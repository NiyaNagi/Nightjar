/**
 * Test Suite: Migration
 * Tests for data migration from old format to new workspace-based format
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
  needsMigration,
  getSchemaVersion,
  detectLegacyData,
  runMigration,
  rollbackMigration,
  getMigrationRecord,
  getMigrationStatus,
} from '../frontend/src/utils/migration';

describe('Migration', () => {
  // Mock localStorage
  let localStorageMock;
  
  beforeEach(() => {
    localStorageMock = {};
    global.localStorage = {
      getItem: (key) => localStorageMock[key] || null,
      setItem: (key, value) => { localStorageMock[key] = value; },
      removeItem: (key) => { delete localStorageMock[key]; },
      clear: () => { localStorageMock = {}; },
    };
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('needsMigration', () => {
    test('returns true when no version set', () => {
      expect(needsMigration()).toBe(true);
    });

    test('returns true when version is old', () => {
      localStorage.setItem('nahma-migration-version', '1');
      expect(needsMigration()).toBe(true);
    });

    test('returns false when version is current', () => {
      localStorage.setItem('nahma-migration-version', '2');
      expect(needsMigration()).toBe(false);
    });
  });

  describe('getSchemaVersion', () => {
    test('returns 0 when no version set', () => {
      expect(getSchemaVersion()).toBe(0);
    });

    test('returns stored version', () => {
      localStorage.setItem('nahma-migration-version', '1');
      expect(getSchemaVersion()).toBe(1);
    });
  });

  describe('detectLegacyData', () => {
    test('detects no legacy data when empty', () => {
      const result = detectLegacyData();
      
      expect(result.hasLegacyData).toBe(false);
      expect(result.legacyDocCount).toBe(0);
      expect(result.legacyFolderCount).toBe(0);
      expect(result.needsMigration).toBe(false);
    });

    test('detects legacy documents without workspaceId', () => {
      localStorage.setItem('nahma-documents', JSON.stringify([
        { id: 'doc1', name: 'Doc 1' },
        { id: 'doc2', name: 'Doc 2' },
      ]));

      const result = detectLegacyData();
      
      expect(result.hasLegacyData).toBe(true);
      expect(result.legacyDocCount).toBe(2);
      expect(result.needsMigration).toBe(true);
    });

    test('detects legacy folders without workspaceId', () => {
      localStorage.setItem('nahma-folders', JSON.stringify([
        { id: 'folder1', name: 'Folder 1' },
      ]));

      const result = detectLegacyData();
      
      expect(result.hasLegacyData).toBe(true);
      expect(result.legacyFolderCount).toBe(1);
      expect(result.needsMigration).toBe(true);
    });

    test('ignores already-migrated items', () => {
      localStorage.setItem('nahma-documents', JSON.stringify([
        { id: 'doc1', name: 'Doc 1', workspaceId: 'ws-123' },
        { id: 'doc2', name: 'Doc 2' }, // Only this needs migration
      ]));

      const result = detectLegacyData();
      
      expect(result.legacyDocCount).toBe(1);
    });
  });

  describe('runMigration', () => {
    const mockSendToSidecar = jest.fn();
    const mockIdentity = { publicKeyHex: 'test-user-key' };

    beforeEach(() => {
      mockSendToSidecar.mockClear();
    });

    test('succeeds with no legacy data', async () => {
      localStorage.setItem('nahma-migration-version', '2');
      
      const result = await runMigration({
        identity: mockIdentity,
        sendToSidecar: mockSendToSidecar,
      });

      expect(result.success).toBe(true);
    });

    test('creates default workspace for legacy data', async () => {
      localStorage.setItem('nahma-documents', JSON.stringify([
        { id: 'doc1', name: 'Doc 1' },
      ]));

      let createdWorkspace = null;
      const result = await runMigration({
        identity: mockIdentity,
        sendToSidecar: mockSendToSidecar,
        onWorkspaceCreated: (ws) => { createdWorkspace = ws; },
      });

      expect(result.success).toBe(true);
      expect(result.workspaceId).toBeDefined();
      expect(createdWorkspace).toBeDefined();
      expect(createdWorkspace.name).toBe('My Documents');
    });

    test('migrates legacy documents', async () => {
      localStorage.setItem('nahma-documents', JSON.stringify([
        { id: 'doc1', name: 'Doc 1' },
        { id: 'doc2', name: 'Doc 2' },
      ]));

      const result = await runMigration({
        identity: mockIdentity,
        sendToSidecar: mockSendToSidecar,
      });

      expect(result.success).toBe(true);
      expect(result.migratedDocuments).toBe(2);
    });

    test('migrates legacy folders', async () => {
      localStorage.setItem('nahma-folders', JSON.stringify([
        { id: 'folder1', name: 'Folder 1' },
        { id: 'folder2', name: 'Folder 2' },
      ]));
      localStorage.setItem('nahma-documents', JSON.stringify([]));

      const result = await runMigration({
        identity: mockIdentity,
        sendToSidecar: mockSendToSidecar,
      });

      expect(result.success).toBe(true);
      expect(result.migratedFolders).toBe(2);
    });

    test('calls progress callback', async () => {
      localStorage.setItem('nahma-documents', JSON.stringify([
        { id: 'doc1', name: 'Doc 1' },
      ]));

      const progressCalls = [];
      await runMigration({
        identity: mockIdentity,
        sendToSidecar: mockSendToSidecar,
        onProgress: (step, total, message) => {
          progressCalls.push({ step, total, message });
        },
      });

      expect(progressCalls.length).toBeGreaterThan(0);
      expect(progressCalls[0].step).toBe(0);
    });

    test('updates schema version on success', async () => {
      const result = await runMigration({
        identity: mockIdentity,
        sendToSidecar: mockSendToSidecar,
      });

      expect(result.success).toBe(true);
      expect(localStorage.getItem('nahma-migration-version')).toBe('2');
    });

    test('sends workspace creation to sidecar', async () => {
      localStorage.setItem('nahma-documents', JSON.stringify([
        { id: 'doc1', name: 'Doc 1' },
      ]));

      await runMigration({
        identity: mockIdentity,
        sendToSidecar: mockSendToSidecar,
      });

      expect(mockSendToSidecar).toHaveBeenCalled();
      const createCall = mockSendToSidecar.mock.calls.find(
        call => call[0].type === 'create-workspace'
      );
      expect(createCall).toBeDefined();
    });
  });

  describe('rollbackMigration', () => {
    test('removes migration flags', () => {
      localStorage.setItem('nahma-migration-version', '2');
      localStorage.setItem('nahma-migration-record', JSON.stringify({ test: true }));

      const result = rollbackMigration();

      expect(result).toBe(true);
      expect(localStorage.getItem('nahma-migration-version')).toBeNull();
      expect(localStorage.getItem('nahma-migration-record')).toBeNull();
    });
  });

  describe('getMigrationRecord', () => {
    test('returns null when no record', () => {
      expect(getMigrationRecord()).toBeNull();
    });

    test('returns stored record', () => {
      const record = {
        completedAt: Date.now(),
        fromVersion: 1,
        toVersion: 2,
      };
      localStorage.setItem('nahma-migration-record', JSON.stringify(record));

      const result = getMigrationRecord();
      
      expect(result).toBeDefined();
      expect(result.fromVersion).toBe(1);
      expect(result.toVersion).toBe(2);
    });
  });

  describe('getMigrationStatus', () => {
    test('returns complete status object', () => {
      localStorage.setItem('nahma-migration-version', '1');
      localStorage.setItem('nahma-documents', JSON.stringify([
        { id: 'doc1', name: 'Doc 1' },
      ]));

      const status = getMigrationStatus();

      expect(status.currentVersion).toBe(1);
      expect(status.targetVersion).toBe(2);
      expect(status.needsMigration).toBe(true);
      expect(status.legacyDataDetected).toBeDefined();
    });

    test('shows no migration needed when current', () => {
      localStorage.setItem('nahma-migration-version', '2');

      const status = getMigrationStatus();

      expect(status.needsMigration).toBe(false);
    });
  });
});
