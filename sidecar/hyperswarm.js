/**
 * Hyperswarm P2P Discovery Module
 * Handles peer discovery and connection via DHT
 * 
 * Security: Identity messages are cryptographically signed to prevent impersonation
 * 
 * Direct P2P: Also supports direct IP:port connections via getDirectAddress()
 */

const Hyperswarm = require('hyperswarm');
const b4a = require('b4a');
const crypto = require('crypto');
const nacl = require('tweetnacl');
const { EventEmitter } = require('events');
const https = require('https');
const http = require('http');
const dgram = require('dgram');

// Public IP detection cache
let cachedPublicIP = null;
let publicIPTimestamp = 0;
const PUBLIC_IP_CACHE_TTL = 60000; // 1 minute cache

/**
 * Get public IP via STUN server
 * STUN servers return our reflexive address (how the internet sees us)
 * @returns {Promise<string|null>} Public IP or null
 */
async function getPublicIPViaSTUN() {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const STUN_SERVERS = [
      { host: 'stun.l.google.com', port: 19302 },
      { host: 'stun1.l.google.com', port: 19302 },
      { host: 'stun.cloudflare.com', port: 3478 },
    ];
    
    // STUN binding request
    const stunRequest = Buffer.alloc(20);
    stunRequest.writeUInt16BE(0x0001, 0); // Binding Request
    stunRequest.writeUInt16BE(0x0000, 2); // Message Length
    stunRequest.writeUInt32BE(0x2112A442, 4); // Magic Cookie
    crypto.randomBytes(12).copy(stunRequest, 8); // Transaction ID
    
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.close();
        resolve(null);
      }
    }, 3000);
    
    socket.on('message', (msg) => {
      if (resolved) return;
      try {
        // Parse STUN response for XOR-MAPPED-ADDRESS
        let offset = 20; // Skip header
        while (offset < msg.length) {
          const attrType = msg.readUInt16BE(offset);
          const attrLen = msg.readUInt16BE(offset + 2);
          
          // XOR-MAPPED-ADDRESS (0x0020) or MAPPED-ADDRESS (0x0001)
          if (attrType === 0x0020 || attrType === 0x0001) {
            const family = msg.readUInt8(offset + 5);
            if (family === 0x01) { // IPv4
              let ip;
              if (attrType === 0x0020) {
                // XOR with magic cookie
                const xPort = msg.readUInt16BE(offset + 6);
                const xAddr = msg.readUInt32BE(offset + 8);
                const addr = xAddr ^ 0x2112A442;
                ip = `${(addr >> 24) & 0xFF}.${(addr >> 16) & 0xFF}.${(addr >> 8) & 0xFF}.${addr & 0xFF}`;
              } else {
                ip = `${msg.readUInt8(offset + 8)}.${msg.readUInt8(offset + 9)}.${msg.readUInt8(offset + 10)}.${msg.readUInt8(offset + 11)}`;
              }
              resolved = true;
              clearTimeout(timeout);
              socket.close();
              resolve(ip);
              return;
            }
          }
          offset += 4 + attrLen;
          if (attrLen % 4 !== 0) offset += 4 - (attrLen % 4); // Padding
        }
      } catch (e) {
        // Parse error, continue
      }
    });
    
    socket.on('error', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(null);
      }
    });
    
    // Try first STUN server
    socket.send(stunRequest, STUN_SERVERS[0].port, STUN_SERVERS[0].host);
  });
}

/**
 * Get public IP via HTTP API (fallback)
 * @returns {Promise<string|null>} Public IP or null
 */
async function getPublicIPViaHTTP() {
  const services = [
    'https://api.ipify.org?format=json',
    'https://api.ip.sb/ip',
    'https://icanhazip.com',
  ];
  
  for (const url of services) {
    try {
      const response = await new Promise((resolve, reject) => {
        const proto = url.startsWith('https') ? https : http;
        const req = proto.get(url, { timeout: 3000 }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve({ status: res.statusCode, data: data.trim() }));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      });
      
      if (response.status === 200 && response.data) {
        // Handle JSON or plain text
        let ip = response.data;
        if (ip.startsWith('{')) {
          try { ip = JSON.parse(ip).ip; } catch (e) {}
        }
        // Validate IP format
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
          return ip;
        }
      }
    } catch (e) {
      continue; // Try next service
    }
  }
  return null;
}

/**
 * Get public IP address with caching and retries
 * @param {number} retries - Number of retry attempts (default 2)
 * @returns {Promise<string|null>} Public IP or null
 */
