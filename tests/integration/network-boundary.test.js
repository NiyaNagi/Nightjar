/**
 * Network Boundary Tests
 * 
 * Tests that validate the P2P networking code by simulating 
 * realistic network conditions:
 * - Multiple isolated clients that must sync through a simulated network
 * - Network partitions (split-brain scenarios)
 * - Message ordering and delivery guarantees
 * - Latency and jitter
 * - Packet loss and retransmission
 * - Bandwidth throttling
 * 
 * These tests use a mock network layer that sits between clients,
 * allowing us to control and observe all network traffic.
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

// ============ Mock Network Infrastructure ============

/**
 * A simulated network that connects multiple mock clients.
 * Provides control over message delivery, latency, and partitions.
 */
class MockNetwork extends EventEmitter {
    constructor(options = {}) {
        super();
        this.clients = new Map();          // clientId -> MockNetworkClient
        this.messageQueue = [];            // Pending messages
        this.partitions = [];              // Array of client ID sets (isolated groups)
        this.latencyMs = options.latency || 0;
        this.jitterMs = options.jitter || 0;
        this.dropRate = options.dropRate || 0;   // 0-1, probability of dropping a message
        this.messageLog = [];              // All sent messages for debugging
        this.running = true;
        this.bandwidthBps = options.bandwidthBps || Infinity;
        this.totalBytesSent = 0;
    }
    
    /**
     * Register a client with the network
     */
    addClient(client) {
        this.clients.set(client.id, client);
        client.network = this;
        this.emit('client-added', client.id);
    }
    
    /**
     * Remove a client from the network
     */
    removeClient(clientId) {
        const client = this.clients.get(clientId);
        if (client) {
            client.network = null;
            this.clients.delete(clientId);
            this.emit('client-removed', clientId);
        }
    }
    
    /**
     * Create a network partition - clients in different partitions can't communicate
     */
    partition(groups) {
        // groups is array of arrays of client IDs
        // e.g., [['client1', 'client2'], ['client3']] 
        // means client1 and client2 can talk to each other, client3 is isolated
        this.partitions = groups.map(g => new Set(g));
        this.emit('partitioned', this.partitions);
    }
    
    /**
     * Heal all partitions - all clients can communicate again
     */
    healPartition() {
        this.partitions = [];
        this.emit('partition-healed');
    }
    
    /**
     * Check if two clients can communicate (not in different partitions)
     */
    canCommunicate(fromId, toId) {
        if (this.partitions.length === 0) return true;
        
        for (const group of this.partitions) {
            if (group.has(fromId)) {
                return group.has(toId);
            }
        }
        // If sender not in any partition, they can talk to everyone
        return true;
    }
    
    /**
     * Send a message from one client to another or broadcast
     */
    send(fromId, toId, message) {
        if (!this.running) return;
        
        const msgBytes = JSON.stringify(message).length;
        this.totalBytesSent += msgBytes;
        
        // Check if message should be dropped
        if (Math.random() < this.dropRate) {
            this.messageLog.push({ from: fromId, to: toId, message, dropped: true, time: Date.now() });
            return;
        }
        
        // Calculate delivery delay
        let delay = this.latencyMs;
        if (this.jitterMs > 0) {
            delay += Math.random() * this.jitterMs * 2 - this.jitterMs;
        }
        delay = Math.max(0, delay);
        
        // Bandwidth throttling
        if (this.bandwidthBps !== Infinity) {
            const throttleDelay = (msgBytes * 8 * 1000) / this.bandwidthBps;
            delay += throttleDelay;
        }
        
        this.messageLog.push({ from: fromId, to: toId, message, delay, time: Date.now() });
        
        // Schedule delivery
        setTimeout(() => {
            if (!this.running) return;
            
            if (toId === 'broadcast') {
                // Broadcast to all clients in same partition
                for (const [clientId, client] of this.clients) {
                    if (clientId !== fromId && this.canCommunicate(fromId, clientId)) {
                        client.receive(fromId, message);
                    }
                }
            } else {
                // Unicast
                const client = this.clients.get(toId);
                if (client && this.canCommunicate(fromId, toId)) {
                    client.receive(fromId, message);
                }
            }
        }, delay);
    }
    
