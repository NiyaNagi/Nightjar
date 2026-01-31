/**
 * P2P E2E Test Harness
 * 
 * Extends the ConcurrencyTestHarness to support P2P transport testing.
 * Manages P2P-aware test clients with WebSocket, WebRTC, and optional
 * Hyperswarm transports.
 * 
 * Key features:
 * - Real P2P connections (not mocked)
 * - WebRTC via wrtc package
 * - Multi-transport sync verification
 * - Peer discovery assertions
 * - Transport failover testing
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { P2PTestClient, generateDocId, generateWorkspaceId, sleep } = require('./p2p-test-client');
const { PortAllocator } = require('./port-allocator');
const { MessageRecorder } = require('./message-recorder');
const { ChaosProxyPair } = require('./chaos-proxy');
const { assertTextIdentical, waitForConvergence } = require('./crdt-assertions');
const { timedLog } = require('./test-stability');

/**
 * Start the unified server
 */
class UnifiedServerProcess {
  constructor(options = {}) {
    this.port = options.port || 3000;
    this.disablePersistence = options.disablePersistence || false;
    this.process = null;
    this.ready = false;
    this.serverDir = path.join(__dirname, '../../server/unified');
  }

  async start() {
    return new Promise((resolve, reject) => {
      const args = ['index.js'];
      if (this.disablePersistence) {
        args.push('--no-persist');
      }
      
      const env = {
        ...process.env,
        PORT: this.port.toString(),
      };

      this.process = spawn('node', args, {
        cwd: this.serverDir,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const timeout = setTimeout(() => {
        reject(new Error('Server start timeout'));
      }, 30000);

      let output = '';
      
      this.process.stdout.on('data', (data) => {
        output += data.toString();
        // Check for server ready message
        if (output.includes('Nightjar Unified Server') || output.includes(`http://localhost:${this.port}`)) {
          this.ready = true;
          clearTimeout(timeout);
          resolve();
        }
      });

      this.process.stderr.on('data', (data) => {
        console.error(`[UnifiedServer] stderr: ${data}`);
      });

      this.process.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      this.process.on('close', (code) => {
        if (!this.ready) {
          clearTimeout(timeout);
          reject(new Error(`Server exited with code ${code}`));
        }
      });
    });
  }

  stop() {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.ready = false;
  }
}

/**
 * P2P E2E Test Harness
 * 
 * Manages a complete P2P test environment with unified server and P2P clients.
 */
class P2PTestHarness {
  constructor(options = {}) {
    this.clientCount = options.clientCount || 2;
    this.testName = options.testName || 'p2p-test';
    this.enableWebRTC = options.enableWebRTC !== false && P2PTestClient.hasWebRTC();
    this.chaosEnabled = options.chaosEnabled || false;
    this.traceAll = options.traceAll || process.argv.includes('--trace-all');
    this.disablePersistence = options.disablePersistence || false;
    
    // Components
    this.server = null;
    this.clients = [];
    this.ports = null;
    this.chaosProxy = null;
    this.recorder = null;
    
    // State
    this.isSetup = false;
    this.testPassed = true;
    this.testError = null;
    this.currentWorkspaceId = null;
  }

  /**
   * Set up the test environment
   */
  async setup() {
    if (this.isSetup) {
      throw new Error('Harness already set up');
    }

    timedLog(`[P2PHarness] Setting up ${this.clientCount} P2P clients for: ${this.testName}`);

    // Allocate ports
    const allocator = new PortAllocator();
    this.ports = await allocator.allocate();
    this.portAllocator = allocator;
    
    timedLog(`[P2PHarness] Allocated ports: ${this.ports.metaPort}, ${this.ports.yjsPort}`);

    // Start unified server
    this.server = new UnifiedServerProcess({
      port: this.ports.yjsPort, // Use the Yjs port for unified server
      disablePersistence: this.disablePersistence,
    });
    
    try {
      await this.server.start();
      timedLog(`[P2PHarness] Unified server started on port ${this.ports.yjsPort}`);
    } catch (e) {
      console.error(`[P2PHarness] Failed to start server:`, e);
      // Continue without server for pure P2P tests
    }

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
      timedLog(`[P2PHarness] Chaos proxy started`);
    }

    // Create message recorder
    this.recorder = new MessageRecorder({
      testName: this.testName,
      enabled: true,
    });

    // Create P2P clients
    for (let i = 0; i < this.clientCount; i++) {
      const client = new P2PTestClient(`P2PClient${i + 1}`, {
        enableWebRTC: this.enableWebRTC,
        displayName: `Test User ${i + 1}`,
        color: `#${(0x3498db + i * 0x123456).toString(16).slice(0, 6)}`,
      });
      this.clients.push(client);
    }

    this.isSetup = true;
    timedLog(`[P2PHarness] Setup complete`);
  }

  /**
   * Get connection ports (proxy ports if chaos enabled)
   */
  getConnectionPorts() {
    if (this.chaosEnabled && this.proxyPorts) {
      return this.proxyPorts;
    }
    return this.ports;
  }

  /**
   * Connect all clients to signaling server
   */
  async connectAllSignaling() {
    const ports = this.getConnectionPorts();
    await Promise.all(
      this.clients.map(client => client.connectSignaling(ports.yjsPort))
    );
    timedLog(`[P2PHarness] All clients connected to signaling`);
  }

  /**
   * Join all clients to a P2P workspace
   */
  async joinAllP2P(workspaceId = null) {
    this.currentWorkspaceId = workspaceId || generateWorkspaceId();
    const ports = this.getConnectionPorts();
    
    // Join sequentially to ensure proper peer discovery
    for (const client of this.clients) {
      await client.joinP2P(this.currentWorkspaceId, { port: ports.yjsPort });
      await sleep(100); // Small delay for peer announcements
    }
    
    timedLog(`[P2PHarness] All clients joined workspace: ${this.currentWorkspaceId.slice(0, 8)}...`);
    return this.currentWorkspaceId;
  }

  /**
   * Connect all clients to Yjs for document sync
   */
  async connectAllYjs(docId) {
    const ports = this.getConnectionPorts();
    await Promise.all(
      this.clients.map(client => client.connectYjs(docId, ports.yjsPort))
    );
    timedLog(`[P2PHarness] All clients connected to Yjs doc: ${docId}`);
  }

  /**
   * Wait for all clients to discover each other
   */
  async waitForPeerDiscovery(timeout = 10000) {
    const expectedPeers = this.clientCount - 1;
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
      let allDiscovered = true;
      for (const client of this.clients) {
        if (client.getConnectedPeerCount() < expectedPeers) {
          allDiscovered = false;
          break;
        }
      }
      
      if (allDiscovered) {
        timedLog(`[P2PHarness] All peers discovered each other`);
        return true;
      }
      
      await sleep(100);
    }
    
    throw new Error(`Peer discovery timeout. Expected ${expectedPeers} peers each.`);
  }

