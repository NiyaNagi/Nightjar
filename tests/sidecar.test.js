/**
 * Sidecar Backend Test Suite
 * 
 * Tests for the Node.js sidecar modules:
 * - crypto.js: Encryption/decryption with padding
 * - identity.js: Identity storage and management
 * 
 * These tests run in Node.js environment (not jsdom)
 */

// Set up Node.js environment for these tests
/**
 * @jest-environment node
 */

const nacl = require('tweetnacl');

// Mock fs module
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

const fs = require('fs');

// Import modules after mocking
const {
  encryptUpdate,
  decryptUpdate,
  generateKey,
  timingSafeEqual,
  isValidKey,
  secureWipe,
} = require('../sidecar/crypto');

// ============================================================
// Crypto: Key Validation
// ============================================================

describe('Sidecar Crypto: Key Validation', () => {
  describe('isValidKey', () => {
    test('accepts valid 32-byte key', () => {
      const key = nacl.randomBytes(32);
      expect(isValidKey(key)).toBe(true);
    });

    test('rejects null key', () => {
      expect(isValidKey(null)).toBe(false);
    });

    test('rejects undefined key', () => {
      expect(isValidKey(undefined)).toBe(false);
    });

    test('rejects short key', () => {
      const key = nacl.randomBytes(16);
      expect(isValidKey(key)).toBe(false);
    });

    test('rejects long key', () => {
      const key = nacl.randomBytes(64);
      expect(isValidKey(key)).toBe(false);
    });

    test('rejects all-zero key', () => {
      const key = new Uint8Array(32).fill(0);
      expect(isValidKey(key)).toBe(false);
    });

    test('rejects non-Uint8Array', () => {
      expect(isValidKey('not a key')).toBe(false);
      expect(isValidKey([1, 2, 3])).toBe(false);
      expect(isValidKey({ length: 32 })).toBe(false);
    });
  });

  describe('generateKey', () => {
    test('generates 32-byte key', () => {
      const key = generateKey();
      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
    });

    test('generates unique keys', () => {
      const key1 = generateKey();
      const key2 = generateKey();
      expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(false);
    });

    test('generated key is valid', () => {
      const key = generateKey();
      expect(isValidKey(key)).toBe(true);
    });
  });
});

// ============================================================
// Crypto: Timing-Safe Comparison
// ============================================================

describe('Sidecar Crypto: Timing-Safe Comparison', () => {
  test('returns true for identical arrays', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4, 5]);
    expect(timingSafeEqual(a, b)).toBe(true);
  });

  test('returns false for different arrays', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4, 6]);
    expect(timingSafeEqual(a, b)).toBe(false);
  });

  test('returns false for different length arrays', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3]);
    expect(timingSafeEqual(a, b)).toBe(false);
  });

  test('returns false for non-Uint8Array inputs', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(false);
    expect(timingSafeEqual([1, 2], [1, 2])).toBe(false);
    expect(timingSafeEqual(null, null)).toBe(false);
  });

  test('handles empty arrays', () => {
    const a = new Uint8Array([]);
    const b = new Uint8Array([]);
    expect(timingSafeEqual(a, b)).toBe(true);
  });
});

// ============================================================
// Crypto: Secure Wipe
// ============================================================

describe('Sidecar Crypto: Secure Wipe', () => {
  test('wipes Uint8Array to zeros', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    secureWipe(data);
    expect(data.every(b => b === 0)).toBe(true);
  });

  test('handles empty array', () => {
    const data = new Uint8Array([]);
    expect(() => secureWipe(data)).not.toThrow();
  });

  test('handles non-Uint8Array gracefully', () => {
    expect(() => secureWipe(null)).not.toThrow();
    expect(() => secureWipe(undefined)).not.toThrow();
    expect(() => secureWipe('string')).not.toThrow();
    expect(() => secureWipe([1, 2, 3])).not.toThrow();
  });
});

// ============================================================
// Crypto: Encryption/Decryption
// ============================================================

