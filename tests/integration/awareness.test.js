/**
 * Awareness/Presence Integration Tests
 * 
 * Tests for presence and awareness functionality:
 * - Awareness state management (local/remote)
 * - Cursor position sync
 * - Selection sync
 * - Typing indicators
 * - Peer tracking (join/leave)
 * - Last seen timestamps
 * - Multi-client awareness sync
 * - Awareness update encoding/decoding
 * 
 * Based on y-protocols/awareness and PresenceContext
 */

const {
    assert,
    sleep,
    randomHex,
} = require('./test-utils.js');

// Mock EventEmitter for awareness
class MockEventEmitter {
    constructor() {
        this._listeners = new Map();
    }
    
    on(event, callback) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, []);
        }
        this._listeners.get(event).push(callback);
    }
    
    off(event, callback) {
        const callbacks = this._listeners.get(event);
        if (callbacks) {
            const idx = callbacks.indexOf(callback);
            if (idx !== -1) callbacks.splice(idx, 1);
        }
    }
    
    emit(event, data) {
        const callbacks = this._listeners.get(event);
        if (callbacks) {
            callbacks.forEach(cb => cb(data));
        }
    }
}

/**
 * Mock Awareness class (simulates y-protocols/awareness)
 */
class MockAwareness extends MockEventEmitter {
    constructor(doc) {
        super();
        this.doc = doc;
        this.clientID = doc?.clientID || Math.floor(Math.random() * 1000000);
        this.states = new Map();
        this.meta = new Map();
        
        // Initialize local state
        this.states.set(this.clientID, {});
        this.meta.set(this.clientID, { clock: 0, lastUpdated: Date.now() });
    }
    
    getLocalState() {
        return this.states.get(this.clientID) || null;
    }
    
    setLocalState(state) {
        const prevState = this.states.get(this.clientID);
        
        if (state === null) {
            this.states.delete(this.clientID);
        } else {
            this.states.set(this.clientID, state);
        }
        
        const meta = this.meta.get(this.clientID) || { clock: 0 };
        this.meta.set(this.clientID, { 
            clock: meta.clock + 1, 
            lastUpdated: Date.now() 
        });
        
        // Emit update event
        const added = prevState === undefined && state !== null ? [this.clientID] : [];
        const updated = prevState !== undefined && state !== null ? [this.clientID] : [];
        const removed = state === null ? [this.clientID] : [];
        
        this.emit('update', { added, updated, removed });
        this.emit('change', { added, updated, removed });
    }
    
    setLocalStateField(key, value) {
        const state = this.getLocalState() || {};
        this.setLocalState({ ...state, [key]: value });
    }
    
    getStates() {
        return this.states;
    }
    
    destroy() {
        this.setLocalState(null);
        this._listeners.clear();
    }
}

/**
 * Mock presence state for a peer
 */
function createMockPeerState(options = {}) {
    return {
        user: {
            id: options.publicKey || randomHex(32),
            name: options.name || 'TestUser',
            color: options.color || '#6366f1',
            icon: options.icon || '😊',
            deviceId: options.deviceId || randomHex(8),
            deviceName: options.deviceName || 'Desktop'
        },
        cursor: options.cursor || null,
        selection: options.selection || null,
        isTyping: options.isTyping || false,
        lastSeen: options.lastSeen || Date.now()
    };
}

/**
 * Simulate awareness update encoding (simplified)
 */
function encodeAwarenessUpdate(awareness, clientIds) {
    const encoded = {
        clients: []
    };
    
    for (const clientId of clientIds) {
        const state = awareness.states.get(clientId);
        const meta = awareness.meta.get(clientId);
        if (state !== undefined && meta) {
            encoded.clients.push({
                clientId,
                clock: meta.clock,
                state
            });
        }
    }
    
    return JSON.stringify(encoded);
}

/**
 * Simulate awareness update decoding
 */
