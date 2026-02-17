/**
 * FilePickerModal
 * 
 * Cross-feature modal for picking files from the file storage.
 * Used by TipTap editor, spreadsheet, and kanban to embed/link files.
 * 
 * See docs/FILE_STORAGE_SPEC.md §13
 */

import { useState, useCallback, useMemo } from 'react';
import FileTypeIcon from './FileTypeIcon';
import SearchBar from './SearchBar';
import { formatFileSize, getRelativeTime, getFileTypeCategory } from '../../utils/fileTypeCategories';
import './FilePickerModal.css';

const FILE_PICKER_MODES = {
  ALL: 'all',
  IMAGES: 'images',
  DOCUMENTS: 'documents',
  MEDIA: 'media',
};

export default function FilePickerModal({
  isOpen,
  onClose,
  onSelect,         // (file) => void
  activeFiles = [],
  activeFolders = [],
  mode = FILE_PICKER_MODES.ALL,
  title = 'Select File',
  multiple = false,
}) {
  const [selectedFiles, setSelectedFiles] = useState(new Set());
  const [currentFolderId, setCurrentFolderId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Filter by mode
  const modeFilter = useMemo(() => {
    const filters = {
      [FILE_PICKER_MODES.ALL]: () => true,
      [FILE_PICKER_MODES.IMAGES]: (f) => {
        const cat = f.typeCategory || getFileTypeCategory(f.extension);
        return cat === 'image';
      },
      [FILE_PICKER_MODES.DOCUMENTS]: (f) => {
        const cat = f.typeCategory || getFileTypeCategory(f.extension);
        return cat === 'document' || cat === 'spreadsheet' || cat === 'presentation';
      },
      [FILE_PICKER_MODES.MEDIA]: (f) => {
        const cat = f.typeCategory || getFileTypeCategory(f.extension);
        return cat === 'audio' || cat === 'video' || cat === 'image';
      },
    };
    return filters[mode] || filters[FILE_PICKER_MODES.ALL];
  }, [mode]);

  // Files in current folder filtered by mode + search
  const displayFiles = useMemo(() => {
    let files = activeFiles
      .filter(f => (f.folderId || null) === currentFolderId)
      .filter(modeFilter);

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      files = files.filter(f =>
        f.name.toLowerCase().includes(term) ||
        (f.extension || '').toLowerCase().includes(term) ||
        (f.tags || []).some(t => t.toLowerCase().includes(term))
      );
    }

    return files.sort((a, b) => a.name.localeCompare(b.name));
  }, [activeFiles, currentFolderId, modeFilter, searchTerm]);

  const foldersInView = useMemo(() => {
    return activeFolders
      .filter(f => (f.parentId || null) === currentFolderId && !f.deletedAt)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [activeFolders, currentFolderId]);

  // Breadcrumb path
  const breadcrumbPath = useMemo(() => {
    const path = [];
    let id = currentFolderId;
    let safety = 0;
    while (id && safety < 10) {
      const folder = activeFolders.find(f => f.id === id);
      if (!folder) break;
      path.unshift({ id: folder.id, name: folder.name });
      id = folder.parentId;
      safety++;
    }
    return path;
  }, [currentFolderId, activeFolders]);

  const handleToggleSelect = useCallback((file) => {
    if (multiple) {
      setSelectedFiles(prev => {
        const next = new Set(prev);
        if (next.has(file.id)) next.delete(file.id);
        else next.add(file.id);
        return next;
      });
    } else {
      setSelectedFiles(new Set([file.id]));
    }
  }, [multiple]);

  const handleConfirm = useCallback(() => {
    const selected = activeFiles.filter(f => selectedFiles.has(f.id));
    if (multiple) {
      onSelect?.(selected);
    } else {
      onSelect?.(selected[0] || null);
    }
    onClose?.();
  }, [selectedFiles, activeFiles, multiple, onSelect, onClose]);

  if (!isOpen) return null;

  return (
    <div className="file-picker-overlay" onClick={onClose} data-testid="file-picker-overlay">
      <div className="file-picker-modal" onClick={e => e.stopPropagation()} data-testid="file-picker-modal">
        <div className="file-picker-header">
          <h3 className="file-picker-title">{title}</h3>
          <button className="file-picker-close" onClick={onClose} data-testid="file-picker-close">✕</button>
        </div>

        {/* Breadcrumbs + Search */}
        <div className="file-picker-toolbar">
          <div className="file-picker-breadcrumbs">
            <button
              className="file-picker-crumb"
              onClick={() => setCurrentFolderId(null)}
            >
              Root
            </button>
            {breadcrumbPath.map(item => (
              <span key={item.id}>
                <span className="file-picker-crumb-sep">/</span>
                <button
                  className="file-picker-crumb"
                  onClick={() => setCurrentFolderId(item.id)}
                >
                  {item.name}
                </button>
              </span>
            ))}
          </div>
          <input
            className="file-picker-search"
            placeholder="Search files..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            data-testid="file-picker-search"
          />
        </div>

        {/* File list */}
        <div className="file-picker-body">
          {foldersInView.map(folder => (
            <div
              key={folder.id}
              className="file-picker-item file-picker-folder"
              onClick={() => setCurrentFolderId(folder.id)}
              data-testid={`picker-folder-${folder.id}`}
            >
              <span className="file-picker-folder-icon">{folder.icon || '📁'}</span>
              <span className="file-picker-item-name">{folder.name}</span>
            </div>
          ))}
          {displayFiles.map(file => (
            <div
              key={file.id}
              className={`file-picker-item file-picker-file ${selectedFiles.has(file.id) ? 'file-picker-file--selected' : ''}`}
              onClick={() => handleToggleSelect(file)}
              data-testid={`picker-file-${file.id}`}
            >
              {multiple && (
                <input
                  type="checkbox"
                  checked={selectedFiles.has(file.id)}
                  readOnly
                  className="file-picker-checkbox"
                />
              )}
              <FileTypeIcon extension={file.extension} size="sm" />
              <span className="file-picker-item-name">{file.name}</span>
              <span className="file-picker-item-size">{formatFileSize(file.sizeBytes)}</span>
            </div>
          ))}
          {foldersInView.length === 0 && displayFiles.length === 0 && (
            <div className="file-picker-empty">
              No files found
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="file-picker-footer">
          <span className="file-picker-selected-count">
            {selectedFiles.size > 0 ? `${selectedFiles.size} selected` : ''}
          </span>
          <div className="file-picker-footer-actions">
            <button className="file-picker-cancel" onClick={onClose} data-testid="file-picker-cancel">
              Cancel
            </button>
            <button
              className="file-picker-confirm"
              onClick={handleConfirm}
              disabled={selectedFiles.size === 0}
              data-testid="file-picker-confirm"
            >
              Select
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export { FILE_PICKER_MODES };
