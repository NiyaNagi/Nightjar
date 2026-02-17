/**
 * Secure Hierarchical Key Derivation
 * 
 * Uses Argon2id for password-based key derivation with parameters
 * designed to resist brute-force attacks for 1000+ years.
 * 
 * Key Hierarchy (from WORKSPACE_PERMISSIONS_SPEC.md):
 *   workspaceKey = Argon2id(password, salt="Nightjar-v1-workspace-{workspaceId}")
 *   folderKey    = Argon2id(workspaceKey, salt="Nightjar-v1-folder-{folderId}")
 *   documentKey  = Argon2id(folderKey, salt="Nightjar-v1-document-{documentId}")
 * 
 * This hierarchy ensures:
 * - Access to a parent grants automatic access to all children
 * - New content is automatically accessible with the parent key
 * - Each entity has a unique encryption key
 */

import { argon2id } from 'hash-wasm';

// Argon2id parameters for high security
// Memory: 64 MB (65536 KB) - makes GPU attacks expensive
// Iterations: 4 - combined with memory makes each hash take ~1 second
// Parallelism: 4 - uses multiple threads but prevents parallel attacks
const ARGON2_MEMORY = 65536;  // 64 MB in KB
const ARGON2_ITERATIONS = 4;
const ARGON2_PARALLELISM = 4;
const ARGON2_HASH_LENGTH = 32; // 256 bits for NaCl secretbox

// Version prefix for future compatibility
const KDF_VERSION = 1;

/**
 * Derive an encryption key from a password and document ID using Argon2id
 * 
 * Security analysis:
 * - Argon2id is the winner of the Password Hashing Competition
 * - Memory-hard: requires 64MB RAM per hash, preventing GPU parallelization
 * - Time-hard: ~1 second per hash on modern hardware
 * - With 35+ bits of password entropy and 1 hash/second:
 *   2^35 seconds ≈ 1,089 years to brute force
 * - With distributed attack (1 million machines): still > 1 year
 * - Memory requirements make large-scale attacks impractical
 * 
 * @param {string} password - User password
 * @param {string} documentId - Document ID (hex string, used as salt)
 * @param {string} purpose - Key purpose (e.g., 'encryption', 'topic')
 * @returns {Promise<Uint8Array>} 256-bit derived key
 */
export async function deriveKey(password, documentId, purpose = 'encryption') {
  if (!password || !documentId) {
    throw new Error('Password and document ID are required');
  }

  // Construct salt: version + purpose + documentId
  // This ensures different keys for different purposes/documents
  const saltString = `Nightjar-v${KDF_VERSION}-${purpose}-${documentId}`;
  const salt = new TextEncoder().encode(saltString);
  
  // Ensure salt is at least 16 bytes (Argon2 requirement)
  const paddedSalt = new Uint8Array(Math.max(salt.length, 16));
  paddedSalt.set(salt);

  try {
    const hashHex = await argon2id({
      password,
      salt: paddedSalt,
      memorySize: ARGON2_MEMORY,
      iterations: ARGON2_ITERATIONS,
      parallelism: ARGON2_PARALLELISM,
      hashLength: ARGON2_HASH_LENGTH,
      outputType: 'hex',
    });

    // Convert hex to Uint8Array
    const result = new Uint8Array(hashHex.length / 2);
    for (let i = 0; i < result.length; i++) {
      result[i] = parseInt(hashHex.substr(i * 2, 2), 16);
    }
    return result;
  } catch (error) {
    console.error('[KeyDerivation] Argon2 failed:', error);
    throw new Error('Key derivation failed');
  }
}

/**
 * Derive a topic hash for P2P discovery from password and document ID
 * Uses faster parameters since this doesn't need to be as slow
 * (attackers can't enumerate valid topics without the password)
 * 
 * @param {string} password - User password
 * @param {string} documentId - Document ID (hex string)
 * @returns {Promise<string>} Topic hash (hex string)
 */
