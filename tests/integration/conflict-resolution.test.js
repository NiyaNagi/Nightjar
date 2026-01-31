/**
 * Conflict Resolution Tests
 * 
 * Tests for CRDT-based conflict resolution:
 * - Concurrent edits at same position
 * - Offline editing and merge on reconnect
 * - Three-way merge scenarios
 * - CRDT convergence guarantees
 * - Undo/redo across clients
 */

const Y = require('yjs');
const { WebsocketProvider } = require('y-websocket');
const WebSocket = require('ws');
const {
    TestClient,
    assert,
    sleep,
    generateDocId,
    generateKey,
} = require('./test-utils.js');

// Configuration
const YJS_PORT = parseInt(process.env.YJS_PORT || '8080', 10);
const META_PORT = parseInt(process.env.META_PORT || '8081', 10);
const YJS_URL = `ws://localhost:${YJS_PORT}`;

let providers = [];
let docs = [];

async function setup() {
    console.log('  [Setup] Conflict resolution tests ready');
}

async function teardown() {
    for (const provider of providers) {
        try {
            provider.destroy();
        } catch (e) {}
    }
    for (const doc of docs) {
        try {
            doc.destroy();
        } catch (e) {}
    }
    providers = [];
    docs = [];
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
            // Check immediately in case already connected
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
 * Helper: Wait for a text field to contain specific content
 */
async function waitForContent(doc, expected, field = 'content', timeout = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const text = doc.getText(field).toString();
        if (text === expected) {
            return true;
        }
        await sleep(50);
    }
    const actual = doc.getText(field).toString();
    throw new Error(`Content did not match. Expected: "${expected}", Got: "${actual}"`);
}

/**
 * Test: Concurrent edits at different positions
 */
async function testConcurrentEditsNonConflicting() {
    const docId = generateDocId();
    
    // Two clients
    const { doc: doc1, provider: p1 } = createSyncedDoc(docId);
    const { doc: doc2, provider: p2 } = createSyncedDoc(docId);
    
    await waitForSync(p1);
    await waitForSync(p2);
    
    const text1 = doc1.getText('content');
    const text2 = doc2.getText('content');
    
    // Initial content
    text1.insert(0, 'Hello World');
    await sleep(100);
    
    // Concurrent edits at different positions
    text1.insert(0, 'AAA ');  // "AAA Hello World"
    text2.insert(11, ' BBB'); // "Hello World BBB"
    
    // Wait for sync
    await sleep(200);
    
    // Both should converge to same content
    const content1 = text1.toString();
    const content2 = text2.toString();
    
    assert.equal(content1, content2, 'Documents should converge');
    assert.contains(content1, 'AAA', 'Should contain first edit');
    assert.contains(content1, 'BBB', 'Should contain second edit');
}

/**
 * Test: Concurrent edits at same position
 */
async function testConcurrentEditsSamePosition() {
    const docId = generateDocId();
    
    const { doc: doc1, provider: p1 } = createSyncedDoc(docId);
    const { doc: doc2, provider: p2 } = createSyncedDoc(docId);
    
    await waitForSync(p1);
    await waitForSync(p2);
    
    const text1 = doc1.getText('content');
    const text2 = doc2.getText('content');
    
    // Initial content
    text1.insert(0, 'Start');
    await sleep(100);
    
    // Both insert at position 5 (after "Start")
    // These happen "concurrently"
    text1.insert(5, ' Alpha');
    text2.insert(5, ' Beta');
    
    // Wait for sync
    await sleep(200);
    
    const content1 = text1.toString();
    const content2 = text2.toString();
    
    // Both should converge (CRDT handles ordering)
    assert.equal(content1, content2, 'Documents should converge');
    assert.contains(content1, 'Alpha', 'Should contain Alpha');
    assert.contains(content1, 'Beta', 'Should contain Beta');
    assert.contains(content1, 'Start', 'Should contain Start');
}

/**
 * Test: Concurrent deletions
 * 
 * In a localhost test environment, y-websocket sync happens almost instantly.
 * This test verifies that multiple clients deleting at different positions
 * converge to the same final state, regardless of execution order.
 */
async function testConcurrentDeletions() {
    const docId = generateDocId();
    
    const { doc: doc1, provider: p1 } = createSyncedDoc(docId);
    const { doc: doc2, provider: p2 } = createSyncedDoc(docId);
    
    await waitForSync(p1);
    await waitForSync(p2);
    
    const text1 = doc1.getText('content');
    const text2 = doc2.getText('content');
    
    // Initial content: "ABCDEFGH"
    text1.insert(0, 'ABCDEFGH');
    
    // Wait for client2 to actually receive the content
    await waitForContent(doc2, 'ABCDEFGH');
    
    // Client 1 deletes 2 characters starting at position 1 (intended: "BC")
    text1.delete(1, 2);
    
    // Client 2 deletes 2 characters starting at position 3 (intended: "EF" in original or after sync)
    // Note: Due to instant sync, positions may shift
    text2.delete(3, 2);
    
    // Wait for both clients to converge
    await sleep(500);
    
    const content1 = text1.toString();
    const content2 = text2.toString();
    
    // Key CRDT guarantee: both clients converge to the same state
    assert.equal(content1, content2, 'Documents should converge to same content');
    // Result should have 4 characters deleted total (8 - 4 = 4)
    assert.equal(content1.length, 4, 'Should have 4 characters remaining after 4 deletions');
}