function applyAwarenessUpdate(awareness, encodedUpdate, origin) {
    const decoded = JSON.parse(encodedUpdate);
    const added = [];
    const updated = [];
    const removed = [];
    
    for (const client of decoded.clients) {
        const { clientId, clock, state } = client;
        
        if (clientId === awareness.clientID) continue; // Skip self
        
        const prevMeta = awareness.meta.get(clientId);
        
        if (state === null) {
            if (awareness.states.has(clientId)) {
                awareness.states.delete(clientId);
                removed.push(clientId);
            }
        } else {
            if (!awareness.states.has(clientId)) {
                added.push(clientId);
            } else {
                updated.push(clientId);
            }
            awareness.states.set(clientId, state);
        }
        
        awareness.meta.set(clientId, { clock, lastUpdated: Date.now() });
    }
    
    if (added.length > 0 || updated.length > 0 || removed.length > 0) {
        awareness.emit('update', { added, updated, removed });
        awareness.emit('change', { added, updated, removed });
    }
}

async function setup() {
    console.log('  [Setup] Awareness tests ready');
}

async function teardown() {
    // Cleanup
}

// ============ MockAwareness Tests ============

/**
 * Test: Awareness has clientID
 */
async function testAwarenessHasClientId() {
    const awareness = new MockAwareness({ clientID: 12345 });
    
    assert.equal(awareness.clientID, 12345, 'Should have clientID');
}

/**
 * Test: Awareness initializes with empty states
 */
async function testAwarenessInitialStates() {
    const awareness = new MockAwareness({ clientID: 1 });
    
    assert.ok(awareness.states instanceof Map, 'States should be Map');
    assert.equal(awareness.states.size, 1, 'Should have local client state');
}

/**
 * Test: getLocalState returns local state
 */
async function testGetLocalState() {
    const awareness = new MockAwareness({ clientID: 1 });
    awareness.setLocalState({ user: 'Test' });
    
    const state = awareness.getLocalState();
    assert.equal(state.user, 'Test', 'Should return local state');
}

/**
 * Test: setLocalState updates state
 */
async function testSetLocalState() {
    const awareness = new MockAwareness({ clientID: 1 });
    
    awareness.setLocalState({ cursor: { x: 10, y: 20 } });
    
    const state = awareness.getLocalState();
    assert.equal(state.cursor.x, 10, 'Should update state');
}

/**
 * Test: setLocalStateField updates single field
 */
async function testSetLocalStateField() {
    const awareness = new MockAwareness({ clientID: 1 });
    awareness.setLocalState({ user: 'A', color: 'red' });
    
    awareness.setLocalStateField('color', 'blue');
    
    const state = awareness.getLocalState();
    assert.equal(state.color, 'blue', 'Should update field');
    assert.equal(state.user, 'A', 'Should preserve other fields');
}

/**
 * Test: setLocalState null removes state
 */
async function testSetLocalStateNull() {
    const awareness = new MockAwareness({ clientID: 1 });
    awareness.setLocalState({ test: true });
    
    awareness.setLocalState(null);
    
    assert.equal(awareness.getLocalState(), null, 'Should remove state');
}

/**
 * Test: setLocalState emits update event
 */
async function testSetLocalStateEmitsUpdate() {
    const awareness = new MockAwareness({ clientID: 1 });
    
    let updateReceived = false;
    awareness.on('update', () => { updateReceived = true; });
    
    awareness.setLocalState({ test: true });
    
    assert.ok(updateReceived, 'Should emit update event');
}

/**
 * Test: getStates returns all states
 */
async function testGetStates() {
    const awareness = new MockAwareness({ clientID: 1 });
    awareness.setLocalState({ local: true });
    
    // Add a remote state
    awareness.states.set(999, { remote: true });
    
    const states = awareness.getStates();
    assert.equal(states.size, 2, 'Should have 2 states');
}

/**
 * Test: destroy clears state
 */
async function testAwarenessDestroy() {
    const awareness = new MockAwareness({ clientID: 1 });
    awareness.setLocalState({ test: true });
    
    awareness.destroy();
    
    assert.equal(awareness.getLocalState(), null, 'State should be null');
}

// ============ Peer State Tests ============

/**
 * Test: createMockPeerState has required fields
 */
