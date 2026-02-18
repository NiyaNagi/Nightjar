/**
 * Mesh Participant
 * 
 * Manages participation in the Nightjar Relay Mesh network.
 * Handles DHT discovery, relay announcements, and workspace routing.
 * 
 * Reference: docs/RELAY_MESH_ARCHITECTURE.md
 */

// OPTIMIZATION: Lazy-load hyperswarm package
let Hyperswarm = null;
function ensureHyperswarm() {
  if (!Hyperswarm) {
    Hyperswarm = require('hyperswarm');
  }
  return Hyperswarm;
}

const crypto = require('crypto');
const EventEmitter = require('events');

const {
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
} = require('./mesh-constants');

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
class MeshParticipant extends EventEmitter {
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

    // Lazy-load hyperswarm package
    ensureHyperswarm();
    
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

    // Set up message handling with buffer overflow protection
    const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB max buffer
    let buffer = Buffer.alloc(0);
    
    conn.on('data', (data) => {
      // Accumulate data (messages may be fragmented)
      buffer = Buffer.concat([buffer, data]);
      
      // Prevent buffer overflow attacks
      if (buffer.length > MAX_BUFFER_SIZE) {
        console.error(`[Mesh] Buffer overflow from ${remoteKey.slice(0, 16)}..., closing connection`);
        conn.destroy();
        return;
      }
      
      // Try to parse complete messages (newline-delimited JSON)
      const lines = buffer.toString().split('\n');
      buffer = Buffer.from(lines.pop() || ''); // Keep incomplete line
      
      // Maximum size for a single parsed JSON message (1MB)
      const MAX_MESSAGE_SIZE = 1024 * 1024;
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        // Reject oversized individual messages
        if (line.length > MAX_MESSAGE_SIZE) {
          console.error(`[Mesh] Rejecting oversized message (${line.length} bytes) from ${remoteKey.slice(0, 16)}...`);
          continue;
        }
        
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
      console.error(`[Mesh] Connection error: ${err.message}`);
      this.meshConnections.delete(remoteKey);
      try {
        conn.destroy();
      } catch (e) {
        // Ignore cleanup errors
      }
    });

