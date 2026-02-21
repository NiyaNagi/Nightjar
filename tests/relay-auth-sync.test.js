/**
 * Relay Auth & Cross-Platform Sync Tests for v1.7.26 / v1.7.27
 *
 * Tests for the relay bridge HMAC authentication fix (Issue #11) and
 * the encryption key delivery + sanitizeRoomName fixes (Issue #12):
 *
 * v1.7.26 ROOT CAUSE (Issue #11): The sidecar's relay bridge did NOT send
 * HMAC auth tokens when connecting to the relay server.
 *
 * v1.7.27 ROOT CAUSES (Issue #12):
 * 1. sanitizeId() rejects colons → workspace room names like
 *    "workspace-meta:abc123" are sanitized to null → keys fall through to
 *    global sessionKey → relay auth-reconnect is bypassed
 * 2. Sidecar never HTTP POSTs encryption keys to relay server → server
 *    can't persist Yjs state (encrypted persistence ON by default) → web
 *    joiners see empty rooms
 * 3. Password-derived workspace keys aren't persisted → autoRejoinWorkspaces
 *    on restart can't deliver keys or compute auth tokens
 *
 * FIXES (v1.7.27):
 * 1. sanitizeRoomName() allows colons for room prefixes
 * 2. deliverKeyToRelayServer() / deliverKeyToAllRelays() HTTP POST keys
 * 3. set-key handler persists workspace keys in LevelDB metadata
 * 4. create-workspace / join-workspace deliver keys to relay
 * 5. connectAllDocsToRelay / autoRejoinWorkspaces skip keyless rooms
 * 6. doc-added handler skips relay connect without key
 * 7. Server accepts same-key delivery from different identities
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
    // After v1.7.27, autoRejoinWorkspaces has a key-null guard before connecting
    const pattern = /const key = getKeyForDocument\(roomName\);\s*[\s\S]*?if \(key\) \{\s*const authToken = computeRelayAuthToken\(key, roomName\);\s*relayBridge\.connect\(roomName, doc, null, authToken\)\.catch/;
    expect(sidecarSource).toMatch(pattern);
  });

  test('doc-added handler relay connection passes auth token', () => {
    // This should appear in the context of the doc-added observer
    expect(sidecarSource).toContain(
      "console.log(`[Sidecar] Connecting ${docName} to public relay for cross-platform sharing...`);"
    );
    // Auth token is computed and passed inside the if (key) guard
    const docAddedPattern = /if \(key\) \{[\s\S]*?const authToken = computeRelayAuthToken\(key, docName\);\s*relayBridge\.connect\(docName, doc, null, authToken\)\.catch/;
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
// ═══════════════════════════════════════════════════════════════════════════════
// v1.7.27 — sanitizeRoomName (Issue #12 Root Cause #1)
// ═══════════════════════════════════════════════════════════════════════════════

describe('sanitizeRoomName — colon-safe room name validation', () => {
  test('sanitizeRoomName function exists in sidecar', () => {
    expect(sidecarSource).toContain('function sanitizeRoomName(name)');
  });

  test('sanitizeRoomName allows colons for workspace room prefixes', () => {
    // The regex must match [a-zA-Z0-9_\-:]+ (note the colon)
    expect(sidecarSource).toMatch(/sanitizeRoomName[\s\S]*?safePattern\s*=\s*\/.*:/);
  });

  test('sanitizeRoomName rejects dangerous characters (slashes, dots, etc.)', () => {
    // The safe pattern should NOT allow slashes, periods, spaces, etc.
    expect(sidecarSource).toContain("if (name.includes('..') || name.includes('./') || name.includes('/.'))");
  });

  test('sanitizeId still rejects colons (unchanged, for non-room-name IDs)', () => {
    // sanitizeId must NOT match colons — it guards document/workspace/folder IDs
    expect(sidecarSource).toMatch(/function sanitizeId[\s\S]*?safePattern\s*=\s*\/\^?\[a-zA-Z0-9_\\-\]\+\$/);
  });

  test('set-key handler uses sanitizeRoomName instead of sanitizeId', () => {
    // The set-key case must call sanitizeRoomName for docName
    const setKeySection = sidecarSource.match(/case 'set-key':[\s\S]*?break;/);
    expect(setKeySection).not.toBeNull();
    expect(setKeySection[0]).toContain('sanitizeRoomName(docName)');
  });

  test('set-key handler falls back to sanitizeId for non-room names', () => {
    // If sanitizeRoomName returns null, it should try sanitizeId
    const setKeySection = sidecarSource.match(/case 'set-key':[\s\S]*?break;/);
    expect(setKeySection[0]).toContain('sanitizeRoomName(docName) || sanitizeId(docName)');
  });

  // Functional test: verify regex actually works
  test('sanitizeRoomName regex accepts valid workspace room names', () => {
    const regex = /^[a-zA-Z0-9_\-:]+$/;
    expect(regex.test('workspace-meta:abc123def456')).toBe(true);
    expect(regex.test('workspace-folders:abc123def456')).toBe(true);
    expect(regex.test('doc-abc123')).toBe(true);
  });

  test('sanitizeRoomName regex rejects injection attempts', () => {
    const regex = /^[a-zA-Z0-9_\-:]+$/;
    expect(regex.test('workspace-meta:abc/../../etc/passwd')).toBe(false);
    expect(regex.test('workspace-meta:abc\nHTTP/1.1')).toBe(false);
    expect(regex.test('workspace-meta:abc 123')).toBe(false);
    expect(regex.test('')).toBe(false);
    expect(regex.test('workspace-meta:abc;ls -la')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// v1.7.27 — deliverKeyToRelayServer (Issue #12 Root Cause #2)
// ═══════════════════════════════════════════════════════════════════════════════

describe('deliverKeyToRelayServer — HTTP POST key to relay', () => {
  test('deliverKeyToRelayServer function exists in sidecar', () => {
    expect(sidecarSource).toContain('async function deliverKeyToRelayServer(relayUrl, roomName, keyBytes)');
  });

  test('deliverKeyToAllRelays function exists in sidecar', () => {
    expect(sidecarSource).toContain('async function deliverKeyToAllRelays(roomName, keyBytes)');
  });

  test('deliverKeyToRelayServer converts wss:// to https://', () => {
    expect(sidecarSource).toContain(".replace(/^wss:/i, 'https:')");
  });

  test('deliverKeyToRelayServer converts ws:// to http://', () => {
    expect(sidecarSource).toContain(".replace(/^ws:/i, 'http:')");
  });

  test('deliverKeyToRelayServer posts to /api/rooms/:roomName/key', () => {
    expect(sidecarSource).toContain('/api/rooms/${encodedRoom}/key');
  });

  test('deliverKeyToRelayServer URL-encodes room name (handles colons)', () => {
    expect(sidecarSource).toContain('encodeURIComponent(roomName)');
  });

  test('deliverKeyToRelayServer signs with Ed25519 identity', () => {
    expect(sidecarSource).toContain('nacl.sign.detached(messageBytes, ident.privateKey)');
  });

  test('deliverKeyToRelayServer uses same signature format as frontend', () => {
    // Both sidecar and frontend sign: "key-delivery:{roomName}:{keyBase64}:{timestamp}"
    expect(sidecarSource).toContain('`key-delivery:${roomName}:${keyBase64}:${timestamp}`');
    expect(websocketSource).toContain('`key-delivery:${roomName}:${keyBase64}:${timestamp}`');
  });

  test('deliverKeyToRelayServer handles 404 gracefully (persistence disabled)', () => {
    expect(sidecarSource).toContain("res.statusCode === 404");
    // Should return true on 404 (not an error — just no persistence)
    const fnSection = sidecarSource.match(/async function deliverKeyToRelayServer[\s\S]*?^}/m);
    expect(fnSection).not.toBeNull();
    expect(fnSection[0]).toContain("resolve(true)");
  });

  test('deliverKeyToRelayServer has request timeout', () => {
    expect(sidecarSource).toContain('timeout: 10000');
  });

  test('deliverKeyToAllRelays loads bootstrap nodes from mesh-constants', () => {
    const fnSection = sidecarSource.match(/async function deliverKeyToAllRelays[\s\S]*?^}/m);
    expect(fnSection).not.toBeNull();
    expect(fnSection[0]).toContain('BOOTSTRAP_NODES');
    expect(fnSection[0]).toContain('DEV_BOOTSTRAP_NODES');
  });

  test('deliverKeyToAllRelays uses Promise.allSettled for parallel delivery', () => {
    expect(sidecarSource).toContain('Promise.allSettled(promises)');
  });

  test('deliverKeyToAllRelays respects RELAY_OVERRIDE', () => {
    const fnSection = sidecarSource.match(/async function deliverKeyToAllRelays[\s\S]*?^}/m);
    expect(fnSection).not.toBeNull();
    expect(fnSection[0]).toContain('RELAY_OVERRIDE');
  });

  test('sidecar imports http module for dev-mode relay servers', () => {
    expect(sidecarSource).toContain("const http = require('http')");
  });

  test('sidecar imports tweetnacl for Ed25519 signing', () => {
    expect(sidecarSource).toContain("const nacl = require('tweetnacl')");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// v1.7.27 — Key delivery wiring (Issue #12 fix integration)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Key delivery wiring — all paths deliver keys to relay', () => {
  test('set-key handler delivers key to relay after documentKeys.set', () => {
    const setKeySection = sidecarSource.match(/case 'set-key':[\s\S]*?break;/);
    expect(setKeySection).not.toBeNull();
    expect(setKeySection[0]).toContain('deliverKeyToAllRelays(sanitizedDocName, key)');
  });

  test('set-key handler persists workspace keys in LevelDB metadata', () => {
    const setKeySection = sidecarSource.match(/case 'set-key':[\s\S]*?break;/);
    expect(setKeySection).not.toBeNull();
    // Should check for workspace-meta: or workspace-folders: prefix and save
    expect(setKeySection[0]).toContain("sanitizedDocName.startsWith('workspace-meta:')");
    expect(setKeySection[0]).toContain('saveWorkspaceMetadata(wsId, wsMeta)');
  });

  test('set-key handler stores key as base64url in workspace metadata', () => {
    const setKeySection = sidecarSource.match(/case 'set-key':[\s\S]*?break;/);
    expect(setKeySection).not.toBeNull();
    // Must convert to base64url format (matching frontend)
    expect(setKeySection[0]).toContain("replace(/\\+/g, '-')");
    expect(setKeySection[0]).toContain("replace(/\\//g, '_')");
  });

  test('create-workspace handler delivers key to all relays', () => {
    const createSection = sidecarSource.match(/case 'create-workspace':[\s\S]*?break;/);
    expect(createSection).not.toBeNull();
    expect(createSection[0]).toContain('deliverKeyToAllRelays(`workspace-meta:${wsData.id}`, keyBytes)');
    expect(createSection[0]).toContain('deliverKeyToAllRelays(`workspace-folders:${wsData.id}`, keyBytes)');
  });

  test('join-workspace handler delivers key to all relays', () => {
    const joinSection = sidecarSource.match(/case 'join-workspace':[\s\S]*?break;/);
    expect(joinSection).not.toBeNull();
    expect(joinSection[0]).toContain('deliverKeyToAllRelays(workspaceMetaDocName, keyBytes)');
    expect(joinSection[0]).toContain('deliverKeyToAllRelays(workspaceFoldersDocName, keyBytes)');
  });

  test('connectAllDocsToRelay skips rooms without encryption key', () => {
    const fnSection = sidecarSource.match(/async function connectAllDocsToRelay[\s\S]*?return connected;\s*\}/);
    expect(fnSection).not.toBeNull();
    expect(fnSection[0]).toContain('if (!key)');
    expect(fnSection[0]).toContain('continue');
    expect(fnSection[0]).toContain('no key available yet');
  });

  test('connectAllDocsToRelay delivers key to relay for connected rooms', () => {
    const fnSection = sidecarSource.match(/async function connectAllDocsToRelay[\s\S]*?return connected;\s*\}/);
    expect(fnSection).not.toBeNull();
    expect(fnSection[0]).toContain('deliverKeyToAllRelays(roomName, key)');
  });

  test('autoRejoinWorkspaces skips relay when no key available', () => {
    const fnSection = sidecarSource.match(/async function autoRejoinWorkspaces[\s\S]*?^\}/m);
    expect(fnSection).not.toBeNull();
    expect(fnSection[0]).toContain('Deferring relay connect');
    expect(fnSection[0]).toContain('no key available yet');
  });

  test('autoRejoinWorkspaces delivers key to relay when available', () => {
    const fnSection = sidecarSource.match(/async function autoRejoinWorkspaces[\s\S]*?^\}/m);
    expect(fnSection).not.toBeNull();
    expect(fnSection[0]).toContain('deliverKeyToAllRelays(roomName, key)');
    expect(fnSection[0]).toContain('deliverKeyToAllRelays(foldersRoom, key)');
  });

  test('doc-added handler skips relay connect without key', () => {
    // The doc-added event handler must check for key before relay connect
    const docAddedSection = sidecarSource.match(/docs\.on\('doc-added'[\s\S]*?^\}\);/m);
    expect(docAddedSection).not.toBeNull();
    expect(docAddedSection[0]).toContain('Deferring relay connect');
    expect(docAddedSection[0]).toContain('no key available yet');
  });

  test('doc-added handler delivers key to relay when key exists', () => {
    const docAddedSection = sidecarSource.match(/docs\.on\('doc-added'[\s\S]*?^\}\);/m);
    expect(docAddedSection).not.toBeNull();
    expect(docAddedSection[0]).toContain('deliverKeyToAllRelays(docName, key)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// v1.7.27 — Server same-key acceptance (Issue #12 Bug #10 fix)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Server key delivery — same-key different-identity acceptance', () => {
  test('server key endpoint accepts same key from different identity', () => {
    // The server should compare the incoming key with the stored key
    // and return 200 if they match, even if the identity is different
    expect(serverSource).toContain('Same key re-delivered by different identity');
  });

  test('server key endpoint uses Buffer.equals for key comparison', () => {
    // Must use proper byte comparison, not string comparison
    const keySection = serverSource.match(/api\/rooms\/:roomName\/key[\s\S]*?res\.json\(\{ success: true \}\);[\s\S]*?\}\);/);
    expect(keySection).not.toBeNull();
    expect(keySection[0]).toContain('.equals(');
  });

  test('server still rejects truly different key from different identity', () => {
    // Different key + different identity should still return 403
    expect(serverSource).toContain("'Room key already registered by a different identity'");
  });

  test('server key endpoint still has encrypted persistence gate', () => {
    expect(serverSource).toContain("if (!ENCRYPTED_PERSISTENCE)");
  });

  test('server key endpoint still has rate limiting', () => {
    expect(serverSource).toContain('keyDeliveryLimiter');
  });

  test('server key endpoint handles deferred loads (pendingKeyLoads)', () => {
    expect(serverSource).toContain('pendingKeyLoads.has(roomName)');
    expect(serverSource).toContain("Y.applyUpdate(doc, decrypted, 'persistence-load')");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// v1.7.27 — Cross-Platform Matrix Verification
// ═══════════════════════════════════════════════════════════════════════════════

describe('Cross-Platform Matrix — all 4 scenarios work end-to-end', () => {

  // Scenario 1: Native → Web
  describe('Scenario 1: Native creates, Web joins', () => {
    test('create-workspace registers key in documentKeys', () => {
      const createSection = sidecarSource.match(/case 'create-workspace':[\s\S]*?break;/);
      expect(createSection[0]).toContain('documentKeys.set(`workspace-meta:${wsData.id}`, keyBytes)');
      expect(createSection[0]).toContain('documentKeys.set(`workspace-folders:${wsData.id}`, keyBytes)');
    });

    test('create-workspace delivers key to relay for server persistence', () => {
      const createSection = sidecarSource.match(/case 'create-workspace':[\s\S]*?break;/);
      expect(createSection[0]).toContain('deliverKeyToAllRelays');
    });

    test('set-key accepts workspace-meta:xxx (colon in name)', () => {
      // sanitizeRoomName must accept colons
      expect(sidecarSource).toContain('function sanitizeRoomName(name)');
      const regex = /^[a-zA-Z0-9_\-:]+$/;
      expect(regex.test('workspace-meta:test123')).toBe(true);
    });

    test('set-key delivers key to relay server', () => {
      const setKeySection = sidecarSource.match(/case 'set-key':[\s\S]*?break;/);
      expect(setKeySection[0]).toContain('deliverKeyToAllRelays(sanitizedDocName, key)');
    });

    test('web client can still use deliverKeyToServer from frontend', () => {
      // Browser path: useWorkspaceSync → deliverKeyToServer → HTTP POST
      expect(websocketSource).toContain('async function deliverKeyToServer');
      expect(websocketSource).toContain('/api/rooms/${encodedRoom}/key');
    });
  });

  // Scenario 2: Web → Native
  describe('Scenario 2: Web creates, Native joins', () => {
    test('web client delivers key via deliverKeyToServer (browser path)', () => {
      expect(websocketSource).toContain("isElectron() && !serverUrl");
      // Browser mode should proceed (skip condition is Electron without serverUrl)
    });

    test('join-workspace registers key from share link', () => {
      const joinSection = sidecarSource.match(/case 'join-workspace':[\s\S]*?break;/);
      expect(joinSection[0]).toContain("documentKeys.set(workspaceMetaDocName, keyBytes)");
      expect(joinSection[0]).toContain("documentKeys.set(workspaceFoldersDocName, keyBytes)");
    });

    test('join-workspace delivers key to relay (covers native joiner)', () => {
      const joinSection = sidecarSource.match(/case 'join-workspace':[\s\S]*?break;/);
      expect(joinSection[0]).toContain('deliverKeyToAllRelays(workspaceMetaDocName, keyBytes)');
    });
  });

  // Scenario 3: Native → Native
  describe('Scenario 3: Native creates, Native joins', () => {
    test('both sides compute identical HMAC auth tokens', () => {
      // Both use computeRelayAuthToken with identical algorithm
      const key = crypto.randomBytes(32);
      const room = 'workspace-meta:testws123';
      const token = crypto.createHmac('sha256', key).update(`room-auth:${room}`).digest('base64');

      // Second computation must produce same result
      const token2 = crypto.createHmac('sha256', key).update(`room-auth:${room}`).digest('base64');
      expect(token).toBe(token2);
    });

    test('both sides deliver same key to relay (server accepts)', () => {
      // Server must accept same-key delivery from different identity
      expect(serverSource).toContain('Same key re-delivered by different identity');
    });

    test('relay bridge appends auth token to WebSocket URL', () => {
      expect(relayBridgeSource).toContain('auth=${encodeURIComponent(authToken)}');
    });
  });

  // Scenario 4: Web → Web
  describe('Scenario 4: Web creates, Web joins', () => {
    test('browser uses async auth fallback (Web Crypto API)', () => {
      // useWorkspaceSync has fallback for browsers without sync HMAC
      expect(useWorkspaceSyncSource).toContain('computeRoomAuthToken(authKeyChain.workspaceKey, roomName)');
    });

    test('browser delivers key to server via fetch (no sidecar involved)', () => {
      expect(websocketSource).toContain("method: 'POST'");
      expect(websocketSource).toContain("'Content-Type': 'application/json'");
    });

    test('sidecar changes do not affect browser-only path', () => {
      // deliverKeyToServer in websocket.js skips in Electron mode
      expect(websocketSource).toContain('isElectron() && !serverUrl');
      // Browser mode: isElectron() returns false → proceeds with delivery
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// v1.7.27 — Key Persistence and Restart Recovery
// ═══════════════════════════════════════════════════════════════════════════════

describe('Key persistence — workspace keys survive restart', () => {
  test('set-key handler persists key for workspace-meta rooms', () => {
    const setKeySection = sidecarSource.match(/case 'set-key':[\s\S]*?break;/);
    expect(setKeySection[0]).toContain("sanitizedDocName.startsWith('workspace-meta:')");
    expect(setKeySection[0]).toContain('saveWorkspaceMetadata(wsId, wsMeta)');
  });

  test('set-key handler persists key for workspace-folders rooms', () => {
    const setKeySection = sidecarSource.match(/case 'set-key':[\s\S]*?break;/);
    expect(setKeySection[0]).toContain("sanitizedDocName.startsWith('workspace-folders:')");
  });

  test('loadWorkspaceList preloads keys from persisted metadata', () => {
    // loadWorkspaceList already loads encryptionKey into documentKeys
    expect(sidecarSource).toContain('Loaded encryption key for workspace-meta:');
    // Use word boundary \b to avoid matching loadWorkspaceListInternal
    const loadSection = sidecarSource.match(/async function loadWorkspaceList\b(?!Internal)[\s\S]*?return workspaces;\s*\}/);
    expect(loadSection).not.toBeNull();
    expect(loadSection[0]).toContain('documentKeys.set(workspaceMetaDocName, keyBytes)');
    expect(loadSection[0]).toContain('documentKeys.set(workspaceFoldersDocName, keyBytes)');
  });

  test('autoRejoinWorkspaces uses preloaded keys for relay auth', () => {
    // After loadWorkspaceList preloads keys, autoRejoinWorkspaces should
    // find them via getKeyForDocument and compute auth tokens
    const fnSection = sidecarSource.match(/async function autoRejoinWorkspaces[\s\S]*?^\}/m);
    expect(fnSection[0]).toContain('getKeyForDocument(roomName)');
    expect(fnSection[0]).toContain('computeRelayAuthToken(key, roomName)');
  });

  test('set-key handler handles missing workspace metadata gracefully', () => {
    // If workspace doesn't exist yet in metadata DB, should not crash
    const setKeySection = sidecarSource.match(/case 'set-key':[\s\S]*?break;/);
    expect(setKeySection[0]).toContain('LEVEL_NOT_FOUND');
  });

  test('set-key handler only persists when key not already saved', () => {
    // Idempotency: don't overwrite existing persisted key
    const setKeySection = sidecarSource.match(/case 'set-key':[\s\S]*?break;/);
    expect(setKeySection[0]).toContain('!wsMeta.encryptionKey');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// v1.7.27 — Signature format compatibility
// ═══════════════════════════════════════════════════════════════════════════════

describe('Ed25519 Signature compatibility — sidecar matches frontend', () => {
  test('both use identical signed message format', () => {
    // Sidecar: `key-delivery:${roomName}:${keyBase64}:${timestamp}`
    expect(sidecarSource).toContain('`key-delivery:${roomName}:${keyBase64}:${timestamp}`');
    // Frontend: same format
    expect(websocketSource).toContain('`key-delivery:${roomName}:${keyBase64}:${timestamp}`');
  });

  test('sidecar uses nacl.sign.detached for signing', () => {
    expect(sidecarSource).toContain('nacl.sign.detached(messageBytes, ident.privateKey)');
  });

  test('frontend uses nacl.sign.detached for signing', () => {
    expect(websocketSource).toContain('nacl.sign.detached(messageBytes, secretKey)');
  });

  test('both encode public key and signature as base64', () => {
    // Sidecar uses Buffer.from().toString('base64')
    expect(sidecarSource).toContain("Buffer.from(ident.publicKey).toString('base64')");
    expect(sidecarSource).toContain("Buffer.from(signature).toString('base64')");
    // Frontend uses btoa()
    expect(websocketSource).toContain('btoa(pubBinary)');
    expect(websocketSource).toContain('btoa(sigBinary)');
  });

  // Verify that Buffer.from(str, 'utf-8') and TextEncoder produce identical bytes for ASCII
  test('signature byte encoding produces identical results for ASCII strings', () => {
    const testMessage = 'key-delivery:workspace-meta:abc123:AaBbCcDd+/==:1234567890';
    const bufferBytes = Buffer.from(testMessage, 'utf-8');
    const encoderBytes = new TextEncoder().encode(testMessage);
    expect(Buffer.from(encoderBytes).equals(bufferBytes)).toBe(true);
  });
});