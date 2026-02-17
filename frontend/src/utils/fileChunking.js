/**
 * fileChunking.js
 * 
 * File chunking, hashing, encryption, and reassembly utilities.
 * Handles splitting files into 1MB chunks, computing SHA-256 hashes,
 * encrypting chunks with the workspace key (XSalsa20-Poly1305), and
 * reassembling them.
 * 
 * See docs/FILE_STORAGE_SPEC.md §6, §7
 */

import nacl from 'tweetnacl';

// --- Constants ---
export const CHUNK_SIZE = 1024 * 1024; // 1 MB per chunk
export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB max

/**
 * Compute SHA-256 hash of an ArrayBuffer.
 * Uses SubtleCrypto when available (browser / Electron), fallback to manual.
 * @param {ArrayBuffer|Uint8Array} data
 * @returns {Promise<string>} hex-encoded hash
 */
export async function sha256(data) {
  const buffer = data instanceof Uint8Array ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data;
  
  // Use SubtleCrypto (available in all modern browsers and Electron)
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = new Uint8Array(hashBuffer);
    return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  
  // Fallback: use node crypto if in Electron main process or sidecar
  if (typeof require !== 'undefined') {
    try {
      const nodeCrypto = require('crypto');
      const hash = nodeCrypto.createHash('sha256');
      hash.update(Buffer.from(buffer));
      return hash.digest('hex');
    } catch (e) {
      // ignore
    }
  }
  
  throw new Error('No SHA-256 implementation available');
}

/**
 * Split a File or ArrayBuffer into chunks of CHUNK_SIZE bytes.
 * @param {File|ArrayBuffer|Uint8Array} fileData 
 * @returns {Promise<{ chunks: Uint8Array[], totalSize: number }>}
 */
export async function splitIntoChunks(fileData) {
  let buffer;
  if (fileData instanceof File) {
    buffer = new Uint8Array(await fileData.arrayBuffer());
  } else if (fileData instanceof ArrayBuffer) {
    buffer = new Uint8Array(fileData);
  } else if (fileData instanceof Uint8Array) {
    buffer = fileData;
  } else {
    throw new Error('fileData must be a File, ArrayBuffer, or Uint8Array');
  }
  
  const totalSize = buffer.length;
  const chunks = [];
  
  for (let offset = 0; offset < totalSize; offset += CHUNK_SIZE) {
    const end = Math.min(offset + CHUNK_SIZE, totalSize);
    chunks.push(buffer.slice(offset, end));
  }
  
  return { chunks, totalSize };
}

/**
 * Hash each chunk and compute a whole-file hash.
 * @param {Uint8Array[]} chunks 
 * @returns {Promise<{ chunkHashes: string[], fileHash: string }>}
 */
export async function hashChunks(chunks) {
  // Hash each chunk individually
  const chunkHashes = await Promise.all(chunks.map(chunk => sha256(chunk)));
  
  // Compute a whole-file hash by hashing the concatenation of chunk hashes
  const concatenatedHashes = chunkHashes.join('');
  const encoder = new TextEncoder();
  const fileHash = await sha256(encoder.encode(concatenatedHashes));
  
  return { chunkHashes, fileHash };
}

/**
 * Encrypt a single chunk with XSalsa20-Poly1305.
 * @param {Uint8Array} chunk - plaintext chunk
 * @param {Uint8Array} key - 32-byte workspace key
 * @returns {{ encrypted: Uint8Array, nonce: Uint8Array }}
 */
export function encryptChunk(chunk, key) {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const encrypted = nacl.secretbox(chunk, nonce, key);
  return { encrypted, nonce };
}

/**
 * Decrypt a single chunk.
 * @param {Uint8Array} encrypted - ciphertext
 * @param {Uint8Array} nonce - nonce used during encryption
 * @param {Uint8Array} key - 32-byte workspace key
 * @returns {Uint8Array|null} plaintext or null if decryption fails
 */
export function decryptChunk(encrypted, nonce, key) {
  return nacl.secretbox.open(encrypted, nonce, key);
}

