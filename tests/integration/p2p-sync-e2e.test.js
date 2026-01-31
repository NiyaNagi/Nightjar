/**
 * P2P Sync End-to-End Tests
 * 
 * Comprehensive tests for P2P mesh networking:
 * - Multi-transport sync convergence
 * - Recursive peer discovery
 * - WebRTC direct connections
 * - Transport failover
 * - Network partition recovery
 * - Relay-only mode
 * 
 * Run with: node tests/integration/p2p-sync-e2e.test.js
 * Run with WebRTC: node tests/integration/p2p-sync-e2e.test.js --webrtc
 */

const { P2PTestHarness, withP2PHarness } = require('./p2p-e2e-harness');
const { P2PTestClient, generateDocId, generateWorkspaceId, sleep, hasWebRTC } = require('./p2p-test-client');
const { assertTextIdentical } = require('./crdt-assertions');

// Test configuration
const ENABLE_WEBRTC = process.argv.includes('--webrtc') && hasWebRTC();
const VERBOSE = process.argv.includes('--verbose');

// Test results
const results = {
  passed: 0,
  failed: 0,
  skipped: 0,
  tests: [],
};

/**
 * Test helper - run a test and track results
 */
async function runTest(name, testFn, options = {}) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: ${name}`);
  console.log('='.repeat(60));
  
  const startTime = Date.now();
  
  try {
    await testFn();
    const duration = Date.now() - startTime;
    console.log(`✅ PASSED (${duration}ms)`);
    results.passed++;
    results.tests.push({ name, status: 'passed', duration });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ FAILED (${duration}ms):`, error.message);
    if (VERBOSE) {
      console.error(error.stack);
    }
    results.failed++;
    results.tests.push({ name, status: 'failed', duration, error: error.message });
  }
}

/**
 * Skip a test
 */
function skipTest(name, reason) {
  console.log(`\n⏭️  SKIPPED: ${name} (${reason})`);
  results.skipped++;
  results.tests.push({ name, status: 'skipped', reason });
}

// =============================================================================
// TEST SUITE: Peer Discovery
// =============================================================================

async function testBasicPeerDiscovery() {
  await withP2PHarness({
    testName: 'basic-peer-discovery',
    clientCount: 3,
    enableWebRTC: false, // Pure signaling test
  }, async (harness) => {
    // Connect all clients to signaling
    await harness.connectAllSignaling();
    
    // Join workspace
    await harness.joinAllP2P();
    
    // Wait for peer discovery
    await harness.waitForPeerDiscovery(5000);
    
    // Verify each client sees 2 peers
    harness.assertPeerCounts(2);
    
    console.log('  ✓ All 3 clients discovered each other');
  });
}

async function testRecursivePeerDiscovery() {
  await withP2PHarness({
    testName: 'recursive-peer-discovery',
    clientCount: 5,
    enableWebRTC: false,
  }, async (harness) => {
    const workspaceId = generateWorkspaceId();
    
    // Join clients one by one (simulating real-world joining)
    for (let i = 0; i < harness.clients.length; i++) {
      await harness.clients[i].connectSignaling(harness.getConnectionPorts().yjsPort);
      await harness.clients[i].joinP2P(workspaceId, { port: harness.getConnectionPorts().yjsPort });
      console.log(`  Client ${i + 1} joined`);
      await sleep(200);
    }
    
    // Wait for all to discover each other
    await harness.waitForPeerDiscovery(10000);
    
    // Each client should see 4 peers
    harness.assertPeerCounts(4);
    
    console.log('  ✓ All 5 clients recursively discovered each other');
  });
}

async function testLateJoiner() {
  await withP2PHarness({
    testName: 'late-joiner',
    clientCount: 2,
    enableWebRTC: false,
  }, async (harness) => {
    const workspaceId = generateWorkspaceId();
    
    // First client joins
    await harness.clients[0].connectSignaling(harness.getConnectionPorts().yjsPort);
    await harness.clients[0].joinP2P(workspaceId, { port: harness.getConnectionPorts().yjsPort });
    
    // Wait a bit
    await sleep(500);
    
    // Second client joins late
    await harness.clients[1].connectSignaling(harness.getConnectionPorts().yjsPort);
    await harness.clients[1].joinP2P(workspaceId, { port: harness.getConnectionPorts().yjsPort });
    
    // Both should discover each other
    await harness.waitForPeerDiscovery(5000);
    
    harness.assertPeerCounts(1);
    
    console.log('  ✓ Late joiner discovered existing peer');
  });
}

