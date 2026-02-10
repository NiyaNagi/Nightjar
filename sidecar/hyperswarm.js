/**
 * Hyperswarm P2P Discovery Module
 * Handles peer discovery and connection via DHT
 * 
 * Security: Identity messages are cryptographically signed to prevent impersonation
 * 
 * Direct P2P: Also supports direct IP:port connections via getDirectAddress()
 */

// OPTIMIZATION: Lazy-load hyperswarm package (it's ~40s to load!)
let Hyperswarm = null;
function ensureHyperswarmPackage() {
  if (!Hyperswarm) {
    Hyperswarm = require('hyperswarm');
  }
  return Hyperswarm;
}

const b4a = require('b4a');
const crypto = require('crypto');
const nacl = require('tweetnacl');
const { EventEmitter } = require('events');
const https = require('https');
const http = require('http');
const dgram = require('dgram');
const os = require('os');

// Public IP detection cache
let cachedPublicIP = null;
let publicIPTimestamp = 0;
const PUBLIC_IP_CACHE_TTL = 60000; // 1 minute cache

// Track network interfaces for change detection
let cachedNetworkInterfaces = null;

/**
 * Get a hash of current network interfaces for change detection
 * @returns {string} Hash of network interface addresses
 */
function getNetworkInterfaceHash() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (addrs) {
      for (const addr of addrs) {
        if (!addr.internal) {
          addresses.push(`${name}:${addr.address}`);
        }
      }
    }
  }
  return addresses.sort().join(',');
}

/**
 * Check if network interfaces have changed and invalidate IP cache if so
 * @returns {boolean} True if network changed
 */
function checkNetworkChange() {
  const currentHash = getNetworkInterfaceHash();
  if (cachedNetworkInterfaces !== null && cachedNetworkInterfaces !== currentHash) {
    console.log('[Hyperswarm] Network interface change detected, invalidating IP cache');
    cachedPublicIP = null;
    publicIPTimestamp = 0;
    cachedNetworkInterfaces = currentHash;
    return true;
  }
  cachedNetworkInterfaces = currentHash;
  return false;
}

/**
 * Clear the public IP cache (call when network changes)
 */
function clearIPCache() {
  console.log('[Hyperswarm] Clearing public IP cache');
  cachedPublicIP = null;
  publicIPTimestamp = 0;
}

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
    
    console.log('[Hyperswarm] Attempting STUN IP detection...');
    
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
        console.warn('[Hyperswarm] STUN request timed out');
        resolve(null);
      }
    }, 2000); // Reduced from 5s to 2s for faster startup
    
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
              console.log('[Hyperswarm] Got IP via STUN:', ip);
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
    
    socket.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        console.warn('[Hyperswarm] STUN socket error:', err.message);
        resolve(null);
      }
    });
    
    // Try first STUN server
    console.log(`[Hyperswarm] Sending STUN request to ${STUN_SERVERS[0].host}:${STUN_SERVERS[0].port}`);
    socket.send(stunRequest, STUN_SERVERS[0].port, STUN_SERVERS[0].host, (err) => {
      if (err) {
        console.warn('[Hyperswarm] Failed to send STUN request:', err.message);
      }
    });
  });
}

/**
 * Get public IP via HTTP API (fallback)
 * OPTIMIZATION: Reduced timeout from 5s to 2s and limited to 3 fastest services
 * @returns {Promise<string|null>} Public IP or null
 */
async function getPublicIPViaHTTP() {
  // Use only the fastest/most reliable services
  const services = [
    'https://api.ipify.org?format=json',
    'https://icanhazip.com',
    'https://checkip.amazonaws.com',
  ];
  
  for (const url of services) {
    try {
      console.log(`[Hyperswarm] Trying IP detection service: ${url}`);
      const response = await new Promise((resolve, reject) => {
        const proto = url.startsWith('https') ? https : http;
        const req = proto.get(url, { 
          timeout: 2000, // Reduced from 5s to 2s
          headers: {
            'User-Agent': 'Nightjar/1.0'
          }
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve({ status: res.statusCode, data: data.trim() }));
        });
        req.on('error', reject);
        req.on('timeout', () => { 
          req.destroy(); 
          reject(new Error('timeout')); 
        });
      });
      
      if (response.status === 200 && response.data) {
        // Handle JSON or plain text
        let ip = response.data;
        if (ip.startsWith('{')) {
          try { ip = JSON.parse(ip).ip; } catch (e) {}
        }
        // Clean up any whitespace/newlines
        ip = ip.trim();
        // Validate IP format
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
          console.log(`[Hyperswarm] Got IP from ${url}: ${ip}`);
          return ip;
        } else {
          console.warn(`[Hyperswarm] Invalid IP format from ${url}: ${ip}`);
        }
      }
    } catch (e) {
      console.warn(`[Hyperswarm] Failed to get IP from ${url}: ${e.message}`);
      continue; // Try next service
    }
  }
  console.error('[Hyperswarm] All HTTP IP services failed');
  return null;
}

