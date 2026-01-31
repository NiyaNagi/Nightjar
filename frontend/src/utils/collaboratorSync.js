/**
 * Collaborator Sync System
 * 
 * Uses Yjs Y.Map for collaborator list per workspace.
 * Syncs collaborator information across all connected peers.
 * 
 * Reference: docs/WORKSPACE_PERMISSIONS_SPEC.md
 * 
 * Key features:
 * - CRDT-based collaborator list (no conflicts)
 * - Permission level tracking
 * - Scope tracking (workspace/folder/document)
 * - Automatic upgrade to higher permissions
 */

import * as Y from 'yjs';

// Permission hierarchy for comparison
const PERMISSION_LEVELS = {
  owner: 3,
  editor: 2,
  viewer: 1,
  none: 0,
};

/**
 * Collaborator entry structure in Y.Map
 * @typedef {Object} CollaboratorEntry
 * @property {string} publicKey - User's public key (identity)
 * @property {string} handle - Display name
 * @property {string} color - Avatar color
 * @property {string} icon - Avatar icon/emoji
 * @property {string} permission - 'owner' | 'editor' | 'viewer'
 * @property {string} scope - 'workspace' | 'folder' | 'document'
 * @property {string} scopeId - ID of the entity granting access
 * @property {string} grantedBy - Public key of granter
 * @property {number} grantedAt - Timestamp
 * @property {number} lastSeen - Last activity timestamp
 * @property {boolean} online - Currently connected
 */

/**
 * Create or get the collaborators Y.Map for a workspace
 * @param {Y.Doc} ydoc - Yjs document for the workspace
 * @returns {Y.Map} Collaborators map
 */
export function getCollaboratorsMap(ydoc) {
  return ydoc.getMap('collaborators');
}

/**
 * Add or update a collaborator in the workspace
 * Handles permission upgrades (highest wins)
 * 
 * @param {Y.Map} collaboratorsMap - The Y.Map of collaborators
 * @param {Object} collaborator - Collaborator data
 * @param {string} collaborator.publicKey - User's public key
 * @param {string} collaborator.handle - Display name
 * @param {string} collaborator.color - Avatar color
 * @param {string} collaborator.icon - Avatar icon
 * @param {string} collaborator.permission - Permission level
 * @param {string} collaborator.scope - Access scope
 * @param {string} collaborator.scopeId - Entity ID for scope
 * @param {string} [collaborator.grantedBy] - Who granted access
 */
export function addCollaborator(collaboratorsMap, collaborator) {
  const {
    publicKey,
    handle,
    color,
    icon,
    permission,
    scope,
    scopeId,
    grantedBy,
  } = collaborator;

  if (!publicKey) {
    throw new Error('Collaborator public key is required');
  }

  const existing = collaboratorsMap.get(publicKey);
  const now = Date.now();

  if (existing) {
    // Check if new permission is higher
    const existingLevel = PERMISSION_LEVELS[existing.permission] || 0;
    const newLevel = PERMISSION_LEVELS[permission] || 0;

    if (newLevel > existingLevel) {
      // Upgrade permission (highest wins)
      collaboratorsMap.set(publicKey, {
        ...existing,
        handle: handle || existing.handle,
        color: color || existing.color,
        icon: icon || existing.icon,
        permission,
        scope,
        scopeId,
        grantedBy: grantedBy || existing.grantedBy,
        grantedAt: now,
        lastSeen: now,
      });
      console.log(`[CollaboratorSync] Upgraded ${publicKey} to ${permission}`);
    } else {
      // Just update activity
      collaboratorsMap.set(publicKey, {
        ...existing,
        handle: handle || existing.handle,
        color: color || existing.color,
        icon: icon || existing.icon,
        lastSeen: now,
      });
    }
  } else {
    // New collaborator
    collaboratorsMap.set(publicKey, {
      publicKey,
      handle: handle || 'Anonymous',
      color: color || '#888888',
      icon: icon || '👤',
      permission: permission || 'viewer',
      scope: scope || 'workspace',
      scopeId: scopeId || '',
      grantedBy: grantedBy || publicKey, // Self if not specified
      grantedAt: now,
      lastSeen: now,
      online: true,
    });
    console.log(`[CollaboratorSync] Added collaborator ${publicKey} as ${permission}`);
  }
}

/**
 * Update collaborator online status
 * @param {Y.Map} collaboratorsMap - The Y.Map of collaborators
 * @param {string} publicKey - User's public key
 * @param {boolean} online - Online status
 */
export function updateOnlineStatus(collaboratorsMap, publicKey, online) {
  const existing = collaboratorsMap.get(publicKey);
  if (existing) {
    collaboratorsMap.set(publicKey, {
      ...existing,
      online,
      lastSeen: Date.now(),
    });
  }
}

/**
 * Get all collaborators as array
 * @param {Y.Map} collaboratorsMap - The Y.Map of collaborators
 * @returns {CollaboratorEntry[]} Array of collaborators
 */
export function getAllCollaborators(collaboratorsMap) {
  const collaborators = [];
  collaboratorsMap.forEach((value, key) => {
    collaborators.push({ ...value, publicKey: key });
  });
  return collaborators;
}

/**
 * Get collaborators filtered by permission level
 * @param {Y.Map} collaboratorsMap - The Y.Map of collaborators
 * @param {string} minPermission - Minimum permission level
 * @returns {CollaboratorEntry[]} Filtered collaborators
 */