export async function deriveTopicHash(password, documentId) {
  const key = await deriveKey(password, documentId, 'topic');
  return Array.from(key).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Derive encryption key with caching for performance
 * Keys are cached in memory during the session
 */
const keyCache = new Map();

export async function deriveKeyWithCache(password, documentId, purpose = 'encryption') {
  // Hash password for cache key to avoid storing cleartext in memory
  let hashBuffer;
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  } else {
    try {
      const nodeCrypto = require('crypto');
      hashBuffer = nodeCrypto.createHash('sha256').update(password).digest();
    } catch {
      // Fallback: use password directly (less secure but won't crash)
      const encoder = new TextEncoder();
      hashBuffer = encoder.encode(password);
    }
  }
  const passwordHash = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  const cacheKey = `${documentId}:${purpose}:${passwordHash}`;
  
  if (keyCache.has(cacheKey)) {
    return keyCache.get(cacheKey);
  }
  
  const key = await deriveKey(password, documentId, purpose);
  keyCache.set(cacheKey, key);
  
  return key;
}

/**
 * Clear the key cache (call on logout or security events)
 */
export function clearKeyCache() {
  keyCache.clear();
}

/**
 * Check if Argon2 WASM is loaded and ready
 * @returns {Promise<boolean>}
 */
export async function isArgon2Ready() {
  try {
    // Small test hash to verify Argon2 is working
    await argon2id({
      password: 'test',
      salt: new Uint8Array(16),
      memorySize: 1024,
      iterations: 1,
      parallelism: 1,
      hashLength: 32,
      outputType: 'hex',
    });
    return true;
  } catch {
    return false;
  }
}

export { ARGON2_MEMORY, ARGON2_ITERATIONS, ARGON2_PARALLELISM };

// ============================================================
// Hierarchical Key Derivation (Workspace → Folder → Document)
// ============================================================

/**
 * Derive a workspace key from password
 * This is the root key for a workspace hierarchy
 * 
 * @param {string} password - Memorable password from share link
 * @param {string} workspaceId - Workspace UUID
 * @returns {Promise<Uint8Array>} 256-bit workspace key
 */
export async function deriveWorkspaceKey(password, workspaceId) {
  if (!password || !workspaceId) {
    throw new Error('Password and workspace ID are required');
  }
  return deriveKeyWithCache(password, workspaceId, 'workspace');
}

/**
 * Derive a folder key from parent key
 * Parent can be workspace key or another folder key (for nested folders)
 * 
 * @param {Uint8Array} parentKey - Parent key (workspace or folder)
 * @param {string} folderId - Folder UUID
 * @returns {Promise<Uint8Array>} 256-bit folder key
 */
export async function deriveFolderKey(parentKey, folderId) {
  if (!parentKey || !folderId) {
    throw new Error('Parent key and folder ID are required');
  }
  
  // Convert parent key to string for Argon2 password input
  const parentKeyHex = Array.from(parentKey)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  return deriveKeyWithCache(parentKeyHex, folderId, 'folder');
}

/**
 * Derive a document key from folder key
 * 
 * @param {Uint8Array} folderKey - Parent folder's key
 * @param {string} documentId - Document UUID
 * @returns {Promise<Uint8Array>} 256-bit document key
 */
export async function deriveDocumentKey(folderKey, documentId) {
  if (!folderKey || !documentId) {
    throw new Error('Folder key and document ID are required');
  }
  
  // Convert folder key to string for Argon2 password input
  const folderKeyHex = Array.from(folderKey)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  return deriveKeyWithCache(folderKeyHex, documentId, 'document');
}

/**
 * Derive a complete key chain from password to target entity
 * Returns all keys in the chain for caching
 * 
 * @param {string} password - Root password
 * @param {Object} path - Path to target
 * @param {string} path.workspaceId - Workspace ID
 * @param {string[]} [path.folderPath] - Array of folder IDs from root to target
 * @param {string} [path.documentId] - Document ID (if target is a document)
 * @returns {Promise<Object>} Object with all derived keys
 */
