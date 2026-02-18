import { useState, useCallback, useRef, useEffect } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import nacl from 'tweetnacl';
import { toString as uint8ArrayToString, fromString as uint8ArrayFromString } from 'uint8arrays';
import { isElectron } from '../hooks/useEnvironment';
import { getYjsWebSocketUrl } from '../utils/websocket';

// Alias for backwards compatibility
const getWsUrl = getYjsWebSocketUrl;

// Generate a unique document ID
const generateDocId = () => {
    return 'doc-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
};

// Generate a new encryption key for a document
const generateEncryptionKey = () => {
    const key = nacl.randomBytes(nacl.secretbox.keyLength);
    return uint8ArrayToString(key, 'base64');
};

// Hook for managing multiple documents with Yjs
export function useDocumentManager(metaSocket, sessionKey, setCurrentSessionKey) {
    const [documents, setDocuments] = useState([]);
    const [openTabs, setOpenTabs] = useState([]);
    const [activeDocId, setActiveDocId] = useState(null);
    const ydocsRef = useRef(new Map()); // Map of docId -> { ydoc, provider }
    const metadataRef = useRef(new Map()); // Map of docId -> metadata
    const documentKeysRef = useRef(new Map()); // Map of docId -> encryptionKey (base64)

    // Load document list from sidecar on mount
    useEffect(() => {
        if (metaSocket && metaSocket.readyState === WebSocket.OPEN) {
            metaSocket.send(JSON.stringify({ type: 'list-documents' }));
        }
    }, [metaSocket]);

    // Cleanup all Yjs providers on unmount
    useEffect(() => {
        return () => {
            ydocsRef.current.forEach((docRef, docId) => {
                try {
                    docRef.provider.disconnect();
                    docRef.ydoc.destroy();
                } catch (e) {
                    console.error(`[useDocumentManager] Error cleaning up doc ${docId}:`, e);
                }
            });
            ydocsRef.current.clear();
        };
    }, []);

    // Handle messages from sidecar
    useEffect(() => {
        if (!metaSocket) return;

        const handleMessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'document-list') {
                    setDocuments(data.documents || []);
                } else if (data.type === 'document-created') {
                    // Only add if not already present (avoid duplicates from optimistic update)
                    setDocuments(prev => {
                        if (prev.some(d => d.id === data.document.id)) return prev;
                        return [...prev, data.document];
                    });
                } else if (data.type === 'document-deleted') {
                    setDocuments(prev => prev.filter(d => d.id !== data.docId));
                    // Close tab if open
                    setOpenTabs(prev => prev.filter(t => t.id !== data.docId));
                    setActiveDocId(prevActiveDocId => {
                        if (prevActiveDocId === data.docId) {
                            // Read current tabs via a synchronous ref-free approach:
                            // We already filtered the deleted tab above, so pick the first remaining tab
                            let nextId = null;
                            setOpenTabs(currentTabs => {
                                nextId = currentTabs.length > 0 ? currentTabs[0].id : null;
                                return currentTabs; // no mutation, just reading
                            });
                            return nextId;
                        }
                        return prevActiveDocId;
                    });
                } else if (data.type === 'document-metadata-updated') {
                    setDocuments(prev => prev.map(d => 
                        d.id === data.docId ? { ...d, ...data.metadata } : d
                    ));
                }
            } catch (e) {
                console.error('Failed to parse document manager message:', e);
            }
        };

        metaSocket.addEventListener('message', handleMessage);
        return () => metaSocket.removeEventListener('message', handleMessage);
    }, [metaSocket]);

    // Create a new document
    const createDocument = useCallback((name) => {
        const docId = generateDocId();
        const encryptionKey = generateEncryptionKey();
        
        // Store the key locally
        documentKeysRef.current.set(docId, encryptionKey);
        
        const document = {
            id: docId,
            name: name,
            encryptionKey: encryptionKey, // Store key in metadata
            createdAt: Date.now(),
            lastEdited: Date.now(),
            authorCount: 1,
            authors: []
        };

        // Create Yjs doc and provider
        const ydoc = new Y.Doc();
        const provider = new WebsocketProvider(getWsUrl(), docId, ydoc);
        ydocsRef.current.set(docId, { ydoc, provider });

        // Notify sidecar with encryption key
        if (metaSocket && metaSocket.readyState === WebSocket.OPEN) {
            // First set the key for this document
            metaSocket.send(JSON.stringify({ 
                type: 'set-key', 
                payload: encryptionKey,
                docName: docId
            }));
            
            // Then create the document
            metaSocket.send(JSON.stringify({ 
                type: 'create-document', 
                document 
            }));
        }
        
        // Update the current session key
        if (setCurrentSessionKey) {
            setCurrentSessionKey(encryptionKey);
        }

        // Add to local state
        setDocuments(prev => [...prev, document]);
        
        // Open in new tab
        openDocument(docId, name, encryptionKey);

        return docId;
    }, [metaSocket, setCurrentSessionKey, openDocument]);

    // Open a document (create provider if needed)
    const openDocument = useCallback((docId, name, encryptionKey = null) => {
        // Helper to set encryption key on sidecar
        const sendKey = (key) => {
            if (key && metaSocket && metaSocket.readyState === WebSocket.OPEN) {
                metaSocket.send(JSON.stringify({ 
                    type: 'set-key', 
                    payload: key,
                    docName: docId
                }));
                if (setCurrentSessionKey) {
                    setCurrentSessionKey(key);
                }
            }
        };

        // Find the encryption key for this document
        let key = encryptionKey || documentKeysRef.current.get(docId);
        
        // If we don't have the key locally, find it from the documents list
        if (!key) {
            const doc = documents.find(d => d.id === docId);
            if (doc && doc.encryptionKey) {
                key = doc.encryptionKey;
                documentKeysRef.current.set(docId, key);
            }
        }

        // Use functional updater to check current tabs (avoids stale closure)
        setOpenTabs(prev => {
            if (prev.find(t => t.id === docId)) {
                // Already open — just activate and set key
                setActiveDocId(docId);
                sendKey(key);
                return prev; // no change
            }

            // Send the key to the sidecar before creating the provider
            sendKey(key);

            // Create provider if not exists
            if (!ydocsRef.current.has(docId)) {
                const ydoc = new Y.Doc();
                const provider = new WebsocketProvider(getWsUrl(), docId, ydoc);
                ydocsRef.current.set(docId, { ydoc, provider });
            }

            // Add to tabs
            const newTab = {
                id: docId,
                name: name || 'Untitled',
                hasUnsavedChanges: false
            };
            return [...prev, newTab];
        });
        setActiveDocId(docId);
    }, [documents, metaSocket, setCurrentSessionKey]);

    // Close a document tab
    const closeDocument = useCallback((docId) => {
        // Use functional updater to avoid stale closure issues with rapid close operations
        setOpenTabs(prev => {
            const tabIndex = prev.findIndex(t => t.id === docId);
            if (tabIndex === -1) return prev;
            
            const newTabs = prev.filter(t => t.id !== docId);
            
            // Update active tab if needed
            setActiveDocId(currentActive => {
                if (currentActive === docId) {
                    if (newTabs.length > 0) {
                        const newIndex = Math.min(tabIndex, newTabs.length - 1);
                        return newTabs[newIndex].id;
                    }
                    return null;
                }
                return currentActive;
            });
            
            return newTabs;
        });

        // Cleanup provider
        const docRef = ydocsRef.current.get(docId);
        if (docRef) {
            docRef.provider.disconnect();
            docRef.ydoc.destroy();
            ydocsRef.current.delete(docId);
        }
    }, []);

    // Delete a document permanently
    const deleteDocument = useCallback((docId) => {
        // Close if open
        closeDocument(docId);

        // Notify sidecar
        if (metaSocket && metaSocket.readyState === WebSocket.OPEN) {
            metaSocket.send(JSON.stringify({ 
                type: 'delete-document', 
                docId 
            }));
        }

        // Remove from local state
        setDocuments(prev => prev.filter(d => d.id !== docId));
    }, [metaSocket, closeDocument]);

    // Mark document as having unsaved changes
    const markUnsaved = useCallback((docId, hasChanges = true) => {
        setOpenTabs(prev => prev.map(t => 
            t.id === docId ? { ...t, hasUnsavedChanges: hasChanges } : t
        ));
    }, []);

    // Update document metadata
    const updateMetadata = useCallback((docId, metadata) => {
        if (metaSocket && metaSocket.readyState === WebSocket.OPEN) {
            metaSocket.send(JSON.stringify({ 
                type: 'update-document-metadata', 
                docId,
                metadata
            }));
        }
        setDocuments(prev => prev.map(d => 
            d.id === docId ? { ...d, ...metadata } : d
        ));
    }, [metaSocket]);

    // Get the active document's Yjs doc and provider
    const getActiveDoc = useCallback(() => {
        if (!activeDocId) return null;
        return ydocsRef.current.get(activeDocId) || null;
    }, [activeDocId]);

    return {
        documents,
        openTabs,
        activeDocId,
        createDocument,
        openDocument,
        closeDocument,
        deleteDocument,
        setActiveDocId,
        markUnsaved,
        updateMetadata,
        getActiveDoc
    };
}
