/**
 * P2P Bridge Direct-Message Forwarding Tests
 *
 * Tests that P2PBridge correctly forwards direct-message events from
 * HyperswarmManager to all connected frontend WebSocket clients.
 *
 * This validates the critical fix: chunk-request/chunk-response/chunk-seed
 * messages that fall through HyperswarmManager's default case are now
 * emitted as 'direct-message' and P2PBridge forwards them as 'p2p-message'
 * to all frontend clients via _broadcastToAllClients.
 *
 * @jest-environment node
 */

// Mock hyperswarm module
jest.mock('../../sidecar/hyperswarm', () => {
  const { EventEmitter } = require('events');

  class MockHyperswarmManager extends EventEmitter {
    constructor() {
      super();
      this.topics = new Set();
      this.connected = true;
      this.sentMessages = [];
    }

    async initialize(identity) {}

    async joinTopic(topic) {
      this.topics.add(topic);
      return { topic };
    }

    async leaveTopic(topic) {
      this.topics.delete(topic);
    }

    async sendToPeer(peerId, message) {
      this.sentMessages.push({ peerId, message });
    }

    async broadcastSync(topic, data) {}

    getOwnPublicKey() {
      return 'a'.repeat(64);
    }

    getConnectedPeerKeys() {
      return [];
    }
  }

  return {
    HyperswarmManager: MockHyperswarmManager,
    generateTopic: (id) =>
      require('crypto').createHash('sha256').update(id).digest('hex'),
  };
});

// Mock bonjour (mDNS)
jest.mock('bonjour', () => {
  return jest.fn().mockImplementation(() => ({
    publish: jest.fn().mockReturnValue({ name: 'test', stop: jest.fn() }),
    find: jest.fn().mockReturnValue({ on: jest.fn() }),
    unpublishAll: jest.fn(),
    destroy: jest.fn(),
  }));
}, { virtual: true });

const { EventEmitter } = require('events');
const { P2PBridge } = require('../../sidecar/p2p-bridge');

// Helper to create mock WebSocket
function createMockWebSocket() {
  const ws = new EventEmitter();
  ws.readyState = 1; // OPEN
  ws.sent = [];
  ws.send = function (data) {
    this.sent.push(typeof data === 'string' ? JSON.parse(data) : data);
  };
  ws.close = function (code, reason) {
    this.readyState = 3; // CLOSED
    this.emit('close', code, reason);
  };
  return ws;
}

