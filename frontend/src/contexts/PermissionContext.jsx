/**
 * Permission Context
 * 
 * Manages permission checking and enforcement across the application.
 * 
 * Reference: docs/WORKSPACE_PERMISSIONS_SPEC.md
 * 
 * Key features:
 * - Permission hierarchy: owner > editor > viewer
 * - Inherited permissions from workspace → folder → document
 * - Highest permission wins on upgrade
 * - Full transparency (all users see collaborator list)
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useWorkspaces } from './WorkspaceContext';

// Permission hierarchy for comparison
const PERMISSION_LEVELS = {
  owner: 3,
  editor: 2,
  viewer: 1,
  none: 0,
};

// Action requirements
const ACTION_REQUIREMENTS = {
  'view': 'viewer',
  'edit': 'editor',
  'create': 'editor',
  'delete': 'editor',
  'restore': 'editor',
  'share-owner': 'owner',
  'share-editor': 'editor',
  'share-viewer': 'viewer',
  'delete-workspace': 'owner',
  'promote-owner': 'owner',
};

const PermissionContext = createContext(null);

/**
 * Hook to access permission context
 */
export function usePermissions() {
  const context = useContext(PermissionContext);
  if (!context) {
    throw new Error('usePermissions must be used within a PermissionProvider');
  }
  return context;
}

/**
 * Permission Provider Component
 */
