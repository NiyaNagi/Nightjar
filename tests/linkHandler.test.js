/**
 * Test Suite: Link Handler
 * Tests for share link navigation and handling
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import {
  handleShareLink,
  handleShareLinkWithPassword,
  isNightjarShareLink,
  peekShareLink,
  copyShareLink,
} from '../frontend/src/utils/linkHandler';
import { generateShareLink } from '../frontend/src/utils/sharing';

describe('Link Handler', () => {
  const sampleWorkspaceId = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
  const sampleFolderId = 'f1e2d3c4b5a6f7e8d9c0b1a2f3e4d5c6';
  const sampleDocumentId = 'd1c2b3a4f5e6d7c8b9a0f1e2d3c4b5a6';

  const mockOptions = {
    getWorkspace: jest.fn(),
    addWorkspace: jest.fn(),
    getFolder: jest.fn(),
    addFolder: jest.fn(),
    getDocument: jest.fn(),
    addDocument: jest.fn(),
    updatePermission: jest.fn(),
    navigate: jest.fn(),
    identity: { publicKeyHex: 'test-identity' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockOptions.getWorkspace.mockReturnValue(null);
    mockOptions.getFolder.mockReturnValue(null);
    mockOptions.getDocument.mockReturnValue(null);
  });

  describe('isNightjarShareLink', () => {
    test('recognizes valid Nightjar links', () => {
      expect(isNightjarShareLink('Nightjar://w/abc123')).toBe(true);
      expect(isNightjarShareLink('Nightjar://f/xyz789')).toBe(true);
      expect(isNightjarShareLink('Nightjar://d/def456')).toBe(true);
    });

    test('rejects invalid links', () => {
      expect(isNightjarShareLink('')).toBe(false);
      expect(isNightjarShareLink('http://example.com')).toBe(false);
      expect(isNightjarShareLink('https://Nightjar.com')).toBe(false);
      expect(isNightjarShareLink(null)).toBe(false);
      expect(isNightjarShareLink(undefined)).toBe(false);
      expect(isNightjarShareLink(123)).toBe(false);
    });
  });

  describe('peekShareLink', () => {
    test('extracts entity info without processing', () => {
      const link = generateShareLink({
        entityType: 'workspace',
        entityId: sampleWorkspaceId,
        permission: 'owner',
        hasPassword: true,
        password: 'test-pass',
      });

      const info = peekShareLink(link);
      
      expect(info).toBeDefined();
      expect(info.entityType).toBe('workspace');
      expect(info.entityId).toBe(sampleWorkspaceId);
      expect(info.permission).toBe('owner');
      expect(info.hasEmbeddedPassword).toBe(true);
    });

    test('returns null for invalid link', () => {
      expect(peekShareLink('invalid')).toBeNull();
      expect(peekShareLink('')).toBeNull();
      expect(peekShareLink(null)).toBeNull();
    });

    test('detects when password is missing', () => {
      const link = generateShareLink({
        entityType: 'document',
        entityId: sampleDocumentId,
        permission: 'viewer',
        hasPassword: true,
        // No password provided in link
      });

      const info = peekShareLink(link);
      expect(info.hasEmbeddedPassword).toBe(false);
    });
  });

  describe('handleShareLink', () => {
    test('handles workspace link successfully', async () => {
      const link = generateShareLink({
        entityType: 'workspace',
        entityId: sampleWorkspaceId,
        permission: 'owner',
        hasPassword: true,
        password: 'test-password',
      });

      const result = await handleShareLink(link, mockOptions);

      expect(result.success).toBe(true);
      expect(result.entityType).toBe('workspace');
      expect(result.entityId).toBe(sampleWorkspaceId);
      expect(result.permission).toBe('owner');
      expect(result.alreadyHadAccess).toBe(false);
    });

    test('handles folder link successfully', async () => {
      const link = generateShareLink({
        entityType: 'folder',
        entityId: sampleFolderId,
        permission: 'editor',
        hasPassword: true,
        password: 'folder-pass',
      });

      const result = await handleShareLink(link, mockOptions);

      expect(result.success).toBe(true);
      expect(result.entityType).toBe('folder');
      expect(result.entityId).toBe(sampleFolderId);
      expect(result.permission).toBe('editor');
    });

    test('handles document link successfully', async () => {
      const link = generateShareLink({
        entityType: 'document',
        entityId: sampleDocumentId,
        permission: 'viewer',
        hasPassword: true,
        password: 'doc-pass',
      });

      const result = await handleShareLink(link, mockOptions);

      expect(result.success).toBe(true);
      expect(result.entityType).toBe('document');
      expect(result.entityId).toBe(sampleDocumentId);
      expect(result.permission).toBe('viewer');
    });

    test('detects already-had-access scenario', async () => {
      mockOptions.getWorkspace.mockReturnValue({
        id: sampleWorkspaceId,
        permission: 'viewer',
      });

      const link = generateShareLink({
        entityType: 'workspace',
        entityId: sampleWorkspaceId,
        permission: 'editor',
        hasPassword: true,
        password: 'test',
      });

      const result = await handleShareLink(link, mockOptions);

      expect(result.alreadyHadAccess).toBe(true);
      expect(result.permissionUpgraded).toBe(true);
    });

    test('detects permission upgrade', async () => {
      mockOptions.getWorkspace.mockReturnValue({
        id: sampleWorkspaceId,
        permission: 'viewer',
      });

      const link = generateShareLink({
        entityType: 'workspace',
        entityId: sampleWorkspaceId,
        permission: 'owner', // Upgrade from viewer to owner
        hasPassword: true,
        password: 'test',
      });

      const result = await handleShareLink(link, mockOptions);

      expect(result.permissionUpgraded).toBe(true);
    });

    test('calls navigate on success', async () => {
      const link = generateShareLink({
        entityType: 'workspace',
        entityId: sampleWorkspaceId,
        permission: 'owner',
        hasPassword: true,
        password: 'test',
      });

      await handleShareLink(link, mockOptions);

      expect(mockOptions.navigate).toHaveBeenCalledWith('workspace', sampleWorkspaceId);
    });

    test('calls updatePermission for new access', async () => {
      const link = generateShareLink({
        entityType: 'workspace',
        entityId: sampleWorkspaceId,
        permission: 'editor',
        hasPassword: true,
        password: 'test',
      });

      await handleShareLink(link, mockOptions);

      expect(mockOptions.updatePermission).toHaveBeenCalledWith('workspace', sampleWorkspaceId, 'editor');
    });

    test('returns error for invalid link', async () => {
      const result = await handleShareLink('invalid-link', mockOptions);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    // TODO: This test requires mocking getStoredKeyChain from keyDerivation
    // to return null, otherwise the cached key is used
    test.skip('requests password when not embedded', async () => {
      const link = generateShareLink({
        entityType: 'document',
        entityId: sampleDocumentId,
        permission: 'viewer',
        hasPassword: true,
        // No password embedded
      });

      const result = await handleShareLink(link, mockOptions);

      expect(result.success).toBe(false);
      expect(result.needsPassword).toBe(true);
    });
  });

  describe('handleShareLinkWithPassword', () => {
    test('handles link with manually provided password', async () => {
      const link = generateShareLink({
        entityType: 'document',
        entityId: sampleDocumentId,
        permission: 'editor',
        hasPassword: true,
        // No password in link
      });

      const result = await handleShareLinkWithPassword(
        link,
        'user-provided-password',
        mockOptions
      );

      expect(result.success).toBe(true);
      expect(result.entityId).toBe(sampleDocumentId);
    });

    test('returns error for invalid link', async () => {
      const result = await handleShareLinkWithPassword(
        'invalid',
        'password',
        mockOptions
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('copyShareLink', () => {
    // Note: These tests require mocking clipboard API
    
    test('calls onSuccess callback when copy succeeds', async () => {
      // Mock clipboard API - must be set up before calling copyShareLink
      const mockWriteText = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(global, 'navigator', {
        value: {
          clipboard: {
            writeText: mockWriteText,
          },
        },
        writable: true,
        configurable: true,
      });

      const onSuccess = jest.fn();
      const onError = jest.fn();

      await copyShareLink('Nightjar://test', { onSuccess, onError });

      expect(mockWriteText).toHaveBeenCalledWith('Nightjar://test');
      expect(onSuccess).toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });
  });
});
