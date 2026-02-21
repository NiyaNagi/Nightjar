import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import { EncryptedIndexeddbPersistence } from './utils/EncryptedIndexeddbPersistence';
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
import InventoryDashboard from './components/inventory/InventoryDashboard';
import FileStorageDashboard from './components/files/FileStorageDashboard';
import { FileTransferProvider } from './contexts/FileTransferContext';
import Chat from './components/Chat';
import Comments from './components/Comments';
import SplitPane from './components/SplitPane';
import UserProfile, { loadUserProfile } from './components/UserProfile';
import ChangelogPanel from './components/Changelog';
import CreateWorkspace from './components/CreateWorkspace';
import CreateDocumentDialog from './components/CreateDocument';
import KickedModal from './components/KickedModal';
import SyncProgressModal from './components/SyncProgressModal';
import OnboardingFlow from './components/Onboarding/OnboardingFlow';
import IdentitySelector from './components/IdentitySelector';
import LockScreen from './components/LockScreen';
import NightjarMascot from './components/NightjarMascot';
import HelpPage from './components/common/HelpPage';
import DeepLinkGate from './components/common/DeepLinkGate';
import SearchPalette from './components/SearchPalette';
import BugReportModal from './components/BugReportModal';
import { handleIndexResults, clearCache as clearSearchIndexCache } from './services/SearchIndexCache';
import { useAutoLock } from './hooks/useAutoLock';
import identityManager from './utils/identityManager';
import { deleteChangelogForDocument } from './utils/changelogStore';
import { useAuthorAttribution } from './hooks/useAuthorAttribution';
import { useChangelogObserver } from './hooks/useChangelogObserver';
import { useWorkspaceSync } from './hooks/useWorkspaceSync';
import { useWorkspacePeerStatus } from './hooks/useWorkspacePeerStatus';
import { useWorkspaces } from './contexts/WorkspaceContext';
import { useFolders } from './contexts/FolderContext';
import { usePermissions } from './contexts/PermissionContext';
import { useIdentity } from './contexts/IdentityContext';
import { PresenceProvider, usePresence } from './contexts/PresenceContext';
import { useToast } from './contexts/ToastContext';
import { logBehavior } from './utils/logger';
import { createCollaboratorTracker } from './utils/collaboratorTracking';
import { useEnvironment, isElectron, isCapacitor, getPlatform } from './hooks/useEnvironment';
import { getYjsWebSocketUrl, deliverKeyToServer, computeRoomAuthTokenSync, getAssetUrl } from './utils/websocket';
import { parseShareLink, clearUrlFragment, isJoinUrl, joinUrlToNightjarLink } from './utils/sharing';
import { META_WS_PORT, CONTENT_DOC_TYPES } from './config/constants';
import { handleShareLink, isNightjarShareLink } from './utils/linkHandler';

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
import './components/NightjarMascot.css';

// Get WebSocket URL using centralized utility
const getWsUrl = getYjsWebSocketUrl;

// --- Helper Functions ---
function getKeyFromUrl() {
    const fragment = window.location.hash.slice(1);
    if (!fragment) return null;
    
    // SECURITY FIX: Check if this is actually a share link before treating as session key
    if (isShareLinkFragment(fragment)) {
        console.log('[Security] URL fragment contains share link, not treating as session key');
        return null; // Don't use share links as session keys
    }
    
    try {
        return uint8ArrayFromString(fragment, 'base64url');
    } catch (e) {
        console.error('Failed to parse key from URL fragment.', e);
        return null;
    }
}

function isShareLinkFragment(fragment) {
    // Check if fragment looks like a workspace share link
    // Must be specific to avoid false positives
    
    if (!fragment || fragment.length < 20) {
        return false; // Too short to be a workspace identifier
    }
    
    // Check for known share link patterns:
    // 1. Contains known fragment parameters like k:, perm:, topic:, sig:, exp:
    if (/[&]?(k|perm|topic|sig|exp|by|hpeer|srv|addr):/.test(fragment)) {
        return true;
    }
    
    // 2. Starts with base64-like workspace ID followed by fragment params
    // e.g., "O4YtGGtX-5Q5ZZIFUgLDoK4tnhQV2W0zjMjy_6oQq4w"
    if (/^[A-Za-z0-9_-]{20,}(&|$)/.test(fragment) && fragment.includes('&')) {
        return true;
    }
    
    return false;
}

function generateDocId() {
    return 'doc-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
}

