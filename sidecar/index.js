const WebSocket = require('ws');
const crypto = require('crypto');
const { createLibp2pNode } = require('../backend/p2p');
const Y = require('yjs');
const { setupWSConnection, docs } = require('y-websocket/bin/utils');
const { encryptUpdate, decryptUpdate, isValidKey } = require('../backend/crypto');
const { Level } = require('level');
const TorControl = require('tor-control');
const EventEmitter = require('events');
const { P2PBridge } = require('./p2p-bridge');
const { loadIdentity, hasIdentity } = require('./identity');

// Initialize P2P Bridge for unified P2P layer
const p2pBridge = new P2PBridge();

// Track if P2P is initialized with identity
let p2pInitialized = false;

// Dynamically import uint8arrays to handle ES module
let uint8ArrayFromString = null;
const uint8arraysReady = (async () => {
    const uint8arrays = await import('uint8arrays');
    uint8ArrayFromString = uint8arrays.fromString;
    return true;
})();

const path = require('path');

const YJS_WEBSOCKET_PORT = 8080;
const METADATA_WEBSOCKET_PORT = 8081;
const TOR_CONTROL_PORT = 9051;
const P2P_PORT = 4001;
const PUBSUB_TOPIC = '/nightjarx/1.0.0';

// Storage path - use userData path from command line if provided (Electron packaged app),
// otherwise fall back to relative path (development mode)
const USER_DATA_PATH = process.argv[2] || '.';
const DB_PATH = path.join(USER_DATA_PATH, 'storage');

// --- Security Constants ---
const MAX_MESSAGE_SIZE = 10 * 1024 * 1024; // 10MB max message size
const MAX_ID_LENGTH = 256;
const MAX_NAME_LENGTH = 1024;
const MAX_CONTENT_SIZE = 50 * 1024 * 1024; // 50MB max content

// --- Input Validation Utilities ---

/**
 * Validate and sanitize an ID (document, workspace, folder, etc.)
 * @param {string} id - ID to validate
 * @returns {string|null} Sanitized ID or null if invalid
 */
function sanitizeId(id) {
    if (typeof id !== 'string') return null;
    id = id.trim();
    if (id.length === 0 || id.length > MAX_ID_LENGTH) return null;
    
    // Only allow safe characters
    const safePattern = /^[a-zA-Z0-9_\-\.]+$/;
    if (!safePattern.test(id)) return null;
    
    // Reject path traversal
    if (id.includes('..') || id.includes('./') || id.includes('/.')) return null;
    
    return id;
}

/**
 * Validate and sanitize a name (document name, workspace name, etc.)
 * @param {string} name - Name to validate
 * @returns {string|null} Sanitized name or null if invalid
 */
function sanitizeName(name) {
    if (typeof name !== 'string') return null;
    name = name.trim();
    if (name.length === 0 || name.length > MAX_NAME_LENGTH) return null;
    
    // Remove potentially dangerous characters but allow more flexibility for names
    // Strip control characters
    name = name.replace(/[\x00-\x1F\x7F]/g, '');
    
    return name || null;
}

/**
 * Sanitize object to prevent prototype pollution
 * @param {Object} obj - Object to sanitize
 * @param {Set} seen - Set for cycle detection
 * @returns {Object} Sanitized object
 */
function sanitizeObject(obj, seen = new Set()) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (seen.has(obj)) return obj;
    seen.add(obj);
    
    if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
            obj[i] = sanitizeObject(obj[i], seen);
        }
        return obj;
    }
    
    // Remove dangerous prototype pollution vectors
    const dangerous = ['__proto__', 'constructor', 'prototype'];
    for (const prop of dangerous) {
        if (Object.prototype.hasOwnProperty.call(obj, prop)) {
            delete obj[prop];
        }
    }
    
    for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'object' && obj[key] !== null) {
            obj[key] = sanitizeObject(obj[key], seen);
        }
    }
    
    return obj;
}

/**
 * Safe JSON parse with prototype pollution protection
 * @param {string} json - JSON string to parse
 * @returns {Object|null} Parsed object or null
 */
function safeJsonParse(json) {
    if (typeof json !== 'string') return null;
    if (json.length > MAX_MESSAGE_SIZE) {
        console.warn('[Sidecar] Message too large, rejecting');
        return null;
    }
    
    try {
        const parsed = JSON.parse(json);
        return sanitizeObject(parsed);
    } catch {
        return null;
    }
}

// --- Rate Limiting Configuration ---
const RATE_LIMIT_WINDOW_MS = 1000; // 1 second window
const RATE_LIMIT_MAX_REQUESTS = 100; // Max requests per window
const RATE_LIMIT_BURST = 150; // Allow burst up to this limit

/**
 * Simple rate limiter using sliding window
 */
class RateLimiter {
    constructor(windowMs = RATE_LIMIT_WINDOW_MS, maxRequests = RATE_LIMIT_MAX_REQUESTS, burstLimit = RATE_LIMIT_BURST) {
        this.windowMs = windowMs;
        this.maxRequests = maxRequests;
        this.burstLimit = burstLimit;
        this.clients = new Map(); // clientId -> { requests: [], blocked: boolean, blockedUntil: number }
    }

    /**
     * Check if a client should be rate limited
     * @param {string} clientId - Unique client identifier
     * @returns {Object} { allowed: boolean, remaining: number, retryAfter?: number }
     */
    check(clientId) {
        const now = Date.now();
        let client = this.clients.get(clientId);

        if (!client) {
            client = { requests: [], blocked: false, blockedUntil: 0 };
            this.clients.set(clientId, client);
        }

        // Check if client is temporarily blocked
        if (client.blocked && now < client.blockedUntil) {
            return { 
                allowed: false, 
                remaining: 0, 
                retryAfter: Math.ceil((client.blockedUntil - now) / 1000) 
            };
        }

        // Unblock if block period has passed
        if (client.blocked && now >= client.blockedUntil) {
            client.blocked = false;
            client.requests = [];
        }

        // Remove old requests outside the window
        const windowStart = now - this.windowMs;
        client.requests = client.requests.filter(timestamp => timestamp > windowStart);

        // Check if over burst limit (trigger temporary block)
        if (client.requests.length >= this.burstLimit) {
            client.blocked = true;
            client.blockedUntil = now + this.windowMs * 5; // Block for 5 seconds
            console.warn(`[RateLimiter] Client ${clientId.slice(0, 8)} blocked for excessive requests`);
            return { allowed: false, remaining: 0, retryAfter: 5 };
        }

        // Check if over normal limit
        if (client.requests.length >= this.maxRequests) {
            return { 
                allowed: false, 
                remaining: 0, 
                retryAfter: Math.ceil((client.requests[0] + this.windowMs - now) / 1000) 
            };
        }

        // Allow request
        client.requests.push(now);
        return { 
            allowed: true, 
            remaining: this.maxRequests - client.requests.length 
        };
    }

    /**
     * Clean up stale client entries (call periodically)
     */
    cleanup() {
        const now = Date.now();
        const staleThreshold = now - this.windowMs * 10;
        
        for (const [clientId, client] of this.clients) {
            if (client.requests.length === 0 || 
                (client.requests[client.requests.length - 1] < staleThreshold && !client.blocked)) {
                this.clients.delete(clientId);
            }
        }
    }
}

// Global rate limiter instance
const rateLimiter = new RateLimiter();

// Clean up rate limiter every minute
setInterval(() => rateLimiter.cleanup(), 60000);

// --- Application State ---
let onionAddress = null;
let p2pNode = null;
let fullMultiaddr = null;
let sessionKey = null;
const documentKeys = new Map(); // Map of docName -> encryption key
let isOnline = false; // Track if P2P/Tor is available
let connectionStatus = 'offline'; // 'offline', 'connecting', 'connected'
let torEnabled = false; // Whether Tor should be enabled (default OFF)

// --- 1. Persistence Layer ---
const db = new Level(DB_PATH, { valueEncoding: 'binary' });
console.log(`[Sidecar] Initialized LevelDB at ${DB_PATH}`);

// --- P2P Message Protocol ---
// P2P messages include document ID for proper routing
// Format: [1 byte version][32 bytes docId length-prefixed][encrypted data]
const P2P_PROTOCOL_VERSION = 1;

/**
 * Create a P2P message with document ID header
 * @param {string} docId - Document identifier
 * @param {Buffer|Uint8Array} encryptedData - Encrypted Yjs update
 * @returns {Buffer} Framed P2P message
 */
function createP2PMessage(docId, encryptedData) {
    const docIdBytes = Buffer.from(docId, 'utf8');
    const docIdLength = docIdBytes.length;
    
    // Version (1) + docId length (1) + docId + encrypted data
    const message = Buffer.alloc(2 + docIdLength + encryptedData.length);
    message[0] = P2P_PROTOCOL_VERSION;
    message[1] = docIdLength;
    docIdBytes.copy(message, 2);
    
    if (Buffer.isBuffer(encryptedData)) {
        encryptedData.copy(message, 2 + docIdLength);
    } else {
        Buffer.from(encryptedData).copy(message, 2 + docIdLength);
    }
    
    return message;
}