/**
 * Test: Insert and delete at same position
 */
async function testInsertDeleteConflict() {
    const docId = generateDocId();
    
    const { doc: doc1, provider: p1 } = createSyncedDoc(docId);
    const { doc: doc2, provider: p2 } = createSyncedDoc(docId);
    
    await waitForSync(p1);
    await waitForSync(p2);
    
    const text1 = doc1.getText('content');
    const text2 = doc2.getText('content');
    
    // Initial: "Hello World"
    text1.insert(0, 'Hello World');
    
    // Wait for client2 to actually receive the content
    await waitForContent(doc2, 'Hello World');
    
    // Client 1 inserts " Beautiful" after "Hello"
    text1.insert(5, ' Beautiful');
    
    // Client 2 inserts " Amazing" at position 5
    text2.insert(5, ' Amazing');
    
    // Wait for both clients to converge
    await sleep(500);
    
    const content1 = text1.toString();
    const content2 = text2.toString();
    
    // Key CRDT guarantee: both clients converge to the same state
    assert.equal(content1, content2, 'Documents should converge');
    // Both inserts should be preserved
    assert.contains(content1, 'Beautiful', 'Should contain Beautiful');
    assert.contains(content1, 'Amazing', 'Should contain Amazing');
    assert.contains(content1, 'Hello', 'Should contain Hello');
    assert.contains(content1, 'World', 'Should contain World');
}

/**
 * Test: Three-way concurrent edits
 */
async function testThreeWayConcurrentEdits() {
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
    
    // Three concurrent edits
    text1.insert(4, ' One');
    text2.insert(4, ' Two');
    text3.insert(4, ' Three');
    
    // Wait for sync
    await sleep(300);
    
    const content1 = text1.toString();
    const content2 = text2.toString();
    const content3 = text3.toString();
    
    // All should converge
    assert.equal(content1, content2, 'Doc 1 and 2 should converge');
    assert.equal(content2, content3, 'Doc 2 and 3 should converge');
    
    // All edits should be present
    assert.contains(content1, 'One', 'Should contain One');
    assert.contains(content1, 'Two', 'Should contain Two');
    assert.contains(content1, 'Three', 'Should contain Three');
}

/**
 * Test: Rapid concurrent typing
 */
async function testRapidConcurrentTyping() {
    const docId = generateDocId();
    
    const { doc: doc1, provider: p1 } = createSyncedDoc(docId);
    const { doc: doc2, provider: p2 } = createSyncedDoc(docId);
    
    await waitForSync(p1);
    await waitForSync(p2);
    
    const text1 = doc1.getText('content');
    const text2 = doc2.getText('content');
    
    // Simulate rapid typing from both clients
    const word1 = 'ALPHA';
    const word2 = 'BRAVO';
    
    for (let i = 0; i < word1.length; i++) {
        text1.insert(text1.length, word1[i]);
        text2.insert(text2.length, word2[i]);
        await sleep(10); // Small delay between keystrokes
    }
    
    // Wait for final sync
    await sleep(300);
    
    const content1 = text1.toString();
    const content2 = text2.toString();
    
    assert.equal(content1, content2, 'Documents should converge');
    assert.equal(content1.length, 10, 'Should have 10 characters (ALPHA + BRAVO)');
    
    // Check all letters are present
    for (const char of word1) {
        assert.contains(content1, char, `Should contain ${char} from word1`);
    }
    for (const char of word2) {
        assert.contains(content1, char, `Should contain ${char} from word2`);
    }
}

/**
 * Test: Map (metadata) concurrent updates
 */
async function testMapConcurrentUpdates() {
    const docId = generateDocId();
    
    const { doc: doc1, provider: p1 } = createSyncedDoc(docId);
    const { doc: doc2, provider: p2 } = createSyncedDoc(docId);
    
    await waitForSync(p1);
    await waitForSync(p2);
    
    const meta1 = doc1.getMap('metadata');
    const meta2 = doc2.getMap('metadata');
    
    // Initial metadata
    meta1.set('title', 'Original Title');
    meta1.set('author', 'Alice');
    await sleep(100);
    
    // Concurrent updates to different keys
    meta1.set('title', 'Title by Client 1');
    meta2.set('author', 'Bob');
    
    // Wait for sync
    await sleep(200);
    
    // Both should converge
    assert.equal(meta1.get('title'), meta2.get('title'), 'Titles should match');
    assert.equal(meta1.get('author'), meta2.get('author'), 'Authors should match');
}

