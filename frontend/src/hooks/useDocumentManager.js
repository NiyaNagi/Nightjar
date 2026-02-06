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
                    if (activeDocId === data.docId) {
                        setActiveDocId(openTabs.length > 1 ? openTabs[0].id : null);
                    }
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
    }, [metaSocket, activeDocId, openTabs]);

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
    }, [metaSocket, setCurrentSessionKey]);

    // Open a document (create provider if needed)
    const openDocument = useCallback((docId, name, encryptionKey = null) => {
        // Check if already open in tabs
        if (openTabs.find(t => t.id === docId)) {
            setActiveDocId(docId);
            // Still need to set the key for this document
            const key = encryptionKey || documentKeysRef.current.get(docId);
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
            return;
        }
        
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
        
        // Send the key to the sidecar before creating the provider
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
        setOpenTabs(prev => [...prev, newTab]);
        setActiveDocId(docId);
    }, [openTabs, documents, metaSocket, setCurrentSessionKey]);

    // Close a document tab
    const closeDocument = useCallback((docId) => {
        const tabIndex = openTabs.findIndex(t => t.id === docId);
        if (tabIndex === -1) return;

        // Remove from tabs
        const newTabs = openTabs.filter(t => t.id !== docId);
        setOpenTabs(newTabs);

        // Update active tab
        if (activeDocId === docId) {
            if (newTabs.length > 0) {
                // Switch to adjacent tab
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
