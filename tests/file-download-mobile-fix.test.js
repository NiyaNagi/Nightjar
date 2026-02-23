/**
 * Issue #21 — File Download Fails on Mobile
 * 
 * Root cause: WebSocketTransport sends { type: 'identity' } immediately
 * on connect.  The unified server had NO case for 'identity' and returned
 * { type: 'error', error: 'unknown_type' }.  The client's error handler
 * BLINDLY rejected the pending joinTopic promise for ANY error, killing
 * peer discovery → 0 peers → all downloads fail.
 * 
 * Three fixes applied:
 *   A. Server: Handle 'identity' and 'pong' messages (no more unknown_type)
 *   B. Client: Only reject joinTopic for topic-fatal errors (allowlist)
 *   C. Client: Defer identity message until AFTER joinTopic on reconnect
 */

import { jest } from '@jest/globals';

// ── Top-level mocks ─────────────────────────────────────────────────

jest.mock('../frontend/src/services/p2p/protocol/serialization.js', () => ({
  generateTopic: jest.fn().mockResolvedValue('mock-topic'),
  generatePeerId: jest.fn().mockReturnValue('mock-peer-id'),
  encodeMessage: jest.fn((msg) => JSON.stringify(msg)),
  decodeMessage: jest.fn((str) => {
    try { return JSON.parse(str); } catch { return null; }
  }),
  MessageTypes: {
    PEER_LIST: 'peer-list',
    PEER_ANNOUNCE: 'peer-announce',
    WEBRTC_SIGNAL: 'webrtc-signal',
    PING: 'ping',
    PONG: 'pong',
    IDENTITY: 'identity',
  },
}));

jest.mock('../frontend/src/utils/roomAuth.js', () => ({
  computeRoomAuthToken: jest.fn().mockResolvedValue('mock-token'),
  computeRoomAuthTokenSync: jest.fn().mockReturnValue('mock-token'),
  encryptRelayPayload: jest.fn(),
  decryptRelayPayload: jest.fn(),
}));

import { WebSocketTransport } from '../frontend/src/services/p2p/transports/WebSocketTransport.js';

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const readSource = (rel) => fs.readFileSync(path.join(rootDir, rel), 'utf-8');

const wsTransportSource = readSource('frontend/src/services/p2p/transports/WebSocketTransport.js');
const serverSource = readSource('server/unified/index.js');

// =====================================================================
// Fix A: Server handles 'identity' and 'pong' without unknown_type
// =====================================================================

describe('Fix A: Server handles identity and pong messages', () => {
  test('server has case for "identity" in message switch', () => {
    // The switch should contain: case 'identity':
    expect(serverSource).toContain("case 'identity':");
  });

  test('server stores peerId from identity message', () => {
    // Should set info.peerId = msg.peerId
    expect(serverSource).toContain('info.peerId = msg.peerId');
  });

  test('server stores displayName from identity message', () => {
    // Should set info.displayName = msg.displayName
    expect(serverSource).toContain('info.displayName = msg.displayName');
  });

  test('server identity handler guards against missing peerId', () => {
    // Should check if (msg.peerId) before storing
    expect(serverSource).toMatch(/case 'identity':[\s\S]*?if\s*\(\s*msg\.peerId\s*\)/);
  });

  test('server has case for "pong" in message switch', () => {
    expect(serverSource).toContain("case 'pong':");
  });

  test('identity and pong cases appear before default in switch', () => {
    const identityPos = serverSource.indexOf("case 'identity':");
    const pongPos = serverSource.indexOf("case 'pong':");
    const defaultPos = serverSource.indexOf("this.send(ws, { type: 'error', error: 'unknown_type' })");
    expect(identityPos).toBeGreaterThan(-1);
    expect(pongPos).toBeGreaterThan(-1);
    expect(defaultPos).toBeGreaterThan(-1);
    expect(identityPos).toBeLessThan(defaultPos);
    expect(pongPos).toBeLessThan(defaultPos);
  });

  test('identity case does NOT send an error response', () => {
    // Extract the identity case block (from case 'identity' to the next break)
    const identityBlock = serverSource.match(/case 'identity':[\s\S]*?break;/);
    expect(identityBlock).toBeTruthy();
    expect(identityBlock[0]).not.toContain('unknown_type');
    expect(identityBlock[0]).not.toContain("type: 'error'");
  });

  test('pong case does NOT send an error response', () => {
    const pongBlock = serverSource.match(/case 'pong':[\s\S]*?break;/);
    expect(pongBlock).toBeTruthy();
    expect(pongBlock[0]).not.toContain('unknown_type');
    expect(pongBlock[0]).not.toContain("type: 'error'");
  });
});

