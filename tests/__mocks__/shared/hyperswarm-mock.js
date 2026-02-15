/**
 * Shared Hyperswarm Mock Factory
 * 
 * Provides consistent mock behavior for Hyperswarm across all P2P tests.
 * Use this to avoid duplicating mock implementations.
 */

const { EventEmitter } = require('events');

/**
 * Creates a mock Hyperswarm connection
 */
function createMockConnection(remotePublicKey = null) {
  const conn = new EventEmitter();
  conn.remotePublicKey = remotePublicKey || Buffer.from('mock-remote-key-' + Date.now());
  conn.publicKey = Buffer.from('mock-local-key');
  conn.rawStream = new EventEmitter();
  conn.rawStream.remoteHost = '127.0.0.1';
  conn.rawStream.remotePort = 12345;
  conn.writable = true;
  conn.readable = true;
  conn.destroyed = false;
  
  conn.write = jest.fn((data) => {
    conn.emit('data-sent', data);
    return true;
  });
  
  conn.end = jest.fn(() => {
    conn.destroyed = true;
    conn.emit('close');
  });
  
  conn.destroy = jest.fn(() => {
    conn.destroyed = true;
    conn.emit('close');
  });
  
  return conn;
}

/**
 * Creates a mock topic handle for join/leave operations
 */
function createMockTopicHandle(topicBuffer) {
  return {
    topic: topicBuffer,
    flushed: () => Promise.resolve(),
    destroy: jest.fn(() => Promise.resolve()),
  };
}

/**
 * Mock Hyperswarm class for testing
 */
class MockHyperswarm extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.connections = new Map();
    this.topics = new Map();
    this.destroyed = false;
    this.keyPair = {
      publicKey: Buffer.from('mock-public-key-' + Date.now()),
      secretKey: Buffer.from('mock-secret-key'),
    };
    
    // Track all method calls for assertions
    this.calls = {
      join: [],
      leave: [],
      destroy: [],
    };
  }
  
  join(topic, options = {}) {
    const topicHex = topic.toString('hex');
    this.calls.join.push({ topic: topicHex, options });
    
    const handle = createMockTopicHandle(topic);
    this.topics.set(topicHex, handle);
    
    return handle;
  }
  
  leave(topic) {
    const topicHex = topic.toString('hex');
    this.calls.leave.push({ topic: topicHex });
    this.topics.delete(topicHex);
    return Promise.resolve();
  }
  
  async destroy() {
    this.calls.destroy.push({ timestamp: Date.now() });
    this.destroyed = true;
    this.connections.clear();
    this.topics.clear();
    this.emit('close');
  }
  
  /**
   * Simulate a new peer connection
   * @param {Buffer} remotePublicKey - Remote peer's public key
   * @param {Object} peerInfo - Additional peer info
   */
  simulateConnection(remotePublicKey, peerInfo = {}) {
    const conn = createMockConnection(remotePublicKey);
    conn.peerInfo = peerInfo;
    this.connections.set(remotePublicKey.toString('hex'), conn);
    this.emit('connection', conn, peerInfo);
    return conn;
  }
  
  /**
   * Simulate a peer disconnection
   */
  simulateDisconnection(remotePublicKey) {
    const keyHex = remotePublicKey.toString('hex');
    const conn = this.connections.get(keyHex);
    if (conn) {
      this.connections.delete(keyHex);
      conn.emit('close');
    }
  }
  
  /**
   * Get all active connections
   */
  getConnections() {
    return Array.from(this.connections.values());
  }
}

/**
 * Mock HyperswarmManager for sidecar testing
 */
class MockHyperswarmManager extends EventEmitter {
  constructor() {
    super();
    this.topics = new Set();
    this.peers = new Map();
    this.connected = false;
    this.initialized = false;
    this.identity = null;
    
    this.calls = {
      initialize: [],
      joinTopic: [],
      leaveTopic: [],
      sendMessage: [],
      broadcastMessage: [],
      destroy: [],
    };
  }
  
  async initialize(identity) {
    this.calls.initialize.push({ identity });
    this.identity = identity;
    this.initialized = true;
    this.connected = true;
    this.emit('ready');
  }
  
  async joinTopic(topic) {
    this.calls.joinTopic.push({ topic });
    this.topics.add(topic);
    return { topic, flushed: () => Promise.resolve() };
  }
  
  async leaveTopic(topic) {
    this.calls.leaveTopic.push({ topic });
    this.topics.delete(topic);
  }
  
  async sendMessage(topic, peerId, message) {
    this.calls.sendMessage.push({ topic, peerId, message });
    return true;
  }
  