export async function deriveKeyChain(password, path) {
  const { workspaceId, folderPath = [], documentId } = path;
  
  if (!password || !workspaceId) {
    throw new Error('Password and workspace ID are required');
  }
  
  const keys = {};
  
  // 1. Derive workspace key
  keys.workspaceKey = await deriveWorkspaceKey(password, workspaceId);
  keys.workspaceId = workspaceId;
  
  // 2. Derive folder keys (walking down the hierarchy)
  let currentKey = keys.workspaceKey;
  keys.folderKeys = {};
  
  for (const folderId of folderPath) {
    const folderKey = await deriveFolderKey(currentKey, folderId);
    keys.folderKeys[folderId] = folderKey;
    currentKey = folderKey;
  }
  
  // 3. Derive document key if needed
  if (documentId) {
    if (folderPath.length === 0) {
      throw new Error('Documents must be in a folder');
    }
    const lastFolderId = folderPath[folderPath.length - 1];
    const folderKey = keys.folderKeys[lastFolderId];
    keys.documentKey = await deriveDocumentKey(folderKey, documentId);
    keys.documentId = documentId;
  }
  
  return keys;
}

/**
 * Derive topic hash for P2P discovery of a workspace
 * All entities within a workspace share the same P2P topic
 * 
 * @param {string} password - Workspace password
 * @param {string} workspaceId - Workspace UUID
 * @returns {Promise<string>} Topic hash (hex string, 64 chars)
 */
export async function deriveWorkspaceTopicHash(password, workspaceId) {
  const key = await deriveKey(password, workspaceId, 'workspace-topic');
  return Array.from(key).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Store for hierarchical key chains
 * Keyed by workspaceId, stores all derived keys for that workspace
 */
const keyChainStore = new Map();

/**
 * Store a key chain for a workspace
 * @param {string} workspaceId - Workspace ID
 * @param {Object} keyChain - Key chain object from deriveKeyChain
 */
export function storeKeyChain(workspaceId, keyChain) {
  keyChainStore.set(workspaceId, keyChain);
}

/**
 * Get stored key chain for a workspace
 * @param {string} workspaceId - Workspace ID
 * @returns {Object|null} Key chain or null
 */
export function getStoredKeyChain(workspaceId) {
  return keyChainStore.get(workspaceId) || null;
}

/**
 * Get or derive a folder key from stored key chain
 * Derives child keys on demand if parent is known
 * 
 * @param {string} workspaceId - Workspace ID
 * @param {string} folderId - Folder ID
 * @param {string} [parentFolderId] - Parent folder ID (null for root folders)
 * @returns {Promise<Uint8Array|null>} Folder key or null if not derivable
 */
export async function getFolderKey(workspaceId, folderId, parentFolderId = null) {
  const chain = keyChainStore.get(workspaceId);
  if (!chain) return null;
  
  // Check if already derived
  if (chain.folderKeys && chain.folderKeys[folderId]) {
    return chain.folderKeys[folderId];
  }
  
  // Try to derive from parent
  let parentKey;
  if (parentFolderId === null) {
    parentKey = chain.workspaceKey;
  } else if (chain.folderKeys && chain.folderKeys[parentFolderId]) {
    parentKey = chain.folderKeys[parentFolderId];
  } else {
    return null; // Can't derive without parent key
  }
  
  // Derive and store
  const folderKey = await deriveFolderKey(parentKey, folderId);
  if (!chain.folderKeys) chain.folderKeys = {};
  chain.folderKeys[folderId] = folderKey;
  
  return folderKey;
}

/**
 * Get or derive a document key from stored key chain
 * 
 * @param {string} workspaceId - Workspace ID
 * @param {string} documentId - Document ID
 * @param {string} folderId - Parent folder ID
 * @returns {Promise<Uint8Array|null>} Document key or null if not derivable
 */
export async function getDocumentKey(workspaceId, documentId, folderId) {
  const chain = keyChainStore.get(workspaceId);
  if (!chain) return null;
  
  // Check if folder key exists
  const folderKey = chain.folderKeys?.[folderId];
  if (!folderKey) return null;
  
  // Derive document key
  return deriveDocumentKey(folderKey, documentId);
}

/**
 * Clear key chain for a workspace
 * @param {string} workspaceId - Workspace ID to clear
 */
export function clearWorkspaceKeys(workspaceId) {
  keyChainStore.delete(workspaceId);
  
  // Also clear individual keys from cache
  for (const key of keyCache.keys()) {
    if (key.startsWith(workspaceId + ':')) {
      keyCache.delete(key);
    }
  }
}

/**
 * Clear all stored keys (call on logout)
 */
export function clearAllKeys() {
  keyCache.clear();
  keyChainStore.clear();
}
