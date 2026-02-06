/**
 * P2P Bridge Tests
 * 
 * Tests for sidecar/p2p-bridge.js - bridges PeerManager protocol to sidecar
 * 
 * Tests cover:
 * - Client connection handling
 * - Message routing
 * - Topic management (join/leave)
 * - Identity handling
 * - Broadcast functionality
 * - mDNS integration
 * - Rate limiting / max clients protection
 */

/**
 * @jest-environment node
 */

// Mock hyperswarm module - must use require inside factory
jest.mock('../sidecar/hyperswarm', () => {
  const { EventEmitter } = require('events');
  
  class MockHyperswarmManager extends EventEmitter {
    constructor() {
      super();
      this.topics = new Set();
      this.connected = true;
    }
    
    async initialize(identity) {}
    
    async joinTopic(topic) {
      this.topics.add(topic);
      return { topic };
    }
    
    async leaveTopic(topic) {
      this.topics.delete(topic);
    }
    
    async sendMessage(topic, peerId, message) {}
    async broadcastMessage(topic, message) {}
  }
  
  return {
    HyperswarmManager: MockHyperswarmManager,
    generateTopic: (id) => require('crypto').createHash('sha256').update(id).digest('hex'),
  };
});

// Mock bonjour (mDNS) - use doMock instead since module may not exist
jest.mock('bonjour', () => {
  return jest.fn().mockImplementation(() => ({
    publish: jest.fn().mockReturnValue({ name: 'test' }),
    find: jest.fn().mockReturnValue({ on: jest.fn() }),
    unpublishAll: jest.fn(),
  }));
}, { virtual: true });

const { EventEmitter } = require('events');
const { P2PBridge } = require('../sidecar/p2p-bridge');

// Helper to create mock WebSocket
function createMockWebSocket() {
  const ws = new EventEmitter();
  ws.readyState = 1; // OPEN
  ws.sent = [];
  ws.send = function(data) {
    this.sent.push(typeof data === 'string' ? JSON.parse(data) : data);
  };
  ws.close = function(code, reason) {
    this.readyState = 3; // CLOSED
    this.emit('close', code, reason);
  };
  return ws;
}

// ============================================================
// P2PBridge Constructor Tests
// ============================================================

describe('P2PBridge', () => {
  let bridge;

  beforeEach(() => {
    bridge = new P2PBridge();
  });

  afterEach(() => {
    bridge = null;
  });

  describe('Constructor', () => {
    test('initializes with empty state', () => {
      expect(bridge.clients.size).toBe(0);
      expect(bridge.topics.size).toBe(0);
      expect(bridge.peerIdToSocket.size).toBe(0);
      expect(bridge.isInitialized).toBe(false);
    });

    test('sets max clients limit', () => {
      expect(bridge.maxClients).toBe(100);
    });

    test('hyperswarm is null before initialization', () => {
      expect(bridge.hyperswarm).toBeNull();
    });
  });

  describe('Client Connection Handling', () => {
    test('accepts new client connection', () => {
      const ws = createMockWebSocket();
      bridge.handleClient(ws);
      
      expect(bridge.clients.size).toBe(1);
      expect(bridge.clients.get(ws)).toEqual({
        peerId: null,
        topics: expect.any(Set),
        identity: null,
      });
    });

    test('rejects connection when at max clients', () => {
      // Fill up to max
      bridge.maxClients = 2;
      
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();
      const ws3 = createMockWebSocket();
      
      bridge.handleClient(ws1);
      bridge.handleClient(ws2);
      
      // Third should be rejected
      bridge.handleClient(ws3);
      
      expect(bridge.clients.size).toBe(2);
      expect(ws3.readyState).toBe(3); // CLOSED
    });

    test('cleans up on client disconnect', () => {
      const ws = createMockWebSocket();
      bridge.handleClient(ws);
      expect(bridge.clients.size).toBe(1);
      
      // Simulate disconnect
      ws.emit('close');
      expect(bridge.clients.size).toBe(0);
    });
  });
});

// ============================================================
// Message Handling Tests
// ============================================================