/**
 * Parse a P2P message to extract document ID and encrypted data
 * @param {Buffer|Uint8Array} message - Raw P2P message
 * @returns {Object|null} { docId, encryptedData } or null if invalid/legacy
 */
function parseP2PMessage(message) {
    const buf = Buffer.isBuffer(message) ? message : Buffer.from(message);
    
    // Check minimum length and version
    if (buf.length < 3) return null;
    
    const version = buf[0];
    if (version !== P2P_PROTOCOL_VERSION) {
        // Legacy message without document ID
        return null;
    }
    
    const docIdLength = buf[1];
    if (buf.length < 2 + docIdLength) return null;
    
    const docId = buf.slice(2, 2 + docIdLength).toString('utf8');
    const encryptedData = buf.slice(2 + docIdLength);
    
    return { docId, encryptedData };
}

// --- 2. Yjs / P2P Bridge ---

// Helper to broadcast status to all connected metadata clients
function broadcastStatus() {
    const statusMessage = JSON.stringify({
        type: 'status',
        status: connectionStatus,
        isOnline: isOnline,
        torEnabled: torEnabled,
        onionAddress: onionAddress ? `${onionAddress}.onion` : null,
        multiaddr: fullMultiaddr,
        peerId: p2pNode ? p2pNode.peerId.toString() : null
    });
    metaWss.clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(statusMessage);
        }
    });
}

// Helper to get encryption key for a document (per-doc key or fallback to session key)
function getKeyForDocument(docName) {
    return documentKeys.get(docName) || sessionKey;
}

// Helper to persist and optionally broadcast document updates
async function persistUpdate(docName, update, origin) {
    const key = getKeyForDocument(docName);
    console.log(`[Sidecar] persistUpdate called for ${docName}, update size: ${update?.length}, hasKey: ${!!key}`);
    
    if (!key) {
        console.log(`[Sidecar] Cannot persist update - no encryption key for document ${docName}`);
        return;
    }
    
    try {
        console.log(`[Sidecar] Encrypting update for ${docName}...`);
        const encrypted = encryptUpdate(update, key);
        console.log(`[Sidecar] Encrypted size: ${encrypted?.length}`);
        
        // Use docName as prefix for proper per-document storage
        const dbKey = `${docName}:${Date.now().toString()}`;
        await db.put(dbKey, encrypted);
        console.log(`[Sidecar] Persisted update for document: ${docName} (${update.length} bytes) with key: ${dbKey}`);
        
        // If P2P is available, broadcast to network with document ID
        if (isOnline && p2pNode && origin !== 'p2p') {
            // Create P2P message with document ID for proper routing
            const p2pMessage = createP2PMessage(docName, encrypted);
            await p2pNode.services.pubsub.publish(PUBSUB_TOPIC, p2pMessage);
            console.log(`[Sidecar] Published update to P2P network for doc: ${docName}`);
        }
    } catch (err) {
        console.error('[Sidecar] Failed to persist update:', err);
    }
}

async function loadPersistedData(docName, doc, key) {
    console.log(`[Sidecar] Loading persisted data for document: ${docName}`);
    console.log(`[Sidecar] DB iterator starting...`);
    let count = 0;
    let errors = 0;
    let orphaned = 0;
    let totalKeys = 0;
    const prefix = `${docName}:`;
    const orphanedKeys = [];
    
    for await (const [dbKey, value] of db.iterator()) {
        totalKeys++;
        // Load updates for this specific document, or legacy data without prefix
        // Legacy data (no colon) or p2p data (p2p: prefix) is loaded for all docs
        const isLegacy = !dbKey.includes(':');
        const isP2P = dbKey.startsWith('p2p:');
        const isThisDoc = dbKey.startsWith(prefix);
        
        // Skip verbose logging for non-matching keys
        if (isThisDoc || isLegacy || isP2P) {
            console.log(`[Sidecar] DB key: ${dbKey}, isThisDoc: ${isThisDoc}, isLegacy: ${isLegacy}, isP2P: ${isP2P}`);
            console.log(`[Sidecar] Decrypting update from key: ${dbKey}`);
            const decrypted = decryptUpdate(value, key);
            if (decrypted) {
                console.log(`[Sidecar] Decrypted ${decrypted.length} bytes, applying to doc...`);
                try {
                    Y.applyUpdate(doc, decrypted, 'persistence');
                    count++;
                    console.log(`[Sidecar] Applied update successfully`);
                } catch (e) {
                    console.error(`[Sidecar] Failed to apply update ${dbKey}:`, e.message);
                    errors++;
                }
            } else {
                console.log(`[Sidecar] Decryption returned null for key: ${dbKey} (wrong key or corrupted)`);
                orphaned++;
                orphanedKeys.push(dbKey);
            }
        }
    }
    
    console.log(`[Sidecar] Loaded ${count} persisted updates for document: ${docName} (${errors} errors, ${orphaned} orphaned, ${totalKeys} total keys in DB)`);
    
    // Return info about orphaned data for potential cleanup
    return { count, errors, orphaned, orphanedKeys };
}

// --- Document Metadata Storage ---
const METADATA_DB_PATH = path.join(USER_DATA_PATH, 'storage', 'metadata');
let metadataDb;
try {
    metadataDb = new Level(METADATA_DB_PATH, { valueEncoding: 'json' });
    console.log(`[Sidecar] Initialized metadata DB at ${METADATA_DB_PATH}`);
} catch (err) {
    console.error('[Sidecar] Failed to create metadata DB:', err.message);
}

// Load all document metadata
async function loadDocumentList() {
    const documents = [];
    console.log('[Sidecar] Loading document list...');
    try {
        for await (const [key, metadata] of metadataDb.iterator()) {
            // Only load keys that start with 'doc:' prefix
            // Skip workspaces, folders, and other metadata types
            if (!key.startsWith('doc:')) {
                continue;
            }
            
            // Extract the actual document ID (remove 'doc:' prefix)
            const docId = key.slice(4);
            documents.push({ id: docId, ...metadata });
            
            // Preload encryption keys for documents that have them stored
            if (metadata.encryptionKey) {
                try {
                    // Ensure uint8arrays is loaded before using
                    await uint8arraysReady;
                    const keyBytes = uint8ArrayFromString(metadata.encryptionKey, 'base64');
                    documentKeys.set(docId, keyBytes);
                    console.log(`[Sidecar] Loaded encryption key for document: ${docId}`);
                } catch (e) {
                    console.error(`[Sidecar] Failed to load key for ${docId}:`, e.message);
                }
            }
        }
    } catch (err) {
        console.log('[Sidecar] No existing documents found:', err.message);
    }
    console.log(`[Sidecar] Loaded ${documents.length} documents`);
    return documents;
}

// Save document metadata
async function saveDocumentMetadata(docId, metadata) {
    try {
        // Use 'doc:' prefix to distinguish from workspaces/folders
        await metadataDb.put(`doc:${docId}`, metadata);
        console.log(`[Sidecar] Saved metadata for document: ${docId}`);
    } catch (err) {
        console.error('[Sidecar] Failed to save document metadata:', err);
    }
}

// Delete document metadata
async function deleteDocumentMetadata(docId) {
    try {
        // Use 'doc:' prefix to match how we store it
        await metadataDb.del(`doc:${docId}`);
        console.log(`[Sidecar] Deleted metadata for document: ${docId}`);
    } catch (err) {
        console.error('[Sidecar] Failed to delete document metadata:', err);
    }
}

// Delete document data (all updates for a document)
async function deleteDocumentData(docId) {
    try {
        const prefix = `${docId}:`;
        let count = 0;
        const keysToDelete = [];
        
        // Collect all keys for this document
        for await (const [dbKey] of db.iterator({ keys: true, values: false })) {
            if (dbKey.startsWith(prefix)) {
                keysToDelete.push(dbKey);
            }
        }
        
        // Delete all collected keys
        for (const key of keysToDelete) {
            await db.del(key);
            count++;
        }
        
        console.log(`[Sidecar] Deleted ${count} updates for document: ${docId}`);
        return count;
    } catch (err) {
        console.error('[Sidecar] Failed to delete document data:', err);
        return 0;
    }
}

// --- Folder Metadata Functions ---

// Load all folders
async function loadFolderList() {
    const folders = [];
    try {
        for await (const [key, value] of metadataDb.iterator()) {
            if (key.startsWith('folder:')) {
                folders.push(value);
            }
        }
    } catch (err) {
        console.log('[Sidecar] No existing folders found');
    }
    return folders;
}

// Save folder metadata
async function saveFolderMetadata(folderId, metadata) {
    try {
        await metadataDb.put(`folder:${folderId}`, metadata);
        console.log(`[Sidecar] Saved metadata for folder: ${folderId}`);
    } catch (err) {
        console.error('[Sidecar] Failed to save folder metadata:', err);
        throw err;
    }
}

