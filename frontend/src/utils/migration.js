/**
 * Data Migration System
 * 
 * Migrates data from old format to new workspace-based format.
 * 
 * Reference: docs/WORKSPACE_PERMISSIONS_SPEC.md
 * 
 * Migration flow:
 * 1. Detect old data format
 * 2. Create default workspace for existing content
 * 3. Migrate folders and documents
 * 4. Re-derive keys for new hierarchy
 * 5. Mark user as owner of migrated content
 * 6. Clean up old format data
 */

import { generatePassword } from './passwordGenerator';
import { deriveWorkspaceKey, storeKeyChain, deriveFolderKey, deriveDocumentKey } from './keyDerivation';
import { createNewEntity } from './sharing';

// Migration versions
const CURRENT_SCHEMA_VERSION = 2;
const MIGRATION_KEY = 'Nightjar-migration-version';
const LEGACY_DOCS_KEY = 'Nightjar-documents';
const LEGACY_FOLDERS_KEY = 'Nightjar-folders';

/**
 * Check if migration is needed
 * @returns {boolean}
 */
export function needsMigration() {
  try {
    const version = parseInt(localStorage.getItem(MIGRATION_KEY) || '0', 10);
    return version < CURRENT_SCHEMA_VERSION;
  } catch {
    return false;
  }
}

/**
 * Get current schema version
 * @returns {number}
 */
export function getSchemaVersion() {
  try {
    return parseInt(localStorage.getItem(MIGRATION_KEY) || '0', 10);
  } catch {
    return 0;
  }
}

/**
 * Detect if there's legacy data to migrate
 * @returns {Object} Detection result
 */
export function detectLegacyData() {
  const hasLegacyDocs = localStorage.getItem(LEGACY_DOCS_KEY) !== null;
  const hasLegacyFolders = localStorage.getItem(LEGACY_FOLDERS_KEY) !== null;
  
  // Check for old document format (no workspaceId)
  let legacyDocCount = 0;
  let legacyFolderCount = 0;

  try {
    const docs = JSON.parse(localStorage.getItem(LEGACY_DOCS_KEY) || '[]');
    legacyDocCount = docs.filter(d => !d.workspaceId).length;
  } catch {}

  try {
    const folders = JSON.parse(localStorage.getItem(LEGACY_FOLDERS_KEY) || '[]');
    legacyFolderCount = folders.filter(f => !f.workspaceId).length;
  } catch {}

  return {
    hasLegacyData: hasLegacyDocs || hasLegacyFolders,
    legacyDocCount,
    legacyFolderCount,
    needsMigration: legacyDocCount > 0 || legacyFolderCount > 0,
  };
}

/**
 * Run migration from v0/v1 to v2 (workspace-based)
 * 
 * @param {Object} options - Migration options
 * @param {Function} options.onProgress - Progress callback (step, total, message)
 * @param {Function} options.onWorkspaceCreated - Called when default workspace is created
 * @param {Object} options.identity - Current user identity
 * @param {Function} options.sendToSidecar - Function to send messages to sidecar
 * @returns {Promise<Object>} Migration result
 */
