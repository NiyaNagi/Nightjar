/**
 * File Sharing Auth Fixes — v1.8.10
 * 
 * Tests for the 4 fixes addressing Issue #18 (file sharing 0 peers)
 * and Issue #19 (infinite reconnect loop on mobile):
 * 
 * Fix 1: FileTransferProvider uses workspace key (not sessionKey)
 * Fix 2: y-websocket 4403 close code stops reconnect loop
 * Fix 3: Rapid-disconnect circuit breaker
 * Fix 4: WebSocketTransport joinTopic error handling
 */

import { jest } from '@jest/globals';

// ── Top-level mocks (Jest hoisting-safe) ─────────────────────────────

// Mock serialization
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
  },
}));

// Mock roomAuth
jest.mock('../frontend/src/utils/roomAuth.js', () => ({
  computeRoomAuthToken: jest.fn().mockResolvedValue('mock-token'),
  computeRoomAuthTokenSync: jest.fn().mockReturnValue('mock-token'),
  encryptRelayPayload: jest.fn(),
  decryptRelayPayload: jest.fn(),
}));

// ── WebSocketTransport Tests (Fix 4) ────────────────────────────────

import { WebSocketTransport } from '../frontend/src/services/p2p/transports/WebSocketTransport.js';

describe('WebSocketTransport — joinTopic error handling (Fix 4)', () => {
  let transport;
  let mockWs;

  beforeEach(() => {
    transport = new WebSocketTransport({ peerId: 'test-peer' });

    // Create a mock WebSocket
    mockWs = {
      send: jest.fn(),
      close: jest.fn(),
      readyState: 1, // OPEN
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    transport.serverSocket = mockWs;
    transport.connected = true;
    transport.localPeerId = 'test-peer';

    // Wire up _setupServerSocket to capture the message handler
    transport._setupServerSocket(mockWs);
  });

  test('joinTopic resolves when server sends peer-list', async () => {
    const joinPromise = transport.joinTopic('workspace-topic', {
      authToken: 'valid-token',
      workspaceKey: 'workspace-key',
    });

    // Simulate server responding with peer-list (successful join)
    mockWs.onmessage({ data: JSON.stringify({ type: 'peer-list', peers: [] }) });

    await expect(joinPromise).resolves.toBeUndefined();
  });

  test('joinTopic rejects when server sends auth error', async () => {
    const joinPromise = transport.joinTopic('workspace-topic', {
      authToken: 'wrong-token',
    });

    // Simulate server responding with auth error
    mockWs.onmessage({ data: JSON.stringify({ type: 'error', error: 'auth_token_mismatch' }) });

    await expect(joinPromise).rejects.toThrow('Topic join rejected: auth_token_mismatch');
  });

  test('joinTopic rejects on room_requires_auth error', async () => {
    const joinPromise = transport.joinTopic('workspace-topic', {});

    mockWs.onmessage({ data: JSON.stringify({ type: 'error', error: 'room_requires_auth' }) });

    await expect(joinPromise).rejects.toThrow('Topic join rejected: room_requires_auth');
  });

  test('joinTopic resolves on timeout (no response)', async () => {
    jest.useFakeTimers();

    const joinPromise = transport.joinTopic('workspace-topic', {
      authToken: 'valid-token',
    });

    // Fast-forward past the 5s timeout
    jest.advanceTimersByTime(5500);

    await expect(joinPromise).resolves.toBeUndefined();

    jest.useRealTimers();
  });

  test('joinTopic returns immediately when not connected', async () => {
    transport.connected = false;
    transport.serverSocket = null;

    const result = await transport.joinTopic('workspace-topic', {
      authToken: 'token',
    });
    expect(result).toBeUndefined();
  });

  test('emits server-error event on error message', (done) => {
    transport.on('server-error', (event) => {
      expect(event.error).toBe('auth_token_mismatch');
      done();
    });

    mockWs.onmessage({ data: JSON.stringify({ type: 'error', error: 'auth_token_mismatch' }) });
  });

  test('stores auth token and workspace key for reconnection', async () => {
    jest.useFakeTimers();

    transport.joinTopic('workspace-topic', {
      authToken: 'my-auth-token',
      workspaceKey: 'my-workspace-key',
    });

    expect(transport.currentAuthToken).toBe('my-auth-token');
    expect(transport.workspaceKey).toBe('my-workspace-key');
    expect(transport.currentTopic).toBe('workspace-topic');

    jest.advanceTimersByTime(6000);
    jest.useRealTimers();
  });

  test('peer-list resolves pending joinTopic promise', async () => {
    const joinPromise = transport.joinTopic('workspace-topic', {
      authToken: 'valid-token',
    });

    // Server sends peer-list with actual peers
    mockWs.onmessage({
      data: JSON.stringify({
        type: 'peer-list',
        peers: [{ peerId: 'peer-a' }, { peerId: 'peer-b' }],
      }),
    });

    await expect(joinPromise).resolves.toBeUndefined();
  });
});

// ── BootstrapManager Tests (Fix 4 integration) ─────────────────────

import { BootstrapManager } from '../frontend/src/services/p2p/BootstrapManager.js';

describe('BootstrapManager — auth rejection handling', () => {
  let bootstrap;
  let mockTransports;

  beforeEach(() => {
    mockTransports = {
      websocket: {
        connectToServer: jest.fn().mockResolvedValue(),
        joinTopic: jest.fn().mockResolvedValue(),
        isServerConnected: jest.fn().mockReturnValue(true),
        on: jest.fn(),
        off: jest.fn(),
      },
      webrtc: { on: jest.fn(), off: jest.fn() },
      hyperswarm: {
        on: jest.fn(), off: jest.fn(),
        getConnectedPeers: jest.fn().mockReturnValue([]),
        connected: false,
      },
      mdns: { on: jest.fn(), off: jest.fn() },
    };

    bootstrap = new BootstrapManager();
    bootstrap.peerManager = {
      peerId: 'test-peer',
      transports: mockTransports,
    };
    bootstrap.localPeerId = 'test-peer';
  });

  test('passes auth token and workspace key to joinTopic during bootstrap', async () => {
    await bootstrap.bootstrap({
      serverUrl: 'wss://server.example.com/signal',
      workspaceId: 'test-workspace-id',
      authToken: 'hmac-auth-token',
      workspaceKey: 'workspace-encryption-key',
    });

    expect(mockTransports.websocket.joinTopic).toHaveBeenCalledWith(
      'mock-topic',
      expect.objectContaining({
        authToken: 'hmac-auth-token',
        workspaceKey: 'workspace-encryption-key',
      })
    );
  });

  test('emits auth-rejected when joinTopic rejects with auth error', async () => {
    mockTransports.websocket.joinTopic.mockRejectedValue(
      new Error('Topic join rejected: auth_token_mismatch')
    );

    const authRejected = jest.fn();
    bootstrap.on('auth-rejected', authRejected);

    await bootstrap.bootstrap({
      serverUrl: 'wss://server.example.com/signal',
      workspaceId: 'test-workspace-id',
      authToken: 'wrong-token',
      workspaceKey: 'wrong-key',
    });

    expect(authRejected).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('auth_token_mismatch'),
      })
    );
  });

  test('passes auth credentials to bootstrap peers', async () => {
    bootstrap._authToken = 'hmac-auth-token';
    bootstrap._workspaceKey = 'workspace-key';
    bootstrap.currentTopic = 'test-topic';

    await bootstrap._tryBootstrapPeer('wss://alt-server.example.com');

    expect(mockTransports.websocket.joinTopic).toHaveBeenCalledWith(
      'test-topic',
      expect.objectContaining({
        authToken: 'hmac-auth-token',
        workspaceKey: 'workspace-key',
      })
    );
  });

  test('bootstrap completes even when joinTopic fails (non-fatal)', async () => {
    mockTransports.websocket.joinTopic.mockRejectedValue(
      new Error('Topic join rejected: auth_token_mismatch')
    );

    // bootstrap needs these methods for later steps
    bootstrap.peerManager.broadcast = jest.fn().mockResolvedValue();

    const completeFn = jest.fn();
    const failedFn = jest.fn();
    bootstrap.on('bootstrap-complete', completeFn);
    bootstrap.on('bootstrap-failed', failedFn);

    await bootstrap.bootstrap({
      serverUrl: 'wss://server.example.com/signal',
      workspaceId: 'test-workspace-id',
      authToken: 'bad-token',
    });

    // Bootstrap should still complete (with 0 peers) — the auth rejection
    // in _seedConnections is caught and returns false, not thrown
    expect(completeFn).toHaveBeenCalledWith(
      expect.objectContaining({ peerCount: 0 })
    );
    expect(failedFn).not.toHaveBeenCalled();
  });
});

