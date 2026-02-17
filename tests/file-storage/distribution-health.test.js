/**
 * Tests for distribution health computation.
 * Tests the chunk availability tracking and health calculations
 * used in the file storage system.
 * 
 * See docs/FILE_STORAGE_SPEC.md §15.9
 */

import {
  splitIntoChunks,
  hashChunks,
  CHUNK_SIZE,
} from '../../frontend/src/utils/fileChunking';

/**
 * Compute distribution health for a file given chunk availability.
 * This is a pure function used in the dashboard.
 * 
 * @param {number} chunkCount - total chunks
 * @param {Map<string, { holders: string[] }>} availability - chunkKey -> holders
 * @param {string} fileId 
 * @param {number} totalPeers - connected peers
 * @returns {{ health: number, minSeeders: number, avgSeeders: number, missingChunks: number[] }}
 */
function computeDistributionHealth(chunkCount, availability, fileId, totalPeers) {
  if (chunkCount === 0) return { health: 1, minSeeders: 0, avgSeeders: 0, missingChunks: [] };
  
  const missingChunks = [];
  let totalHolders = 0;
  let minHolders = Infinity;

  for (let i = 0; i < chunkCount; i++) {
    const key = `${fileId}:${i}`;
    const entry = availability.get(key);
    const holders = entry?.holders?.length || 0;
    
    if (holders === 0) {
      missingChunks.push(i);
    }
    
    totalHolders += holders;
    if (holders < minHolders) minHolders = holders;
  }

  if (minHolders === Infinity) minHolders = 0;
  const avgSeeders = chunkCount > 0 ? totalHolders / chunkCount : 0;
  
  // Health: 0 if any chunk missing, otherwise ratio of min seeders to desired minimum (2)
  const desiredMin = 2;
  const health = missingChunks.length > 0 ? 0 : Math.min(minHolders / desiredMin, 1);

  return { health, minSeeders: minHolders, avgSeeders, missingChunks };
}

describe('distribution-health', () => {
  describe('computeDistributionHealth', () => {
    it('should return full health when all chunks have 2+ seeders', () => {
      const availability = new Map();
      availability.set('file1:0', { holders: ['peerA', 'peerB'] });
      availability.set('file1:1', { holders: ['peerA', 'peerB', 'peerC'] });
      availability.set('file1:2', { holders: ['peerA', 'peerB'] });
      
      const result = computeDistributionHealth(3, availability, 'file1', 3);
      expect(result.health).toBe(1);
      expect(result.minSeeders).toBe(2);
      expect(result.avgSeeders).toBeCloseTo(2.33, 1);
      expect(result.missingChunks).toHaveLength(0);
    });

    it('should return partial health with 1 seeder', () => {
      const availability = new Map();
      availability.set('file1:0', { holders: ['peerA'] });
      availability.set('file1:1', { holders: ['peerA', 'peerB'] });
      
      const result = computeDistributionHealth(2, availability, 'file1', 2);
      expect(result.health).toBe(0.5); // min seeders = 1, desired = 2 → 0.5
      expect(result.minSeeders).toBe(1);
      expect(result.missingChunks).toHaveLength(0);
    });

    it('should return 0 health when any chunk is missing', () => {
      const availability = new Map();
      availability.set('file1:0', { holders: ['peerA', 'peerB'] });
      // chunk 1 missing
      availability.set('file1:2', { holders: ['peerA'] });
      
      const result = computeDistributionHealth(3, availability, 'file1', 2);
      expect(result.health).toBe(0);
      expect(result.missingChunks).toEqual([1]);
    });

    it('should identify all missing chunks', () => {
      const availability = new Map();
      // All chunks missing
      const result = computeDistributionHealth(5, availability, 'file1', 3);
      expect(result.health).toBe(0);
      expect(result.missingChunks).toEqual([0, 1, 2, 3, 4]);
    });

    it('should handle empty file (0 chunks)', () => {
      const result = computeDistributionHealth(0, new Map(), 'file1', 3);
      expect(result.health).toBe(1);
      expect(result.missingChunks).toHaveLength(0);
    });

    it('should cap health at 1.0 even with many seeders', () => {
      const availability = new Map();
      availability.set('file1:0', { holders: ['a', 'b', 'c', 'd', 'e'] });
      
      const result = computeDistributionHealth(1, availability, 'file1', 5);
      expect(result.health).toBe(1);
      expect(result.minSeeders).toBe(5);
    });

    it('should compute correct average seeders', () => {
      const availability = new Map();
      availability.set('file1:0', { holders: ['a'] });
      availability.set('file1:1', { holders: ['a', 'b', 'c'] });
      
      const result = computeDistributionHealth(2, availability, 'file1', 3);
      expect(result.avgSeeders).toBe(2); // (1 + 3) / 2
    });
  });

  describe('chunk splitting produces correct count for health tracking', () => {
    it('should produce predictable chunk counts', async () => {
      // 1 byte → 1 chunk
      expect((await splitIntoChunks(new Uint8Array(1))).chunks.length).toBe(1);
      // Exactly CHUNK_SIZE → 1 chunk
      expect((await splitIntoChunks(new Uint8Array(CHUNK_SIZE))).chunks.length).toBe(1);
      // CHUNK_SIZE + 1 → 2 chunks
      expect((await splitIntoChunks(new Uint8Array(CHUNK_SIZE + 1))).chunks.length).toBe(2);
      // 5 MB → 5 chunks
      expect((await splitIntoChunks(new Uint8Array(CHUNK_SIZE * 5))).chunks.length).toBe(5);
    });

    it('should produce hashable chunks for availability tracking', async () => {
      const data = new Uint8Array(CHUNK_SIZE * 2 + 100);
      for (let i = 0; i < data.length; i++) data[i] = i % 256;
      
      const { chunks } = await splitIntoChunks(data);
      const { chunkHashes } = await hashChunks(chunks);
      
      expect(chunkHashes.length).toBe(chunks.length);
      expect(chunkHashes.length).toBe(3);
      
      // Each hash should be unique
      const unique = new Set(chunkHashes);
      expect(unique.size).toBe(3);
    });
  });
});
