/**
 * useWorkspaceSync Hook
 * 
 * Syncs workspace metadata (document list, folder structure) across connected clients.
 * Uses a Yjs doc per workspace for real-time sync via y-websocket.
 * 
 * This enables:
 * - Multiple clients seeing the same document list
 * - Real-time updates when documents are created/deleted
 * - Workspace content sync via invite links
 * - Workspace-level collaborator tracking
 * - Cross-platform sync (Electron connecting to web-hosted workspaces via serverUrl)
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { isElectron } from '../hooks/useEnvironment';
import { getYjsWebSocketUrl } from '../utils/websocket';
import { getStoredKeyChain } from '../utils/keyDerivation';
import { toString as uint8ArrayToString } from 'uint8arrays';
import { META_WS_PORT, WS_RECONNECT_MAX_DELAY, TIMEOUT_LONG, AWARENESS_HEARTBEAT_MS } from '../config/constants';

// Alias for backwards compatibility
const getWsUrl = getYjsWebSocketUrl;

/**
 * Hook to sync workspace metadata via Yjs
 * @param {string} workspaceId - Current workspace ID
 * @param {Object} initialWorkspaceInfo - Initial workspace info (name, icon, etc.) for owner
 * @param {Object} userProfile - Current user's profile (name, color, icon)
 * @param {string|null} serverUrl - Optional remote server URL for cross-platform sync
 * @param {Object|null} userIdentity - User identity object with publicKeyBase62
 * @param {string|null} myPermission - Current user's permission in this workspace
 * @returns {Object} { documents, folders, workspaceInfo, collaborators, onlineCount, totalCount, ... }
 */
