/**
 * FileStorageDashboard
 * 
 * Shell component for the file storage feature.
 * Wraps children in FileStorageProvider, renders nav rail + content router.
 * Integrates all hooks (upload, download, transfer) and renders real views.
 * 
 * See docs/FILE_STORAGE_SPEC.md §5
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { FileStorageProvider, useFileStorage } from '../../contexts/FileStorageContext';
import FileStorageNavRail, { FILE_VIEWS } from './FileStorageNavRail';
import useFileUpload from '../../hooks/useFileUpload';
import useFileDownload from '../../hooks/useFileDownload';
import useFileTransfer from '../../hooks/useFileTransfer';
import { useFileTransferContext } from '../../contexts/FileTransferContext';
import { getStoredKeyChain } from '../../utils/keyDerivation';
import { getExtension, getFileTypeCategory } from '../../utils/fileTypeCategories';
import { generateFileId, generateFolderId, fileExistsInFolder } from '../../utils/fileStorageValidation';
import BrowseView from './BrowseView';
import RecentView from './RecentView';
import FavoritesView from './FavoritesView';
import TrashView from './TrashView';
import AuditLogView from './AuditLogView';
import StorageView from './StorageView';
import FileStorageSettings from './FileStorageSettings';
import DownloadsView from './DownloadsView';
import DownloadsBar from './DownloadsBar';
import MeshView from './MeshView';
import { DEFAULT_CHUNK_REDUNDANCY_TARGET } from '../../utils/fileStorageValidation';
import './FileStorageDashboard.css';

/**
 * View IDs for the content area.
 */
export const VIEWS = {
  BROWSE: FILE_VIEWS.BROWSE,
  RECENT: FILE_VIEWS.RECENT,
  DOWNLOADS: FILE_VIEWS.DOWNLOADS,
  FAVORITES: FILE_VIEWS.FAVORITES,
  TRASH: FILE_VIEWS.TRASH,
  AUDIT_LOG: FILE_VIEWS.AUDIT_LOG,
  STORAGE: FILE_VIEWS.STORAGE,
  MESH: FILE_VIEWS.MESH,
  SETTINGS: FILE_VIEWS.SETTINGS,
};

/** Download history persistence key */
const DOWNLOAD_HISTORY_KEY = 'nightjar-download-history';

