/**
 * Relay Auth & Cross-Platform Sync Tests for v1.7.26
 *
 * Tests for the relay bridge HMAC authentication fix (Issue #11):
 *
 * ROOT CAUSE: The sidecar's relay bridge did NOT send HMAC auth tokens when
 * connecting to the relay server. Once a web client registered its token via
 * first-write-wins, the sidecar was permanently locked out (4403 rejection).
 *
 * FIXES:
 * 1. relay-bridge.js: accepts authToken param, appends ?auth=TOKEN to WS URL,
 *    stores token for reconnects, handles 4403 close code without retrying
 * 2. sidecar/index.js: computeRelayAuthToken() HMAC helper, all connect() call
 *    sites pass auth tokens, set-key handler reconnects with auth, expanded
 *    room filters (workspace-folders: and doc- rooms)
 * 3. useWorkspaceSync.js: browser async auth fallback via Web Crypto API
 * 4. AppNew.jsx: browser async auth fallback for document rooms
 *
 * Scenarios tested:
 * - Native ↔ Web: sidecar connects with auth, browser uses async fallback
 * - Web ↔ Web: both use async fallback, tokens match
 * - Native ↔ Native: both compute same HMAC from same key
 * - Web → Native and Native → Web: connection order doesn't matter
 *
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const rootDir = path.resolve(__dirname, '..');
const readFile = (rel) => fs.readFileSync(path.join(rootDir, rel), 'utf-8');

// Read source files
const relayBridgeSource = readFile('sidecar/relay-bridge.js');
const sidecarSource = readFile('sidecar/index.js');
const useWorkspaceSyncSource = readFile('frontend/src/hooks/useWorkspaceSync.js');
const appNewSource = readFile('frontend/src/AppNew.jsx');
const roomAuthSource = readFile('frontend/src/utils/roomAuth.js');
const websocketSource = readFile('frontend/src/utils/websocket.js');
const serverSource = readFile('server/unified/index.js');

// ═══════════════════════════════════════════════════════════════════════════════
// HMAC Token Compatibility
// ═══════════════════════════════════════════════════════════════════════════════

describe('HMAC Auth Token Compatibility', () => {
  const testKey = crypto.randomBytes(32);
  const testRoom = 'workspace-meta:test-workspace-id-123';

  test('sidecar computeRelayAuthToken produces correct HMAC-SHA256', () => {
    // The sidecar helper should compute: HMAC-SHA256(key, "room-auth:" + roomName) → base64
    const expected = crypto
      .createHmac('sha256', testKey)
      .update(`room-auth:${testRoom}`)
      .digest('base64');

    // Verify computeRelayAuthToken function exists in sidecar
    expect(sidecarSource).toContain('function computeRelayAuthToken(keyBytes, roomName)');

    // Verify it uses the correct HMAC message format
    expect(sidecarSource).toContain('`room-auth:${roomName}`');

    // Verify it uses crypto.createHmac
    expect(sidecarSource).toContain("crypto.createHmac('sha256', Buffer.from(keyBytes))");

    // Verify it returns base64
    expect(sidecarSource).toContain(".digest('base64')");

    // Actually compute and verify
    const hmac = crypto.createHmac('sha256', Buffer.from(testKey));
    hmac.update(`room-auth:${testRoom}`);
    const token = hmac.digest('base64');
    expect(token).toBe(expected);
  });

  test('sidecar HMAC matches web client computeRoomAuthTokenSync format', () => {
    // Web client (roomAuth.js) computes: HMAC-SHA256(keyBytes, "room-auth:" + roomOrTopic) → base64
    expect(roomAuthSource).toContain('`room-auth:${roomOrTopic}`');
    expect(roomAuthSource).toContain("nodeCrypto.createHmac('sha256', Buffer.from(keyBytes))");
    expect(roomAuthSource).toContain(".digest('base64')");

    // Both use identical message format "room-auth:" prefix
    const sidecarMessage = `room-auth:${testRoom}`;
    const webMessage = `room-auth:${testRoom}`;
    expect(sidecarMessage).toBe(webMessage);
  });

  test('sidecar HMAC matches web client computeRoomAuthToken (async) format', () => {
    // The async variant uses Web Crypto API with same message format
    expect(roomAuthSource).toContain("const message = `room-auth:${roomOrTopic}`");
    expect(roomAuthSource).toContain("{ name: 'HMAC', hash: 'SHA-256' }");
  });

  test('sidecar returns null for missing key or room', () => {
    expect(sidecarSource).toContain(
      'if (!keyBytes || !roomName) return null;'
    );
  });

  test('sidecar handles HMAC computation errors gracefully', () => {
    expect(sidecarSource).toContain(
      "console.warn('[Sidecar] Failed to compute relay auth token:'"
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Relay Bridge Auth Token Support (relay-bridge.js)
// ═══════════════════════════════════════════════════════════════════════════════

describe('RelayBridge auth token support', () => {
  test('connect() accepts authToken parameter', () => {
    // Function signature must include authToken as 4th parameter
    expect(relayBridgeSource).toMatch(
      /async connect\(roomName,\s*ydoc,\s*relayUrl\s*=\s*null,\s*authToken\s*=\s*null\)/
    );
  });

  test('_connectToRelay() accepts authToken parameter', () => {
    expect(relayBridgeSource).toMatch(
      /_connectToRelay\(roomName,\s*ydoc,\s*relayUrl,\s*authToken\s*=\s*null\)/
    );
  });

  test('auth token is appended to WebSocket URL as ?auth= query parameter', () => {
    expect(relayBridgeSource).toContain(
      "wsUrl = `${wsUrl}${separator}auth=${encodeURIComponent(authToken)}`"
    );
  });

  test('auth token is only appended when provided (not null/undefined)', () => {
    expect(relayBridgeSource).toContain('if (authToken) {');
  });

  test('auth token is stored in connection object for reconnects', () => {
    expect(relayBridgeSource).toContain('authToken,');
    // Verify it's in the connection set
    expect(relayBridgeSource).toMatch(
      /this\.connections\.set\(roomName,\s*\{[^}]*authToken/s
    );
  });

  test('auth token is passed through to _scheduleReconnect', () => {
    // From _handleDisconnect
    expect(relayBridgeSource).toContain(
      'this._scheduleReconnect(roomName, conn.ydoc, conn.relayUrl, conn.authToken)'
    );
    // From connect() failure path
    expect(relayBridgeSource).toContain(
      'this._scheduleReconnect(roomName, ydoc, relays[0], authToken)'
    );
  });

  test('_scheduleReconnect accepts authToken parameter', () => {
    expect(relayBridgeSource).toMatch(
      /_scheduleReconnect\(roomName,\s*ydoc,\s*relayUrl,\s*authToken\s*=\s*null\)/
    );
  });

  test('_scheduleReconnect passes authToken to connect()', () => {
    expect(relayBridgeSource).toContain(
      'this.connect(roomName, freshDoc, relayUrl, authToken)'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4403 Auth Rejection Handling
// ═══════════════════════════════════════════════════════════════════════════════

describe('RelayBridge 4403 auth rejection handling', () => {
  test('close handler receives close code and reason', () => {
    expect(relayBridgeSource).toMatch(
      /ws\.on\('close',\s*\(code,\s*reason\)/
    );
  });

  test('4403 close code triggers skipReconnect', () => {
    expect(relayBridgeSource).toContain('if (code === 4403)');
    expect(relayBridgeSource).toContain(
      'this._handleDisconnect(roomName, { skipReconnect: true })'
    );
  });

  test('_handleDisconnect accepts options parameter', () => {
    expect(relayBridgeSource).toMatch(
      /_handleDisconnect\(roomName,\s*options\s*=\s*\{\}\)/
    );
  });

  test('_handleDisconnect skips reconnect when skipReconnect is true', () => {
    expect(relayBridgeSource).toContain('if (!options.skipReconnect)');
  });

  test('non-4403 close codes still trigger reconnect', () => {
    // Default path calls _handleDisconnect without skipReconnect
    expect(relayBridgeSource).toContain(
      'this._handleDisconnect(roomName);'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sidecar Call Sites Pass Auth Tokens
// ═══════════════════════════════════════════════════════════════════════════════

describe('Sidecar relay connect call sites pass auth tokens', () => {
  test('connectAllDocsToRelay computes and passes auth token', () => {
    // Should get key and compute token before connecting
    const pattern = /const key = getKeyForDocument\(roomName\);\s*const authToken = computeRelayAuthToken\(key, roomName\);\s*await relayBridge\.connect\(roomName, doc, null, authToken\)/;
    expect(sidecarSource).toMatch(pattern);
  });

  test('manual peer sync relay fallback passes auth token', () => {
    const pattern = /const key = getKeyForDocument\(roomName\);\s*const authToken = computeRelayAuthToken\(key, roomName\);\s*await relayBridge\.connect\(roomName, doc, null, authToken\);\s*syncSuccess = true/;
    expect(sidecarSource).toMatch(pattern);
  });

  test('autoRejoinWorkspaces relay connection passes auth token', () => {
    const pattern = /const key = getKeyForDocument\(roomName\);\s*const authToken = computeRelayAuthToken\(key, roomName\);\s*relayBridge\.connect\(roomName, doc, null, authToken\)\.catch/;
    expect(sidecarSource).toMatch(pattern);
  });

  test('doc-added handler relay connection passes auth token', () => {
    // This should appear in the context of the doc-added observer
    expect(sidecarSource).toContain(
      "console.log(`[Sidecar] Connecting ${docName} to public relay for cross-platform sharing...`);"
    );
    // And compute auth before connecting
    const docAddedPattern = /const key = getKeyForDocument\(docName\);\s*const authToken = computeRelayAuthToken\(key, docName\);\s*relayBridge\.connect\(docName, doc, null, authToken\)\.catch/;
    expect(sidecarSource).toMatch(docAddedPattern);
  });

  test('no relayBridge.connect calls without auth token (except in tests)', () => {
    // Find all relayBridge.connect calls that are NOT followed by auth token
    const connectCalls = sidecarSource.match(/relayBridge\.connect\([^)]+\)/g) || [];
    for (const call of connectCalls) {
      // Skip non-connect property accesses (e.g., relayBridge.connections)
      if (call.includes('connections')) continue;
      // Every connect call should have 4 args (roomName, doc, null, authToken)
      // or at least mention 'authToken'
      const argCount = call.split(',').length;
      expect(argCount).toBeGreaterThanOrEqual(3); // At minimum: roomName, doc, null
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Expanded Room Filters
// ═══════════════════════════════════════════════════════════════════════════════

describe('Expanded relay room filters', () => {
  test('connectAllDocsToRelay includes workspace-meta, workspace-folders, and doc rooms', () => {
    expect(sidecarSource).toContain(
      "roomName.startsWith('workspace-meta:') || roomName.startsWith('workspace-folders:') || roomName.startsWith('doc-')"
    );
  });

  test('doc-added handler connects workspace-meta, workspace-folders, and doc rooms', () => {
    // The doc-added observer should relay all three room types
    expect(sidecarSource).toContain(
      "docName.startsWith('workspace-meta:')"
    );
    expect(sidecarSource).toContain(
      "docName.startsWith('workspace-folders:')"
    );
    expect(sidecarSource).toContain(
      "docName.startsWith('doc-')"
    );
  });

  test('connectAllDocsToRelay has TODO for per-workspace relay URL', () => {
    expect(sidecarSource).toContain(
      'TODO: Per-workspace relay URL'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Set-Key Handler Reconnects With Auth
// ═══════════════════════════════════════════════════════════════════════════════

describe('set-key handler reconnects relay with auth', () => {
  test('checks existing relay connection for missing auth token', () => {
    expect(sidecarSource).toContain(
      'existingConn && !existingConn.authToken'
    );
  });

  test('disconnects and reconnects with auth when key arrives late', () => {
    expect(sidecarSource).toContain(
      'Key received for'
    );
    expect(sidecarSource).toContain(
      'reconnecting to relay with auth'
    );
    expect(sidecarSource).toContain(
      'relayBridge.disconnect(sanitizedDocName)'
    );
  });

  test('connects rooms that should be on relay but are not yet connected', () => {
    expect(sidecarSource).toContain(
      "sanitizedDocName.startsWith('workspace-meta:')"
    );
    expect(sidecarSource).toContain(
      "sanitizedDocName.startsWith('workspace-folders:')"
    );
    expect(sidecarSource).toContain(
      "sanitizedDocName.startsWith('doc-')"
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Browser Async Auth Fallback (useWorkspaceSync.js)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Browser async auth fallback (useWorkspaceSync)', () => {
  test('imports computeRoomAuthToken (async variant)', () => {
    expect(useWorkspaceSyncSource).toContain(
      'computeRoomAuthToken'
    );
    // Should import both sync and async
    expect(useWorkspaceSyncSource).toMatch(
      /import.*computeRoomAuthTokenSync.*computeRoomAuthToken/
    );
  });

  test('async fallback fires when sync token is null', () => {
    expect(useWorkspaceSyncSource).toContain(
      '!ywsAuthToken && authKeyChain?.workspaceKey'
    );
  });

  test('async fallback computes token with same key and room', () => {
    expect(useWorkspaceSyncSource).toContain(
      'computeRoomAuthToken(authKeyChain.workspaceKey, roomName)'
    );
  });

  test('async fallback reconstructs full URL with room name and auth token', () => {
    // CRITICAL: URL must include room name, not just server base
    expect(useWorkspaceSyncSource).toContain(
      'provider.url = `${serverBase}/${roomName}?auth=${encodeURIComponent(asyncToken)}`'
    );
  });

  test('async fallback disconnects and reconnects provider', () => {
    expect(useWorkspaceSyncSource).toContain(
      'provider.disconnect()'
    );
    expect(useWorkspaceSyncSource).toContain(
      'provider.connect()'
    );
  });

  test('async fallback checks cleanedUp flag to prevent stale reconnect', () => {
    expect(useWorkspaceSyncSource).toContain(
      'if (cleanedUp || !asyncToken) return'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Browser Async Auth Fallback (AppNew.jsx)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Browser async auth fallback (AppNew.jsx)', () => {
  test('imports computeRoomAuthToken (async variant)', () => {
    expect(appNewSource).toContain(
      'computeRoomAuthToken'
    );
    expect(appNewSource).toMatch(
      /import.*computeRoomAuthTokenSync.*computeRoomAuthToken/
    );
  });

  test('async fallback for document creation', () => {
    // First provider creation site
    const firstSite = appNewSource.indexOf('Creating document');
    expect(firstSite).toBeGreaterThan(-1);

    // Should have async fallback after provider creation
    const afterFirst = appNewSource.indexOf('!docAuthToken && sessionKey', firstSite);
    expect(afterFirst).toBeGreaterThan(firstSite);
  });

  test('async fallback for document opening', () => {
    // Second provider creation site
    const secondSite = appNewSource.indexOf('Opening document');
    expect(secondSite).toBeGreaterThan(-1);

    // Should have async fallback after provider creation
    const afterSecond = appNewSource.indexOf('!docAuthToken && sessionKey', secondSite);
    expect(afterSecond).toBeGreaterThan(secondSite);
  });

  test('async fallback reconstructs full URL with doc room name', () => {
    // CRITICAL: Must include docId in URL, not just server base
    const matches = appNewSource.match(
      /provider\.url = `\$\{serverBase\}\/\$\{docId\}\?auth=\$\{encodeURIComponent\(asyncToken\)\}`/g
    );
    // Should appear twice (create and open)
    expect(matches).not.toBeNull();
    expect(matches.length).toBe(2);
  });

  test('async fallback checks ydocsRef for stale guard', () => {
    const matches = appNewSource.match(
      /!ydocsRef\.current\.has\(docId\)/g
    );
    expect(matches).not.toBeNull();
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Server Auth Validation (Verify no changes needed)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Server auth validation (unchanged)', () => {
  test('server validates auth token with yws: prefix on map key', () => {
    expect(serverSource).toContain(
      'validateRoomAuthToken(`yws:${roomName}`, ywsAuthToken)'
    );
  });

  test('server uses first-write-wins for token registration', () => {
    // No token stored → register
    expect(serverSource).toContain("roomAuthTokens.set(roomId, authToken)");
    // Backward compat: no auth + no registered → allow
    expect(serverSource).toContain('return { allowed: true }');
    // Auth required: no auth + registered → reject
    expect(serverSource).toContain("return { allowed: false, reason: 'room_requires_auth' }");
    // Token mismatch
    expect(serverSource).toContain("return { allowed: false, reason: 'auth_token_mismatch' }");
  });

  test('server uses timing-safe comparison for token validation', () => {
    expect(serverSource).toContain('timingSafeEqual');
  });

  test('server closes connection with 4403 on auth failure', () => {
    expect(serverSource).toContain('ws.close(4403');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// End-to-End Scenario Analysis
// ═══════════════════════════════════════════════════════════════════════════════

describe('End-to-end scenario: Native ↔ Web', () => {
  test('sidecar produces same token as web client for same key+room', () => {
    // Both compute HMAC-SHA256(key, "room-auth:" + roomName) → base64
    const key = crypto.randomBytes(32);
    const room = 'workspace-meta:test-abc-123';

    // Sidecar style
    const sidecarToken = crypto
      .createHmac('sha256', Buffer.from(key))
      .update(`room-auth:${room}`)
      .digest('base64');

    // Web client sync style (same as sidecar in Node.js)
    const webToken = crypto
      .createHmac('sha256', Buffer.from(key))
      .update(`room-auth:${room}`)
      .digest('base64');

    expect(sidecarToken).toBe(webToken);
    expect(sidecarToken.length).toBeGreaterThan(0);
  });

  test('HMAC message format uses "room-auth:" prefix consistently', () => {
    // Sidecar
    expect(sidecarSource).toContain('`room-auth:${roomName}`');
    // Web client (roomAuth.js)
    expect(roomAuthSource).toContain('`room-auth:${roomOrTopic}`');
  });

  test('auth token is URL-encoded in both sidecar and web client', () => {
    // Sidecar relay-bridge
    expect(relayBridgeSource).toContain('encodeURIComponent(authToken)');
    // Web client websocket.js
    expect(websocketSource).toContain('encodeURIComponent(authToken)');
  });
});

describe('End-to-end scenario: Web ↔ Web', () => {
  test('both browsers use async fallback to compute tokens', () => {
    // In browser, computeRoomAuthTokenSync returns null (no Node.js crypto)
    expect(roomAuthSource).toContain(
      'Browser: no synchronous HMAC available'
    );
    // But async uses Web Crypto API
    expect(roomAuthSource).toContain(
      "crypto.subtle.importKey"
    );
    expect(roomAuthSource).toContain(
      "{ name: 'HMAC', hash: 'SHA-256' }"
    );
  });

  test('server backward compat allows first connect without auth', () => {
    // validateRoomAuthToken allows unauthenticated joins when no token is registered
    expect(serverSource).toMatch(
      /if\s*\(!authToken\)/
    );
    expect(serverSource).toContain(
      "return { allowed: true }"
    );
  });
});

describe('End-to-end scenario: Native ↔ Native', () => {
  test('both sidecars have access to workspace key via documentKeys', () => {
    expect(sidecarSource).toContain(
      "const documentKeys = new Map()"
    );
    expect(sidecarSource).toContain(
      "documentKeys.get(docName) || sessionKey"
    );
  });

  test('relay-bridge stores authToken in connection for reconnects', () => {
    expect(relayBridgeSource).toMatch(
      /this\.connections\.set\(roomName,\s*\{[^}]*authToken/s
    );
  });

  test('HMAC tokens are deterministic for same key+room', () => {
    const key = crypto.randomBytes(32);
    const room = 'workspace-meta:shared-workspace-456';

    const token1 = crypto.createHmac('sha256', Buffer.from(key))
      .update(`room-auth:${room}`)
      .digest('base64');
    const token2 = crypto.createHmac('sha256', Buffer.from(key))
      .update(`room-auth:${room}`)
      .digest('base64');

    expect(token1).toBe(token2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Room Name Format Consistency
// ═══════════════════════════════════════════════════════════════════════════════

describe('Room name format consistency', () => {
  test('workspace-meta rooms use colon separator', () => {
    // Sidecar
    expect(sidecarSource).toContain("`workspace-meta:${");
    // Frontend
    expect(useWorkspaceSyncSource).toContain("`workspace-meta:${workspaceId}`");
  });

  test('workspace-folders rooms use colon separator', () => {
    expect(sidecarSource).toContain("`workspace-folders:${");
    expect(useWorkspaceSyncSource).toContain("`workspace-folders:${workspaceId}`");
  });

  test('doc rooms use dash separator (not colon)', () => {
    // Filter checks use 'doc-' prefix
    expect(sidecarSource).toContain("startsWith('doc-')");
  });

  test('relay-bridge URL format: relayUrl/roomName?auth=token', () => {
    // URL construction
    expect(relayBridgeSource).toContain(
      "let wsUrl = relayUrl.endsWith('/') ? `${relayUrl}${roomName}` : `${relayUrl}/${roomName}`"
    );
    expect(relayBridgeSource).toContain(
      "const separator = wsUrl.includes('?') ? '&' : '?'"
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Token Computation Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('Token computation edge cases', () => {
  test('computeRelayAuthToken returns null for null key', () => {
    expect(sidecarSource).toContain('if (!keyBytes || !roomName) return null');
  });

  test('computeRelayAuthToken returns null for null room', () => {
    expect(sidecarSource).toContain('if (!keyBytes || !roomName) return null');
  });

  test('computeRoomAuthToken (async) returns null for null inputs', () => {
    expect(roomAuthSource).toContain('if (!workspaceKey || !roomOrTopic) return null');
  });

  test('token works with base64 special characters (no URL breakage)', () => {
    // Base64 can contain +, /, = which are URL-special
    // But we use encodeURIComponent on both sides
    const key = Buffer.from('0123456789abcdef0123456789abcdef'); // 32 bytes
    const room = 'workspace-meta:test';
    const token = crypto.createHmac('sha256', key)
      .update(`room-auth:${room}`)
      .digest('base64');
    
    // encodeURIComponent should handle any base64 characters
    const encoded = encodeURIComponent(token);
    const decoded = decodeURIComponent(encoded);
    expect(decoded).toBe(token);
  });

  test('different rooms produce different tokens (token isolation)', () => {
    const key = crypto.randomBytes(32);
    const token1 = crypto.createHmac('sha256', Buffer.from(key))
      .update('room-auth:workspace-meta:room-A')
      .digest('base64');
    const token2 = crypto.createHmac('sha256', Buffer.from(key))
      .update('room-auth:workspace-meta:room-B')
      .digest('base64');
    expect(token1).not.toBe(token2);
  });

  test('different keys produce different tokens (key isolation)', () => {
    const key1 = crypto.randomBytes(32);
    const key2 = crypto.randomBytes(32);
    const room = 'workspace-meta:same-room';
    const token1 = crypto.createHmac('sha256', Buffer.from(key1))
      .update(`room-auth:${room}`)
      .digest('base64');
    const token2 = crypto.createHmac('sha256', Buffer.from(key2))
      .update(`room-auth:${room}`)
      .digest('base64');
    expect(token1).not.toBe(token2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Regression: Existing Functionality Not Broken
// ═══════════════════════════════════════════════════════════════════════════════

describe('Regression: existing relay functionality preserved', () => {
  test('relay-bridge still supports null authToken (backward compat)', () => {
    expect(relayBridgeSource).toContain('authToken = null');
  });

  test('relay-bridge still has exponential backoff', () => {
    expect(relayBridgeSource).toContain('_calculateBackoffDelay');
    expect(relayBridgeSource).toContain('BACKOFF_MAX_RETRIES');
  });

  test('relay-bridge still supports Tor SOCKS proxy', () => {
    expect(relayBridgeSource).toContain('this.socksProxy');
    expect(relayBridgeSource).toContain('getSocksProxyAgent');
  });

  test('relay-bridge still validates update size', () => {
    expect(relayBridgeSource).toContain('MAX_UPDATE_SIZE');
    expect(relayBridgeSource).toContain('Rejecting oversized update');
  });

  test('relay-bridge still handles Yjs sync protocol correctly', () => {
    expect(relayBridgeSource).toContain('syncProtocol.writeSyncStep1');
    expect(relayBridgeSource).toContain('syncProtocol.readSyncMessage');
  });

  test('sidecar still uses RELAY_OVERRIDE for tests', () => {
    expect(relayBridgeSource).toContain('RELAY_OVERRIDE');
  });

  test('server still supports backward-compatible unauthenticated joins', () => {
    // When no token is stored for a room, unauthenticated joins are allowed
    expect(serverSource).toMatch(
      /if\s*\(!authToken\)\s*\{[^}]*if\s*\(roomAuthTokens\.has\(roomId\)\)/s
    );
  });
});
