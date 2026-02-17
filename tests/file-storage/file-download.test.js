/**
 * Tests for file download and reassembly.
 * 
 * See docs/FILE_STORAGE_SPEC.md §15.9
 */

import {
  splitIntoChunks,
  hashChunks,
  encryptChunk,
  decryptChunk,
  reassembleFile,
  toBlob,
  downloadBlob,
  CHUNK_SIZE,
} from '../../frontend/src/utils/fileChunking';
import nacl from 'tweetnacl';

describe('file-download', () => {
  describe('reassembleFile', () => {
    it('should reassemble single-chunk file', async () => {
      const original = new Uint8Array([10, 20, 30, 40, 50]);
      const { chunks } = await splitIntoChunks(original);
      const { chunkHashes } = await hashChunks(chunks);
      
      const decryptedChunks = [{ data: chunks[0], index: 0 }];
      const { data, valid, errors } = await reassembleFile(decryptedChunks, chunkHashes, 5);
      
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
      expect(data).toEqual(original);
    });

    it('should reassemble multi-chunk file', async () => {
      const size = CHUNK_SIZE * 3 + 42;
      const original = new Uint8Array(size);
      for (let i = 0; i < size; i++) original[i] = (i * 7) % 256;
      
      const { chunks } = await splitIntoChunks(original);
      const { chunkHashes } = await hashChunks(chunks);
      
      const decryptedChunks = chunks.map((c, i) => ({ data: c, index: i }));
      const { data, valid } = await reassembleFile(decryptedChunks, chunkHashes, size);
      
      expect(valid).toBe(true);
      expect(data).toEqual(original);
    });

    it('should handle chunks arriving out of order', async () => {
      const size = CHUNK_SIZE * 2 + 10;
      const original = new Uint8Array(size);
      for (let i = 0; i < size; i++) original[i] = i % 256;
      
      const { chunks } = await splitIntoChunks(original);
      const { chunkHashes } = await hashChunks(chunks);
      
      // Reverse the order
      const decryptedChunks = chunks.map((c, i) => ({ data: c, index: i })).reverse();
      const { data, valid } = await reassembleFile(decryptedChunks, chunkHashes, size);
      
      expect(valid).toBe(true);
      expect(data).toEqual(original);
    });

    it('should detect corrupted chunk', async () => {
      const original = new Uint8Array([1, 2, 3, 4, 5]);
      const { chunks } = await splitIntoChunks(original);
      const { chunkHashes } = await hashChunks(chunks);
      
      // Corrupt the data
      const corrupted = new Uint8Array(chunks[0]);
      corrupted[0] = 255;
      
      const { valid, errors } = await reassembleFile(
        [{ data: corrupted, index: 0 }],
        chunkHashes,
        5
      );
      
      expect(valid).toBe(false);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('hash mismatch');
    });

    it('should handle empty file', async () => {
      const original = new Uint8Array(0);
      const { chunks } = await splitIntoChunks(original);
      // Empty file = 0 chunks, but splitIntoChunks gives 0 chunks for empty data
      // Edge case: no chunks to reassemble
      if (chunks.length === 0) {
        const { data, valid } = await reassembleFile([], [], 0);
        expect(valid).toBe(true);
        expect(data.length).toBe(0);
      }
    });
  });

  describe('end-to-end download flow', () => {
    it('should encrypt, split, reassemble and decrypt correctly', async () => {
      const key = nacl.randomBytes(32);
      const size = CHUNK_SIZE + 500;
      const original = new Uint8Array(size);
      for (let i = 0; i < size; i++) original[i] = (i * 13) % 256;
      
      // Upload side: split and encrypt
      const { chunks: rawChunks } = await splitIntoChunks(original);
      const { chunkHashes } = await hashChunks(rawChunks);
      const encryptedChunks = rawChunks.map(c => encryptChunk(c, key));
      
      // Download side: decrypt each chunk
      const decryptedChunks = encryptedChunks.map((ec, i) => {
        const decrypted = decryptChunk(ec.encrypted, ec.nonce, key);
        expect(decrypted).not.toBeNull();
        return { data: decrypted, index: i };
      });
      
      // Reassemble
      const { data, valid } = await reassembleFile(decryptedChunks, chunkHashes, size);
      expect(valid).toBe(true);
      expect(data).toEqual(original);
    });

    it('should detect decryption failure with wrong key', async () => {
      const key = nacl.randomBytes(32);
      const wrongKey = nacl.randomBytes(32);
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      
      const { encrypted, nonce } = encryptChunk(data, key);
      const result = decryptChunk(encrypted, nonce, wrongKey);
      expect(result).toBeNull();
    });
  });

  describe('toBlob', () => {
    it('should create blob with correct size and type', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const blob = toBlob(data, 'application/pdf');
      expect(blob.size).toBe(5);
      expect(blob.type).toBe('application/pdf');
    });

    it('should default mime type', () => {
      const blob = toBlob(new Uint8Array([1]));
      expect(blob.type).toBe('application/octet-stream');
    });
  });

  describe('downloadBlob', () => {
    it('should create and click an anchor element', () => {
      // jsdom doesn't have URL.createObjectURL, so define them
      URL.createObjectURL = jest.fn(() => 'blob:test');
      URL.revokeObjectURL = jest.fn();
      
      const blob = new Blob([new Uint8Array([1, 2, 3])]);
      
      // Mock document.createElement
      const mockAnchor = {
        href: '',
        download: '',
        style: { display: '' },
        click: jest.fn(),
      };
      const createElementSpy = jest.spyOn(document, 'createElement').mockReturnValue(mockAnchor);
      const appendChildSpy = jest.spyOn(document.body, 'appendChild').mockImplementation(() => {});
      const removeChildSpy = jest.spyOn(document.body, 'removeChild').mockImplementation(() => {});
      
      downloadBlob(blob, 'test.pdf');
      
      expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
      expect(mockAnchor.href).toBe('blob:test');
      expect(mockAnchor.download).toBe('test.pdf');
      expect(mockAnchor.click).toHaveBeenCalled();
      
      delete URL.createObjectURL;
      delete URL.revokeObjectURL;
      createElementSpy.mockRestore();
      appendChildSpy.mockRestore();
      removeChildSpy.mockRestore();
    });
  });
});
