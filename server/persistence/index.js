/**
 * Nahma Persistence Node
 * 
 * A headless Yjs peer that:
 * 1. Connects to the signaling server
 * 2. Joins workspaces as they become active
 * 3. Stores document state in SQLite (encrypted blobs)
 * 4. Provides "always-on" sync partner
 * 
 * Security model:
 * - Stores only encrypted document blobs
 * - Cannot decrypt content (no workspace keys)
 * - Just a relay and storage node
 */

import WebSocket from 'ws';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Configuration
const SIGNALING_URL = process.env.SIGNALING_URL || 'ws://localhost:4444';
const DB_PATH = process.env.DB_PATH || join(__dirname, 'data', 'persistence.db');
const RECONNECT_DELAY = 5000;
const ROOMS_TO_JOIN = process.env.ROOMS ? process.env.ROOMS.split(',') : [];

/**
 * Storage layer using SQLite
 */
class Storage {
  constructor(dbPath) {
    this.db = new Database(dbPath);
    this._initialize();
  }

  _initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        room_id TEXT PRIMARY KEY,
        state BLOB,
        updated_at INTEGER,
        created_at INTEGER
      );
      
      CREATE TABLE IF NOT EXISTS updates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT,
        update_data BLOB,
        created_at INTEGER,
        FOREIGN KEY (room_id) REFERENCES documents(room_id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_updates_room ON updates(room_id);
    `);

    // Prepared statements
    this._getDoc = this.db.prepare('SELECT state FROM documents WHERE room_id = ?');
    this._upsertDoc = this.db.prepare(`
      INSERT INTO documents (room_id, state, updated_at, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(room_id) DO UPDATE SET state = ?, updated_at = ?
    `);
    this._insertUpdate = this.db.prepare(`
      INSERT INTO updates (room_id, update_data, created_at) VALUES (?, ?, ?)
    `);
    this._getRecentUpdates = this.db.prepare(`
      SELECT update_data FROM updates WHERE room_id = ? ORDER BY id DESC LIMIT 100
    `);
    this._pruneUpdates = this.db.prepare(`
      DELETE FROM updates WHERE room_id = ? AND id NOT IN (
        SELECT id FROM updates WHERE room_id = ? ORDER BY id DESC LIMIT 10
      )
    `);
  }

  /**
   * Get document state for a room
   */
  getDocument(roomId) {
    const row = this._getDoc.get(roomId);
    return row ? row.state : null;
  }

  /**
   * Store document state
   */
  storeDocument(roomId, state) {
    const now = Date.now();
    this._upsertDoc.run(roomId, state, now, now, state, now);
  }

  /**
   * Store an update (for history/recovery)
   */
  storeUpdate(roomId, update) {
    const now = Date.now();
    this._insertUpdate.run(roomId, update, now);
    
    // Prune old updates to save space
    this._pruneUpdates.run(roomId, roomId);
  }

  /**
   * Get list of known rooms
   */
  getRooms() {
    const rows = this.db.prepare('SELECT room_id FROM documents').all();
    return rows.map(r => r.room_id);
  }

  close() {
    this.db.close();
  }
}

/**
 * Document manager - handles Yjs docs for each room
 */
class DocumentManager {
  constructor(storage) {
    this.storage = storage;
    this.docs = new Map(); // roomId -> { doc, lastUpdate }
  }

  /**
   * Get or create a Yjs document for a room
   */
  getDocument(roomId) {
    if (this.docs.has(roomId)) {
      return this.docs.get(roomId).doc;
    }

    const doc = new Y.Doc();
    
    // Load existing state
    const savedState = this.storage.getDocument(roomId);
    if (savedState) {
      try {
        Y.applyUpdate(doc, savedState);
        console.log(`[DocManager] Loaded state for room ${roomId.slice(0, 8)}...`);
      } catch (e) {
        console.error(`[DocManager] Failed to load state for ${roomId}:`, e.message);
      }
    }

    this.docs.set(roomId, { doc, lastUpdate: Date.now() });
    return doc;
  }

  /**
   * Apply update to document and persist
   */
  applyUpdate(roomId, update) {
    const doc = this.getDocument(roomId);
    
    try {
      Y.applyUpdate(doc, update);
      
      // Store the update
      this.storage.storeUpdate(roomId, update);
      
      // Periodically save full state
      const entry = this.docs.get(roomId);
      if (Date.now() - entry.lastUpdate > 30000) { // Every 30 seconds
        this.saveDocument(roomId);
        entry.lastUpdate = Date.now();
      }
    } catch (e) {
      console.error(`[DocManager] Failed to apply update:`, e.message);
    }
  }

  /**
   * Save document state to storage
   */
  saveDocument(roomId) {
    const entry = this.docs.get(roomId);
    if (!entry) return;

    const state = Y.encodeStateAsUpdate(entry.doc);
    this.storage.storeDocument(roomId, state);
    console.log(`[DocManager] Saved state for room ${roomId.slice(0, 8)}... (${state.length} bytes)`);
  }

  /**
   * Get state vector for sync
   */
  getStateVector(roomId) {
    const doc = this.getDocument(roomId);
    return Y.encodeStateVector(doc);
  }

  /**
   * Get state as update for sync
   */
  getStateAsUpdate(roomId, targetStateVector) {
    const doc = this.getDocument(roomId);
    return Y.encodeStateAsUpdate(doc, targetStateVector);
  }

  /**
   * Save all documents and clean up
   */
  close() {
    for (const [roomId] of this.docs) {
      this.saveDocument(roomId);
    }
    this.docs.clear();
  }
}

/**
 * Persistence node - connects to signaling and syncs documents
 */
class PersistenceNode {
  constructor(signalingUrl, storage) {
    this.signalingUrl = signalingUrl;
    this.storage = storage;
    this.docManager = new DocumentManager(storage);
    
    this.ws = null;
    this.peerId = null;
    this.connected = false;
    this.rooms = new Set();
    this.peers = new Map(); // peerId -> { roomId }
    
    this._destroyed = false;
  }

  /**
   * Connect to signaling server
   */
  connect() {
    if (this._destroyed) return;

    console.log(`[Persistence] Connecting to ${this.signalingUrl}...`);
    
    this.ws = new WebSocket(this.signalingUrl);
    
    this.ws.on('open', () => {
      console.log('[Persistence] Connected to signaling server');
      this.connected = true;
      
      // Join configured rooms
      for (const roomId of ROOMS_TO_JOIN) {
        this.joinRoom(roomId);
      }
      
      // Also join rooms we have stored documents for
      for (const roomId of this.storage.getRooms()) {
        if (!this.rooms.has(roomId)) {
          this.joinRoom(roomId);
        }
      }
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this._handleMessage(message);
      } catch (e) {
        console.error('[Persistence] Failed to parse message:', e.message);
      }
    });

    this.ws.on('close', () => {
      console.log('[Persistence] Disconnected from signaling server');
      this.connected = false;
      this.peers.clear();
      
      // Reconnect
      if (!this._destroyed) {
        setTimeout(() => this.connect(), RECONNECT_DELAY);
      }
    });

    this.ws.on('error', (error) => {
      console.error('[Persistence] WebSocket error:', error.message);
    });
  }

  /**
   * Handle message from signaling server
   */
  _handleMessage(message) {
    switch (message.type) {
      case 'welcome':
        this.peerId = message.peerId;
        console.log(`[Persistence] Got peer ID: ${this.peerId}`);
        break;

      case 'joined':
        console.log(`[Persistence] Joined room with ${message.peers.length} peers`);
        // Initiate sync with existing peers
        for (const peer of message.peers) {
          this._startSync(peer.peerId, message.roomId);
        }
        break;

      case 'peer_joined':
        console.log(`[Persistence] Peer ${message.peerId.slice(0, 8)} joined`);
        // Wait for them to request sync
        break;

      case 'peer_left':
        console.log(`[Persistence] Peer ${message.peerId.slice(0, 8)} left`);
        this.peers.delete(message.peerId);
        break;

      case 'signal':
        this._handleSignal(message.from, message.signal);
        break;
    }
  }

  /**
   * Join a room
   */
  joinRoom(roomId) {
    if (this.rooms.has(roomId)) return;
    
    console.log(`[Persistence] Joining room ${roomId.slice(0, 8)}...`);
    this.rooms.add(roomId);
    
    this._send({
      type: 'join',
      roomId,
      profile: {
        name: 'Nahma Persistence',
        icon: '💾',
        color: '#64748b'
      }
    });
  }

  /**
   * Start sync with a peer
   */
  _startSync(peerId, roomId) {
    this.peers.set(peerId, { roomId });
    
    // Send sync step 1 (our state vector)
    const stateVector = this.docManager.getStateVector(roomId);
    this._send({
      type: 'signal',
      to: peerId,
      signal: {
        type: 'sync-step-1',
        roomId,
        stateVector: Array.from(stateVector)
      }
    });
  }

  /**
   * Handle signaling message from peer
   */
  _handleSignal(fromPeerId, signal) {
    const peer = this.peers.get(fromPeerId);
    const roomId = signal.roomId || peer?.roomId;
    
    if (!roomId) {
      console.log(`[Persistence] No room for peer ${fromPeerId.slice(0, 8)}`);
      return;
    }

    switch (signal.type) {
      case 'sync-step-1':
        // Peer sent their state vector, send our diff + our state vector
        const diff = this.docManager.getStateAsUpdate(roomId, new Uint8Array(signal.stateVector));
        const ourStateVector = this.docManager.getStateVector(roomId);
        
        this._send({
          type: 'signal',
          to: fromPeerId,
          signal: {
            type: 'sync-step-2',
            roomId,
            update: Array.from(diff),
            stateVector: Array.from(ourStateVector)
          }
        });
        break;

      case 'sync-step-2':
        // Apply their diff
        if (signal.update && signal.update.length > 0) {
          this.docManager.applyUpdate(roomId, new Uint8Array(signal.update));
        }
        
        // Send our diff based on their state vector
        if (signal.stateVector) {
          const ourDiff = this.docManager.getStateAsUpdate(roomId, new Uint8Array(signal.stateVector));
          if (ourDiff.length > 0) {
            this._send({
              type: 'signal',
              to: fromPeerId,
              signal: {
                type: 'update',
                roomId,
                update: Array.from(ourDiff)
              }
            });
          }
        }
        break;

      case 'update':
        // Apply incremental update
        if (signal.update && signal.update.length > 0) {
          this.docManager.applyUpdate(roomId, new Uint8Array(signal.update));
        }
        break;
    }
  }

  /**
   * Send message to signaling server
   */
  _send(message) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Shutdown
   */
  async shutdown() {
    console.log('[Persistence] Shutting down...');
    this._destroyed = true;
    
    // Save all documents
    this.docManager.close();
    
    // Close WebSocket
    if (this.ws) {
      this.ws.close();
    }
    
    // Close database
    this.storage.close();
    
    console.log('[Persistence] Shutdown complete');
  }
}

// Main
async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║           Nahma Persistence Node                          ║
╠═══════════════════════════════════════════════════════════╣
║  Signaling: ${SIGNALING_URL.padEnd(44)}║
║  Database:  ${DB_PATH.slice(-44).padEnd(44)}║
║                                                           ║
║  This node stores encrypted document blobs.               ║
║  It cannot decrypt content - just provides availability.  ║
╚═══════════════════════════════════════════════════════════╝
`);

  // Ensure data directory exists
  const { mkdir } = await import('fs/promises');
  await mkdir(join(__dirname, 'data'), { recursive: true });

  // Initialize storage
  const storage = new Storage(DB_PATH);
  
  // Create persistence node
  const node = new PersistenceNode(SIGNALING_URL, storage);
  
  // Connect
  node.connect();

  // Handle shutdown
  process.on('SIGINT', async () => {
    await node.shutdown();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    await node.shutdown();
    process.exit(0);
  });
}

main().catch(console.error);
