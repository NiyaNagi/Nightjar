/**
 * Mesh Network Constants (ES Module version)
 * 
 * Shared constants for the Nightjar Relay Mesh network.
 * This is the ES module version for use with the unified server.
 * 
 * Reference: docs/RELAY_MESH_ARCHITECTURE.md
 */

import crypto from 'crypto';

// =============================================================================
// Mesh Topics
// =============================================================================

/**
 * Version 1 mesh coordination topic string
 * All public nodes join the DHT topic derived from this
 */
export const MESH_TOPIC_V1 = 'nightjar-mesh-v1';

/**
 * Prefix for workspace-specific topics
 * Full topic = SHA256(WORKSPACE_TOPIC_PREFIX + workspaceId)
 */
export const WORKSPACE_TOPIC_PREFIX = 'nightjar-workspace:';

/**
 * Derive the mesh coordination topic buffer for Hyperswarm
 * @returns {Buffer} 32-byte topic hash
 */
export function getMeshTopic() {
  return crypto.createHash('sha256').update(MESH_TOPIC_V1).digest();
}

/**
 * Derive a workspace topic hash for DHT discovery
 * @param {string} workspaceId - Raw workspace ID (hex)
 * @returns {Buffer} 32-byte topic hash
 */
export function getWorkspaceTopic(workspaceId) {
  return crypto.createHash('sha256')
    .update(WORKSPACE_TOPIC_PREFIX + workspaceId)
    .digest();
}

/**
 * Get workspace topic as hex string (for logging/transmission)
 * @param {string} workspaceId - Raw workspace ID
 * @returns {string} 64-char hex topic hash
 */
export function getWorkspaceTopicHex(workspaceId) {
  return getWorkspaceTopic(workspaceId).toString('hex');
}

// =============================================================================
// Bootstrap Nodes
// =============================================================================

/**
 * Hardcoded bootstrap relay nodes
 * These are maintained by the Nightjar project for initial mesh entry
 */
export const BOOTSTRAP_NODES = [
  'wss://relay1.nightjar.io',
  'wss://relay2.nightjar.io',
  'wss://relay3.nightjar.io'
];

/**
 * Fallback bootstrap nodes for development/testing
 */
export const DEV_BOOTSTRAP_NODES = [
  'ws://localhost:3000'
];

// =============================================================================
// Timeouts and Intervals
// =============================================================================

/** Timeout for bootstrap connection attempts (ms) */
export const BOOTSTRAP_TIMEOUT_MS = 5000;

/** Interval between relay announcements on mesh topic (ms) */
export const RELAY_ANNOUNCE_INTERVAL_MS = 60000;

/** Timeout for workspace peer queries (ms) */
export const PEER_QUERY_TIMEOUT_MS = 3000;

/** How long announcement tokens are valid (ms) */
export const TOKEN_VALIDITY_MS = 600000; // 10 minutes

/** Interval for routing table refresh (ms) */
export const ROUTING_REFRESH_INTERVAL_MS = 300000; // 5 minutes

// =============================================================================
// Limits
// =============================================================================

/** Maximum relay nodes to embed in share links */
export const MAX_EMBEDDED_NODES = 5;

/** Maximum nodes in routing table */
export const MAX_ROUTING_TABLE_SIZE = 100;

/** Maximum workspace topics a node can announce */
export const MAX_WORKSPACE_ANNOUNCEMENTS = 50;

/** Default max peers per relay server */
export const DEFAULT_MAX_PEERS = 100;

// =============================================================================
// Rate Limiting
// =============================================================================

/** Rate limit window (ms) */
export const RATE_LIMIT_WINDOW_MS = 60000;

/** Maximum requests per rate limit window */
export const RATE_LIMIT_MAX_REQUESTS = 100;

// =============================================================================
// Message Types
// =============================================================================

/**
 * Mesh protocol message types
 */
export const MESSAGE_TYPES = {
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
};

// =============================================================================
// Server Modes
// =============================================================================

/**
 * Server operation modes
 */
export const SERVER_MODES = {
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
export function generateNodeId() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate an announcement token bound to an IP address
 * @param {string} ip - Requester's IP address
 * @param {string} secret - Server secret
 * @returns {{ token: string, expiresAt: number }}
 */
export function generateAnnouncementToken(ip, secret) {
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
export function verifyAnnouncementToken(token, ip, secret, issuedAt) {
  if (Date.now() > issuedAt + TOKEN_VALIDITY_MS) {
    return false; // Expired
  }
  
  const expectedData = `${ip}:${secret}:${issuedAt}`;
  const expectedToken = crypto.createHash('sha256').update(expectedData).digest('hex');
  return token === expectedToken;
}

/**
 * Parse relay endpoints from a comma-separated string
 * @param {string} nodesStr - Comma-separated relay URLs
 * @returns {string[]} Array of relay URLs
 */
export function parseBootstrapNodes(nodesStr) {
  if (!nodesStr) return [];
  return nodesStr.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Get version string for relay announcements
 * @returns {string} Version string (e.g., "1.0.0")
 */
export function getVersion() {
  // TODO: Read from package.json
  return '1.0.0';
}