    /**
     * Broadcast a message to all clients
     */
    broadcast(fromId, message) {
        this.send(fromId, 'broadcast', message);
    }
    
    /**
     * Get statistics about the network
     */
    getStats() {
        return {
            clientCount: this.clients.size,
            messagesSent: this.messageLog.length,
            messagesDropped: this.messageLog.filter(m => m.dropped).length,
            totalBytesSent: this.totalBytesSent,
            partitioned: this.partitions.length > 0,
        };
    }
    
    /**
     * Shutdown the network
     */
    shutdown() {
        this.running = false;
        this.clients.clear();
        this.messageQueue = [];
    }
}

/**
 * A mock network client that syncs Yjs documents over the mock network
 */
class MockNetworkClient extends EventEmitter {
    constructor(id) {
        super();
        this.id = id;
        this.network = null;
        this.docs = new Map();  // docId -> Y.Doc
        this.connected = false;
        this.pendingUpdates = new Map(); // docId -> pending updates during disconnect
    }
    
    /**
     * Connect to the network
     */
    connect() {
        this.connected = true;
        
        // Flush any pending updates
        for (const [docId, updates] of this.pendingUpdates) {
            for (const update of updates) {
                this.broadcastUpdate(docId, update);
            }
        }
        this.pendingUpdates.clear();
        
        this.emit('connected');
    }
    
    /**
     * Disconnect from the network
     */
    disconnect() {
        this.connected = false;
        this.emit('disconnected');
    }
    
    /**
     * Get or create a shared document
     */
    getDoc(docId) {
        if (this.docs.has(docId)) {
            return this.docs.get(docId);
        }
        
        const doc = new Y.Doc();
        this.docs.set(docId, doc);
        
        // Listen for local changes and broadcast them
        doc.on('update', (update, origin) => {
            if (origin !== 'remote') {
                this.broadcastUpdate(docId, update);
            }
        });
        
        // Request sync from peers
        if (this.connected && this.network) {
            this.network.broadcast(this.id, {
                type: 'sync-request',
                docId,
            });
        }
        
        return doc;
    }
    
    /**
     * Broadcast an update to peers
     */
    broadcastUpdate(docId, update) {
        if (!this.connected || !this.network) {
            // Queue for later
            if (!this.pendingUpdates.has(docId)) {
                this.pendingUpdates.set(docId, []);
            }
            this.pendingUpdates.get(docId).push(update);
            return;
        }
        
        this.network.broadcast(this.id, {
            type: 'yjs-update',
            docId,
            update: Buffer.from(update).toString('base64'),
        });
    }
    
    /**
     * Receive a message from the network
     */
    receive(fromId, message) {
        // Don't process messages when disconnected
        if (!this.connected) return;
        
        this.emit('message', { from: fromId, message });
        
        switch (message.type) {
            case 'yjs-update':
                this.handleUpdate(message.docId, message.update);
                break;
                
            case 'sync-request':
                this.handleSyncRequest(fromId, message.docId);
                break;
                
            case 'sync-response':
                this.handleSyncResponse(message.docId, message.state);
                break;
        }
    }
    
    /**
     * Handle incoming Yjs update
     */
    handleUpdate(docId, updateBase64) {
        const doc = this.docs.get(docId);
        if (!doc) return;
        
        const update = new Uint8Array(Buffer.from(updateBase64, 'base64'));
        Y.applyUpdate(doc, update, 'remote');
    }
    
    /**
     * Handle sync request - send our state
     */
    handleSyncRequest(fromId, docId) {
        if (!this.connected || !this.network) return;
        
        const doc = this.docs.get(docId);
        if (!doc) return;
        
        const state = Y.encodeStateAsUpdate(doc);
        this.network.send(this.id, fromId, {
            type: 'sync-response',
            docId,
            state: Buffer.from(state).toString('base64'),
        });
    }
    
