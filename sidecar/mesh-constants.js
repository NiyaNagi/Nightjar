/**
 * Mesh Network Constants
 * 
 * Shared constants for the Nightjar Relay Mesh network.
 * Used by both sidecar (Electron) and unified server.
 * 
 * Reference: docs/RELAY_MESH_ARCHITECTURE.md
 */

const crypto = require('crypto');

// =============================================================================
// Mesh Topics
// =============================================================================

/**
 * Version 1 mesh coordination topic string
 * All public nodes join the DHT topic derived from this
 */
const MESH_TOPIC_V1 = 'nightjar-mesh-v1';

/**
 * Prefix for workspace-specific topics
 * Full topic = SHA256(WORKSPACE_TOPIC_PREFIX + workspaceId)
 */
const WORKSPACE_TOPIC_PREFIX = 'nightjar-workspace:';

/**
 * Derive the mesh coordination topic buffer for Hyperswarm
 * @returns {Buffer} 32-byte topic hash
 */
function getMeshTopic() {
  return crypto.createHash('sha256').update(MESH_TOPIC_V1).digest();
}

/**
 * Derive a workspace topic hash for DHT discovery
 * @param {string} workspaceId - Raw workspace ID (hex)
 * @returns {Buffer} 32-byte topic hash
 */
function getWorkspaceTopic(workspaceId) {
  return crypto.createHash('sha256')
    .update(WORKSPACE_TOPIC_PREFIX + workspaceId)
    .digest();
}

/**
 * Get workspace topic as hex string (for logging/transmission)
 * @param {string} workspaceId - Raw workspace ID
 * @returns {string} 64-char hex topic hash
 */
function getWorkspaceTopicHex(workspaceId) {
  return getWorkspaceTopic(workspaceId).toString('hex');
}

// =============================================================================
// Bootstrap Nodes
// =============================================================================

/**
 * Bootstrap relay nodes
 * For Electron: Hyperswarm DHT is used for P2P discovery (no relay needed)
 * For Browser: Auto-detected from window.location.origin
 * These are only used if explicitly configured or in development
 */
const BOOTSTRAP_NODES = [
  // Empty by default - use Hyperswarm DHT or auto-detection
];

/**
 * Fallback bootstrap nodes for development/testing
 */
const DEV_BOOTSTRAP_NODES = [
  'ws://localhost:3000'
];

// =============================================================================
// Timeouts and Intervals
// =============================================================================

/** Timeout for bootstrap connection attempts (ms) */
const BOOTSTRAP_TIMEOUT_MS = 5000;

/** Interval between relay announcements on mesh topic (ms) */
const RELAY_ANNOUNCE_INTERVAL_MS = 60000;

/** Timeout for workspace peer queries (ms) */
const PEER_QUERY_TIMEOUT_MS = 3000;

/** How long announcement tokens are valid (ms) */
const TOKEN_VALIDITY_MS = 600000; // 10 minutes

/** Interval for routing table refresh (ms) */
const ROUTING_REFRESH_INTERVAL_MS = 300000; // 5 minutes

// =============================================================================
// Limits
// =============================================================================

/** Maximum relay nodes to embed in share links */
const MAX_EMBEDDED_NODES = 5;

/** Maximum nodes in routing table */
const MAX_ROUTING_TABLE_SIZE = 100;

/** Maximum workspace topics a node can announce */
const MAX_WORKSPACE_ANNOUNCEMENTS = 50;

/** Default max peers per relay server */
const DEFAULT_MAX_PEERS = 100;

// =============================================================================
// Rate Limiting
// =============================================================================

/** Rate limit window (ms) */
const RATE_LIMIT_WINDOW_MS = 60000;

/** Maximum requests per rate limit window */
const RATE_LIMIT_MAX_REQUESTS = 100;

// =============================================================================
// Message Types
// =============================================================================

/**
 * Mesh protocol message types
 */
