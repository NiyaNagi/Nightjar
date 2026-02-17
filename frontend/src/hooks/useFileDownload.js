/**
 * useFileDownload
 * 
 * React hook for downloading files from the file storage system.
 * Retrieves encrypted chunks from IndexedDB (local) or P2P peers,
 * decrypts them, validates hashes, and triggers browser download.
 * 
 * See docs/FILE_STORAGE_SPEC.md §7
 */

import { useState, useCallback, useRef } from 'react';
import { decryptChunk, reassembleFile, toBlob, downloadBlob, sha256 } from '../utils/fileChunking';
import { getChunk, openChunkStore } from '../utils/chunkStore';

/**
 * Download states
 */
export const DOWNLOAD_STATUS = {
  IDLE: 'idle',
  FETCHING: 'fetching',
  DECRYPTING: 'decrypting',
  ASSEMBLING: 'assembling',
  COMPLETE: 'complete',
  ERROR: 'error',
};

/**
 * React hook providing file download functionality.
 * 
 * @param {object} params
 * @param {string} params.workspaceId
 * @param {Uint8Array} params.workspaceKey - 32-byte NaCl key
 * @param {function} [params.requestChunkFromPeer] - P2P chunk fetch callback
 * @param {function} [params.addAuditEntry] - from FileStorageContext
 * @param {function} [params.announceAvailability] - from useFileTransfer
 * @param {object}   [params.chunkAvailability] - chunk availability map for holder hints
 */
