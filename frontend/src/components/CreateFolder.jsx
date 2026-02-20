/**
 * CreateFolder Dialog
 * 
 * Modal dialog for creating a new folder within the current workspace.
 */

import React, { useState, useRef } from 'react';
import { useFolders } from '../contexts/FolderContext';
import { useWorkspaces } from '../contexts/WorkspaceContext';
import { usePermissions } from '../contexts/PermissionContext';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { logBehavior } from '../utils/logger';
import { UnifiedPicker } from './common';
import './CreateFolder.css';

export default function CreateFolderDialog({ 
  isOpen, 
  onClose, 
  parentFolderId = null,
  onSuccess 
}) {
  const { createFolder, folders } = useFolders();
  const { currentWorkspace, currentWorkspaceId } = useWorkspaces();
  const { canCreate } = usePermissions();
  const modalRef = useRef(null);
  
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📁');
  const [color, setColor] = useState(null);
  const [selectedParent, setSelectedParent] = useState(parentFolderId);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');
  
  // Focus trap for modal accessibility
  useFocusTrap(modalRef, isOpen, { onEscape: onClose });
  
  // Get available parent folders (user-created, non-system)
  const availableParents = folders.filter(f => !f.isSystem && !f.deletedAt);
  
  // Check if user can create folders
  const hasPermission = canCreate('workspace', currentWorkspaceId);
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (!name.trim()) {
      setError('Please enter a folder name');
      return;
    }
    
    if (!hasPermission) {
      setError('You do not have permission to create folders');
      return;
    }
    
    setIsCreating(true);
    
    try {
      const folderId = await createFolder(name.trim(), selectedParent, { icon, color });
      logBehavior('folder', 'folder_created');
      onSuccess?.(folderId);
      onClose?.();
      
      // Reset form
      setName('');
      setIcon('📁');
      setColor(null);
      setSelectedParent(parentFolderId);
    } catch (err) {
      setError(err.message || 'Failed to create folder');
    } finally {
      setIsCreating(false);
    }
  };
  
  const handleClose = () => {
    logBehavior('folder', 'dialog_closed');
    setName('');
    setError('');
    setIcon('📁');
    setColor(null);
    setSelectedParent(parentFolderId);
    onClose?.();
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="create-folder-overlay" onClick={handleClose}>
      <div 
        ref={modalRef}
        className="create-folder" 
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-folder-title"
      >
        <div className="create-folder__header">
          <h2 id="create-folder-title" className="create-folder__title">Create Folder</h2>
          <button type="button" className="create-folder__close" onClick={handleClose} aria-label="Close dialog">×</button>
        </div>
        
        <form onSubmit={handleSubmit} className="create-folder__form">
          {/* Workspace indicator */}
          <div className="create-folder__workspace">
            <span className="create-folder__workspace-icon">{currentWorkspace?.icon || '📁'}</span>
            <span className="create-folder__workspace-name">{currentWorkspace?.name || 'Workspace'}</span>
          </div>
          
          {/* Icon & Color selector */}
          <div className="create-folder__section">
            <label className="create-folder__label">Appearance</label>
            <UnifiedPicker
              icon={icon}
              color={color}
              onIconChange={setIcon}
              onColorChange={setColor}
              compact
            />
          </div>
          
          {/* Name input */}
          <div className="create-folder__section">
            <label className="create-folder__label">Folder Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="create-folder__input"
              placeholder="My Folder"
              autoFocus
            />
          </div>
          
          {/* Parent folder selector */}
          {availableParents.length > 0 && (
            <div className="create-folder__section">
              <label className="create-folder__label">Location</label>
              <select
                value={selectedParent || ''}
                onChange={(e) => setSelectedParent(e.target.value || null)}
                className="create-folder__select"
              >
                <option value="">Root (no parent)</option>
                {availableParents.map(folder => (
                  <option key={folder.id} value={folder.id}>
                    {folder.icon} {folder.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          
          {/* Error message */}
          {error && (
            <div className="create-folder__error">{error}</div>
          )}
          
          {/* Actions */}
          <div className="create-folder__actions">
            <button 
              type="button" 
              className="create-folder__btn create-folder__btn--secondary"
              onClick={handleClose}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="create-folder__btn create-folder__btn--primary"
              disabled={isCreating || !hasPermission || !name.trim()}
            >
              {isCreating ? 'Creating...' : 'Create Folder'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
