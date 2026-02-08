/**
 * Sharing Utilities
 * Generate and parse shareable workspace/folder/document links
 * 
 * Reference: docs/WORKSPACE_PERMISSIONS_SPEC.md
 * 
 * SECURITY NOTES:
 * ---------------
 * 1. Sensitive data (passwords, keys) are placed in URL fragments (#hash).
 *    URL fragments are NOT sent to servers in HTTP requests (RFC 3986),
 *    and are NOT included in Referrer headers. This is a deliberate security choice.
 * 
 * 2. When handling share links, the application should:
 *    - Clear the URL fragment from browser history after processing
 *    - Never log or persist the fragment containing secrets
 *    - Process and consume secrets immediately, then discard from URL
 * 
 * 3. For maximum security, use the server-side token format (v4) which
 *    stores sensitive data server-side, not in the URL at all.
 * 
 * NEW Simplified Link Format (v4):
 *   https://{host}/invite/{uniqueToken}
 *   
 * Where:
 *   - uniqueToken: Random 22-char Base62 token (128 bits of entropy)
 *   - The token maps to {entityType, entityId, permission} stored server-side
 *   - Password is optional and NOT embedded in the link
 *   - Each link is unique - you can't change permission by editing the URL
 * 
 * Legacy formats still supported for backwards compatibility:
 *   - nightjar://{type}/{id}#p:{password}&perm:{level}
 */

import { secureError, secureWarn } from './secureLogger';
import { signData, verifySignature, uint8ToBase62, base62ToUint8 } from './identity';
import { isElectron } from '../hooks/useEnvironment';

// Import types for reference
// import type { EntityType, Permission, EntityTypeCode, PermissionCode } from '../types/workspace';

// Base62 alphabet for URL-safe encoding
const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Encode bytes to Base62 string
 * @param {Uint8Array|Buffer} bytes - Bytes to encode
 * @returns {string} Base62 encoded string
 */
function base62Encode(bytes) {
  if (bytes.length === 0) return '0';
  
  // Convert to BigInt
  let num = BigInt(0);
  for (const byte of bytes) {
    num = num * BigInt(256) + BigInt(byte);
  }
  
  // Convert to Base62
  let result = '';
  const base = BigInt(62);
  while (num > 0) {
    result = BASE62_ALPHABET[Number(num % base)] + result;
    num = num / base;
  }
  
  // Preserve leading zeros
  for (const byte of bytes) {
    if (byte === 0) {
      result = '0' + result;
    } else {
      break;
    }
  }
  
  return result || '0';
}

/**
 * Decode Base62 string to bytes
 * @param {string} str - Base62 encoded string
 * @returns {Uint8Array} Decoded bytes
 */
