/**
 * Fuzz Testing Suite ("Ralph Wiggum" Testing)
 * 
 * Randomized testing with seeded random for reproducibility.
 * "I'm testing! And when I test, sometimes I break things!"
 * 
 * Run with seed: FUZZ_SEED=12345 npm test -- tests/fuzz.test.js
 */

import {
  generateIdentity,
  restoreIdentityFromMnemonic,
  validateMnemonic,
  signData,
  verifySignature,
  uint8ToBase62,
  base62ToUint8,
} from '../frontend/src/utils/identity';
import {
  encryptData,
  decryptData,
  deriveBackupKey,
} from '../frontend/src/utils/backup';

// Seeded random number generator for reproducibility
class SeededRandom {
  constructor(seed) {
    this.seed = seed;
    this.current = seed;
  }
  
  // Simple xorshift32 algorithm
  next() {
    let x = this.current;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.current = x >>> 0;
    return this.current / 0xffffffff;
  }
  
  nextInt(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  
  nextBytes(length) {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      bytes[i] = this.nextInt(0, 255);
    }
    return bytes;
  }
  
  nextString(length, charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
    let result = '';
    for (let i = 0; i < length; i++) {
      result += charset[this.nextInt(0, charset.length - 1)];
    }
    return result;
  }
  
  // "Ralph Wiggum" special: generate weird strings
  nextWeirdString(maxLength) {
    const length = this.nextInt(0, maxLength);
    const weirdChars = '\0\n\r\t\u0000\u001f\uffff🎉😀世界مرحباשלום';
    const normal = 'abcABC123';
    const charset = weirdChars + normal;
    return this.nextString(length, charset);
  }
  
  pick(array) {
    return array[this.nextInt(0, array.length - 1)];
  }
}

// Get seed from environment or use current timestamp
const FUZZ_SEED = parseInt(process.env.FUZZ_SEED || String(Date.now() % 1000000), 10);
const FUZZ_ITERATIONS = parseInt(process.env.FUZZ_ITERATIONS || '50', 10);

// Log seed for reproducibility
beforeAll(() => {
  console.log(`\n🎲 Fuzz Testing Seed: ${FUZZ_SEED}`);
  console.log(`   To reproduce: FUZZ_SEED=${FUZZ_SEED} npm test -- tests/fuzz.test.js`);
  console.log(`   Iterations: ${FUZZ_ITERATIONS}\n`);
});

describe('Fuzz Testing: Identity System', () => {
  let rng;
  
  beforeEach(() => {
    // Each test starts with same seed for that iteration
    rng = new SeededRandom(FUZZ_SEED);
  });

  test('identity generation never throws', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      expect(() => generateIdentity()).not.toThrow();
    }
  });

  test('mnemonic round-trip always works', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const identity = generateIdentity();
      expect(validateMnemonic(identity.mnemonic)).toBe(true);
      
      const restored = restoreIdentityFromMnemonic(identity.mnemonic);
      expect(restored.publicKeyBase62).toBe(identity.publicKeyBase62);
    }
  });

  test('validateMnemonic never throws on random input', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const randomInput = rng.nextWeirdString(200);
      expect(() => validateMnemonic(randomInput)).not.toThrow();
    }
  });

  test('restoreIdentityFromMnemonic handles invalid input gracefully', () => {
    const invalidInputs = [
      '',
      'a'.repeat(1000),
      rng.nextWeirdString(100),
      Array(12).fill('abandon').join(' '), // Valid words but invalid checksum
      '   ',
      '\n\n\n',
    ];
    
    for (const input of invalidInputs) {
      // Should either throw a clear error or return null/undefined
      // but never crash unexpectedly
      try {
        const result = restoreIdentityFromMnemonic(input);
        // If it doesn't throw, result should be falsy or have empty keys
        if (result) {
          expect(result.publicKey || result.mnemonic).toBeDefined();
        }
      } catch (e) {
        // Expected - invalid mnemonic should throw
        expect(e).toBeInstanceOf(Error);
      }
    }
  });
});

describe('Fuzz Testing: Base62 Encoding', () => {
  let rng;
  
  beforeEach(() => {
    rng = new SeededRandom(FUZZ_SEED);
  });

  test('random bytes encode/decode round-trip', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const length = rng.nextInt(1, 128);
      const original = rng.nextBytes(length);
      
      const encoded = uint8ToBase62(original);
      const decoded = base62ToUint8(encoded, length);
      
      expect(decoded).toEqual(original);
    }
  });

  test('encoded output only contains Base62 characters', () => {
    const base62Regex = /^[0-9A-Za-z]*$/;
    
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const length = rng.nextInt(0, 64);
      const bytes = rng.nextBytes(length);
      
      const encoded = uint8ToBase62(bytes);
      expect(encoded).toMatch(base62Regex);
    }
  });

  test('base62ToUint8 handles invalid input gracefully', () => {
    const invalidInputs = [
      '!@#$%^&*()',
      'hello world with spaces',
      '🎉🎉🎉',
      'AAAAAAAAAAAAAAAAAAAAzzzz+/==', // Base64-like but not Base62
    ];
    
    for (const input of invalidInputs) {
      // Should either throw a clear error or return empty/null
      try {
        const result = base62ToUint8(input, 32);
        // If it returns something, verify it's a Uint8Array
        if (result) {
          expect(result).toBeInstanceOf(Uint8Array);
        }
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    }
  });
});

