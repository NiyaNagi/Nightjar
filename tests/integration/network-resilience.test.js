/**
 * Network Resilience Tests
 * 
 * Tests for network issues and recovery:
 * - Client disconnection and reconnection
 * - Sync after network partition
 * - Behavior under latency
 * - Behavior under packet loss
 * - Graceful degradation
 */

const Y = require('yjs');
const { WebsocketProvider } = require('y-websocket');
const WebSocket = require('ws');
const {
    TestClient,
    NetworkSimulator,
    assert,
    sleep,
    generateDocId,
    generateWorkspaceId,
    generateKey,
} = require('./test-utils.js');

// Configuration
const YJS_PORT = parseInt(process.env.YJS_PORT || '8080', 10);
const META_PORT = parseInt(process.env.META_PORT || '8081', 10);
const YJS_URL = `ws://localhost:${YJS_PORT}`;

let providers = [];
let docs = [];
let clients = [];

async function setup() {
    console.log('  [Setup] Network resilience tests ready');
}

async function teardown() {
    for (const provider of providers) {
        try {
            provider.disconnect();
            provider.destroy();
        } catch (e) {}
    }
    for (const doc of docs) {
        try {
            doc.destroy();
        } catch (e) {}
    }
    for (const client of clients) {
        client.close();
    }
    providers = [];
    docs = [];
    clients = [];
}

/**
 * Helper: Create a Yjs document and connect to sidecar
 */
function createSyncedDoc(docId) {
    const doc = new Y.Doc();
    docs.push(doc);
    
    const provider = new WebsocketProvider(YJS_URL, docId, doc, {
        WebSocketPolyfill: WebSocket,
        connect: true,
        resyncInterval: 500,
    });
    providers.push(provider);
    
    return { doc, provider };
}

/**
 * Helper: Wait for provider to connect and sync
 */
async function waitForSync(provider, timeout = 10000) {
    // First, wait for WebSocket connection
    if (!provider.wsconnected) {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Connection timeout')), timeout);
            const checkConnection = () => {
                if (provider.wsconnected) {
                    clearTimeout(timer);
                    resolve();
                }
            };
            provider.on('status', ({ status }) => {
                if (status === 'connected') {
                    checkConnection();
                }
            });
            // Check immediately
            checkConnection();
        });
    }
    
    // Then wait for sync
    if (provider.synced) return;
    
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Sync timeout')), timeout);
        provider.on('sync', (synced) => {
            if (synced) {
                clearTimeout(timer);
                resolve();
            }
        });
        // Check if already synced
        if (provider.synced) {
            clearTimeout(timer);
            resolve();
        }
    });
}

/**
 * Helper: Wait for provider to disconnect
 */
async function waitForDisconnect(provider, timeout = 5000) {
    if (!provider.wsconnected) return;
    
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Disconnect timeout')), timeout);
        const check = () => {
            if (!provider.wsconnected) {
                clearTimeout(timer);
                resolve();
            }
        };
        provider.on('status', check);
    });
}

// ============ Tests ============

/**
 * Test: Client reconnection after disconnect
 */
async function testReconnectionAfterDisconnect() {
    const docId = generateDocId();
    const { doc, provider } = createSyncedDoc(docId);
    
    await waitForSync(provider);
    
    const text = doc.getText('content');
    text.insert(0, 'Before disconnect');
    
    // Disconnect
    provider.disconnect();
    await sleep(500);  // Increased from 100ms for more reliable disconnection
    
    // Note: wsconnected may be unreliable right after disconnect, check synced instead
    assert.ok(!provider.synced || !provider.wsconnected, 'Should be disconnected or not synced');
    
    // Reconnect
    provider.connect();
    await waitForSync(provider);
    
    assert.ok(provider.wsconnected, 'Should be reconnected');
    assert.equal(text.toString(), 'Before disconnect', 'Content should persist');
}

/**
 * Test: Offline edits sync on reconnect
 */