  async broadcastMessage(topic, message) {
    this.calls.broadcastMessage.push({ topic, message });
    return true;
  }
  
  getPublicKey() {
    return 'mock-public-key-hex';
  }
  
  getConnectedPeerKeys() {
    return Array.from(this.peers.keys());
  }
  
  async destroy() {
    this.calls.destroy.push({ timestamp: Date.now() });
    this.topics.clear();
    this.peers.clear();
    this.connected = false;
  }
  
  /**
   * Simulate a peer joining a topic
   */
  simulatePeerJoin(topic, peerKey, peerInfo = {}) {
    this.peers.set(peerKey, { topic, ...peerInfo });
    this.emit('peer-joined', { topic, peerKey, peerInfo });
  }
  
  /**
   * Simulate a peer leaving
   */
  simulatePeerLeave(peerKey) {
    const peer = this.peers.get(peerKey);
    if (peer) {
      this.peers.delete(peerKey);
      this.emit('peer-left', { peerKey, topic: peer.topic });
    }
  }
  
  /**
   * Simulate receiving a message
   */
  simulateMessage(topic, peerKey, message) {
    this.emit('message', { topic, peerKey, message });
  }
}

/**
 * Creates a mock WebSocket for testing
 */
function createMockWebSocket() {
  const ws = new EventEmitter();
  ws.readyState = 1; // WebSocket.OPEN
  ws.sent = [];
  ws.closed = false;
  
  ws.send = jest.fn((data) => {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    ws.sent.push(parsed);
  });
  
  ws.close = jest.fn((code, reason) => {
    ws.readyState = 3; // WebSocket.CLOSED
    ws.closed = true;
    ws.emit('close', code, reason);
  });
  
  ws.terminate = jest.fn(() => {
    ws.readyState = 3;
    ws.closed = true;
    ws.emit('close', 1006, 'terminated');
  });
  
  // Helper to simulate receiving a message
  ws.simulateMessage = (data) => {
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    ws.emit('message', message);
  };
  
  // Helper to get last sent message
  ws.getLastSent = () => ws.sent[ws.sent.length - 1];
  
  return ws;
}

/**
 * Creates mock Awareness for Yjs testing
 */
function createMockAwareness(clientID = Math.floor(Math.random() * 1000000)) {
  const awareness = new EventEmitter();
  awareness.clientID = clientID;
  awareness.states = new Map();
  awareness.localState = {};
  
  awareness.setLocalState = jest.fn((state) => {
    awareness.localState = state;
    if (state) {
      awareness.states.set(clientID, state);
    } else {
      awareness.states.delete(clientID);
    }
    awareness.emit('change', [{ added: [], updated: [clientID], removed: [] }], 'local');
  });
  
  awareness.setLocalStateField = jest.fn((field, value) => {
    awareness.localState = { ...awareness.localState, [field]: value };
    awareness.states.set(clientID, awareness.localState);
    awareness.emit('change', [{ added: [], updated: [clientID], removed: [] }], 'local');
  });
  
  awareness.getLocalState = jest.fn(() => awareness.localState);
  
  awareness.getStates = jest.fn(() => awareness.states);
  
  awareness.destroy = jest.fn(() => {
    awareness.states.clear();
    awareness.removeAllListeners();
  });
  
  // Helper to simulate remote peer state
  awareness.simulateRemotePeer = (remoteClientId, state) => {
    awareness.states.set(remoteClientId, state);
    awareness.emit('change', [{ added: [remoteClientId], updated: [], removed: [] }], 'remote');
  };
  
  // Helper to simulate peer leaving
  awareness.simulatePeerLeave = (remoteClientId) => {
    awareness.states.delete(remoteClientId);
    awareness.emit('change', [{ added: [], updated: [], removed: [remoteClientId] }], 'remote');
  };
  
  return awareness;
}

/**
 * Retry helper for flaky tests
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum number of retries (default: 3)
 * @param {number} delay - Delay between retries in ms (default: 500)
 */
async function withRetry(fn, maxRetries = 3, delay = 500) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

/**
 * Wait for a condition to be true
 * @param {Function} condition - Function returning boolean
 * @param {number} timeout - Maximum wait time in ms (default: 5000)
 * @param {number} interval - Check interval in ms (default: 100)
 */
async function waitFor(condition, timeout = 5000, interval = 100) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) {
      return true;
    }
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(`Condition not met within ${timeout}ms`);
}

module.exports = {
  MockHyperswarm,
  MockHyperswarmManager,
  createMockConnection,
  createMockTopicHandle,
  createMockWebSocket,
  createMockAwareness,
  withRetry,
  waitFor,
};
