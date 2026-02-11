/**
 * Workspace Context
 * 
 * Manages workspace state, switching, and synchronization.
 * 
 * Reference: docs/WORKSPACE_PERMISSIONS_SPEC.md
 * 
 * Key features:
 * - Multiple workspaces per user
 * - Workspace switching via dropdown
 * - Sync workspace metadata via WebSocket to sidecar
 * - Local storage of accessible workspaces
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createNewEntity, generateTopicHash } from '../utils/sharing';
import { deriveWorkspaceKey, storeKeyChain, getStoredKeyChain } from '../utils/keyDerivation';
import { secureError, secureLog } from '../utils/secureLogger';
import { isElectron as checkIsElectron } from '../hooks/useEnvironment';
import { useIdentity } from './IdentityContext';
import identityManager from '../utils/identityManager';
import { META_WS_PORT } from '../config/constants';

/**
 * Get identity-scoped storage key for web mode
 * Ensures workspaces are isolated between different identities
 */
function getIdentityScopedStorageKey(baseKey) {
  const activeId = identityManager.getActiveIdentityId();
  if (activeId) {
    return `${baseKey}_${activeId}`;
  }
  // Fallback to unscoped key (legacy or no identity yet)
  return baseKey;
}

/**
 * Helper: Convert bytes to base64url string for localStorage persistence
 */
function keyToBase64(bytes) {
  if (!bytes || !(bytes instanceof Uint8Array)) return null;
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Helper: Convert base64url string back to Uint8Array
 */
function base64ToKey(str) {
  if (!str || typeof str !== 'string') return null;
  try {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch (e) {
    secureError('[WorkspaceContext] Failed to parse key:', e);
    return null;
  }
}

/**
 * Restore keychain for a workspace from its stored encryptionKey
 * Returns updated workspace object if key was generated (for persistence)
 */
async function restoreKeyChain(workspace) {
  // Skip if already in keychain store
  if (getStoredKeyChain(workspace.id)) return null;
  
  let workspaceKey = null;
  let needsPersistence = false;
  
  // Try to get key from stored encryptionKey (for passwordless workspaces)
  if (workspace.encryptionKey) {
    workspaceKey = base64ToKey(workspace.encryptionKey);
  }
  
  // Fall back to deriving from password (for password-protected workspaces)
  if (!workspaceKey && workspace.password) {
    try {
      workspaceKey = await deriveWorkspaceKey(workspace.password, workspace.id);
    } catch (e) {
      secureError('[WorkspaceContext] Failed to derive key for workspace:', workspace.id, e);
    }
  }
  
  // For legacy passwordless workspaces without stored key, generate a new one
  // This ensures share links can be created
  if (!workspaceKey && !workspace.password) {
    secureLog('[WorkspaceContext] Generating key for legacy passwordless workspace:', workspace.id);
    workspaceKey = crypto.getRandomValues(new Uint8Array(32));
    needsPersistence = true;
  }
  
  if (workspaceKey) {
    storeKeyChain(workspace.id, {
      workspaceKey,
      workspaceId: workspace.id,
      password: workspace.password || null,
      folderKeys: {},
    });
  }
  
  // Return updated workspace if key was generated (caller should persist)
  if (needsPersistence) {
    return {
      ...workspace,
      encryptionKey: keyToBase64(workspaceKey),
    };
  }
  return null;
}

// Default state
const WorkspaceContext = createContext(null);

/**
 * Hook to access workspace context
 */
export function useWorkspaces() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspaces must be used within a WorkspaceProvider');
  }
  return context;
}

/**
 * Workspace Provider Component
 */
