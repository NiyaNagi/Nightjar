/**
 * inventoryAddressStore.js
 * 
 * Client-side encryption/decryption for inventory addresses.
 * Communicates with sidecar LevelDB via IPC for persistence.
 * 
 * Architecture: Encryption/decryption happens in the frontend (renderer process).
 * The sidecar stores opaque encrypted blobs via IPC.
 * 
 * See docs/INVENTORY_SYSTEM_SPEC.md §11.3.3
 */

import nacl from 'tweetnacl';
import { deriveKeyWithCache, getStoredKeyChain } from './keyDerivation';
import { isElectron } from '../hooks/useEnvironment';

// ── IndexedDB helpers (web fallback) ─────────────────────────

const IDB_NAME = 'nightjar-inventory';
const IDB_STORE = 'addresses';
const IDB_VERSION = 1;

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key, value) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(key) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbList(prefix) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const store = tx.objectStore(IDB_STORE);
    const keys = [];
    const req = store.openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
          keys.push(cursor.key);
        }
        cursor.continue();
      } else {
        resolve(keys);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

// ── Key Material ─────────────────────────────────────────────

/**
 * Get the key material (password or hex-encoded key) for encryption operations.
 * 
 * @param {Object} currentWorkspace - From useWorkspaces()
 * @param {string} currentWorkspaceId - Workspace ID
 * @returns {string} Password string or hex-encoded workspace key
 */
export function getWorkspaceKeyMaterial(currentWorkspace, currentWorkspaceId) {
  if (currentWorkspace?.password) {
    return currentWorkspace.password;
  }
  const keyChain = getStoredKeyChain(currentWorkspaceId);
  if (keyChain?.workspaceKey) {
    return Array.from(keyChain.workspaceKey)
      .map(b => b.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('No workspace key material available');
}

// ── Address Storage (Admin) ──────────────────────────────────

/**
 * Store an encrypted address for a request.
 * Called by admin when processing a pending address or submitting on behalf.
 *
 * @param {string} keyMaterial - From getWorkspaceKeyMaterial()
 * @param {string} inventorySystemId
 * @param {string} requestId
 * @param {Object} addressData - Full address object
 */
export async function storeAddress(keyMaterial, inventorySystemId, requestId, addressData) {
  const key = await deriveKeyWithCache(
    keyMaterial,
    inventorySystemId,
    'inventory-addresses'
  );

  const plaintext = new TextEncoder().encode(JSON.stringify(addressData));
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(plaintext, nonce, key);

  const packed = new Uint8Array(nonce.length + ciphertext.length);
  packed.set(nonce, 0);
  packed.set(ciphertext, nonce.length);

  if (isElectron()) {
    await window.electronAPI.inventory.storeAddress(inventorySystemId, requestId, Array.from(packed));
  } else {
    await idbPut(`inv-addr:${inventorySystemId}:${requestId}`, packed);
  }
}

/**
 * Retrieve and decrypt an address for a request.
 *
 * @param {string} keyMaterial - From getWorkspaceKeyMaterial()
 * @param {string} inventorySystemId
 * @param {string} requestId
 * @returns {Object|null} Decrypted address object or null if not found
 */
export async function getAddress(keyMaterial, inventorySystemId, requestId) {
  const key = await deriveKeyWithCache(
    keyMaterial,
    inventorySystemId,
    'inventory-addresses'
  );

  let packed;
  if (isElectron()) {
    const data = await window.electronAPI.inventory.getAddress(inventorySystemId, requestId);
    if (!data) return null;
    packed = new Uint8Array(data);
  } else {
    packed = await idbGet(`inv-addr:${inventorySystemId}:${requestId}`);
  }

  if (!packed) return null;

  const nonce = packed.slice(0, nacl.secretbox.nonceLength);
  const ciphertext = packed.slice(nacl.secretbox.nonceLength);

  const plaintext = nacl.secretbox.open(ciphertext, nonce, key);
  if (!plaintext) throw new Error('Failed to decrypt address — wrong key or corrupted data');

  return JSON.parse(new TextDecoder().decode(plaintext));
}

/**
 * Delete an address (after confirm-delete or cancellation).
 *
 * @param {string} inventorySystemId
 * @param {string} requestId
 */
export async function deleteAddress(inventorySystemId, requestId) {
  if (isElectron()) {
    await window.electronAPI.inventory.deleteAddress(inventorySystemId, requestId);
  } else {
    await idbDelete(`inv-addr:${inventorySystemId}:${requestId}`);
  }
}

/**
 * List all stored address keys for an inventory system.
 *
 * @param {string} inventorySystemId
 * @returns {string[]} Array of request IDs that have stored addresses
 */
export async function listAddresses(inventorySystemId) {
  if (isElectron()) {
    return await window.electronAPI.inventory.listAddresses(inventorySystemId);
  } else {
    const prefix = `inv-addr:${inventorySystemId}:`;
    const keys = await idbList(prefix);
    return keys.map(k => k.slice(prefix.length));
  }
}