// --- Workspace Metadata Functions ---

// Load all workspaces
async function loadWorkspaceList() {
    const workspaces = [];
    console.log('[Sidecar] Loading workspace list...');
    try {
        for await (const [key, value] of metadataDb.iterator()) {
            console.log(`[Sidecar] DB key: ${key}`);
            if (key.startsWith('workspace:')) {
                console.log(`[Sidecar] Found workspace: ${value?.name || value?.id}`);
                workspaces.push(value);
            }
        }
    } catch (err) {
        console.error('[Sidecar] Error loading workspaces:', err);
    }
    console.log(`[Sidecar] Loaded ${workspaces.length} workspaces`);
    return workspaces;
}

// Save workspace metadata
async function saveWorkspaceMetadata(workspaceId, metadata) {
    try {
        const key = `workspace:${workspaceId}`;
        console.log(`[Sidecar] Saving workspace with key: ${key}`);
        await metadataDb.put(key, metadata);
        console.log(`[Sidecar] Saved metadata for workspace: ${workspaceId}`);
        
        // Verify it was saved
        const saved = await metadataDb.get(key);
        console.log(`[Sidecar] Verified workspace saved: ${saved?.name}`);
    } catch (err) {
        console.error('[Sidecar] Failed to save workspace metadata:', err);
        throw err;
    }
}

// Delete workspace metadata
async function deleteWorkspaceMetadata(workspaceId) {
    try {
        await metadataDb.del(`workspace:${workspaceId}`);
        console.log(`[Sidecar] Deleted metadata for workspace: ${workspaceId}`);
    } catch (err) {
        console.error('[Sidecar] Failed to delete workspace metadata:', err);
        throw err;
    }
}

// --- Trash Management Functions ---

const TRASH_PURGE_DAYS = 30;
const TRASH_PURGE_MS = TRASH_PURGE_DAYS * 24 * 60 * 60 * 1000;

// Load trashed items (folders and documents)
async function loadTrashList(workspaceId) {
    const trash = {
        folders: [],
        documents: []
    };
    
    try {
        // Load trashed folders
        for await (const [key, value] of metadataDb.iterator()) {
            if (key.startsWith('folder:') && value.deletedAt && value.workspaceId === workspaceId) {
                trash.folders.push(value);
            }
        }
        
        // Load trashed documents
        for await (const [key, value] of metadataDb.iterator()) {
            if (key.startsWith('doc:') && value.deletedAt) {
                // Check if document belongs to this workspace
                if (value.workspaceId === workspaceId) {
                    // Extract doc ID by removing 'doc:' prefix
                    const docId = key.slice(4);
                    trash.documents.push({ id: docId, ...value });
                } else if (value.folderId) {
                    // Check folder's workspace
                    try {
                        const folder = await metadataDb.get(`folder:${value.folderId}`);
                        if (folder.workspaceId === workspaceId) {
                            const docId = key.slice(4);
                            trash.documents.push({ id: docId, ...value });
                        }
                    } catch (e) {
                        // Folder not found, skip
                    }
                }
            }
        }
    } catch (err) {
        console.error('[Sidecar] Error loading trash:', err);
    }
    
    return trash;
}

// Auto-purge items older than 30 days
async function purgeExpiredTrash() {
    const now = Date.now();
    const cutoff = now - TRASH_PURGE_MS;
    let purgedCount = 0;
    
    try {
        // Find and delete expired folders
        for await (const [key, value] of metadataDb.iterator()) {
            if (key.startsWith('folder:') && value.deletedAt && value.deletedAt < cutoff) {
                await metadataDb.del(key);
                purgedCount++;
                console.log(`[Sidecar] Purged expired folder: ${value.id}`);
            }
        }
        
        // Find and delete expired documents
        for await (const [key, value] of metadataDb.iterator()) {
            if (key.startsWith('doc:') && value.deletedAt && value.deletedAt < cutoff) {
                await metadataDb.del(key);
                // Extract doc ID by removing 'doc:' prefix
                const docId = key.slice(4);
                await deleteDocumentData(docId);
                purgedCount++;
                console.log(`[Sidecar] Purged expired document: ${value.id}`);
            }
        }
        
        if (purgedCount > 0) {
            console.log(`[Sidecar] Purged ${purgedCount} expired trash items`);
        }
    } catch (err) {
        console.error('[Sidecar] Error purging expired trash:', err);
    }
    
    return purgedCount;
}

// Run trash purge check every hour
setInterval(purgeExpiredTrash, 60 * 60 * 1000);
// Also run on startup after a delay
setTimeout(purgeExpiredTrash, 5000);

// --- 3. WebSocket Servers ---

// Server 1: Handles Yjs protocol (using the library's official setup)
const yjsWss = new WebSocket.Server({ port: YJS_WEBSOCKET_PORT });
yjsWss.on('connection', (conn, req) => {
    console.log('[Sidecar] Yjs client connected');
    setupWSConnection(conn, req);
});
console.log(`[Sidecar] Yjs WebSocket server listening on ws://localhost:${YJS_WEBSOCKET_PORT}`);

// Server 2: Handles metadata and commands
const metaWss = new WebSocket.Server({ port: METADATA_WEBSOCKET_PORT });
console.log(`[Sidecar] Metadata WebSocket server listening on ws://localhost:${METADATA_WEBSOCKET_PORT}`);

// --- P2P Initialization ---
// Initialize P2PBridge with identity if available (enables Hyperswarm DHT)
// force=true will reinitialize even if already initialized (useful after identity creation)
async function initializeP2P(force = false) {
    if (p2pInitialized && !force) {
        console.log('[Sidecar] P2P already initialized, skipping');
        return { success: true, alreadyInitialized: true };
    }
    
    try {
        if (hasIdentity()) {
            const identity = loadIdentity();
            if (identity) {
                const p2pIdentity = {
                    publicKey: Buffer.from(identity.publicKey).toString('hex'),
                    secretKey: Buffer.from(identity.privateKey).toString('hex'),
                    displayName: identity.handle || 'Anonymous',
                    color: identity.color || '#6366f1',
                };
                
                await p2pBridge.initialize(p2pIdentity);
                p2pInitialized = true;
                console.log('[Sidecar] P2P initialized with identity:', identity.handle);
                
                // Set up Yjs sync bridging via P2P
                setupYjsP2PBridge();
                
                // Set up peer persistence for mesh networking
                setupPeerPersistence();
                
                // Auto-rejoin saved workspaces
                await autoRejoinWorkspaces();
                
                return { success: true, alreadyInitialized: false };
            }
        } else {
            console.log('[Sidecar] No identity found, P2P will initialize when identity is created');
            return { success: false, reason: 'no_identity' };
        }
    } catch (err) {
        console.error('[Sidecar] Failed to initialize P2P:', err);
        return { success: false, reason: err.message };
    }
    return { success: false, reason: 'unknown' };
}

// --- Yjs P2P Bridge ---
// This bridges Hyperswarm P2P connections with Yjs document sync
// When a peer sends a sync message, apply it to the local Yjs doc
// When a local Yjs doc updates, broadcast to P2P peers

// Map of topicHash -> workspaceId for reverse lookup
const topicToWorkspace = new Map();

function setupYjsP2PBridge() {
    if (!p2pBridge || !p2pBridge.hyperswarm) {
        console.warn('[Sidecar] Cannot setup Yjs P2P bridge - P2P not initialized');
        return;
    }
    
    const hyperswarm = p2pBridge.hyperswarm;
    
    // Listen for sync messages from P2P peers
    hyperswarm.on('sync-message', ({ peerId, topic, data }) => {
        handleP2PSyncMessage(peerId, topic, data);
    });
    
    console.log('[Sidecar] Yjs P2P bridge initialized');
}

// Handle incoming sync message from a P2P peer
function handleP2PSyncMessage(peerId, topicHex, data) {
    try {
        // Find the workspace ID for this topic
        const workspaceId = topicToWorkspace.get(topicHex);
        if (!workspaceId) {
            console.warn(`[Sidecar] Received sync for unknown topic: ${topicHex?.slice(0, 16)}...`);
            return;
        }
        
        // Construct the Yjs room name
        const roomName = `workspace-meta:${workspaceId}`;
        
        // Get or create the Yjs doc
        let doc = docs.get(roomName);
        if (!doc) {
            doc = new Y.Doc();
            docs.set(roomName, doc);
            console.log(`[Sidecar] Created Yjs doc for room: ${roomName} (from P2P)`);
        }
        
        // Decode and apply the sync update
        const updateData = typeof data === 'string' ? Buffer.from(data, 'base64') : data;
        Y.applyUpdate(doc, updateData);
        
        console.log(`[Sidecar] Applied P2P sync from peer ${peerId?.slice(0, 8)}... to ${roomName}`);
    } catch (err) {
        console.error('[Sidecar] Failed to handle P2P sync message:', err);
    }
}

