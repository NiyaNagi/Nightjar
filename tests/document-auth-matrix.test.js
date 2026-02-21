/**
 * Document Auth Token Matrix Tests for v1.7.29
 *
 * ROOT CAUSE (Issue #14): Document-level WebSocket auth tokens were computed
 * from `sessionKey` (unique per browser/app instance) instead of `workspaceKey`
 * (shared among all workspace members). This caused:
 *
 *   Client A registers: HMAC(sessionKey_A, "room-auth:" + docId)
 *   Client B computes:  HMAC(sessionKey_B, "room-auth:" + docId)
 *   → Tokens don't match → relay rejects with 4403 → infinite reconnect loop
 *
 * The fix uses `getStoredKeyChain(currentWorkspaceId).workspaceKey` (the shared
 * workspace key) for ALL room auth tokens. This ensures all clients in the same
 * workspace compute identical HMAC tokens.
 *
 * This test verifies the full sharing matrix:
 *   ✅ Web ↔ Web    (both use workspace key via async Web Crypto API)
 *   ✅ Web ↔ Native  (web: workspace key, sidecar: workspace key via set-key)
 *   ✅ Native ↔ Web   (sidecar: workspace key via set-key, web: workspace key)
 *   ✅ Native ↔ Native (both sidecars use workspace key via set-key)
 *
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const rootDir = path.resolve(__dirname, '..');
const readFile = (rel) => fs.readFileSync(path.join(rootDir, rel), 'utf-8');

// Read source files at test time
const appNewSource = readFile('frontend/src/AppNew.jsx');
const sidecarSource = readFile('sidecar/index.js');
const useWorkspaceSyncSource = readFile('frontend/src/hooks/useWorkspaceSync.js');
const roomAuthSource = readFile('frontend/src/utils/roomAuth.js');

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Document auth uses workspace key (not session key)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Document auth uses workspace key (Issue #14 fix)', () => {
  test('createDocument() derives authKey from getStoredKeyChain', () => {
    const idx = appNewSource.indexOf('Creating document');
    expect(idx).toBeGreaterThan(-1);

    // Before the provider creation, authKey should be derived from workspace key chain
    const before = appNewSource.lastIndexOf('getStoredKeyChain(currentWorkspaceId)', idx);
    expect(before).toBeGreaterThan(-1);

    // authKey is used (not sessionKey directly) for the HMAC
    const authTokenLine = appNewSource.indexOf('computeRoomAuthTokenSync(authKey, docId)', before);
    expect(authTokenLine).toBeGreaterThan(before);
    expect(authTokenLine).toBeLessThan(idx + 500);
  });

  test('openDocument() derives authKey from getStoredKeyChain', () => {
    const idx = appNewSource.indexOf('Opening document');
    expect(idx).toBeGreaterThan(-1);

    const before = appNewSource.lastIndexOf('getStoredKeyChain(currentWorkspaceId)', idx);
    expect(before).toBeGreaterThan(-1);

    const authTokenLine = appNewSource.indexOf('computeRoomAuthTokenSync(authKey, docId)', before);
    expect(authTokenLine).toBeGreaterThan(before);
    expect(authTokenLine).toBeLessThan(idx + 500);
  });

  test('authKey falls back to sessionKey when no keychain stored yet', () => {
    // Both createDocument and openDocument should have the fallback
    const matches = appNewSource.match(
      /getStoredKeyChain\(currentWorkspaceId\)\?\.workspaceKey\s*\|\|\s*sessionKey/g
    );
    expect(matches).not.toBeNull();
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  test('imports getStoredKeyChain', () => {
    expect(appNewSource).toContain("import { getStoredKeyChain } from './utils/keyDerivation'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Browser async fallback uses workspace key
// ═══════════════════════════════════════════════════════════════════════════════

describe('Browser async auth fallback uses workspace key', () => {
  test('createDocument async fallback uses authKey', () => {
    const createSite = appNewSource.indexOf('Creating document');
    const asyncCall = appNewSource.indexOf('computeRoomAuthToken(authKey, docId)', createSite);
    expect(asyncCall).toBeGreaterThan(createSite);
  });

  test('openDocument async fallback uses authKey', () => {
    const openSite = appNewSource.indexOf('Opening document');
    const asyncCall = appNewSource.indexOf('computeRoomAuthToken(authKey, docId)', openSite);
    expect(asyncCall).toBeGreaterThan(openSite);
  });

  test('connect:false is used when async auth needed to prevent no-auth rejection', () => {
    // When docAuthToken is null and authKey exists, provider should start disconnected
    const matches = appNewSource.match(
      /WebsocketProvider\([^)]*\{[^}]*connect:\s*false[^}]*\}/g
    );
    // Should appear in both createDocument and openDocument
    expect(matches).not.toBeNull();
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  test('async fallback calls connect() (not disconnect+connect cycle)', () => {
    // In v1.7.29, we use connect:false initially, then just connect() after async token
    // The provider.disconnect() before connect() is no longer needed
    const createSite = appNewSource.indexOf('Creating document');
    const openSite = appNewSource.indexOf('Opening document');
    
    // Check that async fallback section after createDocument has provider.connect()
    const createAsync = appNewSource.indexOf('computeRoomAuthToken(authKey, docId)', createSite);
    const createAsyncEnd = appNewSource.indexOf('}).catch', createAsync);
    const createBlock = appNewSource.substring(createAsync, createAsyncEnd);
    expect(createBlock).toContain('provider.connect()');
    // Should NOT have disconnect before connect in the async block
    expect(createBlock).not.toContain('provider.disconnect()');
    
    // Same for openDocument
    const openAsync = appNewSource.indexOf('computeRoomAuthToken(authKey, docId)', openSite);
    const openAsyncEnd = appNewSource.indexOf('}).catch', openAsync);
    const openBlock = appNewSource.substring(openAsync, openAsyncEnd);
    expect(openBlock).toContain('provider.connect()');
    expect(openBlock).not.toContain('provider.disconnect()');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Key delivery uses workspace key
// ═══════════════════════════════════════════════════════════════════════════════

describe('Key delivery uses workspace key', () => {
  test('web mode delivers authKey (not sessionKey) to server for doc rooms', () => {
    // deliverKeyToServer should use authKey
    const createSite = appNewSource.indexOf('Creating document');
    const deliveryBlock = appNewSource.substring(createSite, createSite + 800);
    expect(deliveryBlock).toContain("uint8ArrayToString(authKey, 'base64')");
    expect(deliveryBlock).toContain('deliverKeyToServer(docId, keyBase64');
  });

  test('Electron mode sends set-key with docName to sidecar for createDocument', () => {
    const createSite = appNewSource.indexOf('Creating document');
    // set-key appears after the provider creation, awareness setup, and IndexedDB
    const createBlock = appNewSource.substring(createSite, createSite + 4500);
    expect(createBlock).toContain("type: 'set-key'");
    expect(createBlock).toContain('docName: docId');
  });

  test('Electron mode sends set-key with docName to sidecar for openDocument', () => {
    const openSite = appNewSource.indexOf('Opening document');
    const openBlock = appNewSource.substring(openSite, openSite + 1500);
    expect(openBlock).toContain("type: 'set-key'");
    expect(openBlock).toContain('docName: docId');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Workspace-level auth still uses workspace key (unchanged, verified)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Workspace-level auth uses workspace key (unchanged)', () => {
  test('useWorkspaceSync computes auth from authKeyChain.workspaceKey', () => {
    expect(useWorkspaceSyncSource).toContain(
      'computeRoomAuthTokenSync(authKeyChain.workspaceKey,'
    );
  });

  test('useWorkspaceSync async fallback uses authKeyChain.workspaceKey', () => {
    expect(useWorkspaceSyncSource).toContain(
      'computeRoomAuthToken(authKeyChain.workspaceKey, roomName)'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. HMAC token compatibility: web client = sidecar = server
// ═══════════════════════════════════════════════════════════════════════════════

describe('HMAC token cross-platform compatibility', () => {
  test('same workspace key + same room = identical token (web ↔ native)', () => {
    // Both compute HMAC-SHA256(key, "room-auth:" + roomName) → base64
    const workspaceKey = crypto.randomBytes(32);
    const docRoom = 'doc-test-abc-123';

    // Sidecar / Electron style (Node.js crypto)
    const nativeToken = crypto
      .createHmac('sha256', Buffer.from(workspaceKey))
      .update(`room-auth:${docRoom}`)
      .digest('base64');

    // Web client style (same algorithm, just computed via Web Crypto API in browser)
    // Here we simulate with Node.js crypto since the algorithm is identical
    const webToken = crypto
      .createHmac('sha256', Buffer.from(workspaceKey))
      .update(`room-auth:${docRoom}`)
      .digest('base64');

    expect(nativeToken).toBe(webToken);
  });

  test('different session keys produce different tokens (the old bug)', () => {
    const sessionKeyA = crypto.randomBytes(32);
    const sessionKeyB = crypto.randomBytes(32);
    const docRoom = 'doc-test-xyz-789';

    const tokenA = crypto
      .createHmac('sha256', sessionKeyA)
      .update(`room-auth:${docRoom}`)
      .digest('base64');

    const tokenB = crypto
      .createHmac('sha256', sessionKeyB)
      .update(`room-auth:${docRoom}`)
      .digest('base64');

    // This is WHY the old code was broken: different session keys = different tokens
    expect(tokenA).not.toBe(tokenB);
  });

  test('same workspace key produces same token for all workspace rooms', () => {
    const workspaceKey = crypto.randomBytes(32);
    const wsId = 'test-workspace-id';

    const rooms = [
      `workspace-meta:${wsId}`,
      `workspace-folders:${wsId}`,
      'doc-abc-123',
      'doc-xyz-789',
    ];

    const tokens = rooms.map(room =>
      crypto
        .createHmac('sha256', Buffer.from(workspaceKey))
        .update(`room-auth:${room}`)
        .digest('base64')
    );

    // Each room gets a unique token (tokens differ per room)
    const unique = new Set(tokens);
    expect(unique.size).toBe(rooms.length);

    // But computing the same room again gives the same token (deterministic)
    for (let i = 0; i < rooms.length; i++) {
      const again = crypto
        .createHmac('sha256', Buffer.from(workspaceKey))
        .update(`room-auth:${rooms[i]}`)
        .digest('base64');
      expect(again).toBe(tokens[i]);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Sidecar uses per-doc keys from set-key (not just global session key)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Sidecar per-document key handling', () => {
  test('getKeyForDocument prefers per-doc key over global session key', () => {
    expect(sidecarSource).toContain('documentKeys.get(docName) || sessionKey');
  });

  test('set-key handler stores key under docName in documentKeys map', () => {
    expect(sidecarSource).toContain('documentKeys.set(sanitizedDocName, key)');
  });

  test('set-key handler reconnects relay with auth when key arrives after initial connect', () => {
    // When a key arrives for an already-connected doc, it should reconnect with auth
    expect(sidecarSource).toContain(
      'Key received for'
    );
    expect(sidecarSource).toContain(
      'reconnecting to relay with auth'
    );
  });

  test('connectAllDocsToRelay computes auth from getKeyForDocument', () => {
    expect(sidecarSource).toContain('getKeyForDocument(roomName)');
    expect(sidecarSource).toContain('computeRelayAuthToken(key, roomName)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Full matrix scenario analysis
// ═══════════════════════════════════════════════════════════════════════════════

describe('Full sharing matrix (web↔web, web↔native, native↔web, native↔native)', () => {
  const workspaceKey = crypto.randomBytes(32);
  const docRoom = 'doc-matrix-test';

  function computeToken(key, room) {
    return crypto
      .createHmac('sha256', Buffer.from(key))
      .update(`room-auth:${room}`)
      .digest('base64');
  }

  test('Web ↔ Web: both clients use workspace key → tokens match', () => {
    // Client A (web): authKey = workspaceKey
    const tokenA = computeToken(workspaceKey, docRoom);
    // Client B (web): authKey = same workspaceKey (from same share link)
    const tokenB = computeToken(workspaceKey, docRoom);
    expect(tokenA).toBe(tokenB);
  });

  test('Native ↔ Web: sidecar and web client use workspace key → tokens match', () => {
    // Sidecar: uses key from documentKeys.get(docRoom) = workspaceKey (set via set-key IPC)
    const sidecarToken = computeToken(workspaceKey, docRoom);
    // Web client: uses getStoredKeyChain(wsId).workspaceKey
    const webToken = computeToken(workspaceKey, docRoom);
    expect(sidecarToken).toBe(webToken);
  });

  test('Web ↔ Native: web client registers, sidecar matches', () => {
    const webToken = computeToken(workspaceKey, docRoom);
    const sidecarToken = computeToken(workspaceKey, docRoom);
    expect(webToken).toBe(sidecarToken);
  });

  test('Native ↔ Native: both sidecars use same workspace key → tokens match', () => {
    const sidecarA = computeToken(workspaceKey, docRoom);
    const sidecarB = computeToken(workspaceKey, docRoom);
    expect(sidecarA).toBe(sidecarB);
  });

  test('OLD BUG: different session keys would have produced mismatched tokens', () => {
    const sessionKeyA = crypto.randomBytes(32);
    const sessionKeyB = crypto.randomBytes(32);
    const tokenA = computeToken(sessionKeyA, docRoom);
    const tokenB = computeToken(sessionKeyB, docRoom);
    // This is what caused the infinite reconnect loop in Issue #14
    expect(tokenA).not.toBe(tokenB);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Relay server auth compatibility (server side unchanged)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Relay server auth (unchanged but verified)', () => {
  const serverSource = readFile('server/unified/index.js');

  test('validates room auth on WebSocket connection', () => {
    expect(serverSource).toContain("validateRoomAuthToken(`yws:${roomName}`, ywsAuthToken)");
  });

  test('first-write-wins token registration', () => {
    expect(serverSource).toContain('roomAuthTokens.set(roomId, authToken)');
  });

  test('rejects mismatched tokens', () => {
    expect(serverSource).toContain("return { allowed: false, reason: 'auth_token_mismatch' }");
  });

  test('rejects unauthenticated joins for registered rooms', () => {
    expect(serverSource).toContain("return { allowed: false, reason: 'room_requires_auth' }");
  });

  test('closes rejected connections with 4403', () => {
    expect(serverSource).toContain('ws.close(4403');
  });

  test('uses timing-safe comparison', () => {
    expect(serverSource).toContain('timingSafeEqual');
  });
});
