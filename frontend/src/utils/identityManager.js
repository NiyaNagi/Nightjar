/**
 * Multi-Identity Manager
 * 
 * Manages multiple isolated identities with PIN-based encryption.
 * Each identity has its own encrypted storage partition.
 * 
 * Storage Schema:
 * - nightjar_identities: Array of identity metadata (unencrypted)
 *   [{ id, handle, icon, color, createdAt, docCount, pinHash, pinAttempts, attemptResetTime }]
 * - nightjar_identity_{id}: Encrypted identity data (encrypted with PIN-derived key)
 * - nightjar_data_{id}_*: Identity-scoped data keys
 * 
 * Security:
 * - PIN is 6 digits, stored as PBKDF2 hash
 * - 10 attempts per hour before identity is deleted
 * - Identity data encrypted with PIN-derived key
 */

import nacl from 'tweetnacl';
import { Buffer } from 'buffer';

// Storage keys
const IDENTITIES_KEY = 'nightjar_identities';
const IDENTITY_PREFIX = 'nightjar_identity_';
const DATA_PREFIX = 'nightjar_data_';
const ACTIVE_IDENTITY_KEY = 'nightjar_active_identity';
const SESSION_KEY = 'nightjar_session';
const LOCK_TIMEOUT_KEY = 'nightjar_lock_timeout';

// Security constants
const MAX_PIN_ATTEMPTS = 10;
const ATTEMPT_RESET_HOURS = 1;
const DEFAULT_LOCK_TIMEOUT_MINUTES = 15;
const PIN_LENGTH = 6;

/**
 * Convert base64 to base64url (browser-compatible)
 */