async function testPeerStateHasRequiredFields() {
    const state = createMockPeerState({ name: 'Alice' });
    
    assert.ok(state.user, 'Should have user');
    assert.ok(state.user.id, 'Should have user.id');
    assert.ok(state.user.name, 'Should have user.name');
    assert.ok(state.user.color, 'Should have user.color');
    assert.ok(state.lastSeen, 'Should have lastSeen');
}

/**
 * Test: Peer state includes cursor when provided
 */
async function testPeerStateWithCursor() {
    const state = createMockPeerState({ 
        cursor: { line: 5, column: 10 } 
    });
    
    assert.equal(state.cursor.line, 5, 'Should have cursor line');
    assert.equal(state.cursor.column, 10, 'Should have cursor column');
}

/**
 * Test: Peer state includes selection when provided
 */
async function testPeerStateWithSelection() {
    const state = createMockPeerState({ 
        selection: { start: 0, end: 10 } 
    });
    
    assert.equal(state.selection.start, 0, 'Should have selection start');
    assert.equal(state.selection.end, 10, 'Should have selection end');
}

/**
 * Test: Peer state includes typing indicator
 */
async function testPeerStateTypingIndicator() {
    const state = createMockPeerState({ isTyping: true });
    
    assert.equal(state.isTyping, true, 'Should be typing');
}

// ============ Awareness Update Encoding Tests ============

/**
 * Test: encodeAwarenessUpdate encodes client states
 */
async function testEncodeAwarenessUpdate() {
    const awareness = new MockAwareness({ clientID: 1 });
    awareness.setLocalState({ user: 'Test' });
    
    const encoded = encodeAwarenessUpdate(awareness, [1]);
    const decoded = JSON.parse(encoded);
    
    assert.ok(decoded.clients, 'Should have clients array');
    assert.equal(decoded.clients.length, 1, 'Should have 1 client');
    assert.equal(decoded.clients[0].clientId, 1, 'Should include clientId');
}

/**
 * Test: encodeAwarenessUpdate includes clock
 */
async function testEncodeIncludesClock() {
    const awareness = new MockAwareness({ clientID: 1 });
    awareness.setLocalState({ test: true });
    awareness.setLocalState({ test: true, update: 2 }); // Increment clock
    
    const encoded = encodeAwarenessUpdate(awareness, [1]);
    const decoded = JSON.parse(encoded);
    
    assert.ok(decoded.clients[0].clock >= 1, 'Should include clock');
}

/**
 * Test: encodeAwarenessUpdate includes state
 */
async function testEncodeIncludesState() {
    const awareness = new MockAwareness({ clientID: 1 });
    awareness.setLocalState({ cursor: { x: 5 } });
    
    const encoded = encodeAwarenessUpdate(awareness, [1]);
    const decoded = JSON.parse(encoded);
    
    assert.equal(decoded.clients[0].state.cursor.x, 5, 'Should include state');
}

/**
 * Test: encodeAwarenessUpdate handles multiple clients
 */
async function testEncodeMultipleClients() {
    const awareness = new MockAwareness({ clientID: 1 });
    awareness.setLocalState({ name: 'Local' });
    awareness.states.set(2, { name: 'Remote' });
    awareness.meta.set(2, { clock: 1, lastUpdated: Date.now() });
    
    const encoded = encodeAwarenessUpdate(awareness, [1, 2]);
    const decoded = JSON.parse(encoded);
    
    assert.equal(decoded.clients.length, 2, 'Should have 2 clients');
}

// ============ Awareness Update Decoding Tests ============

/**
 * Test: applyAwarenessUpdate adds remote state
 */
async function testApplyAwarenessUpdateAdds() {
    const awareness = new MockAwareness({ clientID: 1 });
    
    const update = JSON.stringify({
        clients: [{ clientId: 2, clock: 1, state: { name: 'Remote' } }]
    });
    
    applyAwarenessUpdate(awareness, update, 'test');
    
    assert.ok(awareness.states.has(2), 'Should add remote state');
    assert.equal(awareness.states.get(2).name, 'Remote', 'Should have correct state');
}

