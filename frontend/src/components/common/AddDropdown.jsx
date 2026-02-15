/**
 * AddDropdown Component
 * 
 * Unified "Add" button that shows a dropdown with options to create:
 * - Document
 * - Sheet (Spreadsheet)
 * - Kanban
 * - Folder
 * 
 * Each option shows an inline creator for name, icon, color, and folder selection.
 */

import React, { useState, useRef, useEffect } from 'react';
import IconColorPicker from './IconColorPicker';
import './AddDropdown.css';

const ITEM_TYPES = {
  document: {
    label: 'Document',
    icon: '📄',
    defaultColor: '#3b82f6',
    description: 'Text document with rich editing',
  },
  sheet: {
    label: 'Spreadsheet',
    icon: '📊',
    defaultColor: '#22c55e',
    description: 'Spreadsheet with formulas',
  },
  kanban: {
    label: 'Kanban Board',
    icon: '📋',
    defaultColor: '#10b981',
    description: 'Visual task board',
  },
  inventory: {
    label: 'Inventory System',
    icon: '📦',
    defaultColor: '#8b5cf6',
    description: 'Manage inventory requests',
  },
  folder: {
    label: 'Folder',
    icon: '📁',
    defaultColor: '#f59e0b',
    description: 'Organize your documents',
  },
};

export default function AddDropdown({
  folders = [],
  currentFolderId = null,
  onCreateDocument,
  onCreateSheet,
  onCreateKanban,
  onCreateInventory,
  onCreateFolder,
  canCreateInventory = false,
  disabled = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [creatingType, setCreatingType] = useState(null); // 'document' | 'sheet' | 'kanban' | 'folder'
  const [itemName, setItemName] = useState('');
  const [itemIcon, setItemIcon] = useState('📄');
  const [itemColor, setItemColor] = useState('#3b82f6');
  const [selectedFolderId, setSelectedFolderId] = useState(currentFolderId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const dropdownRef = useRef(null);
  const nameInputRef = useRef(null);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        handleClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Focus input when creating
  useEffect(() => {
    if (creatingType && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [creatingType]);

  // Update folder selection when currentFolderId changes
  useEffect(() => {
    if (currentFolderId && currentFolderId !== 'all' && currentFolderId !== 'recent') {
      setSelectedFolderId(currentFolderId);
    }
  }, [currentFolderId]);

  const handleClose = () => {
    setIsOpen(false);
    setCreatingType(null);
    setItemName('');
    setItemIcon('📄');
    setItemColor('#3b82f6');
  };

  const handleSelectType = (type) => {
    setCreatingType(type);
    setItemIcon(ITEM_TYPES[type].icon);
    setItemColor(ITEM_TYPES[type].defaultColor);
    setItemName('');
  };

  const handleCreate = async () => {
    if (!itemName.trim() || isSubmitting) return;

    setIsSubmitting(true);
    
    try {
      const itemData = {
        name: itemName.trim(),
        icon: itemIcon,
        color: itemColor,
        folderId: creatingType !== 'folder' ? selectedFolderId : null,
      };

      switch (creatingType) {
        case 'document':
          await onCreateDocument?.(itemData);
          break;
        case 'sheet':
          await onCreateSheet?.(itemData);
          break;
        case 'kanban':
          await onCreateKanban?.(itemData);
          break;
        case 'inventory':
          await onCreateInventory?.(itemData);
          break;
        case 'folder':
          await onCreateFolder?.(itemData);
          break;
      }

      handleClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleCreate();
    }
    if (e.key === 'Escape') {
      if (creatingType) {
        setCreatingType(null);
      } else {
        handleClose();
      }
    }
  };

  // Get available folders for selection (exclude system folders)
  const availableFolders = folders.filter(f => 
    !['all', 'recent', 'shared', 'trash'].includes(f.id)
  );

  return (
    <div className="add-dropdown" ref={dropdownRef}>
      <button
        type="button"
        className="add-dropdown__trigger"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        data-testid="new-document-btn"
      >
        <span className="add-dropdown__trigger-icon">+</span>
        <span className="add-dropdown__trigger-label">Add</span>
        <span className="add-dropdown__trigger-chevron">▾</span>
      </button>

      {isOpen && (
        <div className="add-dropdown__menu" role="menu">
          {!creatingType ? (
            // Type selection
            <div className="add-dropdown__types">
              {Object.entries(ITEM_TYPES)
                .filter(([type]) => type !== 'inventory' || canCreateInventory)
                .map(([type, info]) => (
                <button
                  key={type}
                  type="button"
                  className="add-dropdown__type-btn"
                  onClick={() => handleSelectType(type)}
                  role="menuitem"
                >
                  <span className="add-dropdown__type-icon">{info.icon}</span>
                  <div className="add-dropdown__type-info">
                    <span className="add-dropdown__type-label">{info.label}</span>
                    <span className="add-dropdown__type-desc">{info.description}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            // Inline creator form
            <div className="add-dropdown__creator" onKeyDown={handleKeyDown}>
              <div className="add-dropdown__creator-header">
                <button
                  type="button"
                  className="add-dropdown__back-btn"
                  onClick={() => setCreatingType(null)}
                >
                  ← Back
                </button>
                <span className="add-dropdown__creator-title">
                  New {ITEM_TYPES[creatingType].label}
                </span>
              </div>

              <div className="add-dropdown__creator-form">
                {/* Icon & Name row */}
                <div className="add-dropdown__creator-row">
                  <IconColorPicker
                    icon={itemIcon}
                    color={itemColor}
                    onIconChange={setItemIcon}
                    onColorChange={setItemColor}
                    size="medium"
                  />
                  <input
                    ref={nameInputRef}
                    type="text"
                    className="add-dropdown__name-input"
                    value={itemName}
                    onChange={(e) => setItemName(e.target.value)}
                    placeholder={`${ITEM_TYPES[creatingType].label} name...`}
                    maxLength={100}
                  />
                </div>

                {/* Folder selection (not for folders) */}
                {creatingType !== 'folder' && availableFolders.length > 0 && (
                  <div className="add-dropdown__creator-field">
                    <label className="add-dropdown__field-label">Add to folder:</label>
                    <select
                      className="add-dropdown__folder-select"
                      value={selectedFolderId || ''}
                      onChange={(e) => setSelectedFolderId(e.target.value || null)}
                    >
                      <option value="">No folder (root)</option>
                      {availableFolders.map(folder => (
                        <option key={folder.id} value={folder.id}>
                          {folder.icon || '📁'} {folder.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Actions */}
                <div className="add-dropdown__creator-actions">
                  <button
                    type="button"
                    className="add-dropdown__cancel-btn"
                    onClick={() => setCreatingType(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="add-dropdown__create-btn"
                    onClick={handleCreate}
                    disabled={!itemName.trim() || isSubmitting}
                  >
                    {isSubmitting ? 'Creating...' : 'Create'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { ITEM_TYPES };