/**
 * Get public IP address with caching and retries
 * OPTIMIZATION: Reduced retries from 3 to 1 for faster startup
 * @param {number} retries - Number of retry attempts (default 1)
 * @returns {Promise<string|null>} Public IP or null
 */
async function getPublicIP(retries = 1) {
  // Check for network changes first - this invalidates cache if interfaces changed
  checkNetworkChange();
  
  // Check cache
  if (cachedPublicIP && Date.now() - publicIPTimestamp < PUBLIC_IP_CACHE_TTL) {
    console.log('[Hyperswarm] Using cached public IP:', cachedPublicIP);
    return cachedPublicIP;
  }
  
  console.log('[Hyperswarm] ========== PUBLIC IP DETECTION ==========');
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      console.log(`[Hyperswarm] Retry attempt ${attempt}/${retries}...`);
    }
    
    // Try HTTP API first (more reliable on Windows)
    let ip = await getPublicIPViaHTTP();
    
    if (!ip) {
      // Fallback to STUN
      console.log('[Hyperswarm] HTTP detection failed, trying STUN...');
      ip = await getPublicIPViaSTUN();
    }
    
    if (ip) {
      cachedPublicIP = ip;
      publicIPTimestamp = Date.now();
      console.log('[Hyperswarm] ✓ Successfully detected public IP:', ip);
      console.log('[Hyperswarm] ==========================================');
      return ip;
    }
    
    // Wait before retry
    if (attempt < retries) {
      console.warn(`[Hyperswarm] Public IP detection failed, waiting before retry...`);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Increased wait time
    }
  }
  
  console.error('[Hyperswarm] ✗ Failed to detect public IP after', retries + 1, 'attempts');
  console.error('[Hyperswarm] This may be due to firewall, network configuration, or blocked services');
  console.log('[Hyperswarm] ==========================================');
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

// Constants for P2P networking
const MAX_PEER_LIST_SIZE = 50; // Limit peer list processing to prevent DoS
const MESSAGE_DEDUP_TTL = 60000; // 60 seconds TTL for message deduplication
const MESSAGE_DEDUP_CLEANUP_INTERVAL = 30000; // Clean up old message IDs every 30s
const HEARTBEAT_INTERVAL = 30000; // Send ping every 30 seconds
const HEARTBEAT_TIMEOUT = 10000; // Consider connection dead if no pong in 10s

class HyperswarmManager extends EventEmitter {
  constructor() {
    super();
    this.swarm = null;
    this.connections = new Map(); // peerId -> connection
    this.topics = new Map(); // topicHex -> { discovery, peers }
    this.identity = null;
    this.isInitialized = false;
    
    // Message deduplication: messageHash -> timestamp
    this.processedMessages = new Map();
    this.dedupCleanupInterval = null;
    
    // Heartbeat tracking
    this.heartbeatInterval = null;
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
    
    // Lazy-load hyperswarm package
    ensureHyperswarmPackage();
    
    // Create Hyperswarm instance with keypair for persistent peer ID
    const seed = b4a.from(identity.secretKey.slice(0, 32), 'hex');
    this.swarm = new Hyperswarm({ seed });

    // Handle new connections
    this.swarm.on('connection', (socket, peerInfo) => {
      this._handleConnection(socket, peerInfo);
    });

    this.isInitialized = true;
    console.log('[Hyperswarm] Initialized with peer ID:', this.swarm.keyPair.publicKey.toString('hex').slice(0, 16) + '...');
    
    // Start message deduplication cleanup interval
    this._startDedupCleanup();
    
    // Start heartbeat interval
    this._startHeartbeat();
    
    // Start listening in background (don't block initialization)
    // This will establish DHT connection and get a port asynchronously
    this.swarm.listen().then(() => {
      console.log('[Hyperswarm] Started listening on port:', this.swarm.dht?.port || 'unknown');
    }).catch(err => {
      console.warn('[Hyperswarm] Failed to start listening:', err.message);
    });
  }

