/**
 * Web Identity Storage
 * 
 * Secure storage for cryptographic identity in browser environments.
 * Uses IndexedDB for persistence and Web Crypto API for encryption.
 * 
 * Security:
 * - Private keys are encrypted at rest with a user-provided password (optional)
 * - Uses PBKDF2 for key derivation
 * - AES-GCM for encryption
 * - Falls back to localStorage if IndexedDB unavailable
 */

const DB_NAME = 'Nightjar-identity';
const DB_VERSION = 1;
const STORE_NAME = 'identity';
const SALT_KEY = 'Nightjar-salt';

/**
 * Generate cryptographically secure random bytes
 */
function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Convert ArrayBuffer to base64
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert base64 to ArrayBuffer
 */
function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Derive encryption key from password using PBKDF2
 */
async function deriveKey(password, salt) {
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt data with AES-GCM
 */
async function encrypt(data, key) {
  const iv = randomBytes(12);
  const encoder = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(JSON.stringify(data))
  );
  
  return {
    iv: arrayBufferToBase64(iv),
    data: arrayBufferToBase64(encrypted)
  };
}

/**
 * Decrypt data with AES-GCM
 */
async function decrypt(encryptedData, key) {
  const iv = new Uint8Array(base64ToArrayBuffer(encryptedData.iv));
  const data = new Uint8Array(base64ToArrayBuffer(encryptedData.data));
  
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );
  
  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(decrypted));
}

/**
 * Open IndexedDB database
 */
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

/**
 * Store data in IndexedDB
 */
async function dbStore(id, data) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put({ id, ...data });
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
    
    transaction.oncomplete = () => db.close();
  });
}

/**
 * Retrieve data from IndexedDB
 */
async function dbGet(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    transaction.oncomplete = () => db.close();
  });
}

/**
 * Delete data from IndexedDB
 */
async function dbDelete(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
    
    transaction.oncomplete = () => db.close();
  });
}

/**
 * Get or create encryption salt
 */
async function getSalt() {
  let saltData = await dbGet(SALT_KEY);
  if (!saltData) {
    const salt = randomBytes(16);
    saltData = { salt: arrayBufferToBase64(salt) };
    await dbStore(SALT_KEY, saltData);
  }
  return new Uint8Array(base64ToArrayBuffer(saltData.salt));
}

/**
 * WebIdentityStore - Main class for browser identity storage
 */
export class WebIdentityStore {
  constructor() {
    this.useEncryption = false;
    this.encryptionKey = null;
  }

  /**
   * Initialize storage with optional password encryption
   */
  async initialize(password = null) {
    if (password) {
      const salt = await getSalt();
      this.encryptionKey = await deriveKey(password, salt);
      this.useEncryption = true;
    } else {
      this.useEncryption = false;
      this.encryptionKey = null;
    }
  }

  /**
   * Check if identity exists
   */
  async hasIdentity() {
    try {
      const data = await dbGet('identity');
      return !!data;
    } catch (e) {
      // Fallback to localStorage
      return !!localStorage.getItem('Nightjar-identity');
    }
  }

  /**
   * Check if identity is encrypted
   */
  async isEncrypted() {
    try {
      const data = await dbGet('identity');
      return data?.encrypted === true;
    } catch (e) {
      const stored = localStorage.getItem('Nightjar-identity');
      if (stored) {
        const data = JSON.parse(stored);
        return data?.encrypted === true;
      }
      return false;
    }
  }

  /**
   * Store identity
   */
  async storeIdentity(identity) {
    const toStore = {
      privateKey: identity.privateKey,
      publicKey: identity.publicKey,
      mnemonic: identity.mnemonic,
      profile: identity.profile,
      createdAt: identity.createdAt || Date.now(),
      devices: identity.devices || []
    };

    let data;
    if (this.useEncryption && this.encryptionKey) {
      const encrypted = await encrypt(toStore, this.encryptionKey);
      data = { encrypted: true, ...encrypted };
    } else {
      data = { encrypted: false, ...toStore };
    }

    try {
      await dbStore('identity', data);
    } catch (e) {
      // Fallback to localStorage
      console.warn('[WebIdentityStore] IndexedDB failed, using localStorage');
      localStorage.setItem('Nightjar-identity', JSON.stringify(data));
    }
  }

  /**
   * Retrieve identity
   */
  async getIdentity() {
    let data;
    try {
      data = await dbGet('identity');
    } catch (e) {
      // Fallback to localStorage
      const stored = localStorage.getItem('Nightjar-identity');
      if (stored) {
        try {
          data = JSON.parse(stored);
        } catch (parseErr) {
          console.warn('[WebIdentityStore] Failed to parse localStorage fallback:', parseErr);
          return null;
        }
      }
    }

    if (!data) return null;

    if (data.encrypted) {
      if (!this.encryptionKey) {
        throw new Error('Identity is encrypted. Call initialize() with password first.');
      }
      return await decrypt(data, this.encryptionKey);
    }

    return {
      privateKey: data.privateKey,
      publicKey: data.publicKey,
      mnemonic: data.mnemonic,
      profile: data.profile,
      createdAt: data.createdAt,
      devices: data.devices
    };
  }

