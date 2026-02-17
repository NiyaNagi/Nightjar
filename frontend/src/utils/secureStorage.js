/**
 * Secure Storage Utility
 * 
 * Provides encrypted storage for sensitive data in localStorage.
 * Uses session-derived keys to encrypt data at rest.
 * 
 * WARNING: This provides defense-in-depth but localStorage is inherently
 * vulnerable to XSS attacks. The Electron app uses secure OS keychain storage.
 * This is a fallback for web/dev mode only.
 */

import nacl from 'tweetnacl';

// Storage key prefix
const STORAGE_PREFIX = 'Nightjar_secure_';

// Session encryption key (derived from a random value per browser session)
let sessionKey = null;

/**
 * Initialize the session encryption key
 * This key is held in memory and lost when the page is closed
 */
function ensureSessionKey() {
  if (sessionKey) return sessionKey;
  
  // Check if we have a session key in sessionStorage (survives page refresh within tab)
  const storedKey = sessionStorage.getItem('Nightjar_session_enc_key');
  if (storedKey) {
    try {
      sessionKey = new Uint8Array(JSON.parse(storedKey));
      return sessionKey;
    } catch {
      // Invalid stored key, generate new one
    }
  }
  
  // Generate new session key
  sessionKey = nacl.randomBytes(nacl.secretbox.keyLength);
  
  // Store in sessionStorage (cleared when browser/tab closes)
  sessionStorage.setItem('Nightjar_session_enc_key', JSON.stringify(Array.from(sessionKey)));
  
  return sessionKey;
}

/**
 * Encrypt data using session key
 * @param {string} plaintext - Data to encrypt
 * @returns {string} Encrypted data as base64
 */
function encrypt(plaintext) {
  const key = ensureSessionKey();
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const messageBytes = new TextEncoder().encode(plaintext);
  const encrypted = nacl.secretbox(messageBytes, nonce, key);
  
  // Combine nonce + ciphertext
  const combined = new Uint8Array(nonce.length + encrypted.length);
  combined.set(nonce);
  combined.set(encrypted, nonce.length);
  
  // Return as base64 (use loop to avoid stack overflow on large data)
  let binary = '';
  for (let i = 0; i < combined.length; i++) binary += String.fromCharCode(combined[i]);
  return btoa(binary);
}

/**
 * Decrypt data using session key
 * @param {string} ciphertext - Encrypted data as base64
 * @returns {string|null} Decrypted data or null if failed
 */
function decrypt(ciphertext) {
  try {
    const key = ensureSessionKey();
    
    // Decode from base64
    const combined = new Uint8Array(
      atob(ciphertext).split('').map(c => c.charCodeAt(0))
    );
    
    // Validate minimum length
    if (combined.length < nacl.secretbox.nonceLength + nacl.secretbox.overheadLength) {
      return null;
    }
    
    // Extract nonce and ciphertext
    const nonce = combined.slice(0, nacl.secretbox.nonceLength);
    const encrypted = combined.slice(nacl.secretbox.nonceLength);
    
    // Decrypt
    const decrypted = nacl.secretbox.open(encrypted, nonce, key);
    if (!decrypted) return null;
    
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

/**
 * Securely wipe a Uint8Array
 * @param {Uint8Array} data - Data to wipe
 */
function secureWipe(data) {
  if (!(data instanceof Uint8Array)) return;
  try {
    const random = nacl.randomBytes(data.length);
    for (let i = 0; i < data.length; i++) data[i] = random[i];
    for (let i = 0; i < data.length; i++) data[i] = 0;
  } catch {
    // Silently fail
  }
}

/**
 * Sanitize object to prevent prototype pollution
 * @param {Object} obj - Object to sanitize
 * @returns {Object} Sanitized object
 */
function sanitizeObject(obj, seen = new Set()) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (seen.has(obj)) return obj;
  seen.add(obj);
  
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      obj[i] = sanitizeObject(obj[i], seen);
    }
    return obj;
  }
  
  const dangerous = ['__proto__', 'constructor', 'prototype'];
  for (const prop of dangerous) {
    if (Object.prototype.hasOwnProperty.call(obj, prop)) {
      delete obj[prop];
    }
  }
  
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      obj[key] = sanitizeObject(obj[key], seen);
    }
  }
  
  return obj;
}

/**
 * Store sensitive data securely (encrypted in localStorage)
 * @param {string} key - Storage key
 * @param {any} value - Value to store (will be JSON serialized)
 */
export function secureSet(key, value) {
  if (typeof key !== 'string' || key.length === 0) {
    console.error('[SecureStorage] Invalid key');
    return;
  }
  
  const json = JSON.stringify(value);
  const encrypted = encrypt(json);
  localStorage.setItem(STORAGE_PREFIX + key, encrypted);
}

/**
 * Retrieve sensitive data (decrypted from localStorage)
 * @param {string} key - Storage key
 * @returns {any|null} Decrypted and parsed value, or null if not found/failed
 */
export function secureGet(key) {
  if (typeof key !== 'string' || key.length === 0) {
    return null;
  }
  
  const encrypted = localStorage.getItem(STORAGE_PREFIX + key);
  if (!encrypted) return null;
  
  const decrypted = decrypt(encrypted);
  if (!decrypted) {
    // Decryption failed (session key changed), remove invalid data
    localStorage.removeItem(STORAGE_PREFIX + key);
    return null;
  }
  
  try {
    const parsed = JSON.parse(decrypted);
    // Sanitize to prevent prototype pollution
    return sanitizeObject(parsed);
  } catch {
    return null;
  }
}

/**
 * Remove sensitive data from storage
 * @param {string} key - Storage key
 */
export function secureRemove(key) {
  localStorage.removeItem(STORAGE_PREFIX + key);
}

/**
 * Check if a secure storage key exists
 * @param {string} key - Storage key
 * @returns {boolean}
 */
export function secureHas(key) {
  return localStorage.getItem(STORAGE_PREFIX + key) !== null;
}

/**
 * Clear all secure storage
 */
export function secureClear() {
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_PREFIX)) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(key => localStorage.removeItem(key));
  
  // Also clear session key
  sessionStorage.removeItem('Nightjar_session_enc_key');
  sessionKey = null;
}

/**
 * Migrate unencrypted data to encrypted storage
 * @param {string} oldKey - Old unencrypted localStorage key
 * @param {string} newKey - New secure storage key
 * @returns {boolean} True if migration occurred
 */
export function migrateToSecure(oldKey, newKey) {
  const oldData = localStorage.getItem(oldKey);
  if (oldData === null) return false;
  
  try {
    const parsed = JSON.parse(oldData);
    secureSet(newKey, parsed);
    localStorage.removeItem(oldKey); // Remove unencrypted version
    return true;
  } catch {
    return false;
  }
}

// Default export
const secureStorage = {
  set: secureSet,
  get: secureGet,
  remove: secureRemove,
  has: secureHas,
  clear: secureClear,
  migrate: migrateToSecure,
};

export default secureStorage;
