/**
 * Room Authentication Utilities
 * 
 * Provides HMAC-SHA256 based authentication tokens for room/topic joins.
 * Clients compute an auth token from their workspace encryption key to prove
 * they hold the key without revealing it. The server stores the first token
 * it sees per room (first-write-wins) and validates subsequent joins.
 * 
 * This module also provides NaCl secretbox encryption/decryption for relay
 * message payloads (Fix 6: encrypted relay messages).
 * 
 * Security model:
 * - Auth token = HMAC-SHA256(workspaceKey, "room-auth:" + roomOrTopic)
 * - Server can't derive the workspace key from the token (HMAC is one-way)
 * - The token binds the room to a specific workspace key
 * - Once a room has a registered token, unauthenticated joins are blocked
 */

import nacl from 'tweetnacl';

// ─── HMAC-SHA256 Auth Token ───────────────────────────────────────────────────

/**
 * Compute an HMAC-SHA256 auth token for a room.
 * Uses Web Crypto API (browser) with Node.js crypto fallback (tests).
 * 
 * @param {Uint8Array|string} workspaceKey - 32-byte workspace encryption key (or base64 string)
 * @param {string} roomOrTopic - The room name or topic hash to authenticate against
 * @returns {Promise<string>} Base64-encoded HMAC-SHA256 token
 */
export async function computeRoomAuthToken(workspaceKey, roomOrTopic) {
  if (!workspaceKey || !roomOrTopic) return null;

  // Normalize key to Uint8Array
  let keyBytes;
  if (typeof workspaceKey === 'string') {
    // Base64-encoded key
    keyBytes = Uint8Array.from(atob(workspaceKey), c => c.charCodeAt(0));
  } else if (workspaceKey instanceof Uint8Array) {
    keyBytes = workspaceKey;
  } else {
    return null;
  }

  const message = `room-auth:${roomOrTopic}`;
  const encoder = new TextEncoder();
  const messageBytes = encoder.encode(message);

  // Try Web Crypto API first (browser/Electron)
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const cryptoKey = await crypto.subtle.importKey(
        'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
      );
      const sig = await crypto.subtle.sign('HMAC', cryptoKey, messageBytes);
      return uint8ToBase64(new Uint8Array(sig));
    } catch {
      // Fall through to Node.js fallback
    }
  }

  // Node.js fallback (for tests)
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    try {
      const cryptoKey = await globalThis.crypto.subtle.importKey(
        'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
      );
      const sig = await globalThis.crypto.subtle.sign('HMAC', cryptoKey, messageBytes);
      return uint8ToBase64(new Uint8Array(sig));
    } catch {
      // Fall through
    }
  }

  // Final fallback: use Node.js crypto module (test environments)
  try {
    const { createHmac } = await import('crypto');
    const hmac = createHmac('sha256', Buffer.from(keyBytes));
    hmac.update(message);
    return hmac.digest('base64');
  } catch {
    console.warn('[RoomAuth] No HMAC implementation available');
    return null;
  }
}

// ─── Relay Message Encryption (Fix 6) ─────────────────────────────────────────

/**
 * Encrypt a relay message payload using NaCl secretbox.
 * Uses the workspace encryption key so only members who hold the key can read relay payloads.
 * 
 * @param {object} payload - The message payload to encrypt
 * @param {Uint8Array} workspaceKey - 32-byte workspace encryption key
 * @returns {string|null} Base64-encoded encrypted payload (nonce + ciphertext), or null on failure
 */
export function encryptRelayPayload(payload, workspaceKey) {
  if (!payload || !workspaceKey || workspaceKey.length !== 32) return null;
  try {
    const json = JSON.stringify(payload);
    const messageBytes = new TextEncoder().encode(json);
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const encrypted = nacl.secretbox(messageBytes, nonce, workspaceKey);
    // Concatenate nonce + ciphertext
    const combined = new Uint8Array(nonce.length + encrypted.length);
    combined.set(nonce, 0);
    combined.set(encrypted, nonce.length);
    return uint8ToBase64(combined);
  } catch (e) {
    console.warn('[RoomAuth] Failed to encrypt relay payload:', e.message);
    return null;
  }
}

/**
 * Decrypt a relay message payload using NaCl secretbox.
 * 
 * @param {string} encryptedBase64 - Base64-encoded encrypted payload (nonce + ciphertext)
 * @param {Uint8Array} workspaceKey - 32-byte workspace encryption key
 * @returns {object|null} The decrypted message payload, or null on failure
 */
export function decryptRelayPayload(encryptedBase64, workspaceKey) {
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
    const json = new TextDecoder().decode(decrypted);
    return JSON.parse(json);
  } catch (e) {
    console.warn('[RoomAuth] Failed to decrypt relay payload:', e.message);
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert Uint8Array to base64 string */
function uint8ToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Convert base64 string to Uint8Array */
function base64ToUint8(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
