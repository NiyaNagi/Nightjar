/**
 * CreateDocument Dialog
 * 
 * Modal dialog for creating a new document within the current workspace.
 */

import React, { useState, useRef } from 'react';
import { useFolders } from '../contexts/FolderContext';
import { useWorkspaces } from '../contexts/WorkspaceContext';
import { usePermissions } from '../contexts/PermissionContext';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { logBehavior } from '../utils/logger';
import { UnifiedPicker } from './common';
import './CreateDocument.css';

const DOC_TYPES = {
    TEXT: 'text',
    SHEET: 'sheet', 
    KANBAN: 'kanban',
    INVENTORY: 'inventory',
    FILE_STORAGE: 'files',
};

const DOCUMENT_TYPES = [
    { 
        type: DOC_TYPES.TEXT, 
        icon: '📄', 
        label: 'Document', 
        description: 'Rich text document with collaborative editing'
    },
    { 
        type: DOC_TYPES.SHEET, 
        icon: '📊', 
        label: 'Spreadsheet', 
        description: 'Collaborative spreadsheet with formulas and charts'
    },
    { 
        type: DOC_TYPES.KANBAN, 
        icon: '📋', 
        label: 'Kanban Board', 
        description: 'Visual task management and workflow board'
    },
    { 
        type: DOC_TYPES.INVENTORY, 
        icon: '📦', 
        label: 'Inventory System', 
        description: 'Manage inventory requests and fulfillment'
    },
    { 
        type: DOC_TYPES.FILE_STORAGE, 
        icon: '📂', 
        label: 'File Storage', 
        description: 'Encrypted P2P file sharing and storage'
    }
];

