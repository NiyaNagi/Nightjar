/**
 * Embedded Relay Server for Nahma Electron App
 * 
 * A lightweight WebSocket relay server that enables Electron users
 * to serve as relay nodes for other peers (both Electron and browser).
 * 
 * Features:
 * - WebSocket signaling for WebRTC connections
 * - Room-based peer discovery
 * - Configurable max connections
 * - No persistent storage (stateless relay)
 * - Privacy-focused (no logging of personal data)
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { nanoid } from 'nanoid';

// Default configuration
const DEFAULT_PORT = 4445;
const DEFAULT_MAX_PEERS_PER_ROOM = 50;
const DEFAULT_MAX_TOTAL_CONNECTIONS = 100;

class EmbeddedRelayServer {
  constructor(options = {}) {
    this.port = options.port || DEFAULT_PORT;
    this.maxPeersPerRoom = options.maxPeersPerRoom || DEFAULT_MAX_PEERS_PER_ROOM;
    this.maxTotalConnections = options.maxTotalConnections || DEFAULT_MAX_TOTAL_CONNECTIONS;
    this.anonymousMode = options.anonymousMode !== false; // Default: no logging
    
    // State
    this.server = null;
    this.wss = null;
    this.rooms = new Map(); // roomId -> Set<WebSocket>
    this.peerInfo = new WeakMap(); // WebSocket -> { peerId, roomId, profile }
    this.totalConnections = 0;
    this.isRunning = false;
    
    // Callbacks
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onError = options.onError || ((err) => console.error('[Relay]', err));
    this.onConnectionChange = options.onConnectionChange || (() => {});
  }

  /**
   * Start the relay server
   * @returns {Promise<{success: boolean, port: number}>}
   */
  async start() {
    if (this.isRunning) {
      return { success: true, port: this.port };
    }

    return new Promise((resolve, reject) => {
      try {
        this.server = createServer();
        this.wss = new WebSocketServer({ server: this.server });

        this.wss.on('connection', (ws, req) => this._handleConnection(ws, req));
        this.wss.on('error', (err) => this.onError(err));

        this.server.listen(this.port, '0.0.0.0', () => {
          this.isRunning = true;
          this._log(`Relay server started on port ${this.port}`);
          
          this.onStatusChange({
            status: 'running',
            port: this.port,
            connections: this.totalConnections,
          });
          
          resolve({ success: true, port: this.port });
        });

        this.server.on('error', (err) => {
          this.onError(err);
          reject(err);
        });
        
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Stop the relay server
   */
  async stop() {
    if (!this.isRunning) return;

    this._log('Stopping relay server...');

    // Close all WebSocket connections
    if (this.wss) {
      for (const client of this.wss.clients) {
        client.close(1001, 'Server shutting down');
      }
      this.wss.close();
      this.wss = null;
    }

    // Close HTTP server
    if (this.server) {
      await new Promise((resolve) => this.server.close(resolve));
      this.server = null;
    }

    this.rooms.clear();
    this.totalConnections = 0;
    this.isRunning = false;

    this.onStatusChange({ status: 'stopped' });
  }

  /**
   * Get current status
   */
  getStatus() {
    const roomStats = [];
    for (const [roomId, peers] of this.rooms) {
      roomStats.push({
        roomId: roomId.slice(0, 8) + '...', // Truncated for privacy
        peerCount: peers.size,
      });
    }

    return {
      isRunning: this.isRunning,
      port: this.port,
      totalConnections: this.totalConnections,
      roomCount: this.rooms.size,
      rooms: roomStats,
      maxConnections: this.maxTotalConnections,
      maxPeersPerRoom: this.maxPeersPerRoom,
    };
  }

  // ==========================================================================
  // Private methods
  // ==========================================================================

  _log(message) {
    if (!this.anonymousMode) {
      console.log(`[Relay] ${message}`);
    }
  }

  _send(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  _broadcast(roomId, message, excludeWs = null) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const data = JSON.stringify(message);
    for (const peer of room) {
      if (peer !== excludeWs && peer.readyState === WebSocket.OPEN) {
        peer.send(data);
      }
    }
  }

  _getPeers(roomId, excludePeerId = null) {
    const room = this.rooms.get(roomId);
    if (!room) return [];

    const peers = [];
    for (const ws of room) {
      const info = this.peerInfo.get(ws);
      if (info && info.peerId !== excludePeerId) {
        peers.push({
          peerId: info.peerId,
          profile: info.profile,
        });
      }
    }
    return peers;
  }

  _handleConnection(ws, req) {
    // Check connection limit
    if (this.totalConnections >= this.maxTotalConnections) {
      ws.close(1013, 'Server at capacity');
      return;
    }

    const peerId = nanoid(21);
    this.totalConnections++;

    this.peerInfo.set(ws, {
      peerId,
      roomId: null,
      profile: null,
    });

    this._send(ws, {
      type: 'welcome',
      peerId,
      serverTime: Date.now(),
    });

    ws.on('message', (data) => this._handleMessage(ws, data));
    ws.on('close', () => this._handleClose(ws));
    ws.on('error', () => this._handleClose(ws));

    this.onConnectionChange({
      event: 'connected',
      totalConnections: this.totalConnections,
    });
  }

  _handleMessage(ws, rawData) {
    const info = this.peerInfo.get(ws);
    if (!info) return;

    let msg;
    try {
      msg = JSON.parse(rawData);
    } catch {
      this._send(ws, { type: 'error', error: 'invalid_json' });
      return;
    }

    switch (msg.type) {
      case 'join':
        this._handleJoin(ws, info, msg);
        break;

      case 'leave':
        this._handleLeave(ws, info);
        break;

      case 'signal':
        this._handleSignal(ws, info, msg);
        break;

      case 'ping':
        this._send(ws, { type: 'pong', timestamp: Date.now() });
        break;

      default:
        this._send(ws, { type: 'error', error: 'unknown_type' });
    }
  }

  _handleJoin(ws, info, msg) {
    const { roomId, profile } = msg;

    if (!roomId || typeof roomId !== 'string') {
      this._send(ws, { type: 'error', error: 'invalid_room' });
      return;
    }

    // Leave current room if any
    if (info.roomId) {
      this._handleLeave(ws, info);
    }

    // Create room if needed
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Set());
    }

    const room = this.rooms.get(roomId);

    if (room.size >= this.maxPeersPerRoom) {
      this._send(ws, { type: 'error', error: 'room_full' });
      return;
    }

    room.add(ws);
    info.roomId = roomId;
    info.profile = profile;

    // Notify peer of successful join
    this._send(ws, {
      type: 'joined',
      roomId,
      peers: this._getPeers(roomId, info.peerId),
      persisted: false, // Relay servers don't persist
    });

    // Notify others
    this._broadcast(
      roomId,
      {
        type: 'peer_joined',
        peerId: info.peerId,
        profile: info.profile,
      },
      ws
    );

    this._log(`Peer joined room (${room.size} peers)`);
  }

  _handleLeave(ws, info) {
    if (!info.roomId) return;

    const room = this.rooms.get(info.roomId);
    if (room) {
      room.delete(ws);

      this._broadcast(info.roomId, {
        type: 'peer_left',
        peerId: info.peerId,
      });

      if (room.size === 0) {
        this.rooms.delete(info.roomId);
      }

      this._log(`Peer left room (${room.size} remaining)`);
    }

    info.roomId = null;
  }

  _handleSignal(ws, info, msg) {
    if (!info.roomId || !msg.to || !msg.signal) return;

    const room = this.rooms.get(info.roomId);
    if (!room) return;

    for (const peer of room) {
      const pInfo = this.peerInfo.get(peer);
      if (pInfo && pInfo.peerId === msg.to) {
        this._send(peer, {
          type: 'signal',
          from: info.peerId,
          signal: msg.signal,
        });
        break;
      }
    }
  }

  _handleClose(ws) {
    const info = this.peerInfo.get(ws);
    if (info) {
      this._handleLeave(ws, info);
      this.peerInfo.delete(ws);
    }

    this.totalConnections = Math.max(0, this.totalConnections - 1);

    this.onConnectionChange({
      event: 'disconnected',
      totalConnections: this.totalConnections,
    });
  }
}

// Export singleton instance and class
let instance = null;

export function getRelayServer(options) {
  if (!instance) {
    instance = new EmbeddedRelayServer(options);
  }
  return instance;
}

export { EmbeddedRelayServer };
export default EmbeddedRelayServer;
