/**
 * FolderTree Component
 * 
 * Hierarchical tree view of folders with drag-drop support.
 * Shows folder structure within current workspace.
 */

import React, { useState, useCallback } from 'react';
import { useFolders } from '../contexts/FolderContext';
import { useWorkspaces } from '../contexts/WorkspaceContext';
import { usePermissions } from '../contexts/PermissionContext';
import './FolderTree.css';

/**
 * Single folder item in the tree
 */
function FolderItem({ 
  folder, 
  level = 0, 
  isSelected,
  selectedFolderId,
  isExpanded,
  expandedFolders,
  onSelect,
  onToggle,
  onContextMenu,
  onDrop,
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const { canEdit } = usePermissions();
  
  const handleDragOver = (e) => {
    e.preventDefault();
    if (canEdit('folder', folder.id)) {
      setIsDragOver(true);
    }
  };
  
  const handleDragLeave = () => {
    setIsDragOver(false);
  };
  
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const data = e.dataTransfer.getData('application/json');
    if (data) {
      try {
        const dropped = JSON.parse(data);
        onDrop?.(dropped, folder.id);
      } catch (err) {
        console.error('Failed to parse dropped data:', err);
      }
    }
  };
  
  const hasChildren = folder.children && folder.children.length > 0;
  
  return (
    <div className="folder-item-wrapper">
      <div
        className={`folder-item ${isSelected ? 'folder-item--selected' : ''} ${isDragOver ? 'folder-item--drag-over' : ''}`}
        style={{ paddingLeft: `${12 + level * 16}px` }}
        onClick={() => onSelect(folder.id)}
        onContextMenu={(e) => onContextMenu?.(e, folder)}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Expand/collapse toggle */}
        <button
          className={`folder-item__toggle ${hasChildren ? '' : 'folder-item__toggle--hidden'}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(folder.id);
          }}
        >
          <span className={`folder-item__arrow ${isExpanded ? 'folder-item__arrow--expanded' : ''}`}>
            ▶
          </span>
        </button>
        
        {/* Folder icon */}
        <span 
          className="folder-item__icon"
          style={folder.color ? { color: folder.color } : undefined}
        >
          {folder.icon || (isExpanded ? '📂' : '📁')}
        </span>
        
        {/* Folder name */}
        <span className="folder-item__name">{folder.name}</span>
      </div>
      
      {/* Children */}
      {hasChildren && isExpanded && (
        <div className="folder-item__children">
          {folder.children.map(child => (
            <FolderItem
              key={child.id}
              folder={child}
              level={level + 1}
              isSelected={selectedFolderId === child.id}
              selectedFolderId={selectedFolderId}
              isExpanded={expandedFolders?.has(child.id) || false}
              expandedFolders={expandedFolders}
              onSelect={onSelect}
              onToggle={onToggle}
              onContextMenu={onContextMenu}
              onDrop={onDrop}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Main FolderTree component
 */
export default function FolderTree({ 
  onCreateFolder,
  onFolderContextMenu 
}) {
  const { 
    folders, 
    selectedFolderId, 
    setSelectedFolderId,
    expandedFolders,
    toggleFolderExpand,
    getFolderHierarchy,
    moveDocumentToFolder,
  } = useFolders();
  const { currentWorkspaceId } = useWorkspaces();
  const { canCreate } = usePermissions();
  
  // Check if user can create folders in current workspace
  const canCreateFolder = currentWorkspaceId && canCreate('folder', currentWorkspaceId);
  
  // Get hierarchical folder structure
  const folderTree = getFolderHierarchy(null);
  
  // Get system folders (filtered for current workspace)
  const systemFolders = folders.filter(f => f.isSystem);
  
  // Handle dropping items onto folders
  const handleDrop = useCallback((droppedItem, targetFolderId) => {
    if (droppedItem.type === 'document') {
      moveDocumentToFolder(droppedItem.id, targetFolderId);
    }
    // Could also handle folder reordering here
  }, [moveDocumentToFolder]);
  
  return (
    <div className="folder-tree">
      {/* System folders */}
      <div className="folder-tree__section">
        {systemFolders.map(folder => (
          <div
            key={folder.id}
            className={`folder-item folder-item--system ${selectedFolderId === folder.id ? 'folder-item--selected' : ''}`}
            onClick={() => setSelectedFolderId(folder.id)}
          >
            <span className="folder-item__icon">{folder.icon}</span>
            <span className="folder-item__name">{folder.name}</span>
          </div>
        ))}
      </div>
      
      {/* Divider */}
      {systemFolders.length > 0 && folderTree.length > 0 && (
        <div className="folder-tree__divider" />
      )}
      
      {/* User folders */}
      <div className="folder-tree__section folder-tree__section--user">
        <div className="folder-tree__section-header">
          <span className="folder-tree__section-title">Folders</span>
          {canCreateFolder && (
            <button 
              className="folder-tree__add-btn"
              onClick={onCreateFolder}
              title="Create folder"
            >
              +
            </button>
          )}
        </div>
        
        {folderTree.length > 0 ? (
          <div className="folder-tree__list">
            {folderTree.map(folder => (
              <FolderTreeItem
                key={folder.id}
                folder={folder}
                selectedFolderId={selectedFolderId}
                expandedFolders={expandedFolders}
                onSelect={setSelectedFolderId}
                onToggle={toggleFolderExpand}
                onContextMenu={onFolderContextMenu}
                onDrop={handleDrop}
              />
            ))}
          </div>
        ) : (
          <div className="folder-tree__empty">
            <span className="folder-tree__empty-text">No folders yet</span>
            {canCreateFolder && (
              <button 
                className="folder-tree__empty-btn"
                onClick={onCreateFolder}
              >
                Create your first folder
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Recursive folder tree item with expand/collapse
 */
function FolderTreeItem({
  folder,
  level = 0,
  selectedFolderId,
  expandedFolders,
  onSelect,
  onToggle,
  onContextMenu,
  onDrop,
}) {
  const isSelected = selectedFolderId === folder.id;
  const isExpanded = expandedFolders.has(folder.id);
  
  return (
    <FolderItem
      folder={folder}
      level={level}
      isSelected={isSelected}
      selectedFolderId={selectedFolderId}
      isExpanded={isExpanded}
      expandedFolders={expandedFolders}
      onSelect={onSelect}
      onToggle={onToggle}
      onContextMenu={onContextMenu}
      onDrop={onDrop}
    />
  );
}