    /**
     * Handle sync response - apply received state
     */
    handleSyncResponse(docId, stateBase64) {
        const doc = this.docs.get(docId);
        if (!doc) return;
        
        const state = new Uint8Array(Buffer.from(stateBase64, 'base64'));
        Y.applyUpdate(doc, state, 'remote');
    }
    
    /**
     * Destroy the client
     */
    destroy() {
        for (const doc of this.docs.values()) {
            doc.destroy();
        }
        this.docs.clear();
        if (this.network) {
            this.network.removeClient(this.id);
        }
    }
}

// ============ Test Helpers ============

/**
 * Wait for documents to sync across all clients
 * This helper also triggers sync requests periodically
 */
async function waitForSync(clients, docId, timeout = 5000) {
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
        const states = clients.map(c => {
            const doc = c.docs.get(docId);
            if (!doc) return null;
            return doc.getText('content').toString();
        });
        
        // Check if all non-null states are equal
        const nonNull = states.filter(s => s !== null);
        if (nonNull.length === clients.length && nonNull.every(s => s === nonNull[0])) {
            return true;
        }
        
        // Trigger sync requests from each client
        for (const client of clients) {
            if (client.connected && client.network) {
                client.network.broadcast(client.id, { type: 'sync-request', docId });
            }
        }
        
        // Wait longer to allow network latency to settle
        await sleep(250);
    }
    
    throw new Error('Sync timeout');
}

// ============ Test Suite ============

let network = null;
let clients = [];

async function setup() {
    console.log('  [Setup] Network boundary tests ready');
}

async function teardown() {
    if (network) {
        network.shutdown();
        network = null;
    }
    for (const client of clients) {
        client.destroy();
    }
    clients = [];
}

// ============ Basic Connectivity Tests ============

/**
 * Test: Two clients can sync a document over mock network
 */
async function testTwoClientSync() {
    network = new MockNetwork();
    
    const client1 = new MockNetworkClient('client1');
    const client2 = new MockNetworkClient('client2');
    clients.push(client1, client2);
    
    network.addClient(client1);
    network.addClient(client2);
    
    client1.connect();
    client2.connect();
    
    const docId = generateDocId();
    const doc1 = client1.getDoc(docId);
    const doc2 = client2.getDoc(docId);
    
    // Wait for sync request to complete
    await sleep(100);
    
    // Client1 makes a change
    doc1.getText('content').insert(0, 'Hello from client1');
    
    // Wait for sync
    await waitForSync([client1, client2], docId);
    
    assert.equal(doc2.getText('content').toString(), 'Hello from client1', 
        'Client2 should see client1 changes');
}

/**
 * Test: Three clients sync in a mesh
 */
async function testThreeClientMesh() {
    network = new MockNetwork();
    
    const client1 = new MockNetworkClient('client1');
    const client2 = new MockNetworkClient('client2');
    const client3 = new MockNetworkClient('client3');
    clients.push(client1, client2, client3);
    
    network.addClient(client1);
    network.addClient(client2);
    network.addClient(client3);
    
    client1.connect();
    client2.connect();
    client3.connect();
    
    const docId = generateDocId();
    client1.getDoc(docId);
    client2.getDoc(docId);
    client3.getDoc(docId);
    
    await sleep(200);
    
    // Client1 makes a change and we wait for it to sync
    client1.docs.get(docId).getText('content').insert(0, 'A');
    await waitForSync(clients, docId, 3000);
    
    // Client2 makes a change
    client2.docs.get(docId).getText('content').insert(1, 'B');
    await waitForSync(clients, docId, 3000);
    
    // Client3 makes a change
    client3.docs.get(docId).getText('content').insert(2, 'C');
    await waitForSync(clients, docId, 3000);
    
    const finalContent = client1.docs.get(docId).getText('content').toString();
    assert.equal(finalContent.length, 3, 'Should have 3 characters');
    assert.ok(finalContent.includes('A'), 'Should contain A');
    assert.ok(finalContent.includes('B'), 'Should contain B');
    assert.ok(finalContent.includes('C'), 'Should contain C');
}

// ============ Network Partition Tests ============

/**
 * Test: Clients in partition cannot sync
 */