function base62Decode(str) {
  if (!str || str === '0') return new Uint8Array(0);
  
  // Count leading zeros
  let leadingZeros = 0;
  for (const char of str) {
    if (char === '0') {
      leadingZeros++;
    } else {
      break;
    }
  }
  
  // Convert from Base62 to BigInt
  let num = BigInt(0);
  const base = BigInt(62);
  for (const char of str) {
    const index = BASE62_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Invalid Base62 character: ${char}`);
    num = num * base + BigInt(index);
  }
  
  // Convert to bytes
  const bytes = [];
  while (num > 0) {
    bytes.unshift(Number(num % BigInt(256)));
    num = num / BigInt(256);
  }
  
  // Add leading zeros
  for (let i = 0; i < leadingZeros; i++) {
    bytes.unshift(0);
  }
  
  return new Uint8Array(bytes);
}

/**
 * Encode a list of peer addresses into a compact Base62 string
 * Format: Each peer is "ip:port" or "host:port"
 * Encoding: Join with semicolon, then Base62 encode
 * @param {Array<string>} peers - Array of peer addresses
 * @returns {string} Base62 encoded peer list
 */
function encodePeerList(peers) {
  if (!peers || peers.length === 0) return '';
  const joined = peers.join(';');
  const encoder = new TextEncoder();
  const bytes = encoder.encode(joined);
  return base62Encode(bytes);
}

/**
 * Decode a Base62 encoded peer list back to array of addresses
 * @param {string} encoded - Base62 encoded peer list
 * @returns {Array<string>} Array of peer addresses
 */
function decodePeerList(encoded) {
  if (!encoded) return [];
  try {
    const bytes = base62Decode(encoded);
    const decoder = new TextDecoder();
    const joined = decoder.decode(bytes);
    return joined.split(';').filter(p => p.length > 0);
  } catch (e) {
    secureError('Failed to decode peer list:', e);
    return [];
  }
}

/**
 * Share link format:
 * 
 * New format (v3):
 *   nightjar://{type}/{base62(payload)}#p:{password}&perm:{level}
 * 
 * Entity Type Codes:
 *   - w: workspace
 *   - f: folder
 *   - d: document
 * 
 * Permission Level Codes:
 *   - o: owner (full control)
 *   - e: editor (read/write)
 *   - v: viewer (read-only)
 * 
 * Payload Components:
 * - entityId: 16 bytes (UUID)
 * - version: 1 byte (protocol version)
 * - flags: 1 byte (options bitmap)
 * - checksum: 2 bytes (CRC16 of above)
 * 
 * Flags:
 * - bit 0: has password (Option B)
 * - bit 1: reserved (was read-only, now use permission level instead)
 * - bit 2: has embedded key (Option A)
 * - bit 3-7: reserved
 * 
 * Legacy format (v2) still supported for backwards compatibility:
 *   nightjar://d/{payload}#p:{password}
 */

const PROTOCOL_VERSION = 4; // Version 4: P2P with bootstrap peers

// Entity type codes
const ENTITY_TYPES = {
  workspace: 'w',
  folder: 'f',
  document: 'd',
};

// Maximum peers to embed in a link (to keep URLs manageable)
const MAX_EMBEDDED_PEERS = 5;

// Maximum Hyperswarm peer public keys to embed
const MAX_HYPERSWARM_PEERS = 3;

// Maximum mesh relay nodes to embed in share links
const MAX_MESH_RELAYS = 5;

const CODE_TO_ENTITY = {
  w: 'workspace',
  f: 'folder',
  d: 'document',
};

// Permission level codes
const PERMISSION_CODES = {
  owner: 'o',
  editor: 'e',
  viewer: 'v',
};

const CODE_TO_PERMISSION = {
  o: 'owner',
  e: 'editor',
  v: 'viewer',
};

// Legacy prefix for backwards compatibility
const LEGACY_LINK_PREFIX = 'nightjar://d/';

/**
 * Generate a shareable link for a workspace, folder, or document
 * 
 * @param {Object} options - Link options
 * @param {string} options.entityType - 'workspace' | 'folder' | 'document'
 * @param {string} options.entityId - 32-char hex entity ID (UUID)
 * @param {string} options.permission - 'owner' | 'editor' | 'viewer'
 * @param {boolean} options.hasPassword - Whether to use password mode (Option B)
 * @param {string} options.password - Password for key derivation (Option B)
 * @param {Uint8Array} options.encryptionKey - Direct encryption key (Option A)
 * @param {Array<string>} options.bootstrapPeers - Array of peer addresses (ip:port or host:port) - legacy WebSocket
 * @param {Array<string>} options.hyperswarmPeers - Array of Hyperswarm public keys (64-char hex)
 * @param {Array<string>} options.meshRelays - Array of mesh relay WebSocket URLs (wss://...)
 * @param {string} options.topicHash - Full 64-char hex Hyperswarm topic hash
 * @param {string} options.directAddress - Direct connection address (ip:port for P2P)
 * @param {string} options.serverUrl - Sync server URL for fallback
 * @returns {string} Shareable link
 */
export function generateShareLink(options) {
  const { 
    entityType = 'document',
    entityId,
    permission = 'editor',
    hasPassword = true,
    password = null,
    encryptionKey = null,
    bootstrapPeers = [],
    hyperswarmPeers = [], // Hyperswarm peer public keys
    meshRelays = [], // Mesh relay WebSocket URLs
    topicHash = null, // Full topic hash for DHT discovery
    directAddress = null, // Direct P2P address (ip:port)
    serverUrl = null, // Sync server URL for cross-platform sharing
    // Legacy support
    documentId,
    readOnly = false,
  } = options;
  
  // Support legacy documentId parameter
  const id = entityId || documentId;
  
  // Parse entity ID from hex
  const idBytes = hexToBytes(id);
  if (idBytes.length !== 16) {
    throw new Error('Entity ID must be 16 bytes (32 hex chars)');
  }
  
  // Build payload
  const payload = new Uint8Array(20); // 16 + 1 + 1 + 2
  payload.set(idBytes, 0);
  payload[16] = PROTOCOL_VERSION;
  
  // Build flags
  let flags = 0;
  if (hasPassword) flags |= 0x01;
  if (readOnly) flags |= 0x02; // Legacy flag for backwards compat
  if (encryptionKey && !hasPassword) flags |= 0x04;
  payload[17] = flags;
  
  // Calculate CRC16 checksum
  const checksum = crc16(payload.subarray(0, 18));
  payload[18] = (checksum >> 8) & 0xff;
  payload[19] = checksum & 0xff;
  
  // Encode to Base62
  const encoded = base62Encode(payload);
  
  // Build link with entity type prefix
  const typeCode = ENTITY_TYPES[entityType] || 'd';
  let link = `nightjar://${typeCode}/${encoded}`;
  
  // Build fragment with password and permission
  const fragmentParts = [];
  
  if (encryptionKey && !hasPassword) {
    // Option A: Direct key in URL fragment
    fragmentParts.push('k:' + bytesToBase64Url(encryptionKey));
  } else if (password && hasPassword) {
    // Option B with embedded password
    fragmentParts.push('p:' + encodeURIComponent(password));
  }
  
  // Always include permission level
  const permCode = PERMISSION_CODES[permission] || 'e';
  fragmentParts.push('perm:' + permCode);
  
  // Add direct P2P connection address (public IP:port)
  // This allows direct connections without DHT lookup
  if (directAddress) {
    fragmentParts.push('addr:' + encodeURIComponent(directAddress));
  }
  
  // Add bootstrap peers (limit to MAX_EMBEDDED_PEERS) - legacy WebSocket format
  if (bootstrapPeers && bootstrapPeers.length > 0) {
    const peersToEmbed = bootstrapPeers.slice(0, MAX_EMBEDDED_PEERS);
    const peersEncoded = encodePeerList(peersToEmbed);
    fragmentParts.push('peers:' + peersEncoded);
  }
  
  // Add Hyperswarm peer public keys (for true P2P without server)
  if (hyperswarmPeers && hyperswarmPeers.length > 0) {
    const hpeersToEmbed = hyperswarmPeers.slice(0, MAX_HYPERSWARM_PEERS);
    // Encode as comma-separated hex keys
    fragmentParts.push('hpeer:' + hpeersToEmbed.join(','));
  }
  
  // Add mesh relay nodes for bootstrap discovery
  // These are WebSocket URLs that can help find peers via the mesh network
  if (meshRelays && meshRelays.length > 0) {
    const relaysToEmbed = meshRelays.slice(0, MAX_MESH_RELAYS);
    // Encode as comma-separated URLs (URL-encoded)
    const relaysEncoded = relaysToEmbed.map(r => encodeURIComponent(r)).join(',');
    fragmentParts.push('nodes:' + relaysEncoded);
  }
  
  // Add sync server URL for cross-platform sharing (fallback only)
  // This allows Electron apps to connect to web-hosted workspaces
  if (serverUrl) {
    fragmentParts.push('srv:' + encodeURIComponent(serverUrl));
  }
  
  // Add Hyperswarm topic for P2P discovery
  if (entityType === 'workspace') {
    if (topicHash) {
      // Use provided topic hash (full 64-char hex)
      fragmentParts.push('topic:' + topicHash);
    } else {
      // Fallback: use entityId as topic hint (peers will derive full topic)
      fragmentParts.push('topic:' + entityId);
    }
  }
  
  if (fragmentParts.length > 0) {
    link += '#' + fragmentParts.join('&');
  }
  
  return link;
}

/**
 * Parse a shareable link (supports v4, v3, and legacy v2 formats)
 * Note: For compressed links, use parseShareLinkAsync instead
 * @param {string} link - Shareable link or just the encoded part
 * @returns {Object} Parsed link data
 */
export function parseShareLink(link) {
  // Handle various link formats
  let encoded = link.trim();
  let fragment = '';
  let entityType = 'document'; // Default for legacy links
  
  // Normalize protocol to lowercase for comparison
  const encodedLower = encoded.toLowerCase();
  
  // Check for compressed format - cannot parse synchronously
  if (encodedLower.startsWith('nightjar://c/')) {
    throw new Error('Compressed link detected. Use parseShareLinkAsync() instead.');
  }
  
  // Extract fragment (contains key, password, and/or permission)
  const hashIndex = encoded.indexOf('#');
  if (hashIndex !== -1) {
    fragment = encoded.slice(hashIndex + 1);
    encoded = encoded.slice(0, hashIndex);
  }
  
  // Parse entity type from protocol prefix (case-insensitive)
  if (encodedLower.startsWith('nightjar://')) {
    const afterProtocol = encoded.slice('nightjar://'.length);
    const slashIndex = afterProtocol.indexOf('/');
    
    if (slashIndex !== -1) {
      const typeCode = afterProtocol.slice(0, slashIndex);
      
      // Check if it's a new format type code
      if (typeCode in CODE_TO_ENTITY) {
        entityType = CODE_TO_ENTITY[typeCode];
        encoded = afterProtocol.slice(slashIndex + 1);
      } else if (typeCode === 'd') {
        // Legacy format: nightjar://d/...
        entityType = 'document';
        encoded = afterProtocol.slice(slashIndex + 1);
      } else {
        // Unknown format, try to parse as legacy
        encoded = afterProtocol;
        if (encoded.startsWith('d/')) {
          encoded = encoded.slice(2);
        }
      }
    }
  }
  
  // Remove any trailing path or query
  encoded = encoded.split('/')[0].split('?')[0];
  
  // Decode from Base62
  const payload = base62Decode(encoded);
  
  if (payload.length < 20) {
    throw new Error('Invalid share link: payload too short');
  }
  
  // Verify checksum
  const expectedChecksum = crc16(payload.subarray(0, 18));
  const actualChecksum = (payload[18] << 8) | payload[19];
  
  if (expectedChecksum !== actualChecksum) {
    throw new Error('Invalid share link: checksum mismatch');
  }
  
  // Parse components
  const entityId = bytesToHex(payload.subarray(0, 16));
  const version = payload[16];
  const flags = payload[17];
  
  if (version > PROTOCOL_VERSION) {
    secureWarn(`Share link uses newer protocol version ${version}, current is ${PROTOCOL_VERSION}`);
  }
  
  // Parse fragment for embedded key, password, and permission
  let encryptionKey = null;
  let embeddedPassword = null;
  let permission = 'editor'; // Default permission
  let bootstrapPeers = [];
  let hyperswarmPeers = []; // Hyperswarm peer public keys
  let meshRelays = []; // Mesh relay WebSocket URLs
  let directAddress = null; // Direct P2P connection address (ip:port)
  let serverUrl = null; // Remote sync server URL (for Electron joining web workspaces)
  let topic = null; // Hyperswarm topic for P2P discovery
  
  // Split fragment by & to handle multiple parameters
  const fragmentParams = fragment.split('&');
  for (const param of fragmentParams) {
    if (param.startsWith('k:')) {
      // Direct key (Option A)
      encryptionKey = base64UrlToBytes(param.slice(2));
    } else if (param.startsWith('p:')) {
      // Embedded password (Option B)
      embeddedPassword = decodeURIComponent(param.slice(2));
    } else if (param.startsWith('perm:')) {
      // Permission level
      const permCode = param.slice(5);
      if (permCode in CODE_TO_PERMISSION) {
        permission = CODE_TO_PERMISSION[permCode];
      }
    } else if (param.startsWith('addr:')) {
      // Direct P2P address (ip:port)
      directAddress = decodeURIComponent(param.slice(5));
    } else if (param.startsWith('peers:')) {
      // Bootstrap peers for P2P connection (legacy WebSocket format)
      bootstrapPeers = decodePeerList(param.slice(6));
    } else if (param.startsWith('hpeer:')) {
      // Hyperswarm peer public keys (comma-separated hex)
      hyperswarmPeers = param.slice(6).split(',').filter(p => p.length === 64);
    } else if (param.startsWith('nodes:')) {
      // Mesh relay WebSocket URLs (comma-separated, URL-encoded)
      meshRelays = param.slice(6).split(',').map(r => decodeURIComponent(r)).filter(Boolean);
    } else if (param.startsWith('srv:')) {
      // Sync server URL (for cross-platform workspace joining)
      const rawServerUrl = decodeURIComponent(param.slice(4));
      // Validate the URL scheme - reject file:// and other invalid schemes
      const lowerUrl = rawServerUrl.toLowerCase();
      if (lowerUrl.startsWith('ws:') || lowerUrl.startsWith('wss:') || 
          lowerUrl.startsWith('http:') || lowerUrl.startsWith('https:')) {
        serverUrl = rawServerUrl;
      } else {
        // Invalid scheme (e.g., file://) - ignore this serverUrl
        console.warn(`[Sharing] Ignoring invalid serverUrl in share link: ${rawServerUrl}`);
        serverUrl = null;
      }
    } else if (param.startsWith('topic:')) {
      // Hyperswarm topic for P2P discovery
      // This is used to find peers via DHT
      topic = param.slice(6);
    }
  }
  
  // Legacy: if readOnly flag is set and no permission specified, set viewer
  if ((flags & 0x02) !== 0 && !fragment.includes('perm:')) {
    permission = 'viewer';
  }
  
  return {
    entityType,
    entityId,
    // Legacy compatibility
    documentId: entityId,
    version,
    hasPassword: (flags & 0x01) !== 0,
    readOnly: (flags & 0x02) !== 0, // Legacy flag
    hasEmbeddedKey: (flags & 0x04) !== 0,
    encryptionKey,
    embeddedPassword,
    permission,
    bootstrapPeers, // Legacy WebSocket peers
    hyperswarmPeers, // Hyperswarm peer public keys
    meshRelays, // Mesh relay WebSocket URLs for bootstrap
    directAddress, // Direct P2P address (ip:port)
    serverUrl, // Sync server URL for remote workspaces
    topic, // Hyperswarm topic for P2P discovery
    raw: encoded
  };
}

/**
 * Parse a shareable link asynchronously (handles both compressed and uncompressed)
 * @param {string} link - Shareable link (possibly compressed)
 * @returns {Promise<Object>} Parsed link data
 */
export async function parseShareLinkAsync(link) {
  const trimmed = link.trim();
  
  // Decompress if needed
  if (isCompressedLink(trimmed)) {
    const decompressed = await decompressShareLink(trimmed);
    return parseShareLink(decompressed);
  }
  
  return parseShareLink(trimmed);
}

/**
 * Validate a share link without fully parsing
 * @param {string} link - Link to validate
 * @returns {boolean} Whether link is valid
 */
export function isValidShareLink(link) {
  try {
    parseShareLink(link);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract a compact share code from a full share link
 * The code is just the entity type + encoded payload (without nightjar:// prefix)
 * @param {string} link - Full nightjar:// share link
 * @returns {string} Compact share code (e.g., "w/abc123#p:mypass&perm:e")
 */
export function extractShareCode(link) {
  if (!link) return '';
  // Remove the nightjar:// prefix
  return link.replace(/^nightjar:\/\//, '');
}

/**
 * Expand a share code back to a full link
 * @param {string} code - Compact share code
 * @returns {string} Full nightjar:// link
 */
export function expandShareCode(code) {
  if (!code) return '';
  // Add the nightjar:// prefix if not present (case-insensitive check)
  if (code.toLowerCase().startsWith('nightjar://')) return code;
  return `nightjar://${code}`;
}

/**
 * Generate a shareable message with the link
 * @param {Object} options - Message options  
 * @param {string} options.link - The share link
 * @param {string} options.workspaceName - Name of the workspace
 * @param {string} options.permission - Permission level
 * @returns {string} Formatted message
 */
export function generateShareMessage(options) {
  const { link, workspaceName = 'a workspace', permission = 'viewer' } = options;
  const permLabel = permission === 'owner' ? 'full owner' 
    : permission === 'editor' ? 'editor' 
    : 'view-only';
  
  return `Join my Nightjar workspace "${workspaceName}" with ${permLabel} access:\n\n${link}\n\nOpen the link in Nightjar to connect.`;
}

/**
 * Generate a new document ID and corresponding share link
 * @param {Object} options - Link options
 * @returns {Promise<Object>} { documentId, shareLink, topic }
 */
export async function createNewDocument(options = {}) {
  // Generate random 16-byte document ID
  const docIdBytes = new Uint8Array(16);
  crypto.getRandomValues(docIdBytes);
  const documentId = bytesToHex(docIdBytes);
  
  // Generate share link
  const shareLink = generateShareLink({
    entityType: 'document',
    entityId: documentId,
    ...options
  });
  
  // Generate topic hash for P2P discovery
  const topic = await generateTopicFromDocId(documentId, options.password);
  
  return {
    documentId,
    shareLink,
    topic
  };
}

/**
 * Generate a new entity (workspace, folder, or document) with share link
 * @param {string} entityType - 'workspace' | 'folder' | 'document'
 * @param {Object} options - Share link options
 * @returns {Promise<Object>} { entityId, shareLink, topic }
 */
export async function createNewEntity(entityType, options = {}) {
  // Generate random 16-byte entity ID
  const idBytes = new Uint8Array(16);
  crypto.getRandomValues(idBytes);
  const entityId = bytesToHex(idBytes);
  
  // Generate share link
  const shareLink = generateShareLink({
    entityType,
    entityId,
    hasPassword: true,
    ...options
  });
  
  // Generate topic hash for P2P discovery
  // For workspaces, the topic is based on workspace ID
  // For folders/documents, it inherits from workspace
  // MUST await - generateTopicFromEntityId is now async to use correct sha256
  const topic = await generateTopicFromEntityId(entityType, entityId, options.password);
  
  return {
    entityId,
    shareLink,
    topic
  };
}

/**
 * IMPORTANT: This must match sidecar/mesh-constants.js getWorkspaceTopic()
 * Both use: SHA256('nightjar-workspace:' + workspaceId)
 * Password is NOT included in topic hash - it only affects encryption.
 */
const WORKSPACE_TOPIC_PREFIX = 'nightjar-workspace:';

/**
 * Generate topic hash from entity ID
 * IMPORTANT: Must use sha256Async for correct output (the sync sha256 has a padding bug)
 * @param {string} entityType - Entity type
 * @param {string} entityId - Entity ID (hex)
 * @param {string} password - Password for the entity (ignored for topic generation)
 * @returns {Promise<string>} Topic hash (hex)
 */
export async function generateTopicFromEntityId(entityType, entityId, password = '') {
  // For workspaces, use the standard prefix that matches sidecar/mesh-constants.js
  // This ensures all peers join the SAME DHT topic regardless of password
  // MUST use sha256Async - the sync sha256 has a padding bug that produces wrong hashes
  if (entityType === 'workspace') {
    return await sha256Async(WORKSPACE_TOPIC_PREFIX + entityId);
  }
  // Folders and documents inherit from their workspace's topic
  // They use a different prefix to avoid collisions
  const data = `nightjar-${entityType}:${entityId}`;
  return await sha256Async(data);
}

/**
 * Generate topic hash from document ID
 * @param {string} documentId - Document ID (hex)
 * @param {string} password - Optional password
 * @returns {Promise<string>} Topic hash (hex)
 */
export async function generateTopicFromDocId(documentId, password = '') {
  const data = password ? `${documentId}:${password}` : documentId;
  return await sha256Async(data);
}

/**
 * Generate topic hash for Hyperswarm DHT discovery
 * IMPORTANT: Must match sidecar/mesh-constants.js getWorkspaceTopic()
 * Password is NOT used for topic generation - only for encryption
 * @param {string} workspaceId - Workspace ID (hex)
 * @param {string} password - Ignored (kept for API compatibility)
 * @returns {Promise<string>} 64-char hex topic hash
 */
export async function generateTopicHash(workspaceId, password = '') {
  // Use the same formula as sidecar/mesh-constants.js
  // Must use sha256Async for correct output (the sync sha256 has a padding bug)
  return await sha256Async(WORKSPACE_TOPIC_PREFIX + workspaceId);
}

/**
 * Helper: Convert hex string to bytes
 */
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Helper: Convert bytes to hex string
 */
function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Helper: CRC16-CCITT
 */
function crc16(data) {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc <<= 1;
      }
      crc &= 0xffff;
    }
  }
  return crc;
}

/**
 * Helper: SHA256 hash
 */
async function sha256Async(data) {
  // Use Web Crypto API if available (browser/Electron)
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
    return bytesToHex(new Uint8Array(hashBuffer));
  }
  
  // Fallback for Node.js environment (tests)
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    const encoder = new TextEncoder();
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(data));
    return bytesToHex(new Uint8Array(hashBuffer));
  }
  
  // Node.js crypto module fallback for test environment
  if (typeof require !== 'undefined') {
    try {
      const nodeCrypto = require('crypto');
      return nodeCrypto.createHash('sha256').update(data).digest('hex');
    } catch (e) {
      // Ignore if require fails
    }
  }
  
  // No fallback to buggy sync sha256 - throw error instead
  throw new Error('Web Crypto API not available and no Node.js crypto fallback');
}

