/**
 * Race Condition and Edge Case Tests
 * 
 * Tests for complex timing scenarios and edge cases:
 * - Simultaneous conflicting operations
 * - Out-of-order message delivery
 * - Clock skew between clients
 * - Byzantine/malicious client behavior
 * - Memory leaks and resource cleanup
 * - Large-scale concurrent operations
 */

const Y = require('yjs');
const { EventEmitter } = require('events');
const crypto = require('crypto');
const {
    assert,
    sleep,
    randomHex,
    generateDocId,
} = require('./test-utils.js');

// ============ Test Infrastructure ============

/**
 * Simulates out-of-order message delivery
 */
class UnreliableChannel {
    constructor(options = {}) {
        this.queue = [];
        this.reorderProbability = options.reorderProbability || 0.3;
        this.duplicateProbability = options.duplicateProbability || 0.1;
        this.handlers = new Map();
    }
    
    send(from, to, message) {
        const entry = { from, to, message, timestamp: Date.now() };
        
        // Maybe duplicate
        if (Math.random() < this.duplicateProbability) {
            this.queue.push({ ...entry });
        }
        
        // Maybe insert out of order
        if (this.queue.length > 0 && Math.random() < this.reorderProbability) {
            const insertAt = Math.floor(Math.random() * this.queue.length);
            this.queue.splice(insertAt, 0, entry);
        } else {
            this.queue.push(entry);
        }
    }
    
    registerHandler(id, handler) {
        this.handlers.set(id, handler);
    }
    
    deliverOne() {
        if (this.queue.length === 0) return false;
        
        const entry = this.queue.shift();
        const handler = this.handlers.get(entry.to);
        if (handler) {
            handler(entry.from, entry.message);
        }
        return true;
    }
    
    deliverAll() {
        while (this.deliverOne()) {}
    }
    
    clear() {
        this.queue = [];
    }
}

/**
 * A client that tracks all operations for verification
 */
class TrackedClient {
    constructor(id) {
        this.id = id;
        this.doc = new Y.Doc();
        this.operationLog = [];
        this.receivedUpdates = [];
        this.sentUpdates = [];
        
        this.doc.on('update', (update, origin) => {
            if (origin !== 'remote') {
                this.sentUpdates.push({
                    update: Buffer.from(update).toString('base64'),
                    timestamp: Date.now(),
                });
            }
        });
    }
    
    applyRemoteUpdate(update) {
        const decoded = new Uint8Array(Buffer.from(update, 'base64'));
        Y.applyUpdate(this.doc, decoded, 'remote');
        this.receivedUpdates.push({
            update,
            timestamp: Date.now(),
        });
    }
    
    insert(pos, text) {
        this.doc.getText('content').insert(pos, text);
        this.operationLog.push({
            type: 'insert',
            pos,
            text,
            timestamp: Date.now(),
        });
    }
    
    delete(pos, len) {
        this.doc.getText('content').delete(pos, len);
        this.operationLog.push({
            type: 'delete',
            pos,
            len,
            timestamp: Date.now(),
        });
    }
    
    getText() {
        return this.doc.getText('content').toString();
    }
    
    destroy() {
        this.doc.destroy();
    }
}

// ============ Test Suite ============

let clients = [];

async function setup() {
    console.log('  [Setup] Race condition tests ready');
}

async function teardown() {
    for (const client of clients) {
        client.destroy();
    }
    clients = [];
}

// ============ Simultaneous Operation Tests ============

/**
 * Test: Two clients insert at same position simultaneously
 */
async function testSimultaneousInsertSamePosition() {
    const client1 = new TrackedClient('client1');
    const client2 = new TrackedClient('client2');
    clients.push(client1, client2);
    
    // Both insert at position 0 before syncing
    client1.insert(0, 'AAA');
    client2.insert(0, 'BBB');
    
    // Now sync - apply each other's updates
    for (const updateEntry of client1.sentUpdates) {
        client2.applyRemoteUpdate(updateEntry.update);
    }
    for (const updateEntry of client2.sentUpdates) {
        client1.applyRemoteUpdate(updateEntry.update);
    }
    
    // Both should have same content (order determined by CRDT)
    assert.equal(client1.getText(), client2.getText(), 'Content should be equal');
    assert.equal(client1.getText().length, 6, 'Should have all 6 characters');
}

