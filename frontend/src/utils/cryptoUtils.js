/**
 * Cryptographic Utilities
 * 
 * Security-hardened cryptographic helper functions.
 * Provides timing-safe comparisons, memory wiping, and input validation.
 */

import nacl from 'tweetnacl';

/**
 * Timing-safe comparison of two byte arrays
 * Prevents timing attacks by ensuring constant-time comparison
 * 
 * @param {Uint8Array} a - First array
 * @param {Uint8Array} b - Second array
 * @returns {boolean} True if arrays are equal
 */
export function timingSafeEqual(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) {
    return false;
  }
  
  const aLen = a.length;
  const bLen = b.length;
  // Compare against b or a zero-filled dummy to maintain constant time
  if (aLen !== bLen) b = new Uint8Array(aLen);
  
  let result = 0;
  for (let i = 0; i < aLen; i++) {
    result |= a[i] ^ b[i];
  }
  
  return result === 0 && aLen === bLen;
}

/**
 * Timing-safe comparison of two strings
 * 
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} True if strings are equal
 */
export function timingSafeStringEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  
  return timingSafeEqual(aBytes, bBytes);
}

/**
 * Securely wipe sensitive data from a Uint8Array
 * Overwrites with random data then zeros to prevent recovery
 * 
 * @param {Uint8Array} data - Array to wipe
 */
export function secureWipe(data) {
  if (!(data instanceof Uint8Array)) {
    return;
  }
  
  try {
    // First pass: overwrite with random data
    const random = nacl.randomBytes(data.length);
    for (let i = 0; i < data.length; i++) {
      data[i] = random[i];
    }
    
    // Second pass: overwrite with zeros
    for (let i = 0; i < data.length; i++) {
      data[i] = 0;
    }
    
    // Third pass: overwrite with 0xFF
    for (let i = 0; i < data.length; i++) {
      data[i] = 0xFF;
    }
    
    // Final pass: zeros
    for (let i = 0; i < data.length; i++) {
      data[i] = 0;
    }
  } catch {
    // Silently fail - data may be frozen or detached
  }
}

/**
 * Securely wipe a string by overwriting the character array
 * Note: JavaScript strings are immutable, this creates a sanitized copy reference
 * Best effort - actual memory clearing depends on GC
 * 
 * @param {Object} obj - Object containing the string property to wipe
 * @param {string} key - Property key to wipe
 */
export function secureWipeString(obj, key) {
  if (obj && typeof obj[key] === 'string') {
    // Replace with empty string to allow GC of original
    obj[key] = '';
  }
}

/**
 * Validate a hex string
 * 
 * @param {string} hex - String to validate
 * @returns {boolean} True if valid hex string
 */
export function isValidHex(hex) {
  if (typeof hex !== 'string') return false;
  return /^[0-9a-fA-F]*$/.test(hex) && hex.length % 2 === 0;
}

/**
 * Convert a hex string to Uint8Array
 * 
 * @param {string} hex - Hex string to convert
 * @returns {Uint8Array} Byte array
 */
