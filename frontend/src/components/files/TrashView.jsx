/**
 * TrashView
 * 
 * Soft-deleted files and folders.
 * Shows days remaining before auto-delete.
 * Restore / Delete Forever. Admin sees all.
 * 
 * See docs/FILE_STORAGE_SPEC.md §5.6
 */

import { useMemo, useCallback, useState } from 'react';
import FileTypeIcon from './FileTypeIcon';
import { formatFileSize, getRelativeTime } from '../../utils/fileTypeCategories';
import { DEFAULT_AUTO_DELETE_DAYS } from '../../utils/fileStorageValidation';
import { useConfirmDialog } from '../common/ConfirmDialog';
import './TrashView.css';

export default function TrashView({
  trashedFiles,
  trashedFolders,
  role,
  userIdentity,
  settings,
  onRestoreFile,
  onPermanentlyDeleteFile,
  onRestoreFolder,
  onPermanentlyDeleteFolder,
  onEmptyTrash,
}) {
  const [selectedIds, setSelectedIds] = useState(new Set());
  const { confirm, ConfirmDialogComponent } = useConfirmDialog();
  const autoDeleteDays = settings?.autoDeleteDays ?? DEFAULT_AUTO_DELETE_DAYS;
  const canEdit = role === 'admin' || role === 'collaborator';

  const trashedItems = useMemo(() => {
    const files = (trashedFiles || []).map(f => ({ ...f, itemType: 'file' }));
    const folders = (trashedFolders || []).map(f => ({ ...f, itemType: 'folder' }));
    return [...files, ...folders].sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  }, [trashedFiles, trashedFolders]);

  const getDaysRemaining = useCallback((deletedAt) => {
    if (!deletedAt || !autoDeleteDays) return null;
    const elapsed = (Date.now() - deletedAt) / (1000 * 60 * 60 * 24);
    return Math.max(0, Math.ceil(autoDeleteDays - elapsed));
  }, [autoDeleteDays]);

  const handleRestore = useCallback((item) => {
    if (item.itemType === 'file') onRestoreFile?.(item.id);
    else onRestoreFolder?.(item.id);
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });
  }, [onRestoreFile, onRestoreFolder]);

  const handlePermanentDelete = useCallback(async (item) => {
    const confirmed = await confirm({
      title: 'Delete Forever',
      message: `Permanently delete "${item.name}"? This cannot be undone.`,
      confirmText: 'Delete Forever',
      variant: 'danger'
    });
    if (!confirmed) return;
    if (item.itemType === 'file') onPermanentlyDeleteFile?.(item.id);
    else onPermanentlyDeleteFolder?.(item.id);
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });
  }, [onPermanentlyDeleteFile, onPermanentlyDeleteFolder, confirm]);

  const handleEmptyTrash = useCallback(async () => {
    const confirmed = await confirm({
      title: 'Empty Trash',
      message: 'Permanently delete all items in trash? This cannot be undone.',
      confirmText: 'Empty Trash',
      variant: 'danger'
    });
    if (confirmed) onEmptyTrash?.();
  }, [onEmptyTrash, confirm]);

  const toggleSelect = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleBulkRestore = useCallback(() => {
    for (const item of trashedItems) {
      if (selectedIds.has(item.id)) handleRestore(item);
    }
    setSelectedIds(new Set());
  }, [selectedIds, trashedItems, handleRestore]);

  const handleBulkDelete = useCallback(async () => {
    const confirmed = await confirm({
      title: 'Delete Items',
      message: `Permanently delete ${selectedIds.size} items? This cannot be undone.`,
      confirmText: 'Delete All',
      variant: 'danger'
    });
    if (!confirmed) return;
    for (const item of trashedItems) {
      if (selectedIds.has(item.id)) {
        if (item.itemType === 'file') onPermanentlyDeleteFile?.(item.id);
        else onPermanentlyDeleteFolder?.(item.id);
      }
    }
    setSelectedIds(new Set());
  }, [selectedIds, trashedItems, onPermanentlyDeleteFile, onPermanentlyDeleteFolder, confirm]);

  return (
    <div className="trash-view" data-testid="trash-view">
      {ConfirmDialogComponent}
      <div className="trash-header">
        <div className="trash-header-left">
          <h3 className="trash-title">🗑️ Trash</h3>
          <span className="trash-count">{trashedItems.length} items</span>
        </div>
        <div className="trash-header-right">
          {canEdit && selectedIds.size > 0 && (
            <>
              <button className="trash-btn trash-btn--restore" onClick={handleBulkRestore} data-testid="trash-bulk-restore">
                Restore ({selectedIds.size})
              </button>
              <button className="trash-btn trash-btn--delete" onClick={handleBulkDelete} data-testid="trash-bulk-delete">
                Delete ({selectedIds.size})
              </button>
            </>
          )}
          {trashedItems.length > 0 && role === 'admin' && (
            <button className="trash-btn trash-btn--danger" onClick={handleEmptyTrash} data-testid="trash-empty">
              Empty Trash
            </button>
          )}
        </div>
      </div>

      {trashedItems.length === 0 ? (
        <div className="trash-empty" data-testid="trash-empty-state">
          <div className="trash-empty-icon">🗑️</div>
          <p>Trash is empty</p>
        </div>
      ) : (
        <div className="trash-list" data-testid="trash-list">
          <div className="trash-info-bar">
            Items in trash will be automatically deleted after {autoDeleteDays} days
          </div>
          {trashedItems.map(item => {
            const daysLeft = getDaysRemaining(item.deletedAt);
            return (
              <div
                key={item.id}
                className={`trash-row ${selectedIds.has(item.id) ? 'trash-row--selected' : ''}`}
                data-testid={`trash-item-${item.id}`}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(item.id)}
                  onChange={() => toggleSelect(item.id)}
                  className="trash-checkbox"
                  data-testid={`trash-check-${item.id}`}
                />
                {item.itemType === 'file' ? (
                  <FileTypeIcon extension={item.extension} size="sm" />
                ) : (
                  <span className="trash-folder-icon">📁</span>
                )}
                <span className="trash-name">{item.name}</span>
                {item.itemType === 'file' && (
                  <span className="trash-size">{formatFileSize(item.sizeBytes)}</span>
                )}
                <span className="trash-deleted">
                  Deleted {getRelativeTime(item.deletedAt)}
                </span>
                {daysLeft !== null && (
                  <span className={`trash-days ${daysLeft <= 3 ? 'trash-days--urgent' : ''}`}>
                    {daysLeft}d left
                  </span>
                )}
                <div className="trash-actions">
                  {canEdit && (
                    <>
                      <button className="trash-action-btn" onClick={() => handleRestore(item)} title="Restore" data-testid={`trash-restore-${item.id}`}>
                        ↩️
                      </button>
                      <button className="trash-action-btn trash-action-btn--danger" onClick={() => handlePermanentDelete(item)} title="Delete Forever" data-testid={`trash-perm-delete-${item.id}`}>
                        ❌
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