export default function CreateDocumentDialog({ 
  isOpen, 
  onClose, 
  parentFolderId = null,
  onSuccess,
  defaultType = DOC_TYPES.TEXT,
  onCreateDocument,
  onCreateSheet,
  onCreateKanban,
  onCreateInventory,
  onCreateFileStorage,
  disabledTypes = [],
}) {
  const { folders } = useFolders();
  const { currentWorkspace, currentWorkspaceId } = useWorkspaces();
  const { canCreate } = usePermissions();
  const modalRef = useRef(null);
  
  const [name, setName] = useState('');
  const [documentType, setDocumentType] = useState(defaultType);
  const [icon, setIcon] = useState(DOCUMENT_TYPES.find(t => t.type === defaultType)?.icon || '📄');
  const [color, setColor] = useState(null);
  const [selectedFolder, setSelectedFolder] = useState(parentFolderId);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');
  
  // Focus trap for modal accessibility
  useFocusTrap(modalRef, isOpen, { onEscape: onClose });
  
  // Get available parent folders (user-created, non-system)
  const availableFolders = folders.filter(f => 
    f.workspaceId === currentWorkspaceId && 
    !f.isSystem && 
    !f.deletedAt
  );
  
  // Check if user can create documents
  const canCreateDocument = currentWorkspace && canCreate('document', currentWorkspaceId);
  
  // Reset form only on the rising edge of isOpen (closed → open).
  // Do NOT include defaultType/parentFolderId in deps — they can change while
  // the dialog is open (e.g., parent re-render) and would wipe user input.
  const prevIsOpenRef = useRef(false);
  React.useEffect(() => {
    const wasOpen = prevIsOpenRef.current;
    prevIsOpenRef.current = isOpen;
    if (isOpen && !wasOpen) {
      setName('');
      setDocumentType(defaultType);
      setIcon(DOCUMENT_TYPES.find(t => t.type === defaultType)?.icon || '📄');
      setColor(null);
      setSelectedFolder(parentFolderId);
      setError('');
      setIsCreating(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
  
  // Update icon when document type changes — only set the default type icon if the user hasn't customized it yet
  React.useEffect(() => {
    const typeInfo = DOCUMENT_TYPES.find(t => t.type === documentType);
    const defaultIcons = DOCUMENT_TYPES.map(t => t.icon);
    if (typeInfo && defaultIcons.includes(icon)) {
      setIcon(typeInfo.icon);
    }
  }, [documentType, icon]);
  
  const handleCreate = async () => {
    // Guard against double-submit (Enter key bypasses button disabled attribute)
    if (isCreating) return;
    
    if (!name.trim()) {
      setError('Document name is required');
      return;
    }
    
    if (!canCreateDocument) {
      setError('You do not have permission to create documents in this workspace');
      return;
    }
    
    setIsCreating(true);
    setError('');
    
    try {
      const docName = name.trim();
      
      // Call the appropriate creation function based on type
      if (documentType === DOC_TYPES.KANBAN && onCreateKanban) {
        await onCreateKanban(docName, selectedFolder, icon, color);
      } else if (documentType === DOC_TYPES.INVENTORY && onCreateInventory) {
        await onCreateInventory(docName, selectedFolder, icon, color);
      } else if (documentType === DOC_TYPES.FILE_STORAGE && onCreateFileStorage) {
        await onCreateFileStorage(docName, selectedFolder, icon, color);
      } else if (documentType === DOC_TYPES.SHEET && onCreateSheet) {
        await onCreateSheet(docName, selectedFolder, icon, color);
      } else if (onCreateDocument) {
        await onCreateDocument(docName, selectedFolder, icon, color);
      } else {
        throw new Error('No creation handler available for this document type');
      }
      
      // Success - close dialog and call success callback
      logBehavior('document', 'document_created', { type: documentType });
      onClose();
      onSuccess?.(docName, documentType);
    } catch (err) {
      console.error('Failed to create document:', err);
      setError(err.message || 'Failed to create document');
    } finally {
      setIsCreating(false);
    }
  };
  
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleCreate();
    }
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="create-document-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="create-document-modal" ref={modalRef}>
        <header className="create-document-modal__header">
          <h2 className="create-document-modal__title">Create New Item</h2>
          <button 
            type="button"
            className="create-document-modal__close" 
            onClick={onClose}
            aria-label="Close dialog"
          >
            ×
          </button>
        </header>
        
        <div className="create-document-modal__content">
          {/* Document Type Selection */}
          <div className="create-document-field">
            <label className="create-document-field__label">Document Type</label>
            <div className="document-type-grid" data-testid="doc-type-grid">
              {DOCUMENT_TYPES.map((type) => {
                const isDisabled = disabledTypes.includes(type.type);
                return (
                  <button
                    key={type.type}
                    type="button"
                    className={`document-type-option ${documentType === type.type ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                    onClick={() => { if (!isDisabled) { logBehavior('document', 'type_selected', { type: type.type }); setDocumentType(type.type); } }}
                    disabled={isDisabled}
                    title={isDisabled ? `Only one ${type.label.toLowerCase()} per workspace is allowed` : undefined}
                    data-testid={`doc-type-${type.type}`}
                  >
                    <div className="document-type-option__icon">{type.icon}</div>
                    <div className="document-type-option__label">{type.label}</div>
                    <div className="document-type-option__description">
                      {isDisabled ? 'Already exists in this workspace' : type.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          
          {/* Document Name */}
          <div className="create-document-field">
            <label htmlFor="doc-name" className="create-document-field__label">
              Name
            </label>
            <input
              id="doc-name"
              type="text"
              className="create-document-field__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Enter ${DOCUMENT_TYPES.find(t => t.type === documentType)?.label.toLowerCase() || 'document'} name`}
              autoFocus
              maxLength={100}
              data-testid="document-name-input"
            />
          </div>
          
          {/* Icon & Color Selection */}
          <div className="create-document-field">
            <label className="create-document-field__label">Appearance</label>
            <UnifiedPicker
              icon={icon}
              color={color}
              onIconChange={setIcon}
              onColorChange={setColor}
              size="medium"
            />
          </div>
          
          {/* Folder Selection */}
          {availableFolders.length > 0 && (
            <div className="create-document-field">
              <label htmlFor="folder-select" className="create-document-field__label">
                Folder (Optional)
              </label>
              <select
                id="folder-select"
                className="create-document-field__select"
                value={selectedFolder || ''}
                onChange={(e) => setSelectedFolder(e.target.value || null)}
              >
                <option value="">Root (no folder)</option>
                {availableFolders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.icon || '📁'} {folder.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          
          {/* Error Display */}
          {error && (
            <div className="create-document-error">
              {error}
            </div>
          )}
        </div>
        
        <footer className="create-document-modal__footer">
          <button
            type="button"
            className="create-document-btn create-document-btn--cancel"
            onClick={onClose}
            data-testid="cancel-document-btn"
          >
            Cancel
          </button>
          <button
            type="button"
            className="create-document-btn create-document-btn--primary"
            onClick={handleCreate}
            disabled={isCreating || !canCreateDocument || !name.trim()}
            data-testid="create-document-confirm"
          >
            {isCreating ? 'Creating...' : `Create ${DOCUMENT_TYPES.find(t => t.type === documentType)?.label || 'Document'}`}
          </button>
        </footer>
      </div>
    </div>
  );
}