// =============================================================================
// TEST SUITE: Document Sync via Y.js
// =============================================================================

async function testTwoClientYjsSync() {
  await withP2PHarness({
    testName: 'two-client-yjs-sync',
    clientCount: 2,
    enableWebRTC: false,
  }, async (harness) => {
    const docId = generateDocId();
    
    // Connect to Yjs
    await harness.connectAllYjs(docId);
    
    // Client 1 inserts text
    harness.clients[0].insertText('Hello from Client 1!');
    
    // Wait for sync
    await sleep(500);
    
    // Client 2 should see the text
    const text0 = harness.clients[0].getText();
    const text1 = harness.clients[1].getText();
    
    if (text0 !== text1) {
      throw new Error(`Texts don't match: "${text0}" vs "${text1}"`);
    }
    
    console.log(`  ✓ Text synced: "${text0}"`);
  });
}

async function testConcurrentEdits() {
  await withP2PHarness({
    testName: 'concurrent-edits',
    clientCount: 3,
    enableWebRTC: false,
  }, async (harness) => {
    const docId = generateDocId();
    
    // Connect to Yjs
    await harness.connectAllYjs(docId);
    
    // All clients edit concurrently
    harness.clients[0].insertText('AAA');
    harness.clients[1].insertText('BBB');
    harness.clients[2].insertText('CCC');
    
    // Wait for sync
    await sleep(1000);
    
    // All should converge
    await harness.assertAllConverged('content', 5000);
    
    const finalText = harness.clients[0].getText();
    console.log(`  ✓ Converged to: "${finalText}"`);
    
    // Verify all text is present (order may vary due to CRDT)
    if (!finalText.includes('AAA') || !finalText.includes('BBB') || !finalText.includes('CCC')) {
      throw new Error('Not all edits are present in final text');
    }
  });
}

async function testInterleavedTyping() {
  await withP2PHarness({
    testName: 'interleaved-typing',
    clientCount: 2,
    enableWebRTC: false,
  }, async (harness) => {
    const docId = generateDocId();
    
    // Connect to Yjs
    await harness.connectAllYjs(docId);
    
    // Alternate typing character by character
    const word1 = 'Hello';
    const word2 = 'World';
    
    for (let i = 0; i < Math.max(word1.length, word2.length); i++) {
      if (i < word1.length) {
        const pos = harness.clients[0].getText().length;
        harness.clients[0].insertText(word1[i], pos);
      }
      if (i < word2.length) {
        const pos = harness.clients[1].getText().length;
        harness.clients[1].insertText(word2[i], pos);
      }
      await sleep(50);
    }
    
    // Wait for final sync
    await sleep(500);
    
    await harness.assertAllConverged('content', 5000);
    
    const finalText = harness.clients[0].getText();
    console.log(`  ✓ Interleaved result: "${finalText}"`);
  });
}

// =============================================================================
// TEST SUITE: WebRTC Direct Connections
// =============================================================================

async function testWebRTCConnection() {
  if (!hasWebRTC()) {
    skipTest('WebRTC Direct Connection', 'wrtc not available');
    return;
  }
  
  await withP2PHarness({
    testName: 'webrtc-connection',
    clientCount: 2,
    enableWebRTC: true,
  }, async (harness) => {
    // Join workspace
    await harness.connectAllSignaling();
    await harness.joinAllP2P();
    
    // Wait for WebRTC
    const hasRTC = await harness.waitForWebRTC(15000);
    
    if (!hasRTC) {
      throw new Error('WebRTC connection failed to establish');
    }
    
    const stats = harness.getWebRTCStats();
    console.log(`  ✓ WebRTC established: ${stats.totalConnections} connections`);
    
    // Verify at least one WebRTC connection per client
    for (const client of stats.clientConnections) {
      if (client.webrtcPeers === 0) {
        throw new Error(`Client ${client.name} has no WebRTC connections`);
      }
    }
  });
}

