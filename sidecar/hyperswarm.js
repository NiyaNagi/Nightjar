/**
 * Hyperswarm P2P Discovery Module
 * Handles peer discovery and connection via DHT
 * 
 * Security: Identity messages are cryptographically signed to prevent impersonation
 */

const Hyperswarm = require('hyperswarm');
const b4a = require('b4a');
const crypto = require('crypto');
const nacl = require('tweetnacl');
const { EventEmitter } = require('events');

/**
 * Sign a message with Ed25519
 * @param {Object} message - Message to sign
 * @param {string} secretKeyHex - 64-byte secret key in hex
 * @returns {Object} Message with signature
 */
function signMessage(message, secretKeyHex) {
  const messageBytes = Buffer.from(JSON.stringify(message), 'utf8');
  const secretKey = Buffer.from(secretKeyHex, 'hex');
  const signature = nacl.sign.detached(messageBytes, secretKey);
  return {
    ...message,
    signature: Buffer.from(signature).toString('hex')
  };
}

/**
 * Verify a signed message
 * @param {Object} signedMessage - Message with signature field
 * @param {string} publicKeyHex - 32-byte public key in hex
 * @returns {boolean} Whether signature is valid
 */
function verifyMessage(signedMessage, publicKeyHex) {
  try {
    const { signature, ...message } = signedMessage;
    if (!signature) return false;
    
    const messageBytes = Buffer.from(JSON.stringify(message), 'utf8');
    const signatureBytes = Buffer.from(signature, 'hex');
    const publicKey = Buffer.from(publicKeyHex, 'hex');
    
    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey);
  } catch (err) {
    console.error('[Hyperswarm] Signature verification failed:', err.message);
    return false;
  }
}