export function useWorkspaceSync(workspaceId, initialWorkspaceInfo = null, userProfile = null, serverUrl = null, userIdentity = null, myPermission = null) {
  const [documents, setDocuments] = useState([]);
  const [folders, setFolders] = useState([]);
  const [workspaceInfo, setWorkspaceInfo] = useState(null);
  const [connected, setConnected] = useState(false);
  const [synced, setSynced] = useState(false);
  // Workspace-level collaborator tracking
  const [collaborators, setCollaborators] = useState([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  // Track which document each collaborator has open (for tab presence indicators)
  // Map of documentId -> array of { name, color, icon, publicKey }
  const [collaboratorsByDocument, setCollaboratorsByDocument] = useState({});
  
  // Membership tracking (keyed by publicKey for deduplication)
  const [members, setMembers] = useState({});
  const [kicked, setKicked] = useState({});
  const [isKicked, setIsKicked] = useState(false);
  
  // Document-folder mapping and trashed documents (for FolderContext compatibility)
  const [documentFolders, setDocumentFolders] = useState({}); // Map docId -> folderId
  const [trashedDocuments, setTrashedDocuments] = useState([]); // Soft-deleted documents
  
  // Sync progress tracking for UI feedback
  const [syncPhase, setSyncPhase] = useState('idle'); // idle, connecting, awaiting-peers, receiving-metadata, receiving-documents, complete, failed, expired
  const [syncProgress, setSyncProgress] = useState({
    bytesReceived: 0,
    documentsReceived: 0,
    foldersReceived: 0,
    membersReceived: 0,
    startTime: null,
    error: null,
  });
  
  // Track when provider is ready (for triggering awareness update effect)
  const [providerReady, setProviderReady] = useState(false);
  
  const ydocRef = useRef(null);
  const providerRef = useRef(null);
  const yDocumentsRef = useRef(null);
  const yFoldersRef = useRef(null);
  const yInfoRef = useRef(null);
  const yCollaboratorsRef = useRef(null);
  const yMembersRef = useRef(null);
  const yKickedRef = useRef(null);
  const yDocFoldersRef = useRef(null); // Map docId -> folderId
  const yTrashedDocsRef = useRef(null); // Array of trashed documents
  const yInventorySystemsRef = useRef(null); // Map of inventory systems
  const yCatalogItemsRef = useRef(null); // Array of catalog items
  const yInventoryRequestsRef = useRef(null); // Array of inventory requests
  const yProducerCapacitiesRef = useRef(null); // Map of producer capacities
  const yAddressRevealsRef = useRef(null); // Map of encrypted address reveals
  const yPendingAddressesRef = useRef(null); // Map of pending addresses
  const yInventoryAuditLogRef = useRef(null); // Array of audit log entries
  const yInventoryNotificationsRef = useRef(null); // Array of inventory notifications
  // File Storage shared types — live in workspace-level Y.Doc (NOT separate per-document rooms)
  // See docs/FILE_STORAGE_SPEC.md §15.2
  const yFileStorageSystemsRef = useRef(null); // Map of file storage systems
  const yStorageFilesRef = useRef(null); // Array of storage files
  const yStorageFoldersRef = useRef(null); // Array of storage folders
  const yChunkAvailabilityRef = useRef(null); // Map of chunk availability
  const yFileAuditLogRef = useRef(null); // Array of file audit log entries
  
  // Keep a ref to userIdentity so that callbacks inside the main effect
  // (which captures the initial closure) always see the latest value.
  const userIdentityRef = useRef(userIdentity);
  userIdentityRef.current = userIdentity;

  // Keep a ref to userProfile for the same reason
  const userProfileRef = useRef(userProfile);
  userProfileRef.current = userProfile;

  // Keep a ref to myPermission for the same reason
  const myPermissionRef = useRef(myPermission);
  myPermissionRef.current = myPermission;

  // Initialize Yjs sync when workspace changes
  useEffect(() => {
    // Always reset kicked state when workspace changes
    setIsKicked(false);
    setSynced(false);
    setProviderReady(false); // Reset provider ready state
    setSyncPhase('idle');
    setSyncProgress({ bytesReceived: 0, documentsReceived: 0, foldersReceived: 0, membersReceived: 0, startTime: null, error: null });

    if (!workspaceId) {
      setDocuments([]);
      setFolders([]);
      setWorkspaceInfo(null);
      setConnected(false);
      setSynced(false);
      setCollaborators([]);
      setOnlineCount(0);
      setTotalCount(0);
      setCollaboratorsByDocument({});
      setMembers({});
      setKicked({});
      setSyncPhase('idle');
      return;
    }
    
    // Start sync - set phase and start time
    setSyncPhase('connecting');
    setSyncProgress(prev => ({ ...prev, startTime: Date.now() }));
    
    const roomName = `workspace-meta:${workspaceId}`;
    // Pass serverUrl to getWsUrl for cross-platform workspaces
    const wsUrl = getWsUrl(serverUrl);
    let cleanedUp = false;
    let keySocket = null;
    let keySocketReconnecting = false; // Prevent multiple reconnection attempts
    
    // DEBUG: Log connection details
    console.log(`[WorkspaceSync] ========== SYNC INIT ==========`);
    console.log(`[WorkspaceSync] workspaceId: ${workspaceId}`);
    console.log(`[WorkspaceSync] roomName: ${roomName}`);
    console.log(`[WorkspaceSync] wsUrl: ${wsUrl}`);
    console.log(`[WorkspaceSync] serverUrl (param): ${serverUrl || '(none - using default)'}`);
    console.log(`[WorkspaceSync] isElectron: ${isElectron()}`);
    console.log(`[WorkspaceSync] initialWorkspaceInfo:`, initialWorkspaceInfo);
    console.log(`[WorkspaceSync] ================================`);
    
    // In Electron mode, register workspace encryption key with sidecar FIRST
    // This ensures the sidecar can encrypt/decrypt workspace metadata updates
    if (isElectron()) {
      const keyChain = getStoredKeyChain(workspaceId);
      if (keyChain?.workspaceKey) {
        try {
          keySocket = new WebSocket(`ws://localhost:${META_WS_PORT}`);
          keySocket.onopen = () => {
            const keyBase64 = uint8ArrayToString(keyChain.workspaceKey, 'base64');
            // Register key for workspace-meta room
            keySocket.send(JSON.stringify({ 
              type: 'set-key', 
              docName: roomName,
              payload: keyBase64 
            }));
            // Also register for workspace-folders room
            keySocket.send(JSON.stringify({ 
              type: 'set-key', 
              docName: `workspace-folders:${workspaceId}`,
              payload: keyBase64 
            }));
            console.log(`[WorkspaceSync] Registered workspace keys for ${workspaceId}`);
          };
          keySocket.onerror = (err) => {
            console.warn('[WorkspaceSync] Failed to register workspace key:', err);
          };
          keySocket.onclose = (event) => {
            console.warn(`[WorkspaceSync] Key socket closed (code: ${event.code}, reason: ${event.reason || 'none'})`);
            // Re-register encryption key after brief delay if not intentionally cleaned up
            if (!cleanedUp && !keySocketReconnecting) {
              keySocketReconnecting = true;
              setTimeout(() => {
                if (cleanedUp) {
                  keySocketReconnecting = false;
                  return;
                }
                try {
                  const reKeyChain = getStoredKeyChain(workspaceId);
                  if (!reKeyChain?.workspaceKey) {
                    keySocketReconnecting = false;
                    return;
                  }
                  const reSocket = new WebSocket(`ws://localhost:${META_WS_PORT}`);
                  reSocket.onopen = () => {
                    const reKeyBase64 = uint8ArrayToString(reKeyChain.workspaceKey, 'base64');
                    reSocket.send(JSON.stringify({ type: 'set-key', docName: roomName, payload: reKeyBase64 }));
                    reSocket.send(JSON.stringify({ type: 'set-key', docName: `workspace-folders:${workspaceId}`, payload: reKeyBase64 }));
                    console.log(`[WorkspaceSync] Re-registered workspace keys after socket close`);
                    keySocketReconnecting = false;
                  };
                  reSocket.onerror = (e) => {
                    console.warn('[WorkspaceSync] Re-registration socket error:', e);
                    keySocketReconnecting = false;
                  };
                  keySocket = reSocket;
                } catch (e) {
                  console.warn('[WorkspaceSync] Failed to re-register key after close:', e);
                  keySocketReconnecting = false;
                }
              }, 2000);
            }
          };
        } catch (err) {
          console.warn('[WorkspaceSync] Error creating socket for key registration:', err);
        }
      } else {
        console.warn(`[WorkspaceSync] No keychain found for workspace ${workspaceId}`);
      }
    }
    
    // Create Yjs doc and provider
    console.log(`[WorkspaceSync] Creating Yjs doc and WebSocketProvider...`);
    console.log(`[WorkspaceSync] Connecting to: ${wsUrl} with room: ${roomName}`);
    const ydoc = new Y.Doc();
    
    // For remote workspaces (serverUrl provided), limit reconnection attempts
    // For local sidecar, allow more retries as it should always be available
    const isRemote = !!serverUrl;
    const providerOptions = isRemote ? {
      connect: true,
      maxBackoffTime: WS_RECONNECT_MAX_DELAY,  // Max reconnect delay between retries
      // y-websocket doesn't have maxAttempts, but we'll handle it via status tracking
    } : {};
    
    const provider = new WebsocketProvider(wsUrl, roomName, ydoc, providerOptions);
    
    // Track connection failures for remote/local workspaces
    let connectionFailures = 0;
    // Limit retries: 5 for remote servers, 10 for local sidecar (was 30)
    const maxFailures = isRemote ? 5 : 10;
    
    // DEBUG: Track WebSocket events
    provider.on('status', (event) => {
      console.log(`[WorkspaceSync] Provider status changed:`, event.status);
      
      // Update sync phase based on provider status
      if (event.status === 'connecting') {
        setSyncPhase('connecting');
      } else if (event.status === 'connected') {
        // Connected but not synced yet - awaiting peers or metadata
        setSyncPhase('awaiting-peers');
      } else if (event.status === 'disconnected') {
        // Only mark as failed if we haven't synced yet
        if (!providerRef.current?.synced) {
          setSyncPhase(prev => prev === 'complete' ? 'complete' : 'failed');
          setSyncProgress(prev => ({ ...prev, error: 'Connection lost' }));
        }
      }
      
      // Track failures for remote workspaces
      if (event.status === 'connecting' && connectionFailures > 0 && isRemote) {
        if (connectionFailures >= maxFailures) {
          console.warn(`[WorkspaceSync] Remote server unreachable after ${maxFailures} attempts, stopping reconnection`);
          setSyncPhase('failed');
          setSyncProgress(prev => ({ ...prev, error: `Server unreachable after ${maxFailures} attempts` }));
          provider.disconnect();
        }
      } else if (event.status === 'connected') {
        connectionFailures = 0; // Reset on successful connection
      }
    });
    
    provider.on('connection-error', (event) => {
      console.error(`[WorkspaceSync] Connection error:`, event);
      connectionFailures++;
      if (connectionFailures >= maxFailures && isRemote) {
        console.warn(`[WorkspaceSync] Remote server unreachable, stopping reconnection`);
        setSyncPhase('failed');
        setSyncProgress(prev => ({ ...prev, error: 'Server unreachable' }));
        provider.disconnect();
      }
    });
    
    provider.on('synced', (synced) => {
      console.log(`[WorkspaceSync] Provider synced:`, synced);
      const yInfo = ydoc.getMap('workspaceInfo');
      const yDocs = ydoc.getArray('documents');
      console.log(`[WorkspaceSync] After sync - workspaceInfo.name:`, yInfo.get('name'));
      console.log(`[WorkspaceSync] After sync - documents count:`, yDocs.toArray().length);
    });
    
    provider.on('connection-close', (event) => {
      console.log(`[WorkspaceSync] Connection closed:`, event);
    });
    
    // Set user awareness for workspace-level presence (used by Chat)
    if (userProfile && provider.awareness) {
      provider.awareness.setLocalStateField('user', {
        name: userProfile.name || 'Anonymous',
        color: userProfile.color || '#6366f1',
        icon: userProfile.icon || '👤',
        publicKey: userIdentity?.publicKeyBase62 || null, // Stable identity for deduplication
        lastActive: Date.now(),
      });
      
      // Keep awareness updated with heartbeat
      const heartbeatInterval = setInterval(() => {
        try {
          // Guard against destroyed provider or awareness
          if (!provider || !provider.awareness || provider.wsconnected === false) {
            clearInterval(heartbeatInterval);
            return;
          }
          const currentState = provider.awareness.getLocalState();
          if (currentState?.user) {
            provider.awareness.setLocalStateField('user', {
              ...currentState.user,
              lastActive: Date.now(),
            });
          }
        } catch (err) {
          // Provider was likely destroyed, clear the interval
          console.warn('[WorkspaceSync] Heartbeat error, clearing interval:', err.message);
          clearInterval(heartbeatInterval);
        }
      }, AWARENESS_HEARTBEAT_MS); // Update every 15 seconds
      
      // Store interval ID for cleanup
      provider._heartbeatInterval = heartbeatInterval;
    }
    
    // Signal that provider is ready (triggers awareness update effect)
    setProviderReady(true);
    
    // Get shared types for documents, folders, and workspace info
    const yDocuments = ydoc.getArray('documents');
    const yFolders = ydoc.getMap('folders');
    const yInfo = ydoc.getMap('workspaceInfo');
    const yCollaborators = ydoc.getArray('workspaceCollaborators');
    
    // Document-folder mapping and trashed documents (for FolderContext compatibility)
    const yDocFolders = ydoc.getMap('documentFolders'); // Map docId -> folderId
    const yTrashedDocs = ydoc.getArray('trashedDocuments'); // Soft-deleted documents
    
    // Membership maps (keyed by publicKey for deduplication and proper identity)
    const yMembers = ydoc.getMap('members');
    const yKicked = ydoc.getMap('kicked');
    
    // Inventory shared types — live in workspace-level Y.Doc (NOT separate per-document rooms)
    // See docs/INVENTORY_SYSTEM_SPEC.md §11.2.3
    const yInventorySystems = ydoc.getMap('inventorySystems');
    const yCatalogItems = ydoc.getArray('catalogItems');
    const yInventoryRequests = ydoc.getArray('inventoryRequests');
    const yProducerCapacities = ydoc.getMap('producerCapacities');
    const yAddressReveals = ydoc.getMap('addressReveals');
    const yPendingAddresses = ydoc.getMap('pendingAddresses');
    const yInventoryAuditLog = ydoc.getArray('inventoryAuditLog');
    const yInventoryNotifications = ydoc.getArray('inventoryNotifications');
    
    // File Storage shared types — live in workspace-level Y.Doc (NOT separate per-document rooms)
    // See docs/FILE_STORAGE_SPEC.md §15.2
    const yFileStorageSystems = ydoc.getMap('fileStorageSystems');
    const yStorageFiles = ydoc.getArray('storageFiles');
    const yStorageFolders = ydoc.getMap('storageFolders');
    const yChunkAvailability = ydoc.getMap('chunkAvailability');
    const yFileAuditLog = ydoc.getArray('fileAuditLog');
    
    // RACE CONDITION FIX: Self-registration is deferred to the 'synced' handler below.
    // Before sync, yMembers is empty (persistence hasn't loaded), so reading
    // existingMember here would always return undefined, causing the owner to
    // be written with permission:'viewer' instead of their real permission.
    // See registerSelfInMembers() called inside provider.on('synced').
    
    ydocRef.current = ydoc;
    providerRef.current = provider;
    yDocumentsRef.current = yDocuments;
    yFoldersRef.current = yFolders;
    yInfoRef.current = yInfo;
    yCollaboratorsRef.current = yCollaborators;
    yMembersRef.current = yMembers;
    yKickedRef.current = yKicked;
    yDocFoldersRef.current = yDocFolders;
    yTrashedDocsRef.current = yTrashedDocs;
    yInventorySystemsRef.current = yInventorySystems;
    yCatalogItemsRef.current = yCatalogItems;
    yInventoryRequestsRef.current = yInventoryRequests;
    yProducerCapacitiesRef.current = yProducerCapacities;
    yAddressRevealsRef.current = yAddressReveals;
    yPendingAddressesRef.current = yPendingAddresses;
    yInventoryAuditLogRef.current = yInventoryAuditLog;
    yInventoryNotificationsRef.current = yInventoryNotifications;
    yFileStorageSystemsRef.current = yFileStorageSystems;
    yStorageFilesRef.current = yStorageFiles;
    yStorageFoldersRef.current = yStorageFolders;
    yChunkAvailabilityRef.current = yChunkAvailability;
    yFileAuditLogRef.current = yFileAuditLog;
    
    // Sync documents from Yjs to React state (with deduplication)
    const syncDocuments = () => {
      if (cleanedUp) return; // Prevent state updates after cleanup
      const rawDocs = yDocuments.toArray();
      
      // Deduplicate by document ID (keep first occurrence)
      const seenIds = new Set();
      const dedupedDocs = [];
      for (const doc of rawDocs) {
        if (doc.id && !seenIds.has(doc.id)) {
          seenIds.add(doc.id);
          dedupedDocs.push(doc);
        }
      }
      
      // Log if duplicates were found
      if (rawDocs.length !== dedupedDocs.length) {
        console.warn(`[WorkspaceSync] Deduplicated documents: ${rawDocs.length} -> ${dedupedDocs.length}`);
      }
      
      console.log(`[WorkspaceSync] syncDocuments called, count: ${dedupedDocs.length}`);
      setDocuments(dedupedDocs);
    };
    
    // Sync folders from Yjs to React state (Y.Map — keys are unique, no dedup needed)
    const syncFolders = () => {
      if (cleanedUp) return; // Prevent state updates after cleanup
      const foldersArray = [];
      yFolders.forEach((folder, folderId) => {
        foldersArray.push({ ...folder, id: folder.id || folderId });
      });
      
      console.log(`[WorkspaceSync] syncFolders called, count: ${foldersArray.length}`, foldersArray.map(f => ({ id: f.id, name: f.name, color: f.color })));
      setFolders(foldersArray);
    };
    
    // Sync workspace info from Yjs to React state
    const syncInfo = () => {
      if (cleanedUp) return; // Prevent state updates after cleanup
      const info = {
        name: yInfo.get('name'),
        icon: yInfo.get('icon'),
        color: yInfo.get('color'),
        createdBy: yInfo.get('createdBy'),
        createdAt: yInfo.get('createdAt'),
      };
      console.log(`[WorkspaceSync] syncInfo called:`, JSON.stringify(info));
      // Only update if we have a name (indicates data exists)
      if (info.name) {
        console.log(`[WorkspaceSync] Updating workspaceInfo state with name: "${info.name}"`);
        setWorkspaceInfo(info);
      } else {
        console.log(`[WorkspaceSync] Skipping workspaceInfo update - no name in Yjs`);
      }
    };
    
    // Sync document-folder mapping from Yjs to React state
    const syncDocFolders = () => {
      if (cleanedUp) return;
      const mapping = {};
      yDocFolders.forEach((value, key) => {
        mapping[key] = value;
      });
      console.log(`[WorkspaceSync] syncDocFolders called, count: ${Object.keys(mapping).length}`);
      setDocumentFolders(mapping);
    };
    
    // Sync trashed documents from Yjs to React state
    const syncTrashedDocs = () => {
      if (cleanedUp) return;
      const trashed = yTrashedDocs.toArray();
      console.log(`[WorkspaceSync] syncTrashedDocs called, count: ${trashed.length}`);
      setTrashedDocuments(trashed);
    };
    
    // Initial sync
    syncDocuments();
    syncFolders();
    syncInfo();
    syncDocFolders();
    syncTrashedDocs();
    
    // If we have initial info (owner creating workspace), set it ONLY after sync
    // and ONLY if the remote doesn't already have data
    // CRITICAL FIX: Only set initial info if we're the OWNER.
    // Non-owners joining get initialWorkspaceInfo set to "Shared Workspace" which would
    // overwrite the real workspace name if set before P2P sync delivers the real data.
    let hasSetInitialInfo = false;
    const trySetInitialInfo = () => {
      if (hasSetInitialInfo || !initialWorkspaceInfo) return;
      
      // CRITICAL: Only set initial info if we're the owner
      // This prevents joiners from overwriting workspace info with "Shared Workspace"
      if (myPermission !== 'owner') {
        console.log(`[WorkspaceSync] trySetInitialInfo - skipping (not owner, permission: ${myPermission})`);
        return;
      }
      
      // Only set if remote is empty (no name set)
      const existingName = yInfo.get('name');
      console.log(`[WorkspaceSync] trySetInitialInfo - existingName: "${existingName}", initialName: "${initialWorkspaceInfo?.name}"`);
      if (!existingName) {
        hasSetInitialInfo = true;
        console.log(`[WorkspaceSync] Setting initial workspace info (owner, no existing name in Yjs)`);
        yInfo.set('name', initialWorkspaceInfo.name);
        yInfo.set('icon', initialWorkspaceInfo.icon || '📁');
        yInfo.set('color', initialWorkspaceInfo.color || '#6366f1');
        yInfo.set('createdBy', initialWorkspaceInfo.createdBy || 'unknown');
        yInfo.set('createdAt', initialWorkspaceInfo.createdAt || Date.now());
      } else {
        console.log(`[WorkspaceSync] NOT setting initial info - Yjs already has name: "${existingName}"`);
      }
    };
    
    // Clean up duplicate documents and folders in the Yjs arrays (one-time per session)
    let hasCleanedDuplicates = false;
    const cleanupDuplicates = () => {
      if (hasCleanedDuplicates) return;
      hasCleanedDuplicates = true;
      
      // Clean duplicate documents
      const rawDocs = yDocuments.toArray();
      const seenDocIds = new Set();
      const duplicateDocIndices = [];
      
      for (let i = 0; i < rawDocs.length; i++) {
        const doc = rawDocs[i];
        if (doc.id && seenDocIds.has(doc.id)) {
          duplicateDocIndices.push(i);
        } else if (doc.id) {
          seenDocIds.add(doc.id);
        }
      }
      
      // Clean duplicate folders - not needed for Y.Map (keys are unique)
      // Y.Map folders can't have duplicates by design
      
      // Delete duplicates in a single transaction
      if (duplicateDocIndices.length > 0) {
        console.warn(`[WorkspaceSync] Cleaning up duplicates: ${duplicateDocIndices.length} docs`);
        
        ydoc.transact(() => {
          // Delete from highest index to lowest to avoid index shifting
          for (let i = duplicateDocIndices.length - 1; i >= 0; i--) {
            yDocuments.delete(duplicateDocIndices[i], 1);
          }
        });
        
        console.log(`[WorkspaceSync] Cleanup complete. Docs: ${rawDocs.length} -> ${yDocuments.toArray().length}`);
      }
    };
    
    // Self-registration function — MUST run after synced so yMembers is populated
    const registerSelfInMembers = () => {
      const identity = userIdentityRef.current;
      const profile = userProfileRef.current;
      const permission = myPermissionRef.current;
      if (!identity?.publicKeyBase62 || !profile) return;
      const myPublicKey = identity.publicKeyBase62;
      const existingMember = yMembers.get(myPublicKey);
      const now = Date.now();
      
      // Determine permission - use passed permission, workspace creation, or existing value
      const effectivePermission = permission || 
                                  (initialWorkspaceInfo?.createdBy === myPublicKey ? 'owner' : null) ||
                                  existingMember?.permission || 
                                  'viewer';
      
      console.log(`[WorkspaceSync] registerSelfInMembers - myPermission: ${permission}, createdBy match: ${initialWorkspaceInfo?.createdBy === myPublicKey}, existing: ${existingMember?.permission}, effective: ${effectivePermission}`);
      
      if (!existingMember) {
        yMembers.set(myPublicKey, {
          publicKey: myPublicKey,
          displayName: profile.name || 'Anonymous',
          handle: profile.name || '',
          color: profile.color || '#6366f1',
          icon: profile.icon || '👤',
          permission: effectivePermission,
          permissionUpdatedAt: now,
          joinedAt: now,
          lastSeen: now,
          isOnline: true,
        });
      } else {
        // Update existing member - use authoritative effectivePermission directly
        // (no max-hierarchy: server/owner demotions must be respected)
        const permChanged = effectivePermission !== existingMember.permission;
        yMembers.set(myPublicKey, {
          ...existingMember,
          displayName: profile.name || existingMember.displayName,
          color: profile.color || existingMember.color,
          icon: profile.icon || existingMember.icon,
          permission: effectivePermission,
          permissionUpdatedAt: permChanged ? now : (existingMember.permissionUpdatedAt || now),
          lastSeen: now,
          isOnline: true,
        });
      }
    };

    // Wait for initial sync before setting info (to check if remote has data)
    provider.on('synced', () => {
      console.log(`[WorkspaceSync] ========== SYNC RECEIVED ==========`);
      console.log(`[WorkspaceSync] synced event - resyncing all data to React state`);
      
      // Log what we received from peers
      const receivedDocs = yDocuments.toArray();
      const receivedFolders = [];
      yFolders.forEach((folder, folderId) => {
        receivedFolders.push({ ...folder, id: folder.id || folderId });
      });
      const receivedInfo = {
        name: yInfo.get('name'),
        icon: yInfo.get('icon'),
        color: yInfo.get('color'),
        createdBy: yInfo.get('createdBy'),
      };
      const receivedMembersCount = yMembers.size;
      const receivedKickedCount = yKicked.size;
      
      console.log(`[WorkspaceSync] Received from peers:`, JSON.stringify({
        documentsCount: receivedDocs.length,
        documentNames: receivedDocs.map(d => ({ id: d.id?.substring(0, 10), name: d.name })),
        foldersCount: receivedFolders.length,
        workspaceInfo: receivedInfo,
        membersCount: receivedMembersCount,
        kickedCount: receivedKickedCount,
      }, null, 2));
      console.log(`[WorkspaceSync] ==================================`);
      
      // Update sync progress with received data counts
      setSyncProgress(prev => ({
        ...prev,
        documentsReceived: receivedDocs.length,
        foldersReceived: receivedFolders.length,
        membersReceived: receivedMembersCount,
      }));
      
      // Clean up any duplicate documents/folders in the Yjs arrays (one-time)
      cleanupDuplicates();
      
      // Register self in members map AFTER sync so yMembers is populated from persistence/peers
      registerSelfInMembers();
      
      setSynced(true);
      // Mark sync as complete
      setSyncPhase('complete');
      
      // Re-sync all data to React state after provider sync
      syncDocuments();
      syncFolders();
      syncInfo();
      syncMembers();
      trySetInitialInfo();
    });
    
    // Also try immediately in case we're already synced
    if (provider.synced) {
      registerSelfInMembers();
      setSynced(true);
      trySetInitialInfo();
    }
    
    // Sync workspace-level collaborators from Yjs
    // Derive from yMembers (the authoritative membership map) since yCollaborators
    // Y.Array is a legacy type that is never populated.  Also merge any entries
    // from the legacy yCollaborators array so nothing is lost.
    const syncCollaborators = () => {
      if (cleanedUp) return; // Prevent state updates after cleanup
      const membersArr = [];
      yMembers.forEach((value, key) => {
        membersArr.push({
          ...value,
          publicKey: key,
          publicKeyBase62: key, // alias so resolveCollaborator works with both fields
        });
      });
      // Merge legacy yCollaborators entries (if any exist)
      const legacyCollabs = yCollaborators.toArray();
      for (const lc of legacyCollabs) {
        const lcKey = lc.publicKey || lc.publicKeyBase62;
        if (lcKey && !membersArr.find(m => m.publicKey === lcKey)) {
          membersArr.push({ ...lc, publicKey: lcKey, publicKeyBase62: lcKey });
        }
      }
      setCollaborators(membersArr);
      setTotalCount(membersArr.length);
    };
    
    // Sync members map (keyed by publicKey for deduplication)
    const syncMembers = () => {
      if (cleanedUp) return; // Prevent state updates after cleanup
      const membersObj = {};
      yMembers.forEach((value, key) => {
        membersObj[key] = value;
      });
      setMembers(membersObj);
      console.log(`[WorkspaceSync] syncMembers called, count: ${Object.keys(membersObj).length}`);
    };
    
    // Sync kicked map and check if current user is kicked
    const syncKicked = () => {
      if (cleanedUp) return; // Prevent state updates after cleanup
      const kickedObj = {};
      const kickedKeys = [];
      yKicked.forEach((value, key) => {
        kickedObj[key] = value;
        kickedKeys.push(key);
      });
      setKicked(kickedObj);
      
      console.log(`[WorkspaceSync] syncKicked - kicked keys:`, kickedKeys);
      
      // Check if current user is kicked
      if (userIdentityRef.current?.publicKeyBase62) {
        const myKey = userIdentityRef.current.publicKeyBase62;
        const amIKicked = yKicked.has(myKey);
        console.log(`[WorkspaceSync] Checking if I'm kicked - my key: "${myKey}", amIKicked: ${amIKicked}`);
        
        // Debug: check for partial matches
        if (!amIKicked && kickedKeys.length > 0) {
          kickedKeys.forEach(k => {
            if (k.includes(myKey) || myKey.includes(k)) {
              console.warn(`[WorkspaceSync] Partial key match found! kicked key: "${k}", my key: "${myKey}"`);
            }
          });
        }
        
        if (amIKicked) {
          console.warn(`[WorkspaceSync] Current user has been kicked from workspace ${workspaceId}`);
          // Set kicked state - the hook is per-workspace so this is already scoped correctly
          setIsKicked(true);
        }
      } else {
        console.warn(`[WorkspaceSync] syncKicked - no userIdentity.publicKeyBase62 available`);
      }
    };
    
    // Track online users via awareness
    // Uses publicKey for deduplication to prevent duplicates when users reconnect
    // Also tracks which document each collaborator has open for tab presence
    const syncOnlineFromAwareness = () => {
      if (cleanedUp) return; // Prevent state updates after cleanup
      const states = provider.awareness.getStates();
      let online = 0;
      const myClientId = provider.awareness.clientID;
      const myPublicKey = userIdentityRef.current?.publicKeyBase62; // Get our own publicKey for self-exclusion
      const now = Date.now();
      
      // Track which publicKeys are currently online
      const onlinePublicKeys = new Set();
      // Track collaborators by document for tab presence indicators
      const docCollaborators = {}; // documentId -> [{ name, color, icon, publicKey }]
      
      states.forEach((state, clientId) => {
        if (clientId === myClientId) return;
        if (state?.user?.name) {
          const publicKey = state.user.publicKey;
          
          // CRITICAL: Skip if this is our own user (same publicKey, different tab/session)
          // This prevents the current user from appearing in their own presence indicators
          if (myPublicKey && publicKey && publicKey === myPublicKey) {
            return;
          }
          
          // Use publicKey for deduplication when available, fall back to clientId
          // This ensures clients whose identity hasn't loaded yet still show presence
          const deduplicationKey = publicKey || `client-${clientId}`;
          
          // Skip if we've already processed this identity (same user, different connection)
          if (onlinePublicKeys.has(deduplicationKey)) return;
          onlinePublicKeys.add(deduplicationKey);
          
          // Increment AFTER dedup check so multiple connections don't inflate count
          online++;
          
          // Track which documents this user has open (for tab presence)
          // Support both legacy single openDocumentId and new openDocumentIds array
          const openDocIds = state.openDocumentIds || state.user?.openDocumentIds || [];
          const focusedDocId = state.openDocumentId || state.user?.openDocumentId;
          // Check if the user has focused state (working on a specific document)
          const isFocused = state.isFocused || state.user?.isFocused || false;
          
          // Add user to ALL documents they have open
          const allOpenDocs = openDocIds.length > 0 ? openDocIds : (focusedDocId ? [focusedDocId] : []);
          for (const docId of allOpenDocs) {
            if (!docCollaborators[docId]) {
              docCollaborators[docId] = [];
            }
            docCollaborators[docId].push({
              name: state.user.name,
              color: state.user.color || '#888888',
              icon: state.user.icon || '👤',
              publicKey,
              isFocused: isFocused && docId === focusedDocId, // Only focused if this is the active doc
            });
          }
          
          // Update the members map (keyed by publicKey for proper deduplication)
          // Only update members map if publicKey is available (identity has loaded)
          if (!publicKey) {
            // Client identity hasn't loaded yet - skip member tracking but still show presence pips
          } else {
          const existingMember = yMembers.get(publicKey);
          
          if (!existingMember) {
            // RACE CONDITION FIX: Only create new member entries from awareness
            // AFTER sync has completed. Before sync, yMembers is empty so every
            // peer looks "new" and would be written with permission:'viewer'.
            // Presence pips still work via the awareness array regardless.
            if (!provider.synced) {
              console.log(`[WorkspaceSync] Skipping member creation for ${publicKey.substring(0, 10)}... (awaiting sync)`);
            } else {
            // New member - add to members map
            yMembers.set(publicKey, {
              publicKey,
              displayName: state.user.name,
              handle: state.user.name,
              color: state.user.color || '#888888',
              icon: state.user.icon || '👤',
              permission: 'viewer', // Default, will be upgraded if they have higher
              lastSeen: now,
              joinedAt: now,
              isOnline: true,
            });
            }
          } else if (now - (existingMember.lastSeen || 0) > 2 * AWARENESS_HEARTBEAT_MS) {
            // Update existing member if more than 2 heartbeats since last update
            yMembers.set(publicKey, {
              ...existingMember,
              displayName: state.user.name || existingMember.displayName,
              handle: state.user.name || existingMember.handle,
              color: state.user.color || existingMember.color,
              icon: state.user.icon || existingMember.icon,
              lastSeen: now,
              isOnline: true,
            });
          }
          } // end if (publicKey) for member tracking
        }
      });
      
      setOnlineCount(online);
      setCollaboratorsByDocument(docCollaborators);
      
      // Debug: Log collaborator presence data
      if (Object.keys(docCollaborators).length > 0) {
        console.log('[WorkspaceSync] Presence indicators:', docCollaborators);
      }
    };
    
    // Subscribe to changes
    yDocuments.observe(syncDocuments);
    yFolders.observe(syncFolders);
    yInfo.observe(syncInfo);
    yDocFolders.observe(syncDocFolders);
    yTrashedDocs.observe(syncTrashedDocs);
    yCollaborators.observe(syncCollaborators);
    yMembers.observe(syncMembers);
    // Also re-derive collaborators when members change (collaborators are now sourced from yMembers)
    yMembers.observe(syncCollaborators);
    yKicked.observe(syncKicked);
    provider.awareness.on('change', syncOnlineFromAwareness);
    
    // Initial sync
    syncCollaborators();
    syncMembers();
    syncKicked();
    syncOnlineFromAwareness();
    
    // Connection status
    const handleStatusChange = ({ status }) => {
      if (cleanedUp) return; // Prevent state updates after cleanup
      setConnected(status === 'connected');
    };
    provider.on('status', handleStatusChange);
    
    // Cleanup on workspace change
    return () => {
      cleanedUp = true;
      // Close key registration socket if still open
      if (keySocket && (keySocket.readyState === WebSocket.OPEN || keySocket.readyState === WebSocket.CONNECTING)) {
        keySocket.close();
      }
      // Remove status handler
      provider.off('status', handleStatusChange);
      yDocuments.unobserve(syncDocuments);
      yFolders.unobserve(syncFolders);
      yInfo.unobserve(syncInfo);
      yDocFolders.unobserve(syncDocFolders);
      yTrashedDocs.unobserve(syncTrashedDocs);
      yCollaborators.unobserve(syncCollaborators);
      yMembers.unobserve(syncMembers);
      yMembers.unobserve(syncCollaborators); // collaborators also derived from members
      yKicked.unobserve(syncKicked);
      provider.awareness.off('change', syncOnlineFromAwareness);
      // Clear heartbeat interval if it exists
      if (provider._heartbeatInterval) {
        clearInterval(provider._heartbeatInterval);
      }
      provider.destroy();
      ydoc.destroy();
      ydocRef.current = null;
      providerRef.current = null;
      yDocumentsRef.current = null;
      yFoldersRef.current = null;
      yCollaboratorsRef.current = null;
      yMembersRef.current = null;
      yKickedRef.current = null;
      yDocFoldersRef.current = null;
      yTrashedDocsRef.current = null;
      yInfoRef.current = null;
      yInventorySystemsRef.current = null;
      yCatalogItemsRef.current = null;
      yInventoryRequestsRef.current = null;
      yProducerCapacitiesRef.current = null;
      yAddressRevealsRef.current = null;
      yPendingAddressesRef.current = null;
      yInventoryAuditLogRef.current = null;
      yInventoryNotificationsRef.current = null;
      yFileStorageSystemsRef.current = null;
      yStorageFilesRef.current = null;
      yStorageFoldersRef.current = null;
      yChunkAvailabilityRef.current = null;
      yFileAuditLogRef.current = null;
    };
  }, [workspaceId, serverUrl]);
  
  // Update awareness when userProfile or userIdentity changes
  // This is CRITICAL: The initial awareness setup may happen before userIdentity is loaded
  // So we need to update publicKey as soon as it becomes available
  // providerReady ensures this effect runs after the provider is created
  useEffect(() => {
    const provider = providerRef.current;
    if (!provider?.awareness) return;
    
    // Get current state to preserve existing fields
    const currentState = provider.awareness.getLocalState()?.user || {};
    
    // Update even if only providerReady changed - we need to ensure publicKey is set
    // This handles the case where userIdentity was already loaded before provider was created
    const newPublicKey = userIdentity?.publicKeyBase62 || null;
    
    const updatedUser = {
      name: userProfile?.name || currentState.name || 'Anonymous',
      color: userProfile?.color || currentState.color || '#6366f1',
      icon: userProfile?.icon || currentState.icon || '👤',
      publicKey: newPublicKey || currentState.publicKey || null,
      lastActive: Date.now(),
    };
    
    // Debug: Log when we're updating awareness with publicKey
    if (newPublicKey && !currentState.publicKey) {
      console.log('[WorkspaceSync] Setting awareness publicKey (was missing):', newPublicKey.slice(0, 12) + '...');
    }
    
    provider.awareness.setLocalStateField('user', updatedUser);
  }, [providerReady, userProfile?.name, userProfile?.color, userProfile?.icon, userIdentity?.publicKeyBase62]);
  
  // Re-register self in members when userIdentity or userProfile loads after initial sync.
  // This fixes the race where identity loads after the 'synced' event has already fired,
  // leaving the user unregistered in workspace members.
  useEffect(() => {
    if (!synced || !userIdentity?.publicKeyBase62 || !userProfile) return;
    const yMembers = yMembersRef.current;
    if (!yMembers) return;
    
    const myPublicKey = userIdentity.publicKeyBase62;
    const existingMember = yMembers.get(myPublicKey);
    const now = Date.now();
    
    const effectivePermission = myPermission ||
      (yInfoRef.current?.get('createdBy') === myPublicKey ? 'owner' : null) ||
      existingMember?.permission ||
      'viewer';
    
    if (!existingMember) {
      console.log(`[WorkspaceSync] Late self-registration (identity loaded after sync)`);
      yMembers.set(myPublicKey, {
        publicKey: myPublicKey,
        displayName: userProfile.name || 'Anonymous',
        handle: userProfile.name || '',
        color: userProfile.color || '#6366f1',
        icon: userProfile.icon || '👤',
        permission: effectivePermission,
        permissionUpdatedAt: now,
        joinedAt: now,
        lastSeen: now,
        isOnline: true,
      });
    } else {
      // Update profile fields in case they changed
      const permChanged = effectivePermission !== existingMember.permission;
      yMembers.set(myPublicKey, {
        ...existingMember,
        displayName: userProfile.name || existingMember.displayName,
        color: userProfile.color || existingMember.color,
        icon: userProfile.icon || existingMember.icon,
        permission: effectivePermission,
        permissionUpdatedAt: permChanged ? now : (existingMember.permissionUpdatedAt || now),
        lastSeen: now,
        isOnline: true,
      });
    }
  }, [synced, userIdentity?.publicKeyBase62, userProfile?.name, userProfile?.color, userProfile?.icon, myPermission]);
  
  // Set the currently open document IDs in awareness (for tab presence indicators)
  // Supports both single ID (legacy) and array of IDs (all open documents)
  // The focusedDocId is the actively viewed document
  const setOpenDocumentId = useCallback((focusedDocId, isFocused = true, allOpenDocIds = null) => {
    const provider = providerRef.current;
    if (!provider?.awareness) {
      console.log('[WorkspaceSync] setOpenDocumentId: no provider/awareness yet');
      return;
    }
    
    // If allOpenDocIds is provided, use it; otherwise just use the focused ID
    const openDocIds = allOpenDocIds || (focusedDocId ? [focusedDocId] : []);
    
    console.log('[WorkspaceSync] setOpenDocumentId - focused:', focusedDocId, 'all open:', openDocIds.length, 'ids:', openDocIds);
    
    // Set both the focused document ID (for backwards compatibility) and all open IDs
    provider.awareness.setLocalStateField('openDocumentId', focusedDocId);
    provider.awareness.setLocalStateField('openDocumentIds', openDocIds);
    provider.awareness.setLocalStateField('isFocused', isFocused);
  }, []);
  
  // Get raw Yjs document count (for migration check - avoids React state lag)
  const getYjsDocumentCount = useCallback(() => {
    if (!yDocumentsRef.current) return 0;
    return yDocumentsRef.current.toArray().length;
  }, []);
  
  // Add a document to the workspace
  const addDocument = useCallback((doc) => {
    if (!yDocumentsRef.current) return;
    
    // Check if already exists
    const existing = yDocumentsRef.current.toArray().find(d => d.id === doc.id);
    if (existing) return;
    
    yDocumentsRef.current.push([doc]);
  }, []);
  
  // Remove a document from the workspace
  const removeDocument = useCallback((docId) => {
    if (!yDocumentsRef.current) return;
    
    const doRemove = () => {
      const docs = yDocumentsRef.current.toArray();
      const index = docs.findIndex(d => d.id === docId);
      if (index !== -1) {
        yDocumentsRef.current.delete(index, 1);
      }
    };
    if (ydocRef.current) {
      ydocRef.current.transact(doRemove);
    } else {
      doRemove();
    }
  }, []);
  
  // Update a document in the workspace
  const updateDocument = useCallback((docId, updates) => {
    if (!yDocumentsRef.current || !ydocRef.current) return;
    
    // Re-find index inside transaction to avoid race conditions
    ydocRef.current.transact(() => {
      const currentDocs = yDocumentsRef.current.toArray();
      const currentIndex = currentDocs.findIndex(d => d.id === docId);
      if (currentIndex !== -1) {
        // Yjs arrays don't have direct update - remove and re-add
        const doc = { ...currentDocs[currentIndex], ...updates };
        yDocumentsRef.current.delete(currentIndex, 1);
        yDocumentsRef.current.insert(currentIndex, [doc]);
      }
    });
  }, []);
  
  // Add an inventory system to the workspace
  const addInventorySystem = useCallback((inventorySystem) => {
    if (!yInventorySystemsRef.current) return;
    
    // Check if already exists (Map is keyed by ID)
    if (yInventorySystemsRef.current.has(inventorySystem.id)) return;
    
    yInventorySystemsRef.current.set(inventorySystem.id, inventorySystem);
  }, []);
  
  // Remove an inventory system
  const removeInventorySystem = useCallback((inventorySystemId) => {
    if (!yInventorySystemsRef.current) return;
    yInventorySystemsRef.current.delete(inventorySystemId);
  }, []);
  
  // Update an inventory system (e.g. rename)
  const updateInventorySystem = useCallback((inventorySystemId, updates) => {
    if (!yInventorySystemsRef.current) return;
    const existing = yInventorySystemsRef.current.get(inventorySystemId);
    if (existing) {
      yInventorySystemsRef.current.set(inventorySystemId, { ...existing, ...updates, updatedAt: Date.now() });
    }
  }, []);
  
  // --- File Storage CRUD operations ---
  // See docs/FILE_STORAGE_SPEC.md §15.2
  
  // Add a file storage system to the workspace
  const addFileStorageSystem = useCallback((fileStorageSystem) => {
    if (!yFileStorageSystemsRef.current) return;
    if (yFileStorageSystemsRef.current.has(fileStorageSystem.id)) return;
    yFileStorageSystemsRef.current.set(fileStorageSystem.id, fileStorageSystem);
  }, []);
  
  // Remove a file storage system
  const removeFileStorageSystem = useCallback((fileStorageSystemId) => {
    if (!yFileStorageSystemsRef.current) return;
    yFileStorageSystemsRef.current.delete(fileStorageSystemId);
  }, []);
  
  // Update a file storage system (e.g. rename)
  const updateFileStorageSystem = useCallback((fileStorageSystemId, updates) => {
    if (!yFileStorageSystemsRef.current) return;
    const existing = yFileStorageSystemsRef.current.get(fileStorageSystemId);
    if (existing) {
      yFileStorageSystemsRef.current.set(fileStorageSystemId, { ...existing, ...updates, updatedAt: Date.now() });
    }
  }, []);
  
  // Add a folder
  const addFolder = useCallback((folder) => {
    if (!yFoldersRef.current) return;
    
    if (yFoldersRef.current.has(folder.id)) return;
    
    yFoldersRef.current.set(folder.id, folder);
  }, []);
  
  // Remove a folder
  const removeFolder = useCallback((folderId) => {
    if (!yFoldersRef.current) return;
    
    yFoldersRef.current.delete(folderId);
  }, []);
  
  // Update a folder
  const updateFolder = useCallback((folderId, updates) => {
    if (!yFoldersRef.current) return;
    
    const existing = yFoldersRef.current.get(folderId);
    console.log('[WorkspaceSync] updateFolder:', { folderId, updates, found: !!existing });
    if (existing) {
      const folder = { ...existing, ...updates };
      console.log('[WorkspaceSync] updateFolder - merged folder:', folder);
      yFoldersRef.current.set(folderId, folder);
    }
  }, []);
  
  // Set document-folder mapping
  const setDocumentFolder = useCallback((docId, folderId) => {
    if (!yDocFoldersRef.current) return;
    if (folderId) {
      yDocFoldersRef.current.set(docId, folderId);
    } else {
      yDocFoldersRef.current.delete(docId);
    }
  }, []);
  
  // Move document to trash (soft delete)
  const trashDocument = useCallback((document, deletedBy = null) => {
    if (!yTrashedDocsRef.current) return;
    const trashedDoc = {
      ...document,
      deletedAt: Date.now(),
      deletedBy,
    };
    yTrashedDocsRef.current.push([trashedDoc]);
  }, []);
  
  // Restore document from trash
  const restoreDocument = useCallback((docId) => {
    if (!yTrashedDocsRef.current || !ydocRef.current) return null;
    
    let doc = null;
    ydocRef.current.transact(() => {
      const trashed = yTrashedDocsRef.current.toArray();
      const index = trashed.findIndex(d => d.id === docId);
      if (index === -1) return;
      
      doc = { ...trashed[index] };
      delete doc.deletedAt;
      delete doc.deletedBy;
      
      yTrashedDocsRef.current.delete(index, 1);
    });
    return doc;
  }, []);
  
  // Permanently delete document from trash
  const permanentlyDeleteDocument = useCallback((docId) => {
    if (!yTrashedDocsRef.current || !ydocRef.current) return;
    
    ydocRef.current.transact(() => {
      const trashed = yTrashedDocsRef.current.toArray();
      const index = trashed.findIndex(d => d.id === docId);
      if (index !== -1) {
        yTrashedDocsRef.current.delete(index, 1);
      }
    });
  }, []);
  
  // Update workspace info
  const updateWorkspaceInfo = useCallback((updates) => {
    if (!yInfoRef.current) return;
    
    Object.entries(updates).forEach(([key, value]) => {
      yInfoRef.current.set(key, value);
    });
  }, []);
  
  // Add or update a member in the workspace (keyed by publicKey)
  const addMember = useCallback((publicKey, memberData) => {
    if (!yMembersRef.current) return;
    
    const now = Date.now();
    const existing = yMembersRef.current.get(publicKey);
    
    if (existing) {
      // Update existing member
      yMembersRef.current.set(publicKey, {
        ...existing,
        ...memberData,
        lastSeen: now,
      });
    } else {
      // Add new member
      yMembersRef.current.set(publicKey, {
        publicKey,
        displayName: memberData.displayName || 'Anonymous',
        handle: memberData.handle || '',
        color: memberData.color || '#888888',
        icon: memberData.icon || '👤',
        permission: memberData.permission || 'viewer',
        joinedAt: now,
        lastSeen: now,
        ...memberData,
      });
    }
  }, []);
  
  // Kick a member from the workspace (owner only)
  // Simplified: just requires the target publicKey - caller is responsible for authorization
  const kickMember = useCallback((targetPublicKey, reason = '') => {
    if (!yKickedRef.current || !yMembersRef.current) {
      console.error('[WorkspaceSync] kickMember: refs not available');
      return false;
    }
    
    console.log(`[WorkspaceSync] Kicking member: ${targetPublicKey}`);
    
    // Add to kicked map
    yKickedRef.current.set(targetPublicKey, {
      kickedAt: Date.now(),
      kickedBy: userIdentity?.publicKeyBase62 || 'unknown',
      reason,
    });
    
    // Remove from members map
    if (yMembersRef.current.has(targetPublicKey)) {
      yMembersRef.current.delete(targetPublicKey);
      console.log(`[WorkspaceSync] Removed from members map`);
    }
    
    console.log(`[WorkspaceSync] Member kicked successfully`);
    return true;
  }, [userIdentity?.publicKeyBase62]);
  
  // Check if a publicKey is in the kicked list
  const checkIsKicked = useCallback((publicKey) => {
    if (!yKickedRef.current) return false;
    return yKickedRef.current.has(publicKey);
  }, []);
  
  // Get owner's public key from workspace info
  const getOwnerPublicKey = useCallback(() => {
    if (!yInfoRef.current) return null;
    return yInfoRef.current.get('createdBy');
  }, []);
  
  // Transfer ownership to another member
  const transferOwnership = useCallback((newOwnerPublicKey) => {
    if (!yInfoRef.current || !yMembersRef.current) return false;
    
    const doc = yInfoRef.current.doc || yMembersRef.current.doc;
    const doTransfer = () => {
      const now = Date.now();
      
      // Update workspace info with new owner
      yInfoRef.current.set('createdBy', newOwnerPublicKey);
      
      // Update the new owner's permission to 'owner'
      const newOwner = yMembersRef.current.get(newOwnerPublicKey);
      if (newOwner) {
        yMembersRef.current.set(newOwnerPublicKey, {
          ...newOwner,
          permission: 'owner',
          permissionUpdatedAt: now,
          pendingDemotion: null,
        });
      }
      
      // Demote the current owner to 'editor' so only one owner exists
      if (userIdentity?.publicKeyBase62) {
        const currentOwner = yMembersRef.current.get(userIdentity.publicKeyBase62);
        if (currentOwner) {
          yMembersRef.current.set(userIdentity.publicKeyBase62, {
            ...currentOwner,
            permission: 'editor',
            permissionUpdatedAt: now,
            pendingDemotion: null,
          });
        }
      }
    };
    
    if (doc) doc.transact(doTransfer);
    else doTransfer();
    
    console.log(`[WorkspaceSync] Transferred ownership to ${newOwnerPublicKey}`);
    return true;
  }, [userIdentity?.publicKeyBase62]);
  
  // Update a member's permission (owner only, supports multi-owner)
  // For founding owner demotion: sets pendingDemotion instead of writing directly
  const updateMemberPermission = useCallback((targetPublicKey, newPermission) => {
    if (!yMembersRef.current || !yInfoRef.current) return false;
    
    const validPermissions = ['owner', 'editor', 'viewer'];
    if (!validPermissions.includes(newPermission)) {
      console.error(`[WorkspaceSync] Invalid permission: ${newPermission}`);
      return false;
    }
    
    // Authorization: caller must be an owner
    if (myPermission !== 'owner') {
      console.error('[WorkspaceSync] updateMemberPermission: caller is not an owner');
      return false;
    }
    
    const targetMember = yMembersRef.current.get(targetPublicKey);
    if (!targetMember) {
      console.error(`[WorkspaceSync] updateMemberPermission: member not found: ${targetPublicKey}`);
      return false;
    }
    
    // If permission is the same, no-op
    if (targetMember.permission === newPermission) return true;
    
    const now = Date.now();
    const foundingOwner = yInfoRef.current.get('createdBy');
    const isSelf = targetPublicKey === userIdentity?.publicKeyBase62;
    
    // Founding owner protection: if demoting the founding owner (and it's not self-demotion),
    // set a pendingDemotion marker instead of writing directly
    const permHierarchy = { owner: 3, editor: 2, viewer: 1 };
    const isDemotion = (permHierarchy[newPermission] || 0) < (permHierarchy[targetMember.permission] || 0);
    
    if (targetPublicKey === foundingOwner && isDemotion && !isSelf) {
      // Get caller's display name for the pending demotion notification
      const callerMember = yMembersRef.current.get(userIdentity?.publicKeyBase62);
      const callerName = callerMember?.displayName || callerMember?.handle || 'An owner';
      
      yMembersRef.current.set(targetPublicKey, {
        ...targetMember,
        lastSeen: now,
        pendingDemotion: {
          requestedBy: userIdentity?.publicKeyBase62,
          requestedByName: callerName,
          requestedPermission: newPermission,
          requestedAt: now,
        },
      });
      console.log(`[WorkspaceSync] Pending demotion request for founding owner ${targetPublicKey} → ${newPermission}`);
      return 'pending';
    }
    
    // Direct permission update for all other cases
    yMembersRef.current.set(targetPublicKey, {
      ...targetMember,
      permission: newPermission,
      permissionUpdatedAt: now,
      pendingDemotion: null,
      lastSeen: now,
    });
    
    console.log(`[WorkspaceSync] Updated permission: ${targetPublicKey} → ${newPermission}`);
    return true;
  }, [myPermission, userIdentity?.publicKeyBase62]);
  
  // Respond to a pending demotion request (founding owner only)
  const respondToPendingDemotion = useCallback((accept) => {
    if (!yMembersRef.current || !userIdentity?.publicKeyBase62) return false;
    
    const myKey = userIdentity.publicKeyBase62;
    const myMember = yMembersRef.current.get(myKey);
    if (!myMember?.pendingDemotion) return false;
    
    const now = Date.now();
    
    if (accept) {
      // Accept: apply the demotion
      const newPermission = myMember.pendingDemotion.requestedPermission;
      yMembersRef.current.set(myKey, {
        ...myMember,
        permission: newPermission,
        permissionUpdatedAt: now,
        pendingDemotion: null,
        lastSeen: now,
      });
      console.log(`[WorkspaceSync] Founding owner accepted demotion → ${newPermission}`);
    } else {
      // Decline: clear the pending demotion
      yMembersRef.current.set(myKey, {
        ...myMember,
        pendingDemotion: null,
        lastSeen: now,
      });
      console.log(`[WorkspaceSync] Founding owner declined demotion`);
    }
    
    return true;
  }, [userIdentity?.publicKeyBase62]);

  // Expose ydoc and provider for workspace-level features (e.g., chat)
  const getYdoc = useCallback(() => ydocRef.current, []);
  const getProvider = useCallback(() => providerRef.current, []);
  
  return {
    documents,
    folders,
    workspaceInfo,
    connected,
    synced,
    // Sync progress for UI feedback
    syncPhase,
    syncProgress,
    // Document-folder mapping and trash (for FolderContext compatibility)
    documentFolders,
    trashedDocuments,
    // Workspace-level collaborator tracking (legacy)
    collaborators,
    onlineCount,
    totalCount,
    // Tab presence: which collaborators have which documents open
    collaboratorsByDocument,
    // Membership tracking (keyed by publicKey)
    members,
    kicked,
    isKicked,
    // Workspace ydoc and provider for chat/awareness
    ydoc: ydocRef.current,
    provider: providerRef.current,
    getYdoc,
    getProvider,
    getYjsDocumentCount,
    // Set current document for tab presence
    setOpenDocumentId,
    // Document/folder operations
    addDocument,
    removeDocument,
    updateDocument,
    addFolder,
    removeFolder,
    updateFolder,
    updateWorkspaceInfo,
    // Document-folder and trash operations
    setDocumentFolder,
    trashDocument,
    restoreDocument,
    permanentlyDeleteDocument,
    // Membership operations
    addMember,
    kickMember,
    checkIsKicked,
    getOwnerPublicKey,
    transferOwnership,
    updateMemberPermission,
    respondToPendingDemotion,
    // Inventory Yjs shared types (refs for direct access by InventoryDashboard)
    yInventorySystems: yInventorySystemsRef.current,
    yCatalogItems: yCatalogItemsRef.current,
    yInventoryRequests: yInventoryRequestsRef.current,
    yProducerCapacities: yProducerCapacitiesRef.current,
    yAddressReveals: yAddressRevealsRef.current,
    yPendingAddresses: yPendingAddressesRef.current,
    yInventoryAuditLog: yInventoryAuditLogRef.current,
    yInventoryNotifications: yInventoryNotificationsRef.current,
    // Inventory operations
    addInventorySystem,
    removeInventorySystem,
    updateInventorySystem,
    // File Storage Yjs shared types (refs for direct access by FileStorageDashboard)
    yFileStorageSystems: yFileStorageSystemsRef.current,
    yStorageFiles: yStorageFilesRef.current,
    yStorageFolders: yStorageFoldersRef.current,
    yChunkAvailability: yChunkAvailabilityRef.current,
    yFileAuditLog: yFileAuditLogRef.current,
    // File Storage operations
    addFileStorageSystem,
    removeFileStorageSystem,
    updateFileStorageSystem,
  };
}

export default useWorkspaceSync;
