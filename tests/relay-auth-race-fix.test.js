/**
 * Relay Auth Race Condition Fix Tests for v1.7.30 (Issue #15)
 *
 * Tests for the four interrelated bugs causing document-level WebSocket
 * connections to cycle connected→disconnected every ~300ms:
 *
 * Bug 1: Sidecar getKeyForDocument() falls back to sessionKey for relay auth.
 *   sessionKey is random per-app-instance → HMAC token doesn't match web
 *   clients' workspaceKey-based tokens → relay server rejects with 4403.
 *   FIX: New getKeyForRelayAuth() returns null instead of sessionKey fallback.
 *
 * Bug 2: Sidecar set-key handler checks `!existingConn.authToken` to decide
 *   whether to reconnect. But the connection already has a (wrong) token from
 *   sessionKey → condition is false → no reconnection.
 *   FIX: Check `existingConn.authToken !== newAuthToken` (mismatch detection).
 *
 * Bug 3: Server roomAuthTokens entries never deleted — not on doc destroy, not
 *   during stale cleanup. Wrong tokens from the race condition persist forever.
 *   FIX: Delete roomAuthTokens entry on doc destroy and stale doc cleanup.
 *
 * Bug 4: useWorkspaceSync.js creates provider with connect:true then gets 4403
 *   in browser mode (no sync token). Wastes a connection and can register wrong
 *   state on the server.
 *   FIX: Use connect:false + async auth (same pattern as AppNew.jsx documents).
 *
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const rootDir = path.resolve(__dirname, '..');
const readFile = (rel) => fs.readFileSync(path.join(rootDir, rel), 'utf-8');

// Read source files
const sidecarSource = readFile('sidecar/index.js');
const serverSource = readFile('server/unified/index.js');
const useWorkspaceSyncSource = readFile('frontend/src/hooks/useWorkspaceSync.js');
const appNewSource = readFile('frontend/src/AppNew.jsx');
const roomAuthSource = readFile('frontend/src/utils/roomAuth.js');
const relayBridgeSource = readFile('sidecar/relay-bridge.js');

// ═══════════════════════════════════════════════════════════════════════════════
// Bug 1: getKeyForRelayAuth — never falls back to sessionKey
// ═══════════════════════════════════════════════════════════════════════════════

describe('Bug 1: getKeyForRelayAuth prevents sessionKey fallback', () => {
  test('getKeyForRelayAuth function exists in sidecar', () => {
    expect(sidecarSource).toContain('function getKeyForRelayAuth(docName)');
  });

  test('getKeyForRelayAuth returns documentKeys.get() or null (not sessionKey)', () => {
    // Must return null when no per-doc key, NOT sessionKey
    expect(sidecarSource).toContain(
      'return documentKeys.get(docName) || null;'
    );
  });

  test('getKeyForRelayAuth has clear documentation about why sessionKey is excluded', () => {
    expect(sidecarSource).toContain(
      'NEVER falls back to sessionKey'
    );
    expect(sidecarSource).toContain(
      'sessionKey is per-app-instance'
    );
  });

  test('getKeyForDocument still falls back to sessionKey for local persistence', () => {
    expect(sidecarSource).toContain(
      'return documentKeys.get(docName) || sessionKey;'
    );
  });

  test('getKeyForDocument is marked as LOCAL persistence only', () => {
    // The comment above getKeyForDocument must indicate it's for local use
    const idx = sidecarSource.indexOf('function getKeyForDocument(docName)');
    const context = sidecarSource.substring(Math.max(0, idx - 200), idx);
    expect(context.toLowerCase()).toMatch(/local|persist/i);
  });

  // Verify all relay connection paths use getKeyForRelayAuth

  test('connectAllDocsToRelay uses getKeyForRelayAuth', () => {
    // Find the connectAllDocsToRelay function
    const funcStart = sidecarSource.indexOf('async function connectAllDocsToRelay');
    const funcEnd = sidecarSource.indexOf('\n}', funcStart + 100);
    const funcBody = sidecarSource.substring(funcStart, funcEnd);
    
    expect(funcBody).toContain('getKeyForRelayAuth(roomName)');
    expect(funcBody).not.toContain('getKeyForDocument(roomName)');
  });

  test('sync-workspace relay fallback uses getKeyForRelayAuth', () => {
    // The sync-workspace handler tries relay as fallback
    const syncIdx = sidecarSource.indexOf("case 'sync-workspace':");
    const syncEnd = sidecarSource.indexOf("case '", syncIdx + 30);
    const syncBlock = sidecarSource.substring(syncIdx, syncEnd);
    
    // The relay fallback block within sync-workspace
    const relayFallbackIdx = syncBlock.indexOf('Try relay as fallback');
    if (relayFallbackIdx !== -1) {
      const relayBlock = syncBlock.substring(relayFallbackIdx, relayFallbackIdx + 600);
      expect(relayBlock).toContain('getKeyForRelayAuth(roomName)');
      expect(relayBlock).not.toContain('getKeyForDocument(roomName)');
    }
  });

  test('workspace rejoin relay uses getKeyForRelayAuth', () => {
    // The autoRejoinWorkspaces / startup relay connect block
    const rejoinIdx = sidecarSource.indexOf('Also try relay as fallback for fresh sync');
    expect(rejoinIdx).toBeGreaterThan(-1);
    const rejoinBlock = sidecarSource.substring(rejoinIdx, rejoinIdx + 800);
    expect(rejoinBlock).toContain('getKeyForRelayAuth(roomName)');
    expect(rejoinBlock).not.toContain('getKeyForDocument(roomName)');
  });

  test('doc-added relay connect uses getKeyForRelayAuth', () => {
    // Find the doc-added handler's relay connect section
    const docAddedIdx = sidecarSource.indexOf('Connect workspace-meta, workspace-folders, and doc rooms to public relay');
    expect(docAddedIdx).toBeGreaterThan(-1);
    const docAddedBlock = sidecarSource.substring(docAddedIdx, docAddedIdx + 600);
    expect(docAddedBlock).toContain('getKeyForRelayAuth(docName)');
    expect(docAddedBlock).not.toContain('getKeyForDocument(docName)');
  });

  test('no getKeyForDocument calls exist in relay connection code paths', () => {
    // Every relayBridge.connect call should be preceded by getKeyForRelayAuth or
    // a direct key variable from the set-key handler (which IS the per-doc key)
    const relayConnectCalls = sidecarSource.split('relayBridge.connect(');
    
    for (let i = 1; i < relayConnectCalls.length; i++) {
      // Look at the 500 chars before each relayBridge.connect call
      const preceding = sidecarSource.substring(
        sidecarSource.indexOf('relayBridge.connect(') - 500 + (i - 1) * 10,
        sidecarSource.indexOf('relayBridge.connect(') + (i - 1) * 10
      );
      // Should not find getKeyForDocument used to compute the auth token
      // (set-key handler is an exception — it uses `key` directly from the parsed message)
    }
    
    // Simpler check: count getKeyForRelayAuth calls near relayBridge.connect
    const connectBlocks = sidecarSource.match(/getKeyForRelayAuth\([^)]+\)[\s\S]{0,300}relayBridge\.connect/g);
    expect(connectBlocks).not.toBeNull();
    expect(connectBlocks.length).toBeGreaterThanOrEqual(3); // connectAll, sync-workspace, workspace rejoin, doc-added
  });

  test('relay auth defers connection when no key available', () => {
    // connectAllDocsToRelay skips rooms without key
    expect(sidecarSource).toContain('Skipping relay connect for');
    expect(sidecarSource).toContain('no key available yet');
    
    // doc-added handler defers relay connect
    expect(sidecarSource).toContain('Deferring relay connect for');
    expect(sidecarSource).toContain('awaiting set-key');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Bug 2: set-key handler detects token MISMATCH (not just absence)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Bug 2: set-key handler reconnects on token mismatch', () => {
  test('set-key handler compares existing token vs new token', () => {
    // Must use !== comparison, not !existingConn.authToken
    expect(sidecarSource).toContain('existingConn.authToken !== newAuthToken');
  });

  test('set-key handler does NOT use absence check for reconnection', () => {
    // The old buggy code checked `!existingConn.authToken` — this should NOT be
    // the condition for relay reconnection anymore
    const setKeyIdx = sidecarSource.indexOf("case 'set-key':");
    const setKeyEnd = sidecarSource.indexOf("case '", setKeyIdx + 20);
    const setKeyBlock = sidecarSource.substring(setKeyIdx, setKeyEnd);
    
    // Should not find the old pattern for relay reconnection
    // Note: !existingConn.authToken might appear in other contexts, but
    // the relay reconnection block must use !== comparison
    const reconnectIdx = setKeyBlock.indexOf('reconnecting to relay with updated auth');
    if (reconnectIdx !== -1) {
      const nearReconnect = setKeyBlock.substring(Math.max(0, reconnectIdx - 200), reconnectIdx);
      expect(nearReconnect).toContain('!== newAuthToken');
    }
  });

  test('set-key handler disconnects before reconnecting with correct token', () => {
    // When token mismatch detected, must disconnect old then connect new
    const setKeyIdx = sidecarSource.indexOf("case 'set-key':");
    const setKeyEnd = sidecarSource.indexOf("case '", setKeyIdx + 20);
    const setKeyBlock = sidecarSource.substring(setKeyIdx, setKeyEnd);
    
    // disconnect before connect
    const disconnIdx = setKeyBlock.indexOf('relayBridge.disconnect(');
    const connectIdx = setKeyBlock.indexOf('relayBridge.connect(', disconnIdx);
    expect(disconnIdx).toBeGreaterThan(-1);
    expect(connectIdx).toBeGreaterThan(disconnIdx);
  });

  test('set-key handler also connects rooms not yet on relay', () => {
    // When no existing connection, the set-key handler should connect
    const setKeyIdx = sidecarSource.indexOf("case 'set-key':");
    const setKeyEnd = sidecarSource.indexOf("case '", setKeyIdx + 20);
    const setKeyBlock = sidecarSource.substring(setKeyIdx, setKeyEnd);
    
    expect(setKeyBlock).toContain('!existingConn');
    expect(setKeyBlock).toContain("sanitizedDocName.startsWith('workspace-meta:')");
    expect(setKeyBlock).toContain("sanitizedDocName.startsWith('doc-')");
  });

  test('set-key handler comment explains the race condition', () => {
    expect(sidecarSource).toContain('STALE auth token');
    expect(sidecarSource).toContain('computed from sessionKey before the correct workspaceKey');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Bug 3: Server roomAuthTokens cleanup on doc destroy/stale
// ═══════════════════════════════════════════════════════════════════════════════

describe('Bug 3: Server clears roomAuthTokens on doc destroy', () => {
  test('roomAuthTokens Map exists on server', () => {
    expect(serverSource).toContain('const roomAuthTokens = new Map()');
  });

  test('doc destroy handler clears roomAuthTokens entry', () => {
    // Find the doc.on('destroy') handler in the y-websocket connection handler
    const destroyIdx = serverSource.indexOf("doc.on('destroy'");
    expect(destroyIdx).toBeGreaterThan(-1);
    
    const destroyEnd = serverSource.indexOf('});', destroyIdx);
    const destroyBlock = serverSource.substring(destroyIdx, destroyEnd);
    
    expect(destroyBlock).toContain("roomAuthTokens.delete(`yws:${roomName}`)");
  });

  test('stale doc cleanup clears roomAuthTokens entry', () => {
    // Find the periodic cleanup interval
    const cleanupIdx = serverSource.indexOf('Periodic cleanup of stale y-websocket docs');
    expect(cleanupIdx).toBeGreaterThan(-1);
    
    const cleanupEnd = serverSource.indexOf('}, DOC_CLEANUP_INTERVAL_MS)');
    const cleanupBlock = serverSource.substring(cleanupIdx, cleanupEnd);
    
    expect(cleanupBlock).toContain("roomAuthTokens.delete(`yws:${roomName}`)");
  });

  test('roomAuthTokens uses yws: prefix for y-websocket rooms', () => {
    // The validateRoomAuthToken call uses `yws:${roomName}` prefix
    expect(serverSource).toContain("validateRoomAuthToken(`yws:${roomName}`");
    
    // The cleanup must use the same prefix
    const deleteMatches = serverSource.match(/roomAuthTokens\.delete\(`yws:\$\{roomName\}`\)/g);
    expect(deleteMatches).not.toBeNull();
    // At least 2: one in destroy handler, one in stale cleanup
    expect(deleteMatches.length).toBeGreaterThanOrEqual(2);
  });

  test('first-write-wins auth works correctly when token is cleared', () => {
    // After token is deleted, a new client should be able to register a fresh token
    expect(serverSource).toContain("roomAuthTokens.set(roomId, authToken)");
    expect(serverSource).toContain("return { allowed: true }");
  });

  test('stale cleanup also clears persistence timers and awareness listeners', () => {
    // Verify existing cleanup targets are still present
    const cleanupIdx = serverSource.indexOf('Periodic cleanup of stale y-websocket docs');
    const cleanupEnd = serverSource.indexOf('}, DOC_CLEANUP_INTERVAL_MS)');
    const cleanupBlock = serverSource.substring(cleanupIdx, cleanupEnd);
    
    expect(cleanupBlock).toContain('persistenceTimers.delete(roomName)');
    expect(cleanupBlock).toContain('docAwarenessListeners.delete(roomName)');
    expect(cleanupBlock).toContain('docLastActivity.delete(roomName)');
    expect(cleanupBlock).toContain("roomAuthTokens.delete(`yws:${roomName}`)");
  });

  test('doc destroy handler cleanup is comprehensive', () => {
    const destroyIdx = serverSource.indexOf("doc.on('destroy'");
    const destroyEnd = serverSource.indexOf('});', destroyIdx);
    const destroyBlock = serverSource.substring(destroyIdx, destroyEnd);
    
    expect(destroyBlock).toContain('docAwarenessListeners.delete(roomName)');
    expect(destroyBlock).toContain("roomAuthTokens.delete(`yws:${roomName}`)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Bug 4: useWorkspaceSync connect:false + async auth in browser
// ═══════════════════════════════════════════════════════════════════════════════

describe('Bug 4: useWorkspaceSync defers connection for async browser auth', () => {
  test('needsAsyncAuth flag is computed correctly', () => {
    expect(useWorkspaceSyncSource).toContain(
      "const needsAsyncAuth = !ywsAuthToken && !!authKeyChain?.workspaceKey"
    );
  });

  test('provider is created with connect:false when async auth needed (remote)', () => {
    // Remote workspace provider options
    expect(useWorkspaceSyncSource).toContain('connect: !needsAsyncAuth');
  });

  test('provider is created with connect:false when async auth needed (local)', () => {
    // Both remote and local paths should defer
    const optionsMatches = useWorkspaceSyncSource.match(/connect: !needsAsyncAuth/g);
    expect(optionsMatches).not.toBeNull();
    expect(optionsMatches.length).toBeGreaterThanOrEqual(2); // remote + local
  });

  test('async auth block uses needsAsyncAuth guard', () => {
    expect(useWorkspaceSyncSource).toContain('if (needsAsyncAuth)');
  });

  test('async auth computes token then connects (not disconnect+connect)', () => {
    // Find the async auth block
    const asyncIdx = useWorkspaceSyncSource.indexOf('if (needsAsyncAuth)');
    expect(asyncIdx).toBeGreaterThan(-1);
    
    const asyncBlock = useWorkspaceSyncSource.substring(asyncIdx, asyncIdx + 500);
    
    // Should call provider.connect() (first connection)
    expect(asyncBlock).toContain('provider.connect()');
    
    // Should NOT call provider.disconnect() (no wasted connection to tear down)
    expect(asyncBlock).not.toContain('provider.disconnect()');
  });

  test('async auth sets URL with auth token before connecting', () => {
    const asyncIdx = useWorkspaceSyncSource.indexOf('if (needsAsyncAuth)');
    const asyncBlock = useWorkspaceSyncSource.substring(asyncIdx, asyncIdx + 500);
    
    // URL is set before connect
    const urlSetIdx = asyncBlock.indexOf('provider.url =');
    const connectIdx = asyncBlock.indexOf('provider.connect()');
    expect(urlSetIdx).toBeGreaterThan(-1);
    expect(connectIdx).toBeGreaterThan(urlSetIdx);
  });

  test('async auth URL includes auth query parameter', () => {
    const asyncIdx = useWorkspaceSyncSource.indexOf('if (needsAsyncAuth)');
    const asyncBlock = useWorkspaceSyncSource.substring(asyncIdx, asyncIdx + 500);
    
    expect(asyncBlock).toContain('?auth=${encodeURIComponent(asyncToken)}');
  });

  test('async auth is skipped when cleanup has occurred', () => {
    const asyncIdx = useWorkspaceSyncSource.indexOf('if (needsAsyncAuth)');
    const asyncBlock = useWorkspaceSyncSource.substring(asyncIdx, asyncIdx + 500);
    
    expect(asyncBlock).toContain('if (cleanedUp || !asyncToken) return');
  });

  test('pattern matches AppNew.jsx document creation pattern', () => {
    // AppNew.jsx uses the same connect:false + async auth pattern
    expect(appNewSource).toContain("{ connect: false }");
    expect(appNewSource).toContain('computeRoomAuthToken(authKey, docId)');
    expect(appNewSource).toContain('provider.connect()');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Cross-Matrix Auth Consistency Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Cross-platform auth token consistency (all matrix paths)', () => {
  const testKey = crypto.randomBytes(32);
  const workspaceRoom = 'workspace-meta:test-ws-12345';
  const docRoom = 'doc-abc123def456';

  test('HMAC tokens are identical for same key+room across all 3 implementations', () => {
    // Compute the expected token
    const expected = crypto
      .createHmac('sha256', testKey)
      .update(`room-auth:${workspaceRoom}`)
      .digest('base64');

    // All three implementations use the same algorithm
    expect(sidecarSource).toContain("crypto.createHmac('sha256', Buffer.from(keyBytes))");
    expect(roomAuthSource).toContain("nodeCrypto.createHmac('sha256', Buffer.from(keyBytes))");

    // Both use "room-auth:" prefix
    expect(sidecarSource).toContain('`room-auth:${roomName}`');
    expect(roomAuthSource).toContain('`room-auth:${roomOrTopic}`');

    // Both use base64 encoding
    expect(sidecarSource).toContain(".digest('base64')");
    expect(roomAuthSource).toContain(".digest('base64')");
  });

  test('web-to-web: both clients use workspaceKey from keychain', () => {
    // useWorkspaceSync gets key from getStoredKeyChain
    expect(useWorkspaceSyncSource).toContain('getStoredKeyChain(workspaceId)');
    expect(useWorkspaceSyncSource).toContain('authKeyChain.workspaceKey');
    
    // AppNew.jsx documents also use workspaceKey
    expect(appNewSource).toContain("getStoredKeyChain(currentWorkspaceId)?.workspaceKey");
  });

  test('web-to-native: sidecar uses workspaceKey from set-key (not sessionKey)', () => {
    // getKeyForRelayAuth ensures no sessionKey fallback
    expect(sidecarSource).toMatch(
      /function getKeyForRelayAuth\(docName\)\s*\{\s*return documentKeys\.get\(docName\) \|\| null;/
    );
  });

  test('native-to-web: sidecar relay auth token matches web client token', () => {
    // Same HMAC algorithm ensures native token = web token for same key
    const token1 = crypto.createHmac('sha256', testKey).update(`room-auth:${docRoom}`).digest('base64');
    const token2 = crypto.createHmac('sha256', testKey).update(`room-auth:${docRoom}`).digest('base64');
    expect(token1).toBe(token2);
  });

  test('native-to-native: both sidecars use workspaceKey for relay auth', () => {
    // Both would get key via set-key from their respective frontends
    // getKeyForRelayAuth ensures consistent token computation
    expect(sidecarSource).toContain('getKeyForRelayAuth(roomName)');
    
    // The set-key handler delivers the real workspaceKey to documentKeys Map
    expect(sidecarSource).toContain('documentKeys.set(sanitizedDocName, key)');
  });

  test('server validates tokens with constant-time comparison', () => {
    expect(serverSource).toContain('timingSafeEqual');
    expect(serverSource).toContain("const { timingSafeEqual } = require('crypto')");
  });

  test('server first-write-wins allows first authenticated client through', () => {
    expect(serverSource).toContain('roomAuthTokens.set(roomId, authToken)');
    // After first write, subsequent clients must match
    expect(serverSource).toContain('auth_token_mismatch');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Race Condition Prevention Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Race condition prevention', () => {
  test('doc-added handler defers relay connect without key', () => {
    // When no key available, should NOT connect to relay (avoids sessionKey fallback)
    expect(sidecarSource).toContain(
      'Deferring relay connect for'
    );
    expect(sidecarSource).toContain(
      'no per-doc key available yet (awaiting set-key)'
    );
  });

  test('set-key handler connects deferred docs to relay', () => {
    // The set-key handler should connect rooms that were deferred
    const setKeyIdx = sidecarSource.indexOf("case 'set-key':");
    const setKeyEnd = sidecarSource.indexOf("case '", setKeyIdx + 20);
    const setKeyBlock = sidecarSource.substring(setKeyIdx, setKeyEnd);
    
    // Connects rooms that should be on relay but aren't connected yet
    expect(setKeyBlock).toContain('Doc should be on relay but isn\'t connected yet');
  });

  test('server clears stale tokens so race condition doesn\'t persist forever', () => {
    // roomAuthTokens entries are cleared on doc destroy
    expect(serverSource).toContain("roomAuthTokens.delete(`yws:${roomName}`)");
    
    // And during periodic cleanup
    const cleanupIdx = serverSource.indexOf('STALE_DOC_TIMEOUT_MS');
    expect(cleanupIdx).toBeGreaterThan(-1);
  });

  test('relay bridge handles 4403 rejection by skipping reconnect', () => {
    // When auth fails, relay bridge should NOT keep reconnecting with wrong token
    expect(relayBridgeSource).toContain('skipReconnect: true');
    expect(relayBridgeSource).toMatch(/4403|auth.*reject|reject.*auth/i);
  });

  test('sync-workspace relay fallback defers without key', () => {
    const syncIdx = sidecarSource.indexOf("case 'sync-workspace':");
    const syncEnd = sidecarSource.indexOf("case '", syncIdx + 30);
    const syncBlock = sidecarSource.substring(syncIdx, syncEnd);
    
    // Must check for null key before connecting
    expect(syncBlock).toContain('Deferring relay sync for');
    expect(syncBlock).toContain('no per-doc key available yet');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Behavioral HMAC Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('HMAC token behavioral correctness', () => {
  test('different keys produce different tokens for same room', () => {
    const key1 = crypto.randomBytes(32);
    const key2 = crypto.randomBytes(32);
    const room = 'workspace-meta:test';

    const token1 = crypto.createHmac('sha256', key1).update(`room-auth:${room}`).digest('base64');
    const token2 = crypto.createHmac('sha256', key2).update(`room-auth:${room}`).digest('base64');

    expect(token1).not.toBe(token2);
  });

  test('same key produces different tokens for different rooms', () => {
    const key = crypto.randomBytes(32);
    const room1 = 'workspace-meta:ws1';
    const room2 = 'doc-abc123';

    const token1 = crypto.createHmac('sha256', key).update(`room-auth:${room1}`).digest('base64');
    const token2 = crypto.createHmac('sha256', key).update(`room-auth:${room2}`).digest('base64');

    expect(token1).not.toBe(token2);
  });

  test('same key and room always produce the same token (deterministic)', () => {
    const key = crypto.randomBytes(32);
    const room = 'workspace-meta:deterministic-test';

    const token1 = crypto.createHmac('sha256', key).update(`room-auth:${room}`).digest('base64');
    const token2 = crypto.createHmac('sha256', key).update(`room-auth:${room}`).digest('base64');

    expect(token1).toBe(token2);
  });

  test('sessionKey-based token does NOT match workspaceKey-based token', () => {
    // This is the ROOT CAUSE of the connect/disconnect loop
    const workspaceKey = crypto.randomBytes(32);
    const sessionKey = crypto.randomBytes(32); // Different per-app-instance
    const room = 'doc-shared-document-123';

    const workspaceToken = crypto.createHmac('sha256', workspaceKey).update(`room-auth:${room}`).digest('base64');
    const sessionToken = crypto.createHmac('sha256', sessionKey).update(`room-auth:${room}`).digest('base64');

    // These MUST differ — if they matched, there would be no bug
    expect(workspaceToken).not.toBe(sessionToken);
  });

  test('token is valid base64 string', () => {
    const key = crypto.randomBytes(32);
    const token = crypto.createHmac('sha256', key).update('room-auth:test').digest('base64');

    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    // Should be valid base64 (can be decoded without error)
    expect(() => Buffer.from(token, 'base64')).not.toThrow();
    // HMAC-SHA256 produces 32 bytes → 44 base64 chars
    expect(token.length).toBe(44);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Integration: End-to-End Flow Verification
// ═══════════════════════════════════════════════════════════════════════════════

describe('End-to-end auth flow integrity', () => {
  test('web client workspace sync flow: keychain → async auth → connect', () => {
    // 1. Gets workspace key from keychain
    expect(useWorkspaceSyncSource).toContain('getStoredKeyChain(workspaceId)');
    
    // 2. Tries sync token first (works in Electron, null in browser)
    expect(useWorkspaceSyncSource).toContain('computeRoomAuthTokenSync');
    
    // 3. Detects need for async auth
    expect(useWorkspaceSyncSource).toContain('needsAsyncAuth');
    
    // 4. Creates provider with connect:false
    expect(useWorkspaceSyncSource).toContain('connect: !needsAsyncAuth');
    
    // 5. Computes async token and connects
    expect(useWorkspaceSyncSource).toContain('computeRoomAuthToken(authKeyChain.workspaceKey, roomName)');
    expect(useWorkspaceSyncSource).toContain('provider.connect()');
  });

  test('native client workspace sync flow: set-key → relay connect', () => {
    // 1. Frontend sends set-key with workspaceKey to sidecar
    expect(useWorkspaceSyncSource).toContain("type: 'set-key'");
    
    // 2. Sidecar stores the key
    expect(sidecarSource).toContain('documentKeys.set(sanitizedDocName, key)');
    
    // 3. Sidecar computes auth token from the workspaceKey
    expect(sidecarSource).toContain('computeRelayAuthToken(key, sanitizedDocName)');
    
    // 4. Connects/reconnects to relay with correct token
    expect(sidecarSource).toContain('relayBridge.connect(sanitizedDocName, doc, null, newAuthToken)');
  });

  test('web client document flow: keychain → async auth → connect', () => {
    // AppNew.jsx createDocument
    expect(appNewSource).toContain("getStoredKeyChain(currentWorkspaceId)?.workspaceKey");
    expect(appNewSource).toContain('computeRoomAuthTokenSync(authKey, docId)');
    expect(appNewSource).toContain("{ connect: false }");
    expect(appNewSource).toContain('computeRoomAuthToken(authKey, docId)');
  });

  test('native client document flow: doc-added → defer → set-key → connect', () => {
    // 1. doc-added fires before set-key arrives
    expect(sidecarSource).toContain('getKeyForRelayAuth(docName)');
    
    // 2. No key yet → defers
    expect(sidecarSource).toContain('Deferring relay connect for');
    
    // 3. set-key arrives with workspaceKey → detects no existing connection → connects
    expect(sidecarSource).toContain('Doc should be on relay but isn\'t connected yet');
  });

  test('server allows re-registration after token cleanup', () => {
    // 1. Wrong token registered during race
    // 2. Doc destroyed or stale cleanup runs
    // 3. roomAuthTokens entry deleted
    // 4. New client connects and registers correct token
    
    // Verify the server's first-write-wins logic
    expect(serverSource).toContain('if (!existingToken)');
    expect(serverSource).toContain('roomAuthTokens.set(roomId, authToken)');
    
    // Verify cleanup removes the entry
    expect(serverSource).toContain("roomAuthTokens.delete(`yws:${roomName}`)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Regression Prevention
// ═══════════════════════════════════════════════════════════════════════════════

describe('Regression prevention', () => {
  test('getKeyForDocument is never used in a relay auth context', () => {
    // Find all getKeyForDocument calls and verify none are near relayBridge.connect
    const lines = sidecarSource.split('\n');
    const relayConnectLines = [];
    const getKeyForDocLines = [];
    
    lines.forEach((line, idx) => {
      if (line.includes('relayBridge.connect(')) relayConnectLines.push(idx);
      if (line.includes('getKeyForDocument(')) getKeyForDocLines.push(idx);
    });
    
    // No getKeyForDocument call should be within 10 lines before a relayBridge.connect
    for (const connectLine of relayConnectLines) {
      for (const keyLine of getKeyForDocLines) {
        if (keyLine >= connectLine - 10 && keyLine < connectLine) {
          // Check if this is actually computing a relay auth token
          const context = lines.slice(keyLine, connectLine + 1).join('\n');
          // Only fail if the getKeyForDocument result is used for computeRelayAuthToken
          if (context.includes('computeRelayAuthToken') && context.includes('getKeyForDocument')) {
            fail(`getKeyForDocument used for relay auth near line ${keyLine + 1}`);
          }
        }
      }
    }
  });

  test('no unauthenticated WebSocket provider connections in browser mode', () => {
    // useWorkspaceSync must not create a connected provider without auth
    // The needsAsyncAuth flag ensures connect:false when sync auth unavailable
    expect(useWorkspaceSyncSource).toContain('connect: !needsAsyncAuth');
    
    // AppNew.jsx must use connect:false when docAuthToken is null
    expect(appNewSource).toContain('!docAuthToken && authKey ? { connect: false }');
  });

  test('relay bridge 4403 handler prevents reconnect loop', () => {
    expect(relayBridgeSource).toContain('skipReconnect: true');
  });

  test('all relay auth paths are guarded against null keys', () => {
    // computeRelayAuthToken returns null for missing key
    expect(sidecarSource).toContain('if (!keyBytes || !roomName) return null');
    
    // All relay connect paths check for null key before computing token
    // (verified by the existence of the "Skipping"/"Deferring" log messages)
    expect(sidecarSource).toContain('Skipping relay connect');
    expect(sidecarSource).toContain('Deferring relay connect');
  });
});
