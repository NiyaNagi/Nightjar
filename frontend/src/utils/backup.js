/**
 * Backup Utilities
 * 
 * Encrypted backup creation and restoration for identity and workspace data.
 * Uses XSalsa20-Poly1305 (via tweetnacl) for encryption.
 * 
 * Backup format:
 * {
 *   version: 1,
 *   createdAt: ISO timestamp,
 *   identity: { publicKey, encryptedSecretKey },
 *   workspaces: [{ id, name, encryptedKey, isOwner }]
 * }
 */

import nacl from 'tweetnacl';
import * as bip39 from 'bip39';

const BACKUP_VERSION = 1;

/**
 * Convert Uint8Array to base64 string
 */
function uint8ToBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Convert base64 string to Uint8Array
 */
function base64ToUint8(str) {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Derive backup encryption key from BIP39 mnemonic
 * Uses bytes 32-63 of the seed (separate from identity keypair which uses 0-31)
 * 
 * @param {string} mnemonic - 12-word BIP39 mnemonic
 * @returns {Uint8Array} 32-byte encryption key
 */
export function deriveBackupKey(mnemonic) {
  const rawSeed = bip39.mnemonicToSeedSync(mnemonic);
  // Ensure it's a Uint8Array (Buffer.slice may return Buffer in Node.js)
  const seed = new Uint8Array(rawSeed);
  // Use bytes 32-63 for backup encryption (identity uses 0-31)
  return seed.slice(32, 64);
}

/**
 * Encrypt data using XSalsa20-Poly1305
 * 
 * @param {Object|string} data - Data to encrypt
 * @param {Uint8Array} key - 32-byte encryption key
 * @returns {string} Base64 encoded encrypted data (nonce + ciphertext)
 */
export function encryptData(data, key) {
  const plaintext = new TextEncoder().encode(
    typeof data === 'string' ? data : JSON.stringify(data)
  );
  
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(plaintext, nonce, key);
  
  // Pack nonce + ciphertext
  const packed = new Uint8Array(nonce.length + ciphertext.length);
  packed.set(nonce, 0);
  packed.set(ciphertext, nonce.length);
  
  return uint8ToBase64(packed);
}

/**
 * Decrypt data using XSalsa20-Poly1305
 * 
 * @param {string} encryptedBase64 - Base64 encoded encrypted data
 * @param {Uint8Array} key - 32-byte encryption key
 * @returns {Object|string} Decrypted data
 */
export function decryptData(encryptedBase64, key) {
  const packed = base64ToUint8(encryptedBase64);
  
  const nonce = packed.slice(0, nacl.secretbox.nonceLength);
  const ciphertext = packed.slice(nacl.secretbox.nonceLength);
  
  const plaintext = nacl.secretbox.open(ciphertext, nonce, key);
  if (!plaintext) {
    throw new Error('Decryption failed - incorrect key or corrupted data');
  }
  
  const decoded = new TextDecoder().decode(plaintext);
  
  try {
    return JSON.parse(decoded);
  } catch {
    return decoded;
  }
}

/**
 * Create an encrypted backup of identity and workspaces
 * 
 * @param {Object} identity - Identity object with mnemonic, publicKey, privateKey
 * @param {Array} workspaces - Array of workspace objects with id, name, encryptionKey
 * @param {string} passphrase - Optional additional passphrase for extra security
 * @returns {Object} Backup object ready for download
 */
export function createBackup(identity, workspaces = [], passphrase = null) {
  if (!identity?.mnemonic) {
    throw new Error('Identity with mnemonic is required');
  }
  
  // Derive backup key from mnemonic
  let backupKey = deriveBackupKey(identity.mnemonic);
  
  // If passphrase provided, XOR with passphrase-derived key for extra security
  if (passphrase) {
    const passphraseKey = deriveKeyFromPassphrase(passphrase);
    backupKey = xorBytes(backupKey, passphraseKey);
  }
  
  // Encrypt secret key
  const encryptedSecretKey = encryptData(
    uint8ToBase64(identity.privateKey),
    backupKey
  );
  
  // Encrypt workspace keys
  const encryptedWorkspaces = workspaces.map(ws => ({
    id: ws.id,
    name: ws.name,
    isOwner: ws.myPermission === 'owner',
    encryptedKey: ws.encryptionKey 
      ? encryptData(ws.encryptionKey, backupKey)
      : null,
  }));
  
  return {
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    hasPassphrase: !!passphrase,
    identity: {
      publicKey: identity.publicKeyBase62,
      encryptedSecretKey,
    },
    workspaces: encryptedWorkspaces,
  };
}

/**
 * Derive a key from a passphrase using simple stretching
 * (For production, use PBKDF2 or similar)
 * 
 * @param {string} passphrase - User passphrase
 * @returns {Uint8Array} 32-byte key
 */
function deriveKeyFromPassphrase(passphrase) {
  const encoder = new TextEncoder();
  const data = encoder.encode(passphrase + 'nightjar-backup-salt-v1');
  
  // Simple key stretching - hash multiple times
  let key = new Uint8Array(32);
  for (let i = 0; i < data.length && i < 32; i++) {
    key[i] = data[i];
  }
  
  // XOR with shifted values for basic mixing
  for (let round = 0; round < 1000; round++) {
    for (let i = 0; i < 32; i++) {
      key[i] = key[i] ^ ((key[(i + 1) % 32] * round) & 0xff);
    }
  }
  
  return key;
}

/**
 * XOR two byte arrays
 */
function xorBytes(a, b) {
  const result = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i] ^ b[i % b.length];
  }
  return result;
}

