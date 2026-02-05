/**
 * Breadcrumbs Component
 * 
 * Shows navigation path: Workspace > Folder > ... > Document
 * Handles partial access (grayed out inaccessible ancestors)
 * 
 * Reference: docs/WORKSPACE_PERMISSIONS_SPEC.md
 */

import React, { useMemo } from 'react';
import { useWorkspaces } from '../contexts/WorkspaceContext';
import { useFolders } from '../contexts/FolderContext';
import { usePermissions } from '../contexts/PermissionContext';
import './Breadcrumbs.css';

/**
 * Breadcrumb item data
 * @typedef {Object} BreadcrumbItem
 * @property {string} id - Entity ID
 * @property {string} name - Display name
 * @property {string} type - 'workspace' | 'folder' | 'document'
 * @property {string} icon - Emoji icon
 * @property {boolean} accessible - Whether user can access this item
 * @property {boolean} current - Whether this is the current item
 */

/**
 * Build breadcrumb path from entity to root
 * 
 * @param {string} entityType - 'workspace' | 'folder' | 'document'
 * @param {string} entityId - Entity ID
 * @param {Object} context - Context data
 * @returns {BreadcrumbItem[]}
 */
function buildBreadcrumbPath(entityType, entityId, context) {
  const { 
    workspaces, 
    folders, 
    documents,
    documentFolders,
    folderHierarchy,
    canView 
  } = context;

  const path = [];

  // Start from current entity and work up
  if (entityType === 'document') {
    const doc = documents?.find(d => d.id === entityId);
    const folderId = documentFolders?.[entityId] || doc?.folderId;
    
    const getDocIcon = (docType) => {
      if (docType === 'kanban') return '📋';
      if (docType === 'sheet') return '📊';
      return '📄';
    };
    
    path.unshift({
      id: entityId,
      name: doc?.name || 'Document',
      type: 'document',
      icon: getDocIcon(doc?.type),
      accessible: canView('document', entityId),
      current: true,
    });

    // Add folder and ancestors
    if (folderId) {
      addFolderPath(folderId, path, context);
    }
  } else if (entityType === 'folder') {
    addFolderPath(entityId, path, context, true);
  } else if (entityType === 'workspace') {
    const workspace = workspaces?.find(w => w.id === entityId);
    path.push({
      id: entityId,
      name: workspace?.name || 'Workspace',
      type: 'workspace',
      icon: workspace?.icon || '📁',
      accessible: canView('workspace', entityId),
      current: true,
    });
  }

  return path;
}

/**
 * Add folder and its ancestors to path
 */
function addFolderPath(folderId, path, context, isCurrent = false) {
  const { folders, folderHierarchy, workspaces, canView } = context;
  
  // Handle system folders
  if (folderId.includes(':')) {
    const [workspaceId, virtualId] = folderId.split(':');
    const workspace = workspaces?.find(w => w.id === workspaceId);
    
    // Add system folder
    const systemNames = {
      all: 'All Documents',
      recent: 'Recent',
      shared: 'Shared with Me',
      trash: 'Trash',
    };
    
    path.unshift({
      id: folderId,
      name: systemNames[virtualId] || virtualId,
      type: 'folder',
      icon: virtualId === 'trash' ? '🗑️' : '📁',
      accessible: true,
      current: isCurrent && path.length === 0,
      isSystem: true,
    });

    // Add workspace
    path.unshift({
      id: workspaceId,
      name: workspace?.name || 'Workspace',
      type: 'workspace',
      icon: workspace?.icon || '📁',
      accessible: canView('workspace', workspaceId),
      current: false,
    });

    return;
  }

  const folder = folders?.find(f => f.id === folderId);
  const hierarchy = folderHierarchy?.get?.(folderId);
  
  path.unshift({
    id: folderId,
    name: folder?.name || 'Folder',
    type: 'folder',
    icon: folder?.icon || '📁',
    accessible: canView('folder', folderId),
    current: isCurrent && path.length === 0,
  });

  // Add parent folder if exists
  const parentId = hierarchy?.parentId || folder?.parentId;
  if (parentId) {
    addFolderPath(parentId, path, context);
  } else {
    // Add workspace
    const workspaceId = hierarchy?.workspaceId || folder?.workspaceId;
    if (workspaceId) {
      const workspace = workspaces?.find(w => w.id === workspaceId);
      path.unshift({
        id: workspaceId,
        name: workspace?.name || 'Workspace',
        type: 'workspace',
        icon: workspace?.icon || '📁',
        accessible: canView('workspace', workspaceId),
        current: false,
      });
    }
  }
}

/**
 * Breadcrumbs Component
 * 
 * @param {Object} props
 * @param {string} props.entityType - Current entity type
 * @param {string} props.entityId - Current entity ID
 * @param {Function} props.onNavigate - Navigation callback (type, id)
 * @param {boolean} props.compact - Use compact display
 */
export default function Breadcrumbs({ 
  entityType, 
  entityId, 
  onNavigate,
  compact = false,
}) {
  const { workspaces } = useWorkspaces();
  const { folders, documentFolders } = useFolders();
  const { canView } = usePermissions();

  // Build breadcrumb path
  const breadcrumbs = useMemo(() => {
    if (!entityType || !entityId) return [];
    
    return buildBreadcrumbPath(entityType, entityId, {
      workspaces,
      folders,
      documents: [], // Would need documents context
      documentFolders,
      folderHierarchy: new Map(), // Would need from FolderContext
      canView: (type, id) => canView(id),
    });
  }, [entityType, entityId, workspaces, folders, documentFolders, canView]);

  if (breadcrumbs.length === 0) {
    return null;
  }

  // Compact mode: only show last 2 items
  const displayItems = compact && breadcrumbs.length > 2
    ? [{ ellipsis: true }, ...breadcrumbs.slice(-2)]
    : breadcrumbs;

  return (
    <nav className={`breadcrumbs ${compact ? 'compact' : ''}`} aria-label="Breadcrumb">
      <ol className="breadcrumb-list">
        {displayItems.map((item, index) => (
          <li 
            key={item.ellipsis ? 'ellipsis' : item.id}
            className={`breadcrumb-item ${item.current ? 'current' : ''} ${!item.accessible ? 'inaccessible' : ''}`}
          >
            {item.ellipsis ? (
              <span className="breadcrumb-ellipsis">...</span>
            ) : (
              <>
                {index > 0 && <span className="breadcrumb-separator">/</span>}
                {item.accessible && !item.current ? (
                  <button
                    type="button"
                    className="breadcrumb-link"
                    onClick={() => onNavigate?.(item.type, item.id)}
                    title={item.name}
                  >
                    <span className="breadcrumb-icon">{item.icon}</span>
                    <span className="breadcrumb-name">{item.name}</span>
                  </button>
                ) : (
                  <span className="breadcrumb-text" title={item.accessible ? item.name : 'No access'}>
                    <span className="breadcrumb-icon">{item.icon}</span>
                    <span className="breadcrumb-name">{item.name}</span>
                    {!item.accessible && (
                      <span className="breadcrumb-lock" title="No access">🔒</span>
                    )}
                  </span>
                )}
              </>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * Inline breadcrumbs for document header
 */
export function DocumentBreadcrumbs({ documentId, documentName, onNavigate }) {
  return (
    <Breadcrumbs
      entityType="document"
      entityId={documentId}
      onNavigate={onNavigate}
      compact={true}
    />
  );
}