async function testWebRTCDirectMessage() {
  if (!hasWebRTC()) {
    skipTest('WebRTC Direct Message', 'wrtc not available');
    return;
  }
  
  await withP2PHarness({
    testName: 'webrtc-direct-message',
    clientCount: 2,
    enableWebRTC: true,
  }, async (harness) => {
    // Join workspace
    await harness.connectAllSignaling();
    await harness.joinAllP2P();
    await harness.waitForWebRTC(15000);
    
    // Setup message receiver
    let receivedMessage = null;
    harness.clients[1].on('p2p-message', ({ message }) => {
      receivedMessage = message;
    });
    
    // Send message via WebRTC
    const testMessage = { type: 'test', data: 'Hello via WebRTC' };
    const rtcPeers = harness.clients[0].getWebRTCPeers();
    
    if (rtcPeers.length === 0) {
      throw new Error('No WebRTC peers available');
    }
    
    harness.clients[0].sendP2P(rtcPeers[0], testMessage);
    
    // Wait for message
    await sleep(500);
    
    if (!receivedMessage || receivedMessage.data !== testMessage.data) {
      throw new Error('Message not received via WebRTC');
    }
    
    console.log(`  ✓ Message sent and received via WebRTC`);
  });
}

// =============================================================================
// TEST SUITE: Transport Failover
// =============================================================================

async function testFallbackToRelay() {
  await withP2PHarness({
    testName: 'fallback-to-relay',
    clientCount: 2,
    enableWebRTC: false, // Force relay-only
  }, async (harness) => {
    // Join workspace
    await harness.connectAllSignaling();
    await harness.joinAllP2P();
    await harness.waitForPeerDiscovery(5000);
    
    // Verify relay connection works
    const docId = generateDocId();
    await harness.connectAllYjs(docId);
    
    harness.clients[0].insertText('Relay test message');
    await sleep(500);
    
    const text1 = harness.clients[1].getText();
    if (!text1.includes('Relay test message')) {
      throw new Error('Relay sync failed');
    }
    
    console.log('  ✓ Relay-only sync works');
  });
}

// =============================================================================
// TEST SUITE: Network Resilience
// =============================================================================

async function testReconnectAfterDisconnect() {
  await withP2PHarness({
    testName: 'reconnect-after-disconnect',
    clientCount: 2,
    enableWebRTC: false,
  }, async (harness) => {
    const workspaceId = generateWorkspaceId();
    const docId = generateDocId();
    
    // Connect and sync
    await harness.connectAllSignaling();
    await harness.joinAllP2P(workspaceId);
    await harness.connectAllYjs(docId);
    
    // Initial edit
    harness.clients[0].insertText('Before disconnect');
    await sleep(300);
    
    // Disconnect client 1
    await harness.clients[1].disconnect();
    console.log('  Client 1 disconnected');
    
    // Client 0 continues editing
    harness.clients[0].insertText(' - Added while offline');
    await sleep(300);
    
    // Reconnect client 1
    const client1 = harness.clients[1];
    await client1.connectSignaling(harness.getConnectionPorts().yjsPort);
    await client1.joinP2P(workspaceId, { port: harness.getConnectionPorts().yjsPort });
    await client1.connectYjs(docId, harness.getConnectionPorts().yjsPort);
    console.log('  Client 1 reconnected');
    
    // Wait for sync
    await sleep(1000);
    
    // Should have all content
    const text1 = harness.clients[1].getText();
    if (!text1.includes('Before disconnect') || !text1.includes('Added while offline')) {
      throw new Error(`Reconnect sync failed. Text: "${text1}"`);
    }
    
    console.log('  ✓ Reconnect synced all content');
  });
}

// =============================================================================
// TEST SUITE: Relay-Only Mode (Server with --no-persist)
// =============================================================================

async function testRelayOnlyMode() {
  await withP2PHarness({
    testName: 'relay-only-mode',
    clientCount: 2,
    enableWebRTC: false,
    disablePersistence: true, // Server runs with --no-persist
  }, async (harness) => {
    const docId = generateDocId();
    
    // Connect and sync
    await harness.connectAllSignaling();
    await harness.joinAllP2P();
    await harness.connectAllYjs(docId);
    
    // Edit and sync
    harness.clients[0].insertText('No persistence test');
    await sleep(500);
    
    const text1 = harness.clients[1].getText();
    if (!text1.includes('No persistence test')) {
      throw new Error('Sync failed in relay-only mode');
    }
    
    console.log('  ✓ Relay-only mode syncs correctly');
  });
}

// =============================================================================
// TEST SUITE: Stress Tests
// =============================================================================

