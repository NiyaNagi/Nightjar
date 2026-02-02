/**
 * Mesh Participant (ES Module version)
 * 
 * Manages participation in the Nightjar Relay Mesh network.
 * Handles DHT discovery, relay announcements, and workspace routing.
 * 
 * This is the ES module version for use with the unified server.
 * 
 * Reference: docs/RELAY_MESH_ARCHITECTURE.md
 */

import Hyperswarm from 'hyperswarm';
import crypto from 'crypto';
import { EventEmitter } from 'events';

import {
  getMeshTopic,
  getWorkspaceTopic,
  getWorkspaceTopicHex,
  BOOTSTRAP_NODES,
  DEV_BOOTSTRAP_NODES,
  RELAY_ANNOUNCE_INTERVAL_MS,
  PEER_QUERY_TIMEOUT_MS,
  MAX_ROUTING_TABLE_SIZE,
  MESSAGE_TYPES,
  generateNodeId,
  getVersion,
} from './mesh-constants.mjs';

/**
 * MeshParticipant - Core class for mesh network participation
 * 
 * Responsibilities:
 * - Join mesh coordination topic for peer discovery
 * - Announce as relay (if enabled)
 * - Track known relay nodes
 * - Query mesh for workspace peers
 * - Announce workspace participation
 */
export class MeshParticipant extends EventEmitter {
  /**
   * @param {Object} options
   * @param {boolean} options.enabled - Whether to participate in mesh (default: true)
   * @param {boolean} options.relayMode - Whether to act as relay for web clients (default: false)
   * @param {boolean} options.announceWorkspaces - Whether to announce workspace participation (default: true)
   * @param {string} options.publicUrl - Public WebSocket URL if acting as relay
   * @param {number} options.maxPeers - Max connections to accept (default: 100)
   * @param {boolean} options.persist - Whether persistence is enabled (default: false)
   */
  constructor(options = {}) {
    super();
    
    this.enabled = options.enabled ?? true;
    this.relayMode = options.relayMode ?? false;
    this.announceWorkspaces = options.announceWorkspaces ?? true;
    this.publicUrl = options.publicUrl || null;
    this.maxPeers = options.maxPeers ?? 100;
    this.persist = options.persist ?? false;
    
    // Generate persistent node ID
    this.nodeId = options.nodeId || generateNodeId();
    
    // Hyperswarm instance
    this.swarm = null;
    
    // Known relay nodes: nodeId -> { endpoints, capabilities, lastSeen }
    this.knownRelays = new Map();
    
    // Active workspace topics: topicHex -> Set<peerNodeId>
    this.workspaceTopics = new Map();
    
    // Our active workspace topics
    this.ourWorkspaces = new Set();
    
    // Mesh connections: remotePublicKey -> connection
    this.meshConnections = new Map();
    
    // Announcement interval handle
    this._announceInterval = null;
    
    // Start time for uptime calculation
    this._startTime = Date.now();
    
    // Running state
    this._running = false;
  }

  /**
   * Start mesh participation
   */
  async start() {
    if (!this.enabled) {
      console.log('[Mesh] Mesh participation disabled');
      return;
    }

    if (this._running) {
      console.log('[Mesh] Already running');
      return;
    }

    console.log('[Mesh] Starting mesh participant...');
    console.log(`[Mesh] Node ID: ${this.nodeId.slice(0, 16)}...`);
    console.log(`[Mesh] Relay mode: ${this.relayMode}`);

    // Create Hyperswarm instance
    this.swarm = new Hyperswarm();
    
    // Handle new connections
    this.swarm.on('connection', (conn, info) => {
      this._handleConnection(conn, info);
    });

    // Join mesh coordination topic
    const meshTopic = getMeshTopic();
    console.log(`[Mesh] Joining mesh topic: ${meshTopic.toString('hex').slice(0, 16)}...`);
    
    const discovery = this.swarm.join(meshTopic, {
      server: this.relayMode,  // Only relays announce on mesh topic
      client: true,            // Everyone discovers
    });
    
    await discovery.flushed();
    console.log('[Mesh] Joined mesh coordination topic');

    // Start periodic announcements if we're a relay
    if (this.relayMode && this.publicUrl) {
      this._startAnnouncements();
    }

    this._running = true;
    this.emit('started');
  }

