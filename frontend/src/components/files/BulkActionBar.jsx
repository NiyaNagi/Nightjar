/**
 * BulkActionBar
 * 
 * Floating toolbar shown when one or more items are selected.
 * Provides batch operations: Download, Move, Tags, Favorite, Delete.
 * 
 * See docs/FILE_STORAGE_SPEC.md §5
 */

import { useMemo } from 'react';
import './BulkActionBar.css';

export default function BulkActionBar({
  selectedItems,         // Set<string> of selected IDs
  files,                 // array of all visible file records
  folders,               // array of all visible folder records
  onDownload,            // (file) => void
  onDelete,              // () => void — triggers ConfirmDialog externally
  onMove,                // () => void — triggers FileMoveDialog externally
  onEditTags,            // () => void — triggers BulkTagDialog externally
  onToggleFavorite,      // (fileId) => void
  onClear,               // () => void — deselect all
  canEdit = true,        // false for viewers – hides write actions
}) {
  const count = selectedItems?.size || 0;

  const { selectedFileCount, selectedFolderCount } = useMemo(() => {
    if (!selectedItems || count === 0) return { selectedFileCount: 0, selectedFolderCount: 0 };
    let fc = 0;
    let dc = 0;
    const folderIds = new Set((folders || []).map(f => f.id));
    for (const id of selectedItems) {
      if (folderIds.has(id)) dc++;
      else fc++;
    }
    return { selectedFileCount: fc, selectedFolderCount: dc };
  }, [selectedItems, count, folders]);

  if (count === 0) return null;

  const hasFiles = selectedFileCount > 0;

  return (
    <div className="bulk-action-bar" role="toolbar" aria-label={`Bulk actions for ${count} selected items`} data-testid="bulk-action-bar">
      <div className="bulk-action-info">
        <span className="bulk-action-count" data-testid="bulk-action-count">
          {count} item{count !== 1 ? 's' : ''} selected
        </span>
        <button className="bulk-action-deselect" onClick={onClear} title="Deselect all" data-testid="bulk-action-deselect">
          ✕ Deselect
        </button>
      </div>
      <div className="bulk-action-buttons">
        {hasFiles && (
          <button className="bulk-action-btn" onClick={onDownload} title="Download selected files" data-testid="bulk-action-download">
            <span className="bulk-action-btn-icon">⬇️</span>
            <span className="bulk-action-btn-label">Download{selectedFileCount > 1 ? ` (${selectedFileCount})` : ''}</span>
          </button>
        )}
        {canEdit && (
          <button className="bulk-action-btn" onClick={onMove} title="Move selected items" data-testid="bulk-action-move">
            <span className="bulk-action-btn-icon">📦</span>
            <span className="bulk-action-btn-label">Move{count > 1 ? ` (${count})` : ''}</span>
          </button>
        )}
        {canEdit && hasFiles && (
          <button className="bulk-action-btn" onClick={onEditTags} title="Edit tags on selected files" data-testid="bulk-action-tags">
            <span className="bulk-action-btn-icon">🏷️</span>
            <span className="bulk-action-btn-label">Tags{selectedFileCount > 1 ? ` (${selectedFileCount})` : ''}</span>
          </button>
        )}
        {hasFiles && (
          <button className="bulk-action-btn" onClick={() => {
            for (const id of selectedItems) {
              // Only toggle files, not folders
              const isFolder = (folders || []).some(f => f.id === id);
              if (!isFolder) onToggleFavorite?.(id);
            }
          }} title="Toggle favorite on selected files" data-testid="bulk-action-favorite">
            <span className="bulk-action-btn-icon">⭐</span>
            <span className="bulk-action-btn-label">Favorite</span>
          </button>
        )}
        {canEdit && (
          <button className="bulk-action-btn bulk-action-btn--danger" onClick={onDelete} title="Delete selected items" data-testid="bulk-action-delete">
            <span className="bulk-action-btn-icon">🗑️</span>
            <span className="bulk-action-btn-label">Delete{count > 1 ? ` (${count})` : ''}</span>
          </button>
        )}
      </div>
    </div>
  );
}