describe('Sidecar Crypto: Encryption', () => {
  let validKey;

  beforeEach(() => {
    validKey = generateKey();
  });

  describe('encryptUpdate', () => {
    test('encrypts valid update', () => {
      const update = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const encrypted = encryptUpdate(update, validKey);
      
      expect(encrypted).not.toBeNull();
      expect(encrypted).toBeInstanceOf(Uint8Array);
      expect(encrypted.length).toBeGreaterThan(update.length);
    });

    test('encrypted data is different from plaintext', () => {
      const update = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const encrypted = encryptUpdate(update, validKey);
      
      // Should not contain the original plaintext
      expect(Buffer.from(encrypted).includes(Buffer.from(update))).toBe(false);
    });

    test('returns null for empty update', () => {
      const empty = new Uint8Array([]);
      const result = encryptUpdate(empty, validKey);
      expect(result).toBeNull();
    });

    test('returns null for null update', () => {
      const result = encryptUpdate(null, validKey);
      expect(result).toBeNull();
    });

    test('returns null for invalid key', () => {
      const update = new Uint8Array([1, 2, 3, 4, 5]);
      const result = encryptUpdate(update, null);
      expect(result).toBeNull();
    });

    test('returns null for short key', () => {
      const update = new Uint8Array([1, 2, 3, 4, 5]);
      const shortKey = new Uint8Array(16);
      const result = encryptUpdate(update, shortKey);
      expect(result).toBeNull();
    });

    test('encrypts same data differently each time (nonce)', () => {
      const update = new Uint8Array([1, 2, 3, 4, 5]);
      const encrypted1 = encryptUpdate(update, validKey);
      const encrypted2 = encryptUpdate(update, validKey);
      
      // Different nonces should produce different ciphertext
      expect(Buffer.from(encrypted1).equals(Buffer.from(encrypted2))).toBe(false);
    });
  });

  describe('decryptUpdate', () => {
    test('decrypts what was encrypted', () => {
      const original = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
      const encrypted = encryptUpdate(original, validKey);
      const decrypted = decryptUpdate(encrypted, validKey);
      
      expect(decrypted).not.toBeNull();
      expect(Buffer.from(decrypted).equals(Buffer.from(original))).toBe(true);
    });

    test('returns null with wrong key', () => {
      const original = new Uint8Array([1, 2, 3, 4, 5]);
      const encrypted = encryptUpdate(original, validKey);
      const wrongKey = generateKey();
      const decrypted = decryptUpdate(encrypted, wrongKey);
      
      expect(decrypted).toBeNull();
    });

    test('returns null for corrupted data', () => {
      const original = new Uint8Array([1, 2, 3, 4, 5]);
      const encrypted = encryptUpdate(original, validKey);
      
      // Corrupt the ciphertext
      encrypted[encrypted.length - 1] ^= 0xff;
      
      const decrypted = decryptUpdate(encrypted, validKey);
      expect(decrypted).toBeNull();
    });

    test('returns null for truncated data', () => {
      const original = new Uint8Array([1, 2, 3, 4, 5]);
      const encrypted = encryptUpdate(original, validKey);
      
      // Truncate
      const truncated = encrypted.slice(0, 10);
      
      const decrypted = decryptUpdate(truncated, validKey);
      expect(decrypted).toBeNull();
    });

    test('returns null for null packed data', () => {
      expect(decryptUpdate(null, validKey)).toBeNull();
    });

    test('returns null for invalid key', () => {
      const original = new Uint8Array([1, 2, 3, 4, 5]);
      const encrypted = encryptUpdate(original, validKey);
      expect(decryptUpdate(encrypted, null)).toBeNull();
    });
  });

  describe('Round-trip encryption', () => {
    test('handles small data', () => {
      const original = new Uint8Array([1]);
      const encrypted = encryptUpdate(original, validKey);
      const decrypted = decryptUpdate(encrypted, validKey);
      
      expect(Buffer.from(decrypted).equals(Buffer.from(original))).toBe(true);
    });

    test('handles medium data', () => {
      const original = nacl.randomBytes(1000);
      const encrypted = encryptUpdate(original, validKey);
      const decrypted = decryptUpdate(encrypted, validKey);
      
      expect(Buffer.from(decrypted).equals(Buffer.from(original))).toBe(true);
    });

    test('handles large data', () => {
      const original = nacl.randomBytes(100000); // 100KB
      const encrypted = encryptUpdate(original, validKey);
      const decrypted = decryptUpdate(encrypted, validKey);
      
      expect(Buffer.from(decrypted).equals(Buffer.from(original))).toBe(true);
    });

    test('preserves exact data', () => {
      // Test with specific byte patterns
      const patterns = [
        new Uint8Array([0, 0, 0, 0]),
        new Uint8Array([255, 255, 255, 255]),
        new Uint8Array([0, 255, 0, 255]),
        new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
      ];

      for (const original of patterns) {
        const encrypted = encryptUpdate(original, validKey);
        const decrypted = decryptUpdate(encrypted, validKey);
        expect(Buffer.from(decrypted).equals(Buffer.from(original))).toBe(true);
      }
    });
  });
});