/**
 * DEPRECATED: Buggy synchronous SHA-256 implementation
 * This function has a padding bug that produces incorrect hashes.
 * DO NOT USE - kept only for documentation of the bug.
 * 
 * The bug: padding calculation used (bytes.length + 8) instead of (bytes.length + 1)
 * This caused the hash to differ from standard SHA-256 implementations.
 * 
 * Always use sha256Async() which uses Web Crypto API or Node.js crypto.
 */
// function sha256_BUGGY_DO_NOT_USE(data) { ... }

/**
 * Helper: Convert bytes to base64url string (URL-safe base64 without padding)
 */
function bytesToBase64Url(bytes) {
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Helper: Convert base64url string to bytes
 */
function base64UrlToBytes(str) {
  // Restore standard base64 characters
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Copy text to clipboard
 * @param {string} text - Text to copy
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    secureError('Failed to copy to clipboard:', err);
    return false;
  }
}

/**
 * Read text from clipboard
 * @returns {Promise<string>}
 */
export async function readFromClipboard() {
  try {
    return await navigator.clipboard.readText();
  } catch (err) {
    secureError('Failed to read from clipboard:', err);
    return '';
  }
}

// =============================================================================
// NEW: Simplified Invite Token System (v4)
// =============================================================================

/**
 * Generate a unique invite token (22 chars, 128 bits of entropy)
 * @returns {string} Unique invite token
 */
