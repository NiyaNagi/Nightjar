/**
 * Nahma Unified Server
 * 
 * A single server that provides:
 * 1. Static file hosting (React app)
 * 2. WebSocket signaling (peer discovery)
 * 3. Optional persistence (encrypted blob storage)
 * 4. y-websocket sync for document collaboration
 * 
 * SECURITY MODEL:
 * - Server NEVER has decryption keys
 * - All stored data is encrypted by clients before sending
 * - Server stores opaque blobs it cannot read
 * - Workspace keys are derived client-side and never transmitted
 * 
 * MODES:
 * - Pure P2P: Server only relays signaling, stores nothing
 * - Persisted: Server stores encrypted Yjs updates, acts as always-on peer
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { nanoid } from 'nanoid';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { createRequire } from 'module';
import { MeshParticipant } from './mesh.mjs';
import { SERVER_MODES } from './mesh-constants.mjs';

// Use createRequire to get the same Yjs instance that y-websocket uses
// This avoids the "Yjs was already imported" warning which breaks CRDT sync
const require = createRequire(import.meta.url);
const Y = require('yjs');
const { setupWSConnection, setPersistence, docs } = require('y-websocket/bin/utils');

const __dirname = dirname(fileURLToPath(import.meta.url));

// =============================================================================
// Configuration
// =============================================================================

const PORT = process.env.PORT || 3000;
const STATIC_PATH = process.env.STATIC_PATH || join(__dirname, '../../frontend/dist');
const DB_PATH = process.env.DB_PATH || join(__dirname, 'data/nahma.db');
const MAX_PEERS_PER_ROOM = parseInt(process.env.MAX_PEERS_PER_ROOM || '100');
const RATE_LIMIT_WINDOW = 1000;
const RATE_LIMIT_MAX = 50;

// Server mode: host, relay, or private
// - host: Full persistence + mesh participation (default)
// - relay: Signaling only + mesh participation, no persistence
// - private: Full features, no mesh (for private deployments)
const SERVER_MODE = process.env.NIGHTJAR_MODE || SERVER_MODES.HOST;
const PUBLIC_URL = process.env.PUBLIC_URL || null; // e.g., wss://relay1.nightjar.io

// Mesh participation: enabled for host and relay modes, disabled for private
const MESH_ENABLED = SERVER_MODE !== SERVER_MODES.PRIVATE;

// Persistence toggle: disable to run in pure relay mode
// Set via NAHMA_DISABLE_PERSISTENCE=1 or --no-persist CLI flag or relay mode
const DISABLE_PERSISTENCE = process.env.NAHMA_DISABLE_PERSISTENCE === '1' || 
                            process.env.NAHMA_DISABLE_PERSISTENCE === 'true' ||
                            process.argv.includes('--no-persist') ||
                            SERVER_MODE === SERVER_MODES.RELAY;

if (DISABLE_PERSISTENCE) {
  console.log('[Config] Persistence DISABLED - running in pure relay mode');
}

if (MESH_ENABLED) {
  console.log(`[Config] Mesh participation ENABLED (mode: ${SERVER_MODE})`);
} else {
  console.log('[Config] Mesh participation DISABLED (private mode)');
}

// Mesh participant instance (initialized after server starts)
let meshParticipant = null;

// Ensure data directory exists (only if persistence enabled)
if (!DISABLE_PERSISTENCE) {
  const dataDir = dirname(DB_PATH);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

// =============================================================================
// Storage Layer (Zero-Knowledge)
// =============================================================================

class Storage {
  constructor(dbPath) {
    this.db = new Database(dbPath);
    this._initialize();
    console.log('[Storage] Initialized at:', dbPath);
  }

  _initialize() {
    this.db.exec(`
      -- Workspaces that opted into server persistence
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        created_at INTEGER,
        last_activity INTEGER,
        persist_enabled INTEGER DEFAULT 1
      );
      
      -- Encrypted Yjs document state (opaque blobs)
      CREATE TABLE IF NOT EXISTS documents (
        workspace_id TEXT,
        doc_id TEXT,
        encrypted_state BLOB,
        updated_at INTEGER,
        PRIMARY KEY (workspace_id, doc_id)
      );
      
      -- Yjs document state for y-websocket persistence (by room name)
      CREATE TABLE IF NOT EXISTS yjs_docs (
        room_name TEXT PRIMARY KEY,
        state BLOB,
        updated_at INTEGER
      );
      
      -- Encrypted Yjs updates (for sync protocol)
      CREATE TABLE IF NOT EXISTS updates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT,
        doc_id TEXT,
        encrypted_update BLOB,
        created_at INTEGER
      );
      
      -- Invite tokens for sharing (unique tokens map to entity + permission)
      CREATE TABLE IF NOT EXISTS invites (
        token TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        permission TEXT NOT NULL,
        requires_password INTEGER DEFAULT 0,
        created_at INTEGER,
        expires_at INTEGER,
        use_count INTEGER DEFAULT 0,
        max_uses INTEGER
      );
      
      CREATE INDEX IF NOT EXISTS idx_updates_workspace ON updates(workspace_id, doc_id);
      CREATE INDEX IF NOT EXISTS idx_workspace_activity ON workspaces(last_activity);
      CREATE INDEX IF NOT EXISTS idx_invites_entity ON invites(entity_id);
    `);

    // Prepared statements
    this._stmts = {
      getWorkspace: this.db.prepare('SELECT * FROM workspaces WHERE id = ?'),
      createWorkspace: this.db.prepare('INSERT OR IGNORE INTO workspaces (id, created_at, last_activity, persist_enabled) VALUES (?, ?, ?, ?)'),
      updateActivity: this.db.prepare('UPDATE workspaces SET last_activity = ? WHERE id = ?'),
      
      getDocument: this.db.prepare('SELECT encrypted_state FROM documents WHERE workspace_id = ? AND doc_id = ?'),
      upsertDocument: this.db.prepare(`
        INSERT INTO documents (workspace_id, doc_id, encrypted_state, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(workspace_id, doc_id) DO UPDATE SET encrypted_state = ?, updated_at = ?
      `),
      
      getUpdates: this.db.prepare('SELECT encrypted_update FROM updates WHERE workspace_id = ? AND doc_id = ? ORDER BY id'),
      addUpdate: this.db.prepare('INSERT INTO updates (workspace_id, doc_id, encrypted_update, created_at) VALUES (?, ?, ?, ?)'),
      pruneUpdates: this.db.prepare('DELETE FROM updates WHERE workspace_id = ? AND doc_id = ? AND id NOT IN (SELECT id FROM updates WHERE workspace_id = ? AND doc_id = ? ORDER BY id DESC LIMIT 50)'),
      
      // Invite management
      createInvite: this.db.prepare('INSERT INTO invites (token, entity_type, entity_id, permission, requires_password, created_at, expires_at, max_uses) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
      getInvite: this.db.prepare('SELECT * FROM invites WHERE token = ?'),
      incrementInviteUse: this.db.prepare('UPDATE invites SET use_count = use_count + 1 WHERE token = ?'),
      deleteInvite: this.db.prepare('DELETE FROM invites WHERE token = ?'),
      getInvitesByEntity: this.db.prepare('SELECT * FROM invites WHERE entity_id = ?'),
      
      // Yjs document persistence (for y-websocket)
      getYjsDoc: this.db.prepare('SELECT state FROM yjs_docs WHERE room_name = ?'),
      upsertYjsDoc: this.db.prepare(`
        INSERT INTO yjs_docs (room_name, state, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(room_name) DO UPDATE SET state = ?, updated_at = ?
      `),
    };
  }

  /**
   * Create an invite token
   */
  createInvite(token, entityType, entityId, permission, options = {}) {
    const { requiresPassword = false, expiresIn = null, maxUses = null } = options;
    const now = Date.now();
    const expiresAt = expiresIn ? now + expiresIn : null;
    this._stmts.createInvite.run(token, entityType, entityId, permission, requiresPassword ? 1 : 0, now, expiresAt, maxUses);
    console.log(`[Storage] Created invite: ${token.slice(0, 8)}... for ${entityType} ${entityId.slice(0, 8)}...`);
  }

  /**
   * Get invite by token (returns null if expired or max uses reached)
   */
  getInvite(token) {
    const invite = this._stmts.getInvite.get(token);
    if (!invite) return null;
    
    // Check expiration
    if (invite.expires_at && Date.now() > invite.expires_at) {
      console.log(`[Storage] Invite expired: ${token.slice(0, 8)}...`);
      return null;
    }
    
    // Check max uses
    if (invite.max_uses && invite.use_count >= invite.max_uses) {
      console.log(`[Storage] Invite max uses reached: ${token.slice(0, 8)}...`);
      return null;
    }
    
    return {
      token: invite.token,
      entityType: invite.entity_type,
      entityId: invite.entity_id,
      permission: invite.permission,
      requiresPassword: invite.requires_password === 1,
      createdAt: invite.created_at,
      useCount: invite.use_count,
    };
  }

  /**
   * Increment invite use count
   */
  useInvite(token) {
    this._stmts.incrementInviteUse.run(token);
  }

  /**
   * Check if a workspace has persistence enabled
   */
  isPersisted(workspaceId) {
    const row = this._stmts.getWorkspace.get(workspaceId);
    return row?.persist_enabled === 1;
  }

  /**
   * Enable persistence for a workspace
   */
  enablePersistence(workspaceId) {
    const now = Date.now();
    this._stmts.createWorkspace.run(workspaceId, now, now, 1);
    console.log(`[Storage] Persistence enabled for workspace: ${workspaceId.slice(0, 8)}...`);
  }

  /**
   * Store encrypted document state (opaque blob - server cannot read)
   */
  storeDocument(workspaceId, docId, encryptedState) {
    const now = Date.now();
    this._stmts.upsertDocument.run(
      workspaceId, docId, encryptedState, now,
      encryptedState, now
    );
    this._stmts.updateActivity.run(now, workspaceId);
  }

  /**
   * Get encrypted document state
   */
  getDocument(workspaceId, docId) {
    const row = this._stmts.getDocument.get(workspaceId, docId);
    return row?.encrypted_state || null;
  }

  /**
   * Store encrypted update (for sync protocol)
   */
  storeUpdate(workspaceId, docId, encryptedUpdate) {
    const now = Date.now();
    this._stmts.addUpdate.run(workspaceId, docId, encryptedUpdate, now);
    this._stmts.updateActivity.run(now, workspaceId);
    
    // Prune old updates periodically
    if (Math.random() < 0.1) {
      this._stmts.pruneUpdates.run(workspaceId, docId, workspaceId, docId);
    }
  }

  /**
   * Get all stored updates for a document
   */
  getUpdates(workspaceId, docId) {
    return this._stmts.getUpdates.all(workspaceId, docId).map(r => r.encrypted_update);
  }

  /**
   * Get Yjs document state by room name (for y-websocket persistence)
   */
  getYjsDoc(roomName) {
    const row = this._stmts.getYjsDoc.get(roomName);
    return row?.state || null;
  }

  /**
   * Store Yjs document state by room name (for y-websocket persistence)
   */
  storeYjsDoc(roomName, state) {
    const now = Date.now();
    this._stmts.upsertYjsDoc.run(roomName, state, now, state, now);
  }
}

