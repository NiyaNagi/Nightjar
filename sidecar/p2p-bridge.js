/**
 * P2P Bridge - Bridges PeerManager protocol to sidecar native capabilities
 * 
 * Handles:
 * - Hyperswarm topic joining/leaving
 * - P2P message routing
 * - mDNS discovery integration
 * - Mesh peer sharing (peers share their peer lists)
 */

// OPTIMIZATION: Lazy-load hyperswarm to speed up startup
let HyperswarmManager = null;
let generateTopic = null;

async function ensureHyperswarm() {
  if (HyperswarmManager) return;
  const module = require('./hyperswarm');
  HyperswarmManager = module.HyperswarmManager;
  generateTopic = module.generateTopic;
}

const EventEmitter = require('events');

// Maximum number of concurrent P2P clients to prevent resource exhaustion
const MAX_CLIENTS = 100;

class P2PBridge extends EventEmitter {
  constructor() {
    super();
    this.hyperswarm = null;
    this.clients = new Map(); // websocket -> { peerId, topics, identity }
    this.topics = new Map(); // topic -> Set<websocket>
    this.peerIdToSocket = new Map(); // peerId -> websocket
    this.isInitialized = false;
    this.isSuspended = false; // True when Tor relay-only mode is active
    this._suspendedIdentity = null; // Saved identity for resume
    this._suspendedTopics = null; // Saved topics for resume
    this.maxClients = MAX_CLIENTS;
    
    // mDNS (optional - try to load bonjour)
    this.bonjour = null;
    this.mdnsService = null;
    this.mdnsBrowser = null;
    
    this._initMDNS();
  }

  /**
   * Try to initialize mDNS
   */
  _initMDNS() {
    try {
      const Bonjour = require('bonjour');
      this.bonjour = new Bonjour();
      console.log('[P2PBridge] mDNS (Bonjour) available');
    } catch (e) {
      console.log('[P2PBridge] mDNS not available (bonjour package not installed)');
    }
  }

  /**
   * Initialize with identity
   */
  async initialize(identity) {
    if (this.isInitialized) return;

    try {
      // Lazy-load hyperswarm module
      await ensureHyperswarm();
      
      this.hyperswarm = new HyperswarmManager();
      await this.hyperswarm.initialize(identity);
      this._setupHyperswarmEvents();
      this.isInitialized = true;
      console.log('[P2PBridge] Initialized');
    } catch (error) {
      console.error('[P2PBridge] Failed to initialize Hyperswarm:', error);
      // Continue without Hyperswarm - other features still work
    }
  }

  /**
   * Setup Hyperswarm event handlers
   */
  _setupHyperswarmEvents() {
    if (!this.hyperswarm) return;

    this.hyperswarm.on('peer-joined', (data) => {
      this._broadcastToTopic(data.topic, {
        type: 'p2p-peer-connected',
        peerId: data.peerId,
        info: data.identity || {},
      });
      
      // Mesh: share our peer list with the new peer
      this.broadcastPeerList(data.topic);
    });

    this.hyperswarm.on('peer-left', (data) => {
      this._broadcastToTopic(data.topic, {
        type: 'p2p-peer-disconnected',
        peerId: data.peerId,
      });
    });

    this.hyperswarm.on('sync-message', (data) => {
      this._broadcastToTopic(data.topic, {
        type: 'p2p-message',
        fromPeerId: data.peerId,
        payload: data.message,
      });
    });

    // Handle peer list from mesh sharing
    this.hyperswarm.on('peer-list-received', (data) => {
      console.log(`[P2PBridge] Received peer list for topic ${data.topic?.slice(0, 16)}...: ${data.peers?.length || 0} peers`);
      // Notify frontend about new peers discovered
      this._broadcastToTopic(data.topic, {
        type: 'p2p-peers-discovered',
        peers: (data.peers || []).map(pk => ({ peerId: pk })),
      });
    });

    // Handle direct messages (chunk-request, chunk-response, chunk-seed,
    // and any future custom message types that fall through the switch
    // in HyperswarmManager._handleData's default case).
    // These are peer-to-peer messages that don't belong to a topic,
    // so we forward them to ALL connected frontend WebSocket clients.
    this.hyperswarm.on('direct-message', (data) => {
      const { peerId, message } = data;
      console.log(`[P2PBridge] Forwarding direct-message from ${peerId?.slice(0, 16)}...: type=${message?.type}`);
      this._broadcastToAllClients({
        type: 'p2p-message',
        fromPeerId: peerId,
        payload: message,
      });
    });
  }

