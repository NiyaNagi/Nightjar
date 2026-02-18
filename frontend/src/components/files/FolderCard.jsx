/**
 * FolderCard
 * 
 * Renders a folder in the browse view. Click to drill in.
 * Supports drag-drop (files dropped on folder → move to folder).
 * 
 * See docs/FILE_STORAGE_SPEC.md §5.5
 */

import { useState, useCallback } from 'react';
import './FolderCard.css';

export default function FolderCard({
  folder,
  fileCount = 0,
  viewMode = 'grid',
  isSelected = false,
  onSelect,
  onClick,
  onContextMenu,
  onFileDrop,
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleClick = useCallback((e) => {
    if (e.shiftKey) {
      onSelect?.(folder.id, { ctrl: false, shift: true });
    } else if (e.ctrlKey || e.metaKey) {
      onSelect?.(folder.id, { ctrl: true, shift: false });
    } else {
      onSelect?.(folder.id, { ctrl: false, shift: false });
      onClick?.(folder);
    }
  }, [folder, onClick, onSelect]);

  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
    onContextMenu?.(e, { type: 'folder', item: folder });
  }, [folder, onContextMenu]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    // Only reset if leaving the element itself, not moving between child elements
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data && (data.type === 'file' || data.type === 'folder')) {
        // Support multi-file drag (ids array) and single drag (id)
        const ids = data.ids || (data.id ? [data.id] : []);
        for (const id of ids) {
          if (id && id !== folder.id) {
            onFileDrop?.(id, folder.id, data.type);
          }
        }
      }
    } catch (err) {
      // Ignore invalid drag data
    }
  }, [folder.id, onFileDrop]);

  const handleCheckbox = useCallback((e) => {
    e.stopPropagation();
    onSelect?.(folder.id, { ctrl: true, shift: false });
  }, [folder.id, onSelect]);

  if (viewMode === 'compact') {
    return (
      <div
        className={`folder-compact-row ${isSelected ? 'folder-compact-row--selected' : ''} ${isDragOver ? 'folder-compact-row--drop-target' : ''}`}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        data-testid={`fs-folder-${folder.id}`}
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={handleCheckbox}
          className="folder-compact-checkbox"
        />
        <span className="folder-compact-icon">{folder.icon || '📁'}</span>
        <span className="folder-compact-name">{folder.name}</span>
        <span className="folder-compact-count">{fileCount} item{fileCount !== 1 ? 's' : ''}</span>
      </div>
    );
  }

  if (viewMode === 'table') {
    return (
      <tr
        className={`folder-table-row ${isSelected ? 'folder-table-row--selected' : ''} ${isDragOver ? 'folder-table-row--drop-target' : ''}`}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        data-testid={`fs-folder-${folder.id}`}
      >
        <td className="file-table-cell file-table-check">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={handleCheckbox}
            className="file-table-checkbox"
          />
        </td>
        <td className="file-table-cell file-table-name">
          <span className="folder-table-icon">{folder.icon || '📁'}</span>
          <span className="file-table-name-text">{folder.name}</span>
        </td>
        <td className="file-table-cell file-table-size">{fileCount} item{fileCount !== 1 ? 's' : ''}</td>
        <td className="file-table-cell file-table-type">Folder</td>
        <td className="file-table-cell file-table-uploader">—</td>
        <td className="file-table-cell file-table-date">
          {folder.createdAt ? new Date(folder.createdAt).toLocaleDateString() : '—'}
        </td>
        <td className="file-table-cell">—</td>
        <td className="file-table-cell">—</td>
      </tr>
    );
  }

  // Grid view
  return (
    <div
      className={`folder-card ${isSelected ? 'folder-card--selected' : ''} ${isDragOver ? 'folder-card--drop-target' : ''}`}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-testid={`fs-folder-${folder.id}`}
    >
      <div className="folder-card-header">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={handleCheckbox}
          className="folder-card-checkbox"
        />
      </div>
      <span className="folder-card-icon" style={folder.color ? { color: folder.color } : {}}>
        {folder.icon || '📁'}
      </span>
      <span className="folder-card-name" title={folder.name}>{folder.name}</span>
      <span className="folder-card-count">{fileCount} item{fileCount !== 1 ? 's' : ''}</span>
    </div>
  );
}