function loadDownloadHistory(workspaceId) {
  try {
    const raw = localStorage.getItem(`${DOWNLOAD_HISTORY_KEY}-${workspaceId}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveDownloadHistory(workspaceId, history) {
  try {
    // Keep last 200 entries
    const trimmed = (history || []).slice(0, 200);
    localStorage.setItem(`${DOWNLOAD_HISTORY_KEY}-${workspaceId}`, JSON.stringify(trimmed));
  } catch { /* ignore quota errors */ }
}

/** Inner content component – consumes FileStorageContext */
function FileStorageContent({ onClose, workspaceProvider, onStartChatWith }) {
  const [activeView, setActiveView] = useState(VIEWS.BROWSE);
  const ctx = useFileStorage();
  const [downloadHistory, setDownloadHistory] = useState([]);

  const {
    workspaceId,
    fileStorageId,
    activeFiles,
    trashedFiles,
    activeFolders,
    trashedFolders,
    totalFileCount,
    totalFolderCount,
    totalSizeBytes,
    sizeByCategory,
    chunkAvailability,
    auditLog,
    currentSystem,
    userIdentity,
    collaborators,
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
  } = ctx;

  const userPublicKey = userIdentity?.publicKeyBase62 || userIdentity?.publicKey;

  // Get workspace key for encryption
  const workspaceKey = useMemo(() => {
    if (!workspaceId) return null;
    const keyChain = getStoredKeyChain(workspaceId);
    return keyChain?.workspaceKey || null;
  }, [workspaceId]);

  // Load download history from localStorage
  useEffect(() => {
    if (workspaceId) {
      setDownloadHistory(loadDownloadHistory(workspaceId));
    }
  }, [workspaceId]);

  // Initialize hooks
  const {
    uploadFile,
    uploadFiles,
    uploads,
    clearUpload,
    clearCompleted: clearCompletedUploads,
  } = useFileUpload({
    workspaceId,
    workspaceKey,
    userPublicKey,
    createFileRecord,
    setChunkAvailability,
    addAuditEntry,
  });

  const {
    handleChunkRequest,
    requestChunkFromPeer,
    announceAvailability,
    getLocalChunkCount,
    transferStats,
  } = useFileTransfer({
    workspaceId,
    userPublicKey,
    workspaceProvider,
    setChunkAvailability,
  });

  const {
    downloadFile,
    checkLocalAvailability,
    downloads,
    clearDownload,
  } = useFileDownload({
    workspaceId,
    workspaceKey,
    requestChunkFromPeer,
    addAuditEntry,
    announceAvailability,
    chunkAvailability,
  });

  // Get connected peers for mesh view
  const [connectedPeers, setConnectedPeers] = useState([]);
  useEffect(() => {
    const updatePeers = () => {
      try {
        const { getPeerManager } = require('../../services/p2p/index.js');
        const pm = getPeerManager();
        setConnectedPeers(pm?.getConnectedPeers?.() || []);
      } catch {
        setConnectedPeers([]);
      }
    };
    updatePeers();
    const timer = setInterval(updatePeers, 10000);
    return () => clearInterval(timer);
  }, []);

  // Track completed downloads for history
  const prevDownloadsRef = useRef([]);
  useEffect(() => {
    if (!workspaceId) return;
    const prev = prevDownloadsRef.current;
    const completed = downloads.filter(d =>
      (d.status === 'complete' || d.status === 'error') &&
      !prev.some(p => p.downloadId === d.downloadId && (p.status === 'complete' || p.status === 'error'))
    );
    if (completed.length > 0) {
      setDownloadHistory(h => {
        const updated = [
          ...completed.map(d => ({
            ...d,
            completedAt: Date.now(),
            isActive: false,
          })),
          ...h,
        ];
        saveDownloadHistory(workspaceId, updated);
        return updated;
      });
    }
    prevDownloadsRef.current = downloads;
  }, [downloads, workspaceId]);

  // Badge counts
  const trashedCount = (trashedFiles?.length || 0) + (trashedFolders?.length || 0);
  const downloadingCount = downloads.filter(d => d.status !== 'complete' && d.status !== 'error').length;
  const favoriteCount = useMemo(() => {
    if (!userPublicKey || !activeFiles) return 0;
    return activeFiles.filter(f => f.favoritedBy?.includes(userPublicKey)).length;
  }, [activeFiles, userPublicKey]);

  // Favorite IDs set for fast lookup
  const favoriteIds = useMemo(() => {
    if (!userPublicKey || !activeFiles) return new Set();
    return new Set(activeFiles.filter(f => f.favoritedBy?.includes(userPublicKey)).map(f => f.id));
  }, [activeFiles, userPublicKey]);

  // Role
  const role = useMemo(() => {
    if (!currentSystem || !userIdentity) return 'collaborator';
    if (currentSystem.createdBy === userPublicKey) return 'admin';
    return 'collaborator';
  }, [currentSystem, userIdentity, userPublicKey]);

  // Settings from currentSystem
  const settings = useMemo(() => currentSystem?.settings || {}, [currentSystem]);

  // Chunk seeding & transfer stats from workspace-level context
  const redundancyTarget = settings.chunkRedundancyTarget ?? DEFAULT_CHUNK_REDUNDANCY_TARGET;

  const {
    seedingStats,
    bandwidthHistory,
    triggerSeedCycle,
    resetStats,
  } = useFileTransferContext();

  // Upload files with collision handling
  const handleUploadFiles = useCallback(async (files, folderId, options = {}) => {
    for (const file of files) {
      let name = file.name;
      if (options.keepBoth && fileExistsInFolder(name, folderId, activeFiles)) {
        const ext = getExtension(name);
        const base = name.slice(0, name.length - (ext ? ext.length + 1 : 0));
        name = `${base} (copy)${ext ? '.' + ext : ''}`;
      }
      await uploadFile(file, folderId, {
        replace: options.replace || false,
        fileName: options.keepBoth ? name : undefined,
      });
    }
  }, [uploadFile, activeFiles]);

  // Download file
  const handleDownloadFile = useCallback(async (fileRecord) => {
    try {
      setActiveView(VIEWS.DOWNLOADS);
      await downloadFile(fileRecord);
    } catch (err) {
      console.error('[FileStorage] Download error:', err);
    }
  }, [downloadFile]);

  // Update file metadata
  const handleUpdateFile = useCallback((fileId, updates) => {
    updateFile(fileId, updates);
    if (updates.name) {
      addAuditEntry('rename', 'file', fileId, updates.name, 'Renamed file');
    }
    if (updates.tags) {
      addAuditEntry('tag', 'file', fileId, null, 'Tags updated');
    }
  }, [updateFile, addAuditEntry]);

  // Delete file (soft)
  const handleDeleteFile = useCallback((fileId) => {
    const file = activeFiles.find(f => f.id === fileId);
    deleteFile(fileId);
    addAuditEntry('delete', 'file', fileId, file?.name || fileId, 'Deleted file');
  }, [deleteFile, addAuditEntry, activeFiles]);

  // Toggle favorite
  const handleToggleFavorite = useCallback((fileId) => {
    toggleFavorite(fileId, userPublicKey);
  }, [toggleFavorite, userPublicKey]);

  // Create folder
  const handleCreateFolder = useCallback(({ name, parentId, color, icon }) => {
    createFolderRecord({ name, parentId, color, icon });
    addAuditEntry('create_folder', 'folder', null, name, 'Created folder');
  }, [createFolderRecord, addAuditEntry]);

  // Update folder
  const handleUpdateFolder = useCallback((folderId, updates) => {
    updateFolder(folderId, updates);
    if (updates.name) {
      addAuditEntry('rename', 'folder', folderId, updates.name, 'Renamed folder');
    }
  }, [updateFolder, addAuditEntry]);

  // Delete folder
  const handleDeleteFolder = useCallback((folderId) => {
    const folder = activeFolders.find(f => f.id === folderId);
    deleteFolder(folderId);
    addAuditEntry('delete', 'folder', folderId, folder?.name || folderId, 'Deleted folder');
  }, [deleteFolder, addAuditEntry, activeFolders]);

  // Move file
  const handleMoveFile = useCallback((fileId, destFolderId) => {
    const file = activeFiles.find(f => f.id === fileId);
    updateFile(fileId, { folderId: destFolderId || null });
    addAuditEntry('move', 'file', fileId, file?.name || fileId, `Moved to ${destFolderId || 'Root'}`);
  }, [updateFile, addAuditEntry, activeFiles]);

  // Move folder
  const handleMoveFolder = useCallback((folderId, destParentId) => {
    const folder = activeFolders.find(f => f.id === folderId);
    updateFolder(folderId, { parentId: destParentId || null });
    addAuditEntry('move', 'folder', folderId, folder?.name || folderId, `Moved to ${destParentId || 'Root'}`);
  }, [updateFolder, addAuditEntry, activeFolders]);

  // Restore file/folder
  const handleRestoreFile = useCallback((fileId) => {
    restoreFile(fileId);
    addAuditEntry('restore', 'file', fileId, null, 'Restored file');
  }, [restoreFile, addAuditEntry]);

  const handleRestoreFolder = useCallback((folderId) => {
    restoreFolder(folderId);
    addAuditEntry('restore', 'folder', folderId, null, 'Restored folder');
  }, [restoreFolder, addAuditEntry]);

  // Permanent delete
  const handlePermanentlyDeleteFile = useCallback((fileId) => {
    permanentlyDeleteFile(fileId);
    addAuditEntry('permanent_delete', 'file', fileId, null, 'Permanently deleted file');
  }, [permanentlyDeleteFile, addAuditEntry]);

  const handlePermanentlyDeleteFolder = useCallback((folderId) => {
    // For folders, remove from yStorageFolders (no chunks to clean)
    permanentlyDeleteFolder(folderId);
    addAuditEntry('permanent_delete', 'folder', folderId, null, 'Permanently deleted folder');
  }, [permanentlyDeleteFolder, addAuditEntry]);

  // Empty trash
  const handleEmptyTrash = useCallback(() => {
    (trashedFiles || []).forEach(f => permanentlyDeleteFile(f.id));
    (trashedFolders || []).forEach(f => permanentlyDeleteFolder(f.id));
    addAuditEntry('permanent_delete', null, null, null, 'Emptied trash');
  }, [trashedFiles, trashedFolders, permanentlyDeleteFile, permanentlyDeleteFolder, addAuditEntry]);

  // Delete all files (danger zone)
  const handleDeleteAllFiles = useCallback(() => {
    (activeFiles || []).forEach(f => permanentlyDeleteFile(f.id));
    (activeFolders || []).forEach(f => permanentlyDeleteFolder(f.id));
    (trashedFiles || []).forEach(f => permanentlyDeleteFile(f.id));
    (trashedFolders || []).forEach(f => permanentlyDeleteFolder(f.id));
    addAuditEntry('permanent_delete', null, null, null, 'Deleted all files and folders');
  }, [activeFiles, activeFolders, trashedFiles, trashedFolders, permanentlyDeleteFile, permanentlyDeleteFolder, addAuditEntry]);

  // Update settings
  const handleUpdateSettings = useCallback((newSettings) => {
    updateSettings(newSettings);
    addAuditEntry('settings', null, null, null, 'Updated settings');
  }, [updateSettings, addAuditEntry]);

  // Clear download history
  const handleClearHistory = useCallback(() => {
    setDownloadHistory([]);
    saveDownloadHistory(workspaceId, []);
  }, [workspaceId]);

  // Clear single download from history
  const handleClearDownloadFromHistory = useCallback((downloadId) => {
    clearDownload(downloadId);
    setDownloadHistory(h => {
      const updated = h.filter(d => d.downloadId !== downloadId);
      saveDownloadHistory(workspaceId, updated);
      return updated;
    });
  }, [clearDownload, workspaceId]);

  const handleViewChange = useCallback((viewId) => {
    setActiveView(viewId);
  }, []);

  const renderContent = () => {
    switch (activeView) {
      case VIEWS.BROWSE:
        return (
          <BrowseView
            activeFiles={activeFiles || []}
            activeFolders={activeFolders || []}
            chunkAvailability={chunkAvailability}
            userPublicKey={userPublicKey}
            userIdentity={userIdentity}
            role={role}
            uploads={uploads}
            onUploadFiles={handleUploadFiles}
            onClearUpload={clearUpload}
            onClearCompletedUploads={clearCompletedUploads}
            onDownloadFile={handleDownloadFile}
            onUpdateFile={handleUpdateFile}
            onDeleteFile={handleDeleteFile}
            onToggleFavorite={handleToggleFavorite}
            onCreateFolder={handleCreateFolder}
            onUpdateFolder={handleUpdateFolder}
            onDeleteFolder={handleDeleteFolder}
            onMoveFile={handleMoveFile}
            onMoveFolder={handleMoveFolder}
            collaborators={collaborators}
            favoriteIds={favoriteIds}
            onStartChatWith={onStartChatWith}
          />
        );

      case VIEWS.RECENT:
        return (
          <RecentView
            activeFiles={activeFiles || []}
            activeFolders={activeFolders || []}
            chunkAvailability={chunkAvailability}
            userPublicKey={userPublicKey}
            onSelectFile={(f) => { /* detail panel opened from BrowseView */ }}
            onDownloadFile={handleDownloadFile}
          />
        );

      case VIEWS.DOWNLOADS:
        return (
          <DownloadsView
            downloads={downloads}
            downloadHistory={downloadHistory}
            onClearDownload={handleClearDownloadFromHistory}
            onClearHistory={handleClearHistory}
            onRetryDownload={(item) => {
              const file = activeFiles?.find(f => f.id === item.fileId);
              if (file) handleDownloadFile(file);
            }}
          />
        );

      case VIEWS.FAVORITES:
        return (
          <FavoritesView
            activeFiles={activeFiles || []}
            userIdentity={userIdentity}
            onSelectFile={(f) => { /* could navigate to browse */ }}
            onToggleFavorite={handleToggleFavorite}
          />
        );

      case VIEWS.TRASH:
        return (
          <TrashView
            trashedFiles={trashedFiles || []}
            trashedFolders={trashedFolders || []}
            role={role}
            userIdentity={userIdentity}
            settings={settings}
            onRestoreFile={handleRestoreFile}
            onPermanentlyDeleteFile={handlePermanentlyDeleteFile}
            onRestoreFolder={handleRestoreFolder}
            onPermanentlyDeleteFolder={handlePermanentlyDeleteFolder}
            onEmptyTrash={handleEmptyTrash}
          />
        );

      case VIEWS.AUDIT_LOG:
        return (
          <AuditLogView
            auditLog={auditLog || []}
            collaborators={collaborators || []}
            onStartChatWith={onStartChatWith}
            currentUserKey={userPublicKey}
          />
        );

      case VIEWS.STORAGE:
        return (
          <StorageView
            activeFiles={activeFiles || []}
            activeFolders={activeFolders || []}
            trashedFiles={trashedFiles || []}
            totalSizeBytes={totalSizeBytes}
            sizeByCategory={sizeByCategory}
            chunkAvailability={chunkAvailability}
            collaborators={collaborators}
            userPublicKey={userPublicKey}
            onStartChatWith={onStartChatWith}
          />
        );

      case VIEWS.SETTINGS:
        return (
          <FileStorageSettings
            currentSystem={currentSystem}
            settings={settings}
            role={role}
            onUpdateSettings={handleUpdateSettings}
            onEmptyTrash={handleEmptyTrash}
            onDeleteAllFiles={handleDeleteAllFiles}
            trashedCount={trashedCount}
          />
        );

      case VIEWS.MESH:
        return (
          <MeshView
            activeFiles={activeFiles || []}
            chunkAvailability={chunkAvailability}
            seedingStats={seedingStats}
            bandwidthHistory={bandwidthHistory}
            transferStats={transferStats}
            redundancyTarget={redundancyTarget}
            userPublicKey={userPublicKey}
            connectedPeers={connectedPeers}
            onResetStats={resetStats}
          />
        );

      default:
        return null;
    }
  };

  return (
    <div className="file-storage-dashboard" data-testid="fs-dashboard">
      <FileStorageNavRail
        activeView={activeView}
        onViewChange={handleViewChange}
        role={role}
        trashedCount={trashedCount}
        downloadingCount={downloadingCount}
        favoriteCount={favoriteCount}
      />
      <div className="fs-content-area">
        {renderContent()}
        <DownloadsBar
          downloads={downloads}
          onClearDownload={clearDownload}
          onClearAll={() => downloads.filter(d => d.status === 'complete' || d.status === 'error').forEach(d => clearDownload(d.downloadId))}
        />
      </div>
    </div>
  );
}

/**
 * Main FileStorageDashboard – wraps content in Provider.
 * Called from AppNew.jsx when a file-storage type document is active.
 */
export default function FileStorageDashboard({
  fileStorageId,
  workspaceId,
  yFileStorageSystems,
  yStorageFiles,
  yStorageFolders,
  yChunkAvailability,
  yFileAuditLog,
  userIdentity,
  collaborators,
  workspaceProvider,
  onClose,
  onStartChatWith,
}) {
  return (
    <FileStorageProvider
      fileStorageId={fileStorageId}
      workspaceId={workspaceId}
      yFileStorageSystems={yFileStorageSystems}
      yStorageFiles={yStorageFiles}
      yStorageFolders={yStorageFolders}
      yChunkAvailability={yChunkAvailability}
      yFileAuditLog={yFileAuditLog}
      userIdentity={userIdentity}
      collaborators={collaborators}
    >
      <FileStorageContent onClose={onClose} workspaceProvider={workspaceProvider} onStartChatWith={onStartChatWith} />
    </FileStorageProvider>
  );
}