export function PermissionProvider({ children }) {
  // Get workspace context
  const { workspaces, currentWorkspaceId, currentWorkspace } = useWorkspaces();
  
  // Permission cache: entityId -> { permission, scope, scopeId }
  const [permissionCache, setPermissionCache] = useState(new Map());
  
  // Folder hierarchy cache: folderId -> { parentId, workspaceId }
  const [folderHierarchy, setFolderHierarchy] = useState(new Map());
  
  // Document-to-folder mapping: documentId -> folderId
  const [documentFolders, setDocumentFolders] = useState(new Map());

  /**
   * Update folder hierarchy cache
   * @param {Object[]} folders - Array of folder objects
   */
  const updateFolderHierarchy = useCallback((folders) => {
    const newHierarchy = new Map();
    for (const folder of folders) {
      newHierarchy.set(folder.id, {
        parentId: folder.parentId,
        workspaceId: folder.workspaceId,
      });
    }
    setFolderHierarchy(newHierarchy);
  }, []);

  /**
   * Update document-to-folder mapping
   * @param {Object[]} documents - Array of document objects
   */
  const updateDocumentFolders = useCallback((documents) => {
    const newMapping = new Map();
    for (const doc of documents) {
      newMapping.set(doc.id, doc.folderId);
    }
    setDocumentFolders(newMapping);
  }, []);

  /**
   * Get the higher of two permissions
   */
  const getHigherPermission = useCallback((a, b) => {
    return PERMISSION_LEVELS[a] >= PERMISSION_LEVELS[b] ? a : b;
  }, []);

  /**
   * Check if permission A is at least as high as permission B
   */
  const isAtLeast = useCallback((userPerm, requiredPerm) => {
    return PERMISSION_LEVELS[userPerm || 'none'] >= PERMISSION_LEVELS[requiredPerm];
  }, []);

  /**
   * Get workspace permission for a workspace ID
   * @param {string} workspaceId - Workspace ID
   * @returns {string} Permission level or 'none'
   */
  const getWorkspacePermission = useCallback((workspaceId) => {
    const workspace = workspaces.find(w => w.id === workspaceId);
    return workspace?.myPermission || 'none';
  }, [workspaces]);

  /**
   * Resolve permission for a folder by walking up the hierarchy
   * @param {string} folderId - Folder ID
   * @returns {Object} { permission, scope, scopeId }
   */
  const resolveFolderPermission = useCallback((folderId, _visited) => {
    // Check cache first
    if (permissionCache.has(`folder:${folderId}`)) {
      return permissionCache.get(`folder:${folderId}`);
    }
    
    // Get folder info
    const folderInfo = folderHierarchy.get(folderId);
    if (!folderInfo) {
      // Fallback to workspace permission
      const workspacePerm = getWorkspacePermission(currentWorkspaceId);
      return { permission: workspacePerm, scope: 'workspace', scopeId: currentWorkspaceId };
    }
    
    // Walk up hierarchy with cycle detection
    if (folderInfo.parentId) {
      const visited = _visited || new Set();
      if (visited.has(folderId)) {
        // Cycle detected - fall back to workspace permission
        const workspacePerm = getWorkspacePermission(folderInfo.workspaceId || currentWorkspaceId);
        return { permission: workspacePerm, scope: 'workspace', scopeId: folderInfo.workspaceId || currentWorkspaceId };
      }
      visited.add(folderId);
      const parentPerm = resolveFolderPermission(folderInfo.parentId, visited);
      return parentPerm;
    }
    
    // Root folder - use workspace permission
    const workspacePerm = getWorkspacePermission(folderInfo.workspaceId);
    return { permission: workspacePerm, scope: 'workspace', scopeId: folderInfo.workspaceId };
  }, [permissionCache, folderHierarchy, getWorkspacePermission, currentWorkspaceId]);

  /**
   * Resolve permission for a document
   * @param {string} documentId - Document ID
   * @returns {Object} { permission, scope, scopeId }
   */
  const resolveDocumentPermission = useCallback((documentId) => {
    // Check cache first
    if (permissionCache.has(`document:${documentId}`)) {
      return permissionCache.get(`document:${documentId}`);
    }
    
    // Get folder for this document
    const folderId = documentFolders.get(documentId);
    if (!folderId) {
      // Fallback to workspace permission
      const workspacePerm = getWorkspacePermission(currentWorkspaceId);
      return { permission: workspacePerm, scope: 'workspace', scopeId: currentWorkspaceId };
    }
    
    // Use folder permission
    return resolveFolderPermission(folderId);
  }, [permissionCache, documentFolders, resolveFolderPermission, getWorkspacePermission, currentWorkspaceId]);

  /**
   * Get permission for any entity type
   * @param {string} entityType - 'workspace' | 'folder' | 'document'
   * @param {string} entityId - Entity ID
   * @returns {string} Permission level
   */
  const getPermission = useCallback((entityType, entityId) => {
    switch (entityType) {
      case 'workspace':
        return getWorkspacePermission(entityId);
      case 'folder':
        return resolveFolderPermission(entityId).permission;
      case 'document':
        return resolveDocumentPermission(entityId).permission;
      default:
        return 'none';
    }
  }, [getWorkspacePermission, resolveFolderPermission, resolveDocumentPermission]);

  /**
   * Check if user can perform an action on an entity
   * @param {string} action - Action from ACTION_REQUIREMENTS
   * @param {string} entityType - 'workspace' | 'folder' | 'document'
   * @param {string} entityId - Entity ID
   * @returns {boolean}
   */
  const canPerformAction = useCallback((action, entityType, entityId) => {
    const required = ACTION_REQUIREMENTS[action];
    if (!required) {
      console.warn(`Unknown action: ${action}`);
      return false;
    }
    
    const userPerm = getPermission(entityType, entityId);
    return isAtLeast(userPerm, required);
  }, [getPermission, isAtLeast]);

  /**
   * Grant a permission (used when joining via share link)
   * @param {string} entityType - Entity type
   * @param {string} entityId - Entity ID
   * @param {string} permission - Permission level
   * @param {string} scope - Scope of the grant
   * @param {string} scopeId - Scope entity ID
   */
  const grantPermission = useCallback((entityType, entityId, permission, scope, scopeId) => {
    const key = `${entityType}:${entityId}`;
    
    setPermissionCache(prev => {
      const newCache = new Map(prev);
      const existing = newCache.get(key);
      
      if (existing) {
        // Upgrade if new permission is higher
        const higher = getHigherPermission(existing.permission, permission);
        newCache.set(key, { permission: higher, scope, scopeId });
      } else {
        newCache.set(key, { permission, scope, scopeId });
      }
      
      return newCache;
    });
  }, [getHigherPermission]);

  /**
   * Convenience hooks for common permission checks
   */
  const canView = useCallback((entityType, entityId) => 
    canPerformAction('view', entityType, entityId), [canPerformAction]);
    
  const canEdit = useCallback((entityType, entityId) => 
    canPerformAction('edit', entityType, entityId), [canPerformAction]);
    
  const canCreate = useCallback((entityType, entityId) => 
    canPerformAction('create', entityType, entityId), [canPerformAction]);
    
  const canDelete = useCallback((entityType, entityId) => 
    canPerformAction('delete', entityType, entityId), [canPerformAction]);
    
  const canShare = useCallback((entityType, entityId, shareLevel) => {
    const action = `share-${shareLevel}`;
    return canPerformAction(action, entityType, entityId);
  }, [canPerformAction]);

  /**
   * Get available share levels for current user
   * @param {string} entityType - Entity type
   * @param {string} entityId - Entity ID
   * @returns {string[]} Available share levels
   */
  const getAvailableShareLevels = useCallback((entityType, entityId) => {
    const userPerm = getPermission(entityType, entityId);
    const levels = [];
    
    if (isAtLeast(userPerm, 'owner')) {
      levels.push('owner', 'editor', 'viewer');
    } else if (isAtLeast(userPerm, 'editor')) {
      levels.push('editor', 'viewer');
    } else if (isAtLeast(userPerm, 'viewer')) {
      levels.push('viewer');
    }
    
    return levels;
  }, [getPermission, isAtLeast]);

  /**
   * Check if user is owner of current workspace
   */
  const isOwner = currentWorkspace?.myPermission === 'owner';
  
  /**
   * Check if user can edit in current workspace
   */
  const canEditWorkspace = isAtLeast(currentWorkspace?.myPermission, 'editor');

  // Context value - memoized to prevent unnecessary re-renders
  const value = useMemo(() => ({
    // Resolution
    getPermission,
    getWorkspacePermission,
    resolveFolderPermission,
    resolveDocumentPermission,
    
    // Action checks
    canPerformAction,
    canView,
    canEdit,
    canCreate,
    canDelete,
    canShare,
    
    // Share levels
    getAvailableShareLevels,
    
    // Granting
    grantPermission,
    
    // Hierarchy management
    updateFolderHierarchy,
    updateDocumentFolders,
    
    // Utilities
    isAtLeast,
    getHigherPermission,
    
    // Current workspace shortcuts
    isOwner,
    canEditWorkspace,
    
    // Constants
    PERMISSION_LEVELS,
    ACTION_REQUIREMENTS,
  }), [
    getPermission, getWorkspacePermission, resolveFolderPermission, resolveDocumentPermission,
    canPerformAction, canView, canEdit, canCreate, canDelete, canShare,
    getAvailableShareLevels, grantPermission, updateFolderHierarchy, updateDocumentFolders,
    isOwner, canEditWorkspace
  ]);

  return (
    <PermissionContext.Provider value={value}>
      {children}
    </PermissionContext.Provider>
  );
}

export default PermissionContext;