export function generateInviteToken() {
  const bytes = new Uint8Array(16); // 128 bits
  crypto.getRandomValues(bytes);
  return base62Encode(bytes);
}

/**
 * Generate a simplified invite link that uses a unique token
 * The token-to-entity mapping is stored server-side
 * 
 * @param {Object} options
 * @param {string} options.entityType - 'workspace' | 'folder' | 'document'
 * @param {string} options.entityId - Entity ID
 * @param {string} options.permission - 'owner' | 'editor' | 'viewer'
 * @param {boolean} [options.requiresPassword] - Whether password is required to join
 * @returns {Object} { token, link, inviteData }
 */
export function generateInviteLink(options) {
  const { 
    entityType = 'workspace',
    entityId, 
    permission = 'editor',
    requiresPassword = false,
  } = options;
  
  const token = generateInviteToken();
  
  // Build the invite link using current host
  const host = typeof window !== 'undefined' ? window.location.host : 'localhost:3000';
  const protocol = typeof window !== 'undefined' ? window.location.protocol : 'https:';
  const link = `${protocol}//${host}/invite/${token}`;
  
  // Return both the link and the data to store server-side
  return {
    token,
    link,
    inviteData: {
      token,
      entityType,
      entityId,
      permission,
      requiresPassword,
      createdAt: Date.now(),
    }
  };
}