  /**
   * Delete identity
   */
  async deleteIdentity() {
    try {
      await dbDelete('identity');
    } catch (e) {
      // Ignore
    }
    localStorage.removeItem('Nightjar-identity');
  }

  /**
   * Export identity for backup (returns recovery data)
   */
  async exportIdentity() {
    const identity = await this.getIdentity();
    if (!identity) throw new Error('No identity to export');

    // Only export what's needed for recovery
    return {
      mnemonic: identity.mnemonic,
      profile: identity.profile
    };
  }

  /**
   * Change encryption password
   */
  async changePassword(currentPassword, newPassword) {
    // Re-initialize with current password
    if (currentPassword) {
      await this.initialize(currentPassword);
    }
    
    // Get identity
    const identity = await this.getIdentity();
    if (!identity) throw new Error('No identity found');

    // Re-initialize with new password
    if (newPassword) {
      const salt = await getSalt();
      this.encryptionKey = await deriveKey(newPassword, salt);
      this.useEncryption = true;
    } else {
      this.useEncryption = false;
      this.encryptionKey = null;
    }

    // Re-store with new encryption
    await this.storeIdentity(identity);
  }
}

/**
 * Generate Ed25519 keypair using Web Crypto API
 * Note: Web Crypto doesn't support Ed25519 in all browsers,
 * so we use a polyfill approach with ECDSA P-256 as fallback
 */
export async function generateKeyPair() {
  try {
    // Try Ed25519 first (supported in modern browsers)
    const keyPair = await crypto.subtle.generateKey(
      { name: 'Ed25519' },
      true,
      ['sign', 'verify']
    );
    
    const privateKey = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
    const publicKey = await crypto.subtle.exportKey('spki', keyPair.publicKey);
    
    return {
      privateKey: arrayBufferToBase64(privateKey),
      publicKey: arrayBufferToBase64(publicKey),
      algorithm: 'Ed25519'
    };
  } catch (e) {
    // Fallback to ECDSA P-256
    console.warn('[WebIdentityStore] Ed25519 not supported, using ECDSA P-256');
    
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
    
    const privateKey = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
    const publicKey = await crypto.subtle.exportKey('spki', keyPair.publicKey);
    
    return {
      privateKey: arrayBufferToBase64(privateKey),
      publicKey: arrayBufferToBase64(publicKey),
      algorithm: 'ECDSA-P256'
    };
  }
}

/**
 * Sign data with private key
 */
export async function signData(privateKeyBase64, data, algorithm = 'Ed25519') {
  const privateKeyBuffer = base64ToArrayBuffer(privateKeyBase64);
  const encoder = new TextEncoder();
  
  let privateKey;
  if (algorithm === 'Ed25519') {
    privateKey = await crypto.subtle.importKey(
      'pkcs8',
      privateKeyBuffer,
      { name: 'Ed25519' },
      false,
      ['sign']
    );
  } else {
    privateKey = await crypto.subtle.importKey(
      'pkcs8',
      privateKeyBuffer,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    );
  }
  
  const signature = await crypto.subtle.sign(
    algorithm === 'Ed25519' ? 'Ed25519' : { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    encoder.encode(data)
  );
  
  return arrayBufferToBase64(signature);
}

/**
 * Verify signature with public key
 */
export async function verifySignature(publicKeyBase64, data, signatureBase64, algorithm = 'Ed25519') {
  const publicKeyBuffer = base64ToArrayBuffer(publicKeyBase64);
  const signatureBuffer = base64ToArrayBuffer(signatureBase64);
  const encoder = new TextEncoder();
  
  let publicKey;
  if (algorithm === 'Ed25519') {
    publicKey = await crypto.subtle.importKey(
      'spki',
      publicKeyBuffer,
      { name: 'Ed25519' },
      false,
      ['verify']
    );
  } else {
    publicKey = await crypto.subtle.importKey(
      'spki',
      publicKeyBuffer,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
  }
  
  return crypto.subtle.verify(
    algorithm === 'Ed25519' ? 'Ed25519' : { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    signatureBuffer,
    encoder.encode(data)
  );
}

/**
 * Create a fingerprint from public key (short identifier)
 */
export async function getKeyFingerprint(publicKeyBase64) {
  const publicKeyBuffer = base64ToArrayBuffer(publicKeyBase64);
  const hash = await crypto.subtle.digest('SHA-256', publicKeyBuffer);
  const hashArray = new Uint8Array(hash);
  
  // Return first 8 bytes as hex
  return Array.from(hashArray.slice(0, 8))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export default WebIdentityStore;
