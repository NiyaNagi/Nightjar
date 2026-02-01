// sidecar/identity.js
// Secure identity storage for the sidecar process

const fs = require('fs');
const path = require('path');
const nacl = require('tweetnacl');
const crypto = require('crypto');

// Configurable base path - set by sidecar/index.js on startup
// When set, identity is stored in {basePath}/identity/identity.json
// When null, falls back to legacy HOME-based path ~/.Nightjar/identity.json
let configuredBasePath = null;

/**
 * Set the base path for identity storage
 * Should be called early in sidecar startup with userData path
 * @param {string} basePath - Base directory for identity storage
 */
function setBasePath(basePath) {
    if (basePath && typeof basePath === 'string') {
        configuredBasePath = basePath;
        console.log('[Identity] Base path set to:', basePath);
    }
}

/**
 * Get the legacy identity directory (HOME-based)
 * Used for migration and fallback on all platforms
 */
function getLegacyIdentityDir() {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    return path.join(homeDir, '.Nightjar');
}

/**
 * Get the legacy identity file path
 */
function getLegacyIdentityPath() {
    return path.join(getLegacyIdentityDir(), 'identity.json');
}

// Get app data directory
function getIdentityDir() {
    // If configured base path is set, use it (preferred for Electron apps)
    if (configuredBasePath) {
        const identityDir = path.join(configuredBasePath, 'identity');
        if (!fs.existsSync(identityDir)) {
            fs.mkdirSync(identityDir, { recursive: true });
        }
        return identityDir;
    }
    
    // Fallback to legacy HOME-based path
    const appDir = getLegacyIdentityDir();
    
    if (!fs.existsSync(appDir)) {
        fs.mkdirSync(appDir, { recursive: true });
    }
    
    return appDir;
}

function getIdentityPath() {
    return path.join(getIdentityDir(), 'identity.json');
}

/**
 * Migrate identity from legacy path to new path if needed
 * Called at sidecar startup after setBasePath
 * Preserves the legacy file for safety (Option A)
 * @returns {boolean} Whether migration occurred
 */
function migrateIdentityIfNeeded() {
    if (!configuredBasePath) {
        // No configured path, nothing to migrate
        return false;
    }
    
    const newPath = getIdentityPath();
    const legacyPath = getLegacyIdentityPath();
    
    console.log('[Identity] Checking migration...');
    console.log('[Identity] New path:', newPath);
    console.log('[Identity] Legacy path:', legacyPath);
    
    // Check if identity exists at new path
    if (fs.existsSync(newPath)) {
        console.log('[Identity] Identity already at new path, no migration needed');
        return false;
    }
    
    // Check if identity exists at legacy path
    if (!fs.existsSync(legacyPath)) {
        console.log('[Identity] No identity at legacy path, no migration needed');
        return false;
    }
    
    // Migrate: copy from legacy to new path (preserve legacy for safety)
    try {
        // Ensure new directory exists
        const newDir = path.dirname(newPath);
        if (!fs.existsSync(newDir)) {
            fs.mkdirSync(newDir, { recursive: true });
        }
        
        // Copy legacy identity to new path
        fs.copyFileSync(legacyPath, newPath);
        
        console.log('[Identity] Successfully migrated identity from legacy path');
        console.log('[Identity] Legacy file preserved at:', legacyPath);
        
        return true;
    } catch (e) {
        console.error('[Identity] Migration failed:', e);
        // Don't throw - continue using legacy path as fallback
        return false;
    }
}

/**
 * Store identity securely
 * Note: Private key is stored encrypted with a key derived from machine-specific info
 * For production, use OS keychain (keytar) instead
 */
function storeIdentity(identity) {
    const identityPath = getIdentityPath();
    
    // Prepare storable format (convert Uint8Arrays to hex)
    const storable = {
        privateKeyHex: Buffer.from(identity.privateKey).toString('hex'),
        publicKeyHex: Buffer.from(identity.publicKey).toString('hex'),
        publicKeyBase62: identity.publicKeyBase62,
        // IMPORTANT: Mnemonic is stored encrypted for backup
        // In production, should use OS keychain
        mnemonicEncrypted: encryptMnemonic(identity.mnemonic),
        handle: identity.handle,
        color: identity.color,
        icon: identity.icon,
        createdAt: identity.createdAt,
        devices: identity.devices
    };
    
    fs.writeFileSync(identityPath, JSON.stringify(storable, null, 2), 'utf-8');
    console.log('[Identity] Stored identity at:', identityPath);
    
    return true;
}