async function testFiveClientSync() {
  await withP2PHarness({
    testName: 'five-client-sync',
    clientCount: 5,
    enableWebRTC: false,
  }, async (harness) => {
    const docId = generateDocId();
    
    // Connect all
    await harness.connectAllSignaling();
    await harness.joinAllP2P();
    await harness.waitForPeerDiscovery(10000);
    await harness.connectAllYjs(docId);
    
    // All clients edit
    await harness.parallel(async (client, index) => {
      client.insertText(`[Client${index}]`);
    });
    
    // Wait for convergence
    await sleep(2000);
    await harness.assertAllConverged('content', 10000);
    
    const finalText = harness.clients[0].getText();
    console.log(`  ✓ 5 clients converged: "${finalText}"`);
    
    // Verify all client markers present
    for (let i = 0; i < 5; i++) {
      if (!finalText.includes(`[Client${i}]`)) {
        throw new Error(`Missing edit from Client${i}`);
      }
    }
  });
}

async function testRapidEdits() {
  await withP2PHarness({
    testName: 'rapid-edits',
    clientCount: 2,
    enableWebRTC: false,
  }, async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllYjs(docId);
    
    // Rapid fire edits
    const editCount = 50;
    for (let i = 0; i < editCount; i++) {
      harness.clients[i % 2].insertText(`${i}`);
      if (i % 10 === 0) {
        await sleep(10); // Small pause every 10 edits
      }
    }
    
    // Wait for sync
    await sleep(2000);
    await harness.assertAllConverged('content', 10000);
    
    const finalText = harness.clients[0].getText();
    console.log(`  ✓ ${editCount} rapid edits converged (length: ${finalText.length})`);
  });
}

// =============================================================================
// Main Test Runner
// =============================================================================

async function runAllTests() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║           P2P Sync End-to-End Test Suite                    ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║  WebRTC: ${ENABLE_WEBRTC ? 'ENABLED' : 'DISABLED (use --webrtc to enable)'}`.padEnd(61) + '║');
  console.log(`║  Verbose: ${VERBOSE ? 'ON' : 'OFF'}`.padEnd(61) + '║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const startTime = Date.now();

  // Peer Discovery Tests
  console.log('\n📡 PEER DISCOVERY TESTS\n');
  await runTest('Basic Peer Discovery (3 clients)', testBasicPeerDiscovery);
  await runTest('Recursive Peer Discovery (5 clients)', testRecursivePeerDiscovery);
  await runTest('Late Joiner Discovery', testLateJoiner);

  // Y.js Sync Tests
  console.log('\n📝 DOCUMENT SYNC TESTS\n');
  await runTest('Two Client Y.js Sync', testTwoClientYjsSync);
  await runTest('Concurrent Edits (3 clients)', testConcurrentEdits);
  await runTest('Interleaved Typing', testInterleavedTyping);

  // WebRTC Tests
  console.log('\n🔗 WEBRTC TESTS\n');
  await runTest('WebRTC Connection', testWebRTCConnection);
  await runTest('WebRTC Direct Message', testWebRTCDirectMessage);

  // Transport Failover Tests
  console.log('\n🔄 TRANSPORT FAILOVER TESTS\n');
  await runTest('Fallback to Relay', testFallbackToRelay);

  // Network Resilience Tests
  console.log('\n🌐 NETWORK RESILIENCE TESTS\n');
  await runTest('Reconnect After Disconnect', testReconnectAfterDisconnect);

  // Relay-Only Mode Tests
  console.log('\n⚡ RELAY-ONLY MODE TESTS\n');
  await runTest('Relay-Only Mode', testRelayOnlyMode);

  // Stress Tests
  console.log('\n🔥 STRESS TESTS\n');
  await runTest('Five Client Sync', testFiveClientSync);
  await runTest('Rapid Edits (50 operations)', testRapidEdits);

  // Summary
  const duration = Date.now() - startTime;
  console.log('\n' + '═'.repeat(60));
  console.log('TEST RESULTS SUMMARY');
  console.log('═'.repeat(60));
  console.log(`  ✅ Passed:  ${results.passed}`);
  console.log(`  ❌ Failed:  ${results.failed}`);
  console.log(`  ⏭️  Skipped: ${results.skipped}`);
  console.log(`  ⏱️  Duration: ${(duration / 1000).toFixed(1)}s`);
  console.log('═'.repeat(60));

  // Exit code
  process.exit(results.failed > 0 ? 1 : 0);
}

// Run tests
runAllTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
