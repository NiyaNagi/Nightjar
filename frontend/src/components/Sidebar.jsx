import React, { useState, useCallback, useMemo } from 'react';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import FolderTree from './FolderTree';
import CreateFolder from './CreateFolder';
import CreateWorkspace from './CreateWorkspace';
import WorkspaceSettings from './WorkspaceSettings';
import { IfPermitted } from './PermissionGuard';
import { AddDropdown, JoinWithLink, AppSettings } from './common';
import './Sidebar.css';

/**
 * Enhanced Sidebar with Workspace and Folder navigation
 */
const Sidebar = ({ 
    documents, 
    activeDocId, 
    onSelectDocument, 
    onCreateDocument,
    onCreateKanban,
    onDeleteDocument,
    onMoveDocument,
    isCollapsed,
    onToggleCollapse,
    documentCollaborators, // Map of docId -> array of {name, color, icon}
    // Workspace props
    workspaces,
    currentWorkspace,
    onSwitchWorkspace,
    onCreateWorkspace,
    onJoinWorkspace,
    onUpdateWorkspace,
    onDeleteWorkspace,
    // Folder props
    folders,
    activeFolderId,
    onSelectFolder,
    onCreateFolder,
    onDeleteFolder,
    onRenameFolder,
    // System folder counts
    systemFolderCounts,
}) => {
    const [newDocName, setNewDocName] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [createType, setCreateType] = useState('text'); // 'text' or 'kanban'
    
    // Dialog states
    const [showCreateFolder, setShowCreateFolder] = useState(false);
    const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
    const [showWorkspaceSettings, setShowWorkspaceSettings] = useState(false);
    const [createWorkspaceMode, setCreateWorkspaceMode] = useState('create'); // 'create' or 'join'
    const [showJoinModal, setShowJoinModal] = useState(false);
    const [showAppSettings, setShowAppSettings] = useState(false);

    const handleCreate = () => {
        if (newDocName.trim()) {
            if (createType === 'kanban' && onCreateKanban) {
                onCreateKanban(newDocName.trim());
            } else {
                onCreateDocument(newDocName.trim());
            }
            setNewDocName('');
            setIsCreating(false);
            setCreateType('text');
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') handleCreate();
        if (e.key === 'Escape') {
            setIsCreating(false);
            setNewDocName('');
            setCreateType('text');
        }
    };

    const getDocIcon = (doc) => {
        // Use custom icon if set, otherwise default based on type
        if (doc.icon) return doc.icon;
        switch (doc.type) {
            case 'kanban': return '📋';
            case 'sheet': return '📊';
            default: return '📄';
        }
    };

    const formatDate = (timestamp) => {
        if (!timestamp) return 'Never';
        const date = new Date(timestamp);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    // Handle document drop onto folder
    const handleDocumentDrop = useCallback((documentId, folderId) => {
        if (onMoveDocument) {
            onMoveDocument(documentId, folderId);
        }
    }, [onMoveDocument]);

    // Handle workspace creation
    const handleOpenCreateWorkspace = useCallback(() => {
        setCreateWorkspaceMode('create');
        setShowCreateWorkspace(true);
    }, []);

    const handleOpenJoinWorkspace = useCallback(() => {
        setCreateWorkspaceMode('join');
        setShowCreateWorkspace(true);
    }, []);

    const handleCreateWorkspace = useCallback((workspaceData) => {
        if (onCreateWorkspace) {
            onCreateWorkspace(workspaceData);
        }
        setShowCreateWorkspace(false);
    }, [onCreateWorkspace]);

    const handleJoinWorkspace = useCallback((shareLink, password) => {
        if (onJoinWorkspace) {
            onJoinWorkspace(shareLink, password);
        }
        setShowCreateWorkspace(false);
    }, [onJoinWorkspace]);

    // Filter documents for current folder
    console.log('[Sidebar] Received documents:', documents?.length, documents);
    const filteredDocuments = useMemo(() => (documents || []).filter(doc => {
        if (activeFolderId === 'all' || !activeFolderId) return true;
        if (activeFolderId === 'recent') {
            // Show docs edited in last 7 days
            const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
            return doc.lastEdited > weekAgo;
        }
        if (activeFolderId === 'shared') {
            return doc.shared;
        }
        if (activeFolderId === 'trash') {
            return doc.deletedAt;
        }
        return doc.folderId === activeFolderId;
    }), [documents, activeFolderId]);

    if (isCollapsed) {
        return (
            <div className="sidebar collapsed">
                <button className="sidebar-toggle" onClick={onToggleCollapse} title="Expand sidebar">
                    <span>☰</span>
                </button>
            </div>
        );
    }

    return (
        <div className="sidebar" data-testid="workspace-sidebar">
            {/* Workspace Switcher at top */}
            <WorkspaceSwitcher
                workspaces={workspaces}
                currentWorkspace={currentWorkspace}
                onSwitchWorkspace={onSwitchWorkspace}
                onOpenSettings={() => setShowWorkspaceSettings(true)}
                onCreateWorkspace={handleOpenCreateWorkspace}
                onJoinWorkspace={handleOpenJoinWorkspace}
            />

            {/* Folder Tree Navigation */}
            <FolderTree
                folders={folders}
                selectedFolderId={activeFolderId}
                onSelectFolder={onSelectFolder}
                onCreateFolder={() => setShowCreateFolder(true)}
                onDeleteFolder={onDeleteFolder}
                onRenameFolder={onRenameFolder}
                onDocumentDrop={handleDocumentDrop}
                systemFolderCounts={systemFolderCounts}
                workspaceId={currentWorkspace?.id}
            />
            
            {/* Document creation using unified AddDropdown */}
            <div className="sidebar-actions">
                {currentWorkspace ? (
                    <IfPermitted action="create" entityType="workspace" entityId={currentWorkspace.id}>
                        <AddDropdown
                            folders={folders}
                            currentFolderId={activeFolderId}
                            onCreateDocument={(data) => {
                                if (onCreateDocument) {
                                    onCreateDocument(data.name, data.folderId, data.icon, data.color);
                                }
                            }}
                            onCreateKanban={(data) => {
                                if (onCreateKanban) {
                                    onCreateKanban(data.name, data.folderId, data.icon, data.color);
                                }
                            }}
                            onCreateFolder={(data) => {
                                if (onCreateFolder) {
                                    onCreateFolder(data);
                                }
                            }}
                        />
                    </IfPermitted>
                ) : (
                    // Fallback for simple mode without workspaces
                    <AddDropdown
                        folders={folders}
                        currentFolderId={activeFolderId}
                        onCreateDocument={(data) => {
                            if (onCreateDocument) {
                                onCreateDocument(data.name, data.folderId, data.icon, data.color);
                            }
                        }}
                        onCreateKanban={(data) => {
                            if (onCreateKanban) {
                                onCreateKanban(data.name, data.folderId, data.icon, data.color);
                            }
                        }}
                        onCreateFolder={(data) => {
                            if (onCreateFolder) {
                                onCreateFolder(data);
                            }
                        }}
                    />
                )}
            </div>

            {/* Document list for current folder */}
            <div className="document-list" data-testid="document-list">
                {filteredDocuments.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-state__icon">📝</div>
                        <h3 className="empty-state__title">
                            {currentWorkspace?.name || 'Workspace'} is empty
                        </h3>
                        <p className="empty-state__text">
                            Create your first document or folder to get started
                        </p>
                        <div className="empty-state__actions">
                            <button 
                                className="empty-state__btn empty-state__btn--primary"
                                onClick={handleOpenCreateWorkspace}
                            >
                                + New Workspace
                            </button>
                            <button 
                                className="empty-state__btn"
                                onClick={() => setShowJoinModal(true)}
                            >
                                🔗 Join with Link
                            </button>
                        </div>
                    </div>
                ) : (
                    filteredDocuments.map((doc) => {
                        const collabs = documentCollaborators?.[doc.id] || [];
                        return (
                            <div
                                key={doc.id}
                                className={`document-item ${doc.id === activeDocId ? 'active' : ''} ${doc.deletedAt ? 'deleted' : ''}`}
                                onClick={() => onSelectDocument(doc.id)}
                                draggable
                                onDragStart={(e) => {
                                    e.dataTransfer.setData('documentId', doc.id);
                                    e.dataTransfer.effectAllowed = 'move';
                                }}
                                data-testid={`doc-${doc.id}`}
                            >
                                <span 
                                    className="doc-icon"
                                    style={doc.color ? { color: doc.color } : undefined}
                                >
                                    {getDocIcon(doc)}
                                </span>
                                <div className="doc-info">
                                    <span className="doc-name">{doc.name}</span>
                                    {collabs.length > 0 && (
                                        <div className="doc-pips">
                                            {collabs.slice(0, 5).map((collab, idx) => (
                                                <span 
                                                    key={idx}
                                                    className={`user-pip ${collab.isFocused ? 'focused' : ''}`}
                                                    style={{ backgroundColor: collab.color }}
                                                    title={collab.name + (collab.isFocused ? ' (editing)' : '')}
                                                >
                                                    {collab.icon || collab.name.charAt(0).toUpperCase()}
                                                </span>
                                            ))}
                                            {collabs.length > 5 && (
                                                <span className="user-pip more">+{collabs.length - 5}</span>
                                            )}
                                        </div>
                                    )}
                                    <span className="doc-meta">
                                        <span className="last-edited" title={`Last edited: ${formatDate(doc.lastEdited)}`}>
                                            {formatDate(doc.lastEdited)}
                                        </span>
                                    </span>
                                </div>
                                <IfPermitted action="delete" entityType="document" entityId={doc.id}>
                                    <button 
                                        className="btn-delete" 
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onDeleteDocument(doc.id);
                                        }}
                                        title="Delete document"
                                    >
                                        🗑
                                    </button>
                                </IfPermitted>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Sidebar footer with settings and collapse */}
            <div className="sidebar-footer">
                <button 
                    className="sidebar-footer__btn sidebar-footer__settings" 
                    onClick={() => setShowAppSettings(true)}
                    title="App Settings"
                >
                    ⚙️
                </button>
                <button 
                    className="sidebar-footer__btn sidebar-toggle" 
                    onClick={onToggleCollapse} 
                    title="Collapse sidebar"
                >
                    <span>⟨</span>
                </button>
            </div>

            {/* Dialogs */}
            {showCreateFolder && (
                <CreateFolder
                    workspaceId={currentWorkspace?.id}
                    parentFolderId={activeFolderId !== 'all' && activeFolderId !== 'recent' ? activeFolderId : null}
                    existingFolders={folders}
                    onSubmit={(folderData) => {
                        if (onCreateFolder) onCreateFolder(folderData);
                        setShowCreateFolder(false);
                    }}
                    onClose={() => setShowCreateFolder(false)}
                />
            )}

            {showCreateWorkspace && (
                <CreateWorkspace
                    initialTab={createWorkspaceMode}
                    onSubmit={handleCreateWorkspace}
                    onJoin={handleJoinWorkspace}
                    onClose={() => setShowCreateWorkspace(false)}
                />
            )}

            {showWorkspaceSettings && currentWorkspace && (
                <WorkspaceSettings
                    workspace={currentWorkspace}
                    onUpdate={onUpdateWorkspace}
                    onDelete={onDeleteWorkspace}
                    onClose={() => setShowWorkspaceSettings(false)}
                />
            )}

            {showJoinModal && (
                <JoinWithLink
                    onJoin={handleJoinWorkspace}
                    onClose={() => setShowJoinModal(false)}
                />
            )}

            {showAppSettings && (
                <AppSettings
                    onClose={() => setShowAppSettings(false)}
                />
            )}
        </div>
    );
};

export default React.memo(Sidebar);