// Broadcast a Yjs update to all P2P peers for a workspace
function broadcastYjsUpdate(workspaceId, topicHex, update) {
    if (!p2pInitialized || !p2pBridge.hyperswarm) return;
    
    try {
        const updateBase64 = Buffer.from(update).toString('base64');
        p2pBridge.hyperswarm.broadcastSync(topicHex, updateBase64);
    } catch (err) {
        console.error('[Sidecar] Failed to broadcast Yjs update:', err);
    }
}

// Register a workspace topic for Yjs bridging
function registerWorkspaceTopic(workspaceId, topicHex) {
    topicToWorkspace.set(topicHex, workspaceId);
    
    // Set up doc observer to broadcast updates
    const roomName = `workspace-meta:${workspaceId}`;
    let doc = docs.get(roomName);
    
    if (doc) {
        // Add update observer to broadcast to P2P peers
        doc.on('update', (update, origin) => {
            // Don't re-broadcast updates that came from P2P
            if (origin !== 'p2p') {
                broadcastYjsUpdate(workspaceId, topicHex, update);
            }
        });
        console.log(`[Sidecar] Registered P2P observer for ${roomName}`);
    }
}

// Set up listeners to persist peer connections for mesh networking
function setupPeerPersistence() {
    if (!p2pBridge || !p2pBridge.hyperswarm) return;
    
    const hyperswarm = p2pBridge.hyperswarm;
    
    // When we verify a peer's identity, persist them for this workspace
    hyperswarm.on('peer-identity', async ({ peerId, identity }) => {
        try {
            // Find all workspaces this peer might be connected to
            // by checking which topics they're in
            const conn = hyperswarm.connections.get(peerId);
            if (!conn) return;
            
            for (const topicHex of conn.topics) {
                const workspaceId = topicToWorkspace.get(topicHex);
                if (!workspaceId) continue;
                
                // Update lastKnownPeers for this workspace
                await updateWorkspacePeers(workspaceId, peerId, true);
            }
        } catch (err) {
            console.error('[Sidecar] Failed to persist peer:', err);
        }
    });
    
    // When a peer joins a topic, persist them
    hyperswarm.on('peer-joined', async ({ peerId, topic }) => {
        try {
            const workspaceId = topicToWorkspace.get(topic);
            if (workspaceId) {
                await updateWorkspacePeers(workspaceId, peerId, true);
            }
        } catch (err) {
            console.error('[Sidecar] Failed to persist peer on join:', err);
        }
    });
    
    // Optionally mark peers as stale when they leave (don't remove, just update timestamp)
    hyperswarm.on('peer-left', async ({ peerId, topic }) => {
        try {
            const workspaceId = topicToWorkspace.get(topic);
            if (workspaceId) {
                await updateWorkspacePeers(workspaceId, peerId, false);
            }
        } catch (err) {
            console.error('[Sidecar] Failed to update peer status on leave:', err);
        }
    });
    
    console.log('[Sidecar] Peer persistence handlers initialized');
}

// Helper to update a workspace's lastKnownPeers
async function updateWorkspacePeers(workspaceId, peerPublicKey, isConnected) {
    try {
        const existing = await metadataDb.get(`workspace:${workspaceId}`);
        if (!existing) return;
        
        let peers = existing.lastKnownPeers || [];
        
        // Find existing peer entry
        const existingIdx = peers.findIndex(p => p.publicKey === peerPublicKey);
        
        if (isConnected) {
            const peerEntry = {
                publicKey: peerPublicKey,
                lastSeen: Date.now(),
            };
            
            if (existingIdx >= 0) {
                peers[existingIdx] = peerEntry;
            } else {
                peers.push(peerEntry);
            }
            console.log(`[Sidecar] Persisted peer ${peerPublicKey.slice(0, 16)}... for workspace ${workspaceId.slice(0, 8)}...`);
        } else {
            // Just update lastSeen, don't remove (they might come back)
            if (existingIdx >= 0) {
                peers[existingIdx].lastSeen = Date.now();
                peers[existingIdx].disconnectedAt = Date.now();
            }
        }
        
        // Keep only the most recent 20 peers
        peers = peers
            .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
            .slice(0, 20);
        
        await saveWorkspaceMetadata(workspaceId, { ...existing, lastKnownPeers: peers });
    } catch (err) {
        // Workspace might not exist yet
        if (err.code !== 'LEVEL_NOT_FOUND') {
            console.error('[Sidecar] Failed to update workspace peers:', err.message);
        }
    }
}