// =============================================================================
// Rate Limiter
// =============================================================================

class RateLimiter {
  constructor(windowMs, maxRequests) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.requests = [];
  }

  check() {
    const now = Date.now();
    this.requests = this.requests.filter(t => now - t < this.windowMs);
    if (this.requests.length >= this.maxRequests) {
      return false;
    }
    this.requests.push(now);
    return true;
  }
}

// =============================================================================
// Signaling & Room Management
// =============================================================================

class SignalingServer {
  constructor(storage) {
    this.storage = storage;
    this.rooms = new Map(); // roomId -> Set<WebSocket>
    this.peerInfo = new WeakMap(); // WebSocket -> PeerInfo
  }

  /**
   * Send JSON message to a peer
   */
  send(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast to room except sender
   */
  broadcast(roomId, message, excludeWs = null) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    
    const data = JSON.stringify(message);
    for (const peer of room) {
      if (peer !== excludeWs && peer.readyState === WebSocket.OPEN) {
        peer.send(data);
      }
    }
  }

  /**
   * Get peers in a room
   */
  getPeers(roomId, excludePeerId = null) {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    
    const peers = [];
    for (const ws of room) {
      const info = this.peerInfo.get(ws);
      if (info && info.peerId !== excludePeerId) {
        peers.push({
          peerId: info.peerId,
          profile: info.profile
        });
      }
    }
    return peers;
  }