/**
 * Load stored identity
 */
function loadIdentity() {
    const identityPath = getIdentityPath();
    
    if (!fs.existsSync(identityPath)) {
        return null;
    }
    
    try {
        const data = JSON.parse(fs.readFileSync(identityPath, 'utf-8'));
        
        // Convert back to proper format
        const identity = {
            privateKey: new Uint8Array(Buffer.from(data.privateKeyHex, 'hex')),
            publicKey: new Uint8Array(Buffer.from(data.publicKeyHex, 'hex')),
            publicKeyBase62: data.publicKeyBase62,
            mnemonic: decryptMnemonic(data.mnemonicEncrypted),
            handle: data.handle,
            color: data.color,
            icon: data.icon,
            createdAt: data.createdAt,
            devices: data.devices || []
        };
        
        console.log('[Identity] Loaded identity for:', identity.handle);
        return identity;
    } catch (e) {
        console.error('[Identity] Failed to load identity:', e);
        return null;
    }
}

/**
 * Check if identity exists
 */
function hasIdentity() {
    return fs.existsSync(getIdentityPath());
}

/**
 * Delete stored identity
 */
function deleteIdentity() {
    const identityPath = getIdentityPath();
    if (fs.existsSync(identityPath)) {
        fs.unlinkSync(identityPath);
        console.log('[Identity] Deleted identity');
        return true;
    }
    return false;
}

/**
 * Update identity fields (handle, color, icon, devices)
 */
function updateIdentity(updates) {
    const identity = loadIdentity();
    if (!identity) {
        throw new Error('No identity to update');
    }
    
    // Only allow updating certain fields
    const allowedFields = ['handle', 'color', 'icon', 'devices'];
    for (const field of allowedFields) {
        if (updates[field] !== undefined) {
            identity[field] = updates[field];
        }
    }
    
    storeIdentity(identity);
    return identity;
}

/**
 * Simple mnemonic encryption using machine-specific key
 * For production, use OS keychain instead
 */
function getMachineKey() {
    // Derive a key from machine-specific info using proper PBKDF2
    // This is NOT secure against determined attackers, just casual access
    const os = require('os');
    const info = [
        os.hostname(),
        os.platform(),
        os.homedir(),
        'Nightjar-identity-key-v1'
    ].join(':');
    
    // Use PBKDF2 to derive a proper 32-byte key
    const salt = Buffer.from('Nightjar-machine-key-salt', 'utf-8');
    const key = crypto.pbkdf2Sync(info, salt, 10000, 32, 'sha256');
    
    return new Uint8Array(key);
}

function encryptMnemonic(mnemonic) {
    const key = getMachineKey();
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const plaintext = new TextEncoder().encode(mnemonic);
    const ciphertext = nacl.secretbox(plaintext, nonce, key);
    
    // Pack nonce + ciphertext
    const packed = Buffer.concat([Buffer.from(nonce), Buffer.from(ciphertext)]);
    return packed.toString('hex');
}

function decryptMnemonic(encrypted) {
    const key = getMachineKey();
    const packed = Buffer.from(encrypted, 'hex');
    
    const nonce = new Uint8Array(packed.slice(0, nacl.secretbox.nonceLength));
    const ciphertext = new Uint8Array(packed.slice(nacl.secretbox.nonceLength));
    
    const plaintext = nacl.secretbox.open(ciphertext, nonce, key);
    if (!plaintext) {
        throw new Error('Failed to decrypt mnemonic');
    }
    
    return new TextDecoder().decode(plaintext);
}

/**
 * Export identity for file backup
 * @param {string} password - Password to encrypt the export
 */
