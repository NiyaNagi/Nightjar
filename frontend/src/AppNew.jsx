import { useState, useEffect, useCallback, useRef } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import nacl from 'tweetnacl';
import { fromString as uint8ArrayFromString, toString as uint8ArrayToString } from 'uint8arrays';

import HierarchicalSidebar from './components/HierarchicalSidebar';
import TabBar from './components/TabBar';
import StatusBar from './components/StatusBar';
import RelaySettings from './components/RelaySettings';
import { TorSettings } from './components/Settings/TorSettings';
import DocumentCollaborators from './components/DocumentCollaborators';
import EditorPane from './EditorPane';
import Kanban from './components/Kanban';
import Sheet from './components/Sheet';
import Chat from './components/Chat';
import Comments from './components/Comments';
import SplitPane from './components/SplitPane';
import UserProfile, { loadUserProfile } from './components/UserProfile';
import ChangelogPanel from './components/Changelog';
import CreateWorkspace from './components/CreateWorkspace';
import KickedModal from './components/KickedModal';
import OnboardingFlow from './components/Onboarding/OnboardingFlow';
import { useAuthorAttribution } from './hooks/useAuthorAttribution';
import { useChangelogObserver } from './hooks/useChangelogObserver';
import { useWorkspaceSync } from './hooks/useWorkspaceSync';
import { useWorkspaces } from './contexts/WorkspaceContext';
import { useFolders } from './contexts/FolderContext';
import { usePermissions } from './contexts/PermissionContext';
import { useIdentity } from './contexts/IdentityContext';
import { createCollaboratorTracker } from './utils/collaboratorTracking';
import { useEnvironment, isElectron } from './hooks/useEnvironment';
import { getYjsWebSocketUrl } from './utils/websocket';

import './styles/global.css';
import './styles/editor.css';
import './components/HierarchicalSidebar.css';
import './components/TabBar.css';
import './components/StatusBar.css';
import './components/Toolbar.css';
import './components/UserProfile.css';
import './components/SplitPane.css';
import './components/Changelog.css';
import './components/Comments.css';

// Get WebSocket URL using centralized utility
const getWsUrl = getYjsWebSocketUrl;

// --- Helper Functions ---
function getKeyFromUrl() {
    const fragment = window.location.hash.slice(1);
    if (fragment) {
        try {
            return uint8ArrayFromString(fragment, 'base64url');
        } catch (e) {
            console.error('Failed to parse key from URL fragment.', e);
            return null;
        }
    }
    return null;
}

function generateDocId() {
    return 'doc-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
}

// Document types supported
const DOC_TYPES = {
    TEXT: 'text',
    SHEET: 'sheet',
    KANBAN: 'kanban'
};

// Helper to convert column index to letter (0 -> A, 25 -> Z, 26 -> AA)
function colToLetter(col) {
    let letter = '';
    let c = col;
    while (c >= 0) {
        letter = String.fromCharCode(65 + (c % 26)) + letter;
        c = Math.floor(c / 26) - 1;
    }
    return letter;
}

// Helper to get cell range reference from selection (e.g., "A1" or "B5:E12")
function getCellRangeRef(selection) {
    if (!selection?.row || !selection?.column) return null;
    
    const rowStart = selection.row[0] ?? 0;
    const rowEnd = selection.row[1] ?? rowStart;
    const colStart = selection.column[0] ?? 0;
    const colEnd = selection.column[1] ?? colStart;
    
    const startRef = `${colToLetter(colStart)}${rowStart + 1}`;
    const endRef = `${colToLetter(colEnd)}${rowEnd + 1}`;
    
    if (startRef === endRef) {
        return startRef;
    }
    return `${startRef}:${endRef}`;
}

