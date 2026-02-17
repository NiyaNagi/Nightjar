/**
 * useFileUpload
 * 
 * React hook for uploading files to the file storage system.
 * Handles chunking, hashing, encryption, local persistence (IndexedDB),
 * and chunk availability updates in Yjs.
 * 
 * See docs/FILE_STORAGE_SPEC.md §6
 */

import { useState, useCallback, useRef } from 'react';
import { processFileForUpload } from '../utils/fileChunking';
import {
  validateFileForUpload,
  generateFileId,
  MAX_FILE_SIZE,
} from '../utils/fileStorageValidation';
import {
  UPLOAD_STATUS,
  openChunkStore,
  storeChunk,
  getChunk,
  deleteFileChunks,
} from '../utils/chunkStore';

// Re-export for backward compatibility
export { UPLOAD_STATUS, getChunk, deleteFileChunks };

/**
 * React hook providing file upload functionality.
 * 
 * @param {object} params
 * @param {string} params.workspaceId
 * @param {Uint8Array} params.workspaceKey - 32-byte NaCl key
 * @param {string} params.userPublicKey - uploader's public key
 * @param {function} params.createFileRecord - from FileStorageContext
 * @param {function} params.setChunkAvailability - from FileStorageContext
 * @param {function} params.addAuditEntry - from FileStorageContext
 */
export default function useFileUpload({
  workspaceId,
  workspaceKey,
  userPublicKey,
  createFileRecord,
  setChunkAvailability,
  addAuditEntry,
}) {
  const [uploads, setUploads] = useState(new Map()); // uploadId -> upload state
  const dbRef = useRef(null);
  const uploadIdCounter = useRef(0);

  /** Get or open IndexedDB */
  const getDb = useCallback(async () => {
    if (!dbRef.current && workspaceId) {
      dbRef.current = await openChunkStore(workspaceId);
    }
    return dbRef.current;
  }, [workspaceId]);

  /**
   * Upload a single file.
   * @param {File} file - browser File object
   * @param {string} folderId - target folder (null for root)
   * @param {object} [options] - { description, tags }
   * @returns {Promise<{ fileId: string, uploadId: string }>}
   */
  const uploadFile = useCallback(async (file, folderId = null, options = {}) => {
    const uploadId = `upload-${++uploadIdCounter.current}`;
    
    const updateStatus = (status, progress = {}) => {
      setUploads(prev => {
        const next = new Map(prev);
        next.set(uploadId, {
          uploadId,
          fileName: file.name,
          fileSize: file.size,
          status,
          chunksProcessed: 0,
          totalChunks: 0,
          error: null,
          ...progress,
        });
        return next;
      });
    };

    try {
      // Validate
      const validation = validateFileForUpload(file, MAX_FILE_SIZE);
      if (!validation.valid) {
        updateStatus(UPLOAD_STATUS.ERROR, { error: validation.error });
        throw new Error(validation.error);
      }

      updateStatus(UPLOAD_STATUS.READING);
      
      // Process file: chunk → hash → encrypt
      updateStatus(UPLOAD_STATUS.CHUNKING);
      const result = await processFileForUpload(
        file,
        workspaceKey,
        (chunkIdx, total) => {
          updateStatus(UPLOAD_STATUS.ENCRYPTING, {
            chunksProcessed: chunkIdx + 1,
            totalChunks: total,
          });
        }
      );

      // Store encrypted chunks in IndexedDB
      updateStatus(UPLOAD_STATUS.STORING, {
        chunksProcessed: 0,
        totalChunks: result.chunkCount,
      });
      
      const db = await getDb();
      // Generate the canonical file ID up front so chunks are stored under the same key
      const fileId = generateFileId();
      
      for (let i = 0; i < result.chunks.length; i++) {
        const chunk = result.chunks[i];
        await storeChunk(db, fileId, i, {
          encrypted: chunk.encrypted,
          nonce: chunk.nonce,
        });
        updateStatus(UPLOAD_STATUS.STORING, {
          chunksProcessed: i + 1,
          totalChunks: result.chunkCount,
        });
      }

      // Create file record in Yjs, passing our pre-generated ID
      createFileRecord({
        id: fileId,
        name: file.name,
        sizeBytes: result.totalSize,
        chunkCount: result.chunkCount,
        chunkHashes: result.chunkHashes,
        fileHash: result.fileHash,
        folderId,
      });

      // Set chunk availability for ourselves
      for (let i = 0; i < result.chunkCount; i++) {
        setChunkAvailability(fileId, i, [userPublicKey]);
      }

      // Apply optional metadata
      if (options.description || options.tags) {
        // These would be applied through updateFile, but we'll let the caller handle that
      }

      updateStatus(UPLOAD_STATUS.COMPLETE, {
        chunksProcessed: result.chunkCount,
        totalChunks: result.chunkCount,
        fileId,
      });

      return { fileId, uploadId };
    } catch (err) {
      updateStatus(UPLOAD_STATUS.ERROR, { error: err.message });
      throw err;
    }
  }, [workspaceId, workspaceKey, userPublicKey, createFileRecord, setChunkAvailability, getDb]);

  /**
   * Upload multiple files at once.
   * @param {FileList|File[]} files 
   * @param {string} folderId 
   * @returns {Promise<Array<{ fileId: string, uploadId: string }>>}
   */
  const uploadFiles = useCallback(async (files, folderId = null) => {
    const results = [];
    for (const file of Array.from(files)) {
      try {
        const result = await uploadFile(file, folderId);
        results.push(result);
      } catch (err) {
        console.error(`[FileUpload] Failed to upload ${file.name}:`, err);
        results.push({ fileId: null, uploadId: null, error: err.message, fileName: file.name });
      }
    }
    return results;
  }, [uploadFile]);

  /** Clear a completed/errored upload from state */
  const clearUpload = useCallback((uploadId) => {
    setUploads(prev => {
      const next = new Map(prev);
      next.delete(uploadId);
      return next;
    });
  }, []);

  /** Clear all completed uploads */
  const clearCompleted = useCallback(() => {
    setUploads(prev => {
      const next = new Map(prev);
      for (const [id, upload] of next) {
        if (upload.status === UPLOAD_STATUS.COMPLETE || upload.status === UPLOAD_STATUS.ERROR) {
          next.delete(id);
        }
      }
      return next;
    });
  }, []);

  return {
    uploadFile,
    uploadFiles,
    uploads: Array.from(uploads.values()),
    clearUpload,
    clearCompleted,
    UPLOAD_STATUS,
  };
}
