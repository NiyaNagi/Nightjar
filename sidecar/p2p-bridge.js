/**
 * P2P Bridge - Bridges PeerManager protocol to sidecar native capabilities
 * 
 * Handles:
 * - Hyperswarm topic joining/leaving
 * - P2P message routing
 * - mDNS discovery integration
 */

const { HyperswarmManager, generateTopic } = require('./hyperswarm');
const EventEmitter = require('events');

class P2PBridge extends EventEmitter {
  constructor() {
    super();
    this.hyperswarm = null;
    this.clients = new Map(); // websocket -> { peerId, topics, identity }
    this.topics = new Map(); // topic -> Set<websocket>
    this.peerIdToSocket = new Map(); // peerId -> websocket
    this.isInitialized = false;
    
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
  }

  /**
   * Handle new WebSocket client connection
   */
  handleClient(ws) {
    this.clients.set(ws, {
      peerId: null,
      topics: new Set(),
      identity: null,
    });

    ws.on('close', () => {
      this._handleClientDisconnect(ws);
    });
  }

  /**
   * Handle message from client
   */
  async handleMessage(ws, message) {
    const client = this.clients.get(ws);
    if (!client) return;

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
      }
    }

    this._sendToClient(ws, {
      type: 'p2p-topic-joined',
      topic,
    });

    // Send current peers in topic
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
   * Send message to a client
   */
  _sendToClient(ws, message) {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify(message));
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
    }

    this.clients.clear();
    this.topics.clear();
    this.peerIdToSocket.clear();
  }
}

module.exports = { P2PBridge };