function base64ToBase64Url(base64) {
    return base64
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

/**
 * Convert base64url to base64 (browser-compatible)
 */
function base64UrlToBase64(base64url) {
    let base64 = base64url
        .replace(/-/g, '+')
        .replace(/_/g, '/');
    // Add padding if needed
    const padding = base64.length % 4;
    if (padding) {
        base64 += '='.repeat(4 - padding);
    }
    return base64;
}

/**
 * Generate a random identity ID (8 bytes as base64url)
 */
function generateIdentityId() {
    const bytes = nacl.randomBytes(8);
    // Use base64 and convert to base64url for browser compatibility
    const base64 = Buffer.from(bytes).toString('base64');
    return base64ToBase64Url(base64);
}

/**
 * Derive an encryption key from PIN using PBKDF2-like approach
 * Uses multiple rounds of hashing for key stretching
 */
async function deriveKeyFromPin(pin, salt) {
    const encoder = new TextEncoder();
    const pinBytes = encoder.encode(pin);
    const saltBytes = typeof salt === 'string' ? Buffer.from(salt, 'base64') : salt;
    
    // Use SubtleCrypto for PBKDF2 if available
    if (window.crypto?.subtle) {
        const keyMaterial = await window.crypto.subtle.importKey(
            'raw',
            pinBytes,
            'PBKDF2',
            false,
            ['deriveBits']
        );
        
        const derivedBits = await window.crypto.subtle.deriveBits(
            {
                name: 'PBKDF2',
                salt: saltBytes,
                iterations: 100000,
                hash: 'SHA-256'
            },
            keyMaterial,
            256
        );
        
        return new Uint8Array(derivedBits);
    }
    
    // Fallback: Use nacl hash with multiple rounds
    let hash = new Uint8Array([...pinBytes, ...saltBytes]);
    for (let i = 0; i < 10000; i++) {
        hash = nacl.hash(hash).slice(0, 32);
    }
    return hash;
}

/**
 * Hash PIN for verification storage (separate from encryption key)
 */
async function hashPin(pin, salt) {
    const key = await deriveKeyFromPin(pin, salt);
    const hash = nacl.hash(key);
    return Buffer.from(hash).toString('base64');
}

/**
 * Encrypt data with a key
 */
function encryptData(data, key) {
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const message = new TextEncoder().encode(JSON.stringify(data));
    const encrypted = nacl.secretbox(message, nonce, key);
    
    // Combine nonce + ciphertext
    const combined = new Uint8Array(nonce.length + encrypted.length);
    combined.set(nonce);
    combined.set(encrypted, nonce.length);
    
    return Buffer.from(combined).toString('base64');
}

/**
 * Decrypt data with a key
 */
function decryptData(encryptedString, key) {
    try {
        const combined = Buffer.from(encryptedString, 'base64');
        const nonce = combined.slice(0, nacl.secretbox.nonceLength);
        const ciphertext = combined.slice(nacl.secretbox.nonceLength);
        
        const decrypted = nacl.secretbox.open(ciphertext, nonce, key);
        if (!decrypted) return null;
        
        return JSON.parse(new TextDecoder().decode(decrypted));
    } catch {
        return null;
    }
}

/**
 * Get list of all identities (metadata only, not encrypted data)
 */
export function listIdentities() {
    try {
        const stored = localStorage.getItem(IDENTITIES_KEY);
        if (!stored) return [];
        
        const identities = JSON.parse(stored);
        return Array.isArray(identities) ? identities : [];
    } catch {
        return [];
    }
}

/**
 * Save identities list
 */
function saveIdentities(identities) {
    localStorage.setItem(IDENTITIES_KEY, JSON.stringify(identities));
}

/**
 * Get active identity ID
 */
export function getActiveIdentityId() {
    return localStorage.getItem(ACTIVE_IDENTITY_KEY);
}

/**
 * Set active identity ID
 */
function setActiveIdentityId(id) {
    if (id) {
        localStorage.setItem(ACTIVE_IDENTITY_KEY, id);
    } else {
        localStorage.removeItem(ACTIVE_IDENTITY_KEY);
    }
}

/**
 * Check if session is valid (not timed out)
 */
export function isSessionValid() {
    const session = sessionStorage.getItem(SESSION_KEY);
    if (!session) return false;
    
    try {
        const { identityId, unlockedAt, timeoutMinutes } = JSON.parse(session);
        const timeout = (timeoutMinutes || DEFAULT_LOCK_TIMEOUT_MINUTES) * 60 * 1000;
        const elapsed = Date.now() - unlockedAt;
        
        return elapsed < timeout;
    } catch {
        return false;
    }
}

/**
 * Get session decryption key (if session is valid)
 */
export function getSessionKey() {
    const session = sessionStorage.getItem(SESSION_KEY);
    if (!session) return null;
    
    try {
        const { key, identityId, unlockedAt, timeoutMinutes } = JSON.parse(session);
        const timeout = (timeoutMinutes || DEFAULT_LOCK_TIMEOUT_MINUTES) * 60 * 1000;
        const elapsed = Date.now() - unlockedAt;
        
        if (elapsed >= timeout) {
            // Session expired
            clearSession();
            return null;
        }
        
        return {
            identityId,
            key: Buffer.from(key, 'base64')
        };
    } catch {
        return null;
    }
}

/**
 * Create a session after successful PIN unlock
 */
function createSession(identityId, encryptionKey) {
    const timeoutMinutes = getLockTimeout();
    const session = {
        identityId,
        key: Buffer.from(encryptionKey).toString('base64'),
        unlockedAt: Date.now(),
        timeoutMinutes
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

/**
 * Clear the current session (lock the app)
 */
export function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
}

/**
 * Refresh session timeout (call on user activity)
 */
export function refreshSession() {
    const session = sessionStorage.getItem(SESSION_KEY);
    if (!session) return;
    
    try {
        const parsed = JSON.parse(session);
        parsed.unlockedAt = Date.now();
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
    } catch {
        // Invalid session
    }
}

/**
 * Get lock timeout setting (in minutes)
 */
export function getLockTimeout() {
    const stored = localStorage.getItem(LOCK_TIMEOUT_KEY);
    if (stored) {
        const val = parseInt(stored, 10);
        if (!isNaN(val) && val > 0) return val;
    }
    return DEFAULT_LOCK_TIMEOUT_MINUTES;
}

/**
 * Set lock timeout (in minutes)
 */
export function setLockTimeout(minutes) {
    if (typeof minutes === 'number' && minutes > 0) {
        localStorage.setItem(LOCK_TIMEOUT_KEY, String(minutes));
    }
}

/**
 * Validate PIN format
 */
export function validatePin(pin) {
    if (typeof pin !== 'string') return { valid: false, error: 'PIN must be a string' };
    if (pin.length !== PIN_LENGTH) return { valid: false, error: `PIN must be ${PIN_LENGTH} digits` };
    if (!/^\d+$/.test(pin)) return { valid: false, error: 'PIN must contain only digits' };
    return { valid: true };
}

/**
 * Create a new identity with PIN
 */
export async function createIdentity(identityData, pin) {
    const validation = validatePin(pin);
    if (!validation.valid) {
        throw new Error(validation.error);
    }
    
    // Generate unique ID and salt
    const id = generateIdentityId();
    const salt = nacl.randomBytes(16);
    const saltBase64 = Buffer.from(salt).toString('base64');
    
    // Derive encryption key and hash PIN
    const encryptionKey = await deriveKeyFromPin(pin, salt);
    const pinHash = await hashPin(pin, salt);
    
    // Create identity metadata (stored unencrypted)
    const metadata = {
        id,
        handle: identityData.handle || 'Anonymous',
        icon: identityData.icon || '👤',
        color: identityData.color || '#6366f1',
        createdAt: Date.now(),
        docCount: 0,
        salt: saltBase64,
        pinHash,
        pinAttempts: 0,
        attemptResetTime: null
    };
    
    // Store encrypted identity data
    const encryptedData = encryptData(identityData, encryptionKey);
    localStorage.setItem(IDENTITY_PREFIX + id, encryptedData);
    
    // Add to identities list
    const identities = listIdentities();
    identities.push(metadata);
    saveIdentities(identities);
    
    // Clear legacy identity keys to prevent re-migration
    localStorage.removeItem('identity');
    localStorage.removeItem('Nightjar-identity');
    localStorage.removeItem('Nightjar_secure_identity');
    
    // Set as active and create session
    setActiveIdentityId(id);
    createSession(id, encryptionKey);
    
    return { id, metadata, identityData };
}

/**
 * Attempt to unlock an identity with PIN
 */
export async function unlockIdentity(id, pin) {
    const identities = listIdentities();
    const metadata = identities.find(i => i.id === id);
    
    if (!metadata) {
        throw new Error('Identity not found');
    }
    
    // Check attempt limiting
    const now = Date.now();
    if (metadata.attemptResetTime && now > metadata.attemptResetTime) {
        // Reset attempts after timeout
        metadata.pinAttempts = 0;
        metadata.attemptResetTime = null;
        saveIdentities(identities);
    }
    
    if (metadata.pinAttempts >= MAX_PIN_ATTEMPTS) {
        // Delete the identity - too many attempts
        await deleteIdentity(id, true); // Force delete
        throw new Error('Too many failed attempts. Identity has been deleted for security.');
    }
    
    // Verify PIN
    const pinHash = await hashPin(pin, metadata.salt);
    
    if (pinHash !== metadata.pinHash) {
        // Wrong PIN
        metadata.pinAttempts = (metadata.pinAttempts || 0) + 1;
        
        if (!metadata.attemptResetTime) {
            metadata.attemptResetTime = now + (ATTEMPT_RESET_HOURS * 60 * 60 * 1000);
        }
        
        saveIdentities(identities);
        
        const remaining = MAX_PIN_ATTEMPTS - metadata.pinAttempts;
        if (remaining <= 0) {
            // Delete now
            await deleteIdentity(id, true);
            throw new Error('Too many failed attempts. Identity has been deleted for security.');
        }
        
        throw new Error(`Incorrect PIN. ${remaining} attempts remaining.`);
    }
    
    // PIN correct - reset attempts and create session
    metadata.pinAttempts = 0;
    metadata.attemptResetTime = null;
    saveIdentities(identities);
    
    // Derive key and decrypt
    const encryptionKey = await deriveKeyFromPin(pin, metadata.salt);
    const encrypted = localStorage.getItem(IDENTITY_PREFIX + id);
    
    if (!encrypted) {
        throw new Error('Identity data not found');
    }
    
    const identityData = decryptData(encrypted, encryptionKey);
    if (!identityData) {
        throw new Error('Failed to decrypt identity data');
    }
    
    // Set active and create session
    setActiveIdentityId(id);
    createSession(id, encryptionKey);
    
    return { id, metadata, identityData };
}

/**
 * Get the current unlocked identity data
 */
export function getUnlockedIdentity() {
    const session = getSessionKey();
    if (!session) return null;
    
    const { identityId, key } = session;
    const encrypted = localStorage.getItem(IDENTITY_PREFIX + identityId);
    if (!encrypted) return null;
    
    const identityData = decryptData(encrypted, key);
    if (!identityData) return null;
    
    const identities = listIdentities();
    const metadata = identities.find(i => i.id === identityId);
    
    return { id: identityId, metadata, identityData };
}

/**
 * Update identity data (requires active session)
 */
export function updateIdentity(updates) {
    const session = getSessionKey();
    if (!session) throw new Error('No active session');
    
    const { identityId, key } = session;
    const encrypted = localStorage.getItem(IDENTITY_PREFIX + identityId);
    if (!encrypted) throw new Error('Identity not found');
    
    const current = decryptData(encrypted, key);
    if (!current) throw new Error('Failed to decrypt identity');
    
    const updated = { ...current, ...updates };
    const newEncrypted = encryptData(updated, key);
    localStorage.setItem(IDENTITY_PREFIX + identityId, newEncrypted);
    
    // Update metadata if handle/icon/color changed
    if (updates.handle || updates.icon || updates.color) {
        const identities = listIdentities();
        const idx = identities.findIndex(i => i.id === identityId);
        if (idx >= 0) {
            if (updates.handle) identities[idx].handle = updates.handle;
            if (updates.icon) identities[idx].icon = updates.icon;
            if (updates.color) identities[idx].color = updates.color;
            saveIdentities(identities);
        }
    }
    
    return updated;
}

/**
 * Update document count for current identity
 */
export function updateDocCount(count) {
    const activeId = getActiveIdentityId();
    if (!activeId) return;
    
    const identities = listIdentities();
    const idx = identities.findIndex(i => i.id === activeId);
    if (idx >= 0) {
        identities[idx].docCount = count;
        saveIdentities(identities);
    }
}

/**
 * Delete an identity (requires confirmation)
 */
export async function deleteIdentity(id, force = false) {
    const identities = listIdentities();
    const idx = identities.findIndex(i => i.id === id);
    
    if (idx < 0 && !force) {
        throw new Error('Identity not found');
    }
    
    // Remove identity data
    localStorage.removeItem(IDENTITY_PREFIX + id);
    
    // Remove all data scoped to this identity
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(DATA_PREFIX + id + '_')) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    
    // Remove from list
    if (idx >= 0) {
        identities.splice(idx, 1);
        saveIdentities(identities);
    }
    
    // Clear active if this was the active identity
    if (getActiveIdentityId() === id) {
        setActiveIdentityId(null);
        clearSession();
    }
    
    return true;
}

/**
 * Get remaining PIN attempts for an identity
 */
export function getRemainingAttempts(id) {
    const identities = listIdentities();
    const metadata = identities.find(i => i.id === id);
    if (!metadata) return MAX_PIN_ATTEMPTS;
    
    // Check if reset time has passed
    const now = Date.now();
    if (metadata.attemptResetTime && now > metadata.attemptResetTime) {
        return MAX_PIN_ATTEMPTS;
    }
    
    return Math.max(0, MAX_PIN_ATTEMPTS - (metadata.pinAttempts || 0));
}

/**
 * Get identity-scoped storage key
 */
export function getScopedKey(key) {
    const activeId = getActiveIdentityId();
    if (!activeId) return key; // Fallback to unscoped
    return DATA_PREFIX + activeId + '_' + key;
}

/**
 * Store data scoped to current identity
 */
export function scopedSet(key, value) {
    const scopedKey = getScopedKey(key);
    localStorage.setItem(scopedKey, JSON.stringify(value));
}

/**
 * Get data scoped to current identity
 */
export function scopedGet(key) {
    const scopedKey = getScopedKey(key);
    try {
        const stored = localStorage.getItem(scopedKey);
        return stored ? JSON.parse(stored) : null;
    } catch {
        return null;
    }
}

/**
 * Remove data scoped to current identity
 */
export function scopedRemove(key) {
    const scopedKey = getScopedKey(key);
    localStorage.removeItem(scopedKey);
}

/**
 * Migrate existing identity to new multi-identity system
 * Returns info about what was migrated
 */
export async function migrateExistingIdentity(existingIdentity, pin) {
    const validation = validatePin(pin);
    if (!validation.valid) {
        throw new Error(validation.error);
    }
    
    // Create identity with existing data
    const result = await createIdentity(existingIdentity, pin);
    
    // Migrate workspace data to be scoped to this identity
    const dataKeysToMigrate = [
        'nahma-workspaces',
        'nahma-current-workspace',
        'nahma-user-profile',
        'nahma-session-key',
        'nahma_preferences',
        'Nightjar-app-settings',
        'Nightjar-chat-state'
    ];
    
    for (const key of dataKeysToMigrate) {
        const value = localStorage.getItem(key);
        if (value) {
            try {
                const parsed = JSON.parse(value);
                scopedSet(key, parsed);
            } catch {
                // Store as string if not JSON
                scopedSet(key, value);
            }
        }
    }
    
    // Count documents for metadata
    try {
        const workspaces = localStorage.getItem('nahma-workspaces');
        if (workspaces) {
            const parsed = JSON.parse(workspaces);
            let docCount = 0;
            if (Array.isArray(parsed)) {
                parsed.forEach(ws => {
                    docCount += (ws.documents?.length || 0);
                });
            }
            updateDocCount(docCount);
        }
    } catch {
        // Ignore counting errors
    }
    
    return {
        migrated: true,
        identityId: result.id,
        message: 'Your existing data has been associated with this identity.'
    };
}

/**
 * Check if migration is needed (existing identity without multi-identity setup)
 */
export function needsMigration() {
    // Check if we have old identity keys but no multi-identity setup
    const hasOldIdentity = localStorage.getItem('identity') || 
                          localStorage.getItem('Nightjar-identity') ||
                          localStorage.getItem('Nightjar_secure_identity');
    const hasNewSystem = listIdentities().length > 0;
    
    return hasOldIdentity && !hasNewSystem;
}

/**
 * Get legacy identity data for migration
 */
export function getLegacyIdentity() {
    // Try different storage locations
    const locations = [
        'identity',
        'Nightjar-identity',
        'Nightjar_secure_identity'
    ];
    
    for (const key of locations) {
        const data = localStorage.getItem(key);
        if (data) {
            try {
                return JSON.parse(data);
            } catch {
                continue;
            }
        }
    }
    
    return null;
}

export default {
    listIdentities,
    getActiveIdentityId,
    isSessionValid,
    getSessionKey,
    clearSession,
    refreshSession,
    getLockTimeout,
    setLockTimeout,
    validatePin,
    createIdentity,
    unlockIdentity,
    getUnlockedIdentity,
    updateIdentity,
    updateDocCount,
    deleteIdentity,
    getRemainingAttempts,
    getScopedKey,
    scopedSet,
    scopedGet,
    scopedRemove,
    migrateExistingIdentity,
    needsMigration,
    getLegacyIdentity
};
