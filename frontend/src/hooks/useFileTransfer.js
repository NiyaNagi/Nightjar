/**
 * useFileTransfer
 * 
 * Thin compatibility wrapper around FileTransferContext.
 * 
 * Previously this hook contained all the PeerManager handler registration
 * and chunk request/response logic in component-scoped useEffects. That logic
 * has been promoted to FileTransferContext (workspace-level) so that handlers
 * stay registered regardless of which view the user is on.
 * 
 * This wrapper exists so existing consumers (FileStorageDashboard) can continue
 * calling useFileTransfer() without changes to their API. New code should
 * import useFileTransferContext from contexts/FileTransferContext directly.
 * 
 * See docs/FILE_STORAGE_SPEC.md §8
 */

import { useFileTransferContext } from '../contexts/FileTransferContext';

/** Message types for chunk transfer protocol */
const CHUNK_MSG_TYPES = {
  REQUEST: 'chunk-request',
  RESPONSE: 'chunk-response',
  SEED: 'chunk-seed',
};

/**
 * Open the IndexedDB chunk store for a workspace.
 */
function openChunkStore(workspaceId) {
  return new Promise((resolve, reject) => {
    const dbName = `nightjar-chunks-${workspaceId}`;
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('chunks')) {
        db.createObjectStore('chunks');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get a chunk from local IndexedDB.
 */
function getLocalChunk(db, fileId, chunkIndex) {
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
 * Store a chunk in local IndexedDB (received from peer).
 */
function storeLocalChunk(db, fileId, chunkIndex, chunkData) {
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
 * Encode Uint8Array to base64 string for wire transfer.
 */
function uint8ToBase64(uint8) {
  if (!uint8 || uint8.length === 0) return '';
  const chunkSize = 32768;
  let binary = '';
  for (let i = 0; i < uint8.length; i += chunkSize) {
    const slice = uint8.subarray(i, Math.min(i + chunkSize, uint8.length));
    binary += String.fromCharCode.apply(null, slice);
  }
  return btoa(binary);
}

/**
 * Decode base64 string back to Uint8Array.
 */
function base64ToUint8(base64) {
  if (!base64) return new Uint8Array(0);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Compatibility hook — delegates to FileTransferContext.
 * 
 * @param {object} params - (ignored — context already has workspace data)
 * @returns {object} Same shape as the old useFileTransfer return value
 */
export default function useFileTransfer(_params = {}) {
  const ctx = useFileTransferContext();
  return {
    handleChunkRequest: ctx.handleChunkRequest,
    requestChunkFromPeer: ctx.requestChunkFromPeer,
    announceAvailability: ctx.announceAvailability,
    getLocalChunkCount: ctx.getLocalChunkCount,
    transferStats: ctx.transferStats,
  };
}

// Export utilities for use by useChunkSeeding and other modules
export { CHUNK_MSG_TYPES, uint8ToBase64, base64ToUint8, openChunkStore, getLocalChunk, storeLocalChunk };