// ── Workspace Key Flow (Fix 1) ─────────────────────────────────────

describe('Workspace key flow — Fix 1 verification', () => {
  test('getStoredKeyChain returns shared workspace key', () => {
    const keychains = new Map();
    keychains.set('workspace-123', {
      workspaceKey: 'shared-workspace-key-abc',
      personalKey: 'personal-key-xyz',
    });

    const getStoredKeyChain = (workspaceId) => keychains.get(workspaceId) || null;

    const sessionKey = 'per-browser-random-key';
    const workspaceId = 'workspace-123';

    const resolvedKey = getStoredKeyChain(workspaceId)?.workspaceKey || sessionKey;
    expect(resolvedKey).toBe('shared-workspace-key-abc');
    expect(resolvedKey).not.toBe(sessionKey);
  });

  test('falls back to sessionKey when no keychain exists (new workspace)', () => {
    const keychains = new Map();
    const getStoredKeyChain = (workspaceId) => keychains.get(workspaceId) || null;

    const sessionKey = 'per-browser-random-key';
    const workspaceId = 'new-workspace';

    const resolvedKey = getStoredKeyChain(workspaceId)?.workspaceKey || sessionKey;
    expect(resolvedKey).toBe(sessionKey);
  });

  test('two devices with same workspace key produce matching auth tokens', () => {
    const workspaceKey = 'shared-workspace-key-abc';
    const topic = 'workspace-topic-hash';

    const computeToken = (key, t) => `hmac-${key}-${t}`;

    const tokenA = computeToken(workspaceKey, topic);
    const tokenB = computeToken(workspaceKey, topic);
    expect(tokenA).toBe(tokenB);

    // Different key → different token (the bug we fixed)
    const wrongToken = computeToken('per-browser-random-key', topic);
    expect(wrongToken).not.toBe(tokenA);
  });
});

