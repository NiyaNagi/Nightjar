// frontend/src/utils/identity.js
// Identity management utilities - keypair generation, BIP39 mnemonics, encoding

import * as bip39 from 'bip39';
import nacl from 'tweetnacl';
import { Buffer } from 'buffer';

// Polyfill Buffer globally for bip39
if (typeof window !== 'undefined' && !window.Buffer) {
    window.Buffer = Buffer;
}

// Base62 alphabet for compact encoding
const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Encode a Uint8Array to base62 string
 */
export function uint8ToBase62(bytes) {
    if (!bytes || bytes.length === 0) return '';
    
    // Convert to BigInt
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
    
    // Preserve leading zeros
    for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
        result = '0' + result;
    }
    
    return result;
}

/**
 * Decode a base62 string to Uint8Array
 */
export function base62ToUint8(str, expectedLength = 32) {
    if (!str) return new Uint8Array(expectedLength);
    
    let num = BigInt(0);
    for (let i = 0; i < str.length; i++) {
        const idx = BASE62_ALPHABET.indexOf(str[i]);
        if (idx === -1) throw new Error(`Invalid base62 character: ${str[i]}`);
        num = num * BigInt(62) + BigInt(idx);
    }
    
    // Convert to bytes
    const bytes = [];
    while (num > 0) {
        bytes.unshift(Number(num % BigInt(256)));
        num = num / BigInt(256);
    }
    
    // Pad to expected length
    while (bytes.length < expectedLength) {
        bytes.unshift(0);
    }
    
    return new Uint8Array(bytes);
}

/**
 * Generate a new identity keypair from entropy or random
 * @param {string} mnemonic - Optional BIP39 mnemonic to derive from
 * @returns {Object} Identity object with keys and metadata
 */
export function generateIdentity(mnemonic = null) {
    let seed;
    let generatedMnemonic = mnemonic;
    
    if (!mnemonic) {
        // Generate new mnemonic (128 bits = 12 words)
        generatedMnemonic = bip39.generateMnemonic(128);
    }
    
    // Derive seed from mnemonic (512-bit seed, we use first 32 bytes)
    const rawSeed = bip39.mnemonicToSeedSync(generatedMnemonic);
    // Ensure it's a Uint8Array (Buffer.slice may return Buffer in Node.js)
    seed = new Uint8Array(rawSeed);
    
    // Use first 32 bytes as signing keypair seed
    const signingKeySeed = seed.slice(0, 32);
    const signingKeyPair = nacl.sign.keyPair.fromSeed(signingKeySeed);
    
    // Generate a device ID
    const deviceId = uint8ToBase62(nacl.randomBytes(8));
    
    return {
        privateKey: signingKeyPair.secretKey,  // 64 bytes (includes public key)
        publicKey: signingKeyPair.publicKey,   // 32 bytes
        publicKeyBase62: uint8ToBase62(signingKeyPair.publicKey),
        mnemonic: generatedMnemonic,
        handle: '',  // User will set this
        color: generateRandomColor(),
        icon: getRandomEmoji(),
        createdAt: Date.now(),
        devices: [{
            id: deviceId,
            name: inferDeviceName(),
            platform: getPlatform(),
            lastSeen: Date.now(),
            isCurrent: true
        }]
    };
}

/**
 * Restore identity from mnemonic phrase
 */
export function restoreIdentityFromMnemonic(mnemonic) {
    if (!bip39.validateMnemonic(mnemonic)) {
        throw new Error('Invalid recovery phrase');
    }
    return generateIdentity(mnemonic);
}

/**
 * Validate a BIP39 mnemonic
 */
export function validateMnemonic(mnemonic) {
    return bip39.validateMnemonic(mnemonic);
}

/**
 * Get a short ID from public key (first 10 chars of base62)
 */
export function getShortId(publicKey) {
    if (typeof publicKey === 'string') {
        return publicKey.slice(0, 10);
    }
    return uint8ToBase62(publicKey).slice(0, 10);
}

/**
 * Sign data with private key
 */
export function signData(data, privateKey) {
    const message = typeof data === 'string' 
        ? new TextEncoder().encode(data) 
        : data;
    return nacl.sign.detached(message, privateKey);
}

/**
 * Verify signature with public key
 */
export function verifySignature(data, signature, publicKey) {
    const message = typeof data === 'string'
        ? new TextEncoder().encode(data)
        : data;
    return nacl.sign.detached.verify(message, signature, publicKey);
}

/**
 * Get platform string
 */
export function getPlatform() {
    if (typeof navigator !== 'undefined') {
        const ua = navigator.userAgent.toLowerCase();
        if (ua.includes('android')) return 'android';
        if (ua.includes('iphone') || ua.includes('ipad')) return 'ios';
        if (ua.includes('win')) return 'windows';
        if (ua.includes('mac')) return 'macos';
        if (ua.includes('linux')) return 'linux';
    }
    return 'unknown';
}

/**
 * Infer device name from available info
 */
