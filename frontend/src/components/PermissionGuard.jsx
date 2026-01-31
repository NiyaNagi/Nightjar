/**
 * PermissionGuard Component
 * 
 * Higher-order component that checks permissions before rendering children.
 * Shows AccessDenied or fallback if permission check fails.
 */

import React from 'react';
import { usePermissions } from '../contexts/PermissionContext';
import AccessDenied, { AccessDeniedInline } from './AccessDenied';

/**
 * PermissionGuard - Wraps content that requires specific permissions
 * 
 * @param {string} action - Required action: 'view', 'edit', 'create', 'delete', 'share-owner', etc.
 * @param {string} entityType - 'workspace' | 'folder' | 'document'
 * @param {string} entityId - ID of the entity to check
 * @param {ReactNode} children - Content to render if permitted
 * @param {ReactNode} fallback - Optional fallback content (default: AccessDenied)
 * @param {boolean} inline - Use inline denied message instead of full page
 * @param {boolean} hide - Hide completely instead of showing denied message
 */
export default function PermissionGuard({
  action,
  entityType,
  entityId,
  children,
  fallback,
  inline = false,
  hide = false,
  onGoBack,
}) {
  const { canPerformAction } = usePermissions();
  
  // Check permission
  const hasPermission = canPerformAction(action, entityType, entityId);
  
  if (hasPermission) {
    return <>{children}</>;
  }
  
  // Permission denied
  if (hide) {
    return null;
  }
  
  if (fallback) {
    return <>{fallback}</>;
  }
  
  if (inline) {
    return <AccessDeniedInline action={action} />;
  }
  
  return (
    <AccessDenied 
      action={action} 
      entityType={entityType}
      onGoBack={onGoBack}
    />
  );
}

/**
 * RequireEditor - Shorthand for requiring editor permission
 */
export function RequireEditor({ entityType, entityId, children, fallback, hide }) {
  return (
    <PermissionGuard
      action="edit"
      entityType={entityType}
      entityId={entityId}
      fallback={fallback}
      hide={hide}
    >
      {children}
    </PermissionGuard>
  );
}

/**
 * RequireOwner - Shorthand for requiring owner permission
 */
export function RequireOwner({ entityType, entityId, children, fallback, hide }) {
  return (
    <PermissionGuard
      action="share-owner"
      entityType={entityType}
      entityId={entityId}
      fallback={fallback}
      hide={hide}
    >
      {children}
    </PermissionGuard>
  );
}

/**
 * RequireViewer - Shorthand for requiring at least viewer permission
 */
export function RequireViewer({ entityType, entityId, children, fallback, onGoBack }) {
  return (
    <PermissionGuard
      action="view"
      entityType={entityType}
      entityId={entityId}
      fallback={fallback}
      onGoBack={onGoBack}
    >
      {children}
    </PermissionGuard>
  );
}

/**
 * Hook version for more flexibility
 */
export function usePermissionCheck(action, entityType, entityId) {
  const { canPerformAction, getPermission } = usePermissions();
  
  return {
    hasPermission: canPerformAction(action, entityType, entityId),
    permission: getPermission(entityType, entityId),
  };
}

/**
 * Conditional render based on permission
 * Useful for showing/hiding UI elements
 */
export function IfPermitted({ action, entityType, entityId, children }) {
  const { canPerformAction } = usePermissions();
  
  if (canPerformAction(action, entityType, entityId)) {
    return <>{children}</>;
  }
  
  return null;
}

/**
 * Render prop pattern for permission checks
 */
export function WithPermission({ action, entityType, entityId, children }) {
  const { canPerformAction, getPermission } = usePermissions();
  
  const hasPermission = canPerformAction(action, entityType, entityId);
  const permission = getPermission(entityType, entityId);
  
  return children({ hasPermission, permission });
}
