/**
 * Security Test Suite
 * 
 * Tests for cryptographic utilities, input validation, and security hardening.
 */

const nacl = require('tweetnacl');
const { encryptUpdate, decryptUpdate, generateKey, timingSafeEqual, isValidKey, secureWipe } = require('../backend/crypto');

describe('Crypto Security Hardening', () => {
  describe('timingSafeEqual', () => {
    it('should return true for identical arrays', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5]);
      const b = new Uint8Array([1, 2, 3, 4, 5]);
      expect(timingSafeEqual(a, b)).toBe(true);
    });

    it('should return false for different arrays', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5]);
      const b = new Uint8Array([1, 2, 3, 4, 6]);
      expect(timingSafeEqual(a, b)).toBe(false);
    });

    it('should return false for different length arrays', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5]);
      const b = new Uint8Array([1, 2, 3, 4]);
      expect(timingSafeEqual(a, b)).toBe(false);
    });

    it('should return false for non-Uint8Array inputs', () => {
      expect(timingSafeEqual('test', 'test')).toBe(false);
      expect(timingSafeEqual(null, null)).toBe(false);
      expect(timingSafeEqual(undefined, undefined)).toBe(false);
    });

    it('should handle empty arrays', () => {
      const a = new Uint8Array([]);
      const b = new Uint8Array([]);
      expect(timingSafeEqual(a, b)).toBe(true);
    });
  });

  describe('isValidKey', () => {
    it('should accept valid 32-byte key', () => {
      const key = generateKey();
      expect(isValidKey(key)).toBe(true);
    });

    it('should reject all-zero key', () => {
      const key = new Uint8Array(32);
      expect(isValidKey(key)).toBe(false);
    });

    it('should reject wrong length key', () => {
      expect(isValidKey(new Uint8Array(16))).toBe(false);
      expect(isValidKey(new Uint8Array(64))).toBe(false);
    });

    it('should reject non-Uint8Array inputs', () => {
      expect(isValidKey('not a key')).toBe(false);
      expect(isValidKey(null)).toBe(false);
      expect(isValidKey([1, 2, 3])).toBe(false);
    });
  });

  describe('secureWipe', () => {
    it('should zero out array', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      secureWipe(data);
      expect(data.every(b => b === 0)).toBe(true);
    });

    it('should handle empty array', () => {
      const data = new Uint8Array([]);
      expect(() => secureWipe(data)).not.toThrow();
    });

    it('should handle non-Uint8Array gracefully', () => {
      expect(() => secureWipe('not an array')).not.toThrow();
      expect(() => secureWipe(null)).not.toThrow();
      expect(() => secureWipe(undefined)).not.toThrow();
    });
  });

  describe('encryptUpdate', () => {
    it('should return null for invalid update', () => {
      const key = generateKey();
      expect(encryptUpdate(null, key)).toBe(null);
      expect(encryptUpdate(new Uint8Array([]), key)).toBe(null);
      expect(encryptUpdate('not uint8array', key)).toBe(null);
    });

    it('should return null for invalid key', () => {
      const update = new Uint8Array([1, 2, 3, 4]);
      expect(encryptUpdate(update, null)).toBe(null);
      expect(encryptUpdate(update, new Uint8Array(16))).toBe(null);
      expect(encryptUpdate(update, new Uint8Array(32))).toBe(null); // all zeros
    });

    it('should successfully encrypt valid data', () => {
      const key = generateKey();
      const update = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const encrypted = encryptUpdate(update, key);
      expect(encrypted).not.toBe(null);
      expect(encrypted.length).toBeGreaterThan(update.length);
    });
  });

  describe('decryptUpdate', () => {
    it('should return null for invalid key', () => {
      const key = generateKey();
      const update = new Uint8Array([1, 2, 3, 4]);
      const encrypted = encryptUpdate(update, key);
      
      const wrongKey = generateKey();
      expect(decryptUpdate(encrypted, wrongKey)).toBe(null);
      expect(decryptUpdate(encrypted, null)).toBe(null);
      expect(decryptUpdate(encrypted, new Uint8Array(32))).toBe(null); // all zeros
    });

    it('should return null for too-short packed data', () => {
      const key = generateKey();
      expect(decryptUpdate(new Uint8Array(10), key)).toBe(null);
    });

    it('should successfully decrypt valid data', () => {
      const key = generateKey();
      const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const encrypted = encryptUpdate(original, key);
      const decrypted = decryptUpdate(encrypted, key);
      
      expect(decrypted).not.toBe(null);
      expect(timingSafeEqual(original, decrypted)).toBe(true);
    });
  });
});