  /**
   * Handle new WebSocket client connection
   */
  handleClient(ws) {
    // Reject new connections when at limit to prevent resource exhaustion
    if (this.clients.size >= this.maxClients) {
      console.warn(`[P2PBridge] Connection rejected: max clients (${this.maxClients}) reached`);
      ws.close(1013, 'Max clients reached'); // 1013 = Try Again Later
      return;
    }

    this.clients.set(ws, {
      peerId: null,
      topics: new Set(),
      identity: null,
    });

    ws.on('close', () => {
      this._handleClientDisconnect(ws);
    });

    ws.on('error', (err) => {
      console.error('[P2PBridge] WebSocket client error:', err.message);
      this._handleClientDisconnect(ws);
    });
  }

  /**
   * Handle message from client
   */
  async handleMessage(ws, message) {
    const client = this.clients.get(ws);
    if (!client) return;

    // Validate message format
    if (!message || typeof message.type !== 'string') {
      console.warn('[P2PBridge] Invalid message format, missing type');
      return;
    }

    try {
      switch (message.type) {
        case 'p2p-identity':
          await this._handleIdentity(ws, client, message);
          break;

        case 'p2p-join-topic':
          await this._handleJoinTopic(ws, client, message);
          break;

        case 'p2p-leave-topic':
          await this._handleLeaveTopic(ws, client, message);
          break;

        case 'p2p-send':
          await this._handleSend(ws, client, message);
          break;

        case 'p2p-broadcast':
          await this._handleBroadcast(ws, client, message);
          break;

        case 'mdns-advertise':
          this._handleMDNSAdvertise(ws, message);
          break;

        case 'mdns-discover':
          this._handleMDNSDiscover(ws, message);
          break;

        case 'mdns-stop':
          this._handleMDNSStop(ws);
          break;
      }
    } catch (error) {
      console.error('[P2PBridge] Error handling message:', error);
      this._sendToClient(ws, {
        type: 'p2p-error',
        message: error.message,
      });
    }
  }

  /**
   * Handle identity message
   */
  async _handleIdentity(ws, client, message) {
    client.peerId = message.peerId;
    client.identity = {
      displayName: message.displayName,
      color: message.color,
      icon: message.icon,
    };
    this.peerIdToSocket.set(message.peerId, ws);
    
    console.log(`[P2PBridge] Client identified: ${message.displayName} (${message.peerId?.slice(0, 8)})`);
  }

  /**
   * Handle join topic
   */
  async _handleJoinTopic(ws, client, message) {
    const { topic } = message;
    if (!topic) return;

    // Already in topic - skip to avoid duplicate joins
    if (client.topics.has(topic)) {
      console.log(`[P2PBridge] Client already in topic ${topic.slice(0, 16)}...`);
      return;
    }

    client.topics.add(topic);

    if (!this.topics.has(topic)) {
      this.topics.set(topic, new Set());
    }
    this.topics.get(topic).add(ws);

    // Join Hyperswarm topic if available
    if (this.hyperswarm && this.isInitialized) {
      try {
        await this.hyperswarm.joinTopic(topic);
        console.log(`[P2PBridge] Joined Hyperswarm topic: ${topic.slice(0, 16)}...`);
      } catch (e) {
        console.warn('[P2PBridge] Failed to join Hyperswarm topic:', e.message);
        // Notify client of P2P join failure (relay may still work)
        this._sendToClient(ws, {
          type: 'p2p-topic-join-failed',
          topic,
          error: e.message,
        });
        // Continue to send topic-joined since local relay still works
      }
    }

    this._sendToClient(ws, {
      type: 'p2p-topic-joined',
      topic,
    });

    // Send current peers in topic (local P2P Bridge clients)
    const peers = [];
    for (const otherWs of this.topics.get(topic)) {
      if (otherWs !== ws) {
        const otherClient = this.clients.get(otherWs);
        if (otherClient?.peerId) {
          peers.push({
            peerId: otherClient.peerId,
            ...otherClient.identity,
          });
        }
      }
    }

    // Also include Hyperswarm-connected remote peers for this topic.
    // These are already connected via DHT but the new client doesn't
    // know about them yet (peer-joined events fired before this client
    // subscribed to the topic).
    if (this.hyperswarm && this.isInitialized) {
      try {
        const hyperswarmPeers = this.hyperswarm.getPeers(topic);
        const localPeerIds = new Set(peers.map(p => p.peerId));
        for (const hsPeer of hyperswarmPeers) {
          if (!localPeerIds.has(hsPeer.peerId)) {
            peers.push(hsPeer);
          }
        }
      } catch (e) {
        // Non-fatal — Hyperswarm peer discovery is optional
        console.warn('[P2PBridge] Failed to get Hyperswarm peers for topic:', e.message);
      }
    }

    if (peers.length > 0) {
      this._sendToClient(ws, {
        type: 'p2p-peers-discovered',
        peers,
      });
    }

    // Notify other clients in topic
    this._broadcastToTopic(topic, {
      type: 'p2p-peer-connected',
      peerId: client.peerId,
      info: client.identity,
    }, ws);
  }