// =====================================================================
// Fix B: Client — TOPIC_FATAL_ERRORS allowlist in error handler
// =====================================================================

describe('Fix B: Smart joinTopic error filtering', () => {
  test('WebSocketTransport defines TOPIC_FATAL_ERRORS set', () => {
    expect(wsTransportSource).toContain('TOPIC_FATAL_ERRORS');
  });

  test('TOPIC_FATAL_ERRORS includes auth_token_mismatch', () => {
    expect(wsTransportSource).toContain("'auth_token_mismatch'");
  });

  test('TOPIC_FATAL_ERRORS includes room_requires_auth', () => {
    expect(wsTransportSource).toContain("'room_requires_auth'");
  });

  test('TOPIC_FATAL_ERRORS includes topic_full', () => {
    expect(wsTransportSource).toContain("'topic_full'");
  });

  test('TOPIC_FATAL_ERRORS includes server_room_limit', () => {
    expect(wsTransportSource).toContain("'server_room_limit'");
  });

  test('TOPIC_FATAL_ERRORS includes too_many_topics', () => {
    expect(wsTransportSource).toContain("'too_many_topics'");
  });

  test('error handler checks TOPIC_FATAL_ERRORS.has() before rejecting', () => {
    expect(wsTransportSource).toContain('TOPIC_FATAL_ERRORS.has(message.error)');
  });

  // ── Behavioral tests (mock WebSocket) ─────────────────────────────

  let transport;
  let mockWs;

  beforeEach(() => {
    transport = new WebSocketTransport({ peerId: 'test-peer' });
    mockWs = {
      send: jest.fn(),
      close: jest.fn(),
      readyState: 1,
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    transport.serverSocket = mockWs;
    transport.connected = true;
    transport.localPeerId = 'test-peer';
    transport._setupServerSocket(mockWs);
  });

  test('unknown_type error does NOT reject joinTopic', async () => {
    const joinPromise = transport.joinTopic('workspace-topic', {
      authToken: 'valid-token',
    });

    // Simulate the exact error from Issue #21 diagnostic logs
    mockWs.onmessage({
      data: JSON.stringify({ type: 'error', error: 'unknown_type' }),
    });

    // Send peer-list after to prove joinTopic still resolves normally
    mockWs.onmessage({
      data: JSON.stringify({ type: 'peer-list', peers: ['peer-a'] }),
    });

    await expect(joinPromise).resolves.toBeUndefined();
  });

  test('relay_target_not_found error does NOT reject joinTopic', async () => {
    const joinPromise = transport.joinTopic('workspace-topic', {
      authToken: 'valid-token',
    });

    mockWs.onmessage({
      data: JSON.stringify({ type: 'error', error: 'relay_target_not_found' }),
    });

    mockWs.onmessage({
      data: JSON.stringify({ type: 'peer-list', peers: [] }),
    });

    await expect(joinPromise).resolves.toBeUndefined();
  });

  test('rate_limited error does NOT reject joinTopic', async () => {
    const joinPromise = transport.joinTopic('workspace-topic', {
      authToken: 'valid-token',
    });

    mockWs.onmessage({
      data: JSON.stringify({ type: 'error', error: 'rate_limited' }),
    });

    mockWs.onmessage({
      data: JSON.stringify({ type: 'peer-list', peers: [] }),
    });

    await expect(joinPromise).resolves.toBeUndefined();
  });

  test('auth_token_mismatch error DOES reject joinTopic', async () => {
    const joinPromise = transport.joinTopic('workspace-topic', {
      authToken: 'wrong-token',
    });

    mockWs.onmessage({
      data: JSON.stringify({ type: 'error', error: 'auth_token_mismatch' }),
    });

    await expect(joinPromise).rejects.toThrow('Topic join rejected: auth_token_mismatch');
  });

  test('room_requires_auth error DOES reject joinTopic', async () => {
    const joinPromise = transport.joinTopic('workspace-topic', {});

    mockWs.onmessage({
      data: JSON.stringify({ type: 'error', error: 'room_requires_auth' }),
    });

    await expect(joinPromise).rejects.toThrow('Topic join rejected: room_requires_auth');
  });

  test('topic_full error DOES reject joinTopic', async () => {
    const joinPromise = transport.joinTopic('workspace-topic', {
      authToken: 'valid',
    });

    mockWs.onmessage({
      data: JSON.stringify({ type: 'error', error: 'topic_full' }),
    });

    await expect(joinPromise).rejects.toThrow('Topic join rejected: topic_full');
  });

  test('server_room_limit error DOES reject joinTopic', async () => {
    const joinPromise = transport.joinTopic('workspace-topic', {
      authToken: 'valid',
    });

    mockWs.onmessage({
      data: JSON.stringify({ type: 'error', error: 'server_room_limit' }),
    });

    await expect(joinPromise).rejects.toThrow('Topic join rejected: server_room_limit');
  });

  test('too_many_topics error DOES reject joinTopic', async () => {
    const joinPromise = transport.joinTopic('workspace-topic', {
      authToken: 'valid',
    });

    mockWs.onmessage({
      data: JSON.stringify({ type: 'error', error: 'too_many_topics' }),
    });

    await expect(joinPromise).rejects.toThrow('Topic join rejected: too_many_topics');
  });

  test('server-error event is still emitted for non-fatal errors', (done) => {
    transport.on('server-error', (event) => {
      expect(event.error).toBe('unknown_type');
      done();
    });

    mockWs.onmessage({
      data: JSON.stringify({ type: 'error', error: 'unknown_type' }),
    });
  });
});

// =====================================================================
// Fix C: Deferred identity — send AFTER joinTopic on reconnect
// =====================================================================

describe('Fix C: Deferred identity message on reconnect', () => {
  test('WebSocketTransport has _sendIdentity helper method', () => {
    expect(wsTransportSource).toContain('_sendIdentity()');
    expect(wsTransportSource).toMatch(/_sendIdentity\s*\(\s*\)\s*\{/);
  });

  test('_sendIdentity sends identity message with peerId', () => {
    expect(wsTransportSource).toMatch(
      /type:\s*MessageTypes\.IDENTITY[\s\S]*?peerId:\s*this\.localPeerId/
    );
  });

  test('_sendIdentity guards on isServerConnected()', () => {
    // Should check this.isServerConnected() before sending
    const sendIdentityBlock = wsTransportSource.match(
      /_sendIdentity\s*\(\)\s*\{[\s\S]*?\}/
    );
    expect(sendIdentityBlock).toBeTruthy();
    expect(sendIdentityBlock[0]).toContain('isServerConnected()');
  });

  test('on reconnect (currentTopic exists), joinTopic is called before _sendIdentity', () => {
    // The pattern should be: if (this.currentTopic) { this.joinTopic(...).then(() => { this._sendIdentity() })
    const setupBlock = wsTransportSource.match(
      /if\s*\(\s*this\.currentTopic\s*\)\s*\{[\s\S]*?this\.joinTopic[\s\S]*?_sendIdentity/
    );
    expect(setupBlock).toBeTruthy();
  });

  test('on initial connect (no currentTopic), _sendIdentity is called immediately', () => {
    // The else block should call _sendIdentity immediately
    const elseBlock = wsTransportSource.match(
      /\}\s*else\s*\{[\s\S]*?_sendIdentity\s*\(\s*\)/
    );
    expect(elseBlock).toBeTruthy();
  });

  test('_sendIdentity is called in both .then() and .catch() of reconnect joinTopic', () => {
    // Even if joinTopic fails on reconnect, identity should still be sent
    const reconnectBlock = wsTransportSource.match(
      /this\.joinTopic\(this\.currentTopic\)\.then\(\(\) => \{[\s\S]*?_sendIdentity[\s\S]*?\.catch\(\(\) => \{[\s\S]*?_sendIdentity/
    );
    expect(reconnectBlock).toBeTruthy();
  });

  // ── Behavioral: reconnect defers identity ──────────────────────────

  test('reconnect with currentTopic calls joinTopic before sending identity', () => {
    const transport = new WebSocketTransport({ peerId: 'test-peer' });
    const mockWs = {
      send: jest.fn(),
      close: jest.fn(),
      readyState: 1,
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    transport.serverSocket = mockWs;
    transport.connected = true;
    transport.localPeerId = 'test-peer';
    transport.identity = { displayName: 'Alice' };

    // Simulate reconnect state: a topic was already joined
    transport.currentTopic = 'workspace-topic';
    transport.currentAuthToken = 'hmac-token';

    // Track the order of sent messages
    const sentMessages = [];
    mockWs.send = jest.fn((data) => {
      const msg = JSON.parse(data);
      sentMessages.push(msg.type);
    });

    transport._setupServerSocket(mockWs);

    // The join-topic message should go out first
    // (identity is deferred to .then()/.catch())
    expect(sentMessages[0]).toBe('join-topic');
  });

  test('initial connect without currentTopic sends identity immediately', () => {
    const transport = new WebSocketTransport({ peerId: 'test-peer' });
    const mockWs = {
      send: jest.fn(),
      close: jest.fn(),
      readyState: 1,
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    transport.serverSocket = mockWs;
    transport.connected = true;
    transport.localPeerId = 'test-peer';
    transport.identity = { displayName: 'Bob' };
    transport.currentTopic = null;

    const sentMessages = [];
    mockWs.send = jest.fn((data) => {
      const msg = JSON.parse(data);
      sentMessages.push(msg.type);
    });

    transport._setupServerSocket(mockWs);

    // Identity should be sent immediately (no deferred joinTopic)
    expect(sentMessages).toContain('identity');
    expect(sentMessages).not.toContain('join-topic');
  });
});

// =====================================================================
// End-to-end scenario: The exact Issue #21 race condition
// =====================================================================

describe('Issue #21 regression: identity error no longer kills joinTopic', () => {
  let transport;
  let mockWs;

  beforeEach(() => {
    transport = new WebSocketTransport({ peerId: 'mobile-peer' });
    mockWs = {
      send: jest.fn(),
      close: jest.fn(),
      readyState: 1,
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    transport.serverSocket = mockWs;
    transport.connected = true;
    transport.localPeerId = 'mobile-peer';
    transport._setupServerSocket(mockWs);
  });

  test('identity error followed by peer-list: joinTopic resolves (not rejects)', async () => {
    // This is the EXACT sequence from Issue #21 logs:
    // 1. Client sends identity message
    // 2. Server returns { type: 'error', error: 'unknown_type' }
    // 3. Client sends join-topic
    // 4. Server returns { type: 'peer-list', peers: [...] }
    //
    // BUG (before fix): Step 2 rejects joinTopic → 0 peers → download fails
    // FIX: Step 2 is logged but does NOT reject → Step 4 resolves normally

    const joinPromise = transport.joinTopic('workspace-topic', {
      authToken: 'valid-hmac-token',
      workspaceKey: 'workspace-key',
    });

    // Step 2: Server rejects identity (old server without Fix A)
    mockWs.onmessage({
      data: JSON.stringify({ type: 'error', error: 'unknown_type' }),
    });

    // Step 4: Server accepts join-topic
    mockWs.onmessage({
      data: JSON.stringify({
        type: 'peer-list',
        peers: [{ peerId: 'desktop-peer' }],
      }),
    });

    // joinTopic should resolve (not reject)
    await expect(joinPromise).resolves.toBeUndefined();
  });

  test('multiple non-fatal errors do not accumulate and kill joinTopic', async () => {
    const joinPromise = transport.joinTopic('workspace-topic', {
      authToken: 'valid',
    });

    // Rapid-fire non-fatal errors (e.g., relay errors while joining)
    for (let i = 0; i < 5; i++) {
      mockWs.onmessage({
        data: JSON.stringify({ type: 'error', error: 'relay_target_not_found' }),
      });
    }

    // joinTopic should still be pending — resolve it with peer-list
    mockWs.onmessage({
      data: JSON.stringify({ type: 'peer-list', peers: [] }),
    });

    await expect(joinPromise).resolves.toBeUndefined();
  });

  test('fatal error still rejects even after non-fatal errors', async () => {
    const joinPromise = transport.joinTopic('workspace-topic', {
      authToken: 'wrong-token',
    });

    // Non-fatal error first
    mockWs.onmessage({
      data: JSON.stringify({ type: 'error', error: 'unknown_type' }),
    });

    // Fatal error arrives
    mockWs.onmessage({
      data: JSON.stringify({ type: 'error', error: 'auth_token_mismatch' }),
    });

    await expect(joinPromise).rejects.toThrow('Topic join rejected: auth_token_mismatch');
  });
});

// =====================================================================
// Cross-platform matrix verification (source-level)
// =====================================================================

describe('Cross-platform file download matrix verification', () => {
  const bootstrapSource = readSource('frontend/src/services/p2p/BootstrapManager.js');
  const fileTransferSource = readSource('frontend/src/contexts/FileTransferContext.jsx');
  const downloadSource = readSource('frontend/src/hooks/useFileDownload.js');

  test('Web↔Web: WebSocketTransport is the only transport for web clients', () => {
    // BootstrapManager._seedConnections uses websocket transport for server connection
    expect(bootstrapSource).toContain('connectToServer');
    expect(bootstrapSource).toContain('joinTopic');
    // FileTransferContext connects via serverUrl prop (WebSocket)
    expect(fileTransferSource).toContain('serverUrl');
  });

  test('FileTransferContext re-bootstraps when 0 connected peers', () => {
    // The re-bootstrap logic should detect zero peers and retry
    expect(fileTransferSource).toContain('connectedPeers.length === 0');
    expect(fileTransferSource).toContain('one-shot re-bootstrap');
  });

  test('useFileDownload retries chunks with exponential backoff', () => {
    expect(downloadSource).toContain('MAX_RETRIES');
    expect(downloadSource).toContain('BASE_DELAY_MS');
    expect(downloadSource).toContain('Math.pow(2, attempt)');
  });

  test('BootstrapManager passes authToken and workspaceKey to joinTopic', () => {
    // The joinTopic call should include auth credentials
    expect(bootstrapSource).toContain('authToken');
    expect(bootstrapSource).toContain('workspaceKey');
  });

  test('Server message switch handles all P2P message types without unknown_type errors', () => {
    const requiredCases = [
      'join', 'leave', 'signal',
      'join-topic', 'leave-topic',
      'peer-request', 'peer-announce', 'webrtc-signal',
      'enable_persistence', 'store', 'sync_request',
      'ping', 'relay-message', 'relay-broadcast',
      'identity', 'pong',
    ];
    for (const msgType of requiredCases) {
      expect(serverSource).toContain(`case '${msgType}':`);
    }
  });
});
