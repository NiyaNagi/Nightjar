import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useWorkspaces } from './WorkspaceContext';
import { useWorkspaceSyncContext } from './WorkspaceSyncContext';
import { deriveFolderKey, storeKeyChain, getStoredKeyChain } from '../utils/keyDerivation';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { isElectron } from '../hooks/useEnvironment';
import { getYjsWebSocketUrl } from '../utils/websocket';

// Alias for backwards compatibility
const getWsUrl = getYjsWebSocketUrl;

/**
 * Folder structure (updated for workspace support):
 * {
 *   id: string,              // Unique folder ID
 *   name: string,            // Display name
 *   workspaceId: string,     // Parent workspace ID
 *   parentId: string | null, // Parent folder ID (null for root folder in workspace)
 *   color: string,           // Optional color
 *   icon: string,            // Optional emoji icon
 *   createdAt: number,       // Timestamp
 *   updatedAt: number,       // Timestamp
 *   deletedAt: number | null, // Soft delete timestamp (null if not deleted)
 * }
 * 
 * Document structure additions:
 * {
 *   ...existing,
 *   deletedAt: number | null, // Soft delete timestamp
 *   deletedBy: string | null, // Identity ID who deleted
 * }
 */

const FolderContext = createContext(null);

// Trash purge time: 30 days in milliseconds
const TRASH_PURGE_DAYS = 30;
const TRASH_PURGE_MS = TRASH_PURGE_DAYS * 24 * 60 * 60 * 1000;

// Generate unique folder ID
const generateFolderId = () => {
  return 'folder-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
};

// System folder IDs (these are per-workspace virtual folders)
const SYSTEM_FOLDER_IDS = ['all', 'recent', 'shared', 'trash'];

// Get default system folders for a workspace
const getSystemFolders = (workspaceId) => [
  { id: `${workspaceId}:all`, virtualId: 'all', name: 'All Documents', parentId: null, icon: '📄', isSystem: true, workspaceId },
  { id: `${workspaceId}:recent`, virtualId: 'recent', name: 'Recent', parentId: null, icon: '🕐', isSystem: true, workspaceId },
  { id: `${workspaceId}:shared`, virtualId: 'shared', name: 'Shared with Me', parentId: null, icon: '👥', isSystem: true, workspaceId },
  { id: `${workspaceId}:trash`, virtualId: 'trash', name: 'Trash', parentId: null, icon: '🗑️', isSystem: true, workspaceId },
];