// Document types supported
const DOC_TYPES = {
    TEXT: 'text',
    SHEET: 'sheet',
    KANBAN: 'kanban',
    INVENTORY: 'inventory',
    FILE_STORAGE: 'files',
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

// Component to update presence when active document changes
function PresenceDocumentTracker({ activeDocId }) {
    const { updateOpenDocument } = usePresence();
    
    useEffect(() => {
        updateOpenDocument(activeDocId);
    }, [activeDocId, updateOpenDocument]);
    
    return null;
}

function App() {
    // --- Identity Context ---
    // Identity context is available for features like kick signatures, membership tracking
    const { 
        identity: userIdentity,
        publicIdentity,  // For useWorkspaceSync (has .publicKeyBase62)
        needsOnboarding, 
        createIdentity,
        loading: identityLoading,
        syncFromIdentityManager,
    } = useIdentity();

    // Crypto-capable identity for inventory address encryption/decryption.
    // Extends publicIdentity with a pre-derived Curve25519 encryption key
    // (32 bytes) — this is the ONLY secret exposed to inventory components.
    // The full Ed25519 signing key never leaves this scope.
    const [curveSecretKey, setCurveSecretKey] = useState(null);
    useEffect(() => {
        let cancelled = false;
        if (!userIdentity?.privateKey) { setCurveSecretKey(null); return; }
        (async () => {
            try {
                const { ed25519ToCurve25519Secret } = await import('./utils/addressCrypto');
                const curve = await ed25519ToCurve25519Secret(userIdentity.privateKey);
                if (!cancelled) setCurveSecretKey(curve);
            } catch (err) {
                console.error('[App] Failed to derive Curve25519 key for inventory:', err);
            }
        })();
        return () => { cancelled = true; };
    }, [userIdentity?.privateKey]);

    const inventoryIdentity = useMemo(() => {
        if (!publicIdentity) return null;
        return {
            ...publicIdentity,
            curveSecretKey,                              // Uint8Array (32 bytes) — Curve25519 encryption-only key
            publicKeyHex: userIdentity?.publicKeyHex,   // hex string — for getPublicKeyHex()
        };
    }, [publicIdentity, curveSecretKey, userIdentity?.publicKeyHex]);
    
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
        loading: workspacesLoading,
        setCurrentWorkspaceId
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
    const [meshStatus, setMeshStatus] = useState(null);
    const [publicIP, setPublicIP] = useState(null);
    
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
        createdBy: currentWorkspace.createdBy,
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
        synced: workspaceSyncSynced,
        // Sync progress for UI feedback
        syncPhase,
        syncProgress,
        getYjsDocumentCount,
        // Workspace-level collaborator tracking
        collaborators: workspaceCollaborators,
        onlineCount: workspaceOnlineCount,
        totalCount: workspaceTotalCount,
        // Tab presence: which collaborators have which documents open
        collaboratorsByDocument,
        setOpenDocumentId,
        // Workspace-level ydoc and provider for chat
        ydoc: workspaceYdoc,
        provider: workspaceProvider,
        // Membership tracking
        members: workspaceMembers,
        isKicked: isUserKicked,
        kickMember: syncKickMember,
        transferOwnership: syncTransferOwnership,
        updateMemberPermission: syncUpdateMemberPermission,
        respondToPendingDemotion: syncRespondToPendingDemotion,
        // Inventory Yjs shared types
        yInventorySystems,
        yCatalogItems,
        yInventoryRequests,
        yProducerCapacities,
        yAddressReveals,
        yPendingAddresses,
        yInventoryAuditLog,
        yInventoryNotifications,
        // Inventory operations
        addInventorySystem: syncAddInventorySystem,
        removeInventorySystem: syncRemoveInventorySystem,
        updateInventorySystem: syncUpdateInventorySystem,
        // File Storage Yjs shared types
        yFileStorageSystems,
        yStorageFiles,
        yStorageFolders,
        yChunkAvailability,
        yFileAuditLog,
        // File Storage operations
        addFileStorageSystem: syncAddFileStorageSystem,
        removeFileStorageSystem: syncRemoveFileStorageSystem,
        updateFileStorageSystem: syncUpdateFileStorageSystem,
    } = useWorkspaceSync(currentWorkspaceId, initialWorkspaceInfo, workspaceUserProfile, workspaceServerUrl, publicIdentity, currentWorkspace?.myPermission);
    
    // --- P2P Peer Status (Electron only) ---
    const {
        activePeers,
        totalSeenPeers,
        relayConnected,
        requestSync: requestPeerSync,
        isRetrying: isPeerSyncRetrying,
        syncStatus,
        syncDetails,
        verifySyncState,
        forceFullSync,
    } = useWorkspacePeerStatus(currentWorkspaceId);
    
    // ALWAYS use synced documents from Yjs - this is the single source of truth
    // The sidecar persists to LevelDB but Yjs is the source for the UI
    const isElectronMode = isElectron();
    const isRemoteWorkspace = !!workspaceServerUrl;
    // Documents are always from Yjs sync - no special casing by permission
    const documents = syncedDocuments;
    
    // --- Document State ---
    const [openTabs, setOpenTabs] = useState([]);
    const [activeDocId, setActiveDocId] = useState(null);
    const ydocsRef = useRef(new Map()); // Map of docId -> { ydoc, provider }

    // --- UI State ---
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [showCreateWorkspaceDialog, setShowCreateWorkspaceDialog] = useState(false);
    const [createWorkspaceMode, setCreateWorkspaceMode] = useState('create'); // 'create' or 'join'
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [stats, setStats] = useState({ wordCount: 0, characterCount: 0 });
    const [showChangelog, setShowChangelog] = useState(false);
    const [chatTargetUser, setChatTargetUser] = useState(null); // User to open DM with
    const [showComments, setShowComments] = useState(false); // Comments panel visibility
    const [pendingComment, setPendingComment] = useState(null); // Selection to add comment to
    const [showRelaySettings, setShowRelaySettings] = useState(false); // Relay settings modal
    const [showTorSettings, setShowTorSettings] = useState(false); // Tor settings modal
    const [showCreateDocumentDialog, setShowCreateDocumentDialog] = useState(false); // Create document modal
    const [createDocumentType, setCreateDocumentType] = useState('text'); // Pre-selected document type
    const [showIdentitySelector, setShowIdentitySelector] = useState(false); // Identity selector for multiple identities
    const [showCreateNewIdentity, setShowCreateNewIdentity] = useState(false); // Show onboarding to create new identity
    const [needsMigration, setNeedsMigration] = useState(false); // Migration needed for legacy identity
    const [legacyIdentity, setLegacyIdentity] = useState(null); // Legacy identity data for migration
    const [startupComplete, setStartupComplete] = useState(false); // Track if startup identity check is complete
    const [showSyncProgress, setShowSyncProgress] = useState(false); // Show sync progress modal for new workspace joins
    const [syncProgressWorkspaceId, setSyncProgressWorkspaceId] = useState(null); // Track which workspace is syncing
    const [showHelp, setShowHelp] = useState(false); // Show help/documentation overlay
    const [helpSection, setHelpSection] = useState(null); // Deep-link to specific help section
    const [showSearchPalette, setShowSearchPalette] = useState(false); // Cross-app search palette
    const [showBugReport, setShowBugReport] = useState(false); // Bug report modal
    const [expandedFolders, setExpandedFolders] = useState(new Set()); // Lifted from sidebar for search folder-reveal
    const [showDeepLinkGate, setShowDeepLinkGate] = useState(false); // Deep link attempt overlay
    const [pendingDeepLink, setPendingDeepLink] = useState(null); // nightjar:// link for deep link gate

    // --- Auto-Lock Hook ---
    const { isLocked, setIsLocked, lock: lockApp, unlock: unlockApp } = useAutoLock();

    // --- Refs ---
    const metaSocketRef = useRef(null);

    // --- Toast (from context, available to all components) ---
    const { showToast } = useToast();

    // --- Helper: Process pending share link after onboarding or lock screen ---
    const processPendingShareLink = useCallback(() => {
        const pendingLink = sessionStorage.getItem('pendingShareLink');
        if (!pendingLink) return;

        // Check if the pending link has expired
        const pendingExpiry = sessionStorage.getItem('pendingShareLinkExpiry');
        if (pendingExpiry) {
            const expiryTs = parseInt(pendingExpiry, 10);
            if (Date.now() > expiryTs) {
                console.log('[App] Pending share link has expired, discarding');
                sessionStorage.removeItem('pendingShareLink');
                sessionStorage.removeItem('pendingShareLinkExpiry');
                showToast('The share link expired while you were setting up. Please request a new one.', 'warning');
                return;
            }
        }

        console.log('[App] Found pending share link after identity setup, opening join dialog');
        // Use setTimeout to let the current render cycle complete
        setTimeout(() => {
            setCreateWorkspaceMode('join');
            setShowCreateWorkspaceDialog(true);
            showToast('Share link detected - please review the invitation details', 'info');
        }, 500);
    }, [showToast]);

    // --- Onboarding Handler ---
    const handleOnboardingComplete = useCallback(async (identity, hadLocalData = false) => {
        try {
            logBehavior('identity', 'onboarding_complete', { hadLocalData });
            console.log('[App] Creating identity from onboarding:', identity.handle);
            
            // Use the new identity manager to create identity with PIN
            if (identity.pin) {
                // New multi-identity system with PIN
                const result = await identityManager.createIdentity(identity, identity.pin);
                console.log('[App] Identity created with PIN:', result.id);
                
                // CRITICAL: Clear any locked state since we just created a new identity with valid session
                setIsLocked(false);
                
                // Also create legacy identity for backward compatibility
                const success = await createIdentity(identity);
                
                if (success) {
                    // Clear legacy identity keys to prevent re-migration
                    // These are checked by needsMigration() and would cause a loop
                    localStorage.removeItem('identity');
                    localStorage.removeItem('Nightjar-identity');
                    localStorage.removeItem('Nightjar_secure_identity');
                    console.log('[App] Cleared legacy identity keys');
                    
                    if (hadLocalData || needsMigration) {
                        showToast(`Welcome back, ${identity.handle}! 🔓`, 'success');
                    } else {
                        showToast(`Welcome, ${identity.handle}! 👋`, 'success');
                    }
                    
                    setUserProfile({
                        name: identity.handle,
                        icon: identity.icon || '😊',
                        color: identity.color || '#6366f1',
                    });
                    
                    setNeedsMigration(false);
                    setLegacyIdentity(null);
                }
            } else {
                // Legacy flow (shouldn't happen with new UI)
                const success = await createIdentity(identity);
                if (success) {
                    console.log('[App] Identity created successfully');
                    
                    if (hadLocalData) {
                        showToast(`Welcome back, ${identity.handle}! 🔓`, 'success');
                    } else {
                        showToast(`Welcome, ${identity.handle}! 👋`, 'success');
                    }
                    
                    setUserProfile({
                        name: identity.handle,
                        icon: identity.icon || '😊',
                        color: identity.color || '#6366f1',
                    });
                } else {
                    console.error('[App] Failed to create identity');
                    showToast('Failed to create identity. Please try again.', 'error');
                }
            }
        } catch (error) {
            console.error('[App] Error during identity creation:', error);
            showToast('Error creating identity: ' + error.message, 'error');
        }

        // Check for pending share link that arrived before onboarding was complete
        processPendingShareLink();
    }, [createIdentity, showToast, needsMigration, processPendingShareLink]);

    // --- Lock Screen Handlers ---
    const handleLockScreenUnlock = useCallback((identityData, metadata) => {
        logBehavior('identity', 'lock_screen_unlocked');
        console.log('[App] Unlocked identity:', metadata?.handle);
        unlockApp();
        
        // Update user profile with unlocked identity data
        if (identityData || metadata) {
            setUserProfile({
                name: identityData?.handle || metadata?.handle || 'Anonymous',
                icon: identityData?.icon || metadata?.icon || '😊',
                color: identityData?.color || metadata?.color || '#6366f1',
            });
        }
        
        showToast(`Welcome back, ${metadata?.handle || 'User'}! 🔓`, 'success');

        // Check for pending share link that arrived while locked
        processPendingShareLink();
    }, [unlockApp, showToast, processPendingShareLink]);
    
    const handleSwitchIdentity = useCallback(() => {
        logBehavior('identity', 'switch_identity_initiated');
        setIsLocked(false);
        setShowIdentitySelector(true);
    }, [setIsLocked]);
    
    const handleIdentitySelected = useCallback((identityData, metadata) => {
        logBehavior('identity', 'identity_selected');
        console.log('[App] Identity selected:', metadata?.handle);
        setShowIdentitySelector(false);
        
        // Clear locked state since identity is now selected/unlocked
        setIsLocked(false);
        
        // CRITICAL: Sync identity data (including privateKey) to IdentityContext
        // This enables signed share links to work
        if (identityData) {
            syncFromIdentityManager(identityData);
            
            // Update user profile with selected identity
            setUserProfile({
                name: identityData.handle || metadata?.handle || 'Anonymous',
                icon: identityData.icon || metadata?.icon || '😊',
                color: identityData.color || metadata?.color || '#6366f1',
            });
        }
        
        showToast(`Signed in as ${metadata?.handle || 'User'}`, 'success');
    }, [showToast, setIsLocked, syncFromIdentityManager]);
    
    const handleNeedsMigration = useCallback(() => {
        // Legacy identity detected, need to migrate
        // Try identityManager first (localStorage), then fall back to userIdentity (IdentityContext/Electron)
        const legacy = identityManager.getLegacyIdentity() || userIdentity;
        if (legacy) {
            // Ensure we have the required fields
            const legacyData = {
                ...legacy,
                handle: legacy.handle || userProfile?.name || 'User',
                icon: legacy.icon || userProfile?.icon || '😊',
                color: legacy.color || userProfile?.color || '#6366f1'
            };
            setLegacyIdentity(legacyData);
            setNeedsMigration(true);
        }
    }, [userIdentity, userProfile]);

    // --- Kick Member Handler with Toast Feedback ---
    const handleKickMember = useCallback((publicKey, memberName = 'member') => {
        if (!syncKickMember) return;
        logBehavior('membership', 'kick_member');
        
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

    // --- Update Member Permission Handler with Toast Feedback ---
    const handleUpdateMemberPermission = useCallback((publicKey, newPermission, memberName = 'member') => {
        if (!syncUpdateMemberPermission) return;
        logBehavior('permission', 'update_member_permission', { newPermission });
        
        const result = syncUpdateMemberPermission(publicKey, newPermission);
        const label = newPermission.charAt(0).toUpperCase() + newPermission.slice(1);
        
        if (result === 'pending') {
            showToast(`Demotion request sent to founding owner ${memberName}`, 'info');
        } else if (result === true) {
            showToast(`Changed ${memberName}'s role to ${label}`, 'success');
        } else {
            showToast(`Failed to change ${memberName}'s permission`, 'error');
        }
    }, [syncUpdateMemberPermission, showToast]);

    // --- Respond to Pending Demotion Handler ---
    const handleRespondToPendingDemotion = useCallback((accept) => {
        if (!syncRespondToPendingDemotion) return;
        logBehavior('permission', accept ? 'demotion_accepted' : 'demotion_declined');
        
        const result = syncRespondToPendingDemotion(accept);
        if (result) {
            showToast(accept ? 'Demotion accepted' : 'Demotion declined', accept ? 'info' : 'success');
        }
    }, [syncRespondToPendingDemotion, showToast]);

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

    // --- Update workspace awareness with currently open documents (for tab presence indicators) ---
    useEffect(() => {
        if (setOpenDocumentId) {
            // Send both the focused document and all open document IDs
            const allOpenDocIds = openTabs.map(tab => tab.id);
            setOpenDocumentId(activeDocId, true, allOpenDocIds);
        }
    }, [activeDocId, openTabs, setOpenDocumentId]);

    // --- Android Back Button Handling (Capacitor only) ---
    useEffect(() => {
        // Only add listener if running on Capacitor Android
        if (!isCapacitor() || getPlatform() !== 'android') {
            return;
        }
        
        let backButtonListener = null;
        
        // Dynamically import Capacitor App plugin
        const setupBackButtonHandler = async () => {
            try {
                const { App } = await import('@capacitor/app');
                
                backButtonListener = await App.addListener('backButton', ({ canGoBack }) => {
                    // Priority 1: Close any open modals/dialogs
                    if (showSearchPalette) {
                        setShowSearchPalette(false);
                        return;
                    }
                    if (showRelaySettings) {
                        setShowRelaySettings(false);
                        return;
                    }
                    if (showTorSettings) {
                        setShowTorSettings(false);
                        return;
                    }
                    if (showCreateWorkspaceDialog) {
                        setShowCreateWorkspaceDialog(false);
                        return;
                    }
                    if (showCreateDocumentDialog) {
                        setShowCreateDocumentDialog(false);
                        return;
                    }
                    if (showIdentitySelector) {
                        setShowIdentitySelector(false);
                        return;
                    }
                    if (showChangelog) {
                        setShowChangelog(false);
                        return;
                    }
                    if (showComments) {
                        setShowComments(false);
                        return;
                    }
                    
                    // Priority 2: Close active document tab (only if there are open tabs)
                    if (openTabs.length > 0 && activeDocId) {
                        setActiveDocId(prevActiveDocId => {
                            if (!prevActiveDocId) return null;
                            setOpenTabs(prevTabs => {
                                if (prevTabs.length === 0) return prevTabs;
                                const newTabs = prevTabs.filter(t => t.id !== prevActiveDocId);
                                // Derive next activeDocId from the filtered array
                                const nextId = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null;
                                // Schedule the activeDocId update (can't set during this updater)
                                setTimeout(() => setActiveDocId(nextId), 0);
                                return newTabs;
                            });
                            return prevActiveDocId; // keep current until setTimeout fires
                        });
                        return;
                    }
                    
                    // Priority 3: If browser can go back, allow it
                    if (canGoBack) {
                        window.history.back();
                        return;
                    }
                    
                    // Priority 4: Exit app (with optional confirmation)
                    App.exitApp();
                });
            } catch (err) {
                console.warn('[App] Failed to set up Android back button handler:', err);
            }
        };
        
        setupBackButtonHandler();
        
        return () => {
            if (backButtonListener) {
                backButtonListener.remove();
            }
        };
    }, [
        showRelaySettings, showTorSettings, showCreateWorkspaceDialog, 
        showCreateDocumentDialog, showIdentitySelector, showChangelog, 
        showComments, showSearchPalette, openTabs, activeDocId
    ]);

    // --- Sync workspace info from remote (for joined workspaces) ---
    // Track last synced values to detect local vs remote changes
    const lastSyncedWorkspaceInfo = useRef(null);
    // Flag to prevent feedback loop: when true, we just received a remote update
    // and should not push back to Yjs
    const isProcessingRemoteUpdate = useRef(false);
    // Timer ref for sync progress auto-hide
    const syncProgressTimerRef = useRef(null);
    
    // Track previous workspace to detect changes
    const prevWorkspaceIdRef = useRef(currentWorkspaceId);
    
    // Reset sync tracking and close all tabs when workspace changes
    useEffect(() => {
        lastSyncedWorkspaceInfo.current = null;
        isProcessingRemoteUpdate.current = false;
        
        // Close all open document tabs when switching or leaving workspaces
        if (prevWorkspaceIdRef.current !== currentWorkspaceId) {
            // Clean up ydocs for previous workspace
            if (prevWorkspaceIdRef.current) {
                ydocsRef.current.forEach((docData, docId) => {
                    try {
                        if (docData.provider) {
                            docData.provider.destroy();
                        }
                    } catch (err) {
                        console.warn(`[App] Failed to destroy provider for doc ${docId}:`, err);
                    }
                    try {
                        docData.indexeddbProvider?.destroy();
                    } catch (err) {
                        console.warn(`[App] Failed to destroy indexeddbProvider for doc ${docId}:`, err);
                    }
                    try {
                        if (docData.ydoc) {
                            docData.ydoc.destroy();
                        }
                    } catch (err) {
                        console.warn(`[App] Failed to destroy ydoc for doc ${docId}:`, err);
                    }
                });
                ydocsRef.current.clear();
            }
            
            // Clear open tabs and active document
            setOpenTabs([]);
            setActiveDocId(null);
            
            // Clear search index cache to prevent cross-workspace result leaks
            clearSearchIndexCache();
            
            // Reset collaborator tracking to prevent stale data from previous workspace
            setDocumentCollaborators({});
            
            prevWorkspaceIdRef.current = currentWorkspaceId;
        }
    }, [currentWorkspaceId]);
    
    // Documents are always loaded from Yjs sync
    // The sidecar bootstraps the Yjs document with persisted data
    // No special handling needed here - useWorkspaceSync handles it
    
    // --- Show sync progress modal when joining a non-owner workspace ---
    useEffect(() => {
        // Show modal when:
        // 1. We have a current workspace
        // 2. We're not the owner (joining)
        // 3. Workspace was recently created (name is still "Shared Workspace" - placeholder)
        // 4. Sync is in progress
        if (currentWorkspace && 
            currentWorkspace.myPermission !== 'owner' &&
            currentWorkspace.name === 'Shared Workspace' &&
            syncPhase !== 'complete' && 
            syncPhase !== 'idle') {
            setShowSyncProgress(true);
            setSyncProgressWorkspaceId(currentWorkspaceId);
        }
        
        // Auto-hide when sync completes
        if (syncPhase === 'complete' && syncProgressWorkspaceId === currentWorkspaceId) {
            // Keep showing briefly to show success
            syncProgressTimerRef.current = setTimeout(() => {
                setShowSyncProgress(false);
                setSyncProgressWorkspaceId(null);
            }, 1500);
        }
        return () => {
            if (syncProgressTimerRef.current) {
                clearTimeout(syncProgressTimerRef.current);
                syncProgressTimerRef.current = null;
            }
        };
    }, [currentWorkspace, currentWorkspaceId, syncPhase, syncProgressWorkspaceId]);
    
    useEffect(() => {
        // When synced workspace info arrives and differs from local, update it
        // This applies to ALL users regardless of platform - Yjs is the source of truth
        if (syncedWorkspaceInfo && currentWorkspace) {
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
    }, [syncedWorkspaceInfo, currentWorkspace, currentWorkspaceId, updateWorkspace]);

    // --- Push local workspace info changes to Yjs (for owners/editors) ---
    useEffect(() => {
        if (!currentWorkspace || !syncUpdateWorkspaceInfo) return;
        
        // Don't push if we're processing a remote update (prevents feedback loop)
        if (isProcessingRemoteUpdate.current) {
            return;
        }
        
        const { name, icon, color } = currentWorkspace;
        const last = lastSyncedWorkspaceInfo.current;
        
        // Never push the "Shared Workspace" placeholder to Yjs — it's not a real name.
        // This default gets set when joining a workspace before the real name arrives via sync.
        if (name === 'Shared Workspace') {
            console.log('[WorkspaceSync] Skipping push - "Shared Workspace" is a placeholder, not a real name');
            return;
        }
        
        // Check if this is a local change (not an echo from sync)
        const isLocalChange = !last || 
            (last.name !== name) || 
            (last.icon !== icon) || 
            (last.color !== color);
        
        // On initial load (!last), only push if we're the owner.
        // Non-owners should wait for sync to deliver the real name rather than
        // overwriting it with their stale local copy.
        if (!last && currentWorkspace.myPermission !== 'owner') {
            console.log('[WorkspaceSync] Skipping initial push - non-owner should not overwrite workspace info');
            // Still record what we have so subsequent *real* local changes can be detected
            lastSyncedWorkspaceInfo.current = { name, icon, color };
            return;
        }
        
        if (isLocalChange && name) {
            console.log('[WorkspaceSync] Pushing local workspace info to Yjs:', { name, icon, color });
            lastSyncedWorkspaceInfo.current = { name, icon, color };
            syncUpdateWorkspaceInfo({ name, icon, color });
        }
    }, [currentWorkspace?.name, currentWorkspace?.icon, currentWorkspace?.color, currentWorkspace?.myPermission, syncUpdateWorkspaceInfo]);

    // --- Initialize session key and metadata connection ---
    useEffect(() => {
        // 1. Initialize or retrieve session key
        // Priority: URL fragment > sessionStorage > localStorage (legacy) > generate new
        // SECURITY: Use sessionStorage in Electron mode so the key doesn't persist across
        // app restarts. localStorage is only used in web mode for room sharing.
        let key = getKeyFromUrl();
        
        if (!key || key.length !== nacl.secretbox.keyLength) {
            // Try sessionStorage first (preferred — does not persist to disk)
            const sessionStored = sessionStorage.getItem('nahma-session-key');
            if (sessionStored) {
                try {
                    key = uint8ArrayFromString(sessionStored, 'base64url');
                } catch (e) {
                    console.error('Failed to parse stored key from sessionStorage:', e);
                }
            }
        }
        
        if (!key || key.length !== nacl.secretbox.keyLength) {
            // Fallback: try localStorage for backward compat / web mode persistence
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
        
        // Persist key — sessionStorage for Electron (ephemeral), localStorage for web (shareable rooms)
        const keyString = uint8ArrayToString(key, 'base64url');
        if (isElectronMode) {
            // Electron: use sessionStorage (cleared on app close, never written to disk profile)
            sessionStorage.setItem('nahma-session-key', keyString);
            // Remove any legacy localStorage entry left from older versions
            localStorage.removeItem('nahma-session-key');
        } else {
            // Web mode: persist to URL fragment and localStorage for room sharing
            window.history.replaceState(null, '', '#' + keyString);
            try {
                localStorage.setItem('nahma-session-key', keyString);
            } catch (err) {
                console.warn('[App] Failed to persist session key to localStorage (quota exceeded?):', err);
            }
        }
        
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
                metaSocket = new WebSocket(`ws://localhost:${META_WS_PORT}`);
                metaSocketRef.current = metaSocket;

                metaSocket.onopen = () => {
                    console.log('Metadata socket connected.');
                    reconnectAttempts = 0;
                    metaSocket.send(JSON.stringify({ 
                        type: 'set-key', 
                        payload: uint8ArrayToString(key, 'base64') 
                    }));
                    // Documents are workspace-scoped - will be loaded when workspace is selected
                    // See currentWorkspaceId effect below for document loading
                };

                metaSocket.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        
                        if (data.type === 'status') {
                            setP2pStatus(data.status);
                            setTorEnabled(data.torEnabled || false);
                            // Store mesh network status
                            if (data.mesh) {
                                setMeshStatus(data.mesh);
                            }
                            if (data.multiaddr) {
                                const keyString = uint8ArrayToString(key, 'base64url');
                                setInviteLink(`${data.multiaddr}#${keyString}`);
                            } else {
                                setInviteLink('');
                            }
                        } else if (data.type === 'p2p-info') {
                            // Update public IP when received
                            if (data.publicIP) {
                                setPublicIP(data.publicIP);
                            }
                        } else if (data.type === 'mesh-status') {
                            // Detailed mesh status response
                            setMeshStatus(data);
                        } else if (data.type === 'tor-toggled') {
                            setTorEnabled(data.enabled);
                            setP2pStatus(data.status);
                        } else if (data.type === 'key-set') {
                            console.log('Session key confirmed by sidecar');
                            // Request P2P info after key is set to get public IP
                            metaSocket.send(JSON.stringify({ type: 'get-p2p-info' }));
                        } else if (data.type === 'document-list') {
                            // Documents are now synced via Yjs (syncedDocuments from WorkspaceSyncContext)
                            // This handler is kept for logging but no longer updates state
                            console.log(`[App] Received document-list from sidecar: ${(data.documents || []).length} documents (handled by Yjs sync)`);
                        } else if (data.type === 'document-created') {
                            // Documents are now created/synced via Yjs
                            console.log('[App] Document created via sidecar (handled by Yjs sync):', data.document?.id);
                        } else if (data.type === 'document-deleted') {
                            // Documents are now deleted/synced via Yjs
                            console.log('[App] Document deleted via sidecar (handled by Yjs sync):', data.docId);
                        } else if (data.type === 'document-moved') {
                            // Document moves are now synced via Yjs
                            const docId = data.documentId || data.docId;
                            console.log('[App] Document moved via sidecar (handled by Yjs sync):', docId);
                        } else if (data.type === 'index-results') {
                            // Search index results from sidecar
                            handleIndexResults(data);
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
                    } else if (!isCleanedUp) {
                        console.log('Max reconnect attempts reached. Will retry when tab becomes visible.');
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

        // Reset reconnection when tab becomes visible (recovers from max-attempts state)
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && !isCleanedUp) {
                if (reconnectAttempts >= maxReconnectAttempts) {
                    console.log('Tab visible — resetting reconnect attempts and retrying sidecar connection.');
                    reconnectAttempts = 0;
                    connect();
                }
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        // Start initial connection
        connect();

        return () => {
            isCleanedUp = true;
            clearTimeout(reconnectTimer);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (metaSocket) {
                if (metaSocket.readyState === WebSocket.OPEN || metaSocket.readyState === WebSocket.CLOSING) {
                    metaSocket.close();
                } else if (metaSocket.readyState === WebSocket.CONNECTING) {
                    // Capture reference to avoid stale closure if metaSocket is reassigned
                    const socketToClose = metaSocket;
                    socketToClose.onopen = () => socketToClose.close();
                    socketToClose.onerror = () => {}; // Suppress error if connection fails
                }
            }
        };
    }, []);

    // --- Share Link Handling ---
    // Handle workspace share links in URL by redirecting to join dialog with rich consent UI
    // Supports both:
    //   1. URL fragment: https://host/#p:pass&perm:e&...  (legacy web deploy)
    //   2. Join path:    https://host/join/w/payload#fragment  (clickable HTTPS share links)
    //   3. Electron IPC: protocol-link event from main process (nightjar:// deep links)
    //
    // On the web, if a /join/ URL is detected, we first show a DeepLinkGate overlay
    // that attempts to open the nightjar:// deep link (for desktop app users). If the
    // deep link fails, the user can "Continue in Browser" to proceed with the web join flow.
    // In Electron, the deep link gate is skipped (protocol handled natively).
    useEffect(() => {
        // --- Electron IPC: Listen for nightjar:// deep links from the main process ---
        // When the user clicks a nightjar:// link while the Electron app is running,
        // the main process sends the link via IPC. Store it and open the join dialog.
        let cleanupProtocolListener = null;
        if (isElectron() && window.electronAPI?.onProtocolLink) {
            cleanupProtocolListener = window.electronAPI.onProtocolLink((link) => {
                if (!link || typeof link !== 'string') return;
                console.log('[ShareLink] Received protocol link via IPC:', link.slice(0, 60) + '...');
                sessionStorage.setItem('pendingShareLink', link);
                const expMatch = link.match(/exp:(\d+)/);
                if (expMatch) {
                    sessionStorage.setItem('pendingShareLinkExpiry', expMatch[1]);
                }
                setCreateWorkspaceMode('join');
                setShowCreateWorkspaceDialog(true);
                showToast('Share link detected - please review the invitation details', 'info');
            });
        }

        // Check for clickable HTTPS join URL first (e.g., /join/w/abc123#fragment)
        const joinIdx = window.location.pathname.indexOf('/join/');
        if (joinIdx !== -1) {
            const joinPath = window.location.pathname.slice(joinIdx);
            const fragment = window.location.hash || '';
            // Reconstruct the full join URL to convert to nightjar:// format
            const fullJoinUrl = window.location.origin + joinPath + fragment;
            const nightjarLink = joinUrlToNightjarLink(fullJoinUrl);

            console.log('[ShareLink] Detected clickable join URL in path:', joinPath);

            // Store the converted nightjar:// link for the join dialog
            sessionStorage.setItem('pendingShareLink', nightjarLink);
            // Also store expiry from fragment for persistence through onboarding/lock
            const expMatch = fragment.match(/exp:(\d+)/);
            if (expMatch) {
                sessionStorage.setItem('pendingShareLinkExpiry', expMatch[1]);
            }

            // Clear the URL for security — replace with clean path
            try {
                const cleanPath = window.location.pathname.slice(0, joinIdx) || '/';
                window.history.replaceState(null, '', cleanPath);
            } catch (e) {
                clearUrlFragment(true);
            }

            // On web (non-Electron), show DeepLinkGate to attempt opening the desktop app
            if (!isElectron()) {
                setPendingDeepLink(nightjarLink);
                setShowDeepLinkGate(true);
            } else {
                // In Electron, skip deep link gate and open join dialog directly
                setCreateWorkspaceMode('join');
                setShowCreateWorkspaceDialog(true);
                showToast('Share link detected - please review the invitation details', 'info');
            }
            return;
        }

        // Clear any stale pending share link from previous session first
        // Only process if there's actually a fragment in the current URL.
        // IMPORTANT: Do NOT clear pendingShareLink if it was recently stored (within 60s)
        // by the /join/ path above or by an Electron protocol-link event. This prevents
        // a race condition where a React re-render clears a valid pending link before
        // the CreateWorkspace dialog can consume it.
        const fragment = window.location.hash.slice(1);
        if (!fragment) {
            const pendingExpiry = sessionStorage.getItem('pendingShareLinkExpiry');
            const pendingLink = sessionStorage.getItem('pendingShareLink');
            // Only clear if there IS a pending link and it's older than 60s (stale from previous session)
            // or if there's no expiry set (legacy/unknown origin)
            if (pendingLink && pendingExpiry) {
                const expiryTs = parseInt(pendingExpiry, 10);
                // If the expiry is far in the future, the link was stored recently (fresh) — don't clear
                // A stale link from a previous session will have an expired or nearly-expired timestamp
                const linkAge = expiryTs - Date.now();
                if (linkAge < 0) {
                    // Expired — safe to clear
                    sessionStorage.removeItem('pendingShareLink');
                    sessionStorage.removeItem('pendingShareLinkExpiry');
                }
                // Otherwise: link is fresh (not yet expired), leave it for CreateWorkspace to consume
            } else if (pendingLink && !pendingExpiry) {
                // No expiry means unknown origin — clear it to be safe
                sessionStorage.removeItem('pendingShareLink');
            }
            return;
        }
        
        // Check if this looks like a workspace identifier/share link
        if (isShareLinkFragment(fragment)) {
            console.log('[ShareLink] Detected share link in URL fragment');
            
            // Store the full share link to be picked up by the CreateWorkspaceDialog
            // The dialog will parse and display rich metadata for user consent
            const fullLink = window.location.origin + window.location.pathname + '#' + fragment;
            sessionStorage.setItem('pendingShareLink', fullLink);
            // Store expiry for persistence through onboarding/lock
            const expMatch = fragment.match(/exp:(\d+)/);
            if (expMatch) {
                sessionStorage.setItem('pendingShareLinkExpiry', expMatch[1]);
            }
            
            // Clear the URL fragment immediately for security
            clearUrlFragment(true);
            
            // Open the join workspace dialog
            setCreateWorkspaceMode('join');
            setShowCreateWorkspaceDialog(true);
            
            showToast('Share link detected - please review the invitation details', 'info');
        }

        // Cleanup: remove Electron IPC listener on unmount
        return () => {
            if (cleanupProtocolListener) {
                cleanupProtocolListener();
            }
        };
    }, [showToast]);

    // --- Document Management ---
    const createDocument = useCallback((name, folderId = null, docType = DOC_TYPES.TEXT, icon = null, color = null) => {
        // Require workspace to create documents
        if (!currentWorkspaceId) {
            showToast('Please create a workspace first', 'error');
            return null;
        }
        logBehavior('document', 'create_document', { docType, hasFolderId: !!folderId });
        
        // Enforce name length limit
        if (name && name.length > 200) {
            name = name.slice(0, 200);
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
        const docAuthToken = computeRoomAuthTokenSync(sessionKey, docId);
        const wsUrl = getWsUrl(workspaceServerUrl, docAuthToken);
        console.log(`[App] Creating document ${docId} with wsUrl: ${wsUrl}`);

        // In web mode, deliver encryption key for this document room to the server
        // before creating the WebSocket provider (so server can decrypt persisted state)
        if (!isElectronMode && sessionKey) {
            const keyBase64 = uint8ArrayToString(sessionKey, 'base64');
            deliverKeyToServer(docId, keyBase64, workspaceServerUrl).catch(e => {
                console.warn(`[App] Failed to deliver key for document ${docId}:`, e);
            });
        }

        const provider = new WebsocketProvider(wsUrl, docId, ydoc);
        
        // CRITICAL: Immediately set awareness with user identity to prevent P2P race condition
        // This ensures publicKey is included in awareness BEFORE any P2P sync happens
        if (provider.awareness && userProfile) {
            provider.awareness.setLocalStateField('user', {
                name: userProfile.name || 'Anonymous',
                color: userProfile.color || '#6366f1',
                icon: userProfile.icon || '👤',
                publicKey: userIdentity?.publicKeyBase62 || null,
                lastActive: Date.now(),
            });
        }
        
        // Debug: Log provider connection status
        provider.on('status', ({ status }) => {
            console.log(`[App] Document ${docId.slice(0, 8)}... provider status: ${status}`);
        });
        provider.on('synced', (isSynced) => {
            console.log(`[App] Document ${docId.slice(0, 8)}... synced: ${isSynced}`);
        });
        
        // Add local IndexedDB persistence in web mode (offline-first)
        // Use encrypted persistence when a session key is available
        let indexeddbProvider = null;
        if (!isElectronMode) {
            const dbName = `nahma-doc-${docId}`;
            indexeddbProvider = new EncryptedIndexeddbPersistence(dbName, ydoc, sessionKey);
            indexeddbProvider.on('synced', () => {
                console.log(`[App] Document ${docId.slice(0, 8)}... loaded from IndexedDB`);
            });
        }
        ydocsRef.current.set(docId, { ydoc, provider, indexeddbProvider, type: docType });

        // Add to shared document list (syncs to all connected clients)
        // ALWAYS use Yjs sync so documents are available for P2P sharing
        syncAddDocument(document);

        // Notify sidecar (for persistence) - Electron mode only
        if (isElectronMode && metaSocketRef.current?.readyState === WebSocket.OPEN) {
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
    }, [currentWorkspaceId, showToast, syncAddDocument, workspaceServerUrl, userProfile, userIdentity]);

    const openDocument = useCallback((docId, name, docType = DOC_TYPES.TEXT) => {
        logBehavior('document', 'open_document', { docType });
        // Use functional updater to avoid stale closure on openTabs
        let alreadyOpen = false;
        setOpenTabs(prev => {
            // Check if already open
            if (prev.find(t => t.id === docId)) {
                alreadyOpen = true;
                return prev;
            }
            return [...prev, { id: docId, name: name || 'Untitled', docType, hasUnsavedChanges: false }];
        });
        setActiveDocId(docId);
        if (alreadyOpen) return;

        // Inventory systems don't get their own Y.Doc — data lives in workspace-level doc
        if (docType === DOC_TYPES.INVENTORY) {
            return;
        }

        // File storage systems don't get their own Y.Doc — data lives in workspace-level doc
        if (docType === DOC_TYPES.FILE_STORAGE) {
            return;
        }

        // Create provider if not exists — guard against duplicate Y.Doc
        if (ydocsRef.current.has(docId)) {
            return;
        }
        {
            const ydoc = new Y.Doc();
            // Pass serverUrl for cross-platform sync (Electron joining remote workspace)
            const docAuthToken = computeRoomAuthTokenSync(sessionKey, docId);
            const wsUrl = getWsUrl(workspaceServerUrl, docAuthToken);
            console.log(`[App] Opening document ${docId} with wsUrl: ${wsUrl}`);

            // In web mode, deliver encryption key for this document room to the server
            // before creating the WebSocket provider
            if (!isElectronMode && sessionKey) {
                const keyBase64 = uint8ArrayToString(sessionKey, 'base64');
                deliverKeyToServer(docId, keyBase64, workspaceServerUrl).catch(e => {
                    console.warn(`[App] Failed to deliver key for document ${docId}:`, e);
                });
            }

            const provider = new WebsocketProvider(wsUrl, docId, ydoc);
            
            // CRITICAL: Immediately set awareness with user identity to prevent P2P race condition
            // This ensures publicKey is included in awareness BEFORE any P2P sync happens
            if (provider.awareness && userProfile) {
                provider.awareness.setLocalStateField('user', {
                    name: userProfile.name || 'Anonymous',
                    color: userProfile.color || '#6366f1',
                    icon: userProfile.icon || '👤',
                    publicKey: userIdentity?.publicKeyBase62 || null,
                    lastActive: Date.now(),
                });
            }
            
            // Debug: Log provider connection status
            provider.on('status', ({ status }) => {
                console.log(`[App] Document ${docId.slice(0, 8)}... provider status: ${status}`);
            });
            provider.on('synced', (isSynced) => {
                console.log(`[App] Document ${docId.slice(0, 8)}... synced: ${isSynced}`);
            });
            
            // Add local IndexedDB persistence in web mode (offline-first)
            // Use encrypted persistence when a session key is available
            let indexeddbProvider = null;
            if (!isElectronMode) {
                const dbName = `nahma-doc-${docId}`;
                indexeddbProvider = new EncryptedIndexeddbPersistence(dbName, ydoc, sessionKey);
                indexeddbProvider.on('synced', () => {
                    console.log(`[App] Document ${docId.slice(0, 8)}... loaded from IndexedDB`);
                });
            }
            ydocsRef.current.set(docId, { ydoc, provider, indexeddbProvider, type: docType });
        }

        // Tab was already added via functional updater above
    }, [workspaceServerUrl, userProfile, userIdentity, sessionKey]);

    // Create an Inventory System — does NOT create a separate Y.Doc
    // Inventory data lives in the workspace-level Y.Doc (see spec §11.2.5)
    // Only ONE inventory system per workspace is allowed.
    const createInventorySystem = useCallback((name, folderId = null, icon = null, color = null) => {
        if (!currentWorkspaceId) {
            showToast('Please create a workspace first', 'error');
            return null;
        }
        logBehavior('document', 'create_inventory_system');
        // One-per-workspace guard: if an inventory system already exists, open it instead
        const existingInventory = syncedDocuments.find(
            d => d.type === DOC_TYPES.INVENTORY && d.workspaceId === currentWorkspaceId && !d.deletedAt
        );
        if (existingInventory) {
            openDocument(existingInventory.id, existingInventory.name, DOC_TYPES.INVENTORY);
            showToast('Opened existing inventory system — only one per workspace is allowed', 'info');
            return existingInventory.id;
        }
        const invId = 'inv-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
        const resolvedIcon = icon || '📦';
        const inventorySystem = {
            id: invId,
            workspaceId: currentWorkspaceId,
            name: name || 'Inventory System',
            icon: resolvedIcon,
            createdAt: Date.now(),
            createdBy: publicIdentity?.publicKeyBase62,
            settings: {
                requireApproval: true,
                autoAssignEnabled: true,
                allowProducerClaims: true,
                defaultUrgency: false,
            },
        };
        // Add to workspace-level Yjs map (syncs to all peers)
        syncAddInventorySystem(inventorySystem);

        // Also add to shared document list so it appears in the sidebar
        const document = {
            id: invId,
            name: name || 'Inventory System',
            type: DOC_TYPES.INVENTORY,
            icon: resolvedIcon,
            color: color || null,
            workspaceId: currentWorkspaceId,
            folderId: folderId || null,
            createdAt: Date.now(),
            lastEdited: Date.now(),
            authorCount: 1,
        };
        syncAddDocument(document);

        // Open tab immediately
        setOpenTabs(prev => [...prev, {
            id: invId,
            name: name || 'Inventory System',
            docType: DOC_TYPES.INVENTORY,
            hasUnsavedChanges: false,
        }]);
        setActiveDocId(invId);
        showToast('Inventory System created', 'success');
        return invId;
    }, [currentWorkspaceId, showToast, publicIdentity, syncAddInventorySystem, syncAddDocument, syncedDocuments, openDocument]);

    // Create a File Storage system — does NOT create a separate Y.Doc
    // File storage data lives in the workspace-level Y.Doc (see FILE_STORAGE_SPEC.md §15.2)
    // Only ONE file storage system per workspace is allowed.
    const createFileStorage = useCallback((name, folderId = null, icon = null, color = null) => {
        if (!currentWorkspaceId) {
            showToast('Please create a workspace first', 'error');
            return null;
        }
        logBehavior('document', 'create_file_storage');
        // One-per-workspace guard: if a file storage system already exists, open it instead
        const existingFileStorage = syncedDocuments.find(
            d => d.type === DOC_TYPES.FILE_STORAGE && d.workspaceId === currentWorkspaceId && !d.deletedAt
        );
        if (existingFileStorage) {
            openDocument(existingFileStorage.id, existingFileStorage.name, DOC_TYPES.FILE_STORAGE);
            showToast('Opened existing file storage — only one per workspace is allowed', 'info');
            return existingFileStorage.id;
        }
        const fsId = 'fs-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
        const resolvedIcon = icon || '📁';
        const fileStorageSystem = {
            id: fsId,
            workspaceId: currentWorkspaceId,
            name: name || 'File Storage',
            icon: resolvedIcon,
            createdAt: Date.now(),
            createdBy: publicIdentity?.publicKeyBase62,
            settings: {
                maxFileSize: 100 * 1024 * 1024, // 100 MB in bytes (spec §3.2)
                autoDeleteDays: 30,              // days before trashed files are permanently deleted
                chunkRedundancyTarget: 3,        // min peers per chunk for seeding
                storageQuota: 0,                 // 0 = unlimited
            },
        };
        // Add to workspace-level Yjs map
        syncAddFileStorageSystem(fileStorageSystem);

        // Also add to shared document list so it appears in the sidebar
        const document = {
            id: fsId,
            name: name || 'File Storage',
            type: DOC_TYPES.FILE_STORAGE,
            icon: resolvedIcon || '📁',
            color: color || null,
            workspaceId: currentWorkspaceId,
            folderId: folderId || null,
            createdAt: Date.now(),
            lastEdited: Date.now(),
            authorCount: 1,
        };
        syncAddDocument(document);

        // Open tab immediately
        setOpenTabs(prev => [...prev, {
            id: fsId,
            name: name || 'File Storage',
            docType: DOC_TYPES.FILE_STORAGE,
            hasUnsavedChanges: false,
        }]);
        setActiveDocId(fsId);
        showToast('File Storage created', 'success');
        return fsId;
    }, [currentWorkspaceId, showToast, publicIdentity, syncAddFileStorageSystem, syncAddDocument, syncedDocuments, openDocument]);

    const closeDocument = useCallback((docId) => {
        logBehavior('document', 'close_document');
        setOpenTabs(prev => {
            const tabIndex = prev.findIndex(t => t.id === docId);
            if (tabIndex === -1) return prev;

            const newTabs = prev.filter(t => t.id !== docId);

            setActiveDocId(prevActive => {
                if (prevActive !== docId) return prevActive;
                if (newTabs.length > 0) {
                    const newIndex = Math.min(tabIndex, newTabs.length - 1);
                    return newTabs[newIndex].id;
                }
                return null;
            });

            return newTabs;
        });

        // Cleanup providers
        const docRef = ydocsRef.current.get(docId);
        if (docRef) {
            try { docRef.provider?.destroy(); } catch (err) {
                console.warn(`[App] Failed to destroy provider for doc ${docId}:`, err);
            }
            // Also cleanup IndexedDB provider if exists (web mode)
            try { docRef.indexeddbProvider?.destroy(); } catch (err) {
                console.warn(`[App] Failed to destroy indexeddbProvider for doc ${docId}:`, err);
            }
            try { docRef.ydoc?.destroy(); } catch (err) {
                console.warn(`[App] Failed to destroy ydoc for doc ${docId}:`, err);
            }
            ydocsRef.current.delete(docId);
        }
    }, []);

    const deleteDocument = useCallback((docId) => {
        logBehavior('document', 'delete_document');
        closeDocument(docId);

        // ALWAYS remove from shared document list so P2P peers see the deletion
        // (also cleans up document-folder mapping and trash entries in Yjs)
        syncRemoveDocument(docId);

        // Also remove from inventory Y.Map if this was an inventory system
        // (safe no-op if docId doesn't exist in the map)
        syncRemoveInventorySystem(docId);

        // Also remove from file storage Y.Map if this was a file storage system
        // (safe no-op if docId doesn't exist in the map)
        syncRemoveFileStorageSystem(docId);

        // Clean up IndexedDB storage for this document (web mode only)
        // IndexeddbPersistence.destroy() only disconnects — it does NOT delete the database
        if (!isElectronMode) {
            try {
                indexedDB.deleteDatabase(`nahma-doc-${docId}`);
            } catch (err) {
                console.warn(`[App] Failed to delete IndexedDB for doc ${docId}:`, err);
            }
        }

        // Clean up changelog entries for deleted document
        deleteChangelogForDocument(docId).catch(err => {
            console.warn(`[App] Failed to delete changelog for doc ${docId}:`, err);
        });

        // Notify sidecar - Electron mode only
        if (isElectronMode && metaSocketRef.current?.readyState === WebSocket.OPEN) {
            metaSocketRef.current.send(JSON.stringify({ 
                type: 'delete-document', 
                docId 
            }));
        }
        showToast('Document deleted', 'success');
    }, [closeDocument, isElectronMode, syncRemoveDocument, syncRemoveInventorySystem, syncRemoveFileStorageSystem, showToast]);

    // Move document to a folder (or to root if folderId is null)
    const handleMoveDocument = useCallback((documentId, folderId) => {
        logBehavior('document', 'move_document', { toFolder: !!folderId });
        // ALWAYS update via Yjs sync for P2P sharing
        syncUpdateDocument(documentId, { folderId: folderId || null });
        
        // In Electron mode, also call the FolderContext function to sync with sidecar
        if (isElectronMode) {
            moveDocumentToFolder(documentId, folderId);
        }
    }, [moveDocumentToFolder, isElectronMode, syncUpdateDocument]);

    // Rename document
    const renameDocument = useCallback((docId, newName) => {
        if (!newName?.trim()) return;
        logBehavior('document', 'rename_document');
        
        // ALWAYS update via Yjs sync for P2P sharing
        syncUpdateDocument(docId, { name: newName.trim() });
        
        // Also update inventory Y.Map if this was an inventory system
        // (safe no-op if docId doesn't exist in the map)
        syncUpdateInventorySystem(docId, { name: newName.trim() });
        
        // Also update file storage Y.Map if this was a file storage system
        // (safe no-op if docId doesn't exist in the map)
        syncUpdateFileStorageSystem(docId, { name: newName.trim() });
        
        // Also update local open tabs
        setOpenTabs(prev => prev.map(tab => 
            tab.id === docId 
                ? { ...tab, name: newName.trim() }
                : tab
        ));
        
        showToast('Document renamed', 'success');
    }, [syncUpdateDocument, syncUpdateInventorySystem, syncUpdateFileStorageSystem, showToast]);

    const copyInviteLink = useCallback(() => {
        if (inviteLink) {
            logBehavior('invite', 'copy_invite_link');
            navigator.clipboard.writeText(inviteLink);
            showToast('Invite link copied!', 'success');
        }
    }, [inviteLink, showToast]);

    const toggleTor = useCallback(async () => {
        const enabling = !torEnabled;
        logBehavior('app', enabling ? 'tor_enabled' : 'tor_disabled');
        
        // 1. Actually start/stop Tor via main process (spawns/kills daemon)
        if (window.electronAPI?.tor) {
            try {
                if (enabling) {
                    const savedMode = localStorage.getItem('Nightjar_tor_mode') || 'bundled';
                    showToast('Starting Tor...', 'info');
                    await window.electronAPI.tor.start(savedMode === 'disabled' ? 'bundled' : savedMode);
                    showToast('Tor connected', 'success');
                } else {
                    showToast('Stopping Tor...', 'info');
                    await window.electronAPI.tor.stop();
                    showToast('Tor disconnected', 'success');
                }
            } catch (err) {
                showToast(`Tor error: ${err.message || err}`, 'error');
                console.error('[App] Tor toggle failed:', err);
                return; // Don't flip sidecar state if main process failed
            }
        }
        
        // 2. Notify sidecar of the toggle + pass SOCKS proxy info
        if (metaSocketRef.current?.readyState === WebSocket.OPEN) {
            let socksProxy = null;
            if (enabling && window.electronAPI?.tor) {
                try { socksProxy = await window.electronAPI.tor.getSocksProxy(); } catch (_) {}
            }
            metaSocketRef.current.send(JSON.stringify({ 
                type: 'toggle-tor', 
                payload: { enable: enabling, socksProxy }
            }));
        }
    }, [torEnabled, showToast]);

    const toggleFullscreen = useCallback(() => {
        logBehavior('ui', 'toggle_fullscreen');
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
    
    // Global hotkeys for application-level actions
    useEffect(() => {
        const handleGlobalHotkeys = (e) => {
            const isCtrlOrCmd = e.ctrlKey || e.metaKey;
            
            // Don't handle hotkeys when typing in inputs/textareas (except specific ones)
            const activeElement = document.activeElement;
            const isInInput = activeElement && (
                activeElement.tagName === 'INPUT' || 
                activeElement.tagName === 'TEXTAREA' ||
                activeElement.isContentEditable
            );
            
            // Ctrl+N: New document
            if (isCtrlOrCmd && e.key === 'n' && !e.shiftKey && !isInInput) {
                e.preventDefault();
                if (currentWorkspaceId) {
                    setCreateDocumentType('text');
                    setShowCreateDocumentDialog(true);
                }
                return;
            }
            
            // Ctrl+Shift+N: New folder
            if (isCtrlOrCmd && e.key === 'N' && e.shiftKey && !isInInput) {
                e.preventDefault();
                // Trigger new folder creation via sidebar
                // The sidebar will need to expose a method for this
                return;
            }
            
            // Ctrl+W: Close current tab
            if (isCtrlOrCmd && e.key === 'w' && !e.shiftKey) {
                e.preventDefault();
                if (activeDocId) {
                    closeDocument(activeDocId);
                }
                return;
            }
            
            // Ctrl+Tab: Next tab
            if (e.ctrlKey && e.key === 'Tab' && !e.shiftKey) {
                e.preventDefault();
                if (openTabs.length > 1) {
                    const currentIndex = openTabs.findIndex(t => t.id === activeDocId);
                    if (currentIndex === -1) return;
                    const nextIndex = (currentIndex + 1) % openTabs.length;
                    setActiveDocId(openTabs[nextIndex].id);
                }
                return;
            }
            
            // Ctrl+Shift+Tab: Previous tab
            if (e.ctrlKey && e.key === 'Tab' && e.shiftKey) {
                e.preventDefault();
                if (openTabs.length > 1) {
                    const currentIndex = openTabs.findIndex(t => t.id === activeDocId);
                    if (currentIndex === -1) return;
                    const prevIndex = (currentIndex - 1 + openTabs.length) % openTabs.length;
                    setActiveDocId(openTabs[prevIndex].id);
                }
                return;
            }
            
            // Ctrl+,: Open settings (toggle changelog/settings panel)
            if (isCtrlOrCmd && e.key === ',' && !isInInput) {
                e.preventDefault();
                setShowChangelog(prev => !prev);
                return;
            }
            
            // Ctrl+\: Toggle sidebar
            if (isCtrlOrCmd && e.key === '\\' && !isInInput) {
                e.preventDefault();
                setSidebarCollapsed(prev => !prev);
                return;
            }
            
            // F1: Open help
            if (e.key === 'F1') {
                e.preventDefault();
                setHelpSection(null);
                setShowHelp(prev => !prev);
                return;
            }
            
            // Ctrl+K: Open search palette (works even in inputs)
            if (isCtrlOrCmd && e.key === 'k') {
                e.preventDefault();
                setShowSearchPalette(prev => !prev);
                return;
            }
        };
        
        window.addEventListener('keydown', handleGlobalHotkeys);
        return () => window.removeEventListener('keydown', handleGlobalHotkeys);
    }, [currentWorkspaceId, activeDocId, openTabs, closeDocument]);

    // --- Get active document ---
    const activeDoc = activeDocId ? ydocsRef.current.get(activeDocId) : null;
    const activeTabName = openTabs.find(t => t.id === activeDocId)?.name || 'Untitled';
    const activeDocType = openTabs.find(t => t.id === activeDocId)?.docType || DOC_TYPES.TEXT;

    // Observe changelog changes at the App level (runs even when panel is closed)
    const currentUser = { name: userHandle, color: userColor, icon: userIcon, publicKey: userIdentity?.publicKeyBase62 || '' };
    useChangelogObserver(
        activeDoc?.ydoc, 
        activeDocId, 
        currentUser,
        activeDocType // Pass document type for proper changelog handling
    );

    // Auto-close Comments/Changelog panels when switching to non-content views
    useEffect(() => {
        if (!CONTENT_DOC_TYPES.has(activeDocType)) {
            setShowComments(false);
            setShowChangelog(false);
        }
    }, [activeDocType]);

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
        
        // Update counts function — derive online count from awareness, not stale closure
        const updateCounts = () => {
            // Online count from awareness states (live query, avoids stale closure)
            const states = activeDoc.provider.awareness.getStates();
            const onlineCount = Math.max(0, states.size - 1); // exclude self
            // Total count from historical tracking
            const totalCount = tracker.getTotalCount();
            setCollaboratorCounts({ online: onlineCount, total: totalCount });
        };
        
        // Subscribe to changes in the collaborators Y.Array
        tracker.collaborators.observe(updateCounts);
        
        // Also listen to awareness changes for live online count
        activeDoc.provider.awareness.on('change', updateCounts);
        
        // Initial count
        updateCounts();
        
        return () => {
            tracker.collaborators.unobserve(updateCounts);
            activeDoc.provider.awareness.off('change', updateCounts);
            tracker.destroy();
        };
    }, [activeDoc?.ydoc, activeDoc?.provider]);

    // --- Render ---
    
    // Track if startup check has been performed to avoid duplicate runs
    const startupCheckDone = useRef(false);
    
    // Check for multiple identities on startup - runs once after identity loading completes
    useEffect(() => {
        // Don't run until IdentityContext has finished loading
        if (identityLoading) return;
        
        // Only run startup check once
        if (startupCheckDone.current) return;
        startupCheckDone.current = true;
        
        console.log('[App] Startup identity check');
        
        // Check for migration need first (legacy identity without PIN system)
        if (identityManager.needsMigration()) {
            console.log('[App] Migration needed for legacy identity');
            handleNeedsMigration();
            setStartupComplete(true);
            return;
        }
        
        // Check if we have identities in the new PIN-protected system
        const identities = identityManager.listIdentities();
        console.log('[App] Found', identities.length, 'identities in new system');
        
        if (identities.length > 0) {
            // Have identities in new system - check session
            if (!identityManager.isSessionValid()) {
                // No valid session - show identity selector for PIN entry
                console.log('[App] No valid session, showing identity selector');
                setShowIdentitySelector(true);
            } else {
                // Session is valid - try to get the unlocked identity
                const unlocked = identityManager.getUnlockedIdentity();
                if (unlocked) {
                    console.log('[App] Valid session with unlocked identity:', unlocked.metadata?.handle);
                    
                    // CRITICAL: Sync identity data (including privateKey) to IdentityContext
                    // This enables signed share links to work on app restart with existing session
                    if (unlocked.identityData) {
                        syncFromIdentityManager(unlocked.identityData);
                        
                        // Update user profile from unlocked identity
                        setUserProfile({
                            name: unlocked.identityData.handle || 'Anonymous',
                            icon: unlocked.identityData.icon || '😊',
                            color: unlocked.identityData.color || '#6366f1',
                        });
                    }
                } else {
                    // Session valid but failed to decrypt - session may be stale
                    console.warn('[App] Valid session but no unlocked identity, clearing session');
                    identityManager.clearSession();
                    setShowIdentitySelector(true);
                }
            }
        } else if (userIdentity && identityManager.needsMigration()) {
            // Have legacy identity loaded from disk AND old localStorage markers exist
            // This is a genuine pre-PIN identity that needs migration
            console.log('[App] Legacy identity exists with migration markers, triggering migration');
            const legacy = {
                ...userIdentity,
                handle: userIdentity.handle || userProfile.name || 'User',
                icon: userIdentity.icon || userProfile.icon || '😊',
                color: userIdentity.color || userProfile.color || '#6366f1'
            };
            setLegacyIdentity(legacy);
            setNeedsMigration(true);
        }
        // If no identities and no migration markers, IdentityContext will handle showing onboarding via needsOnboarding
        setStartupComplete(true);
    }, [identityLoading, handleNeedsMigration, userIdentity, userProfile, syncFromIdentityManager]);
    
    // Compute which singleton doc types already exist in this workspace
    // NOTE: This must be above all early returns to satisfy React's Rules of Hooks
    const disabledDocTypes = useMemo(() => {
        const types = [];
        if (documents.some(d => d.type === DOC_TYPES.INVENTORY && !d.deletedAt)) types.push(DOC_TYPES.INVENTORY);
        if (documents.some(d => d.type === DOC_TYPES.FILE_STORAGE && !d.deletedAt)) types.push(DOC_TYPES.FILE_STORAGE);
        return types;
    }, [documents]);
    
    // Show loading screen while checking identity status
    if (identityLoading || !startupComplete) {
        return (
            <div className="app-loading">
                <div className="app-loading__content">
                    <img 
                        src={getAssetUrl('/assets/nightjar-logo.png')}
                        alt="Nightjar" 
                        className="app-loading__logo"
                        style={{ width: '120px', height: '120px' }} 
                    />
                    <div className="app-loading__spinner" />
                </div>
            </div>
        );
    }
    
    // Show identity selector first (takes priority over lock screen to avoid double unlock)
    // This handles both: locked session + multiple identities
    if (showIdentitySelector) {
        return (
            <IdentitySelector
                onSelect={handleIdentitySelected}
                onCreateNew={() => {
                    setShowIdentitySelector(false);
                    setShowCreateNewIdentity(true);
                }}
                onNeedsMigration={handleNeedsMigration}
            />
        );
    }
    
    // Show lock screen if app is locked during use (NOT on startup - startup uses IdentitySelector)
    // Only show after startup check is complete to avoid flashing LockScreen before IdentitySelector
    if (isLocked && startupComplete) {
        return (
            <LockScreen
                onUnlock={handleLockScreenUnlock}
                onSwitchIdentity={handleSwitchIdentity}
            />
        );
    }
    
    // Show migration flow if needed
    if (needsMigration && legacyIdentity) {
        return (
            <OnboardingFlow 
                onComplete={handleOnboardingComplete}
                isMigration={true}
                legacyIdentity={legacyIdentity}
            />
        );
    }
    
    // Show onboarding for creating a new identity (from IdentitySelector)
    if (showCreateNewIdentity) {
        return (
            <OnboardingFlow 
                onComplete={(identity, hadLocalData) => {
                    setShowCreateNewIdentity(false);
                    handleOnboardingComplete(identity, hadLocalData);
                }} 
            />
        );
    }
    
    // Show onboarding if identity doesn't exist and not loading
    // Also check the new identity manager - if we have identities there, skip onboarding
    const hasNewSystemIdentities = identityManager.listIdentities().length > 0;
    if (needsOnboarding && !userIdentity && !identityLoading && !hasNewSystemIdentities) {
        return <OnboardingFlow onComplete={handleOnboardingComplete} />;
    }
    
    // Get workspace awareness for presence - will be null if no workspace provider
    const workspaceAwareness = workspaceProvider?.awareness || null;
    
    return (
        <PresenceProvider awareness={workspaceAwareness}>
        <FileTransferProvider
            workspaceId={currentWorkspaceId}
            userPublicKey={publicIdentity?.publicKeyBase62}
            yChunkAvailability={yChunkAvailability}
            yStorageFiles={yStorageFiles}
        >
        {/* Track which document user has open for presence */}
        <PresenceDocumentTracker activeDocId={activeDocId} />
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
                        // Detect inventory by type or id prefix
                        if (!docType && (doc?.type === DOC_TYPES.INVENTORY || docId.startsWith('inv-'))) {
                            docType = DOC_TYPES.INVENTORY;
                        }
                        // Detect file storage by type or id prefix
                        if (!docType && (doc?.type === DOC_TYPES.FILE_STORAGE || docId.startsWith('fs-'))) {
                            docType = DOC_TYPES.FILE_STORAGE;
                        }
                        // Always default to TEXT if docType is missing.
                        // Name-based guessing (e.g. "kanban" / "sheet" in name) was removed
                        // because it caused incorrect type detection for renamed documents.
                        openDocument(docId, doc?.name, docType || DOC_TYPES.TEXT);
                    }}
                    onCreateDocument={(name, folderId, icon, color) => createDocument(name, folderId, DOC_TYPES.TEXT, icon, color)}
                    onCreateSheet={(name, folderId, icon, color) => createDocument(name || 'Spreadsheet', folderId, DOC_TYPES.SHEET, icon, color)}
                    onCreateKanban={(name, folderId, icon, color) => createDocument(name || 'Kanban Board', folderId, DOC_TYPES.KANBAN, icon, color)}
                    onCreateInventory={(name, folderId, icon, color) => createInventorySystem(name || 'Inventory', folderId, icon, color)}
                    onCreateFileStorage={(name, folderId, icon, color) => createFileStorage(name || 'File Storage', folderId, icon, color)}
                    disabledTypes={disabledDocTypes}
                    onDeleteDocument={deleteDocument}
                    onMoveDocument={handleMoveDocument}
                    onRenameDocument={renameDocument}
                    onUpdateDocument={syncUpdateDocument}
                    documentCollaborators={collaboratorsByDocument}
                    
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
                    onUpdateMemberPermission={handleUpdateMemberPermission}
                    onRespondToPendingDemotion={handleRespondToPendingDemotion}
                    
                    // Folder props
                    folders={folders}
                    onCreateFolder={createFolder}
                    onDeleteFolder={deleteFolder}
                    onRenameFolder={renameFolder}
                    expandedFolders={expandedFolders}
                    onSetExpandedFolders={setExpandedFolders}
                    
                    // Search
                    onOpenSearch={() => setShowSearchPalette(true)}
                    
                    // Help
                    onShowHelp={() => { setHelpSection(null); setShowHelp(true); }}
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
                            activeDocType={activeDocType}
                            userProfile={userProfile}
                            onProfileChange={setUserProfile}
                            isFullscreen={isFullscreen}
                            onToggleFullscreen={toggleFullscreen}
                            onOpenSearch={() => setShowSearchPalette(true)}
                            onReportBug={() => setShowBugReport(true)}
                            documents={documents}
                            folders={folders}
                            collaboratorsByDocument={collaboratorsByDocument}
                        />
                    ) : (
                        <div className="header-bar-minimal">
                            <div className="header-spacer"></div>
                            <div className="header-actions">
                                <button
                                    className="tab-bar-btn"
                                    onClick={() => setShowSearchPalette(true)}
                                    title="Search everything (Ctrl+K)"
                                    aria-label="Open search palette"
                                    data-testid="search-btn-minimal"
                                >
                                    🔍
                                </button>
                                <button
                                    className="tab-bar-btn"
                                    onClick={() => setShowBugReport(true)}
                                    title="Report a bug"
                                    aria-label="Report a bug"
                                    data-testid="bug-report-btn-minimal"
                                >
                                    🐛
                                </button>
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
                                    onLock={lockApp}
                                />
                            </div>
                        </div>
                    )}
                </div>

                <div className="editor-with-comments">
                    {activeDocType === DOC_TYPES.FILE_STORAGE ? (
                        <FileStorageDashboard
                            key={activeDocId}
                            fileStorageId={activeDocId}
                            workspaceId={currentWorkspaceId}
                            yFileStorageSystems={yFileStorageSystems}
                            yStorageFiles={yStorageFiles}
                            yStorageFolders={yStorageFolders}
                            yChunkAvailability={yChunkAvailability}
                            yFileAuditLog={yFileAuditLog}
                            userIdentity={publicIdentity}
                            collaborators={workspaceCollaborators}
                            workspaceProvider={workspaceProvider}
                            onStartChatWith={(user) => setChatTargetUser(user)}
                        />
                    ) : activeDocType === DOC_TYPES.INVENTORY ? (
                        <InventoryDashboard
                            key={currentWorkspaceId}
                            inventorySystemId={activeDocId}
                            workspaceId={currentWorkspaceId}
                            currentWorkspace={currentWorkspace}
                            userIdentity={inventoryIdentity}
                            collaborators={workspaceCollaborators}
                            yInventorySystems={yInventorySystems}
                            yCatalogItems={yCatalogItems}
                            yInventoryRequests={yInventoryRequests}
                            yProducerCapacities={yProducerCapacities}
                            yAddressReveals={yAddressReveals}
                            yPendingAddresses={yPendingAddresses}
                            yInventoryAuditLog={yInventoryAuditLog}
                            yInventoryNotifications={yInventoryNotifications}
                            onStartChatWith={(user) => setChatTargetUser(user)}
                        />
                    ) : activeDoc ? (
                        activeDocType === DOC_TYPES.KANBAN ? (
                            <Kanban
                                key={activeDocId}
                                ydoc={activeDoc.ydoc}
                                provider={activeDoc.provider}
                                userColor={userColor}
                                userHandle={userHandle}
                                userPublicKey={userIdentity?.publicKeyBase62}
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
                                userPublicKey={userIdentity?.publicKeyBase62}
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
                                    userPublicKey={userIdentity?.publicKeyBase62}
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
                        <div className="welcome-icon">
                            <img 
                                src={getAssetUrl('/assets/nightjar-logo.png')}
                                alt="Nightjar" 
                            />
                        </div>
                        <h2>Welcome to Nightjar</h2>
                        <p>Secure P2P Collaboration. Create a workspace or join an existing one.</p>
                        <div className="create-buttons">
                            <button className="btn-create primary" data-testid="welcome-create-workspace-btn" onClick={() => {
                                setCreateWorkspaceMode('create');
                                setShowCreateWorkspaceDialog(true);
                            }}>
                                📁 Create Workspace
                            </button>
                            <button className="btn-create secondary" data-testid="welcome-join-workspace-btn" onClick={() => {
                                setCreateWorkspaceMode('join');
                                setShowCreateWorkspaceDialog(true);
                            }}>
                                🔗 Join with a Code
                            </button>
                        </div>
                    </div>
                    ) : (
                        <div className="empty-editor-state">
                            <NightjarMascot size="large" autoRotate={true} rotateInterval={5000} />
                            <h2>Ready to collaborate</h2>
                            <p>Create a document or select one from the sidebar to get started.</p>
                            <div className="create-buttons">
                                <button className="btn-create" onClick={() => {
                                    setCreateDocumentType('text');
                                    setShowCreateDocumentDialog(true);
                                }}>
                                    📝 New Document
                                </button>
                                <button className="btn-create sheet" onClick={() => {
                                    setCreateDocumentType('sheet');
                                    setShowCreateDocumentDialog(true);
                                }}>
                                    📊 New Spreadsheet
                                </button>
                                <button className="btn-create kanban" onClick={() => {
                                    setCreateDocumentType('kanban');
                                    setShowCreateDocumentDialog(true);
                                }}>
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
                            userPublicKey={userIdentity?.publicKeyBase62}
                            collaborators={workspaceCollaborators}
                            onStartChatWith={(user) => setChatTargetUser(user)}
                        />
                    )}
                </div>

                <StatusBar
                    p2pStatus={p2pStatus}
                    inviteLink={inviteLink}
                    torEnabled={torEnabled}
                    meshStatus={meshStatus}
                    publicIP={publicIP}
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
                    activePeers={activePeers}
                    totalSeenPeers={totalSeenPeers}
                    relayConnected={relayConnected}
                    onRequestSync={requestPeerSync}
                    isRetrying={isPeerSyncRetrying}
                    documentType={activeDocType}
                    onStartChatWith={(user) => setChatTargetUser(user)}
                    syncPhase={syncPhase}
                    workspaceSynced={workspaceSyncSynced}
                    workspaceConnected={workspaceSyncConnected}
                    syncStatus={syncStatus}
                    syncDetails={syncDetails}
                    onVerifySyncState={verifySyncState}
                    onForceFullSync={forceFullSync}
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

            {/* Toast notifications now rendered by ToastProvider in main.jsx */}

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
                    userPublicKey={userIdentity?.publicKeyBase62}
                    workspaceMembers={Object.values(workspaceMembers || {}).map(m => ({
                        publicKey: m.publicKey,
                        displayName: m.displayName || m.name || 'Unknown',
                        color: m.color || '#6366f1',
                        icon: m.icon
                    }))}
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
                    userPublicKey={userIdentity?.publicKeyBase62}
                    collaborators={workspaceCollaborators}
                    onStartChatWith={(user) => setChatTargetUser(user)}
                    onRollback={activeDocType === DOC_TYPES.TEXT ? (stateData) => {
                        // Rollback: apply the state snapshot (text documents only)
                        if (stateData instanceof Uint8Array) {
                            // New format: Yjs state snapshot
                            const newDoc = new Y.Doc();
                            try {
                                Y.applyUpdate(newDoc, stateData);
                                const fragment = activeDoc.ydoc.get('prosemirror', Y.XmlFragment);
                                const newFragment = newDoc.get('prosemirror', Y.XmlFragment);
                                // Snapshot the original content before deleting, so we can
                                // restore it if copying from the snapshot doc fails.
                                const originalItems = fragment.toArray().map(item => item.clone());
                                activeDoc.ydoc.transact(() => {
                                    fragment.delete(0, fragment.length);
                                    try {
                                        // Copy content from new doc
                                        newFragment.toArray().forEach(item => {
                                            fragment.push([item.clone()]);
                                        });
                                    } catch (restoreErr) {
                                        // Restoration failed — re-insert the original content
                                        // so the document is never left empty.
                                        console.error('[Rollback] Failed to restore snapshot, re-inserting original:', restoreErr);
                                        originalItems.forEach(item => {
                                            fragment.push([item]);
                                        });
                                        throw restoreErr; // re-throw so outer catch can report
                                    }
                                });
                            } catch (err) {
                                console.error('[Rollback] Rollback failed:', err);
                                newDoc.destroy();
                                showToast('Rollback failed — original content preserved', 'error');
                                return;
                            }
                            newDoc.destroy();
                        } else {
                            // Old format: plain text (fallback)
                            console.log('Rollback to text not supported for ProseMirror');
                        }
                        setShowChangelog(false);
                        showToast('Document rolled back successfully', 'success');
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
                        sessionStorage.removeItem('pendingShareLink'); // Clear any pending share link
                        sessionStorage.removeItem('pendingShareLinkExpiry');
                    }}
                    onSuccess={() => {
                        setShowCreateWorkspaceDialog(false);
                        setCreateWorkspaceMode('create'); // Reset to default
                        sessionStorage.removeItem('pendingShareLink'); // Clear pending share link
                        sessionStorage.removeItem('pendingShareLinkExpiry');
                    }}
                />
            )}

            {/* Deep Link Gate — attempts nightjar:// protocol, falls back to web join */}
            {showDeepLinkGate && pendingDeepLink && (
                <DeepLinkGate
                    nightjarLink={pendingDeepLink}
                    onContinueInBrowser={() => {
                        setShowDeepLinkGate(false);
                        setPendingDeepLink(null);
                        // Open the join workspace dialog with the pending share link
                        setCreateWorkspaceMode('join');
                        setShowCreateWorkspaceDialog(true);
                        showToast('Share link detected - please review the invitation details', 'info');
                    }}
                    onCancel={() => {
                        setShowDeepLinkGate(false);
                        setPendingDeepLink(null);
                        sessionStorage.removeItem('pendingShareLink');
                        sessionStorage.removeItem('pendingShareLinkExpiry');
                    }}
                />
            )}

            {/* Create Document Dialog (from center CTA buttons) */}
            {showCreateDocumentDialog && (
                <CreateDocumentDialog
                    isOpen={showCreateDocumentDialog}
                    onClose={() => setShowCreateDocumentDialog(false)}
                    defaultType={createDocumentType}
                    disabledTypes={disabledDocTypes}
                    onCreateDocument={(name, folderId, icon, color) => {
                        createDocument(name, folderId, DOC_TYPES.TEXT, icon, color);
                        setShowCreateDocumentDialog(false);
                    }}
                    onCreateSheet={(name, folderId, icon, color) => {
                        createDocument(name || 'Spreadsheet', folderId, DOC_TYPES.SHEET, icon, color);
                        setShowCreateDocumentDialog(false);
                    }}
                    onCreateKanban={(name, folderId, icon, color) => {
                        createDocument(name || 'Kanban Board', folderId, DOC_TYPES.KANBAN, icon, color);
                        setShowCreateDocumentDialog(false);
                    }}
                    onCreateInventory={(name, folderId, icon, color) => {
                        createInventorySystem(name || 'Inventory', folderId, icon, color);
                        setShowCreateDocumentDialog(false);
                    }}
                    onCreateFileStorage={(name, folderId, icon, color) => {
                        createFileStorage(name || 'File Storage', folderId, icon, color);
                        setShowCreateDocumentDialog(false);
                    }}
                    onSuccess={() => setShowCreateDocumentDialog(false)}
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

            {/* Sync Progress Modal - shown when joining a workspace */}
            {showSyncProgress && (
                <SyncProgressModal
                    phase={syncPhase}
                    progress={syncProgress}
                    workspaceName={syncedWorkspaceInfo?.name || currentWorkspace?.name || 'workspace'}
                    onClose={() => {
                        setShowSyncProgress(false);
                        setSyncProgressWorkspaceId(null);
                    }}
                    onCancel={() => {
                        // User cancelled - leave the workspace
                        setShowSyncProgress(false);
                        setSyncProgressWorkspaceId(null);
                        leaveWorkspace(currentWorkspaceId);
                        const otherWorkspace = workspaces.find(w => w.id !== currentWorkspaceId);
                        if (otherWorkspace) {
                            switchWorkspace(otherWorkspace.id);
                        } else {
                            switchWorkspace(null);
                        }
                    }}
                    onRetry={() => {
                        // Force reconnect by switching workspace back
                        const wsId = currentWorkspaceId;
                        switchWorkspace(null);
                        setTimeout(() => switchWorkspace(wsId), 100);
                    }}
                />
            )}

            {/* Help & Documentation Overlay */}
            <HelpPage
                isOpen={showHelp}
                onClose={() => setShowHelp(false)}
                initialSection={helpSection}
            />

            {/* Bug Report Modal */}
            <BugReportModal
                isOpen={showBugReport}
                onClose={() => setShowBugReport(false)}
                context={{
                    documentName: openTabs.find(t => t.id === activeDocId)?.name || null,
                    documentType: activeDocType,
                    workspaceName: currentWorkspace?.name || null,
                }}
            />

            {/* Cross-App Search Palette */}
            <SearchPalette
                show={showSearchPalette}
                onClose={() => setShowSearchPalette(false)}
                documents={documents}
                folders={folders}
                workspaceCollaborators={workspaceCollaborators}
                workspaceMembers={Object.values(workspaceMembers || {})}
                yCatalogItems={yCatalogItems}
                yStorageFiles={yStorageFiles}
                yStorageFolders={yStorageFolders}
                workspaceYdoc={workspaceYdoc}
                onOpenDocument={openDocument}
                onNavigateFolder={(folderId) => {
                    // Expand parent folders to reveal target, then switch sidebar to folder
                    if (folderId) {
                        setExpandedFolders(prev => {
                            const next = new Set(prev);
                            // Expand the target folder and all its ancestors
                            const parentChain = [];
                            let current = folderId;
                            while (current) {
                                parentChain.push(current);
                                const folder = folders.find(f => f.id === current);
                                current = folder?.parentId || null;
                            }
                            parentChain.forEach(id => next.add(id));
                            return next;
                        });
                    }
                }}
                onOpenChat={(user) => {
                    if (user) {
                        setChatTargetUser(user);
                    }
                }}
                onOpenInventory={(item) => {
                    // Open inventory dashboard if an inventory item is selected
                    // Look for inventory doc type in documents
                    const invDoc = documents.find(d => d.type === 'inventory');
                    if (invDoc) openDocument(invDoc.id, invDoc.name, 'inventory');
                }}
                onOpenFileStorage={(file) => {
                    // Open file storage dashboard if a file is selected
                    const fsDoc = documents.find(d => d.type === DOC_TYPES.FILE_STORAGE);
                    if (fsDoc) openDocument(fsDoc.id, fsDoc.name, DOC_TYPES.FILE_STORAGE);
                }}
                isElectronMode={isElectronMode}
                metaSocketRef={metaSocketRef}
                ydocsRef={ydocsRef}
                workspaceName={syncedWorkspaceInfo?.name || currentWorkspace?.name}
            />
        </div>
        </FileTransferProvider>
        </PresenceProvider>
    );
}

export default App;