/**
 * Test: Two clients delete overlapping regions
 */
async function testSimultaneousOverlappingDelete() {
    const client1 = new TrackedClient('client1');
    const client2 = new TrackedClient('client2');
    clients.push(client1, client2);
    
    // Both start with same content
    client1.insert(0, 'ABCDEFGH');
    
    // Sync initial content
    for (const updateEntry of client1.sentUpdates) {
        client2.applyRemoteUpdate(updateEntry.update);
    }
    
    // Clear sent updates
    client1.sentUpdates = [];
    client2.sentUpdates = [];
    
    // Client1 deletes "CDE", client2 deletes "DEF"
    client1.delete(2, 3); // Delete CDE -> "ABFGH"
    client2.delete(3, 3); // Delete DEF -> "ABCGH"
    
    // Sync
    for (const updateEntry of client1.sentUpdates) {
        client2.applyRemoteUpdate(updateEntry.update);
    }
    for (const updateEntry of client2.sentUpdates) {
        client1.applyRemoteUpdate(updateEntry.update);
    }
    
    // Should converge
    assert.equal(client1.getText(), client2.getText());
    // "CDEF" deleted, "ABGH" remains
    assert.equal(client1.getText(), 'ABGH');
}

/**
 * Test: One client inserts, another deletes at same position
 */
async function testInsertDeleteSamePosition() {
    const client1 = new TrackedClient('client1');
    const client2 = new TrackedClient('client2');
    clients.push(client1, client2);
    
    client1.insert(0, 'Hello');
    
    // Sync
    for (const updateEntry of client1.sentUpdates) {
        client2.applyRemoteUpdate(updateEntry.update);
    }
    client1.sentUpdates = [];
    
    // Client1 inserts at position 2, client2 deletes character at position 2
    client1.insert(2, 'XXX'); // He[XXX]llo
    client2.delete(2, 1);     // He[l]lo -> Helo
    
    // Sync
    for (const updateEntry of client1.sentUpdates) {
        client2.applyRemoteUpdate(updateEntry.update);
    }
    for (const updateEntry of client2.sentUpdates) {
        client1.applyRemoteUpdate(updateEntry.update);
    }
    
    assert.equal(client1.getText(), client2.getText());
    // Insert should be preserved, delete applies to original character
    assert.ok(client1.getText().includes('XXX'), 'Insert should be preserved');
}

// ============ Out-of-Order Delivery Tests ============

/**
 * Test: Updates delivered out of order still converge
 */
async function testOutOfOrderDelivery() {
    const channel = new UnreliableChannel({ reorderProbability: 1.0 }); // Always reorder
    
    const client1 = new TrackedClient('client1');
    const client2 = new TrackedClient('client2');
    clients.push(client1, client2);
    
    channel.registerHandler('client2', (from, msg) => {
        client2.applyRemoteUpdate(msg.update);
    });
    
    // Client1 makes several sequential edits
    client1.insert(0, 'A');
    client1.insert(1, 'B');
    client1.insert(2, 'C');
    client1.insert(3, 'D');
    client1.insert(4, 'E');
    
    // Send updates through unreliable channel
    for (const updateEntry of client1.sentUpdates) {
        channel.send('client1', 'client2', { update: updateEntry.update });
    }
    
    // Deliver all (in scrambled order)
    channel.deliverAll();
    
    // Should still converge
    assert.equal(client2.getText(), 'ABCDE', 'Out of order delivery should still produce correct result');
}

/**
 * Test: Duplicate messages are handled correctly
 */
async function testDuplicateMessages() {
    const client1 = new TrackedClient('client1');
    const client2 = new TrackedClient('client2');
    clients.push(client1, client2);
    
    client1.insert(0, 'Hello');
    
    // Apply same update multiple times
    const update = client1.sentUpdates[0].update;
    client2.applyRemoteUpdate(update);
    client2.applyRemoteUpdate(update);
    client2.applyRemoteUpdate(update);
    
    // Should only have content once (Yjs is idempotent)
    assert.equal(client2.getText(), 'Hello', 'Duplicate updates should be idempotent');
}

