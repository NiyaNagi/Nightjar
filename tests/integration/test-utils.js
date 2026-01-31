/**
 * Test Utilities and Infrastructure
 * 
 * Shared utilities for all integration tests
 */

const WebSocket = require('ws');
const Y = require('yjs');
const { WebsocketProvider } = require('y-websocket');
const nacl = require('tweetnacl');
const crypto = require('crypto');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

// Configuration
const CONFIG = {
    YJS_WS_PORT: 8080,
    META_WS_PORT: 8081,
    SIDECAR_PATH: path.join(__dirname, '../../sidecar/index.js'),
    PROJECT_ROOT: path.join(__dirname, '../..'),
    DEFAULT_TIMEOUT: 5000,  // Reduced from 30s for faster test iteration
    CONNECTION_TIMEOUT: 10000,
};

/**
 * Check if a port is in use
 */
async function isPortInUse(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(true));
        server.once('listening', () => {
            server.close();
            resolve(false);
        });
        server.listen(port);
    });
}

/**
 * Wait for a port to become available
 */
async function waitForPort(port, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (await isPortInUse(port)) {
            return true;
        }
        await sleep(100);
    }
    throw new Error(`Timeout waiting for port ${port}`);
}

/**
 * Sleep helper
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate random hex string
 */
function randomHex(length = 32) {
    return crypto.randomBytes(length / 2).toString('hex');
}

/**
 * Generate a test document ID
 */
function generateDocId() {
    return `test-doc-${Date.now()}-${randomHex(8)}`;
}

/**
 * Generate a test workspace ID
 */
function generateWorkspaceId() {
    return `test-ws-${randomHex(16)}`;
}

/**
 * Generate a test encryption key
 */
function generateKey() {
    return nacl.randomBytes(32);
}

/**
 * TestClient - Simulates a Nahma client for testing
 */
class TestClient {
    constructor(name, options = {}) {
        this.name = name;
        this.sessionKey = options.sessionKey || generateKey();
        this.clientId = options.clientId || `client-${randomHex(8)}`;
        this.ydoc = new Y.Doc();
        this.connected = false;
        this.messages = [];
        this.yjsWs = null;
        this.metaWs = null;
        this.onMessage = options.onMessage || null;
    }