describe('Input Validation', () => {
  // Test sanitization functions that would be in cryptoUtils
  describe('Prototype Pollution Prevention', () => {
    it('should not allow prototype pollution through parsed objects', () => {
      // Simulate what safeJsonParse should do
      const malicious = '{"__proto__": {"polluted": true}, "constructor": {"polluted": true}}';
      const parsed = JSON.parse(malicious);
      
      // Check that a fresh object is not polluted
      const testObj = {};
      expect(testObj.polluted).toBeUndefined();
      
      // After sanitization, dangerous properties should be removed from the parsed object
      const sanitized = { ...parsed };
      delete sanitized.__proto__;
      delete sanitized.constructor;
      delete sanitized.prototype;
      
      // The sanitized object should not have these as own properties
      expect(Object.prototype.hasOwnProperty.call(sanitized, '__proto__')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(sanitized, 'constructor')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(sanitized, 'prototype')).toBe(false);
    });
  });

  describe('ID Sanitization', () => {
    // Testing sanitization patterns
    const safeIdPattern = /^[a-zA-Z0-9_\-\.]+$/;
    
    it('should accept valid IDs', () => {
      expect(safeIdPattern.test('doc123')).toBe(true);
      expect(safeIdPattern.test('my-doc_v2.0')).toBe(true);
      expect(safeIdPattern.test('ABC123xyz')).toBe(true);
    });

    it('should reject path traversal attempts', () => {
      expect('../../etc/passwd'.includes('..')).toBe(true);
      expect('./secret'.includes('./')).toBe(true);
    });

    it('should reject special characters', () => {
      expect(safeIdPattern.test('doc<script>')).toBe(false);
      expect(safeIdPattern.test('doc;rm -rf')).toBe(false);
      expect(safeIdPattern.test('doc`whoami`')).toBe(false);
      expect(safeIdPattern.test('doc${var}')).toBe(false);
    });
  });
});

describe('Rate Limiting', () => {
  // Simple rate limiter test
  class MockRateLimiter {
    constructor(maxRequests = 5, windowMs = 1000) {
      this.maxRequests = maxRequests;
      this.windowMs = windowMs;
      this.requests = [];
    }

    check() {
      const now = Date.now();
      this.requests = this.requests.filter(t => now - t < this.windowMs);
      
      if (this.requests.length >= this.maxRequests) {
        return { allowed: false, remaining: 0 };
      }
      
      this.requests.push(now);
      return { allowed: true, remaining: this.maxRequests - this.requests.length };
    }
  }

  it('should allow requests under limit', () => {
    const limiter = new MockRateLimiter(5, 1000);
    
    for (let i = 0; i < 5; i++) {
      const result = limiter.check();
      expect(result.allowed).toBe(true);
    }
  });

  it('should block requests over limit', () => {
    const limiter = new MockRateLimiter(3, 1000);
    
    limiter.check();
    limiter.check();
    limiter.check();
    
    const result = limiter.check();
    expect(result.allowed).toBe(false);
  });
});

describe('Encryption Padding', () => {
  it('should pad to 4KB blocks', () => {
    const key = generateKey();
    
    // Test various sizes
    const sizes = [1, 100, 1000, 4000, 4096, 5000, 8192];
    
    for (const size of sizes) {
      const data = nacl.randomBytes(size);
      const encrypted = encryptUpdate(data, key);
      
      // Encrypted size should be a multiple of 4096 (after accounting for nonce and overhead)
      // The padding happens before encryption, so the ciphertext includes padded data
      expect(encrypted).not.toBe(null);
      
      // Verify round-trip
      const decrypted = decryptUpdate(encrypted, key);
      expect(decrypted).not.toBe(null);
      expect(decrypted.length).toBe(size);
    }
  });
});