function App() {
    // --- Identity Context ---
    // Identity context is available for features like kick signatures, membership tracking
    const { 
        identity: userIdentity, 
        needsOnboarding, 
        createIdentity,
        loading: identityLoading 
    } = useIdentity();
    
    // --- Workspace & Folder Context ---
    const { 
        workspaces, 
        currentWorkspace, 
        currentWorkspaceId,
        createWorkspace,
        switchWorkspace,
        updateWorkspace,
        deleteWorkspace,
        leaveWorkspace,
        joinWorkspace,
        hasWorkspaces,
        loading: workspacesLoading
    } = useWorkspaces();
    
    const {
        folders,
        createFolder,
        deleteFolder,
        renameFolder,
        moveDocumentToFolder
    } = useFolders();
    
    // --- Permissions ---
    const { canEdit } = usePermissions();
    const canEditCurrentWorkspace = currentWorkspaceId ? canEdit('workspace', currentWorkspaceId) : false;
    
    // --- Core State ---
    const [sessionKey, setSessionKey] = useState(null);
    const [p2pStatus, setP2pStatus] = useState('offline');
    const [inviteLink, setInviteLink] = useState('');
    const [torEnabled, setTorEnabled] = useState(false);
    
    // User profile with persistence
    const [userProfile, setUserProfile] = useState(loadUserProfile);
    const userHandle = userProfile.name;
    const userColor = userProfile.color;
    const userIcon = userProfile.icon;

    // --- Workspace Sync (shared document/folder list via Yjs) ---
    // Pass initial workspace info so it gets synced to other clients
    const initialWorkspaceInfo = currentWorkspace ? {
        name: currentWorkspace.name,
        icon: currentWorkspace.icon,
        color: currentWorkspace.color,
    } : null;
    
    // User profile for workspace-level awareness (Chat, online status)
    const workspaceUserProfile = {
        name: userHandle,
        color: userColor,
        icon: userIcon,
    };
    
    // Remote server URL for cross-platform workspaces (Electron joining web-hosted workspace)
    const workspaceServerUrl = currentWorkspace?.serverUrl || null;
    
    const {
        documents: syncedDocuments,
        workspaceInfo: syncedWorkspaceInfo,
        addDocument: syncAddDocument,
        removeDocument: syncRemoveDocument,
        updateDocument: syncUpdateDocument,
        updateWorkspaceInfo: syncUpdateWorkspaceInfo,
        connected: workspaceSyncConnected,
        // Workspace-level collaborator tracking
        collaborators: workspaceCollaborators,
        onlineCount: workspaceOnlineCount,
        totalCount: workspaceTotalCount,
        // Workspace-level ydoc and provider for chat
        ydoc: workspaceYdoc,
        provider: workspaceProvider,
        // Membership tracking
        members: workspaceMembers,
        isKicked: isUserKicked,
        kickMember: syncKickMember,
        transferOwnership: syncTransferOwnership,
    } = useWorkspaceSync(currentWorkspaceId, initialWorkspaceInfo, workspaceUserProfile, workspaceServerUrl, userIdentity, currentWorkspace?.myPermission);
    
    // Use synced documents, fall back to local state for Electron mode
    // Exception: In Electron mode, if we have a serverUrl (remote workspace), use synced docs
    const isElectronMode = isElectron();
    const isRemoteWorkspace = !!workspaceServerUrl;
    const [localDocuments, setLocalDocuments] = useState([]);
    // Use syncedDocuments for: 1) web mode, 2) Electron joining remote workspace
    // Use localDocuments for: Electron with local workspace (no serverUrl)
    const documents = (isElectronMode && !isRemoteWorkspace) ? localDocuments : syncedDocuments;
    const setDocuments = (isElectronMode && !isRemoteWorkspace) ? setLocalDocuments : () => {}; // No-op for synced mode
    
    // --- Document State ---
    const [openTabs, setOpenTabs] = useState([]);
    const [activeDocId, setActiveDocId] = useState(null);
    const ydocsRef = useRef(new Map()); // Map of docId -> { ydoc, provider }

    // --- UI State ---
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [showCreateWorkspaceDialog, setShowCreateWorkspaceDialog] = useState(false);
    const [createWorkspaceMode, setCreateWorkspaceMode] = useState('create'); // 'create' or 'join'
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [toast, setToast] = useState(null);
    const [stats, setStats] = useState({ wordCount: 0, characterCount: 0 });
    const [showChangelog, setShowChangelog] = useState(false);
    const [chatTargetUser, setChatTargetUser] = useState(null); // User to open DM with
    const [showComments, setShowComments] = useState(false); // Comments panel visibility
    const [pendingComment, setPendingComment] = useState(null); // Selection to add comment to
    const [showRelaySettings, setShowRelaySettings] = useState(false); // Relay settings modal
    const [showTorSettings, setShowTorSettings] = useState(false); // Tor settings modal

    // --- Refs ---
    const metaSocketRef = useRef(null);

    // --- UI Helpers (defined early so callbacks can use them) ---
    const showToast = useCallback((message, type = 'info') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    }, []);

    // --- Onboarding Handler ---
    const handleOnboardingComplete = useCallback(async (identity) => {
        try {
            console.log('[App] Creating identity from onboarding:', identity.handle);
            const success = await createIdentity(identity);
            if (success) {
                console.log('[App] Identity created successfully');
                showToast(`Welcome, ${identity.handle}! 👋`, 'success');
                // Identity context will reload automatically
            } else {
                console.error('[App] Failed to create identity');
                showToast('Failed to create identity. Please try again.', 'error');
            }
        } catch (error) {
            console.error('[App] Error during identity creation:', error);
            showToast('Error creating identity: ' + error.message, 'error');
        }
    }, [createIdentity, showToast]);

    // --- Kick Member Handler with Toast Feedback ---
    const handleKickMember = useCallback((publicKey, memberName = 'member') => {
        if (!syncKickMember) return;
        
        // Check if member is currently online
        const isOnline = workspaceCollaborators?.some(c => c.publicKey === publicKey);
        
        // Perform the kick
        syncKickMember(publicKey);
        
        // Show appropriate toast
        if (isOnline) {
            showToast(`Kicked ${memberName} from workspace`, 'success');
        } else {
            showToast(`${memberName} will be kicked when they next connect`, 'warning');
        }
    }, [syncKickMember, workspaceCollaborators, showToast]);

    // --- Cleanup awareness states on page unload to prevent ghost users ---
    useEffect(() => {
        const handleBeforeUnload = () => {
            // Clear awareness state for all connected providers
            ydocsRef.current.forEach(({ provider }) => {
                if (provider?.awareness) {
                    // Set local state to null to notify other clients we're leaving
                    provider.awareness.setLocalState(null);
                }
                // Disconnect the provider
                if (provider?.disconnect) {
                    provider.disconnect();
                }
            });
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            // Also cleanup on component unmount
            handleBeforeUnload();
        };
    }, []);

    // --- Sync workspace info from remote (for joined workspaces) ---
    // Track last synced values to detect local vs remote changes
    const lastSyncedWorkspaceInfo = useRef(null);
    // Flag to prevent feedback loop: when true, we just received a remote update
    // and should not push back to Yjs
    const isProcessingRemoteUpdate = useRef(false);
    
    // Reset sync tracking when workspace changes
    useEffect(() => {
        lastSyncedWorkspaceInfo.current = null;
        isProcessingRemoteUpdate.current = false;
    }, [currentWorkspaceId]);
    
    useEffect(() => {
        // When synced workspace info arrives and differs from local, update it
        if (syncedWorkspaceInfo && currentWorkspace && !isElectronMode) {
            const { name, icon, color } = syncedWorkspaceInfo;
            // Update if any field differs from our last known synced state
            const lastSynced = lastSyncedWorkspaceInfo.current;
            const nameChanged = name && (!lastSynced || name !== lastSynced.name);
            const iconChanged = icon && (!lastSynced || icon !== lastSynced.icon);
            const colorChanged = color && (!lastSynced || color !== lastSynced.color);
            
            if (nameChanged || iconChanged || colorChanged) {
                console.log('[WorkspaceSync] Updating workspace from sync:', { name, icon, color });
                // Set flag before updating to prevent the other effect from pushing back
                isProcessingRemoteUpdate.current = true;
                lastSyncedWorkspaceInfo.current = { name, icon, color };
                updateWorkspace(currentWorkspaceId, { 
                    name: name || currentWorkspace.name, 
                    icon: icon || currentWorkspace.icon, 
                    color: color || currentWorkspace.color 
                });
                // Clear flag after a microtask to allow state to settle
                Promise.resolve().then(() => {
                    isProcessingRemoteUpdate.current = false;
                });
            }
        }
    }, [syncedWorkspaceInfo, currentWorkspace, currentWorkspaceId, updateWorkspace, isElectronMode]);

    // --- Push local workspace info changes to Yjs (for owners/editors) ---
    useEffect(() => {
        if (!currentWorkspace || isElectronMode || !syncUpdateWorkspaceInfo) return;
        
        // Don't push if we're processing a remote update (prevents feedback loop)
        if (isProcessingRemoteUpdate.current) {
            return;
        }
        
        const { name, icon, color } = currentWorkspace;
        const last = lastSyncedWorkspaceInfo.current;
        
        // Check if this is a local change (not an echo from sync)
        const isLocalChange = !last || 
            (last.name !== name) || 
            (last.icon !== icon) || 
            (last.color !== color);
        
        if (isLocalChange && name) {
            console.log('[WorkspaceSync] Pushing local workspace info to Yjs:', { name, icon, color });
            lastSyncedWorkspaceInfo.current = { name, icon, color };
            syncUpdateWorkspaceInfo({ name, icon, color });
        }
    }, [currentWorkspace?.name, currentWorkspace?.icon, currentWorkspace?.color, syncUpdateWorkspaceInfo, isElectronMode]);

    // --- Initialize session key and metadata connection ---
    useEffect(() => {
        // 1. Initialize or retrieve session key
        // Priority: URL fragment > localStorage > generate new
        let key = getKeyFromUrl();
        
        if (!key || key.length !== nacl.secretbox.keyLength) {
            // Try to load from localStorage
            const storedKey = localStorage.getItem('nahma-session-key');
            if (storedKey) {
                try {
                    key = uint8ArrayFromString(storedKey, 'base64url');
                } catch (e) {
                    console.error('Failed to parse stored key:', e);
                }
            }
        }
        
        if (!key || key.length !== nacl.secretbox.keyLength) {
            // Generate new key
            key = nacl.randomBytes(nacl.secretbox.keyLength);
        }
        
        // Always persist to URL and localStorage
        const keyString = uint8ArrayToString(key, 'base64url');
        window.history.replaceState(null, '', '#' + keyString);
        localStorage.setItem('nahma-session-key', keyString);
        
        setSessionKey(key);

        // 2. Only connect to sidecar in Electron mode
        // In web mode, we don't have a sidecar - just use y-websocket for document sync
        if (!isElectronMode) {
            console.log('[App] Web mode - skipping sidecar connection');
            return;
        }

        // Electron mode: Set up metadata WebSocket connection with reconnection
        let metaSocket = null;
        let reconnectAttempts = 0;
        const maxReconnectAttempts = 10;
        const baseDelay = 1000;
        let reconnectTimer = null;
        let isCleanedUp = false;

        const connect = () => {
            if (isCleanedUp) return;
            if (metaSocket?.readyState === WebSocket.OPEN || metaSocket?.readyState === WebSocket.CONNECTING) {
                return;
            }
            
            try {
                metaSocket = new WebSocket('ws://localhost:8081');
                metaSocketRef.current = metaSocket;

                metaSocket.onopen = () => {
                    console.log('Metadata socket connected.');
                    reconnectAttempts = 0;
                    metaSocket.send(JSON.stringify({ 
                        type: 'set-key', 
                        payload: uint8ArrayToString(key, 'base64') 
                    }));
                    metaSocket.send(JSON.stringify({ type: 'list-documents' }));
                };

                metaSocket.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        
                        if (data.type === 'status') {
                            setP2pStatus(data.status);
                            setTorEnabled(data.torEnabled || false);
                            if (data.multiaddr) {
                                const keyString = uint8ArrayToString(key, 'base64url');
                                setInviteLink(`${data.multiaddr}#${keyString}`);
                            } else {
                                setInviteLink('');
                            }
                        } else if (data.type === 'tor-toggled') {
                            setTorEnabled(data.enabled);
                            setP2pStatus(data.status);
                        } else if (data.type === 'key-set') {
                            console.log('Session key confirmed by sidecar');
                        } else if (data.type === 'document-list') {
                            setDocuments(data.documents || []);
                        } else if (data.type === 'document-created') {
                            // Add document if not already in list (avoids duplicates from optimistic update)
                            setDocuments(prev => {
                                if (prev.some(d => d.id === data.document.id)) return prev;
                                return [...prev, data.document];
                            });
                        } else if (data.type === 'document-deleted') {
                            setDocuments(prev => prev.filter(d => d.id !== data.docId));
                        } else if (data.type === 'document-moved') {
                            // Update document's folderId when moved via drag-drop
                            const docId = data.documentId || data.docId;
                            setDocuments(prev => prev.map(d => 
                                d.id === docId 
                                    ? { ...d, folderId: data.folderId || null }
                                    : d
                            ));
                        }
                    } catch (e) {
                        console.error('Failed to parse metadata message:', e);
                    }
                };

                metaSocket.onclose = () => {
                    console.log('Metadata socket disconnected.');
                    if (!isCleanedUp && reconnectAttempts < maxReconnectAttempts) {
                        const delay = baseDelay * Math.pow(2, reconnectAttempts);
                        reconnectAttempts++;
                        console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
                        reconnectTimer = setTimeout(connect, delay);
                    }
                };

                metaSocket.onerror = () => {
                    // Error will trigger onclose, which handles reconnection
                };
            } catch (err) {
                console.error('Failed to create WebSocket:', err);
                if (!isCleanedUp && reconnectAttempts < maxReconnectAttempts) {
                    const delay = baseDelay * Math.pow(2, reconnectAttempts);
                    reconnectAttempts++;
                    reconnectTimer = setTimeout(connect, delay);
                }
            }
        };

        // Start initial connection
        connect();

        return () => {
            isCleanedUp = true;
            clearTimeout(reconnectTimer);
            if (metaSocket && metaSocket.readyState !== WebSocket.CONNECTING) {
                // Only close if not still connecting (avoids StrictMode double-invoke error)
                metaSocket.close();
            } else if (metaSocket) {
                // For connecting sockets, let them complete then close
                metaSocket.onopen = () => metaSocket.close();
            }
        };
    }, []);

    // --- Document Management ---
    const createDocument = useCallback((name, folderId = null, docType = DOC_TYPES.TEXT, icon = null, color = null) => {
        // Require workspace to create documents
        if (!currentWorkspaceId) {
            showToast('Please create a workspace first', 'error');
            return null;
        }
        
        const docId = generateDocId();
        const document = {
            id: docId,
            name: name,
            type: docType,
            icon: icon || null,
            color: color || null,
            workspaceId: currentWorkspaceId,
            folderId: folderId, // null = root level, or folder ID
            createdAt: Date.now(),
            lastEdited: Date.now(),
            authorCount: 1
        };

        // Create Yjs doc and provider - pass serverUrl for remote workspaces
        const ydoc = new Y.Doc();
        const wsUrl = getWsUrl(workspaceServerUrl);
        console.log(`[App] Creating document ${docId} with wsUrl: ${wsUrl}`);
        const provider = new WebsocketProvider(wsUrl, docId, ydoc);
        ydocsRef.current.set(docId, { ydoc, provider, type: docType });

        // Add to shared document list (syncs to all connected clients)
        // Use Yjs sync for: web mode OR Electron with remote workspace
        if (!isElectronMode || isRemoteWorkspace) {
            syncAddDocument(document);
        } else {
            // Electron local mode: update local state
            setDocuments(prev => {
                if (prev.some(d => d.id === docId)) return prev;
                return [...prev, document];
            });
        }

        // Notify sidecar (for persistence) - Electron local mode only
        if (isElectronMode && !isRemoteWorkspace && metaSocketRef.current?.readyState === WebSocket.OPEN) {
            metaSocketRef.current.send(JSON.stringify({ 
                type: 'create-document', 
                document 
            }));
        }

        // Open the document tab immediately
        setOpenTabs(prev => [...prev, { 
            id: docId, 
            name: name || 'Untitled',
            docType: docType,
            hasUnsavedChanges: false 
        }]);
        setActiveDocId(docId);
        const typeNames = {
            [DOC_TYPES.KANBAN]: 'Kanban board',
            [DOC_TYPES.SHEET]: 'Spreadsheet',
            [DOC_TYPES.TEXT]: 'Document'
        };
        showToast(`${typeNames[docType] || 'Document'} created`, 'success');

        return docId;
    }, [currentWorkspaceId, showToast]);

    const openDocument = useCallback((docId, name, docType = DOC_TYPES.TEXT) => {
        // Check if already open
        if (openTabs.find(t => t.id === docId)) {
            setActiveDocId(docId);
            return;
        }

        // Create provider if not exists
        if (!ydocsRef.current.has(docId)) {
            const ydoc = new Y.Doc();
            // Pass serverUrl for cross-platform sync (Electron joining remote workspace)
            const wsUrl = getWsUrl(workspaceServerUrl);
            console.log(`[App] Opening document ${docId} with wsUrl: ${wsUrl}`);
            const provider = new WebsocketProvider(wsUrl, docId, ydoc);
            ydocsRef.current.set(docId, { ydoc, provider, type: docType });
        }

        // Add to tabs
        setOpenTabs(prev => [...prev, { 
            id: docId, 
            name: name || 'Untitled',
            docType: docType,
            hasUnsavedChanges: false 
        }]);
        setActiveDocId(docId);
    }, [openTabs, workspaceServerUrl]);

    const closeDocument = useCallback((docId) => {
        const tabIndex = openTabs.findIndex(t => t.id === docId);
        if (tabIndex === -1) return;

        const newTabs = openTabs.filter(t => t.id !== docId);
        setOpenTabs(newTabs);

        if (activeDocId === docId) {
            if (newTabs.length > 0) {
                const newIndex = Math.min(tabIndex, newTabs.length - 1);
                setActiveDocId(newTabs[newIndex].id);
            } else {
                setActiveDocId(null);
            }
        }

        // Cleanup provider
        const docRef = ydocsRef.current.get(docId);
        if (docRef) {
            docRef.provider.disconnect();
            docRef.ydoc.destroy();
            ydocsRef.current.delete(docId);
        }
    }, [openTabs, activeDocId]);

    const deleteDocument = useCallback((docId) => {
        closeDocument(docId);

        // Remove from shared document list (syncs to all clients)
        // Use Yjs sync for: web mode OR Electron with remote workspace
        if (!isElectronMode || isRemoteWorkspace) {
            syncRemoveDocument(docId);
        }

        // Notify sidecar - Electron local mode only
        if (isElectronMode && !isRemoteWorkspace && metaSocketRef.current?.readyState === WebSocket.OPEN) {
            metaSocketRef.current.send(JSON.stringify({ 
                type: 'delete-document', 
                docId 
            }));
        }
        showToast('Document deleted', 'success');
    }, [closeDocument, isElectronMode, isRemoteWorkspace, syncRemoveDocument, showToast]);

    // Move document to a folder (or to root if folderId is null)
    const handleMoveDocument = useCallback((documentId, folderId) => {
        // Update via sync (web mode or remote workspace) or local state (Electron local)
        if (!isElectronMode || isRemoteWorkspace) {
            syncUpdateDocument(documentId, { folderId: folderId || null });
        } else {
            setDocuments(prev => prev.map(d => 
                d.id === documentId 
                    ? { ...d, folderId: folderId || null }
                    : d
            ));
        }
        
        // Also call the FolderContext function to sync with sidecar (Electron local only)
        if (isElectronMode && !isRemoteWorkspace) {
            moveDocumentToFolder(documentId, folderId);
        }
    }, [moveDocumentToFolder, isElectronMode, isRemoteWorkspace, syncUpdateDocument]);

    // Rename document
    const renameDocument = useCallback((docId, newName) => {
        if (!newName?.trim()) return;
        
        // Update via sync (web mode or remote workspace) or local state (Electron local)
        if (!isElectronMode || isRemoteWorkspace) {
            syncUpdateDocument(docId, { name: newName.trim() });
        } else {
            setDocuments(prev => prev.map(d => 
                d.id === docId 
                    ? { ...d, name: newName.trim() }
                    : d
            ));
        }
        
        // Also update local open tabs
        setOpenTabs(prev => prev.map(tab => 
            tab.id === docId 
                ? { ...tab, name: newName.trim() }
                : tab
        ));
        
        showToast('Document renamed', 'success');
    }, [isElectronMode, isRemoteWorkspace, syncUpdateDocument, showToast]);

    const copyInviteLink = useCallback(() => {
        if (inviteLink) {
            navigator.clipboard.writeText(inviteLink);
            showToast('Invite link copied!', 'success');
        }
    }, [inviteLink, showToast]);

    const toggleTor = useCallback(() => {
        if (metaSocketRef.current?.readyState === WebSocket.OPEN) {
            metaSocketRef.current.send(JSON.stringify({ 
                type: 'toggle-tor', 
                payload: { enable: !torEnabled }
            }));
            showToast(torEnabled ? 'Disabling Tor...' : 'Enabling Tor...', 'info');
        }
    }, [torEnabled, showToast]);

    const toggleFullscreen = useCallback(() => {
        setIsFullscreen(prev => !prev);
    }, []);

    // Escape key to exit fullscreen
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && isFullscreen) {
                setIsFullscreen(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isFullscreen]);

    // --- Get active document ---
    const activeDoc = activeDocId ? ydocsRef.current.get(activeDocId) : null;
    const activeTabName = openTabs.find(t => t.id === activeDocId)?.name || 'Untitled';
    const activeDocType = openTabs.find(t => t.id === activeDocId)?.docType || DOC_TYPES.TEXT;

    // Debug logging for changelog observer
    console.log('[App] activeDocId:', activeDocId, 'activeDoc:', !!activeDoc, 'ydoc:', !!activeDoc?.ydoc);

    // Observe changelog changes at the App level (runs even when panel is closed)
    const currentUser = { name: userHandle, color: userColor, icon: userIcon };
    useChangelogObserver(
        activeDoc?.ydoc, 
        activeDocId, 
        currentUser
    );

    // Track collaborators for all documents (for sidebar pips)
    const [documentCollaborators, setDocumentCollaborators] = useState({});
    
    useEffect(() => {
        // Build collaborator map for all docs with providers
        const updateAllCollaborators = () => {
            const collabMap = {};
            ydocsRef.current.forEach((docData, docId) => {
                if (docData.provider?.awareness) {
                    const states = docData.provider.awareness.getStates();
                    const collabList = [];
                    states.forEach((state, clientId) => {
                        // Filter out:
                        // 1. Current session (by clientID)
                        // 2. Same user in other tabs/sessions (by username)
                        const isCurrentSession = clientId === docData.provider.awareness.clientID;
                        const isCurrentUser = state.user?.name && state.user.name === userHandle;
                        
                        if (state.user && !isCurrentSession && !isCurrentUser) {
                            const selection = state.selection;
                            // Build context info (cell reference for sheets)
                            let contextInfo = null;
                            if (selection?.row && selection?.column) {
                                contextInfo = getCellRangeRef(selection);
                            }
                            collabList.push({
                                clientId,
                                name: state.user.name || 'Anonymous',
                                color: state.user.color || '#888888',
                                icon: state.user.icon || null,
                                contextInfo,
                                selection
                            });
                        }
                    });
                    if (collabList.length > 0) {
                        collabMap[docId] = collabList;
                    }
                }
            });
            setDocumentCollaborators(collabMap);
        };

        // Subscribe to awareness changes on all providers
        const cleanupFns = [];
        ydocsRef.current.forEach((docData, docId) => {
            if (docData.provider?.awareness) {
                docData.provider.awareness.on('change', updateAllCollaborators);
                cleanupFns.push(() => docData.provider.awareness.off('change', updateAllCollaborators));
            }
        });
        
        updateAllCollaborators();

        return () => {
            cleanupFns.forEach(fn => fn());
        };
    }, [openTabs, userHandle]); // Re-run when tabs change or username changes

    // Get collaborators for active document (for status bar)
    const collaborators = documentCollaborators[activeDocId] || [];
    
    // Track total (historical) collaborators using Y.Array for persistence
    const [collaboratorCounts, setCollaboratorCounts] = useState({ online: 0, total: 0 });
    const collaboratorTrackerRef = useRef(null);
    
    useEffect(() => {
        // Clean up previous tracker
        if (collaboratorTrackerRef.current) {
            collaboratorTrackerRef.current.destroy();
            collaboratorTrackerRef.current = null;
        }
        
        if (!activeDoc?.ydoc || !activeDoc?.provider?.awareness) {
            setCollaboratorCounts({ online: 0, total: 0 });
            return;
        }
        
        // Create tracker for active document
        const tracker = createCollaboratorTracker(activeDoc.ydoc, activeDoc.provider.awareness);
        collaboratorTrackerRef.current = tracker;
        
        // Update counts function
        const updateCounts = () => {
            // Online count from current awareness (matching the collaborators array)
            const onlineCount = collaborators.length;
            // Total count from historical tracking
            const totalCount = tracker.getTotalCount();
            setCollaboratorCounts({ online: onlineCount, total: totalCount });
        };
        
        // Subscribe to changes in the collaborators Y.Array
        tracker.collaborators.observe(updateCounts);
        
        // Initial count
        updateCounts();
        
        return () => {
            tracker.collaborators.unobserve(updateCounts);
            tracker.destroy();
        };
    }, [activeDoc?.ydoc, activeDoc?.provider, collaborators.length]);

    // --- Render ---
    
    // Show onboarding if identity doesn't exist and not loading
    if (needsOnboarding && !userIdentity && !identityLoading) {
        return <OnboardingFlow onComplete={handleOnboardingComplete} />;
    }
    
    return (
        <div className={`app-container ${isFullscreen ? 'fullscreen' : ''} ${!hasWorkspaces && !workspacesLoading ? 'onboarding' : ''}`}>
            {/* Only show sidebar when we have workspaces (or while loading) */}
            {(hasWorkspaces || workspacesLoading) && (
                <HierarchicalSidebar
                    // Document props
                    documents={documents}
                    activeDocId={activeDocId}
                    onSelectDocument={(docId) => {
                        const doc = documents.find(d => d.id === docId);
                        let docType = doc?.type;
                        if (!docType && doc?.name?.toLowerCase().includes('kanban')) {
                            docType = DOC_TYPES.KANBAN;
                        }
                        if (!docType && doc?.name?.toLowerCase().includes('sheet')) {
                            docType = DOC_TYPES.SHEET;
                        }
                        openDocument(docId, doc?.name, docType || DOC_TYPES.TEXT);
                    }}
                    onCreateDocument={(name, folderId, icon, color) => createDocument(name, folderId, DOC_TYPES.TEXT, icon, color)}
                    onCreateSheet={(name, folderId, icon, color) => createDocument(name || 'Spreadsheet', folderId, DOC_TYPES.SHEET, icon, color)}
                    onCreateKanban={(name, folderId, icon, color) => createDocument(name || 'Kanban Board', folderId, DOC_TYPES.KANBAN, icon, color)}
                    onDeleteDocument={deleteDocument}
                    onMoveDocument={handleMoveDocument}
                    onRenameDocument={renameDocument}
                    onUpdateDocument={syncUpdateDocument}
                    documentCollaborators={documentCollaborators}
                    
                    // UI props
                    isCollapsed={sidebarCollapsed}
                    onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
                    
                    // Workspace props
                    workspaces={workspaces}
                    currentWorkspace={currentWorkspace}
                    onSwitchWorkspace={switchWorkspace}
                    onCreateWorkspace={createWorkspace}
                    onJoinWorkspace={joinWorkspace}
                    onUpdateWorkspace={updateWorkspace}
                    onDeleteWorkspace={deleteWorkspace}
                    workspacesLoading={workspacesLoading}
                    workspaceCollaborators={workspaceCollaborators}
                    
                    // Membership props
                    workspaceMembers={workspaceMembers}
                    onKickMember={handleKickMember}
                    onTransferOwnership={syncTransferOwnership}
                    
                    // Folder props
                    folders={folders}
                    onCreateFolder={createFolder}
                    onDeleteFolder={deleteFolder}
                    onRenameFolder={renameFolder}
                    onRenameDocument={renameDocument}
                />
            )}

            <div className="main-content">
                {/* Fullscreen exit button - always visible in fullscreen mode */}
                {isFullscreen && (
                    <button
                        className="fullscreen-exit-btn"
                        onClick={toggleFullscreen}
                        title="Exit fullscreen (Esc)"
                    >
                        ⤢ Exit Fullscreen
                    </button>
                )}

                {/* Always show header bar with tabs (if any) and profile */}
                <div className={`main-header ${openTabs.length === 0 ? 'main-header--no-tabs' : ''}`}>
                    {openTabs.length > 0 ? (
                        <TabBar
                            tabs={openTabs}
                            activeTabId={activeDocId}
                            onSelectTab={setActiveDocId}
                            onCloseTab={closeDocument}
                            onShowChangelog={() => setShowChangelog(true)}
                            onShowComments={() => setShowComments(!showComments)}
                            showComments={showComments}
                            userProfile={userProfile}
                            onProfileChange={setUserProfile}
                            isFullscreen={isFullscreen}
                            onToggleFullscreen={toggleFullscreen}
                            documents={documents}
                            folders={folders}
                        />
                    ) : (
                        <div className="header-bar-minimal">
                            <div className="header-spacer"></div>
                            <div className="header-actions">
                                <button
                                    className="tab-bar-btn"
                                    onClick={toggleFullscreen}
                                    title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                                >
                                    {isFullscreen ? '⤢' : '⤡'}
                                </button>
                                <UserProfile
                                    userProfile={userProfile}
                                    onProfileChange={setUserProfile}
                                />
                            </div>
                        </div>
                    )}
                </div>

                <div className="editor-with-comments">
                    {activeDoc ? (
                        activeDocType === DOC_TYPES.KANBAN ? (
                            <Kanban
                                key={activeDocId}
                                ydoc={activeDoc.ydoc}
                                provider={activeDoc.provider}
                                userColor={userColor}
                                readOnly={!canEditCurrentWorkspace}
                                onAddComment={(selection) => {
                                    setPendingComment({
                                        ...selection,
                                        documentType: 'kanban'
                                    });
                                    setShowComments(true);
                                }}
                            />
                        ) : activeDocType === DOC_TYPES.SHEET ? (
                            <Sheet
                                key={activeDocId}
                                ydoc={activeDoc.ydoc}
                                provider={activeDoc.provider}
                                userColor={userColor}
                                userHandle={userHandle}
                                readOnly={!canEditCurrentWorkspace}
                                onStatsChange={setStats}
                                onAddComment={(selection) => {
                                    setPendingComment({
                                        ...selection,
                                        documentType: 'sheet'
                                    });
                                    setShowComments(true);
                                }}
                            />
                        ) : (
                            <SplitPane key={activeDocId} docId={activeDocId} maxSplits={10}>
                                <EditorPane
                                    ydoc={activeDoc.ydoc}
                                    provider={activeDoc.provider}
                                    userHandle={userHandle}
                                    userColor={userColor}
                                    userIcon={userIcon}
                                    docName={activeTabName}
                                    onStatsChange={setStats}
                                    readOnly={!canEditCurrentWorkspace}
                                    onAddComment={(selection) => {
                                        setPendingComment({
                                            ...selection,
                                            documentType: 'text'
                                        });
                                        setShowComments(true);
                                    }}
                                />
                            </SplitPane>
                        )
                    ) : workspacesLoading ? (
                        <div className="empty-editor-state loading-state">
                            <div className="loading-spinner"></div>
                            <h2>Loading...</h2>
                            <p>Connecting to your workspace data...</p>
                        </div>
                    ) : !hasWorkspaces ? (
                        <div className="empty-editor-state onboarding-welcome">
                        <div className="welcome-icon">🚀</div>
                        <h2>Welcome to Nahma</h2>
                        <p>Secure P2P Collaboration. Create a workspace or join an existing one.</p>
                        <div className="create-buttons">
                            <button className="btn-create primary" onClick={() => {
                                setCreateWorkspaceMode('create');
                                setShowCreateWorkspaceDialog(true);
                            }}>
                                📁 Create Workspace
                            </button>
                            <button className="btn-create secondary" onClick={() => {
                                setCreateWorkspaceMode('join');
                                setShowCreateWorkspaceDialog(true);
                            }}>
                                🔗 Join with a Code
                            </button>
                        </div>
                    </div>
                    ) : (
                        <div className="empty-editor-state">
                            <h2>Ready to collaborate</h2>
                            <p>Create a document or select one from the sidebar to get started.</p>
                            <div className="create-buttons">
                                <button className="btn-create" onClick={() => createDocument('Untitled', null, DOC_TYPES.TEXT)}>
                                    📝 New Document
                                </button>
                                <button className="btn-create sheet" onClick={() => createDocument('Spreadsheet', null, DOC_TYPES.SHEET)}>
                                    📊 New Spreadsheet
                                </button>
                                <button className="btn-create kanban" onClick={() => createDocument('Kanban Board', null, DOC_TYPES.KANBAN)}>
                                    📋 New Kanban Board
                                </button>
                            </div>
                        </div>
                    )}
                    
                    {/* Comments Panel */}
                    {showComments && activeDoc && (
                        <Comments
                            ydoc={activeDoc.ydoc}
                            provider={activeDoc.provider}
                            username={userHandle}
                            userColor={userColor}
                            documentType={activeDocType}
                            isVisible={showComments}
                            onClose={() => setShowComments(false)}
                            pendingSelection={pendingComment}
                            onPendingSelectionHandled={() => setPendingComment(null)}
                        />
                    )}
                </div>

                <StatusBar
                    p2pStatus={p2pStatus}
                    inviteLink={inviteLink}
                    torEnabled={torEnabled}
                    onToggleTor={toggleTor}
                    onCopyInvite={copyInviteLink}
                    onOpenRelaySettings={() => setShowRelaySettings(true)}
                    onOpenTorSettings={() => setShowTorSettings(true)}
                    wordCount={stats.wordCount}
                    characterCount={stats.characterCount}
                    cellCount={stats.cellCount}
                    collaborators={collaborators}
                    onlineCount={workspaceOnlineCount}
                    totalCollaborators={workspaceTotalCount}
                    documentType={activeDocType}
                    onStartChatWith={(user) => setChatTargetUser(user)}
                />
            </div>

            {/* Relay Settings Modal */}
            <RelaySettings
                isOpen={showRelaySettings}
                onClose={() => setShowRelaySettings(false)}
            />

            {/* Tor Settings Modal */}
            {showTorSettings && (
                <TorSettings
                    isOpen={showTorSettings}
                    onClose={() => setShowTorSettings(false)}
                />
            )}

            {toast && (
                <div 
                    className={`toast ${toast.type}`}
                    role="alert"
                    aria-live="polite"
                >
                    <span className="toast__icon">
                        {toast.type === 'success' && '✓'}
                        {toast.type === 'error' && '✕'}
                        {toast.type === 'warning' && '⚠'}
                        {toast.type === 'info' && 'ℹ'}
                    </span>
                    <span className="toast__message">{toast.message}</span>
                    <button 
                        className="toast__close" 
                        onClick={() => setToast(null)}
                        aria-label="Dismiss notification"
                    >
                        ×
                    </button>
                </div>
            )}

            {/* Global Chat for collaboration - show when workspace exists */}
            {hasWorkspaces && workspaceProvider && (
                <Chat
                    ydoc={workspaceYdoc}
                    provider={workspaceProvider}
                    username={userHandle}
                    userColor={userColor}
                    userIcon={userIcon}
                    workspaceId={currentWorkspace?.id}
                    targetUser={chatTargetUser}
                    onTargetUserHandled={() => setChatTargetUser(null)}
                />
            )}

            {/* Changelog Panel */}
            {activeDoc && (
                <ChangelogPanel
                    docId={activeDocId}
                    ydoc={activeDoc.ydoc}
                    documentType={activeDocType}
                    isOpen={showChangelog}
                    onClose={() => setShowChangelog(false)}
                    onRollback={activeDocType === DOC_TYPES.TEXT ? (stateData) => {
                        // Rollback: apply the state snapshot (text documents only)
                        if (stateData instanceof Uint8Array) {
                            // New format: Yjs state snapshot
                            const newDoc = new Y.Doc();
                            Y.applyUpdate(newDoc, stateData);
                            const fragment = activeDoc.ydoc.get('prosemirror', Y.XmlFragment);
                            const newFragment = newDoc.get('prosemirror', Y.XmlFragment);
                            activeDoc.ydoc.transact(() => {
                                fragment.delete(0, fragment.length);
                                // Copy content from new doc
                                newFragment.toArray().forEach(item => {
                                    fragment.push([item.clone()]);
                                });
                            });
                        } else {
                            // Old format: plain text (fallback)
                            console.log('Rollback to text not supported for ProseMirror');
                        }
                        setShowChangelog(false);
                        setToast({ message: 'Document rolled back successfully', type: 'success' });
                    } : null}
                    currentUser={{ name: userHandle, color: userColor, icon: userIcon }}
                />
            )}
            
            {/* Create/Join Workspace Dialog (from main area CTA) */}
            {showCreateWorkspaceDialog && (
                <CreateWorkspace
                    mode={createWorkspaceMode}
                    onClose={() => {
                        setShowCreateWorkspaceDialog(false);
                        setCreateWorkspaceMode('create'); // Reset to default
                    }}
                    onSuccess={() => {
                        setShowCreateWorkspaceDialog(false);
                        setCreateWorkspaceMode('create'); // Reset to default
                    }}
                />
            )}

            {/* Kicked from Workspace Modal */}
            {isUserKicked && currentWorkspace && (
                <KickedModal
                    workspaceName={currentWorkspace.name}
                    onClose={() => {
                        // Leave the workspace to clear local data
                        leaveWorkspace(currentWorkspaceId);
                        
                        // Switch to another workspace or clear selection
                        const otherWorkspace = workspaces.find(w => w.id !== currentWorkspaceId);
                        if (otherWorkspace) {
                            switchWorkspace(otherWorkspace.id);
                        } else {
                            // No other workspaces - just clear current
                            switchWorkspace(null);
                        }
                    }}
                    onClearData={() => {
                        // Same as onClose - leave workspace
                        leaveWorkspace(currentWorkspaceId);
                    }}
                />
            )}
        </div>
    );
}

export default App;