// Auto-rejoin workspaces that have topic hashes saved
async function autoRejoinWorkspaces() {
    try {
        const workspaces = await loadWorkspaceList();
        for (const ws of workspaces) {
            if (ws.topicHash && p2pBridge.isInitialized) {
                try {
                    await p2pBridge.joinTopic(ws.topicHash);
                    console.log(`[Sidecar] Auto-rejoined workspace topic: ${ws.topicHash.slice(0, 16)}...`);
                    
                    // Register for Yjs P2P bridging
                    registerWorkspaceTopic(ws.id, ws.topicHash);
                    
                    // Try to connect to last known peers
                    if (ws.lastKnownPeers && Array.isArray(ws.lastKnownPeers)) {
                        for (const peer of ws.lastKnownPeers) {
                            if (peer.publicKey) {
                                try {
                                    await p2pBridge.connectToPeer(peer.publicKey);
                                } catch (e) {
                                    // Peer may be offline, continue
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.warn(`[Sidecar] Failed to rejoin workspace ${ws.id}:`, e.message);
                }
            }
        }
    } catch (err) {
        console.error('[Sidecar] Auto-rejoin failed:', err);
    }
}

// Initialize P2P after a short delay to let everything start up
setTimeout(initializeP2P, 1000);

metaWss.on('connection', (ws, req) => {
    console.log('[Sidecar] Metadata client connected.');
    
    // Generate unique client ID for rate limiting per connection
    // Include remote port to differentiate multiple connections from localhost
    const clientId = `${req.socket.remoteAddress || 'unknown'}:${req.socket.remotePort || crypto.randomBytes(4).toString('hex')}`;
    
    // Immediately send current status
    ws.send(JSON.stringify({
        type: 'status',
        status: connectionStatus,
        isOnline: isOnline,
        onionAddress: onionAddress ? `${onionAddress}.onion` : null,
        multiaddr: fullMultiaddr,
        peerId: p2pNode ? p2pNode.peerId.toString() : null
    }));

    ws.on('message', async (message) => {
        // Apply rate limiting
        const rateLimit = rateLimiter.check(clientId);
        if (!rateLimit.allowed) {
            ws.send(JSON.stringify({ 
                type: 'error', 
                code: 'RATE_LIMITED',
                message: `Too many requests. Retry after ${rateLimit.retryAfter} seconds.`,
                retryAfter: rateLimit.retryAfter
            }));
            console.warn(`[Sidecar] Rate limited client: ${clientId.slice(0, 8)}`);
            return;
        }
        
        try {
            // Ensure uint8arrays module is loaded
            await uint8arraysReady;
            
            // Use safe JSON parsing with prototype pollution protection
            const parsed = safeJsonParse(message.toString());
            if (!parsed) {
                ws.send(JSON.stringify({ type: 'error', code: 'INVALID_MESSAGE', message: 'Invalid message format' }));
                return;
            }
            
            const { type, payload, document, docId, metadata, docName, workspace, folder, workspaceId, folderId, updates } = parsed;
            
            // Validate message type
            if (typeof type !== 'string' || type.length === 0 || type.length > 64) {
                ws.send(JSON.stringify({ type: 'error', code: 'INVALID_TYPE', message: 'Invalid message type' }));
                return;
            }
            
            switch (type) {
                case 'set-key':
                    if (payload) {
                        const key = uint8ArrayFromString(payload, 'base64');
                        
                        // Validate key length
                        if (!isValidKey(key)) {
                            ws.send(JSON.stringify({ type: 'error', code: 'INVALID_KEY', message: 'Invalid encryption key' }));
                            return;
                        }
                        
                        // Sanitize docName if provided
                        const sanitizedDocName = docName ? sanitizeId(docName) : null;
                        
                        if (sanitizedDocName) {
                            // Per-document key
                            console.log(`[Sidecar] Received encryption key for document: ${sanitizedDocName}`);
                            documentKeys.set(sanitizedDocName, key);
                            
                            // If this document is already loaded, reload its data with the correct key
                            if (docs.has(sanitizedDocName)) {
                                const doc = docs.get(sanitizedDocName);
                                await loadPersistedData(sanitizedDocName, doc, key);
                            }
                            
                            // Flush any pending updates for this document
                            if (pendingUpdates.has(sanitizedDocName)) {
                                const updates = pendingUpdates.get(sanitizedDocName);
                                console.log(`[Sidecar] Flushing ${updates.length} pending updates for ${sanitizedDocName}`);
                                for (const { update, origin } of updates) {
                                    await persistUpdate(sanitizedDocName, update, origin);
                                }
                                pendingUpdates.set(sanitizedDocName, []);
                            }
                        } else {
                            // Legacy: global session key (for backward compatibility)
                            console.log('[Sidecar] Received global session key. Loading all documents...');
                            sessionKey = key;
                            
                            // When the key is set, load data for all existing documents
                            for (const [name, doc] of docs.entries()) {
                                // Only use session key if no per-doc key exists
                                if (!documentKeys.has(name)) {
                                    await loadPersistedData(name, doc, sessionKey);
                                }
                            }
                            console.log('[Sidecar] Finished applying persisted data to all docs.');
                            
                            // Flush any pending updates that were queued before the key was available
                            for (const [name, updates] of pendingUpdates.entries()) {
                                if (!documentKeys.has(name)) {
                                    console.log(`[Sidecar] Flushing ${updates.length} pending updates for ${name}`);
                                    for (const { update, origin } of updates) {
                                        await persistUpdate(name, update, origin);
                                    }
                                    pendingUpdates.set(name, []);
                                }
                            }
                        }
                        
                        // Confirm key was set
                        ws.send(JSON.stringify({ type: 'key-set', success: true, docName: sanitizedDocName || docName }));
                    }
                    break;
                
                case 'list-documents':
                    const documents = await loadDocumentList();
                    ws.send(JSON.stringify({ type: 'document-list', documents }));
                    break;
                
                case 'create-document':
                    if (document) {
                        // Validate document ID
                        const safeDocId = sanitizeId(document.id);
                        if (!safeDocId) {
                            ws.send(JSON.stringify({ type: 'error', code: 'INVALID_DOC_ID', message: 'Invalid document ID' }));
                            return;
                        }
                        
                        // Sanitize name
                        const safeDocName = sanitizeName(document.name) || 'Untitled';
                        
                        // Validate workspace/folder IDs if provided
                        const safeWorkspaceId = document.workspaceId ? sanitizeId(document.workspaceId) : null;
                        const safeFolderId = document.folderId ? sanitizeId(document.folderId) : null;
                        
                        // Validate document type
                        const validTypes = ['text', 'sheet', 'code', 'markdown'];
                        const safeType = validTypes.includes(document.type) ? document.type : 'text';
                        
                        await saveDocumentMetadata(safeDocId, {
                            name: safeDocName,
                            type: safeType,
                            workspaceId: safeWorkspaceId,
                            folderId: safeFolderId,
                            encryptionKey: document.encryptionKey, // Store encryption key
                            createdAt: document.createdAt || Date.now(),
                            lastEdited: document.lastEdited || Date.now(),
                            authorCount: Math.min(Math.max(1, parseInt(document.authorCount) || 1), 1000)
                        });
                        
                        // Create sanitized document for broadcast
                        const sanitizedDocument = {
                            ...document,
                            id: safeDocId,
                            name: safeDocName,
                            type: safeType,
                            workspaceId: safeWorkspaceId,
                            folderId: safeFolderId
                        };
                        
                        // Broadcast to all clients
                        metaWss.clients.forEach(client => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({ type: 'document-created', document: sanitizedDocument }));
                            }
                        });
                    }
                    break;
                
                case 'delete-document':
                    if (docId) {
                        // Validate document ID
                        const safeDeleteDocId = sanitizeId(docId);
                        if (!safeDeleteDocId) {
                            ws.send(JSON.stringify({ type: 'error', code: 'INVALID_DOC_ID', message: 'Invalid document ID' }));
                            return;
                        }
                        
                        // Delete both metadata and document data
                        await deleteDocumentMetadata(safeDeleteDocId);
                        await deleteDocumentData(safeDeleteDocId);
                        
                        // Also remove from y-websocket docs map if present
                        if (docs.has(safeDeleteDocId)) {
                            const doc = docs.get(safeDeleteDocId);
                            doc.destroy();
                            docs.delete(safeDeleteDocId);
                            console.log(`[Sidecar] Removed Yjs doc from memory: ${safeDeleteDocId}`);
                        }
                        
                        // Broadcast to all clients
                        metaWss.clients.forEach(client => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({ type: 'document-deleted', docId: safeDeleteDocId }));
                            }
                        });
                    }
                    break;
                
                case 'update-document-metadata':
                    if (docId && metadata) {
                        // Load existing, merge, save
                        try {
                            const existing = await metadataDb.get(`doc:${docId}`);
                            await saveDocumentMetadata(docId, { ...existing, ...metadata, lastEdited: Date.now() });
                        } catch (err) {
                            await saveDocumentMetadata(docId, { ...metadata, lastEdited: Date.now() });
                        }
                    }
                    break;
                
                case 'toggle-tor':
                    const enable = payload?.enable;
                    console.log(`[Sidecar] Toggle Tor: ${enable ? 'ON' : 'OFF'}`);
                    
                    if (enable && !torEnabled) {
                        torEnabled = true;
                        await startP2PStack();
                    } else if (!enable && torEnabled) {
                        torEnabled = false;
                        await stopP2PStack();
                    }
                    
                    // Send confirmation
                    ws.send(JSON.stringify({ 
                        type: 'tor-toggled', 
                        enabled: torEnabled,
                        status: connectionStatus
                    }));
                    break;
                
                case 'get-status':
                    ws.send(JSON.stringify({
                        type: 'status',
                        status: connectionStatus,
                        isOnline: isOnline,
                        torEnabled: torEnabled,
                        onionAddress: onionAddress ? `${onionAddress}.onion` : null,
                        multiaddr: fullMultiaddr,
                        peerId: p2pNode ? p2pNode.peerId.toString() : null
                    }));
                    break;
                
                case 'clear-orphaned-data':
                    // Clear all data that cannot be decrypted (orphaned from old sessions)
                    console.log('[Sidecar] Clearing orphaned/unrecoverable data...');
                    let clearedCount = 0;
                    const keysToDelete = [];
                    
                    for await (const [dbKey, value] of db.iterator()) {
                        // Try to decrypt with all known keys
                        let canDecrypt = false;
                        
                        // Try session key
                        if (sessionKey) {
                            const decrypted = decryptUpdate(value, sessionKey);
                            if (decrypted) canDecrypt = true;
                        }
                        
                        // Try all document keys
                        if (!canDecrypt) {
                            for (const [docId, key] of documentKeys) {
                                const decrypted = decryptUpdate(value, key);
                                if (decrypted) {
                                    canDecrypt = true;
                                    break;
                                }
                            }
                        }
                        
                        if (!canDecrypt) {
                            keysToDelete.push(dbKey);
                        }
                    }
                    
                    for (const key of keysToDelete) {
                        await db.del(key);
                        clearedCount++;
                    }
                    
                    console.log(`[Sidecar] Cleared ${clearedCount} orphaned entries`);
                    ws.send(JSON.stringify({ 
                        type: 'orphaned-data-cleared', 
                        count: clearedCount 
                    }));
                    break;
                
                // --- Folder Management ---
                case 'list-folders':
                    try {
                        const folders = await loadFolderList();
                        ws.send(JSON.stringify({ type: 'folder-list', folders }));
                    } catch (err) {
                        console.error('[Sidecar] Failed to list folders:', err);
                        ws.send(JSON.stringify({ type: 'folder-list', folders: [], error: err.message }));
                    }
                    break;
                
                case 'create-folder':
                    // Accept folder from direct property or payload
                    const folderData = folder || payload?.folder;
                    console.log('[Sidecar] create-folder received:', folderData?.id, folderData?.name);
                    if (folderData) {
                        try {
                            await saveFolderMetadata(folderData.id, folderData);
                            console.log('[Sidecar] Folder saved successfully');
                            metaWss.clients.forEach(client => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({ type: 'folder-created', folder: folderData }));
                                }
                            });
                        } catch (err) {
                            console.error('[Sidecar] Failed to create folder:', err);
                            ws.send(JSON.stringify({ type: 'error', message: err.message }));
                        }
                    }
                    break;
                
                case 'update-folder':
                    // Accept folderId/updates from direct properties or payload
                    const updateFolderId = folderId || payload?.folderId;
                    const updateFolderData = updates || payload?.updates;
                    if (updateFolderId && updateFolderData) {
                        try {
                            const existing = await metadataDb.get(`folder:${updateFolderId}`);
                            const updated = { ...existing, ...updateFolderData };
                            await saveFolderMetadata(updateFolderId, updated);
                            metaWss.clients.forEach(client => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({ type: 'folder-updated', folder: updated }));
                                }
                            });
                        } catch (err) {
                            console.error('[Sidecar] Failed to update folder:', err);
                            ws.send(JSON.stringify({ type: 'error', message: err.message }));
                        }
                    }
                    break;
                
                case 'delete-folder':
                    // Soft delete - add deletedAt timestamp
                    // Accept folderId from direct property or payload
                    const deleteFolderId = folderId || payload?.folderId;
                    if (deleteFolderId) {
                        try {
                            const folderToDelete = await metadataDb.get(`folder:${deleteFolderId}`);
                            const trashed = {
                                ...folderToDelete,
                                deletedAt: Date.now(),
                                deletedBy: payload?.deletedBy || null
                            };
                            await saveFolderMetadata(deleteFolderId, trashed);
                            metaWss.clients.forEach(client => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({ type: 'folder-deleted', folderId: deleteFolderId }));
                                }
                            });
                        } catch (err) {
                            console.error('[Sidecar] Failed to delete folder:', err);
                            ws.send(JSON.stringify({ type: 'error', message: err.message }));
                        }
                    }
                    break;
                
                case 'move-document':
                case 'move-document-to-folder':
                    // Handle both message formats: { documentId } or { docId }
                    const moveDocId = payload?.documentId || payload?.docId;
                    if (moveDocId) {
                        try {
                            const existing = await metadataDb.get(`doc:${moveDocId}`);
                            await saveDocumentMetadata(moveDocId, { 
                                ...existing, 
                                folderId: payload.folderId || null 
                            });
                            console.log(`[Sidecar] Moved document ${moveDocId} to folder ${payload.folderId || 'root'}`);
                            metaWss.clients.forEach(client => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({ 
                                        type: 'document-moved', 
                                        docId: moveDocId,
                                        documentId: moveDocId,
                                        folderId: payload.folderId 
                                    }));
                                }
                            });
                        } catch (err) {
                            console.error('[Sidecar] Failed to move document:', err);
                            ws.send(JSON.stringify({ type: 'error', message: err.message }));
                        }
                    }
                    break;
                
                // --- P2P Info ---
                case 'get-p2p-info':
                    // Get our Hyperswarm public key, connected peers, and direct address
                    // If P2P not initialized but identity exists, try to initialize now
                    try {
                        if (!p2pInitialized) {
                            console.log('[Sidecar] P2P not initialized, attempting initialization...');
                            await initializeP2P(true);
                        }
                        const ownPublicKey = p2pBridge.getOwnPublicKey();
                        const connectedPeers = p2pBridge.getConnectedPeers();
                        // Get direct connection address (public IP:port)
                        const directAddress = await p2pBridge.getDirectAddress();
                        console.log('[Sidecar] get-p2p-info: initialized=', p2pInitialized, 'ownPublicKey=', ownPublicKey?.slice(0, 16), 'directAddress=', directAddress?.address);
                        ws.send(JSON.stringify({
                            type: 'p2p-info',
                            initialized: p2pInitialized,
                            ownPublicKey,
                            connectedPeers,
                            directAddress, // { host, port, publicKey, address }
                        }));
                    } catch (err) {
                        console.error('[Sidecar] get-p2p-info error:', err);
                        ws.send(JSON.stringify({
                            type: 'p2p-info',
                            initialized: false,
                            ownPublicKey: null,
                            connectedPeers: [],
                            directAddress: null,
                            error: err.message,
                        }));
                    }
                    break;
                
                case 'reinitialize-p2p':
                    // Force P2P reinitialization (call after identity is created/changed)
                    try {
                        console.log('[Sidecar] Reinitializing P2P...');
                        const result = await initializeP2P(true);
                        const ownPublicKey = p2pBridge.getOwnPublicKey();
                        const directAddress = await p2pBridge.getDirectAddress();
                        console.log('[Sidecar] P2P reinitialized: initialized=', p2pInitialized, 'ownPublicKey=', ownPublicKey?.slice(0, 16));
                        ws.send(JSON.stringify({
                            type: 'p2p-reinitialized',
                            success: result.success,
                            initialized: p2pInitialized,
                            ownPublicKey,
                            directAddress,
                            reason: result.reason,
                        }));
                    } catch (err) {
                        console.error('[Sidecar] P2P reinitialization failed:', err);
                        ws.send(JSON.stringify({
                            type: 'p2p-reinitialized',
                            success: false,
                            initialized: false,
                            ownPublicKey: null,
                            directAddress: null,
                            error: err.message,
                        }));
                    }
                    break;
                
                // --- Workspace Management ---
                case 'list-workspaces':
                    try {
                        const workspaces = await loadWorkspaceList();
                        ws.send(JSON.stringify({ type: 'workspace-list', workspaces }));
                    } catch (err) {
                        console.error('[Sidecar] Failed to list workspaces:', err);
                        ws.send(JSON.stringify({ type: 'workspace-list', workspaces: [], error: err.message }));
                    }
                    break;
                
                case 'create-workspace':
                    // Accept workspace from either direct property or payload.workspace
                    const wsData = workspace || payload?.workspace;
                    console.log('[Sidecar] create-workspace received:', wsData?.id, wsData?.name);
                    if (wsData) {
                        try {
                            await saveWorkspaceMetadata(wsData.id, wsData);
                            console.log('[Sidecar] Workspace saved successfully');
                            
                            // --- P2P: Join the Hyperswarm topic for this workspace ---
                            // This is CRITICAL - without this, the sharer isn't discoverable on DHT
                            // Auto-initialize P2P if needed
                            if (!p2pInitialized && wsData.topicHash) {
                                console.log('[Sidecar] P2P not initialized, attempting initialization for workspace creation...');
                                await initializeP2P(true);
                            }
                            
                            if (p2pInitialized && p2pBridge.isInitialized && wsData.topicHash) {
                                try {
                                    await p2pBridge.joinTopic(wsData.topicHash);
                                    console.log(`[Sidecar] Joined P2P topic for new workspace: ${wsData.topicHash.slice(0, 16)}...`);
                                    
                                    // Register for Yjs P2P bridging
                                    registerWorkspaceTopic(wsData.id, wsData.topicHash);
                                } catch (e) {
                                    console.warn('[Sidecar] Failed to join P2P topic for workspace:', e.message);
                                }
                            } else if (wsData.topicHash && !p2pInitialized) {
                                console.log('[Sidecar] P2P could not be initialized, topic will be joined on next startup');
                            }
                            
                            metaWss.clients.forEach(client => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({ type: 'workspace-created', workspace: wsData }));
                                }
                            });
                        } catch (err) {
                            console.error('[Sidecar] Failed to create workspace:', err);
                            ws.send(JSON.stringify({ type: 'error', message: err.message }));
                        }
                    } else {
                        console.log('[Sidecar] create-workspace: No workspace in payload');
                    }
                    break;
                
                case 'update-workspace':
                    // Accept workspaceId/updates from direct properties or payload
                    const updateWsId = workspaceId || payload?.workspaceId;
                    const updateWsData = updates || payload?.updates;
                    if (updateWsId && updateWsData) {
                        try {
                            const existing = await metadataDb.get(`workspace:${updateWsId}`);
                            const updated = { ...existing, ...updateWsData, updatedAt: Date.now() };
                            await saveWorkspaceMetadata(updateWsId, updated);
                            
                            // --- P2P: Join topic if topicHash was added/changed ---
                            if (p2pInitialized && p2pBridge.isInitialized && updateWsData.topicHash && updateWsData.topicHash !== existing.topicHash) {
                                try {
                                    await p2pBridge.joinTopic(updateWsData.topicHash);
                                    console.log(`[Sidecar] Joined P2P topic for updated workspace: ${updateWsData.topicHash.slice(0, 16)}...`);
                                    registerWorkspaceTopic(updateWsId, updateWsData.topicHash);
                                } catch (e) {
                                    console.warn('[Sidecar] Failed to join P2P topic on update:', e.message);
                                }
                            }
                            
                            metaWss.clients.forEach(client => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({ type: 'workspace-updated', workspace: updated }));
                                }
                            });
                        } catch (err) {
                            console.error('[Sidecar] Failed to update workspace:', err);
                            ws.send(JSON.stringify({ type: 'error', message: err.message }));
                        }
                    }
                    break;
                
                case 'delete-workspace':
                    // Accept workspaceId from direct property or payload
                    const deleteWsId = workspaceId || payload?.workspaceId;
                    if (deleteWsId) {
                        try {
                            await deleteWorkspaceMetadata(deleteWsId);
                            // Note: Folders and documents are NOT deleted - they become orphaned
                            // This is intentional for safety - actual cleanup is separate
                            metaWss.clients.forEach(client => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({ type: 'workspace-deleted', workspaceId: deleteWsId }));
                                }
                            });
                        } catch (err) {
                            console.error('[Sidecar] Failed to delete workspace:', err);
                            ws.send(JSON.stringify({ type: 'error', message: err.message }));
                        }
                    }
                    break;
                
                case 'leave-workspace':
                    // Leave a workspace (for non-owners) - removes local copy only
                    // This is semantically different from delete but performs the same local cleanup
                    const leaveWsId = workspaceId || payload?.workspaceId;
                    if (leaveWsId) {
                        try {
                            console.log('[Sidecar] leave-workspace: Removing local workspace', leaveWsId);
                            await deleteWorkspaceMetadata(leaveWsId);
                            metaWss.clients.forEach(client => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({ type: 'workspace-left', workspaceId: leaveWsId }));
                                }
                            });
                        } catch (err) {
                            console.error('[Sidecar] Failed to leave workspace:', err);
                            ws.send(JSON.stringify({ type: 'error', message: err.message }));
                        }
                    }
                    break;
                
                case 'join-workspace':
                    // Join a workspace via share link - store permission grant
                    // Accept workspace from either direct property or payload.workspace
                    const joinWsData = workspace || payload?.workspace;
                    if (joinWsData) {
                        try {
                            console.log('[Sidecar] join-workspace: Processing workspace', joinWsData.id);
                            // Check if workspace already exists locally
                            let existing = null;
                            try {
                                existing = await metadataDb.get(`workspace:${joinWsData.id}`);
                            } catch (e) {
                                // Workspace doesn't exist locally
                            }
                            
                            if (existing) {
                                // Upgrade permission if new one is higher
                                const permLevels = { owner: 3, editor: 2, viewer: 1 };
                                const existingLevel = permLevels[existing.myPermission] || 0;
                                const newLevel = permLevels[joinWsData.myPermission] || 0;
                                
                                // Build updates object with serverUrl and optionally permission
                                const updates = { ...existing };
                                let needsUpdate = false;
                                
                                // Update serverUrl if provided and different (for cross-platform sync)
                                if (joinWsData.serverUrl && joinWsData.serverUrl !== existing.serverUrl) {
                                    updates.serverUrl = joinWsData.serverUrl;
                                    console.log('[Sidecar] join-workspace: Updating serverUrl to', joinWsData.serverUrl);
                                    needsUpdate = true;
                                }
                                
                                // Update encryptionKey if provided and not present
                                if (joinWsData.encryptionKey && !existing.encryptionKey) {
                                    updates.encryptionKey = joinWsData.encryptionKey;
                                    needsUpdate = true;
                                }
                                
                                // Update topicHash if provided
                                if (joinWsData.topicHash && joinWsData.topicHash !== existing.topicHash) {
                                    updates.topicHash = joinWsData.topicHash;
                                    needsUpdate = true;
                                }
                                
                                // Update bootstrapPeers if provided
                                if (joinWsData.bootstrapPeers && Array.isArray(joinWsData.bootstrapPeers)) {
                                    updates.lastKnownPeers = joinWsData.bootstrapPeers.map(pk => ({
                                        publicKey: pk,
                                        lastSeen: Date.now()
                                    }));
                                    needsUpdate = true;
                                }
                                
                                // Update directAddress if provided
                                if (joinWsData.directAddress && joinWsData.directAddress !== existing.directAddress) {
                                    updates.directAddress = joinWsData.directAddress;
                                    needsUpdate = true;
                                }
                                
                                // Upgrade permission if new one is higher
                                if (newLevel > existingLevel) {
                                    updates.myPermission = joinWsData.myPermission;
                                    needsUpdate = true;
                                }
                                
                                if (needsUpdate) {
                                    await saveWorkspaceMetadata(joinWsData.id, updates);
                                    ws.send(JSON.stringify({ type: 'workspace-joined', workspace: updates, upgraded: true }));
                                } else {
                                    ws.send(JSON.stringify({ type: 'workspace-joined', workspace: existing, upgraded: false }));
                                }
                            } else {
                                // New workspace - save with P2P info
                                const wsToSave = { ...joinWsData };
                                if (joinWsData.bootstrapPeers && Array.isArray(joinWsData.bootstrapPeers)) {
                                    wsToSave.lastKnownPeers = joinWsData.bootstrapPeers.map(pk => ({
                                        publicKey: pk,
                                        lastSeen: Date.now()
                                    }));
                                }
                                await saveWorkspaceMetadata(joinWsData.id, wsToSave);
                                ws.send(JSON.stringify({ type: 'workspace-joined', workspace: wsToSave, upgraded: false }));
                            }
                            
                            // --- P2P Connection ---
                            // Join Hyperswarm topic and connect to bootstrap peers
                            // Auto-initialize P2P if needed (joiner may not have initialized yet)
                            if (!p2pInitialized) {
                                console.log('[Sidecar] P2P not initialized, attempting initialization for join...');
                                await initializeP2P(true);
                            }
                            
                            if (p2pInitialized && p2pBridge.isInitialized) {
                                const topicHash = joinWsData.topicHash;
                                const bootstrapPeers = joinWsData.bootstrapPeers;
                                const peerDirectAddress = joinWsData.directAddress;
                                
                                // Log direct address if available (for debugging and potential future direct connections)
                                if (peerDirectAddress) {
                                    console.log(`[Sidecar] Peer direct address: ${peerDirectAddress}`);
                                }
                                
                                if (topicHash) {
                                    try {
                                        await p2pBridge.joinTopic(topicHash);
                                        console.log(`[Sidecar] Joined P2P topic: ${topicHash.slice(0, 16)}...`);
                                        
                                        // Register for Yjs P2P bridging
                                        registerWorkspaceTopic(joinWsData.id, topicHash);
                                    } catch (e) {
                                        console.warn('[Sidecar] Failed to join P2P topic:', e.message);
                                    }
                                }
                                
                                if (bootstrapPeers && Array.isArray(bootstrapPeers)) {
                                    for (const peerKey of bootstrapPeers) {
                                        try {
                                            await p2pBridge.connectToPeer(peerKey);
                                            console.log(`[Sidecar] Connecting to bootstrap peer: ${peerKey.slice(0, 16)}...`);
                                        } catch (e) {
                                            console.warn(`[Sidecar] Failed to connect to peer ${peerKey.slice(0, 16)}:`, e.message);
                                        }
                                    }
                                }
                            }
                        } catch (err) {
                            console.error('[Sidecar] Failed to join workspace:', err);
                            ws.send(JSON.stringify({ type: 'error', message: err.message }));
                        }
                    } else {
                        console.log('[Sidecar] join-workspace: No workspace data provided');
                    }
                    break;
                
                // --- Trash Management ---
                case 'list-trash':
                    if (payload?.workspaceId) {
                        try {
                            const trash = await loadTrashList(payload.workspaceId);
                            ws.send(JSON.stringify({ 
                                type: 'trash-list', 
                                workspaceId: payload.workspaceId,
                                documents: trash.documents,
                                folders: trash.folders
                            }));
                        } catch (err) {
                            console.error('[Sidecar] Failed to list trash:', err);
                            ws.send(JSON.stringify({ type: 'trash-list', documents: [], folders: [], error: err.message }));
                        }
                    }
                    break;
                
                case 'trash-document':
                    if (payload?.document) {
                        try {
                            // Add deletedAt timestamp
                            const trashed = {
                                ...payload.document,
                                deletedAt: Date.now(),
                                deletedBy: payload.deletedBy || null
                            };
                            await saveDocumentMetadata(payload.document.id, trashed);
                            metaWss.clients.forEach(client => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({ type: 'document-trashed', document: trashed }));
                                }
                            });
                        } catch (err) {
                            console.error('[Sidecar] Failed to trash document:', err);
                            ws.send(JSON.stringify({ type: 'error', message: err.message }));
                        }
                    }
                    break;
                
                case 'restore-document':
                    if (payload?.documentId) {
                        try {
                            const doc = await metadataDb.get(`doc:${payload.documentId}`);
                            const restored = { ...doc, deletedAt: null, deletedBy: null };
                            await saveDocumentMetadata(payload.documentId, restored);
                            metaWss.clients.forEach(client => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({ type: 'document-restored', documentId: payload.documentId, document: restored }));
                                }
                            });
                        } catch (err) {
                            console.error('[Sidecar] Failed to restore document:', err);
                            ws.send(JSON.stringify({ type: 'error', message: err.message }));
                        }
                    }
                    break;
                
                case 'purge-document':
                    if (payload?.documentId) {
                        try {
                            await deleteDocumentMetadata(payload.documentId);
                            await deleteDocumentData(payload.documentId);
                            metaWss.clients.forEach(client => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({ type: 'document-purged', documentId: payload.documentId }));
                                }
                            });
                        } catch (err) {
                            console.error('[Sidecar] Failed to purge document:', err);
                            ws.send(JSON.stringify({ type: 'error', message: err.message }));
                        }
                    }
                    break;
                
                case 'restore-folder':
                    if (payload?.folderId) {
                        try {
                            const folder = await metadataDb.get(`folder:${payload.folderId}`);
                            const restored = { ...folder, deletedAt: null, deletedBy: null };
                            await saveFolderMetadata(payload.folderId, restored);
                            metaWss.clients.forEach(client => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({ type: 'folder-restored', folderId: payload.folderId, folder: restored }));
                                }
                            });
                        } catch (err) {
                            console.error('[Sidecar] Failed to restore folder:', err);
                            ws.send(JSON.stringify({ type: 'error', message: err.message }));
                        }
                    }
                    break;
                
                case 'purge-folder':
                    if (payload?.folderId) {
                        try {
                            await metadataDb.del(`folder:${payload.folderId}`);
                            // Also permanently delete documents in this folder
                            const allDocs = await loadDocumentList();
                            for (const doc of allDocs) {
                                if (doc.folderId === payload.folderId) {
                                    await deleteDocumentMetadata(doc.id);
                                    await deleteDocumentData(doc.id);
                                }
                            }
                            metaWss.clients.forEach(client => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({ type: 'folder-purged', folderId: payload.folderId }));
                                }
                            });
                        } catch (err) {
                            console.error('[Sidecar] Failed to purge folder:', err);
                            ws.send(JSON.stringify({ type: 'error', message: err.message }));
                        }
                    }
                    break;
                
                default:
                    // Check if it's a P2P message and route to P2PBridge
                    if (type.startsWith('p2p-') || type.startsWith('mdns-')) {
                        p2pBridge.handleMessage(ws, parsed).catch(err => {
                            console.error('[Sidecar] P2P message error:', err);
                        });
                    } else {
                        console.log(`[Sidecar] Unknown message type: ${type}`);
                    }
            }
        } catch (e) {
            console.error('[Sidecar] Failed to handle metadata message:', e);
        }
    });
    
    ws.on('close', () => {
        console.log('[Sidecar] Metadata client disconnected.');
    });
    
    // Register client with P2P bridge
    p2pBridge.handleClient(ws);
});
console.log(`[Sidecar] Metadata WebSocket server listening on ws://localhost:${METADATA_WEBSOCKET_PORT}`);