export function hexToBytes(hex) {
  if (!isValidHex(hex)) {
    throw new Error(`Invalid hex string: expected even-length hex characters`);
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Convert a hex string to a NaCl secretbox key (32 bytes) with length validation
 * 
 * @param {string} hex - Hex string to convert (must be 64 hex chars = 32 bytes)
 * @param {number} expectedLength - Expected key length in bytes (default: 32)
 * @returns {Uint8Array} Key bytes
 * @throws {Error} If resulting key is not the expected length
 */
export function hexToKey(hex, expectedLength = nacl.secretbox.keyLength) {
  const bytes = hexToBytes(hex);
  if (bytes.length !== expectedLength) {
    throw new Error(
      `Invalid key length: expected ${expectedLength} bytes but got ${bytes.length} bytes (from ${hex.length} hex chars)`
    );
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string
 * 
 * @param {Uint8Array} bytes - Byte array to convert
 * @returns {string} Hex string
 */
export function bytesToHex(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('Expected Uint8Array');
  }
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Validate that a key is the correct length and type
 * 
 * @param {Uint8Array} key - Key to validate
 * @param {number} expectedLength - Expected key length (default: 32 for NaCl secretbox)
 * @returns {boolean} True if key is valid
 */
export function isValidKey(key, expectedLength = nacl.secretbox.keyLength) {
  return (
    key instanceof Uint8Array &&
    key.length === expectedLength &&
    !key.every(b => b === 0) // Not all zeros
  );
}

/**
 * Validate that a nonce is the correct length and type
 * 
 * @param {Uint8Array} nonce - Nonce to validate
 * @returns {boolean} True if nonce is valid
 */
export function isValidNonce(nonce) {
  return (
    nonce instanceof Uint8Array &&
    nonce.length === nacl.secretbox.nonceLength
  );
}

/**
 * Generate a cryptographically secure random key
 * 
 * @param {number} length - Key length in bytes (default: 32)
 * @returns {Uint8Array} Random key
 */
export function generateSecureKey(length = nacl.secretbox.keyLength) {
  return nacl.randomBytes(length);
}

/**
 * Generate a cryptographically secure nonce
 * 
 * @returns {Uint8Array} Random nonce
 */
export function generateSecureNonce() {
  return nacl.randomBytes(nacl.secretbox.nonceLength);
}

/**
 * Constant-time conditional select
 * Returns a if condition is true, b otherwise
 * Prevents timing attacks on conditional operations
 * 
 * @param {number} condition - 1 for true, 0 for false
 * @param {number} a - Value if true
 * @param {number} b - Value if false
 * @returns {number} Selected value
 */
export function constantTimeSelect(condition, a, b) {
  // Ensure condition is 0 or 1
  condition = condition ? 1 : 0;
  
  // Use bitwise operations for constant-time selection
  // mask is all 1s if condition is 1, all 0s if condition is 0
  const mask = -condition;
  return (a & mask) | (b & ~mask);
}

/**
 * Safe JSON parse with prototype pollution protection
 * 
 * @param {string} json - JSON string to parse
 * @param {*} defaultValue - Default value if parse fails
 * @returns {*} Parsed object or default value
 */
export function safeJsonParse(json, defaultValue = null) {
  if (typeof json !== 'string') {
    return defaultValue;
  }
  
  try {
    const parsed = JSON.parse(json);
    
    // Protect against prototype pollution
    if (parsed && typeof parsed === 'object') {
      return sanitizeObject(parsed);
    }
    
    return parsed;
  } catch {
    return defaultValue;
  }
}

/**
 * Recursively sanitize an object to prevent prototype pollution
 * Removes __proto__, constructor, and prototype properties
 * 
 * @param {Object} obj - Object to sanitize
 * @param {Set} seen - Set of already processed objects (for cycle detection)
 * @returns {Object} Sanitized object
 */
export function sanitizeObject(obj, seen = new Set()) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  // Detect cycles
  if (seen.has(obj)) {
    return obj;
  }
  seen.add(obj);
  
  // Handle arrays - return new array
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, seen));
  }
  
  // Clone object, skipping dangerous properties
  const dangerous = ['__proto__', 'constructor', 'prototype'];
  const clone = {};
  for (const key of Object.keys(obj)) {
    if (dangerous.includes(key)) continue;
    clone[key] = (typeof obj[key] === 'object' && obj[key] !== null)
      ? sanitizeObject(obj[key], seen)
      : obj[key];
  }
  
  return clone;
}

/**
 * Validate and sanitize a document/workspace ID
 * Prevents path traversal and injection attacks
 * 
 * @param {string} id - ID to validate
 * @returns {string|null} Sanitized ID or null if invalid
 */
