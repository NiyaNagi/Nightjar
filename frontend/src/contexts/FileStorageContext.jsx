/**
 * FileStorageContext
 * 
 * Provides file-storage-specific Yjs data to all file storage components
 * without prop-drilling. Follows the InventoryContext pattern.
 * 
 * Usage: FileStorageDashboard wraps its children in <FileStorageProvider>,
 * and all child components call useFileStorage() to access data.
 * 
 * See docs/FILE_STORAGE_SPEC.md §15.2
 */

import { createContext, useContext, useMemo, useCallback, useRef } from 'react';
import { useFileStorageSync } from '../hooks/useFileStorageSync';
import {
  generateFileId,
  generateFolderId,
  generateAuditId,
} from '../utils/fileStorageValidation';
import {
  getFileTypeCategory,
  getExtension,
  getMimeType,
} from '../utils/fileTypeCategories';

const FileStorageContext = createContext(null);

/**
 * Hook to access file storage state from any file storage component.
 * Must be used within a FileStorageProvider.
 */
export function useFileStorage() {
  const context = useContext(FileStorageContext);
  if (!context) {
    throw new Error('useFileStorage must be used within a FileStorageProvider');
  }
  return context;
}

/**
 * Provider wraps FileStorageDashboard. Receives workspace-level Yjs
 * shared types and exposes them plus derived state and mutation functions.
 */
