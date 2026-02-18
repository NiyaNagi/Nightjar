/**
 * BrowseView
 * 
 * Main browse/explorer container. Composes:
 * UploadZone, SearchBar, SearchFilters, Breadcrumbs, ViewModeToggle,
 * FolderCards, FileCards, FileContextMenu, FileDetailPanel,
 * FolderCreateDialog, FileMoveDialog, ReplaceDialog, UploadProgress,
 * BulkActionBar, BulkTagDialog, ConfirmDialog.
 * 
 * Manages currentFolderId, viewMode, selectedItems, sort, filter state.
 * Supports shift-click range selection, ctrl-click toggle, drag-lasso,
 * select-all checkbox, keyboard shortcuts, and bulk operations.
 * 
 * See docs/FILE_STORAGE_SPEC.md §5
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import UploadZone from './UploadZone';
import UploadProgress from './UploadProgress';
import Breadcrumbs from './Breadcrumbs';
import { VIEW_MODES } from './ViewModeToggle';
import ViewModeToggle from './ViewModeToggle';
import SearchBar from './SearchBar';
import SearchFilters, { applyFilters } from './SearchFilters';
import FileCard from './FileCard';
import FolderCard from './FolderCard';
import FileContextMenu from './FileContextMenu';
import FileDetailPanel from './FileDetailPanel';
import FolderCreateDialog from './FolderCreateDialog';
import FileMoveDialog from './FileMoveDialog';
import ReplaceDialog from './ReplaceDialog';
import BulkActionBar from './BulkActionBar';
import BulkTagDialog from './BulkTagDialog';
import ConfirmDialog from './ConfirmDialog';
import useDragSelect from '../../hooks/useDragSelect';
import { fileExistsInFolder } from '../../utils/fileStorageValidation';
import './BrowseView.css';

const SORT_FIELDS = {
  NAME: 'name',
  SIZE: 'sizeBytes',
  DATE: 'createdAt',
  TYPE: 'typeCategory',
};

export default function BrowseView({
  activeFiles,
  activeFolders,
  chunkAvailability,
  userPublicKey,
  userIdentity,
  role,
  uploads,
  onUploadFiles,
  onClearUpload,
  onClearCompletedUploads,
  onDownloadFile,
  onUpdateFile,
  onDeleteFile,
  onToggleFavorite,
  onCreateFolder,
  onUpdateFolder,
  onDeleteFolder,
  onMoveFile,
  onMoveFolder,
  collaborators,
  favoriteIds,
  onStartChatWith,
}) {
  const [currentFolderId, setCurrentFolderId] = useState(null);
  const [viewMode, setViewMode] = useState(VIEW_MODES.GRID);
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [sortField, setSortField] = useState(SORT_FIELDS.NAME);
  const [sortDir, setSortDir] = useState('asc');
  const [filters, setFilters] = useState({});
  const [contextMenu, setContextMenu] = useState(null);
  const [detailFile, setDetailFile] = useState(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [moveItem, setMoveItem] = useState(null);
  const [replaceInfo, setReplaceInfo] = useState(null);
  const [showBulkTagDialog, setShowBulkTagDialog] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [renameItem, setRenameItem] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const pendingUploadRef = useRef(null);
  const lastSelectedRef = useRef(null);
  const browseItemsRef = useRef(null);

  // Files in current folder
  const filesInFolder = useMemo(() => {
    return activeFiles.filter(f => (f.folderId || null) === currentFolderId);
  }, [activeFiles, currentFolderId]);

  // Apply search/filter
  const filteredFiles = useMemo(() => {
    return applyFilters(filesInFolder, filters);
  }, [filesInFolder, filters]);

  // Sort files
  const sortedFiles = useMemo(() => {
    const arr = [...filteredFiles];
    arr.sort((a, b) => {
      let va = a[sortField] ?? '';
      let vb = b[sortField] ?? '';
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      let cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return arr;
  }, [filteredFiles, sortField, sortDir]);

  // Folders in current folder
  const foldersInFolder = useMemo(() => {
    return activeFolders.filter(f => (f.parentId || null) === currentFolderId);
  }, [activeFolders, currentFolderId]);

  // Navigate to folder
  const navigateToFolder = useCallback((folderId) => {
    setCurrentFolderId(folderId);
    setSelectedItems(new Set());
    lastSelectedRef.current = null;
  }, []);

  // Combined ordered list of visible items (for shift-range selection)
  const allVisibleIds = useMemo(() => {
    return [...foldersInFolder.map(f => f.id), ...sortedFiles.map(f => f.id)];
  }, [foldersInFolder, sortedFiles]);

  // File selection with shift-range and ctrl-toggle support
  const handleSelectFile = useCallback((fileId, opts = {}) => {
    const { ctrl = false, shift = false } = typeof opts === 'object' ? opts : { ctrl: opts, shift: false };

    // Capture lastSelected BEFORE setting the ref, since setSelectedItems
    // updater function runs asynchronously during render and would read
    // the already-updated ref.
    const lastSelected = lastSelectedRef.current;

    setSelectedItems(prev => {
      if (shift && lastSelected) {
        // Shift-click: select range from last selected to current
        const lastIdx = allVisibleIds.indexOf(lastSelected);
        const curIdx = allVisibleIds.indexOf(fileId);
        if (lastIdx >= 0 && curIdx >= 0) {
          const start = Math.min(lastIdx, curIdx);
          const end = Math.max(lastIdx, curIdx);
          const next = new Set(prev);
          for (let i = start; i <= end; i++) {
            next.add(allVisibleIds[i]);
          }
          return next;
        }
        // lastSelected was filtered out – fall through to plain-click
      }
      if (ctrl) {
        // Ctrl-click: toggle single item in existing set
        const next = new Set(prev);
        if (next.has(fileId)) next.delete(fileId);
        else next.add(fileId);
        return next;
      }
      // Plain click: clear and select only this item
      return new Set([fileId]);
    });
    lastSelectedRef.current = fileId;
  }, [allVisibleIds]);

  // Select all visible items
  const handleSelectAll = useCallback(() => {
    if (selectedItems.size === allVisibleIds.length && allVisibleIds.length > 0) {
      setSelectedItems(new Set());
      lastSelectedRef.current = null;
    } else {
      setSelectedItems(new Set(allVisibleIds));
    }
  }, [selectedItems, allVisibleIds]);

  // Deselect all
  const handleDeselectAll = useCallback(() => {
    setSelectedItems(new Set());
    lastSelectedRef.current = null;
  }, []);

  // Drag-select integration
  const handleDragSelection = useCallback((ids, additive) => {
    setSelectedItems(prev => {
      if (additive) {
        const next = new Set(prev);
        for (const id of ids) next.add(id);
        return next;
      }
      return ids;
    });
  }, []);

  useDragSelect({
    containerRef: browseItemsRef,
    itemSelector: '[data-testid^="fs-file-"], [data-testid^="fs-folder-"]',
    onSelectionChange: handleDragSelection,
    enabled: true,
  });

  // Compute selected file/folder breakdowns for bulk-aware components
  const folderIdSet = useMemo(() => new Set(foldersInFolder.map(f => f.id)), [foldersInFolder]);
  const selectedFileCount = useMemo(() => {
    let count = 0;
    for (const id of selectedItems) {
      if (!folderIdSet.has(id)) count++;
    }
    return count;
  }, [selectedItems, folderIdSet]);
  const selectedFolderCount = useMemo(() => {
    let count = 0;
    for (const id of selectedItems) {
      if (folderIdSet.has(id)) count++;
    }
    return count;
  }, [selectedItems, folderIdSet]);

  // Get selected file objects for bulk tag dialog
  const selectedFileObjects = useMemo(() => {
    return sortedFiles.filter(f => selectedItems.has(f.id));
  }, [sortedFiles, selectedItems]);

  // --- Bulk action handlers ---

  const handleBulkDownload = useCallback(() => {
    for (const file of selectedFileObjects) {
      onDownloadFile?.(file);
    }
  }, [selectedFileObjects, onDownloadFile]);

  const handleBulkDeleteRequest = useCallback(() => {
    const count = selectedItems.size;
    if (count === 0) return;
    setConfirmDialog({
      title: 'Delete Items',
      message: `Are you sure you want to delete ${count} item${count !== 1 ? 's' : ''}? They will be moved to trash.`,
      confirmLabel: 'Delete',
      variant: 'danger',
      onConfirm: () => {
        for (const id of selectedItems) {
          if (folderIdSet.has(id)) onDeleteFolder?.(id);
          else onDeleteFile?.(id);
        }
        setSelectedItems(new Set());
        lastSelectedRef.current = null;
        setConfirmDialog(null);
      },
    });
  }, [selectedItems, folderIdSet, onDeleteFile, onDeleteFolder]);

  const handleBulkMoveRequest = useCallback(() => {
    if (selectedItems.size === 0) return;
    const moveItems = [];
    for (const id of selectedItems) {
      if (folderIdSet.has(id)) {
        const folder = foldersInFolder.find(f => f.id === id);
        if (folder) moveItems.push({ type: 'folder', id, name: folder.name });
      } else {
        const file = sortedFiles.find(f => f.id === id);
        if (file) moveItems.push({ type: 'file', id, name: file.name });
      }
    }
    setMoveItem(moveItems.length === 1 ? moveItems[0] : moveItems);
  }, [selectedItems, folderIdSet, foldersInFolder, sortedFiles]);

  const handleBulkFavorite = useCallback(() => {
    for (const id of selectedItems) {
      if (!folderIdSet.has(id)) onToggleFavorite?.(id);
    }
  }, [selectedItems, folderIdSet, onToggleFavorite]);

  // --- Keyboard shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't intercept when user is typing in inputs
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

      const isCtrl = e.ctrlKey || e.metaKey;

      // Ctrl+A — select all
      if (isCtrl && e.key === 'a') {
        e.preventDefault();
        handleSelectAll();
        return;
      }

      // Escape — deselect all (only if items selected)
      if (e.key === 'Escape' && selectedItems.size > 0) {
        e.preventDefault();
        handleDeselectAll();
        return;
      }

      // Delete — bulk delete
      if (e.key === 'Delete' && selectedItems.size > 0) {
        e.preventDefault();
        handleBulkDeleteRequest();
        return;
      }

      // Ctrl+D — bulk download
      if (isCtrl && e.key === 'd' && selectedItems.size > 0 && selectedFileCount > 0) {
        e.preventDefault();
        handleBulkDownload();
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleSelectAll, handleDeselectAll, handleBulkDeleteRequest, handleBulkDownload, selectedItems]);

  // Upload handling with collision detection
  const handleFilesSelected = useCallback((files) => {
    const fileList = Array.from(files);
    for (const f of fileList) {
      if (fileExistsInFolder(f.name, currentFolderId, activeFiles)) {
        pendingUploadRef.current = { file: f, folderId: currentFolderId, remaining: fileList.filter(x => x !== f) };
        setReplaceInfo({ fileName: f.name });
        return;
      }
    }
    onUploadFiles?.(fileList, currentFolderId);
  }, [currentFolderId, activeFiles, onUploadFiles]);

  const handleReplace = useCallback(() => {
    const pending = pendingUploadRef.current;
    if (pending) {
      onUploadFiles?.([pending.file], pending.folderId, { replace: true });
      if (pending.remaining?.length) {
        handleFilesSelected(pending.remaining);
      }
    }
    pendingUploadRef.current = null;
    setReplaceInfo(null);
  }, [onUploadFiles, handleFilesSelected]);

  const handleKeepBoth = useCallback(() => {
    const pending = pendingUploadRef.current;
    if (pending) {
      onUploadFiles?.([pending.file], pending.folderId, { keepBoth: true });
      if (pending.remaining?.length) {
        handleFilesSelected(pending.remaining);
      }
    }
    pendingUploadRef.current = null;
    setReplaceInfo(null);
  }, [onUploadFiles, handleFilesSelected]);

  // Context menu — bulk-aware
  const handleContextMenu = useCallback((e, target) => {
    e.preventDefault();
    // If right-clicked item is already selected, show bulk context menu
    const isBulk = selectedItems.has(target.item.id) && selectedItems.size > 1;
    setContextMenu({ position: { x: e.clientX, y: e.clientY }, target, isBulk });
    // If right-clicked item is NOT selected, select it (replace selection)
    if (!selectedItems.has(target.item.id)) {
      setSelectedItems(new Set([target.item.id]));
      lastSelectedRef.current = target.item.id;
    }
  }, [selectedItems]);

  const handleContextAction = useCallback((action) => {
    const target = contextMenu?.target;
    if (!target) return;
    const isBulk = contextMenu?.isBulk;

    if (isBulk) {
      // Bulk context actions
      switch (action) {
        case 'download':
          handleBulkDownload();
          break;
        case 'move':
          handleBulkMoveRequest();
          break;
        case 'tags':
          setShowBulkTagDialog(true);
          break;
        case 'favorite':
          handleBulkFavorite();
          break;
        case 'delete':
          handleBulkDeleteRequest();
          break;
      }
    } else {
      // Single-item context actions
      switch (action) {
        case 'download':
          onDownloadFile?.(target.item);
          break;
        case 'rename': {
          setRenameItem({ type: target.type, item: target.item });
          break;
        }
        case 'move':
          setMoveItem({ type: target.type, id: target.item.id, name: target.item.name });
          break;
        case 'tags':
        case 'properties':
        case 'details':
          if (target.type === 'file') setDetailFile(target.item);
          break;
        case 'favorite':
          if (target.type === 'file') onToggleFavorite?.(target.item.id);
          break;
        case 'delete':
          setConfirmDialog({
            title: 'Delete Item',
            message: `Are you sure you want to delete "${target.item.name}"? It will be moved to trash.`,
            confirmLabel: 'Delete',
            onConfirm: () => {
              if (target.type === 'file') onDeleteFile?.(target.item.id);
              else onDeleteFolder?.(target.item.id);
              setConfirmDialog(null);
            },
          });
          break;
      }
    }
    setContextMenu(null);
  }, [contextMenu, onDownloadFile, onUpdateFile, onUpdateFolder, onDeleteFile, onDeleteFolder, onToggleFavorite, handleBulkDownload, handleBulkMoveRequest, handleBulkFavorite, handleBulkDeleteRequest]);

  // Initialize rename value when rename dialog opens
  useEffect(() => {
    if (renameItem) setRenameValue(renameItem.item.name);
  }, [renameItem]);

  // Handle rename submit
  const handleRenameSubmit = useCallback(() => {
    if (!renameItem || !renameValue?.trim()) return;
    const trimmed = renameValue.trim();
    if (trimmed.length > 255 || /[\/\\:*?"<>|]/.test(trimmed)) return;
    if (trimmed === renameItem.item.name) { setRenameItem(null); return; } // No-op if name unchanged
    if (renameItem.type === 'file') onUpdateFile?.(renameItem.item.id, { name: trimmed });
    else onUpdateFolder?.(renameItem.item.id, { name: trimmed });
    setRenameItem(null);
  }, [renameItem, renameValue, onUpdateFile, onUpdateFolder]);

  // Move (supports single and bulk)
  const handleMove = useCallback((id, destFolderId, type) => {
    if (type === 'file') onMoveFile?.(id, destFolderId);
    else onMoveFolder?.(id, destFolderId);
    setMoveItem(null);
    setSelectedItems(new Set());
    lastSelectedRef.current = null;
  }, [onMoveFile, onMoveFolder]);

  // Drop file onto folder
  const handleFileDrop = useCallback((itemId, folderId, type) => {
    if (type === 'file') {
      onMoveFile?.(itemId, folderId);
    } else if (type === 'folder') {
      // Prevent circular nesting: check if folderId is a descendant of itemId
      let current = folderId;
      const visited = new Set();
      while (current) {
        if (current === itemId) return; // Would create cycle
        if (visited.has(current)) break;
        visited.add(current);
        const parent = activeFolders.find(f => f.id === current);
        current = parent?.parentId || null;
      }
      onMoveFolder?.(itemId, folderId);
    }
    // Clear moved item from selection
    setSelectedItems(prev => {
      if (prev.has(itemId)) {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      }
      return prev;
    });
  }, [onMoveFile, onMoveFolder, activeFolders]);

  // Sort toggle
  const handleSortChange = useCallback((field) => {
    if (field === sortField) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }, [sortField]);

  const fileCountInFolder = useCallback((folderId) => {
    return activeFiles.filter(f => f.folderId === folderId).length;
  }, [activeFiles]);

  const canEdit = role === 'admin' || role === 'collaborator';
  const isAdmin = role === 'admin';

  return (
    <div className="browse-view" data-testid="browse-view">
      {/* Toolbar */}
      <div className="browse-toolbar">
        <div className="browse-toolbar-left">
          <input
            type="checkbox"
            className="browse-select-all"
            checked={allVisibleIds.length > 0 && selectedItems.size === allVisibleIds.length}
            ref={el => {
              if (el) {
                el.indeterminate = selectedItems.size > 0 && selectedItems.size < allVisibleIds.length;
              }
            }}
            onChange={handleSelectAll}
            title={selectedItems.size === allVisibleIds.length ? 'Deselect all' : 'Select all'}
            aria-label="Select all items"
            data-testid="browse-select-all"
          />
          <Breadcrumbs
            currentFolderId={currentFolderId}
            folders={activeFolders}
            onNavigate={navigateToFolder}
          />
        </div>
        <div className="browse-toolbar-right">
          <SearchBar
            files={activeFiles}
            folders={activeFolders}
            onSelectFile={(f) => setDetailFile(f)}
            onSelectFolder={(f) => navigateToFolder(f.id)}
            onSearch={(term) => setFilters(prev => ({ ...prev, search: term }))}
          />
          <ViewModeToggle viewMode={viewMode} onViewModeChange={setViewMode} />
          {canEdit && (
            <>
              <button className="browse-btn" onClick={() => setShowNewFolder(true)} title="New Folder" data-testid="btn-new-folder">
                📁+
              </button>
              <UploadZone.TriggerButton onClick={() => document.querySelector('[data-testid="upload-zone-input"]')?.click()} />
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <SearchFilters filters={filters} onFiltersChange={setFilters} />

      {/* Sort bar (table/compact) */}
      {viewMode !== VIEW_MODES.GRID && (
        <div className="browse-sort-bar">
          <span className="browse-sort-label" onClick={() => handleSortChange(SORT_FIELDS.NAME)} data-testid="sort-name">
            Name {sortField === SORT_FIELDS.NAME ? (sortDir === 'asc' ? '▲' : '▼') : ''}
          </span>
          <span className="browse-sort-label" onClick={() => handleSortChange(SORT_FIELDS.SIZE)} data-testid="sort-size">
            Size {sortField === SORT_FIELDS.SIZE ? (sortDir === 'asc' ? '▲' : '▼') : ''}
          </span>
          <span className="browse-sort-label" onClick={() => handleSortChange(SORT_FIELDS.TYPE)} data-testid="sort-type">
            Type {sortField === SORT_FIELDS.TYPE ? (sortDir === 'asc' ? '▲' : '▼') : ''}
          </span>
          <span className="browse-sort-label" onClick={() => handleSortChange(SORT_FIELDS.DATE)} data-testid="sort-date">
            Date {sortField === SORT_FIELDS.DATE ? (sortDir === 'asc' ? '▲' : '▼') : ''}
          </span>
        </div>
      )}

      {/* Main content */}
      <UploadZone
        onFilesSelected={handleFilesSelected}
        disabled={!canEdit}
        className="browse-content"
      >
        {foldersInFolder.length === 0 && sortedFiles.length === 0 ? (
          <div className="browse-empty" data-testid="browse-empty">
            <div className="browse-empty-icon">📂</div>
            <p className="browse-empty-text">
              {currentFolderId ? 'This folder is empty' : 'No files yet'}
            </p>
            {canEdit && (
              <p className="browse-empty-hint">
                Drag & drop files here or click the upload button
              </p>
            )}
          </div>
        ) : (
          viewMode === 'table' ? (
            <table ref={browseItemsRef} className={`browse-items browse-items--${viewMode}`} data-testid="browse-items">
              <tbody>
                {/* Folders first */}
                {foldersInFolder.map(folder => (
                  <FolderCard
                    key={folder.id}
                    folder={folder}
                    fileCount={fileCountInFolder(folder.id)}
                    viewMode={viewMode}
                    isSelected={selectedItems.has(folder.id)}
                    onSelect={(id, multi) => handleSelectFile(id, multi)}
                    onClick={(f) => navigateToFolder(f.id)}
                    onContextMenu={handleContextMenu}
                    onFileDrop={handleFileDrop}
                  />
                ))}
                {/* Files */}
                {sortedFiles.map(file => (
                  <FileCard
                    key={file.id}
                    file={file}
                    viewMode={viewMode}
                    chunkAvailability={chunkAvailability}
                    userPublicKey={userPublicKey}
                    isFavorite={favoriteIds?.has(file.id)}
                    isSelected={selectedItems.has(file.id)}
                    onSelect={handleSelectFile}
                    onClick={(f) => setDetailFile(f)}
                    onContextMenu={handleContextMenu}
                    onToggleFavorite={onToggleFavorite}
                  />
                ))}
              </tbody>
            </table>
          ) : (
            <div ref={browseItemsRef} className={`browse-items browse-items--${viewMode}`} data-testid="browse-items">
              {/* Folders first */}
              {foldersInFolder.map(folder => (
                <FolderCard
                  key={folder.id}
                  folder={folder}
                  fileCount={fileCountInFolder(folder.id)}
                  viewMode={viewMode}
                  isSelected={selectedItems.has(folder.id)}
                  onSelect={(id, multi) => handleSelectFile(id, multi)}
                  onClick={(f) => navigateToFolder(f.id)}
                  onContextMenu={handleContextMenu}
                  onFileDrop={handleFileDrop}
                />
              ))}
              {/* Files */}
              {sortedFiles.map(file => (
                <FileCard
                  key={file.id}
                  file={file}
                  viewMode={viewMode}
                  chunkAvailability={chunkAvailability}
                  userPublicKey={userPublicKey}
                  isFavorite={favoriteIds?.has(file.id)}
                  isSelected={selectedItems.has(file.id)}
                  onSelect={handleSelectFile}
                  onClick={(f) => setDetailFile(f)}
                  onContextMenu={handleContextMenu}
                  onToggleFavorite={onToggleFavorite}
                />
              ))}
            </div>
          )
        )}
      </UploadZone>

      {/* Upload progress */}
      {uploads?.length > 0 && (
        <UploadProgress
          uploads={uploads}
          onClear={onClearUpload}
          onClearCompleted={onClearCompletedUploads}
        />
      )}

      {/* Bulk Action Bar */}
      <BulkActionBar
        selectedItems={selectedItems}
        files={sortedFiles}
        folders={foldersInFolder}
        onDownload={handleBulkDownload}
        onDelete={handleBulkDeleteRequest}
        onMove={handleBulkMoveRequest}
        onEditTags={() => setShowBulkTagDialog(true)}
        onToggleFavorite={onToggleFavorite}
        onClear={handleDeselectAll}
        canEdit={canEdit}
      />

      {/* Context Menu */}
      <FileContextMenu
        isOpen={!!contextMenu}
        position={contextMenu?.position}
        target={contextMenu?.target}
        onClose={() => setContextMenu(null)}
        onAction={handleContextAction}
        isAdmin={isAdmin}
        canEdit={canEdit}
        isBulk={contextMenu?.isBulk || false}
        selectedCount={contextMenu?.isBulk ? selectedItems.size : 0}
        selectedFileCount={contextMenu?.isBulk ? selectedFileCount : 0}
      />

      {/* Detail Panel */}
      <FileDetailPanel
        file={detailFile}
        isOpen={!!detailFile}
        onClose={() => setDetailFile(null)}
        chunkAvailability={chunkAvailability}
        userPublicKey={userPublicKey}
        onUpdateFile={onUpdateFile}
        onDownload={onDownloadFile}
        onDelete={(id) => { onDeleteFile?.(id); setDetailFile(null); }}
        onToggleFavorite={onToggleFavorite}
        collaborators={collaborators}
        isFavorite={detailFile ? favoriteIds?.has(detailFile.id) : false}
        onStartChatWith={onStartChatWith}
        canEdit={canEdit}
      />

      {/* Folder Create Dialog */}
      <FolderCreateDialog
        isOpen={showNewFolder}
        onClose={() => setShowNewFolder(false)}
        onCreateFolder={onCreateFolder}
        parentId={currentFolderId}
        allFolders={activeFolders}
      />

      {/* Move Dialog */}
      <FileMoveDialog
        isOpen={!!moveItem}
        onClose={() => setMoveItem(null)}
        onMove={handleMove}
        item={Array.isArray(moveItem) ? null : moveItem}
        items={Array.isArray(moveItem) ? moveItem : null}
        activeFolders={activeFolders}
      />

      {/* Replace Dialog */}
      <ReplaceDialog
        isOpen={!!replaceInfo}
        fileName={replaceInfo?.fileName}
        onReplace={handleReplace}
        onKeepBoth={handleKeepBoth}
        onCancel={() => { pendingUploadRef.current = null; setReplaceInfo(null); }}
      />

      {/* Bulk Tag Dialog */}
      <BulkTagDialog
        isOpen={showBulkTagDialog}
        selectedFiles={selectedFileObjects}
        onApply={(fileId, updates) => onUpdateFile?.(fileId, updates)}
        onClose={() => setShowBulkTagDialog(false)}
      />

      {/* Confirm Dialog (bulk delete, etc.) */}
      <ConfirmDialog
        isOpen={!!confirmDialog}
        title={confirmDialog?.title}
        message={confirmDialog?.message}
        confirmLabel={confirmDialog?.confirmLabel}
        variant={confirmDialog?.variant}
        onConfirm={confirmDialog?.onConfirm}
        onCancel={() => setConfirmDialog(null)}
      />

      {/* Rename Dialog */}
      {renameItem && (
        <div className="confirm-dialog-overlay" onClick={(e) => e.target === e.currentTarget && setRenameItem(null)} data-testid="rename-dialog-overlay">
          <div className="confirm-dialog" role="dialog" aria-labelledby="rename-dialog-title" data-testid="rename-dialog">
            <h3 id="rename-dialog-title" className="confirm-dialog-title">Rename {renameItem.type === 'file' ? 'File' : 'Folder'}</h3>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') setRenameItem(null); }}
              autoFocus
              className="confirm-dialog-input"
              style={{ width: '100%', padding: '8px', marginTop: '8px', boxSizing: 'border-box', background: 'var(--bg-secondary, #2a2a2a)', color: 'var(--text-primary, #fff)', border: '1px solid var(--border-color, #444)', borderRadius: '4px' }}
              data-testid="rename-input"
            />
            <div className="confirm-dialog-actions" style={{ marginTop: '12px' }}>
              <button className="confirm-dialog-btn confirm-dialog-btn--cancel" onClick={() => setRenameItem(null)}>Cancel</button>
              <button className="confirm-dialog-btn confirm-dialog-btn--default" onClick={handleRenameSubmit} disabled={!renameValue?.trim()}>Rename</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