  /**
   * Handle leave topic
   */
  async _handleLeaveTopic(ws, client, message) {
    const { topic } = message;
    if (!topic) return;

    client.topics.delete(topic);
    this.topics.get(topic)?.delete(ws);

    // Leave Hyperswarm if no clients left
    if (this.topics.get(topic)?.size === 0) {
      this.topics.delete(topic);
      if (this.hyperswarm) {
        try {
          await this.hyperswarm.leaveTopic(topic);
        } catch (e) {
          // Ignore
        }
      }
    }

    // Notify other clients
    this._broadcastToTopic(topic, {
      type: 'p2p-peer-disconnected',
      peerId: client.peerId,
    });
  }

  /**
   * Handle send to specific peer
   */
  async _handleSend(ws, client, message) {
    const { targetPeerId, payload } = message;
    if (!targetPeerId || !payload) return;

    // Try to find target socket
    const targetWs = this.peerIdToSocket.get(targetPeerId);
    if (targetWs) {
      this._sendToClient(targetWs, {
        type: 'p2p-message',
        fromPeerId: client.peerId,
        payload,
      });
    } else if (this.hyperswarm) {
      // Try sending via Hyperswarm
      try {
        await this.hyperswarm.sendToPeer(targetPeerId, payload);
      } catch (e) {
        console.warn('[P2PBridge] Failed to send to peer:', e.message);
      }
    }
  }

  /**
   * Handle broadcast
   */
  async _handleBroadcast(ws, client, message) {
    const { payload } = message;
    if (!payload) return;

    // Broadcast to all topics the client is in
    for (const topic of client.topics) {
      this._broadcastToTopic(topic, {
        type: 'p2p-message',
        fromPeerId: client.peerId,
        payload,
      }, ws);
    }

    // Also broadcast via Hyperswarm
    if (this.hyperswarm) {
      for (const topic of client.topics) {
        try {
          this.hyperswarm.broadcastSync(topic, JSON.stringify(payload));
        } catch (e) {
          // Ignore
        }
      }
    }
  }

  /**
   * Handle mDNS advertise
   */
  _handleMDNSAdvertise(ws, message) {
    if (!this.bonjour) {
      this._sendToClient(ws, {
        type: 'mdns-error',
        message: 'mDNS not available',
      });
      return;
    }

    const { serviceName, port, peerId, displayName } = message;
    
    // Stop existing service
    if (this.mdnsService) {
      this.mdnsService.stop();
    }

    // Start new service
    this.mdnsService = this.bonjour.publish({
      name: `${serviceName}-${peerId.slice(0, 8)}`,
      type: serviceName,
      port,
      txt: {
        peerId,
        displayName: displayName || 'Unknown',
      },
    });

    console.log(`[P2PBridge] mDNS advertising: ${serviceName} on port ${port}`);
    
    this._sendToClient(ws, {
      type: 'mdns-advertise-started',
    });
  }

  /**
   * Handle mDNS discover
   */
  _handleMDNSDiscover(ws, message) {
    if (!this.bonjour) {
      this._sendToClient(ws, {
        type: 'mdns-error',
        message: 'mDNS not available',
      });
      return;
    }

    const { serviceName } = message;

    // Stop existing browser
    if (this.mdnsBrowser) {
      this.mdnsBrowser.stop();
    }

    // Start discovery
    this.mdnsBrowser = this.bonjour.find({ type: serviceName }, (service) => {
      const txt = service.txt || {};
      this._sendToClient(ws, {
        type: 'mdns-peer-discovered',
        peerId: txt.peerId,
        displayName: txt.displayName,
        host: service.host,
        port: service.port,
        addresses: service.addresses,
      });
    });

    console.log(`[P2PBridge] mDNS discovery started for: ${serviceName}`);
  }

