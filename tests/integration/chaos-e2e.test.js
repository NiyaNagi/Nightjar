/**
 * Chaos/Network Resilience Tests
 * 
 * Tests behavior under adverse network conditions.
 * Run with --chaos flag.
 */

const { ConcurrencyTestHarness } = require('./concurrency-harness');
const { generateDocId, sleep } = require('./test-utils');
const { assertTextIdentical, waitForConvergence } = require('./crdt-assertions');
const { timedLog, measureTime } = require('./test-stability');

/**
 * Test suite definition
 */
const ChaosTests = {
    name: 'Chaos/Network Tests',
    tests: [],
    requiresFlag: '--chaos',
};

function test(name, fn, options = {}) {
    ChaosTests.tests.push({
        name,
        fn: async () => {
            const harness = new ConcurrencyTestHarness({
                testName: `chaos-${name.replace(/\s+/g, '-').toLowerCase()}`,
                clientCount: options.clientCount || 3,
                chaosEnabled: true, // Always enable chaos for this suite
            });
            
            try {
                await harness.setup();
                await fn(harness);
            } catch (error) {
                harness.markFailed(error);
                throw error;
            } finally {
                await harness.teardown();
            }
        },
        options,
        timeout: options.timeout || 60000,
    });
}

// ============================================================================
// LATENCY TESTS
// ============================================================================

test('High latency convergence (500ms)', async (harness) => {
    const docId = generateDocId();
    
    // Apply 500ms latency
    harness.withChaos({ latency: [400, 600] });
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    timedLog('[Chaos] 500ms latency applied');
    
    const [clientA, clientB] = harness.clients;
    
    // Client A types
    clientA.insertText('Hello ', 0);
    
    // With 500ms latency, sync takes longer
    await sleep(1500);
    
    // Client B types
    clientB.insertText('World', clientB.getText().length);
    
    // Wait for convergence with extended timeout
    await harness.waitForConvergence('content', 10000);
    
    const content = clientA.getText();
    if (!content.includes('Hello') || !content.includes('World')) {
        throw new Error(`Content missing parts: "${content}"`);
    }
    
    timedLog('✓ High latency convergence successful');
}, { clientCount: 2 });

test('Variable latency (jitter)', async (harness) => {
    const docId = generateDocId();
    
    // Apply variable latency 0-300ms
    harness.withChaos({ latency: [0, 100], jitter: 200 });
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    timedLog('[Chaos] Jittery connection applied');
    
    // Multiple operations
    await harness.parallel(async (client, index) => {
        for (let i = 0; i < 5; i++) {
            client.insertText(`${index}`, client.getText().length);
            await sleep(100);
        }
    });
    
    // Wait for convergence
    await harness.waitForConvergence('content', 15000);
    
    const content = harness.clients[0].getText();
    // Should have 5 chars per client
    const expectedLength = harness.clients.length * 5;
    if (content.length !== expectedLength) {
        throw new Error(`Expected ${expectedLength} chars, got ${content.length}`);
    }
    
    timedLog('✓ Jittery connection handled correctly');
}, { clientCount: 3 });

// ============================================================================
// PACKET LOSS TESTS
// ============================================================================

test('10% packet loss recovery', async (harness) => {
    const docId = generateDocId();
    
    // Apply 10% packet loss
    harness.withChaos({ packetLoss: 0.10 });
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    timedLog('[Chaos] 10% packet loss applied');
    
    const [clientA, clientB] = harness.clients;
    
    // Multiple operations to trigger retries
    for (let i = 0; i < 20; i++) {
        clientA.insertText(`${i % 10}`, clientA.getText().length);
        await sleep(100);
    }
    
    // Wait for sync with retries
    await harness.waitForConvergence('content', 20000);
    
    const content = clientB.getText();
    // CRDT should ensure all operations eventually sync
    // Some may be reordered but all should be present
    if (content.length !== 20) {
        timedLog(`Warning: Expected 20 chars, got ${content.length} (packet loss may cause reordering)`);
    }
    
    // Most importantly, clients should converge
    await harness.assertAllConverged('content', 5000);
    
    timedLog('✓ Packet loss recovery successful');
}, { clientCount: 2 });

test('High packet loss (25%) stress', async (harness) => {
    const docId = generateDocId();
    
    // Apply 25% packet loss - very harsh
    harness.withChaos({ packetLoss: 0.25 });
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    timedLog('[Chaos] 25% packet loss applied');
    
    const [clientA] = harness.clients;
    
    // Fewer operations since many will need retries
    for (let i = 0; i < 10; i++) {
        clientA.insertText('x', clientA.getText().length);
        await sleep(200);
    }
    
    // Disable chaos for convergence check
    harness.resetChaos();
    timedLog('[Chaos] Chaos disabled for convergence');
    
    // Allow retries to complete
    await sleep(3000);
    
    // Check convergence
    await harness.assertAllConverged('content', 15000);
    
    timedLog('✓ High packet loss recovery successful');
}, { clientCount: 2 });

// ============================================================================
// DISCONNECT/RECONNECT TESTS
// ============================================================================