/**
 * Download a backup file
 * 
 * @param {Object} backup - Backup object from createBackup()
 * @param {string} filename - Optional filename
 */
export function downloadBackup(backup, filename = null) {
  const blob = new Blob(
    [JSON.stringify(backup, null, 2)],
    { type: 'application/json' }
  );
  
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || `nightjar-backup-${new Date().toISOString().split('T')[0]}.json`;
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(url);
}

/**
 * Restore from a backup file
 * 
 * @param {Object} backup - Backup object from file
 * @param {string} mnemonic - Recovery mnemonic (12 words)
 * @param {string} passphrase - Optional passphrase if backup was created with one
 * @returns {Object} { identity, workspaces }
 */
export function restoreBackup(backup, mnemonic, passphrase = null) {
  if (!backup || backup.version !== BACKUP_VERSION) {
    throw new Error('Invalid or unsupported backup version');
  }
  
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error('Invalid recovery phrase');
  }
  
  // Derive backup key
  let backupKey = deriveBackupKey(mnemonic);
  
  if (backup.hasPassphrase) {
    if (!passphrase) {
      throw new Error('This backup requires a passphrase');
    }
    const passphraseKey = deriveKeyFromPassphrase(passphrase);
    backupKey = xorBytes(backupKey, passphraseKey);
  }
  
  // Decrypt secret key
  let privateKey;
  try {
    const secretKeyBase64 = decryptData(backup.identity.encryptedSecretKey, backupKey);
    privateKey = base64ToUint8(secretKeyBase64);
  } catch (e) {
    throw new Error('Failed to decrypt backup - check your recovery phrase' + 
      (backup.hasPassphrase ? ' and passphrase' : ''));
  }
  
  // Verify public key matches
  const keyPair = nacl.sign.keyPair.fromSecretKey(privateKey);
  const restoredPublicKeyBase62 = uint8ToBase62(keyPair.publicKey);
  
  if (restoredPublicKeyBase62 !== backup.identity.publicKey) {
    throw new Error('Recovery phrase does not match this backup');
  }
  
  // Decrypt workspace keys
  const workspaces = backup.workspaces.map(ws => ({
    id: ws.id,
    name: ws.name,
    isOwner: ws.isOwner,
    encryptionKey: ws.encryptedKey 
      ? decryptData(ws.encryptedKey, backupKey)
      : null,
  }));
  
  return {
    identity: {
      publicKey: keyPair.publicKey,
      privateKey: privateKey,
      publicKeyBase62: backup.identity.publicKey,
      mnemonic: mnemonic,
    },
    workspaces,
  };
}

/**
 * Read a backup file from user input
 * 
 * @returns {Promise<Object>} Parsed backup object
 */
export function readBackupFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const backup = JSON.parse(e.target.result);
        resolve(backup);
      } catch (err) {
        reject(new Error('Invalid backup file format'));
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

// Re-export for use in backup file
function uint8ToBase62(bytes) {
  if (!bytes || bytes.length === 0) return '';
  const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  
  let num = BigInt(0);
  for (let i = 0; i < bytes.length; i++) {
    num = num * BigInt(256) + BigInt(bytes[i]);
  }
  
  if (num === BigInt(0)) return '0';
  
  let result = '';
  while (num > 0) {
    result = BASE62_ALPHABET[Number(num % BigInt(62))] + result;
    num = num / BigInt(62);
  }
  
  return result;
}
