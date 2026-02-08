/**
 * Test Suite: Sharing Utilities
 * Tests for share link generation and parsing
 */

import { describe, test, expect, beforeAll } from '@jest/globals';
import { webcrypto } from 'crypto';
import { 
  generateShareLink, 
  parseShareLink, 
  isValidShareLink,
  createNewEntity,
  createNewDocument,
} from '../frontend/src/utils/sharing';

// Setup crypto.subtle for Node.js test environment
beforeAll(() => {
  if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
  }
});

describe('Sharing Utilities', () => {
  // Sample entity IDs (32 hex chars = 16 bytes)
  const sampleWorkspaceId = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
  const sampleFolderId = 'f1e2d3c4b5a6f7e8d9c0b1a2f3e4d5c6';
  const sampleDocumentId = 'd1c2b3a4f5e6d7c8b9a0f1e2d3c4b5a6';

  describe('generateShareLink', () => {
    test('generates valid workspace share link', () => {
      const link = generateShareLink({
        entityType: 'workspace',
        entityId: sampleWorkspaceId,
        permission: 'owner',
        hasPassword: true,
        password: 'test-password',
      });

      expect(link).toMatch(/^nightjar:\/\/w\//i);
      expect(link).toContain('perm:o');
      expect(link).toContain('p:test-password');
    });

    test('generates valid folder share link', () => {
      const link = generateShareLink({
        entityType: 'folder',
        entityId: sampleFolderId,
        permission: 'editor',
        hasPassword: true,
        password: 'folder-pass',
      });

      expect(link).toMatch(/^nightjar:\/\/f\//i);
      expect(link).toContain('perm:e');
    });

    test('generates valid document share link', () => {
      const link = generateShareLink({
        entityType: 'document',
        entityId: sampleDocumentId,
        permission: 'viewer',
        hasPassword: true,
        password: 'doc-pass',
      });

      expect(link).toMatch(/^nightjar:\/\/d\//i);
      expect(link).toContain('perm:v');
    });

    test('throws on invalid entity ID length', () => {
      expect(() => generateShareLink({
        entityType: 'workspace',
        entityId: 'too-short',
        permission: 'owner',
      })).toThrow();
    });

    test('supports all permission levels', () => {
      const permissions = ['owner', 'editor', 'viewer'];
      const codes = ['o', 'e', 'v'];

      permissions.forEach((perm, i) => {
        const link = generateShareLink({
          entityType: 'workspace',
          entityId: sampleWorkspaceId,
          permission: perm,
          hasPassword: true,
          password: 'test',
        });
        expect(link).toContain(`perm:${codes[i]}`);
      });
    });
  });

  describe('parseShareLink', () => {
    test('parses workspace link correctly', () => {
      const link = generateShareLink({
        entityType: 'workspace',
        entityId: sampleWorkspaceId,
        permission: 'owner',
        hasPassword: true,
        password: 'test-pass',
      });

      const parsed = parseShareLink(link);
      
      expect(parsed.entityType).toBe('workspace');
      expect(parsed.entityId).toBe(sampleWorkspaceId);
      expect(parsed.permission).toBe('owner');
      expect(parsed.embeddedPassword).toBe('test-pass');
    });

    test('parses folder link correctly', () => {
      const link = generateShareLink({
        entityType: 'folder',
        entityId: sampleFolderId,
        permission: 'editor',
        hasPassword: true,
        password: 'folder-pass',
      });

      const parsed = parseShareLink(link);
      
      expect(parsed.entityType).toBe('folder');
      expect(parsed.entityId).toBe(sampleFolderId);
      expect(parsed.permission).toBe('editor');
    });

    test('parses document link correctly', () => {
      const link = generateShareLink({
        entityType: 'document',
        entityId: sampleDocumentId,
        permission: 'viewer',
        hasPassword: true,
        password: 'doc-pass',
      });

      const parsed = parseShareLink(link);
      
      expect(parsed.entityType).toBe('document');
      expect(parsed.entityId).toBe(sampleDocumentId);
      expect(parsed.permission).toBe('viewer');
    });

    test('throws on invalid link format', () => {
      expect(() => parseShareLink('invalid')).toThrow();
      expect(() => parseShareLink('nightjar://x/abc')).toThrow();
    });

    test('round-trip: generate then parse returns same data', () => {
      const original = {
        entityType: 'workspace',
        entityId: sampleWorkspaceId,
        permission: 'editor',
        hasPassword: true,
        password: 'round-trip-test',
      };

      const link = generateShareLink(original);
      const parsed = parseShareLink(link);

      expect(parsed.entityType).toBe(original.entityType);
      expect(parsed.entityId).toBe(original.entityId);
      expect(parsed.permission).toBe(original.permission);
      expect(parsed.embeddedPassword).toBe(original.password);
    });
  });

  describe('isValidShareLink', () => {
    test('validates correct link formats', () => {
      const validLink = generateShareLink({
        entityType: 'workspace',
        entityId: sampleWorkspaceId,
        permission: 'owner',
        hasPassword: true,
        password: 'test',
      });

      expect(isValidShareLink(validLink)).toBe(true);
    });

    test('rejects invalid links', () => {
      expect(isValidShareLink('')).toBe(false);
      expect(isValidShareLink('http://example.com')).toBe(false);
      expect(isValidShareLink('nightjar://invalid')).toBe(false);
      expect(isValidShareLink(null)).toBe(false);
      expect(isValidShareLink(undefined)).toBe(false);
    });
  });

  describe('createNewEntity', () => {
    test('creates new workspace with ID and share link', async () => {
      const result = await createNewEntity('workspace', {
        password: 'workspace-pass',
        permission: 'owner',
      });

      expect(result.entityId).toBeDefined();
      expect(result.entityId.length).toBe(32);
      expect(result.shareLink).toMatch(/^nightjar:\/\/w\//i);
    });

    test('creates new folder with ID and share link', async () => {
      const result = await createNewEntity('folder', {
        password: 'folder-pass',
        permission: 'editor',
      });

      expect(result.entityId).toBeDefined();
      expect(result.shareLink).toMatch(/^nightjar:\/\/f\//i);
    });

    test('creates new document with ID and share link', async () => {
      const result = await createNewEntity('document', {
        password: 'doc-pass',
        permission: 'viewer',
      });

      expect(result.entityId).toBeDefined();
      expect(result.shareLink).toMatch(/^nightjar:\/\/d\//i);
    });

    test('generated IDs are unique', async () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        const result = await createNewEntity('workspace', { password: 'test' });
        ids.add(result.entityId);
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('createNewDocument (legacy)', () => {
    test('creates document with default options', async () => {
      const result = await createNewDocument();
      
      expect(result.documentId).toBeDefined();
      expect(result.shareLink).toBeDefined();
    });

    test('creates document with password', async () => {
      const result = await createNewDocument({ password: 'legacy-pass' });
      
      expect(result.documentId).toBeDefined();
      expect(result.shareLink).toContain('p:legacy-pass');
    });
  });
});