/**
 * Parse an invite link to extract the token
 * @param {string} link - Invite link or token
 * @returns {Object|null} { token } or null if invalid
 */
export function parseInviteLink(link) {
  if (!link) return null;
  
  const trimmed = link.trim();
  
  // Check if it's a full URL with /invite/ path
  const inviteMatch = trimmed.match(/\/invite\/([A-Za-z0-9]+)$/);
  if (inviteMatch) {
    return { token: inviteMatch[1] };
  }
  
  // Check if it's just a token (22+ char alphanumeric)
  if (/^[A-Za-z0-9]{16,}$/.test(trimmed)) {
    return { token: trimmed };
  }
  
  // Try legacy nightjar:// format (case-insensitive)
  if (trimmed.toLowerCase().startsWith('nightjar://')) {
    try {
      const parsed = parseShareLink(trimmed);
      return {
        token: null, // No token for legacy links
        legacy: true,
        ...parsed
      };
    } catch (e) {
      secureError('Failed to parse legacy link:', e);
    }
  }
  
  return null;
}

/**
 * Generate a time-limited, cryptographically signed invite link
 * This is the new secure invite format that:
 * - Has an expiry time (max 24 hours)
 * - Is signed by the workspace owner
 * - Can be verified by any peer without server
 * 
 * Format: nightjar://w/{payload}#key:{encKey}&exp:{timestamp}&perm:{permission}&sig:{signature}
 * 
 * @param {Object} options - Invite options
 * @param {string} options.workspaceId - Workspace ID (32 hex chars)
 * @param {Uint8Array} options.encryptionKey - Workspace encryption key
 * @param {string} options.permission - 'editor' | 'viewer'
 * @param {number} options.expiryMinutes - Expiry time in minutes (15, 60, 240, 1440)
 * @param {Uint8Array} options.ownerPrivateKey - Owner's Ed25519 private key for signing
 * @param {string} options.ownerPublicKey - Owner's public key (base62)
 * @param {Array<string>} options.hyperswarmPeers - Hyperswarm peer public keys for P2P
 * @param {string} options.topicHash - DHT topic hash for P2P discovery
 * @param {string} options.directAddress - Direct P2P address (ip:port)
 * @param {string} options.serverUrl - Sync server URL for cross-platform sharing
 * @returns {Object} { link, expiry, signature }
 */
