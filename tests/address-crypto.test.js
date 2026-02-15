/**
 * tests/address-crypto.test.js
 *
 * Unit tests for the address encryption/decryption module.
 * See docs/INVENTORY_SYSTEM_SPEC.md §7.2
 *
 * Note: These tests mock ed2curve and tweetnacl to avoid native dependency
 * issues in the jsdom test environment.  Integration tests with real crypto
 * live in tests/integration/.
 */

import nacl from 'tweetnacl';

// ---------------------------------------------------------------------------
// We test the pure helpers (hexToUint8 / uint8ToHex / secureWipe) by
// importing from the module.  The encrypt/decrypt functions require
// ed2curve which we mock.
// ---------------------------------------------------------------------------

// Mock the serialization module used by addressCrypto
jest.mock('../frontend/src/services/p2p/protocol/serialization', () => ({
  encodeBase64: (bytes) => Buffer.from(bytes).toString('base64'),
  decodeBase64: (str) => new Uint8Array(Buffer.from(str, 'base64')),
}));

// Mock the identity helpers
jest.mock('../frontend/src/utils/identity', () => ({
  base62ToUint8: (str, len) => new Uint8Array(len || 32).fill(42),
  uint8ToBase62: (bytes) => 'mockBase62Key',
}));

// Mock ed2curve with real-ish key conversion (just returns the input for testing)
jest.mock('ed2curve', () => ({
  __esModule: true,
  default: {
    convertPublicKey: (ed) => ed.slice(0, 32),
    convertSecretKey: (ed) => ed.slice(0, 32),
  },
}));

// Now import the module under test
import {
  getPublicKeyHex,
  base62ToPublicKeyHex,
  encryptAdminNotes,
  decryptAdminNotes,
  encryptAddress,
  decryptAddress,
  validateClaim,
  createAddressReveal,
} from '../frontend/src/utils/addressCrypto';

// ---------------------------------------------------------------------------
// getPublicKeyHex
// ---------------------------------------------------------------------------

describe('getPublicKeyHex', () => {
  it('should return publicKeyHex when already available', () => {
    const identity = { publicKeyHex: 'aabbccdd' };
    expect(getPublicKeyHex(identity)).toBe('aabbccdd');
  });

  it('should convert Uint8Array publicKey to hex', () => {
    const identity = { publicKey: new Uint8Array([0, 1, 15, 255]) };
    expect(getPublicKeyHex(identity)).toBe('00010fff');
  });

  it('should convert base62 publicKey to hex', () => {
    const identity = { publicKeyBase62: 'someBase62' };
    // base62ToUint8 is mocked to return Uint8Array(32).fill(42)
    const hex = getPublicKeyHex(identity);
    expect(hex).toHaveLength(64); // 32 bytes × 2 hex chars
  });

  it('should throw when identity is null', () => {
    expect(() => getPublicKeyHex(null)).toThrow('Identity is required');
  });

  it('should throw when no key format is available', () => {
    expect(() => getPublicKeyHex({})).toThrow('Could not determine');
  });
});

// ---------------------------------------------------------------------------
// base62ToPublicKeyHex
// ---------------------------------------------------------------------------