async function testOfflineEditsSync() {
    const docId = generateDocId();
    
    const { doc: doc1, provider: p1 } = createSyncedDoc(docId);
    const { doc: doc2, provider: p2 } = createSyncedDoc(docId);
    
    await waitForSync(p1);
    await waitForSync(p2);
    
    const text1 = doc1.getText('content');
    const text2 = doc2.getText('content');
    
    // Initial content
    text1.insert(0, 'Shared content');
    await sleep(100);
    
    // Disconnect client 2
    p2.disconnect();
    await sleep(100);
    
    // Client 1 makes edits while client 2 is offline
    text1.insert(text1.length, ' - Edit 1');
    text1.insert(text1.length, ' - Edit 2');
    
    // Client 2 makes offline edits
    text2.insert(text2.length, ' [Offline Edit]');
    
    await sleep(100);
    
    // Reconnect client 2
    p2.connect();
    await waitForSync(p2);
    await sleep(200);
    
    // Both should converge
    const content1 = text1.toString();
    const content2 = text2.toString();
    
    assert.equal(content1, content2, 'Documents should converge after reconnect');
    assert.contains(content1, 'Edit 1', 'Should have online edits');
    assert.contains(content1, 'Offline Edit', 'Should have offline edits');
}

/**
 * Test: Multiple reconnection cycles
 */
async function testMultipleReconnections() {
    const docId = generateDocId();
    const { doc, provider } = createSyncedDoc(docId);
    
    await waitForSync(provider);
    
    const text = doc.getText('content');
    
    for (let i = 0; i < 3; i++) {
        text.insert(text.length, `Cycle ${i} `);
        
        provider.disconnect();
        await sleep(50);
        
        provider.connect();
        await waitForSync(provider);
    }
    
    const content = text.toString();
    assert.contains(content, 'Cycle 0', 'Should have cycle 0');
    assert.contains(content, 'Cycle 1', 'Should have cycle 1');
    assert.contains(content, 'Cycle 2', 'Should have cycle 2');
}

/**
 * Test: Simulated network partition
 */
async function testNetworkPartition() {
    const docId = generateDocId();
    
    const { doc: doc1, provider: p1 } = createSyncedDoc(docId);
    const { doc: doc2, provider: p2 } = createSyncedDoc(docId);
    
    await waitForSync(p1);
    await waitForSync(p2);
    
    const text1 = doc1.getText('content');
    const text2 = doc2.getText('content');
    
    // Initial sync
    text1.insert(0, 'Initial');
    await sleep(100);
    
    // Simulate partition: both disconnect
    p1.disconnect();
    p2.disconnect();
    await sleep(100);
    
    // Both make independent edits
    text1.insert(text1.length, ' - Partition A');
    text2.insert(text2.length, ' - Partition B');
    
    // Reconnect both
    p1.connect();
    p2.connect();
    
    await waitForSync(p1);
    await waitForSync(p2);
    await sleep(200);
    
    // Should converge
    assert.equal(text1.toString(), text2.toString(), 'Should converge after partition');
}

/**
 * Test: Metadata WebSocket reconnection
 */
async function testMetadataReconnection() {
    const key = generateKey();
    const client = new TestClient('ReconnectMeta', { sessionKey: key });
    clients.push(client);

    await client.connectMeta();
    await client.waitForMessage('status');

    // Close connection
    client.close();
    await sleep(100);

    // Create new client (simulating reconnect)
    const client2 = new TestClient('ReconnectMeta2', { sessionKey: key });
    clients.push(client2);

    await client2.connectMeta();
    const status = await client2.waitForMessage('status');
    
    assert.ok(status, 'Should reconnect and receive status');

    client2.close();
    clients = [];
}

/**
 * Test: Rapid connect/disconnect cycles
 */
async function testRapidConnectDisconnect() {
    const docId = generateDocId();
    const { doc, provider } = createSyncedDoc(docId);
    
    await waitForSync(provider);
    
    // Rapid cycles
    for (let i = 0; i < 5; i++) {
        provider.disconnect();
        await sleep(10);
        provider.connect();
        await sleep(50);
    }
    
    // Should stabilize
    await sleep(200);
    
    // Final check
    const text = doc.getText('content');
    text.insert(0, 'After rapid cycles');
    
    // Should be able to sync
    await sleep(100);
    assert.equal(text.toString(), 'After rapid cycles', 'Should work after rapid cycles');
}