export function generateSignedInviteLink(options) {
  const {
    workspaceId,
    encryptionKey,
    permission = 'editor',
    expiryMinutes = 60, // Default 1 hour
    ownerPrivateKey,
    ownerPublicKey,
    hyperswarmPeers = [],
    topicHash = null,
    directAddress = null,
    serverUrl = null,
  } = options;
  
  if (!workspaceId || !encryptionKey || !ownerPrivateKey) {
    throw new Error('workspaceId, encryptionKey, and ownerPrivateKey are required');
  }
  
  // Enforce maximum expiry of 24 hours
  const maxMinutes = 24 * 60;
  const actualExpiry = Math.min(expiryMinutes, maxMinutes);
  const expiryTimestamp = Date.now() + (actualExpiry * 60 * 1000);
  
  // Create the message to sign: workspaceId|expiry|permission
  const messageToSign = `${workspaceId}|${expiryTimestamp}|${permission}`;
  
  // Sign the message with owner's private key
  const signature = signData(messageToSign, ownerPrivateKey);
  const signatureBase62 = uint8ToBase62(signature);
  
  // Build the base share link
  // Build the base share link with P2P info and serverUrl for cross-platform
  const baseLink = generateShareLink({
    entityType: 'workspace',
    entityId: workspaceId,
    permission,
    hasPassword: false,
    encryptionKey,
    hyperswarmPeers,
    topicHash,
    directAddress,
    serverUrl,
  });
  
  // Parse existing fragment and add new fields
  const [linkPart, existingFragment] = baseLink.split('#');
  const fragmentParts = existingFragment ? existingFragment.split('&') : [];
  
  // Add expiry and signature
  fragmentParts.push(`exp:${expiryTimestamp}`);
  fragmentParts.push(`sig:${signatureBase62}`);
  fragmentParts.push(`by:${ownerPublicKey}`);
  
  const finalLink = `${linkPart}#${fragmentParts.join('&')}`;
  
  return {
    link: finalLink,
    expiry: expiryTimestamp,
    expiryMinutes: actualExpiry,
    signature: signatureBase62,
    ownerPublicKey,
  };
}

