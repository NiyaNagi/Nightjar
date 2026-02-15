/**
 * inventorySavedAddresses.js
 * 
 * Requestor saved address management — encrypt/store/retrieve saved addresses via IPC.
 * Same pattern as inventoryAddressStore.js but for the requestor's personal saved addresses.
 * 
 * See docs/INVENTORY_SYSTEM_SPEC.md §7.1 (Requestor saved addresses = Private, local only)
 */

import nacl from 'tweetnacl';
import { deriveKeyWithCache } from './keyDerivation';
import { isElectron } from '../hooks/useEnvironment';
import { generateId } from './inventoryValidation';

// ── IndexedDB helpers (web fallback) ─────────────────────────

const IDB_NAME = 'nightjar-inventory';
const IDB_STORE = 'saved-addresses';
const IDB_VERSION = 2; // Bumped from 1 to add saved-addresses store

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains('addresses')) {
        db.createObjectStore('addresses');
      }
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

// ── Saved Address Operations ─────────────────────────────────

/**
 * Store a saved address for the current user.
 * 
 * @param {string} keyMaterial - From getWorkspaceKeyMaterial()
 * @param {string} userPublicKey - User's publicKeyBase62 (used as namespace)
 * @param {Object} savedAddress - { label, recipientName, street1, street2, city, state, zip, phone }
 * @returns {string} The generated address ID
 */
export async function storeSavedAddress(keyMaterial, userPublicKey, savedAddress) {
  const addressId = savedAddress.id || generateId('addr-');
  const record = { ...savedAddress, id: addressId, updatedAt: Date.now() };

  const key = await deriveKeyWithCache(
    keyMaterial,
    userPublicKey,
    'saved-addresses'
  );

  const plaintext = new TextEncoder().encode(JSON.stringify(record));
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(plaintext, nonce, key);

  const packed = new Uint8Array(nonce.length + ciphertext.length);
  packed.set(nonce, 0);
  packed.set(ciphertext, nonce.length);

  if (isElectron()) {
    await window.electronAPI.inventory.storeSavedAddress(addressId, Array.from(packed));
  } else {
    await idbPut(`inv-saved-addr:${userPublicKey}:${addressId}`, packed);
  }

  return addressId;
}

/**
 * Get all saved addresses for the current user.
 * 
 * @param {string} keyMaterial - From getWorkspaceKeyMaterial()
 * @param {string} userPublicKey - User's publicKeyBase62
 * @returns {Object[]} Array of decrypted saved address objects
 */
export async function getSavedAddresses(keyMaterial, userPublicKey) {
  const key = await deriveKeyWithCache(
    keyMaterial,
    userPublicKey,
    'saved-addresses'
  );

  let entries;
  if (isElectron()) {
    entries = await window.electronAPI.inventory.getSavedAddresses();
  } else {
    // Web: scan IDB for matching keys
    const db = await openIDB();
    entries = await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const results = [];
      const prefix = `inv-saved-addr:${userPublicKey}:`;
      const req = store.openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
            results.push({ id: cursor.key.slice(prefix.length), data: cursor.value });
          }
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  const addresses = [];
  for (const entry of entries) {
    try {
      const packed = new Uint8Array(entry.data || entry);
      const nonce = packed.slice(0, nacl.secretbox.nonceLength);
      const ciphertext = packed.slice(nacl.secretbox.nonceLength);
      const plaintext = nacl.secretbox.open(ciphertext, nonce, key);
      if (plaintext) {
        addresses.push(JSON.parse(new TextDecoder().decode(plaintext)));
      }
    } catch (err) {
      console.warn('Failed to decrypt saved address:', err);
    }
  }

  return addresses.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/**
 * Delete a saved address.
 * 
 * @param {string} userPublicKey - User's publicKeyBase62
 * @param {string} addressId - Saved address ID
 */
export async function deleteSavedAddress(userPublicKey, addressId) {
  if (isElectron()) {
    await window.electronAPI.inventory.deleteSavedAddress(addressId);
  } else {
    await idbDelete(`inv-saved-addr:${userPublicKey}:${addressId}`);
  }
}