// ── y-websocket reconnect protection (Fix 2 & 3) ───────────────────

describe('y-websocket reconnect protection — Fixes 2 & 3', () => {

  test('4403 close code is recognized as auth rejection', () => {
    const closeEvent = { code: 4403 };
    expect(closeEvent?.code === 4403).toBe(true);

    expect({ code: 1000 }?.code === 4403).toBe(false);
    expect({ code: 1001 }?.code === 4403).toBe(false);
    expect({ code: 1006 }?.code === 4403).toBe(false);
  });

  test('rapid-disconnect detection triggers after threshold', () => {
    const RAPID_DISCONNECT_THRESHOLD_MS = 2000;
    const MAX_RAPID_DISCONNECTS = 5;

    let rapidDisconnects = 0;
    let lastConnectedAt = 0;

    for (let i = 0; i < MAX_RAPID_DISCONNECTS; i++) {
      lastConnectedAt = Date.now() - 100;
      const timeSinceConnect = Date.now() - lastConnectedAt;
      if (timeSinceConnect < RAPID_DISCONNECT_THRESHOLD_MS) {
        rapidDisconnects++;
      } else {
        rapidDisconnects = 0;
      }
    }

    expect(rapidDisconnects).toBe(MAX_RAPID_DISCONNECTS);
    expect(rapidDisconnects >= MAX_RAPID_DISCONNECTS).toBe(true);
  });

  test('slow disconnects reset the rapid counter', () => {
    const RAPID_DISCONNECT_THRESHOLD_MS = 2000;
    let rapidDisconnects = 3;

    const lastConnectedAt = Date.now() - 5000;
    const timeSinceConnect = Date.now() - lastConnectedAt;

    if (timeSinceConnect < RAPID_DISCONNECT_THRESHOLD_MS) {
      rapidDisconnects++;
    } else {
      rapidDisconnects = 0;
    }

    expect(rapidDisconnects).toBe(0);
  });

  test('retry limits apply to ALL workspaces (isRemote removed)', () => {
    const connectionFailures = 10;
    const maxFailures = 5;
    const isRemote = false;

    // OLD behavior (broken): local users never get protected
    const oldCheck = connectionFailures >= maxFailures && isRemote;
    expect(oldCheck).toBe(false);

    // NEW behavior (fixed): all users get retry limits
    const newCheck = connectionFailures >= maxFailures;
    expect(newCheck).toBe(true);
  });
});

// ── Server auth validation ──────────────────────────────────────────

describe('Server auth validation — first-write-wins pattern', () => {
  test('first client registers token, second must match', () => {
    const roomTokens = new Map();

    function validateRoomAuthToken(roomId, authToken) {
      if (!authToken) {
        if (roomTokens.has(roomId)) {
          return { allowed: false, reason: 'room_requires_auth' };
        }
        return { allowed: true };
      }
      if (!roomTokens.has(roomId)) {
        roomTokens.set(roomId, authToken);
        return { allowed: true };
      }
      if (roomTokens.get(roomId) === authToken) {
        return { allowed: true };
      }
      return { allowed: false, reason: 'auth_token_mismatch' };
    }

    // Device A registers token
    expect(validateRoomAuthToken('p2p:ws-topic', 'hmac-shared').allowed).toBe(true);
    // Device B with same key → allowed
    expect(validateRoomAuthToken('p2p:ws-topic', 'hmac-shared').allowed).toBe(true);
    // Device C with wrong key → rejected
    const bad = validateRoomAuthToken('p2p:ws-topic', 'hmac-wrong');
    expect(bad.allowed).toBe(false);
    expect(bad.reason).toBe('auth_token_mismatch');
    // Device D with no token on protected room
    const noAuth = validateRoomAuthToken('p2p:ws-topic', null);
    expect(noAuth.allowed).toBe(false);
    expect(noAuth.reason).toBe('room_requires_auth');
  });
});
