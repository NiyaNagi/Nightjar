/**
 * Hyperswarm Message Routing Tests
 *
 * Tests that HyperswarmManager._handleData correctly routes all message types:
 * - Explicit cases (sync, identity, join-topic, etc.) → named events
 * - Default case (chunk-request, chunk-response, chunk-seed, etc.) → direct-message event
 * - Deduplication logic does not block unique chunk messages
 * - Heartbeat messages (ping/pong) bypass dedup
 *
 * The real sidecar/hyperswarm.js module is loaded directly. It uses lazy-loading
 * for the native `hyperswarm` package (only on initialize()), so we can construct
 * and test _handleData without native deps.
 *
 * @jest-environment node
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');

const { HyperswarmManager } = require('../../sidecar/hyperswarm');

/**
 * Create a HyperswarmManager with enough internal state
 * to test _handleData without fully initializing.
 */
function createTestManager() {
  const manager = new HyperswarmManager();
  // Manually set up minimum state (normally done in initialize())
  manager.processedMessages = new Map();
  manager.connections = new Map();
  return manager;
}

/**
 * Add a mock peer connection.
 */
function addMockPeer(manager, peerId) {
  const socket = {
    writable: true,
    write: jest.fn(),
  };
  manager.connections.set(peerId, {
    socket,
    peerInfo: { publicKey: Buffer.alloc(32, 'b') },
    authenticated: true,
    identity: { displayName: 'TestPeer', publicKey: peerId },
    topics: new Set(),
    lastPingSent: null,
    lastPongReceived: null,
  });
  return socket;
}