  /**
   * Handle new WebSocket connection
   */
  handleConnection(ws, req) {
    const peerId = nanoid(21);
    
    this.peerInfo.set(ws, {
      peerId,
      roomId: null,
      profile: null,
      rateLimiter: new RateLimiter(RATE_LIMIT_WINDOW, RATE_LIMIT_MAX)
    });

    this.send(ws, {
      type: 'welcome',
      peerId,
      serverTime: Date.now()
    });

    ws.on('message', (data) => this.handleMessage(ws, data));
    ws.on('close', () => this.handleClose(ws));
    ws.on('error', () => this.handleClose(ws));
  }

  /**
   * Handle incoming message
   */
  handleMessage(ws, rawData) {
    const info = this.peerInfo.get(ws);
    if (!info) return;

    if (!info.rateLimiter.check()) {
      this.send(ws, { type: 'error', error: 'rate_limited' });
      return;
    }

    let msg;
    try {
      msg = JSON.parse(rawData);
    } catch {
      this.send(ws, { type: 'error', error: 'invalid_json' });
      return;
    }

    switch (msg.type) {
      case 'join':
        this.handleJoin(ws, info, msg);
        break;
        
      case 'leave':
        this.handleLeave(ws, info);
        break;
        
      case 'signal':
        this.handleSignal(ws, info, msg);
        break;
        
      // P2P Protocol: Topic-based routing
      case 'join-topic':
        this.handleJoinTopic(ws, info, msg);
        break;
        
      case 'leave-topic':
        this.handleLeaveTopic(ws, info, msg);
        break;
        
      case 'peer-request':
        this.handlePeerRequest(ws, info, msg);
        break;
        
      case 'peer-announce':
        this.handlePeerAnnounce(ws, info, msg);
        break;
        
      case 'webrtc-signal':
        this.handleWebRTCSignal(ws, info, msg);
        break;
        
      case 'enable_persistence':
        // Client requests server storage for this workspace
        this.handleEnablePersistence(ws, info, msg);
        break;
        
      case 'store':
        // Client sends encrypted data for server storage
        this.handleStore(ws, info, msg);
        break;
        
      case 'sync_request':
        // Client requests stored data from server
        this.handleSyncRequest(ws, info, msg);
        break;
        
      case 'ping':
        this.send(ws, { type: 'pong', timestamp: Date.now() });
        break;
        
      default:
        this.send(ws, { type: 'error', error: 'unknown_type' });
    }
  }