  /**
   * Stop mesh participation
   */
  async stop() {
    if (!this._running) return;

    console.log('[Mesh] Stopping mesh participant...');

    // Stop announcements
    if (this._announceInterval) {
      clearInterval(this._announceInterval);
      this._announceInterval = null;
    }

    // Leave all workspace topics
    for (const workspaceId of this.ourWorkspaces) {
      await this.leaveWorkspace(workspaceId);
    }

    // Close swarm
    if (this.swarm) {
      await this.swarm.destroy();
      this.swarm = null;
    }

    this.meshConnections.clear();
    this._running = false;
    this.emit('stopped');
    console.log('[Mesh] Stopped');
  }

  /**
   * Handle new mesh connection
   * @private
   */
  _handleConnection(conn, info) {
    const remoteKey = info.publicKey.toString('hex');
    console.log(`[Mesh] New connection: ${remoteKey.slice(0, 16)}...`);
    
    this.meshConnections.set(remoteKey, conn);

    // Set up message handling
    let buffer = Buffer.alloc(0);
    
    conn.on('data', (data) => {
      // Accumulate data (messages may be fragmented)
      buffer = Buffer.concat([buffer, data]);
      
      // Try to parse complete messages (newline-delimited JSON)
      const lines = buffer.toString().split('\n');
      buffer = Buffer.from(lines.pop() || ''); // Keep incomplete line
      
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          this._handleMessage(msg, conn, info);
        } catch (e) {
          console.error('[Mesh] Failed to parse message:', e.message);
        }
      }
    });

    conn.on('close', () => {
      console.log(`[Mesh] Connection closed: ${remoteKey.slice(0, 16)}...`);
      this.meshConnections.delete(remoteKey);
    });

    conn.on('error', (err) => {
      console.error(`[Mesh] Connection error ${remoteKey.slice(0, 16)}...`, err.message);
    });

    // If we're a relay, send a greeting
    if (this.relayMode && this.publicUrl) {
      this._sendRelayAnnounce(conn);
    }
  }

  /**
   * Handle incoming mesh message
   * @private
   */
  _handleMessage(msg, conn, info) {
    const remoteKey = info.publicKey.toString('hex');
    
    switch (msg.type) {
      case MESSAGE_TYPES.RELAY_ANNOUNCE:
        this._handleRelayAnnounce(msg, remoteKey);
        break;
        
      case MESSAGE_TYPES.BOOTSTRAP_REQUEST:
        this._handleBootstrapRequest(conn);
        break;
        
      case MESSAGE_TYPES.BOOTSTRAP_RESPONSE:
        this._handleBootstrapResponse(msg);
        break;
        
      case MESSAGE_TYPES.WORKSPACE_QUERY:
        this._handleWorkspaceQuery(msg, conn);
        break;
        
      case MESSAGE_TYPES.WORKSPACE_RESPONSE:
        this._handleWorkspaceResponse(msg);
        break;
        
      case MESSAGE_TYPES.WORKSPACE_ANNOUNCE:
        this._handleWorkspaceAnnounce(msg, remoteKey);
        break;
        
      case MESSAGE_TYPES.PING:
        this._send(conn, { type: MESSAGE_TYPES.PONG, ts: msg.ts });
        break;
        
      case MESSAGE_TYPES.PONG:
        // Used for latency measurement
        break;
        
      default:
        console.log(`[Mesh] Unknown message type: ${msg.type}`);
    }
  }

  /**
   * Send a message to a connection
   * @private
   */
  _send(conn, msg) {
    try {
      conn.write(JSON.stringify(msg) + '\n');
    } catch (e) {
      console.error('[Mesh] Failed to send message:', e.message);
    }
  }

  /**
   * Broadcast a message to all mesh connections
   * @private
   */
  _broadcast(msg) {
    const data = JSON.stringify(msg) + '\n';
    for (const conn of this.meshConnections.values()) {
      try {
        conn.write(data);
      } catch (e) {
        // Connection may be closing
      }
    }
  }

  /**
   * Send relay announcement to a connection
   * @private
   */
  _sendRelayAnnounce(conn) {
    this._send(conn, {
      type: MESSAGE_TYPES.RELAY_ANNOUNCE,
      nodeId: this.nodeId,
      endpoints: [this.publicUrl],
      capabilities: {
        persist: this.persist,
        maxPeers: this.maxPeers,
      },
      version: getVersion(),
      uptime: Math.floor((Date.now() - this._startTime) / 1000),
    });
  }

  /**
   * Start periodic relay announcements
   * @private
   */
  _startAnnouncements() {
    console.log('[Mesh] Starting periodic announcements');
    
    // Announce immediately to all connected peers
    for (const conn of this.meshConnections.values()) {
      this._sendRelayAnnounce(conn);
    }
    
    // Then announce periodically
    this._announceInterval = setInterval(() => {
      for (const conn of this.meshConnections.values()) {
        this._sendRelayAnnounce(conn);
      }
    }, RELAY_ANNOUNCE_INTERVAL_MS);
  }

  /**
   * Handle relay announcement from another node
   * @private
   */
  _handleRelayAnnounce(msg, remoteKey) {
    const { nodeId, endpoints, capabilities, version, uptime } = msg;
    
    if (!nodeId || !endpoints || endpoints.length === 0) {
      return;
    }
    
    // Store in routing table
    this.knownRelays.set(nodeId, {
      endpoints,
      capabilities: capabilities || {},
      version,
      uptime,
      lastSeen: Date.now(),
      publicKey: remoteKey,
    });
    
    // Trim routing table if too large
    if (this.knownRelays.size > MAX_ROUTING_TABLE_SIZE) {
      // Remove oldest entries
      const entries = [...this.knownRelays.entries()]
        .sort((a, b) => a[1].lastSeen - b[1].lastSeen);
      
      while (this.knownRelays.size > MAX_ROUTING_TABLE_SIZE * 0.8) {
        const [oldKey] = entries.shift();
        this.knownRelays.delete(oldKey);
      }
    }
    
    this.emit('relay-discovered', { nodeId, endpoints, capabilities });
    console.log(`[Mesh] Discovered relay: ${endpoints[0]} (${nodeId.slice(0, 16)}...)`);
  }

  /**
   * Handle bootstrap request - respond with known relays
   * @private
   */
  _handleBootstrapRequest(conn) {
    const relays = this.getTopRelays(20);
    this._send(conn, {
      type: MESSAGE_TYPES.BOOTSTRAP_RESPONSE,
      relays,
    });
  }

  /**
   * Handle bootstrap response - add relays to routing table
   * @private
   */
  _handleBootstrapResponse(msg) {
    const { relays } = msg;
    if (!Array.isArray(relays)) return;
    
    for (const relay of relays) {
      if (relay.nodeId && relay.endpoints) {
        this.knownRelays.set(relay.nodeId, {
          endpoints: relay.endpoints,
          capabilities: relay.capabilities || {},
          version: relay.version,
          uptime: relay.uptime || 0,
          lastSeen: Date.now(),
        });
      }
    }
    
    console.log(`[Mesh] Received ${relays.length} relays from bootstrap`);
  }

  /**
   * Handle workspace query - respond with known peers for that workspace
   * @private
   */
  _handleWorkspaceQuery(msg, conn) {
    const { topicHex, requestId } = msg;
    if (!topicHex) return;
    
    const peers = this.workspaceTopics.get(topicHex) || new Set();
    
    this._send(conn, {
      type: MESSAGE_TYPES.WORKSPACE_RESPONSE,
      topicHex,
      requestId,
      peers: [...peers],
    });
  }

  /**
   * Handle workspace response - process returned peers
   * @private
   */
  _handleWorkspaceResponse(msg) {
    const { topicHex, requestId, peers } = msg;
    this.emit('workspace-response', { topicHex, requestId, peers });
  }

  /**
   * Handle workspace announcement from a peer
   * @private
   */
  _handleWorkspaceAnnounce(msg, remoteKey) {
    const { topicHex, action, nodeId } = msg;
    if (!topicHex || !nodeId) return;
    
    if (!this.workspaceTopics.has(topicHex)) {
      this.workspaceTopics.set(topicHex, new Set());
    }
    
    const peers = this.workspaceTopics.get(topicHex);
    
    if (action === 'join') {
      peers.add(nodeId);
      this.emit('workspace-peer-joined', { topicHex, nodeId });
    } else if (action === 'leave') {
      peers.delete(nodeId);
      this.emit('workspace-peer-left', { topicHex, nodeId });
    }
  }

  /**
   * Join a workspace topic for peer discovery
   * @param {string} workspaceId - Workspace ID
   */
  async joinWorkspace(workspaceId) {
    if (!this._running || !this.swarm) {
      throw new Error('Mesh not running');
    }

    if (this.ourWorkspaces.has(workspaceId)) {
      return; // Already joined
    }

    const topic = getWorkspaceTopic(workspaceId);
    const topicHex = topic.toString('hex');

    console.log(`[Mesh] Joining workspace topic: ${topicHex.slice(0, 16)}...`);

    // Join the DHT topic
    const discovery = this.swarm.join(topic, {
      server: true,  // We announce our presence
      client: true,  // We discover others
    });

    await discovery.flushed();
    
    this.ourWorkspaces.add(workspaceId);
    
    // Announce to all connected mesh peers
    this._broadcast({
      type: MESSAGE_TYPES.WORKSPACE_ANNOUNCE,
      topicHex,
      action: 'join',
      nodeId: this.nodeId,
    });

    console.log(`[Mesh] Joined workspace: ${workspaceId.slice(0, 16)}...`);
    this.emit('workspace-joined', { workspaceId, topicHex });
  }

  /**
   * Leave a workspace topic
   * @param {string} workspaceId - Workspace ID
   */
  async leaveWorkspace(workspaceId) {
    if (!this.ourWorkspaces.has(workspaceId)) {
      return;
    }

    const topic = getWorkspaceTopic(workspaceId);
    const topicHex = topic.toString('hex');

    // Announce departure
    this._broadcast({
      type: MESSAGE_TYPES.WORKSPACE_ANNOUNCE,
      topicHex,
      action: 'leave',
      nodeId: this.nodeId,
    });

    // Leave the DHT topic
    if (this.swarm) {
      await this.swarm.leave(topic);
    }

    this.ourWorkspaces.delete(workspaceId);
    console.log(`[Mesh] Left workspace: ${workspaceId.slice(0, 16)}...`);
    this.emit('workspace-left', { workspaceId, topicHex });
  }

  /**
   * Query mesh for peers in a workspace
   * @param {string} workspaceId - Workspace ID
   * @returns {Promise<string[]>} Array of peer node IDs
   */
  async queryWorkspacePeers(workspaceId) {
    const topicHex = getWorkspaceTopicHex(workspaceId);
    const requestId = crypto.randomBytes(8).toString('hex');
    
    return new Promise((resolve) => {
      const peers = new Set();
      let responded = 0;
      
      const handler = (msg) => {
        if (msg.requestId === requestId) {
          if (Array.isArray(msg.peers)) {
            msg.peers.forEach(p => peers.add(p));
          }
          responded++;
        }
      };
      
      this.on('workspace-response', handler);
      
      // Query all connected peers
      this._broadcast({
        type: MESSAGE_TYPES.WORKSPACE_QUERY,
        topicHex,
        requestId,
      });
      
      // Wait for responses
      setTimeout(() => {
        this.off('workspace-response', handler);
        resolve([...peers]);
      }, PEER_QUERY_TIMEOUT_MS);
    });
  }

  /**
   * Get top relays by uptime/lastSeen
   * @param {number} limit - Max relays to return
   * @returns {Array} Array of relay info
   */
  getTopRelays(limit = 10) {
    const relays = [];
    
    for (const [nodeId, info] of this.knownRelays) {
      relays.push({
        endpoints: info.endpoints,
        capabilities: info.capabilities,
        version: info.version,
        uptime: info.uptime,
        lastSeen: info.lastSeen,
        nodeId,
      });
    }
    
    // Sort by uptime (higher is better) and lastSeen (more recent is better)
    relays.sort((a, b) => {
      // Prefer recently seen
      const seenDiff = b.lastSeen - a.lastSeen;
      if (Math.abs(seenDiff) > 60000) return seenDiff;
      // Then by uptime
      return b.uptime - a.uptime;
    });
    
    return relays.slice(0, limit);
  }

  /**
   * Get mesh status for display
   * @returns {Object} Status info
   */
  getStatus() {
    return {
      enabled: this.enabled,
      running: this._running,
      nodeId: this.nodeId,
      relayMode: this.relayMode,
      publicUrl: this.publicUrl,
      connectedPeers: this.meshConnections.size,
      knownRelays: this.knownRelays.size,
      activeWorkspaces: this.ourWorkspaces.size,
      uptime: Math.floor((Date.now() - this._startTime) / 1000),
    };
  }
}

export default MeshParticipant;