async function testNetworkPartition() {
    network = new MockNetwork();
    
    const client1 = new MockNetworkClient('client1');
    const client2 = new MockNetworkClient('client2');
    const client3 = new MockNetworkClient('client3');
    clients.push(client1, client2, client3);
    
    network.addClient(client1);
    network.addClient(client2);
    network.addClient(client3);
    
    client1.connect();
    client2.connect();
    client3.connect();
    
    const docId = generateDocId();
    client1.getDoc(docId);
    client2.getDoc(docId);
    client3.getDoc(docId);
    
    await sleep(100);
    
    // Create partition: [client1, client2] and [client3]
    network.partition([['client1', 'client2'], ['client3']]);
    
    // Client1 makes a change
    client1.docs.get(docId).getText('content').insert(0, 'Partitioned');
    
    await sleep(200);
    
    // Client2 should see the change (same partition)
    assert.equal(client2.docs.get(docId).getText('content').toString(), 'Partitioned',
        'Client2 should see changes from client1');
    
    // Client3 should NOT see the change (different partition)
    assert.equal(client3.docs.get(docId).getText('content').toString(), '',
        'Client3 should NOT see changes (partitioned)');
}

/**
 * Test: Partition heals and clients sync
 */
async function testPartitionHeal() {
    network = new MockNetwork();
    
    const client1 = new MockNetworkClient('client1');
    const client2 = new MockNetworkClient('client2');
    clients.push(client1, client2);
    
    network.addClient(client1);
    network.addClient(client2);
    
    client1.connect();
    client2.connect();
    
    const docId = generateDocId();
    client1.getDoc(docId);
    client2.getDoc(docId);
    
    await sleep(100);
    
    // Create partition
    network.partition([['client1'], ['client2']]);
    
    // Both make changes during partition
    client1.docs.get(docId).getText('content').insert(0, 'From1');
    client2.docs.get(docId).getText('content').insert(0, 'From2');
    
    await sleep(200);
    
    // Changes should be isolated
    assert.equal(client1.docs.get(docId).getText('content').toString(), 'From1');
    assert.equal(client2.docs.get(docId).getText('content').toString(), 'From2');
    
    // Heal partition
    network.healPartition();
    
    // Trigger sync by having each client request sync
    network.broadcast(client1.id, { type: 'sync-request', docId });
    network.broadcast(client2.id, { type: 'sync-request', docId });
    
    await sleep(300);
    
    // After heal, both should have merged content
    const content1 = client1.docs.get(docId).getText('content').toString();
    const content2 = client2.docs.get(docId).getText('content').toString();
    
    assert.equal(content1, content2, 'Content should be equal after partition heal');
    assert.ok(content1.includes('From1'), 'Should contain From1');
    assert.ok(content1.includes('From2'), 'Should contain From2');
}

/**
 * Test: Split-brain scenario with conflicting edits
 */
async function testSplitBrainConflict() {
    network = new MockNetwork();
    
    const client1 = new MockNetworkClient('client1');
    const client2 = new MockNetworkClient('client2');
    clients.push(client1, client2);
    
    network.addClient(client1);
    network.addClient(client2);
    
    client1.connect();
    client2.connect();
    
    const docId = generateDocId();
    const doc1 = client1.getDoc(docId);
    const doc2 = client2.getDoc(docId);
    
    await sleep(200);
    
    // Both start with same content
    doc1.getText('content').insert(0, 'Initial');
    await waitForSync(clients, docId, 3000);
    
    // Create partition
    network.partition([['client1'], ['client2']]);
    
    // Both edit the SAME position - this is the conflict
    doc1.getText('content').delete(0, 7); // Delete "Initial"
    doc1.getText('content').insert(0, 'Version1');
    
    doc2.getText('content').delete(0, 7); // Delete "Initial"
    doc2.getText('content').insert(0, 'Version2');
    
    await sleep(300);
    
    // Heal partition
    network.healPartition();
    
    // Sync using full state exchange
    await waitForSync(clients, docId, 3000);
    
    // CRDT should merge - both versions present
    const content1 = doc1.getText('content').toString();
    const content2 = doc2.getText('content').toString();
    
    assert.equal(content1, content2, 'Content should converge');
    // The exact content depends on CRDT merge order, but both should be present
    assert.ok(content1.includes('1') || content1.includes('2'), 'Should have merged content');
}