  /**
   * Handle mDNS stop
   */
  _handleMDNSStop(ws) {
    if (this.mdnsService) {
      this.mdnsService.stop();
      this.mdnsService = null;
    }
    if (this.mdnsBrowser) {
      this.mdnsBrowser.stop();
      this.mdnsBrowser = null;
    }
  }

  /**
   * Handle client disconnect
   */
  _handleClientDisconnect(ws) {
    const client = this.clients.get(ws);
    if (!client) return;

    // Notify peers in all topics
    for (const topic of client.topics) {
      this._broadcastToTopic(topic, {
        type: 'p2p-peer-disconnected',
        peerId: client.peerId,
      });

      this.topics.get(topic)?.delete(ws);
      if (this.topics.get(topic)?.size === 0) {
        this.topics.delete(topic);
        // Leave Hyperswarm topic when no clients remain (matches _handleLeaveTopic)
        if (this.hyperswarm) {
          try {
            this.hyperswarm.leaveTopic(topic).catch(() => {});
          } catch (e) {
            // Ignore cleanup errors
          }
        }
      }
    }

    if (client.peerId) {
      this.peerIdToSocket.delete(client.peerId);
    }
    this.clients.delete(ws);

    console.log(`[P2PBridge] Client disconnected: ${client.identity?.displayName || 'Unknown'}`);
  }

  /**
   * Broadcast to all clients in a topic
   */
  _broadcastToTopic(topic, message, excludeWs = null) {
    const sockets = this.topics.get(topic);
    if (!sockets) return;

    for (const ws of sockets) {
      if (ws !== excludeWs) {
        this._sendToClient(ws, message);
      }
    }
  }

  /**
   * Broadcast a message to ALL connected frontend WebSocket clients,
   * regardless of topic. Used for direct peer-to-peer messages like
   * chunk-request/chunk-response that aren't scoped to a topic.
   */
  _broadcastToAllClients(message, excludeWs = null) {
    for (const ws of this.clients.keys()) {
      if (ws !== excludeWs) {
        this._sendToClient(ws, message);
      }
    }
  }