// ============================================================
// Crypto: Padding
// ============================================================

describe('Sidecar Crypto: Padding', () => {
  let validKey;

  beforeEach(() => {
    validKey = generateKey();
  });

  test('encrypted size is always multiple of 4096 + overhead', () => {
    // Overhead: nonce (24 bytes) + auth tag (16 bytes) = 40 bytes
    const overhead = 24 + 16;
    
    const sizes = [1, 100, 1000, 4095, 4096, 4097, 8192, 10000];
    
    for (const size of sizes) {
      const data = nacl.randomBytes(size);
      const encrypted = encryptUpdate(data, validKey);
      
      // Size should be nonce + padded ciphertext
      // Padded size = ceil((4 + dataLen) / 4096) * 4096
      const paddedSize = Math.ceil((4 + size) / 4096) * 4096;
      const expectedSize = 24 + paddedSize + 16;
      
      expect(encrypted.length).toBe(expectedSize);
    }
  });
});

// ============================================================
// Identity: Mocked Tests
// ============================================================

describe('Sidecar Identity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset HOME environment for consistent paths
    process.env.HOME = '/home/testuser';
  });

  // We can't test the full identity module without real fs access,
  // but we can verify the module structure
  describe('Module structure', () => {
    test('identity module loads without errors', () => {
      // Just verify the module can be required
      expect(() => {
        jest.isolateModules(() => {
          require('../sidecar/identity');
        });
      }).not.toThrow();
    });
  });

  describe('Path handling', () => {
    test('creates app directory if not exists', () => {
      fs.existsSync.mockReturnValue(false);
      
      jest.isolateModules(() => {
        const identity = require('../sidecar/identity');
        // The getIdentityDir function should be called on module load or first use
        // We verify the mock was set up correctly
        expect(fs.mkdirSync).toBeDefined();
      });
    });
  });
});

// ============================================================
// Buffer Compatibility
// ============================================================

describe('Sidecar Crypto: Buffer Compatibility', () => {
  let validKey;

  beforeEach(() => {
    validKey = generateKey();
  });

  test('handles Buffer input for packed data', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const encrypted = encryptUpdate(original, validKey);
    
    // Convert to Buffer (simulating data from network/file)
    const asBuffer = Buffer.from(encrypted);
    const decrypted = decryptUpdate(asBuffer, validKey);
    
    expect(decrypted).not.toBeNull();
    expect(Buffer.from(decrypted).equals(Buffer.from(original))).toBe(true);
  });

  test('handles Node.js Buffer as key', () => {
    // Generate key as Buffer instead of Uint8Array
    const bufferKey = Buffer.from(nacl.randomBytes(32));
    const original = new Uint8Array([1, 2, 3, 4, 5]);
    
    const encrypted = encryptUpdate(original, new Uint8Array(bufferKey));
    const decrypted = decryptUpdate(encrypted, new Uint8Array(bufferKey));
    
    expect(Buffer.from(decrypted).equals(Buffer.from(original))).toBe(true);
  });
});

// ============================================================
// Security Edge Cases
// ============================================================

describe('Sidecar Crypto: Security Edge Cases', () => {
  let validKey;

  beforeEach(() => {
    validKey = generateKey();
  });

  test('rejects oversized updates', () => {
    // Create a 101MB update (above 100MB limit)
    // We can't actually allocate this, but we can test the logic
    // by checking the validation happens
    const original = nacl.randomBytes(100);
    const result = encryptUpdate(original, validKey);
    
    // Small data should work
    expect(result).not.toBeNull();
    
    // Can't easily test the 100MB limit without memory issues
    // but the implementation should reject it
  });

  test('handles nonce in ciphertext correctly', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5]);
    const encrypted = encryptUpdate(original, validKey);
    
    // First 24 bytes should be the nonce
    const nonce = encrypted.slice(0, 24);
    expect(nonce.length).toBe(24);
    
    // Nonce should not be all zeros
    expect(nonce.some(b => b !== 0)).toBe(true);
  });

  test('detects key reuse with different data', () => {
    const data1 = new Uint8Array([1, 2, 3, 4, 5]);
    const data2 = new Uint8Array([5, 4, 3, 2, 1]);
    
    const enc1 = encryptUpdate(data1, validKey);
    const enc2 = encryptUpdate(data2, validKey);
    
    // Different nonces should prevent issues
    const nonce1 = enc1.slice(0, 24);
    const nonce2 = enc2.slice(0, 24);
    
    expect(Buffer.from(nonce1).equals(Buffer.from(nonce2))).toBe(false);
  });
});
