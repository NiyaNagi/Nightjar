/**
 * Concurrency Test Harness
 * 
 * Orchestrates multi-client tests with proper setup, teardown,
 * and debugging support.
 */

const path = require('path');
const fs = require('fs');
const { TestClient, SidecarProcess, generateKey, sleep } = require('./test-utils');
const { PortAllocator, allocatePorts, releasePorts } = require('./port-allocator');
const { MessageRecorder } = require('./message-recorder');
const { ChaosProxyPair } = require('./chaos-proxy');
const { assertTextIdentical, waitForConvergence } = require('./crdt-assertions');
const { waitForQuiescence, timedLog } = require('./test-stability');

/**
 * ConcurrencyTestHarness
 * 
 * Manages a complete test environment with sidecar, clients, and optional chaos.
 */
class ConcurrencyTestHarness {
    constructor(options = {}) {
        this.clientCount = options.clientCount || 2;
        this.useDynamicPorts = options.dynamicPorts !== false;
        this.chaosEnabled = options.chaosEnabled || false;
        this.traceAll = options.traceAll || process.argv.includes('--trace-all');
        
        this.testName = options.testName || 'unnamed-test';
        this.sessionKey = options.sessionKey || generateKey();
        
        // Components (initialized in setup)
        this.sidecar = null;
        this.clients = [];
        this.ports = null;
        this.chaosProxy = null;
        this.recorder = null;
        
        // State
        this.isSetup = false;
        this.testPassed = true;
        this.testError = null;
    }

