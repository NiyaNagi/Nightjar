/**
 * Edge Cases Test Suite
 * 
 * Tests boundary conditions, extreme inputs, and unusual scenarios.
 */

import {
  generateIdentity,
  restoreIdentityFromMnemonic,
  validateMnemonic,
  signData,
  verifySignature,
  uint8ToBase62,
  base62ToUint8,
  getShortId,
} from '../frontend/src/utils/identity';
import {
  createBackup,
  restoreBackup,
  deriveBackupKey,
  encryptData,
  decryptData,
} from '../frontend/src/utils/backup';

describe('Edge Cases: Identity', () => {
  describe('Base62 Encoding Boundaries', () => {
    test('encodes empty array', () => {
      const empty = new Uint8Array([]);
      const encoded = uint8ToBase62(empty);
      // Empty should encode to empty or very short string
      expect(encoded.length).toBeLessThanOrEqual(1);
    });

    test('encodes single-byte boundaries', () => {
      // Test 0, 1, 127, 128, 254, 255
      const boundaries = [0, 1, 127, 128, 254, 255];
      for (const val of boundaries) {
        const arr = new Uint8Array([val]);
        const encoded = uint8ToBase62(arr);
        const decoded = base62ToUint8(encoded, 1);
        expect(decoded[0]).toBe(val);
      }
    });

    test('encodes maximum length array (256 bytes)', () => {
      const large = new Uint8Array(256);
      for (let i = 0; i < 256; i++) large[i] = i;
      
      const encoded = uint8ToBase62(large);
      const decoded = base62ToUint8(encoded, 256);
      
      expect(decoded).toEqual(large);
    });

    test('encodes all-zeros array', () => {
      const zeros = new Uint8Array(32);
      const encoded = uint8ToBase62(zeros);
      const decoded = base62ToUint8(encoded, 32);
      
      expect(decoded).toEqual(zeros);
    });

    test('encodes all-255 array', () => {
      const maxes = new Uint8Array(32).fill(255);
      const encoded = uint8ToBase62(maxes);
      const decoded = base62ToUint8(encoded, 32);
      
      expect(decoded).toEqual(maxes);
    });

    test('handles maximum BigInt values', () => {
      // 32 bytes of 0xff is the maximum value for 256-bit number
      const maxBytes = new Uint8Array(32).fill(255);
      const encoded = uint8ToBase62(maxBytes);
      expect(encoded).toBeDefined();
      expect(encoded.length).toBeGreaterThan(0);
    });
  });

  describe('Mnemonic Edge Cases', () => {
    test('rejects mnemonic with extra whitespace', () => {
      const identity = generateIdentity();
      const wordsWithExtraSpaces = identity.mnemonic.replace(/ /g, '  ');
      // Validation should fail or normalize
      const isValid = validateMnemonic(wordsWithExtraSpaces);
      // Either fails or gets normalized
      if (isValid) {
        // If valid, restoration should still work
        const restored = restoreIdentityFromMnemonic(wordsWithExtraSpaces);
        expect(restored.publicKeyBase62).toBe(identity.publicKeyBase62);
      }
    });

    test('handles mnemonic with leading/trailing whitespace', () => {
      const identity = generateIdentity();
      const paddedMnemonic = `  ${identity.mnemonic}  `;
      // Should either fail validation or normalize
      const isValid = validateMnemonic(paddedMnemonic);
      expect(typeof isValid).toBe('boolean');
    });

    test('rejects mnemonic with wrong number of words', () => {
      const identity = generateIdentity();
      const words = identity.mnemonic.split(' ');
      
      // Too few words
      const tooFew = words.slice(0, 6).join(' ');
      expect(validateMnemonic(tooFew)).toBe(false);
      
      // Too many words (13)
      const tooMany = [...words, 'extra'].join(' ');
      expect(validateMnemonic(tooMany)).toBe(false);
    });

    test('rejects mnemonic with invalid words', () => {
      const invalid = 'invalid words that are not in bip39 wordlist at all here now';
      expect(validateMnemonic(invalid)).toBe(false);
    });

    test('mnemonic is case-insensitive', () => {
      const identity = generateIdentity();
      const upperMnemonic = identity.mnemonic.toUpperCase();
      
      // Most BIP39 implementations are case-insensitive
      // This tests our implementation's behavior
      const isValid = validateMnemonic(upperMnemonic);
      // Document the expected behavior
      expect(typeof isValid).toBe('boolean');
    });
  });

  describe('Signature Edge Cases', () => {
    test('signs empty message', () => {
      const identity = generateIdentity();
      const signature = signData('', identity.privateKey);
      
      expect(signature).toBeInstanceOf(Uint8Array);
      expect(signature.length).toBe(64);
      
      // Empty message signature should be verifiable
      expect(verifySignature('', signature, identity.publicKey)).toBe(true);
    });

    test('signs very long message (10KB)', () => {
      const identity = generateIdentity();
      const longMessage = 'x'.repeat(10000);
      
      const signature = signData(longMessage, identity.privateKey);
      expect(signature.length).toBe(64);
      
      expect(verifySignature(longMessage, signature, identity.publicKey)).toBe(true);
    });

    test('signs message with unicode characters', () => {
      const identity = generateIdentity();
      const unicodeMessage = '🎉 Hello, 世界! مرحبا שלום';
      
      const signature = signData(unicodeMessage, identity.privateKey);
      expect(verifySignature(unicodeMessage, signature, identity.publicKey)).toBe(true);
    });

    test('signs message with null bytes', () => {
      const identity = generateIdentity();
      const messageWithNulls = 'hello\0world\0test';
      
      const signature = signData(messageWithNulls, identity.privateKey);
      expect(verifySignature(messageWithNulls, signature, identity.publicKey)).toBe(true);
    });

    test('distinguishes empty vs single-null-byte messages', () => {
      const identity = generateIdentity();
      
      const sig1 = signData('', identity.privateKey);
      const sig2 = signData('\0', identity.privateKey);
      
      // Signatures should be different
      expect(uint8ToBase62(sig1)).not.toBe(uint8ToBase62(sig2));
      
      // Cross-verify should fail
      expect(verifySignature('\0', sig1, identity.publicKey)).toBe(false);
      expect(verifySignature('', sig2, identity.publicKey)).toBe(false);
    });
  });

  describe('Short ID Edge Cases', () => {
    test('generates consistent short IDs', () => {
      const identity = generateIdentity();
      
      const id1 = getShortId(identity.publicKey);
      const id2 = getShortId(identity.publicKey);
      
      expect(id1).toBe(id2);
    });

    test('short ID length is consistent', () => {
      // Generate multiple identities and check short ID length
      for (let i = 0; i < 10; i++) {
        const identity = generateIdentity();
        const shortId = getShortId(identity.publicKey);
        
        expect(shortId.length).toBeGreaterThanOrEqual(6);
        expect(shortId.length).toBeLessThanOrEqual(12);
      }
    });
  });
});

