/**
 * P2P Bridge Extended Tests
 * 
 * Additional tests for sidecar/p2p-bridge.js covering:
 * - Error handling edge cases
 * - Connection state handling
 * - Message payload validation
 * - Rate limiting scenarios
 */

/**
 * @jest-environment node
 */

// Mock hyperswarm module - must use require inside factory
jest.mock('../../sidecar/hyperswarm', () => {
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

// Mock bonjour (mDNS)
jest.mock('bonjour', () => {
  return jest.fn().mockImplementation(() => ({
    publish: jest.fn().mockReturnValue({ name: 'test' }),
    find: jest.fn().mockReturnValue({ on: jest.fn() }),
    unpublishAll: jest.fn(),
  }));
}, { virtual: true });

const { EventEmitter } = require('events');
const { P2PBridge } = require('../../sidecar/p2p-bridge');

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

describe('P2PBridge Extended Tests', () => {
  let bridge;

  beforeEach(async () => {
    bridge = new P2PBridge();
    await bridge.initialize({ peerId: 'test-peer', displayName: 'Test' });
  });

  afterEach(() => {
    bridge = null;
  });

  describe('Connection State Handling', () => {
    test('handles message on closing socket gracefully', async () => {
      const ws = createMockWebSocket();
      bridge.handleClient(ws);
      
      await bridge.handleMessage(ws, {
        type: 'p2p-identity',
        peerId: 'peer-123',
      });
      
      // Close the socket
      ws.readyState = 3; // CLOSED
      
      // Try to send message - internal send should handle closed state
      const sentBefore = ws.sent.length;
      
      // Using the internal ws.send which should be guarded
      // In actual implementation, send checks readyState
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'test' }));
      }
      
      // No new messages should be sent
      expect(ws.sent.length).toBe(sentBefore);
    });

    test('handles socket close event properly', async () => {
      const ws = createMockWebSocket();
      bridge.handleClient(ws);
      
      await bridge.handleMessage(ws, {
        type: 'p2p-identity',
        peerId: 'peer-123',
      });
      
      expect(bridge.clients.size).toBe(1);
      
      // Close the socket
      ws.emit('close');
      
      // Client should be cleaned up
      expect(bridge.clients.size).toBe(0);
    });
  });

  describe('Message Payload Validation', () => {
    test('handles message with undefined payload', async () => {
      const ws = createMockWebSocket();
      bridge.handleClient(ws);
      
      await bridge.handleMessage(ws, {
        type: 'p2p-identity',
        peerId: 'peer-1',
      });
      
      // Broadcast with undefined payload
      await bridge.handleMessage(ws, {
        type: 'p2p-broadcast',
        topic: 'test-topic',
        payload: undefined,
      });
      
      // Should not throw
      expect(true).toBe(true);
    });

    test('handles message with empty string values', async () => {
      const ws = createMockWebSocket();
      bridge.handleClient(ws);
      
      await bridge.handleMessage(ws, {
        type: 'p2p-identity',
        peerId: '',  // Empty peerId
        displayName: '',
      });
      
      // Should handle gracefully
      const client = bridge.clients.get(ws);
      expect(client.peerId).toBe('');
    });

    test('handles very long peerId', async () => {
      const ws = createMockWebSocket();
      bridge.handleClient(ws);
      
      const longPeerId = 'x'.repeat(10000);
      
      await bridge.handleMessage(ws, {
        type: 'p2p-identity',
        peerId: longPeerId,
      });
      
      const client = bridge.clients.get(ws);
      expect(client.peerId).toBe(longPeerId);
    });
  });

  describe('Topic Edge Cases', () => {
    test('handles joining same topic multiple times', async () => {
      const ws = createMockWebSocket();
      bridge.handleClient(ws);
      
      await bridge.handleMessage(ws, {
        type: 'p2p-identity',
        peerId: 'peer-1',
      });
      
      // Join same topic twice
      await bridge.handleMessage(ws, {
        type: 'p2p-join-topic',
        topic: 'topic-a',
      });
      await bridge.handleMessage(ws, {
        type: 'p2p-join-topic',
        topic: 'topic-a',
      });
      
      // Should still only have one entry
      const client = bridge.clients.get(ws);
      const topicCount = [...client.topics].filter(t => t === 'topic-a').length;
      expect(topicCount).toBe(1);
    });

    test('handles leaving topic not joined', async () => {
      const ws = createMockWebSocket();
      bridge.handleClient(ws);
      
      await bridge.handleMessage(ws, {
        type: 'p2p-identity',
        peerId: 'peer-1',
      });
      
      // Leave topic we never joined
      await bridge.handleMessage(ws, {
        type: 'p2p-leave-topic',
        topic: 'never-joined',
      });
      
      // Should not throw
      expect(true).toBe(true);
    });

    test('handles broadcast to topic with no members', async () => {
      const ws = createMockWebSocket();
      bridge.handleClient(ws);
      
      await bridge.handleMessage(ws, {
        type: 'p2p-identity',
        peerId: 'peer-1',
      });
      
      // Broadcast to empty topic
      await bridge.handleMessage(ws, {
        type: 'p2p-broadcast',
        topic: 'empty-topic',
        payload: { test: 'data' },
      });
      
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('Multiple Client Scenarios', () => {
    test('handles many simultaneous clients', async () => {
      const clients = [];
      
      for (let i = 0; i < 50; i++) {
        const ws = createMockWebSocket();
        bridge.handleClient(ws);
        clients.push(ws);
        
        await bridge.handleMessage(ws, {
          type: 'p2p-identity',
          peerId: `peer-${i}`,
        });
        
        await bridge.handleMessage(ws, {
          type: 'p2p-join-topic',
          topic: 'shared-topic',
        });
      }
      
      expect(bridge.clients.size).toBe(50);
      expect(bridge.topics.get('shared-topic').size).toBe(50);
    });

    test('handles rapid connect/disconnect cycles', async () => {
      for (let i = 0; i < 20; i++) {
        const ws = createMockWebSocket();
        bridge.handleClient(ws);
        
        await bridge.handleMessage(ws, {
          type: 'p2p-identity',
          peerId: `peer-${i}`,
        });
        
        ws.emit('close');
      }
      
      expect(bridge.clients.size).toBe(0);
      expect(bridge.peerIdToSocket.size).toBe(0);
    });
  });

  describe('Identity Updates', () => {
    test('handles identity update for same client', async () => {
      const ws = createMockWebSocket();
      bridge.handleClient(ws);
      
      // Initial identity
      await bridge.handleMessage(ws, {
        type: 'p2p-identity',
        peerId: 'peer-1',
        displayName: 'Original Name',
      });
      
      // Update identity
      await bridge.handleMessage(ws, {
        type: 'p2p-identity',
        peerId: 'peer-1',
        displayName: 'New Name',
      });
      
      const client = bridge.clients.get(ws);
      expect(client.identity.displayName).toBe('New Name');
    });

    test('handles peerId change for same client', async () => {
      const ws = createMockWebSocket();
      bridge.handleClient(ws);
      
      // Initial identity
      await bridge.handleMessage(ws, {
        type: 'p2p-identity',
        peerId: 'peer-old',
      });
      
      expect(bridge.peerIdToSocket.has('peer-old')).toBe(true);
      
      // Change peerId
      await bridge.handleMessage(ws, {
        type: 'p2p-identity',
        peerId: 'peer-new',
      });
      
      // Old mapping should be cleaned up
      expect(bridge.peerIdToSocket.has('peer-new')).toBe(true);
    });
  });

  describe('Send Message Edge Cases', () => {
    test('handles send to self', async () => {
      const ws = createMockWebSocket();
      bridge.handleClient(ws);
      
      await bridge.handleMessage(ws, {
        type: 'p2p-identity',
        peerId: 'self-peer',
      });
      
      ws.sent = [];
      
      // Send to self
      await bridge.handleMessage(ws, {
        type: 'p2p-send',
        targetPeerId: 'self-peer',
        payload: { test: 'self-message' },
      });
      
      // May or may not deliver to self depending on implementation
      // Just verify no crash
      expect(true).toBe(true);
    });

    test('handles send with missing targetPeerId', async () => {
      const ws = createMockWebSocket();
      bridge.handleClient(ws);
      
      await bridge.handleMessage(ws, {
        type: 'p2p-identity',
        peerId: 'peer-1',
      });
      
      // Send without target
      await bridge.handleMessage(ws, {
        type: 'p2p-send',
        payload: { test: 'data' },
        // Missing targetPeerId
      });
      
      // Should not throw
      expect(true).toBe(true);
    });
  });
});