    /**
     * Connect to the metadata WebSocket
     */
    async connectMeta(port = CONFIG.META_WS_PORT) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Connection timeout'));
            }, CONFIG.CONNECTION_TIMEOUT);

            this.metaWs = new WebSocket(`ws://localhost:${port}`);

            this.metaWs.on('open', () => {
                clearTimeout(timeout);
                console.log(`[${this.name}] Connected to metadata WS`);
                
                // Send session key
                const keyBase64 = Buffer.from(this.sessionKey).toString('base64');
                this.metaWs.send(JSON.stringify({
                    type: 'set-key',
                    payload: keyBase64,
                }));

                this.connected = true;
                resolve();
            });

            this.metaWs.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    this.messages.push({ ...msg, timestamp: Date.now() });
                    if (this.onMessage) {
                        this.onMessage(msg);
                    }
                } catch (e) {
                    console.error(`[${this.name}] Parse error:`, e.message);
                }
            });

            this.metaWs.on('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });

            this.metaWs.on('close', () => {
                this.connected = false;
            });
        });
    }

    /**
     * Connect to Yjs WebSocket for a specific document
     */
    async connectYjs(docId, port = CONFIG.YJS_WS_PORT) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Yjs connection timeout'));
            }, CONFIG.CONNECTION_TIMEOUT);

            const wsUrl = `ws://localhost:${port}`;
            
            // Use WebsocketProvider for proper y-websocket protocol
            this.yjsProvider = new WebsocketProvider(wsUrl, docId, this.ydoc, {
                WebSocketPolyfill: WebSocket,
                connect: true,
            });

            // Wait for sync
            const onSync = (synced) => {
                if (synced) {
                    clearTimeout(timeout);
                    console.log(`[${this.name}] Connected to Yjs WS for doc: ${docId}`);
                    this.yjsProvider.off('sync', onSync);
                    resolve();
                }
            };

            this.yjsProvider.on('sync', onSync);

            // Also resolve on status connected if already synced
            this.yjsProvider.on('status', ({ status }) => {
                if (status === 'connected' && this.yjsProvider.synced) {
                    clearTimeout(timeout);
                    this.yjsProvider.off('sync', onSync);
                    resolve();
                }
            });

            // Check if already synced
            if (this.yjsProvider.synced) {
                clearTimeout(timeout);
                console.log(`[${this.name}] Connected to Yjs WS for doc: ${docId}`);
                resolve();
            }
        });
    }

    /**
     * Send a message via metadata WebSocket
     */
    send(message) {
        if (!this.metaWs || this.metaWs.readyState !== WebSocket.OPEN) {
            throw new Error('Not connected to metadata WebSocket');
        }
        this.metaWs.send(JSON.stringify(message));
    }

    /**
     * Wait for a specific message type
     */
    async waitForMessage(type, timeout = CONFIG.DEFAULT_TIMEOUT) {
        const start = Date.now();
        
        // Check existing messages first
        const existing = this.messages.find(m => m.type === type);
        if (existing) return existing;

        // Wait for new message
        return new Promise((resolve, reject) => {
            const checkInterval = setInterval(() => {
                // Check ALL messages for the type (not just new ones)
                const msg = this.messages.find(m => m.type === type);
                if (msg) {
                    clearInterval(checkInterval);
                    resolve(msg);
                }
                if (Date.now() - start > timeout) {
                    clearInterval(checkInterval);
                    // Debug: log what messages we have
                    console.log(`    [DEBUG] Received messages: ${JSON.stringify(this.messages.map(m => m.type))}`);
                    reject(new Error(`Timeout waiting for message: ${type}`));
                }
            }, 50);
        });
    }

    /**
     * Get all messages of a specific type
     */
    getMessages(type) {
        return this.messages.filter(m => m.type === type);
    }

    /**
     * Clear message history
     */
    clearMessages() {
        this.messages = [];
    }

    /**
     * Alias for messages (used in some tests)
     */
    get receivedMessages() {
        return this.messages;
    }

    /**
     * Get the raw metadata WebSocket (for advanced testing)
     */
    get ws() {
        return this.metaWs;
    }

    /**
     * Get text content from Yjs document
     */
    getText(field = 'content') {
        return this.ydoc.getText(field).toString();
    }

    /**
     * Insert text into Yjs document
     */
    insertText(text, pos = 0, field = 'content') {
        this.ydoc.getText(field).insert(pos, text);
    }

    /**
     * Delete text from Yjs document
     */
    deleteText(pos, length, field = 'content') {
        this.ydoc.getText(field).delete(pos, length);
    }

    /**
     * Create a document via metadata
     */
    async createDocument(options = {}) {
        const docId = options.id || generateDocId();
        const doc = {
            id: docId,
            name: options.name || `Test Doc ${docId.slice(-8)}`,
            type: options.type || 'text',
            workspaceId: options.workspaceId || null,
            folderId: options.folderId || null,
            createdAt: Date.now(),
            lastEdited: Date.now(),
            ...options,
        };

        this.send({ type: 'create-document', document: doc });
        await this.waitForMessage('document-created');
        return doc;
    }

    /**
     * Create a workspace
     */
    async createWorkspace(options = {}) {
        const workspaceId = options.id || generateWorkspaceId();
        const workspace = {
            id: workspaceId,
            name: options.name || `Test Workspace ${workspaceId.slice(-8)}`,
            createdAt: Date.now(),
            ...options,
        };

        this.send({ type: 'create-workspace', workspace });
        await this.waitForMessage('workspace-created');
        return workspace;
    }

    /**
     * Close all connections
     */
    close() {
        if (this.yjsProvider) {
            this.yjsProvider.disconnect();
            this.yjsProvider.destroy();
            this.yjsProvider = null;
        }
        if (this.yjsWs) {
            this.yjsWs.close();
            this.yjsWs = null;
        }
        if (this.metaWs) {
            this.metaWs.close();
            this.metaWs = null;
        }
        this.connected = false;
    }

    /**
     * Disconnect (alias for close)
     */
    disconnect() {
        this.close();
    }

    /**
     * Get the Y.Doc instance
     */
    getYDoc() {
        return this.ydoc;
    }

    /**
     * Update awareness state
     */
    updateAwareness(state) {
        if (this.yjsProvider && this.yjsProvider.awareness) {
            this.yjsProvider.awareness.setLocalStateField('user', state);
        }
    }

    /**
     * Get all awareness states
     */
    getAwarenessStates() {
        if (this.yjsProvider && this.yjsProvider.awareness) {
            return this.yjsProvider.awareness.getStates();
        }
        return new Map();
    }

    /**
     * Get the Y-websocket provider
     */
    getProvider() {
        return this.yjsProvider;
    }

    /**
     * Check if connected to Yjs
     */
    isYjsConnected() {
        return this.yjsProvider && this.yjsProvider.synced;
    }

    /**
     * Get a specific Y.Text field
     */
    getYText(field = 'content') {
        return this.ydoc.getText(field);
    }

    /**
     * Observe text changes
     */
    observeText(field, callback) {
        this.ydoc.getText(field).observe(callback);
    }

    /**
     * Unobserve text changes
     */
    unobserveText(field, callback) {
        this.ydoc.getText(field).unobserve(callback);
    }
}

/**
 * SidecarProcess - Manages a sidecar instance for testing
 */
