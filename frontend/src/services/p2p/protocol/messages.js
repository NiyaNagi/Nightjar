/**
 * P2P Protocol Message Types
 * 
 * All peers (Electron, Browser, Mobile) use the same protocol.
 * Messages are JSON-serializable and transport-agnostic.
 */

// ============ Message Type Constants ============

export const MessageTypes = {
  // Core sync messages
  SYNC: 'sync',
  AWARENESS: 'awareness',
  
  // Peer discovery
  PEER_REQUEST: 'peer-request',
  PEER_LIST: 'peer-list',
  PEER_ANNOUNCE: 'peer-announce',
  
  // WebRTC signaling (relayed through connected peers)
  WEBRTC_SIGNAL: 'webrtc-signal',
  
  // Identity (signed with Ed25519)
  IDENTITY: 'identity',
  
  // Connection management
  PING: 'ping',
  PONG: 'pong',
  DISCONNECT: 'disconnect',
};

// ============ Message Factories ============

/**
 * Create a sync message for Y.js updates
 * @param {string} docId - Document/workspace ID
 * @param {string} data - Base64-encoded encrypted Y.js update
 * @param {string} origin - Source peer ID (for loop prevention)
 * @returns {Object} Sync message
 */
export function createSyncMessage(docId, data, origin) {
  return {
    type: MessageTypes.SYNC,
    docId,
    data,
    origin,
    timestamp: Date.now(),
  };
}

/**
 * Create an awareness message for presence/cursor sync
 * @param {string} docId - Document/workspace ID
 * @param {Object} states - Map of clientId -> awareness state
 * @returns {Object} Awareness message
 */
export function createAwarenessMessage(docId, states) {
  return {
    type: MessageTypes.AWARENESS,
    docId,
    states,
    timestamp: Date.now(),
  };
}

/**
 * Create a peer request message
 * @returns {Object} Peer request message
 */
export function createPeerRequestMessage() {
  return {
    type: MessageTypes.PEER_REQUEST,
    timestamp: Date.now(),
  };
}

/**
 * Create a peer list response message
 * @param {Array} peers - Array of PeerAddress objects
 * @returns {Object} Peer list message
 */
export function createPeerListMessage(peers) {
  return {
    type: MessageTypes.PEER_LIST,
    peers,
    timestamp: Date.now(),
  };
}

/**
 * Create a peer announce message
 * @param {Object} peer - PeerAddress object for self
 * @returns {Object} Peer announce message
 */
export function createPeerAnnounceMessage(peer) {
  return {
    type: MessageTypes.PEER_ANNOUNCE,
    peer,
    timestamp: Date.now(),
  };
}

/**
 * Create a WebRTC signaling message
 * @param {string} targetPeerId - Destination peer ID
 * @param {string} fromPeerId - Source peer ID
 * @param {Object} signalData - RTCSessionDescription or RTCIceCandidate
 * @returns {Object} WebRTC signal message
 */
export function createWebRTCSignalMessage(targetPeerId, fromPeerId, signalData) {
  return {
    type: MessageTypes.WEBRTC_SIGNAL,
    targetPeerId,
    fromPeerId,
    signalData,
    timestamp: Date.now(),
  };
}

/**
 * Create an identity message (to be signed)
 * @param {string} publicKey - Ed25519 public key (hex)
 * @param {string} displayName - User display name
 * @param {string} color - User color (hex)
 * @param {Object} transports - Available transports { websocket, webrtc, hyperswarm, mdns }
 * @returns {Object} Identity message (unsigned)
 */
export function createIdentityMessage(publicKey, displayName, color, transports = {}) {
  return {
    type: MessageTypes.IDENTITY,
    publicKey,
    displayName,
    color,
    transports,
    timestamp: Date.now(),
  };
}

/**
 * Create a ping message for keepalive
 * @returns {Object} Ping message
 */
export function createPingMessage() {
  return {
    type: MessageTypes.PING,
    timestamp: Date.now(),
  };
}

/**
 * Create a pong response message
 * @param {number} pingTimestamp - Timestamp from the ping
 * @returns {Object} Pong message
 */
export function createPongMessage(pingTimestamp) {
  return {
    type: MessageTypes.PONG,
    pingTimestamp,
    timestamp: Date.now(),
  };
}

/**
 * Create a disconnect message
 * @param {string} reason - Reason for disconnection
 * @returns {Object} Disconnect message
 */
export function createDisconnectMessage(reason = 'normal') {
  return {
    type: MessageTypes.DISCONNECT,
    reason,
    timestamp: Date.now(),
  };
}

// ============ Peer Address Structure ============

/**
 * Create a PeerAddress object
 * @param {string} peerId - Unique peer identifier (public key)
 * @param {Object} transports - Available transports
 * @param {string} displayName - User display name
 * @param {string} color - User color
 * @returns {Object} PeerAddress
 */
export function createPeerAddress(peerId, transports, displayName, color) {
  return {
    peerId,
    transports: {
      websocket: transports.websocket || null,   // WebSocket URL
      webrtc: transports.webrtc || false,        // Supports WebRTC
      hyperswarm: transports.hyperswarm || null, // Hyperswarm public key
      mdns: transports.mdns || null,             // mDNS hostname:port
    },
    displayName,
    color,
    lastSeen: Date.now(),
  };
}

// ============ Message Validation ============

/**
 * Validate a message has required fields
 * @param {Object} message - Message to validate
 * @returns {boolean} Whether message is valid
 */
export function isValidMessage(message) {
  if (!message || typeof message !== 'object') return false;
  if (!message.type || typeof message.type !== 'string') return false;
  if (!message.timestamp || typeof message.timestamp !== 'number') return false;
  
  return true;
}

/**
 * Validate a sync message
 * @param {Object} message - Message to validate
 * @returns {boolean} Whether message is valid sync message
 */
export function isValidSyncMessage(message) {
  if (!isValidMessage(message)) return false;
  if (message.type !== MessageTypes.SYNC) return false;
  if (!message.docId || typeof message.docId !== 'string') return false;
  if (!message.data || typeof message.data !== 'string') return false;
  if (!message.origin || typeof message.origin !== 'string') return false;
  
  return true;
}

/**
 * Validate a peer address
 * @param {Object} peer - Peer address to validate
 * @returns {boolean} Whether peer address is valid
 */
export function isValidPeerAddress(peer) {
  if (!peer || typeof peer !== 'object') return false;
  if (!peer.peerId || typeof peer.peerId !== 'string') return false;
  if (!peer.transports || typeof peer.transports !== 'object') return false;
  
  return true;
}