class HyperswarmManager extends EventEmitter {
  constructor() {
    super();
    this.swarm = null;
    this.connections = new Map(); // peerId -> connection
    this.topics = new Map(); // topicHex -> { discovery, peers }
    this.identity = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the Hyperswarm instance
   * @param {Object} identity - User identity with publicKey and secretKey
   */
  async initialize(identity) {
    if (this.isInitialized) {
      return;
    }

    this.identity = identity;
    
    // Create Hyperswarm instance with keypair for persistent peer ID
    const seed = b4a.from(identity.secretKey.slice(0, 32), 'hex');
    this.swarm = new Hyperswarm({ seed });

    // Handle new connections
    this.swarm.on('connection', (socket, peerInfo) => {
      this._handleConnection(socket, peerInfo);
    });

    this.isInitialized = true;
    console.log('[Hyperswarm] Initialized with peer ID:', this.swarm.keyPair.publicKey.toString('hex').slice(0, 16) + '...');
  }

  /**
   * Handle incoming peer connection
   */
  _handleConnection(socket, peerInfo) {
    const peerId = peerInfo.publicKey.toString('hex');
    const shortId = peerId.slice(0, 16);
    
    console.log('[Hyperswarm] New connection from peer:', shortId);

    // Store connection
    this.connections.set(peerId, {
      socket,
      peerInfo,
      authenticated: false,
      identity: null,
      topics: new Set()
    });

    // Handle incoming data
    socket.on('data', (data) => {
      this._handleData(peerId, data);
    });

    // Handle connection close
    socket.on('close', () => {
      console.log('[Hyperswarm] Connection closed:', shortId);
      const conn = this.connections.get(peerId);
      if (conn) {
        // Notify about peer leaving for each topic
        for (const topic of conn.topics) {
          this.emit('peer-left', { peerId, topic, identity: conn.identity });
        }
      }
      this.connections.delete(peerId);
    });

    // Handle errors
    socket.on('error', (err) => {
      console.error('[Hyperswarm] Connection error:', shortId, err.message);
    });

    // Send our signed identity
    this._sendSignedIdentity(socket);

    this.emit('connection', { peerId, socket, peerInfo });
  }

  /**
   * Handle incoming data from peer
   */
  _handleData(peerId, data) {
    try {
      const message = JSON.parse(data.toString());
      const conn = this.connections.get(peerId);

      if (!conn) return;

      switch (message.type) {
        case 'identity':
          // Verify the signature before trusting the identity
          if (!message.signature) {
            console.warn('[Hyperswarm] Rejecting unsigned identity from peer:', peerId.slice(0, 16));
            return;
          }
          
          if (!verifyMessage(message, message.publicKey)) {
            console.warn('[Hyperswarm] Rejecting identity with invalid signature from peer:', peerId.slice(0, 16));
            return;
          }
          
          conn.authenticated = true;
          conn.identity = {
            publicKey: message.publicKey,
            displayName: message.displayName,
            color: message.color
          };
          console.log('[Hyperswarm] Peer verified and identified:', message.displayName);
          this.emit('peer-identity', { peerId, identity: conn.identity });
          break;

        case 'join-topic':
          conn.topics.add(message.topic);
          this.emit('peer-joined', { peerId, topic: message.topic, identity: conn.identity });
          break;

        case 'leave-topic':
          conn.topics.delete(message.topic);
          this.emit('peer-left', { peerId, topic: message.topic, identity: conn.identity });
          break;

        case 'sync':
          this.emit('sync-message', { peerId, topic: message.topic, data: message.data });
          break;

        case 'awareness':
          this.emit('awareness-update', { peerId, topic: message.topic, state: message.state });
          break;

        default:
          this.emit('message', { peerId, message });
      }
    } catch (err) {
      console.error('[Hyperswarm] Failed to parse message:', err.message);
    }
  }

  /**
   * Send a message to a specific peer
   */
  _sendMessage(socket, message) {
    try {
      socket.write(JSON.stringify(message));
    } catch (err) {
      console.error('[Hyperswarm] Failed to send message:', err.message);
    }
  }

  /**
   * Send a cryptographically signed identity message
   * This proves we own the private key corresponding to our public key
   */
  _sendSignedIdentity(socket) {
    const identityMessage = {
      type: 'identity',
      publicKey: this.identity.publicKey,
      displayName: this.identity.displayName,
      color: this.identity.color,
      timestamp: Date.now() // Include timestamp to prevent replay attacks
    };
    
    const signedMessage = signMessage(identityMessage, this.identity.secretKey);
    this._sendMessage(socket, signedMessage);
  }

  /**
   * Join a topic (document) for peer discovery
   * @param {string} topicHex - Hex-encoded 32-byte topic
   * @returns {Promise<void>}
   */
  async joinTopic(topicHex) {
    if (!this.isInitialized) {
      throw new Error('Hyperswarm not initialized');
    }

    if (this.topics.has(topicHex)) {
      console.log('[Hyperswarm] Already joined topic:', topicHex.slice(0, 16) + '...');
      return;
    }

    const topic = b4a.from(topicHex, 'hex');
    const discovery = this.swarm.join(topic, { server: true, client: true });
    
    // Wait for initial peer discovery
    await discovery.flushed();

    this.topics.set(topicHex, {
      discovery,
      peers: new Set()
    });

    // Notify all connected peers about joining this topic
    for (const [peerId, conn] of this.connections) {
      this._sendMessage(conn.socket, {
        type: 'join-topic',
        topic: topicHex
      });
    }

    console.log('[Hyperswarm] Joined topic:', topicHex.slice(0, 16) + '...');
    this.emit('topic-joined', { topic: topicHex });
  }

  /**
   * Leave a topic
   * @param {string} topicHex - Hex-encoded 32-byte topic
   */
  async leaveTopic(topicHex) {
    const topicData = this.topics.get(topicHex);
    if (!topicData) return;

    // Notify peers
    for (const [peerId, conn] of this.connections) {
      this._sendMessage(conn.socket, {
        type: 'leave-topic',
        topic: topicHex
      });
    }

    await topicData.discovery.destroy();
    this.topics.delete(topicHex);

    console.log('[Hyperswarm] Left topic:', topicHex.slice(0, 16) + '...');
    this.emit('topic-left', { topic: topicHex });
  }

  /**
   * Broadcast a sync message to all peers on a topic
   * @param {string} topicHex - Topic to broadcast on
   * @param {Buffer|Uint8Array} data - Sync data
   */
  broadcastSync(topicHex, data) {
    const dataStr = Buffer.isBuffer(data) ? data.toString('base64') : 
                    data instanceof Uint8Array ? Buffer.from(data).toString('base64') : data;

    for (const [peerId, conn] of this.connections) {
      if (conn.topics.has(topicHex)) {
        this._sendMessage(conn.socket, {
          type: 'sync',
          topic: topicHex,
          data: dataStr
        });
      }
    }
  }

  /**
   * Broadcast awareness state to all peers on a topic
   * @param {string} topicHex - Topic to broadcast on
   * @param {Object} state - Awareness state
   */
  broadcastAwareness(topicHex, state) {
    for (const [peerId, conn] of this.connections) {
      if (conn.topics.has(topicHex)) {
        this._sendMessage(conn.socket, {
          type: 'awareness',
          topic: topicHex,
          state
        });
      }
    }
  }

  /**
   * Get list of peers for a topic
   * @param {string} topicHex - Topic to get peers for
   * @returns {Array} List of peer info
   */
  getPeers(topicHex) {
    const peers = [];
    for (const [peerId, conn] of this.connections) {
      if (conn.topics.has(topicHex) && conn.identity) {
        peers.push({
          peerId,
          ...conn.identity
        });
      }
    }
    return peers;
  }

  /**
   * Get connection count
   * @returns {number}
   */
  getConnectionCount() {
    return this.connections.size;
  }

  /**
   * Destroy the swarm and close all connections
   */
  async destroy() {
    if (!this.isInitialized) return;

    // Leave all topics
    for (const topicHex of this.topics.keys()) {
      await this.leaveTopic(topicHex);
    }

    // Close swarm
    await this.swarm.destroy();
    
    this.connections.clear();
    this.topics.clear();
    this.isInitialized = false;

    console.log('[Hyperswarm] Destroyed');
  }
}

/**
 * Generate a topic hash from a document ID
 * @param {string} documentId - Document identifier
 * @param {string} password - Optional password for private documents
 * @returns {string} Hex-encoded 32-byte topic
 */
function generateTopic(documentId, password = '') {
  const data = password ? `${documentId}:${password}` : documentId;
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Generate a shareable document ID
 * @returns {string} Random 16-byte hex string
 */
function generateDocumentId() {
  return crypto.randomBytes(16).toString('hex');
}

// Singleton instance
let instance = null;

function getInstance() {
  if (!instance) {
    instance = new HyperswarmManager();
  }
  return instance;
}

module.exports = {
  HyperswarmManager,
  getInstance,
  generateTopic,
  generateDocumentId
};