    /**
     * Set up the test environment
     */
    async setup() {
        if (this.isSetup) {
            throw new Error('Harness already set up');
        }

        timedLog(`[Harness] Setting up ${this.clientCount} clients for: ${this.testName}`);

        // Allocate ports
        if (this.useDynamicPorts) {
            const allocator = new PortAllocator();
            this.ports = await allocator.allocate();
            this.portAllocator = allocator;
        } else {
            this.ports = { metaPort: 8081, yjsPort: 8080 };
        }

        // Create storage directory
        const storageDir = path.join(__dirname, `test-storage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

        // Start sidecar
        this.sidecar = new SidecarProcess({
            metaPort: this.ports.metaPort,
            yjsPort: this.ports.yjsPort,
            storageDir,
        });
        
        await this.sidecar.start();
        timedLog(`[Harness] Sidecar started on ports ${this.ports.metaPort}/${this.ports.yjsPort}`);

        // Set up chaos proxy if enabled
        if (this.chaosEnabled) {
            const proxyAllocator = new PortAllocator();
            this.proxyPorts = await proxyAllocator.allocate();
            this.proxyPortAllocator = proxyAllocator;
            
            this.chaosProxy = new ChaosProxyPair({
                metaPort: this.ports.metaPort,
                yjsPort: this.ports.yjsPort,
                metaProxyPort: this.proxyPorts.metaPort,
                yjsProxyPort: this.proxyPorts.yjsPort,
            });
            
            await this.chaosProxy.start();
            timedLog(`[Harness] Chaos proxy started on ports ${this.proxyPorts.metaPort}/${this.proxyPorts.yjsPort}`);
        }

        // Create message recorder
        this.recorder = new MessageRecorder({
            testName: this.testName,
            enabled: true,
        });

        // Create clients
        for (let i = 0; i < this.clientCount; i++) {
            const client = new TestClient(`Client${i + 1}`, {
                sessionKey: this.sessionKey,
            });
            this.clients.push(client);
            this.recorder.wrapClient(client);
        }

        this.isSetup = true;
        timedLog(`[Harness] Setup complete`);
    }

    /**
     * Get the ports clients should connect to
     * (proxy ports if chaos enabled, otherwise sidecar ports)
     */
    getConnectionPorts() {
        if (this.chaosEnabled && this.proxyPorts) {
            return this.proxyPorts;
        }
        return this.ports;
    }

    /**
     * Connect all clients to metadata WebSocket
     */
    async connectAllMeta() {
        const ports = this.getConnectionPorts();
        await Promise.all(
            this.clients.map(client => client.connectMeta(ports.metaPort))
        );
        timedLog(`[Harness] All clients connected to metadata`);
    }

    /**
     * Connect all clients to a Yjs document
     */
    async connectAllYjs(docId) {
        const ports = this.getConnectionPorts();
        await Promise.all(
            this.clients.map(client => client.connectYjs(docId, ports.yjsPort))
        );
        timedLog(`[Harness] All clients connected to doc: ${docId}`);
    }

    /**
     * Execute an operation on all clients in parallel
     */
    async parallel(fn) {
        return Promise.all(
            this.clients.map((client, index) => fn(client, index))
        );
    }

    /**
     * Execute an operation on all clients sequentially
     */
    async sequential(fn) {
        const results = [];
        for (let i = 0; i < this.clients.length; i++) {
            results.push(await fn(this.clients[i], i));
        }
        return results;
    }

    /**
     * Execute an operation on all clients with staggered timing
     */
    async staggered(intervalMs, fn) {
        const results = [];
        for (let i = 0; i < this.clients.length; i++) {
            if (i > 0) {
                await sleep(intervalMs);
            }
            results.push(await fn(this.clients[i], i));
        }
        return results;
    }

    /**
     * Apply chaos settings
     */
    withChaos(settings = {}) {
        if (!this.chaosProxy) {
            throw new Error('Chaos not enabled. Set chaosEnabled: true in constructor.');
        }
        
        if (settings.latency) {
            const [min, max] = Array.isArray(settings.latency) 
                ? settings.latency 
                : [settings.latency, settings.latency];
            this.chaosProxy.setLatency(min, max);
        }
        
        if (settings.packetLoss !== undefined) {
            this.chaosProxy.setPacketLoss(settings.packetLoss);
        }
        
        if (settings.jitter !== undefined) {
            this.chaosProxy.setJitter(settings.jitter);
        }
        
        return this;
    }

    /**
     * Reset chaos to normal conditions
     */
    resetChaos() {
        if (this.chaosProxy) {
            this.chaosProxy.reset();
        }
        return this;
    }

    /**
     * Simulate network partition for a duration
     */
    async partitionFor(durationMs) {
        if (!this.chaosProxy) {
            throw new Error('Chaos not enabled');
        }
        await this.chaosProxy.disconnect(durationMs);
    }

    /**
     * Assert all clients have converged on same content
     */
    async assertAllConverged(field = 'content', timeout) {
        return assertTextIdentical(this.clients, field, timeout);
    }

    /**
     * Wait for convergence and return report
     */
    async waitForConvergence(field = 'content', timeout) {
        return waitForConvergence(this.clients, field, timeout);
    }

    /**
     * Wait for system quiescence
     */
    async waitForQuiet(quietPeriodMs = 200, timeoutMs = 5000) {
        return waitForQuiescence(this.clients, quietPeriodMs, timeoutMs);
    }

    /**
     * Get message trace
     */
    getMessageTrace() {
        return this.recorder.getRecords();
    }

    /**
     * Get message summary
     */
    getMessageSummary() {
        return this.recorder.getSummary();
    }

    /**
     * Mark test as failed (for trace dumping)
     */
    markFailed(error) {
        this.testPassed = false;
        this.testError = error;
    }

    /**
     * Tear down the test environment
     */
    async teardown() {
        if (!this.isSetup) {
            return;
        }

        timedLog(`[Harness] Tearing down...`);

        // Dump trace if test failed or traceAll is enabled
        if (!this.testPassed || this.traceAll) {
            try {
                const tracePath = this.recorder.dumpToFile(this.testName);
                console.log(`[Harness] Trace saved to: ${tracePath}`);
            } catch (e) {
                console.error(`[Harness] Failed to dump trace:`, e.message);
            }
        }

        // Close all clients
        for (const client of this.clients) {
            try {
                this.recorder.unwrapClient(client);
                client.close();
            } catch (e) {
                // Ignore errors during cleanup
            }
        }
        this.clients = [];

        // Stop chaos proxy
        if (this.chaosProxy) {
            await this.chaosProxy.stop();
            this.chaosProxy = null;
        }

        // Stop sidecar
        if (this.sidecar) {
            this.sidecar.cleanup();
            this.sidecar = null;
        }

        // Release ports
        if (this.portAllocator) {
            await this.portAllocator.releaseAll();
        }
        if (this.proxyPortAllocator) {
            await this.proxyPortAllocator.releaseAll();
        }

        this.isSetup = false;
        timedLog(`[Harness] Teardown complete`);
    }

    /**
     * Run a test with automatic setup/teardown
     */
    async run(testFn) {
        try {
            await this.setup();
            await testFn(this);
            return true;
        } catch (error) {
            this.markFailed(error);
            throw error;
        } finally {
            await this.teardown();
        }
    }
}

/**
 * Create a harness and run a test
 */
async function withHarness(options, testFn) {
    if (typeof options === 'function') {
        testFn = options;
        options = {};
    }
    
    const harness = new ConcurrencyTestHarness(options);
    return harness.run(testFn);
}

/**
 * Create multiple harnesses for parallel test file execution
 */
async function withMultipleHarnesses(count, options, testFn) {
    const harnesses = [];
    
    for (let i = 0; i < count; i++) {
        harnesses.push(new ConcurrencyTestHarness({
            ...options,
            testName: `${options.testName || 'test'}-${i}`,
        }));
    }
    
    try {
        await Promise.all(harnesses.map(h => h.setup()));
        await testFn(harnesses);
    } finally {
        await Promise.all(harnesses.map(h => h.teardown()));
    }
}

module.exports = {
    ConcurrencyTestHarness,
    withHarness,
    withMultipleHarnesses,
};
