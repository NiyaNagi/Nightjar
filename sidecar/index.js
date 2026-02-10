console.log('[Sidecar] Starting up...');
const startTime = Date.now();

// Debug mode - reduces verbose logging in hot paths for better performance
const DEBUG_MODE = process.env.NIGHTJAR_DEBUG === 'true';

// Add global error handlers
process.on('uncaughtException', (error) => {
    console.error('[Sidecar] Uncaught exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Sidecar] Unhandled rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

console.log(`[Sidecar] Loading modules... (${Date.now() - startTime}ms)`);
const WebSocket = require('ws');
const crypto = require('crypto');
// OPTIMIZATION: Lazy-load libp2p since it's slow and rarely needed at startup
// const { createLibp2pNode } = require('../backend/p2p');
let createLibp2pNode = null;
const Y = require('yjs');
const { setupWSConnection, docs, getYDoc } = require('y-websocket/bin/utils');
const { encryptUpdate, decryptUpdate, isValidKey } = require('../backend/crypto');
const { Level } = require('level');
const TorControl = require('tor-control');
const EventEmitter = require('events');
const { P2PBridge } = require('./p2p-bridge');
const { getWorkspaceTopicHex } = require('./mesh-constants');
console.log(`[Sidecar] Core modules loaded (${Date.now() - startTime}ms)`);
const identity = require('./identity');
// OPTIMIZATION: Lazy-load mesh since it creates Hyperswarm at import
let MeshParticipant = null;
const { ensureSSLCert, getCertInfo } = require('./ssl-cert');
// OPTIMIZATION: Lazy-load UPnP - it probes the network at require time
let upnpMapper = null;
function getUPnPMapper() {
  if (!upnpMapper) {
    upnpMapper = require('./upnp-mapper');
  }
  return upnpMapper;
}
const { relayBridge } = require('./relay-bridge');
const https = require('https');

console.log(`[Sidecar] All imports completed (${Date.now() - startTime}ms)`);

// Lazy-load heavy modules in background
let libp2pLoading = null;
let meshLoading = null;

async function ensureLibp2p() {
  if (createLibp2pNode) return createLibp2pNode;
  if (libp2pLoading) return libp2pLoading;
  libp2pLoading = (async () => {
    console.log(`[Sidecar] Lazy-loading libp2p... (${Date.now() - startTime}ms)`);
    const module = require('../backend/p2p');
    createLibp2pNode = module.createLibp2pNode;
    console.log(`[Sidecar] libp2p loaded (${Date.now() - startTime}ms)`);
    return createLibp2pNode;
  })();
  return libp2pLoading;
}

async function ensureMesh() {
  if (MeshParticipant) return MeshParticipant;
  if (meshLoading) return meshLoading;
  meshLoading = (async () => {
    console.log(`[Sidecar] Lazy-loading mesh... (${Date.now() - startTime}ms)`);
    const module = require('./mesh');
    MeshParticipant = module.MeshParticipant;
    console.log(`[Sidecar] Mesh loaded (${Date.now() - startTime}ms)`);
    return MeshParticipant;
  })();
  return meshLoading;
}

// Initialize P2P Bridge for unified P2P layer
const p2pBridge = new P2PBridge();

// Initialize Mesh Participant for global relay mesh network
// Default: enabled, not relay mode (desktop clients only relay through mesh, not act as relays)
let meshParticipant = null;
let meshEnabled = process.env.NIGHTJAR_MESH !== 'false'; // Default enabled, can disable via env

// Enable relay bridge for cross-platform sharing (connects local docs to public relay)
let relayBridgeEnabled = process.env.NIGHTJAR_RELAY_BRIDGE === 'true'; // Default disabled (Electron uses Hyperswarm DHT)

// Track if P2P is initialized with identity
let p2pInitialized = false;

// Native uint8array conversion functions using Node.js Buffer (always available)
// This replaces the ESM-only 'uint8arrays' package which fails in ASAR builds
function uint8ArrayFromString(str, encoding = 'utf8') {
    if (encoding === 'base64') {
        return new Uint8Array(Buffer.from(str, 'base64'));
    }
    return new Uint8Array(Buffer.from(str, encoding));
}

function uint8ArrayToString(arr, encoding = 'utf8') {
    if (encoding === 'base64') {
        return Buffer.from(arr).toString('base64');
    }
    return Buffer.from(arr).toString(encoding);
}

// Mark as always loaded since we use native Buffer
const uint8arraysLoaded = true;

// Legacy function for backwards compatibility - now a no-op since we use native Buffer
async function loadUint8Arrays() {
    return true; // Always available with native Buffer
}

const path = require('path');

// Port configuration - supports environment variables for testing
const YJS_WEBSOCKET_PORT = parseInt(process.env.YJS_WEBSOCKET_PORT, 10) || 8080;
const YJS_WEBSOCKET_SECURE_PORT = parseInt(process.env.YJS_WEBSOCKET_SECURE_PORT, 10) || 8443; // WSS port for HTTPS support
const METADATA_WEBSOCKET_PORT = parseInt(process.env.METADATA_WEBSOCKET_PORT, 10) || 8081;
const TOR_CONTROL_PORT = parseInt(process.env.TOR_CONTROL_PORT, 10) || 9051;
const P2P_PORT = parseInt(process.env.P2P_PORT, 10) || 4001;
const PUBSUB_TOPIC = '/nightjarx/1.0.0';

// WebSocket server instances
let metaWss;
let yjsWss = null;       // Plain WebSocket server
let yjsWssSecure = null; // Secure WebSocket server (WSS)

// UPnP port mapping status
let upnpStatus = {
  enabled: false,
  wsPortMapped: false,
  wssPortMapped: false,
  externalIP: null
};

// Storage path - use userData path from command line if provided (Electron packaged app),
// otherwise fall back to relative path (development mode)
const USER_DATA_PATH = process.argv[2] || '.';
const DB_PATH = path.join(USER_DATA_PATH, 'storage');

// Initialize identity storage path to match sidecar storage
// This ensures identity.json is stored alongside other sidecar data
identity.setBasePath(USER_DATA_PATH);

// Migrate identity from legacy path (~/.Nightjar) to new path if needed
// This is a one-time operation that preserves the legacy file for safety
identity.migrateIdentityIfNeeded();

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

// Database operation timeout (default 30 seconds)
const DB_OPERATION_TIMEOUT_MS = parseInt(process.env.DB_TIMEOUT_MS, 10) || 30000;

/**
 * Wrap a database operation with a timeout to prevent indefinite hangs
 * @param {Promise} operation - The database operation promise
 * @param {string} operationName - Name of the operation for logging
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise} The operation result or throws timeout error
 */
async function withDbTimeout(operation, operationName = 'db operation', timeoutMs = DB_OPERATION_TIMEOUT_MS) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`Database operation '${operationName}' timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });
    
    try {
        const result = await Promise.race([operation, timeoutPromise]);
        clearTimeout(timeoutId);
        return result;
    } catch (err) {
        clearTimeout(timeoutId);
        throw err;
    }
}

// Wait for database to open before proceeding
const dbReady = db.open().then(() => {
    console.log(`[Sidecar] LevelDB opened successfully at ${DB_PATH}`);
    return true;
}).catch(e => {
    if (e.code === 'LEVEL_DATABASE_ALREADY_OPEN') {
        console.log(`[Sidecar] LevelDB already open at ${DB_PATH}`);
        return true;
    }
    console.error('[Sidecar] Failed to open LevelDB:', e);
    throw e;
});

console.log(`[Sidecar] Initializing LevelDB at ${DB_PATH}...`);

// Add logging to the db.open() promise
db.open().then(() => {
    console.log(`[Sidecar] LevelDB opened successfully at ${DB_PATH}`);
    return true;
}).catch(e => {
    if (e.code === 'LEVEL_DATABASE_ALREADY_OPEN') {
        console.log(`[Sidecar] LevelDB already open at ${DB_PATH}`);
        return true;
    }
    console.error('[Sidecar] Failed to open LevelDB:', e);
    throw e;
});

console.log('[Sidecar] Database setup completed, ready to start servers');

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
    const meshStatus = meshParticipant ? meshParticipant.getStatus() : null;
    const statusMessage = JSON.stringify({
        type: 'status',
        status: connectionStatus,
        isOnline: isOnline,
        torEnabled: torEnabled,
        onionAddress: onionAddress ? `${onionAddress}.onion` : null,
        multiaddr: fullMultiaddr,
        peerId: p2pNode ? p2pNode.peerId.toString() : null,
        mesh: meshStatus
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
    if (DEBUG_MODE) console.log(`[Sidecar] persistUpdate called for ${docName}, update size: ${update?.length}, hasKey: ${!!key}`);
    
    if (!key) {
        if (DEBUG_MODE) console.log(`[Sidecar] Cannot persist update - no encryption key for document ${docName}`);
        return;
    }
    
    try {
        // Wait for database to be ready
        await dbReady;
        
        if (DEBUG_MODE) console.log(`[Sidecar] Encrypting update for ${docName}...`);
        const encrypted = encryptUpdate(update, key);
        if (DEBUG_MODE) console.log(`[Sidecar] Encrypted size: ${encrypted?.length}`);
        
        // Use docName as prefix for proper per-document storage
        const dbKey = `${docName}:${Date.now().toString()}`;
        await withDbTimeout(db.put(dbKey, encrypted), `put ${dbKey}`);
        if (DEBUG_MODE) console.log(`[Sidecar] Persisted update for document: ${docName} (${update.length} bytes) with key: ${dbKey}`);
        
        // If P2P is available, broadcast to network with document ID
        if (isOnline && p2pNode && origin !== 'p2p') {
            // Create P2P message with document ID for proper routing
            const p2pMessage = createP2PMessage(docName, encrypted);
            await p2pNode.services.pubsub.publish(PUBSUB_TOPIC, p2pMessage);
            if (DEBUG_MODE) console.log(`[Sidecar] Published update to P2P network for doc: ${docName}`);
        }
    } catch (err) {
        console.error('[Sidecar] Failed to persist update:', err);
    }
}

async function loadPersistedData(docName, doc, key) {
    console.log(`[Sidecar] Loading persisted data for document: ${docName}`);
    
    // Wait for database to be ready
    await dbReady;
    
    console.log(`[Sidecar] DB range query starting for prefix: ${docName}:`);
    let count = 0;
    let errors = 0;
    let orphaned = 0;
    const prefix = `${docName}:`;
    const orphanedKeys = [];
    
    // Use LevelDB range queries (gte/lte) to only scan relevant keys
    // This avoids O(n) full database scan for each document load
    const rangeOptions = {
        gte: prefix,           // Keys >= "docName:"
        lte: `${docName}:\uffff`  // Keys <= "docName:\uffff" (high Unicode char for range end)
    };
    
    // Load document-specific updates using range query
    for await (const [dbKey, value] of db.iterator(rangeOptions)) {
        if (DEBUG_MODE) console.log(`[Sidecar] DB key: ${dbKey}`);
        const decrypted = decryptUpdate(value, key);
        if (decrypted) {
            if (DEBUG_MODE) console.log(`[Sidecar] Decrypted ${decrypted.length} bytes, applying to doc...`);
            try {
                Y.applyUpdate(doc, decrypted, 'persistence');
                count++;
            } catch (e) {
                console.error(`[Sidecar] Failed to apply update ${dbKey}:`, e.message);
                errors++;
            }
        } else {
            if (DEBUG_MODE) console.log(`[Sidecar] Decryption returned null for key: ${dbKey} (wrong key or corrupted)`);
            orphaned++;
            orphanedKeys.push(dbKey);
        }
    }
    
    // Also load legacy data (no colon prefix) and p2p data for backwards compatibility
    // These are less common, so a separate pass is acceptable
    for await (const [dbKey, value] of db.iterator()) {
        const isLegacy = !dbKey.includes(':');
        const isP2P = dbKey.startsWith('p2p:');
        
        // Skip if not legacy or p2p data (already handled above)
        if (!isLegacy && !isP2P) continue;
        
        if (DEBUG_MODE) console.log(`[Sidecar] Legacy/P2P key: ${dbKey}, isLegacy: ${isLegacy}, isP2P: ${isP2P}`);
        const decrypted = decryptUpdate(value, key);
        if (decrypted) {
            if (DEBUG_MODE) console.log(`[Sidecar] Decrypted ${decrypted.length} bytes, applying to doc...`);
            try {
                Y.applyUpdate(doc, decrypted, 'persistence');
                count++;
            } catch (e) {
                console.error(`[Sidecar] Failed to apply update ${dbKey}:`, e.message);
                errors++;
            }
        } else {
            if (DEBUG_MODE) console.log(`[Sidecar] Decryption returned null for key: ${dbKey} (wrong key or corrupted)`);
            orphaned++;
            orphanedKeys.push(dbKey);
        }
    }
    
    console.log(`[Sidecar] Loaded ${count} persisted updates for document: ${docName} (${errors} errors, ${orphaned} orphaned)`);
    
    // Return info about orphaned data for potential cleanup
    return { count, errors, orphaned, orphanedKeys };
}

// --- Document Metadata Storage ---
const METADATA_DB_PATH = path.join(USER_DATA_PATH, 'storage', 'metadata');
let metadataDb;
let metadataDbReady;
try {
    metadataDb = new Level(METADATA_DB_PATH, { valueEncoding: 'json' });
    metadataDbReady = metadataDb.open().then(() => {
        console.log(`[Sidecar] Metadata DB opened successfully at ${METADATA_DB_PATH}`);
        return true;
    }).catch((err) => {
        console.error('[Sidecar] Failed to open metadata DB:', err.message);
        throw err;
    });
} catch (err) {
    console.error('[Sidecar] Failed to create metadata DB:', err.message);
}

// Load all document metadata
async function loadDocumentList() {
    await metadataDbReady;
    
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
                    if (!uint8arraysLoaded) {
                        await loadUint8Arrays();
                    }
                    // Convert base64url to standard base64
                    const base64Key = metadata.encryptionKey.replace(/-/g, '+').replace(/_/g, '/');
                    const keyBytes = uint8ArrayFromString(base64Key, 'base64');
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

// Cleanup orphan documents that have no valid workspaceId
// This prevents old documents from polluting new workspaces
async function cleanupOrphanDocuments() {
    await metadataDbReady;
    console.log('[Sidecar] Checking for orphan documents...');
    
    try {
        // Get all documents and workspaces
        const documents = await loadDocumentList();
        const workspaces = await loadWorkspaceListInternal();
        const validWorkspaceIds = new Set(workspaces.map(w => w.id));
        
        let deletedCount = 0;
        for (const doc of documents) {
            // Delete documents with no workspaceId or workspaceId that doesn't exist
            if (!doc.workspaceId || !validWorkspaceIds.has(doc.workspaceId)) {
                await metadataDb.del(`doc:${doc.id}`);
                console.log(`[Sidecar] Deleted orphan document: ${doc.id} (${doc.name}) - workspace: ${doc.workspaceId || 'none'}`);
                deletedCount++;
            }
        }
        
        if (deletedCount > 0) {
            console.log(`[Sidecar] Cleaned up ${deletedCount} orphan documents`);
        } else {
            console.log('[Sidecar] No orphan documents found');
        }
    } catch (err) {
        console.error('[Sidecar] Error cleaning up orphan documents:', err.message);
    }
}

// Internal version of loadWorkspaceList that doesn't filter by identity
// Used for orphan cleanup
async function loadWorkspaceListInternal() {
    await metadataDbReady;
    const workspaces = [];
    try {
        for await (const [key, value] of metadataDb.iterator()) {
            if (key.startsWith('workspace:')) {
                workspaces.push(value);
            }
        }
    } catch (err) {
        console.error('[Sidecar] Error loading workspace list:', err);
    }
    return workspaces;
}

// Save document metadata
async function saveDocumentMetadata(docId, metadata) {
    await metadataDbReady;
    
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
    await metadataDbReady;
    
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
    await withDbTimeout(dbReady, 'dbReady for delete');
    
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
            await withDbTimeout(db.del(key), `del ${key}`);
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
    await metadataDbReady;
    
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
    await metadataDbReady;
    
    try {
        await metadataDb.put(`folder:${folderId}`, metadata);
        console.log(`[Sidecar] Saved metadata for folder: ${folderId}`);
    } catch (err) {
        console.error('[Sidecar] Failed to save folder metadata:', err);
        throw err;
    }
}

// Delete folder metadata
async function deleteFolderMetadata(folderId) {
    await metadataDbReady;
    
    try {
        await metadataDb.del(`folder:${folderId}`);
        console.log(`[Sidecar] Deleted metadata for folder: ${folderId}`);
    } catch (err) {
        if (err.code === 'LEVEL_NOT_FOUND') {
            console.log(`[Sidecar] Folder ${folderId} already deleted or not found`);
            return;
        }
        console.error('[Sidecar] Failed to delete folder metadata:', err);
        throw err;
    }
}

// --- Yjs Folder Sync Functions ---
// These ensure folder changes in LevelDB are also synced to Yjs for P2P sharing

// Add folder to Yjs workspace-meta doc
function addFolderToYjs(workspaceId, folder) {
    const roomName = `workspace-meta:${workspaceId}`;
    const doc = docs.get(roomName);
    
    if (!doc) {
        console.log(`[Sidecar] Yjs doc not found for folder sync: ${roomName}`);
        return false;
    }
    
    try {
        const yFolders = doc.getArray('folders');
        
        // Check if folder already exists
        const existing = yFolders.toArray().find(f => f.id === folder.id);
        if (existing) {
            console.log(`[Sidecar] Folder ${folder.id} already in Yjs, skipping add`);
            return true;
        }
        
        yFolders.push([folder]);
        console.log(`[Sidecar] Added folder ${folder.id} to Yjs for P2P sync`);
        return true;
    } catch (err) {
        console.error(`[Sidecar] Failed to add folder to Yjs:`, err);
        return false;
    }
}

// Update folder in Yjs workspace-meta doc
function updateFolderInYjs(workspaceId, folder) {
    const roomName = `workspace-meta:${workspaceId}`;
    const doc = docs.get(roomName);
    
    if (!doc) {
        console.log(`[Sidecar] Yjs doc not found for folder update: ${roomName}`);
        return false;
    }
    
    try {
        const yFolders = doc.getArray('folders');
        const folders = yFolders.toArray();
        const index = folders.findIndex(f => f.id === folder.id);
        
        if (index === -1) {
            // Folder not found, add it
            yFolders.push([folder]);
            console.log(`[Sidecar] Folder ${folder.id} not found, added to Yjs`);
            return true;
        }
        
        // Update by removing and re-adding at same position
        doc.transact(() => {
            yFolders.delete(index, 1);
            yFolders.insert(index, [folder]);
        });
        console.log(`[Sidecar] Updated folder ${folder.id} in Yjs for P2P sync`);
        return true;
    } catch (err) {
        console.error(`[Sidecar] Failed to update folder in Yjs:`, err);
        return false;
    }
}

// Remove folder from Yjs workspace-meta doc
function removeFolderFromYjs(workspaceId, folderId) {
    const roomName = `workspace-meta:${workspaceId}`;
    const doc = docs.get(roomName);
    
    if (!doc) {
        console.log(`[Sidecar] Yjs doc not found for folder removal: ${roomName}`);
        return false;
    }
    
    try {
        const yFolders = doc.getArray('folders');
        const folders = yFolders.toArray();
        const index = folders.findIndex(f => f.id === folderId);
        
        if (index === -1) {
            console.log(`[Sidecar] Folder ${folderId} not found in Yjs`);
            return true; // Not an error, folder already removed
        }
        
        yFolders.delete(index, 1);
        console.log(`[Sidecar] Removed folder ${folderId} from Yjs for P2P sync`);
        return true;
    } catch (err) {
        console.error(`[Sidecar] Failed to remove folder from Yjs:`, err);
        return false;
    }
}

// --- P2P Sync Metadata Persistence ---
// CRITICAL: Persist document/folder/workspace metadata from Yjs to LevelDB
// This enables invitees to broadcast updates back to owner by having workspace context
async function persistMetadataFromYjs(workspaceId, metaDoc) {
    console.log(`[P2P-SYNC-PERSIST] ========== PERSISTING METADATA ==========`);
    console.log(`[P2P-SYNC-PERSIST] Workspace: ${workspaceId.slice(0, 16)}...`);
    
    try {
        // 1. Persist document metadata
        const yDocuments = metaDoc.getArray('documents');
        const documents = yDocuments.toArray();
        let docsPersisted = 0;
        
        for (const docMeta of documents) {
            if (docMeta && docMeta.id) {
                // Build metadata object for LevelDB
                const metadata = {
                    id: docMeta.id,
                    name: docMeta.name || 'Untitled',
                    type: docMeta.type || 'text',
                    workspaceId: workspaceId,
                    createdAt: docMeta.createdAt || Date.now(),
                    updatedAt: docMeta.updatedAt || Date.now(),
                    parentId: docMeta.parentId || null,
                };
                
                // Include encryption key if present (critical for persistence)
                if (docMeta.encryptionKey) {
                    metadata.encryptionKey = docMeta.encryptionKey;
                    
                    // Also register the key in memory for immediate use
                    try {
                        if (!uint8arraysLoaded) {
                            await loadUint8Arrays();
                        }
                        const base64Key = docMeta.encryptionKey.replace(/-/g, '+').replace(/_/g, '/');
                        const keyBytes = uint8ArrayFromString(base64Key, 'base64');
                        documentKeys.set(docMeta.id, keyBytes);
                        console.log(`[P2P-SYNC-PERSIST] Registered key for document: ${docMeta.id}`);
                    } catch (keyErr) {
                        console.error(`[P2P-SYNC-PERSIST] Failed to register key for ${docMeta.id}:`, keyErr.message);
                    }
                }
                
                await saveDocumentMetadata(docMeta.id, metadata);
                docsPersisted++;
            }
        }
        console.log(`[P2P-SYNC-PERSIST] ✓ Persisted ${docsPersisted} documents to LevelDB`);
        
        // 2. Persist folder metadata
        const yFolders = metaDoc.getArray('folders');
        const folders = yFolders.toArray();
        let foldersPersisted = 0;
        
        for (const folder of folders) {
            if (folder && folder.id) {
                const folderMeta = {
                    id: folder.id,
                    name: folder.name || 'Untitled Folder',
                    workspaceId: workspaceId,
                    parentId: folder.parentId || null,
                    createdAt: folder.createdAt || Date.now(),
                };
                await saveFolderMetadata(folder.id, folderMeta);
                foldersPersisted++;
            }
        }
        console.log(`[P2P-SYNC-PERSIST] ✓ Persisted ${foldersPersisted} folders to LevelDB`);
        
        // 3. Update workspace name from Yjs if present
        const yInfo = metaDoc.getMap('info');
        const syncedName = yInfo.get('name');
        if (syncedName && typeof syncedName === 'string') {
            try {
                const existing = await loadWorkspaceMetadata(workspaceId);
                if (existing) {
                    // Only update if name differs and is not default
                    if (existing.name !== syncedName && syncedName !== 'Shared Workspace') {
                        existing.name = syncedName;
                        await saveWorkspaceMetadata(workspaceId, existing);
                        console.log(`[P2P-SYNC-PERSIST] ✓ Updated workspace name to: ${syncedName}`);
                    }
                }
            } catch (wsErr) {
                console.error(`[P2P-SYNC-PERSIST] Failed to update workspace name:`, wsErr.message);
            }
        }
        
        // 4. Persist document-folder mappings if present
        const yDocumentFolders = metaDoc.getMap('documentFolders');
        if (yDocumentFolders) {
            const mappings = yDocumentFolders.toJSON();
            for (const [docId, folderId] of Object.entries(mappings)) {
                // Update the document's parentId in metadata
                try {
                    const key = `doc:${docId}`;
                    const docMeta = await metadataDb.get(key);
                    if (docMeta && docMeta.parentId !== folderId) {
                        docMeta.parentId = folderId;
                        await metadataDb.put(key, docMeta);
                        console.log(`[P2P-SYNC-PERSIST] Updated document ${docId} parentId to ${folderId}`);
                    }
                } catch (e) {
                    // Document may not exist yet, ignore
                }
            }
        }
        
        console.log(`[P2P-SYNC-PERSIST] ==========================================`);
    } catch (err) {
        console.error(`[P2P-SYNC-PERSIST] ✗ Error persisting metadata:`, err.message);
        console.log(`[P2P-SYNC-PERSIST] ==========================================`);
    }
}

// --- Document Workspace Lookup ---
// Find which workspace a document belongs to
// First checks LevelDB metadata, then falls back to in-memory Yjs docs
// This is critical for invitees who may not have persisted metadata yet
async function findWorkspaceForDocument(docId) {
    // 1. Try LevelDB metadata first (fast path for owners and persisted invitees)
    try {
        const documents = await loadDocumentList();
        const docMeta = documents.find(d => d.id === docId);
        if (docMeta && docMeta.workspaceId) {
            console.log(`[Sidecar] Found workspace for ${docId} in LevelDB: ${docMeta.workspaceId.slice(0, 8)}...`);
            return { workspaceId: docMeta.workspaceId, source: 'leveldb' };
        }
    } catch (err) {
        console.warn(`[Sidecar] LevelDB lookup failed for ${docId}:`, err.message);
    }
    
    // 2. Fallback: Search in-memory Yjs workspace-meta docs
    // This handles the case where invitee has synced via P2P but metadata not yet persisted
    for (const [roomName, metaDoc] of docs.entries()) {
        if (!roomName.startsWith('workspace-meta:')) continue;
        
        try {
            const yDocuments = metaDoc.getArray('documents');
            const documents = yDocuments.toArray();
            const found = documents.find(d => d.id === docId);
            
            if (found) {
                const workspaceId = roomName.replace('workspace-meta:', '');
                console.log(`[Sidecar] Found workspace for ${docId} in Yjs: ${workspaceId.slice(0, 8)}...`);
                
                // Also persist the document metadata now that we found it
                const metadata = {
                    id: docId,
                    name: found.name || 'Untitled',
                    type: found.type || 'text',
                    workspaceId: workspaceId,
                    createdAt: found.createdAt || Date.now(),
                    updatedAt: found.updatedAt || Date.now(),
                    parentId: found.parentId || null,
                };
                if (found.encryptionKey) {
                    metadata.encryptionKey = found.encryptionKey;
                }
                await saveDocumentMetadata(docId, metadata);
                
                return { workspaceId, source: 'yjs' };
            }
        } catch (err) {
            // Continue searching other workspaces
        }
    }
    
    console.log(`[Sidecar] No workspace found for document ${docId}`);
    return null;
}

// --- Workspace Metadata Functions ---

// Load all workspaces
async function loadWorkspaceList() {
    await metadataDbReady;
    
    // Get current identity's public key to filter workspaces
    const currentIdentity = identity.loadIdentity();
    const currentPublicKey = currentIdentity?.publicKeyBase62;
    
    // SECURITY: If no identity is loaded, return empty list to prevent data exposure
    if (!currentIdentity || !currentPublicKey) {
        console.log('[Sidecar] No identity loaded - returning empty workspace list for security');
        return [];
    }
    
    const workspaces = [];
    console.log('[Sidecar] Loading workspace list...');
    console.log('[Sidecar] Current identity public key:', currentPublicKey);
    try {
        for await (const [key, value] of metadataDb.iterator()) {
            console.log(`[Sidecar] DB key: ${key}`);
            if (key.startsWith('workspace:')) {
                // Determine the owner of this workspace
                // Check multiple fields for compatibility: ownerPublicKey, owners[0], createdBy
                const workspaceOwner = value?.ownerPublicKey || value?.owners?.[0] || value?.createdBy;
                // For joined workspaces, check if this identity joined it
                const joinedByMe = value?.joinedBy === currentPublicKey;
                
                console.log(`[Sidecar] Found workspace: ${value?.name || value?.id}, owner: ${workspaceOwner}, joinedBy: ${value?.joinedBy}`);
                
                // Include workspace if:
                // 1. Current identity owns it (created it)
                // 2. Current identity joined it
                // 3. Legacy workspace with no owner info (backward compatibility - very old workspaces)
                // NOTE: We removed the "local-user" legacy fallback as it incorrectly showed
                // old workspaces to newly created identities after factory reset
                const isOwner = workspaceOwner === currentPublicKey;
                const isLegacy = !workspaceOwner && !value?.joinedBy;
                
                if (isOwner || joinedByMe || isLegacy) {
                    workspaces.push(value);
                    
                    // Preload encryption key for workspace-meta document if available
                    // This ensures cross-platform shared workspaces can decrypt their data
                    if (value.encryptionKey) {
                        try {
                            // Ensure uint8arrays is loaded before using
                            if (!uint8arraysLoaded) {
                                await loadUint8Arrays();
                            }
                            // Convert base64url to standard base64
                            const base64Key = value.encryptionKey.replace(/-/g, '+').replace(/_/g, '/');
                            const keyBytes = uint8ArrayFromString(base64Key, 'base64');
                            const workspaceMetaDocName = `workspace-meta:${value.id}`;
                            documentKeys.set(workspaceMetaDocName, keyBytes);
                            console.log(`[Sidecar] Loaded encryption key for workspace-meta: ${value.id}`);
                            
                            // Also load key for workspace-folders room
                            const workspaceFoldersDocName = `workspace-folders:${value.id}`;
                            documentKeys.set(workspaceFoldersDocName, keyBytes);
                        } catch (e) {
                            console.error(`[Sidecar] Failed to load key for workspace ${value.id}:`, e.message);
                        }
                    }
                } else {
                    console.log(`[Sidecar] Skipping workspace - belongs to different identity (owner: ${workspaceOwner}, joined: ${value?.joinedBy})`);
                }
            }
        }
    } catch (err) {
        console.error('[Sidecar] Error loading workspaces:', err);
    }
    console.log(`[Sidecar] Loaded ${workspaces.length} workspaces for current identity`);
    return workspaces;
}

// Migrate workspaces to remove fake relay URLs
async function migrateWorkspaceServerUrls() {
    await metadataDbReady;
    
    const fakeRelayPatterns = [
        'relay1.nightjar.io',
        'relay2.nightjar.io',
        'relay3.nightjar.io'
    ];
    
    let migrationCount = 0;
    
    try {
        for await (const [key, value] of metadataDb.iterator()) {
            if (key.startsWith('workspace:')) {
                let needsUpdate = false;
                
                // Check if serverUrl contains fake relay
                if (value.serverUrl) {
                    for (const fakeRelay of fakeRelayPatterns) {
                        if (value.serverUrl.includes(fakeRelay)) {
                            console.log(`[Sidecar] Migration: Removing fake relay URL from workspace ${value.id}: ${value.serverUrl}`);
                            delete value.serverUrl;
                            needsUpdate = true;
                            break;
                        }
                    }
                }
                
                // Check if relayNodes contains fake relays
                if (value.relayNodes && Array.isArray(value.relayNodes)) {
                    const cleanedNodes = value.relayNodes.filter(node => {
                        for (const fakeRelay of fakeRelayPatterns) {
                            if (node.includes(fakeRelay)) {
                                console.log(`[Sidecar] Migration: Removing fake relay node from workspace ${value.id}: ${node}`);
                                return false;
                            }
                        }
                        return true;
                    });
                    
                    if (cleanedNodes.length !== value.relayNodes.length) {
                        value.relayNodes = cleanedNodes;
                        needsUpdate = true;
                    }
                }
                
                if (needsUpdate) {
                    await metadataDb.put(key, value);
                    migrationCount++;
                    console.log(`[Sidecar] Migration: Updated workspace ${value.id}`);
                }
            }
        }
        
        if (migrationCount > 0) {
            console.log(`[Sidecar] Migration complete: Cleaned ${migrationCount} workspace(s)`);
        }
    } catch (err) {
        console.error('[Sidecar] Migration error:', err);
    }
}

// Save workspace metadata
async function saveWorkspaceMetadata(workspaceId, metadata) {
    await metadataDbReady;
    
    try {
        const key = `workspace:${workspaceId}`;
        console.log(`[Sidecar] Saving workspace with key: ${key}`);
        
        // Ensure ownerPublicKey is set for proper identity filtering
        // For created workspaces, use owners[0] or createdBy if ownerPublicKey not set
        if (!metadata.ownerPublicKey && !metadata.joinedBy) {
            metadata.ownerPublicKey = metadata.owners?.[0] || metadata.createdBy;
            console.log(`[Sidecar] Set ownerPublicKey from owners/createdBy: ${metadata.ownerPublicKey}`);
        }
        
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

// Load single workspace metadata by ID
async function loadWorkspaceMetadata(workspaceId) {
    await metadataDbReady;
    
    try {
        const key = `workspace:${workspaceId}`;
        const workspace = await metadataDb.get(key);
        return workspace;
    } catch (err) {
        if (err.code === 'LEVEL_NOT_FOUND') {
            return null;
        }
        console.error('[Sidecar] Failed to load workspace metadata:', err);
        throw err;
    }
}

// Delete workspace metadata AND all associated data (folders, documents, keys)
async function deleteWorkspaceMetadata(workspaceId) {
    await metadataDbReady;
    
    try {
        console.log(`[Sidecar] Deleting workspace ${workspaceId} and all associated data...`);
        
        // 1. Find and delete all folders in this workspace
        const foldersToDelete = [];
        for await (const [key, value] of metadataDb.iterator()) {
            if (key.startsWith('folder:') && value.workspaceId === workspaceId) {
                foldersToDelete.push(key);
            }
        }
        
        // 2. Find and delete all documents in those folders (and workspace)
        const docsToDelete = [];
        for await (const [key, value] of metadataDb.iterator()) {
            if (key.startsWith('doc:')) {
                // Check if doc belongs to this workspace directly or via folder
                if (value.workspaceId === workspaceId) {
                    docsToDelete.push(key);
                } else if (value.folderId) {
                    const folderKey = `folder:${value.folderId}`;
                    if (foldersToDelete.includes(folderKey)) {
                        docsToDelete.push(key);
                    }
                }
            }
        }
        
        // 3. Delete Yjs document data from main db
        for (const docKey of docsToDelete) {
            const docId = docKey.slice(4); // Remove 'doc:' prefix
            try {
                // Delete all updates for this document
                for await (const [key] of db.iterator()) {
                    if (key.startsWith(`${docId}:`)) {
                        await db.del(key);
                    }
                }
                console.log(`[Sidecar] Deleted Yjs data for document: ${docId}`);
            } catch (e) {
                // Document might not have Yjs data
            }
        }
        
        // 4. Delete document metadata
        for (const key of docsToDelete) {
            await metadataDb.del(key);
            const docId = key.slice(4);
            console.log(`[Sidecar] Deleted document metadata: ${docId}`);
            
            // Also remove from documentKeys map if present
            documentKeys.delete(docId);
        }
        
        // 5. Delete folder metadata
        for (const key of foldersToDelete) {
            await metadataDb.del(key);
            console.log(`[Sidecar] Deleted folder: ${key}`);
        }
        
        // 6. Remove workspace-meta encryption key
        const workspaceMetaDocName = `workspace-meta:${workspaceId}`;
        documentKeys.delete(workspaceMetaDocName);
        console.log(`[Sidecar] Removed encryption key for: ${workspaceMetaDocName}`);
        
        // 7. Delete workspace metadata itself
        await metadataDb.del(`workspace:${workspaceId}`);
        
        console.log(`[Sidecar] Deleted workspace ${workspaceId}: ${foldersToDelete.length} folders, ${docsToDelete.length} documents`);
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
    await metadataDbReady;
    
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
    await metadataDbReady;
    
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

// --- Relay Server Validation ---
/**
 * Validate that a relay server URL is running and accessible
 * @param {string} serverUrl - The URL to validate (e.g., "http://123.45.67.89")
 * @returns {Promise<boolean>} True if server is valid and reachable
 */
async function validateRelayServer(serverUrl) {
    try {
        // Parse the URL to extract host
        const url = new URL(serverUrl);
        
        // Simple HTTP check - try to connect to the server
        // In a real implementation, you'd want to check for specific Hyperswarm/DHT responses
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(serverUrl, {
            method: 'HEAD',
            timeout: 5000,
        });
        
        // Consider 200-299 or 404 (no route) as "server exists"
        // 404 is ok because we're just checking if the server is running
        return response.status < 500;
    } catch (err) {
        console.error('[Sidecar] Relay server validation failed:', err.message);
        return false;
    }
}

// --- Metadata Message Handler ---
// Centralized handler for all metadata WebSocket messages
async function handleMetadataMessage(ws, parsed) {
    // uint8arrays is loaded at startup, no need to check here
    if (!uint8ArrayFromString) {
        throw new Error('uint8arrays module not loaded at startup');
    }
    
    const { type, payload, document, docId, metadata, docName, workspace, folder, workspaceId, folderId, updates } = parsed;
    
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
                        console.log(`[Sidecar] Doc exists for ${sanitizedDocName}, loading persisted data now...`);
                        const doc = docs.get(sanitizedDocName);
                        const result = await loadPersistedData(sanitizedDocName, doc, key);
                        console.log(`[Sidecar] Loaded persisted data result:`, result);
                    } else {
                        console.log(`[Sidecar] Doc does not exist yet for ${sanitizedDocName}, will load when created`);
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
            // Documents are workspace-scoped - filter by workspaceId if provided
            const listDocsWsId = workspaceId || parsed.payload?.workspaceId;
            let allDocuments = await loadDocumentList();
            let filteredDocuments = allDocuments;
            if (listDocsWsId) {
                filteredDocuments = allDocuments.filter(d => d.workspaceId === listDocsWsId);
                console.log(`[Sidecar] Filtered to ${filteredDocuments.length} documents for workspace: ${listDocsWsId}`);
            } else {
                console.log(`[Sidecar] Returning all ${allDocuments.length} documents (no workspace filter)`);
            }
            ws.send(JSON.stringify({ type: 'document-list', documents: filteredDocuments }));
            break;
        
        case 'toggle-tor':
            const enable = payload?.enable ?? !torEnabled;
            console.log(`[Sidecar] Toggle Tor: ${enable ? 'enabling' : 'disabling'}`);
            
            if (enable && !torEnabled) {
                torEnabled = true;
                // P2P is now always on, tor just affects how we connect
            } else if (!enable && torEnabled) {
                torEnabled = false;
            }
            
            // Send confirmation
            ws.send(JSON.stringify({ 
                type: 'tor-toggled', 
                enabled: torEnabled,
                status: connectionStatus
            }));
            break;
        
        case 'get-status':
            const statusMesh = meshParticipant ? meshParticipant.getStatus() : null;
            ws.send(JSON.stringify({
                type: 'status',
                status: connectionStatus,
                isOnline: isOnline,
                torEnabled: torEnabled,
                onionAddress: onionAddress ? `${onionAddress}.onion` : null,
                multiaddr: fullMultiaddr,
                peerId: p2pNode ? p2pNode.peerId.toString() : null,
                mesh: statusMesh
            }));
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
            const wsData = workspace || parsed.payload?.workspace;
            console.log('[Sidecar] create-workspace received:', wsData?.id, wsData?.name);
            if (wsData) {
                try {
                    // Ensure ownerPublicKey is set to current identity's public key
                    // This is critical for workspace filtering on restart
                    const creatorIdentity = identity.loadIdentity();
                    if (creatorIdentity?.publicKeyBase62) {
                        wsData.ownerPublicKey = creatorIdentity.publicKeyBase62;
                        console.log(`[Sidecar] Set ownerPublicKey to current identity: ${creatorIdentity.publicKeyBase62.slice(0, 16)}...`);
                    }
                    
                    await saveWorkspaceMetadata(wsData.id, wsData);
                    console.log('[Sidecar] Workspace saved successfully');
                    
                    // Register encryption key for workspace-meta documents
                    if (wsData.encryptionKey) {
                        try {
                            if (!uint8arraysLoaded) await loadUint8Arrays();
                            // Convert base64url to standard base64
                            const base64Key = wsData.encryptionKey.replace(/-/g, '+').replace(/_/g, '/');
                            const keyBytes = uint8ArrayFromString(base64Key, 'base64');
                            documentKeys.set(`workspace-meta:${wsData.id}`, keyBytes);
                            documentKeys.set(`workspace-folders:${wsData.id}`, keyBytes);
                            console.log(`[Sidecar] Registered encryption key for created workspace-meta: ${wsData.id}`);
                        } catch (e) {
                            console.error(`[Sidecar] Failed to register key for workspace ${wsData.id}:`, e.message);
                        }
                    }
                    
                    // Auto-initialize P2P if needed and join topic
                    if (!p2pInitialized && wsData.topicHash) {
                        console.log('[Sidecar] P2P not initialized, attempting initialization for workspace creation...');
                        await initializeP2P(true);
                    }
                    
                    // Join the workspace topic for P2P discovery
                    if (p2pInitialized && wsData.topicHash) {
                        try {
                            console.log('[Sidecar] Joining Hyperswarm topic for new workspace:', wsData.topicHash?.slice(0, 16));
                            await p2pBridge.joinTopic(wsData.topicHash);
                            console.log('[Sidecar] Successfully joined workspace topic');
                            
                            // Register for Yjs P2P bridging - CRITICAL for responding to sync requests
                            registerWorkspaceTopic(wsData.id, wsData.topicHash);
                            console.log('[Sidecar] ✓ Registered workspace topic for P2P bridging');
                        } catch (joinErr) {
                            console.error('[Sidecar] Failed to join workspace topic:', joinErr);
                        }
                    }
                    
                    ws.send(JSON.stringify({ type: 'workspace-created', workspace: wsData }));
                } catch (err) {
                    console.error('[Sidecar] Failed to create workspace:', err);
                    ws.send(JSON.stringify({ type: 'error', message: err.message }));
                }
            }
            break;
        
        case 'update-workspace':
            const updateWsData = workspace || parsed.payload?.workspace;
            const updateWsId = workspaceId || parsed.payload?.workspaceId;
            const partialUpdates = updates || parsed.payload?.updates;
            
            try {
                if (updateWsData) {
                    // Full workspace object provided - merge with existing to preserve fields like joinedBy
                    const existing = await loadWorkspaceMetadata(updateWsData.id);
                    const merged = { ...existing, ...updateWsData };
                    await saveWorkspaceMetadata(updateWsData.id, merged);
                    ws.send(JSON.stringify({ type: 'workspace-updated', workspace: merged }));
                } else if (updateWsId && partialUpdates) {
                    // Partial update via workspaceId + updates
                    const existing = await loadWorkspaceMetadata(updateWsId);
                    if (!existing) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Workspace not found' }));
                        break;
                    }
                    const merged = { ...existing, ...partialUpdates };
                    await saveWorkspaceMetadata(updateWsId, merged);
                    ws.send(JSON.stringify({ type: 'workspace-updated', workspace: merged }));
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: 'No workspace data provided' }));
                }
            } catch (err) {
                console.error('[Sidecar] Failed to update workspace:', err);
                ws.send(JSON.stringify({ type: 'error', message: err.message }));
            }
            break;
        
        case 'delete-workspace':
            const deleteWsId = workspaceId || parsed.payload?.workspaceId;
            if (deleteWsId) {
                try {
                    await deleteWorkspaceMetadata(deleteWsId);
                    ws.send(JSON.stringify({ type: 'workspace-deleted', workspaceId: deleteWsId }));
                } catch (err) {
                    console.error('[Sidecar] Failed to delete workspace:', err);
                    ws.send(JSON.stringify({ type: 'error', message: err.message }));
                }
            }
            break;
        
        case 'join-workspace':
            // Join an existing workspace (from share link)
            const joinWsData = workspace || parsed.payload?.workspace;
            if (joinWsData) {
                try {
                    console.log('[Sidecar] join-workspace: Processing workspace', joinWsData.id);
                    
                    // Get current identity to track who joined this workspace
                    const joiningIdentity = identity.loadIdentity();
                    if (joiningIdentity?.publicKeyBase62) {
                        joinWsData.joinedBy = joiningIdentity.publicKeyBase62;
                        console.log(`[Sidecar] join-workspace: Marked as joined by ${joiningIdentity.publicKeyBase62.slice(0, 16)}...`);
                    }
                    
                    // Save or update workspace metadata
                    await saveWorkspaceMetadata(joinWsData.id, joinWsData);
                    
                    // Register encryption key immediately for workspace-meta documents
                    // This ensures we can decrypt data synced from other platforms
                    if (joinWsData.encryptionKey) {
                        try {
                            if (!uint8arraysLoaded) {
                                await loadUint8Arrays();
                            }
                            // Convert base64url to standard base64 (frontend stores keys as base64url)
                            const base64Key = joinWsData.encryptionKey
                                .replace(/-/g, '+')
                                .replace(/_/g, '/');
                            const keyBytes = uint8ArrayFromString(base64Key, 'base64');
                            const workspaceMetaDocName = `workspace-meta:${joinWsData.id}`;
                            documentKeys.set(workspaceMetaDocName, keyBytes);
                            console.log(`[Sidecar] Registered encryption key for joined workspace-meta: ${joinWsData.id}`);
                            
                            // Also register for workspace-folders room
                            const workspaceFoldersDocName = `workspace-folders:${joinWsData.id}`;
                            documentKeys.set(workspaceFoldersDocName, keyBytes);
                        } catch (e) {
                            console.error(`[Sidecar] Failed to register key for joined workspace ${joinWsData.id}:`, e.message);
                        }
                    }
                    
                    // --- P2P Connection ---
                    // Auto-initialize P2P if needed (joiner may not have initialized yet)
                    if (!p2pInitialized) {
                        console.log('[Sidecar] P2P not initialized, attempting initialization for join...');
                        await initializeP2P(true);
                    }
                    
                    console.log('[Sidecar] join-workspace: P2P initialized:', p2pInitialized, ', P2P Bridge initialized:', p2pBridge.isInitialized);
                    
                    if (p2pInitialized && p2pBridge.isInitialized) {
                        const topicHash = joinWsData.topicHash;
                        const bootstrapPeers = joinWsData.bootstrapPeers;
                        const peerDirectAddress = joinWsData.directAddress;
                        
                        console.log('[Sidecar] join-workspace: topicHash:', topicHash ? topicHash.slice(0, 16) + '...' : 'MISSING');
                        console.log('[Sidecar] join-workspace: bootstrapPeers:', bootstrapPeers);
                        console.log('[Sidecar] join-workspace: directAddress:', peerDirectAddress);
                        
                        // Log direct address if available (for debugging and potential future direct connections)
                        if (peerDirectAddress) {
                            console.log(`[Sidecar] Peer direct address: ${peerDirectAddress}`);
                        }
                        
                        // Join the topic for P2P discovery
                        if (topicHash) {
                            try {
                                // CRITICAL: Register topic BEFORE joining to avoid race condition
                                // where P2P messages arrive before topicToWorkspace is populated
                                registerWorkspaceTopic(joinWsData.id, topicHash);
                                console.log(`[Sidecar] Pre-registered workspace topic for P2P bridging`);
                                
                                console.log(`[Sidecar] Attempting to join P2P topic: ${topicHash.slice(0, 16)}...`);
                                await p2pBridge.joinTopic(topicHash);
                                console.log(`[Sidecar] Successfully joined P2P topic: ${topicHash.slice(0, 16)}...`);
                            } catch (e) {
                                console.error('[Sidecar] Failed to join P2P topic:', e.message);
                            }
                        } else {
                            console.warn('[Sidecar] No topicHash provided - P2P sync will not work!');
                        }
                        
                        // Connect to bootstrap peers
                        if (bootstrapPeers && Array.isArray(bootstrapPeers) && bootstrapPeers.length > 0) {
                            console.log(`[Sidecar] Connecting to ${bootstrapPeers.length} bootstrap peer(s)...`);
                            for (const peerKey of bootstrapPeers) {
                                try {
                                    console.log(`[Sidecar] Attempting to connect to peer: ${peerKey.slice(0, 16)}...`);
                                    // Queue sync for after identity verification
                                    if (topicHash) {
                                        let pendingTopics = pendingSyncRequests.get(peerKey);
                                        if (!pendingTopics) {
                                            pendingTopics = new Set();
                                            pendingSyncRequests.set(peerKey, pendingTopics);
                                        }
                                        pendingTopics.add(topicHash);
                                        console.log(`[Sidecar] Queued sync-request for ${peerKey.slice(0, 16)}...`);
                                    }
                                    await p2pBridge.connectToPeer(peerKey);
                                    console.log(`[Sidecar] âœ“ Connected to bootstrap peer: ${peerKey.slice(0, 16)}...`);
                                } catch (e) {
                                    console.error(`[Sidecar] âœ— Failed to connect to peer ${peerKey.slice(0, 16)}:`, e.message);
                                }
                            }
                            
                            // Try immediate sync for peers that might already be connected
                            // (e.g., from DHT discovery happening before join-workspace)
                            if (topicHash && p2pBridge.hyperswarm) {
                                setTimeout(() => {
                                    for (const peerKey of bootstrapPeers) {
                                        const conn = p2pBridge.hyperswarm.connections.get(peerKey);
                                        if (conn && conn.authenticated) {
                                            console.log(`[Sidecar] Peer ${peerKey.slice(0, 16)}... already verified, sending sync-request now`);
                                            p2pBridge.hyperswarm.sendSyncRequest(peerKey, topicHash);
                                            // Remove from pending since we just sent it
                                            const pending = pendingSyncRequests.get(peerKey);
                                            if (pending) pending.delete(topicHash);
                                        }
                                    }
                                }, 500); // Short delay for connection to register
                            }
                        } else {
                            console.warn('[Sidecar] âš  No bootstrap peers provided');
                        }
                    } else {
                        console.error('[Sidecar] âœ— Cannot join P2P: P2P not initialized or bridge not ready');
                    }
                    
                    ws.send(JSON.stringify({ type: 'workspace-joined', workspace: joinWsData }));
                } catch (err) {
                    console.error('[Sidecar] Failed to join workspace:', err);
                    ws.send(JSON.stringify({ type: 'error', message: err.message }));
                }
            }
            break;
        
        case 'leave-workspace':
            // Leave a workspace (for non-owners) - removes local copy only
            // This is semantically different from delete but performs the same local cleanup
            const leaveWsId = workspaceId || parsed.payload?.workspaceId;
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
        
        // --- Folder Management ---
        case 'create-folder':
            const folderData = folder || parsed.payload?.folder;
            if (folderData) {
                try {
                    await saveFolderMetadata(folderData.id, folderData);
                    
                    // CRITICAL: Also sync to Yjs for P2P sharing
                    if (folderData.workspaceId) {
                        addFolderToYjs(folderData.workspaceId, folderData);
                    }
                    
                    ws.send(JSON.stringify({ type: 'folder-created', folder: folderData }));
                } catch (err) {
                    console.error('[Sidecar] Failed to create folder:', err);
                    ws.send(JSON.stringify({ type: 'error', message: err.message }));
                }
            }
            break;
        
        case 'update-folder':
            const updateFolderData = folder || parsed.payload?.folder;
            if (updateFolderData) {
                try {
                    await saveFolderMetadata(updateFolderData.id, updateFolderData);
                    
                    // CRITICAL: Also sync to Yjs for P2P sharing
                    if (updateFolderData.workspaceId) {
                        updateFolderInYjs(updateFolderData.workspaceId, updateFolderData);
                    }
                    
                    ws.send(JSON.stringify({ type: 'folder-updated', folder: updateFolderData }));
                } catch (err) {
                    console.error('[Sidecar] Failed to update folder:', err);
                    ws.send(JSON.stringify({ type: 'error', message: err.message }));
                }
            }
            break;
        
        case 'delete-folder':
            // Soft delete: set deletedAt timestamp on folder
            const deleteFolderId = folderId || parsed.payload?.folderId;
            const deleteFolderWsId = workspaceId || parsed.payload?.workspaceId;
            const deletedBy = parsed.deletedBy || parsed.payload?.deletedBy || null;
            if (deleteFolderId) {
                try {
                    // Load existing folder to preserve data
                    const existingFolder = await metadataDb.get(`folder:${deleteFolderId}`);
                    const softDeletedFolder = {
                        ...existingFolder,
                        deletedAt: Date.now(),
                        deletedBy,
                    };
                    await saveFolderMetadata(deleteFolderId, softDeletedFolder);
                    
                    // CRITICAL: Also update in Yjs for P2P sharing (soft delete = update)
                    if (deleteFolderWsId) {
                        updateFolderInYjs(deleteFolderWsId, softDeletedFolder);
                    }
                    
                    ws.send(JSON.stringify({ type: 'folder-deleted', folderId: deleteFolderId, folder: softDeletedFolder }));
                } catch (err) {
                    console.error('[Sidecar] Failed to delete folder:', err);
                    ws.send(JSON.stringify({ type: 'error', message: err.message }));
                }
            }
            break;
        
        case 'list-folders':
            try {
                const folders = await loadFolderList();
                ws.send(JSON.stringify({ type: 'folder-list', folders }));
            } catch (err) {
                console.error('[Sidecar] Failed to list folders:', err);
                ws.send(JSON.stringify({ type: 'folder-list', folders: [], error: err.message }));
            }
            break;
        
        // --- Trash Management ---
        case 'list-trash':
            try {
                const trashItems = await loadTrashList();
                ws.send(JSON.stringify({ type: 'trash-list', trash: trashItems }));
            } catch (err) {
                console.error('[Sidecar] Failed to list trash:', err);
                ws.send(JSON.stringify({ type: 'trash-list', trash: [], error: err.message }));
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
                    const folderToRestore = await metadataDb.get(`folder:${payload.folderId}`);
                    const restored = { ...folderToRestore, deletedAt: null, deletedBy: null };
                    await saveFolderMetadata(payload.folderId, restored);
                    
                    // CRITICAL: Also update in Yjs for P2P sharing
                    if (folderToRestore.workspaceId) {
                        updateFolderInYjs(folderToRestore.workspaceId, restored);
                    }
                    
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
                    // Get folder info for workspaceId before deleting
                    let purgeWorkspaceId = payload.workspaceId;
                    try {
                        const folderToPurge = await metadataDb.get(`folder:${payload.folderId}`);
                        purgeWorkspaceId = purgeWorkspaceId || folderToPurge.workspaceId;
                    } catch (e) {
                        // Folder might already be deleted
                    }
                    
                    await metadataDb.del(`folder:${payload.folderId}`);
                    // Also permanently delete documents in this folder
                    const allDocs = await loadDocumentList();
                    for (const doc of allDocs) {
                        if (doc.folderId === payload.folderId) {
                            await deleteDocumentMetadata(doc.id);
                            await deleteDocumentData(doc.id);
                        }
                    }
                    
                    // CRITICAL: Also remove from Yjs for P2P sharing
                    if (purgeWorkspaceId) {
                        removeFolderFromYjs(purgeWorkspaceId, payload.folderId);
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
        
        // --- Document Management ---
        case 'create-document':
            const docData = document || parsed.payload?.document;
            if (docData) {
                try {
                    await saveDocumentMetadata(docData.id, docData);
                    ws.send(JSON.stringify({ type: 'document-created', document: docData }));
                } catch (err) {
                    console.error('[Sidecar] Failed to create document:', err);
                    ws.send(JSON.stringify({ type: 'error', message: err.message }));
                }
            }
            break;
        
        case 'update-document':
            const updateDocData = document || parsed.payload?.document;
            if (updateDocData) {
                try {
                    await saveDocumentMetadata(updateDocData.id, updateDocData);
                    ws.send(JSON.stringify({ type: 'document-updated', document: updateDocData }));
                } catch (err) {
                    console.error('[Sidecar] Failed to update document:', err);
                    ws.send(JSON.stringify({ type: 'error', message: err.message }));
                }
            }
            break;
        
        case 'delete-document':
            const deleteDocId = docId || parsed.payload?.docId;
            if (deleteDocId) {
                try {
                    await deleteDocumentMetadata(deleteDocId);
                    ws.send(JSON.stringify({ type: 'document-deleted', docId: deleteDocId }));
                } catch (err) {
                    console.error('[Sidecar] Failed to delete document:', err);
                    ws.send(JSON.stringify({ type: 'error', message: err.message }));
                }
            }
            break;
        
        // --- P2P Messages (forward to P2P bridge) ---
        case 'p2p-identity':
        case 'p2p-join-topic':
        case 'p2p-leave-topic':
        case 'p2p-send':
        case 'p2p-broadcast':
        case 'mdns-advertise':
        case 'mdns-discover':
        case 'mdns-stop':
            await p2pBridge.handleMessage(ws, parsed);
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
                const publicIP = await p2pBridge.getPublicIP();
                
                // Build WebSocket URLs for cross-platform sharing
                // IMPORTANT: Only set public URLs if UPnP successfully mapped the ports
                // Otherwise, the URLs won't be accessible from outside
                let directWsUrl = null;
                let directWssUrl = null;
                
                if (publicIP && upnpStatus.wsPortMapped) {
                    directWsUrl = `ws://${publicIP}:${YJS_WEBSOCKET_PORT}`;
                }
                if (publicIP && upnpStatus.wssPortMapped) {
                    directWssUrl = `wss://${publicIP}:${YJS_WEBSOCKET_SECURE_PORT}`;
                }
                
                console.log('[Sidecar] get-p2p-info: initialized=', p2pInitialized, 'ownPublicKey=', ownPublicKey?.slice(0, 16), 'publicIP=', publicIP);
                
                ws.send(JSON.stringify({
                    type: 'p2p-info',
                    initialized: p2pInitialized,
                    ownPublicKey,
                    connectedPeers,
                    directAddress,     // Hyperswarm { host, port, publicKey, address }
                    publicIP,
                    // WebSocket server info for cross-platform sharing
                    wsPort: YJS_WEBSOCKET_PORT,
                    wssPort: YJS_WEBSOCKET_SECURE_PORT,
                    directWsUrl,       // ws://publicIP:8080
                    directWssUrl,      // wss://publicIP:8443
                    upnpEnabled: upnpStatus.enabled,
                    upnpStatus: {
                        wsPortMapped: upnpStatus.wsPortMapped,
                        wssPortMapped: upnpStatus.wssPortMapped,
                        externalIP: upnpStatus.externalIP
                    }
                }));
            } catch (err) {
                console.error('[Sidecar] get-p2p-info error:', err);
                ws.send(JSON.stringify({
                    type: 'p2p-info',
                    initialized: false,
                    ownPublicKey: null,
                    connectedPeers: [],
                    directAddress: null,
                    publicIP: null,
                    wsPort: YJS_WEBSOCKET_PORT,
                    wssPort: YJS_WEBSOCKET_SECURE_PORT,
                    directWsUrl: null,
                    directWssUrl: null,
                    upnpEnabled: false,
                    upnpStatus: null,
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
                const publicIP = await p2pBridge.getPublicIP();
                console.log('[Sidecar] P2P reinitialized: initialized=', p2pInitialized, 'ownPublicKey=', ownPublicKey?.slice(0, 16));
                ws.send(JSON.stringify({
                    type: 'p2p-reinitialized',
                    success: result.success,
                    initialized: p2pInitialized,
                    ownPublicKey,
                    directAddress,
                    publicIP,
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
                    publicIP: null,
                    error: err.message,
                }));
            }
            break;
        
        case 'validate-relay-server':
            // Validate that a relay server URL is running Hyperswarm/DHT
            try {
                const { serverUrl } = parsed.payload || {};
                if (!serverUrl) {
                    ws.send(JSON.stringify({
                        type: 'relay-server-validation',
                        valid: false,
                        error: 'No server URL provided'
                    }));
                    return;
                }
                
                // Simple validation: try to connect and check for Hyperswarm response
                // This is a basic check - in production you'd want more robust validation
                const isValid = await validateRelayServer(serverUrl);
                ws.send(JSON.stringify({
                    type: 'relay-server-validation',
                    valid: isValid,
                    serverUrl
                }));
            } catch (err) {
                console.error('[Sidecar] Relay server validation error:', err);
                ws.send(JSON.stringify({
                    type: 'relay-server-validation',
                    valid: false,
                    error: err.message
                }));
            }
            break;
        
        // --- Identity Management ---
        case 'list-identities':
            try {
                const identities = identity.listIdentities();
                ws.send(JSON.stringify({
                    type: 'identity-list',
                    identities
                }));
            } catch (err) {
                console.error('[Sidecar] Failed to list identities:', err);
                ws.send(JSON.stringify({
                    type: 'identity-list',
                    identities: [],
                    error: err.message
                }));
            }
            break;
        
        case 'switch-identity':
            try {
                const { filename } = parsed.payload || {};
                if (!filename) {
                    ws.send(JSON.stringify({
                        type: 'identity-switched',
                        success: false,
                        error: 'No filename provided'
                    }));
                    return;
                }
                
                identity.switchIdentity(filename);
                
                // Reinitialize P2P with new identity
                await initializeP2P(true);
                
                ws.send(JSON.stringify({
                    type: 'identity-switched',
                    success: true,
                    identity: identity.loadIdentity()
                }));
            } catch (err) {
                console.error('[Sidecar] Failed to switch identity:', err);
                ws.send(JSON.stringify({
                    type: 'identity-switched',
                    success: false,
                    error: err.message
                }));
            }
            break;
        
        // --- Workspace Peer Status ---
        case 'get-workspace-peer-status':
            try {
                const statusWsId = workspaceId || parsed.payload?.workspaceId;
                if (!statusWsId) {
                    ws.send(JSON.stringify({
                        type: 'workspace-peer-status',
                        error: 'No workspace ID provided'
                    }));
                    return;
                }
                
                // Get workspace metadata for lastKnownPeers
                const wsMetadata = await loadWorkspaceMetadata(statusWsId);
                const lastKnownPeers = wsMetadata?.lastKnownPeers || [];
                
                // Count active peers for this workspace's topic
                let activePeers = 0;
                const topicHash = getWorkspaceTopicHex(statusWsId);
                
                if (p2pBridge.isInitialized && p2pBridge.hyperswarm) {
                    const connections = p2pBridge.hyperswarm.connections;
                    if (connections) {
                        for (const [, conn] of connections) {
                            if (conn.authenticated && conn.topics && conn.topics.has(topicHash)) {
                                activePeers++;
                            }
                        }
                    }
                }
                
                // Check relay connection status
                const relayConnected = relayBridge && relayBridge.connections.has(`workspace-meta:${statusWsId}`);
                
                // Cap the total seen peers at MAX_SEEN_PEERS_CAP (100)
                const MAX_SEEN_PEERS_CAP = 100;
                const totalSeenPeers = Math.min(lastKnownPeers.length, MAX_SEEN_PEERS_CAP);
                
                ws.send(JSON.stringify({
                    type: 'workspace-peer-status',
                    workspaceId: statusWsId,
                    activePeers,
                    totalSeenPeers,
                    relayConnected,
                    p2pInitialized
                }));
            } catch (err) {
                console.error('[Sidecar] get-workspace-peer-status error:', err);
                ws.send(JSON.stringify({
                    type: 'workspace-peer-status',
                    error: err.message
                }));
            }
            break;
        
        case 'request-peer-sync':
            try {
                const syncWsId = workspaceId || parsed.payload?.workspaceId;
                if (!syncWsId) {
                    ws.send(JSON.stringify({
                        type: 'peer-sync-result',
                        success: false,
                        error: 'No workspace ID provided'
                    }));
                    return;
                }
                
                console.log(`[Sidecar] Manual peer sync requested for workspace ${syncWsId.slice(0, 8)}...`);
                
                const topicHash = getWorkspaceTopicHex(syncWsId);
                let syncAttempts = 0;
                let syncSuccess = false;
                
                // Try to sync from connected peers
                if (p2pBridge.isInitialized && p2pBridge.hyperswarm) {
                    const connections = p2pBridge.hyperswarm.connections;
                    if (connections) {
                        for (const [peerKey, conn] of connections) {
                            if (conn.authenticated && conn.topics && conn.topics.has(topicHash)) {
                                try {
                                    p2pBridge.hyperswarm.sendSyncRequest(peerKey, topicHash);
                                    syncAttempts++;
                                    syncSuccess = true;
                                    console.log(`[Sidecar] Sent sync request to peer ${peerKey.slice(0, 16)}...`);
                                } catch (e) {
                                    console.warn(`[Sidecar] Failed to send sync request to ${peerKey.slice(0, 16)}:`, e.message);
                                }
                            }
                        }
                    }
                }
                
                // Try relay as fallback if no direct peers
                if (syncAttempts === 0 && relayBridge) {
                    const roomName = `workspace-meta:${syncWsId}`;
                    const doc = docs.get(roomName);
                    if (doc) {
                        try {
                            await relayBridge.connect(roomName, doc);
                            syncSuccess = true;
                            console.log(`[Sidecar] Connected to relay for ${roomName}`);
                        } catch (e) {
                            console.warn(`[Sidecar] Relay connection failed:`, e.message);
                        }
                    }
                }
                
                // Try to connect to last known peers if no current connections
                if (syncAttempts === 0) {
                    const wsMetadata = await loadWorkspaceMetadata(syncWsId);
                    const lastKnownPeers = wsMetadata?.lastKnownPeers || [];
                    
                    for (const peer of lastKnownPeers.slice(0, 5)) { // Try first 5
                        if (peer.publicKey) {
                            try {
                                await p2pBridge.connectToPeer(peer.publicKey);
                                // Queue sync request for when identity is verified
                                let pendingTopics = pendingSyncRequests.get(peer.publicKey);
                                if (!pendingTopics) {
                                    pendingTopics = new Set();
                                    pendingSyncRequests.set(peer.publicKey, pendingTopics);
                                }
                                pendingTopics.add(topicHash);
                                syncAttempts++;
                            } catch (e) {
                                // Peer may be offline
                            }
                        }
                    }
                }
                
                ws.send(JSON.stringify({
                    type: 'peer-sync-result',
                    success: syncSuccess || syncAttempts > 0,
                    syncAttempts,
                    message: syncSuccess 
                        ? `Sync requested from ${syncAttempts} peer(s)` 
                        : syncAttempts > 0 
                            ? `Connecting to ${syncAttempts} peer(s)...`
                            : 'No peers available'
                }));
            } catch (err) {
                console.error('[Sidecar] request-peer-sync error:', err);
                ws.send(JSON.stringify({
                    type: 'peer-sync-result',
                    success: false,
                    error: err.message
                }));
            }
            break;
        
        case 'verify-sync-state':
            // Request manifest verification from connected peers
            try {
                const verifyWsId = workspaceId || parsed.payload?.workspaceId;
                if (!verifyWsId) {
                    ws.send(JSON.stringify({
                        type: 'sync-status',
                        workspaceId: verifyWsId,
                        status: 'failed',
                        details: { error: 'No workspace ID provided' }
                    }));
                    return;
                }
                
                console.log(`[Sidecar] Verify sync state requested for workspace ${verifyWsId.slice(0, 8)}...`);
                
                const topicHash = getWorkspaceTopicHex(verifyWsId);
                requestManifestVerification(verifyWsId, topicHash);
            } catch (err) {
                console.error('[Sidecar] verify-sync-state error:', err);
            }
            break;
        
        case 'force-full-sync':
            // Request full state sync from all connected peers
            try {
                const fullSyncWsId = workspaceId || parsed.payload?.workspaceId;
                if (!fullSyncWsId) {
                    ws.send(JSON.stringify({
                        type: 'sync-status',
                        workspaceId: fullSyncWsId,
                        status: 'failed',
                        details: { error: 'No workspace ID provided' }
                    }));
                    return;
                }
                
                console.log(`[Sidecar] Force full sync requested for workspace ${fullSyncWsId.slice(0, 8)}...`);
                
                const topicHash = getWorkspaceTopicHex(fullSyncWsId);
                let syncAttempts = 0;
                
                // Send sync request to all connected peers
                if (p2pBridge.isInitialized && p2pBridge.hyperswarm) {
                    const connections = p2pBridge.hyperswarm.connections;
                    for (const [peerKey, conn] of connections) {
                        if (conn.authenticated && conn.topics && conn.topics.has(topicHash)) {
                            try {
                                p2pBridge.hyperswarm.sendSyncRequest(peerKey, topicHash);
                                syncAttempts++;
                                console.log(`[Sidecar] Sent full sync request to peer ${peerKey.slice(0, 16)}...`);
                            } catch (e) {
                                console.warn(`[Sidecar] Failed to send sync request:`, e.message);
                            }
                        }
                    }
                }
                
                // Notify frontend
                broadcastSyncStatus(fullSyncWsId, 'syncing', { requestsSent: syncAttempts });
                
                // Schedule verification after delay
                if (syncAttempts > 0) {
                    setTimeout(() => {
                        requestManifestVerification(fullSyncWsId, topicHash);
                    }, 3000);
                }
            } catch (err) {
                console.error('[Sidecar] force-full-sync error:', err);
            }
            break;
        
        // --- Factory Reset: Delete ALL local data ---
        case 'factory-reset':
            try {
                console.log('[Sidecar] FACTORY RESET requested - deleting all local data...');
                
                // 1. Close P2P connections
                if (p2pBridge.isInitialized) {
                    try {
                        await p2pBridge.destroy();
                        console.log('[Sidecar] P2P bridge destroyed');
                    } catch (e) {
                        console.warn('[Sidecar] Error destroying P2P bridge:', e.message);
                    }
                }
                
                // 2. Stop mesh participant
                if (meshParticipant) {
                    try {
                        await meshParticipant.stop();
                        console.log('[Sidecar] Mesh participant stopped');
                    } catch (e) {
                        console.warn('[Sidecar] Error stopping mesh:', e.message);
                    }
                }
                
                // 3. Clear all Yjs docs in memory
                docs.clear();
                console.log('[Sidecar] In-memory Yjs docs cleared');
                
                // 4. Clear the main document database
                console.log('[Sidecar] Clearing main document database...');
                const keysToDelete = [];
                for await (const key of db.keys()) {
                    keysToDelete.push(key);
                }
                for (const key of keysToDelete) {
                    await db.del(key);
                }
                console.log(`[Sidecar] Deleted ${keysToDelete.length} entries from document DB`);
                
                // 5. Clear the metadata database
                console.log('[Sidecar] Clearing metadata database...');
                await metadataDbReady;
                const metaKeysToDelete = [];
                for await (const key of metadataDb.keys()) {
                    metaKeysToDelete.push(key);
                }
                for (const key of metaKeysToDelete) {
                    await metadataDb.del(key);
                }
                console.log(`[Sidecar] Deleted ${metaKeysToDelete.length} entries from metadata DB`);
                
                // 6. Delete identity files
                const identityDir = path.join(USER_DATA_PATH, 'identity');
                const fs = require('fs');
                if (fs.existsSync(identityDir)) {
                    const files = fs.readdirSync(identityDir);
                    for (const file of files) {
                        try {
                            fs.unlinkSync(path.join(identityDir, file));
                            console.log(`[Sidecar] Deleted identity file: ${file}`);
                        } catch (e) {
                            console.warn(`[Sidecar] Could not delete ${file}:`, e.message);
                        }
                    }
                }
                
                // 7. Clear document encryption keys from memory
                documentKeys.clear();
                console.log('[Sidecar] Document encryption keys cleared');
                
                // 8. Clear all other in-memory Maps to prevent stale state
                topicToWorkspace.clear();
                console.log('[Sidecar] Topic-to-workspace mappings cleared');
                
                pendingSyncRequests.clear();
                console.log('[Sidecar] Pending sync requests cleared');
                
                awarenessListeners.clear();
                console.log('[Sidecar] Awareness listeners cleared');
                
                pendingManifestVerifications.clear();
                console.log('[Sidecar] Pending manifest verifications cleared');
                
                remotePeerAwareness.clear();
                console.log('[Sidecar] Remote peer awareness cleared');
                
                awarenessThrottles.clear();
                console.log('[Sidecar] Awareness throttles cleared');
                
                pendingUpdates.clear();
                console.log('[Sidecar] Pending updates cleared');
                
                // 9. Reset P2P initialized flag and mesh participant
                p2pInitialized = false;
                meshParticipant = null;
                console.log('[Sidecar] P2P state reset');
                
                // 10. Reset global connection state variables
                connectionStatus = 'offline';
                sessionKey = null;
                isOnline = false;
                fullMultiaddr = null;
                onionAddress = null;
                console.log('[Sidecar] Global connection state reset');
                
                // 11. Broadcast updated status to all connected clients
                broadcastStatus();
                
                console.log('[Sidecar] FACTORY RESET complete');
                
                ws.send(JSON.stringify({
                    type: 'factory-reset-complete',
                    success: true,
                    message: 'All local data has been deleted. Please restart the application.'
                }));
            } catch (err) {
                console.error('[Sidecar] Factory reset error:', err);
                ws.send(JSON.stringify({
                    type: 'factory-reset-complete',
                    success: false,
                    error: err.message
                }));
            }
            break;
        
        default:
            // Unknown message type - log but don't error
            console.log(`[Sidecar] Unknown message type: ${type}`);
    }
}

// --- 3. WebSocket Servers ---

// Initialize servers after database is ready
async function startServers() {
    // Wait for database to be ready before starting servers
    await dbReady;
    console.log(`[Sidecar] Database ready, starting servers... (${Date.now() - startTime}ms)`);
    
    // Run database migrations
    console.log('[Sidecar] Running database migrations...');
    await migrateWorkspaceServerUrls();
    console.log('[Sidecar] Migrations complete');
    
    // --- UPnP Port Mapping (run AFTER servers start, truly non-blocking) ---
    // Use setImmediate to defer to after the current event loop tick
    setImmediate(() => {
        console.log('[Sidecar] Starting UPnP discovery in background...');
        
        // Run UPnP in background with 3-second timeout
        Promise.race([
            (async () => {
                // Lazy-load UPnP mapper
                const { mapPort, getExternalIP } = getUPnPMapper();
                
                try {
                    const externalIP = await getExternalIP();
                    if (externalIP) {
                        upnpStatus.externalIP = externalIP;
                        console.log(`[UPnP] Detected external IP: ${externalIP}`);
                    }
                } catch (err) {
                    console.warn('[UPnP] Could not detect external IP:', err.message);
                }
                
                const wsMapping = await mapPort(YJS_WEBSOCKET_PORT, 'Nightjar Yjs WebSocket');
                if (wsMapping.success) {
                    upnpStatus.enabled = true;
                    upnpStatus.wsPortMapped = true;
                }
                
                const wssMapping = await mapPort(YJS_WEBSOCKET_SECURE_PORT, 'Nightjar Yjs Secure WebSocket');
                if (wssMapping.success) {
                    upnpStatus.enabled = true;
                    upnpStatus.wssPortMapped = true;
                }
                
                if (upnpStatus.enabled) {
                    console.log('[Sidecar] âœ“ UPnP auto-configuration successful');
                } else {
                    console.log('[Sidecar] âš  UPnP unavailable - manual port forwarding may be required');
                }
            })(),
            new Promise(resolve => setTimeout(() => {
                console.log('[UPnP] Timeout after 3s, continuing...');
                resolve();
            }, 3000))
        ]).catch(err => {
            console.warn('[UPnP] Error during discovery:', err.message);
        }).then(() => {
            // UPnP result doesn't block startup - just log completion
            console.log('[UPnP] Discovery phase complete (background)');
        });
    });
    
    // Continue with server startup immediately
    console.log(`[Sidecar] Continuing startup (UPnP runs in background)... (${Date.now() - startTime}ms)`);
    
    // --- SSL Certificate (for WSS support) ---
    const certDir = path.join(USER_DATA_PATH, 'identity');
    let sslCreds = null;
    try {
        sslCreds = ensureSSLCert(certDir);
        console.log(`[Sidecar] SSL certificate ready for WSS (${Date.now() - startTime}ms)`);
    } catch (err) {
        console.error('[Sidecar] Failed to setup SSL certificate:', err);
        console.warn('[Sidecar] WSS (secure WebSocket) will not be available');
    }
    
    // --- Server 1: Plain Yjs WebSocket (ws://) ---
    console.log(`[Sidecar] Creating Yjs WebSocket server on port ${YJS_WEBSOCKET_PORT}...`);
    await new Promise((resolve, reject) => {
        yjsWss = new WebSocket.Server({ port: YJS_WEBSOCKET_PORT, maxPayload: 10 * 1024 * 1024 /* 10MB */ }, () => {
            console.log(`[Sidecar] Yjs WebSocket server listening on ws://localhost:${YJS_WEBSOCKET_PORT} (${Date.now() - startTime}ms)`);
            resolve();
        });
        yjsWss.on('connection', (conn, req) => {
            console.log('[Sidecar] Yjs client connected (WS)');
            setupWSConnection(conn, req);
        });
        yjsWss.on('error', (err) => {
            console.error(`[Sidecar] Yjs WebSocket server error:`, err);
            reject(err);
        });
    });
    
    // --- Server 2: Secure Yjs WebSocket (wss://) ---
    if (sslCreds) {
        try {
            const httpsServer = https.createServer({
                cert: sslCreds.cert,
                key: sslCreds.key
            });
            
            yjsWssSecure = new WebSocket.Server({ server: httpsServer, maxPayload: 10 * 1024 * 1024 /* 10MB */ });
            yjsWssSecure.on('connection', (conn, req) => {
                console.log('[Sidecar] Yjs client connected (WSS)');
                setupWSConnection(conn, req);
            });
            yjsWssSecure.on('error', (err) => {
                console.error('[Sidecar] Yjs Secure WebSocket server error:', err);
            });
            
            httpsServer.listen(YJS_WEBSOCKET_SECURE_PORT, () => {
                console.log(`[Sidecar] Yjs Secure WebSocket server listening on wss://localhost:${YJS_WEBSOCKET_SECURE_PORT} (${Date.now() - startTime}ms)`);
            });
        } catch (err) {
            console.error('[Sidecar] Failed to start WSS server:', err);
        }
    }

    // Server 2: Handles metadata and commands  
    console.log(`[Sidecar] Creating Metadata WebSocket server on port ${METADATA_WEBSOCKET_PORT}...`);
    const metaServerReady = new Promise((resolve, reject) => {
        metaWss = new WebSocket.Server({ port: METADATA_WEBSOCKET_PORT, maxPayload: 10 * 1024 * 1024 /* 10MB */ }, () => {
            console.log(`[Sidecar] Metadata WebSocket server listening on ws://localhost:${METADATA_WEBSOCKET_PORT} (${Date.now() - startTime}ms)`);
            resolve();
        });
        metaWss.on('error', (err) => {
            console.error(`[Sidecar] Metadata WebSocket server error:`, err);
            reject(err);
        });
    });
    
    // Set up metadata server connection handler
    metaWss.on('connection', (ws, req) => {
        // Generate unique client ID for rate limiting per connection
        const clientId = `${req.socket.remoteAddress || 'unknown'}:${req.socket.remotePort || crypto.randomBytes(4).toString('hex')}`;
        
        // Immediately send current status
        const meshStatus = meshParticipant ? meshParticipant.getStatus() : null;
        ws.send(JSON.stringify({
            type: 'status',
            status: connectionStatus,
            isOnline: isOnline,
            torEnabled: torEnabled,
            onionAddress: onionAddress ? `${onionAddress}.onion` : null,
            multiaddr: fullMultiaddr,
            peerId: p2pNode ? p2pNode.peerId.toString() : null,
            mesh: meshStatus
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
                if (!uint8arraysLoaded) {
                    await loadUint8Arrays();
                }
                
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
                
                // Handle message through the centralized handler
                await handleMetadataMessage(ws, parsed);
                
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
    
    // Wait for metadata server to be ready
    await metaServerReady;
    
    // Load uint8arrays module in background (don't block startup)
    console.log('[Sidecar] Starting uint8arrays module load in background...');
    loadUint8Arrays().then(() => {
        console.log('[Sidecar] uint8arrays loaded, initializing document keys...');
        initializeDocumentKeys();
        console.log('[Sidecar] Document keys initialized');
        
        // Cleanup orphan documents after keys are initialized
        return cleanupOrphanDocuments();
    }).catch(err => {
        console.warn('[Sidecar] uint8arrays/document keys init warning:', err.message);
    });
    
    console.log(`[Sidecar] ========== Startup complete in ${Date.now() - startTime}ms ==========`);
}

// Start servers
startServers().catch(err => {
    console.error('[Sidecar] Failed to start servers:', err);
    process.exit(1);
});

// --- P2P Initialization ---
// Initialize P2PBridge with identity if available (enables Hyperswarm DHT)
// force=true will reinitialize even if already initialized (useful after identity creation)
async function initializeP2P(force = false) {
    if (p2pInitialized && !force) {
        console.log('[Sidecar] P2P already initialized, skipping');
        return { success: true, alreadyInitialized: true };
    }
    
    try {
        if (identity.hasIdentity()) {
            const userIdentity = identity.loadIdentity();
            if (userIdentity) {
                const p2pIdentity = {
                    publicKey: Buffer.from(userIdentity.publicKey).toString('hex'),
                    secretKey: Buffer.from(userIdentity.privateKey).toString('hex'),
                    displayName: userIdentity.handle || 'Anonymous',
                    color: userIdentity.color || '#6366f1',
                };
                
                await p2pBridge.initialize(p2pIdentity);
                p2pInitialized = true;
                
                // Update connection status to reflect P2P is active
                connectionStatus = 'connected';
                broadcastStatus();
                
                console.log('[Sidecar] P2P initialized with identity:', userIdentity.handle);
                
                // Set up Yjs sync bridging via P2P
                setupYjsP2PBridge();
                
                // Set up peer persistence for mesh networking
                setupPeerPersistence();
                
                // Initialize mesh network participation IN BACKGROUND (don't block)
                initializeMesh().catch(err => {
                    console.warn('[Sidecar] Background mesh init failed:', err.message);
                });
                
                // Auto-rejoin saved workspaces - MUST complete before returning
                // to avoid race condition where P2P messages arrive before topics are registered
                try {
                    await autoRejoinWorkspaces();
                } catch (err) {
                    console.warn('[Sidecar] Workspace rejoin failed:', err.message);
                }
                
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

// --- Mesh Network Initialization ---
// Initialize the global relay mesh for peer discovery and redundancy

async function initializeMesh() {
    if (!meshEnabled) {
        console.log('[Mesh] Mesh participation disabled via NIGHTJAR_MESH env');
        return;
    }
    
    try {
        // Lazy-load mesh module
        await ensureMesh();
        
        // Create mesh participant (desktop clients are NOT relays by default)
        meshParticipant = new MeshParticipant({
            enabled: true,
            relayMode: false, // Desktop clients don't act as public relays
            announceWorkspaces: true, // Announce our workspaces for peer discovery
        });
        
        // Set up mesh event handlers
        meshParticipant.on('relay-discovered', (relay) => {
            console.log(`[Mesh] Discovered relay: ${relay.endpoints?.[0] || relay.nodeId?.slice(0, 16)}`);
            broadcastStatus(); // Update clients with new relay info
        });
        
        meshParticipant.on('workspace-peers', ({ workspaceId, peers }) => {
            console.log(`[Mesh] Found ${peers.length} peers for workspace ${workspaceId.slice(0, 16)}...`);
        });
        
        meshParticipant.on('error', (err) => {
            console.error('[Mesh] Error:', err);
        });
        
        // Start mesh participation
        await meshParticipant.start();
        console.log('[Sidecar] Mesh network participation started');
        
        // Broadcast updated status including mesh info
        broadcastStatus();
        
    } catch (err) {
        console.error('[Sidecar] Failed to initialize mesh:', err);
        // Non-fatal - app continues without mesh
    }
}

// --- Yjs P2P Bridge ---
// This bridges Hyperswarm P2P connections with Yjs document sync
// When a peer sends a sync message, apply it to the local Yjs doc
// When a local Yjs doc updates, broadcast to P2P peers
// NEW: When a peer joins, send them our full document state

// Map of topicHash -> workspaceId for reverse lookup
const topicToWorkspace = new Map();

// Map of peerId -> Set of topicHex that need sync after identity is verified
// This ensures we only send sync-request after the peer handshake is complete
const pendingSyncRequests = new Map();

function setupYjsP2PBridge() {
    if (!p2pBridge || !p2pBridge.hyperswarm) {
        console.warn('[Sidecar] Cannot setup Yjs P2P bridge - P2P not initialized');
        return;
    }
    
    const hyperswarm = p2pBridge.hyperswarm;
    
    // Listen for sync messages from P2P peers (incremental updates)
    hyperswarm.on('sync-message', ({ peerId, topic, data }) => {
        handleP2PSyncMessage(peerId, topic, data);
    });
    
    // Listen for sync state requests (peer wants our full state)
    hyperswarm.on('sync-state-request', ({ peerId, topic }) => {
        handleSyncStateRequest(peerId, topic);
    });
    
    // Listen for full sync state from peers (initial sync)
    hyperswarm.on('sync-state-received', ({ peerId, topic, data }) => {
        handleSyncStateReceived(peerId, topic, data);
    });
    
    // Listen for sync manifest requests (peer wants document/folder counts for verification)
    hyperswarm.on('sync-manifest-request', ({ peerId, topic }) => {
        handleSyncManifestRequest(peerId, topic);
    });
    
    // Listen for sync manifest responses (for verification and missing document detection)
    hyperswarm.on('sync-manifest-received', ({ peerId, topic, manifest }) => {
        handleSyncManifestReceived(peerId, topic, manifest);
    });
    
    // Listen for specific document requests (to recover missing documents)
    hyperswarm.on('sync-documents-request', ({ peerId, topic, documentIds }) => {
        handleDocumentsRequest(peerId, topic, documentIds);
    });
    
    // Listen for awareness updates from P2P peers (presence/chat)
    hyperswarm.on('awareness-update', ({ peerId, topic, state }) => {
        handleP2PAwarenessUpdate(peerId, topic, state);
    });
    
    console.log('[Sidecar] Yjs P2P bridge initialized');
    
    // Set up local awareness broadcasting to P2P peers
    // Watch existing docs and attach awareness listeners
    setupAwarenessP2PBridging();
}

// Set up bridging of local awareness changes to P2P peers
// This ensures that presence/chat updates flow bidirectionally
const awarenessListeners = new Map(); // roomName -> listener function

function setupAwarenessP2PBridging() {
    // Check periodically for new docs (workspace-meta and doc-*) and attach awareness listeners
    const checkInterval = setInterval(() => {
        for (const [roomName, doc] of docs.entries()) {
            // Skip if we already attached a listener
            if (awarenessListeners.has(roomName)) continue;
            
            // Check if doc has awareness
            if (!doc.awareness) continue;
            
            let workspaceId = null;
            let topicHex = null;
            let documentId = null;
            
            // Handle workspace-meta rooms
            if (roomName.startsWith('workspace-meta:')) {
                workspaceId = roomName.replace('workspace-meta:', '');
                
                // Find the topic for this workspace
                for (const [topic, wsId] of topicToWorkspace.entries()) {
                    if (wsId === workspaceId) {
                        topicHex = topic;
                        break;
                    }
                }
            }
            // Handle document rooms (doc-*) - broadcast selection awareness over workspace topic
            else if (roomName.startsWith('doc-')) {
                documentId = roomName;
                
                // Find workspace for this document by checking which workspace-meta contains it
                for (const [metaRoomName, metaDoc] of docs.entries()) {
                    if (!metaRoomName.startsWith('workspace-meta:')) continue;
                    try {
                        const yDocuments = metaDoc.getArray('documents');
                        const documents = yDocuments.toArray();
                        if (documents.some(d => d.id === documentId)) {
                            workspaceId = metaRoomName.replace('workspace-meta:', '');
                            // Find topic for this workspace
                            for (const [topic, wsId] of topicToWorkspace.entries()) {
                                if (wsId === workspaceId) {
                                    topicHex = topic;
                                    break;
                                }
                            }
                            break;
                        }
                    } catch (e) {
                        // Skip docs without documents array
                    }
                }
            }
            
            if (!topicHex || !workspaceId) {
                continue; // No P2P topic registered for this workspace
            }
            
            // Create awareness listener - include documentId for document-level awareness
            const capturedDocumentId = documentId; // Capture for closure
            const capturedWorkspaceId = workspaceId;
            const capturedTopicHex = topicHex;
            
            const awarenessHandler = ({ added, updated, removed }, origin) => {
                // Don't broadcast if the update came from P2P (avoid loops)
                if (origin === 'p2p' || origin === 'relay') return;
                
                const changedClients = [...added, ...updated, ...removed];
                if (changedClients.length === 0) return;
                
                // Get the local awareness state to broadcast
                const localState = doc.awareness.getLocalState();
                if (localState) {
                    const awarenessPayload = {
                        clientId: doc.awareness.clientID,
                        ...localState
                    };
                    
                    // Include documentId for document-level awareness (spreadsheet selections)
                    if (capturedDocumentId) {
                        awarenessPayload.documentId = capturedDocumentId;
                    }
                    
                    broadcastAwarenessUpdate(capturedWorkspaceId, capturedTopicHex, awarenessPayload);
                }
            };
            
            doc.awareness.on('update', awarenessHandler);
            awarenessListeners.set(roomName, awarenessHandler);
            console.log(`[P2P-AWARENESS] Attached awareness listener for ${roomName}${documentId ? ` (doc: ${documentId.slice(0, 12)}...)` : ''}`);
        }
    }, 2000); // Check every 2 seconds
    
    // Return cleanup function (not used currently but could be useful)
    return () => {
        clearInterval(checkInterval);
        for (const [roomName, listener] of awarenessListeners.entries()) {
            const doc = docs.get(roomName);
            if (doc?.awareness) {
                doc.awareness.off('update', listener);
            }
        }
        awarenessListeners.clear();
    };
}

// Handle request for our full document state (called when a peer joins or requests sync)
async function handleSyncStateRequest(peerId, topicHex) {
    console.log(`[P2P-SYNC-STATE] ========== STATE REQUEST ==========`);
    console.log(`[P2P-SYNC-STATE] From peer: ${peerId?.slice(0, 16)}...`);
    console.log(`[P2P-SYNC-STATE] Topic: ${topicHex?.slice(0, 16)}...`);
    
    try {
        // Find the workspace ID for this topic
        const workspaceId = topicToWorkspace.get(topicHex);
        if (!workspaceId) {
            console.warn(`[P2P-SYNC-STATE] ✗ Unknown topic - not registered`);
            return;
        }
        
        const roomName = `workspace-meta:${workspaceId}`;
        let doc = docs.get(roomName);
        
        // If doc doesn't exist (frontend not connected), try to load from persistence
        if (!doc) {
            console.log(`[P2P-SYNC-STATE] Doc not in memory, loading from persistence...`);
            const key = getKeyForDocument(roomName);
            if (key) {
                // Use getYDoc to create proper WSSharedDoc with awareness
                doc = getYDoc(roomName);
                await loadPersistedData(roomName, doc, key);
                console.log(`[P2P-SYNC-STATE] ✓ Loaded doc from persistence`);
            } else {
                console.warn(`[P2P-SYNC-STATE] ✗ Doc not found and no key for: ${roomName}`);
                return;
            }
        }
        
        // Encode the full document state as an update
        const stateUpdate = Y.encodeStateAsUpdate(doc);
        console.log(`[P2P-SYNC-STATE] Encoding full state: ${stateUpdate.length} bytes`);
        
        // Create message with room name
        const message = {
            roomName: roomName,
            update: Buffer.from(stateUpdate).toString('base64')
        };
        
        // Send state to the requesting peer
        const messageStr = JSON.stringify(message);
        p2pBridge.hyperswarm.sendSyncState(peerId, topicHex, messageStr);
        
        console.log(`[P2P-SYNC-STATE] ✓ Sent workspace-meta state to ${peerId.slice(0, 16)}...`);
        
        // CRITICAL: Also sync all document contents for this workspace
        // This ensures joiners get the actual document data, not just the list
        await syncAllDocumentsForWorkspace(peerId, topicHex, workspaceId, doc);
        
        console.log(`[P2P-SYNC-STATE] ==========================================`);
    } catch (err) {
        console.error(`[P2P-SYNC-STATE] ✗ Error:`, err.message);
        console.log(`[P2P-SYNC-STATE] ==========================================`);
    }
}

// Sync all document contents for a workspace to a peer
async function syncAllDocumentsForWorkspace(peerId, topicHex, workspaceId, metaDoc) {
    try {
        // Get the documents array from workspace-meta
        const yDocuments = metaDoc.getArray('documents');
        const documents = yDocuments.toArray();
        
        if (documents.length === 0) {
            console.log(`[P2P-SYNC-STATE] No documents to sync for workspace ${workspaceId.slice(0, 16)}...`);
            return;
        }
        
        console.log(`[P2P-SYNC-STATE] Syncing ${documents.length} document(s) content for workspace`);
        
        for (const docMeta of documents) {
            const docId = docMeta.id;
            if (!docId) continue;
            
            let contentDoc = docs.get(docId);
            
            // If doc not in memory, try to load from persistence
            if (!contentDoc) {
                const key = getKeyForDocument(docId);
                if (key) {
                    contentDoc = getYDoc(docId);
                    await loadPersistedData(docId, contentDoc, key);
                    console.log(`[P2P-SYNC-STATE] Loaded document ${docId} from persistence`);
                } else {
                    console.log(`[P2P-SYNC-STATE] No key for document ${docId}, skipping`);
                    continue;
                }
            }
            
            // Encode and send the document content
            const docUpdate = Y.encodeStateAsUpdate(contentDoc);
            if (docUpdate.length > 2) { // Skip empty docs (Yjs empty state is 2 bytes)
                const docMessage = {
                    roomName: docId,
                    update: Buffer.from(docUpdate).toString('base64')
                };
                p2pBridge.hyperswarm.sendSyncState(peerId, topicHex, JSON.stringify(docMessage));
                console.log(`[P2P-SYNC-STATE] ✓ Sent document ${docId} (${docUpdate.length} bytes)`);
            }
        }
        
        console.log(`[P2P-SYNC-STATE] ✓ Finished syncing all document contents`);
    } catch (err) {
        console.error(`[P2P-SYNC-STATE] Error syncing documents:`, err.message);
    }
}

// Handle received full document state from a peer (initial sync)
async function handleSyncStateReceived(peerId, topicHex, data) {
    console.log(`[P2P-SYNC-STATE] ========== STATE RECEIVED ==========`);
    console.log(`[P2P-SYNC-STATE] From peer: ${peerId?.slice(0, 16)}...`);
    console.log(`[P2P-SYNC-STATE] Topic: ${topicHex?.slice(0, 16)}...`);
    console.log(`[P2P-SYNC-STATE] Data length: ${data?.length || 'unknown'}`);
    
    try {
        // Find the workspace ID for this topic
        const workspaceId = topicToWorkspace.get(topicHex);
        if (!workspaceId) {
            console.warn(`[P2P-SYNC-STATE] ✗ Unknown topic - not registered`);
            return;
        }
        
        // Parse the message
        let roomName, updateData;
        try {
            const message = JSON.parse(data);
            roomName = message.roomName;
            updateData = Buffer.from(message.update, 'base64');
            console.log(`[P2P-SYNC-STATE] ✓ Parsed state for room: ${roomName}, size: ${updateData.length}`);
        } catch (e) {
            console.error(`[P2P-SYNC-STATE] ✗ Failed to parse state message:`, e.message);
            return;
        }
        
        // Get or create the Yjs doc using getYDoc to ensure proper WSSharedDoc with awareness
        // This is critical - using Y.Doc directly causes crashes when WebSocket clients connect
        let doc = docs.get(roomName);
        if (!doc) {
            doc = getYDoc(roomName);
            console.log(`[P2P-SYNC-STATE] Created new WSSharedDoc for: ${roomName}`);
        }
        
        // For document content (doc-xxx), get the encryption key from workspace-meta
        if (roomName.startsWith('doc-')) {
            const metaRoomName = `workspace-meta:${workspaceId}`;
            const metaDoc = docs.get(metaRoomName);
            if (metaDoc) {
                const yDocuments = metaDoc.getArray('documents');
                const documents = yDocuments.toArray();
                const docMeta = documents.find(d => d.id === roomName);
                if (docMeta && docMeta.encryptionKey) {
                    // Set the key for this document so it can be persisted
                    documentKeys.set(roomName, docMeta.encryptionKey);
                    console.log(`[P2P-SYNC-STATE] Set encryption key for document ${roomName}`);
                }
            }
        }
        
        // Apply the full state update with 'p2p' origin to prevent re-broadcasting
        try {
            Y.applyUpdate(doc, updateData, 'p2p');
        } catch (applyErr) {
            console.error(`[P2P-SYNC-STATE] Failed to apply update to ${roomName}:`, applyErr.message);
            // Continue without crashing - the document may recover from other peers
            return;
        }
        
        console.log(`[P2P-SYNC-STATE] ✓ Applied full state to ${roomName}`);
        
        // Also persist the update if we have a key
        const key = getKeyForDocument(roomName);
        if (key) {
            persistUpdate(roomName, updateData, 'p2p');
            console.log(`[P2P-SYNC-STATE] ✓ Persisted update for ${roomName}`);
        }
        
        // Also broadcast to local WebSocket clients so they get the sync
        const wss = require('y-websocket/bin/utils').docs;
        if (wss) {
            // The doc is already in the shared docs Map, so local clients will get the update
            console.log(`[P2P-SYNC-STATE] ✓ Local WebSocket clients will receive the update`);
        }
        
        // CRITICAL: Persist document/folder metadata from P2P sync to local LevelDB
        // This enables invitees to broadcast updates back to the owner
        if (roomName.startsWith('workspace-meta:')) {
            await persistMetadataFromYjs(workspaceId, doc);
        }
        
        console.log(`[P2P-SYNC-STATE] ==========================================`);
    } catch (err) {
        console.error(`[P2P-SYNC-STATE] ✗ Error:`, err.message);
        console.log(`[P2P-SYNC-STATE] ==========================================`);
    }
}

// --- Sync Verification and Manifest Handling ---
// Track pending manifest verifications for intelligent retry
const pendingManifestVerifications = new Map(); // workspaceId -> { retryCount, lastRequest, timeoutId }
const SYNC_VERIFY_RETRY_INTERVALS = [5000, 10000, 15000]; // 5s, 10s, 15s
const SYNC_VERIFY_MAX_RETRIES = 3;
const SYNC_VERIFY_TIMEOUT = 30000; // 30s total timeout

// Build a sync manifest for a workspace (document/folder counts and IDs)
function buildSyncManifest(workspaceId) {
    const roomName = `workspace-meta:${workspaceId}`;
    const metaDoc = docs.get(roomName);
    
    if (!metaDoc) {
        return { documentCount: 0, folderCount: 0, documentIds: [], folderIds: [] };
    }
    
    const yDocuments = metaDoc.getArray('documents');
    const yFolders = metaDoc.getArray('folders');
    
    const documents = yDocuments.toArray();
    const folders = yFolders.toArray();
    
    return {
        documentCount: documents.length,
        folderCount: folders.length,
        documentIds: documents.map(d => d.id).filter(Boolean),
        folderIds: folders.map(f => f.id).filter(Boolean),
        timestamp: Date.now(),
    };
}

// Compare local manifest with remote manifest, return missing items
function compareSyncManifests(localManifest, remoteManifest) {
    const missingDocumentIds = (remoteManifest.documentIds || []).filter(
        id => !(localManifest.documentIds || []).includes(id)
    );
    const missingFolderIds = (remoteManifest.folderIds || []).filter(
        id => !(localManifest.folderIds || []).includes(id)
    );
    
    return {
        isSynced: missingDocumentIds.length === 0 && missingFolderIds.length === 0,
        missingDocumentIds,
        missingFolderIds,
        localDocCount: localManifest.documentCount,
        remoteDocCount: remoteManifest.documentCount,
        localFolderCount: localManifest.folderCount,
        remoteFolderCount: remoteManifest.folderCount,
    };
}

// Handle sync manifest request from a peer
function handleSyncManifestRequest(peerId, topicHex) {
    console.log(`[P2P-MANIFEST] ========== MANIFEST REQUEST ==========`);
    console.log(`[P2P-MANIFEST] From peer: ${peerId?.slice(0, 16)}...`);
    console.log(`[P2P-MANIFEST] Topic: ${topicHex?.slice(0, 16)}...`);
    
    try {
        const workspaceId = topicToWorkspace.get(topicHex);
        if (!workspaceId) {
            console.warn(`[P2P-MANIFEST] ✗ Unknown topic`);
            return;
        }
        
        const manifest = buildSyncManifest(workspaceId);
        console.log(`[P2P-MANIFEST] Sending manifest: ${manifest.documentCount} docs, ${manifest.folderCount} folders`);
        
        p2pBridge.hyperswarm.sendSyncManifest(peerId, topicHex, manifest);
        console.log(`[P2P-MANIFEST] ==========================================`);
    } catch (err) {
        console.error(`[P2P-MANIFEST] ✗ Error:`, err.message);
    }
}

// Handle sync manifest response from a peer (for verification)
async function handleSyncManifestReceived(peerId, topicHex, remoteManifest) {
    console.log(`[P2P-MANIFEST] ========== MANIFEST RECEIVED ==========`);
    console.log(`[P2P-MANIFEST] From peer: ${peerId?.slice(0, 16)}...`);
    console.log(`[P2P-MANIFEST] Remote: ${remoteManifest?.documentCount} docs, ${remoteManifest?.folderCount} folders`);
    
    try {
        const workspaceId = topicToWorkspace.get(topicHex);
        if (!workspaceId) {
            console.warn(`[P2P-MANIFEST] ✗ Unknown topic`);
            return;
        }
        
        const localManifest = buildSyncManifest(workspaceId);
        console.log(`[P2P-MANIFEST] Local: ${localManifest.documentCount} docs, ${localManifest.folderCount} folders`);
        
        const comparison = compareSyncManifests(localManifest, remoteManifest);
        
        if (comparison.isSynced) {
            console.log(`[P2P-MANIFEST] ✓ Sync verified - all documents present`);
            
            // Clear any pending verification for this workspace
            const pending = pendingManifestVerifications.get(workspaceId);
            if (pending && pending.timeoutId) {
                clearTimeout(pending.timeoutId);
            }
            pendingManifestVerifications.delete(workspaceId);
            
            // Notify frontend of successful sync
            broadcastSyncStatus(workspaceId, 'verified', localManifest);
        } else {
            console.log(`[P2P-MANIFEST] ⚠ Missing documents: ${comparison.missingDocumentIds.length}`);
            console.log(`[P2P-MANIFEST] ⚠ Missing folders: ${comparison.missingFolderIds.length}`);
            
            // Union merge: request missing documents from this peer
            if (comparison.missingDocumentIds.length > 0) {
                console.log(`[P2P-MANIFEST] Requesting ${comparison.missingDocumentIds.length} missing document(s) from peer`);
                p2pBridge.hyperswarm.sendDocumentsRequest(peerId, topicHex, comparison.missingDocumentIds);
            }
            
            // For missing workspace-meta content, request full sync
            if (comparison.missingFolderIds.length > 0) {
                console.log(`[P2P-MANIFEST] Requesting full sync to get missing folders`);
                p2pBridge.hyperswarm.sendSyncRequest(peerId, topicHex);
            }
            
            // Schedule retry verification
            scheduleManifestVerification(workspaceId, topicHex);
            
            // Notify frontend of incomplete sync
            broadcastSyncStatus(workspaceId, 'incomplete', { ...localManifest, missing: comparison });
        }
        
        console.log(`[P2P-MANIFEST] ==========================================`);
    } catch (err) {
        console.error(`[P2P-MANIFEST] ✗ Error:`, err.message);
    }
}

// Handle request for specific documents (missing document recovery)
async function handleDocumentsRequest(peerId, topicHex, documentIds) {
    console.log(`[P2P-DOCS-REQUEST] ========== DOCUMENTS REQUEST ==========`);
    console.log(`[P2P-DOCS-REQUEST] From peer: ${peerId?.slice(0, 16)}...`);
    console.log(`[P2P-DOCS-REQUEST] Requested: ${documentIds?.length || 0} document(s)`);
    
    try {
        const workspaceId = topicToWorkspace.get(topicHex);
        if (!workspaceId) {
            console.warn(`[P2P-DOCS-REQUEST] ✗ Unknown topic`);
            return;
        }
        
        // Send each requested document
        for (const docId of documentIds || []) {
            try {
                let contentDoc = docs.get(docId);
                if (!contentDoc) {
                    contentDoc = getYDoc(docId);
                    const key = getKeyForDocument(docId);
                    if (key) {
                        await loadPersistedData(docId, contentDoc, key);
                    }
                }
                
                const docUpdate = Y.encodeStateAsUpdate(contentDoc);
                if (docUpdate.length > 2) {
                    const docMessage = {
                        roomName: docId,
                        update: Buffer.from(docUpdate).toString('base64')
                    };
                    p2pBridge.hyperswarm.sendSyncState(peerId, topicHex, JSON.stringify(docMessage));
                    console.log(`[P2P-DOCS-REQUEST] ✓ Sent document ${docId} (${docUpdate.length} bytes)`);
                }
            } catch (docErr) {
                console.error(`[P2P-DOCS-REQUEST] ✗ Failed to send ${docId}:`, docErr.message);
            }
        }
        
        console.log(`[P2P-DOCS-REQUEST] ==========================================`);
    } catch (err) {
        console.error(`[P2P-DOCS-REQUEST] ✗ Error:`, err.message);
    }
}

// Schedule a manifest verification with exponential backoff
function scheduleManifestVerification(workspaceId, topicHex) {
    let pending = pendingManifestVerifications.get(workspaceId);
    
    if (!pending) {
        pending = { retryCount: 0, lastRequest: 0, timeoutId: null };
        pendingManifestVerifications.set(workspaceId, pending);
    }
    
    // Check if max retries exceeded
    if (pending.retryCount >= SYNC_VERIFY_MAX_RETRIES) {
        console.log(`[P2P-MANIFEST] Max retries (${SYNC_VERIFY_MAX_RETRIES}) reached for ${workspaceId.slice(0, 8)}...`);
        broadcastSyncStatus(workspaceId, 'failed', { error: 'Max retries exceeded' });
        return;
    }
    
    // Clear existing timeout
    if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
    }
    
    const delay = SYNC_VERIFY_RETRY_INTERVALS[pending.retryCount] || SYNC_VERIFY_RETRY_INTERVALS[SYNC_VERIFY_RETRY_INTERVALS.length - 1];
    console.log(`[P2P-MANIFEST] Scheduling retry ${pending.retryCount + 1}/${SYNC_VERIFY_MAX_RETRIES} in ${delay/1000}s`);
    
    pending.retryCount++;
    pending.lastRequest = Date.now();
    pending.timeoutId = setTimeout(() => {
        requestManifestVerification(workspaceId, topicHex);
    }, delay);
}

// Request manifest verification from all connected peers for a workspace
function requestManifestVerification(workspaceId, topicHex) {
    if (!p2pInitialized || !p2pBridge.hyperswarm) {
        console.log(`[P2P-MANIFEST] P2P not initialized, skipping verification`);
        return;
    }
    
    console.log(`[P2P-MANIFEST] Requesting manifest verification for ${workspaceId.slice(0, 8)}...`);
    
    const connections = p2pBridge.hyperswarm.connections;
    let requestsSent = 0;
    
    for (const [peerId, conn] of connections) {
        if (conn.authenticated && conn.topics.has(topicHex)) {
            p2pBridge.hyperswarm.sendSyncManifestRequest(peerId, topicHex);
            requestsSent++;
        }
    }
    
    if (requestsSent === 0) {
        console.log(`[P2P-MANIFEST] No connected peers for verification`);
        broadcastSyncStatus(workspaceId, 'no-peers', {});
    } else {
        console.log(`[P2P-MANIFEST] Sent manifest requests to ${requestsSent} peer(s)`);
        broadcastSyncStatus(workspaceId, 'verifying', { requestsSent });
    }
}

// Broadcast sync status to frontend WebSocket clients
function broadcastSyncStatus(workspaceId, status, details) {
    const message = JSON.stringify({
        type: 'sync-status',
        workspaceId,
        status, // 'verifying', 'verified', 'incomplete', 'failed', 'no-peers', 'retrying'
        details,
        timestamp: Date.now(),
    });
    
    if (metaWss) {
        metaWss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }
}

// Handle incoming sync message from a P2P peer (incremental updates)
async function handleP2PSyncMessage(peerId, topicHex, data) {
    console.log(`[P2P-SYNC] ========== INCOMING MESSAGE ==========`);
    console.log(`[P2P-SYNC] From peer: ${peerId?.slice(0, 16)}...`);
    console.log(`[P2P-SYNC] Topic: ${topicHex?.slice(0, 16)}...`);
    console.log(`[P2P-SYNC] Data length: ${data?.length || 'unknown'}`);
    
    try {
        // Find the workspace ID for this topic
        let workspaceId = topicToWorkspace.get(topicHex);
        if (!workspaceId) {
            // Fallback: try to find workspace by topic hash from LevelDB
            // This handles the case where P2P messages arrive before autoRejoinWorkspaces completes
            console.warn(`[P2P-SYNC] ⚠ Unknown topic - attempting fallback lookup...`);
            try {
                const workspaces = await loadWorkspaceList();
                for (const ws of workspaces) {
                    const canonicalHash = getWorkspaceTopicHex(ws.id);
                    if (canonicalHash === topicHex) {
                        workspaceId = ws.id;
                        // Register topic for future messages
                        registerWorkspaceTopic(ws.id, topicHex);
                        console.log(`[P2P-SYNC] ✓ Fallback found workspace ${ws.id.slice(0, 16)}... - registered topic`);
                        break;
                    }
                }
            } catch (lookupErr) {
                console.warn(`[P2P-SYNC] Fallback lookup failed:`, lookupErr.message);
            }
            
            if (!workspaceId) {
                console.warn(`[P2P-SYNC] ✗ Unknown topic - not registered and fallback failed`);
                console.warn(`[P2P-SYNC] Known topics: ${Array.from(topicToWorkspace.keys()).map(t => t.slice(0, 8)).join(', ')}`);
                return;
            }
        }
        
        console.log(`[P2P-SYNC] âœ“ Topic maps to workspace: ${workspaceId.slice(0, 16)}...`);
        
        // Parse the message (new format includes roomName + update)
        let roomName, updateData;
        try {
            const message = JSON.parse(data);
            roomName = message.roomName;
            updateData = Buffer.from(message.update, 'base64');
            console.log(`[P2P-SYNC] âœ“ Parsed new format - room: ${roomName}`);
        } catch (e) {
            // Fallback to old format (just base64 update for workspace-meta)
            roomName = `workspace-meta:${workspaceId}`;
            updateData = typeof data === 'string' ? Buffer.from(data, 'base64') : data;
            console.log(`[P2P-SYNC] âš  Using fallback format - room: ${roomName}`);
        }
        
        console.log(`[P2P-SYNC] Update size: ${updateData?.length} bytes`);

        // For document content (doc-xxx), get the encryption key from workspace-meta
        if (roomName.startsWith('doc-')) {
            const metaRoomName = `workspace-meta:${workspaceId}`;
            const metaDoc = docs.get(metaRoomName);
            if (metaDoc) {
                const yDocuments = metaDoc.getArray('documents');
                const documents = yDocuments.toArray();
                const docMeta = documents.find(d => d.id === roomName);
                if (docMeta && docMeta.encryptionKey && !documentKeys.has(roomName)) {
                    documentKeys.set(roomName, docMeta.encryptionKey);
                    console.log(`[P2P-SYNC] Set encryption key for document ${roomName}`);
                }
            }
        }
        
        // Get or create the Yjs doc for the specified room
        let doc = docs.get(roomName);
        if (!doc) {
            doc = getYDoc(roomName);
            console.log(`[P2P-SYNC] âœ“ Created new Yjs doc for: ${roomName}`);
        } else {
            console.log(`[P2P-SYNC] âœ“ Found existing Yjs doc for: ${roomName}`);
        }
        
        // Apply the update with 'p2p' origin to prevent re-broadcasting
        try {
            Y.applyUpdate(doc, updateData, 'p2p');
        } catch (applyErr) {
            console.error('[P2P-SYNC] Failed to apply update:', applyErr.message);
            return;
        }
        
        console.log(`[P2P-SYNC] âœ“ Successfully applied update to ${roomName}`);
        
        // Also persist the update if we have a key
        const key = getKeyForDocument(roomName);
        if (key) {
            persistUpdate(roomName, updateData, 'p2p');
            console.log(`[P2P-SYNC] Persisted update for ${roomName}`);
        }
        
        // CRITICAL: Also persist metadata when workspace-meta updates arrive
        // This ensures new documents/folders are saved to LevelDB for invitee broadcasts
        if (roomName.startsWith('workspace-meta:')) {
            await persistMetadataFromYjs(workspaceId, doc);
        }
        
        console.log(`[P2P-SYNC] ==========================================`);
    } catch (err) {
        console.error('[P2P-SYNC] ✗ Error handling sync:', err.message);
        console.error('[P2P-SYNC] Stack:', err.stack);
        console.log(`[P2P-SYNC] ==========================================`);
    }
}

// Handle awareness updates from P2P peers
// This bridges presence/chat awareness from remote peers to local Yjs docs
// Remote peer states are stored in a separate map since y-protocols awareness 
// uses clientID-based states that don't work well for cross-process bridging
const remotePeerAwareness = new Map(); // workspaceId -> Map<peerId, state>

function handleP2PAwarenessUpdate(peerId, topicHex, state) {
    try {
        // Find the workspace ID for this topic
        const workspaceId = topicToWorkspace.get(topicHex);
        if (!workspaceId) {
            return; // Not a topic we're tracking
        }
        
        // Parse the state if it's a string (from JSON transport)
        let parsedState;
        try {
            parsedState = typeof state === 'string' ? JSON.parse(state) : state;
        } catch (parseErr) {
            console.warn(`[P2P-AWARENESS] Failed to parse awareness state:`, parseErr.message);
            return;
        }
        
        if (!parsedState || typeof parsedState !== 'object') {
            return;
        }
        
        // Extract documentId if present (for document-level awareness like spreadsheet selections)
        const documentId = parsedState.documentId || null;
        
        // Store remote peer state in our tracking map
        if (!remotePeerAwareness.has(workspaceId)) {
            remotePeerAwareness.set(workspaceId, new Map());
        }
        remotePeerAwareness.get(workspaceId).set(peerId, {
            ...parsedState,
            lastSeen: Date.now(),
            peerId: peerId.slice(0, 16)
        });
        
        const logSuffix = documentId ? ` (doc: ${documentId.slice(0, 12)}...)` : '';
        console.log(`[P2P-AWARENESS] Stored awareness from ${peerId.slice(0, 8)}... for workspace ${workspaceId.slice(0, 8)}...${logSuffix}`);
        
        // Notify WebSocket clients about the remote peer
        // They can query the remote peer states via a message
        if (metaWss) {
            const message = JSON.stringify({
                type: 'p2p-awareness-update',
                workspaceId,
                documentId, // Include documentId for document-level awareness routing
                peerId: peerId.slice(0, 16),
                state: parsedState
            });
            metaWss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(message);
                }
            });
        }
    } catch (err) {
        console.error('[P2P-AWARENESS] Error handling awareness:', err.message);
    }
}

// Broadcast a Yjs update to all P2P peers for a workspace
function broadcastYjsUpdate(workspaceId, topicHex, update, roomName) {
    if (!p2pInitialized || !p2pBridge.hyperswarm) {
        console.log(`[P2P-BROADCAST] âœ— Skipped - P2P not initialized`);
        return;
    }
    
    console.log(`[P2P-BROADCAST] ========== OUTGOING MESSAGE ==========`);
    console.log(`[P2P-BROADCAST] Workspace: ${workspaceId?.slice(0, 16)}...`);
    console.log(`[P2P-BROADCAST] Topic: ${topicHex?.slice(0, 16)}...`);
    console.log(`[P2P-BROADCAST] Room: ${roomName || 'workspace-meta'}`);
    console.log(`[P2P-BROADCAST] Update size: ${update?.length} bytes`);
    
    try {
        // Create a message that includes both the update and the room name
        const message = {
            roomName: roomName || `workspace-meta:${workspaceId}`,
            update: Buffer.from(update).toString('base64')
        };
        
        const messageStr = JSON.stringify(message);
        console.log(`[P2P-BROADCAST] Message size: ${messageStr.length} bytes`);
        
        const connectedPeers = p2pBridge.hyperswarm.getConnectedPeerKeys();
        console.log(`[P2P-BROADCAST] Connected peers: ${connectedPeers.length}`);
        
        p2pBridge.hyperswarm.broadcastSync(topicHex, messageStr);
        console.log(`[P2P-BROADCAST] âœ“ Broadcast complete`);
        console.log(`[P2P-BROADCAST] ==========================================`);
    } catch (err) {
        console.error('[P2P-BROADCAST] âœ— Error:', err.message);
        console.log(`[P2P-BROADCAST] ==========================================`);
    }
}

// Throttled awareness broadcasts to prevent network spam
// Each workspace has its own throttle timer
const awarenessThrottles = new Map(); // workspaceId -> { timer, pending }
const AWARENESS_THROTTLE_MS = 100; // 100ms throttle for smooth but efficient updates

// Broadcast awareness state to all P2P peers for a workspace (throttled)
function broadcastAwarenessUpdate(workspaceId, topicHex, awarenessState) {
    if (!p2pInitialized || !p2pBridge.hyperswarm) {
        return;
    }
    
    // Get or create throttle state for this workspace
    let throttle = awarenessThrottles.get(workspaceId);
    if (!throttle) {
        throttle = { timer: null, pending: null };
        awarenessThrottles.set(workspaceId, throttle);
    }
    
    // Store the latest state to send
    throttle.pending = { topicHex, awarenessState };
    
    // If no timer is running, send immediately and start throttle
    if (!throttle.timer) {
        sendAwarenessNow(workspaceId, throttle.pending);
        throttle.pending = null;
        
        // Start throttle timer
        throttle.timer = setTimeout(() => {
            // If there's a pending update, send it
            if (throttle.pending) {
                sendAwarenessNow(workspaceId, throttle.pending);
                throttle.pending = null;
            }
            throttle.timer = null;
        }, AWARENESS_THROTTLE_MS);
    }
    // If timer is running, the pending state will be sent when timer fires
}

// Actually send awareness update (internal, called by throttle)
function sendAwarenessNow(workspaceId, { topicHex, awarenessState }) {
    try {
        p2pBridge.hyperswarm.broadcastAwareness(topicHex, JSON.stringify(awarenessState));
    } catch (err) {
        console.error('[P2P-AWARENESS] Error broadcasting awareness:', err.message);
    }
}

// Register a workspace topic for Yjs bridging
function registerWorkspaceTopic(workspaceId, topicHex) {
    topicToWorkspace.set(topicHex, workspaceId);
    
    // Also announce this workspace on the mesh for peer discovery
    if (meshParticipant && meshParticipant._running) {
        meshParticipant.joinWorkspace(workspaceId).catch(err => {
            console.error('[Mesh] Failed to join workspace on mesh:', err);
        });
    }
    
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
    // AND send any pending sync requests that were waiting for this peer
    hyperswarm.on('peer-identity', async ({ peerId, identity }) => {
        try {
            // Check if we have pending sync requests for this peer
            const pendingTopics = pendingSyncRequests.get(peerId);
            if (pendingTopics && pendingTopics.size > 0) {
                console.log(`[Sidecar] Peer ${peerId.slice(0, 16)}... verified, sending ${pendingTopics.size} pending sync-request(s)`);
                for (const topicHex of pendingTopics) {
                    try {
                        hyperswarm.sendSyncRequest(peerId, topicHex);
                        console.log(`[Sidecar] ✓ Sent pending sync-request to ${peerId.slice(0, 16)}... for topic ${topicHex.slice(0, 16)}...`);
                    } catch (e) {
                        console.error(`[Sidecar] ✗ Failed to send pending sync-request:`, e.message);
                    }
                }
                // Clear pending requests for this peer
                pendingSyncRequests.delete(peerId);
            }
            
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
    await metadataDbReady;
    
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
        const workspacesToVerify = []; // Track workspaces for post-sync verification
        
        for (const ws of workspaces) {
            // Always derive canonical topic hash from workspace ID to ensure consistency
            if (ws.id && p2pBridge.isInitialized) {
                try {
                    const canonicalTopicHash = getWorkspaceTopicHex(ws.id);
                    
                    // Log migration if stored hash differs from canonical
                    if (ws.topicHash && ws.topicHash !== canonicalTopicHash) {
                        console.log(`[Sidecar] Migrating workspace ${ws.id.slice(0, 8)}... topic hash`);
                        console.log(`[Sidecar]   Old: ${ws.topicHash.slice(0, 16)}...`);
                        console.log(`[Sidecar]   New: ${canonicalTopicHash.slice(0, 16)}...`);
                    }
                    
                    // CRITICAL: Register topic BEFORE joining to avoid race condition
                    registerWorkspaceTopic(ws.id, canonicalTopicHash);
                    console.log(`[Sidecar] Pre-registered workspace topic for auto-rejoin`);
                    
                    await p2pBridge.joinTopic(canonicalTopicHash);
                    console.log(`[Sidecar] Auto-rejoined workspace topic: ${canonicalTopicHash.slice(0, 16)}...`);
                    
                    // Track for verification
                    workspacesToVerify.push({ workspaceId: ws.id, topicHash: canonicalTopicHash });
                    
                    // Try to connect to last known peers and request fresh sync
                    if (ws.lastKnownPeers && Array.isArray(ws.lastKnownPeers)) {
                        for (const peer of ws.lastKnownPeers) {
                            if (peer.publicKey) {
                                try {
                                    await p2pBridge.connectToPeer(peer.publicKey);
                                    // Queue sync request for when identity is verified
                                    let pendingTopics = pendingSyncRequests.get(peer.publicKey);
                                    if (!pendingTopics) {
                                        pendingTopics = new Set();
                                        pendingSyncRequests.set(peer.publicKey, pendingTopics);
                                    }
                                    pendingTopics.add(canonicalTopicHash);
                                    console.log(`[Sidecar] Queued fresh sync request for peer ${peer.publicKey.slice(0, 16)}...`);
                                } catch (e) {
                                    // Peer may be offline, continue
                                }
                            }
                        }
                    }
                    
                    // Also try relay as fallback for fresh sync
                    if (relayBridge) {
                        const roomName = `workspace-meta:${ws.id}`;
                        const doc = docs.get(roomName);
                        if (doc) {
                            relayBridge.connect(roomName, doc).catch(err => {
                                console.warn(`[Sidecar] Relay connection for ${ws.id.slice(0, 8)}... failed:`, err.message);
                            });
                        }
                    }
                } catch (e) {
                    console.warn(`[Sidecar] Failed to rejoin workspace ${ws.id}:`, e.message);
                }
            }
        }
        
        // Schedule sync verification for all workspaces after a delay
        // This ensures we detect and recover any missing data after initial sync
        if (workspacesToVerify.length > 0) {
            console.log(`[Sidecar] Scheduling sync verification for ${workspacesToVerify.length} workspace(s) in 5s...`);
            setTimeout(() => {
                for (const { workspaceId, topicHash } of workspacesToVerify) {
                    // Check if local metadata seems sparse (possible incomplete sync)
                    checkAndRecoverSparse(workspaceId, topicHash);
                }
            }, 5000);
        }
    } catch (err) {
        console.error('[Sidecar] Auto-rejoin failed:', err);
    }
}

// Check if workspace metadata is sparse and request recovery if needed
async function checkAndRecoverSparse(workspaceId, topicHash) {
    try {
        const roomName = `workspace-meta:${workspaceId}`;
        const metaDoc = docs.get(roomName);
        
        // Count documents in LevelDB
        const levelDbDocs = await loadDocumentList();
        const localDocsForWorkspace = levelDbDocs.filter(d => d.workspaceId === workspaceId);
        
        // Count documents in Yjs (if synced)
        let yjsDocCount = 0;
        if (metaDoc) {
            const yDocs = metaDoc.getArray('documents');
            yjsDocCount = yDocs.toArray().length;
        }
        
        console.log(`[Sidecar] Sync check for ${workspaceId.slice(0, 8)}...: LevelDB=${localDocsForWorkspace.length}, Yjs=${yjsDocCount}`);
        
        // If LevelDB has fewer docs than Yjs, persist missing metadata
        if (localDocsForWorkspace.length < yjsDocCount && metaDoc) {
            console.log(`[Sidecar] Sparse metadata detected, persisting from Yjs...`);
            await persistMetadataFromYjs(workspaceId, metaDoc);
        }
        
        // If Yjs has no docs but we expect some, request full sync from peers
        if (yjsDocCount === 0 && localDocsForWorkspace.length === 0) {
            console.log(`[Sidecar] Empty workspace detected, requesting full sync...`);
            requestManifestVerification(workspaceId, topicHash);
        } else {
            // Schedule manifest verification to detect any missing documents
            scheduleManifestVerification(workspaceId, topicHash);
        }
    } catch (err) {
        console.error(`[Sidecar] Sparse check failed for ${workspaceId}:`, err.message);
    }
}

// P2P initialization with retry loop
// Retries initialization until identity is available or max attempts reached
// Reduced from 20 to 3 for faster test execution
const P2P_INIT_MAX_ATTEMPTS = process.env.P2P_INIT_MAX_ATTEMPTS ? parseInt(process.env.P2P_INIT_MAX_ATTEMPTS) : 3;
const P2P_INIT_RETRY_INTERVAL_MS = process.env.P2P_INIT_RETRY_INTERVAL_MS ? parseInt(process.env.P2P_INIT_RETRY_INTERVAL_MS) : 3000;
let p2pInitAttempts = 0;

async function initializeP2PWithRetry() {
    p2pInitAttempts++;
    console.log(`[Sidecar] P2P initialization attempt ${p2pInitAttempts}/${P2P_INIT_MAX_ATTEMPTS}`);
    console.log(`[Sidecar] Identity path configured: ${identity.getIdentityPath()}`);
    console.log(`[Sidecar] Identity exists: ${identity.hasIdentity()}`);
    
    const result = await initializeP2P();
    
    if (result.success) {
        console.log('[Sidecar] P2P initialization successful!');
        return;
    }
    
    console.log(`[Sidecar] P2P init failed: ${result.reason}`);
    
    if (result.reason === 'no_identity') {
        // Identity doesn't exist yet - user hasn't set up their identity
        // Schedule retry so P2P auto-starts once identity is created
        if (p2pInitAttempts < P2P_INIT_MAX_ATTEMPTS) {
            console.log(`[Sidecar] Will retry P2P init in ${P2P_INIT_RETRY_INTERVAL_MS/1000}s...`);
            setTimeout(initializeP2PWithRetry, P2P_INIT_RETRY_INTERVAL_MS);
        } else {
            console.log('[Sidecar] P2P init max attempts reached. Waiting for identity creation...');
            console.log('[Sidecar] P2P will be initialized when get-p2p-info or reinitialize-p2p is called');
        }
    } else {
        // Some other error - may be transient, retry
        if (p2pInitAttempts < P2P_INIT_MAX_ATTEMPTS) {
            console.log(`[Sidecar] P2P init failed (${result.reason}), retrying in ${P2P_INIT_RETRY_INTERVAL_MS/1000}s...`);
            setTimeout(initializeP2PWithRetry, P2P_INIT_RETRY_INTERVAL_MS);
        } else {
            console.error('[Sidecar] P2P init failed after max attempts:', result.reason);
        }
    }
}

// Start P2P initialization after a short delay to let everything start up
setTimeout(initializeP2PWithRetry, 1000);

// Initialize: Load all document keys from metadata on startup (after servers are ready)
// This is deferred to not block startup - documents will be loaded by the time the client connects
async function initializeDocumentKeys() {
    try {
        if (!uint8arraysLoaded) {
            await loadUint8Arrays();
        }
        console.log('[Sidecar] Loading document list...');
        const documents = await loadDocumentList();
        console.log(`[Sidecar] Startup: Loaded ${documents.length} documents, ${documentKeys.size} encryption keys`);
    } catch (err) {
        console.error('[Sidecar] Failed to initialize document keys:', err.message);
    }
}


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
                await withDbTimeout(db.put(`${docId}:p2p:${Date.now().toString()}`, encryptedData), `put p2p ${docId}`);
                
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
                await withDbTimeout(db.put(`p2p:${Date.now().toString()}`, rawData), 'put legacy p2p');

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
const pendingUpdates = new Map(); // docName -> [{ update, origin, timestamp }]

// Pending updates configuration
const PENDING_UPDATES_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes TTL
const PENDING_UPDATES_MAX_PER_DOC = 1000; // Max updates per document
const PENDING_UPDATES_MAX_TOTAL = 10000; // Max total updates across all docs

/**
 * Clean up stale pending updates and enforce size limits
 */
function cleanupPendingUpdates() {
    const now = Date.now();
    let totalCount = 0;
    
    for (const [docName, updates] of pendingUpdates.entries()) {
        // Remove entries older than TTL
        const filtered = updates.filter(u => (now - (u.timestamp || 0)) < PENDING_UPDATES_MAX_AGE_MS);
        
        // Enforce per-doc limit (keep most recent)
        const limited = filtered.length > PENDING_UPDATES_MAX_PER_DOC 
            ? filtered.slice(-PENDING_UPDATES_MAX_PER_DOC) 
            : filtered;
        
        if (limited.length === 0) {
            pendingUpdates.delete(docName);
        } else {
            pendingUpdates.set(docName, limited);
            totalCount += limited.length;
        }
    }
    
    // If still over total limit, remove oldest entries across all docs
    if (totalCount > PENDING_UPDATES_MAX_TOTAL) {
        console.warn(`[Sidecar] pendingUpdates exceeded max total (${totalCount}), trimming oldest entries`);
        // Collect all entries with timestamps, sort by age, keep newest
        const allEntries = [];
        for (const [docName, updates] of pendingUpdates.entries()) {
            for (const update of updates) {
                allEntries.push({ docName, update });
            }
        }
        allEntries.sort((a, b) => (b.update.timestamp || 0) - (a.update.timestamp || 0));
        
        // Clear and rebuild with only the newest entries
        pendingUpdates.clear();
        const keep = allEntries.slice(0, PENDING_UPDATES_MAX_TOTAL);
        for (const { docName, update } of keep) {
            if (!pendingUpdates.has(docName)) {
                pendingUpdates.set(docName, []);
            }
            pendingUpdates.get(docName).push(update);
        }
    }
}

// Clean up pending updates every minute
setInterval(cleanupPendingUpdates, 60000);

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
            console.log(`[Sidecar] >>> Update handler fired for ${docName}, origin: ${origin?.constructor?.name || origin}, update size: ${update?.length}`);
            // Don't re-persist updates that came from persistence or P2P
            if (origin === 'persistence' || origin === 'p2p') {
                console.log(`[Sidecar] Skipping update with origin: ${origin}`);
                return;
            }
            
            console.log(`[Sidecar] Update received for ${docName}, origin: ${origin}, size: ${update?.length}, hasKey: ${!!getKeyForDocument(docName)}`);
            
            const key = getKeyForDocument(docName);
            if (key) {
                console.log(`[Sidecar] Persisting update for ${docName}...`);
                persistUpdate(docName, update, origin);
                
                // Also broadcast to P2P if this document belongs to a workspace
                // Extract document ID from docName (format is "doc-123abc" with dash, not colon)
                if (docName.startsWith('doc-')) {
                    const docId = docName; // docId is the full docName like "doc-123abc"
                    // Find the workspace this document belongs to
                    // First try LevelDB, then fallback to in-memory Yjs docs
                    findWorkspaceForDocument(docId).then(workspaceInfo => {
                        if (workspaceInfo && workspaceInfo.workspaceId) {
                            // Find the topic for this workspace
                            for (const [topicHex, wsId] of topicToWorkspace.entries()) {
                                if (wsId === workspaceInfo.workspaceId) {
                                    broadcastYjsUpdate(workspaceInfo.workspaceId, topicHex, update, docName);
                                    console.log(`[Sidecar] Broadcast document ${docId} update to workspace ${wsId} via P2P`);
                                    break;
                                }
                            }
                        } else {
                            console.log(`[Sidecar] No workspace found for document ${docId} - cannot broadcast`);
                        }
                    }).catch(err => {
                        console.error(`[Sidecar] Failed to broadcast document update to P2P:`, err);
                    });
                }
            } else {
                // Queue the update for when key is available
                console.log(`[Sidecar] Queuing update for ${docName} (no key yet), queue size before: ${pendingUpdates.get(docName)?.length || 0}`);
                pendingUpdates.get(docName).push({ update, origin, timestamp: Date.now() });
                console.log(`[Sidecar] Queue size after: ${pendingUpdates.get(docName)?.length}`);
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
        
        // Connect workspace-meta docs to public relay for zero-config cross-platform sharing
        // This ensures web clients can sync via the relay even if UPnP fails
        if (relayBridgeEnabled && docName.startsWith('workspace-meta:')) {
            console.log(`[Sidecar] Connecting ${docName} to public relay for cross-platform sharing...`);
            relayBridge.connect(docName, doc).catch(err => {
                console.warn(`[Sidecar] Failed to connect ${docName} to relay:`, err.message);
                // Non-fatal - P2P mesh will still work
            });
        }
        
        // For workspace-meta docs, add P2P broadcast observer if topic is registered
        // This handles the case where doc is created AFTER registerWorkspaceTopic() is called (e.g., joiners)
        if (docName.startsWith('workspace-meta:')) {
            const workspaceId = docName.replace('workspace-meta:', '');
            console.log(`[Sidecar] Checking deferred P2P observer for ${docName}, topicToWorkspace has ${topicToWorkspace.size} entries`);
            
            // Find if this workspace has a registered topic
            let foundTopic = false;
            for (const [topicHex, wsId] of topicToWorkspace.entries()) {
                if (wsId === workspaceId) {
                    foundTopic = true;
                    console.log(`[Sidecar] Adding deferred P2P observer for ${docName} on topic ${topicHex.slice(0, 16)}...`);
                    doc.on('update', (update, origin) => {
                        // Don't re-broadcast updates that came from P2P
                        if (origin !== 'p2p') {
                            console.log(`[Sidecar] [DEFERRED-OBSERVER] Update in ${docName}, origin: ${origin}, broadcasting...`);
                            broadcastYjsUpdate(workspaceId, topicHex, update);
                        }
                    });
                    console.log(`[Sidecar] ✓ Registered deferred P2P observer for ${docName}`);
                    break;
                }
            }
            
            if (!foundTopic) {
                console.warn(`[Sidecar] ⚠ No topic registered for workspace ${workspaceId.slice(0, 16)}... - P2P broadcast will not work until topic is registered`);
                // Try to register topic from workspace metadata
                try {
                    const wsMetadata = await loadWorkspaceMetadata(workspaceId);
                    if (wsMetadata) {
                        const canonicalTopicHash = getWorkspaceTopicHex(workspaceId);
                        console.log(`[Sidecar] Late-registering topic for ${workspaceId.slice(0, 16)}...`);
                        registerWorkspaceTopic(workspaceId, canonicalTopicHash);
                    }
                } catch (e) {
                    console.warn(`[Sidecar] Failed to late-register topic:`, e.message);
                }
            }
        }
    } catch (err) {
        console.error(`[Sidecar] Error in doc-added handler for ${docName}:`, err);
    }
});

// P2P stack is NOT auto-started - use toggle-tor command to enable
console.log('[Sidecar] Running in OFFLINE mode by default. Use toggle-tor to enable P2P.');

// --- Graceful Shutdown ---
let isShuttingDown = false;

async function shutdown() {
    // Prevent multiple shutdown attempts
    if (isShuttingDown) {
        console.log('[Sidecar] Shutdown already in progress...');
        return;
    }
    isShuttingDown = true;
    
    console.log('[Sidecar] Shutting down...');
    
    // Set a hard timeout for shutdown (30 seconds)
    const shutdownTimeout = setTimeout(() => {
        console.error('[Sidecar] Shutdown timeout exceeded, forcing exit');
        process.exit(1);
    }, 30000);
    
    try {
        // Close WebSocket servers first to stop accepting new connections
        if (metaWss) {
            console.log('[Sidecar] Closing metadata WebSocket server...');
            await new Promise((resolve) => {
                metaWss.clients.forEach(client => client.close(1001, 'Server shutting down'));
                metaWss.close(() => resolve());
            });
            console.log('[Sidecar] Metadata WebSocket server closed');
        }
        
        if (yjsWss) {
            console.log('[Sidecar] Closing Yjs WebSocket server...');
            await new Promise((resolve) => {
                yjsWss.clients.forEach(client => client.close(1001, 'Server shutting down'));
                yjsWss.close(() => resolve());
            });
            console.log('[Sidecar] Yjs WebSocket server closed');
        }
        
        if (yjsWssSecure) {
            console.log('[Sidecar] Closing secure Yjs WebSocket server...');
            await new Promise((resolve) => {
                yjsWssSecure.clients.forEach(client => client.close(1001, 'Server shutting down'));
                yjsWssSecure.close(() => resolve());
            });
            console.log('[Sidecar] Secure Yjs WebSocket server closed');
        }
        
        // Disconnect relay bridge
        if (relayBridgeEnabled) {
            console.log('[Sidecar] Disconnecting relay bridge...');
            relayBridge.disconnectAll();
        }
        
        // Stop P2P bridge
        if (p2pBridge) {
            console.log('[Sidecar] Stopping P2P bridge...');
            try {
                await p2pBridge.destroy();
                console.log('[Sidecar] P2P bridge stopped');
            } catch (err) {
                console.error('[Sidecar] Error stopping P2P bridge:', err);
            }
        }
        
        // Stop P2P node (libp2p)
        if (p2pNode) {
            console.log('[Sidecar] Stopping P2P node...');
            try {
                await p2pNode.stop();
                console.log('[Sidecar] P2P node stopped');
            } catch (err) {
                console.error('[Sidecar] Error stopping P2P node:', err);
            }
        }
        
        // Unmap UPnP ports (only if upnpMapper was loaded)
        if (upnpStatus.wsPortMapped || upnpStatus.wssPortMapped) {
            console.log('[Sidecar] Unmapping UPnP ports...');
            const { unmapPort } = getUPnPMapper();
            if (upnpStatus.wsPortMapped) {
                await unmapPort(YJS_WEBSOCKET_PORT);
            }
            if (upnpStatus.wssPortMapped) {
                await unmapPort(YJS_WEBSOCKET_SECURE_PORT);
            }
        }
        
        // Stop mesh participant
        if (meshParticipant) {
            try {
                await meshParticipant.stop();
                console.log('[Sidecar] Mesh participant stopped');
            } catch (err) {
                console.error('[Sidecar] Error stopping mesh:', err);
            }
        }
        
        // Clear pending updates
        pendingUpdates.clear();
        console.log('[Sidecar] Pending updates cleared');
        
        // Close database
        try {
            await db.close();
            console.log('[Sidecar] Database closed');
        } catch (err) {
            console.error('[Sidecar] Error closing database:', err);
        }
        
        clearTimeout(shutdownTimeout);
        console.log('[Sidecar] Graceful shutdown complete');
        process.exit(0);
    } catch (err) {
        console.error('[Sidecar] Error during shutdown:', err);
        clearTimeout(shutdownTimeout);
        process.exit(1);
    }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
