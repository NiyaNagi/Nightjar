/**
 * Tests for file encryption/decryption.
 * 
 * See docs/FILE_STORAGE_SPEC.md §15.9
 */

import {
  encryptChunk,
  decryptChunk,
  processFileForUpload,
  CHUNK_SIZE,
} from '../../frontend/src/utils/fileChunking';
import nacl from 'tweetnacl';

describe('file-encryption', () => {
  describe('encryptChunk', () => {
    const key = nacl.randomBytes(32);

    it('should return encrypted data and nonce', () => {
      const plaintext = new Uint8Array(100);
      for (let i = 0; i < 100; i++) plaintext[i] = i;
      const { encrypted, nonce } = encryptChunk(plaintext, key);
      
      expect(encrypted).toBeInstanceOf(Uint8Array);
      expect(nonce).toBeInstanceOf(Uint8Array);
      expect(nonce.length).toBe(24); // nacl.secretbox.nonceLength
      // Encrypted is larger than plaintext due to MAC
      expect(encrypted.length).toBe(plaintext.length + nacl.secretbox.overheadLength);
    });

    it('should encrypt with unique nonce each time', () => {
      const plaintext = new Uint8Array([1, 2, 3]);
      const results = [];
      for (let i = 0; i < 5; i++) {
        results.push(encryptChunk(plaintext, key));
      }
      // All nonces should be unique
      const nonces = results.map(r => Array.from(r.nonce).join(','));
      const uniqueNonces = new Set(nonces);
      expect(uniqueNonces.size).toBe(5);
    });

    it('should encrypt a chunk at maximum CHUNK_SIZE', () => {
      const plaintext = new Uint8Array(CHUNK_SIZE);
      const { encrypted, nonce } = encryptChunk(plaintext, key);
      expect(encrypted.length).toBe(CHUNK_SIZE + nacl.secretbox.overheadLength);
      // Verify decryption
      const decrypted = decryptChunk(encrypted, nonce, key);
      expect(decrypted).toEqual(plaintext);
    });
  });

  describe('decryptChunk', () => {
    const key = nacl.randomBytes(32);

    it('should decrypt correctly encrypted data', () => {
      const original = new Uint8Array([42, 84, 126, 168, 210]);
      const { encrypted, nonce } = encryptChunk(original, key);
      const result = decryptChunk(encrypted, nonce, key);
      expect(result).toEqual(original);
    });

    it('should return null on tampered ciphertext', () => {
      const original = new Uint8Array([1, 2, 3]);
      const { encrypted, nonce } = encryptChunk(original, key);
      // Tamper with first byte
      encrypted[0] = encrypted[0] ^ 0xFF;
      const result = decryptChunk(encrypted, nonce, key);
      expect(result).toBeNull();
    });

    it('should return null on wrong key', () => {
      const original = new Uint8Array([1, 2, 3]);
      const { encrypted, nonce } = encryptChunk(original, key);
      const wrongKey = nacl.randomBytes(32);
      const result = decryptChunk(encrypted, nonce, wrongKey);
      expect(result).toBeNull();
    });

    it('should return null on wrong nonce', () => {
      const original = new Uint8Array([1, 2, 3]);
      const { encrypted } = encryptChunk(original, key);
      const wrongNonce = nacl.randomBytes(24);
      const result = decryptChunk(encrypted, wrongNonce, key);
      expect(result).toBeNull();
    });
  });

  describe('end-to-end encryption flow', () => {
    it('should encrypt and decrypt multi-chunk file', async () => {
      const key = nacl.randomBytes(32);
      const size = CHUNK_SIZE * 2 + 500;
      const original = new Uint8Array(size);
      for (let i = 0; i < size; i++) original[i] = i % 256;

      const result = await processFileForUpload(original, key);
      expect(result.chunks.length).toBe(3);

      // Decrypt each chunk and verify
      const decryptedPieces = [];
      for (const chunk of result.chunks) {
        const decrypted = decryptChunk(chunk.encrypted, chunk.nonce, key);
        expect(decrypted).not.toBeNull();
        decryptedPieces.push(decrypted);
      }

      // Reassemble
      const reassembled = new Uint8Array(size);
      let offset = 0;
      for (const piece of decryptedPieces) {
        reassembled.set(piece, offset);
        offset += piece.length;
      }
      expect(reassembled).toEqual(original);
    });

    it('should maintain data integrity across encrypt/decrypt cycle', async () => {
      const key = nacl.randomBytes(32);
      // Test with known data pattern
      const data = new Uint8Array(256);
      for (let i = 0; i < 256; i++) data[i] = i;

      const { encrypted, nonce } = encryptChunk(data, key);
      const decrypted = decryptChunk(encrypted, nonce, key);
      expect(decrypted).toEqual(data);
      
      // Verify every byte matches
      for (let i = 0; i < 256; i++) {
        expect(decrypted[i]).toBe(i);
      }
    });
  });
});
