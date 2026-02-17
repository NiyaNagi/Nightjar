/**
 * FileContextMenu
 * 
 * Right-click context menu for files and folders.
 * Supports both single-item and bulk (multi-select) modes.
 * Actions: Download, Rename, Move, Delete, Copy Link, Tags, Properties
 * 
 * See docs/FILE_STORAGE_SPEC.md §7.1
 */

import { useEffect, useRef, useCallback } from 'react';
import './FileContextMenu.css';

export default function FileContextMenu({
  isOpen,
  position,
  target,        // { type: 'file'|'folder', item: record }
  onClose,
  onAction,      // (action, item) => void
  isAdmin = false,
  isBulk = false,        // true when multiple items are selected
  selectedCount = 0,     // number of selected items when bulk
  selectedFileCount = 0, // number of selected files (not folders) when bulk
}) {
  const menuRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };

    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen, onClose]);

  // Adjust position to stay within viewport
  useEffect(() => {
    if (!isOpen || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const el = menuRef.current;
    
    if (rect.right > window.innerWidth) {
      el.style.left = `${position.x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
      el.style.top = `${position.y - rect.height}px`;
    }
  }, [isOpen, position]);

  const handleAction = useCallback((action) => {
    onAction?.(action, target?.item);
    onClose();
  }, [onAction, target, onClose]);

  if (!isOpen || !target) return null;

  const isFile = target.type === 'file';
  const isFolder = target.type === 'folder';

  return (
    <div
      ref={menuRef}
      className="file-context-menu"
      style={{ left: position.x, top: position.y }}
      data-testid="file-context-menu"
      role="menu"
    >
      {/* Download — files only (single or bulk) */}
      {(isFile || (isBulk && selectedFileCount > 0)) && (
        <button className="file-context-item" onClick={() => handleAction('download')} role="menuitem" data-testid="ctx-download">
          <span className="file-context-icon">⬇️</span>
          {isBulk ? `Download ${selectedFileCount} file${selectedFileCount !== 1 ? 's' : ''}` : 'Download'}
        </button>
      )}
      {/* Rename — single item only */}
      {!isBulk && (
        <button className="file-context-item" onClick={() => handleAction('rename')} role="menuitem" data-testid="ctx-rename">
          <span className="file-context-icon">✏️</span> Rename
        </button>
      )}
      <button className="file-context-item" onClick={() => handleAction('move')} role="menuitem" data-testid="ctx-move">
        <span className="file-context-icon">📦</span>
        {isBulk ? `Move ${selectedCount} item${selectedCount !== 1 ? 's' : ''}…` : 'Move to…'}
      </button>
      <div className="file-context-divider" />
      {/* Tags — files only */}
      {(isFile || (isBulk && selectedFileCount > 0)) && (
        <button className="file-context-item" onClick={() => handleAction('tags')} role="menuitem" data-testid="ctx-tags">
          <span className="file-context-icon">🏷️</span>
          {isBulk ? `Edit Tags (${selectedFileCount} file${selectedFileCount !== 1 ? 's' : ''})` : 'Edit Tags'}
        </button>
      )}
      {/* Favorite — files only (bulk or single) */}
      {(isFile || (isBulk && selectedFileCount > 0)) && (
        <button className="file-context-item" onClick={() => handleAction('favorite')} role="menuitem" data-testid="ctx-favorite">
          <span className="file-context-icon">⭐</span>
          {isBulk ? `Favorite ${selectedFileCount} file${selectedFileCount !== 1 ? 's' : ''}` : 'Toggle Favorite'}
        </button>
      )}
      {/* Properties — single item only */}
      {!isBulk && isFile && (
        <button className="file-context-item" onClick={() => handleAction('details')} role="menuitem" data-testid="ctx-details">
          <span className="file-context-icon">ℹ️</span> Properties
        </button>
      )}
      {!isBulk && isFolder && (
        <button className="file-context-item" onClick={() => handleAction('details')} role="menuitem" data-testid="ctx-folder-details">
          <span className="file-context-icon">ℹ️</span> Folder Properties
        </button>
      )}
      <div className="file-context-divider" />
      <button className="file-context-item file-context-item--danger" onClick={() => handleAction('delete')} role="menuitem" data-testid="ctx-delete">
        <span className="file-context-icon">🗑️</span>
        {isBulk ? `Delete ${selectedCount} item${selectedCount !== 1 ? 's' : ''}` : 'Delete'}
      </button>
    </div>
  );
}