export default function useFileDownload({
  workspaceId,
  workspaceKey,
  requestChunkFromPeer,
  addAuditEntry,
  announceAvailability,
  chunkAvailability,
}) {
  const [downloads, setDownloads] = useState(new Map()); // downloadId -> state
  const dbRef = useRef(null);
  const downloadIdCounter = useRef(0);

  const getDb = useCallback(async () => {
    if (!dbRef.current && workspaceId) {
      dbRef.current = await openChunkStore(workspaceId);
    }
    return dbRef.current;
  }, [workspaceId]);

  /**
   * Download a file.
   * 
   * @param {object} fileRecord - Yjs file record
   * @param {object} [options] - { skipBrowserDownload: bool }
   * @returns {Promise<{ data: Uint8Array, downloadId: string }>}
   */
  const downloadFile = useCallback(async (fileRecord, options = {}) => {
    const downloadId = `download-${++downloadIdCounter.current}`;
    const { id: fileId, name, chunkCount, chunkHashes, sizeBytes, mimeType } = fileRecord;

    const startedAt = Date.now();
    const updateStatus = (status, progress = {}) => {
      setDownloads(prev => {
        const next = new Map(prev);
        next.set(downloadId, {
          downloadId,
          fileId,
          fileName: name,
          fileSize: sizeBytes,
          status,
          chunksDownloaded: 0,
          totalChunks: chunkCount,
          error: null,
          startedAt,
          ...progress,
        });
        return next;
      });
    };

    try {
      updateStatus(DOWNLOAD_STATUS.FETCHING);
      
      const db = await getDb();
      const decryptedChunks = [];

      console.log(`[FileDownload] Starting download: fileId=${fileId}, name=${name}, chunkCount=${chunkCount}`);
      console.log(`[FileDownload] DB open: ${!!db}, requestChunkFromPeer available: ${!!requestChunkFromPeer}`);

      for (let i = 0; i < chunkCount; i++) {
        // Try local IndexedDB first
        let chunkData = await getChunk(db, fileId, i);
        
        if (chunkData) {
          console.log(`[FileDownload] Chunk ${i}/${chunkCount} found locally`);
        }
        
        // If not available locally, try P2P
        if (!chunkData && requestChunkFromPeer) {
          try {
            // Pass holder hints so requestChunkFromPeer can target the right peers
            const chunkKey = `${fileId}:${i}`;
            const entry = chunkAvailability?.[chunkKey];
            const holders = (entry && Array.isArray(entry.holders)) ? entry.holders : (Array.isArray(entry) ? entry : []);
            console.log(`[FileDownload] Chunk ${i} not local, requesting from peers. Holders:`, holders);
            chunkData = await requestChunkFromPeer(fileId, i, holders);
            // Store locally for future seeding
            if (chunkData) {
              console.log(`[FileDownload] Chunk ${i} received from peer`);
              const tx = db.transaction('chunks', 'readwrite');
              tx.objectStore('chunks').put(chunkData, `${fileId}:${i}`);
            } else {
              console.warn(`[FileDownload] Chunk ${i} peer request returned null`);
            }
          } catch (err) {
            console.warn(`[FileDownload] P2P fetch failed for chunk ${i}:`, err);
          }
        } else if (!chunkData) {
          console.warn(`[FileDownload] Chunk ${i} not local and no requestChunkFromPeer function available`);
        }

        if (!chunkData) {
          // Log all available chunk keys in IndexedDB to help diagnose mismatched IDs
          try {
            const allKeys = await new Promise((resolve, reject) => {
              const tx = db.transaction('chunks', 'readonly');
              const store = tx.objectStore('chunks');
              const req = store.getAllKeys();
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
            });
            const fileKeys = allKeys.filter(k => typeof k === 'string' && k.includes(':0'));
            console.error(`[FileDownload] Chunk ${i} not available. File ID: ${fileId}. DB has ${allKeys.length} total keys. File chunk-0 keys:`, fileKeys.slice(0, 20));
          } catch (dbErr) {
            console.error(`[FileDownload] Could not list DB keys:`, dbErr);
          }
          throw new Error(`Chunk ${i} not available locally or from peers (fileId: ${fileId})`);
        }

        // Decrypt
        updateStatus(DOWNLOAD_STATUS.DECRYPTING, {
          chunksDownloaded: i,
          totalChunks: chunkCount,
        });
        
        const decrypted = decryptChunk(chunkData.encrypted, chunkData.nonce, workspaceKey);
        if (!decrypted) {
          throw new Error(`Failed to decrypt chunk ${i} — wrong key?`);
        }

        decryptedChunks.push({ data: decrypted, index: i });
        
        updateStatus(DOWNLOAD_STATUS.FETCHING, {
          chunksDownloaded: i + 1,
          totalChunks: chunkCount,
        });
      }

      // Reassemble
      updateStatus(DOWNLOAD_STATUS.ASSEMBLING, {
        chunksDownloaded: chunkCount,
        totalChunks: chunkCount,
      });
      
      const { data, valid, errors } = await reassembleFile(decryptedChunks, chunkHashes, sizeBytes);
      
      if (!valid) {
        throw new Error(`File integrity check failed: ${errors.join('; ')}`);
      }

      // Trigger browser download unless suppressed
      if (!options.skipBrowserDownload) {
        let savedFilePath = null;
        // In Electron, save to disk via IPC
        if (typeof window !== 'undefined' && window.electronAPI?.fileSystem) {
          let downloadLocation = localStorage.getItem('nightjar_download_location') || '';
          // First download: ask user to pick a folder
          if (!downloadLocation) {
            downloadLocation = await window.electronAPI.fileSystem.selectFolder({
              title: 'Choose Download Location',
            });
            if (downloadLocation) {
              localStorage.setItem('nightjar_download_location', downloadLocation);
            }
          }
          if (downloadLocation) {
            const filePath = downloadLocation.replace(/[\\/]$/, '') + '/' + name;
            // Convert Uint8Array to base64 for IPC transfer
            let base64 = '';
            const chunkSize = 32768;
            for (let offset = 0; offset < data.length; offset += chunkSize) {
              const slice = data.subarray(offset, Math.min(offset + chunkSize, data.length));
              base64 += String.fromCharCode.apply(null, slice);
            }
            base64 = btoa(base64);
            const result = await window.electronAPI.fileSystem.saveDownload(filePath, base64);
            if (result?.success) {
              savedFilePath = filePath;
            } else {
              // Fallback to browser download if save fails
              const blob = toBlob(data, mimeType || 'application/octet-stream');
              downloadBlob(blob, name);
            }
          } else {
            // User cancelled folder selection — fallback to browser download
            const blob = toBlob(data, mimeType || 'application/octet-stream');
            downloadBlob(blob, name);
          }
        } else {
          // Non-Electron environment — use browser download
          const blob = toBlob(data, mimeType || 'application/octet-stream');
          downloadBlob(blob, name);
        }

        updateStatus(DOWNLOAD_STATUS.COMPLETE, {
          chunksDownloaded: chunkCount,
          totalChunks: chunkCount,
          filePath: savedFilePath,
        });
      } else {
        updateStatus(DOWNLOAD_STATUS.COMPLETE, {
          chunksDownloaded: chunkCount,
          totalChunks: chunkCount,
        });
      }

      // Announce chunk availability to peers (spec §4.6 step 9)
      if (announceAvailability) {
        try {
          await announceAvailability(fileId, chunkCount);
        } catch (announceErr) {
          console.warn('[FileDownload] Failed to announce availability:', announceErr);
        }
      }

      if (addAuditEntry) {
        addAuditEntry(
          'file_downloaded',
          'file',
          fileId,
          name,
          `Downloaded ${name}`,
        );
      }

      return { data, downloadId };
    } catch (err) {
      updateStatus(DOWNLOAD_STATUS.ERROR, { error: err.message });
      throw err;
    }
  }, [workspaceId, workspaceKey, requestChunkFromPeer, chunkAvailability, addAuditEntry, announceAvailability, getDb]);

  /**
   * Check which chunks we have locally for a file.
   * @param {string} fileId 
   * @param {number} chunkCount 
   * @returns {Promise<{ available: number[], missing: number[] }>}
   */
  const checkLocalAvailability = useCallback(async (fileId, chunkCount) => {
    const db = await getDb();
    const available = [];
    const missing = [];
    
    for (let i = 0; i < chunkCount; i++) {
      const chunk = await getChunk(db, fileId, i);
      if (chunk) {
        available.push(i);
      } else {
        missing.push(i);
      }
    }
    
    return { available, missing };
  }, [getDb]);

  /** Clear a completed/errored download from state */
  const clearDownload = useCallback((downloadId) => {
    setDownloads(prev => {
      const next = new Map(prev);
      next.delete(downloadId);
      return next;
    });
  }, []);

  return {
    downloadFile,
    checkLocalAvailability,
    downloads: Array.from(downloads.values()),
    clearDownload,
    DOWNLOAD_STATUS,
  };
}