/**
 * Validate a signed invite link
 * Checks expiry and verifies owner signature
 * 
 * @param {string} link - The invite link to validate
 * @param {string} expectedOwnerPublicKey - The workspace owner's public key (optional, for extra verification)
 * @returns {Object} { valid, error, expiry, permission, ownerPublicKey }
 */
export function validateSignedInvite(link) {
  try {
    const parsed = parseShareLink(link);
    if (!parsed) {
      return { valid: false, error: 'Invalid link format' };
    }
    
    // Extract expiry, signature, and owner from fragment
    const [, fragment] = link.split('#');
    if (!fragment) {
      // Legacy link without signature - still valid but not time-limited
      return { valid: true, legacy: true, ...parsed };
    }
    
    const params = {};
    fragment.split('&').forEach(part => {
      const [key, value] = part.split(':');
      if (key && value) params[key] = value;
    });
    
    const expiry = params.exp ? parseInt(params.exp, 10) : null;
    const signatureBase62 = params.sig;
    const ownerPublicKey = params.by;
    
    // If no expiry/signature, it's a legacy link
    if (!expiry || !signatureBase62) {
      return { valid: true, legacy: true, ...parsed };
    }
    
    // Check expiry
    if (Date.now() > expiry) {
      return { valid: false, error: 'Invite link has expired', expiry };
    }
    
    // Verify signature
    if (ownerPublicKey) {
      const messageToSign = `${parsed.entityId}|${expiry}|${parsed.permission}`;
      const signature = base62ToUint8(signatureBase62, 64);
      const publicKey = base62ToUint8(ownerPublicKey, 32);
      
      const isValid = verifySignature(messageToSign, signature, publicKey);
      if (!isValid) {
        return { valid: false, error: 'Invalid signature - link may have been tampered with' };
      }
    }
    
    return {
      valid: true,
      expiry,
      expiresIn: expiry - Date.now(),
      permission: parsed.permission,
      ownerPublicKey,
      ...parsed,
    };
  } catch (e) {
    // Ensure we capture the actual error message (Error objects don't stringify well)
    const errorMessage = e instanceof Error ? e.message : String(e);
    secureError('Failed to validate signed invite:', errorMessage);
    return { valid: false, error: errorMessage };
  }
}

/**
 * Check if a link is a new-style invite link (vs legacy)
 * @param {string} link 
 * @returns {boolean}
 */
export function isInviteLink(link) {
  if (!link) return false;
  return link.includes('/invite/') || /^[A-Za-z0-9]{16,}$/.test(link.trim());
}

// =============================================================================
// Link Compression (for "Shorten Link" feature)
// =============================================================================

/**
 * Compress a share link using deflate + base62 encoding
 * Preserves all information - can be fully decompressed
 * Uses Web Compression API (CompressionStream) where available
 * 
 * @param {string} link - Full nightjar:// link
 * @returns {Promise<string>} Compressed link in format: nightjar://c/{compressedData}
 */
export async function compressShareLink(link) {
  if (!link || !link.toLowerCase().startsWith('nightjar://')) {
    return link;
  }
  
  // Extract everything after nightjar:// (case-insensitive slice)
  const protocolEnd = link.toLowerCase().indexOf('nightjar://') + 'nightjar://'.length;
  const content = link.slice(protocolEnd);
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  
  try {
    // Use CompressionStream if available (modern browsers)
    if (typeof CompressionStream !== 'undefined') {
      const cs = new CompressionStream('deflate');
      const writer = cs.writable.getWriter();
      writer.write(data);
      writer.close();
      
      const chunks = [];
      const reader = cs.readable.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const compressed = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        compressed.set(chunk, offset);
        offset += chunk.length;
      }
      
      // Only use compressed if it's actually shorter
      if (compressed.length < data.length) {
        return 'nightjar://c/' + base62Encode(compressed);
      }
    }
  } catch (e) {
    secureWarn('Compression failed, returning original link:', e);
  }
  
  // Return original if compression not available or not beneficial
  return link;
}

/**
 * Decompress a compressed share link
 * @param {string} link - Compressed nightjar://c/... link
 * @returns {Promise<string>} Original full link
 */
export async function decompressShareLink(link) {
  const linkLower = link?.toLowerCase() || '';
  if (!link || !linkLower.startsWith('nightjar://c/')) {
    return link; // Not compressed, return as-is
  }
  
  // Find where the compressed data starts (after nightjar://c/)
  const compressedStart = linkLower.indexOf('nightjar://c/') + 'nightjar://c/'.length;
  const compressed = link.slice(compressedStart);
  const compressedBytes = base62Decode(compressed);
  
  try {
    if (typeof DecompressionStream !== 'undefined') {
      const ds = new DecompressionStream('deflate');
      const writer = ds.writable.getWriter();
      writer.write(compressedBytes);
      writer.close();
      
      const chunks = [];
      const reader = ds.readable.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const decompressed = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        decompressed.set(chunk, offset);
        offset += chunk.length;
      }
      
      const decoder = new TextDecoder();
      return 'nightjar://' + decoder.decode(decompressed);
    }
  } catch (e) {
    secureError('Decompression failed:', e);
  }
  
  throw new Error('Cannot decompress: DecompressionStream not available');
}