  /**
   * Wait for WebRTC connections to establish
   */
  async waitForWebRTC(timeout = 15000) {
    if (!this.enableWebRTC) {
      timedLog(`[P2PHarness] WebRTC not enabled, skipping`);
      return false;
    }
    
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
      let webrtcCount = 0;
      for (const client of this.clients) {
        webrtcCount += client.getWebRTCPeers().length;
      }
      
      // At least some WebRTC connections established
      if (webrtcCount > 0) {
        timedLog(`[P2PHarness] WebRTC connections established: ${webrtcCount}`);
        return true;
      }
      
      await sleep(200);
    }
    
    console.warn(`[P2PHarness] WebRTC connection timeout`);
    return false;
  }

  /**
   * Execute operation on all clients in parallel
   */
  async parallel(fn) {
    return Promise.all(
      this.clients.map((client, index) => fn(client, index))
    );
  }

  /**
   * Execute operation on all clients sequentially
   */
  async sequential(fn) {
    const results = [];
    for (let i = 0; i < this.clients.length; i++) {
      results.push(await fn(this.clients[i], i));
    }
    return results;
  }

  /**
   * Execute operation with staggered timing
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
      throw new Error('Chaos not enabled');
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
   * Reset chaos conditions
   */
  resetChaos() {
    if (this.chaosProxy) {
      this.chaosProxy.reset();
    }
    return this;
  }

  /**
   * Simulate network partition
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
   * Wait for convergence
   */
  async waitForConvergence(field = 'content', timeout) {
    return waitForConvergence(this.clients, field, timeout);
  }

  /**
   * Assert peer counts match expectations
   */
  assertPeerCounts(expected) {
    for (let i = 0; i < this.clients.length; i++) {
      const actual = this.clients[i].getConnectedPeerCount();
      if (actual !== expected) {
        throw new Error(`Client ${i} has ${actual} peers, expected ${expected}`);
      }
    }
  }

  /**
   * Get WebRTC connection stats
   */
  getWebRTCStats() {
    const stats = {
      totalConnections: 0,
      clientConnections: [],
    };
    
    for (const client of this.clients) {
      const webrtcPeers = client.getWebRTCPeers();
      stats.totalConnections += webrtcPeers.length;
      stats.clientConnections.push({
        name: client.name,
        webrtcPeers: webrtcPeers.length,
        totalPeers: client.getConnectedPeerCount(),
      });
    }
    
    return stats;
  }

  /**
   * Mark test as failed
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

    timedLog(`[P2PHarness] Tearing down...`);

    // Dump trace if failed or traceAll enabled
    if (!this.testPassed || this.traceAll) {
      try {
        // Record final state
        const stats = this.getWebRTCStats();
        console.log(`[P2PHarness] Final WebRTC stats:`, stats);
      } catch (e) {
        // Ignore
      }
    }

    // Disconnect all clients
    for (const client of this.clients) {
      try {
        await client.disconnect();
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

    // Stop server
    if (this.server) {
      this.server.stop();
      this.server = null;
    }

    // Release ports
    if (this.portAllocator) {
      await this.portAllocator.releaseAll();
    }
    if (this.proxyPortAllocator) {
      await this.proxyPortAllocator.releaseAll();
    }

    this.isSetup = false;
    timedLog(`[P2PHarness] Teardown complete`);
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
 * Helper to run a P2P test
 */
async function withP2PHarness(options, testFn) {
  if (typeof options === 'function') {
    testFn = options;
    options = {};
  }
  
  const harness = new P2PTestHarness(options);
  return harness.run(testFn);
}

module.exports = {
  P2PTestHarness,
  UnifiedServerProcess,
  withP2PHarness,
};