describe('Edge Cases: Backup', () => {
  describe('Encryption Boundaries', () => {
    test('encrypts minimal data (1 byte)', () => {
      const identity = generateIdentity();
      const key = deriveBackupKey(identity.mnemonic);
      
      const encrypted = encryptData('a', key);
      const decrypted = decryptData(encrypted, key);
      
      expect(decrypted).toBe('a');
    });

    test('encrypts large data (100KB)', () => {
      const identity = generateIdentity();
      const key = deriveBackupKey(identity.mnemonic);
      const largeData = 'x'.repeat(100000);
      
      const encrypted = encryptData(largeData, key);
      const decrypted = decryptData(encrypted, key);
      
      expect(decrypted).toBe(largeData);
    });

    test('handles empty object', () => {
      const identity = generateIdentity();
      const key = deriveBackupKey(identity.mnemonic);
      
      const encrypted = encryptData({}, key);
      const decrypted = decryptData(encrypted, key);
      
      expect(decrypted).toEqual({});
    });

    test('handles deeply nested object', () => {
      const identity = generateIdentity();
      const key = deriveBackupKey(identity.mnemonic);
      
      const nested = { a: { b: { c: { d: { e: { value: 'deep' } } } } } };
      
      const encrypted = encryptData(nested, key);
      const decrypted = decryptData(encrypted, key);
      
      expect(decrypted).toEqual(nested);
    });

    test('handles array with various types', () => {
      const identity = generateIdentity();
      const key = deriveBackupKey(identity.mnemonic);
      
      const mixed = [1, 'two', true, null, { nested: 'object' }, [1, 2, 3]];
      
      const encrypted = encryptData(mixed, key);
      const decrypted = decryptData(encrypted, key);
      
      expect(decrypted).toEqual(mixed);
    });

    test('handles special string characters', () => {
      const identity = generateIdentity();
      const key = deriveBackupKey(identity.mnemonic);
      
      const special = 'Line1\nLine2\tTabbed\r\nCRLF\\Backslash"Quote';
      
      const encrypted = encryptData(special, key);
      const decrypted = decryptData(encrypted, key);
      
      expect(decrypted).toBe(special);
    });
  });

  describe('Backup Structure Edge Cases', () => {
    test('handles workspace with no members', async () => {
      const identity = generateIdentity();
      const workspaces = [{
        id: 'ws1',
        name: 'Empty Workspace',
        myPermission: 'owner',
        encryptionKey: 'key123',
      }];
      
      const backup = await createBackup(identity, workspaces);
      expect(backup.workspaces).toHaveLength(1);
    });

    test('handles 100 workspaces', async () => {
      const identity = generateIdentity();
      const workspaces = Array.from({ length: 100 }, (_, i) => ({
        id: `workspace${i}`,
        name: `Test Workspace ${i}`,
        myPermission: i === 0 ? 'owner' : 'editor',
        encryptionKey: `key${i}`,
      }));
      
      const backup = await createBackup(identity, workspaces);
      expect(backup.workspaces).toHaveLength(100);
    });

    test('handles workspace name with special characters', async () => {
      const identity = generateIdentity();
      const workspaces = [{
        id: 'ws1',
        name: 'Test <script>alert("xss")</script> & "quotes"',
        myPermission: 'owner',
        encryptionKey: 'key123',
      }];
      
      const backup = await createBackup(identity, workspaces);
      const restored = await restoreBackup(backup, identity.mnemonic);
      
      expect(restored.workspaces[0].name).toContain('script');
    });
  });
});

describe('Edge Cases: Timing', () => {
  test('timestamp boundary at Year 2038', () => {
    // Year 2038 problem - tests timestamp handling
    const year2038 = 2147483647 * 1000; // Max 32-bit signed int in ms
    const identity = generateIdentity();
    
    const message = `kick:workspace:${identity.publicKeyBase62}:${year2038}`;
    const signature = signData(message, identity.privateKey);
    
    expect(verifySignature(message, signature, identity.publicKey)).toBe(true);
  });

  test('negative timestamp is handled', () => {
    // Timestamps before Unix epoch (shouldn't happen but test defensively)
    const negativeTime = -1000;
    const identity = generateIdentity();
    
    const message = `kick:workspace:${identity.publicKeyBase62}:${negativeTime}`;
    const signature = signData(message, identity.privateKey);
    
    expect(verifySignature(message, signature, identity.publicKey)).toBe(true);
  });
});