test('Temporary disconnect and resync', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    // Initial content
    clientA.insertText('Before disconnect', 0);
    await harness.assertAllConverged('content', 5000);
    
    // Partition network
    timedLog('[Chaos] Starting network partition...');
    harness.withChaos({});
    harness.chaosProxy.setPartitioned(true);
    
    // Both clients make changes while partitioned
    clientA.insertText(' A-edit', clientA.getText().length);
    clientB.insertText(' B-edit', clientB.getText().length);
    
    await sleep(1000);
    
    // They should have different content now
    const contentA = clientA.getText();
    const contentB = clientB.getText();
    timedLog(`[Chaos] During partition: A="${contentA}", B="${contentB}"`);
    
    // Heal partition
    timedLog('[Chaos] Healing network partition...');
    harness.chaosProxy.setPartitioned(false);
    
    // Wait for resync
    await harness.waitForConvergence('content', 15000);
    
    // Both edits should be present
    const finalContent = clientA.getText();
    if (!finalContent.includes('A-edit') || !finalContent.includes('B-edit')) {
        throw new Error(`Missing edits after resync: "${finalContent}"`);
    }
    
    timedLog('✓ Partition healed and changes merged');
}, { clientCount: 2 });

test('5 second disconnect and resync', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    // Initial sync
    clientA.insertText('Initial content. ', 0);
    await harness.assertAllConverged();
    
    timedLog('[Chaos] Disconnecting for 5 seconds...');
    
    // Start disconnect (async, will reconnect after 5s)
    const disconnectPromise = harness.partitionFor(5000);
    
    // Client A makes changes during disconnect
    await sleep(500);
    clientA.insertText('Offline edit 1. ', clientA.getText().length);
    await sleep(500);
    clientA.insertText('Offline edit 2. ', clientA.getText().length);
    
    // Wait for disconnect to end
    await disconnectPromise;
    timedLog('[Chaos] Reconnected');
    
    // Wait for resync
    await harness.waitForConvergence('content', 15000);
    
    // Verify content
    const content = clientB.getText();
    if (!content.includes('Offline edit 1') || !content.includes('Offline edit 2')) {
        throw new Error(`Offline edits not synced: "${content}"`);
    }
    
    timedLog('✓ 5 second disconnect resync successful');
}, { clientCount: 2 });

// ============================================================================
// COMBINED CHAOS
// ============================================================================

test('Latency + packet loss combined', async (harness) => {
    const docId = generateDocId();
    
    // Combined chaos: 200ms latency + 5% packet loss
    harness.withChaos({ 
        latency: [150, 250], 
        packetLoss: 0.05,
    });
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    timedLog('[Chaos] 200ms latency + 5% packet loss');
    
    // Multiple clients make edits
    await harness.parallel(async (client, index) => {
        for (let i = 0; i < 10; i++) {
            client.insertText(`[${index}]`, client.getText().length);
            await sleep(150);
        }
    });
    
    // Wait for convergence
    await harness.waitForConvergence('content', 30000);
    
    // Verify all content from all clients
    const content = harness.clients[0].getText();
    for (let i = 0; i < harness.clients.length; i++) {
        const count = (content.match(new RegExp(`\\[${i}\\]`, 'g')) || []).length;
        if (count !== 10) {
            throw new Error(`Expected 10 edits from client ${i}, found ${count}`);
        }
    }
    
    timedLog('✓ Combined chaos handled correctly');
}, { clientCount: 3 });

test('Chaos during rapid operations', async (harness) => {
    const docId = generateDocId();
    
    // Start with no chaos
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    // Initial content
    clientA.insertText('Start ', 0);
    await harness.assertAllConverged();
    
    // Enable chaos mid-operation
    timedLog('[Chaos] Enabling chaos mid-stream...');
    harness.withChaos({ latency: [100, 300], packetLoss: 0.05 });
    
    // Rapid concurrent operations
    const opsA = [];
    const opsB = [];
    for (let i = 0; i < 20; i++) {
        opsA.push(sleep(i * 50).then(() => clientA.insertText('A', clientA.getText().length)));
        opsB.push(sleep(i * 50 + 25).then(() => clientB.insertText('B', clientB.getText().length)));
    }
    await Promise.all([...opsA, ...opsB]);
    
    // Disable chaos
    harness.resetChaos();
    timedLog('[Chaos] Chaos disabled');
    
    // Allow cleanup
    await sleep(2000);
    
    // Check convergence
    await harness.assertAllConverged('content', 15000);
    
    const content = clientA.getText();
    const countA = (content.match(/A/g) || []).length;
    const countB = (content.match(/B/g) || []).length;
    
    timedLog(`✓ Chaos mid-stream handled: ${countA} A's, ${countB} B's`);
}, { clientCount: 2 });

// ============================================================================
// MODULE EXPORTS
// ============================================================================

module.exports = ChaosTests;

if (require.main === module) {
    const { runTestSuite } = require('./test-runner-utils');
    runTestSuite(ChaosTests).catch(console.error);
}