/**
 * Check if a link is compressed
 * @param {string} link 
 * @returns {boolean}
 */
export function isCompressedLink(link) {
  return link && link.toLowerCase().startsWith('nightjar://c/');
}

/**
 * Clear sensitive URL fragment from browser history
 * 
 * SECURITY: After processing a share link that contains secrets in the fragment,
 * call this to remove the secrets from browser history to prevent leakage.
 * 
 * @param {boolean} keepPath - If true, keeps the current path but clears fragment
 */
export function clearUrlFragment(keepPath = true) {
  try {
    if (typeof window !== 'undefined' && window.history) {
      const url = new URL(window.location.href);
      if (url.hash) {
        url.hash = '';
        // Use replaceState to avoid creating a history entry
        window.history.replaceState(null, '', keepPath ? url.pathname + url.search : '/');
      }
    }
  } catch (e) {
    // Ignore errors in environments without window/history
  }
}

/**
 * Check if the current URL contains sensitive fragment data
 * @returns {boolean}
 */
export function hasSecretFragment() {
  try {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash;
      return hash && (hash.includes('p:') || hash.includes('k:'));
    }
  } catch {
    // Ignore
  }
  return false;
}

/**
 * Fetch top mesh relay nodes for embedding in share links
 * This queries either the sidecar (Electron) or the server (web) for known relays
 * 
 * @param {number} limit - Maximum number of relays to fetch (default: 5)
 * @returns {Promise<string[]>} Array of WebSocket relay URLs
 */
export async function getMeshRelaysForSharing(limit = 5) {
  const relays = [];
  
  try {
    // First try the sidecar (Electron environment)
    if (typeof window !== 'undefined' && window.electronAPI) {
      const { META_WS_PORT } = await import('../config/constants.js');
      const ws = new WebSocket(`ws://localhost:${META_WS_PORT}`);
      const meshStatus = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('Timeout'));
        }, 2000);
        
        ws.onopen = () => {
          ws.send(JSON.stringify({ type: 'get-mesh-status' }));
        };
        
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'mesh-status') {
              clearTimeout(timeout);
              ws.close();
              resolve(msg);
            }
          } catch (e) {
            // Ignore parse errors
          }
        };
        
        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('WebSocket error'));
        };
      });
      
      if (meshStatus.topRelays && Array.isArray(meshStatus.topRelays)) {
        for (const relay of meshStatus.topRelays) {
          if (relay.endpoints && relay.endpoints[0]) {
            relays.push(relay.endpoints[0]);
          }
        }
      }
    } else {
      // Web environment - query the server API
      const response = await fetch('/api/mesh/relays?limit=' + limit);
      if (response.ok) {
        const data = await response.json();
        if (data.relays && Array.isArray(data.relays)) {
          for (const relay of data.relays) {
            if (relay.url) {
              relays.push(relay.url);
            }
          }
        }
      }
    }
  } catch (e) {
    // Mesh not available - return empty array
    secureWarn('Failed to fetch mesh relays for sharing:', e.message);
  }
  
  return relays.slice(0, limit);
}

/**
 * Convert HTTP/HTTPS URL to WebSocket URL
 * @param {string} url - HTTP(S) URL
 * @returns {string} WebSocket URL
 */
function convertHttpToWs(url) {
  return url.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
}

/**
 * Auto-detect relay server from browser context
 * 
 * Strategy:
 * - Browser clients: Use current server origin as relay (auto-detected)
 * - Electron clients: Use Hyperswarm DHT (no relay needed)
 * - Development: Use localhost:3000 unified server
 * 
 * This enables zero-config sharing:
 * - Web users share via their hosting server
 * - Electron users share via Hyperswarm DHT + embedded relay (UPnP)
 */
function getBootstrapRelayNodes() {
  if (typeof window === 'undefined') {
    return []; // Server-side, no relay needed
  }
  
  // Electron mode (dev or production) - use Hyperswarm DHT, no relay needed
  // This check works in both dev mode (http://127.0.0.1:5174) and production (file://)
  // because isElectron() checks for window.electronAPI which is set by preload.js
  if (isElectron()) {
    return [];
  }
  
  const protocol = window.location.protocol;
  const host = window.location.hostname;
  
  // Pure web development mode (no Electron) - use local unified server
  if (host === 'localhost' || host === '127.0.0.1') {
    return ['ws://localhost:3000'];
  }
  
  // Browser production - auto-detect relay from current server
  if (protocol === 'http:' || protocol === 'https:') {
    const origin = window.location.origin;
    return [convertHttpToWs(origin)];
  }
  
  return [];
}

// Export as a getter to allow dynamic detection
export const BOOTSTRAP_RELAY_NODES = typeof window !== 'undefined' ? getBootstrapRelayNodes() : [];

// Public STUN/TURN servers for WebRTC NAT traversal
// These are real, working servers provided by Google, Cloudflare, and Open Relay Project
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  // Free TURN relay from Open Relay Project (for when STUN isn't enough)
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
];

// Export constants for use in other modules
export {
  ENTITY_TYPES,
  CODE_TO_ENTITY,
  PERMISSION_CODES,
  CODE_TO_PERMISSION,
  PROTOCOL_VERSION,
  MAX_MESH_RELAYS,
};
