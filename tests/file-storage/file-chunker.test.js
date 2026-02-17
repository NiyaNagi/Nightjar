/**
 * Tests for fileChunking.js — splitting, hashing, encryption, reassembly.
 * 
 * See docs/FILE_STORAGE_SPEC.md §15.9
 */

import {
  sha256,
  splitIntoChunks,
  hashChunks,
  encryptChunk,
  decryptChunk,
  processFileForUpload,
  reassembleFile,
  toBlob,
  CHUNK_SIZE,
  MAX_FILE_SIZE,
} from '../../frontend/src/utils/fileChunking';
import nacl from 'tweetnacl';

describe('fileChunking', () => {
  // --- sha256 ---
  describe('sha256', () => {
    it('should produce consistent hashes for identical data', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const hash1 = await sha256(data);
      const hash2 = await sha256(data);
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different data', async () => {
      const data1 = new Uint8Array([1, 2, 3]);
      const data2 = new Uint8Array([4, 5, 6]);
      const hash1 = await sha256(data1);
      const hash2 = await sha256(data2);
      expect(hash1).not.toBe(hash2);
    });

    it('should produce a 64-char hex string', async () => {
      const data = new Uint8Array([0]);
      const hash = await sha256(data);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should handle empty data', async () => {
      const data = new Uint8Array(0);
      const hash = await sha256(data);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should handle ArrayBuffer input', async () => {
      const buffer = new Uint8Array([1, 2, 3]).buffer;
      const hash = await sha256(buffer);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // --- splitIntoChunks ---
  describe('splitIntoChunks', () => {
    it('should split a small file into one chunk', async () => {
      const data = new Uint8Array(100);
      const { chunks, totalSize } = await splitIntoChunks(data);
      expect(chunks.length).toBe(1);
      expect(totalSize).toBe(100);
      expect(chunks[0].length).toBe(100);
    });

    it('should split data exactly at CHUNK_SIZE into one chunk', async () => {
      const data = new Uint8Array(CHUNK_SIZE);
      const { chunks } = await splitIntoChunks(data);
      expect(chunks.length).toBe(1);
      expect(chunks[0].length).toBe(CHUNK_SIZE);
    });

    it('should split data at CHUNK_SIZE + 1 into two chunks', async () => {
      const data = new Uint8Array(CHUNK_SIZE + 1);
      const { chunks } = await splitIntoChunks(data);
      expect(chunks.length).toBe(2);
      expect(chunks[0].length).toBe(CHUNK_SIZE);
      expect(chunks[1].length).toBe(1);
    });

    it('should handle multi-chunk files correctly', async () => {
      const size = CHUNK_SIZE * 3 + 500;
      const data = new Uint8Array(size);
      for (let i = 0; i < size; i++) data[i] = i % 256;
      const { chunks, totalSize } = await splitIntoChunks(data);
      expect(chunks.length).toBe(4);
      expect(totalSize).toBe(size);
      expect(chunks[3].length).toBe(500);
    });

    it('should preserve data content through split', async () => {
      const original = new Uint8Array([10, 20, 30, 40, 50]);
      const { chunks } = await splitIntoChunks(original);
      expect(chunks[0]).toEqual(original);
    });

    it('should throw on invalid input', async () => {
      await expect(splitIntoChunks('not valid')).rejects.toThrow();
    });

    it('should handle File-like input via ArrayBuffer', async () => {
      const data = new Uint8Array([1, 2, 3]);
      const { chunks, totalSize } = await splitIntoChunks(data.buffer);
      expect(chunks.length).toBe(1);
      expect(totalSize).toBe(3);
    });
  });

  // --- hashChunks ---
  describe('hashChunks', () => {
    it('should hash each chunk individually', async () => {
      const chunk1 = new Uint8Array([1, 2, 3]);
      const chunk2 = new Uint8Array([4, 5, 6]);
      const { chunkHashes, fileHash } = await hashChunks([chunk1, chunk2]);
      expect(chunkHashes.length).toBe(2);
      expect(chunkHashes[0]).toMatch(/^[0-9a-f]{64}$/);
      expect(chunkHashes[1]).toMatch(/^[0-9a-f]{64}$/);
      expect(chunkHashes[0]).not.toBe(chunkHashes[1]);
      expect(fileHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce a deterministic file hash', async () => {
      const chunks = [new Uint8Array([1]), new Uint8Array([2])];
      const result1 = await hashChunks(chunks);
      const result2 = await hashChunks(chunks);
      expect(result1.fileHash).toBe(result2.fileHash);
      expect(result1.chunkHashes).toEqual(result2.chunkHashes);
    });

    it('should produce different file hashes for different data', async () => {
      const result1 = await hashChunks([new Uint8Array([1])]);
      const result2 = await hashChunks([new Uint8Array([2])]);
      expect(result1.fileHash).not.toBe(result2.fileHash);
    });
  });

  // --- encryptChunk / decryptChunk ---
  describe('encryption', () => {
    const key = nacl.randomBytes(32);

    it('should encrypt and decrypt a chunk successfully', () => {
      const plaintext = new Uint8Array([10, 20, 30, 40, 50]);
      const { encrypted, nonce } = encryptChunk(plaintext, key);
      expect(encrypted).not.toEqual(plaintext);
      expect(nonce.length).toBe(nacl.secretbox.nonceLength);

      const decrypted = decryptChunk(encrypted, nonce, key);
      expect(decrypted).toEqual(plaintext);
    });

    it('should fail with wrong key', () => {
      const plaintext = new Uint8Array([1, 2, 3]);
      const { encrypted, nonce } = encryptChunk(plaintext, key);
      const wrongKey = nacl.randomBytes(32);
      const result = decryptChunk(encrypted, nonce, wrongKey);
      expect(result).toBeNull();
    });

    it('should fail with wrong nonce', () => {
      const plaintext = new Uint8Array([1, 2, 3]);
      const { encrypted } = encryptChunk(plaintext, key);
      const wrongNonce = nacl.randomBytes(nacl.secretbox.nonceLength);
      const result = decryptChunk(encrypted, wrongNonce, key);
      expect(result).toBeNull();
    });

    it('should produce different ciphertexts for same plaintext (random nonce)', () => {
      const plaintext = new Uint8Array([1, 2, 3]);
      const result1 = encryptChunk(plaintext, key);
      const result2 = encryptChunk(plaintext, key);
      expect(result1.encrypted).not.toEqual(result2.encrypted);
      expect(result1.nonce).not.toEqual(result2.nonce);
    });

    it('should handle empty chunk', () => {
      const plaintext = new Uint8Array(0);
      const { encrypted, nonce } = encryptChunk(plaintext, key);
      const decrypted = decryptChunk(encrypted, nonce, key);
      expect(decrypted).toEqual(plaintext);
    });
  });

  // --- processFileForUpload ---
  describe('processFileForUpload', () => {
    const key = nacl.randomBytes(32);

    it('should process a small file', async () => {
      const data = new Uint8Array(100);
      for (let i = 0; i < 100; i++) data[i] = i;
      
      const result = await processFileForUpload(data, key);
      expect(result.chunkCount).toBe(1);
      expect(result.totalSize).toBe(100);
      expect(result.chunkHashes.length).toBe(1);
      expect(result.fileHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.chunks.length).toBe(1);
      expect(result.chunks[0].index).toBe(0);
      expect(result.chunks[0].encrypted).toBeDefined();
      expect(result.chunks[0].nonce).toBeDefined();
      expect(result.chunks[0].hash).toBe(result.chunkHashes[0]);
    });

    it('should call onProgress callback', async () => {
      const data = new Uint8Array(CHUNK_SIZE * 2 + 1);
      const progress = jest.fn();
      await processFileForUpload(data, key, progress);
      expect(progress).toHaveBeenCalledTimes(3); // 3 chunks
      expect(progress).toHaveBeenCalledWith(0, 3);
      expect(progress).toHaveBeenCalledWith(1, 3);
      expect(progress).toHaveBeenCalledWith(2, 3);
    });

    it('should produce decryptable chunks', async () => {
      const data = new Uint8Array([42, 43, 44]);
      const result = await processFileForUpload(data, key);
      const decrypted = decryptChunk(
        result.chunks[0].encrypted,
        result.chunks[0].nonce,
        key
      );
      expect(decrypted).toEqual(data);
    });
  });

  // --- reassembleFile ---
  describe('reassembleFile', () => {
    it('should reassemble chunks in order', async () => {
      const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const { chunks } = await splitIntoChunks(original);
      const { chunkHashes } = await hashChunks(chunks);
      
      const decryptedChunks = chunks.map((c, i) => ({ data: c, index: i }));
      const { data, valid, errors } = await reassembleFile(decryptedChunks, chunkHashes, original.length);
      
      expect(valid).toBe(true);
      expect(errors.length).toBe(0);
      expect(data).toEqual(original);
    });

    it('should handle out-of-order chunks', async () => {
      const original = new Uint8Array(CHUNK_SIZE + 10);
      for (let i = 0; i < original.length; i++) original[i] = i % 256;
      const { chunks } = await splitIntoChunks(original);
      const { chunkHashes } = await hashChunks(chunks);
      
      // Reverse order
      const decryptedChunks = chunks.map((c, i) => ({ data: c, index: i })).reverse();
      const { data, valid } = await reassembleFile(decryptedChunks, chunkHashes, original.length);
      
      expect(valid).toBe(true);
      expect(data).toEqual(original);
    });

    it('should detect hash mismatch', async () => {
      const chunk = new Uint8Array([1, 2, 3]);
      const wrongHash = 'deadbeef'.repeat(8);
      
      const { valid, errors } = await reassembleFile(
        [{ data: chunk, index: 0 }],
        [wrongHash],
        3
      );
      
      expect(valid).toBe(false);
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain('hash mismatch');
    });

    it('should reject when chunk count does not match expected', async () => {
      const chunk1 = new Uint8Array([1, 2, 3]);
      const chunk2 = new Uint8Array([4, 5, 6]);
      const hash1 = await sha256(chunk1);
      const hash2 = await sha256(chunk2);

      // Provide 1 chunk but expect 2
      const { valid, errors } = await reassembleFile(
        [{ data: chunk1, index: 0 }],
        [hash1, hash2],
        6
      );

      expect(valid).toBe(false);
      expect(errors.some(e => e.includes('Expected 2 chunks but received 1'))).toBe(true);
    });

    it('should reject duplicate chunk indices', async () => {
      const chunk = new Uint8Array([1, 2, 3]);
      const hash = await sha256(chunk);

      const { valid, errors } = await reassembleFile(
        [{ data: chunk, index: 0 }, { data: chunk, index: 0 }],
        [hash, hash],
        6
      );

      expect(valid).toBe(false);
      expect(errors.some(e => e.includes('Duplicate chunk index'))).toBe(true);
    });

    it('should reject when a chunk index is missing', async () => {
      const chunk = new Uint8Array([1, 2, 3]);
      const hash = await sha256(chunk);

      // Provide chunk index 0 and 0 (dup), but expect indices 0 and 1
      const { valid, errors } = await reassembleFile(
        [{ data: chunk, index: 0 }, { data: chunk, index: 0 }],
        [hash, hash],
        6
      );

      expect(valid).toBe(false);
      expect(errors.some(e => e.includes('Missing chunk index: 1'))).toBe(true);
    });

    it('should reject when assembled size does not match totalSize', async () => {
      const chunk = new Uint8Array([1, 2, 3]);
      const hash = await sha256(chunk);

      // Claim totalSize is 10 but chunk only has 3 bytes
      const { valid, errors } = await reassembleFile(
        [{ data: chunk, index: 0 }],
        [hash],
        10
      );

      expect(valid).toBe(false);
      expect(errors.some(e => e.includes('Assembled size'))).toBe(true);
    });
  });

  // --- toBlob ---
  describe('toBlob', () => {
    it('should create a Blob from Uint8Array', () => {
      const data = new Uint8Array([1, 2, 3]);
      const blob = toBlob(data, 'image/png');
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('image/png');
      expect(blob.size).toBe(3);
    });

    it('should default to application/octet-stream', () => {
      const data = new Uint8Array([1]);
      const blob = toBlob(data);
      expect(blob.type).toBe('application/octet-stream');
    });
  });
});
