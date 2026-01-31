/**
 * Identity System Tests
 * 
 * Tests for BIP39 mnemonic generation, Ed25519 keypairs, and signing/verification.
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

describe('Identity System', () => {
  describe('Mnemonic Generation', () => {
    test('generates valid 12-word mnemonic', () => {
      const identity = generateIdentity();
      
      expect(identity.mnemonic).toBeDefined();
      const words = identity.mnemonic.split(' ');
      expect(words.length).toBe(12);
    });
    
    test('validates BIP39 mnemonic correctly', () => {
      const identity = generateIdentity();
      
      expect(validateMnemonic(identity.mnemonic)).toBe(true);
      expect(validateMnemonic('invalid mnemonic phrase here')).toBe(false);
      expect(validateMnemonic('')).toBe(false);
    });
    
    test('derives deterministic keypair from mnemonic', () => {
      const identity1 = generateIdentity();
      const identity2 = restoreIdentityFromMnemonic(identity1.mnemonic);
      
      // Same mnemonic should produce same keypair
      expect(identity2.publicKeyBase62).toBe(identity1.publicKeyBase62);
      expect(uint8ToBase62(identity2.privateKey)).toBe(uint8ToBase62(identity1.privateKey));
    });
    
    test('different mnemonics produce different keypairs', () => {
      const identity1 = generateIdentity();
      const identity2 = generateIdentity();
      
      expect(identity1.publicKeyBase62).not.toBe(identity2.publicKeyBase62);
    });
  });
  
  describe('Keypair Generation', () => {
    test('generates 32-byte public key', () => {
      const identity = generateIdentity();
      
      expect(identity.publicKey).toBeInstanceOf(Uint8Array);
      expect(identity.publicKey.length).toBe(32);
    });
    
    test('generates 64-byte private key (includes public key)', () => {
      const identity = generateIdentity();
      
      expect(identity.privateKey).toBeInstanceOf(Uint8Array);
      expect(identity.privateKey.length).toBe(64);
    });
    
    test('generates base62 public key representation', () => {
      const identity = generateIdentity();
      
      expect(typeof identity.publicKeyBase62).toBe('string');
      expect(identity.publicKeyBase62.length).toBeGreaterThan(0);
      // Base62 characters only
      expect(identity.publicKeyBase62).toMatch(/^[0-9A-Za-z]+$/);
    });
  });
  
  describe('Signing and Verification', () => {
    test('signs string data correctly', () => {
      const identity = generateIdentity();
      const message = 'test message to sign';
      
      const signature = signData(message, identity.privateKey);
      
      expect(signature).toBeInstanceOf(Uint8Array);
      expect(signature.length).toBe(64); // Ed25519 signature is 64 bytes
    });
    
    test('verifies valid signature', () => {
      const identity = generateIdentity();
      const message = 'test message to sign';
      
      const signature = signData(message, identity.privateKey);
      const isValid = verifySignature(message, signature, identity.publicKey);
      
      expect(isValid).toBe(true);
    });
    
    test('rejects tampered message', () => {
      const identity = generateIdentity();
      const message = 'test message to sign';
      
      const signature = signData(message, identity.privateKey);
      const isValid = verifySignature('tampered message', signature, identity.publicKey);
      
      expect(isValid).toBe(false);
    });
    
    test('rejects tampered signature', () => {
      const identity = generateIdentity();
      const message = 'test message to sign';
      
      const signature = signData(message, identity.privateKey);
      // Tamper with signature
      signature[0] = signature[0] ^ 0xff;
      
      const isValid = verifySignature(message, signature, identity.publicKey);
      
      expect(isValid).toBe(false);
    });
    
    test('rejects wrong public key', () => {
      const identity1 = generateIdentity();
      const identity2 = generateIdentity();
      const message = 'test message to sign';
      
      const signature = signData(message, identity1.privateKey);
      const isValid = verifySignature(message, signature, identity2.publicKey);
      
      expect(isValid).toBe(false);
    });
    
    test('signs Uint8Array data', () => {
      const identity = generateIdentity();
      const message = new Uint8Array([1, 2, 3, 4, 5]);
      
      const signature = signData(message, identity.privateKey);
      const isValid = verifySignature(message, signature, identity.publicKey);
      
      expect(isValid).toBe(true);
    });
  });
  
  describe('Base62 Encoding', () => {
    test('encodes and decodes round-trip', () => {
      const original = new Uint8Array([0, 1, 128, 255, 100, 50, 25]);
      
      const encoded = uint8ToBase62(original);
      const decoded = base62ToUint8(encoded, original.length);
      
      expect(decoded).toEqual(original);
    });
    
    test('handles leading zeros', () => {
      const original = new Uint8Array([0, 0, 0, 1, 2, 3]);
      
      const encoded = uint8ToBase62(original);
      const decoded = base62ToUint8(encoded, original.length);
      
      expect(decoded).toEqual(original);
    });
    
    test('produces valid base62 characters', () => {
      const data = new Uint8Array([255, 255, 255, 255]);
      const encoded = uint8ToBase62(data);
      
      expect(encoded).toMatch(/^[0-9A-Za-z]+$/);
    });
  });
  
  describe('Short ID', () => {
    test('returns first 10 characters of base62 key', () => {
      const identity = generateIdentity();
      const shortId = getShortId(identity.publicKey);
      
      expect(shortId.length).toBe(10);
      expect(identity.publicKeyBase62.startsWith(shortId)).toBe(true);
    });
    
    test('works with string input', () => {
      const identity = generateIdentity();
      const shortId = getShortId(identity.publicKeyBase62);
      
      expect(shortId.length).toBe(10);
    });
  });
  
  describe('Identity Restoration', () => {
    test('restores identity from valid mnemonic', () => {
      const original = generateIdentity();
      const restored = restoreIdentityFromMnemonic(original.mnemonic);
      
      expect(restored.publicKeyBase62).toBe(original.publicKeyBase62);
      expect(restored.mnemonic).toBe(original.mnemonic);
    });
    
    test('throws error for invalid mnemonic', () => {
      expect(() => {
        restoreIdentityFromMnemonic('invalid mnemonic words here');
      }).toThrow('Invalid recovery phrase');
    });
    
    test('restored identity can sign and verify', () => {
      const original = generateIdentity();
      const message = 'test message';
      
      // Sign with original
      const signature = signData(message, original.privateKey);
      
      // Restore and verify
      const restored = restoreIdentityFromMnemonic(original.mnemonic);
      const isValid = verifySignature(message, signature, restored.publicKey);
      
      expect(isValid).toBe(true);
    });
  });
});
