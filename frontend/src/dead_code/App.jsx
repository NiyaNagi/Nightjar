import { useState, useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import nacl from 'tweetnacl';
import { fromString as uint8ArrayFromString, toString as uint8ArrayToString } from 'uint8arrays';
import Editor from './Editor';
import { IdentityProvider, useIdentity } from './contexts/IdentityContext';
import { PresenceProvider } from './contexts/PresenceContext';
import { FolderProvider, useFolders } from './contexts/FolderContext';
import OnboardingFlow from './components/Onboarding/OnboardingFlow';
import IdentitySettings from './components/Settings/IdentitySettings';
import TorSettings from './components/Settings/TorSettings';
import PresenceIndicator from './components/Presence/PresenceIndicator';
import PeersList from './components/Presence/PeersList';
import ShareDialog from './components/Share/ShareDialog';
import DocumentPicker from './components/DocumentPicker';
import { generateTopicFromDocId } from './utils/sharing';
import './App.css';

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

// --- Yjs Setup ---
const ydoc = new Y.Doc();
// Connect to the Yjs WebSocket server
// In Electron mode: connect to sidecar on localhost:8080 for true P2P with local persistence
// In Web mode: connect to unified server using current host
const isElectronMode = typeof window !== 'undefined' && !!window.electronAPI;
const wsUrl = isElectronMode 
    ? 'ws://localhost:8080'  // Sidecar P2P backend with LevelDB persistence
    : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host || 'localhost:3000'}`;
console.log(`[App] Yjs connecting to: ${wsUrl} (Electron: ${isElectronMode})`);
const provider = new WebsocketProvider(wsUrl, 'p2p-editor-room', ydoc);

// Main App wrapper with identity provider
function App() {
    return (
        <IdentityProvider>
            <FolderProvider>
                <PresenceProvider awareness={provider.awareness}>
                    <AppContent />
                </PresenceProvider>
            </FolderProvider>
        </IdentityProvider>
    );
}

function AppContent() {
    // --- Identity ---
    const { 
        identity, 
        publicIdentity,
        loading: identityLoading, 
        needsOnboarding, 
        createIdentity 
    } = useIdentity();

    // --- Folders ---
    const { moveDocumentToFolder } = useFolders();
    
    // --- State ---
    const [yjsStatus, setYjsStatus] = useState('connecting');
    const [p2pStatus, setP2pStatus] = useState('connecting');
    const [inviteLink, setInviteLink] = useState('');
    const [showSettings, setShowSettings] = useState(false);
    const [showTorSettings, setShowTorSettings] = useState(false);
    const [showPeersList, setShowPeersList] = useState(false);
    const [showShareDialog, setShowShareDialog] = useState(false);
    const [currentDocumentId, setCurrentDocumentId] = useState(null);
    const [currentDocumentName, setCurrentDocumentName] = useState('Untitled');
    const [documents, setDocuments] = useState([]);
    const [showDocumentPicker, setShowDocumentPicker] = useState(true);
    const [shareDocumentId, setShareDocumentId] = useState(null);
    const [shareDocumentName, setShareDocumentName] = useState('');

    // Handle onboarding completion
    const handleOnboardingComplete = async (newIdentity) => {
        // Store identity with hex-encoded keys for transport
        const toStore = {
            privateKeyHex: Array.from(newIdentity.privateKey).map(b => b.toString(16).padStart(2, '0')).join(''),
            publicKeyHex: Array.from(newIdentity.publicKey).map(b => b.toString(16).padStart(2, '0')).join(''),
            publicKeyBase62: newIdentity.publicKeyBase62,
            mnemonic: newIdentity.mnemonic,
            handle: newIdentity.handle,
            color: newIdentity.color,
            icon: newIdentity.icon,
            createdAt: newIdentity.createdAt,
            devices: newIdentity.devices
        };
        await createIdentity(toStore);
    };

    // --- Document Management ---
    // Load documents from storage
    useEffect(() => {
        const loadDocuments = async () => {
            if (window.electronAPI?.documents) {
                try {
                    const docs = await window.electronAPI.documents.list();
                    setDocuments(docs || []);
                } catch (err) {
                    console.error('[App] Failed to load documents:', err);
                }
            }
        };
        loadDocuments();
    }, []);

    // Create a new document
    const handleCreateDocument = useCallback(async () => {
        const newDocId = crypto.randomUUID();
        const newDoc = {
            id: newDocId,
            name: 'Untitled Document',
            createdAt: Date.now(),
            lastEdited: Date.now(),
        };
        
        if (window.electronAPI?.documents) {
            try {
                await window.electronAPI.documents.create(newDoc);
                setDocuments(prev => [...prev, newDoc]);
                setCurrentDocumentId(newDocId);
                setCurrentDocumentName(newDoc.name);
            } catch (err) {
                console.error('[App] Failed to create document:', err);
            }
        } else {
            // Fallback for web-only mode
            setDocuments(prev => [...prev, newDoc]);
            setCurrentDocumentId(newDocId);
            setCurrentDocumentName(newDoc.name);
        }
    }, []);

    // Open a document
    const handleOpenDocument = useCallback((docId, docName) => {
        setCurrentDocumentId(docId);
        setCurrentDocumentName(docName || 'Untitled');
        
        // Update last edited
        if (window.electronAPI?.documents) {
            window.electronAPI.documents.update(docId, { lastEdited: Date.now() });
        }
        setDocuments(prev => prev.map(d => 
            d.id === docId ? { ...d, lastEdited: Date.now() } : d
        ));
    }, []);

    // Delete a document
    const handleDeleteDocument = useCallback(async (docId) => {
        if (window.electronAPI?.documents) {
            try {
                await window.electronAPI.documents.delete(docId);
            } catch (err) {
                console.error('[App] Failed to delete document:', err);
            }
        }
        setDocuments(prev => prev.filter(d => d.id !== docId));
        if (currentDocumentId === docId) {
            setCurrentDocumentId(null);
            setCurrentDocumentName('');
        }
    }, [currentDocumentId]);

    // Rename a document
    const handleRenameDocument = useCallback(async (docId, newName) => {
        if (window.electronAPI?.documents) {
            try {
                await window.electronAPI.documents.update(docId, { name: newName });
            } catch (err) {
                console.error('[App] Failed to rename document:', err);
            }
        }
        setDocuments(prev => prev.map(d => 
            d.id === docId ? { ...d, name: newName } : d
        ));
        if (currentDocumentId === docId) {
            setCurrentDocumentName(newName);
        }
    }, [currentDocumentId]);

    // Open share dialog for a specific document
    const handleShareDocument = useCallback((docId, docName) => {
        setShareDocumentId(docId);
        setShareDocumentName(docName);
        setShowShareDialog(true);
    }, []);
    
    // Show onboarding if needed
    if (identityLoading) {
        return (
            <div className="App loading-screen">
                <div className="loading-spinner">Loading...</div>
            </div>
        );
    }
    
    if (needsOnboarding) {
        return <OnboardingFlow onComplete={handleOnboardingComplete} />;
    }

    // --- Effects ---
    useEffect(() => {
        // Check if running in Electron
        const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
        
        // 1. Initialize or retrieve session key
        let key = getKeyFromUrl();
        if (!key || key.length !== nacl.secretbox.keyLength) {
            key = nacl.randomBytes(nacl.secretbox.keyLength);
            window.history.replaceState(null, '', '#' + uint8ArrayToString(key, 'base64url'));
        }

        // 2. Set up Yjs provider status listener
        const handleStatus = (event) => setYjsStatus(event.status);
        provider.on('status', handleStatus);

        // 3. Only connect to sidecar in Electron mode
        if (!isElectron) {
            console.log('[App] Web mode - skipping sidecar connection');
            return () => {
                provider.off('status', handleStatus);
                provider.disconnect();
            };
        }

        // Electron mode: Set up metadata WebSocket connection
        const metaSocket = new WebSocket('ws://localhost:8081');

        metaSocket.onopen = () => {
            console.log('Metadata socket connected.');
            // Send the key to the sidecar
            metaSocket.send(JSON.stringify({ type: 'set-key', payload: uint8ArrayToString(key, 'base64') }));
        };

        metaSocket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                if (data.type === 'status') {
                    // Handle new status message format
                    setP2pStatus(data.status);
                    
                    if (data.multiaddr) {
                        const keyString = uint8ArrayToString(key, 'base64url');
                        setInviteLink(`${data.multiaddr}#${keyString}`);
                    }
                } else if (data.type === 'connection-info') {
                    // Legacy format support
                    const keyString = uint8ArrayToString(key, 'base64url');
                    setInviteLink(`${data.onionAddress}#${keyString}`);
                    setP2pStatus('connected');
                } else if (data.type === 'key-set') {
                    console.log('Session key confirmed by sidecar');
                }
            } catch (e) {
                console.error('Failed to parse metadata message:', e);
            }
        };

        metaSocket.onclose = () => {
            console.log('Metadata socket disconnected.');
        };

        // 4. Cleanup
        return () => {
            provider.off('status', handleStatus);
            provider.disconnect();
            metaSocket.close();
        };
    }, []);
    
    const copyInviteLink = () => {
        navigator.clipboard.writeText(inviteLink);
    };

    // Handle joining a document from share link
    const handleJoinDocument = async (docInfo) => {
        console.log('[App] Joining document:', docInfo);
        setCurrentDocumentId(docInfo.documentId);
        
        // Initialize Hyperswarm if identity is available
        if (identity && window.electronAPI?.hyperswarm) {
            try {
                await window.electronAPI.hyperswarm.initialize({
                    publicKeyHex: identity.publicKeyHex,
                    privateKeyHex: identity.privateKeyHex,
                    handle: identity.handle,
                    color: identity.color
                });
                
                // Generate topic and join
                const topic = docInfo.topic || generateTopicFromDocId(docInfo.documentId, docInfo.password);
                await window.electronAPI.hyperswarm.joinTopic(topic);
                
                console.log('[App] Joined document topic:', topic.slice(0, 16) + '...');
            } catch (err) {
                console.error('[App] Failed to join document:', err);
            }
        }
    };

    // --- Render ---
    const getStatusLabel = () => {
        if (yjsStatus === 'connected' && p2pStatus === 'connected') {
            return { text: 'Online (P2P)', className: 'connected' };
        } else if (yjsStatus === 'connected' && p2pStatus === 'offline') {
            return { text: 'Offline (Local only)', className: 'offline' };
        } else if (yjsStatus === 'connected' && p2pStatus === 'connecting') {
            return { text: 'Connecting to P2P...', className: 'connecting' };
        } else {
            return { text: 'Connecting...', className: 'connecting' };
        }
    };
    
    const statusInfo = getStatusLabel();

    return (
        <div className="App">
            <header className="App-header">
                <div className="header-left">
                    <button 
                        className="sidebar-toggle"
                        onClick={() => setShowDocumentPicker(!showDocumentPicker)}
                        title={showDocumentPicker ? 'Hide sidebar' : 'Show sidebar'}
                    >
                        ☰
                    </button>
                    <h1>Nightjar</h1>
                    {currentDocumentName && (
                        <span className="current-doc-name">{currentDocumentName}</span>
                    )}
                </div>
                <div className="status-bar">
                    <div className="user-identity" onClick={() => setShowSettings(true)} style={{ cursor: 'pointer' }}>
                        <span className="user-avatar" style={{ backgroundColor: publicIdentity?.color }}>
                            {publicIdentity?.icon}
                        </span>
                        <span className="user-name">{publicIdentity?.handle || 'Anonymous'}</span>
                        <span className="settings-icon">⚙️</span>
                    </div>
                    
                    <div onClick={() => setShowPeersList(true)} style={{ cursor: 'pointer' }}>
                        <PresenceIndicator />
                    </div>
                    
                    <button 
                        className="share-button" 
                        onClick={() => handleShareDocument(currentDocumentId, currentDocumentName)}
                        disabled={!currentDocumentId}
                    >
                        📤 Share
                    </button>
                    
                    <button className="tor-settings-button" onClick={() => setShowTorSettings(true)}>
                        🧅 Tor
                    </button>
                    
                    <p>Status: <span className={statusInfo.className}>{statusInfo.text}</span></p>
                </div>
            </header>
            
            <div className="main-container">
                {showDocumentPicker && (
                    <DocumentPicker
                        documents={documents}
                        activeDocId={currentDocumentId}
                        onOpenDocument={handleOpenDocument}
                        onCreateDocument={handleCreateDocument}
                        onDeleteDocument={handleDeleteDocument}
                        onShareDocument={handleShareDocument}
                        onRenameDocument={handleRenameDocument}
                    />
                )}
                
                <main className={showDocumentPicker ? 'with-sidebar' : ''}>
                    {currentDocumentId ? (
                        <Editor 
                            ydoc={ydoc} 
                            provider={provider} 
                            userHandle={publicIdentity?.handle || 'Anonymous'} 
                            userColor={publicIdentity?.color}
                            documentId={currentDocumentId}
                        />
                    ) : (
                        <div className="no-document-selected">
                            <div className="welcome-message">
                                <h2>Welcome to Nightjar</h2>
                                <p>Select a document from the sidebar or create a new one to get started.</p>
                                <button onClick={handleCreateDocument} className="create-doc-btn">
                                    + Create New Document
                                </button>
                            </div>
                        </div>
                    )}
                </main>
            </div>
            
            {showSettings && (
                <IdentitySettings onClose={() => setShowSettings(false)} />
            )}
            
            <TorSettings 
                isOpen={showTorSettings} 
                onClose={() => setShowTorSettings(false)} 
            />
            
            <ShareDialog 
                isOpen={showShareDialog} 
                onClose={() => setShowShareDialog(false)}
                documentId={shareDocumentId}
                documentName={shareDocumentName}
                userName={publicIdentity?.handle || 'Someone'}
                onJoinDocument={handleJoinDocument}
            />
            
            <PeersList isOpen={showPeersList} onClose={() => setShowPeersList(false)} />
        </div>
    );
}

export default App;