  /**
   * Join a room (workspace)
   */
  handleJoin(ws, info, msg) {
    const { roomId, profile } = msg;
    
    if (!roomId || typeof roomId !== 'string') {
      this.send(ws, { type: 'error', error: 'invalid_room' });
      return;
    }

    // Leave current room if any
    if (info.roomId) {
      this.handleLeave(ws, info);
    }

    // Create room if needed
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Set());
    }

    const room = this.rooms.get(roomId);
    
    if (room.size >= MAX_PEERS_PER_ROOM) {
      this.send(ws, { type: 'error', error: 'room_full' });
      return;
    }

    room.add(ws);
    info.roomId = roomId;
    info.profile = profile;

    // Check if this workspace has server persistence (false if persistence disabled)
    const isPersisted = this.storage ? this.storage.isPersisted(roomId) : false;

    // Notify peer of successful join
    this.send(ws, {
      type: 'joined',
      roomId,
      peers: this.getPeers(roomId, info.peerId),
      persisted: isPersisted
    });

    // Notify others
    this.broadcast(roomId, {
      type: 'peer_joined',
      peerId: info.peerId,
      profile: info.profile
    }, ws);

    console.log(`[${info.peerId.slice(0, 8)}] joined ${roomId.slice(0, 8)}... (${room.size} peers, persisted: ${isPersisted})`);
  }

  /**
   * Leave current room
   */
  handleLeave(ws, info) {
    if (!info.roomId) return;

    const room = this.rooms.get(info.roomId);
    if (room) {
      room.delete(ws);
      
      this.broadcast(info.roomId, {
        type: 'peer_left',
        peerId: info.peerId
      });

      if (room.size === 0) {
        this.rooms.delete(info.roomId);
      }

      console.log(`[${info.peerId.slice(0, 8)}] left ${info.roomId.slice(0, 8)}...`);
    }

    info.roomId = null;
  }

  /**
   * Forward WebRTC signaling
   */
  handleSignal(ws, info, msg) {
    if (!info.roomId || !msg.to || !msg.signal) return;

    const room = this.rooms.get(info.roomId);
    if (!room) return;

    for (const peer of room) {
      const pInfo = this.peerInfo.get(peer);
      if (pInfo && pInfo.peerId === msg.to) {
        this.send(peer, {
          type: 'signal',
          from: info.peerId,
          signal: msg.signal
        });
        break;
      }
    }
  }

  // ==========================================================================
  // P2P Protocol Handlers (for unified mesh networking)
  // ==========================================================================

  /**
   * Handle join-topic (P2P topic-based room joining)
   */
  handleJoinTopic(ws, info, msg) {
    const { topic, peerId: clientPeerId } = msg;
    if (!topic) return;

    // Use topic as room ID for P2P purposes
    const roomId = `p2p:${topic}`;
    
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Set());
    }

    const room = this.rooms.get(roomId);
    room.add(ws);
    
    // Track the topic in peer info
    if (!info.topics) info.topics = new Set();
    info.topics.add(topic);
    if (clientPeerId) info.peerId = clientPeerId;

    // Send current peers in topic
    const peers = [];
    for (const peer of room) {
      if (peer !== ws) {
        const pInfo = this.peerInfo.get(peer);
        if (pInfo) {
          peers.push({
            peerId: pInfo.peerId,
            transports: { websocket: true, webrtc: true },
            displayName: pInfo.profile?.name || 'Anonymous',
            color: pInfo.profile?.color || '#808080',
          });
        }
      }
    }

    this.send(ws, { type: 'peer-list', peers, timestamp: Date.now() });

    // Notify others
    this.broadcast(roomId, {
      type: 'peer-joined',
      peerId: info.peerId,
      info: info.profile || {},
    }, ws);

    console.log(`[P2P] ${info.peerId?.slice(0, 8)} joined topic ${topic.slice(0, 16)}... (${room.size} peers)`);
  }

  /**
   * Handle leave-topic
   */
  handleLeaveTopic(ws, info, msg) {
    const { topic } = msg;
    if (!topic) return;

    const roomId = `p2p:${topic}`;
    const room = this.rooms.get(roomId);
    
    if (room) {
      room.delete(ws);
      
      this.broadcast(roomId, {
        type: 'peer-left',
        peerId: info.peerId,
      });

      if (room.size === 0) {
        this.rooms.delete(roomId);
      }
    }

    info.topics?.delete(topic);
  }

  /**
   * Handle peer-request (request list of connected peers)
   */
  handlePeerRequest(ws, info, msg) {
    const peers = [];
    
    // Get peers from all topics this peer is in
    for (const topic of (info.topics || [])) {
      const roomId = `p2p:${topic}`;
      const room = this.rooms.get(roomId);
      if (!room) continue;

      for (const peer of room) {
        if (peer !== ws) {
          const pInfo = this.peerInfo.get(peer);
          if (pInfo && !peers.find(p => p.peerId === pInfo.peerId)) {
            peers.push({
              peerId: pInfo.peerId,
              transports: { websocket: true, webrtc: true },
              displayName: pInfo.profile?.name || 'Anonymous',
              color: pInfo.profile?.color || '#808080',
              lastSeen: Date.now(),
            });
          }
        }
      }
    }

    this.send(ws, { type: 'peer-list', peers, timestamp: Date.now() });
  }

  /**
   * Handle peer-announce (peer announcing itself)
   */
  handlePeerAnnounce(ws, info, msg) {
    const { peer } = msg;
    if (!peer) return;

    // Broadcast to all topics this peer is in
    for (const topic of (info.topics || [])) {
      const roomId = `p2p:${topic}`;
      this.broadcast(roomId, {
        type: 'peer-announce',
        peer,
        timestamp: Date.now(),
      }, ws);
    }
  }

  /**
   * Handle webrtc-signal (forward WebRTC signaling between peers)
   */
  handleWebRTCSignal(ws, info, msg) {
    const { targetPeerId, fromPeerId, signalData } = msg;
    if (!targetPeerId || !signalData) return;

    // Find target peer in any room
    for (const [roomId, room] of this.rooms) {
      for (const peer of room) {
        const pInfo = this.peerInfo.get(peer);
        if (pInfo && pInfo.peerId === targetPeerId) {
          this.send(peer, {
            type: 'webrtc-signal',
            fromPeerId: fromPeerId || info.peerId,
            signalData,
            timestamp: Date.now(),
          });
          return;
        }
      }
    }
  }

  /**
   * Enable server persistence for a workspace
   */
  handleEnablePersistence(ws, info, msg) {
    if (!info.roomId) {
      this.send(ws, { type: 'error', error: 'not_in_room' });
      return;
    }

    // Check if persistence is available
    if (!this.storage) {
      this.send(ws, { type: 'error', error: 'persistence_disabled_on_server' });
      return;
    }

    this.storage.enablePersistence(info.roomId);
    
    // Notify all peers in room
    this.broadcast(info.roomId, {
      type: 'persistence_enabled',
      workspaceId: info.roomId
    });

    this.send(ws, { type: 'persistence_confirmed' });
  }

  /**
   * Store encrypted data (server cannot decrypt)
   */
  handleStore(ws, info, msg) {
    if (!info.roomId) {
      this.send(ws, { type: 'error', error: 'not_in_room' });
      return;
    }

    // Check if persistence is available
    if (!this.storage) {
      this.send(ws, { type: 'error', error: 'persistence_disabled_on_server' });
      return;
    }

    if (!this.storage.isPersisted(info.roomId)) {
      this.send(ws, { type: 'error', error: 'persistence_not_enabled' });
      return;
    }

    const { docId, encryptedState, encryptedUpdate } = msg;
    
    if (!docId) {
      this.send(ws, { type: 'error', error: 'missing_doc_id' });
      return;
    }

    // Store encrypted state and/or update
    // Server receives opaque blobs - it cannot read the content
    if (encryptedState) {
      const stateBuffer = Buffer.from(encryptedState, 'base64');
      this.storage.storeDocument(info.roomId, docId, stateBuffer);
    }

    if (encryptedUpdate) {
      const updateBuffer = Buffer.from(encryptedUpdate, 'base64');
      this.storage.storeUpdate(info.roomId, docId, updateBuffer);
    }

    this.send(ws, { type: 'stored', docId });
  }

  /**
   * Handle sync request - send stored encrypted data to client
   */
  handleSyncRequest(ws, info, msg) {
    if (!info.roomId) {
      this.send(ws, { type: 'error', error: 'not_in_room' });
      return;
    }

    const { docId } = msg;
    
    if (!docId) {
      this.send(ws, { type: 'error', error: 'missing_doc_id' });
      return;
    }

    // If storage disabled or workspace not persisted, return empty
    if (!this.storage || !this.storage.isPersisted(info.roomId)) {
      this.send(ws, { type: 'sync_response', docId, data: null });
      return;
    }

    // Get stored encrypted data
    const encryptedState = this.storage.getDocument(info.roomId, docId);
    const encryptedUpdates = this.storage.getUpdates(info.roomId, docId);

    this.send(ws, {
      type: 'sync_response',
      docId,
      encryptedState: encryptedState ? encryptedState.toString('base64') : null,
      encryptedUpdates: encryptedUpdates.map(u => u.toString('base64'))
    });
  }

  /**
   * Handle connection close
   */
  handleClose(ws) {
    const info = this.peerInfo.get(ws);
    if (info) {
      this.handleLeave(ws, info);
    }
  }
}

