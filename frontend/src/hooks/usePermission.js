/**
 * Permission Hooks
 * 
 * Convenient hooks for permission checking in components.
 * 
 * Reference: docs/WORKSPACE_PERMISSIONS_SPEC.md
 */

import { useMemo, useCallback } from 'react';
import { usePermissions } from '../contexts/PermissionContext';

/**
 * Get permission level for a specific entity
 * 
 * @param {string} entityType - 'workspace' | 'folder' | 'document'
 * @param {string} entityId - Entity ID
 * @returns {Object} Permission info
 */
export function usePermission(entityType, entityId) {
  const { 
    getPermission, 
    canPerformAction,
    getAvailableShareLevels 
  } = usePermissions();

  const permission = useMemo(() => {
    return getPermission(entityType, entityId);
  }, [getPermission, entityType, entityId]);

  const canView = useMemo(() => {
    return canPerformAction('view', entityType, entityId);
  }, [canPerformAction, entityType, entityId]);

  const canEdit = useMemo(() => {
    return canPerformAction('edit', entityType, entityId);
  }, [canPerformAction, entityType, entityId]);

  const canCreate = useMemo(() => {
    return canPerformAction('create', entityType, entityId);
  }, [canPerformAction, entityType, entityId]);

  const canDelete = useMemo(() => {
    return canPerformAction('delete', entityType, entityId);
  }, [canPerformAction, entityType, entityId]);

  const canShare = useMemo(() => {
    return canPerformAction('share-viewer', entityType, entityId);
  }, [canPerformAction, entityType, entityId]);

  const isOwner = useMemo(() => {
    return permission === 'owner';
  }, [permission]);

  const isEditor = useMemo(() => {
    return permission === 'owner' || permission === 'editor';
  }, [permission]);

  const isViewer = useMemo(() => {
    return permission === 'owner' || permission === 'editor' || permission === 'viewer';
  }, [permission]);

  const shareableLevels = useMemo(() => {
    return getAvailableShareLevels(entityType, entityId);
  }, [getAvailableShareLevels, entityType, entityId]);

  return {
    permission,
    canView,
    canEdit,
    canCreate,
    canDelete,
    canShare,
    isOwner,
    isEditor,
    isViewer,
    shareableLevels,
  };
}

/**
 * Check if current user can view an entity
 * @param {string} entityId - Entity ID
 * @param {string} [entityType='document'] - Entity type
 * @returns {boolean}
 */
export function useCanView(entityId, entityType = 'document') {
  const { canView } = usePermissions();
  return useMemo(() => canView(entityType, entityId), [canView, entityType, entityId]);
}

/**
 * Check if current user can edit an entity
 * @param {string} entityId - Entity ID
 * @param {string} [entityType='document'] - Entity type
 * @returns {boolean}
 */
export function useCanEdit(entityId, entityType = 'document') {
  const { canEdit } = usePermissions();
  return useMemo(() => canEdit(entityType, entityId), [canEdit, entityType, entityId]);
}

/**
 * Check if current user can share an entity
 * @param {string} entityId - Entity ID
 * @param {string} [entityType='document'] - Entity type
 * @returns {boolean}
 */
export function useCanShare(entityId, entityType = 'document') {
  const { canShare } = usePermissions();
  return useMemo(() => canShare(entityType, entityId), [canShare, entityType, entityId]);
}

/**
 * Check if current user is owner of an entity
 * @param {string} entityId - Entity ID
 * @returns {boolean}
 */
export function useIsOwner(entityId) {
  const { getPermission } = usePermissions();
  return useMemo(() => {
    const perm = getPermission('workspace', entityId) || 
                 getPermission('folder', entityId) || 
                 getPermission('document', entityId);
    return perm === 'owner';
  }, [getPermission, entityId]);
}

/**
 * Check if current user can perform a specific action
 * @param {string} action - Action name
 * @param {string} entityType - Entity type
 * @param {string} entityId - Entity ID
 * @returns {boolean}
 */