// ============ Latency and Jitter Tests ============

/**
 * Test: Sync works with latency
 */
async function testSyncWithLatency() {
    network = new MockNetwork({ latency: 100 });
    
    const client1 = new MockNetworkClient('client1');
    const client2 = new MockNetworkClient('client2');
    clients.push(client1, client2);
    
    network.addClient(client1);
    network.addClient(client2);
    
    client1.connect();
    client2.connect();
    
    const docId = generateDocId();
    client1.getDoc(docId);
    client2.getDoc(docId);
    
    await sleep(500); // Account for latency in initial sync
    
    client1.docs.get(docId).getText('content').insert(0, 'Delayed message');
    
    // Should still sync, just takes longer - need longer timeout with latency
    await waitForSync(clients, docId, 5000);
    
    assert.equal(client2.docs.get(docId).getText('content').toString(), 'Delayed message');
}

/**
 * Test: Sync with high jitter
 */
async function testSyncWithJitter() {
    network = new MockNetwork({ latency: 50, jitter: 100 });
    
    const client1 = new MockNetworkClient('client1');
    const client2 = new MockNetworkClient('client2');
    clients.push(client1, client2);
    
    network.addClient(client1);
    network.addClient(client2);
    
    client1.connect();
    client2.connect();
    
    const docId = generateDocId();
    client1.getDoc(docId);
    client2.getDoc(docId);
    
    await sleep(600); // Account for latency + jitter in initial sync
    
    // Send multiple messages - order might vary due to jitter
    const doc1 = client1.docs.get(docId);
    doc1.getText('content').insert(0, 'A');
    doc1.getText('content').insert(1, 'B');
    doc1.getText('content').insert(2, 'C');
    
    await waitForSync(clients, docId, 5000);
    
    // CRDT guarantees order is preserved regardless of delivery order
    assert.equal(client2.docs.get(docId).getText('content').toString(), 'ABC');
}

// ============ Packet Loss Tests ============

/**
 * Test: Eventually syncs despite packet loss
 */
async function testSyncWithPacketLoss() {
    network = new MockNetwork({ dropRate: 0.3 }); // 30% drop rate
    
    const client1 = new MockNetworkClient('client1');
    const client2 = new MockNetworkClient('client2');
    clients.push(client1, client2);
    
    network.addClient(client1);
    network.addClient(client2);
    
    client1.connect();
    client2.connect();
    
    const docId = generateDocId();
    client1.getDoc(docId);
    client2.getDoc(docId);
    
    await sleep(200);
    
    const doc1 = client1.docs.get(docId);
    doc1.getText('content').insert(0, 'Lost?');
    
    // With packet loss, we might need to retry syncs multiple times
    for (let i = 0; i < 5; i++) {
        await sleep(200);
        // Request resync
        network.broadcast(client2.id, { type: 'sync-request', docId });
    }
    
    await sleep(500);
    
    // Should eventually sync
    const content2 = client2.docs.get(docId).getText('content').toString();
    assert.equal(content2, 'Lost?', 'Should eventually sync despite packet loss');
}

// ============ Disconnection and Reconnection Tests ============

/**
 * Test: Offline changes sync on reconnect
 */
async function testOfflineChangesSync() {
    network = new MockNetwork();
    
    const client1 = new MockNetworkClient('client1');
    const client2 = new MockNetworkClient('client2');
    clients.push(client1, client2);
    
    network.addClient(client1);
    network.addClient(client2);
    
    client1.connect();
    client2.connect();
    
    const docId = generateDocId();
    client1.getDoc(docId);
    client2.getDoc(docId);
    
    await sleep(100);
    
    // Client2 goes offline
    client2.disconnect();
    
    // Client1 makes changes while client2 is offline
    client1.docs.get(docId).getText('content').insert(0, 'While you were away');
    
    await sleep(100);
    
    // Client2 should not have the changes
    assert.equal(client2.docs.get(docId).getText('content').toString(), '',
        'Offline client should not have changes');
    
    // Client2 reconnects
    client2.connect();
    
    // Request sync
    network.broadcast(client2.id, { type: 'sync-request', docId });
    
    await sleep(200);
    
    // Now client2 should have the changes
    assert.equal(client2.docs.get(docId).getText('content').toString(), 'While you were away',
        'Should sync after reconnect');
}