export function FolderProvider({ children }) {
  const { currentWorkspaceId, currentWorkspace, workspaces, metaSocket, connected } = useWorkspaces();
  
  // Get synced folder data from WorkspaceSyncContext (single source of truth for P2P sync)
  const syncContext = useWorkspaceSyncContext();
  const {
    folders: syncedFolders,
    documentFolders: syncedDocumentFolders,
    trashedDocuments: syncedTrashedDocuments,
    addFolder: syncAddFolder,
    removeFolder: syncRemoveFolder,
    updateFolder: syncUpdateFolder,
    setDocumentFolder: syncSetDocumentFolder,
    trashDocument: syncTrashDocument,
    restoreDocument: syncRestoreDocument,
    permanentlyDeleteDocument: syncPermanentlyDeleteDocument,
  } = syncContext;
  
  // Compute isElectron once to avoid function-as-boolean bug
  const isElectronMode = isElectron();
  
  const [allFolders, setAllFolders] = useState([]); // All folders across workspaces
  const [documentFolders, setDocumentFolders] = useState({}); // Map docId -> folderId
  const [trashedDocuments, setTrashedDocuments] = useState([]); // Soft-deleted documents
  const [selectedFolderId, setSelectedFolderId] = useState(null);
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  
  // Yjs refs for web mode sync (now only used for fallback/legacy)
  const ydocRef = useRef(null);
  const providerRef = useRef(null);
  const yFoldersRef = useRef(null);
  const yDocFoldersRef = useRef(null);
  const yTrashedDocsRef = useRef(null);
  
  // Yjs sync for folders - works in web mode AND Electron with remote workspaces
  const serverUrl = currentWorkspace?.serverUrl || null;
  const isRemoteWorkspace = !!serverUrl;
  // For P2P joined workspaces (no serverUrl but not owner), use Yjs sync
  const isWorkspaceOwner = currentWorkspace?.myPermission === 'owner';
  // Use local sidecar mode only for owned workspaces in Electron
  const useLocalMode = isElectronMode && !isRemoteWorkspace && isWorkspaceOwner;
  
  // Use synced folders from WorkspaceSyncContext when not in local mode
  // This ensures P2P-synced folders show up correctly
  useEffect(() => {
    if (!useLocalMode && currentWorkspaceId && syncedFolders) {
      console.log(`[FolderContext] Using synced folders from WorkspaceSyncContext: ${syncedFolders.length} folders`, syncedFolders.map(f => ({ id: f.id, name: f.name, color: f.color })));
      setAllFolders(prev => {
        // Keep folders from other workspaces, replace folders for this workspace
        const otherFolders = prev.filter(f => f.workspaceId !== currentWorkspaceId);
        return [...otherFolders, ...syncedFolders];
      });
    }
  }, [useLocalMode, currentWorkspaceId, syncedFolders]);
  
  // Sync document-folder mapping from WorkspaceSyncContext
  useEffect(() => {
    if (!useLocalMode && syncedDocumentFolders) {
      setDocumentFolders(prev => ({ ...prev, ...syncedDocumentFolders }));
    }
  }, [useLocalMode, syncedDocumentFolders]);
  
  // Sync trashed documents from WorkspaceSyncContext
  useEffect(() => {
    if (!useLocalMode && syncedTrashedDocuments) {
      setTrashedDocuments(syncedTrashedDocuments);
    }
  }, [useLocalMode, syncedTrashedDocuments]);
  
  // Track whether observers have been set up (for StrictMode cleanup safety)
  const observersSetUpRef = useRef(false);
  
  // LEGACY: This Yjs effect is no longer needed for P2P sync
  // Folders now come from WorkspaceSyncContext which uses workspace-meta room
  // This effect is kept only for backward compatibility with workspace-folders room
  // which may have data in older workspaces
  useEffect(() => {
    // Skip entirely - we now use WorkspaceSyncContext for all folder sync
    // The workspace-meta room is synced via P2P and contains all folder data
    if (!useLocalMode) {
      console.log(`[FolderContext] Using WorkspaceSyncContext for folder sync (skipping legacy workspace-folders room)`);
      return;
    }
    
    // Only local mode (Electron owned workspaces) uses sidecar, not Yjs
    if (useLocalMode || !currentWorkspaceId) {
      return;
    }
    
    // Reset observer tracking for new effect run
    observersSetUpRef.current = false;
    
    const mode = isElectronMode ? 'Electron (remote workspace)' : 'Web';
    console.log(`[FolderContext] ${mode} - setting up Yjs folder sync for workspace:`, currentWorkspaceId);
    
    // Create Yjs doc for folder metadata
    const roomName = `workspace-folders:${currentWorkspaceId}`;
    const ydoc = new Y.Doc();
    
    // For remote workspaces (serverUrl provided), limit reconnection attempts
    const isRemote = !!serverUrl;
    const providerOptions = isRemote ? {
      connect: true,
      maxBackoffTime: 10000,  // Max 10 seconds between retries
    } : {};
    
    // Pass serverUrl for cross-platform sync
    const provider = new WebsocketProvider(getWsUrl(serverUrl), roomName, ydoc, providerOptions);
    
    // Track connection failures for remote workspaces
    let connectionFailures = 0;
    const maxFailures = isRemote ? 5 : 30;
    
    provider.on('connection-error', () => {
      connectionFailures++;
      if (connectionFailures >= maxFailures && isRemote) {
        console.warn(`[FolderContext] Remote server unreachable after ${maxFailures} attempts, stopping`);
        provider.disconnect();
      }
    });
    
    provider.on('status', ({ status }) => {
      if (status === 'connected') {
        connectionFailures = 0;
      }
    });
    
    // Shared types for folders, doc-folder mapping, and trash
    const yFolders = ydoc.getArray('folders');
    const yDocFolders = ydoc.getMap('documentFolders');
    const yTrashedDocs = ydoc.getArray('trashedDocuments');
    
    ydocRef.current = ydoc;
    providerRef.current = provider;
    yFoldersRef.current = yFolders;
    yDocFoldersRef.current = yDocFolders;
    yTrashedDocsRef.current = yTrashedDocs;
    
    // Sync folders from Yjs to React state
    const syncFolders = () => {
      const folders = yFolders.toArray();
      console.log('[FolderContext] Yjs folder sync - received', folders.length, 'folders');
      setAllFolders(prev => {
        // Keep folders from other workspaces, merge folders for this workspace
        const otherFolders = prev.filter(f => f.workspaceId !== currentWorkspaceId);
        // If Yjs has folders, use them; otherwise keep existing local folders
        if (folders.length > 0) {
          return [...otherFolders, ...folders];
        }
        // Keep local folders if Yjs is empty (might not be synced yet)
        const localFolders = prev.filter(f => f.workspaceId === currentWorkspaceId);
        return [...otherFolders, ...localFolders];
      });
    };
    
    // Sync document-folder mapping
    const syncDocFolders = () => {
      const mapping = {};
      yDocFolders.forEach((value, key) => {
        mapping[key] = value;
      });
      setDocumentFolders(prev => ({ ...prev, ...mapping }));
    };
    
    // Sync trashed documents
    const syncTrashedDocs = () => {
      const trashed = yTrashedDocs.toArray();
      setTrashedDocuments(trashed);
    };
    
    // Subscribe to changes first (before initial sync attempt)
    yFolders.observe(syncFolders);
    yDocFolders.observe(syncDocFolders);
    yTrashedDocs.observe(syncTrashedDocs);
    
    // Mark observers as successfully set up
    observersSetUpRef.current = true;
    
    // Handle initial sync - wait for provider to sync with server
    let hasSynced = false;
    provider.on('synced', (isSynced) => {
      console.log('[FolderContext] Provider synced:', isSynced);
      if (isSynced && !hasSynced) {
        hasSynced = true;
        // Now we have the real data from server
        const remoteFolders = yFolders.toArray();
        console.log('[FolderContext] Remote folders:', remoteFolders.length);
        
        // If Yjs is empty but we have local folders, push them to Yjs
        // This handles migration of folders created before the sync fix
        if (remoteFolders.length === 0) {
          // Use a function form to get current allFolders state
          setAllFolders(currentFolders => {
            const localFolders = currentFolders.filter(f => 
              f.workspaceId === currentWorkspaceId && !f.isSystem
            );
            if (localFolders.length > 0) {
              console.log('[FolderContext] Pushing', localFolders.length, 'local folders to Yjs');
              localFolders.forEach(folder => {
                yFolders.push([folder]);
              });
            }
            return currentFolders;
          });
        }
        
        syncFolders();
        syncDocFolders();
        syncTrashedDocs();
      }
    });
    
    // If already synced (reconnection), sync immediately
    if (provider.synced && !hasSynced) {
      hasSynced = true;
      console.log('[FolderContext] Provider already synced, doing initial sync');
      syncFolders();
      syncDocFolders();
      syncTrashedDocs();
    }
    
    provider.on('status', ({ status }) => {
      console.log('[FolderContext] Yjs provider status:', status);
    });
    
    // Cleanup
    return () => {
      console.log('[FolderContext] Cleaning up Yjs folder sync');
      // Only unobserve if observers were actually set up (StrictMode safety)
      if (observersSetUpRef.current) {
        yFolders.unobserve(syncFolders);
        yDocFolders.unobserve(syncDocFolders);
        yTrashedDocs.unobserve(syncTrashedDocs);
        observersSetUpRef.current = false;
      }
      provider.destroy();
      ydoc.destroy();
      ydocRef.current = null;
      providerRef.current = null;
      yFoldersRef.current = null;
      yDocFoldersRef.current = null;
      yTrashedDocsRef.current = null;
    };
  }, [currentWorkspaceId, isRemoteWorkspace, serverUrl]);
  
  // Folders filtered by current workspace
  const folders = useMemo(() => {
    if (!currentWorkspaceId) return [];
    const systemFolders = getSystemFolders(currentWorkspaceId);
    const userFolders = allFolders.filter(f => 
      f.workspaceId === currentWorkspaceId && !f.deletedAt
    );
    return [...systemFolders, ...userFolders];
  }, [allFolders, currentWorkspaceId]);
  
  // Trashed folders for current workspace
  const trashedFolders = useMemo(() => {
    if (!currentWorkspaceId) return [];
    return allFolders.filter(f => 
      f.workspaceId === currentWorkspaceId && f.deletedAt
    );
  }, [allFolders, currentWorkspaceId]);
  
  // Initialize selected folder when workspace changes
  useEffect(() => {
    if (currentWorkspaceId) {
      setSelectedFolderId(`${currentWorkspaceId}:all`);
      setExpandedFolders(new Set([`${currentWorkspaceId}:all`]));
    }
  }, [currentWorkspaceId]);

  // Load folders from sidecar for current workspace
  useEffect(() => {
    // Only request when connected and have a workspace
    if (connected && metaSocket && currentWorkspaceId) {
      console.log('[FolderContext] Requesting folder list for workspace:', currentWorkspaceId);
      metaSocket.send(JSON.stringify({ 
        type: 'list-folders', 
        workspaceId: currentWorkspaceId 
      }));
      metaSocket.send(JSON.stringify({ 
        type: 'list-trash', 
        workspaceId: currentWorkspaceId 
      }));
    }
  }, [connected, metaSocket, currentWorkspaceId]);

  // Handle messages from sidecar
  useEffect(() => {
    if (!metaSocket) return;

    const handleMessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'folder-list') {
          // Merge folders (don't replace, workspace-scoped data might come separately)
          const incomingFolders = data.folders || [];
          setAllFolders(prev => {
            // Remove old folders for this workspace and add new ones
            const otherFolders = prev.filter(f => f.workspaceId !== data.workspaceId);
            return [...otherFolders, ...incomingFolders];
          });
          setDocumentFolders(prev => ({ ...prev, ...(data.documentFolders || {}) }));
        } else if (data.type === 'trash-list') {
          setTrashedDocuments(data.documents || []);
        } else if (data.type === 'folder-created') {
          // Only add if not already present (avoid duplicates from optimistic update)
          setAllFolders(prev => {
            if (prev.some(f => f.id === data.folder.id)) {
              return prev;
            }
            return [...prev, data.folder];
          });
        } else if (data.type === 'folder-updated') {
          setAllFolders(prev => prev.map(f => f.id === data.folder.id ? data.folder : f));
        } else if (data.type === 'folder-deleted') {
          // Soft delete - move to trash
          setAllFolders(prev => prev.map(f => 
            f.id === data.folderId 
              ? { ...f, deletedAt: Date.now() }
              : f
          ));
        } else if (data.type === 'folder-restored') {
          // Restore from trash
          setAllFolders(prev => prev.map(f => 
            f.id === data.folderId 
              ? { ...f, deletedAt: null }
              : f
          ));
        } else if (data.type === 'folder-purged') {
          // Hard delete
          setAllFolders(prev => prev.filter(f => f.id !== data.folderId));
        } else if (data.type === 'document-moved') {
          setDocumentFolders(prev => ({
            ...prev,
            [data.documentId]: data.folderId
          }));
        } else if (data.type === 'document-trashed') {
          setTrashedDocuments(prev => [...prev, data.document]);
        } else if (data.type === 'document-restored') {
          setTrashedDocuments(prev => prev.filter(d => d.id !== data.documentId));
        }
      } catch (e) {
        console.error('Failed to parse folder message:', e);
      }
    };

    metaSocket.addEventListener('message', handleMessage);
    return () => metaSocket.removeEventListener('message', handleMessage);
  }, [metaSocket]);

  // Create a new folder (with workspace and key derivation)
  const createFolder = useCallback(async (name, parentId = null, options = {}) => {
    if (!currentWorkspaceId) {
      console.error('Cannot create folder without a workspace');
      return null;
    }
    
    const folderId = generateFolderId();
    
    // Derive folder key from workspace or parent folder
    const keyChain = getStoredKeyChain(currentWorkspaceId);
    if (keyChain?.workspaceKey) {
      const parentKey = parentId && keyChain.folders?.[parentId] 
        ? keyChain.folders[parentId]
        : keyChain.workspaceKey;
      const folderKey = await deriveFolderKey(parentKey, folderId);
      
      // Store in key chain
      storeKeyChain(currentWorkspaceId, {
        ...keyChain,
        folders: { ...keyChain.folders, [folderId]: folderKey }
      });
    }
    
    const folder = {
      id: folderId,
      name,
      workspaceId: currentWorkspaceId,
      parentId,
      icon: options.icon || '📁',
      color: options.color || null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
    };

    // Sync via appropriate mechanism
    const shouldUseLocalMode = isElectronMode && !isRemoteWorkspace && isWorkspaceOwner;
    if (shouldUseLocalMode) {
      // Optimistically add locally
      setAllFolders(prev => [...prev, folder]);
      // Electron local mode: use sidecar metaSocket
      if (metaSocket && metaSocket.readyState === WebSocket.OPEN) {
        console.log('[FolderContext] Sending create-folder to sidecar:', folder.id, folder.name);
        metaSocket.send(JSON.stringify({ type: 'create-folder', folder }));
      } else {
        console.error('[FolderContext] Cannot send create-folder - socket not open. Socket:', !!metaSocket, 'State:', metaSocket?.readyState);
      }
    } else {
      // Web mode, remote workspace, or P2P joined: use WorkspaceSyncContext
      if (syncAddFolder) {
        console.log('[FolderContext] Adding folder via WorkspaceSyncContext:', folder.id, folder.name);
        syncAddFolder(folder);
      } else {
        console.error('[FolderContext] Cannot create folder - syncAddFolder not available');
      }
    }

    return folder.id;
  }, [metaSocket, currentWorkspaceId, isRemoteWorkspace, isWorkspaceOwner, syncAddFolder]);

  // Update a folder
  const updateFolder = useCallback((folderId, updates) => {
    const folder = allFolders.find(f => f.id === folderId);
    if (!folder || folder.isSystem) return;
    
    const updatedFolder = {
      ...folder,
      ...updates,
      updatedAt: Date.now(),
    };

    // Sync via appropriate mechanism
    const shouldUseLocalMode = isElectronMode && !isRemoteWorkspace && isWorkspaceOwner;
    if (shouldUseLocalMode) {
      // Optimistically update locally
      setAllFolders(prev => prev.map(f => f.id === folderId ? updatedFolder : f));
      // Sync to sidecar
      if (metaSocket && metaSocket.readyState === WebSocket.OPEN) {
        metaSocket.send(JSON.stringify({ type: 'update-folder', folder: updatedFolder }));
      }
    } else {
      // Web mode, remote workspace, or P2P joined: use WorkspaceSyncContext
      if (syncUpdateFolder) {
        syncUpdateFolder(folderId, updates);
      }
    }
  }, [metaSocket, allFolders, isRemoteWorkspace, isWorkspaceOwner, syncUpdateFolder]);

  // Rename a folder (convenience wrapper around updateFolder)
  const renameFolder = useCallback((folderId, newName) => {
    if (!newName?.trim()) return;
    updateFolder(folderId, { name: newName.trim() });
  }, [updateFolder]);

  // Soft delete a folder (move to trash)
  const deleteFolder = useCallback((folderId, deletedBy = null) => {
    const folder = allFolders.find(f => f.id === folderId);
    if (!folder || folder.isSystem) return;

    // Soft delete - set deletedAt timestamp
    const deletedFolder = {
      ...folder,
      deletedAt: Date.now(),
      deletedBy,
    };

    // Sync via appropriate mechanism
    const shouldUseLocalMode = isElectronMode && !isRemoteWorkspace && isWorkspaceOwner;
    if (shouldUseLocalMode) {
      // Optimistically update locally
      setAllFolders(prev => prev.map(f => f.id === folderId ? deletedFolder : f));
      // Sync to sidecar (include workspaceId for Yjs P2P sync)
      if (metaSocket && metaSocket.readyState === WebSocket.OPEN) {
        metaSocket.send(JSON.stringify({ 
          type: 'delete-folder', 
          folderId, 
          deletedBy,
          workspaceId: currentWorkspaceId // For P2P sync
        }));
      }
    } else {
      // Web mode, remote workspace, or P2P joined: use WorkspaceSyncContext
      // Soft delete = update with deletedAt
      if (syncUpdateFolder) {
        syncUpdateFolder(folderId, { deletedAt: Date.now(), deletedBy });
      }
    }

    // Select 'all' if current folder was deleted
    if (selectedFolderId === folderId) {
      setSelectedFolderId(currentWorkspaceId ? `${currentWorkspaceId}:all` : null);
    }
  }, [metaSocket, allFolders, selectedFolderId, currentWorkspaceId, isRemoteWorkspace, isWorkspaceOwner, syncUpdateFolder]);
  
  // Restore a folder from trash
  const restoreFolder = useCallback((folderId) => {
    const folder = allFolders.find(f => f.id === folderId);
    if (!folder || !folder.deletedAt) return;
    
    // Also restore parent folders if they're deleted
    let parentId = folder.parentId;
    const foldersToRestore = [folderId];
    
    while (parentId) {
      const parent = allFolders.find(f => f.id === parentId);
      if (parent?.deletedAt) {
        foldersToRestore.unshift(parentId);
        parentId = parent.parentId;
      } else {
        break;
      }
    }
    
    // Sync via appropriate mechanism
    const shouldUseLocalMode = isElectronMode && !isRemoteWorkspace && isWorkspaceOwner;
    if (shouldUseLocalMode) {
      // Restore all folders in chain
      setAllFolders(prev => prev.map(f => 
        foldersToRestore.includes(f.id) 
          ? { ...f, deletedAt: null, deletedBy: null }
          : f
      ));
      // Sync to sidecar
      if (metaSocket && metaSocket.readyState === WebSocket.OPEN) {
        foldersToRestore.forEach(id => {
          metaSocket.send(JSON.stringify({ type: 'restore-folder', folderId: id }));
        });
      }
    } else {
      // Web mode, remote workspace, or P2P joined: use WorkspaceSyncContext
      if (syncUpdateFolder) {
        foldersToRestore.forEach(id => {
          syncUpdateFolder(id, { deletedAt: null, deletedBy: null });
        });
      }
    }
  }, [metaSocket, allFolders, isRemoteWorkspace, isWorkspaceOwner, syncUpdateFolder]);
  
  // Permanently delete a folder (only from trash)
  const purgeFolder = useCallback((folderId) => {
    const folder = allFolders.find(f => f.id === folderId);
    if (!folder?.deletedAt) return; // Can only purge trashed folders
    
    // Update document folders mapping
    const updateDocFolders = () => {
      setDocumentFolders(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(docId => {
          if (next[docId] === folderId) {
            delete next[docId];
          }
        });
        return next;
      });
    };
    
    // Sync via appropriate mechanism
    const shouldUseLocalMode = isElectronMode && !isRemoteWorkspace && isWorkspaceOwner;
    if (shouldUseLocalMode) {
      // Remove folder and all its documents
      setAllFolders(prev => prev.filter(f => f.id !== folderId));
      updateDocFolders();
      // Sync to sidecar
      if (metaSocket && metaSocket.readyState === WebSocket.OPEN) {
        metaSocket.send(JSON.stringify({ type: 'purge-folder', folderId }));
      }
    } else {
      // Web mode, remote workspace, or P2P joined: use WorkspaceSyncContext
      if (syncRemoveFolder) {
        syncRemoveFolder(folderId);
      }
      // Also remove document folder mappings for documents in this folder
      if (syncSetDocumentFolder) {
        Object.entries(documentFolders).forEach(([docId, docFolderId]) => {
          if (docFolderId === folderId) {
            syncSetDocumentFolder(docId, null);
          }
        });
      }
    }
  }, [metaSocket, allFolders, isRemoteWorkspace, isWorkspaceOwner, syncRemoveFolder, syncSetDocumentFolder, documentFolders]);

  // Move a document to a folder
  const moveDocumentToFolder = useCallback((documentId, folderId) => {
    // Resolve virtual folder IDs
    const actualFolderId = folderId && SYSTEM_FOLDER_IDS.includes(folderId.split(':').pop())
      ? null
      : folderId;
    
    // Sync via appropriate mechanism
    const shouldUseLocalMode = isElectronMode && !isRemoteWorkspace && isWorkspaceOwner;
    if (shouldUseLocalMode) {
      // Optimistically update locally
      setDocumentFolders(prev => {
        if (actualFolderId === null) {
          const next = { ...prev };
          delete next[documentId];
          return next;
        }
        return { ...prev, [documentId]: actualFolderId };
      });
      // Sync to sidecar
      if (metaSocket && metaSocket.readyState === WebSocket.OPEN) {
        metaSocket.send(JSON.stringify({ 
          type: 'move-document', 
          documentId, 
          folderId: actualFolderId,
          workspaceId: currentWorkspaceId
        }));
      }
    } else {
      // Web mode, remote workspace, or P2P joined: use WorkspaceSyncContext
      if (syncSetDocumentFolder) {
        syncSetDocumentFolder(documentId, actualFolderId);
      }
    }
  }, [metaSocket, currentWorkspaceId, isRemoteWorkspace, isWorkspaceOwner, syncSetDocumentFolder]);
  
  // Soft delete a document (move to trash)
  const trashDocument = useCallback((document, deletedBy = null) => {
    const trashedDoc = {
      ...document,
      deletedAt: Date.now(),
      deletedBy,
    };
    
    // Sync via appropriate mechanism
    const shouldUseLocalMode = isElectronMode && !isRemoteWorkspace && isWorkspaceOwner;
    if (shouldUseLocalMode) {
      setTrashedDocuments(prev => [...prev, trashedDoc]);
      // Sync to sidecar
      if (metaSocket && metaSocket.readyState === WebSocket.OPEN) {
        metaSocket.send(JSON.stringify({ 
          type: 'trash-document', 
          document: trashedDoc,
          workspaceId: currentWorkspaceId
        }));
      }
    } else {
      // Web mode, remote workspace, or P2P joined: use WorkspaceSyncContext
      if (syncTrashDocument) {
        syncTrashDocument(document, deletedBy);
      }
    }
    
    return trashedDoc;
  }, [metaSocket, currentWorkspaceId, isRemoteWorkspace, isWorkspaceOwner, syncTrashDocument]);
  
  // Restore a document from trash
  const restoreDocument = useCallback((documentId) => {
    const doc = trashedDocuments.find(d => d.id === documentId);
    if (!doc) return null;
    
    // Also restore parent folder if trashed
    const folderId = documentFolders[documentId];
    if (folderId) {
      const folder = allFolders.find(f => f.id === folderId);
      if (folder?.deletedAt) {
        restoreFolder(folderId);
      }
    }
    
    // Sync via appropriate mechanism
    const shouldUseLocalMode = isElectronMode && !isRemoteWorkspace && isWorkspaceOwner;
    if (shouldUseLocalMode) {
      setTrashedDocuments(prev => prev.filter(d => d.id !== documentId));
      // Sync to sidecar
      if (metaSocket && metaSocket.readyState === WebSocket.OPEN) {
        metaSocket.send(JSON.stringify({ 
          type: 'restore-document', 
          documentId,
          workspaceId: currentWorkspaceId
        }));
      }
    } else {
      // Web mode, remote workspace, or P2P joined: use WorkspaceSyncContext
      if (syncRestoreDocument) {
        syncRestoreDocument(documentId);
      }
    }
    
    // Return restored document without trash fields
    const { deletedAt, deletedBy, ...restoredDoc } = doc;
    return restoredDoc;
  }, [metaSocket, trashedDocuments, documentFolders, allFolders, restoreFolder, currentWorkspaceId, isRemoteWorkspace, isWorkspaceOwner, syncRestoreDocument]);
  
  // Permanently delete a document from trash
  const purgeDocument = useCallback((documentId) => {
    // Sync via appropriate mechanism
    const shouldUseLocalMode = isElectronMode && !isRemoteWorkspace && isWorkspaceOwner;
    if (shouldUseLocalMode) {
      setTrashedDocuments(prev => prev.filter(d => d.id !== documentId));
      // Sync to sidecar
      if (metaSocket && metaSocket.readyState === WebSocket.OPEN) {
        metaSocket.send(JSON.stringify({ 
          type: 'purge-document', 
          documentId,
          workspaceId: currentWorkspaceId
        }));
      }
    } else {
      // Web mode, remote workspace, or P2P joined: use WorkspaceSyncContext
      if (syncPermanentlyDeleteDocument) {
        syncPermanentlyDeleteDocument(documentId);
      }
    }
  }, [metaSocket, currentWorkspaceId, isRemoteWorkspace, isWorkspaceOwner, syncPermanentlyDeleteDocument]);
  
  // Get days remaining before purge for a trashed item
  const getDaysRemaining = useCallback((deletedAt) => {
    if (!deletedAt) return TRASH_PURGE_DAYS;
    const elapsed = Date.now() - deletedAt;
    const remaining = TRASH_PURGE_MS - elapsed;
    return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
  }, []);

  // Pre-compute folder hierarchy map for O(1) child lookups (avoids O(n²) recursive traversal)
  const folderChildrenMap = useMemo(() => {
    const map = new Map();
    const userFolders = folders.filter(f => !f.isSystem && !f.deletedAt);
    userFolders.forEach(folder => {
      const parentId = folder.parentId || null;
      if (!map.has(parentId)) {
        map.set(parentId, []);
      }
      map.get(parentId).push(folder);
    });
    return map;
  }, [folders]);

  // Get folder hierarchy for tree view (workspace-scoped, excluding system folders)
  // Uses pre-computed map for O(n) traversal instead of O(n²)
  const getFolderHierarchy = useCallback((parentId = null) => {
    const children = folderChildrenMap.get(parentId) || [];
    return children.map(folder => ({
      ...folder,
      children: getFolderHierarchy(folder.id),
    }));
  }, [folderChildrenMap]);

  // Get documents in a folder (updated for workspace-scoped virtual folders)
  const getDocumentsInFolder = useCallback((folderId, documents) => {
    // Handle workspace-scoped virtual folder IDs like "workspace-123:all"
    const virtualId = folderId?.includes(':') ? folderId.split(':').pop() : folderId;
    
    // Filter out trashed documents first
    const activeDocuments = documents.filter(d => !trashedDocuments.some(t => t.id === d.id));
    
    if (virtualId === 'all') {
      return activeDocuments;
    }
    if (virtualId === 'recent') {
      // Sort by lastEdited and take top 10
      return [...activeDocuments]
        .sort((a, b) => (b.lastEdited || 0) - (a.lastEdited || 0))
        .slice(0, 10);
    }
    if (virtualId === 'shared') {
      // Return documents that have multiple authors or are shared
      return activeDocuments.filter(d => d.isShared || (d.authorCount && d.authorCount > 1));
    }
    if (virtualId === 'trash') {
      // Return trashed documents for current workspace
      return trashedDocuments.filter(d => {
        const docFolderId = documentFolders[d.id];
        if (!docFolderId) return d.workspaceId === currentWorkspaceId;
        const folder = allFolders.find(f => f.id === docFolderId);
        return folder?.workspaceId === currentWorkspaceId;
      });
    }
    
    // Return documents in this folder or its children
    // Use BFS with pre-computed folderChildrenMap for O(n) traversal instead of O(n²)
    const folderIds = new Set([folderId]);
    const queue = [folderId];
    
    while (queue.length > 0) {
      const parentId = queue.shift();
      const children = folderChildrenMap.get(parentId) || [];
      for (const child of children) {
        if (!folderIds.has(child.id)) {
          folderIds.add(child.id);
          queue.push(child.id);
        }
      }
    }
    
    return activeDocuments.filter(d => {
      const docFolderId = documentFolders[d.id];
      return folderIds.has(docFolderId);
    });
  }, [folders, folderChildrenMap, documentFolders, trashedDocuments, allFolders, currentWorkspaceId]);
  
  // Get all trash items (folders and documents) for current workspace
  const getTrashItems = useCallback(() => {
    const items = [];
    
    // Add trashed folders
    trashedFolders.forEach(folder => {
      items.push({
        type: 'folder',
        id: folder.id,
        name: folder.name,
        icon: folder.icon,
        deletedAt: folder.deletedAt,
        deletedBy: folder.deletedBy,
        daysRemaining: getDaysRemaining(folder.deletedAt),
      });
    });
    
    // Add trashed documents
    trashedDocuments
      .filter(d => {
        const docFolderId = documentFolders[d.id];
        if (!docFolderId) return d.workspaceId === currentWorkspaceId;
        const folder = allFolders.find(f => f.id === docFolderId);
        return folder?.workspaceId === currentWorkspaceId;
      })
      .forEach(doc => {
        items.push({
          type: 'document',
          id: doc.id,
          name: doc.title || 'Untitled',
          deletedAt: doc.deletedAt,
          deletedBy: doc.deletedBy,
          daysRemaining: getDaysRemaining(doc.deletedAt),
        });
      });
    
    // Sort by deletedAt descending (most recent first)
    return items.sort((a, b) => b.deletedAt - a.deletedAt);
  }, [trashedFolders, trashedDocuments, documentFolders, allFolders, currentWorkspaceId, getDaysRemaining]);

  // Toggle folder expansion
  const toggleFolderExpand = useCallback((folderId) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  // Get breadcrumb path for a folder (with cycle detection)
  const getFolderPath = useCallback((folderId) => {
    const path = [];
    const visited = new Set(); // Cycle detection
    let current = folders.find(f => f.id === folderId);
    
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      path.unshift(current);
      current = current.parentId ? folders.find(f => f.id === current.parentId) : null;
    }
    
    return path;
  }, [folders]);

  // Get document's folder
  const getDocumentFolder = useCallback((documentId) => {
    return documentFolders[documentId] || null;
  }, [documentFolders]);

  // Memoize context value to prevent unnecessary re-renders of consumers
  const value = useMemo(() => ({
    // Folder state
    folders,
    allFolders,
    trashedFolders,
    documentFolders,
    trashedDocuments,
    selectedFolderId,
    expandedFolders,
    
    // Selection
    setSelectedFolderId,
    toggleFolderExpand,
    
    // Folder CRUD
    createFolder,
    updateFolder,
    renameFolder,
    deleteFolder,
    restoreFolder,
    purgeFolder,
    
    // Document management
    moveDocumentToFolder,
    trashDocument,
    restoreDocument,
    purgeDocument,
    
    // Hierarchy and navigation
    getFolderHierarchy,
    getDocumentsInFolder,
    getFolderPath,
    getDocumentFolder,
    
    // Trash
    getTrashItems,
    getDaysRemaining,
    
    // Constants
    TRASH_PURGE_DAYS,
    SYSTEM_FOLDER_IDS,
  }), [
    folders, allFolders, trashedFolders, documentFolders, trashedDocuments,
    selectedFolderId, expandedFolders, setSelectedFolderId, toggleFolderExpand,
    createFolder, updateFolder, renameFolder, deleteFolder, restoreFolder, purgeFolder,
    moveDocumentToFolder, trashDocument, restoreDocument, purgeDocument,
    getFolderHierarchy, getDocumentsInFolder, getFolderPath, getDocumentFolder,
    getTrashItems, getDaysRemaining
  ]);

  return (
    <FolderContext.Provider value={value}>
      {children}
    </FolderContext.Provider>
  );
}

export function useFolders() {
  const context = useContext(FolderContext);
  if (!context) {
    throw new Error('useFolders must be used within a FolderProvider');
  }
  return context;
}

export { SYSTEM_FOLDER_IDS, TRASH_PURGE_DAYS };
export default FolderContext;