export function FileStorageProvider({
  children,
  fileStorageId,
  workspaceId,
  yFileStorageSystems,
  yStorageFiles,
  yStorageFolders,
  yChunkAvailability,
  yFileAuditLog,
  userIdentity,
  collaborators,
}) {
  // Call useFileStorageSync once here so children don't need to
  const sync = useFileStorageSync(
    {
      yFileStorageSystems,
      yStorageFiles,
      yStorageFolders,
      yChunkAvailability,
      yFileAuditLog,
    },
    fileStorageId
  );

  // --- Mutation helpers ---

  /** Add a file record to Yjs */
  const addFile = useCallback((fileRecord) => {
    if (!yStorageFiles) return;
    yStorageFiles.push([fileRecord]);
  }, [yStorageFiles]);

  /** Update a file record in Yjs (find by ID, delete, re-insert) */
  const updateFile = useCallback((fileId, updates) => {
    if (!yStorageFiles) return;
    const doc = yStorageFiles.doc;
    const doUpdate = () => {
      const arr = yStorageFiles.toArray();
      const index = arr.findIndex(f => f.id === fileId);
      if (index === -1) return;
      const updated = { ...arr[index], ...updates, updatedAt: Date.now() };
      yStorageFiles.delete(index, 1);
      yStorageFiles.insert(index, [updated]);
    };
    if (doc) doc.transact(doUpdate);
    else doUpdate();
  }, [yStorageFiles]);

  /** Soft-delete a file (set deletedAt) */
  const deleteFile = useCallback((fileId) => {
    updateFile(fileId, { deletedAt: Date.now() });
  }, [updateFile]);

  /** Restore a soft-deleted file */
  const restoreFile = useCallback((fileId) => {
    updateFile(fileId, { deletedAt: null });
  }, [updateFile]);

  /** Permanently remove a file from Yjs */
  const permanentlyDeleteFile = useCallback((fileId) => {
    if (!yStorageFiles) return;
    const arr = yStorageFiles.toArray();
    const index = arr.findIndex(f => f.id === fileId);
    if (index !== -1) {
      yStorageFiles.delete(index, 1);
    }
    // Also remove chunk availability entries
    if (yChunkAvailability) {
      const keysToDelete = [];
      yChunkAvailability.forEach((_, key) => {
        if (key.startsWith(fileId + ':')) keysToDelete.push(key);
      });
      keysToDelete.forEach(k => yChunkAvailability.delete(k));
    }
  }, [yStorageFiles, yChunkAvailability]);

  /** Add a folder */
  const addFolder = useCallback((folderRecord) => {
    if (!yStorageFolders) return;
    yStorageFolders.push([folderRecord]);
  }, [yStorageFolders]);

  /** Update a folder */
  const updateFolder = useCallback((folderId, updates) => {
    if (!yStorageFolders) return;
    const doc = yStorageFolders.doc;
    const doUpdate = () => {
      const arr = yStorageFolders.toArray();
      const index = arr.findIndex(f => f.id === folderId);
      if (index === -1) return;
      const updated = { ...arr[index], ...updates, updatedAt: Date.now() };
      yStorageFolders.delete(index, 1);
      yStorageFolders.insert(index, [updated]);
    };
    if (doc) doc.transact(doUpdate);
    else doUpdate();
  }, [yStorageFolders]);

  /** Soft-delete a folder and its contents recursively */
  const deleteFolderRef = useRef(null);
  const deleteFolder = useCallback((folderId) => {
    const now = Date.now();
    updateFolder(folderId, { deletedAt: now });
    // Recursively delete subfolders
    const allFolders = yStorageFolders ? yStorageFolders.toArray() : [];
    const childFolderIds = allFolders
      .filter(f => f.parentId === folderId && !f.deletedAt)
      .map(f => f.id);
    for (const childId of childFolderIds) {
      deleteFolderRef.current(childId);
    }
    // Delete files in this folder — iterate in reverse to avoid index shift
    if (yStorageFiles) {
      const arr = yStorageFiles.toArray();
      for (let idx = arr.length - 1; idx >= 0; idx--) {
        const f = arr[idx];
        if (f.folderId === folderId && !f.deletedAt) {
          const updated = { ...f, deletedAt: now };
          yStorageFiles.delete(idx, 1);
          yStorageFiles.insert(idx, [updated]);
        }
      }
    }
  }, [updateFolder, yStorageFolders, yStorageFiles]);
  deleteFolderRef.current = deleteFolder;

  /** Restore a folder and its contents recursively (spec §5.5) */
  const restoreFolderRef = useRef(null);
  const restoreFolder = useCallback((folderId) => {
    updateFolder(folderId, { deletedAt: null });
    // Recursively restore child subfolders
    const allFolders = yStorageFolders ? yStorageFolders.toArray() : [];
    const childFolderIds = allFolders
      .filter(f => f.parentId === folderId && f.deletedAt)
      .map(f => f.id);
    for (const childId of childFolderIds) {
      restoreFolderRef.current(childId);
    }
    // Restore files in this folder — iterate in reverse to avoid index shift
    if (yStorageFiles) {
      const arr = yStorageFiles.toArray();
      for (let idx = arr.length - 1; idx >= 0; idx--) {
        const f = arr[idx];
        if (f.folderId === folderId && f.deletedAt) {
          const updated = { ...f, deletedAt: null };
          yStorageFiles.delete(idx, 1);
          yStorageFiles.insert(idx, [updated]);
        }
      }
    }
  }, [updateFolder, yStorageFolders, yStorageFiles]);
  restoreFolderRef.current = restoreFolder;

  /** Permanently remove a folder from Yjs */
  const permanentlyDeleteFolder = useCallback((folderId) => {
    if (!yStorageFolders) return;
    const arr = yStorageFolders.toArray();
    const index = arr.findIndex(f => f.id === folderId);
    if (index !== -1) {
      yStorageFolders.delete(index, 1);
    }
  }, [yStorageFolders]);

  /** Toggle favorite for a file */
  const toggleFavorite = useCallback((fileId, userPublicKey) => {
    if (!yStorageFiles) return;
    const doc = yStorageFiles.doc;
    const doToggle = () => {
      const arr = yStorageFiles.toArray();
      const index = arr.findIndex(f => f.id === fileId);
      if (index === -1) return;
      const file = arr[index];
      const favs = file.favoritedBy || [];
      const isFav = favs.includes(userPublicKey);
      const newFavs = isFav ? favs.filter(k => k !== userPublicKey) : [...favs, userPublicKey];
      const updated = { ...file, favoritedBy: newFavs };
      yStorageFiles.delete(index, 1);
      yStorageFiles.insert(index, [updated]);
    };
    if (doc) doc.transact(doToggle);
    else doToggle();
  }, [yStorageFiles]);

  /** Update chunk availability */
  const setChunkAvailability = useCallback((fileId, chunkIndex, holders) => {
    if (!yChunkAvailability) return;
    const key = `${fileId}:${chunkIndex}`;
    yChunkAvailability.set(key, {
      fileId,
      chunkIndex,
      holders,
      lastUpdated: Date.now(),
    });
  }, [yChunkAvailability]);

  /** Add audit log entry */
  const addAuditEntry = useCallback((action, targetType, targetId, targetName, summary, metadata = {}) => {
    if (!yFileAuditLog) return;
    yFileAuditLog.push([{
      id: generateAuditId(),
      fileStorageId,
      timestamp: Date.now(),
      actorId: userIdentity?.publicKeyBase62 || 'unknown',
      actorName: userIdentity?.displayName || userIdentity?.name || 'Unknown',
      action,
      targetType,
      targetId,
      targetName,
      summary,
      metadata,
    }]);
  }, [yFileAuditLog, fileStorageId, userIdentity]);

  /** Update file storage system settings */
  const updateSettings = useCallback((updates) => {
    if (!yFileStorageSystems || !fileStorageId) return;
    const existing = yFileStorageSystems.get(fileStorageId);
    if (!existing) return;
    yFileStorageSystems.set(fileStorageId, {
      ...existing,
      settings: { ...existing.settings, ...updates },
    });
  }, [yFileStorageSystems, fileStorageId]);

  /** Create a file record from an uploaded file */
  const createFileRecord = useCallback(({
    id: preGeneratedId,
    name,
    sizeBytes,
    chunkCount,
    chunkHashes,
    fileHash,
    folderId = null,
  }) => {
    const ext = getExtension(name);
    const record = {
      id: preGeneratedId || generateFileId(),
      fileStorageId,
      folderId,
      name,
      extension: ext,
      mimeType: getMimeType(ext),
      sizeBytes,
      chunkCount,
      chunkHashes,
      fileHash,
      description: '',
      tags: [],
      typeCategory: getFileTypeCategory(ext),
      uploadedBy: userIdentity?.publicKeyBase62 || 'unknown',
      uploadedByName: userIdentity?.displayName || userIdentity?.name || 'Unknown',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
      favoritedBy: [],
      version: 1,
      replacedAt: null,
      replacedBy: null,
    };
    addFile(record);
    addAuditEntry(
      'file_uploaded',
      'file',
      record.id,
      record.name,
      `Uploaded ${record.name} (${(sizeBytes / 1024 / 1024).toFixed(1)} MB)`,
      { sizeBytes, chunkCount }
    );
    return record;
  }, [fileStorageId, userIdentity, addFile, addAuditEntry]);

  /** Create a folder record */
  const createFolderRecord = useCallback(({
    name,
    parentId = null,
    color = null,
    icon = null,
  }) => {
    const record = {
      id: generateFolderId(),
      fileStorageId,
      parentId,
      name,
      color,
      icon,
      createdAt: Date.now(),
      createdBy: userIdentity?.publicKeyBase62 || 'unknown',
      updatedAt: Date.now(),
      deletedAt: null,
    };
    addFolder(record);
    addAuditEntry(
      'folder_created',
      'folder',
      record.id,
      record.name,
      `Created folder "${record.name}"`,
    );
    return record;
  }, [fileStorageId, userIdentity, addFolder, addAuditEntry]);

  const value = useMemo(() => ({
    // IDs
    fileStorageId,
    workspaceId,
    // Raw Yjs refs (for direct mutations in advanced scenarios)
    yFileStorageSystems,
    yStorageFiles,
    yStorageFolders,
    yChunkAvailability,
    yFileAuditLog,
    // Identity & collaborators
    userIdentity,
    collaborators,
    // Derived reactive state from useFileStorageSync
    ...sync,
    // Mutation functions
    addFile,
    updateFile,
    deleteFile,
    restoreFile,
    permanentlyDeleteFile,
    permanentlyDeleteFolder,
    addFolder,
    updateFolder,
    deleteFolder,
    restoreFolder,
    toggleFavorite,
    setChunkAvailability,
    addAuditEntry,
    updateSettings,
    createFileRecord,
    createFolderRecord,
  }), [
    fileStorageId, workspaceId,
    yFileStorageSystems, yStorageFiles, yStorageFolders,
    yChunkAvailability, yFileAuditLog,
    userIdentity, collaborators, sync,
    addFile, updateFile, deleteFile, restoreFile, permanentlyDeleteFile, permanentlyDeleteFolder,
    addFolder, updateFolder, deleteFolder, restoreFolder,
    toggleFavorite, setChunkAvailability, addAuditEntry, updateSettings,
    createFileRecord, createFolderRecord,
  ]);

  return (
    <FileStorageContext.Provider value={value}>
      {children}
    </FileStorageContext.Provider>
  );
}

export default FileStorageContext;