export function sanitizeId(id) {
  if (typeof id !== 'string') {
    return null;
  }
  
  // Trim whitespace
  id = id.trim();
  
  // Check length bounds
  if (id.length === 0 || id.length > 256) {
    return null;
  }
  
  // Only allow safe characters: alphanumeric, dash, underscore, dot
  // Reject path traversal attempts
  const safePattern = /^[a-zA-Z0-9_\-\.]+$/;
  if (!safePattern.test(id)) {
    return null;
  }
  
  // Reject path traversal patterns
  if (id.includes('..') || id.includes('./') || id.includes('/.')) {
    return null;
  }
  
  return id;
}

/**
 * Validate URL to prevent open redirect and SSRF attacks
 * 
 * @param {string} url - URL to validate
 * @param {string[]} allowedProtocols - Allowed protocols (default: ['https:'])
 * @param {string[]} allowedHosts - Allowed hosts (empty = allow all)
 * @returns {boolean} True if URL is safe
 */
export function isValidUrl(url, allowedProtocols = ['https:'], allowedHosts = []) {
  try {
    const parsed = new URL(url);
    
    // Check protocol
    if (!allowedProtocols.includes(parsed.protocol)) {
      return false;
    }
    
    // Check host if allowlist provided
    if (allowedHosts.length > 0 && !allowedHosts.includes(parsed.host)) {
      return false;
    }
    
    // Normalize hostname - remove IPv6 brackets and strip IPv6-mapped IPv4 prefix
    let hostname = parsed.hostname.replace(/^\[|\]$/g, '');
    hostname = hostname.replace(/^::ffff:/i, '');
    
    // Reject localhost/internal IPs in production
    const blockedPatterns = [
      /^localhost$/i,
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^::1$/,
      /^0\.0\.0\.0$/,
      /^169\.254\./,  // Link-local
    ];
    
    for (const pattern of blockedPatterns) {
      if (pattern.test(hostname)) {
        return false;
      }
    }
    
    return true;
  } catch {
    return false;
  }
}

/**
 * Rate limiter for client-side operations
 * Prevents brute force attempts on sensitive operations
 */
export class ClientRateLimiter {
  constructor(maxAttempts = 5, windowMs = 60000, lockoutMs = 300000) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
    this.lockoutMs = lockoutMs;
    this.attempts = [];
    this.lockedUntil = 0;
  }
  
  /**
   * Check if operation is allowed
   * @returns {Object} { allowed: boolean, remainingAttempts: number, lockedFor: number }
   */
  check() {
    const now = Date.now();
    
    // Check if locked out
    if (now < this.lockedUntil) {
      return {
        allowed: false,
        remainingAttempts: 0,
        lockedFor: this.lockedUntil - now
      };
    }
    
    // Remove old attempts outside window
    this.attempts = this.attempts.filter(t => now - t < this.windowMs);
    
    const remaining = Math.max(0, this.maxAttempts - this.attempts.length);
    
    return {
      allowed: remaining > 0,
      remainingAttempts: remaining,
      lockedFor: 0
    };
  }
  
  /**
   * Record an attempt
   */
  recordAttempt() {
    const now = Date.now();
    this.attempts.push(now);
    
    // Clean old attempts
    this.attempts = this.attempts.filter(t => now - t < this.windowMs);
    
    // Trigger lockout if exceeded
    if (this.attempts.length >= this.maxAttempts) {
      this.lockedUntil = now + this.lockoutMs;
    }
  }
  
  /**
   * Reset after successful authentication
   */
  reset() {
    this.attempts = [];
    this.lockedUntil = 0;
  }
}

// Freeze exports to prevent tampering
Object.freeze(ClientRateLimiter.prototype);

export default Object.freeze({
  timingSafeEqual,
  timingSafeStringEqual,
  secureWipe,
  secureWipeString,
  isValidKey,
  isValidNonce,
  isValidHex,
  hexToBytes,
  hexToKey,
  bytesToHex,
  generateSecureKey,
  generateSecureNonce,
  constantTimeSelect,
  safeJsonParse,
  sanitizeObject,
  sanitizeId,
  isValidUrl,
  ClientRateLimiter
});