describe('HyperswarmManager Message Routing', () => {
  let manager;
  const testPeerId = 'a'.repeat(64);

  beforeEach(() => {
    manager = createTestManager();
    addMockPeer(manager, testPeerId);
  });

  afterEach(() => {
    manager.processedMessages.clear();
    manager.connections.clear();
    manager.removeAllListeners();
  });

  // ============================================================
  // Direct-message routing (the core fix)
  // ============================================================

  describe('default case emits direct-message', () => {
    test('routes chunk-request to direct-message event', (done) => {
      const payload = {
        type: 'chunk-request',
        fileId: 'file-abc123',
        chunkIndex: 0,
        requestId: 'req_123',
      };

      manager.on('direct-message', (data) => {
        expect(data.peerId).toBe(testPeerId);
        expect(data.message.type).toBe('chunk-request');
        expect(data.message.fileId).toBe('file-abc123');
        expect(data.message.chunkIndex).toBe(0);
        done();
      });

      manager._handleData(testPeerId, Buffer.from(JSON.stringify(payload)));
    });

    test('routes chunk-response to direct-message event', (done) => {
      const payload = {
        type: 'chunk-response',
        requestId: 'req_456',
        fileId: 'file-abc123',
        chunkIndex: 2,
        encrypted: 'base64data==',
        nonce: 'noncedata==',
        timestamp: Date.now(),
      };

      manager.on('direct-message', (data) => {
        expect(data.peerId).toBe(testPeerId);
        expect(data.message.type).toBe('chunk-response');
        expect(data.message.encrypted).toBe('base64data==');
        done();
      });

      manager._handleData(testPeerId, Buffer.from(JSON.stringify(payload)));
    });

    test('routes chunk-seed to direct-message event', (done) => {
      const payload = {
        type: 'chunk-seed',
        fileId: 'file-xyz',
        chunkIndex: 5,
        encrypted: 'seeddata==',
        nonce: 'seednonce==',
      };

      manager.on('direct-message', (data) => {
        expect(data.message.type).toBe('chunk-seed');
        expect(data.message.chunkIndex).toBe(5);
        done();
      });

      manager._handleData(testPeerId, Buffer.from(JSON.stringify(payload)));
    });

    test('routes unknown custom message types to direct-message event', (done) => {
      const payload = {
        type: 'custom-future-message',
        data: { key: 'value' },
      };

      manager.on('direct-message', (data) => {
        expect(data.message.type).toBe('custom-future-message');
        done();
      });

      manager._handleData(testPeerId, Buffer.from(JSON.stringify(payload)));
    });

    test('does NOT emit old "message" event for unhandled types', () => {
      const messageHandler = jest.fn();
      manager.on('message', messageHandler);

      const payload = { type: 'chunk-request', fileId: 'test', chunkIndex: 0 };
      manager._handleData(testPeerId, Buffer.from(JSON.stringify(payload)));

      expect(messageHandler).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Explicit cases still route correctly
  // ============================================================

  describe('explicit message types route to named events', () => {
    test('sync messages emit sync-message event', (done) => {
      const payload = {
        type: 'sync',
        topic: 'abc123',
        data: 'syncpayload',
      };

      manager.on('sync-message', (data) => {
        expect(data.peerId).toBe(testPeerId);
        expect(data.topic).toBe('abc123');
        expect(data.data).toBe('syncpayload');
        done();
      });

      manager._handleData(testPeerId, Buffer.from(JSON.stringify(payload)));
    });

    test('awareness messages emit awareness-update event', (done) => {
      const payload = {
        type: 'awareness',
        topic: 'abc123',
        state: { cursor: { x: 10, y: 20 } },
      };

      manager.on('awareness-update', (data) => {
        expect(data.peerId).toBe(testPeerId);
        expect(data.state.cursor.x).toBe(10);
        done();
      });

      manager._handleData(testPeerId, Buffer.from(JSON.stringify(payload)));
    });

    test('sync-request messages emit sync-state-request event', (done) => {
      const payload = {
        type: 'sync-request',
        topic: 'topic123',
      };

      manager.on('sync-state-request', (data) => {
        expect(data.peerId).toBe(testPeerId);
        expect(data.topic).toBe('topic123');
        done();
      });

      manager._handleData(testPeerId, Buffer.from(JSON.stringify(payload)));
    });
  });

  // ============================================================
  // Deduplication does NOT block chunk messages with unique content
  // ============================================================

  describe('deduplication', () => {
    test('allows unique chunk responses through (not deduped)', () => {
      const handler = jest.fn();
      manager.on('direct-message', handler);

      // Two chunk responses with different content should both be delivered
      const msg1 = {
        type: 'chunk-response',
        requestId: 'req_001',
        fileId: 'file-a',
        chunkIndex: 0,
        encrypted: 'AAAA',
        timestamp: 1000,
      };
      const msg2 = {
        type: 'chunk-response',
        requestId: 'req_002',
        fileId: 'file-a',
        chunkIndex: 1,
        encrypted: 'BBBB',
        timestamp: 1001,
      };

      manager._handleData(testPeerId, Buffer.from(JSON.stringify(msg1)));
      manager._handleData(testPeerId, Buffer.from(JSON.stringify(msg2)));

      expect(handler).toHaveBeenCalledTimes(2);
    });

    test('blocks exact duplicate messages', () => {
      const handler = jest.fn();
      manager.on('direct-message', handler);

      const msg = {
        type: 'chunk-request',
        fileId: 'file-x',
        chunkIndex: 0,
        requestId: 'req_dup',
      };
      const data = Buffer.from(JSON.stringify(msg));

      manager._handleData(testPeerId, data);
      manager._handleData(testPeerId, data);

      // Second one should be dropped as duplicate
      expect(handler).toHaveBeenCalledTimes(1);
    });

    test('ping/pong bypass deduplication entirely', () => {
      const conn = manager.connections.get(testPeerId);
      const socket = conn.socket;

      // Send two identical pings — both should trigger pong responses
      const pingMsg = { type: 'ping', timestamp: 12345 };
      const data = Buffer.from(JSON.stringify(pingMsg));

      manager._handleData(testPeerId, data);
      manager._handleData(testPeerId, data);

      // Both should have sent pong responses
      expect(socket.write).toHaveBeenCalledTimes(2);
      const pongs = socket.write.mock.calls.map(c => JSON.parse(c[0]));
      expect(pongs[0].type).toBe('pong');
      expect(pongs[1].type).toBe('pong');
    });
  });

  // ============================================================
  // Error handling
  // ============================================================

  describe('error handling', () => {
    test('handles invalid JSON gracefully', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      // Should not throw
      expect(() => {
        manager._handleData(testPeerId, Buffer.from('not valid json'));
      }).not.toThrow();

      consoleSpy.mockRestore();
    });

    test('handles unknown peer ID gracefully', () => {
      const unknownPeerId = 'b'.repeat(64);
      const payload = { type: 'chunk-request', fileId: 'f', chunkIndex: 0 };

      // Should not throw (no connection in map)
      expect(() => {
        manager._handleData(unknownPeerId, Buffer.from(JSON.stringify(payload)));
      }).not.toThrow();
    });
  });
});
