/**
 * Chunk Message Round-Trip Tests
 *
 * Tests the complete chunk message flow through HyperswarmManager + P2PBridge:
 *
 *   1. Frontend client sends chunk-request via WebSocket → P2PBridge._handleSend →
 *      HyperswarmManager.sendToPeer → TCP to remote peer
 *
 *   2. Remote peer's chunk-response arrives via TCP → HyperswarmManager._handleData →
 *      default case → emit 'direct-message' → P2PBridge handler →
 *      _broadcastToAllClients → WebSocket to frontend
 *
 * This test validates the fix for the root cause where chunk messages were
 * silently dropped because:
 *   - HyperswarmManager's switch/case only handled sync/awareness/peer-list
 *   - The default case emitted 'message' but P2PBridge never subscribed to it
 *
 * @jest-environment node
 */

jest.mock('../../sidecar/hyperswarm', () => {
  const { EventEmitter } = require('events');

  class MockHyperswarmManager extends EventEmitter {
    constructor() {
      super();
      this.topics = new Set();
      this.sentMessages = [];
    }

    async initialize(identity) {}

    async joinTopic(topic) {
      this.topics.add(topic);
    }

    async leaveTopic(topic) {
      this.topics.delete(topic);
    }

    async sendToPeer(peerId, message) {
      this.sentMessages.push({ peerId, message });
    }

    async broadcastSync() {}

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

function createMockWebSocket() {
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.sent = [];
  ws.send = function (data) {
    this.sent.push(typeof data === 'string' ? JSON.parse(data) : data);
  };
  ws.close = function () {
    this.readyState = 3;
    this.emit('close');
  };
  return ws;
}

describe('Chunk Message Round-Trip', () => {
  let bridge;
  let ws;
  const localPeerId = 'local-' + 'a'.repeat(58);
  const remotePeerId = 'remote-' + 'b'.repeat(57);

  beforeEach(async () => {
    bridge = new P2PBridge();
    await bridge.initialize({ peerId: localPeerId, displayName: 'Boar' });

    ws = createMockWebSocket();
    bridge.handleClient(ws);
    await bridge.handleMessage(ws, {
      type: 'p2p-identity',
      peerId: localPeerId,
    });
    ws.sent = [];
  });

  afterEach(() => {
    bridge = null;
  });

  test('full round-trip: send chunk-request → receive chunk-response', async () => {
    // Step 1: Frontend sends a chunk-request to remote peer
    await bridge.handleMessage(ws, {
      type: 'p2p-send',
      targetPeerId: remotePeerId,
      payload: {
        type: 'chunk-request',
        fileId: 'file-roundtrip',
        chunkIndex: 0,
        requestId: 'req_rt_001',
      },
    });

    // Verify outbound message went through sendToPeer
    expect(bridge.hyperswarm.sentMessages.length).toBe(1);
    expect(bridge.hyperswarm.sentMessages[0].peerId).toBe(remotePeerId);
    expect(bridge.hyperswarm.sentMessages[0].message.type).toBe('chunk-request');

    // Step 2: Remote peer's chunk-response arrives via direct-message
    bridge.hyperswarm.emit('direct-message', {
      peerId: remotePeerId,
      message: {
        type: 'chunk-response',
        requestId: 'req_rt_001',
        fileId: 'file-roundtrip',
        chunkIndex: 0,
        encrypted: 'base64encryptedchunkdata==',
        nonce: 'base64nonce==',
        timestamp: Date.now(),
      },
    });

    // Verify frontend received the response
    expect(ws.sent.length).toBe(1);
    const received = ws.sent[0];
    expect(received.type).toBe('p2p-message');
    expect(received.fromPeerId).toBe(remotePeerId);
    expect(received.payload.type).toBe('chunk-response');
    expect(received.payload.requestId).toBe('req_rt_001');
    expect(received.payload.encrypted).toBe('base64encryptedchunkdata==');
  });

  test('multiple chunk responses delivered in sequence', async () => {
    const chunkCount = 5;

    for (let i = 0; i < chunkCount; i++) {
      bridge.hyperswarm.emit('direct-message', {
        peerId: remotePeerId,
        message: {
          type: 'chunk-response',
          requestId: `req_multi_${i}`,
          fileId: 'file-multi',
          chunkIndex: i,
          encrypted: `chunk_${i}_data`,
          nonce: `nonce_${i}`,
          timestamp: Date.now() + i,
        },
      });
    }

    expect(ws.sent.length).toBe(chunkCount);
    for (let i = 0; i < chunkCount; i++) {
      expect(ws.sent[i].payload.chunkIndex).toBe(i);
      expect(ws.sent[i].payload.encrypted).toBe(`chunk_${i}_data`);
    }
  });

  test('chunk-seed message delivered to frontend', async () => {
    bridge.hyperswarm.emit('direct-message', {
      peerId: remotePeerId,
      message: {
        type: 'chunk-seed',
        fileId: 'file-seed-test',
        chunkIndex: 2,
        encrypted: 'seed_data',
        nonce: 'seed_nonce',
      },
    });

    expect(ws.sent.length).toBe(1);
    expect(ws.sent[0].payload.type).toBe('chunk-seed');
    expect(ws.sent[0].payload.fileId).toBe('file-seed-test');
  });

  test('chunk-request from remote peer delivered to local frontend', async () => {
    // Remote peer asks us for a chunk
    bridge.hyperswarm.emit('direct-message', {
      peerId: remotePeerId,
      message: {
        type: 'chunk-request',
        fileId: 'file-served',
        chunkIndex: 3,
        requestId: 'req_remote_001',
      },
    });

    expect(ws.sent.length).toBe(1);
    expect(ws.sent[0].payload.type).toBe('chunk-request');
    expect(ws.sent[0].fromPeerId).toBe(remotePeerId);
  });

  test('multiple clients all receive direct messages', async () => {
    const ws2 = createMockWebSocket();
    const ws3 = createMockWebSocket();
    bridge.handleClient(ws2);
    bridge.handleClient(ws3);

    bridge.hyperswarm.emit('direct-message', {
      peerId: remotePeerId,
      message: {
        type: 'chunk-response',
        requestId: 'req_broadcast',
        fileId: 'file-bc',
        chunkIndex: 0,
        encrypted: 'data',
        nonce: 'n',
      },
    });

    // All three clients should receive it
    expect(ws.sent.length).toBe(1);
    expect(ws2.sent.length).toBe(1);
    expect(ws3.sent.length).toBe(1);
  });

  test('sync messages still routed via topic (not direct-message)', async () => {
    const topic = 'c'.repeat(64);

    await bridge.handleMessage(ws, {
      type: 'p2p-join-topic',
      topic,
    });

    ws.sent = []; // Clear join confirmation messages

    // Sync message via sync-message event (topic-scoped)
    bridge.hyperswarm.emit('sync-message', {
      peerId: remotePeerId,
      topic,
      message: { type: 'sync', data: 'yjs-update-bytes' },
    });

    const syncMsg = ws.sent.find((m) => m.type === 'p2p-message');
    expect(syncMsg).toBeDefined();
    expect(syncMsg.payload.type).toBe('sync');
  });
});
