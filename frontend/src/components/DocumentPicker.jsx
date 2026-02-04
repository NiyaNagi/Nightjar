import React, { useState, useCallback, useRef } from 'react';
import { useFolders } from '../contexts/FolderContext';
import './DocumentPicker.css';

/**
 * Document Picker Sidebar
 * Shows folder tree and documents with share icons
 */
export function DocumentPicker({
  documents,
  activeDocId,
  onOpenDocument,
  onCreateDocument,
  onDeleteDocument,
  onShareDocument,
  onRenameDocument,
}) {
  const {
    folders,
    selectedFolderId,
    expandedFolders,
    setSelectedFolderId,
    createFolder,
    updateFolder,
    deleteFolder,
    moveDocumentToFolder,
    getFolderHierarchy,
    getDocumentsInFolder,
    toggleFolderExpand,
    getDocumentFolder,
  } = useFolders();

  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderParent, setNewFolderParent] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [dragOverFolderId, setDragOverFolderId] = useState(null);
  const inputRef = useRef(null);

  // Get documents for current folder
  const visibleDocuments = getDocumentsInFolder(selectedFolderId, documents);

  // Handle creating a new folder
  const handleCreateFolder = () => {
    if (newFolderName.trim()) {
      createFolder(newFolderName.trim(), newFolderParent);
      setNewFolderName('');
      setIsCreatingFolder(false);
      setNewFolderParent(null);
    }
  };

  // Handle context menu
  const handleContextMenu = (e, type, item) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      type,
      item,
    });
  };

  // Close context menu
  const closeContextMenu = () => setContextMenu(null);

  // Handle drag start
  const handleDragStart = (e, docId) => {
    e.dataTransfer.setData('text/plain', docId);
    e.dataTransfer.effectAllowed = 'move';
  };

  // Handle drop on folder
  const handleDrop = (e, folderId) => {
    e.preventDefault();
    const docId = e.dataTransfer.getData('text/plain');
    if (docId) {
      moveDocumentToFolder(docId, folderId);
    }
    setDragOverFolderId(null);
  };

  // Handle drag over
  const handleDragOver = (e, folderId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverFolderId(folderId);
  };

  // Handle drag leave
  const handleDragLeave = () => {
    setDragOverFolderId(null);
  };

  // Start renaming
  const startRename = (id, currentName, type) => {
    setRenamingId(id);
    setRenameValue(currentName);
    closeContextMenu();
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  // Finish renaming
  const finishRename = (type) => {
    if (renameValue.trim() && renamingId) {
      if (type === 'folder') {
        updateFolder(renamingId, { name: renameValue.trim() });
      } else if (type === 'document') {
        onRenameDocument?.(renamingId, renameValue.trim());
      }
    }
    setRenamingId(null);
    setRenameValue('');
  };

  // Render folder tree recursively
  const renderFolder = (folder, depth = 0) => {
    const isExpanded = expandedFolders.has(folder.id);
    const isSelected = selectedFolderId === folder.id;
    const isDragOver = dragOverFolderId === folder.id;
    const hasChildren = folders.some(f => f.parentId === folder.id);
    const isRenaming = renamingId === folder.id;

    return (
      <div key={folder.id} className="folder-item-container">
        <div
          className={`folder-item ${isSelected ? 'selected' : ''} ${isDragOver ? 'drag-over' : ''}`}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          onClick={() => setSelectedFolderId(folder.id)}
          onContextMenu={(e) => !folder.isSystem && handleContextMenu(e, 'folder', folder)}
          onDrop={(e) => handleDrop(e, folder.id)}
          onDragOver={(e) => handleDragOver(e, folder.id)}
          onDragLeave={handleDragLeave}
        >
          {hasChildren ? (
            <button
              className="folder-expand-btn"
              onClick={(e) => {
                e.stopPropagation();
                toggleFolderExpand(folder.id);
              }}
            >
              {isExpanded ? '▼' : '▶'}
            </button>
          ) : (
            <span className="folder-expand-spacer" />
          )}
          
          <span className="folder-icon">{folder.icon || '📁'}</span>
          
          {isRenaming ? (
            <input
              ref={inputRef}
              className="folder-rename-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => finishRename('folder')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') finishRename('folder');
                if (e.key === 'Escape') setRenamingId(null);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="folder-name">{folder.name}</span>
          )}
          
          {!folder.isSystem && (
            <button
              className="folder-add-subfolder"
              onClick={(e) => {
                e.stopPropagation();
                setNewFolderParent(folder.id);
                setIsCreatingFolder(true);
              }}
              title="Add subfolder"
            >
              +
            </button>
          )}
        </div>
        
        {isExpanded && hasChildren && (
          <div className="folder-children">
            {folders
              .filter(f => f.parentId === folder.id)
              .map(child => renderFolder(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // Render document item
  const renderDocument = (doc) => {
    const isActive = activeDocId === doc.id;
    const isRenaming = renamingId === doc.id;
    const docFolder = getDocumentFolder(doc.id);

    return (
      <div
        key={doc.id}
        className={`document-item ${isActive ? 'active' : ''}`}
        draggable
        onDragStart={(e) => handleDragStart(e, doc.id)}
        onClick={() => onOpenDocument(doc.id, doc.name)}
        onContextMenu={(e) => handleContextMenu(e, 'document', doc)}
      >
        <div className="document-icon">📝</div>
        
        <div className="document-info">
          {isRenaming ? (
            <input
              ref={inputRef}
              className="document-rename-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => finishRename('document')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') finishRename('document');
                if (e.key === 'Escape') setRenamingId(null);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <span className="document-name">{doc.name || 'Untitled'}</span>
              <span className="document-meta">
                {doc.lastEdited ? formatRelativeTime(doc.lastEdited) : 'Never edited'}
                {doc.authorCount > 1 && ` · ${doc.authorCount} authors`}
              </span>
            </>
          )}
        </div>
        
        <button
          className="document-share-btn"
          onClick={(e) => {
            e.stopPropagation();
            onShareDocument(doc.id, doc.name);
          }}
          title="Share document"
          data-testid={`share-doc-${doc.id}`}
        >
          📤
        </button>
      </div>
    );
  };

  return (
    <div className="document-picker">
      {/* Header */}
      <div className="picker-header">
        <h3>Documents</h3>
        <button
          className="new-doc-btn"
          onClick={() => onCreateDocument()}
          title="Create new document"
        >
          + New
        </button>
      </div>

      {/* Folder Tree */}
      <div className="folder-tree">
        {folders
          .filter(f => f.parentId === null)
          .map(folder => renderFolder(folder))}
        
        {/* New Folder Input */}
        {isCreatingFolder && (
          <div className="new-folder-input" style={{ paddingLeft: newFolderParent ? '28px' : '12px' }}>
            <span className="folder-icon">📁</span>
            <input
              autoFocus
              placeholder="Folder name..."
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onBlur={() => {
                if (!newFolderName.trim()) {
                  setIsCreatingFolder(false);
                  setNewFolderParent(null);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFolder();
                if (e.key === 'Escape') {
                  setIsCreatingFolder(false);
                  setNewFolderParent(null);
                }
              }}
            />
          </div>
        )}
        
        {/* Add Folder Button */}
        <button
          className="add-folder-btn"
          onClick={() => {
            setNewFolderParent(null);
            setIsCreatingFolder(true);
          }}
        >
          + New Folder
        </button>
      </div>

      {/* Divider */}
      <div className="picker-divider" />

      {/* Document List */}
      <div className="document-list">
        <div className="document-list-header">
          <span className="folder-path">
            {selectedFolderId === 'all' ? 'All Documents' : 
             selectedFolderId === 'recent' ? 'Recent' :
             selectedFolderId === 'shared' ? 'Shared with Me' :
             folders.find(f => f.id === selectedFolderId)?.name || 'Documents'}
          </span>
          <span className="document-count">{visibleDocuments.length}</span>
        </div>
        
        {visibleDocuments.length === 0 ? (
          <div className="no-documents">
            <p>No documents in this folder</p>
            <button onClick={() => onCreateDocument()}>Create one</button>
          </div>
        ) : (
          visibleDocuments.map(renderDocument)
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div className="context-menu-overlay" onClick={closeContextMenu} />
          <div
            className="context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {contextMenu.type === 'folder' && (
              <>
                <button onClick={() => startRename(contextMenu.item.id, contextMenu.item.name, 'folder')}>
                  ✏️ Rename
                </button>
                <button onClick={() => {
                  setNewFolderParent(contextMenu.item.id);
                  setIsCreatingFolder(true);
                  closeContextMenu();
                }}>
                  📁 Add Subfolder
                </button>
                <button className="danger" onClick={() => {
                  deleteFolder(contextMenu.item.id);
                  closeContextMenu();
                }}>
                  🗑️ Delete
                </button>
              </>
            )}
            {contextMenu.type === 'document' && (
              <>
                <button onClick={() => startRename(contextMenu.item.id, contextMenu.item.name, 'document')}>
                  ✏️ Rename
                </button>
                <button onClick={() => {
                  onShareDocument(contextMenu.item.id, contextMenu.item.name);
                  closeContextMenu();
                }}>
                  📤 Share
                </button>
                <button onClick={() => {
                  moveDocumentToFolder(contextMenu.item.id, null);
                  closeContextMenu();
                }}>
                  📂 Move to Root
                </button>
                <button className="danger" onClick={() => {
                  onDeleteDocument(contextMenu.item.id);
                  closeContextMenu();
                }}>
                  🗑️ Delete
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Helper: Format relative time
function formatRelativeTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  
  if (diff < minute) return 'Just now';
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < week) return `${Math.floor(diff / day)}d ago`;
  
  return new Date(timestamp).toLocaleDateString();
}

export default DocumentPicker;
