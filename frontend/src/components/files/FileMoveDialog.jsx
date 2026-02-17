/**
 * FileMoveDialog
 * 
 * Modal with a folder tree picker for moving files/folders.
 * 
 * See docs/FILE_STORAGE_SPEC.md §5.5
 */

import { useState, useCallback, useEffect } from 'react';
import './FileMoveDialog.css';

function FolderTreeItem({ folder, folders, selectedId, onSelect, depth = 0 }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const children = folders.filter(f => f.parentId === folder.id && !f.deletedAt);
  const hasChildren = children.length > 0;

  return (
    <div className="move-tree-item">
      <button
        className={`move-tree-btn ${selectedId === folder.id ? 'move-tree-btn--selected' : ''}`}
        onClick={() => onSelect(folder.id)}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        data-testid={`move-tree-${folder.id}`}
      >
        {hasChildren && (
          <span
            className="move-tree-expand"
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          >
            {expanded ? '▾' : '▸'}
          </span>
        )}
        <span className="move-tree-icon">{folder.icon || '📁'}</span>
        <span className="move-tree-name">{folder.name}</span>
      </button>
      {expanded && hasChildren && children.map(child => (
        <FolderTreeItem
          key={child.id}
          folder={child}
          folders={folders}
          selectedId={selectedId}
          onSelect={onSelect}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

export default function FileMoveDialog({
  isOpen,
  onClose,
  onMove,
  item,            // { type: 'file'|'folder', id, name } — single item (legacy)
  items,           // [{ type, id, name }] — bulk mode (takes precedence over item)
  activeFolders,
}) {
  const [selectedFolderId, setSelectedFolderId] = useState(null);

  // Normalize to array
  const moveItems = items && items.length > 0 ? items : (item ? [item] : []);
  const isBulk = moveItems.length > 1;

  useEffect(() => {
    if (isOpen) setSelectedFolderId(null);
  }, [isOpen]);

  const handleMove = useCallback(() => {
    for (const mi of moveItems) {
      onMove?.(mi.id, selectedFolderId, mi.type);
    }
    onClose();
  }, [moveItems, selectedFolderId, onMove, onClose]);

  if (!isOpen || moveItems.length === 0) return null;

  // When moving folders, exclude them and their descendants to prevent circular references
  const excludedFolderIds = new Set();
  for (const mi of moveItems) {
    if (mi.type === 'folder') {
      const collectDescendants = (id) => {
        excludedFolderIds.add(id);
        (activeFolders || []).filter(f => f.parentId === id).forEach(f => collectDescendants(f.id));
      };
      collectDescendants(mi.id);
    }
  }

  const rootFolders = (activeFolders || []).filter(f => !f.parentId && !excludedFolderIds.has(f.id));

  return (
    <div className="move-dialog-overlay" onClick={onClose} data-testid="move-dialog-overlay">
      <div className="move-dialog" onClick={e => e.stopPropagation()} data-testid="move-dialog">
        <h3 className="move-dialog-title">
          {isBulk ? `Move ${moveItems.length} items` : `Move "${moveItems[0].name}"`}
        </h3>
        <p className="move-dialog-subtitle">Select destination folder:</p>

        <div className="move-dialog-tree">
          <button
            className={`move-tree-btn move-tree-root ${selectedFolderId === null ? 'move-tree-btn--selected' : ''}`}
            onClick={() => setSelectedFolderId(null)}
            data-testid="move-tree-root"
          >
            <span className="move-tree-icon">📁</span>
            <span className="move-tree-name">Root</span>
          </button>
          {rootFolders.map(folder => (
            <FolderTreeItem
              key={folder.id}
              folder={folder}
              folders={(activeFolders || []).filter(f => !excludedFolderIds.has(f.id))}
              selectedId={selectedFolderId}
              onSelect={setSelectedFolderId}
            />
          ))}
        </div>

        <div className="move-dialog-actions">
          <button className="move-dialog-cancel" onClick={onClose} data-testid="move-dialog-cancel">Cancel</button>
          <button className="move-dialog-submit" onClick={handleMove} data-testid="move-dialog-submit">
            Move Here
          </button>
        </div>
      </div>
    </div>
  );
}