export function inferDeviceName() {
    const platform = getPlatform();
    
    // Try to get more specific info
    if (typeof navigator !== 'undefined') {
        // Check for mobile device model in user agent
        const ua = navigator.userAgent;
        
        // Android device
        const androidMatch = ua.match(/Android.*?;\s*([^)]+)/);
        if (androidMatch) {
            const model = androidMatch[1].split(';')[0].trim();
            if (model && model.length < 30) {
                return model;
            }
        }
        
        // iOS device
        if (ua.includes('iPhone')) return 'iPhone';
        if (ua.includes('iPad')) return 'iPad';
    }
    
    // Desktop naming
    const platformNames = {
        'windows': 'Windows PC',
        'macos': 'Mac',
        'linux': 'Linux PC',
        'android': 'Android Device',
        'ios': 'iOS Device',
        'unknown': 'Device'
    };
    
    return platformNames[platform] || 'Device';
}

/**
 * Generate a random pastel color for user
 */
export function generateRandomColor() {
    const hue = Math.floor(Math.random() * 360);
    return `hsl(${hue}, 70%, 60%)`;
}

/**
 * Get a random emoji avatar
 */
export function getRandomEmoji() {
    const emojis = [
        '🦊', '🐻', '🐼', '🐨', '🦁', '🐯', '🐮', '🐷', '🐸', '🐵',
        '🐔', '🐧', '🐦', '🦅', '🦆', '🦉', '🐺', '🐗', '🐴', '🦄',
        '🐝', '🦋', '🐌', '🐙', '🦀', '🐠', '🐬', '🐳', '🌸', '🌺',
        '🌻', '🌼', '🌷', '🌹', '🍀', '🌿', '🌴', '🌵', '⭐', '🌙',
        '☀️', '🌈', '❄️', '🔥', '💎', '🎯', '🎨', '🎭', '🎪', '🎢'
    ];
    return emojis[Math.floor(Math.random() * emojis.length)];
}

/**
 * Available emoji options for user selection
 */
export const EMOJI_OPTIONS = [
    '🦊', '🐻', '🐼', '🐨', '🦁', '🐯', '🐮', '🐷', '🐸', '🐵',
    '🐔', '🐧', '🐦', '🦅', '🦆', '🦉', '🐺', '🐗', '🐴', '🦄',
    '🐝', '🦋', '🐌', '🐙', '🦀', '🐠', '🐬', '🐳', '🌸', '🌺',
    '🌻', '🌼', '🌷', '🌹', '🍀', '🌿', '🌴', '🌵', '⭐', '🌙',
    '☀️', '🌈', '❄️', '🔥', '💎', '🎯', '🎨', '🎭', '🎪', '🎢',
    '🚀', '✨', '💫', '🌟', '⚡', '🎵', '🎸', '🎹', '🎺', '🥁'
];

/**
 * Generate QR data for identity transfer
 * @param {Object} identity - The identity to export
 * @param {string} pin - 4-digit PIN for encryption
 * @param {number} expiresInMinutes - How long the QR is valid
 */
export function generateTransferQRData(identity, pin, expiresInMinutes = 5) {
    // Create transfer payload
    const payload = {
        mnemonic: identity.mnemonic,
        handle: identity.handle,
        color: identity.color,
        icon: identity.icon,
        expires: Date.now() + (expiresInMinutes * 60 * 1000)
    };
    
    // Derive encryption key from PIN (using simple hash for short-lived QR)
    const pinBytes = new TextEncoder().encode(pin.padEnd(32, '0'));
    const pinKey = pinBytes.slice(0, 32);
    
    // Encrypt payload
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));
    const ciphertext = nacl.secretbox(plaintext, nonce, pinKey);
    
    // Pack: nonce + ciphertext
    const packed = new Uint8Array(nonce.length + ciphertext.length);
    packed.set(nonce, 0);
    packed.set(ciphertext, nonce.length);
    
    // Return as base62
    return uint8ToBase62(packed);
}

/**
 * Decrypt QR data to restore identity
 */
export function decryptTransferQRData(qrData, pin) {
    try {
        const packed = base62ToUint8(qrData, qrData.length); // Variable length
        
        // Derive key from PIN
        const pinBytes = new TextEncoder().encode(pin.padEnd(32, '0'));
        const pinKey = pinBytes.slice(0, 32);
        
        // Unpack
        const nonce = packed.slice(0, nacl.secretbox.nonceLength);
        const ciphertext = packed.slice(nacl.secretbox.nonceLength);
        
        // Decrypt
        const plaintext = nacl.secretbox.open(ciphertext, nonce, pinKey);
        if (!plaintext) {
            throw new Error('Invalid PIN or corrupted data');
        }
        
        const payload = JSON.parse(new TextDecoder().decode(plaintext));
        
        // Check expiry
        if (payload.expires < Date.now()) {
            throw new Error('QR code has expired');
        }
        
        // Restore identity
        const identity = restoreIdentityFromMnemonic(payload.mnemonic);
        identity.handle = payload.handle;
        identity.color = payload.color;
        identity.icon = payload.icon;
        
        return identity;
    } catch (e) {
        throw new Error('Failed to decrypt: ' + e.message);
    }
}

/**
 * Create public identity object for sharing via awareness
 */
export function getPublicIdentity(identity, deviceId, deviceName) {
    return {
        publicKey: identity.publicKeyBase62,
        handle: identity.handle,
        color: identity.color,
        icon: identity.icon,
        deviceId: deviceId,
        deviceName: deviceName
    };
}