// =============================================================================
// Server Setup
// =============================================================================

const app = express();
const server = createServer(app);

// Storage is only initialized if persistence is enabled
const storage = DISABLE_PERSISTENCE ? null : new Storage(DB_PATH);
const signaling = new SignalingServer(storage);

// =============================================================================
// y-websocket Persistence Setup
// =============================================================================

// Set up persistence for y-websocket (only if enabled)
// This saves document state to SQLite and restores it when clients reconnect

// Debounce timers for persistence (prevents rapid repeated writes)
const persistenceTimers = new Map();
const PERSISTENCE_DEBOUNCE_MS = 1000; // Wait 1 second after last update before persisting

if (!DISABLE_PERSISTENCE) {
  setPersistence({
    bindState: async (docName, ydoc) => {
      // Load persisted state when a document is created/accessed
      const persistedState = storage.getYjsDoc(docName);
      if (persistedState) {
        try {
          Y.applyUpdate(ydoc, persistedState, 'persistence-load'); // Mark origin to avoid re-persisting
          console.log(`[Persistence] Loaded state for room: ${docName.slice(0, 20)}...`);
        } catch (e) {
          console.error(`[Persistence] Failed to load state for room ${docName}:`, e);
        }
      }
      
      // Listen for updates and persist them (debounced)
      ydoc.on('update', (update, origin) => {
        // Skip updates that originated from loading persisted state
        if (origin === 'persistence-load') {
          return;
        }
        
        // Debounce: clear existing timer and set a new one
        if (persistenceTimers.has(docName)) {
          clearTimeout(persistenceTimers.get(docName));
        }
        
        persistenceTimers.set(docName, setTimeout(() => {
          try {
            const state = Y.encodeStateAsUpdate(ydoc);
            storage.storeYjsDoc(docName, Buffer.from(state));
          } catch (e) {
            console.error(`[Persistence] Failed to store update for room ${docName}:`, e);
          }
          persistenceTimers.delete(docName);
        }, PERSISTENCE_DEBOUNCE_MS));
      });
    },
    writeState: async (docName, ydoc) => {
      // Called when document is destroyed - final write
      // Cancel any pending debounced write first
      if (persistenceTimers.has(docName)) {
        clearTimeout(persistenceTimers.get(docName));
        persistenceTimers.delete(docName);
      }
      
      try {
        const state = Y.encodeStateAsUpdate(ydoc);
        storage.storeYjsDoc(docName, Buffer.from(state));
        console.log(`[Persistence] Final state saved for room: ${docName.slice(0, 20)}...`);
      } catch (e) {
        console.error(`[Persistence] Failed to write final state for room ${docName}:`, e);
      }
    }
  });

  console.log('[Persistence] SQLite persistence enabled for y-websocket');
} else {
  console.log('[Persistence] Disabled - server running in pure relay mode');
}