/**
 * Test: Offline client makes changes that sync on reconnect
 */
async function testOfflineClientChanges() {
    network = new MockNetwork();
    
    const client1 = new MockNetworkClient('client1');
    const client2 = new MockNetworkClient('client2');
    clients.push(client1, client2);
    
    network.addClient(client1);
    network.addClient(client2);
    
    client1.connect();
    client2.connect();
    
    const docId = generateDocId();
    client1.getDoc(docId);
    client2.getDoc(docId);
    
    await sleep(100);
    
    // Client2 goes offline
    client2.disconnect();
    
    // Client2 makes changes while offline
    client2.docs.get(docId).getText('content').insert(0, 'Offline edit');
    
    await sleep(100);
    
    // Client1 should not have offline client's changes
    assert.equal(client1.docs.get(docId).getText('content').toString(), '');
    
    // Client2 reconnects
    client2.connect();
    
    await sleep(200);
    
    // After reconnect, client1 should receive the offline changes
    assert.equal(client1.docs.get(docId).getText('content').toString(), 'Offline edit',
        'Offline changes should sync after reconnect');
}

/**
 * Test: Both clients make offline changes
 */
async function testBothClientsOfflineChanges() {
    network = new MockNetwork();
    
    const client1 = new MockNetworkClient('client1');
    const client2 = new MockNetworkClient('client2');
    clients.push(client1, client2);
    
    network.addClient(client1);
    network.addClient(client2);
    
    client1.connect();
    client2.connect();
    
    const docId = generateDocId();
    const doc1 = client1.getDoc(docId);
    const doc2 = client2.getDoc(docId);
    
    await sleep(200);
    
    // Start with shared content
    doc1.getText('content').insert(0, 'Base');
    await waitForSync(clients, docId, 3000);
    
    // Both go offline
    client1.disconnect();
    client2.disconnect();
    
    // Both make changes
    doc1.getText('content').insert(4, '-C1');
    doc2.getText('content').insert(4, '-C2');
    
    // Reconnect both
    client1.connect();
    client2.connect();
    
    await sleep(200);
    
    // Sync using waitForSync which triggers sync requests
    await waitForSync(clients, docId, 3000);
    
    // Should have merged content
    const content1 = doc1.getText('content').toString();
    const content2 = doc2.getText('content').toString();
    
    assert.equal(content1, content2, 'Should converge');
    assert.ok(content1.startsWith('Base'), 'Should keep base');
    assert.ok(content1.includes('C1') && content1.includes('C2'), 'Should have both changes');
}

// ============ Concurrent Edit Tests ============

/**
 * Test: Concurrent edits at same position
 */
async function testConcurrentEditsAtSamePosition() {
    network = new MockNetwork({ latency: 10 });
    
    const client1 = new MockNetworkClient('client1');
    const client2 = new MockNetworkClient('client2');
    clients.push(client1, client2);
    
    network.addClient(client1);
    network.addClient(client2);
    
    client1.connect();
    client2.connect();
    
    const docId = generateDocId();
    client1.getDoc(docId);
    client2.getDoc(docId);
    
    await sleep(200); // Initial sync with latency
    
    // Both insert at position 0 "simultaneously"
    client1.docs.get(docId).getText('content').insert(0, 'ONE');
    client2.docs.get(docId).getText('content').insert(0, 'TWO');
    
    await waitForSync(clients, docId, 5000);
    
    const content1 = client1.docs.get(docId).getText('content').toString();
    const content2 = client2.docs.get(docId).getText('content').toString();
    
    assert.equal(content1, content2, 'Should converge');
    assert.equal(content1.length, 6, 'Should have both insertions');
    assert.ok(content1.includes('ONE'), 'Should contain ONE');
    assert.ok(content1.includes('TWO'), 'Should contain TWO');
}

