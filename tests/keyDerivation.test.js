/**
 * Test Suite: Key Derivation
 * Tests for hierarchical key derivation (Argon2id)
 */

import { describe, test, expect, beforeAll } from '@jest/globals';
import { 
  deriveKey,
  deriveKeyWithCache,
  deriveWorkspaceKey,
  deriveFolderKey,
  deriveDocumentKey,
  deriveKeyChain,
  deriveTopicHash,
  clearKeyCache,
  isArgon2Ready,
  storeKeyChain,
  getStoredKeyChain,
} from '../frontend/src/utils/keyDerivation';

describe('Key Derivation', () => {
  const testPassword = 'tiger-castle-ocean-purple';
  const testWorkspaceId = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
  const testFolderId = 'f1e2d3c4b5a6f7e8d9c0b1a2f3e4d5c6';
  const testDocumentId = 'd1c2b3a4f5e6d7c8b9a0f1e2d3c4b5a6';

  beforeAll(async () => {
    // Ensure Argon2 WASM is loaded
    const ready = await isArgon2Ready();
    expect(ready).toBe(true);
  });

  describe('deriveKey (base function)', () => {
    test('derives 256-bit key from password and document ID', async () => {
      const key = await deriveKey(testPassword, testDocumentId);
      
      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32); // 256 bits
    });

    test('same inputs produce same key', async () => {
      const key1 = await deriveKey(testPassword, testDocumentId);
      const key2 = await deriveKey(testPassword, testDocumentId);
      
      expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(true);
    });

    test('different passwords produce different keys', async () => {
      const key1 = await deriveKey('password1', testDocumentId);
      const key2 = await deriveKey('password2', testDocumentId);
      
      expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(false);
    });

    test('different document IDs produce different keys', async () => {
      const key1 = await deriveKey(testPassword, 'doc1111111111111111111111111111');
      const key2 = await deriveKey(testPassword, 'doc2222222222222222222222222222');
      
      expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(false);
    });

    test('throws on missing password', async () => {
      await expect(deriveKey('', testDocumentId)).rejects.toThrow();
      await expect(deriveKey(null, testDocumentId)).rejects.toThrow();
    });

    test('throws on missing document ID', async () => {
      await expect(deriveKey(testPassword, '')).rejects.toThrow();
      await expect(deriveKey(testPassword, null)).rejects.toThrow();
    });
  });

  describe('deriveWorkspaceKey', () => {
    test('derives workspace key from password', async () => {
      const key = await deriveWorkspaceKey(testPassword, testWorkspaceId);
      
      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
    });

    test('workspace key is deterministic', async () => {
      const key1 = await deriveWorkspaceKey(testPassword, testWorkspaceId);
      const key2 = await deriveWorkspaceKey(testPassword, testWorkspaceId);
      
      expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(true);
    });
  });

  describe('deriveFolderKey', () => {
    test('derives folder key from parent key', async () => {
      const workspaceKey = await deriveWorkspaceKey(testPassword, testWorkspaceId);
      const folderKey = await deriveFolderKey(workspaceKey, testFolderId);
      
      expect(folderKey).toBeInstanceOf(Uint8Array);
      expect(folderKey.length).toBe(32);
    });

    test('folder key differs from workspace key', async () => {
      const workspaceKey = await deriveWorkspaceKey(testPassword, testWorkspaceId);
      const folderKey = await deriveFolderKey(workspaceKey, testFolderId);
      
      expect(Buffer.from(workspaceKey).equals(Buffer.from(folderKey))).toBe(false);
    });

    test('different folders have different keys', async () => {
      const workspaceKey = await deriveWorkspaceKey(testPassword, testWorkspaceId);
      const folderKey1 = await deriveFolderKey(workspaceKey, 'folder111111111111111111111111');
      const folderKey2 = await deriveFolderKey(workspaceKey, 'folder222222222222222222222222');
      
      expect(Buffer.from(folderKey1).equals(Buffer.from(folderKey2))).toBe(false);
    });
  });

  describe('deriveDocumentKey', () => {
    test('derives document key from folder key', async () => {
      const workspaceKey = await deriveWorkspaceKey(testPassword, testWorkspaceId);
      const folderKey = await deriveFolderKey(workspaceKey, testFolderId);
      const documentKey = await deriveDocumentKey(folderKey, testDocumentId);
      
      expect(documentKey).toBeInstanceOf(Uint8Array);
      expect(documentKey.length).toBe(32);
    });

    test('document key differs from folder key', async () => {
      const workspaceKey = await deriveWorkspaceKey(testPassword, testWorkspaceId);
      const folderKey = await deriveFolderKey(workspaceKey, testFolderId);
      const documentKey = await deriveDocumentKey(folderKey, testDocumentId);
      
      expect(Buffer.from(folderKey).equals(Buffer.from(documentKey))).toBe(false);
    });
  });

  describe('deriveKeyChain', () => {
    test('derives complete key chain from password', async () => {
      const keyChain = await deriveKeyChain(testPassword, {
        workspaceId: testWorkspaceId,
        folderPath: [testFolderId],
        documentId: testDocumentId,
      });

      expect(keyChain.workspaceKey).toBeDefined();
      expect(keyChain.workspaceKey.length).toBe(32);
      expect(keyChain.folderKeys[testFolderId]).toBeDefined();
      expect(keyChain.documentKey).toBeDefined();
    });

    test('key chain has correct workspace ID', async () => {
      const keyChain = await deriveKeyChain(testPassword, {
        workspaceId: testWorkspaceId,
        folderPath: [],
      });

      expect(keyChain.workspaceId).toBe(testWorkspaceId);
    });

    test('throws if document without folder', async () => {
      await expect(deriveKeyChain(testPassword, {
        workspaceId: testWorkspaceId,
        folderPath: [],
        documentId: testDocumentId,
      })).rejects.toThrow('Documents must be in a folder');
    });

    test('supports nested folder hierarchy', async () => {
      const nestedFolders = [
        'folder111111111111111111111111',
        'folder222222222222222222222222',
        'folder333333333333333333333333',
      ];

      const keyChain = await deriveKeyChain(testPassword, {
        workspaceId: testWorkspaceId,
        folderPath: nestedFolders,
      });

      expect(Object.keys(keyChain.folderKeys).length).toBe(3);
      nestedFolders.forEach(folderId => {
        expect(keyChain.folderKeys[folderId]).toBeDefined();
      });
    });
  });

  describe('deriveTopicHash', () => {
    test('derives topic hash for P2P discovery', async () => {
      const topic = await deriveTopicHash(testPassword, testDocumentId);
      
      expect(typeof topic).toBe('string');
      expect(topic.length).toBe(64); // 32 bytes as hex
    });

    test('topic is deterministic', async () => {
      const topic1 = await deriveTopicHash(testPassword, testDocumentId);
      const topic2 = await deriveTopicHash(testPassword, testDocumentId);
      
      expect(topic1).toBe(topic2);
    });
  });

  describe('Key caching', () => {
    beforeEach(() => {
      clearKeyCache();
    });

    test('deriveKeyWithCache returns cached key', async () => {
      const start1 = Date.now();
      const key1 = await deriveKeyWithCache(testPassword, testDocumentId);
      const time1 = Date.now() - start1;

      const start2 = Date.now();
      const key2 = await deriveKeyWithCache(testPassword, testDocumentId);
      const time2 = Date.now() - start2;

      expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(true);
      // Cached version should be much faster
      expect(time2).toBeLessThan(time1 / 2);
    });

    test('clearKeyCache clears all cached keys', async () => {
      await deriveKeyWithCache(testPassword, testDocumentId);
      clearKeyCache();
      
      // After clearing, should need to derive again (slower)
      const start = Date.now();
      await deriveKeyWithCache(testPassword, testDocumentId);
      const time = Date.now() - start;
      
      // Should take time since cache was cleared
      expect(time).toBeGreaterThan(10);
    });
  });

  describe('Key storage', () => {
    const testKeyChain = {
      workspaceKey: new Uint8Array(32).fill(1),
      workspaceId: testWorkspaceId,
      password: testPassword,
      folderKeys: {},
    };

    test('storeKeyChain and getStoredKeyChain work together', () => {
      storeKeyChain(testWorkspaceId, testKeyChain);
      const retrieved = getStoredKeyChain(testWorkspaceId);
      
      expect(retrieved).toBeDefined();
      expect(retrieved.workspaceId).toBe(testWorkspaceId);
    });

    test('getStoredKeyChain returns null for unknown ID', () => {
      const retrieved = getStoredKeyChain('unknown-workspace-id');
      expect(retrieved).toBeNull();
    });
  });
});