// Initialize: Load all document keys from metadata on startup (after servers are ready)
// This is deferred to not block startup - documents will be loaded by the time the client connects
(async function initializeDocumentKeys() {
    try {
        await uint8arraysReady;
        console.log('[Sidecar] Loading document list...');
        const documents = await loadDocumentList();
        console.log(`[Sidecar] Startup: Loaded ${documents.length} documents, ${documentKeys.size} encryption keys`);
    } catch (err) {
        console.error('[Sidecar] Failed to initialize document keys:', err.message);
    }
})();


// --- 4. Main P2P Application Logic ---

// Stop the P2P stack (disconnect Tor and libp2p)
async function stopP2PStack() {
    console.log('[Sidecar] Stopping P2P stack...');
    
    try {
        // Unsubscribe from pubsub topic
        if (p2pNode?.services?.pubsub) {
            try {
                p2pNode.services.pubsub.unsubscribe(PUBSUB_TOPIC);
            } catch (e) {
                console.warn('[Sidecar] Error unsubscribing from pubsub:', e.message);
            }
        }
        
        // Stop libp2p node
        if (p2pNode) {
            try {
                await p2pNode.stop();
            } catch (e) {
                console.warn('[Sidecar] Error stopping p2p node:', e.message);
            }
            p2pNode = null;
        }
        
        // Clear onion address (Tor ephemeral services are cleaned up automatically)
        onionAddress = null;
        fullMultiaddr = null;
        
        isOnline = false;
        connectionStatus = 'offline';
        
        console.log('[Sidecar] P2P stack stopped');
        broadcastStatus();
    } catch (err) {
        console.error('[Sidecar] Error stopping P2P stack:', err);
    }
}

