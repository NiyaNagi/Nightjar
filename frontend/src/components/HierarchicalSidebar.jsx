/**
 * HierarchicalSidebar Component
 * 
 * New sidebar design with clear hierarchy:
 * - Workspace dropdown at top (required)
 * - Tree view showing: Folders (expandable) + Root Documents
 * - Documents can exist at workspace root or inside folders
 * - All items collapsed by default
 */

import React, { useState, useCallback, useMemo } from 'react';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import CreateFolder from './CreateFolder';
import CreateWorkspace from './CreateWorkspace';
import WorkspaceSettings from './WorkspaceSettings';
import { AppSettings, useConfirmDialog } from './common';
import { IfPermitted } from './PermissionGuard';
import { usePermissions } from '../contexts/PermissionContext';
import { useWorkspaces } from '../contexts/WorkspaceContext';
import { ensureContrastWithWhite } from '../utils/colorUtils';
import './HierarchicalSidebar.css';

/**
 * Single tree item (folder or document)
 */
function TreeItem({ 
    item, 
    type, // 'folder' or 'document'
    level = 0,
    isSelected,
    isExpanded,
    hasChildren,
    onSelect,
    onToggle,
    onRequestDelete, // Async function that returns true if confirmed
    onRequestRename, // Function to start renaming (id, type, currentName)
    isRenaming, // Whether this item is currently being renamed
    renameValue, // Current rename input value
    onRenameChange, // Handle rename input change
    onRenameSubmit, // Submit the rename
    onRenameCancel, // Cancel renaming
    onContextMenu,
    onDocumentDrop, // Callback when a document is dropped on this folder
    children,
    collaborators = [],
    workspaceColor, // Color of the workspace for system folders
}) {
    const [isDragOver, setIsDragOver] = useState(false);
    
    const handleDragOver = (e) => {
        if (type === 'folder') {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setIsDragOver(true);
        }
    };
    
    const handleDragLeave = (e) => {
        // Only reset if leaving the element itself, not child elements
        if (!e.currentTarget.contains(e.relatedTarget)) {
            setIsDragOver(false);
        }
    };
    
    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        // Handle document drop onto folder
        const docId = e.dataTransfer.getData('documentId');
        if (docId && type === 'folder' && onDocumentDrop) {
            onDocumentDrop(docId, item.id);
        }
    };
    
    const handleDragStart = (e) => {
        if (type === 'document') {
            e.dataTransfer.setData('documentId', item.id);
            e.dataTransfer.effectAllowed = 'move';
            // Add visual feedback
            e.currentTarget.classList.add('tree-item--dragging');
        }
    };
    
    const handleDragEnd = (e) => {
        e.currentTarget.classList.remove('tree-item--dragging');
    };
    
    const getIcon = () => {
        if (type === 'folder') {
            return isExpanded ? '📂' : '📁';
        }
        if (item.type === 'kanban') return '📋';
        if (item.type === 'sheet') return '📊';
        return '📄';
    };
    
    const handleKeyDownItem = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(item.id, type);
        }
        if (e.key === 'ArrowRight' && type === 'folder' && hasChildren && !isExpanded) {
            e.preventDefault();
            onToggle(item.id);
        }
        if (e.key === 'ArrowLeft' && type === 'folder' && isExpanded) {
            e.preventDefault();
            onToggle(item.id);
        }
        if (e.key === 'Delete' && onRequestDelete) {
            e.preventDefault();
            onRequestDelete(item.id, type, item.name);
        }
        if (e.key === 'F2' && onRequestRename) {
            e.preventDefault();
            onRequestRename(item.id, type, item.name);
        }
    };
    
    const handleDoubleClick = (e) => {
        if (onRequestRename && !isRenaming) {
            e.preventDefault();
            e.stopPropagation();
            onRequestRename(item.id, type, item.name);
        }
    };
    
    const handleRenameKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            onRenameSubmit?.();
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            onRenameCancel?.();
        }
    };
    
    // Determine background color based on item type
    const getBackgroundStyle = () => {
        // System folders use workspace color
        if (item.isSystem && workspaceColor) {
            return { background: ensureContrastWithWhite(workspaceColor, 0.3) };
        }
        // Regular folders use their own color
        if (type === 'folder' && item.color) {
            return { background: ensureContrastWithWhite(item.color, 0.3) };
        }
        // Documents use their own color
        if (type === 'document' && item.color) {
            return { background: ensureContrastWithWhite(item.color, 0.3) };
        }
        return {};
    };
    
    return (
        <div className="tree-item-wrapper">
            <div
                className={`tree-item tree-item--${type} ${isSelected ? 'tree-item--selected' : ''} ${isDragOver ? 'tree-item--drag-over' : ''} ${isRenaming ? 'tree-item--renaming' : ''}`}
                style={{ paddingLeft: `${12 + level * 20}px`, ...getBackgroundStyle() }}
                onClick={() => !isRenaming && onSelect(item.id, type)}
                onDoubleClick={handleDoubleClick}
                onKeyDown={handleKeyDownItem}
                onContextMenu={(e) => onContextMenu?.(e, item, type)}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                draggable={type === 'document' && !isRenaming}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                role="treeitem"
                tabIndex={isSelected ? 0 : -1}
                aria-selected={isSelected}
                aria-expanded={type === 'folder' && hasChildren ? isExpanded : undefined}
            >
                {/* Expand/collapse toggle for folders */}
                {type === 'folder' && (
                    <button
                        className={`tree-item__toggle ${hasChildren ? '' : 'tree-item__toggle--hidden'}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggle(item.id);
                        }}
                        aria-label={isExpanded ? 'Collapse folder' : 'Expand folder'}
                        aria-expanded={isExpanded}
                    >
                        <span className={`tree-item__arrow ${isExpanded ? 'tree-item__arrow--expanded' : ''}`}>
                            ▶
                        </span>
                    </button>
                )}
                
                {/* Spacer for documents without toggle */}
                {type === 'document' && (
                    <span className="tree-item__spacer" />
                )}
                
                {/* Icon */}
                <span 
                    className="tree-item__icon"
                    style={item.color ? { color: item.color } : undefined}
                >
                    {item.icon || getIcon()}
                </span>
                
                {/* Name - inline edit when renaming */}
                {isRenaming ? (
                    <input
                        type="text"
                        className="tree-item__rename-input"
                        value={renameValue}
                        onChange={(e) => onRenameChange?.(e.target.value)}
                        onKeyDown={handleRenameKeyDown}
                        onBlur={() => onRenameSubmit?.()}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                    />
                ) : (
                    <span className="tree-item__name">{item.name}</span>
                )}
                
                {/* Collaborator pips for documents */}
                {type === 'document' && collaborators.length > 0 && (
                    <div className="tree-item__collaborators">
                        {collaborators.slice(0, 3).map((collab, idx) => (
                            <span 
                                key={idx}
                                className="tree-item__pip"
                                style={{ backgroundColor: collab.color }}
                                title={collab.name}
                            >
                                {collab.icon || collab.name?.charAt(0).toUpperCase()}
                            </span>
                        ))}
                        {collaborators.length > 3 && (
                            <span className="tree-item__pip tree-item__pip--more">
                                +{collaborators.length - 3}
                            </span>
                        )}
                    </div>
                )}
                
                {/* Delete button */}
                {onRequestDelete && (
                    <button 
                        className="tree-item__delete"
                        onClick={(e) => {
                            e.stopPropagation();
                            onRequestDelete(item.id, type, item.name);
                        }}
                        title={`Delete ${type}`}
                        aria-label={`Delete ${item.name}`}
                    >
                        🗑
                    </button>
                )}
            </div>
            
            {/* Children (folder contents) */}
            {isExpanded && children}
        </div>
    );
}

/**
 * Welcome/onboarding component when no workspace exists
 */
function WelcomeState({ onCreateWorkspace, onJoinWorkspace }) {
    return (
        <div className="sidebar-welcome">
            <div className="sidebar-welcome__icon">🚀</div>
            <h3 className="sidebar-welcome__title">Welcome to Nahma</h3>
            <p className="sidebar-welcome__text">
                Create a workspace to start collaborating on documents securely.
            </p>
            <div className="sidebar-welcome__actions">
                <button 
                    className="sidebar-welcome__btn sidebar-welcome__btn--primary"
                    onClick={onCreateWorkspace}
                >
                    <span>+</span> Create Workspace
                </button>
                <button 
                    className="sidebar-welcome__btn"
                    onClick={onJoinWorkspace}
                >
                    <span>🔗</span> Join via Link
                </button>
            </div>
        </div>
    );
}

/**
 * Empty workspace state (has workspace but no content)
 */
function EmptyWorkspaceState({ onCreateDocument, onCreateFolder, workspaceName, canCreate }) {
    return (
        <div className="sidebar-empty">
            <p className="sidebar-empty__text">
                <strong>{workspaceName}</strong> is empty
            </p>
            {canCreate ? (
                <>
                    <p className="sidebar-empty__hint">
                        Create your first document or folder to get started
                    </p>
                    <div className="sidebar-empty__actions">
                        <button 
                            className="sidebar-empty__btn sidebar-empty__btn--primary"
                            onClick={() => onCreateDocument?.()}
                            aria-label="Create new document"
                        >
                            📄 New Document
                        </button>
                        <button 
                            className="sidebar-empty__btn"
                            onClick={() => onCreateFolder?.()}
                            aria-label="Create new folder"
                        >
                            📁 New Folder
                        </button>
                    </div>
                </>
            ) : (
                <p className="sidebar-empty__hint">
                    You have view-only access to this workspace
                </p>
            )}
        </div>
    );
}

/**
 * Main HierarchicalSidebar component
 */
const HierarchicalSidebar = ({ 
    // Document props
    documents = [],
    activeDocId,
    onSelectDocument,
    onCreateDocument,
    onCreateSheet,
    onCreateKanban,
    onDeleteDocument,
    onRenameDocument,
    onMoveDocument,
    documentCollaborators = {},
    
    // UI props
    isCollapsed,
    onToggleCollapse,
    
    // Workspace props
    workspaces = [],
    currentWorkspace,
    onSwitchWorkspace,
    onCreateWorkspace,
    onJoinWorkspace,
    onUpdateWorkspace,
    onDeleteWorkspace,
    workspacesLoading = false,
    workspaceCollaborators = [],
    
    // Membership props
    workspaceMembers = {},
    onKickMember,
    onTransferOwnership,
    
    // Folder props
    folders = [],
    onCreateFolder,
    onDeleteFolder,
    onRenameFolder,
}) => {
    // Permission context
    const { canCreate, canDelete } = usePermissions();
    
    // Check if user can create/delete in current workspace
    const canCreateInWorkspace = currentWorkspace ? canCreate('workspace', currentWorkspace.id) : false;
    const canDeleteInWorkspace = currentWorkspace ? canDelete('workspace', currentWorkspace.id) : false;
    
    // State
    const [expandedFolders, setExpandedFolders] = useState(new Set());
    const [isCreatingDoc, setIsCreatingDoc] = useState(false);
    const [newDocName, setNewDocName] = useState('');
    const [createDocType, setCreateDocType] = useState('text');
    const [createInFolderId, setCreateInFolderId] = useState(null);
    
    // Rename state
    const [renamingItem, setRenamingItem] = useState(null); // { id, type }
    const [renameValue, setRenameValue] = useState('');
    
    // Dialog states
    const [showCreateFolder, setShowCreateFolder] = useState(false);
    const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
    const [showWorkspaceSettings, setShowWorkspaceSettings] = useState(false);
    const [showAppSettings, setShowAppSettings] = useState(false);
    const [createWorkspaceMode, setCreateWorkspaceMode] = useState('create');
    
    // Confirmation dialog
    const { confirm, ConfirmDialogComponent } = useConfirmDialog();
    
    // Delete confirmation handler
    const handleRequestDelete = useCallback(async (id, type, name) => {
        const confirmed = await confirm({
            title: `Delete ${type === 'folder' ? 'Folder' : 'Document'}`,
            message: `Are you sure you want to delete "${name}"? This cannot be undone.`,
            confirmText: 'Delete',
            cancelText: 'Cancel',
            variant: 'danger'
        });
        if (confirmed) {
            if (type === 'folder') {
                onDeleteFolder?.(id);
            } else {
                onDeleteDocument?.(id);
            }
        }
    }, [confirm, onDeleteFolder, onDeleteDocument]);
    
    // Rename handlers
    const handleRequestRename = useCallback((id, type, currentName) => {
        setRenamingItem({ id, type });
        setRenameValue(currentName);
    }, []);
    
    const handleRenameSubmit = useCallback(() => {
        if (!renamingItem || !renameValue.trim()) {
            setRenamingItem(null);
            setRenameValue('');
            return;
        }
        
        if (renamingItem.type === 'folder') {
            onRenameFolder?.(renamingItem.id, renameValue.trim());
        } else {
            onRenameDocument?.(renamingItem.id, renameValue.trim());
        }
        
        setRenamingItem(null);
        setRenameValue('');
    }, [renamingItem, renameValue, onRenameFolder, onRenameDocument]);
    
    const handleRenameCancel = useCallback(() => {
        setRenamingItem(null);
        setRenameValue('');
    }, []);
    
    // Check if we have any workspaces
    const hasWorkspaces = workspaces.length > 0;
    
    // Get folders for current workspace (deduplicated by ID)
    const workspaceFolders = useMemo(() => {
        if (!currentWorkspace) return [];
        const wsFiltered = folders.filter(f => f.workspaceId === currentWorkspace.id && !f.isSystem);
        // Deduplicate by folder ID (can happen if data loaded from multiple sources)
        const seen = new Set();
        return wsFiltered.filter(f => {
            if (seen.has(f.id)) return false;
            seen.add(f.id);
            return true;
        });
    }, [folders, currentWorkspace]);
    
    // Get documents for current workspace (at root level - no folder)
    const rootDocuments = useMemo(() => {
        if (!currentWorkspace) return [];
        return documents.filter(d => 
            d.workspaceId === currentWorkspace.id && !d.folderId
        );
    }, [documents, currentWorkspace]);
    
    // Get documents inside a specific folder
    const getDocumentsInFolder = useCallback((folderId) => {
        return documents.filter(d => d.folderId === folderId);
    }, [documents]);
    
    // Toggle folder expansion
    const toggleFolder = useCallback((folderId) => {
        setExpandedFolders(prev => {
            const next = new Set(prev);
            if (next.has(folderId)) {
                next.delete(folderId);
            } else {
                next.add(folderId);
            }
            return next;
        });
    }, []);
    
    // Handle document creation
    const handleCreateDoc = useCallback(() => {
        if (!newDocName.trim()) return;
        
        if (createDocType === 'kanban' && onCreateKanban) {
            onCreateKanban(newDocName.trim(), createInFolderId);
        } else if (createDocType === 'sheet' && onCreateSheet) {
            onCreateSheet(newDocName.trim(), createInFolderId);
        } else if (onCreateDocument) {
            onCreateDocument(newDocName.trim(), createInFolderId);
        }
        
        setNewDocName('');
        setIsCreatingDoc(false);
        setCreateDocType('text');
        setCreateInFolderId(null);
    }, [newDocName, createDocType, createInFolderId, onCreateDocument, onCreateSheet, onCreateKanban]);
    
    const handleKeyDown = (e) => {
        if (e.key === 'Enter') handleCreateDoc();
        if (e.key === 'Escape') {
            setIsCreatingDoc(false);
            setNewDocName('');
            setCreateDocType('text');
        }
    };
    
    // Start creating document (optionally in a folder)
    const startCreatingDocument = useCallback((folderId = null) => {
        setCreateInFolderId(folderId);
        setIsCreatingDoc(true);
        setCreateDocType('text');
    }, []);
    
    // Handle item selection
    const handleSelect = useCallback((id, type) => {
        if (type === 'document') {
            onSelectDocument?.(id);
        }
        // Folders don't need special handling - just expand/collapse
    }, [onSelectDocument]);
    
    // Handle document drop onto folder
    const handleDocumentDrop = useCallback((documentId, folderId) => {
        if (onMoveDocument) {
            onMoveDocument(documentId, folderId);
        }
    }, [onMoveDocument]);
    
    // Handle document drop onto root (out of folder)
    const handleDropOnRoot = useCallback((e) => {
        e.preventDefault();
        const docId = e.dataTransfer.getData('documentId');
        if (docId && onMoveDocument) {
            onMoveDocument(docId, null); // null folderId = root
        }
    }, [onMoveDocument]);
    
    const handleDragOverRoot = useCallback((e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }, []);
    
    // Workspace handlers
    const handleOpenCreateWorkspace = useCallback(() => {
        setCreateWorkspaceMode('create');
        setShowCreateWorkspace(true);
    }, []);
    
    const handleOpenJoinWorkspace = useCallback(() => {
        setCreateWorkspaceMode('join');
        setShowCreateWorkspace(true);
    }, []);
    
    // Collapsed state
    if (isCollapsed) {
        return (
            <div className="hierarchical-sidebar hierarchical-sidebar--collapsed">
                <button 
                    className="hierarchical-sidebar__expand-btn" 
                    onClick={onToggleCollapse}
                    title="Expand sidebar"
                >
                    ☰
                </button>
            </div>
        );
    }
    
    // Loading workspaces - show loading state
    if (workspacesLoading && !hasWorkspaces) {
        return (
            <div className="hierarchical-sidebar">
                <div className="sidebar-loading">
                    <div className="sidebar-loading__spinner"></div>
                    <p className="sidebar-loading__text">Loading workspaces...</p>
                </div>
                <div className="hierarchical-sidebar__footer">
                    <button 
                        className="hierarchical-sidebar__collapse-btn"
                        onClick={onToggleCollapse}
                        title="Collapse sidebar"
                    >
                        ⟨
                    </button>
                </div>
            </div>
        );
    }
    
    // No workspaces - show welcome/onboarding
    if (!hasWorkspaces) {
        return (
            <div className="hierarchical-sidebar">
                <WelcomeState 
                    onCreateWorkspace={handleOpenCreateWorkspace}
                    onJoinWorkspace={handleOpenJoinWorkspace}
                />
                
                <div className="hierarchical-sidebar__footer">
                    <button 
                        className="hierarchical-sidebar__collapse-btn"
                        onClick={onToggleCollapse}
                        title="Collapse sidebar"
                    >
                        ⟨
                    </button>
                </div>
                
                {/* Create workspace dialog */}
                {showCreateWorkspace && (
                    <CreateWorkspace
                        initialTab={createWorkspaceMode}
                        onSubmit={handleCreateWorkspaceSubmit}
                        onJoin={handleJoinWorkspaceSubmit}
                        onClose={() => setShowCreateWorkspace(false)}
                    />
                )}
            </div>
        );
    }
    
    // Has workspace(s) - show full sidebar
    const hasContent = workspaceFolders.length > 0 || rootDocuments.length > 0;
    
    return (
        <div className="hierarchical-sidebar">
            {/* Workspace dropdown */}
            <WorkspaceSwitcher
                onOpenSettings={() => setShowWorkspaceSettings(true)}
                onCreateWorkspace={handleOpenCreateWorkspace}
                onJoinWorkspace={handleOpenJoinWorkspace}
            />
            
            {/* Action bar */}
            <div className="hierarchical-sidebar__actions">
                <button 
                    className="hierarchical-sidebar__action-btn hierarchical-sidebar__action-btn--share"
                    onClick={() => setShowWorkspaceSettings(true)}
                    title="Share Workspace"
                >
                    🔗 Share
                </button>
                <IfPermitted action="create" entityType="workspace" entityId={currentWorkspace?.id}>
                    <button 
                        className="hierarchical-sidebar__action-btn"
                        onClick={() => startCreatingDocument(null)}
                        title="New Document"
                        aria-label="Create new document"
                    >
                        📄+
                    </button>
                    <button 
                        className="hierarchical-sidebar__action-btn"
                        onClick={() => setShowCreateFolder(true)}
                        title="New Folder"
                        aria-label="Create new folder"
                    >
                        📁+
                    </button>
                </IfPermitted>
            </div>
            
            {/* Document creation inline form */}
            {isCreatingDoc && (
                <div className="hierarchical-sidebar__create-form">
                    <div className="hierarchical-sidebar__type-selector" role="radiogroup" aria-label="Document type">
                        <button 
                            className={`type-btn ${createDocType === 'text' ? 'active' : ''}`}
                            onClick={() => setCreateDocType('text')}
                            title="Document"
                            aria-label="Create text document"
                            aria-pressed={createDocType === 'text'}
                        >
                            📄
                        </button>
                        <button 
                            className={`type-btn ${createDocType === 'sheet' ? 'active' : ''}`}
                            onClick={() => setCreateDocType('sheet')}
                            title="Spreadsheet"
                            aria-label="Create spreadsheet"
                            aria-pressed={createDocType === 'sheet'}
                        >
                            📊
                        </button>
                        <button 
                            className={`type-btn ${createDocType === 'kanban' ? 'active' : ''}`}
                            onClick={() => setCreateDocType('kanban')}
                            title="Kanban Board"
                            aria-label="Create kanban board"
                            aria-pressed={createDocType === 'kanban'}
                        >
                            📋
                        </button>
                    </div>
                    <input
                        type="text"
                        value={newDocName}
                        onChange={(e) => setNewDocName(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={createDocType === 'kanban' ? 'Board name...' : createDocType === 'sheet' ? 'Spreadsheet name...' : 'Document name...'}
                        autoFocus
                        className="hierarchical-sidebar__create-input"
                        aria-label="New document name"
                    />
                    <button onClick={handleCreateDoc} className="btn-confirm" aria-label="Confirm creation" disabled={!newDocName.trim()}>✓</button>
                    <button onClick={() => setIsCreatingDoc(false)} className="btn-cancel" aria-label="Cancel creation">✕</button>
                </div>
            )}
            
            {/* Tree content - allows dropping docs to root */}
            <div 
                className="hierarchical-sidebar__tree"
                onDragOver={handleDragOverRoot}
                onDrop={handleDropOnRoot}
                role="tree"
                aria-label="Workspace documents and folders"
            >
                {!hasContent ? (
                    <EmptyWorkspaceState 
                        workspaceName={currentWorkspace?.name}
                        onCreateDocument={() => startCreatingDocument(null)}
                        onCreateFolder={() => setShowCreateFolder(true)}
                        canCreate={canCreateInWorkspace}
                    />
                ) : (
                    <>
                        {/* Folders with their documents */}
                        {workspaceFolders.map(folder => {
                            const isExpanded = expandedFolders.has(folder.id);
                            const folderDocs = getDocumentsInFolder(folder.id);
                            const hasChildren = folderDocs.length > 0;
                            const isFolderRenaming = renamingItem?.id === folder.id && renamingItem?.type === 'folder';
                            
                            return (
                                <TreeItem
                                    key={folder.id}
                                    item={folder}
                                    type="folder"
                                    isExpanded={isExpanded}
                                    hasChildren={hasChildren}
                                    onSelect={() => {}}
                                    onToggle={toggleFolder}
                                    onRequestDelete={canDeleteInWorkspace ? handleRequestDelete : undefined}
                                    onRequestRename={canDeleteInWorkspace ? handleRequestRename : undefined}
                                    isRenaming={isFolderRenaming}
                                    renameValue={isFolderRenaming ? renameValue : ''}
                                    onRenameChange={setRenameValue}
                                    onRenameSubmit={handleRenameSubmit}
                                    onRenameCancel={handleRenameCancel}
                                    onDocumentDrop={canCreateInWorkspace ? handleDocumentDrop : undefined}
                                    workspaceColor={currentWorkspace?.color}
                                >
                                    {/* Documents inside this folder */}
                                    {folderDocs.map(doc => {
                                        const isDocRenaming = renamingItem?.id === doc.id && renamingItem?.type === 'document';
                                        return (
                                            <TreeItem
                                                key={doc.id}
                                                item={doc}
                                                type="document"
                                                level={1}
                                                isSelected={doc.id === activeDocId}
                                                onSelect={handleSelect}
                                                onRequestDelete={canDeleteInWorkspace ? handleRequestDelete : undefined}
                                                onRequestRename={canDeleteInWorkspace ? handleRequestRename : undefined}
                                                isRenaming={isDocRenaming}
                                                renameValue={isDocRenaming ? renameValue : ''}
                                                onRenameChange={setRenameValue}
                                                onRenameSubmit={handleRenameSubmit}
                                                onRenameCancel={handleRenameCancel}
                                                collaborators={documentCollaborators[doc.id] || []}
                                                workspaceColor={currentWorkspace?.color}
                                            />
                                        );
                                    })}
                                </TreeItem>
                            );
                        })}
                        
                        {/* Root documents (not in any folder) */}
                        {rootDocuments.map(doc => {
                            const isDocRenaming = renamingItem?.id === doc.id && renamingItem?.type === 'document';
                            return (
                                <TreeItem
                                    key={doc.id}
                                    item={doc}
                                    type="document"
                                    isSelected={doc.id === activeDocId}
                                    onSelect={handleSelect}
                                    onRequestDelete={canDeleteInWorkspace ? handleRequestDelete : undefined}
                                    onRequestRename={canDeleteInWorkspace ? handleRequestRename : undefined}
                                    isRenaming={isDocRenaming}
                                    renameValue={isDocRenaming ? renameValue : ''}
                                    onRenameChange={setRenameValue}
                                    onRenameSubmit={handleRenameSubmit}
                                    onRenameCancel={handleRenameCancel}
                                    collaborators={documentCollaborators[doc.id] || []}
                                    workspaceColor={currentWorkspace?.color}
                                />
                            );
                        })}
                    </>
                )}
            </div>
            
            {/* Footer with app settings and collapse */}
            <div className="hierarchical-sidebar__footer">
                <button 
                    className="hierarchical-sidebar__settings-btn"
                    onClick={() => setShowAppSettings(true)}
                    title="App Settings"
                    aria-label="Open app settings"
                >
                    ⚙️
                </button>
                <button 
                    className="hierarchical-sidebar__collapse-btn"
                    onClick={onToggleCollapse}
                    title="Collapse sidebar"
                    aria-label="Collapse sidebar"
                >
                    ⟨
                </button>
            </div>
            
            {/* Dialogs */}
            <CreateFolder
                isOpen={showCreateFolder}
                onClose={() => setShowCreateFolder(false)}
                onSuccess={() => setShowCreateFolder(false)}
            />
            
            {showCreateWorkspace && (
                <CreateWorkspace
                    mode={createWorkspaceMode}
                    onClose={() => setShowCreateWorkspace(false)}
                    onSuccess={() => setShowCreateWorkspace(false)}
                />
            )}
            
            {showWorkspaceSettings && currentWorkspace && (
                <WorkspaceSettings
                    workspace={currentWorkspace}
                    collaborators={workspaceCollaborators}
                    members={workspaceMembers}
                    onKickMember={onKickMember}
                    onTransferOwnership={onTransferOwnership}
                    onUpdate={onUpdateWorkspace}
                    onDelete={onDeleteWorkspace}
                    onClose={() => setShowWorkspaceSettings(false)}
                />
            )}
            
            {/* App Settings Modal */}
            {showAppSettings && (
                <AppSettings
                    isOpen={showAppSettings}
                    onClose={() => setShowAppSettings(false)}
                />
            )}
            
            {/* Confirmation Dialog */}
            {ConfirmDialogComponent}
        </div>
    );
};

export default HierarchicalSidebar;