/**
 * Test: applyAwarenessUpdate updates existing state
 */
async function testApplyAwarenessUpdateUpdates() {
    const awareness = new MockAwareness({ clientID: 1 });
    awareness.states.set(2, { name: 'Old' });
    awareness.meta.set(2, { clock: 0, lastUpdated: Date.now() });
    
    const update = JSON.stringify({
        clients: [{ clientId: 2, clock: 1, state: { name: 'Updated' } }]
    });
    
    applyAwarenessUpdate(awareness, update, 'test');
    
    assert.equal(awareness.states.get(2).name, 'Updated', 'Should update state');
}

/**
 * Test: applyAwarenessUpdate removes state on null
 */
async function testApplyAwarenessUpdateRemoves() {
    const awareness = new MockAwareness({ clientID: 1 });
    awareness.states.set(2, { name: 'Remote' });
    awareness.meta.set(2, { clock: 0, lastUpdated: Date.now() });
    
    const update = JSON.stringify({
        clients: [{ clientId: 2, clock: 1, state: null }]
    });
    
    applyAwarenessUpdate(awareness, update, 'test');
    
    assert.ok(!awareness.states.has(2), 'Should remove state');
}

/**
 * Test: applyAwarenessUpdate ignores self updates
 */
async function testApplyAwarenessUpdateIgnoresSelf() {
    const awareness = new MockAwareness({ clientID: 1 });
    awareness.setLocalState({ name: 'Original' });
    
    const update = JSON.stringify({
        clients: [{ clientId: 1, clock: 999, state: { name: 'Attempted Override' } }]
    });
    
    applyAwarenessUpdate(awareness, update, 'test');
    
    assert.equal(awareness.getLocalState().name, 'Original', 'Should ignore self update');
}

/**
 * Test: applyAwarenessUpdate emits change event
 */
async function testApplyAwarenessUpdateEmitsChange() {
    const awareness = new MockAwareness({ clientID: 1 });
    
    let changeReceived = false;
    awareness.on('change', () => { changeReceived = true; });
    
    const update = JSON.stringify({
        clients: [{ clientId: 2, clock: 1, state: { test: true } }]
    });
    
    applyAwarenessUpdate(awareness, update, 'test');
    
    assert.ok(changeReceived, 'Should emit change event');
}

// ============ Multi-Client Awareness Tests ============

/**
 * Test: Multiple awareness instances sync
 */
async function testMultipleAwarenessSync() {
    const awareness1 = new MockAwareness({ clientID: 1 });
    const awareness2 = new MockAwareness({ clientID: 2 });
    
    // Client 1 updates
    awareness1.setLocalState({ name: 'Alice', cursor: { line: 10 } });
    
    // Sync to client 2
    const update = encodeAwarenessUpdate(awareness1, [1]);
    applyAwarenessUpdate(awareness2, update, 'sync');
    
    // Client 2 should have client 1's state
    assert.ok(awareness2.states.has(1), 'Client 2 should have client 1 state');
    assert.equal(awareness2.states.get(1).name, 'Alice', 'Should have correct name');
}

/**
 * Test: Bidirectional awareness sync
 */
async function testBidirectionalSync() {
    const awareness1 = new MockAwareness({ clientID: 1 });
    const awareness2 = new MockAwareness({ clientID: 2 });
    
    awareness1.setLocalState({ name: 'Alice' });
    awareness2.setLocalState({ name: 'Bob' });
    
    // Sync both ways
    const update1 = encodeAwarenessUpdate(awareness1, [1]);
    const update2 = encodeAwarenessUpdate(awareness2, [2]);
    
    applyAwarenessUpdate(awareness2, update1, 'sync');
    applyAwarenessUpdate(awareness1, update2, 'sync');
    
    // Both should have each other
    assert.ok(awareness1.states.has(2), 'Client 1 should have client 2');
    assert.ok(awareness2.states.has(1), 'Client 2 should have client 1');
}

/**
 * Test: Cursor position sync between clients
 */