describe('base62ToPublicKeyHex', () => {
  it('should return a hex string from base62 input', () => {
    const hex = base62ToPublicKeyHex('someKey');
    expect(typeof hex).toBe('string');
    expect(hex).toHaveLength(64); // 32 bytes
    expect(/^[0-9a-f]+$/.test(hex)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Admin notes symmetric encryption (nacl.secretbox)
// ---------------------------------------------------------------------------

describe('encryptAdminNotes / decryptAdminNotes', () => {
  const key = nacl.randomBytes(32);

  it('should encrypt and decrypt admin notes round-trip', () => {
    const notes = 'Sensitive admin note about request #42';
    const encrypted = encryptAdminNotes(notes, key);
    expect(typeof encrypted).toBe('string');
    expect(encrypted).not.toBe(notes);

    const decrypted = decryptAdminNotes(encrypted, key);
    expect(decrypted).toBe(notes);
  });

  it('should return null when decrypting with wrong key', () => {
    const encrypted = encryptAdminNotes('secret', key);
    const wrongKey = nacl.randomBytes(32);
    const result = decryptAdminNotes(encrypted, wrongKey);
    expect(result).toBeNull();
  });

  it('should return null for corrupted data', () => {
    const result = decryptAdminNotes('not-valid-base64!!!', key);
    expect(result).toBeNull();
  });

  it('should handle empty string notes', () => {
    const encrypted = encryptAdminNotes('', key);
    const decrypted = decryptAdminNotes(encrypted, key);
    expect(decrypted).toBe('');
  });

  it('should handle long content', () => {
    const notes = 'A'.repeat(1000) + ' admin note with lots of detail';
    const encrypted = encryptAdminNotes(notes, key);
    const decrypted = decryptAdminNotes(encrypted, key);
    expect(decrypted).toBe(notes);
  });
});

// ---------------------------------------------------------------------------
// encryptAddress / decryptAddress (with mocked ed2curve)
// ---------------------------------------------------------------------------

describe('encryptAddress / decryptAddress', () => {
  // Generate real nacl key pairs for testing
  const senderKeyPair = nacl.sign.keyPair();
  const recipientKeyPair = nacl.sign.keyPair();

  const senderPubHex = Array.from(senderKeyPair.publicKey)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  const recipientPubHex = Array.from(recipientKeyPair.publicKey)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  it('should encrypt an address object', async () => {
    const address = { line1: '123 Main St', city: 'Denver', state: 'CO', zip: '80202' };
    const result = await encryptAddress(address, recipientPubHex, senderKeyPair.secretKey);

    expect(result).toHaveProperty('ciphertext');
    expect(result).toHaveProperty('nonce');
    expect(typeof result.ciphertext).toBe('string');
    expect(typeof result.nonce).toBe('string');
  });

  it('should produce different ciphertexts for same input (random nonce)', async () => {
    const address = { line1: '123 Main St' };
    const r1 = await encryptAddress(address, recipientPubHex, senderKeyPair.secretKey);
    const r2 = await encryptAddress(address, recipientPubHex, senderKeyPair.secretKey);
    expect(r1.ciphertext).not.toBe(r2.ciphertext);
  });

  it('should fail to decrypt with wrong keys (authentication check)', async () => {
    const address = { line1: '456 Oak Ave', city: 'Portland', state: 'OR', zip: '97201' };
    const encrypted = await encryptAddress(address, recipientPubHex, senderKeyPair.secretKey);
    // Use a completely unrelated key pair for decryption — should fail auth
    const wrongKeyPair = nacl.sign.keyPair();
    const wrongPubHex = Array.from(wrongKeyPair.publicKey)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    await expect(
      decryptAddress(encrypted.ciphertext, encrypted.nonce, wrongPubHex, wrongKeyPair.secretKey)
    ).rejects.toThrow('authentication failed');
  });
});

// ---------------------------------------------------------------------------
// createAddressReveal
// ---------------------------------------------------------------------------

describe('createAddressReveal', () => {
  const adminKeyPair = nacl.sign.keyPair();
  const producerKeyPair = nacl.sign.keyPair();

  const adminPubHex = Array.from(adminKeyPair.publicKey)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  const producerPubHex = Array.from(producerKeyPair.publicKey)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  it('should return an EncryptedAddressReveal object', async () => {
    const address = { line1: '789 Elm St', city: 'Austin', state: 'TX', zip: '73301' };
    const reveal = await createAddressReveal(address, producerPubHex, adminKeyPair.secretKey, adminPubHex);

    expect(reveal).toHaveProperty('ciphertext');
    expect(reveal).toHaveProperty('nonce');
    expect(reveal.encryptedBy).toBe(adminPubHex);
    expect(reveal.revealedAt).toBeGreaterThan(0);
    expect(reveal.producerConfirmed).toBe(false);
    expect(reveal.confirmedAt).toBeNull();
  });
});
