/**
 * Test Suite: Security Hardening — Phase 2
 * 
 * Covers:
 * - Fix 4: HMAC Room-Join Authentication
 *   - computeRoomAuthToken (HMAC-SHA256 derivation)
 *   - validateRoomAuthToken (first-write-wins, constant-time comparison)
 *   - Server-side auth enforcement in handleJoinTopic, handleJoin, y-ws upgrade
 * - Fix 6: E2E Encrypted Relay Messages
 *   - encryptRelayPayload / decryptRelayPayload round-trip
 *   - NaCl secretbox (XSalsa20-Poly1305) correctness
 *   - Server-side opaque forwarding of encrypted envelopes
 * 
 * Tests are structured as unit tests that run in Jest/jsdom without
 * a running server (re-implementing server logic for isolated testing).
 */

import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';

const nacl = require('tweetnacl');
const crypto = require('crypto');

// =============================================================================
// Fix 4: HMAC Room-Join Authentication
// =============================================================================

describe('Fix 4: HMAC Room-Join Authentication', () => {

  // Re-implement computeRoomAuthToken using Node.js crypto (matching roomAuth.js logic)
  async function computeRoomAuthToken(workspaceKey, roomOrTopic) {
    if (!workspaceKey || !roomOrTopic) return null;

    let keyBytes;
    if (typeof workspaceKey === 'string') {
      keyBytes = Buffer.from(workspaceKey, 'base64');
    } else if (workspaceKey instanceof Uint8Array) {
      keyBytes = Buffer.from(workspaceKey);
    } else {
      return null;
    }

    const message = `room-auth:${roomOrTopic}`;
    const hmac = crypto.createHmac('sha256', keyBytes);
    hmac.update(message);
    return hmac.digest('base64');
  }

  // Re-implement validateRoomAuthToken exactly as in server/unified/index.js
  function createRoomAuthValidator() {
    const roomAuthTokens = new Map();

    return function validateRoomAuthToken(roomId, authToken) {
      if (!authToken) {
        if (roomAuthTokens.has(roomId)) {
          return { allowed: false, reason: 'room_requires_auth' };
        }
        return { allowed: true };
      }

      if (typeof authToken !== 'string' || authToken.length > 256) {
        return { allowed: false, reason: 'invalid_auth_token' };
      }

      const existingToken = roomAuthTokens.get(roomId);
      if (!existingToken) {
        roomAuthTokens.set(roomId, authToken);
        return { allowed: true };
      }

      // Constant-time comparison
      if (existingToken.length !== authToken.length) {
        return { allowed: false, reason: 'auth_token_mismatch' };
      }
      const a = Buffer.from(existingToken);
      const b = Buffer.from(authToken);
      if (!crypto.timingSafeEqual(a, b)) {
        return { allowed: false, reason: 'auth_token_mismatch' };
      }

      return { allowed: true };
    };
  }

  // ─── HMAC Token Computation ──────────────────────────────────────────

  describe('computeRoomAuthToken', () => {
    test('produces a deterministic base64 HMAC-SHA256 token', async () => {
      const key = nacl.randomBytes(32);
      const room = 'workspace-meta:test-workspace';

      const token1 = await computeRoomAuthToken(key, room);
      const token2 = await computeRoomAuthToken(key, room);

      expect(typeof token1).toBe('string');
      expect(token1.length).toBeGreaterThan(0);
      expect(token1).toBe(token2); // deterministic
    });

    test('same key + different rooms produce different tokens', async () => {
      const key = nacl.randomBytes(32);

      const tokenA = await computeRoomAuthToken(key, 'room-alpha');
      const tokenB = await computeRoomAuthToken(key, 'room-beta');

      expect(tokenA).not.toBe(tokenB);
    });

    test('different keys + same room produce different tokens', async () => {
      const key1 = nacl.randomBytes(32);
      const key2 = nacl.randomBytes(32);
      const room = 'shared-room';

      const token1 = await computeRoomAuthToken(key1, room);
      const token2 = await computeRoomAuthToken(key2, room);

      expect(token1).not.toBe(token2);
    });

    test('accepts Uint8Array key', async () => {
      const key = nacl.randomBytes(32);
      const token = await computeRoomAuthToken(key, 'test-room');
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    test('accepts base64 string key', async () => {
      const rawKey = nacl.randomBytes(32);
      const base64Key = Buffer.from(rawKey).toString('base64');
      const room = 'test-room';

      const tokenFromBytes = await computeRoomAuthToken(rawKey, room);
      const tokenFromBase64 = await computeRoomAuthToken(base64Key, room);

      expect(tokenFromBytes).toBe(tokenFromBase64);
    });

    test('returns null for null/empty key', async () => {
      expect(await computeRoomAuthToken(null, 'room')).toBeNull();
      expect(await computeRoomAuthToken(undefined, 'room')).toBeNull();
    });

    test('returns null for null/empty room', async () => {
      const key = nacl.randomBytes(32);
      expect(await computeRoomAuthToken(key, null)).toBeNull();
      expect(await computeRoomAuthToken(key, '')).toBeNull();
    });

    test('token is valid base64', async () => {
      const key = nacl.randomBytes(32);
      const token = await computeRoomAuthToken(key, 'room');
      // Should not throw when decoded
      const decoded = Buffer.from(token, 'base64');
      // SHA-256 HMAC = 32 bytes
      expect(decoded.length).toBe(32);
    });

    test('token matches expected HMAC-SHA256 output', async () => {
      const key = nacl.randomBytes(32);
      const room = 'verification-room';

      const token = await computeRoomAuthToken(key, room);

      // Independent verification
      const expected = crypto.createHmac('sha256', Buffer.from(key))
        .update(`room-auth:${room}`)
        .digest('base64');

      expect(token).toBe(expected);
    });
  });

  // ─── Server-Side Validation ──────────────────────────────────────────

  describe('validateRoomAuthToken', () => {
    let validate;

    beforeEach(() => {
      validate = createRoomAuthValidator();
    });

    test('unauthenticated join allowed when no token registered', () => {
      const result = validate('new-room', undefined);
      expect(result.allowed).toBe(true);
    });

    test('first authenticated join registers token (first-write-wins)', () => {
      const result = validate('room-1', 'token-abc');
      expect(result.allowed).toBe(true);
    });

    test('same token passes on subsequent join', () => {
      validate('room-1', 'token-abc');
      const result = validate('room-1', 'token-abc');
      expect(result.allowed).toBe(true);
    });

    test('different token rejected for registered room', () => {
      validate('room-1', 'token-abc');
      const result = validate('room-1', 'wrong-token');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('auth_token_mismatch');
    });

    test('unauthenticated join blocked after room is registered', () => {
      validate('room-1', 'token-abc');
      const result = validate('room-1', undefined);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('room_requires_auth');
    });

    test('separate rooms have independent tokens', () => {
      validate('room-a', 'token-for-a');
      validate('room-b', 'token-for-b');

      expect(validate('room-a', 'token-for-a').allowed).toBe(true);
      expect(validate('room-b', 'token-for-b').allowed).toBe(true);
      expect(validate('room-a', 'token-for-b').allowed).toBe(false);
      expect(validate('room-b', 'token-for-a').allowed).toBe(false);
    });

    test('rejects invalid token type (non-string)', () => {
      const result = validate('room', 12345);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('invalid_auth_token');
    });

    test('rejects oversized token (>256 chars)', () => {
      const longToken = 'x'.repeat(257);
      const result = validate('room', longToken);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('invalid_auth_token');
    });

    test('constant-time comparison prevents timing attacks', () => {
      // Register a real HMAC token
      const key = nacl.randomBytes(32);
      const token = crypto.createHmac('sha256', Buffer.from(key))
        .update('room-auth:secure-room')
        .digest('base64');

      validate('secure-room', token);

      // Valid re-auth
      expect(validate('secure-room', token).allowed).toBe(true);

      // Wrong token (different length)
      expect(validate('secure-room', 'short').allowed).toBe(false);

      // Wrong token (same length, different content)
      const fakeToken = crypto.createHmac('sha256', nacl.randomBytes(32))
        .update('room-auth:secure-room')
        .digest('base64');
      expect(validate('secure-room', fakeToken).allowed).toBe(false);
    });
  });

  // ─── End-to-End: Token Derivation → Validation ───────────────────────

  describe('Auth Token End-to-End Flow', () => {
    test('token derived from workspace key passes server validation', async () => {
      const validate = createRoomAuthValidator();
      const workspaceKey = nacl.randomBytes(32);
      const topic = 'abc123def456';
      const roomId = `p2p:${topic}`;

      // Client 1 derives and registers
      const token = await computeRoomAuthToken(workspaceKey, roomId);
      expect(validate(roomId, token).allowed).toBe(true);

      // Client 2 with same key
      const token2 = await computeRoomAuthToken(workspaceKey, roomId);
      expect(validate(roomId, token2).allowed).toBe(true);
    });

    test('client with wrong key is rejected', async () => {
      const validate = createRoomAuthValidator();
      const rightKey = nacl.randomBytes(32);
      const wrongKey = nacl.randomBytes(32);
      const roomId = 'p2p:workspace-topic';

      // Legitimate client registers
      const correctToken = await computeRoomAuthToken(rightKey, roomId);
      validate(roomId, correctToken);

      // Attacker with different key
      const wrongToken = await computeRoomAuthToken(wrongKey, roomId);
      const result = validate(roomId, wrongToken);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('auth_token_mismatch');
    });

    test('y-websocket room uses separate auth namespace', async () => {
      const validate = createRoomAuthValidator();
      const key = nacl.randomBytes(32);
      const roomName = 'workspace-meta:ws-123';

      // P2P topic auth
      const p2pToken = await computeRoomAuthToken(key, `p2p:${roomName}`);
      validate(`p2p:${roomName}`, p2pToken);

      // Y-WS auth (different namespace prefix)
      const ywsToken = await computeRoomAuthToken(key, `yws:${roomName}`);
      validate(`yws:${roomName}`, ywsToken);

      // They should have independent registrations
      expect(validate(`p2p:${roomName}`, p2pToken).allowed).toBe(true);
      expect(validate(`yws:${roomName}`, ywsToken).allowed).toBe(true);

      // Cross-namespace should fail
      expect(validate(`p2p:${roomName}`, ywsToken).allowed).toBe(false);
      expect(validate(`yws:${roomName}`, p2pToken).allowed).toBe(false);
    });
  });

  describe('computeRoomAuthTokenSync', () => {
    // Re-implement the sync version for comparison
    function computeRoomAuthTokenSyncLocal(workspaceKey, roomOrTopic) {
      if (!workspaceKey || !roomOrTopic) return null;
      let keyBytes;
      if (typeof workspaceKey === 'string') {
        keyBytes = Buffer.from(workspaceKey, 'base64');
      } else if (workspaceKey instanceof Uint8Array) {
        keyBytes = Buffer.from(workspaceKey);
      } else {
        return null;
      }
      const message = `room-auth:${roomOrTopic}`;
      const hmac = crypto.createHmac('sha256', keyBytes);
      hmac.update(message);
      return hmac.digest('base64');
    }

    test('sync and async produce identical tokens', async () => {
      const key = nacl.randomBytes(32);
      const room = 'test-room-sync';
      const asyncToken = await computeRoomAuthToken(key, room);
      const syncToken = computeRoomAuthTokenSyncLocal(key, room);
      expect(syncToken).toBe(asyncToken);
    });

    test('returns null for null key', () => {
      expect(computeRoomAuthTokenSyncLocal(null, 'room')).toBeNull();
    });

    test('returns null for null room', () => {
      const key = nacl.randomBytes(32);
      expect(computeRoomAuthTokenSyncLocal(key, null)).toBeNull();
    });

    test('accepts string key (base64)', () => {
      const key = nacl.randomBytes(32);
      const keyBase64 = Buffer.from(key).toString('base64');
      const fromBytes = computeRoomAuthTokenSyncLocal(key, 'room');
      const fromString = computeRoomAuthTokenSyncLocal(keyBase64, 'room');
      expect(fromString).toBe(fromBytes);
    });

    test('sync token validates against server auth', async () => {
      const validate = createRoomAuthValidator();
      const key = nacl.randomBytes(32);
      const room = 'doc-sync-test';
      // First client registers with async token
      const asyncToken = await computeRoomAuthToken(key, room);
      validate(room, asyncToken);
      // Second client joins with sync token — should match
      const syncToken = computeRoomAuthTokenSyncLocal(key, room);
      expect(validate(room, syncToken).allowed).toBe(true);
    });
  });
});

// =============================================================================
// Fix 6: E2E Encrypted Relay Messages
// =============================================================================

describe('Fix 6: E2E Encrypted Relay Messages', () => {

  // Re-implement encrypt/decrypt matching roomAuth.js logic
  function uint8ToBase64(bytes) {
    return Buffer.from(bytes).toString('base64');
  }

  function base64ToUint8(base64) {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }

  function encryptRelayPayload(payload, workspaceKey) {
    if (!payload || !workspaceKey || workspaceKey.length !== 32) return null;
    try {
      const json = JSON.stringify(payload);
      const messageBytes = Buffer.from(json, 'utf-8');
      const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
      const encrypted = nacl.secretbox(
        new Uint8Array(messageBytes),
        nonce,
        workspaceKey
      );
      const combined = new Uint8Array(nonce.length + encrypted.length);
      combined.set(nonce, 0);
      combined.set(encrypted, nonce.length);
      return uint8ToBase64(combined);
    } catch {
      return null;
    }
  }

  function decryptRelayPayload(encryptedBase64, workspaceKey) {
    if (!encryptedBase64 || !workspaceKey || workspaceKey.length !== 32) return null;
    try {
      const combined = base64ToUint8(encryptedBase64);
      if (combined.length < nacl.secretbox.nonceLength + nacl.secretbox.overheadLength) {
        return null;
      }
      const nonce = combined.slice(0, nacl.secretbox.nonceLength);
      const ciphertext = combined.slice(nacl.secretbox.nonceLength);
      const decrypted = nacl.secretbox.open(ciphertext, nonce, workspaceKey);
      if (!decrypted) return null;
      const json = Buffer.from(decrypted).toString('utf-8');
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  // ─── Encryption / Decryption Round-Trip ──────────────────────────────

  describe('encryptRelayPayload / decryptRelayPayload', () => {
    test('round-trip: encrypt then decrypt recovers original payload', () => {
      const key = nacl.randomBytes(32);
      const payload = { type: 'sync-update', data: [1, 2, 3], text: 'hello world' };

      const encrypted = encryptRelayPayload(payload, key);
      expect(typeof encrypted).toBe('string');
      expect(encrypted.length).toBeGreaterThan(0);

      const decrypted = decryptRelayPayload(encrypted, key);
      expect(decrypted).toEqual(payload);
    });

    test('encrypted output is base64 and opaque', () => {
      const key = nacl.randomBytes(32);
      const payload = { secret: 'do-not-leak-this' };

      const encrypted = encryptRelayPayload(payload, key);
      
      // Should be valid base64
      expect(() => Buffer.from(encrypted, 'base64')).not.toThrow();
      
      // Should NOT contain plaintext of the payload
      expect(encrypted).not.toContain('do-not-leak-this');
      expect(encrypted).not.toContain('secret');
    });

    test('each encryption produces different ciphertext (random nonce)', () => {
      const key = nacl.randomBytes(32);
      const payload = { value: 42 };

      const enc1 = encryptRelayPayload(payload, key);
      const enc2 = encryptRelayPayload(payload, key);

      // Same plaintext, different nonces → different ciphertext
      expect(enc1).not.toBe(enc2);

      // But both decrypt to same value
      expect(decryptRelayPayload(enc1, key)).toEqual(payload);
      expect(decryptRelayPayload(enc2, key)).toEqual(payload);
    });

    test('wrong key cannot decrypt', () => {
      const key1 = nacl.randomBytes(32);
      const key2 = nacl.randomBytes(32);
      const payload = { sensitive: 'data' };

      const encrypted = encryptRelayPayload(payload, key1);
      const result = decryptRelayPayload(encrypted, key2);

      expect(result).toBeNull();
    });

    test('tampered ciphertext fails decryption', () => {
      const key = nacl.randomBytes(32);
      const payload = { value: 'original' };

      const encrypted = encryptRelayPayload(payload, key);
      const bytes = base64ToUint8(encrypted);

      // Flip a byte in the ciphertext (after the nonce)
      bytes[nacl.secretbox.nonceLength + 5] ^= 0xFF;

      const tampered = uint8ToBase64(bytes);
      const result = decryptRelayPayload(tampered, key);

      expect(result).toBeNull();
    });

    test('handles complex nested payload', () => {
      const key = nacl.randomBytes(32);
      const payload = {
        type: 'chunk-response',
        chunks: [
          { id: 1, data: Buffer.from('binary-data').toString('base64') },
          { id: 2, data: null },
        ],
        metadata: { peerId: 'peer-abc', timestamp: 1700000000 },
        nested: { deep: { value: true } },
      };

      const encrypted = encryptRelayPayload(payload, key);
      const decrypted = decryptRelayPayload(encrypted, key);
      expect(decrypted).toEqual(payload);
    });

    test('handles empty object payload', () => {
      const key = nacl.randomBytes(32);
      const encrypted = encryptRelayPayload({}, key);
      expect(decryptRelayPayload(encrypted, key)).toEqual({});
    });

    test('handles large payload (10 KB)', () => {
      const key = nacl.randomBytes(32);
      const payload = { data: 'x'.repeat(10000) };

      const encrypted = encryptRelayPayload(payload, key);
      const decrypted = decryptRelayPayload(encrypted, key);
      expect(decrypted).toEqual(payload);
    });
  });

  // ─── Edge Cases ──────────────────────────────────────────────────────

  describe('Edge Cases', () => {
    test('encryptRelayPayload returns null for null payload', () => {
      const key = nacl.randomBytes(32);
      expect(encryptRelayPayload(null, key)).toBeNull();
    });

    test('encryptRelayPayload returns null for null key', () => {
      expect(encryptRelayPayload({ data: 1 }, null)).toBeNull();
    });

    test('encryptRelayPayload returns null for wrong-size key', () => {
      const shortKey = nacl.randomBytes(16);
      expect(encryptRelayPayload({ data: 1 }, shortKey)).toBeNull();
    });

    test('decryptRelayPayload returns null for null input', () => {
      const key = nacl.randomBytes(32);
      expect(decryptRelayPayload(null, key)).toBeNull();
    });

    test('decryptRelayPayload returns null for empty string', () => {
      const key = nacl.randomBytes(32);
      expect(decryptRelayPayload('', key)).toBeNull();
    });

    test('decryptRelayPayload returns null for truncated ciphertext', () => {
      const key = nacl.randomBytes(32);
      // Too short to contain nonce + overhead
      const short = uint8ToBase64(nacl.randomBytes(10));
      expect(decryptRelayPayload(short, key)).toBeNull();
    });

    test('decryptRelayPayload returns null for garbage base64', () => {
      const key = nacl.randomBytes(32);
      const garbage = uint8ToBase64(nacl.randomBytes(100));
      expect(decryptRelayPayload(garbage, key)).toBeNull();
    });
  });

  // ─── Server-Side Relay Forwarding ────────────────────────────────────

  describe('Server Relay Forwarding (opaque encrypted envelopes)', () => {
    /**
     * Simulate server-side handleRelayMessage behavior.
     * When client sends encryptedPayload, server wraps it in a relay envelope
     * without touching the encrypted data.
     */
    function simulateRelayMessage(msg, fromPeerId) {
      const { targetPeerId, payload, encryptedPayload } = msg;
      if (!targetPeerId || (!payload && !encryptedPayload)) return null;

      if (encryptedPayload) {
        return {
          type: 'relay-message',
          encryptedPayload,
          _fromPeerId: fromPeerId,
          _relayed: true,
        };
      } else {
        // Legacy: spread payload (backward compat)
        return {
          ...payload,
          _fromPeerId: fromPeerId,
          _relayed: true,
        };
      }
    }

    function simulateRelayBroadcast(msg, fromPeerId) {
      const { payload, encryptedPayload } = msg;
      if (!payload && !encryptedPayload) return null;

      if (encryptedPayload) {
        return {
          type: 'relay-broadcast',
          encryptedPayload,
          _fromPeerId: fromPeerId,
          _relayed: true,
        };
      } else {
        return {
          ...payload,
          _fromPeerId: fromPeerId,
          _relayed: true,
        };
      }
    }

    test('encrypted relay-message forwards opaque envelope', () => {
      const key = nacl.randomBytes(32);
      const payload = { type: 'chunk-request', chunkId: 42 };
      const encrypted = encryptRelayPayload(payload, key);

      const msg = {
        type: 'relay-message',
        targetPeerId: 'peer-b',
        encryptedPayload: encrypted,
      };

      const forwarded = simulateRelayMessage(msg, 'peer-a');

      expect(forwarded.type).toBe('relay-message');
      expect(forwarded.encryptedPayload).toBe(encrypted);
      expect(forwarded._fromPeerId).toBe('peer-a');
      expect(forwarded._relayed).toBe(true);

      // Recipient can decrypt
      const decrypted = decryptRelayPayload(forwarded.encryptedPayload, key);
      expect(decrypted).toEqual(payload);
    });

    test('encrypted relay-broadcast forwards opaque envelope', () => {
      const key = nacl.randomBytes(32);
      const payload = { type: 'heartbeat', ts: Date.now() };
      const encrypted = encryptRelayPayload(payload, key);

      const msg = {
        type: 'relay-broadcast',
        encryptedPayload: encrypted,
      };

      const forwarded = simulateRelayBroadcast(msg, 'peer-x');

      expect(forwarded.type).toBe('relay-broadcast');
      expect(forwarded.encryptedPayload).toBe(encrypted);
      expect(forwarded._fromPeerId).toBe('peer-x');

      const decrypted = decryptRelayPayload(forwarded.encryptedPayload, key);
      expect(decrypted).toEqual(payload);
    });

    test('legacy plaintext relay-message still works (backward compat)', () => {
      const payload = { type: 'old-client-msg', value: 123 };
      const msg = {
        type: 'relay-message',
        targetPeerId: 'peer-b',
        payload,
      };

      const forwarded = simulateRelayMessage(msg, 'peer-a');

      expect(forwarded.type).toBe('old-client-msg');
      expect(forwarded.value).toBe(123);
      expect(forwarded._fromPeerId).toBe('peer-a');
    });

    test('server cannot read encrypted relay payload', () => {
      const key = nacl.randomBytes(32);
      const sensitiveData = { type: 'sync-update', content: 'SECRET_CONTENT_123' };
      const encrypted = encryptRelayPayload(sensitiveData, key);

      // Server only sees the base64 blob — verify it doesn't contain plaintext
      expect(encrypted).not.toContain('SECRET_CONTENT_123');
      expect(encrypted).not.toContain('sync-update');

      // Server forwards it unchanged
      const forwarded = simulateRelayMessage(
        { type: 'relay-message', targetPeerId: 'peer-b', encryptedPayload: encrypted },
        'peer-a'
      );

      // The blob is opaque to the server
      expect(typeof forwarded.encryptedPayload).toBe('string');

      // But the intended recipient can decrypt it
      const decrypted = decryptRelayPayload(forwarded.encryptedPayload, key);
      expect(decrypted.content).toBe('SECRET_CONTENT_123');
    });

    test('rejects message with neither payload nor encryptedPayload', () => {
      expect(simulateRelayMessage({ targetPeerId: 'peer-b' }, 'peer-a')).toBeNull();
      expect(simulateRelayBroadcast({}, 'peer-a')).toBeNull();
    });
  });

  // ─── Combined Fix 4 + Fix 6 ─────────────────────────────────────────

  describe('Combined: Authenticated + Encrypted Relay', () => {
    test('full flow: derive auth token, validate join, send encrypted message', async () => {
      const workspaceKey = nacl.randomBytes(32);
      const topic = 'workspace-topic-hash';
      const roomId = `p2p:${topic}`;

      // Step 1: Derive auth token (Fix 4)
      const authToken = await (async () => {
        const message = `room-auth:${roomId}`;
        const hmac = crypto.createHmac('sha256', Buffer.from(workspaceKey));
        hmac.update(message);
        return hmac.digest('base64');
      })();

      // Step 2: Validate join (server-side)
      const validate = (() => {
        const tokens = new Map();
        return (room, token) => {
          if (!token) return tokens.has(room) ? { allowed: false } : { allowed: true };
          const existing = tokens.get(room);
          if (!existing) { tokens.set(room, token); return { allowed: true }; }
          return existing === token ? { allowed: true } : { allowed: false };
        };
      })();

      expect(validate(roomId, authToken).allowed).toBe(true); // registers
      expect(validate(roomId, authToken).allowed).toBe(true); // re-validates

      // Step 3: Send encrypted message (Fix 6)
      const payload = { type: 'sync-update', data: [1, 2, 3] };
      const encrypted = encryptRelayPayload(payload, workspaceKey);
      expect(typeof encrypted).toBe('string');

      // Step 4: Recipient decrypts
      const decrypted = decryptRelayPayload(encrypted, workspaceKey);
      expect(decrypted).toEqual(payload);
    });

    test('attacker with wrong key cannot auth or decrypt', async () => {
      const legitimateKey = nacl.randomBytes(32);
      const attackerKey = nacl.randomBytes(32);
      const roomId = 'p2p:target-room';

      // Legitimate client registers
      const realToken = crypto.createHmac('sha256', Buffer.from(legitimateKey))
        .update(`room-auth:${roomId}`).digest('base64');
      
      const validate = (() => {
        const tokens = new Map();
        return (room, token) => {
          if (!token) return tokens.has(room) ? { allowed: false } : { allowed: true };
          const existing = tokens.get(room);
          if (!existing) { tokens.set(room, token); return { allowed: true }; }
          return existing === token ? { allowed: true } : { allowed: false };
        };
      })();
      validate(roomId, realToken);

      // Attacker derives auth with wrong key
      const fakeToken = crypto.createHmac('sha256', Buffer.from(attackerKey))
        .update(`room-auth:${roomId}`).digest('base64');
      expect(validate(roomId, fakeToken).allowed).toBe(false);

      // Attacker intercepts encrypted message
      const payload = { type: 'private-data', value: 'secret' };
      const encrypted = encryptRelayPayload(payload, legitimateKey);

      // Attacker cannot decrypt
      const failed = decryptRelayPayload(encrypted, attackerKey);
      expect(failed).toBeNull();
    });
  });
});

// =============================================================================
// Fix 4 + Fix 6: Source Code Verification
// =============================================================================

describe('Fix 4 + Fix 6: Source Code Structure Verification', () => {
  const fs = require('fs');
  const path = require('path');

  const SERVER_PATH = path.join(__dirname, '..', 'server', 'unified', 'index.js');
  const ROOM_AUTH_PATH = path.join(__dirname, '..', 'frontend', 'src', 'utils', 'roomAuth.js');
  const WS_TRANSPORT_PATH = path.join(__dirname, '..', 'frontend', 'src', 'services', 'p2p', 'transports', 'WebSocketTransport.js');
  const WEBSOCKET_UTIL_PATH = path.join(__dirname, '..', 'frontend', 'src', 'utils', 'websocket.js');
  const P2P_ADAPTER_PATH = path.join(__dirname, '..', 'frontend', 'src', 'services', 'p2p', 'P2PWebSocketAdapter.js');
  const P2P_CONTEXT_PATH = path.join(__dirname, '..', 'frontend', 'src', 'contexts', 'P2PContext.jsx');

  function readSource(filePath) {
    return fs.readFileSync(filePath, 'utf-8');
  }

  describe('Server: validateRoomAuthToken', () => {
    test('server has roomAuthTokens Map', () => {
      const src = readSource(SERVER_PATH);
      expect(src).toContain('const roomAuthTokens = new Map()');
    });

    test('server has validateRoomAuthToken function', () => {
      const src = readSource(SERVER_PATH);
      expect(src).toContain('function validateRoomAuthToken(roomId, authToken)');
    });

    test('server uses timingSafeEqual for constant-time comparison', () => {
      const src = readSource(SERVER_PATH);
      expect(src).toContain('timingSafeEqual');
    });

    test('handleJoinTopic extracts authToken', () => {
      const src = readSource(SERVER_PATH);
      expect(src).toMatch(/handleJoinTopic[\s\S]*?authToken[\s\S]*?validateRoomAuthToken/);
    });

    test('handleJoin extracts authToken', () => {
      const src = readSource(SERVER_PATH);
      expect(src).toMatch(/handleJoin[\s\S]*?authToken[\s\S]*?validateRoomAuthToken/);
    });

    test('y-websocket handler checks auth query param', () => {
      const src = readSource(SERVER_PATH);
      expect(src).toContain("urlParams.get('auth')");
      expect(src).toContain('4403');
    });
  });

  describe('Server: Encrypted Relay Support', () => {
    test('handleRelayMessage supports encryptedPayload', () => {
      const src = readSource(SERVER_PATH);
      // Find the method definition (not the dispatch call)
      const pattern = /handleRelayMessage\s*\(ws,\s*info,\s*msg\)\s*\{/;
      const match = pattern.exec(src);
      expect(match).not.toBeNull();
      const section = src.slice(match.index, match.index + 3000);
      expect(section).toContain('encryptedPayload');
    });

    test('handleRelayBroadcast supports encryptedPayload', () => {
      const src = readSource(SERVER_PATH);
      const pattern = /handleRelayBroadcast\s*\(ws,\s*info,\s*msg\)\s*\{/;
      const match = pattern.exec(src);
      expect(match).not.toBeNull();
      const section = src.slice(match.index, match.index + 2000);
      expect(section).toContain('encryptedPayload');
    });
  });

  describe('Client: roomAuth.js module', () => {
    test('roomAuth.js exists and exports computeRoomAuthToken', () => {
      const src = readSource(ROOM_AUTH_PATH);
      expect(src).toContain('export async function computeRoomAuthToken');
    });

    test('roomAuth.js exports encryptRelayPayload', () => {
      const src = readSource(ROOM_AUTH_PATH);
      expect(src).toContain('export function encryptRelayPayload');
    });

    test('roomAuth.js exports decryptRelayPayload', () => {
      const src = readSource(ROOM_AUTH_PATH);
      expect(src).toContain('export function decryptRelayPayload');
    });

    test('uses HMAC-SHA256 with correct prefix', () => {
      const src = readSource(ROOM_AUTH_PATH);
      expect(src).toContain('room-auth:');
      expect(src).toContain('HMAC');
      expect(src).toContain('SHA-256');
    });

    test('uses NaCl secretbox for encryption', () => {
      const src = readSource(ROOM_AUTH_PATH);
      expect(src).toContain('nacl.secretbox(');
      expect(src).toContain('nacl.secretbox.open(');
      expect(src).toContain('nacl.randomBytes(nacl.secretbox.nonceLength)');
    });
  });

  describe('Client: WebSocketTransport encryption', () => {
    test('WebSocketTransport imports encrypt/decrypt from roomAuth', () => {
      const src = readSource(WS_TRANSPORT_PATH);
      expect(src).toContain('encryptRelayPayload');
      expect(src).toContain('decryptRelayPayload');
      expect(src).toContain('roomAuth');
    });

    test('WebSocketTransport has workspaceKey field', () => {
      const src = readSource(WS_TRANSPORT_PATH);
      expect(src).toContain('workspaceKey');
    });

    test('WebSocketTransport has authToken field', () => {
      const src = readSource(WS_TRANSPORT_PATH);
      expect(src).toContain('authToken');
    });
  });

  describe('Client: P2PWebSocketAdapter passes auth options', () => {
    test('adapter accepts authToken option', () => {
      const src = readSource(P2P_ADAPTER_PATH);
      expect(src).toContain('authToken');
    });

    test('adapter accepts workspaceKey option', () => {
      const src = readSource(P2P_ADAPTER_PATH);
      expect(src).toContain('workspaceKey');
    });
  });

  describe('Client: P2PContext passes auth options', () => {
    test('getWebSocketFactory passes authToken', () => {
      const src = readSource(P2P_CONTEXT_PATH);
      expect(src).toContain('authToken: options.authToken');
    });

    test('getWebSocketFactory passes workspaceKey', () => {
      const src = readSource(P2P_CONTEXT_PATH);
      expect(src).toContain('workspaceKey: options.workspaceKey');
    });
  });

  describe('Client: websocket.js auth support', () => {
    test('getYjsWebSocketUrl accepts authToken parameter', () => {
      const src = readSource(WEBSOCKET_UTIL_PATH);
      expect(src).toMatch(/getYjsWebSocketUrl\(.*authToken/);
    });

    test('auth token appended as URL query parameter', () => {
      const src = readSource(WEBSOCKET_UTIL_PATH);
      expect(src).toContain('appendAuth');
      expect(src).toContain('auth=');
    });

    test('computeRoomAuthToken is re-exported', () => {
      const src = readSource(WEBSOCKET_UTIL_PATH);
      expect(src).toContain('computeRoomAuthToken');
    });

    test('computeRoomAuthTokenSync is re-exported', () => {
      const src = readSource(WEBSOCKET_UTIL_PATH);
      expect(src).toContain('computeRoomAuthTokenSync');
      expect(src).toMatch(/export\s*\{[^}]*computeRoomAuthTokenSync/);
    });
  });

  describe('Client: AppNew.jsx document-room auth', () => {
    const APP_PATH = path.join(__dirname, '..', 'frontend', 'src', 'AppNew.jsx');

    test('imports computeRoomAuthTokenSync', () => {
      const src = readSource(APP_PATH);
      expect(src).toContain('computeRoomAuthTokenSync');
    });

    test('creates auth token for document rooms', () => {
      const src = readSource(APP_PATH);
      // Both createDocument and openDocument paths should compute docAuthToken
      // v1.7.29: uses authKey (workspace key) instead of sessionKey for cross-client auth
      const matches = src.match(/computeRoomAuthTokenSync\(authKey,\s*docId\)/g);
      expect(matches).not.toBeNull();
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    test('passes auth token to getWsUrl', () => {
      const src = readSource(APP_PATH);
      // Both call sites should pass docAuthToken to getWsUrl
      const matches = src.match(/getWsUrl\(workspaceServerUrl,\s*docAuthToken\)/g);
      expect(matches).not.toBeNull();
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Client: useWorkspaceSync.js auth', () => {
    const SYNC_PATH = path.join(__dirname, '..', 'frontend', 'src', 'hooks', 'useWorkspaceSync.js');

    test('imports computeRoomAuthTokenSync', () => {
      const src = readSource(SYNC_PATH);
      expect(src).toContain('computeRoomAuthTokenSync');
    });

    test('passes auth token to getYjsWebSocketUrl', () => {
      const src = readSource(SYNC_PATH);
      expect(src).toMatch(/getYjsWebSocketUrl\(serverUrl,\s*ywsAuthToken\)/);
    });
  });
});
