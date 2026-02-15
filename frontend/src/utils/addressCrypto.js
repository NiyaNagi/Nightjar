// frontend/src/utils/addressCrypto.js
// Ed25519→Curve25519 key conversion and NaCl box encryption/decryption
// for address reveals and pending address transmission — see spec §7.2

import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from '../services/p2p/protocol/serialization';
import { base62ToUint8, uint8ToBase62 } from './identity';

// Lazy-loaded ed2curve — not bundled in web builds if unavailable
let ed2curve = null;

async function loadEd2curve() {
  if (ed2curve) return ed2curve;
  try {
    const mod = await import('ed2curve');
    ed2curve = mod.default || mod;
    return ed2curve;
  } catch (err) {
    console.error('[addressCrypto] Failed to load ed2curve:', err);
    throw new Error('ed2curve is required for address encryption. Install it with: npm install ed2curve');
  }
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

/**
 * Convert an Ed25519 public key (hex string) → Curve25519 public key (Uint8Array).
 */
export async function ed25519ToCurve25519Public(ed25519PubKeyHex) {
  const conv = await loadEd2curve();
  const ed25519PubKey = hexToUint8(ed25519PubKeyHex);
  const curve = conv.convertPublicKey(ed25519PubKey);
  if (!curve) throw new Error('Failed to convert Ed25519 public key to Curve25519');
  return curve;
}

/**
 * Convert an Ed25519 secret key (64 bytes, Uint8Array) → Curve25519 secret key (32 bytes).
 */
export async function ed25519ToCurve25519Secret(ed25519SecretKey) {
  const conv = await loadEd2curve();
  const keyBytes =
    typeof ed25519SecretKey === 'string'
      ? hexToUint8(ed25519SecretKey)
      : ed25519SecretKey;
  const curve = conv.convertSecretKey(keyBytes);
  if (!curve) throw new Error('Failed to convert Ed25519 secret key to Curve25519');
  return curve;
}

/**
 * Get the local user's public key as a hex string.
 * Handles Uint8Array, hex, and base62 sources.
 */
export function getPublicKeyHex(identity) {
  if (!identity) throw new Error('Identity is required');
  if (identity.publicKeyHex) return identity.publicKeyHex;
  if (identity.publicKey instanceof Uint8Array) return uint8ToHex(identity.publicKey);
  if (identity.publicKeyBase62) return uint8ToHex(base62ToUint8(identity.publicKeyBase62, 32));
  throw new Error('Could not determine public key hex from identity');
}

/**
 * Convert a remote user's base62 public key → hex string.
 */
export function base62ToPublicKeyHex(base62Key) {
  return uint8ToHex(base62ToUint8(base62Key, 32));
}

// ---------------------------------------------------------------------------
// Encrypt / decrypt (nacl.box — authenticated public-key encryption)
// ---------------------------------------------------------------------------

/**
 * Encrypt an address object for a specific recipient (producer or admin).
 *
 * @param {Object} address            – Plain address object
 * @param {string} recipientPubKeyHex – Recipient's Ed25519 public key (hex)
 * @param {Uint8Array} senderSecretKey – Sender's Ed25519 secret key (64 bytes)
 * @returns {Promise<{ ciphertext: string, nonce: string }>}  Base64-encoded
 */
export async function encryptAddress(address, recipientPubKeyHex, senderSecretKey) {
  const recipientCurve = await ed25519ToCurve25519Public(recipientPubKeyHex);
  const senderCurve = await ed25519ToCurve25519Secret(senderSecretKey);

  const plaintext = new TextEncoder().encode(JSON.stringify(address));
  const nonce = nacl.randomBytes(24);
  const ciphertext = nacl.box(plaintext, nonce, recipientCurve, senderCurve);

  // Wipe converted secret key
  secureWipe(senderCurve);

  return {
    ciphertext: encodeBase64(ciphertext),
    nonce: encodeBase64(nonce),
  };
}

/**
 * Decrypt an address ciphertext from a specific sender.
 *
 * @param {string} ciphertextB64      – Base64 ciphertext
 * @param {string} nonceB64           – Base64 nonce
 * @param {string} senderPubKeyHex    – Sender's Ed25519 public key (hex)
 * @param {Uint8Array} recipientSecretKey – Recipient's Ed25519 secret key (64 bytes)
 * @returns {Promise<Object>}          – Decrypted address object
 */
export async function decryptAddress(ciphertextB64, nonceB64, senderPubKeyHex, recipientSecretKey) {
  const senderCurve = await ed25519ToCurve25519Public(senderPubKeyHex);
  const recipientCurve = await ed25519ToCurve25519Secret(recipientSecretKey);

  const ciphertext = decodeBase64(ciphertextB64);
  const nonce = decodeBase64(nonceB64);
  const plaintext = nacl.box.open(ciphertext, nonce, senderCurve, recipientCurve);

  // Wipe converted secret key
  secureWipe(recipientCurve);

  if (!plaintext) throw new Error('Failed to decrypt address — authentication failed');
  return JSON.parse(new TextDecoder().decode(plaintext));
}

// ---------------------------------------------------------------------------
// Admin notes symmetric encryption (§7.2.5)
// ---------------------------------------------------------------------------

/**
 * Encrypt admin notes with a symmetric key derived from workspace password.
 *
 * @param {string} notes      – Plaintext notes
 * @param {Uint8Array} key    – 32-byte key (from deriveKeyWithCache)
 * @returns {string}          – Base64-encoded (nonce || ciphertext)
 */
export function encryptAdminNotes(notes, key) {
  const plaintext = new TextEncoder().encode(notes);
  const nonce = nacl.randomBytes(24);
  const ciphertext = nacl.secretbox(plaintext, nonce, key);

  // Concatenate nonce + ciphertext then base64
  const combined = new Uint8Array(nonce.length + ciphertext.length);
  combined.set(nonce);
  combined.set(ciphertext, nonce.length);
  return encodeBase64(combined);
}

/**
 * Decrypt admin notes.
 *
 * @param {string} encoded    – Base64-encoded (nonce || ciphertext)
 * @param {Uint8Array} key    – 32-byte key (from deriveKeyWithCache)
 * @returns {string|null}     – Plaintext notes, or null if decryption fails
 */
export function decryptAdminNotes(encoded, key) {
  try {
    const combined = decodeBase64(encoded);
    const nonce = combined.slice(0, 24);
    const ciphertext = combined.slice(24);
    const plaintext = nacl.secretbox.open(ciphertext, nonce, key);
    if (!plaintext) return null;
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pending address helpers (requestor → admin, §7.2.6)
// ---------------------------------------------------------------------------

/**
 * Encrypt an address for all admins in the workspace and return pending entries.
 *
 * @param {Object} address               – Full address object
 * @param {Array} admins                  – [{ publicKey (base62), permission }]
 * @param {Uint8Array} requestorSecretKey – Requestor's Ed25519 secret key (64 bytes)
 * @param {string} requestorPubKeyHex     – Requestor's Ed25519 public key (hex)
 * @returns {Promise<Array>}              – Array of PendingAddressEntry objects
 */
export async function encryptAddressForAdmins(address, admins, requestorSecretKey, requestorPubKeyHex) {
  const entries = [];
  for (const admin of admins) {
    const adminHex = base62ToPublicKeyHex(admin.publicKey);
    const { ciphertext, nonce } = await encryptAddress(address, adminHex, requestorSecretKey);
    entries.push({
      encryptedAddress: ciphertext,
      nonce,
      forAdminPublicKey: adminHex,
      fromRequestorPublicKey: requestorPubKeyHex,
    });
  }
  return entries;
}

/**
 * Find and decrypt the pending address entry for the current admin.
 *
 * @param {Array} entries            – Array of PendingAddressEntry from Yjs
 * @param {string} adminPubKeyHex   – This admin's Ed25519 public key (hex)
 * @param {Uint8Array} adminSecretKey – This admin's Ed25519 secret key (64 bytes)
 * @returns {Promise<Object|null>}   – Decrypted address or null
 */
export async function decryptPendingAddress(entries, adminPubKeyHex, adminSecretKey) {
  if (!entries || !Array.isArray(entries)) return null;

  const myEntry = entries.find(e => e.forAdminPublicKey === adminPubKeyHex);
  if (!myEntry) return null;

  return decryptAddress(
    myEntry.encryptedAddress,
    myEntry.nonce,
    myEntry.fromRequestorPublicKey,
    adminSecretKey
  );
}

// ---------------------------------------------------------------------------
// Address reveal helpers (admin → producer, §7.2.3)
// ---------------------------------------------------------------------------

/**
 * Create an EncryptedAddressReveal for a producer.
 *
 * @param {Object} address            – Full address object
 * @param {string} producerPubKeyHex  – Producer's Ed25519 public key (hex)
 * @param {Uint8Array} adminSecretKey – Admin's Ed25519 secret key (64 bytes)
 * @param {string} adminPubKeyHex     – Admin's Ed25519 public key (hex)
 * @returns {Promise<Object>}         – EncryptedAddressReveal object
 */
export async function createAddressReveal(address, producerPubKeyHex, adminSecretKey, adminPubKeyHex) {
  const { ciphertext, nonce } = await encryptAddress(address, producerPubKeyHex, adminSecretKey);
  return {
    ciphertext,
    nonce,
    encryptedBy: adminPubKeyHex,
    revealedAt: Date.now(),
    producerConfirmed: false,
    confirmedAt: null,
  };
}

/**
 * Decrypt an address reveal as the assigned producer.
 *
 * @param {Object} reveal               – EncryptedAddressReveal from Yjs
 * @param {Uint8Array} producerSecretKey – Producer's Ed25519 secret key (64 bytes)
 * @returns {Promise<Object>}            – Decrypted address object
 */
export async function decryptAddressReveal(reveal, producerSecretKey) {
  return decryptAddress(
    reveal.ciphertext,
    reveal.nonce,
    reveal.encryptedBy,
    producerSecretKey
  );
}

// ---------------------------------------------------------------------------
// Byte utilities
// ---------------------------------------------------------------------------

function hexToUint8(hex) {
  if (!hex || hex.length % 2 !== 0) throw new Error('Invalid hex string');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

function uint8ToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Overwrite a Uint8Array with zeros — best-effort memory wipe.
 */
export function secureWipe(arr) {
  if (arr && arr.fill) arr.fill(0);
}