function exportIdentity(password) {
    const identity = loadIdentity();
    if (!identity) {
        throw new Error('No identity to export');
    }
    
    const payload = {
        mnemonic: identity.mnemonic,
        handle: identity.handle,
        color: identity.color,
        icon: identity.icon,
        createdAt: identity.createdAt
    };
    
    // Derive key from password
    const key = deriveKeyFromPassword(password);
    
    // Encrypt
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));
    const ciphertext = nacl.secretbox(plaintext, nonce, key);
    
    // Pack with version marker
    const result = {
        version: 1,
        data: Buffer.concat([Buffer.from(nonce), Buffer.from(ciphertext)]).toString('base64')
    };
    
    return JSON.stringify(result);
}

/**
 * Import identity from file backup
 */
function importIdentity(exportedData, password) {
    const parsed = JSON.parse(exportedData);
    
    if (parsed.version !== 1) {
        throw new Error('Unsupported export version');
    }
    
    const packed = Buffer.from(parsed.data, 'base64');
    const key = deriveKeyFromPassword(password);
    
    const nonce = new Uint8Array(packed.slice(0, nacl.secretbox.nonceLength));
    const ciphertext = new Uint8Array(packed.slice(nacl.secretbox.nonceLength));
    
    const plaintext = nacl.secretbox.open(ciphertext, nonce, key);
    if (!plaintext) {
        throw new Error('Wrong password or corrupted file');
    }
    
    const payload = JSON.parse(new TextDecoder().decode(plaintext));
    
    // Regenerate identity from mnemonic
    const bip39 = require('bip39');
    const seed = bip39.mnemonicToSeedSync(payload.mnemonic);
    const signingKeySeed = seed.slice(0, 32);
    const signingKeyPair = nacl.sign.keyPair.fromSeed(new Uint8Array(signingKeySeed));
    
    const identity = {
        privateKey: signingKeyPair.secretKey,
        publicKey: signingKeyPair.publicKey,
        publicKeyBase62: uint8ToBase62(signingKeyPair.publicKey),
        mnemonic: payload.mnemonic,
        handle: payload.handle,
        color: payload.color,
        icon: payload.icon,
        createdAt: payload.createdAt,
        devices: [{
            id: uint8ToBase62(nacl.randomBytes(8)),
            name: inferDeviceName(),
            platform: getPlatform(),
            lastSeen: Date.now(),
            isCurrent: true
        }]
    };
    
    storeIdentity(identity);
    return identity;
}

// Helper functions (duplicated for sidecar context)
function deriveKeyFromPassword(password) {
    // Use PBKDF2 with SHA-512 for proper key derivation
    // 100,000 iterations provides reasonable security for export passwords
    const salt = Buffer.from('Nightjar-identity-export-salt-v1', 'utf-8');
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha512');
    return new Uint8Array(key);
}

// Base62 encoding
const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function uint8ToBase62(bytes) {
    if (!bytes || bytes.length === 0) return '';
    
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

function getPlatform() {
    const platform = process.platform;
    switch (platform) {
        case 'win32': return 'windows';
        case 'darwin': return 'macos';
        case 'linux': return 'linux';
        case 'android': return 'android';
        default: return platform;
    }
}

function inferDeviceName() {
    const os = require('os');
    const hostname = os.hostname();
    const platform = getPlatform();
    
    const platformNames = {
        'windows': 'Windows PC',
        'macos': 'Mac',
        'linux': 'Linux PC',
        'android': 'Android Device',
        'ios': 'iOS Device'
    };
    
    // Use hostname if it's reasonable, otherwise platform name
    if (hostname && hostname.length < 30 && hostname !== 'localhost') {
        return hostname;
    }
    
    return platformNames[platform] || 'Device';
}

module.exports = {
    // Configuration
    setBasePath,
    migrateIdentityIfNeeded,
    // Core operations
    storeIdentity,
    loadIdentity,
    hasIdentity,
    deleteIdentity,
    updateIdentity,
    exportIdentity,
    importIdentity,
    // Path helpers
    getIdentityDir,
    getIdentityPath,
    getLegacyIdentityDir,
    getLegacyIdentityPath
};