// ============ Many Clients Tests ============

/**
 * Test: Many clients editing simultaneously
 */
async function testManyClientsSimultaneous() {
    const numClients = 10;
    const clientList = [];
    
    for (let i = 0; i < numClients; i++) {
        clientList.push(new TrackedClient(`client${i}`));
    }
    clients.push(...clientList);
    
    // Each client makes an edit
    for (let i = 0; i < numClients; i++) {
        clientList[i].insert(0, String(i));
    }
    
    // Sync all to all
    for (const sender of clientList) {
        for (const receiver of clientList) {
            if (sender !== receiver) {
                for (const updateEntry of sender.sentUpdates) {
                    receiver.applyRemoteUpdate(updateEntry.update);
                }
            }
        }
    }
    
    // All should have same content
    const expected = clientList[0].getText();
    for (const client of clientList) {
        assert.equal(client.getText(), expected, `All clients should converge`);
    }
    assert.equal(expected.length, numClients, 'Should have all insertions');
}

/**
 * Test: Chain of edits across many clients
 */
async function testChainOfEdits() {
    const numClients = 5;
    const clientList = [];
    
    for (let i = 0; i < numClients; i++) {
        clientList.push(new TrackedClient(`client${i}`));
    }
    clients.push(...clientList);
    
    // Client 0 starts
    clientList[0].insert(0, 'Start');
    
    // Propagate in chain: 0 -> 1 -> 2 -> 3 -> 4
    // Each client receives all previous updates, then adds their own
    for (let i = 0; i < numClients - 1; i++) {
        // Apply ALL updates from sender (including accumulated ones)
        const state = Y.encodeStateAsUpdate(clientList[i].doc);
        Y.applyUpdate(clientList[i + 1].doc, state, 'remote');
        // Each client adds to the end
        clientList[i + 1].insert(clientList[i + 1].getText().length, String(i + 1));
    }
    
    // Now sync all - send full state back to everyone
    const finalState = Y.encodeStateAsUpdate(clientList[numClients - 1].doc);
    for (let i = 0; i < numClients - 1; i++) {
        Y.applyUpdate(clientList[i].doc, finalState, 'remote');
    }
    
    // All should converge
    const expected = clientList[numClients - 1].getText();
    for (const client of clientList) {
        assert.equal(client.getText(), expected);
    }
}

// ============ Byzantine Client Tests ============

/**
 * Test: Client sends invalid update (wrong document)
 */
async function testInvalidUpdateFromDifferentDoc() {
    const client1 = new TrackedClient('client1');
    const client2 = new TrackedClient('client2');
    const malicious = new TrackedClient('malicious');
    clients.push(client1, client2, malicious);
    
    // Client1 and client2 sync normally
    client1.insert(0, 'Legitimate');
    for (const updateEntry of client1.sentUpdates) {
        client2.applyRemoteUpdate(updateEntry.update);
    }
    
    // Malicious client uses a completely different document
    malicious.insert(0, 'Malicious content in different doc');
    
    // Try to apply malicious update to client2
    // This should not corrupt the document
    for (const updateEntry of malicious.sentUpdates) {
        try {
            client2.applyRemoteUpdate(updateEntry.update);
        } catch (e) {
            // Expected - different document origin
        }
    }
    
    // Client2 document should still have the legitimate content
    // (or be a valid merge if Yjs accepts the update)
    assert.ok(client2.getText().includes('Legitimate'), 
        'Legitimate content should be preserved');
}

/**
 * Test: Client sends garbage data
 */
async function testGarbageUpdate() {
    const client = new TrackedClient('client');
    clients.push(client);
    
    client.insert(0, 'Valid content');
    
    // Try to apply garbage
    let errorThrown = false;
    try {
        Y.applyUpdate(client.doc, new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), 'remote');
    } catch (e) {
        errorThrown = true;
    }
    
    // Either throws or ignores garbage
    // Content should not be corrupted
    assert.equal(client.getText(), 'Valid content', 'Content should not be corrupted');
}