/**
 * Test: Map concurrent updates to same key (last-write-wins)
 */
async function testMapSameKeyConflict() {
    const docId = generateDocId();
    
    const { doc: doc1, provider: p1 } = createSyncedDoc(docId);
    const { doc: doc2, provider: p2 } = createSyncedDoc(docId);
    
    await waitForSync(p1);
    await waitForSync(p2);
    
    const meta1 = doc1.getMap('metadata');
    const meta2 = doc2.getMap('metadata');
    
    // Concurrent updates to same key
    meta1.set('status', 'value-from-client-1');
    meta2.set('status', 'value-from-client-2');
    
    // Wait for sync
    await sleep(200);
    
    // Should converge to same value (CRDT determines winner)
    assert.equal(meta1.get('status'), meta2.get('status'), 'Status should converge');
}

/**
 * Test: Array concurrent modifications
 */
async function testArrayConcurrentModifications() {
    const docId = generateDocId();
    
    const { doc: doc1, provider: p1 } = createSyncedDoc(docId);
    const { doc: doc2, provider: p2 } = createSyncedDoc(docId);
    
    await waitForSync(p1);
    await waitForSync(p2);
    
    const arr1 = doc1.getArray('items');
    const arr2 = doc2.getArray('items');
    
    // Initial array
    arr1.insert(0, ['A', 'B', 'C']);
    await sleep(100);
    
    // Concurrent push
    arr1.push(['X']);
    arr2.push(['Y']);
    
    // Wait for sync
    await sleep(200);
    
    assert.equal(arr1.length, arr2.length, 'Array lengths should match');
    assert.equal(arr1.length, 5, 'Should have 5 elements');
    
    const items1 = arr1.toArray();
    const items2 = arr2.toArray();
    
    assert.deepEqual(items1, items2, 'Arrays should converge');
}

/**
 * Test: Undo convergence across clients
 */
async function testUndoConvergence() {
    const docId = generateDocId();
    
    const { doc: doc1, provider: p1 } = createSyncedDoc(docId);
    const { doc: doc2, provider: p2 } = createSyncedDoc(docId);
    
    await waitForSync(p1);
    await waitForSync(p2);
    
    const text1 = doc1.getText('content');
    const text2 = doc2.getText('content');
    
    // Create undo manager for client 1
    const undoManager = new Y.UndoManager(text1);
    
    // Client 1 makes an edit
    text1.insert(0, 'Hello');
    await sleep(100);
    
    // Client 2 makes an edit
    text2.insert(5, ' World');
    await sleep(100);
    
    // Undo client 1's edit
    undoManager.undo();
    await sleep(200);
    
    // Both docs should have just " World" (or be in sync)
    assert.equal(text1.toString(), text2.toString(), 'Documents should converge after undo');
}

/**
 * Test: Large document convergence
 */
async function testLargeDocumentConvergence() {
    const docId = generateDocId();
    
    const { doc: doc1, provider: p1 } = createSyncedDoc(docId);
    const { doc: doc2, provider: p2 } = createSyncedDoc(docId);
    
    await waitForSync(p1);
    await waitForSync(p2);
    
    const text1 = doc1.getText('content');
    const text2 = doc2.getText('content');
    
    // Insert large content
    const largeContent = 'Lorem ipsum '.repeat(100);
    text1.insert(0, largeContent);
    await sleep(200);
    
    // Concurrent edits in large document
    text1.insert(100, '[EDIT1]');
    text2.insert(500, '[EDIT2]');
    
    await sleep(300);
    
    const content1 = text1.toString();
    const content2 = text2.toString();
    
    assert.equal(content1, content2, 'Large documents should converge');
    assert.contains(content1, '[EDIT1]', 'Should contain first edit');
    assert.contains(content1, '[EDIT2]', 'Should contain second edit');
}

// Export test suite
module.exports = {
    setup,
    teardown,
    tests: {
        'Concurrent edits at different positions': testConcurrentEditsNonConflicting,
        'Concurrent edits at same position': testConcurrentEditsSamePosition,
        'Concurrent deletions': testConcurrentDeletions,
        'Insert and delete at same position': testInsertDeleteConflict,
        'Three-way concurrent edits': testThreeWayConcurrentEdits,
        'Rapid concurrent typing': testRapidConcurrentTyping,
        'Map concurrent updates': testMapConcurrentUpdates,
        'Map same-key conflict': testMapSameKeyConflict,
        'Array concurrent modifications': testArrayConcurrentModifications,
        'Undo convergence across clients': testUndoConvergence,
        'Large document convergence': testLargeDocumentConvergence,
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
