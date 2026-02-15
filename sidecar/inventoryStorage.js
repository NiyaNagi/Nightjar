// sidecar/inventoryStorage.js
// Encrypted blob storage for inventory addresses
// Stores pre-encrypted data — never sees plaintext addresses
// See docs/INVENTORY_SYSTEM_SPEC.md §11.2.4

const fs = require('fs');
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
 * Get the storage directory for a given namespace
 * @param {string} namespace - 'addresses' or 'saved-addresses'
 * @returns {string} Absolute path to storage directory
 */
function getStorageDir(namespace) {
  if (!basePath) {
    throw new Error('InventoryStorage base path not configured');
  }
  const dir = path.join(basePath, 'inventory', namespace);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Store an admin address record (encrypted blob)
 * Key: inv-addr:{inventorySystemId}:{requestId}
 * @param {string} inventorySystemId
 * @param {string} requestId
 * @param {string} encryptedBlob - Base64-encoded encrypted data
 */
function storeAddress(inventorySystemId, requestId, encryptedBlob) {
  const dir = getStorageDir('addresses');
  const filename = `${inventorySystemId}_${requestId}.json`;
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, JSON.stringify({
    inventorySystemId,
    requestId,
    data: encryptedBlob,
    storedAt: Date.now(),
  }), 'utf8');
  console.log(`[InventoryStorage] Stored address for request ${requestId}`);
}

/**
 * Get an admin address record
 * @param {string} inventorySystemId
 * @param {string} requestId
 * @returns {string|null} Encrypted blob or null if not found
 */
function getAddress(inventorySystemId, requestId) {
  const dir = getStorageDir('addresses');
  const filename = `${inventorySystemId}_${requestId}.json`;
  const filePath = path.join(dir, filename);
  
  if (!fs.existsSync(filePath)) return null;
  
  try {
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return content.data;
  } catch (err) {
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
function deleteAddress(inventorySystemId, requestId) {
  const dir = getStorageDir('addresses');
  const filename = `${inventorySystemId}_${requestId}.json`;
  const filePath = path.join(dir, filename);
  
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`[InventoryStorage] Deleted address for request ${requestId}`);
    return true;
  }
  return false;
}

/**
 * List all admin address records for an inventory system
 * @param {string} inventorySystemId
 * @returns {Array<{requestId: string, data: string, storedAt: number}>}
 */
function listAddresses(inventorySystemId) {
  const dir = getStorageDir('addresses');
  const prefix = `${inventorySystemId}_`;
  const results = [];
  
  if (!fs.existsSync(dir)) return results;
  
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (file.startsWith(prefix) && file.endsWith('.json')) {
      try {
        const content = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
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
function storeSavedAddress(addressId, encryptedBlob) {
  const dir = getStorageDir('saved-addresses');
  const filePath = path.join(dir, `${addressId}.json`);
  fs.writeFileSync(filePath, JSON.stringify({
    addressId,
    data: encryptedBlob,
    storedAt: Date.now(),
  }), 'utf8');
  console.log(`[InventoryStorage] Stored saved address ${addressId}`);
}

/**
 * Get all saved addresses
 * @returns {Array<{addressId: string, data: string, storedAt: number}>}
 */
function getSavedAddresses() {
  const dir = getStorageDir('saved-addresses');
  const results = [];
  
  if (!fs.existsSync(dir)) return results;
  
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (file.endsWith('.json')) {
      try {
        const content = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
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
function deleteSavedAddress(addressId) {
  const dir = getStorageDir('saved-addresses');
  const filePath = path.join(dir, `${addressId}.json`);
  
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`[InventoryStorage] Deleted saved address ${addressId}`);
    return true;
  }
  return false;
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