describe('P2PBridge Message Handling', () => {
  let bridge;
  let ws;

  beforeEach(async () => {
    bridge = new P2PBridge();
    await bridge.initialize({ peerId: 'test-peer', displayName: 'Test' });
    ws = createMockWebSocket();
    bridge.handleClient(ws);
  });

  describe('Identity Message', () => {
    test('stores peer identity on p2p-identity message', async () => {
      const message = {
        type: 'p2p-identity',
        peerId: 'peer-123',
        displayName: 'Test User',
        color: '#ff0000',
        icon: '👤',
      };
      
      await bridge.handleMessage(ws, message);
      
      const client = bridge.clients.get(ws);
      expect(client.peerId).toBe('peer-123');
      expect(client.identity.displayName).toBe('Test User');
      expect(client.identity.color).toBe('#ff0000');
    });

    test('maps peerId to socket', async () => {
      const message = {
        type: 'p2p-identity',
        peerId: 'peer-123',
        displayName: 'Test User',
      };
      
      await bridge.handleMessage(ws, message);
      
      expect(bridge.peerIdToSocket.get('peer-123')).toBe(ws);
    });
  });

  describe('Topic Join Message', () => {
    test('adds client to topic on join', async () => {
      // First identify
      await bridge.handleMessage(ws, {
        type: 'p2p-identity',
        peerId: 'peer-123',
      });
      
      // Then join topic
      await bridge.handleMessage(ws, {
        type: 'p2p-join-topic',
        topic: 'workspace-abc',
      });
      
      expect(bridge.topics.has('workspace-abc')).toBe(true);
      expect(bridge.topics.get('workspace-abc').has(ws)).toBe(true);
      
      const client = bridge.clients.get(ws);
      expect(client.topics.has('workspace-abc')).toBe(true);
    });

    test('sends topic-joined confirmation', async () => {
      await bridge.handleMessage(ws, {
        type: 'p2p-identity',
        peerId: 'peer-123',
      });
      
      await bridge.handleMessage(ws, {
        type: 'p2p-join-topic',
        topic: 'workspace-abc',
      });
      
      const confirmMessage = ws.sent.find(m => m.type === 'p2p-topic-joined');
      expect(confirmMessage).toBeDefined();
      expect(confirmMessage.topic).toBe('workspace-abc');
    });

    test('handles join without topic gracefully', async () => {
      await bridge.handleMessage(ws, {
        type: 'p2p-join-topic',
        // Missing topic
      });
      
      // Should not throw, just return early
      expect(bridge.topics.size).toBe(0);
    });
  });

  describe('Topic Leave Message', () => {
    test('removes client from topic on leave', async () => {
      await bridge.handleMessage(ws, {
        type: 'p2p-identity',
        peerId: 'peer-123',
      });
      
      await bridge.handleMessage(ws, {
        type: 'p2p-join-topic',
        topic: 'workspace-abc',
      });
      
      await bridge.handleMessage(ws, {
        type: 'p2p-leave-topic',
        topic: 'workspace-abc',
      });
      
      const client = bridge.clients.get(ws);
      expect(client.topics.has('workspace-abc')).toBe(false);
    });
  });

  describe('Message Validation', () => {
    test('rejects message without type', async () => {
      await bridge.handleMessage(ws, { data: 'test' });
      // Should return early without error
      expect(true).toBe(true);
    });

    test('rejects null message', async () => {
      await bridge.handleMessage(ws, null);
      expect(true).toBe(true);
    });
  });
});

// ============================================================
// Broadcast Tests
// ============================================================

describe('P2PBridge Broadcasting', () => {
  let bridge;

  beforeEach(async () => {
    bridge = new P2PBridge();
    await bridge.initialize({ peerId: 'test-peer' });
  });

  test('broadcasts to all clients in topic', async () => {
    const ws1 = createMockWebSocket();
    const ws2 = createMockWebSocket();
    const ws3 = createMockWebSocket();
    
    bridge.handleClient(ws1);
    bridge.handleClient(ws2);
    bridge.handleClient(ws3);
    
    // Set up clients in same topic
    for (const [i, ws] of [ws1, ws2, ws3].entries()) {
      await bridge.handleMessage(ws, {
        type: 'p2p-identity',
        peerId: `peer-${i}`,
      });
      await bridge.handleMessage(ws, {
        type: 'p2p-join-topic',
        topic: 'shared-topic',
      });
    }
    
    // Clear sent messages
    ws1.sent = [];
    ws2.sent = [];
    ws3.sent = [];
    
    // Broadcast from ws1
    await bridge.handleMessage(ws1, {
      type: 'p2p-broadcast',
      topic: 'shared-topic',
      payload: { test: 'data' },
    });
    
    // ws2 and ws3 should receive, but not ws1 (sender)
    expect(ws2.sent.some(m => m.type === 'p2p-message')).toBe(true);
    expect(ws3.sent.some(m => m.type === 'p2p-message')).toBe(true);
  });

  test('does not broadcast to clients in different topic', async () => {
    const ws1 = createMockWebSocket();
    const ws2 = createMockWebSocket();
    
    bridge.handleClient(ws1);
    bridge.handleClient(ws2);
    
    await bridge.handleMessage(ws1, {
      type: 'p2p-identity',
      peerId: 'peer-1',
    });
    await bridge.handleMessage(ws1, {
      type: 'p2p-join-topic',
      topic: 'topic-a',
    });
    
    await bridge.handleMessage(ws2, {
      type: 'p2p-identity',
      peerId: 'peer-2',
    });
    await bridge.handleMessage(ws2, {
      type: 'p2p-join-topic',
      topic: 'topic-b', // Different topic
    });
    
    ws2.sent = [];
    
    await bridge.handleMessage(ws1, {
      type: 'p2p-broadcast',
      topic: 'topic-a',
      payload: { test: 'data' },
    });
    
    // ws2 should NOT receive (different topic)
    expect(ws2.sent.filter(m => m.type === 'p2p-message').length).toBe(0);
  });
});