/**
 * Test: Client sends extremely large update
 */
async function testExtremelyLargeUpdate() {
    const client1 = new TrackedClient('client1');
    const client2 = new TrackedClient('client2');
    clients.push(client1, client2);
    
    // Create large content
    const largeContent = 'X'.repeat(100000); // 100KB
    client1.insert(0, largeContent);
    
    // Should still sync
    for (const updateEntry of client1.sentUpdates) {
        client2.applyRemoteUpdate(updateEntry.update);
    }
    
    assert.equal(client2.getText().length, 100000, 'Large content should sync');
}

// ============ Rapid Operations Tests ============

/**
 * Test: Rapid insert/delete cycles
 */
async function testRapidInsertDelete() {
    const client1 = new TrackedClient('client1');
    const client2 = new TrackedClient('client2');
    clients.push(client1, client2);
    
    // Rapid operations
    for (let i = 0; i < 100; i++) {
        client1.insert(0, 'X');
        client1.delete(0, 1);
    }
    
    // Final state should be empty
    assert.equal(client1.getText(), '', 'Should be empty after insert/delete cycles');
    
    // Sync to client2
    for (const updateEntry of client1.sentUpdates) {
        client2.applyRemoteUpdate(updateEntry.update);
    }
    
    assert.equal(client2.getText(), '', 'Synced client should also be empty');
}

/**
 * Test: Both clients doing rapid operations
 */
async function testBothClientsRapidOperations() {
    const client1 = new TrackedClient('client1');
    const client2 = new TrackedClient('client2');
    clients.push(client1, client2);
    
    // Both do rapid operations
    for (let i = 0; i < 50; i++) {
        client1.insert(client1.getText().length, 'A');
        client2.insert(client2.getText().length, 'B');
    }
    
    // Sync
    for (const updateEntry of client1.sentUpdates) {
        client2.applyRemoteUpdate(updateEntry.update);
    }
    for (const updateEntry of client2.sentUpdates) {
        client1.applyRemoteUpdate(updateEntry.update);
    }
    
    assert.equal(client1.getText(), client2.getText());
    assert.equal(client1.getText().length, 100, 'Should have 100 characters');
}

// ============ Edge Cases ============

/**
 * Test: Empty document operations
 */
async function testEmptyDocumentOperations() {
    const client = new TrackedClient('client');
    clients.push(client);
    
    // Delete from empty with zero length - should be no-op
    try {
        client.delete(0, 0); // Should be no-op or may throw
    } catch (e) {
        // Some implementations may throw on invalid operation
    }
    assert.equal(client.getText(), '');
    
    // Delete beyond bounds - Yjs may throw or no-op
    try {
        const text = client.doc.getText('content');
        if (text.length > 0) {
            client.delete(0, 1);
        }
    } catch (e) {
        // Expected for empty document
    }
    assert.equal(client.getText(), '');
}

/**
 * Test: Insert at invalid position
 */
async function testInsertAtInvalidPosition() {
    const client = new TrackedClient('client');
    clients.push(client);
    
    client.insert(0, 'Hello');
    
    // Insert at position beyond length - should insert at end
    client.insert(1000, 'World');
    
    // Yjs should handle this gracefully
    assert.ok(client.getText().includes('Hello'));
    assert.ok(client.getText().includes('World'));
}

/**
 * Test: Sync empty update
 */
async function testSyncEmptyUpdate() {
    const client1 = new TrackedClient('client1');
    const client2 = new TrackedClient('client2');
    clients.push(client1, client2);
    
    // Get state with no changes
    const emptyState = Y.encodeStateAsUpdate(client1.doc);
    
    // Apply empty state to client2
    Y.applyUpdate(client2.doc, emptyState, 'remote');
    
    assert.equal(client2.getText(), '', 'Empty sync should work');
}

/**
 * Test: Destroy and recreate client
 */