export function WorkspaceProvider({ children }) {
  // Get user identity from context
  const { identity, publicIdentity } = useIdentity();
  
  // All accessible workspaces (local cache)
  const [workspaces, setWorkspaces] = useState([]);
  
  // Currently selected workspace ID
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState(null);
  
  // Loading state
  const [loading, setLoading] = useState(true);
  
  // WebSocket connection to sidecar
  const metaSocket = useRef(null);
  
  // Message queue for messages sent before socket is ready
  const messageQueue = useRef([]);
  
  // Connection status
  const [connected, setConnected] = useState(false);
  
  // Check if running in Electron
  const isElectron = checkIsElectron();

  // Get current workspace object
  const currentWorkspace = workspaces.find(w => w.id === currentWorkspaceId) || null;

  // Use ref to always have latest message handler
  const handleSidecarMessageRef = useRef(null);
  
  // AbortController for canceling pending async operations when switching workspaces
  const abortControllerRef = useRef(null);
  
  // Persist workspaces to localStorage in web mode (identity-scoped)
  useEffect(() => {
    if (!isElectron && workspaces.length > 0) {
      const storageKey = getIdentityScopedStorageKey('nahma-workspaces');
      localStorage.setItem(storageKey, JSON.stringify(workspaces));
    }
  }, [workspaces, isElectron]);
  
  // Persist current workspace selection (identity-scoped)
  useEffect(() => {
    if (!isElectron && currentWorkspaceId) {
      const storageKey = getIdentityScopedStorageKey('nahma-current-workspace');
      localStorage.setItem(storageKey, currentWorkspaceId);
    }
  }, [currentWorkspaceId, isElectron]);

  // Handle messages from sidecar
  const handleSidecarMessage = useCallback((data) => {
    secureLog('[WorkspaceContext] Received message:', data.type);
    switch (data.type) {
      case 'workspace-list':
        secureLog('[WorkspaceContext] Loaded workspaces:', data.workspaces?.length);
        setWorkspaces(data.workspaces || []);
        setLoading(false);
        
        // Auto-select first workspace, or clear if current is not in list
        if (data.workspaces?.length > 0) {
          setCurrentWorkspaceId(prev => {
            // Check if current workspace is in the new list
            const currentInList = prev && data.workspaces.some(w => w.id === prev);
            if (currentInList) {
              return prev; // Keep current selection
            }
            // Otherwise select the first workspace
            return data.workspaces[0].id;
          });
        } else {
          // No workspaces - clear selection
          setCurrentWorkspaceId(null);
        }
        
        // Restore keychains for all loaded workspaces (async)
        // This is critical for share link generation to work
        const restoreAllKeychains = async () => {
          // Cancel any previous keychain restoration
          if (abortControllerRef.current) {
            abortControllerRef.current.abort();
          }
          abortControllerRef.current = new AbortController();
          const signal = abortControllerRef.current.signal;
          
          const failedWorkspaces = [];
          for (const workspace of (data.workspaces || [])) {
            // Check if operation was cancelled (workspace switch)
            if (signal.aborted) {
              secureLog('[WorkspaceContext] Keychain restoration cancelled due to workspace switch');
              return;
            }
            try {
              const updated = await restoreKeyChain(workspace);
              if (updated) {
                // Key was generated for legacy workspace, persist to sidecar
                secureLog('[WorkspaceContext] Persisting generated key for workspace:', workspace.id);
                sendMessage({
                  type: 'update-workspace',
                  workspace: updated,
                });
              }
            } catch (e) {
              secureError('[WorkspaceContext] Failed to restore keychain for:', workspace.id, e);
              failedWorkspaces.push({ id: workspace.id, name: workspace.name, error: e.message });
            }
          }
          
          // Report failures to user and allow retry
          if (failedWorkspaces.length > 0) {
            secureError('[WorkspaceContext] Failed to restore keychains for workspaces:', failedWorkspaces);
            // Broadcast keychain restoration failures for UI notification
            // Store failed workspaces for potential retry
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('keychain-restore-failed', {
                detail: { failedWorkspaces, retry: () => restoreAllKeychains() }
              }));
            }
          }
        };
        restoreAllKeychains();
        break;
        
      case 'workspace-created':
        // Only add if not already present (avoid duplicates from optimistic update)
        setWorkspaces(prev => {
          if (prev.some(w => w.id === data.workspace.id)) {
            return prev;
          }
          return [...prev, data.workspace];
        });
        // Auto-switch to new workspace
        setCurrentWorkspaceId(data.workspace.id);
        break;
        
      case 'workspace-updated':
        setWorkspaces(prev => prev.map(w => 
          w.id === data.workspace.id ? { ...w, ...data.workspace } : w
        ));
        break;
        
      case 'workspace-deleted':
        setWorkspaces(prev => prev.filter(w => w.id !== data.workspaceId));
        break;
        
      case 'workspace-joined':
        // When joining via share link - update or add the workspace
        setWorkspaces(prev => {
          const existingIndex = prev.findIndex(w => w.id === data.workspace.id);
          if (existingIndex >= 0) {
            // Update existing workspace with new data (serverUrl, permission, etc.)
            const updated = [...prev];
            updated[existingIndex] = { ...prev[existingIndex], ...data.workspace };
            return updated;
          }
          return [...prev, data.workspace];
        });
        setCurrentWorkspaceId(data.workspace.id);
        break;
    }
  }, []);

  // Keep ref updated with latest handler
  handleSidecarMessageRef.current = handleSidecarMessage;

  // Helper to send a message, queuing if socket not ready
  const sendMessage = useCallback((message) => {
    const msgString = JSON.stringify(message);
    if (metaSocket.current?.readyState === WebSocket.OPEN) {
      secureLog('[WorkspaceContext] Sending message:', message.type);
      metaSocket.current.send(msgString);
    } else {
      secureLog('[WorkspaceContext] Queuing message (socket not ready):', message.type);
      messageQueue.current.push(msgString);
    }
  }, []);

  // Process queued messages when connected
  const flushMessageQueue = useCallback(() => {
    if (messageQueue.current.length > 0 && metaSocket.current?.readyState === WebSocket.OPEN) {
      secureLog('[WorkspaceContext] Flushing', messageQueue.current.length, 'queued messages');
      messageQueue.current.forEach(msg => {
        metaSocket.current.send(msg);
      });
      messageQueue.current = [];
    }
  }, []);

  // Initialize: Connect to sidecar (Electron) or use localStorage (web)
  useEffect(() => {
    // Check if we're in Electron (has electronAPI) or web mode
    const isElectronMode = checkIsElectron();
    
    if (!isElectronMode) {
      // Web mode: use localStorage for persistence (identity-scoped)
      secureLog('[WorkspaceContext] Running in web mode (localStorage)');
      
      // Check if identity is available for scoped storage
      const activeIdentityId = identityManager.getActiveIdentityId();
      if (!activeIdentityId && identityManager.listIdentities().length > 0) {
        // Have identities but none active - wait for identity selection
        secureLog('[WorkspaceContext] Waiting for identity selection before loading workspaces');
        setLoading(false);
        return;
      }
      
      try {
        // Use identity-scoped storage key
        const storageKey = getIdentityScopedStorageKey('nahma-workspaces');
        const stored = localStorage.getItem(storageKey);
        const storedWorkspaces = stored ? JSON.parse(stored) : [];
        setWorkspaces(storedWorkspaces);
        
        // Restore keychains for all loaded workspaces (async)
        // Also handles legacy workspaces by generating keys
        const restoreAllKeychains = async () => {
          const updatedWorkspaces = [];
          let anyUpdated = false;
          
          for (const workspace of storedWorkspaces) {
            try {
              const updated = await restoreKeyChain(workspace);
              if (updated) {
                // Key was generated for legacy workspace, update state
                updatedWorkspaces.push(updated);
                anyUpdated = true;
              } else {
                updatedWorkspaces.push(workspace);
              }
            } catch (e) {
              secureError('[WorkspaceContext] Failed to restore keychain for:', workspace.id, e);
              updatedWorkspaces.push(workspace);
            }
          }
          
          // Persist updated workspaces if any legacy keys were generated (identity-scoped)
          if (anyUpdated) {
            secureLog('[WorkspaceContext] Persisting updated workspaces with generated keys');
            setWorkspaces(updatedWorkspaces);
            const storageKey = getIdentityScopedStorageKey('nahma-workspaces');
            localStorage.setItem(storageKey, JSON.stringify(updatedWorkspaces));
          }
        };
        
        restoreAllKeychains();
        
        if (storedWorkspaces.length > 0) {
          // Restore last selected workspace (identity-scoped)
          const currentWsKey = getIdentityScopedStorageKey('nahma-current-workspace');
          const lastWorkspaceId = localStorage.getItem(currentWsKey);
          setCurrentWorkspaceId(lastWorkspaceId || storedWorkspaces[0].id);
        }
      } catch (e) {
        secureError('[WorkspaceContext] Failed to load from localStorage:', e);
      }
      
      setLoading(false);
      setConnected(true); // Mark as "connected" even in web mode
      return;
    }
    
    // Electron mode: connect to sidecar with retry logic
    let retryCount = 0;
    const maxRetries = 10;
    const baseDelay = 500; // Start with 500ms delay
    let sidecarUnavailable = false; // Track if sidecar appears to be completely unavailable
    
    const connectToSidecar = () => {
      // If sidecar has been determined unavailable, fall back to web mode
      if (sidecarUnavailable) {
        secureLog('[WorkspaceContext] Sidecar unavailable, falling back to web mode');
        // Load from localStorage as fallback (identity-scoped)
        try {
          const storageKey = getIdentityScopedStorageKey('nahma-workspaces');
          const stored = localStorage.getItem(storageKey);
          const storedWorkspaces = stored ? JSON.parse(stored) : [];
          setWorkspaces(storedWorkspaces);
          if (storedWorkspaces.length > 0) {
            const currentWsKey = getIdentityScopedStorageKey('nahma-current-workspace');
            const lastWorkspaceId = localStorage.getItem(currentWsKey);
            setCurrentWorkspaceId(lastWorkspaceId || storedWorkspaces[0].id);
          }
        } catch (e) {
          secureError('[WorkspaceContext] Failed to load fallback:', e);
        }
        setLoading(false);
        setConnected(true); // Mark as "connected" in offline mode
        return;
      }
      
      try {
        const ws = new WebSocket(`ws://localhost:${META_WS_PORT}`);
        
        ws.onopen = () => {
          secureLog('[WorkspaceContext] Connected to sidecar');
          retryCount = 0; // Reset retry count on successful connection
          metaSocket.current = ws; // Set this FIRST before flushing
          setConnected(true);
          
          // Flush any queued messages now that socket is ready
          if (messageQueue.current.length > 0) {
            secureLog('[WorkspaceContext] Flushing', messageQueue.current.length, 'queued messages');
            messageQueue.current.forEach(msg => {
              ws.send(msg);
            });
            messageQueue.current = [];
          }
          
          // Request workspace list
          ws.send(JSON.stringify({ type: 'list-workspaces' }));
        };
        
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            // Use ref to get latest handler
            handleSidecarMessageRef.current?.(data);
          } catch (e) {
            secureError('[WorkspaceContext] Failed to parse message:', e);
          }
        };
        
        ws.onclose = () => {
          secureLog('[WorkspaceContext] Disconnected from sidecar');
          setConnected(false);
          
          // Only attempt reconnection if sidecar was previously working
          if (!sidecarUnavailable) {
            setTimeout(connectToSidecar, 3000);
          }
        };
        
        ws.onerror = (error) => {
          // Only log error if we've exhausted initial retries (sidecar should be ready by then)
          if (retryCount >= 3) {
            secureError('[WorkspaceContext] WebSocket error:', error);
          }
          // Retry with exponential backoff + jitter during startup
          if (retryCount < maxRetries) {
            retryCount++;
            const baseBackoff = Math.min(baseDelay * Math.pow(1.5, retryCount), 5000);
            // Add randomized jitter (0-50% of base delay) to prevent thundering herd
            const jitter = baseBackoff * Math.random() * 0.5;
            const delay = baseBackoff + jitter;
            secureLog(`[WorkspaceContext] Sidecar not ready, retrying in ${Math.round(delay)}ms (attempt ${retryCount}/${maxRetries})`);
            setTimeout(connectToSidecar, delay);
          } else {
            // Max retries reached - sidecar is unavailable
            secureError('[WorkspaceContext] Sidecar unavailable after max retries, falling back to web mode');
            sidecarUnavailable = true;
            connectToSidecar(); // This will now trigger fallback
          }
        };
        
        // Note: metaSocket.current is set in onopen to ensure it's ready
      } catch (error) {
        secureError('[WorkspaceContext] Failed to connect:', error);
        setLoading(false);
      }
    };
    
    // Give sidecar time to start before first connection attempt
    setTimeout(connectToSidecar, 500);
    
    return () => {
      if (metaSocket.current) {
        metaSocket.current.close();
      }
    };
  }, []);

  // Listen for identity creation to reinitialize P2P
  // This ensures P2P is ready after user completes onboarding
  useEffect(() => {
    const handleIdentityCreated = async () => {
      secureLog('[WorkspaceContext] Identity created/switched, reinitializing P2P...');
      
      // CRITICAL: Clear current workspace state BEFORE requesting new list
      // This ensures we don't show old workspace data from a different identity
      secureLog('[WorkspaceContext] Clearing workspace state for new identity');
      setWorkspaces([]);
      setCurrentWorkspaceId(null);
      setLoading(true);
      
      if (metaSocket.current?.readyState === WebSocket.OPEN) {
        // Reinitialize P2P with new identity
        metaSocket.current.send(JSON.stringify({ type: 'reinitialize-p2p' }));
        
        // CRITICAL: Reload workspace list to filter by new identity's public key
        // The sidecar uses identity.loadIdentity().publicKeyBase62 to filter workspaces
        metaSocket.current.send(JSON.stringify({ type: 'list-workspaces' }));
        secureLog('[WorkspaceContext] Requested workspace list refresh after identity switch');
      }
    };
    
    window.addEventListener('identity-created', handleIdentityCreated);
    return () => {
      window.removeEventListener('identity-created', handleIdentityCreated);
    };
  }, []);

  /**
   * Create a new workspace
   * @param {Object} options - Workspace options
   * @param {string} options.name - Workspace name
   * @param {string} options.password - Password for encryption
   * @param {string} [options.color] - Accent color
   * @param {string} [options.icon] - Emoji icon
   * @returns {Promise<Object>} Created workspace
   */
  const createWorkspace = useCallback(async (options) => {
    const { name, password, color, icon } = options;
    
    if (!name?.trim()) {
      throw new Error('Workspace name is required');
    }
    
    // Password is optional
    
    // Create entity with share link (async to ensure correct topic hash)
    const { entityId, shareLink, topic } = await createNewEntity('workspace', {
      password: password || null,
      permission: 'owner',
    });
    
    // Always generate a workspace key:
    // - If password provided: derive from password
    // - If no password: generate random 32-byte key
    let workspaceKey;
    if (password) {
      workspaceKey = await deriveWorkspaceKey(password, entityId);
    } else {
      // Generate random 256-bit key for passwordless workspaces
      workspaceKey = crypto.getRandomValues(new Uint8Array(32));
    }
    
    // Store key chain locally
    storeKeyChain(entityId, {
      workspaceKey,
      workspaceId: entityId,
      password: password || null, // Store password for re-derivation if provided
      folderKeys: {},
    });
    
    // Get user identity for owner info
    // Use publicIdentity from IdentityContext (via useIdentity hook) - single source of truth
    const userIdentity = publicIdentity ? {
      publicKey: publicIdentity.publicKeyBase62,
      handle: publicIdentity.handle || 'You',
    } : {
      publicKey: 'local-user',
      handle: 'You',
    };
    
    // Build workspace object
    const workspace = {
      id: entityId,
      name: name.trim(),
      createdAt: Date.now(),
      createdBy: userIdentity.publicKey,
      owners: [userIdentity.publicKey],
      color: color || '#6366f1',
      icon: icon || '📁',
      // Local metadata
      myPermission: 'owner',
      accessScope: 'workspace',
      accessScopeId: entityId,
      password: password || null, // Optional
      encrypted: !!password, // Track if workspace is encrypted
      // Store encryption key for passwordless workspaces (needed to restore after refresh)
      encryptionKey: !password ? keyToBase64(workspaceKey) : null,
      topic,
      // Hyperswarm topic hash for P2P discovery (same as topic, explicit field for sidecar)
      topicHash: topic,
    };
    
    // Send to sidecar (will queue if socket not ready)
    secureLog('[WorkspaceContext] Creating workspace:', workspace.id, workspace.name);
    sendMessage({ type: 'create-workspace', workspace });
    
    // Optimistically add to local state
    setWorkspaces(prev => [...prev, workspace]);
    setCurrentWorkspaceId(entityId);
    
    return workspace;
  }, [sendMessage]);

  /**
   * Update a workspace
   * @param {string} workspaceId - Workspace ID
   * @param {Object} updates - Updates to apply
   */
  const updateWorkspace = useCallback(async (workspaceId, updates) => {
    // Find the current workspace and create full merged object
    // This ensures fields like joinedBy are preserved in the backend
    const currentWorkspace = workspaces.find(w => w.id === workspaceId);
    if (currentWorkspace) {
      // Send full workspace object to backend for proper merge
      const fullWorkspace = { ...currentWorkspace, ...updates };
      sendMessage({ type: 'update-workspace', workspace: fullWorkspace });
    } else {
      // Fallback: send partial updates if workspace not found locally
      sendMessage({ type: 'update-workspace', workspaceId, updates });
    }
    
    // Optimistic update
    setWorkspaces(prev => prev.map(w => 
      w.id === workspaceId ? { ...w, ...updates } : w
    ));
  }, [sendMessage, workspaces]);

  /**
   * Delete a workspace (owner OR only member)
   * @param {string} workspaceId - Workspace ID
   */
  const deleteWorkspace = useCallback(async (workspaceId) => {
    const workspace = workspaces.find(w => w.id === workspaceId);
    if (!workspace) {
      throw new Error('Workspace not found');
    }
    
    // Allow deletion if owner OR if you're the only member
    const isOwner = workspace.myPermission === 'owner';
    const memberCount = workspace.members?.length || workspace.collaborators?.length || 1;
    const isOnlyMember = memberCount <= 1;
    
    if (!isOwner && !isOnlyMember) {
      throw new Error('Only owners or the last remaining member can delete a workspace');
    }
    
    sendMessage({ type: 'delete-workspace', workspaceId });
    
    // Optimistic removal
    setWorkspaces(prev => prev.filter(w => w.id !== workspaceId));
    
    if (currentWorkspaceId === workspaceId) {
      const remaining = workspaces.filter(w => w.id !== workspaceId);
      setCurrentWorkspaceId(remaining.length > 0 ? remaining[0].id : null);
    }
  }, [sendMessage, currentWorkspaceId, workspaces]);

  /**
   * Leave a workspace (for editors/viewers - removes local copy only)
   * @param {string} workspaceId - Workspace ID
   */
  const leaveWorkspace = useCallback(async (workspaceId) => {
    const workspace = workspaces.find(w => w.id === workspaceId);
    if (!workspace) {
      throw new Error('Workspace not found');
    }
    
    // Owners should delete, not leave
    if (workspace.myPermission === 'owner') {
      throw new Error('Owners should delete the workspace instead of leaving');
    }
    
    // Tell sidecar to remove local workspace data (same as delete but for non-owners)
    sendMessage({ type: 'leave-workspace', workspaceId });
    
    // Optimistic removal from local state
    setWorkspaces(prev => prev.filter(w => w.id !== workspaceId));
    
    // Switch to another workspace if this was the current one
    if (currentWorkspaceId === workspaceId) {
      const remaining = workspaces.filter(w => w.id !== workspaceId);
      setCurrentWorkspaceId(remaining.length > 0 ? remaining[0].id : null);
    }
  }, [sendMessage, currentWorkspaceId, workspaces]);

  /**
   * Switch to a different workspace
   * @param {string} workspaceId - Workspace ID to switch to
   */
  const switchWorkspace = useCallback((workspaceId) => {
    const workspace = workspaces.find(w => w.id === workspaceId);
    if (!workspace) {
      secureLog('[WorkspaceContext] Workspace not found:', workspaceId);
      return;
    }
    
    setCurrentWorkspaceId(workspaceId);
    
    // Update last accessed
    setWorkspaces(prev => prev.map(w => 
      w.id === workspaceId ? { ...w, lastAccessedAt: Date.now() } : w
    ));
  }, [workspaces]);

  /**
   * Join a workspace via share link
   * @param {Object} shareData - Parsed share link data
   * @param {string} shareData.entityId - Workspace ID
   * @param {string} [shareData.password] - Password (if password-based link)
   * @param {Uint8Array} [shareData.encryptionKey] - Direct encryption key (if key-embedded link)
   * @param {string} shareData.permission - Permission level
   * @returns {Promise<Object>} Joined workspace
   */
  const joinWorkspace = useCallback(async (shareData) => {
    const { entityId, password, encryptionKey, permission, serverUrl, bootstrapPeers, topicHash, directAddress } = shareData;
    
    // DEBUG: Log join attempt details
    secureLog(`[WorkspaceContext] ========== JOIN WORKSPACE ==========`);
    secureLog(`[WorkspaceContext] entityId: ${entityId}`);
    secureLog(`[WorkspaceContext] hasPassword: ${!!password}`);
    secureLog(`[WorkspaceContext] hasEncryptionKey: ${!!encryptionKey}`);
    secureLog(`[WorkspaceContext] permission: ${permission}`);
    secureLog(`[WorkspaceContext] serverUrl: ${serverUrl || '(local)'}`);
    secureLog(`[WorkspaceContext] bootstrapPeers: ${bootstrapPeers?.length || 0} peers`);
    secureLog(`[WorkspaceContext] topicHash: ${topicHash || '(will derive)'}`);
    secureLog(`[WorkspaceContext] directAddress: ${directAddress || '(none)'}`);
    secureLog(`[WorkspaceContext] isElectron: ${checkIsElectron()}`);
    secureLog(`[WorkspaceContext] ====================================`);
    
    // Check if already have access
    const existing = workspaces.find(w => w.id === entityId);
    if (existing) {
      // Build updates object for any changed/new properties
      const updates = {};
      
      // Update permission if higher
      const permHierarchy = { owner: 3, editor: 2, viewer: 1 };
      if (permHierarchy[permission] > permHierarchy[existing.myPermission]) {
        updates.myPermission = permission;
      }
      
      // Update serverUrl if provided and different (for cross-platform sharing)
      if (serverUrl && serverUrl !== existing.serverUrl) {
        updates.serverUrl = serverUrl;
        secureLog(`[WorkspaceContext] Updating serverUrl: ${serverUrl}`);
      }
      
      // Update topicHash if provided
      if (topicHash && topicHash !== existing.topicHash) {
        updates.topicHash = topicHash;
      }
      
      // Update bootstrapPeers if provided
      if (bootstrapPeers && bootstrapPeers.length > 0) {
        updates.bootstrapPeers = bootstrapPeers;
      }
      
      // Update encryption key if provided and not already set
      if (encryptionKey && !existing.encryptionKey) {
        updates.encryptionKey = keyToBase64(encryptionKey);
        // Also store in keychain
        storeKeyChain(entityId, {
          workspaceKey: encryptionKey,
          workspaceId: entityId,
          password: null,
          folderKeys: {},
        });
      }
      
      // Apply updates if any
      if (Object.keys(updates).length > 0) {
        await updateWorkspace(entityId, updates);
      }
      
      switchWorkspace(entityId);
      // Return the updated workspace (merge existing with updates)
      return { ...existing, ...updates };
    }
    
    // Determine workspace key from password or embedded key
    let workspaceKey;
    let topic;
    
    // Use provided topicHash if available (from share link)
    // Otherwise derive from password or use entityId
    if (topicHash) {
      topic = topicHash;
    }
    
    if (encryptionKey) {
      // Use directly provided encryption key (from key-embedded link)
      workspaceKey = encryptionKey;
      // For key-embedded links, derive topic from entityId (matches sidecar formula)
      if (!topic) topic = await generateTopicHash(entityId);
      
      // Store key chain
      storeKeyChain(entityId, {
        workspaceKey,
        workspaceId: entityId,
        password: null,
        folderKeys: {},
      });
    } else if (password) {
      // Derive workspace key from password
      workspaceKey = await deriveWorkspaceKey(password, entityId);
      // Topic is NOT derived from password - use the standard workspace topic
      // This matches sidecar/mesh-constants.js getWorkspaceTopic()
      if (!topic) topic = await generateTopicHash(entityId);
      
      // Store key chain
      storeKeyChain(entityId, {
        workspaceKey,
        workspaceId: entityId,
        password,
        folderKeys: {},
      });
    } else {
      // No password or key - derive topic from entityId (matches sidecar formula)
      if (!topic) topic = await generateTopicHash(entityId);
    }
    
    // Get user identity (prefer context, fallback to IPC)
    const userIdentity = publicIdentity || window.electronAPI?.identity?.getPublic?.() || {
      publicKey: 'local-user',
      handle: 'You',
    };
    
    // Create local workspace entry
    const workspace = {
      id: entityId,
      name: 'Shared Workspace', // Will be updated on sync
      createdAt: Date.now(),
      createdBy: 'unknown',
      owners: [],
      myPermission: permission,
      accessScope: 'workspace',
      accessScopeId: entityId,
      password,
      // Store encryption key for persistence (if key-embedded link)
      encryptionKey: encryptionKey && !password ? keyToBase64(encryptionKey) : null,
      topic,
      // Hyperswarm topic hash for DHT discovery
      topicHash: topic,
      // Remote sync server URL for cross-platform workspaces
      // If set, Electron will connect to this server instead of local sidecar
      serverUrl: serverUrl || null,
      // Bootstrap peers for P2P connection via Hyperswarm
      bootstrapPeers: bootstrapPeers || null,
      // Direct P2P address for connecting without DHT
      directAddress: directAddress || null,
    };
    
    // Notify sidecar (will queue if socket not ready)
    // Send full workspace object so sidecar can persist it
    sendMessage({
      type: 'join-workspace',
      workspace,
      password,
      permission,
      userPublicKey: userIdentity.publicKey,
      // If we have bootstrap peers, tell sidecar to connect via Hyperswarm
      bootstrapPeers: bootstrapPeers || null,
      // Direct P2P address for connecting without DHT
      directAddress: directAddress || null,
    });
    
    // Add to local state
    secureLog(`[WorkspaceContext] Adding workspace to state:`, workspace.id);
    setWorkspaces(prev => [...prev, workspace]);
    setCurrentWorkspaceId(entityId);
    secureLog(`[WorkspaceContext] Workspace joined successfully, currentWorkspaceId set to: ${entityId}`);
    
    return workspace;
  }, [sendMessage, workspaces, updateWorkspace, switchWorkspace]);

  /**
   * Get workspace by ID
   * @param {string} workspaceId - Workspace ID
   * @returns {Object|null} Workspace or null
   */
  const getWorkspace = useCallback((workspaceId) => {
    return workspaces.find(w => w.id === workspaceId) || null;
  }, [workspaces]);

  /**
   * Check if user has at least a certain permission level
   * @param {string} workspaceId - Workspace ID
   * @param {string} requiredPermission - Required permission level
   * @returns {boolean}
   */
  const hasPermission = useCallback((workspaceId, requiredPermission) => {
    const workspace = workspaces.find(w => w.id === workspaceId);
    if (!workspace) return false;
    
    const hierarchy = { owner: 3, editor: 2, viewer: 1 };
    return hierarchy[workspace.myPermission] >= hierarchy[requiredPermission];
  }, [workspaces]);

  /**
   * Get P2P info (our Hyperswarm public key, connected peers, and direct address)
   * Used for generating share links with embedded peer info
   * @returns {Promise<{initialized: boolean, ownPublicKey: string|null, connectedPeers: string[], directAddress: Object|null}>}
   */
  const getP2PInfo = useCallback(() => {
    return new Promise((resolve) => {
      if (!metaSocket.current || metaSocket.current.readyState !== WebSocket.OPEN) {
        resolve({ initialized: false, ownPublicKey: null, connectedPeers: [], directAddress: null });
        return;
      }
      
      // Set up one-time listener for response
      const handleMessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'p2p-info') {
            metaSocket.current.removeEventListener('message', handleMessage);
            resolve({
              initialized: data.initialized || false,
              ownPublicKey: data.ownPublicKey || null,
              connectedPeers: data.connectedPeers || [],
              directAddress: data.directAddress || null,
              publicIP: data.publicIP || null,
              wsPort: data.wsPort || null,
              wssPort: data.wssPort || null,
              directWsUrl: data.directWsUrl || null,
              directWssUrl: data.directWssUrl || null,
              upnpEnabled: data.upnpEnabled || false,
              upnpStatus: data.upnpStatus || null,
            });
          }
        } catch (e) {
          // Ignore parse errors
        }
      };
      
      metaSocket.current.addEventListener('message', handleMessage);
      metaSocket.current.send(JSON.stringify({ type: 'get-p2p-info' }));
      
      // Timeout after 2 seconds
      setTimeout(() => {
        metaSocket.current?.removeEventListener('message', handleMessage);
        resolve({ 
          initialized: false, 
          ownPublicKey: null, 
          connectedPeers: [], 
          directAddress: null,
          publicIP: null,
          wsPort: null,
          wssPort: null,
          directWsUrl: null,
          directWssUrl: null,
          upnpEnabled: false,
          upnpStatus: null
        });
      }, 2000);
    });
  }, []);

  // Context value - memoize to avoid unnecessary re-renders
  // Note: metaSocket.current updates when connected changes, so including connected ensures fresh socket
  const value = useMemo(() => ({
    // State
    workspaces,
    currentWorkspaceId,
    currentWorkspace,
    loading,
    connected,
    
    // Socket (for sharing with other contexts)
    // This is captured fresh when 'connected' changes
    metaSocket: metaSocket.current,
    
    // Actions
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,
    leaveWorkspace,
    switchWorkspace,
    joinWorkspace,
    getWorkspace,
    hasPermission,
    setCurrentWorkspaceId,
    getP2PInfo,
    
    // Helpers
    hasWorkspaces: workspaces.length > 0,
    isOwner: currentWorkspace?.myPermission === 'owner',
    canEdit: currentWorkspace?.myPermission === 'owner' || currentWorkspace?.myPermission === 'editor',
  }), [workspaces, currentWorkspaceId, currentWorkspace, loading, connected, 
       createWorkspace, updateWorkspace, deleteWorkspace, leaveWorkspace, switchWorkspace, 
       joinWorkspace, getWorkspace, hasPermission, getP2PInfo]);

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export default WorkspaceContext;