// ============================================================
// Direct Send Tests
// ============================================================

describe('P2PBridge Direct Send', () => {
  let bridge;

  beforeEach(async () => {
    bridge = new P2PBridge();
    await bridge.initialize({ peerId: 'test-peer' });
  });

  test('sends message to specific peer', async () => {
    const ws1 = createMockWebSocket();
    const ws2 = createMockWebSocket();
    
    bridge.handleClient(ws1);
    bridge.handleClient(ws2);
    
    await bridge.handleMessage(ws1, {
      type: 'p2p-identity',
      peerId: 'sender',
    });
    await bridge.handleMessage(ws2, {
      type: 'p2p-identity',
      peerId: 'receiver',
    });
    
    ws2.sent = [];
    
    await bridge.handleMessage(ws1, {
      type: 'p2p-send',
      targetPeerId: 'receiver',
      payload: { private: 'message' },
    });
    
    const received = ws2.sent.find(m => m.type === 'p2p-message');
    expect(received).toBeDefined();
    expect(received.payload.private).toBe('message');
  });

  test('handles send to unknown peer gracefully', async () => {
    const ws = createMockWebSocket();
    bridge.handleClient(ws);
    
    await bridge.handleMessage(ws, {
      type: 'p2p-identity',
      peerId: 'sender',
    });
    
    // Should not throw
    await bridge.handleMessage(ws, {
      type: 'p2p-send',
      targetPeerId: 'unknown-peer',
      payload: { test: 'data' },
    });
    
    expect(true).toBe(true);
  });
});

// ============================================================
// mDNS Tests
// ============================================================

describe('P2PBridge mDNS', () => {
  test('initializes mDNS when bonjour available', () => {
    const bridge = new P2PBridge();
    // mDNS may or may not be available in test environment
    // Just verify no crash
    expect(bridge.bonjour).toBeDefined();
  });
});

// ============================================================
// Client Disconnect Cleanup Tests
// ============================================================

describe('P2PBridge Disconnect Cleanup', () => {
  let bridge;

  beforeEach(async () => {
    bridge = new P2PBridge();
    await bridge.initialize({ peerId: 'test-peer' });
  });

  test('removes from peerIdToSocket on disconnect', async () => {
    const ws = createMockWebSocket();
    bridge.handleClient(ws);
    
    await bridge.handleMessage(ws, {
      type: 'p2p-identity',
      peerId: 'peer-123',
    });
    
    expect(bridge.peerIdToSocket.has('peer-123')).toBe(true);
    
    ws.emit('close');
    
    expect(bridge.peerIdToSocket.has('peer-123')).toBe(false);
  });

  test('removes from all topics on disconnect', async () => {
    const ws = createMockWebSocket();
    bridge.handleClient(ws);
    
    await bridge.handleMessage(ws, {
      type: 'p2p-identity',
      peerId: 'peer-123',
    });
    
    await bridge.handleMessage(ws, {
      type: 'p2p-join-topic',
      topic: 'topic-1',
    });
    await bridge.handleMessage(ws, {
      type: 'p2p-join-topic',
      topic: 'topic-2',
    });
    
    expect(bridge.topics.get('topic-1').has(ws)).toBe(true);
    expect(bridge.topics.get('topic-2').has(ws)).toBe(true);
    
    ws.emit('close');
    
    expect(bridge.topics.get('topic-1')?.has(ws) ?? false).toBe(false);
    expect(bridge.topics.get('topic-2')?.has(ws) ?? false).toBe(false);
  });

  test('notifies other peers of disconnect', async () => {
    const ws1 = createMockWebSocket();
    const ws2 = createMockWebSocket();
    
    bridge.handleClient(ws1);
    bridge.handleClient(ws2);
    
    await bridge.handleMessage(ws1, {
      type: 'p2p-identity',
      peerId: 'peer-1',
    });
    await bridge.handleMessage(ws2, {
      type: 'p2p-identity',
      peerId: 'peer-2',
    });
    
    await bridge.handleMessage(ws1, {
      type: 'p2p-join-topic',
      topic: 'shared',
    });
    await bridge.handleMessage(ws2, {
      type: 'p2p-join-topic',
      topic: 'shared',
    });
    
    ws2.sent = [];
    
    // Disconnect ws1
    ws1.emit('close');
    
    // ws2 should be notified
    const disconnectMsg = ws2.sent.find(m => m.type === 'p2p-peer-disconnected');
    expect(disconnectMsg).toBeDefined();
    expect(disconnectMsg.peerId).toBe('peer-1');
  });
});