export function useCanPerform(action, entityType, entityId) {
  const { canPerformAction } = usePermissions();
  return useMemo(() => {
    return canPerformAction(action, entityType, entityId);
  }, [canPerformAction, action, entityType, entityId]);
}

/**
 * Get permission status for multiple entities
 * Useful for bulk operations
 * 
 * @param {Array<{type: string, id: string}>} entities - Array of entity refs
 * @returns {Map<string, Object>} Map of entityId to permission info
 */
export function useMultiplePermissions(entities) {
  const { getPermission, canPerformAction } = usePermissions();
  // Stabilize dependency: inline arrays create new references every render,
  // so use a serialized key for comparison instead of the array reference.
  const entitiesKey = JSON.stringify(entities);

  return useMemo(() => {
    const permissions = new Map();
    
    for (const entity of entities) {
      const { type, id } = entity;
      const permission = getPermission(type, id);
      
      permissions.set(id, {
        permission,
        canView: canPerformAction('view', type, id),
        canEdit: canPerformAction('edit', type, id),
        canDelete: canPerformAction('delete', type, id),
      });
    }
    
    return permissions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entitiesKey, getPermission, canPerformAction]);
}

/**
 * Hook to require a minimum permission level
 * Returns redirect info if permission is insufficient
 * 
 * @param {string} entityType - Entity type
 * @param {string} entityId - Entity ID
 * @param {string} requiredPermission - 'viewer' | 'editor' | 'owner'
 * @returns {Object} { allowed, permission, redirect }
 */
export function useRequirePermission(entityType, entityId, requiredPermission = 'viewer') {
  const { getPermission } = usePermissions();

  return useMemo(() => {
    const permission = getPermission(entityType, entityId);
    
    const levels = { owner: 3, editor: 2, viewer: 1, none: 0 };
    const userLevel = levels[permission] || 0;
    const requiredLevel = levels[requiredPermission] || 1;
    
    const allowed = userLevel >= requiredLevel;
    
    return {
      allowed,
      permission,
      requiredPermission,
      redirect: allowed ? null : '/access-denied',
    };
  }, [getPermission, entityType, entityId, requiredPermission]);
}

/**
 * Hook for editor toolbar - disable editing for viewers
 * @param {string} documentId - Document ID
 * @returns {Object} Editor control settings
 */
export function useEditorPermissions(documentId) {
  const { permission, canEdit, canDelete, canShare } = usePermission('document', documentId);

  return useMemo(() => ({
    readOnly: !canEdit,
    canFormat: canEdit,
    canDelete,
    canShare,
    canComment: permission !== 'none',
    showToolbar: canEdit,
    showShareButton: canShare,
    permission,
  }), [permission, canEdit, canDelete, canShare]);
}

/**
 * Hook for workspace actions
 * @param {string} workspaceId - Workspace ID
 * @returns {Object} Available actions
 */
export function useWorkspaceActions(workspaceId) {
  const { permission, isOwner, canEdit, canShare } = usePermission('workspace', workspaceId);
  const { canPerformAction } = usePermissions();

  const canDeleteWorkspace = useMemo(() => {
    return canPerformAction('delete-workspace', 'workspace', workspaceId);
  }, [canPerformAction, workspaceId]);

  const canPromoteToOwner = useMemo(() => {
    return canPerformAction('promote-owner', 'workspace', workspaceId);
  }, [canPerformAction, workspaceId]);

  return {
    permission,
    isOwner,
    canEdit,
    canShare,
    canDeleteWorkspace,
    canPromoteToOwner,
    canCreateFolder: canEdit,
    canInvite: canShare,
  };
}

/**
 * Hook for folder actions
 * @param {string} folderId - Folder ID
 * @returns {Object} Available actions
 */
export function useFolderActions(folderId) {
  const { permission, isOwner, canEdit, canDelete, canShare } = usePermission('folder', folderId);

  return {
    permission,
    isOwner,
    canEdit,
    canDelete,
    canShare,
    canCreateDocument: canEdit,
    canCreateSubfolder: canEdit,
    canRename: canEdit,
    canMove: canEdit,
  };
}