// WebSocket server for signaling (WebRTC)
const wssSignaling = new WebSocketServer({ noServer: true });
wssSignaling.on('connection', (ws, req) => signaling.handleConnection(ws, req));

// WebSocket server for y-websocket (document sync)
const wssYjs = new WebSocketServer({ noServer: true });

// Track WebSocket connections with heartbeat for awareness cleanup
const wsHeartbeats = new Map();
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const HEARTBEAT_TIMEOUT = 60000; // 60 seconds - terminate if no pong

// Heartbeat interval to detect dead connections
setInterval(() => {
  const now = Date.now();
  wsHeartbeats.forEach((data, ws) => {
    if (now - data.lastPong > HEARTBEAT_TIMEOUT) {
      console.log(`[Y-WS] Terminating stale connection in room: ${data.roomName?.slice(0, 30)}...`);
      ws.terminate();
      wsHeartbeats.delete(ws);
    } else if (ws.readyState === 1) { // WebSocket.OPEN
      ws.ping();
    }
  });
}, HEARTBEAT_INTERVAL);

wssYjs.on('connection', (ws, req) => {
  // Extract room name from URL
  const roomName = req.url.slice(1).split('?')[0] || 'default';
  console.log(`[Y-WS] Client connected to room: ${roomName.slice(0, 30)}...`);
  
  // Track connection for heartbeat
  wsHeartbeats.set(ws, { lastPong: Date.now(), roomName });
  
  ws.on('pong', () => {
    const data = wsHeartbeats.get(ws);
    if (data) data.lastPong = Date.now();
  });
  
  ws.on('close', () => {
    console.log(`[Y-WS] Client disconnected from room: ${roomName.slice(0, 30)}...`);
    wsHeartbeats.delete(ws);
  });
  
  ws.on('error', () => {
    wsHeartbeats.delete(ws);
  });
  
  setupWSConnection(ws, req, { docName: roomName });
});

