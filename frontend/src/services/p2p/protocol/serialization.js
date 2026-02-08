/**
 * P2P Protocol Serialization
 * 
 * Handles encoding/decoding of messages and encryption.
 */

import { toString as uint8ArrayToString, fromString as uint8ArrayFromString } from 'uint8arrays';

// ============ Encoding Helpers ============

/**
 * Encode a message to string for transmission
 * @param {Object} message - Message object
 * @returns {string} JSON string
 */
export function encodeMessage(message) {
  return JSON.stringify(message);
}

/**
 * Decode a message string
 * @param {string|ArrayBuffer|Uint8Array} data - Encoded message
 * @returns {Object|null} Decoded message or null if invalid
 */
export function decodeMessage(data) {
  try {
    if (typeof data === 'string') {
      return JSON.parse(data);
    }
    if (data instanceof ArrayBuffer) {
      return JSON.parse(new TextDecoder().decode(data));
    }
    if (data instanceof Uint8Array) {
      return JSON.parse(new TextDecoder().decode(data));
    }
    return null;
  } catch (e) {
    console.error('[P2P] Failed to decode message:', e);
    return null;
  }
}

/**
 * Encode binary data to base64
 * @param {Uint8Array|string} data - Data to encode
 * @returns {string|null} Base64 string
 */
export function encodeBase64(data) {
  if (data instanceof Uint8Array) {
    return uint8ArrayToString(data, 'base64');
  }
  if (typeof data === 'string') {
    return btoa(data);
  }
  return null;
}

/**
 * Decode base64 to Uint8Array
 * @param {string} base64 - Base64 string
 * @returns {Uint8Array|null} Decoded bytes
 */
export function decodeBase64(base64) {
  try {
    return uint8ArrayFromString(base64, 'base64');
  } catch (e) {
    console.error('[P2P] Failed to decode base64:', e);
    return null;
  }
}

// ============ Topic Generation ============

/**
 * Workspace topic prefix - MUST match sidecar/mesh-constants.js
 * Full topic = SHA256(WORKSPACE_TOPIC_PREFIX + workspaceId)
 */
const WORKSPACE_TOPIC_PREFIX = 'nightjar-workspace:';

/**
 * Generate a Hyperswarm topic from workspace ID
 * IMPORTANT: Must use 'nightjar-workspace:' prefix to match sidecar/mesh-constants.js
 * @param {string} workspaceId - Workspace ID
 * @returns {Promise<string>} 32-byte hex topic
 */
export async function generateTopic(workspaceId) {
  const encoder = new TextEncoder();
  // CRITICAL: Use the same formula as sidecar/mesh-constants.js getWorkspaceTopic()
  const data = encoder.encode(WORKSPACE_TOPIC_PREFIX + workspaceId);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return uint8ArrayToString(hashArray, 'hex');
}

/**
 * Generate a unique peer ID
 * @returns {string} 16-byte hex peer ID
 */
export function generatePeerId() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return uint8ArrayToString(array, 'hex');
}

// ============ Encryption Helpers ============

/**
 * Encrypt data with workspace key using AES-GCM
 * @param {string} data - Data to encrypt
 * @param {Uint8Array} key - 32-byte encryption key
 * @returns {Promise<string|null>} Base64-encoded IV + ciphertext
 */
export async function encryptData(data, key) {
  if (!key) return data; // No encryption if no key
  
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encodedData = new TextEncoder().encode(data);
    
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );
    
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      encodedData
    );
    
    // Combine IV + encrypted data
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);
    
    return encodeBase64(combined);
  } catch (e) {
    console.error('[P2P] Encryption failed:', e);
    return null;
  }
}

/**
 * Decrypt data with workspace key using AES-GCM
 * @param {string} encryptedBase64 - Base64-encoded IV + ciphertext
 * @param {Uint8Array} key - 32-byte encryption key
 * @returns {Promise<string|null>} Decrypted string
 */
export async function decryptData(encryptedBase64, key) {
  if (!key) return encryptedBase64; // No decryption if no key
  
  try {
    const combined = decodeBase64(encryptedBase64);
    if (!combined) return null;
    
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);
    
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );
    
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      encrypted
    );
    
    return new TextDecoder().decode(decrypted);
  } catch (e) {
    console.error('[P2P] Decryption failed:', e);
    return null;
  }
}

/**
 * Encode Y.js update to base64 for transmission
 * @param {Uint8Array} update - Y.js update
 * @returns {string} Base64-encoded update
 */
export function encodeYjsUpdate(update) {
  return uint8ArrayToString(update, 'base64');
}

/**
 * Decode base64 to Y.js update
 * @param {string} base64 - Base64-encoded update
 * @returns {Uint8Array} Y.js update
 */
export function decodeYjsUpdate(base64) {
  return uint8ArrayFromString(base64, 'base64');
}
