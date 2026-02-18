/**
 * File Storage Validation Utilities
 * 
 * Validates file uploads, names, sizes, and folder structures.
 * See docs/FILE_STORAGE_SPEC.md §3, §5.6
 */

/** Max file size: 100 MB */
export const MAX_FILE_SIZE = 100 * 1024 * 1024;

/** Chunk size: 1 MB */
export const CHUNK_SIZE = 1024 * 1024;

/** Max folder nesting depth */
export const MAX_FOLDER_DEPTH = 10;

/** Max filename length */
export const MAX_FILENAME_LENGTH = 255;

/** Max folder name length */
export const MAX_FOLDER_NAME_LENGTH = 100;

/** Max description length */
export const MAX_DESCRIPTION_LENGTH = 2000;

/** Max tag length */
export const MAX_TAG_LENGTH = 50;

/** Max tags per file */
export const MAX_TAGS_PER_FILE = 20;

/** Default auto-delete days */
export const DEFAULT_AUTO_DELETE_DAYS = 30;

/** Default chunk redundancy target */
export const DEFAULT_CHUNK_REDUNDANCY_TARGET = 5;

/** Seed interval in ms */
export const SEED_INTERVAL_MS = 60000;

/**
 * Validate a file for upload.
 * @param {File} file - Browser File object
 * @param {number} [maxSize] - Override max size in bytes
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateFileForUpload(file, maxSize = MAX_FILE_SIZE) {
  if (!file) {
    return { valid: false, error: 'No file provided' };
  }

  if (!file.name || file.name.trim() === '') {
    return { valid: false, error: 'File name is empty' };
  }

  if (file.name.length > MAX_FILENAME_LENGTH) {
    return { valid: false, error: `File name too long (max ${MAX_FILENAME_LENGTH} characters)` };
  }

  if (file.size === 0) {
    return { valid: false, error: 'File is empty (0 bytes)' };
  }

  if (file.size > maxSize) {
    const sizeMB = Math.round(maxSize / (1024 * 1024));
    return { valid: false, error: `File too large (max ${sizeMB} MB)` };
  }

  // Check for invalid characters in filename
  const invalidChars = /[<>:"/\\|?*\x00-\x1F]/;
  if (invalidChars.test(file.name)) {
    return { valid: false, error: 'File name contains invalid characters' };
  }

  return { valid: true };
}

/**
 * Validate a folder name.
 * @param {string} name
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateFolderName(name) {
  if (!name || name.trim() === '') {
    return { valid: false, error: 'Folder name is required' };
  }

  const trimmed = name.trim();

  if (trimmed.length > MAX_FOLDER_NAME_LENGTH) {
    return { valid: false, error: `Folder name too long (max ${MAX_FOLDER_NAME_LENGTH} characters)` };
  }

  const invalidChars = /[<>:"/\\|?*\x00-\x1F]/;
  if (invalidChars.test(trimmed)) {
    return { valid: false, error: 'Folder name contains invalid characters' };
  }

  // Disallow names that are only dots or spaces
  if (/^[.\s]+$/.test(trimmed)) {
    return { valid: false, error: 'Folder name cannot be only dots or spaces' };
  }

  return { valid: true };
}

/**
 * Check if adding a subfolder would exceed max depth.
 * @param {string|null} parentId - Parent folder ID
 * @param {Array} allFolders - All folders array
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateFolderDepth(parentId, allFolders) {
  if (!parentId) return { valid: true }; // Root level is always ok

  let depth = 1;
  let currentId = parentId;
  const visited = new Set();

  while (currentId) {
    if (visited.has(currentId)) {
      return { valid: false, error: 'Circular folder reference detected' };
    }
    visited.add(currentId);
    const parent = allFolders.find(f => f.id === currentId);
    if (!parent) break;
    depth++;
    currentId = parent.parentId;

    if (depth >= MAX_FOLDER_DEPTH) {
      return { valid: false, error: `Maximum folder depth (${MAX_FOLDER_DEPTH}) reached` };
    }
  }

  return { valid: true };
}

/**
 * Check if a filename already exists in the same folder.
 * @param {string} name - File name to check
 * @param {string|null} folderId - Target folder ID
 * @param {Array} existingFiles - All files
 * @param {string|null} excludeFileId - Exclude this file ID from check (for renames)
 * @returns {boolean}
 */
export function fileExistsInFolder(name, folderId, existingFiles, excludeFileId = null) {
  return existingFiles.some(f =>
    f.name === name &&
    (f.folderId || null) === (folderId || null) &&
    f.id !== excludeFileId &&
    !f.deletedAt
  );
}

/**
 * Validate a file description.
 * @param {string} description
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateDescription(description) {
  if (description && description.length > MAX_DESCRIPTION_LENGTH) {
    return { valid: false, error: `Description too long (max ${MAX_DESCRIPTION_LENGTH} characters)` };
  }
  return { valid: true };
}

/**
 * Validate a tag.
 * @param {string} tag
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateTag(tag) {
  if (!tag || tag.trim() === '') {
    return { valid: false, error: 'Tag is empty' };
  }
  if (tag.length > MAX_TAG_LENGTH) {
    return { valid: false, error: `Tag too long (max ${MAX_TAG_LENGTH} characters)` };
  }
  return { valid: true };
}

/**
 * Validate tags array.
 * @param {string[]} tags
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateTags(tags) {
  if (!Array.isArray(tags)) return { valid: true };
  if (tags.length > MAX_TAGS_PER_FILE) {
    return { valid: false, error: `Too many tags (max ${MAX_TAGS_PER_FILE})` };
  }
  for (const tag of tags) {
    const result = validateTag(tag);
    if (!result.valid) return result;
  }
  return { valid: true };
}

/**
 * Generate a cryptographically random hex suffix.
 * @param {number} bytes - number of random bytes
 * @returns {string}
 */
function randomHex(bytes = 8) {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback for environments without crypto
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
}

/**
 * Generate a unique file ID.
 * @returns {string}
 */
export function generateFileId() {
  return 'file-' + Date.now().toString(36) + randomHex(8);
}

/**
 * Generate a unique folder ID.
 * @returns {string}
 */
export function generateFolderId() {
  return 'sfolder-' + Date.now().toString(36) + randomHex(8);
}

/**
 * Generate a unique file storage system ID.
 * @returns {string}
 */
export function generateFileStorageId() {
  return 'fs-' + Date.now().toString(36) + randomHex(8);
}

/**
 * Generate an audit entry ID.
 * @returns {string}
 */
export function generateAuditId() {
  return 'faudit-' + Date.now().toString(36) + randomHex(8);
}

export default {
  MAX_FILE_SIZE,
  CHUNK_SIZE,
  MAX_FOLDER_DEPTH,
  MAX_FILENAME_LENGTH,
  MAX_FOLDER_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_FILE,
  DEFAULT_AUTO_DELETE_DAYS,
  DEFAULT_CHUNK_REDUNDANCY_TARGET,
  SEED_INTERVAL_MS,
  validateFileForUpload,
  validateFolderName,
  validateFolderDepth,
  fileExistsInFolder,
  validateDescription,
  validateTag,
  validateTags,
  generateFileId,
  generateFolderId,
  generateFileStorageId,
  generateAuditId,
};