// Handle HTTP upgrade - route to appropriate WebSocket server
server.on('upgrade', (request, socket, head) => {
  const pathname = request.url;
  
  if (pathname === '/signal') {
    // WebRTC signaling
    wssSignaling.handleUpgrade(request, socket, head, (ws) => {
      wssSignaling.emit('connection', ws, request);
    });
  } else {
    // y-websocket for document sync (all other paths)
    wssYjs.handleUpgrade(request, socket, head, (ws) => {
      wssYjs.emit('connection', ws, request);
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    rooms: signaling.rooms.size,
    uptime: process.uptime(),
    persistenceEnabled: !DISABLE_PERSISTENCE,
    meshEnabled: MESH_ENABLED,
    serverMode: SERVER_MODE
  });
});

// API: Get mesh network status
app.get('/api/mesh/status', (req, res) => {
  if (!meshParticipant) {
    return res.json({ 
      enabled: false, 
      reason: MESH_ENABLED ? 'not_started' : 'disabled' 
    });
  }
  
  res.json({
    ...meshParticipant.getStatus(),
    topRelays: meshParticipant.getTopRelays(20)
  });
});

// API: Get top relay nodes (for share link embedding)
app.get('/api/mesh/relays', (req, res) => {
  if (!meshParticipant) {
    return res.json({ relays: [] });
  }
  
  const limit = Math.min(parseInt(req.query.limit) || 5, 20);
  res.json({
    relays: meshParticipant.getTopRelays(limit).map(r => ({
      url: r.endpoints[0],
      persist: r.capabilities?.persist || false,
      uptime: r.uptime
    }))
  });
});

// API: Check if workspace is persisted
app.get('/api/workspace/:id/persisted', (req, res) => {
  if (!storage) {
    return res.json({ persisted: false, persistenceDisabled: true });
  }
  const persisted = storage.isPersisted(req.params.id);
  res.json({ persisted });
});

// =============================================================================
// Invite API (for unique share links)
// =============================================================================

app.use(express.json());

// Create an invite
app.post('/api/invites', (req, res) => {
  try {
    if (!storage) {
      return res.status(503).json({ error: 'Persistence disabled on server' });
    }
    
    const { token, entityType, entityId, permission, requiresPassword, expiresIn, maxUses } = req.body;
    
    if (!token || !entityType || !entityId || !permission) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    storage.createInvite(token, entityType, entityId, permission, {
      requiresPassword,
      expiresIn,
      maxUses
    });
    
    res.json({ success: true, token });
  } catch (err) {
    console.error('[API] Failed to create invite:', err);
    res.status(500).json({ error: 'Failed to create invite' });
  }
});

// Get invite by token
app.get('/api/invites/:token', (req, res) => {
  try {
    if (!storage) {
      return res.status(503).json({ error: 'Persistence disabled on server' });
    }
    
    const invite = storage.getInvite(req.params.token);
    
    if (!invite) {
      return res.status(404).json({ error: 'Invite not found or expired' });
    }
    
    res.json(invite);
  } catch (err) {
    console.error('[API] Failed to get invite:', err);
    res.status(500).json({ error: 'Failed to get invite' });
  }
});

// Use/redeem an invite (increment use count)
app.post('/api/invites/:token/use', (req, res) => {
  try {
    if (!storage) {
      return res.status(503).json({ error: 'Persistence disabled on server' });
    }
    
    const invite = storage.getInvite(req.params.token);
    
    if (!invite) {
      return res.status(404).json({ error: 'Invite not found or expired' });
    }
    
    storage.useInvite(req.params.token);
    
    res.json({ 
      success: true, 
      entityType: invite.entityType,
      entityId: invite.entityId,
      permission: invite.permission,
      requiresPassword: invite.requiresPassword
    });
  } catch (err) {
    console.error('[API] Failed to use invite:', err);
    res.status(500).json({ error: 'Failed to use invite' });
  }
});

// Static files (React app)
app.use(express.static(STATIC_PATH));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(join(STATIC_PATH, 'index.html'));
});

