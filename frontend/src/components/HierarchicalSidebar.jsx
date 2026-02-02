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
import CreateDocument from './CreateDocument';
import CreateWorkspace from './CreateWorkspace';
import WorkspaceSettings from './WorkspaceSettings';
import { AppSettings, useConfirmDialog, EditPropertiesModal } from './common';
import { IfPermitted } from './PermissionGuard';
import { usePermissions } from '../contexts/PermissionContext';
import { useWorkspaces } from '../contexts/WorkspaceContext';
import { useFolders } from '../contexts/FolderContext';
import { ensureContrastWithWhite, createColorGradient } from '../utils/colorUtils';
import NightjarMascot from './NightjarMascot';
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
    onRequestEdit, // Function to start editing properties (id, type, item)
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
    
    // Determine background color/gradient based on item type
    const getBackgroundStyle = () => {
        // System folders use workspace color
        if (item.isSystem && workspaceColor) {
            return { background: ensureContrastWithWhite(workspaceColor, 0.3) };
        }
        // Regular folders use their own color
        if (type === 'folder' && item.color) {
            return { background: ensureContrastWithWhite(item.color, 0.3) };
        }
        // Documents - check for gradient first, then fallback to single color
        if (type === 'document') {
            const folderColor = item.folderColor;
            const docColor = item.color;
            
            // Use gradient if both folder and document have colors
            if (folderColor && docColor) {
                return { background: createColorGradient(folderColor, docColor, 0.25) };
            }
            // Use document color if available
            else if (docColor) {
                return { background: ensureContrastWithWhite(docColor, 0.3) };
            }
            // Use folder color as fallback
            else if (folderColor) {
                return { background: ensureContrastWithWhite(folderColor, 0.3) };
            }
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
                
                {/* Action buttons - edit and delete */}
                <div className="tree-item__actions">
                    {onRequestEdit && (
                        <button 
                            className="tree-item__edit"
                            onClick={(e) => {
                                e.stopPropagation();
                                onRequestEdit(item.id, type, item);
                            }}
                            title={`Edit ${type} properties`}
                            aria-label={`Edit ${item.name} properties`}
                        >
                            ⚙️
                        </button>
                    )}
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
            <div className="sidebar-welcome__icon">
                <img src="/assets/nightjar-logo.png" alt="Nightjar" />
            </div>
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
                <p className="sidebar-empty__hint">
                    Create your first document or folder to get started
                </p>
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
    onUpdateDocument, // For updating document properties (icon, color)
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
    
    // Folder context - for updating folder properties
    const { updateFolder } = useFolders();
    
    // Check if user can create/delete in current workspace
    const canCreateInWorkspace = currentWorkspace ? canCreate('workspace', currentWorkspace.id) : false;
    const canDeleteInWorkspace = currentWorkspace ? canDelete('workspace', currentWorkspace.id) : false;
    
    // State
    const [expandedFolders, setExpandedFolders] = useState(new Set());
    const [showCreateDocument, setShowCreateDocument] = useState(false);
    const [createInFolderId, setCreateInFolderId] = useState(null);
    const [createDocumentType, setCreateDocumentType] = useState('text');
    
    // Rename state
    const [renamingItem, setRenamingItem] = useState(null); // { id, type }
    const [renameValue, setRenameValue] = useState('');
    
    // Dialog states
    const [showCreateFolder, setShowCreateFolder] = useState(false);
    const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
    const [showWorkspaceSettings, setShowWorkspaceSettings] = useState(false);
    const [showAppSettings, setShowAppSettings] = useState(false);
    const [createWorkspaceMode, setCreateWorkspaceMode] = useState('create');
    
    // Context menu state
    const [contextMenu, setContextMenu] = useState(null);
    
    // Edit properties modal state
    const [editPropertiesItem, setEditPropertiesItem] = useState(null);
    
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
    
    // Context menu handlers
    const handleContextMenu = useCallback((e, item, type) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Don't show context menu for system folders
        if (item.isSystem) return;
        
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            item,
            type
        });
    }, []);
    
    const closeContextMenu = useCallback(() => {
        setContextMenu(null);
    }, []);
    
    const handleEditProperties = useCallback(() => {
        if (contextMenu) {
            setEditPropertiesItem({
                id: contextMenu.item.id,
                name: contextMenu.item.name,
                icon: contextMenu.item.icon,
                color: contextMenu.item.color,
                type: contextMenu.type
            });
            closeContextMenu();
        }
    }, [contextMenu, closeContextMenu]);
    
    const handleSaveProperties = useCallback(async ({ id, type, icon, color }) => {
        if (type === 'folder') {
            updateFolder(id, { icon, color });
        } else if (type === 'document' && onUpdateDocument) {
            await onUpdateDocument(id, { icon, color });
        }
    }, [updateFolder, onUpdateDocument]);
    
    // Direct edit properties handler (for button, not context menu)
    const handleRequestEdit = useCallback((id, type, item) => {
        // Find parent folder for documents to enable gradient preview
        let parentFolder = null;
        if (type === 'document' && item.folderId) {
            parentFolder = folders.find(f => f.id === item.folderId);
        }
        
        setEditPropertiesItem({
            id,
            name: item.name,
            icon: item.icon,
            color: item.color,
            type,
            parentFolder
        });
    }, [folders]);
    
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
    const handleCreateDocumentSuccess = useCallback((name, type) => {
        setShowCreateDocument(false);
        setCreateInFolderId(null);
        setCreateDocumentType('text');
    }, []);
    
    // Start creating document (optionally in a folder)
    const startCreatingDocument = useCallback((folderId = null, docType = 'text') => {
        setCreateInFolderId(folderId);
        setCreateDocumentType(docType);
        setShowCreateDocument(true);
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
                    <span className="action-btn__icon">🔗</span>
                    <span className="action-btn__label">Share</span>
                </button>
                <button 
                    className="hierarchical-sidebar__action-btn hierarchical-sidebar__action-btn--join"
                    onClick={handleOpenJoinWorkspace}
                    title="Join via Link"
                >
                    <span className="action-btn__icon">📥</span>
                    <span className="action-btn__label">Join</span>
                </button>
                <IfPermitted action="create" entityType="workspace" entityId={currentWorkspace?.id}>
                    <button 
                        className="hierarchical-sidebar__action-btn hierarchical-sidebar__action-btn--doc"
                        onClick={() => startCreatingDocument(null)}
                        title="New Document"
                        aria-label="Create new document"
                    >
                        <span className="action-btn__icon">📄+</span>
                        <span className="action-btn__label">Doc</span>
                    </button>
                    <button 
                        className="hierarchical-sidebar__action-btn hierarchical-sidebar__action-btn--folder"
                        onClick={() => setShowCreateFolder(true)}
                        title="New Folder"
                        aria-label="Create new folder"
                    >
                        <span className="action-btn__icon">📁+</span>
                        <span className="action-btn__label">Folder</span>
                    </button>
                </IfPermitted>
            </div>
            
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
                                    onRequestEdit={handleRequestEdit}
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
                                                item={{...doc, folderColor: folder.color}}
                                                type="document"
                                                level={1}
                                                isSelected={doc.id === activeDocId}
                                                onSelect={handleSelect}
                                                onRequestDelete={canDeleteInWorkspace ? handleRequestDelete : undefined}
                                                onRequestRename={canDeleteInWorkspace ? handleRequestRename : undefined}
                                                onRequestEdit={handleRequestEdit}
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
                                    onRequestEdit={handleRequestEdit}
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
            
            {/* Footer with mascot, app settings and collapse */}
            <div className="hierarchical-sidebar__footer">
                <NightjarMascot size="mini" autoRotate={false} fadeTimeout={5000} />
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
            
            {/* Context Menu */}
            {contextMenu && (
                <>
                    <div className="context-menu-overlay" onClick={closeContextMenu} />
                    <div
                        className="context-menu"
                        style={{ left: contextMenu.x, top: contextMenu.y }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            className="context-menu__item"
                            onClick={handleEditProperties}
                        >
                            <span className="context-menu__icon">🎨</span>
                            Edit Properties
                        </button>
                        <button
                            className="context-menu__item"
                            onClick={() => {
                                handleRequestRename(contextMenu.item.id, contextMenu.type, contextMenu.item.name);
                                closeContextMenu();
                            }}
                        >
                            <span className="context-menu__icon">✏️</span>
                            Rename
                        </button>
                        <button
                            className="context-menu__item context-menu__item--danger"
                            onClick={() => {
                                handleRequestDelete(contextMenu.item.id, contextMenu.type, contextMenu.item.name);
                                closeContextMenu();
                            }}
                        >
                            <span className="context-menu__icon">🗑️</span>
                            Delete
                        </button>
                    </div>
                </>
            )}
            
            {/* Edit Properties Modal */}
            <EditPropertiesModal
                isOpen={!!editPropertiesItem}
                onClose={() => setEditPropertiesItem(null)}
                item={editPropertiesItem}
                onSave={handleSaveProperties}
                parentFolder={editPropertiesItem?.parentFolder}
            />
            
            {/* Create Document Modal */}
            <CreateDocument
                isOpen={showCreateDocument}
                onClose={() => setShowCreateDocument(false)}
                parentFolderId={createInFolderId}
                defaultType={createDocumentType}
                onSuccess={handleCreateDocumentSuccess}
                onCreateDocument={onCreateDocument}
                onCreateSheet={onCreateSheet}
                onCreateKanban={onCreateKanban}
            />
        </div>
    );
};

export default HierarchicalSidebar;