  /**
   * Start periodic cleanup of old message IDs for deduplication
   * @private
   */
  _startDedupCleanup() {
    if (this.dedupCleanupInterval) return;
    
    this.dedupCleanupInterval = setInterval(() => {
      const now = Date.now();
      let cleaned = 0;
      for (const [hash, timestamp] of this.processedMessages) {
        if (now - timestamp > MESSAGE_DEDUP_TTL) {
          this.processedMessages.delete(hash);
          cleaned++;
        }
      }
      if (cleaned > 0) {
        console.log(`[Hyperswarm] Cleaned ${cleaned} old message IDs, ${this.processedMessages.size} remaining`);
      }
    }, MESSAGE_DEDUP_CLEANUP_INTERVAL);
  }

  /**
   * Start heartbeat mechanism for connection health monitoring
   * @private
   */
  _startHeartbeat() {
    if (this.heartbeatInterval) return;
    
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      // Collect peers to clean up first, then clean up after iteration
      // This avoids modifying the map during iteration
      const peersToCleanup = [];
      
      for (const [peerId, conn] of this.connections) {
        // Check if connection is still writable
        if (!conn.socket || !conn.socket.writable) {
          console.warn(`[Hyperswarm] Removing dead connection (not writable): ${peerId.slice(0, 16)}`);
          peersToCleanup.push(peerId);
          continue;
        }
        
        // Check for heartbeat timeout
        if (conn.lastPingSent && !conn.lastPongReceived) {
          const pingAge = now - conn.lastPingSent;
          if (pingAge > HEARTBEAT_TIMEOUT) {
            console.warn(`[Hyperswarm] Heartbeat timeout for peer: ${peerId.slice(0, 16)}`);
            peersToCleanup.push(peerId);
            continue;
          }
        }
        
        // Send ping
        conn.lastPingSent = now;
        this._sendMessage(conn.socket, { type: 'ping', timestamp: now });
      }
      
      // Clean up dead connections after iteration
      for (const peerId of peersToCleanup) {
        this._cleanupConnection(peerId);
      }
    }, HEARTBEAT_INTERVAL);
  }

  /**
   * Clean up a connection and notify listeners
   * @private
   */
  _cleanupConnection(peerId) {
    const conn = this.connections.get(peerId);
    if (!conn) return;
    
    // Notify about peer leaving for each topic
    for (const topic of conn.topics) {
      this.emit('peer-left', { peerId, topic, identity: conn.identity });
    }
    
    // Close socket if possible
    try {
      if (conn.socket && !conn.socket.destroyed) {
        conn.socket.destroy();
      }
    } catch (e) {
      // Ignore cleanup errors
    }
    
    this.connections.delete(peerId);
  }

  /**
   * Generate a hash for message deduplication
   * @private
   */
  _getMessageHash(peerId, data) {
    const content = typeof data === 'string' ? data : JSON.stringify(data);
    return crypto.createHash('sha256').update(`${peerId}:${content}`).digest('hex').slice(0, 32);
  }

  /**
   * Check if a message has already been processed (deduplication)
   * @private
   * @returns {boolean} True if message is a duplicate
   */
  _isDuplicateMessage(peerId, data) {
    const hash = this._getMessageHash(peerId, data);
    if (this.processedMessages.has(hash)) {
      return true;
    }
    this.processedMessages.set(hash, Date.now());
    return false;
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

      // Handle heartbeat messages immediately (no deduplication needed)
      if (message.type === 'ping') {
        this._sendMessage(conn.socket, { type: 'pong', timestamp: message.timestamp });
        return;
      }
      
      if (message.type === 'pong') {
        conn.lastPongReceived = Date.now();
        return;
      }

      // Check for duplicate messages (skip for identity which has its own replay protection)
      if (message.type !== 'identity' && this._isDuplicateMessage(peerId, data.toString())) {
        console.log(`[Hyperswarm] Dropping duplicate message from ${peerId.slice(0, 16)}: ${message.type}`);
        return;
      }

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
          
          // Reject stale identity messages (replay attack protection)
          const messageAge = Date.now() - (message.timestamp || 0);
          if (messageAge > 60000 || messageAge < -30000) { // Allow 1 minute old, 30s future (clock skew)
            console.warn('[Hyperswarm] Rejecting stale identity from peer:', peerId.slice(0, 16));
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
          
          // CRITICAL: Also send join-topic messages for all our topics to the new peer
          // This ensures they know we're in these topics and can request sync from us
          for (const topicHex of this.topics.keys()) {
            console.log(`[Hyperswarm] Sending join-topic to ${peerId.slice(0, 16)}... for topic ${topicHex.slice(0, 16)}...`);
            this._sendMessage(conn.socket, {
              type: 'join-topic',
              topic: topicHex
            });
          }
          break;

        case 'join-topic':
          // Only add if not already in topics (prevents duplicates from reciprocal messages)
          const alreadyTracked = conn.topics.has(message.topic);
          conn.topics.add(message.topic);
          
          if (!alreadyTracked) {
            this.emit('peer-joined', { peerId, topic: message.topic, identity: conn.identity });
            // When a peer joins our topic, send them our full state
            this.emit('sync-state-request', { peerId, topic: message.topic });
            
            // CRITICAL: If we're also on this topic, send back a join-topic so they can broadcast to us
            // This enables bidirectional communication immediately
            if (this.topics.has(message.topic)) {
              console.log(`[Hyperswarm] Sending reciprocal join-topic to ${peerId.slice(0, 16)}... for topic ${message.topic?.slice(0, 16)}...`);
              this._sendMessage(conn.socket, {
                type: 'join-topic',
                topic: message.topic
              });
            }
          }
          break;

        case 'leave-topic':
          conn.topics.delete(message.topic);
          this.emit('peer-left', { peerId, topic: message.topic, identity: conn.identity });
          break;

        case 'sync':
          this.emit('sync-message', { peerId, topic: message.topic, data: message.data });
          break;
        
        case 'sync-request':
          // Peer is requesting our full state for a topic
          console.log(`[Hyperswarm] Received sync-request from ${peerId.slice(0, 16)}... for topic ${message.topic?.slice(0, 16)}...`);
          this.emit('sync-state-request', { peerId, topic: message.topic });
          break;
        
        case 'sync-state':
          // Peer is sending us their full state (initial sync)
          console.log(`[Hyperswarm] Received sync-state from ${peerId.slice(0, 16)}... for topic ${message.topic?.slice(0, 16)}...`);
          this.emit('sync-state-received', { peerId, topic: message.topic, data: message.data });
          break;

        case 'sync-manifest-request':
          // Peer is requesting our sync manifest (doc/folder counts) for verification
          console.log(`[Hyperswarm] Received sync-manifest-request from ${peerId.slice(0, 16)}... for topic ${message.topic?.slice(0, 16)}...`);
          this.emit('sync-manifest-request', { peerId, topic: message.topic });
          break;
        
        case 'sync-manifest':
          // Peer is sending their sync manifest for comparison
          console.log(`[Hyperswarm] Received sync-manifest from ${peerId.slice(0, 16)}... for topic ${message.topic?.slice(0, 16)}...`);
          this.emit('sync-manifest-received', { peerId, topic: message.topic, manifest: message.manifest });
          break;
        
        case 'sync-documents-request':
          // Peer is requesting specific documents by ID
          console.log(`[Hyperswarm] Received sync-documents-request from ${peerId.slice(0, 16)}... for ${message.documentIds?.length || 0} document(s)`);
          this.emit('sync-documents-request', { peerId, topic: message.topic, documentIds: message.documentIds });
          break;

        case 'awareness':
          this.emit('awareness-update', { peerId, topic: message.topic, state: message.state });
          break;

        case 'peer-list':
          // Mesh peer discovery: connect to peers we don't already know
          // SECURITY: Limit peer list size to prevent DoS from malicious peers
          let peers = message.peers;
          if (Array.isArray(peers) && peers.length > MAX_PEER_LIST_SIZE) {
            console.warn(`[Hyperswarm] Truncating peer list from ${peers.length} to ${MAX_PEER_LIST_SIZE}`);
            peers = peers.slice(0, MAX_PEER_LIST_SIZE);
          }
          this.emit('peer-list-received', { peerId, topic: message.topic, peers });
          // Auto-connect to new peers
          if (Array.isArray(peers)) {
            for (const peerKey of peers) {
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
      // Check socket state before sending
      if (!socket || !socket.writable) {
        console.warn('[Hyperswarm] Cannot send message: socket not writable');
        return false;
      }
      socket.write(JSON.stringify(message));
      return true;
    } catch (err) {
      console.error('[Hyperswarm] Failed to send message:', err.message);
      return false;
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

    // Validate topicHex format: must be exactly 64 hex characters (32 bytes)
    if (!topicHex || typeof topicHex !== 'string' || !/^[0-9a-f]{64}$/i.test(topicHex)) {
      throw new Error(`Invalid topicHex format: expected 64-character hex string, got ${topicHex?.length || 0} chars`);
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
   * @param {number} retryCount - Internal retry counter
   */
  broadcastSync(topicHex, data, retryCount = 0) {
    const dataStr = Buffer.isBuffer(data) ? data.toString('base64') : 
                    data instanceof Uint8Array ? Buffer.from(data).toString('base64') : data;

    if (retryCount === 0) {
      console.log(`[Hyperswarm] broadcastSync called - topic: ${topicHex.slice(0, 8)}...`);
      console.log(`[Hyperswarm] Data type: ${typeof data}, size: ${dataStr.length}`);
    } else {
      console.log(`[Hyperswarm] broadcastSync retry ${retryCount} - topic: ${topicHex.slice(0, 8)}...`);
    }
    
    let sentCount = 0;
    let skippedCount = 0;
    for (const [peerId, conn] of this.connections) {
      if (conn.topics.has(topicHex)) {
        // Check socket state before sending
        if (!conn.socket || !conn.socket.writable) {
          console.warn(`[Hyperswarm] Skipping peer ${peerId.slice(0, 8)}... - socket not writable`);
          skippedCount++;
          continue;
        }
        console.log(`[Hyperswarm] → Sending to peer ${peerId.slice(0, 8)}... (${conn.identity?.displayName || 'unknown'})`);
        this._sendMessage(conn.socket, {
          type: 'sync',
          topic: topicHex,
          data: dataStr
        });
        sentCount++;
      }
    }
    
    console.log(`[Hyperswarm] broadcastSync complete - sent to ${sentCount} peer(s), skipped ${skippedCount}`);
    
    if (sentCount === 0) {
      // Retry up to 3 times with 300ms delay - peers may not have exchanged join-topic yet
      if (retryCount < 3) {
        console.log(`[Hyperswarm] No peers on topic yet, retrying in 300ms (attempt ${retryCount + 1}/3)...`);
        setTimeout(() => this.broadcastSync(topicHex, dataStr, retryCount + 1), 300);
        return;
      }
      console.warn(`[Hyperswarm] ⚠ No peers on topic ${topicHex.slice(0, 8)}... to receive broadcast after ${retryCount} retries`);
      const topicsWithPeers = [];
      for (const [peerId, conn] of this.connections) {
        topicsWithPeers.push(...Array.from(conn.topics).map(t => t.slice(0, 8)));
      }
      console.warn(`[Hyperswarm] Peers are on topics: ${topicsWithPeers.join(', ') || 'none'}`);
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
   * Send a sync request to a specific peer asking for their full state
   * @param {string} peerId - Target peer's public key hex
   * @param {string} topicHex - Topic to sync
   */
  sendSyncRequest(peerId, topicHex) {
    const conn = this.connections.get(peerId);
    if (!conn || !conn.socket) {
      console.warn(`[Hyperswarm] Cannot send sync-request - peer ${peerId.slice(0, 16)}... not connected`);
      return false;
    }
    console.log(`[Hyperswarm] Sending sync-request to ${peerId.slice(0, 16)}... for topic ${topicHex.slice(0, 16)}...`);
    return this._sendMessage(conn.socket, {
      type: 'sync-request',
      topic: topicHex
    });
  }

  /**
   * Send full state to a specific peer (response to sync-request or on join)
   * @param {string} peerId - Target peer's public key hex
   * @param {string} topicHex - Topic the state belongs to
   * @param {string} data - Base64-encoded state data
   */
  sendSyncState(peerId, topicHex, data) {
    const conn = this.connections.get(peerId);
    if (!conn || !conn.socket) {
      console.warn(`[Hyperswarm] Cannot send sync-state - peer ${peerId.slice(0, 16)}... not connected`);
      return false;
    }
    console.log(`[Hyperswarm] Sending sync-state to ${peerId.slice(0, 16)}... for topic ${topicHex.slice(0, 16)}... (${data?.length || 0} bytes)`);
    return this._sendMessage(conn.socket, {
      type: 'sync-state',
      topic: topicHex,
      data: data
    });
  }

  /**
   * Request sync manifest from a specific peer (for verification)
   * @param {string} peerId - Target peer's public key hex
   * @param {string} topicHex - Topic to get manifest for
   */
  sendSyncManifestRequest(peerId, topicHex) {
    const conn = this.connections.get(peerId);
    if (!conn || !conn.socket) {
      console.warn(`[Hyperswarm] Cannot send sync-manifest-request - peer ${peerId.slice(0, 16)}... not connected`);
      return false;
    }
    console.log(`[Hyperswarm] Sending sync-manifest-request to ${peerId.slice(0, 16)}... for topic ${topicHex.slice(0, 16)}...`);
    return this._sendMessage(conn.socket, {
      type: 'sync-manifest-request',
      topic: topicHex
    });
  }

  /**
   * Send sync manifest to a specific peer (response to sync-manifest-request)
   * @param {string} peerId - Target peer's public key hex
   * @param {string} topicHex - Topic the manifest belongs to
   * @param {Object} manifest - Manifest object with documentIds, documentCount, folderCount
   */
  sendSyncManifest(peerId, topicHex, manifest) {
    const conn = this.connections.get(peerId);
    if (!conn || !conn.socket) {
      console.warn(`[Hyperswarm] Cannot send sync-manifest - peer ${peerId.slice(0, 16)}... not connected`);
      return false;
    }
    console.log(`[Hyperswarm] Sending sync-manifest to ${peerId.slice(0, 16)}... docs: ${manifest?.documentCount}, folders: ${manifest?.folderCount}`);
    return this._sendMessage(conn.socket, {
      type: 'sync-manifest',
      topic: topicHex,
      manifest: manifest
    });
  }

  /**
   * Request specific documents from a peer (for missing document recovery)
   * @param {string} peerId - Target peer's public key hex
   * @param {string} topicHex - Topic the documents belong to
   * @param {Array<string>} documentIds - List of document IDs to request
   */
  sendDocumentsRequest(peerId, topicHex, documentIds) {
    const conn = this.connections.get(peerId);
    if (!conn || !conn.socket) {
      console.warn(`[Hyperswarm] Cannot send sync-documents-request - peer ${peerId.slice(0, 16)}... not connected`);
      return false;
    }
    console.log(`[Hyperswarm] Sending sync-documents-request to ${peerId.slice(0, 16)}... for ${documentIds?.length || 0} document(s)`);
    return this._sendMessage(conn.socket, {
      type: 'sync-documents-request',
      topic: topicHex,
      documentIds: documentIds
    });
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
        console.log('[Hyperswarm] No port found, attempting to start listening...');
        await this.swarm.listen();
        
        // Wait a bit for DHT to be ready
        await new Promise(resolve => setTimeout(resolve, 500));
        
        if (dht && dht.port) {
          port = dht.port;
        } else if (this.swarm.server && this.swarm.server.address) {
          const addr = this.swarm.server.address();
          if (addr) port = addr.port;
        }
      }
      
      if (!port) {
        console.warn('[Hyperswarm] Could not determine listening port after retry');
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

    // Stop deduplication cleanup
    if (this.dedupCleanupInterval) {
      clearInterval(this.dedupCleanupInterval);
      this.dedupCleanupInterval = null;
    }
    
    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Leave all topics
    for (const topicHex of this.topics.keys()) {
      await this.leaveTopic(topicHex);
    }

    // Close swarm
    await this.swarm.destroy();
    
    this.connections.clear();
    this.topics.clear();
    this.processedMessages.clear();
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
  getPublicIP,
  clearIPCache,
  checkNetworkChange
};
