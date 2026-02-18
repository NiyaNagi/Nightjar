// sidecar/inventoryStorage.js
// Encrypted blob storage for inventory addresses
// Stores pre-encrypted data — never sees plaintext addresses
// See docs/INVENTORY_SYSTEM_SPEC.md §11.2.4

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

// Configurable base path — set by main.js on startup
let basePath = null;

/**
 * Set the base path for inventory storage
 * @param {string} bp - Base directory (typically app.getPath('userData'))
 */
function setBasePath(bp) {
  if (bp && typeof bp === 'string') {
    basePath = bp;
    console.log('[InventoryStorage] Base path set to:', bp);
  }
}

/**
 * Sanitize a user-provided string for use in filenames.
 * Strips path separators, traversal sequences, and null bytes.
 * @param {string} input
 * @returns {string}
 */
function sanitizeForFilename(input) {
  if (!input || typeof input !== 'string') return 'unknown';
  // Replace null bytes, path separators, and traversal patterns with '_' to preserve distinctness
  return input.replace(/[\x00/\\:]/g, '_').replace(/\.\./g, '_').trim() || 'unknown';
}

/**
 * Get the storage directory for a given namespace
 * @param {string} namespace - 'addresses' or 'saved-addresses'
 * @returns {string} Absolute path to storage directory
 */
async function getStorageDir(namespace) {
  if (!basePath) {
    throw new Error('InventoryStorage base path not configured');
  }
  const dir = path.join(basePath, 'inventory', namespace);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Store an admin address record (encrypted blob)
 * Key: inv-addr:{inventorySystemId}:{requestId}
 * @param {string} inventorySystemId
 * @param {string} requestId
 * @param {string} encryptedBlob - Base64-encoded encrypted data
 */
async function storeAddress(inventorySystemId, requestId, encryptedBlob) {
  const dir = await getStorageDir('addresses');
  const filename = `${sanitizeForFilename(inventorySystemId)}_${sanitizeForFilename(requestId)}.json`;
  const filePath = path.join(dir, filename);
  const tmpPath = filePath + '.tmp';
  await fsp.writeFile(tmpPath, JSON.stringify({
    inventorySystemId,
    requestId,
    data: encryptedBlob,
    storedAt: Date.now(),
  }), 'utf8');
  await fsp.rename(tmpPath, filePath);
  console.log(`[InventoryStorage] Stored address for request ${requestId}`);
}

/**
 * Get an admin address record
 * @param {string} inventorySystemId
 * @param {string} requestId
 * @returns {string|null} Encrypted blob or null if not found
 */
async function getAddress(inventorySystemId, requestId) {
  const dir = await getStorageDir('addresses');
  const filename = `${sanitizeForFilename(inventorySystemId)}_${sanitizeForFilename(requestId)}.json`;
  const filePath = path.join(dir, filename);
  
  try {
    const content = JSON.parse(await fsp.readFile(filePath, 'utf8'));
    return content.data;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    console.error(`[InventoryStorage] Error reading address ${requestId}:`, err.message);
    return null;
  }
}

/**
 * Delete an admin address record
 * @param {string} inventorySystemId
 * @param {string} requestId
 * @returns {boolean} True if deleted
 */
async function deleteAddress(inventorySystemId, requestId) {
  const dir = await getStorageDir('addresses');
  const filename = `${sanitizeForFilename(inventorySystemId)}_${sanitizeForFilename(requestId)}.json`;
  const filePath = path.join(dir, filename);
  
  try {
    await fsp.unlink(filePath);
    console.log(`[InventoryStorage] Deleted address for request ${requestId}`);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * List all admin address records for an inventory system
 * @param {string} inventorySystemId
 * @returns {Array<{requestId: string, data: string, storedAt: number}>}
 */
async function listAddresses(inventorySystemId) {
  const dir = await getStorageDir('addresses');
  const prefix = `${sanitizeForFilename(inventorySystemId)}_`;
  const results = [];
  
  let files;
  try {
    files = await fsp.readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return results;
    throw err;
  }
  
  for (const file of files) {
    if (file.startsWith(prefix) && file.endsWith('.json')) {
      try {
        const content = JSON.parse(await fsp.readFile(path.join(dir, file), 'utf8'));
        results.push({
          requestId: content.requestId,
          data: content.data,
          storedAt: content.storedAt,
        });
      } catch (err) {
        console.error(`[InventoryStorage] Error reading ${file}:`, err.message);
      }
    }
  }
  
  return results;
}

/**
 * Store a saved address (requestor-local, encrypted blob)
 * @param {string} addressId - UUID of the saved address
 * @param {string} encryptedBlob - Base64-encoded encrypted data
 */
async function storeSavedAddress(addressId, encryptedBlob) {
  const dir = await getStorageDir('saved-addresses');
  const filePath = path.join(dir, `${sanitizeForFilename(addressId)}.json`);
  const tmpPath = filePath + '.tmp';
  await fsp.writeFile(tmpPath, JSON.stringify({
    addressId,
    data: encryptedBlob,
    storedAt: Date.now(),
  }), 'utf8');
  await fsp.rename(tmpPath, filePath);
  console.log(`[InventoryStorage] Stored saved address ${addressId}`);
}

/**
 * Get all saved addresses
 * @returns {Array<{addressId: string, data: string, storedAt: number}>}
 */
async function getSavedAddresses() {
  const dir = await getStorageDir('saved-addresses');
  const results = [];
  
  let files;
  try {
    files = await fsp.readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return results;
    throw err;
  }
  
  for (const file of files) {
    if (file.endsWith('.json')) {
      try {
        const content = JSON.parse(await fsp.readFile(path.join(dir, file), 'utf8'));
        results.push({
          addressId: content.addressId,
          data: content.data,
          storedAt: content.storedAt,
        });
      } catch (err) {
        console.error(`[InventoryStorage] Error reading saved address ${file}:`, err.message);
      }
    }
  }
  
  return results;
}

/**
 * Delete a saved address
 * @param {string} addressId
 * @returns {boolean} True if deleted
 */
async function deleteSavedAddress(addressId) {
  const dir = await getStorageDir('saved-addresses');
  const filePath = path.join(dir, `${sanitizeForFilename(addressId)}.json`);
  
  try {
    await fsp.unlink(filePath);
    console.log(`[InventoryStorage] Deleted saved address ${addressId}`);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

module.exports = {
  setBasePath,
  storeAddress,
  getAddress,
  deleteAddress,
  listAddresses,
  storeSavedAddress,
  getSavedAddresses,
  deleteSavedAddress,
};
