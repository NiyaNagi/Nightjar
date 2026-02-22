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
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { createRequire } from 'module';
import { MeshParticipant } from './mesh.mjs';
import { SERVER_MODES } from './mesh-constants.mjs';
import { encryptUpdate, decryptUpdate, keyFromBase64, isValidKey } from './crypto.js';

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

// Log static path resolution for debugging asset-serving issues
console.log(`[Config] STATIC_PATH = ${STATIC_PATH}`);
if (existsSync(STATIC_PATH)) {
  const assetsDir = join(STATIC_PATH, 'assets');
  if (existsSync(assetsDir)) {
    const assetFiles = readdirSync(assetsDir);
    console.log(`[Config] ${assetsDir} contains ${assetFiles.length} files: ${assetFiles.slice(0, 10).join(', ')}${assetFiles.length > 10 ? '...' : ''}`);
  } else {
    console.warn(`[Config] WARNING: ${assetsDir} does not exist — CSS/JS will 404`);
  }
} else {
  console.warn(`[Config] WARNING: STATIC_PATH ${STATIC_PATH} does not exist`);
}

const MAX_PEERS_PER_ROOM = parseInt(process.env.MAX_PEERS_PER_ROOM || '100');
const RATE_LIMIT_WINDOW = 1000;
const RATE_LIMIT_MAX = 50;

// Base path for sub-path deployments (e.g., '/app')
// Normalize: ensure leading slash, strip trailing slash, empty string for root
const RAW_BASE_PATH = (process.env.BASE_PATH || '').replace(/\/+$/, '');
const BASE_PATH = RAW_BASE_PATH && !RAW_BASE_PATH.startsWith('/') 
  ? '/' + RAW_BASE_PATH 
  : RAW_BASE_PATH;

if (BASE_PATH) {
  console.log(`[Config] BASE_PATH set to: ${BASE_PATH}`);
}

// Server mode: host, relay, or private
// - host: Full persistence + mesh participation (default)
// - relay: Signaling only + mesh participation, no persistence
// - private: Full features, no mesh (for private deployments)
const SERVER_MODE = process.env.NIGHTJAR_MODE || SERVER_MODES.HOST;
const PUBLIC_URL = process.env.PUBLIC_URL || null; // e.g., wss://relay1.nightjar.co

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

// Encrypted persistence: encrypts Yjs document state at rest in SQLite
// When enabled, clients must deliver encryption keys via HTTP POST before connecting
// Default ON — set ENCRYPTED_PERSISTENCE=false or ENCRYPTED_PERSISTENCE=0 to disable.
const ENCRYPTED_PERSISTENCE = process.env.ENCRYPTED_PERSISTENCE !== '0' &&
                              process.env.ENCRYPTED_PERSISTENCE !== 'false';

if (ENCRYPTED_PERSISTENCE) {
  console.log('[Config] Encrypted persistence ENABLED - Yjs state will be encrypted at rest');
} else {
  console.log('[Config] Encrypted persistence DISABLED - Yjs state will be stored in cleartext');
}

// In-memory key store for encrypted persistence
// Maps room name -> Uint8Array encryption key
// Keys are delivered by clients via POST /api/rooms/:roomName/key before WebSocket connect
const documentKeys = new Map();

// Track rooms that had encrypted data but no key during bindState (deferred load)
// These will be loaded when the key arrives
const pendingKeyLoads = new Set();

/**
 * Get the encryption key for a document/room
 * @param {string} roomName - The Yjs room name
 * @returns {Uint8Array|null} The key, or null if not available
 */