describe('P2PBridge Direct-Message Forwarding', () => {
  let bridge;

  beforeEach(async () => {
    bridge = new P2PBridge();
    await bridge.initialize({ peerId: 'test-peer', displayName: 'Test' });
  });

  afterEach(() => {
    bridge = null;
  });

  // ============================================================
  // _broadcastToAllClients method
  // ============================================================

  describe('_broadcastToAllClients', () => {
    test('sends message to all connected clients', async () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();
      const ws3 = createMockWebSocket();

      bridge.handleClient(ws1);
      bridge.handleClient(ws2);
      bridge.handleClient(ws3);

      bridge._broadcastToAllClients({ type: 'test', data: 'hello' });

      expect(ws1.sent).toEqual([{ type: 'test', data: 'hello' }]);
      expect(ws2.sent).toEqual([{ type: 'test', data: 'hello' }]);
      expect(ws3.sent).toEqual([{ type: 'test', data: 'hello' }]);
    });

    test('respects excludeWs parameter', async () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();

      bridge.handleClient(ws1);
      bridge.handleClient(ws2);

      bridge._broadcastToAllClients({ type: 'test' }, ws1);

      expect(ws1.sent).toEqual([]);
      expect(ws2.sent).toEqual([{ type: 'test' }]);
    });

    test('skips closed sockets', async () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();

      bridge.handleClient(ws1);
      bridge.handleClient(ws2);

      // Close ws1
      ws1.readyState = 3; // CLOSED

      bridge._broadcastToAllClients({ type: 'test' });

      expect(ws1.sent).toEqual([]); // should not receive
      expect(ws2.sent).toEqual([{ type: 'test' }]);
    });

    test('handles empty client list gracefully', () => {
      expect(() => {
        bridge._broadcastToAllClients({ type: 'test' });
      }).not.toThrow();
    });
  });

  // ============================================================
  // direct-message event forwarding
  // ============================================================

  describe('direct-message event → p2p-message forwarding', () => {
    test('forwards chunk-request from Hyperswarm to all frontend clients', async () => {
      const ws = createMockWebSocket();
      bridge.handleClient(ws);

      await bridge.handleMessage(ws, {
        type: 'p2p-identity',
        peerId: 'frontend-client',
      });

      ws.sent = []; // Clear identity-related messages

      // Simulate Hyperswarm emitting a direct-message
      const remotePeerId = 'b'.repeat(64);
      bridge.hyperswarm.emit('direct-message', {
        peerId: remotePeerId,
        message: {
          type: 'chunk-request',
          fileId: 'file-abc',
          chunkIndex: 0,
          requestId: 'req_001',
        },
      });

      expect(ws.sent.length).toBe(1);
      expect(ws.sent[0].type).toBe('p2p-message');
      expect(ws.sent[0].fromPeerId).toBe(remotePeerId);
      expect(ws.sent[0].payload.type).toBe('chunk-request');
      expect(ws.sent[0].payload.fileId).toBe('file-abc');
    });

    test('forwards chunk-response from Hyperswarm to all frontend clients', async () => {
      const ws = createMockWebSocket();
      bridge.handleClient(ws);

      ws.sent = [];

      bridge.hyperswarm.emit('direct-message', {
        peerId: 'c'.repeat(64),
        message: {
          type: 'chunk-response',
          requestId: 'req_002',
          fileId: 'file-xyz',
          chunkIndex: 3,
          encrypted: 'base64==',
          nonce: 'nonce==',
          timestamp: Date.now(),
        },
      });

      expect(ws.sent.length).toBe(1);
      expect(ws.sent[0].type).toBe('p2p-message');
      expect(ws.sent[0].payload.type).toBe('chunk-response');
      expect(ws.sent[0].payload.encrypted).toBe('base64==');
    });

    test('forwards chunk-seed from Hyperswarm to all frontend clients', async () => {
      const ws = createMockWebSocket();
      bridge.handleClient(ws);
      ws.sent = [];

      bridge.hyperswarm.emit('direct-message', {
        peerId: 'd'.repeat(64),
        message: {
          type: 'chunk-seed',
          fileId: 'file-seed',
          chunkIndex: 1,
          encrypted: 'seeddata',
          nonce: 'seednonce',
        },
      });

      expect(ws.sent.length).toBe(1);
      expect(ws.sent[0].type).toBe('p2p-message');
      expect(ws.sent[0].payload.type).toBe('chunk-seed');
    });

    test('forwards to ALL clients, not just topic members', async () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();
      const ws3 = createMockWebSocket();

      bridge.handleClient(ws1);
      bridge.handleClient(ws2);
      bridge.handleClient(ws3);

      // ws1 joins a topic, ws2 and ws3 do not
      await bridge.handleMessage(ws1, { type: 'p2p-identity', peerId: 'peer1' });
      await bridge.handleMessage(ws1, { type: 'p2p-join-topic', topic: 'a'.repeat(64) });

      ws1.sent = [];
      ws2.sent = [];
      ws3.sent = [];

      // Direct message should go to ALL clients, not filtered by topic
      bridge.hyperswarm.emit('direct-message', {
        peerId: 'e'.repeat(64),
        message: { type: 'chunk-request', fileId: 'f1', chunkIndex: 0 },
      });

      expect(ws1.sent.length).toBe(1);
      expect(ws2.sent.length).toBe(1);
      expect(ws3.sent.length).toBe(1);
    });

    test('forwards unknown future message types too', async () => {
      const ws = createMockWebSocket();
      bridge.handleClient(ws);
      ws.sent = [];

      bridge.hyperswarm.emit('direct-message', {
        peerId: 'f'.repeat(64),
        message: { type: 'some-future-type', data: 42 },
      });

      expect(ws.sent.length).toBe(1);
      expect(ws.sent[0].payload.type).toBe('some-future-type');
    });
  });

  // ============================================================
  // End-to-end: p2p-send → sendToPeer → direct-message → p2p-message
  // ============================================================

  describe('round-trip: send chunk-request via Hyperswarm and receive response', () => {
    test('outbound p2p-send calls sendToPeer on hyperswarm', async () => {
      const ws = createMockWebSocket();
      bridge.handleClient(ws);

      await bridge.handleMessage(ws, {
        type: 'p2p-identity',
        peerId: 'local-peer',
      });

      ws.sent = [];

      const remotePeerId = 'g'.repeat(64);
      await bridge.handleMessage(ws, {
        type: 'p2p-send',
        targetPeerId: remotePeerId,
        payload: {
          type: 'chunk-request',
          fileId: 'file-123',
          chunkIndex: 0,
          requestId: 'req_100',
        },
      });

      // Should have called sendToPeer on hyperswarm since remotePeerId
      // is not a local WebSocket client
      expect(bridge.hyperswarm.sentMessages.length).toBe(1);
      expect(bridge.hyperswarm.sentMessages[0].peerId).toBe(remotePeerId);
      expect(bridge.hyperswarm.sentMessages[0].message.type).toBe('chunk-request');
    });

    test('inbound direct-message arrives as p2p-message on local client', async () => {
      const ws = createMockWebSocket();
      bridge.handleClient(ws);

      await bridge.handleMessage(ws, {
        type: 'p2p-identity',
        peerId: 'local-peer',
      });

      ws.sent = [];

      // Simulate remote peer sending back a chunk-response
      bridge.hyperswarm.emit('direct-message', {
        peerId: 'h'.repeat(64),
        message: {
          type: 'chunk-response',
          requestId: 'req_100',
          fileId: 'file-123',
          chunkIndex: 0,
          encrypted: 'ENCRYPTED_DATA',
          nonce: 'NONCE',
          timestamp: Date.now(),
        },
      });

      expect(ws.sent.length).toBe(1);
      const msg = ws.sent[0];
      expect(msg.type).toBe('p2p-message');
      expect(msg.fromPeerId).toBe('h'.repeat(64));
      expect(msg.payload.type).toBe('chunk-response');
      expect(msg.payload.requestId).toBe('req_100');
    });
  });

  // ============================================================
  // sync-message still works (regression check)
  // ============================================================

  describe('sync-message forwarding still works', () => {
    test('sync-message is forwarded to topic members via _broadcastToTopic', async () => {
      const ws = createMockWebSocket();
      bridge.handleClient(ws);

      const topic = 'a'.repeat(64);
      await bridge.handleMessage(ws, { type: 'p2p-identity', peerId: 'peer1' });
      await bridge.handleMessage(ws, { type: 'p2p-join-topic', topic });

      ws.sent = [];

      // Simulate sync-message from hyperswarm
      bridge.hyperswarm.emit('sync-message', {
        peerId: 'remote-peer',
        topic,
        message: { type: 'sync', data: 'yjs-update' },
      });

      // sync-message should use _broadcastToTopic, not _broadcastToAllClients
      const syncMsg = ws.sent.find(m => m.type === 'p2p-message');
      expect(syncMsg).toBeDefined();
    });
  });
});