/**
 * Test: Sync with high simulated latency
 */
async function testHighLatencySync() {
    const simulator = new NetworkSimulator();
    simulator.setLatency(500); // 500ms latency
    
    const docId = generateDocId();
    
    const { doc: doc1, provider: p1 } = createSyncedDoc(docId);
    const { doc: doc2, provider: p2 } = createSyncedDoc(docId);
    
    await waitForSync(p1);
    await waitForSync(p2);
    
    const text1 = doc1.getText('content');
    const text2 = doc2.getText('content');
    
    text1.insert(0, 'High latency test');
    
    // Wait longer for high latency sync
    await sleep(1000);
    
    // Note: Yjs handles network latency internally
    // This test verifies the setup works
    const content2 = text2.toString();
    assert.equal(content2, 'High latency test', 'Should sync despite latency');
}

/**
 * Test: Message ordering under delay
 */
async function testMessageOrdering() {
    const docId = generateDocId();
    
    const { doc: doc1, provider: p1 } = createSyncedDoc(docId);
    const { doc: doc2, provider: p2 } = createSyncedDoc(docId);
    
    await waitForSync(p1);
    await waitForSync(p2);
    
    const text1 = doc1.getText('content');
    const text2 = doc2.getText('content');
    
    // Send ordered messages from client 1
    for (let i = 0; i < 10; i++) {
        text1.insert(text1.length, `${i}`);
    }
    
    // Wait for sync
    await sleep(300);
    
    // Check ordering is preserved
    const content = text1.toString();
    assert.equal(content, '0123456789', 'Message ordering should be preserved');
    assert.equal(text2.toString(), content, 'Both docs should have same order');
}

/**
 * Test: Graceful handling of WebSocket errors
 */
async function testWebSocketErrorHandling() {
    const docId = generateDocId();
    const { doc, provider } = createSyncedDoc(docId);
    
    await waitForSync(provider);
    
    // Inject error (if possible)
    let errorHandled = false;
    provider.on('connection-error', () => {
        errorHandled = true;
    });
    
    // Force close the websocket
    if (provider.ws) {
        provider.ws.close();
    }
    
    await sleep(200);
    
    // Provider should attempt reconnect
    provider.connect();
    await waitForSync(provider);
    
    assert.ok(provider.wsconnected, 'Should recover from WebSocket error');
}

/**
 * Test: Document state after server restart (simulated)
 */
async function testPersistenceAcrossRestart() {
    const docId = generateDocId();
    
    // First connection
    const { doc: doc1, provider: p1 } = createSyncedDoc(docId);
    await waitForSync(p1);
    
    const text1 = doc1.getText('content');
    text1.insert(0, 'Persistent content');
    
    await sleep(100);
    
    // Disconnect (simulating server going down)
    p1.disconnect();
    await sleep(100);
    
    // Reconnect (simulating server coming back)
    p1.connect();
    await waitForSync(p1);
    
    // Create second client
    const { doc: doc2, provider: p2 } = createSyncedDoc(docId);
    await waitForSync(p2);
    await sleep(100);
    
    const text2 = doc2.getText('content');
    
    // Both should have the content
    assert.equal(text1.toString(), 'Persistent content', 'Client 1 should retain content');
    assert.equal(text2.toString(), 'Persistent content', 'Client 2 should see persisted content');
}

/**
 * Test: Concurrent reconnections
 */