async function startP2PStack() {
    connectionStatus = 'connecting';
    broadcastStatus();
    
    let tor;
    try {
        // Create and connect to Tor control port
        tor = new TorControl({ host: '127.0.0.1', port: TOR_CONTROL_PORT, password: '' });
        
        // Connect and authenticate
        await tor.connect();
        console.log('[Sidecar] Connected to Tor control port');
        
        // Try to authenticate with empty password
        try {
            await tor.sendCommand('AUTHENTICATE ""');
        } catch (err) {
            console.warn('[Sidecar] Tor authentication attempt completed');
        }
        
        const command = `ADD_ONION NEW:BEST Port=80,127.0.0.1:${P2P_PORT} Flags=DiscardPK`;
        const result = await tor.sendCommand(command);
        
        if (!result || typeof result !== 'string' || !result.includes('ServiceID=')) {
            throw new Error(`Failed to create onion service: ${result}`);
        }
        
        onionAddress = result.match(/ServiceID=([^\s]+)/)[1];
        console.log(`[Sidecar] Created onion service: ${onionAddress}.onion`);

        p2pNode = await createLibp2pNode(`${onionAddress}.onion`);
        fullMultiaddr = `/dns4/${onionAddress}.onion/tcp/80/p2p/${p2pNode.peerId.toString()}`;
        
        isOnline = true;
        connectionStatus = 'connected';
        console.log('[Sidecar] P2P Stack is Ready! Invite Multiaddr:', fullMultiaddr);

        // Broadcast updated status to all clients
        broadcastStatus();

        // Handle incoming P2P messages
        p2pNode.services.pubsub.subscribe(PUBSUB_TOPIC);
        p2pNode.services.pubsub.addEventListener('message', async (event) => {
            const rawData = event.detail.data;
            
            // Try to parse as new protocol with document ID
            const parsed = parseP2PMessage(rawData);
            
            if (parsed) {
                // New protocol: message includes document ID
                const { docId, encryptedData } = parsed;
                console.log(`[Sidecar] Received P2P update for doc: ${docId}`);
                
                // Store with document prefix
                await db.put(`${docId}:p2p:${Date.now().toString()}`, encryptedData);
                
                // Get the key for this specific document
                const key = getKeyForDocument(docId);
                if (!key) {
                    console.log(`[Sidecar] No key for P2P document: ${docId}`);
                    return;
                }
                
                const decrypted = decryptUpdate(encryptedData, key);
                if (decrypted) {
                    // Apply only to the correct document
                    const doc = docs.get(docId);
                    if (doc) {
                        Y.applyUpdate(doc, decrypted, 'p2p');
                        console.log(`[Sidecar] Applied P2P update to doc: ${docId}`);
                    } else {
                        console.log(`[Sidecar] Document not loaded: ${docId}`);
                    }
                }
            } else {
                // Legacy protocol: no document ID, apply to all docs (backwards compat)
                console.log('[Sidecar] Received legacy P2P update (no docId)');
                await db.put(`p2p:${Date.now().toString()}`, rawData);

                if (!sessionKey) return;

                const decrypted = decryptUpdate(rawData, sessionKey);
                if (decrypted) {
                    docs.forEach(doc => Y.applyUpdate(doc, decrypted, 'p2p'));
                }
            }
        });
        
    } catch (err) {
        console.error('[Sidecar] Tor/P2P setup failed:', err.message);
        console.log('[Sidecar] Running in OFFLINE mode - local editing only');
        
        isOnline = false;
        connectionStatus = 'offline';
        broadcastStatus();
        
        // Don't exit - the app works fine offline
    }
}