    // If we need bootstrap, request it
    if (this.knownRelays.size < 10) {
      this._sendMessage(conn, {
        type: MESSAGE_TYPES.BOOTSTRAP_REQUEST,
        nodeId: this.nodeId,
      });
    }
  }

  /**
   * Handle incoming mesh message
   * @private
   */
  _handleMessage(msg, conn, info) {
    switch (msg.type) {
      case MESSAGE_TYPES.RELAY_ANNOUNCE:
        this._handleRelayAnnounce(msg);
        break;
        
      case MESSAGE_TYPES.BOOTSTRAP_REQUEST:
        this._handleBootstrapRequest(msg, conn);
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
        
      case MESSAGE_TYPES.PING:
        this._sendMessage(conn, { type: MESSAGE_TYPES.PONG, nodeId: this.nodeId });
        break;
        
      case MESSAGE_TYPES.PONG:
        // Ping response received
        break;
        
      default:
        console.log(`[Mesh] Unknown message type: ${msg.type}`);
    }
  }

  /**
   * Handle relay announcement
   * @private
   */
  _handleRelayAnnounce(msg) {
    if (!msg.nodeId || !msg.endpoints) return;
    
    // Don't store our own announcement
    if (msg.nodeId === this.nodeId) return;
    
    // Store/update relay info
    this.knownRelays.set(msg.nodeId, {
      endpoints: msg.endpoints,
      capabilities: msg.capabilities || {},
      version: msg.version,
      workspaceCount: msg.workspaceCount || 0,
      uptime: msg.uptime || 0,
      lastSeen: Date.now(),
    });
    
    // Trim routing table if too large
    if (this.knownRelays.size > MAX_ROUTING_TABLE_SIZE) {
      // Remove oldest entries
      const entries = [...this.knownRelays.entries()]
        .sort((a, b) => a[1].lastSeen - b[1].lastSeen);
      
      while (this.knownRelays.size > MAX_ROUTING_TABLE_SIZE) {
        const [oldestId] = entries.shift();
        this.knownRelays.delete(oldestId);
      }
    }
    
    console.log(`[Mesh] Relay discovered: ${msg.nodeId.slice(0, 16)}... (${this.knownRelays.size} known)`);
    this.emit('relay-discovered', msg);
  }

  /**
   * Handle bootstrap request
   * @private
   */
  _handleBootstrapRequest(msg, conn) {
    const nodes = [];
    
    // Include ourselves if we're a relay
    if (this.relayMode && this.publicUrl) {
      nodes.push({
        nodeId: this.nodeId,
        endpoints: { wss: this.publicUrl },
        capabilities: { relay: true, persist: this.persist },
      });
    }
    
    // Include known relays (up to 50)
    for (const [nodeId, info] of this.knownRelays) {
      if (nodes.length >= 50) break;
      nodes.push({
        nodeId,
        endpoints: info.endpoints,
        capabilities: info.capabilities,
      });
    }
    
    this._sendMessage(conn, {
      type: MESSAGE_TYPES.BOOTSTRAP_RESPONSE,
      nodes,
    });
  }

  /**
   * Handle bootstrap response
   * @private
   */
  _handleBootstrapResponse(msg) {
    if (!Array.isArray(msg.nodes)) return;
    
    console.log(`[Mesh] Received bootstrap with ${msg.nodes.length} nodes`);
    
    for (const node of msg.nodes) {
      if (node.nodeId && node.nodeId !== this.nodeId) {
        this.knownRelays.set(node.nodeId, {
          endpoints: node.endpoints || {},
          capabilities: node.capabilities || {},
          lastSeen: Date.now(),
        });
      }
    }
    
    this.emit('bootstrap-complete', msg.nodes.length);
  }

  /**
   * Handle workspace peer query
   * @private
   */
  _handleWorkspaceQuery(msg, conn) {
    const { topicHash, requesterId } = msg;
    if (!topicHash) return;
    
    // Check if we have peers for this topic
    const peers = this.workspaceTopics.get(topicHash);
    const peerList = [];
    
    // Include ourselves if we're on this topic
    if (this.ourWorkspaces.has(topicHash) && this.relayMode && this.publicUrl) {
      peerList.push({
        nodeId: this.nodeId,
        endpoints: { wss: this.publicUrl },
        lastSeen: Date.now(),
      });
    }
    
    // Include known peers on this topic
    if (peers) {
      for (const peerId of peers) {
        const relay = this.knownRelays.get(peerId);
        if (relay) {
          peerList.push({
            nodeId: peerId,
            endpoints: relay.endpoints,
            lastSeen: relay.lastSeen,
          });
        }
      }
    }
    
    this._sendMessage(conn, {
      type: MESSAGE_TYPES.WORKSPACE_RESPONSE,
      topicHash,
      peers: peerList,
    });
  }

  /**
   * Handle workspace peer response
   * @private
   */
  _handleWorkspaceResponse(msg) {
    const { topicHash, peers } = msg;
    if (!topicHash || !Array.isArray(peers)) return;
    
    // Store peers for this topic
    if (!this.workspaceTopics.has(topicHash)) {
      this.workspaceTopics.set(topicHash, new Set());
    }
    
    const topicPeers = this.workspaceTopics.get(topicHash);
    for (const peer of peers) {
      if (peer.nodeId) {
        topicPeers.add(peer.nodeId);
        
        // Also update known relays
        if (peer.endpoints) {
          this.knownRelays.set(peer.nodeId, {
            endpoints: peer.endpoints,
            lastSeen: peer.lastSeen || Date.now(),
            capabilities: {},
          });
        }
      }
    }
    
    this.emit('workspace-peers', { topicHash, peers });
  }

  /**
   * Start periodic relay announcements
   * @private
   */
  _startAnnouncements() {
    // Announce immediately
    this._announceRelay();
    
    // Then periodically
    this._announceInterval = setInterval(() => {
      this._announceRelay();
    }, RELAY_ANNOUNCE_INTERVAL_MS);
  }

  /**
   * Broadcast relay announcement to mesh
   * @private
   */
  _announceRelay() {
    const announcement = {
      type: MESSAGE_TYPES.RELAY_ANNOUNCE,
      nodeId: this.nodeId,
      version: getVersion(),
      capabilities: {
        relay: this.relayMode,
        persist: this.persist,
        maxPeers: this.maxPeers,
      },
      endpoints: {
        wss: this.publicUrl,
      },
      workspaceCount: this.ourWorkspaces.size,
      uptime: Math.floor((Date.now() - this._startTime) / 1000),
      timestamp: Date.now(),
    };
    
    // Broadcast to all mesh connections
    for (const conn of this.meshConnections.values()) {
      this._sendMessage(conn, announcement);
    }
    
    console.log(`[Mesh] Announced relay (${this.meshConnections.size} peers)`);
  }

  /**
   * Send message on connection
   * @private
   */
  _sendMessage(conn, msg) {
    try {
      conn.write(JSON.stringify(msg) + '\n');
    } catch (e) {
      console.error('[Mesh] Failed to send message:', e.message);
    }
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Join a workspace topic (announce our presence)
   * @param {string} workspaceId - Raw workspace ID
   */
  async joinWorkspace(workspaceId) {
    if (!this.enabled || !this.swarm) return;
    
    const topicHex = getWorkspaceTopicHex(workspaceId);
    
    if (this.ourWorkspaces.has(topicHex)) {
      return; // Already joined
    }
    
    const topic = getWorkspaceTopic(workspaceId);
    console.log(`[Mesh] Joining workspace topic: ${topicHex.slice(0, 16)}...`);
    
    // Join the workspace-specific DHT topic
    const discovery = this.swarm.join(topic, {
      server: this.announceWorkspaces,
      client: true,
    });
    
    await discovery.flushed();
    
    this.ourWorkspaces.add(topicHex);
    this.emit('workspace-joined', workspaceId);
  }

  /**
   * Leave a workspace topic
   * @param {string} workspaceId - Raw workspace ID
   */
  async leaveWorkspace(workspaceId) {
    if (!this.swarm) return;
    
    const topicHex = getWorkspaceTopicHex(workspaceId);
    const topic = getWorkspaceTopic(workspaceId);
    
    if (this.ourWorkspaces.has(topicHex)) {
      await this.swarm.leave(topic);
      this.ourWorkspaces.delete(topicHex);
      this.emit('workspace-left', workspaceId);
    }
  }

  /**
   * Query mesh for peers hosting a workspace
   * @param {string} workspaceId - Raw workspace ID
   * @returns {Promise<Array>} List of peers
   */
  async queryWorkspacePeers(workspaceId) {
    const topicHash = getWorkspaceTopicHex(workspaceId);
    
    return new Promise((resolve) => {
      const peers = [];
      let responsesReceived = 0;
      const connectionsToQuery = [...this.meshConnections.values()];
      
      if (connectionsToQuery.length === 0) {
        resolve([]);
        return;
      }
      
      // Collect responses within timeout
      const handler = (data) => {
        if (data.topicHash === topicHash) {
          peers.push(...data.peers);
        }
      };
      
      this.on('workspace-peers', handler);
      
      // Query all connections
      for (const conn of connectionsToQuery) {
        this._sendMessage(conn, {
          type: MESSAGE_TYPES.WORKSPACE_QUERY,
          topicHash,
          requesterId: this.nodeId,
        });
      }
      
      // Timeout and return results
      setTimeout(() => {
        this.off('workspace-peers', handler);
        
        // Deduplicate by nodeId
        const uniquePeers = new Map();
        for (const peer of peers) {
          if (peer.nodeId && !uniquePeers.has(peer.nodeId)) {
            uniquePeers.set(peer.nodeId, peer);
          }
        }
        
        resolve([...uniquePeers.values()]);
      }, PEER_QUERY_TIMEOUT_MS);
    });
  }

  /**
   * Get known relay nodes (for embedding in share links)
   * @param {number} count - Max number to return
   * @returns {Array<{ url: string, nodeId: string }>}
   */
  getTopRelays(count = 5) {
    const relays = [];
    
    // Include ourselves if we're a relay
    if (this.relayMode && this.publicUrl) {
      relays.push({
        url: this.publicUrl,
        nodeId: this.nodeId,
      });
    }
    
    // Add known relays sorted by most recently seen
    const sorted = [...this.knownRelays.entries()]
      .filter(([, info]) => info.endpoints?.wss)
      .sort((a, b) => b[1].lastSeen - a[1].lastSeen);
    
    for (const [nodeId, info] of sorted) {
      if (relays.length >= count) break;
      relays.push({
        url: info.endpoints.wss,
        nodeId,
      });
    }
    
    return relays;
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

module.exports = { MeshParticipant };
