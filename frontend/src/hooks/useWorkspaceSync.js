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
import { META_WS_PORT, WS_RECONNECT_MAX_DELAY, TIMEOUT_LONG } from '../config/constants';

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
  // Workspace-level collaborator tracking
  const [collaborators, setCollaborators] = useState([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  
  // Membership tracking (keyed by publicKey for deduplication)
  const [members, setMembers] = useState({});
  const [kicked, setKicked] = useState({});
  const [isKicked, setIsKicked] = useState(false);
  
  const ydocRef = useRef(null);
  const providerRef = useRef(null);
  const yDocumentsRef = useRef(null);
  const yFoldersRef = useRef(null);
  const yInfoRef = useRef(null);
  const yCollaboratorsRef = useRef(null);
  const yMembersRef = useRef(null);
  const yKickedRef = useRef(null);
  
  // Initialize Yjs sync when workspace changes
  useEffect(() => {
    // Always reset kicked state when workspace changes
    setIsKicked(false);
    
    if (!workspaceId) {
      setDocuments([]);
      setFolders([]);
      setWorkspaceInfo(null);
      setConnected(false);
      setCollaborators([]);
      setOnlineCount(0);
      setTotalCount(0);
      setMembers({});
      setKicked({});
      return;
    }
    
    const roomName = `workspace-meta:${workspaceId}`;
    // Pass serverUrl to getWsUrl for cross-platform workspaces
    const wsUrl = getWsUrl(serverUrl);
    let cleanedUp = false;
    let keySocket = null;
    
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
      
      // Track failures for remote workspaces
      if (event.status === 'connecting' && connectionFailures > 0 && isRemote) {
        connectionFailures++;
        if (connectionFailures >= maxFailures) {
          console.warn(`[WorkspaceSync] Remote server unreachable after ${maxFailures} attempts, stopping reconnection`);
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
      }, TIMEOUT_LONG); // Update every 30 seconds
      
      // Store interval ID for cleanup
      provider._heartbeatInterval = heartbeatInterval;
    }
    
    // Get shared types for documents, folders, and workspace info
    const yDocuments = ydoc.getArray('documents');
    const yFolders = ydoc.getArray('folders');
    const yInfo = ydoc.getMap('workspaceInfo');
    const yCollaborators = ydoc.getArray('workspaceCollaborators');
    
    // Membership maps (keyed by publicKey for deduplication and proper identity)
    const yMembers = ydoc.getMap('members');
    const yKicked = ydoc.getMap('kicked');
    
    // Add current user to members map if they have an identity
    if (userIdentity?.publicKeyBase62 && userProfile) {
      const myPublicKey = userIdentity.publicKeyBase62;
      const existingMember = yMembers.get(myPublicKey);
      const now = Date.now();
      
      // Determine permission - use passed permission, workspace creation, or existing value
      const effectivePermission = myPermission || 
                                  (initialWorkspaceInfo?.createdBy === myPublicKey ? 'owner' : null) ||
                                  existingMember?.permission || 
                                  'viewer';
      
      if (!existingMember) {
        yMembers.set(myPublicKey, {
          publicKey: myPublicKey,
          displayName: userProfile.name || 'Anonymous',
          handle: userProfile.name || '',
          color: userProfile.color || '#6366f1',
          icon: userProfile.icon || '👤',
          permission: effectivePermission,
          joinedAt: now,
          lastSeen: now,
          isOnline: true,
        });
      } else {
        // Update existing member - upgrade permission if new is higher
        const permHierarchy = { owner: 3, editor: 2, viewer: 1 };
        const newPerm = (permHierarchy[effectivePermission] || 0) > (permHierarchy[existingMember.permission] || 0)
          ? effectivePermission
          : existingMember.permission;
        
        yMembers.set(myPublicKey, {
          ...existingMember,
          displayName: userProfile.name || existingMember.displayName,
          color: userProfile.color || existingMember.color,
          icon: userProfile.icon || existingMember.icon,
          permission: newPerm,
          lastSeen: now,
          isOnline: true,
        });
      }
    }
    
    ydocRef.current = ydoc;
    providerRef.current = provider;
    yDocumentsRef.current = yDocuments;
    yFoldersRef.current = yFolders;
    yInfoRef.current = yInfo;
    yCollaboratorsRef.current = yCollaborators;
    yMembersRef.current = yMembers;
    yKickedRef.current = yKicked;
    
    // Sync documents from Yjs to React state
    const syncDocuments = () => {
      if (cleanedUp) return; // Prevent state updates after cleanup
      const docs = yDocuments.toArray();
      console.log(`[WorkspaceSync] syncDocuments called, count: ${docs.length}`);
      setDocuments(docs);
    };
    
    // Sync folders from Yjs to React state
    const syncFolders = () => {
      if (cleanedUp) return; // Prevent state updates after cleanup
      const flds = yFolders.toArray();
      console.log(`[WorkspaceSync] syncFolders called, count: ${flds.length}`);
      setFolders(flds);
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
      // Only update if we have a name (indicates data exists)
      if (info.name) {
        setWorkspaceInfo(info);
      }
    };
    
    // Initial sync
    syncDocuments();
    syncFolders();
    syncInfo();
    
    // If we have initial info (owner creating workspace), set it ONLY after sync
    // and ONLY if the remote doesn't already have data
    let hasSetInitialInfo = false;
    const trySetInitialInfo = () => {
      if (hasSetInitialInfo || !initialWorkspaceInfo) return;
      // Only set if remote is empty (no name set)
      if (!yInfo.get('name')) {
        hasSetInitialInfo = true;
        yInfo.set('name', initialWorkspaceInfo.name);
        yInfo.set('icon', initialWorkspaceInfo.icon || '📁');
        yInfo.set('color', initialWorkspaceInfo.color || '#6366f1');
        yInfo.set('createdBy', initialWorkspaceInfo.createdBy || 'unknown');
        yInfo.set('createdAt', initialWorkspaceInfo.createdAt || Date.now());
      }
    };
    
    // Wait for initial sync before setting info (to check if remote has data)
    provider.on('synced', () => {
      console.log(`[WorkspaceSync] synced event - resyncing all data to React state`);
      // Re-sync all data to React state after provider sync
      syncDocuments();
      syncFolders();
      syncInfo();
      trySetInitialInfo();
    });
    
    // Also try immediately in case we're already synced
    if (provider.synced) {
      trySetInitialInfo();
    }
    
    // Sync workspace-level collaborators from Yjs
    const syncCollaborators = () => {
      if (cleanedUp) return; // Prevent state updates after cleanup
      const collabs = yCollaborators.toArray();
      setCollaborators(collabs);
      setTotalCount(collabs.length);
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
      if (userIdentity?.publicKeyBase62) {
        const myKey = userIdentity.publicKeyBase62;
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
          // Only set kicked if we're still connected to this workspace
          // This prevents loops when switching workspaces
          if (provider.awareness.getLocalState()?.workspaceId === workspaceId) {
            setIsKicked(true);
          }
        }
      } else {
        console.warn(`[WorkspaceSync] syncKicked - no userIdentity.publicKeyBase62 available`);
      }
    };
    
    // Track online users via awareness
    // Uses publicKey for deduplication to prevent duplicates when users reconnect
    const syncOnlineFromAwareness = () => {
      if (cleanedUp) return; // Prevent state updates after cleanup
      const states = provider.awareness.getStates();
      let online = 0;
      const myClientId = provider.awareness.clientID;
      const now = Date.now();
      
      // Track which publicKeys are currently online
      const onlinePublicKeys = new Set();
      
      states.forEach((state, clientId) => {
        if (clientId === myClientId) return;
        if (state?.user?.name) {
          online++;
          
          // Use publicKey for stable identity, fall back to clientId for legacy clients
          const publicKey = state.user.publicKey || `legacy-${clientId}`;
          
          // Skip if we've already processed this publicKey (same user, different connection)
          if (onlinePublicKeys.has(publicKey)) return;
          onlinePublicKeys.add(publicKey);
          
          // Update the members map (keyed by publicKey for proper deduplication)
          const existingMember = yMembers.get(publicKey);
          
          if (!existingMember) {
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
          } else if (now - (existingMember.lastSeen || 0) > TIMEOUT_LONG) {
            // Update existing member if more than 30s since last update
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
        }
      });
      
      setOnlineCount(online);
    };
    
    // Subscribe to changes
    yDocuments.observe(syncDocuments);
    yFolders.observe(syncFolders);
    yInfo.observe(syncInfo);
    yCollaborators.observe(syncCollaborators);
    yMembers.observe(syncMembers);
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
      if (keySocket && keySocket.readyState === WebSocket.OPEN) {
        keySocket.close();
      }
      // Remove status handler
      provider.off('status', handleStatusChange);
      yDocuments.unobserve(syncDocuments);
      yFolders.unobserve(syncFolders);
      yInfo.unobserve(syncInfo);
      yCollaborators.unobserve(syncCollaborators);
      yMembers.unobserve(syncMembers);
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
    };
  }, [workspaceId, serverUrl, userIdentity?.publicKeyBase62]);
  
  // Update awareness when userProfile changes
  useEffect(() => {
    const provider = providerRef.current;
    if (!provider?.awareness || !userProfile) return;
    
    provider.awareness.setLocalStateField('user', {
      name: userProfile.name || 'Anonymous',
      color: userProfile.color || '#6366f1',
      icon: userProfile.icon || '👤',
      lastActive: Date.now(),
    });
  }, [userProfile?.name, userProfile?.color, userProfile?.icon]);
  
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
    
    const docs = yDocumentsRef.current.toArray();
    const index = docs.findIndex(d => d.id === docId);
    if (index !== -1) {
      yDocumentsRef.current.delete(index, 1);
    }
  }, []);
  
  // Update a document in the workspace
  const updateDocument = useCallback((docId, updates) => {
    if (!yDocumentsRef.current || !ydocRef.current) return;
    
    const docs = yDocumentsRef.current.toArray();
    const index = docs.findIndex(d => d.id === docId);
    if (index !== -1) {
      // Yjs arrays don't have direct update - remove and re-add
      const doc = { ...docs[index], ...updates };
      ydocRef.current.transact(() => {
        yDocumentsRef.current.delete(index, 1);
        yDocumentsRef.current.insert(index, [doc]);
      });
    }
  }, []);
  
  // Add a folder
  const addFolder = useCallback((folder) => {
    if (!yFoldersRef.current) return;
    
    const existing = yFoldersRef.current.toArray().find(f => f.id === folder.id);
    if (existing) return;
    
    yFoldersRef.current.push([folder]);
  }, []);
  
  // Remove a folder
  const removeFolder = useCallback((folderId) => {
    if (!yFoldersRef.current) return;
    
    const folders = yFoldersRef.current.toArray();
    const index = folders.findIndex(f => f.id === folderId);
    if (index !== -1) {
      yFoldersRef.current.delete(index, 1);
    }
  }, []);
  
  // Update a folder
  const updateFolder = useCallback((folderId, updates) => {
    if (!yFoldersRef.current || !ydocRef.current) return;
    
    const folders = yFoldersRef.current.toArray();
    const index = folders.findIndex(f => f.id === folderId);
    if (index !== -1) {
      const folder = { ...folders[index], ...updates };
      ydocRef.current.transact(() => {
        yFoldersRef.current.delete(index, 1);
        yFoldersRef.current.insert(index, [folder]);
      });
    }
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
    
    // Update workspace info with new owner
    yInfoRef.current.set('createdBy', newOwnerPublicKey);
    
    // Update the new owner's permission to 'owner'
    const newOwner = yMembersRef.current.get(newOwnerPublicKey);
    if (newOwner) {
      yMembersRef.current.set(newOwnerPublicKey, {
        ...newOwner,
        permission: 'owner',
      });
    }
    
    // Update the current owner's permission to 'editor' (they're leaving anyway, but good for consistency)
    if (userIdentity?.publicKeyBase62) {
      const currentOwner = yMembersRef.current.get(userIdentity.publicKeyBase62);
      if (currentOwner) {
        yMembersRef.current.set(userIdentity.publicKeyBase62, {
          ...currentOwner,
          permission: 'editor',
        });
      }
    }
    
    console.log(`[WorkspaceSync] Transferred ownership to ${newOwnerPublicKey}`);
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
    // Workspace-level collaborator tracking (legacy)
    collaborators,
    onlineCount,
    totalCount,
    // Membership tracking (keyed by publicKey)
    members,
    kicked,
    isKicked,
    // Workspace ydoc and provider for chat/awareness
    ydoc: ydocRef.current,
    provider: providerRef.current,
    getYdoc,
    getProvider,
    // Document/folder operations
    addDocument,
    removeDocument,
    updateDocument,
    addFolder,
    removeFolder,
    updateFolder,
    updateWorkspaceInfo,
    // Membership operations
    addMember,
    kickMember,
    checkIsKicked,
    getOwnerPublicKey,
    transferOwnership,
  };
}

export default useWorkspaceSync;