class SidecarProcess {
    constructor(options = {}) {
        this.id = options.id || 1;
        this.port = options.metaPort || CONFIG.META_WS_PORT + (this.id - 1) * 10;
        this.yjsPort = options.yjsPort || CONFIG.YJS_WS_PORT + (this.id - 1) * 10;
        this.storageDir = options.storageDir || path.join(CONFIG.PROJECT_ROOT, `test-storage-${this.id}`);
        this.process = null;
        this.output = [];
    }

    /**
     * Start the sidecar process
     */
    async start() {
        return new Promise((resolve, reject) => {
            // Set up environment
            const env = {
                ...process.env,
                SIDECAR_META_PORT: String(this.port),
                SIDECAR_YJS_PORT: String(this.yjsPort),
                NAHMA_STORAGE_DIR: this.storageDir,
            };

            // Ensure storage directory exists
            if (!fs.existsSync(this.storageDir)) {
                fs.mkdirSync(this.storageDir, { recursive: true });
            }

            this.process = spawn('node', [CONFIG.SIDECAR_PATH], {
                env,
                cwd: CONFIG.PROJECT_ROOT,
            });

            let started = false;

            this.process.stdout.on('data', (data) => {
                const line = data.toString();
                this.output.push(line);
                
                // Check if sidecar is ready
                if (line.includes('WebSocket server listening') && !started) {
                    started = true;
                    resolve();
                }
            });

            this.process.stderr.on('data', (data) => {
                this.output.push(`[ERROR] ${data.toString()}`);
            });

            this.process.on('error', reject);

            this.process.on('exit', (code) => {
                if (!started) {
                    reject(new Error(`Sidecar exited with code ${code} before starting`));
                }
            });

            // Timeout
            setTimeout(() => {
                if (!started) {
                    this.stop();
                    reject(new Error('Sidecar start timeout'));
                }
            }, 15000);
        });
    }

    /**
     * Stop the sidecar process
     */
    stop() {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
    }

    /**
     * Clean up storage directory
     */
    cleanup() {
        this.stop();
        if (fs.existsSync(this.storageDir)) {
            fs.rmSync(this.storageDir, { recursive: true, force: true });
        }
    }
}

/**
 * NetworkSimulator - Simulates network conditions
 */
class NetworkSimulator {
    constructor() {
        this.latency = 0;
        this.packetLoss = 0;
        this.enabled = false;
    }

    /**
     * Add latency to operations
     */
    async delay() {
        if (this.enabled && this.latency > 0) {
            await sleep(this.latency);
        }
    }

    /**
     * Simulate packet loss
     */
    shouldDrop() {
        if (this.enabled && this.packetLoss > 0) {
            return Math.random() < this.packetLoss;
        }
        return false;
    }

    /**
     * Set network conditions
     */
    setConditions(options = {}) {
        this.latency = options.latency || 0;
        this.packetLoss = options.packetLoss || 0;
        this.enabled = options.enabled !== false;
    }

    /**
     * Set latency only (convenience method)
     */
    setLatency(ms) {
        this.latency = ms;
        this.enabled = true;
    }

    /**
     * Set packet loss only (convenience method)
     */
    setPacketLoss(rate) {
        this.packetLoss = rate;
        this.enabled = true;
    }

    /**
     * Reset to normal
     */
    reset() {
        this.latency = 0;
        this.packetLoss = 0;
        this.enabled = false;
    }
}

/**
 * Assertion helpers
 */
const assert = {
    equal(actual, expected, message = '') {
        if (actual !== expected) {
            throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        }
    },

    deepEqual(actual, expected, message = '') {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            throw new Error(`${message}: objects not equal`);
        }
    },

    ok(value, message = 'Assertion failed') {
        if (!value) {
            throw new Error(message);
        }
    },

    throws(fn, message = 'Expected function to throw') {
        try {
            fn();
            throw new Error(message);
        } catch (e) {
            // Expected
        }
    },

    async rejects(promise, message = 'Expected promise to reject') {
        try {
            await promise;
            throw new Error(message);
        } catch (e) {
            // Expected
        }
    },

    contains(str, substr, message = '') {
        if (!str.includes(substr)) {
            throw new Error(`${message}: "${str}" does not contain "${substr}"`);
        }
    },

    notContains(str, substr, message = '') {
        if (str.includes(substr)) {
            throw new Error(`${message}: "${str}" should not contain "${substr}"`);
        }
    },

    notEqual(actual, expected, message = '') {
        if (actual === expected) {
            throw new Error(`${message}: values should not be equal: ${JSON.stringify(actual)}`);
        }
    },

    lengthOf(arr, len, message = '') {
        if (arr.length !== len) {
            throw new Error(`${message}: expected length ${len}, got ${arr.length}`);
        }
    },
};

module.exports = {
    CONFIG,
    TestClient,
    SidecarProcess,
    NetworkSimulator,
    assert,
    sleep,
    randomHex,
    generateDocId,
    generateWorkspaceId,
    generateKey,
    isPortInUse,
    waitForPort,
};