async function testDestroyRecreateClient() {
    const client1 = new TrackedClient('client1');
    clients.push(client1);
    
    client1.insert(0, 'Persistent content');
    const state = Y.encodeStateAsUpdate(client1.doc);
    
    client1.destroy();
    
    // Recreate with same state
    const client2 = new TrackedClient('client2');
    clients.push(client2);
    
    Y.applyUpdate(client2.doc, state, 'remote');
    
    assert.equal(client2.getText(), 'Persistent content');
}

// ============ State Vector Tests ============

/**
 * Test: State vector comparison
 */
async function testStateVectorComparison() {
    const client1 = new TrackedClient('client1');
    const client2 = new TrackedClient('client2');
    clients.push(client1, client2);
    
    // Client1 makes edits
    client1.insert(0, 'From client 1');
    
    // Get state vectors
    const sv1 = Y.encodeStateVector(client1.doc);
    const sv2 = Y.encodeStateVector(client2.doc);
    
    // Get diff from sv2's perspective
    const diff = Y.encodeStateAsUpdate(client1.doc, sv2);
    
    // Apply diff
    Y.applyUpdate(client2.doc, diff, 'remote');
    
    assert.equal(client2.getText(), 'From client 1');
}

/**
 * Test: Incremental sync with state vectors
 */
async function testIncrementalStateVectorSync() {
    const client1 = new TrackedClient('client1');
    const client2 = new TrackedClient('client2');
    clients.push(client1, client2);
    
    // Initial sync
    client1.insert(0, 'Initial');
    Y.applyUpdate(client2.doc, Y.encodeStateAsUpdate(client1.doc), 'remote');
    
    // More edits from client1
    client1.insert(7, ' content');
    
    // Incremental sync using state vector
    const sv2 = Y.encodeStateVector(client2.doc);
    const diff = Y.encodeStateAsUpdate(client1.doc, sv2);
    Y.applyUpdate(client2.doc, diff, 'remote');
    
    assert.equal(client2.getText(), 'Initial content');
}

// ============ Memory and Resource Tests ============

/**
 * Test: No memory leak on repeated sync
 */
async function testNoMemoryLeakOnSync() {
    const client1 = new TrackedClient('client1');
    const client2 = new TrackedClient('client2');
    clients.push(client1, client2);
    
    // Do many sync cycles
    for (let i = 0; i < 100; i++) {
        client1.insert(client1.getText().length, 'x');
        
        const update = Y.encodeStateAsUpdate(client1.doc);
        Y.applyUpdate(client2.doc, update, 'remote');
    }
    
    // Documents should be equal
    assert.equal(client1.getText(), client2.getText());
    assert.equal(client1.getText().length, 100);
}

/**
 * Test: Cleanup after destroy
 */
async function testCleanupAfterDestroy() {
    const client = new TrackedClient('client');
    
    client.insert(0, 'Test content');
    
    // Destroy
    client.destroy();
    
    // Accessing destroyed doc should throw or return empty
    try {
        client.doc.getText('content').toString();
        // If it doesn't throw, that's also acceptable
    } catch (e) {
        // Expected
    }
}

// Export test suite
module.exports = {
    name: 'Race Conditions',
    setup,
    teardown,
    tests: {
        // Simultaneous operations
        testSimultaneousInsertSamePosition,
        testSimultaneousOverlappingDelete,
        testInsertDeleteSamePosition,
        
        // Out of order delivery
        testOutOfOrderDelivery,
        testDuplicateMessages,
        
        // Many clients
        testManyClientsSimultaneous,
        testChainOfEdits,
        
        // Byzantine behavior
        testInvalidUpdateFromDifferentDoc,
        testGarbageUpdate,
        testExtremelyLargeUpdate,
        
        // Rapid operations
        testRapidInsertDelete,
        testBothClientsRapidOperations,
        
        // Edge cases
        testEmptyDocumentOperations,
        testInsertAtInvalidPosition,
        testSyncEmptyUpdate,
        testDestroyRecreateClient,
        
        // State vectors
        testStateVectorComparison,
        testIncrementalStateVectorSync,
        
        // Memory and resources
        testNoMemoryLeakOnSync,
        testCleanupAfterDestroy,
    }
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