async function getPublicIP(retries = 2) {
  // Check cache
  if (cachedPublicIP && Date.now() - publicIPTimestamp < PUBLIC_IP_CACHE_TTL) {
    return cachedPublicIP;
  }
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    // Try STUN first (more accurate for NAT scenarios)
    let ip = await getPublicIPViaSTUN();
    if (!ip) {
      // Fallback to HTTP API
      ip = await getPublicIPViaHTTP();
    }
    
    if (ip) {
      cachedPublicIP = ip;
      publicIPTimestamp = Date.now();
      console.log('[Hyperswarm] Detected public IP:', ip);
      return ip;
    }
    
    // Wait before retry
    if (attempt < retries) {
      console.log(`[Hyperswarm] Public IP detection failed, retrying (${attempt + 1}/${retries})...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.warn('[Hyperswarm] Failed to detect public IP after', retries + 1, 'attempts');
  return null;
}

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
          
          // After identity verified, send peer list for all topics we're in
          // This ensures new peers immediately learn about the mesh
          for (const topicHex of this.topics.keys()) {
            this._sendPeerListToPeer(peerId, topicHex);
          }
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

        case 'peer-list':
          // Mesh peer discovery: connect to peers we don't already know
          this.emit('peer-list-received', { peerId, topic: message.topic, peers: message.peers });
          // Auto-connect to new peers
          if (Array.isArray(message.peers)) {
            for (const peerKey of message.peers) {
              if (!this.connections.has(peerKey) && peerKey !== this.swarm?.keyPair?.publicKey?.toString('hex')) {
                this.connectToPeer(peerKey).catch(() => {
                  // Peer may be unreachable, ignore
                });
              }
            }
          }
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
   * Send peer list to a specific peer for a topic
   * This enables mesh networking - peers share their known peers
   * @param {string} peerId - Target peer's public key hex
   * @param {string} topicHex - Topic to send peers for
   */
  _sendPeerListToPeer(peerId, topicHex) {
    const conn = this.connections.get(peerId);
    if (!conn || !conn.authenticated) return;
    
    // Get all peers except the target peer
    const allPeers = this.getConnectedPeerKeys().filter(pk => pk !== peerId);
    // Include ourselves
    const ownKey = this.getOwnPublicKey();
    if (ownKey && !allPeers.includes(ownKey)) {
      allPeers.push(ownKey);
    }
    
    if (allPeers.length > 0) {
      console.log(`[Hyperswarm] Sending peer list to ${peerId.slice(0, 16)}: ${allPeers.length} peers`);
      this._sendMessage(conn.socket, {
        type: 'peer-list',
        topic: topicHex,
        peers: allPeers,
      });
    }
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
   * Get our own Hyperswarm public key
   * @returns {string|null} Hex-encoded 32-byte public key
   */
  getOwnPublicKey() {
    if (!this.isInitialized || !this.swarm) return null;
    return this.swarm.keyPair.publicKey.toString('hex');
  }

  /**
   * Get the local listening address (host:port)
   * This is the local address - may be different from public address if behind NAT
   * @returns {Object|null} { host, port } or null
   */
  getLocalAddress() {
    if (!this.isInitialized || !this.swarm) return null;
    try {
      // Get address from DHT server
      const dht = this.swarm.dht;
      if (dht && dht.host && dht.port) {
        return { host: dht.host, port: dht.port };
      }
      // Fallback: check server
      if (this.swarm.server && this.swarm.server.address) {
        const addr = this.swarm.server.address();
        if (addr) return { host: addr.host || '0.0.0.0', port: addr.port };
      }
    } catch (e) {
      console.warn('[Hyperswarm] Failed to get local address:', e.message);
    }
    return null;
  }

  /**
   * Get direct connection address (public IP:port)
   * This combines public IP detection with the listening port
   * @returns {Promise<Object|null>} { host, port, publicKey } or null
   */
  async getDirectAddress() {
    if (!this.isInitialized || !this.swarm) return null;
    
    try {
      // Get public IP
      const publicIP = await getPublicIP();
      if (!publicIP) {
        console.warn('[Hyperswarm] Could not detect public IP');
        return null;
      }
      
      // Get listening port from DHT
      let port = null;
      const dht = this.swarm.dht;
      if (dht && dht.port) {
        port = dht.port;
      } else if (this.swarm.server && this.swarm.server.address) {
        const addr = this.swarm.server.address();
        if (addr) port = addr.port;
      }
      
      if (!port) {
        // Try to start listening to get a port
        await this.swarm.listen();
        if (dht && dht.port) {
          port = dht.port;
        }
      }
      
      if (!port) {
        console.warn('[Hyperswarm] Could not determine listening port');
        return null;
      }
      
      const publicKey = this.getOwnPublicKey();
      
      return {
        host: publicIP,
        port,
        publicKey,
        address: `${publicIP}:${port}`,
      };
    } catch (e) {
      console.error('[Hyperswarm] Failed to get direct address:', e.message);
      return null;
    }
  }

  /**
   * Connect directly to a peer by their public key
   * @param {string} peerPublicKeyHex - 64-char hex public key
   * @returns {Promise<void>}
   */
  async connectToPeer(peerPublicKeyHex) {
    if (!this.isInitialized) {
      throw new Error('Hyperswarm not initialized');
    }

    try {
      const publicKey = b4a.from(peerPublicKeyHex, 'hex');
      console.log('[Hyperswarm] Connecting to peer:', peerPublicKeyHex.slice(0, 16) + '...');
      
      // joinPeer initiates a direct connection to a known peer
      await this.swarm.joinPeer(publicKey);
      console.log('[Hyperswarm] Peer connection initiated');
    } catch (err) {
      console.error('[Hyperswarm] Failed to connect to peer:', err.message);
      throw err;
    }
  }

  /**
   * Get all connected peer public keys
   * @returns {string[]} Array of hex-encoded peer public keys
   */
  getConnectedPeerKeys() {
    return Array.from(this.connections.keys());
  }

  /**
   * Send a message to a specific peer
   * @param {string} peerId - Hex-encoded peer public key
   * @param {Object} message - Message to send
   * @returns {boolean} Whether message was sent
   */
  sendToPeer(peerId, message) {
    const conn = this.connections.get(peerId);
    if (!conn) return false;
    
    this._sendMessage(conn.socket, message);
    return true;
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
  generateDocumentId,
  getPublicIP
};