/**
 * Process a file for upload: split, hash, encrypt all chunks.
 * Returns everything needed for storage and metadata.
 * 
 * @param {File|ArrayBuffer|Uint8Array} fileData
 * @param {Uint8Array} workspaceKey - 32-byte NaCl key
 * @param {function} [onProgress] - callback(chunkIndex, totalChunks)
 * @returns {Promise<{
 *   chunks: Array<{ encrypted: Uint8Array, nonce: Uint8Array, hash: string, index: number }>,
 *   chunkHashes: string[],
 *   fileHash: string,
 *   totalSize: number,
 *   chunkCount: number,
 * }>}
 */
export async function processFileForUpload(fileData, workspaceKey, onProgress) {
  // 1. Split into chunks
  const { chunks, totalSize } = await splitIntoChunks(fileData);
  
  // 2. Hash all chunks
  const { chunkHashes, fileHash } = await hashChunks(chunks);
  
  // 3. Encrypt each chunk
  const encryptedChunks = [];
  for (let i = 0; i < chunks.length; i++) {
    const { encrypted, nonce } = encryptChunk(chunks[i], workspaceKey);
    encryptedChunks.push({
      encrypted,
      nonce,
      hash: chunkHashes[i],
      index: i,
    });
    if (onProgress) onProgress(i, chunks.length);
  }
  
  return {
    chunks: encryptedChunks,
    chunkHashes,
    fileHash,
    totalSize,
    chunkCount: chunks.length,
  };
}

/**
 * Reassemble a file from decrypted chunks.
 * Validates each chunk hash before including it.
 * 
 * @param {Array<{ data: Uint8Array, index: number }>} chunks - decrypted chunks (may be out of order)
 * @param {string[]} expectedHashes - expected SHA-256 hash per chunk
 * @param {number} totalSize - expected total file size
 * @returns {Promise<{ data: Uint8Array, valid: boolean, errors: string[] }>}
 */
export async function reassembleFile(chunks, expectedHashes, totalSize) {
  const errors = [];
  
  // Verify we have the right number of chunks
  if (chunks.length !== expectedHashes.length) {
    errors.push(`Expected ${expectedHashes.length} chunks but received ${chunks.length}`);
    return { data: null, valid: false, errors };
  }
  
  // Sort chunks by index
  const sorted = [...chunks].sort((a, b) => a.index - b.index);
  
  // Check for duplicate indices
  const seenIndices = new Set();
  for (const chunk of sorted) {
    if (seenIndices.has(chunk.index)) {
      errors.push(`Duplicate chunk index: ${chunk.index}`);
    }
    seenIndices.add(chunk.index);
  }
  
  // Verify all indices present
  for (let i = 0; i < expectedHashes.length; i++) {
    if (!seenIndices.has(i)) {
      errors.push(`Missing chunk index: ${i}`);
    }
  }
  
  if (errors.length > 0) {
    return { data: null, valid: false, errors };
  }
  
  // Validate each chunk hash
  for (const chunk of sorted) {
    const hash = await sha256(chunk.data);
    if (hash !== expectedHashes[chunk.index]) {
      errors.push(`Chunk ${chunk.index} hash mismatch: expected ${expectedHashes[chunk.index]}, got ${hash}`);
    }
  }
  
  if (errors.length > 0) {
    return { data: null, valid: false, errors };
  }
  
  // Concatenate
  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of sorted) {
    result.set(chunk.data, offset);
    offset += chunk.data.length;
  }
  
  // Verify assembled size
  if (offset !== totalSize) {
    errors.push(`Assembled size ${offset} does not match expected size ${totalSize}`);
    return { data: result, valid: false, errors };
  }
  
  return { data: result, valid: true, errors: [] };
}

/**
 * Convert a reassembled Uint8Array to a downloadable Blob.
 * @param {Uint8Array} data 
 * @param {string} mimeType 
 * @returns {Blob}
 */
export function toBlob(data, mimeType = 'application/octet-stream') {
  return new Blob([data], { type: mimeType });
}

/**
 * Trigger a browser download of a Blob.
 * @param {Blob} blob 
 * @param {string} filename 
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, 1000);
}