const MESSAGE_TYPES = {
  // Relay announcements
  RELAY_ANNOUNCE: 'relay-announce',
  
  // Bootstrap
  BOOTSTRAP_REQUEST: 'bootstrap-request',
  BOOTSTRAP_RESPONSE: 'bootstrap-response',
  
  // Workspace discovery
  WORKSPACE_QUERY: 'workspace-query',
  WORKSPACE_RESPONSE: 'workspace-response',
  WORKSPACE_ANNOUNCE: 'workspace-announce',
  
  // Token management (anti-spoofing)
  TOKEN_REQUEST: 'token-request',
  TOKEN_RESPONSE: 'token-response',
  
  // Health/ping
  PING: 'ping',
  PONG: 'pong',
  
  // File Storage P2P transfer (see docs/FILE_STORAGE_SPEC.md §8)
  FILE_CHUNK_REQUEST: 'file-chunk-request',
  FILE_CHUNK_RESPONSE: 'file-chunk-response',
  FILE_AVAILABILITY_ANNOUNCE: 'file-availability-announce',
  FILE_AVAILABILITY_QUERY: 'file-availability-query',
  FILE_SEED_STATUS: 'file-seed-status',
};

// =============================================================================
// Server Modes
// =============================================================================

/**
 * Server operation modes
 */
const SERVER_MODES = {
  /** Full persistence + mesh participation */
  HOST: 'host',
  
  /** Signaling only + mesh participation, no persistence */
  RELAY: 'relay',
  
  /** Full features, no mesh (auth required) */
  PRIVATE: 'private',
};

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate a random node ID
 * @returns {string} 64-char hex node ID
 */
function generateNodeId() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate an announcement token bound to an IP address
 * @param {string} ip - Requester's IP address
 * @param {string} secret - Server secret
 * @returns {{ token: string, expiresAt: number }}
 */
function generateAnnouncementToken(ip, secret) {
  const timestamp = Date.now();
  const data = `${ip}:${secret}:${timestamp}`;
  const token = crypto.createHash('sha256').update(data).digest('hex');
  return {
    token,
    expiresAt: timestamp + TOKEN_VALIDITY_MS,
  };
}

/**
 * Verify an announcement token
 * @param {string} token - Token to verify
 * @param {string} ip - Requester's IP address
 * @param {string} secret - Server secret
 * @param {number} issuedAt - When token was issued
 * @returns {boolean} Whether token is valid
 */
function verifyAnnouncementToken(token, ip, secret, issuedAt) {
  if (Date.now() > issuedAt + TOKEN_VALIDITY_MS) {
    return false; // Expired
  }
  
  const expectedData = `${ip}:${secret}:${issuedAt}`;
  const expectedToken = crypto.createHash('sha256').update(expectedData).digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(token, 'hex'),
      Buffer.from(expectedToken, 'hex')
    );
  } catch (e) {
    return false; // Length mismatch or invalid hex
  }
}

/**
 * Parse relay endpoints from a comma-separated string
 * @param {string} nodesStr - Comma-separated relay URLs
 * @returns {string[]} Array of relay URLs
 */
function parseBootstrapNodes(nodesStr) {
  if (!nodesStr) return [];
  return nodesStr.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Get version string for relay announcements
 * @returns {string} Version string (e.g., "1.0.0")
 */
function getVersion() {
  try {
    const packageJson = require('../package.json');
    return packageJson.version || '1.0.0';
  } catch (err) {
    // Fallback if package.json cannot be read
    return '1.0.0';
  }
}

// =============================================================================
// Module Exports
// =============================================================================

module.exports = {
  // Topics
  MESH_TOPIC_V1,
  WORKSPACE_TOPIC_PREFIX,
  getMeshTopic,
  getWorkspaceTopic,
  getWorkspaceTopicHex,
  
  // Bootstrap
  BOOTSTRAP_NODES,
  DEV_BOOTSTRAP_NODES,
  
  // Timeouts
  BOOTSTRAP_TIMEOUT_MS,
  RELAY_ANNOUNCE_INTERVAL_MS,
  PEER_QUERY_TIMEOUT_MS,
  TOKEN_VALIDITY_MS,
  ROUTING_REFRESH_INTERVAL_MS,
  
  // Limits
  MAX_EMBEDDED_NODES,
  MAX_ROUTING_TABLE_SIZE,
  MAX_WORKSPACE_ANNOUNCEMENTS,
  DEFAULT_MAX_PEERS,
  
  // Rate Limiting
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
  
  // Message Types
  MESSAGE_TYPES,
  
  // Server Modes
  SERVER_MODES,
  
  // Utilities
  generateNodeId,
  generateAnnouncementToken,
  verifyAnnouncementToken,
  parseBootstrapNodes,
  getVersion,
};