export function getCollaboratorsByPermission(collaboratorsMap, minPermission) {
  const minLevel = PERMISSION_LEVELS[minPermission] || 0;
  const collaborators = [];
  
  collaboratorsMap.forEach((value, key) => {
    const level = PERMISSION_LEVELS[value.permission] || 0;
    if (level >= minLevel) {
      collaborators.push({ ...value, publicKey: key });
    }
  });
  
  return collaborators;
}

/**
 * Get online collaborators
 * @param {Y.Map} collaboratorsMap - The Y.Map of collaborators
 * @returns {CollaboratorEntry[]} Online collaborators
 */
export function getOnlineCollaborators(collaboratorsMap) {
  const collaborators = [];
  collaboratorsMap.forEach((value, key) => {
    if (value.online) {
      collaborators.push({ ...value, publicKey: key });
    }
  });
  return collaborators;
}

/**
 * Get collaborator's permission for an entity
 * Checks hierarchy: document -> folder -> workspace
 * 
 * @param {Y.Map} collaboratorsMap - The Y.Map of collaborators
 * @param {string} publicKey - User's public key
 * @param {string} entityType - 'workspace' | 'folder' | 'document'
 * @param {string} entityId - Entity ID
 * @param {Object} hierarchy - Hierarchy info { documentFolderId, folderWorkspaceId }
 * @returns {string|null} Permission level or null
 */
export function getCollaboratorPermission(collaboratorsMap, publicKey, entityType, entityId, hierarchy = {}) {
  const collaborator = collaboratorsMap.get(publicKey);
  if (!collaborator) return null;

  // Check if direct access to this entity
  if (collaborator.scopeId === entityId) {
    return collaborator.permission;
  }

  // Check inherited access
  const { documentFolderId, folderWorkspaceId } = hierarchy;

  if (entityType === 'document' && documentFolderId) {
    // Document inherits from folder
    if (collaborator.scopeId === documentFolderId) {
      return collaborator.permission;
    }
    // Or from workspace
    if (folderWorkspaceId && collaborator.scopeId === folderWorkspaceId) {
      return collaborator.permission;
    }
  }

  if (entityType === 'folder' && folderWorkspaceId) {
    // Folder inherits from workspace
    if (collaborator.scopeId === folderWorkspaceId) {
      return collaborator.permission;
    }
  }

  // Workspace-level access covers everything
  if (collaborator.scope === 'workspace') {
    return collaborator.permission;
  }

  return null;
}

/**
 * Promote a collaborator to owner (owner-only operation)
 * @param {Y.Map} collaboratorsMap - The Y.Map of collaborators
 * @param {string} publicKey - User's public key to promote
 * @param {string} promoterKey - Who is promoting (must be owner)
 * @returns {boolean} Success
 */
export function promoteToOwner(collaboratorsMap, publicKey, promoterKey) {
  const promoter = collaboratorsMap.get(promoterKey);
  if (!promoter || promoter.permission !== 'owner') {
    console.error('[CollaboratorSync] Only owners can promote to owner');
    return false;
  }

  const target = collaboratorsMap.get(publicKey);
  if (!target) {
    console.error('[CollaboratorSync] Target collaborator not found');
    return false;
  }

  if (target.permission === 'owner') {
    console.log('[CollaboratorSync] Target is already an owner');
    return true;
  }

  collaboratorsMap.set(publicKey, {
    ...target,
    permission: 'owner',
    grantedBy: promoterKey,
    grantedAt: Date.now(),
  });

  console.log(`[CollaboratorSync] ${publicKey} promoted to owner by ${promoterKey}`);
  return true;
}

/**
 * Listen for collaborator changes
 * @param {Y.Map} collaboratorsMap - The Y.Map of collaborators
 * @param {Function} callback - Called with updated collaborators array
 * @returns {Function} Cleanup function
 */
export function onCollaboratorsChange(collaboratorsMap, callback) {
  const handler = () => {
    callback(getAllCollaborators(collaboratorsMap));
  };

  collaboratorsMap.observe(handler);
  
  // Call immediately with current state
  handler();

  return () => {
    collaboratorsMap.unobserve(handler);
  };
}

/**
 * Sync local user as collaborator when joining
 * @param {Y.Map} collaboratorsMap - The Y.Map of collaborators
 * @param {Object} identity - Local user identity
 * @param {string} permission - Permission level from share link
 * @param {string} scope - Access scope
 * @param {string} scopeId - Entity ID
 */
export function syncLocalCollaborator(collaboratorsMap, identity, permission, scope, scopeId) {
  addCollaborator(collaboratorsMap, {
    publicKey: identity.publicKey || identity.publicKeyHex,
    handle: identity.handle || identity.name,
    color: identity.color,
    icon: identity.icon,
    permission,
    scope,
    scopeId,
  });
}

/**
 * Clean up stale collaborators (offline for > 7 days)
 * Does NOT remove them, just marks as offline
 * @param {Y.Map} collaboratorsMap - The Y.Map of collaborators
 */
export function cleanupStaleCollaborators(collaboratorsMap) {
  const staleThreshold = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days
  
  collaboratorsMap.forEach((value, key) => {
    if (value.online && value.lastSeen < staleThreshold) {
      collaboratorsMap.set(key, {
        ...value,
        online: false,
      });
    }
  });
}