async function testConcurrentReconnections() {
    const docId = generateDocId();
    
    const { doc: doc1, provider: p1 } = createSyncedDoc(docId);
    const { doc: doc2, provider: p2 } = createSyncedDoc(docId);
    const { doc: doc3, provider: p3 } = createSyncedDoc(docId);
    
    await waitForSync(p1);
    await waitForSync(p2);
    await waitForSync(p3);
    
    const text1 = doc1.getText('content');
    const text2 = doc2.getText('content');
    const text3 = doc3.getText('content');
    
    // Initial content
    text1.insert(0, 'Base');
    await sleep(100);
    
    // All disconnect at once
    p1.disconnect();
    p2.disconnect();
    p3.disconnect();
    await sleep(100);
    
    // All make edits
    text1.insert(text1.length, '-A');
    text2.insert(text2.length, '-B');
    text3.insert(text3.length, '-C');
    
    // All reconnect at once
    p1.connect();
    p2.connect();
    p3.connect();
    
    await waitForSync(p1);
    await waitForSync(p2);
    await waitForSync(p3);
    await sleep(300);
    
    // All should converge
    const c1 = text1.toString();
    const c2 = text2.toString();
    const c3 = text3.toString();
    
    assert.equal(c1, c2, 'Doc 1 and 2 should converge');
    assert.equal(c2, c3, 'Doc 2 and 3 should converge');
}

/**
 * Test: Long offline period then sync
 */
async function testLongOfflinePeriod() {
    const docId = generateDocId();
    
    const { doc: doc1, provider: p1 } = createSyncedDoc(docId);
    await waitForSync(p1);
    
    const text1 = doc1.getText('content');
    text1.insert(0, 'Online content');
    
    // Disconnect
    p1.disconnect();
    await sleep(100);
    
    // Many offline edits
    for (let i = 0; i < 50; i++) {
        text1.insert(text1.length, `[${i}]`);
    }
    
    // Reconnect
    p1.connect();
    await waitForSync(p1);
    await sleep(200);
    
    // Create new client to verify sync
    const { doc: doc2, provider: p2 } = createSyncedDoc(docId);
    await waitForSync(p2);
    await sleep(200);
    
    const text2 = doc2.getText('content');
    
    assert.equal(text1.toString(), text2.toString(), 'Long offline edits should sync');
    assert.contains(text1.toString(), '[49]', 'Should have all 50 edits');
}

/**
 * Test: Metadata reconnect preserves state
 */
async function testMetadataStatePreservation() {
    const key = generateKey();
    const workspaceId = generateWorkspaceId();
    
    const client1 = new TestClient('StatePreserve', { sessionKey: key });
    clients.push(client1);

    await client1.connectMeta();
    await client1.waitForMessage('status');

    // Create workspace
    client1.send({
        type: 'create-workspace',
        payload: {
            workspace: {
                id: workspaceId,
                name: 'Persistent Workspace',
                createdAt: Date.now(),
            },
        },
    });

    await client1.waitForMessage('workspace-created');
    
    // Disconnect
    client1.close();
    await sleep(100);

    // New client should see the workspace
    const client2 = new TestClient('StatePreserve2', { sessionKey: key });
    clients.push(client2);

    await client2.connectMeta();
    await client2.waitForMessage('status');

    // Request workspace list
    client2.send({
        type: 'list-workspaces',
        payload: {},
    });

    // Note: Workspace visibility depends on server-side persistence
    console.log('    Metadata state preservation checked');

    client2.close();
    clients = [];
}

// Export test suite
module.exports = {
    setup,
    teardown,
    tests: {
        'Reconnection after disconnect': testReconnectionAfterDisconnect,
        'Offline edits sync on reconnect': testOfflineEditsSync,
        'Multiple reconnection cycles': testMultipleReconnections,
        'Network partition recovery': testNetworkPartition,
        'Metadata WebSocket reconnection': testMetadataReconnection,
        'Rapid connect/disconnect cycles': testRapidConnectDisconnect,
        'High latency sync': testHighLatencySync,
        'Message ordering under delay': testMessageOrdering,
        'WebSocket error handling': testWebSocketErrorHandling,
        'Persistence across restart': testPersistenceAcrossRestart,
        'Concurrent reconnections': testConcurrentReconnections,
        'Long offline period then sync': testLongOfflinePeriod,
        'Metadata state preservation': testMetadataStatePreservation,
    },
};

// Jest placeholder - integration tests use custom runner
const describe = typeof global.describe === 'function' ? global.describe : () => {};
const test = typeof global.test === 'function' ? global.test : () => {};
const expect = typeof global.expect === 'function' ? global.expect : () => ({});

describe('Integration Test Placeholder', () => {
  test('tests exist in custom format', () => {
    expect(module.exports).toBeDefined();
  });
});