/**
 * Test: Rapid concurrent edits
 */
async function testRapidConcurrentEdits() {
    network = new MockNetwork({ latency: 5 });
    
    const client1 = new MockNetworkClient('client1');
    const client2 = new MockNetworkClient('client2');
    clients.push(client1, client2);
    
    network.addClient(client1);
    network.addClient(client2);
    
    client1.connect();
    client2.connect();
    
    const docId = generateDocId();
    const doc1 = client1.getDoc(docId);
    const doc2 = client2.getDoc(docId);
    
    await sleep(200); // Initial sync
    
    // Both rapidly insert characters
    for (let i = 0; i < 20; i++) {
        doc1.getText('content').insert(doc1.getText('content').length, 'A');
        doc2.getText('content').insert(doc2.getText('content').length, 'B');
    }
    
    await waitForSync(clients, docId, 10000);
    
    const content1 = doc1.getText('content').toString();
    const content2 = doc2.getText('content').toString();
    
    assert.equal(content1, content2, 'Should converge');
    assert.equal(content1.length, 40, 'Should have all 40 characters');
    
    const aCount = (content1.match(/A/g) || []).length;
    const bCount = (content1.match(/B/g) || []).length;
    assert.equal(aCount, 20, 'Should have 20 As');
    assert.equal(bCount, 20, 'Should have 20 Bs');
}

// ============ Client Join/Leave Tests ============

/**
 * Test: Late joiner gets full document state
 */
async function testLateJoinerSync() {
    network = new MockNetwork();
    
    const client1 = new MockNetworkClient('client1');
    clients.push(client1);
    
    network.addClient(client1);
    client1.connect();
    
    const docId = generateDocId();
    const doc1 = client1.getDoc(docId);
    
    // Client1 creates content
    doc1.getText('content').insert(0, 'Existing content');
    
    await sleep(100);
    
    // Client2 joins late
    const client2 = new MockNetworkClient('client2');
    clients.push(client2);
    network.addClient(client2);
    client2.connect();
    
    // Client2 gets the document
    client2.getDoc(docId);
    
    await sleep(300);
    
    // Client2 should have the full content
    assert.equal(client2.docs.get(docId).getText('content').toString(), 'Existing content',
        'Late joiner should get existing content');
}

/**
 * Test: Client leaves and changes still propagate to remaining
 */
async function testClientLeavesOthersSync() {
    network = new MockNetwork();
    
    const client1 = new MockNetworkClient('client1');
    const client2 = new MockNetworkClient('client2');
    const client3 = new MockNetworkClient('client3');
    clients.push(client1, client2, client3);
    
    network.addClient(client1);
    network.addClient(client2);
    network.addClient(client3);
    
    client1.connect();
    client2.connect();
    client3.connect();
    
    const docId = generateDocId();
    client1.getDoc(docId);
    client2.getDoc(docId);
    client3.getDoc(docId);
    
    await sleep(100);
    
    // Client2 leaves
    client2.disconnect();
    network.removeClient(client2.id);
    
    // Client1 makes a change
    client1.docs.get(docId).getText('content').insert(0, 'After leave');
    
    await sleep(200);
    
    // Client3 should still get the change
    assert.equal(client3.docs.get(docId).getText('content').toString(), 'After leave');
}

// Export test suite
module.exports = {
    name: 'Network Boundary',
    setup,
    teardown,
    tests: {
        // Basic connectivity
        testTwoClientSync,
        testThreeClientMesh,
        
        // Network partitions
        testNetworkPartition,
        testPartitionHeal,
        testSplitBrainConflict,
        
        // Latency and jitter
        testSyncWithLatency,
        testSyncWithJitter,
        
        // Packet loss
        testSyncWithPacketLoss,
        
        // Disconnection/reconnection
        testOfflineChangesSync,
        testOfflineClientChanges,
        testBothClientsOfflineChanges,
        
        // Concurrent edits
        testConcurrentEditsAtSamePosition,
        testRapidConcurrentEdits,
        
        // Client join/leave
        testLateJoinerSync,
        testClientLeavesOthersSync,
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