function getKeyForDocument(roomName) {
  return documentKeys.get(roomName) || null;
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
      // Cleanup: delete expired invites (expires_at < now)
      deleteExpiredInvites: this.db.prepare('DELETE FROM invites WHERE expires_at IS NOT NULL AND expires_at < ?'),
      // Nuclear cleanup: delete ALL invites older than 24 hours from creation regardless of expiry
      nuclearDeleteOldInvites: this.db.prepare('DELETE FROM invites WHERE created_at < ?'),
      // TODO: Encrypt invite rows at rest — currently entity metadata (type, ID, permission)
      // is stored in cleartext in SQLite. While secrets (passwords, keys) are never stored
      // server-side, the metadata could be encrypted with a server-level key to reduce
      // exposure if the database file is compromised.
      
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
    const parsedExpiresIn = expiresIn != null ? parseInt(expiresIn, 10) : null;
    const expiresAt = parsedExpiresIn && Number.isFinite(parsedExpiresIn) ? now + parsedExpiresIn : null;
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
   * Delete all invites that have passed their expires_at timestamp.
   * @param {number} now - Current timestamp (Date.now())
   * @returns {{ changes: number }} Number of deleted rows
   */
  deleteExpiredInvites(now) {
    return this._stmts.deleteExpiredInvites.run(now);
  }

  /**
   * Nuclear cleanup: delete ALL invites older than cutoff regardless of expiry.
   * This ensures no invite persists beyond 24 hours from creation.
   * @param {number} cutoff - Timestamp cutoff (invites created before this are deleted)
   * @returns {{ changes: number }} Number of deleted rows
   */
  nuclearDeleteOldInvites(cutoff) {
    return this._stmts.nuclearDeleteOldInvites.run(cutoff);
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
    this.sessionTokens = new Map(); // sessionToken -> { peerId, ws }
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
    const sessionToken = nanoid(32);
    
    this.peerInfo.set(ws, {
      peerId,
      roomId: null,
      profile: null,
      sessionToken,
      rateLimiter: new RateLimiter(RATE_LIMIT_WINDOW, RATE_LIMIT_MAX)
    });

    this.sessionTokens.set(sessionToken, { peerId, ws });

    this.send(ws, {
      type: 'welcome',
      peerId,
      sessionToken,
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

      // P2P Protocol: Relay a message to a specific peer
      case 'relay-message':
        this.handleRelayMessage(ws, info, msg);
        break;

      // P2P Protocol: Broadcast a message to all peers in the same topics
      case 'relay-broadcast':
        this.handleRelayBroadcast(ws, info, msg);
        break;
        
      default:
        this.send(ws, { type: 'error', error: 'unknown_type' });
    }
  }

  /**
   * Join a room (workspace)
   */
  handleJoin(ws, info, msg) {
    const { roomId, profile, authToken } = msg;
    
    if (!roomId || typeof roomId !== 'string' || roomId.length > 256) {
      this.send(ws, { type: 'error', error: 'invalid_room' });
      return;
    }

    // Fix 4: HMAC room-join authentication
    const authResult = validateRoomAuthToken(roomId, authToken);
    if (!authResult.allowed) {
      this.send(ws, { type: 'error', error: authResult.reason });
      return;
    }

    // Leave current room if any
    if (info.roomId) {
      this.handleLeave(ws, info);
    }

    // Create room if needed
    if (!this.rooms.has(roomId)) {
      // Prevent unbounded room creation (DoS)
      if (this.rooms.size >= MAX_PEERS_PER_ROOM * 100) {
        this.send(ws, { type: 'error', error: 'server_room_limit' });
        return;
      }
      this.rooms.set(roomId, new Set());
    }

    const room = this.rooms.get(roomId);
    
    if (room.size >= MAX_PEERS_PER_ROOM) {
      this.send(ws, { type: 'error', error: 'room_full' });
      return;
    }

    room.add(ws);
    info.roomId = roomId;
    // Validate profile to prevent memory abuse from untrusted clients
    if (profile && typeof profile === 'object' && profile !== null) {
      const profileStr = JSON.stringify(profile);
      info.profile = profileStr.length <= 4096 ? profile : null;
    }

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
    const { topic, peerId: clientPeerId, authToken } = msg;
    if (!topic || typeof topic !== 'string' || topic.length > 256) return;

    // Use topic as room ID for P2P purposes
    const roomId = `p2p:${topic}`;

    // Fix 4: HMAC room-join authentication
    // Validates that the client holds the workspace encryption key
    const authResult = validateRoomAuthToken(roomId, authToken);
    if (!authResult.allowed) {
      this.send(ws, { type: 'error', error: authResult.reason });
      return;
    }
    
    if (!this.rooms.has(roomId)) {
      // Prevent unbounded room creation (DoS)
      if (this.rooms.size >= MAX_PEERS_PER_ROOM * 100) {
        this.send(ws, { type: 'error', error: 'server_room_limit' });
        return;
      }
      this.rooms.set(roomId, new Set());
    }

    const room = this.rooms.get(roomId);
    
    // Check room capacity (consistent with handleJoin)
    if (room.size >= MAX_PEERS_PER_ROOM) {
      this.send(ws, { type: 'error', error: 'topic_full' });
      return;
    }
    
    // Track the topic in peer info - limit max topics per peer to prevent resource exhaustion
    // Check BEFORE adding to room to avoid ghost peer leak on early return
    if (!info.topics) info.topics = new Set();
    if (info.topics.size >= 50) {
      this.send(ws, { type: 'error', error: 'too_many_topics' });
      return;
    }

    room.add(ws);
    info.topics.add(topic);
    // NOTE: Do NOT allow client to override server-assigned peerId.
    // Accepting clientPeerId here would enable impersonation attacks
    // where an attacker intercepts messages destined for another peer.

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

    // Only search rooms/topics the sender participates in (prevents O(n*m) scan of all rooms)
    const roomsToSearch = [];
    if (info.roomId) {
      const r = this.rooms.get(info.roomId);
      if (r) roomsToSearch.push(r);
    }
    if (info.topics) {
      for (const topic of info.topics) {
        const r = this.rooms.get(`p2p:${topic}`);
        if (r) roomsToSearch.push(r);
      }
    }

    for (const room of roomsToSearch) {
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
   * Handle relay-message: forward an arbitrary message to a specific peer.
   * Used by clients for P2P chunk-request/chunk-response/chunk-seed etc.
   * The server is opaque to the payload — it just routes it.
   */
  handleRelayMessage(ws, info, msg) {
    const { targetPeerId, payload, encryptedPayload } = msg;
    if (!targetPeerId || (!payload && !encryptedPayload)) {
      this.send(ws, { type: 'error', error: 'relay_missing_target_or_payload' });
      return;
    }

    // Guard against oversized relay payloads
    // Raised from 64KB to 2MB to support file chunk transfer (1MB chunks → ~1.37MB base64)
    const MAX_RELAY_MESSAGE_SIZE = 2 * 1024 * 1024; // 2 MB
    const dataToCheck = encryptedPayload || JSON.stringify(payload);
    if ((typeof dataToCheck === 'string' ? dataToCheck.length : 0) > MAX_RELAY_MESSAGE_SIZE) {
      this.send(ws, { type: 'error', error: 'relay_payload_too_large', maxBytes: MAX_RELAY_MESSAGE_SIZE });
      return;
    }

    // Verify sender is in at least one topic (authenticated participation)
    if (!info.topics || info.topics.size === 0) {
      this.send(ws, { type: 'error', error: 'not_in_topic' });
      return;
    }

    // Find target peer — must share at least one topic with sender
    for (const topic of info.topics) {
      const roomId = `p2p:${topic}`;
      const room = this.rooms.get(roomId);
      if (!room) continue;

      for (const peer of room) {
        const pInfo = this.peerInfo.get(peer);
        if (pInfo && pInfo.peerId === targetPeerId) {
          // Fix 6: If client sent encryptedPayload, forward the opaque
          // encrypted envelope without reading its contents.
          if (encryptedPayload) {
            this.send(peer, {
              type: 'relay-message',
              encryptedPayload,
              _fromPeerId: info.peerId,
              _relayed: true,
            });
          } else {
            // Legacy plaintext relay — forward with sender info
            // Use Object.create(null) as base to prevent prototype pollution from untrusted payload
            const forwarded = Object.create(null);
            Object.assign(forwarded, payload);
            forwarded._fromPeerId = info.peerId;
            forwarded._relayed = true;
            this.send(peer, forwarded);
          }
          return;
        }
      }
    }

    // Target not found in any shared topic
    this.send(ws, { type: 'error', error: 'relay_target_not_found' });
  }

  /**
   * Handle relay-broadcast: broadcast an arbitrary message to all peers
   * in the sender's topics. Used for chunk-seed announcements etc.
   */
  handleRelayBroadcast(ws, info, msg) {
    const { payload, encryptedPayload } = msg;
    if (!payload && !encryptedPayload) {
      this.send(ws, { type: 'error', error: 'broadcast_missing_payload' });
      return;
    }

    // Guard against amplification DoS — reject oversized payloads
    // Raised from 64KB to 2MB to support file chunk seeding (1MB chunks → ~1.37MB base64)
    const MAX_RELAY_BROADCAST_SIZE = 2 * 1024 * 1024; // 2 MB
    const dataToCheck = encryptedPayload || JSON.stringify(payload);
    if ((typeof dataToCheck === 'string' ? dataToCheck.length : 0) > MAX_RELAY_BROADCAST_SIZE) {
      this.send(ws, { type: 'error', error: 'broadcast_payload_too_large', maxBytes: MAX_RELAY_BROADCAST_SIZE });
      return;
    }

    if (!info.topics || info.topics.size === 0) {
      this.send(ws, { type: 'error', error: 'not_in_topic' });
      return;
    }

    // Fix 6: If client sent encryptedPayload, forward the opaque envelope
    if (encryptedPayload) {
      const encrypted = {
        type: 'relay-broadcast',
        encryptedPayload,
        _fromPeerId: info.peerId,
        _relayed: true,
      };
      for (const topic of info.topics) {
        const roomId = `p2p:${topic}`;
        this.broadcast(roomId, encrypted, ws);
      }
      return;
    }

    // Legacy plaintext broadcast
    // Use Object.create(null) as base to prevent prototype pollution from untrusted payload
    const broadcastPayload = Object.create(null);
    Object.assign(broadcastPayload, payload);
    broadcastPayload._fromPeerId = info.peerId;
    broadcastPayload._relayed = true;

    // Broadcast to all topics this peer is in
    for (const topic of info.topics) {
      const roomId = `p2p:${topic}`;
      this.broadcast(roomId, broadcastPayload, ws);
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
    
    if (!docId || typeof docId !== 'string' || docId.length > 256) {
      this.send(ws, { type: 'error', error: 'missing_doc_id' });
      return;
    }

    // Limit blob sizes to prevent memory exhaustion (50MB max per blob)
    const MAX_BLOB_SIZE = 50 * 1024 * 1024;

    // Store encrypted state and/or update
    // Server receives opaque blobs - it cannot read the content
    if (encryptedState) {
      if (typeof encryptedState !== 'string' || encryptedState.length > MAX_BLOB_SIZE) {
        this.send(ws, { type: 'error', error: 'state_too_large' });
        return;
      }
      const stateBuffer = Buffer.from(encryptedState, 'base64');
      this.storage.storeDocument(info.roomId, docId, stateBuffer);
    }

    if (encryptedUpdate) {
      if (typeof encryptedUpdate !== 'string' || encryptedUpdate.length > MAX_BLOB_SIZE) {
        this.send(ws, { type: 'error', error: 'update_too_large' });
        return;
      }
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
   * Validate a session token and return the session data.
   * Used by HTTP API endpoints to verify the caller is an active WebSocket peer.
   * @param {string} token - Session token from Authorization header
   * @returns {object|null} Session data { peerId, ws } or null if invalid
   */
  validateSession(token) {
    if (!token) return null;
    const session = this.sessionTokens.get(token);
    if (!session) return null;
    // Verify the WebSocket is still open
    if (session.ws.readyState !== WebSocket.OPEN) {
      this.sessionTokens.delete(token);
      return null;
    }
    return session;
  }

  /**
   * Handle connection close
   */
  handleClose(ws) {
    const info = this.peerInfo.get(ws);
    if (info) {
      // Clean up session token
      if (info.sessionToken) {
        this.sessionTokens.delete(info.sessionToken);
      }

      // Clean up signaling room
      this.handleLeave(ws, info);
      
      // Clean up all P2P topic rooms (prevents ghost peers)
      if (info.topics) {
        for (const topic of info.topics) {
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
        }
        info.topics.clear();
      }
      
      // Remove peer info
      this.peerInfo.delete(ws);
    }
  }
}

// =============================================================================
// Server Setup
// =============================================================================

const app = express();
const server = createServer(app);

// =============================================================================
// Security Headers Middleware
// =============================================================================
// Defense-in-depth: mitigate XSS, clickjacking, MIME sniffing, and referrer leakage.
// CSP is intentionally permissive ('unsafe-inline') to avoid breaking the React SPA.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0'); // Disabled per modern best practice (CSP supersedes)
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; " +
    "font-src 'self' data:; " +
    "connect-src 'self' ws: wss: http: https:; " +
    "worker-src 'self' blob:; " +
    "frame-ancestors 'self'"
  );
  next();
});

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

// Track last activity for y-websocket docs (safety-net for stale room cleanup)
const docLastActivity = new Map(); // roomName -> timestamp
const STALE_DOC_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours
const DOC_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Check every hour

if (!DISABLE_PERSISTENCE) {
  setPersistence({
    bindState: async (docName, ydoc) => {
      // Load persisted state when a document is created/accessed
      const persistedState = storage.getYjsDoc(docName);
      if (persistedState) {
        try {
          if (ENCRYPTED_PERSISTENCE) {
            // Encrypted mode: need key to decrypt
            const key = getKeyForDocument(docName);
            if (key) {
              const decrypted = decryptUpdate(new Uint8Array(persistedState), key);
              if (decrypted) {
                Y.applyUpdate(ydoc, decrypted, 'persistence-load');
                console.log(`[Persistence] Loaded encrypted state for room: ${docName.slice(0, 20)}...`);
              } else {
                console.warn(`[Persistence] Failed to decrypt state for room: ${docName.slice(0, 20)}... (wrong key?)`);
              }
            } else {
              // No key yet — mark for deferred load when key arrives
              pendingKeyLoads.add(docName);
              console.log(`[Persistence] No key for room: ${docName.slice(0, 20)}... — deferring load until key arrives`);
            }
          } else {
            // Unencrypted mode: direct apply (original behavior)
            Y.applyUpdate(ydoc, persistedState, 'persistence-load');
            console.log(`[Persistence] Loaded state for room: ${docName.slice(0, 20)}...`);
          }
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
            if (ENCRYPTED_PERSISTENCE) {
              const key = getKeyForDocument(docName);
              if (key) {
                const encrypted = encryptUpdate(state, key);
                if (encrypted) {
                  storage.storeYjsDoc(docName, Buffer.from(encrypted));
                } else {
                  console.error(`[Persistence] Encryption failed for room ${docName} — state NOT persisted`);
                }
              } else {
                console.warn(`[Persistence] No key for room ${docName} — skipping encrypted persist`);
              }
            } else {
              storage.storeYjsDoc(docName, Buffer.from(state));
            }
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
        if (ENCRYPTED_PERSISTENCE) {
          const key = getKeyForDocument(docName);
          if (key) {
            const encrypted = encryptUpdate(state, key);
            if (encrypted) {
              storage.storeYjsDoc(docName, Buffer.from(encrypted));
              console.log(`[Persistence] Final encrypted state saved for room: ${docName.slice(0, 20)}...`);
            } else {
              console.error(`[Persistence] Final encryption failed for room ${docName}`);
            }
          } else {
            console.warn(`[Persistence] No key for final write of room ${docName} — state NOT persisted`);
          }
        } else {
          storage.storeYjsDoc(docName, Buffer.from(state));
          console.log(`[Persistence] Final state saved for room: ${docName.slice(0, 20)}...`);
        }
      } catch (e) {
        console.error(`[Persistence] Failed to write final state for room ${docName}:`, e);
      }

      // Do NOT delete keys from memory when a doc is destroyed.
      // Keys are legitimately delivered and should remain available so that
      // persisted state can be decrypted when a new client reconnects.
      // Previously, deleting keys here meant reconnecting clients saw empty
      // rooms because bindState couldn't decrypt the stored data.
      if (ENCRYPTED_PERSISTENCE) {
        pendingKeyLoads.delete(docName);
      }
    }
  });

  console.log('[Persistence] SQLite persistence enabled for y-websocket');
  if (ENCRYPTED_PERSISTENCE) {
    console.log('[Persistence] At-rest encryption enabled — clients must deliver keys before connecting');
  }
} else {
  console.log('[Persistence] Disabled - server running in pure relay mode');
}

// WebSocket server for signaling (WebRTC) - 2MB max payload (supports file chunk relay)
const wssSignaling = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
wssSignaling.on('connection', (ws, req) => signaling.handleConnection(ws, req));

// WebSocket server for y-websocket (document sync) - 10MB max payload
const wssYjs = new WebSocketServer({ noServer: true, maxPayload: 10 * 1024 * 1024 });

// P2P awareness bridge: track which y-websocket docs already have an awareness
// listener attached so we don't duplicate listeners when multiple clients join
// the same room. Entries are cleaned up on doc destroy so that a fresh doc for
// the same room name gets a new listener (see doc.on('destroy') below).
const docAwarenessListeners = new Map(); // roomName -> awareness handler fn

// Track WebSocket connections with heartbeat for awareness cleanup
const wsHeartbeats = new Map();
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const HEARTBEAT_TIMEOUT = 60000; // 60 seconds - terminate if no pong

// Heartbeat interval to detect dead connections
const heartbeatInterval = setInterval(() => {
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

// Periodic cleanup of stale y-websocket docs (safety net)
// Removes docs with 0 connections that haven't been active for >24 hours
const docCleanupInterval = setInterval(() => {
  const now = Date.now();
  let cleaned = 0;

  for (const [roomName, doc] of docs) {
    const connCount = doc.conns ? doc.conns.size : 0;
    if (connCount === 0) {
      const lastActivity = docLastActivity.get(roomName) || 0;
      if (now - lastActivity > STALE_DOC_TIMEOUT_MS) {
        try {
          doc.destroy();
        } catch (e) {
          // doc.destroy() may throw if already destroyed
        }
        docs.delete(roomName);
        docLastActivity.delete(roomName);

        // Clean up related maps
        if (persistenceTimers.has(roomName)) {
          clearTimeout(persistenceTimers.get(roomName));
          persistenceTimers.delete(roomName);
        }
        docAwarenessListeners.delete(roomName);
        // Clear the auth token so reconnecting clients can re-register
        roomAuthTokens.delete(`yws:${roomName}`);

        cleaned++;
      }
    } else {
      // Update activity for docs with active connections
      docLastActivity.set(roomName, now);
    }
  }

  if (cleaned > 0) {
    console.log(`[Cleanup] Removed ${cleaned} stale y-websocket docs (${docs.size} remaining)`);
  }
}, DOC_CLEANUP_INTERVAL_MS);

// =============================================================================
// Invite Cleanup — Two-Tier Strategy
// =============================================================================
// 1. Hourly: Delete invites that have passed their expires_at timestamp
// 2. Nuclear (every 6 hours): Delete ALL invites older than 24h from creation,
//    regardless of their expires_at value. This is a hard ceiling to ensure
//    no invite persists indefinitely even if it was created without an expiry.
// =============================================================================

const INVITE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Every hour
const NUCLEAR_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // Every 6 hours
const MAX_INVITE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours absolute maximum

let lastNuclearCleanup = Date.now();

const inviteCleanupInterval = setInterval(() => {
  const now = Date.now();
  
  try {
    // Tier 1: Delete expired invites (expires_at < now)
    const expiredResult = storage.deleteExpiredInvites(now);
    if (expiredResult.changes > 0) {
      console.log(`[Invite Cleanup] Deleted ${expiredResult.changes} expired invites`);
    }
    
    // Tier 2: Nuclear cleanup every 6 hours — delete ALL invites older than 24h
    if (now - lastNuclearCleanup >= NUCLEAR_CLEANUP_INTERVAL_MS) {
      const cutoff = now - MAX_INVITE_AGE_MS;
      const nuclearResult = storage.nuclearDeleteOldInvites(cutoff);
      if (nuclearResult.changes > 0) {
        console.log(`[Invite Cleanup] NUCLEAR: Deleted ${nuclearResult.changes} invites older than 24h`);
      }
      lastNuclearCleanup = now;
    }
  } catch (err) {
    console.error('[Invite Cleanup] Error during invite cleanup:', err);
  }
}, INVITE_CLEANUP_INTERVAL_MS);

wssYjs.on('connection', (ws, req) => {
  // Extract room name from URL
  const roomName = req.url.slice(1).split('?')[0] || 'default';
  
  // Fix 4: HMAC room-join authentication for y-websocket
  const urlParams = new URLSearchParams(req.url.includes('?') ? req.url.split('?')[1] : '');
  const ywsAuthToken = urlParams.get('auth') || undefined;
  const ywsAuthResult = validateRoomAuthToken(`yws:${roomName}`, ywsAuthToken);
  if (!ywsAuthResult.allowed) {
    console.warn(`[Y-WS] Auth rejected for room: ${roomName.slice(0, 30)}... reason: ${ywsAuthResult.reason}`);
    ws.close(4403, ywsAuthResult.reason);
    return;
  }

  console.log(`[Y-WS] Client connected to room: ${roomName.slice(0, 30)}...`);
  
  // Track connection for heartbeat
  wsHeartbeats.set(ws, { lastPong: Date.now(), roomName });

  // Track document activity for stale cleanup
  docLastActivity.set(roomName, Date.now());
  
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

  // ── P2P awareness bridge ─────────────────────────────────────────────
  // After setupWSConnection the doc is guaranteed to exist in the y-ws
  // `docs` map. Attach an awareness change listener ONCE per doc so we
  // can bridge awareness state to signaling (P2P) peers.
  const doc = docs.get(roomName);
  if (doc && !docAwarenessListeners.has(roomName)) {
    if (doc.awareness) {
      const awarenessHandler = ({ added, updated, removed }) => {
        const changed = [...added, ...updated, ...removed];
        if (changed.length === 0) return;

        // Build a lightweight state snapshot for the changed clients
        const states = {};
        for (const clientId of changed) {
          const s = doc.awareness.getStates().get(clientId);
          if (s) states[clientId] = s;
        }

        // Relay to any signaling peers in the same room
        signaling.broadcast(roomName, {
          type: 'awareness_update',
          roomName,
          states,
        });
      };

      doc.awareness.on('update', awarenessHandler);
      docAwarenessListeners.set(roomName, awarenessHandler);
    }

    // ── FIX: clean up the awareness map entry when the doc is destroyed ──
    // y-websocket destroys a doc when all clients disconnect. Without this
    // handler the stale Map entry would prevent attaching a fresh listener
    // when a new client reconnects and y-ws creates a new doc for the
    // same room name.
    doc.on('destroy', () => {
      docAwarenessListeners.delete(roomName);
      // Clear the auth token so a reconnecting client can re-register
      // (prevents stale/wrong tokens from persisting after a race condition)
      roomAuthTokens.delete(`yws:${roomName}`);
      console.log(`[Y-WS] Doc destroyed, cleared awareness listener and auth token for room: ${roomName.slice(0, 30)}...`);
    });
  }
});

// Handle HTTP upgrade - route to appropriate WebSocket server
server.on('upgrade', (request, socket, head) => {
  let pathname = request.url;
  
  // Strip BASE_PATH prefix from WebSocket URLs
  if (BASE_PATH && pathname.startsWith(BASE_PATH)) {
    pathname = pathname.slice(BASE_PATH.length) || '/';
  }
  
  if (pathname === '/signal') {
    // WebRTC signaling
    wssSignaling.handleUpgrade(request, socket, head, (ws) => {
      wssSignaling.emit('connection', ws, request);
    });
  } else {
    // Strip BASE_PATH from request.url so y-websocket extracts correct room names
    if (BASE_PATH && request.url.startsWith(BASE_PATH)) {
      request.url = request.url.slice(BASE_PATH.length) || '/';
    }
    // y-websocket for document sync (all other paths)
    wssYjs.handleUpgrade(request, socket, head, (ws) => {
      wssYjs.emit('connection', ws, request);
    });
  }
});

// Redirect root to BASE_PATH if set
if (BASE_PATH) {
  app.get('/', (req, res) => res.redirect(BASE_PATH + '/'));
}

// CORS headers for API endpoints
app.use(BASE_PATH + '/api', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// JSON body parsing — must be registered before any POST routes that read req.body
app.use(express.json({ limit: '1mb' }));

// Health check
app.get(BASE_PATH + '/health', (req, res) => {
  // Only return status - do not expose room count, uptime, or server config to unauthenticated callers
  res.json({ status: 'ok' });
});

// API: Get mesh network status
app.get(BASE_PATH + '/api/mesh/status', (req, res) => {
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
app.get(BASE_PATH + '/api/mesh/relays', (req, res) => {
  if (!meshParticipant) {
    return res.json({ relays: [] });
  }
  
  const parsedLimit = parseInt(req.query.limit, 10);
  const limit = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 5, 1), 20);
  res.json({
    relays: meshParticipant.getTopRelays(limit).map(r => ({
      url: r.endpoints[0],
      persist: r.capabilities?.persist || false,
      uptime: r.uptime
    }))
  });
});

// API: Check if encrypted persistence is enabled
// Returns false when persistence is disabled entirely (relay mode) — even if
// ENCRYPTED_PERSISTENCE env var is true, there is nothing to encrypt.
app.get(BASE_PATH + '/api/encrypted-persistence', (req, res) => {
  res.json({ enabled: ENCRYPTED_PERSISTENCE && !DISABLE_PERSISTENCE });
});

// =============================================================================
// Encrypted Persistence Key Delivery API
// =============================================================================

// Rate limiter for key delivery (prevent brute-force key submission)
const keyDeliveryLimiter = new Map(); // ip -> { count, resetAt }
const KEY_DELIVERY_RATE_LIMIT = 30; // max per window
const KEY_DELIVERY_RATE_WINDOW = 60000; // 1 minute

// Track which Ed25519 public key "owns" each room's encryption key.
// Prevents unauthorized key overwrite by a different identity.
// Maps roomName -> base64-encoded Ed25519 public key string
const roomKeyOwners = new Map();

// =============================================================================
// Fix 4: HMAC Room-Join Authentication
// =============================================================================
// Tracks the HMAC auth token for each signaling topic / y-websocket room.
// First client to present a valid token "registers" it; subsequent clients
// must present the same token to prove they hold the workspace encryption key.
// Maps: topic-or-room string -> base64-encoded HMAC-SHA256 token
const roomAuthTokens = new Map();

/**
 * Validate an HMAC room-auth token.
 * - If no token is stored yet for this room, register the provided one (first-write-wins).
 * - If a token is already stored, the provided one must match.
 * - If the client does not provide a token, allow for backward compatibility.
 * @param {string} roomId - The room/topic identifier
 * @param {string|undefined} authToken - The HMAC auth token from the client
 * @returns {{ allowed: boolean, reason?: string }}
 */
function validateRoomAuthToken(roomId, authToken) {
  if (!authToken) {
    // Backward compatibility: older clients don't send auth tokens.
    // Once a room has a registered token, unauthenticated joins are blocked.
    if (roomAuthTokens.has(roomId)) {
      return { allowed: false, reason: 'room_requires_auth' };
    }
    return { allowed: true };
  }

  if (typeof authToken !== 'string' || authToken.length > 256) {
    return { allowed: false, reason: 'invalid_auth_token' };
  }

  const existingToken = roomAuthTokens.get(roomId);
  if (!existingToken) {
    // First client to auth — register token
    roomAuthTokens.set(roomId, authToken);
    return { allowed: true };
  }

  // Constant-time comparison to prevent timing attacks
  if (existingToken.length !== authToken.length) {
    return { allowed: false, reason: 'auth_token_mismatch' };
  }
  const a = Buffer.from(existingToken);
  const b = Buffer.from(authToken);
  const { timingSafeEqual } = require('crypto');
  if (!timingSafeEqual(a, b)) {
    return { allowed: false, reason: 'auth_token_mismatch' };
  }

  return { allowed: true };
}

/**
 * Verify an Ed25519 signature.
 * @param {string} messageString - The original message that was signed
 * @param {string} signatureBase64 - Base64-encoded 64-byte Ed25519 signature
 * @param {string} publicKeyBase64 - Base64-encoded 32-byte Ed25519 public key
 * @returns {boolean} True if valid
 */
function verifyEd25519Signature(messageString, signatureBase64, publicKeyBase64) {
  try {
    const nacl = require('tweetnacl');
    const message = Buffer.from(messageString, 'utf-8');
    const signature = Buffer.from(signatureBase64, 'base64');
    const publicKey = Buffer.from(publicKeyBase64, 'base64');
    
    if (signature.length !== 64 || publicKey.length !== 32) return false;
    
    return nacl.sign.detached.verify(
      new Uint8Array(message),
      new Uint8Array(signature),
      new Uint8Array(publicKey)
    );
  } catch {
    return false;
  }
}

/**
 * POST /api/rooms/:roomName/key
 * Delivers an encryption key for a room. Must be called BEFORE WebSocket connect.
 * Only active when ENCRYPTED_PERSISTENCE=true.
 * 
 * Authenticated via Ed25519 signature to prevent unauthorized key overwrite.
 * 
 * Body: {
 *   key: "<base64-encoded 32-byte key>",
 *   publicKey: "<base64-encoded 32-byte Ed25519 public key>",
 *   signature: "<base64-encoded 64-byte Ed25519 signature>",
 *   timestamp: <unix ms>
 * }
 * 
 * The signature covers: `key-delivery:${roomName}:${keyBase64}:${timestamp}`
 * Timestamp must be within 5 minutes of server time to prevent replay attacks.
 * 
 * Response: { success: true } or { error: "..." }
 */
app.post(BASE_PATH + '/api/rooms/:roomName/key', express.json({ limit: '64kb' }), (req, res) => {
  // Only available when encrypted persistence is enabled
  if (!ENCRYPTED_PERSISTENCE) {
    return res.status(404).json({ error: 'Encrypted persistence not enabled' });
  }

  // Rate limit by IP
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();
  let limiter = keyDeliveryLimiter.get(ip);
  if (!limiter || now > limiter.resetAt) {
    limiter = { count: 0, resetAt: now + KEY_DELIVERY_RATE_WINDOW };
    keyDeliveryLimiter.set(ip, limiter);
  }
  limiter.count++;
  if (limiter.count > KEY_DELIVERY_RATE_LIMIT) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  const { roomName } = req.params;
  const { key: keyBase64, publicKey: pubKeyBase64, signature: sigBase64, timestamp } = req.body || {};

  if (!roomName || typeof roomName !== 'string' || roomName.length > 512) {
    return res.status(400).json({ error: 'Invalid room name' });
  }

  if (!keyBase64 || typeof keyBase64 !== 'string') {
    return res.status(400).json({ error: 'Missing key' });
  }

  // Parse and validate the encryption key
  const key = keyFromBase64(keyBase64);
  if (!key) {
    return res.status(400).json({ error: 'Invalid key format (must be valid base64-encoded 32-byte key)' });
  }

  // --- Ed25519 Signature Verification ---
  // If signature fields are present, verify them.
  // If absent, allow unauthenticated delivery for backward compatibility
  // (older clients that haven't updated yet).
  if (pubKeyBase64 && sigBase64 && timestamp) {
    // Validate types
    if (typeof pubKeyBase64 !== 'string' || typeof sigBase64 !== 'string' || typeof timestamp !== 'number') {
      return res.status(400).json({ error: 'Invalid signature fields' });
    }

    // Replay protection: timestamp must be within 5 minutes
    const REPLAY_WINDOW = 5 * 60 * 1000;
    if (Math.abs(now - timestamp) > REPLAY_WINDOW) {
      return res.status(400).json({ error: 'Timestamp out of range (replay protection)' });
    }

    // Verify Ed25519 signature
    const signedMessage = `key-delivery:${roomName}:${keyBase64}:${timestamp}`;
    if (!verifyEd25519Signature(signedMessage, sigBase64, pubKeyBase64)) {
      return res.status(403).json({ error: 'Invalid signature' });
    }

    // Check room ownership
    const existingOwner = roomKeyOwners.get(roomName);
    if (existingOwner && existingOwner !== pubKeyBase64) {
      // Different identity trying to deliver a key. If the key matches the
      // already-registered key, accept it — workspace members share the same
      // encryption key so this is a legitimate delivery from a different device.
      const existingKey = documentKeys.get(roomName);
      if (existingKey && key.length === existingKey.length && Buffer.from(key).equals(Buffer.from(existingKey))) {
        console.log(`[EncryptedPersistence] Same key re-delivered by different identity for room: ${roomName.slice(0, 30)}...`);
        return res.json({ success: true });
      }
      // Truly different key from different identity — reject
      return res.status(403).json({ error: 'Room key already registered by a different identity' });
    }

    // Register ownership
    roomKeyOwners.set(roomName, pubKeyBase64);
  }

  // Store the key
  documentKeys.set(roomName, key);
  console.log(`[EncryptedPersistence] Key registered for room: ${roomName.slice(0, 30)}...`);

  // If this room was waiting for a key (deferred load), trigger the load now
  if (pendingKeyLoads.has(roomName)) {
    pendingKeyLoads.delete(roomName);
    const doc = docs.get(roomName);
    if (doc && storage) {
      try {
        const encryptedState = storage.getYjsDoc(roomName);
        if (encryptedState) {
          const decrypted = decryptUpdate(new Uint8Array(encryptedState), key);
          if (decrypted) {
            Y.applyUpdate(doc, decrypted, 'persistence-load');
            console.log(`[EncryptedPersistence] Deferred load completed for room: ${roomName.slice(0, 30)}...`);
          } else {
            console.warn(`[EncryptedPersistence] Deferred load failed - decryption returned null for room: ${roomName.slice(0, 30)}...`);
          }
        }
      } catch (e) {
        console.error(`[EncryptedPersistence] Deferred load error for room ${roomName}:`, e);
      }
    }
  }

  res.json({ success: true });
});

// =============================================================================
// Bug Report Proxy (creates GitHub issues server-side using PAT)
// =============================================================================

// Simple in-memory rate limiter: max 5 reports per IP per 10 minutes
const bugReportRateLimit = new Map();
const BUG_REPORT_MAX = 5;
const BUG_REPORT_WINDOW = 10 * 60 * 1000; // 10 minutes

function checkBugReportRateLimit(ip) {
  const now = Date.now();
  const entry = bugReportRateLimit.get(ip);
  if (!entry) {
    bugReportRateLimit.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (now - entry.windowStart > BUG_REPORT_WINDOW) {
    bugReportRateLimit.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= BUG_REPORT_MAX) return false;
  entry.count++;
  return true;
}

// Periodically clean up stale rate-limit entries (every 30 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of bugReportRateLimit) {
    if (now - entry.windowStart > BUG_REPORT_WINDOW * 2) {
      bugReportRateLimit.delete(ip);
    }
  }
}, 30 * 60 * 1000);

app.post(BASE_PATH + '/api/bug-report', express.json({ limit: '256kb' }), async (req, res) => {
  try {
    const GITHUB_PAT = process.env.GITHUB_PAT || process.env.VITE_GITHUB_PAT;
    if (!GITHUB_PAT) {
      return res.status(503).json({ error: 'Bug report submission not configured on this server' });
    }

    // Rate limit by IP
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
    if (!checkBugReportRateLimit(clientIp)) {
      return res.status(429).json({ error: 'Too many bug reports. Please try again later.' });
    }

    const { title, body } = req.body;
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'Missing or empty title' });
    }
    if (!body || typeof body !== 'string') {
      return res.status(400).json({ error: 'Missing or empty body' });
    }
    // Limit sizes to prevent abuse
    if (title.length > 500) {
      return res.status(400).json({ error: 'Title too long (max 500 chars)' });
    }
    if (body.length > 65000) {
      return res.status(400).json({ error: 'Body too long (max 65000 chars)' });
    }

    const response = await fetch('https://api.github.com/repos/NiyaNagi/Nightjar/issues', {
      method: 'POST',
      headers: {
        'Authorization': `token ${GITHUB_PAT}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Nightjar-Bug-Reporter/1.0',
      },
      body: JSON.stringify({
        title: title.trim(),
        body,
        labels: ['bug'],
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[BugReport] GitHub API error:', response.status, errorData.message);
      return res.status(502).json({ error: 'Failed to create GitHub issue' });
    }

    const data = await response.json();
    console.log(`[BugReport] Created issue #${data.number}: ${data.html_url}`);
    res.json({ success: true, url: data.html_url, number: data.number });
  } catch (err) {
    console.error('[BugReport] Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =============================================================================
// Invite API (for unique share links)
// =============================================================================

// Create an invite (requires active WebSocket session)
app.post(BASE_PATH + '/api/invites', (req, res) => {
  try {
    // Authenticate: require a valid session token from an active WebSocket peer
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const sessionToken = authHeader.slice(7);
    const session = signaling.validateSession(sessionToken);
    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    if (!storage) {
      return res.status(503).json({ error: 'Persistence disabled on server' });
    }
    
    const { token, entityType, entityId, permission, requiresPassword, expiresIn, maxUses } = req.body;
    
    if (!token || !entityType || !entityId || !permission) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Validate field lengths to prevent DoS via huge tokens/IDs
    if (typeof token !== 'string' || token.length > 512 ||
        typeof entityType !== 'string' || entityType.length > 64 ||
        typeof entityId !== 'string' || entityId.length > 256 ||
        typeof permission !== 'string' || permission.length > 64) {
      return res.status(400).json({ error: 'Invalid field format or length' });
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
app.get(BASE_PATH + '/api/invites/:token', (req, res) => {
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
app.post(BASE_PATH + '/api/invites/:token/use', (req, res) => {
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

// =============================================================================
// Clickable Share Link — Serve SPA for /join/* routes
// =============================================================================
// Share links in the format:
//   https://{host}/join/{typeCode}/{base62_payload}#{fragment}
//
// are now handled entirely by the React SPA. The SPA's DeepLinkGate component
// will attempt to open nightjar:// deep links for desktop app users, then
// fall back to the web app's join flow for web-only users.
//
// SECURITY: The URL #fragment (containing secrets like passwords/keys) is
// NEVER sent to the server (RFC 3986). It is only available client-side.
//
// The /join/* route simply serves the SPA (same as the catch-all), ensuring
// the React app loads and handles the join path + fragment on the client.
// =============================================================================

// Route must be registered BEFORE the SPA fallback catch-all
// This ensures /join/* paths serve the SPA rather than returning 404
// The React app will detect /join/ in the pathname and handle it
app.get((BASE_PATH || '') + '/join/*', (req, res, next) => {
  // Safety net: if the request looks like a static asset (e.g. /join/w/assets/main.js
  // due to relative URL resolution), skip to express.static instead of returning HTML.
  // The <base> tag in the injected HTML should prevent this, but this is defense-in-depth.
  const ext = req.path.split('.').pop()?.toLowerCase();
  if (ext && /^(js|css|map|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|webp|json|wasm)$/.test(ext)) {
    return next();
  }
  // Serve the SPA — the React app will handle the share link client-side
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  if (injectedIndexHtml) {
    res.type('html').send(injectedIndexHtml);
  } else if (existsSync(indexHtmlPath)) {
    res.sendFile(indexHtmlPath);
  } else {
    res.status(404).type('text').send('SPA not found');
  }
});

// =============================================================================
// PWA Manifest — served dynamically so start_url and icon paths honour BASE_PATH.
// Registered BEFORE express.static so it takes priority over the static file.
// =============================================================================
app.get((BASE_PATH || '') + '/manifest.json', (_req, res) => {
  const manifestPath = join(STATIC_PATH, 'manifest.json');
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const prefix = BASE_PATH || '';
    // Ensure the PWA opens the app, not the landing page
    manifest.start_url = prefix + '/';
    manifest.scope    = prefix + '/';
    // Rewrite icon src paths to include BASE_PATH
    if (manifest.icons) {
      manifest.icons = manifest.icons.map(icon => ({
        ...icon,
        src: prefix + '/' + icon.src.replace(/^\.?\//, ''),
      }));
    }
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Content-Type', 'application/manifest+json');
    res.json(manifest);
  } else {
    res.status(404).type('text').send('Manifest not found');
  }
});

// Static files (React app)
// index: false prevents express.static from serving the raw index.html for
// directory requests — the SPA fallback below serves the injected version
// that includes __NIGHTJAR_BASE_PATH__ so the frontend can resolve asset URLs.

// Defense-in-depth: rewrite asset requests under /join/ sub-paths to root /assets/.
// When the SPA is served at /join/w/XXXXX with relative URLs (base:"./"), the browser
// may request /join/w/assets/main.js. The <base> tag prevents this, but older cached
// pages or edge cases may still hit these paths. Rewrite them to /assets/... so
// express.static can find the actual files.
app.use((BASE_PATH || '') + '/join/', (req, res, next) => {
  // Match /join/.../assets/... and rewrite to /assets/...
  const assetMatch = req.path.match(/\/assets\/(.*)/);
  if (assetMatch) {
    req.url = '/assets/' + assetMatch[1];
    return express.static(STATIC_PATH, { index: false })(req, res, next);
  }
  next();
});

app.use(BASE_PATH || '/', express.static(STATIC_PATH, { index: false }));

// Read index.html and inject BASE_PATH + <base> tag as runtime configuration.
// The <base href> is CRITICAL for nested routes like /join/w/XXXXX:
//   Without <base>: browser resolves ./assets/main.js → /join/w/assets/main.js (404/HTML!)
//   With <base href="/">: browser resolves ./assets/main.js → /assets/main.js (correct)
// This fixes the white-screen bug when clicking share links (Issue #6/#7).
const indexHtmlPath = join(STATIC_PATH, 'index.html');
let injectedIndexHtml = null;
if (existsSync(indexHtmlPath)) {
  let rawHtml = readFileSync(indexHtmlPath, 'utf8');
  // Inject <base> tag right after <head> — MUST come before any elements with
  // relative URLs (link, script, etc.) so the browser resolves them correctly.
  // For relay (BASE_PATH=""): <base href="/"> → ./assets/x.js resolves to /assets/x.js
  // For private (BASE_PATH="/app"): <base href="/app/"> → ./assets/x.js → /app/assets/x.js
  const baseHref = (BASE_PATH || '') + '/';
  const baseTag = `<base href="${baseHref}">`;
  rawHtml = rawHtml.replace('<head>', `<head>\n    ${baseTag}`);
  // Also inject BASE_PATH as a JS global before </head> so the frontend can
  // construct URLs programmatically (e.g., for API calls, WebSocket connections)
  const basepathScript = `<script>window.__NIGHTJAR_BASE_PATH__="${BASE_PATH || ''}";</script>`;
  injectedIndexHtml = rawHtml.replace('</head>', basepathScript + '</head>');
  console.log(`[SPA] Injected <base href="${baseHref}"> and BASE_PATH="${BASE_PATH || ''}" into index.html`);
} else {
  console.warn(`[SPA] index.html not found at ${indexHtmlPath} — SPA fallback will fail`);
}

// Guard: return 404 for asset requests that express.static couldn't find
// (prevents the SPA fallback from returning HTML with text/html MIME type
// for genuinely missing .js, .css, .png etc. files)
const ASSET_EXTENSIONS = new Set([
  'js', 'css', 'map', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico',
  'woff', 'woff2', 'ttf', 'eot', 'webp', 'avif', 'mp4', 'webm', 'json'
]);
app.use(BASE_PATH + '/assets', (req, res, next) => {
  // If we get here, express.static already failed to find the file.
  // Return 404 instead of falling through to the SPA handler.
  const ext = req.path.split('.').pop()?.toLowerCase();
  if (ext && ASSET_EXTENSIONS.has(ext)) {
    console.warn(`[Static] 404 asset not found: ${req.originalUrl}`);
    return res.status(404).type('text').send('Not found');
  }
  next();
});

// SPA fallback — only serves navigation requests (HTML pages), not assets
app.get(BASE_PATH + '/*', (req, res) => {
  // Prevent caching of the injected HTML so Cloudflare/browsers always
  // fetch the latest version with correct asset hashes
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  if (injectedIndexHtml) {
    res.type('html').send(injectedIndexHtml);
  } else {
    res.sendFile(indexHtmlPath);
  }
});
if (BASE_PATH) {
  // Also catch exact BASE_PATH without trailing slash
  app.get(BASE_PATH, (req, res) => {
    if (injectedIndexHtml) {
      res.type('html').send(injectedIndexHtml);
    } else {
      res.sendFile(indexHtmlPath);
    }
  });
}

// Start server
server.listen(PORT, async () => {
  const persistMode = DISABLE_PERSISTENCE ? 'DISABLED (relay only)' : 'ENABLED';
  const meshMode = MESH_ENABLED ? `ENABLED (${SERVER_MODE})` : 'DISABLED (private)';
  const basePath = BASE_PATH || '(root)';
  
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║              Nightjar Unified Server                      ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log(`║  HTTP:      http://localhost:${PORT}${BASE_PATH || ''}                         ║`);
  console.log(`║  Y-WS:      ws://localhost:${PORT}${BASE_PATH || ''}/<room>                    ║`);
  console.log(`║  Signaling: ws://localhost:${PORT}${BASE_PATH || ''}/signal                    ║`);
  console.log('║                                                           ║');
  console.log('║  Modes:                                                   ║');
  console.log('║  • Y-WS:       Real-time document sync                    ║');
  console.log('║  • Pure P2P:   Signaling only, no storage                 ║');
  console.log('║  • Persisted:  Server stores encrypted blobs              ║');
  console.log('║                                                           ║');
  console.log(`║  Persistence: ${persistMode.padEnd(35)}    ║`);
  console.log(`║  Mesh:        ${meshMode.padEnd(35)}    ║`);
  console.log(`║  Base Path:   ${basePath.padEnd(35)}    ║`);
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

// Graceful shutdown handler
const gracefulShutdown = async () => {
  console.log('\n[Server] Shutting down...');
  
  // Stop heartbeat interval so it doesn't fire after cleanup
  clearInterval(heartbeatInterval);

  // Stop stale doc cleanup interval
  clearInterval(docCleanupInterval);
  
  // Stop invite cleanup interval
  clearInterval(inviteCleanupInterval);
  
  // Stop mesh participation
  if (meshParticipant) {
    try {
      await meshParticipant.stop();
      console.log('[Server] Mesh participant stopped');
    } catch (err) {
      console.error('[Server] Error stopping mesh:', err);
    }
  }
  
  // Clear all pending persistence debounce timers before closing the database
  for (const [docName, timer] of persistenceTimers) {
    clearTimeout(timer);
    persistenceTimers.delete(docName);
  }

  wssSignaling.clients.forEach(ws => ws.close());
  wssYjs.clients.forEach(ws => ws.close());
  server.close(() => {
    if (storage) {
      storage.db.close();
    }
    process.exit(0);
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
