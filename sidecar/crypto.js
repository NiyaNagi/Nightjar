// crypto.js
// Handles encryption and decryption of Yjs updates.
// Security-hardened with input validation and constant-time operations.

const nacl = require('tweetnacl');

// Native uint8array conversion functions using Node.js Buffer
// Replaces the ESM-only 'uint8arrays' package which fails in ASAR builds
function uint8ArrayFromString(str, encoding = 'utf8') {
    if (encoding === 'base64') {
        return new Uint8Array(Buffer.from(str, 'base64'));
    }
    return new Uint8Array(Buffer.from(str, encoding));
}

function uint8ArrayToString(arr, encoding = 'utf8') {
    if (encoding === 'base64') {
        return Buffer.from(arr).toString('base64');
    }
    return Buffer.from(arr).toString(encoding);
}

const PADDING_BLOCK_SIZE = 4096; // As specified in the design document
const MIN_PACKED_LENGTH = nacl.secretbox.nonceLength + nacl.secretbox.overheadLength + 4;
const MAX_UPDATE_SIZE = 100 * 1024 * 1024; // 100MB max

/**
 * Timing-safe comparison of two byte arrays
 * @param {Uint8Array} a - First array
 * @param {Uint8Array} b - Second array
 * @returns {boolean} True if equal
 */
function timingSafeEqual(a, b) {
    if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) {
        return false;
    }
    const lengthsMatch = a.length === b.length;
    const compareTo = lengthsMatch ? b : new Uint8Array(a.length);
    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a[i] ^ compareTo[i];
    }
    return result === 0 && lengthsMatch;
}

/**
 * Validate encryption key
 * @param {Uint8Array} key - Key to validate
 * @returns {boolean} True if valid
 */
function isValidKey(key) {
    return (
        key instanceof Uint8Array &&
        key.length === nacl.secretbox.keyLength &&
        !key.every(b => b === 0)
    );
}

/**
 * Securely wipe sensitive data from a Uint8Array
 * @param {Uint8Array} data - Data to wipe
 */
function secureWipe(data) {
    if (!(data instanceof Uint8Array)) return;
    try {
        const random = nacl.randomBytes(data.length);
        for (let i = 0; i < data.length; i++) data[i] = random[i];
        for (let i = 0; i < data.length; i++) data[i] = 0;
    } catch (err) {
        console.warn('[Crypto] secureWipe failed (data may be frozen):', err.message);
    }
}

/**
 * Encrypts a Yjs update with padding.
 * @param {Uint8Array} update The raw Yjs update.
 * @param {Uint8Array} key The 256-bit symmetric key.
 * @returns {Uint8Array|null} The packed encrypted data (nonce + ciphertext), or null on error.
 */
function encryptUpdate(update, key) {
    // Validate inputs
    if (!(update instanceof Uint8Array) || update.length === 0) {
        console.error('[Crypto] Invalid update data');
        return null;
    }
    if (!isValidKey(key)) {
        console.error('[Crypto] Invalid encryption key');
        return null;
    }
    if (update.length > MAX_UPDATE_SIZE) {
        console.error('[Crypto] Update too large');
        return null;
    }

    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);

    // 1. Calculate the padded size (4 bytes for length + update data, rounded up to block size)
    const minSize = 4 + update.length;
    const paddedSize = Math.ceil(minSize / PADDING_BLOCK_SIZE) * PADDING_BLOCK_SIZE;
    
    // 2. Create padded buffer with length prefix
    const padded = new Uint8Array(paddedSize);
    const view = new DataView(padded.buffer);
    view.setUint32(0, update.length, false); // Big-endian
    padded.set(update, 4);
    
    // 3. Encrypt
    const ciphertext = nacl.secretbox(padded, nonce, key);
    
    // 4. Securely wipe the padded plaintext
    secureWipe(padded);

    // 5. Pack nonce and ciphertext together
    const packed = new Uint8Array(nonce.length + ciphertext.length);
    packed.set(nonce, 0);
    packed.set(ciphertext, nonce.length);

    return packed;
}

/**
 * Decrypts a packed update and removes padding.
 * @param {Uint8Array} packed The encrypted data (nonce + ciphertext).
 * @param {Uint8Array} key The 256-bit symmetric key.
 * @returns {Uint8Array|null} The decrypted Yjs update, or null if decryption fails.
 */
function decryptUpdate(packed, key) {
    try {
        // Validate key
        if (!isValidKey(key)) {
            console.error('[Crypto] Invalid decryption key');
            return null;
        }
        
        // Ensure packed is a proper Uint8Array (convert from Buffer if needed)
        if (Buffer.isBuffer(packed) || !(packed instanceof Uint8Array)) {
            packed = new Uint8Array(packed);
        }
        
        // Validate minimum length
        if (packed.length < MIN_PACKED_LENGTH) {
            console.log('[Crypto] Packed data too short');
            return null;
        }
        
        const nonce = packed.slice(0, nacl.secretbox.nonceLength);
        const ciphertext = packed.slice(nacl.secretbox.nonceLength);

        // 1. Decrypt
        const padded = nacl.secretbox.open(ciphertext, nonce, key);
        if (!padded) {
            console.log('[Crypto] Decryption returned null (wrong key or corrupted data)');
            return null;
        }

        // 2. Unpad - CRITICAL: Use byteOffset to handle Uint8Array views correctly
        // nacl may return a view into a larger ArrayBuffer, so we must account for offset
        const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
        const originalLength = view.getUint32(0, false); // Big-endian
        
        // Sanity check the length with bounds checking
        if (originalLength > padded.byteLength - 4 || originalLength < 0 || originalLength > MAX_UPDATE_SIZE) {
            console.log(`[Crypto] Invalid originalLength: ${originalLength}, padded size: ${padded.byteLength}`);
            return null;
        }
        
        const update = padded.slice(4, 4 + originalLength);
        console.log(`[Crypto] Decrypted successfully: ${originalLength} bytes`);

        return update;
    } catch (e) {
        console.error('[Crypto] Decryption failed:', e.message);
        return null;
    }
}

/**
 * Generates a new random key for encryption.
 * @returns {Uint8Array} A 256-bit (32-byte) key.
 */
function generateKey() {
    return nacl.randomBytes(nacl.secretbox.keyLength);
}

module.exports = {
    encryptUpdate,
    decryptUpdate,
    generateKey,
    // Export security utilities
    timingSafeEqual,
    isValidKey,
    secureWipe,
};