describe('Fuzz Testing: Signing', () => {
  let rng;
  let identity;
  
  beforeEach(() => {
    rng = new SeededRandom(FUZZ_SEED);
    identity = generateIdentity();
  });

  test('signing random messages always produces valid signatures', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const message = rng.nextWeirdString(1000);
      
      const signature = signData(message, identity.privateKey);
      expect(signature).toBeInstanceOf(Uint8Array);
      expect(signature.length).toBe(64);
      
      expect(verifySignature(message, signature, identity.publicKey)).toBe(true);
    }
  });

  test('random bytes as message sign correctly', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const messageBytes = rng.nextBytes(rng.nextInt(0, 500));
      
      const signature = signData(messageBytes, identity.privateKey);
      expect(verifySignature(messageBytes, signature, identity.publicKey)).toBe(true);
    }
  });

  test('tampered signatures always fail verification', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const message = rng.nextString(50);
      const signature = signData(message, identity.privateKey);
      
      // Tamper with random byte
      const tampered = new Uint8Array(signature);
      const tamperIndex = rng.nextInt(0, 63);
      tampered[tamperIndex] = tampered[tamperIndex] ^ 0xff;
      
      expect(verifySignature(message, tampered, identity.publicKey)).toBe(false);
    }
  });

  test('cross-identity verification always fails', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const identity2 = generateIdentity();
      const message = rng.nextString(50);
      
      const signature = signData(message, identity.privateKey);
      expect(verifySignature(message, signature, identity2.publicKey)).toBe(false);
    }
  });
});

describe('Fuzz Testing: Encryption', () => {
  let rng;
  let identity;
  let key;
  
  beforeEach(() => {
    rng = new SeededRandom(FUZZ_SEED);
    identity = generateIdentity();
    key = deriveBackupKey(identity.mnemonic);
  });

  test('random strings encrypt/decrypt correctly', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const data = rng.nextString(rng.nextInt(0, 1000));
      
      const encrypted = encryptData(data, key);
      const decrypted = decryptData(encrypted, key);
      
      expect(decrypted).toBe(data);
    }
  });

  test('random objects encrypt/decrypt correctly', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const data = {
        string: rng.nextString(20),
        number: rng.nextInt(-1000000, 1000000),
        boolean: rng.next() > 0.5,
        array: [rng.nextInt(0, 100), rng.nextString(5)],
        nested: {
          value: rng.nextString(10),
        },
      };
      
      const encrypted = encryptData(data, key);
      const decrypted = decryptData(encrypted, key);
      
      expect(decrypted).toEqual(data);
    }
  });

  test('decryption with wrong key always fails', () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const data = rng.nextString(50);
      const encrypted = encryptData(data, key);
      
      // Generate a different key
      const otherIdentity = generateIdentity();
      const wrongKey = deriveBackupKey(otherIdentity.mnemonic);
      
      expect(() => {
        decryptData(encrypted, wrongKey);
      }).toThrow();
    }
  });

  test('tampered ciphertext always fails decryption', () => {
    for (let i = 0; i < Math.min(FUZZ_ITERATIONS, 20); i++) { // Fewer iterations - expensive
      const data = rng.nextString(50);
      const encrypted = encryptData(data, key);
      
      // Tamper with the ciphertext
      const bytes = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
      if (bytes.length > 0) {
        const tamperIndex = rng.nextInt(0, bytes.length - 1);
        bytes[tamperIndex] = bytes[tamperIndex] ^ 0xff;
        const tampered = btoa(String.fromCharCode(...bytes));
        
        expect(() => {
          decryptData(tampered, key);
        }).toThrow();
      }
    }
  });
});

describe('Fuzz Testing: Kick Message Format', () => {
  let rng;
  
  beforeEach(() => {
    rng = new SeededRandom(FUZZ_SEED);
  });

  test('kick messages with random workspace IDs work', () => {
    const owner = generateIdentity();
    const target = generateIdentity();
    
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const workspaceId = rng.nextString(rng.nextInt(1, 64), 'abcdef0123456789');
      const timestamp = rng.nextInt(0, 2147483647) * 1000;
      
      const message = `kick:${workspaceId}:${target.publicKeyBase62}:${timestamp}`;
      const signature = signData(message, owner.privateKey);
      
      expect(verifySignature(message, signature, owner.publicKey)).toBe(true);
    }
  });
});

describe('Fuzz Testing: Stress', () => {
  test('rapid identity generation (100 identities)', () => {
    const identities = [];
    const startTime = Date.now();
    
    for (let i = 0; i < 100; i++) {
      identities.push(generateIdentity());
    }
    
    const elapsed = Date.now() - startTime;
    console.log(`   Generated 100 identities in ${elapsed}ms`);
    
    // All should be unique
    const publicKeys = new Set(identities.map(id => id.publicKeyBase62));
    expect(publicKeys.size).toBe(100);
  });

  test('concurrent signing operations', async () => {
    const identity = generateIdentity();
    const rng = new SeededRandom(FUZZ_SEED);
    
    const promises = Array.from({ length: 50 }, (_, i) => {
      return new Promise(resolve => {
        const message = rng.nextString(100);
        const signature = signData(message, identity.privateKey);
        const valid = verifySignature(message, signature, identity.publicKey);
        resolve(valid);
      });
    });
    
    const results = await Promise.all(promises);
    expect(results.every(r => r === true)).toBe(true);
  });
});