async function testCursorPositionSync() {
    const awareness1 = new MockAwareness({ clientID: 1 });
    const awareness2 = new MockAwareness({ clientID: 2 });
    
    awareness1.setLocalStateField('cursor', { line: 5, column: 15 });
    
    const update = encodeAwarenessUpdate(awareness1, [1]);
    applyAwarenessUpdate(awareness2, update, 'sync');
    
    const remoteState = awareness2.states.get(1);
    assert.equal(remoteState.cursor.line, 5, 'Should sync cursor line');
    assert.equal(remoteState.cursor.column, 15, 'Should sync cursor column');
}

/**
 * Test: Selection sync between clients
 */
async function testSelectionSync() {
    const awareness1 = new MockAwareness({ clientID: 1 });
    const awareness2 = new MockAwareness({ clientID: 2 });
    
    awareness1.setLocalStateField('selection', { 
        anchor: { line: 1, column: 0 },
        head: { line: 1, column: 20 }
    });
    
    const update = encodeAwarenessUpdate(awareness1, [1]);
    applyAwarenessUpdate(awareness2, update, 'sync');
    
    const remoteState = awareness2.states.get(1);
    assert.ok(remoteState.selection, 'Should sync selection');
    assert.equal(remoteState.selection.head.column, 20, 'Should have correct selection');
}

/**
 * Test: Typing indicator sync
 */
async function testTypingIndicatorSync() {
    const awareness1 = new MockAwareness({ clientID: 1 });
    const awareness2 = new MockAwareness({ clientID: 2 });
    
    awareness1.setLocalStateField('isTyping', true);
    
    const update = encodeAwarenessUpdate(awareness1, [1]);
    applyAwarenessUpdate(awareness2, update, 'sync');
    
    const remoteState = awareness2.states.get(1);
    assert.equal(remoteState.isTyping, true, 'Should sync typing indicator');
}

// ============ Presence Provider Logic Tests ============

/**
 * Test: Peers map filters self
 */
async function testPeersMapFiltersSelf() {
    const awareness = new MockAwareness({ clientID: 1 });
    awareness.setLocalState({ user: { name: 'Self' } });
    awareness.states.set(2, { user: { name: 'Remote' } });
    
    // Filter like PresenceContext does
    const peers = new Map();
    awareness.getStates().forEach((state, clientId) => {
        if (clientId !== awareness.clientID && state.user) {
            peers.set(clientId, state);
        }
    });
    
    assert.equal(peers.size, 1, 'Should only have remote peers');
    assert.ok(!peers.has(1), 'Should not include self');
}

/**
 * Test: Count online peers
 */
async function testCountOnlinePeers() {
    const awareness = new MockAwareness({ clientID: 1 });
    awareness.states.set(2, { user: { name: 'User2' } });
    awareness.states.set(3, { user: { name: 'User3' } });
    awareness.states.set(4, { user: { name: 'User4' } });
    
    // Count like PresenceContext does
    let count = 0;
    awareness.getStates().forEach((state, clientId) => {
        if (clientId !== awareness.clientID && state.user) {
            count++;
        }
    });
    
    assert.equal(count, 3, 'Should count 3 online peers');
}

/**
 * Test: Get typing peers
 */
async function testGetTypingPeers() {
    const awareness = new MockAwareness({ clientID: 1 });
    awareness.states.set(2, { user: { name: 'User2' }, isTyping: true });
    awareness.states.set(3, { user: { name: 'User3' }, isTyping: false });
    awareness.states.set(4, { user: { name: 'User4' }, isTyping: true });
    
    // Filter typing like PresenceContext does
    const typingPeers = [];
    awareness.getStates().forEach((state, clientId) => {
        if (clientId !== awareness.clientID && state.isTyping) {
            typingPeers.push(state);
        }
    });
    
    assert.equal(typingPeers.length, 2, 'Should have 2 typing peers');
}

/**
 * Test: Last seen timestamp update
 */