export async function runMigration(options = {}) {
  const { 
    onProgress,
    onWorkspaceCreated,
    identity,
    sendToSidecar,
  } = options;

  const result = {
    success: false,
    workspaceId: null,
    migratedDocuments: 0,
    migratedFolders: 0,
    errors: [],
  };

  try {
    const currentVersion = getSchemaVersion();
    
    if (currentVersion >= CURRENT_SCHEMA_VERSION) {
      result.success = true;
      return result;
    }

    onProgress?.(0, 5, 'Checking for legacy data...');

    // 1. Detect legacy data
    const { legacyDocCount, legacyFolderCount, needsMigration } = detectLegacyData();
    
    if (!needsMigration) {
      localStorage.setItem(MIGRATION_KEY, CURRENT_SCHEMA_VERSION.toString());
      result.success = true;
      return result;
    }

    onProgress?.(1, 5, 'Creating default workspace...');

    // 2. Create default workspace for migrated content
    const workspaceName = 'My Documents';
    const password = generatePassword();
    const { entityId: workspaceId, shareLink } = createNewEntity('workspace', {
      password,
      permission: 'owner',
    });

    // Derive workspace key
    const workspaceKey = await deriveWorkspaceKey(password, workspaceId);
    
    // Store key chain
    storeKeyChain(workspaceId, {
      workspaceKey,
      workspaceId,
      password,
      folderKeys: {},
    });

    const defaultWorkspace = {
      id: workspaceId,
      name: workspaceName,
      icon: '📁',
      color: '#6366f1',
      createdAt: Date.now(),
      createdBy: identity?.publicKeyHex || 'local-user',
      owners: [identity?.publicKeyHex || 'local-user'],
      migratedFrom: 'v' + currentVersion,
      shareLink,
    };

    // Notify about workspace creation
    onWorkspaceCreated?.(defaultWorkspace);

    // Save workspace to sidecar
    if (sendToSidecar) {
      sendToSidecar({
        type: 'create-workspace',
        workspace: defaultWorkspace,
      });
    }

    result.workspaceId = workspaceId;

    onProgress?.(2, 5, 'Creating default folder...');

    // 3. Create default folder for root-level documents
    const defaultFolderId = 'folder-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
    const folderKey = await deriveFolderKey(workspaceKey, defaultFolderId);
    
    const defaultFolder = {
      id: defaultFolderId,
      name: 'Migrated Documents',
      icon: '📄',
      workspaceId,
      parentId: null,
      createdAt: Date.now(),
    };

    // Update key chain with folder key
    const keyChain = {
      workspaceKey,
      workspaceId,
      password,
      folderKeys: { [defaultFolderId]: folderKey },
    };
    storeKeyChain(workspaceId, keyChain);

    if (sendToSidecar) {
      sendToSidecar({
        type: 'create-folder',
        folder: defaultFolder,
        workspaceId,
      });
    }

    onProgress?.(3, 5, 'Migrating folders...');

    // 4. Migrate existing folders
    try {
      const legacyFolders = JSON.parse(localStorage.getItem(LEGACY_FOLDERS_KEY) || '[]');
      
      for (const folder of legacyFolders) {
        if (folder.workspaceId) continue; // Already migrated
        
        const migratedFolder = {
          ...folder,
          workspaceId,
          parentId: folder.parentId || null, // Keep folder hierarchy
        };

        // Derive folder key
        const parentKey = folder.parentId 
          ? keyChain.folderKeys[folder.parentId] || workspaceKey
          : workspaceKey;
        const newFolderKey = await deriveFolderKey(parentKey, folder.id);
        keyChain.folderKeys[folder.id] = newFolderKey;

        if (sendToSidecar) {
          sendToSidecar({
            type: 'update-folder',
            folder: migratedFolder,
            workspaceId,
          });
        }

        result.migratedFolders++;
      }

      // Update stored key chain
      storeKeyChain(workspaceId, keyChain);
    } catch (error) {
      result.errors.push(`Failed to migrate folders: ${error.message}`);
    }

    onProgress?.(4, 5, 'Migrating documents...');

    // 5. Migrate existing documents
    try {
      const legacyDocs = JSON.parse(localStorage.getItem(LEGACY_DOCS_KEY) || '[]');
      
      for (const doc of legacyDocs) {
        if (doc.workspaceId) continue; // Already migrated
        
        // Place in appropriate folder or default folder
        const targetFolderId = doc.folderId && keyChain.folderKeys[doc.folderId] 
          ? doc.folderId 
          : defaultFolderId;

        const migratedDoc = {
          ...doc,
          workspaceId,
          folderId: targetFolderId,
        };

        // Derive document key
        const folderKey = keyChain.folderKeys[targetFolderId] || workspaceKey;
        await deriveDocumentKey(folderKey, doc.id);

        if (sendToSidecar) {
          sendToSidecar({
            type: 'update-document',
            document: migratedDoc,
            workspaceId,
          });
        }

        result.migratedDocuments++;
      }
    } catch (error) {
      result.errors.push(`Failed to migrate documents: ${error.message}`);
    }

    onProgress?.(5, 5, 'Finishing migration...');

    // 6. Mark migration as complete
    localStorage.setItem(MIGRATION_KEY, CURRENT_SCHEMA_VERSION.toString());
    
    // Store migration record
    localStorage.setItem('Nightjar-migration-record', JSON.stringify({
      completedAt: Date.now(),
      fromVersion: currentVersion,
      toVersion: CURRENT_SCHEMA_VERSION,
      workspaceId,
      migratedDocs: result.migratedDocuments,
      migratedFolders: result.migratedFolders,
    }));

    result.success = true;
    return result;

  } catch (error) {
    result.errors.push(`Migration failed: ${error.message}`);
    console.error('[Migration] Failed:', error);
    return result;
  }
}

/**
 * Rollback migration (for recovery)
 * Note: This won't undo document/folder changes sent to sidecar
 * 
 * @returns {boolean} Success
 */
export function rollbackMigration() {
  try {
    localStorage.removeItem(MIGRATION_KEY);
    localStorage.removeItem('Nightjar-migration-record');
    console.log('[Migration] Rolled back migration flags');
    return true;
  } catch (error) {
    console.error('[Migration] Rollback failed:', error);
    return false;
  }
}

/**
 * Get migration record
 * @returns {Object|null}
 */
export function getMigrationRecord() {
  try {
    const record = localStorage.getItem('Nightjar-migration-record');
    return record ? JSON.parse(record) : null;
  } catch {
    return null;
  }
}

/**
 * Migration status UI component helper
 * Returns status info for display
 * 
 * @returns {Object} Status info
 */
export function getMigrationStatus() {
  const version = getSchemaVersion();
  const record = getMigrationRecord();
  const legacy = detectLegacyData();

  return {
    currentVersion: version,
    targetVersion: CURRENT_SCHEMA_VERSION,
    needsMigration: version < CURRENT_SCHEMA_VERSION && legacy.needsMigration,
    migrationRecord: record,
    legacyDataDetected: legacy,
  };
}