  /**
   * Send message to a client
   */
  _sendToClient(ws, message) {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Suspend Hyperswarm connections (relay-only mode for Tor privacy).
   * Tears down UDP-based Hyperswarm to prevent IP leakage while keeping
   * client state intact so resume() can re-join the same topics.
   */
  async suspend() {
    if (this.isSuspended || !this.isInitialized) return;
    
    console.log('[P2PBridge] Suspending Hyperswarm (relay-only mode)...');
    
    // Save current topics so we can re-join on resume
    this._suspendedTopics = new Set();
    for (const topic of this.topics.keys()) {
      this._suspendedTopics.add(topic);
    }
    
    // Tear down Hyperswarm (stops UDP DHT)
    if (this.hyperswarm) {
      try {
        // Save identity for re-initialization
        this._suspendedIdentity = this.hyperswarm.identity || null;
        await this.hyperswarm.destroy();
        this.hyperswarm = null;
      } catch (err) {
        console.error('[P2PBridge] Error suspending Hyperswarm:', err);
      }
    }
    
    // Stop mDNS (also leaks on LAN)
    if (this.mdnsService) {
      this.mdnsService.stop();
      this.mdnsService = null;
    }
    if (this.mdnsBrowser) {
      this.mdnsBrowser.stop();
      this.mdnsBrowser = null;
    }
    
    this.isInitialized = false;
    this.isSuspended = true;
    this.emit('suspended');
    console.log('[P2PBridge] Hyperswarm suspended — all sync via relay only');
  }
  
  /**
   * Resume Hyperswarm connections after Tor is disabled.
   * Re-initializes Hyperswarm and re-joins previously active topics.
   */
  async resume() {
    if (!this.isSuspended) return;
    
    console.log('[P2PBridge] Resuming Hyperswarm connections...');
    
    try {
      // Re-initialize Hyperswarm
      if (this._suspendedIdentity) {
        await ensureHyperswarm();
        this.hyperswarm = new HyperswarmManager();
        await this.hyperswarm.initialize(this._suspendedIdentity);
        this._setupHyperswarmEvents();
        
        // Re-join previously active topics
        if (this._suspendedTopics) {
          for (const topic of this._suspendedTopics) {
            try {
              await this.hyperswarm.joinTopic(topic);
              console.log(`[P2PBridge] Re-joined topic: ${topic.slice(0, 16)}...`);
            } catch (err) {
              console.warn(`[P2PBridge] Failed to re-join topic ${topic.slice(0, 16)}...:`, err.message);
            }
          }
        }
      }
      
      // Re-initialize mDNS
      this._initMDNS();
      
      // Only mark as initialized and clear saved state on success
      this.isInitialized = true;
      this.isSuspended = false;
      this._suspendedIdentity = null;
      this._suspendedTopics = null;
      this.emit('resumed');
      console.log('[P2PBridge] Hyperswarm resumed — direct P2P active');
    } catch (err) {
      console.error('[P2PBridge] Error resuming Hyperswarm:', err);
      // Leave isSuspended=true and preserve saved identity/topics for retry
      console.warn('[P2PBridge] Resume failed — will remain suspended, retry possible');
    }
  }

  /**
   * Cleanup
   */
  async destroy() {
    // Stop mDNS
    if (this.mdnsService) {
      this.mdnsService.stop();
    }
    if (this.mdnsBrowser) {
      this.mdnsBrowser.stop();
    }
    if (this.bonjour) {
      this.bonjour.destroy();
    }

    // Stop Hyperswarm
    if (this.hyperswarm) {
      await this.hyperswarm.destroy();
      this.hyperswarm = null;
    }

    this.clients.clear();
    this.topics.clear();
    this.peerIdToSocket.clear();
    this.isInitialized = false;
  }

  // --- Public API for sidecar use ---

  /**
   * Join a Hyperswarm topic directly (for auto-rejoin)
   * @param {string} topicHex - 64-char hex topic hash
   */
  async joinTopic(topicHex) {
    if (!this.hyperswarm || !this.isInitialized) {
      throw new Error('P2PBridge not initialized');
    }
    await this.hyperswarm.joinTopic(topicHex);
  }

  /**
   * Connect directly to a peer by public key
   * @param {string} peerPublicKeyHex - 64-char hex public key
   */
  async connectToPeer(peerPublicKeyHex) {
    if (!this.hyperswarm || !this.isInitialized) {
      throw new Error('P2PBridge not initialized');
    }
    await this.hyperswarm.connectToPeer(peerPublicKeyHex);
  }

  /**
   * Get our own Hyperswarm public key
   * @returns {string|null} 64-char hex public key
   */
  getOwnPublicKey() {
    if (!this.hyperswarm || !this.isInitialized) return null;
    return this.hyperswarm.getOwnPublicKey();
  }

  /**
   * Get our direct connection address (public IP:port)
   * @returns {Promise<Object|null>} { host, port, publicKey, address } or null
   */
  async getDirectAddress() {
    if (!this.hyperswarm || !this.isInitialized) return null;
    return this.hyperswarm.getDirectAddress();
  }

  /**
   * Get all connected peer public keys
   * @returns {string[]} Array of hex public keys
   */
  getConnectedPeers() {
    if (!this.hyperswarm) return [];
    return this.hyperswarm.getConnectedPeerKeys();
  }

  /**
   * Get public IP address (cached if available)
   * @returns {Promise<string|null>} Public IP or null
   */
  async getPublicIP() {
    const { getPublicIP } = require('./hyperswarm.js');
    return await getPublicIP();
  }

  /**
   * Broadcast peer list to all connected peers on a topic (mesh sharing)
   * @param {string} topicHex - Topic to broadcast on
   */
  broadcastPeerList(topicHex) {
    if (!this.hyperswarm) return;
    
    const peers = this.hyperswarm.getConnectedPeerKeys();
    const ownKey = this.getOwnPublicKey();
    
    // Send peer list to all connected hyperswarm peers on this topic
    for (const peerId of peers) {
      const otherPeers = peers.filter(p => p !== peerId);
      if (ownKey) otherPeers.push(ownKey);
      
      this.hyperswarm.sendToPeer(peerId, {
        type: 'peer-list',
        topic: topicHex,
        peers: otherPeers,
      });
    }
  }
}

module.exports = { P2PBridge };