async function testLastSeenUpdate() {
    const awareness = new MockAwareness({ clientID: 1 });
    const before = Date.now();
    
    awareness.setLocalStateField('lastSeen', Date.now());
    
    const state = awareness.getLocalState();
    assert.ok(state.lastSeen >= before, 'lastSeen should be updated');
}

// ============ Edge Cases ============

/**
 * Test: Empty awareness states
 */
async function testEmptyAwarenessStates() {
    const awareness = new MockAwareness({ clientID: 1 });
    awareness.setLocalState(null);
    
    const states = awareness.getStates();
    assert.equal(states.size, 0, 'Should have no states');
}

/**
 * Test: Concurrent awareness updates
 */
async function testConcurrentUpdates() {
    const awareness1 = new MockAwareness({ clientID: 1 });
    const awareness2 = new MockAwareness({ clientID: 2 });
    const awareness3 = new MockAwareness({ clientID: 3 });
    
    // All three clients update simultaneously
    awareness1.setLocalState({ cursor: { line: 1 } });
    awareness2.setLocalState({ cursor: { line: 2 } });
    awareness3.setLocalState({ cursor: { line: 3 } });
    
    // Sync all to awareness1
    const update2 = encodeAwarenessUpdate(awareness2, [2]);
    const update3 = encodeAwarenessUpdate(awareness3, [3]);
    
    applyAwarenessUpdate(awareness1, update2, 'sync');
    applyAwarenessUpdate(awareness1, update3, 'sync');
    
    assert.equal(awareness1.states.size, 3, 'Should have all 3 states');
}

/**
 * Test: Rapid cursor updates
 */
async function testRapidCursorUpdates() {
    const awareness = new MockAwareness({ clientID: 1 });
    
    // Simulate rapid typing
    for (let i = 0; i < 10; i++) {
        awareness.setLocalStateField('cursor', { line: 1, column: i });
    }
    
    const state = awareness.getLocalState();
    assert.equal(state.cursor.column, 9, 'Should have last cursor position');
}

/**
 * Test: Peer disconnect removes state
 */
async function testPeerDisconnect() {
    const awareness = new MockAwareness({ clientID: 1 });
    awareness.states.set(2, { user: { name: 'Remote' } });
    awareness.meta.set(2, { clock: 1, lastUpdated: Date.now() });
    
    // Simulate disconnect
    const update = JSON.stringify({
        clients: [{ clientId: 2, clock: 2, state: null }]
    });
    
    applyAwarenessUpdate(awareness, update, 'disconnect');
    
    assert.ok(!awareness.states.has(2), 'Disconnected peer should be removed');
}

// Export test suite
module.exports = {
    name: 'Awareness',
    setup,
    teardown,
    tests: {
        // MockAwareness tests
        testAwarenessHasClientId,
        testAwarenessInitialStates,
        testGetLocalState,
        testSetLocalState,
        testSetLocalStateField,
        testSetLocalStateNull,
        testSetLocalStateEmitsUpdate,
        testGetStates,
        testAwarenessDestroy,
        
        // Peer state tests
        testPeerStateHasRequiredFields,
        testPeerStateWithCursor,
        testPeerStateWithSelection,
        testPeerStateTypingIndicator,
        
        // Encoding tests
        testEncodeAwarenessUpdate,
        testEncodeIncludesClock,
        testEncodeIncludesState,
        testEncodeMultipleClients,
        
        // Decoding tests
        testApplyAwarenessUpdateAdds,
        testApplyAwarenessUpdateUpdates,
        testApplyAwarenessUpdateRemoves,
        testApplyAwarenessUpdateIgnoresSelf,
        testApplyAwarenessUpdateEmitsChange,
        
        // Multi-client tests
        testMultipleAwarenessSync,
        testBidirectionalSync,
        testCursorPositionSync,
        testSelectionSync,
        testTypingIndicatorSync,
        
        // Presence provider logic tests
        testPeersMapFiltersSelf,
        testCountOnlinePeers,
        testGetTypingPeers,
        testLastSeenUpdate,
        
        // Edge cases
        testEmptyAwarenessStates,
        testConcurrentUpdates,
        testRapidCursorUpdates,
        testPeerDisconnect,
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