// Start server
server.listen(PORT, async () => {
  const persistMode = DISABLE_PERSISTENCE ? 'DISABLED (relay only)' : 'ENABLED';
  const meshMode = MESH_ENABLED ? `ENABLED (${SERVER_MODE})` : 'DISABLED (private)';
  
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║              Nightjar Unified Server                      ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log(`║  HTTP:      http://localhost:${PORT}                         ║`);
  console.log(`║  Y-WS:      ws://localhost:${PORT}/<room>                    ║`);
  console.log(`║  Signaling: ws://localhost:${PORT}/signal                    ║`);
  console.log('║                                                           ║');
  console.log('║  Modes:                                                   ║');
  console.log('║  • Y-WS:       Real-time document sync                    ║');
  console.log('║  • Pure P2P:   Signaling only, no storage                 ║');
  console.log('║  • Persisted:  Server stores encrypted blobs              ║');
  console.log('║                                                           ║');
  console.log(`║  Persistence: ${persistMode.padEnd(35)}    ║`);
  console.log(`║  Mesh:        ${meshMode.padEnd(35)}    ║`);
  console.log('║                                                           ║');
  console.log('║  Security:                                                ║');
  console.log('║  • Server CANNOT decrypt stored data                      ║');
  console.log('║  • All encryption happens client-side                     ║');
  console.log('║  • Workspace keys never leave the browser                 ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');
  
  // Initialize mesh participation if enabled
  if (MESH_ENABLED) {
    try {
      meshParticipant = new MeshParticipant({
        enabled: true,
        relayMode: true, // Server always acts as relay for web clients
        announceWorkspaces: false, // Server doesn't have its own workspaces
        publicUrl: PUBLIC_URL,
        persist: !DISABLE_PERSISTENCE,
        maxPeers: MAX_PEERS_PER_ROOM,
      });
      
      meshParticipant.on('relay-discovered', (relay) => {
        console.log(`[Mesh] Discovered relay: ${relay.endpoints?.[0] || relay.nodeId?.slice(0, 16)}`);
      });
      
      meshParticipant.on('error', (err) => {
        console.error('[Mesh] Error:', err);
      });
      
      await meshParticipant.start();
      console.log('[Server] Mesh network participation started');
      if (PUBLIC_URL) {
        console.log(`[Server] Announcing as relay at: ${PUBLIC_URL}`);
      } else {
        console.log('[Server] WARNING: No PUBLIC_URL set - not announcing as relay');
        console.log('[Server] Set PUBLIC_URL=wss://your.domain to join the relay mesh');
      }
    } catch (err) {
      console.error('[Server] Failed to initialize mesh:', err);
      // Non-fatal - server continues without mesh
    }
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('\n[Server] Shutting down...');
  
  // Stop mesh participation
  if (meshParticipant) {
    try {
      await meshParticipant.stop();
      console.log('[Server] Mesh participant stopped');
    } catch (err) {
      console.error('[Server] Error stopping mesh:', err);
    }
  }
  
  wssSignaling.clients.forEach(ws => ws.close());
  wssYjs.clients.forEach(ws => ws.close());
  server.close(() => {
    if (storage) {
      storage.db.close();
    }
    process.exit(0);
  });
});