// Monkey-patch the 'docs' map from y-websocket to emit an event when a doc is added.
const originalSet = docs.set;
docs.set = function(key, value) {
    const had = this.has(key);
    const result = originalSet.apply(this, arguments);
    if (!had) {
        docs.emit('doc-added', value, key);
    }
    return result;
};
Object.assign(docs, EventEmitter.prototype);

// Queue of pending updates that arrived before the key was set
const pendingUpdates = new Map(); // docName -> [{ update, origin }]

// When a new document is added, bind persistence to it
docs.on('doc-added', async (doc, docName) => {
    console.log(`[Sidecar] New document added: ${docName}`);
    console.log(`[Sidecar] Doc type: ${doc?.constructor?.name}, has 'on': ${typeof doc?.on}`);
    
    try {
        // Initialize pending queue for this doc
        if (!pendingUpdates.has(docName)) {
            pendingUpdates.set(docName, []);
        }
        
        // Listen for updates and persist them with document name prefix
        const updateHandler = (update, origin) => {
            console.log(`[Sidecar] >>> Update handler fired for ${docName}`);
            // Don't re-persist updates that came from persistence or P2P
            if (origin === 'persistence' || origin === 'p2p') {
                console.log(`[Sidecar] Skipping update with origin: ${origin}`);
                return;
            }
            
            console.log(`[Sidecar] Update received for ${docName}, origin: ${origin}, size: ${update?.length}, hasKey: ${!!getKeyForDocument(docName)}`);
            
            const key = getKeyForDocument(docName);
            if (key) {
                persistUpdate(docName, update, origin);
            } else {
                // Queue the update for when key is available
                console.log(`[Sidecar] Queuing update for ${docName} (no key yet)`);
                pendingUpdates.get(docName).push({ update, origin });
            }
        };
        
        doc.on('update', updateHandler);
        console.log(`[Sidecar] Bound update handler to doc: ${docName}, listener count: ${doc.listenerCount?.('update') || 'N/A'}`);
        
        // If we already have a key for this document, load persisted data immediately
        const key = getKeyForDocument(docName);
        if (key) {
            console.log(`[Sidecar] Loading persisted data for new document: ${docName}`);
            await loadPersistedData(docName, doc, key);
        } else {
            console.log(`[Sidecar] No session key yet for new document: ${docName}`);
        }
    } catch (err) {
        console.error(`[Sidecar] Error in doc-added handler for ${docName}:`, err);
    }
});

// P2P stack is NOT auto-started - use toggle-tor command to enable
console.log('[Sidecar] Running in OFFLINE mode by default. Use toggle-tor to enable P2P.');