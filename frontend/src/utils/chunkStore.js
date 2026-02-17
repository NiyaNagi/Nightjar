/**
 * chunkStore.js
 * 
 * Shared IndexedDB utilities for file chunk storage.
 * Extracted from useFileUpload.js to avoid circular/cross-hook imports
 * that cause Temporal Dead Zone (TDZ) errors in Vite production bundles.
 * 
 * See docs/FILE_STORAGE_SPEC.md §6, §7
 */

/**
 * Upload states — shared constant used by multiple components.
 */
export const UPLOAD_STATUS = {
  IDLE: 'idle',
  READING: 'reading',
  CHUNKING: 'chunking',
  ENCRYPTING: 'encrypting',
  STORING: 'storing',
  COMPLETE: 'complete',
  ERROR: 'error',
};

/**
 * Open (or create) the IndexedDB store for file chunks.
 * Each workspace gets its own database.
 * @param {string} workspaceId
 * @returns {Promise<IDBDatabase>}
 */
export function openChunkStore(workspaceId) {
  return new Promise((resolve, reject) => {
    const dbName = `nightjar-chunks-${workspaceId}`;
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('chunks')) {
        db.createObjectStore('chunks'); // key = `${fileId}:${chunkIndex}`
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Store an encrypted chunk in IndexedDB.
 * @param {IDBDatabase} db 
 * @param {string} fileId 
 * @param {number} chunkIndex 
 * @param {{ encrypted: Uint8Array, nonce: Uint8Array }} chunkData 
 */
export function storeChunk(db, fileId, chunkIndex, chunkData) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('chunks', 'readwrite');
    const store = tx.objectStore('chunks');
    const key = `${fileId}:${chunkIndex}`;
    store.put({ ...chunkData, fileId, chunkIndex }, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Retrieve an encrypted chunk from IndexedDB.
 * @param {IDBDatabase} db 
 * @param {string} fileId 
 * @param {number} chunkIndex 
 * @returns {Promise<{ encrypted: Uint8Array, nonce: Uint8Array } | null>}
 */
export function getChunk(db, fileId, chunkIndex) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('chunks', 'readonly');
    const store = tx.objectStore('chunks');
    const key = `${fileId}:${chunkIndex}`;
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete all chunks for a file from IndexedDB.
 * @param {IDBDatabase} db 
 * @param {string} fileId 
 * @param {number} chunkCount
 */
export function deleteFileChunks(db, fileId, chunkCount) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('chunks', 'readwrite');
    const store = tx.objectStore('chunks');
    for (let i = 0; i < chunkCount; i++) {
      store.delete(`${fileId}:${i}`);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get all chunk keys stored in IndexedDB.
 * @param {IDBDatabase} db
 * @returns {Promise<string[]>}
 */
export function getAllChunkKeys(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('chunks', 'readonly');
    const store = tx.objectStore('chunks');
    const req = store.getAllKeys();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
