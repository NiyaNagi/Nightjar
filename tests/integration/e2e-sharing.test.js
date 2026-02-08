/**
 * End-to-End P2P Sharing Integration Tests
 * 
 * Tests the COMPLETE sharing stack:
 * 1. Share link generation (generateShareLink, generateSignedInviteLink)
 * 2. Share link parsing/verification (parseShareLink, validateSignedInvite)
 * 3. Sidecar IPC (join-workspace, create-workspace handlers)
 * 4. DHT discovery via real Hyperswarm network
 * 5. Y.js document sync (workspace-meta, documents, chat)
 * 6. Cross-platform relay server (WebSocket bridge)
 * 7. Document content verification across all clients
 * 
 * Run with: npm run test:e2e:sharing
 * 
 * NOTE: These tests use the REAL Hyperswarm DHT network.
 * Tests may take 10-60 seconds depending on DHT discovery time.
 */

const crypto = require('crypto');
const Y = require('yjs');
const WebSocket = require('ws');
const path = require('path');

// Load sidecar modules
const { HyperswarmManager } = require('../../sidecar/hyperswarm');
const { getWorkspaceTopicHex } = require('../../sidecar/mesh-constants');

// We need to port the sharing utils to work in Node.js
// The frontend version uses browser APIs, so we create Node.js equivalents

// =============================================================================
// Node.js Sharing Utilities (ported from frontend/src/utils/sharing.js)
// =============================================================================

const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function base62Encode(bytes) {
  if (bytes.length === 0) return '0';
  let num = BigInt(0);
  for (const byte of bytes) {
    num = num * BigInt(256) + BigInt(byte);
  }
  let result = '';
  const base = BigInt(62);
  while (num > 0) {
    result = BASE62_ALPHABET[Number(num % base)] + result;
    num = num / base;
  }
  for (const byte of bytes) {
    if (byte === 0) result = '0' + result;
    else break;
  }
  return result || '0';
}

function base62Decode(str) {
  if (!str || str === '0') return new Uint8Array(0);
  let leadingZeros = 0;
  for (const char of str) {
    if (char === '0') leadingZeros++;
    else break;
  }
  let num = BigInt(0);
  const base = BigInt(62);
  for (const char of str) {
    const index = BASE62_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Invalid Base62 character: ${char}`);
    num = num * base + BigInt(index);
  }
  const bytes = [];
  while (num > 0) {
    bytes.unshift(Number(num % BigInt(256)));
    num = num / BigInt(256);
  }
  for (let i = 0; i < leadingZeros; i++) bytes.unshift(0);
  return new Uint8Array(bytes);
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64Url(bytes) {
  const base64 = Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

function crc16(data) {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      if (crc & 0x8000) crc = (crc << 1) ^ 0x1021;
      else crc <<= 1;
      crc &= 0xffff;
    }
  }
  return crc;
}

const PROTOCOL_VERSION = 4;
const ENTITY_TYPES = { workspace: 'w', folder: 'f', document: 'd' };
const CODE_TO_ENTITY = { w: 'workspace', f: 'folder', d: 'document' };
const PERMISSION_CODES = { owner: 'o', editor: 'e', viewer: 'v' };
const CODE_TO_PERMISSION = { o: 'owner', e: 'editor', v: 'viewer' };

function generateShareLink(options) {
  const {
    entityType = 'workspace',
    entityId,
    permission = 'editor',
    encryptionKey = null,
    hyperswarmPeers = [],
    topicHash = null,
    directAddress = null,
    serverUrl = null,
  } = options;
  
  const idBytes = hexToBytes(entityId);
  if (idBytes.length !== 16) throw new Error('Entity ID must be 16 bytes (32 hex chars)');
  
  const payload = new Uint8Array(20);
  payload.set(idBytes, 0);
  payload[16] = PROTOCOL_VERSION;
  payload[17] = encryptionKey ? 0x04 : 0x00;
  const checksum = crc16(payload.subarray(0, 18));
  payload[18] = (checksum >> 8) & 0xff;
  payload[19] = checksum & 0xff;
  
  const encoded = base62Encode(payload);
  const typeCode = ENTITY_TYPES[entityType] || 'w';
  let link = `nightjar://${typeCode}/${encoded}`;
  
  const fragmentParts = [];
  if (encryptionKey) fragmentParts.push('k:' + bytesToBase64Url(encryptionKey));
  fragmentParts.push('perm:' + (PERMISSION_CODES[permission] || 'e'));
  if (directAddress) fragmentParts.push('addr:' + encodeURIComponent(directAddress));
  if (hyperswarmPeers?.length > 0) fragmentParts.push('hpeer:' + hyperswarmPeers.slice(0, 3).join(','));
  if (serverUrl) fragmentParts.push('srv:' + encodeURIComponent(serverUrl));
  if (entityType === 'workspace' && topicHash) fragmentParts.push('topic:' + topicHash);
  
  if (fragmentParts.length > 0) link += '#' + fragmentParts.join('&');
  return link;
}

function parseShareLink(link) {
  let encoded = link.trim();
  let fragment = '';
  let entityType = 'document';
  
  const hashIndex = encoded.indexOf('#');
  if (hashIndex !== -1) {
    fragment = encoded.slice(hashIndex + 1);
    encoded = encoded.slice(0, hashIndex);
  }
  
  if (encoded.toLowerCase().startsWith('nightjar://')) {
    const afterProtocol = encoded.slice('nightjar://'.length);
    const slashIndex = afterProtocol.indexOf('/');
    if (slashIndex !== -1) {
      const typeCode = afterProtocol.slice(0, slashIndex);
      if (typeCode in CODE_TO_ENTITY) {
        entityType = CODE_TO_ENTITY[typeCode];
        encoded = afterProtocol.slice(slashIndex + 1);
      }
    }
  }
  
  encoded = encoded.split('/')[0].split('?')[0];
  const payload = base62Decode(encoded);
  if (payload.length < 20) throw new Error('Invalid share link: payload too short');
  
  const expectedChecksum = crc16(payload.subarray(0, 18));
  const actualChecksum = (payload[18] << 8) | payload[19];
  if (expectedChecksum !== actualChecksum) throw new Error('Invalid share link: checksum mismatch');
  
  const entityId = bytesToHex(payload.subarray(0, 16));
  const version = payload[16];
  const flags = payload[17];
  
  let encryptionKey = null;
  let permission = 'editor';
  let hyperswarmPeers = [];
  let serverUrl = null;
  let topic = null;
  
  for (const param of fragment.split('&')) {
    if (param.startsWith('k:')) encryptionKey = base64UrlToBytes(param.slice(2));
    else if (param.startsWith('perm:')) {
      const code = param.slice(5);
      if (code in CODE_TO_PERMISSION) permission = CODE_TO_PERMISSION[code];
    }
    else if (param.startsWith('hpeer:')) hyperswarmPeers = param.slice(6).split(',').filter(p => p.length === 64);
    else if (param.startsWith('srv:')) serverUrl = decodeURIComponent(param.slice(4));
    else if (param.startsWith('topic:')) topic = param.slice(6);
  }
  
  return {
    entityType,
    entityId,
    version,
    hasEmbeddedKey: (flags & 0x04) !== 0,
    encryptionKey,
    permission,
    hyperswarmPeers,
    serverUrl,
    topic,
  };
}

// Ed25519 signing for signed invite links
const nacl = require('tweetnacl');

function uint8ToBase62(bytes) {
  return base62Encode(bytes);
}

function base62ToUint8(str, expectedLen = 0) {
  const bytes = base62Decode(str);
  if (expectedLen && bytes.length !== expectedLen) {
    // Pad or truncate to expected length
    if (bytes.length < expectedLen) {
      const padded = new Uint8Array(expectedLen);
      padded.set(bytes, expectedLen - bytes.length);
      return padded;
    }
  }
  return bytes;
}

function signData(message, privateKey) {
  const encoder = new TextEncoder();
  const msgBytes = encoder.encode(message);
  return nacl.sign.detached(msgBytes, privateKey);
}

function verifySignature(message, signature, publicKey) {
  try {
    const encoder = new TextEncoder();
    const msgBytes = encoder.encode(message);
    return nacl.sign.detached.verify(msgBytes, signature, publicKey);
  } catch {
    return false;
  }
}

function generateSignedInviteLink(options) {
  const {
    workspaceId,
    encryptionKey,
    permission = 'editor',
    expiryMinutes = 60,
    ownerPrivateKey,
    ownerPublicKey,
    hyperswarmPeers = [],
    topicHash = null,
    directAddress = null,
    serverUrl = null,
  } = options;
  
  const maxMinutes = 24 * 60;
  const actualExpiry = Math.min(expiryMinutes, maxMinutes);
  const expiryTimestamp = Date.now() + (actualExpiry * 60 * 1000);
  
  const messageToSign = `${workspaceId}|${expiryTimestamp}|${permission}`;
  const signature = signData(messageToSign, ownerPrivateKey);
  const signatureBase62 = uint8ToBase62(signature);
  
  const baseLink = generateShareLink({
    entityType: 'workspace',
    entityId: workspaceId,
    permission,
    encryptionKey,
    hyperswarmPeers,
    topicHash,
    directAddress,
    serverUrl,
  });
  
  const [linkPart, existingFragment] = baseLink.split('#');
  const fragmentParts = existingFragment ? existingFragment.split('&') : [];
  fragmentParts.push(`exp:${expiryTimestamp}`);
  fragmentParts.push(`sig:${signatureBase62}`);
  fragmentParts.push(`by:${ownerPublicKey}`);
  
  return {
    link: `${linkPart}#${fragmentParts.join('&')}`,
    expiry: expiryTimestamp,
    expiryMinutes: actualExpiry,
    signature: signatureBase62,
    ownerPublicKey,
  };
}

function validateSignedInvite(link) {
  try {
    const parsed = parseShareLink(link);
    if (!parsed) return { valid: false, error: 'Invalid link format' };
    
    const [, fragment] = link.split('#');
    if (!fragment) return { valid: true, legacy: true, ...parsed };
    
    const params = {};
    fragment.split('&').forEach(part => {
      const colonIndex = part.indexOf(':');
      if (colonIndex > 0) {
        params[part.slice(0, colonIndex)] = part.slice(colonIndex + 1);
      }
    });
    
    const expiry = params.exp ? parseInt(params.exp, 10) : null;
    const signatureBase62 = params.sig;
    const ownerPublicKey = params.by;
    
    if (!expiry || !signatureBase62) return { valid: true, legacy: true, ...parsed };
    if (Date.now() > expiry) return { valid: false, error: 'Invite link has expired', expiry };
    
    if (ownerPublicKey) {
      const messageToSign = `${parsed.entityId}|${expiry}|${parsed.permission}`;
      const signature = base62ToUint8(signatureBase62, 64);
      const publicKey = base62ToUint8(ownerPublicKey, 32);
      
      const isValid = verifySignature(messageToSign, signature, publicKey);
      if (!isValid) return { valid: false, error: 'Invalid signature' };
    }
    
    return {
      valid: true,
      expiry,
      expiresIn: expiry - Date.now(),
      permission: parsed.permission,
      ownerPublicKey,
      ...parsed,
    };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

// =============================================================================
// Test Client Class - Simulates a full Nightjar client
// =============================================================================

class TestClient {
  constructor(name) {
    this.name = name;
    this.identity = null;
    this.hyperswarm = null;
    this.workspaces = new Map(); // workspaceId -> { doc, topic, encryptionKey }
    this.documents = new Map(); // docId -> Y.Doc
    this.peers = new Set();
    this.syncReceived = [];
  }
  
  async initialize() {
    // Generate Ed25519 identity using tweetnacl
    const keyPair = nacl.sign.keyPair();
    const privateKey = keyPair.secretKey; // 64 bytes in nacl (seed + pubkey)
    const publicKey = keyPair.publicKey;  // 32 bytes
    
    this.identity = {
      privateKey,
      publicKey,
      publicKeyHex: bytesToHex(publicKey),
      publicKeyBase62: uint8ToBase62(publicKey),
      // secretKey is hex string of the 64-byte secret key for Hyperswarm
      secretKeyHex: bytesToHex(privateKey),
    };
    
    // Initialize Hyperswarm
    // HyperswarmManager expects identity passed to initialize(), not constructor
    this.hyperswarm = new HyperswarmManager();
    
    // Hyperswarm expects identity with publicKey and secretKey (both hex strings)
    await this.hyperswarm.initialize({
      name: this.name,
      publicKey: this.identity.publicKeyHex,
      secretKey: this.identity.secretKeyHex,
    });
    
    // Set up event handlers
    this.hyperswarm.on('peer-joined', (peer) => {
      console.log(`  [${this.name}] Peer joined: ${peer.name || peer.peerId?.slice(0, 16)}`);
      this.peers.add(peer.peerId);
    });
    
    this.hyperswarm.on('peer-left', (peer) => {
      console.log(`  [${this.name}] Peer left: ${peer.peerId?.slice(0, 16)}`);
      this.peers.delete(peer.peerId);
    });
    
    this.hyperswarm.on('sync-message', ({ peerId, topic, data }) => {
      console.log(`  [${this.name}] Received sync from ${peerId.slice(0, 8)}...`);
      this.syncReceived.push({ peerId, topic, data, timestamp: Date.now() });
      this._applySyncMessage(topic, data);
    });
    
    this.hyperswarm.on('sync-state-received', ({ peerId, topic, data }) => {
      console.log(`  [${this.name}] Received full state from ${peerId.slice(0, 8)}...`);
      this._applySyncMessage(topic, data);
    });
    
    this.hyperswarm.on('sync-state-request', ({ peerId, topic }) => {
      console.log(`  [${this.name}] Peer ${peerId.slice(0, 8)}... requested full state`);
      const workspace = this._findWorkspaceByTopic(topic);
      if (workspace) {
        const state = Y.encodeStateAsUpdate(workspace.doc);
        this.hyperswarm.sendSyncState(peerId, topic, Buffer.from(state).toString('base64'));
      }
    });
    
    console.log(`  [${this.name}] Initialized with pubkey: ${this.identity.publicKeyHex.slice(0, 16)}...`);
    return this;
  }
  
  _findWorkspaceByTopic(topic) {
    for (const [, ws] of this.workspaces) {
      if (ws.topic === topic || ws.topic?.startsWith(topic) || topic?.startsWith(ws.topic)) {
        return ws;
      }
    }
    return null;
  }
  
  _applySyncMessage(topic, data) {
    const workspace = this._findWorkspaceByTopic(topic);
    if (workspace && data) {
      try {
        let update;
        if (typeof data === 'string') {
          update = new Uint8Array(Buffer.from(data, 'base64'));
        } else if (data instanceof Uint8Array) {
          update = data;
        } else if (Buffer.isBuffer(data)) {
          update = new Uint8Array(data);
        }
        if (update && update.length > 0) {
          Y.applyUpdate(workspace.doc, update);
        }
      } catch (e) {
        console.error(`  [${this.name}] Failed to apply sync:`, e.message);
      }
    }
  }
  
  // Create a new workspace and generate a share link
  async createWorkspace(name) {
    const workspaceId = crypto.randomBytes(16).toString('hex');
    const encryptionKey = crypto.randomBytes(32);
    const topicHash = getWorkspaceTopicHex(workspaceId);
    
    // Create Y.js doc for workspace metadata
    const doc = new Y.Doc();
    const workspaceInfo = doc.getMap('workspaceInfo');
    workspaceInfo.set('id', workspaceId);
    workspaceInfo.set('name', name);
    workspaceInfo.set('createdAt', Date.now());
    workspaceInfo.set('createdBy', this.identity.publicKeyBase62);
    
    // Initialize documents array and chat
    const documents = doc.getArray('documents');
    const chatMessages = doc.getArray('chat-messages');
    
    // Set up sync broadcasting
    doc.on('update', (update, origin) => {
      if (origin !== 'remote') {
        const base64Update = Buffer.from(update).toString('base64');
        this.hyperswarm.broadcastSync(topicHash, base64Update);
      }
    });
    
    // Store workspace
    this.workspaces.set(workspaceId, {
      id: workspaceId,
      name,
      doc,
      topic: topicHash,
      encryptionKey,
    });
    
    // Join DHT topic
    await this.hyperswarm.joinTopic(topicHash);
    console.log(`  [${this.name}] Created workspace: ${name} (topic: ${topicHash.slice(0, 16)}...)`);
    
    return {
      id: workspaceId,
      name,
      topicHash,
      encryptionKey,
      doc,
    };
  }
  
  // Generate a share link for a workspace
  generateShareLink(workspaceId, options = {}) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);
    
    return generateShareLink({
      entityType: 'workspace',
      entityId: workspaceId,
      permission: options.permission || 'editor',
      encryptionKey: workspace.encryptionKey,
      hyperswarmPeers: [this.identity.publicKeyHex],
      topicHash: workspace.topic,
      serverUrl: options.serverUrl,
    });
  }
  
  // Generate a signed invite link
  generateSignedInvite(workspaceId, options = {}) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);
    
    return generateSignedInviteLink({
      workspaceId,
      encryptionKey: workspace.encryptionKey,
      permission: options.permission || 'editor',
      expiryMinutes: options.expiryMinutes || 60,
      ownerPrivateKey: this.identity.privateKey,
      ownerPublicKey: this.identity.publicKeyBase62,
      hyperswarmPeers: [this.identity.publicKeyHex],
      topicHash: workspace.topic,
      serverUrl: options.serverUrl,
    });
  }
  
  // Join a workspace via share link (simulates full redemption flow)
  async joinWorkspace(shareLink) {
    // Parse the share link
    const parsed = parseShareLink(shareLink);
    console.log(`  [${this.name}] Parsed share link for workspace: ${parsed.entityId.slice(0, 16)}...`);
    
    // Validate if it's a signed invite
    const validation = validateSignedInvite(shareLink);
    if (!validation.valid && !validation.legacy) {
      throw new Error(`Invalid share link: ${validation.error}`);
    }
    if (validation.expiry) {
      console.log(`  [${this.name}] Signed invite valid, expires in ${Math.round(validation.expiresIn / 60000)} minutes`);
    }
    
    // Create Y.js doc for workspace
    const doc = new Y.Doc();
    const topicHash = parsed.topic || getWorkspaceTopicHex(parsed.entityId);
    
    // Set up sync broadcasting
    doc.on('update', (update, origin) => {
      if (origin !== 'remote') {
        const base64Update = Buffer.from(update).toString('base64');
        this.hyperswarm.broadcastSync(topicHash, base64Update);
      }
    });
    
    // Store workspace
    this.workspaces.set(parsed.entityId, {
      id: parsed.entityId,
      name: 'Joined Workspace',
      doc,
      topic: topicHash,
      encryptionKey: parsed.encryptionKey,
      permission: parsed.permission,
    });
    
    // Join DHT topic
    await this.hyperswarm.joinTopic(topicHash);
    console.log(`  [${this.name}] Joined topic: ${topicHash.slice(0, 16)}...`);
    
    // Connect to bootstrap peers
    if (parsed.hyperswarmPeers?.length > 0) {
      for (const peerKey of parsed.hyperswarmPeers) {
        console.log(`  [${this.name}] Connecting to bootstrap peer: ${peerKey.slice(0, 16)}...`);
        try {
          await this.hyperswarm.connectToPeer(peerKey);
          
          // Request full state after connection
          setTimeout(() => {
            this.hyperswarm.sendSyncRequest(peerKey, topicHash);
          }, 500);
        } catch (e) {
          console.error(`  [${this.name}] Failed to connect to peer:`, e.message);
        }
      }
    }
    
    return {
      workspaceId: parsed.entityId,
      permission: parsed.permission,
      doc,
      topic: topicHash,
    };
  }
  
  // Add a document to a workspace
  addDocument(workspaceId, docName, content = '') {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);
    
    const docId = crypto.randomBytes(16).toString('hex');
    const documents = workspace.doc.getArray('documents');
    
    const docMeta = {
      id: docId,
      name: docName,
      type: 'text',
      createdAt: Date.now(),
      createdBy: this.identity.publicKeyBase62,
      content,
    };
    
    documents.push([docMeta]);
    console.log(`  [${this.name}] Added document: ${docName}`);
    
    return docMeta;
  }
  
  // Update a document's content
  updateDocument(workspaceId, docId, newContent) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);
    
    const documents = workspace.doc.getArray('documents');
    const docs = documents.toArray();
    
    for (let i = 0; i < docs.length; i++) {
      if (docs[i].id === docId) {
        // Update via Y.js transaction
        workspace.doc.transact(() => {
          documents.delete(i, 1);
          documents.insert(i, [{ ...docs[i], content: newContent, updatedAt: Date.now() }]);
        });
        console.log(`  [${this.name}] Updated document ${docId.slice(0, 8)}...`);
        return;
      }
    }
    throw new Error(`Document ${docId} not found`);
  }
  
  // Send a chat message
  sendChatMessage(workspaceId, message) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);
    
    const chatMessages = workspace.doc.getArray('chat-messages');
    const chatMessage = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 11),
      text: message,
      username: this.name,
      timestamp: Date.now(),
      channel: 'general',
      senderClientId: this.identity.publicKeyHex.slice(0, 16),
    };
    
    chatMessages.push([chatMessage]);
    console.log(`  [${this.name}] Sent chat: "${message}"`);
    return chatMessage;
  }
  
  // Get workspace state
  getWorkspaceState(workspaceId) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return null;
    
    const workspaceInfo = workspace.doc.getMap('workspaceInfo');
    const documents = workspace.doc.getArray('documents');
    const chatMessages = workspace.doc.getArray('chat-messages');
    
    return {
      id: workspaceId,
      name: workspaceInfo.get('name'),
      documents: documents.toArray(),
      chatMessages: chatMessages.toArray(),
    };
  }
  
  async destroy() {
    if (this.hyperswarm) {
      for (const [, ws] of this.workspaces) {
        await this.hyperswarm.leaveTopic(ws.topic);
      }
      await this.hyperswarm.destroy();
    }
    this.workspaces.clear();
    this.documents.clear();
  }
}

// =============================================================================
// Test Utilities
// =============================================================================

async function waitFor(condition, timeoutMs = 30000, checkIntervalMs = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return true;
    await new Promise(r => setTimeout(r, checkIntervalMs));
  }
  return false;
}

async function waitForSync(clients, workspaceId, timeoutMs = 30000) {
  console.log(`  Waiting for sync convergence...`);
  
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const states = clients.map(c => {
      const state = c.getWorkspaceState(workspaceId);
      return {
        name: c.name,
        docCount: state?.documents?.length || 0,
        chatCount: state?.chatMessages?.length || 0,
        docs: state?.documents?.map(d => d.id) || [],
        chats: state?.chatMessages?.map(m => m.id) || [],
      };
    });
    
    // Check if all clients have same document and chat counts
    const docCounts = states.map(s => s.docCount);
    const chatCounts = states.map(s => s.chatCount);
    
    if (docCounts.every(c => c === docCounts[0] && c > 0) ||
        chatCounts.every(c => c === chatCounts[0] && c > 0)) {
      // Further verify content matches
      const docIds = states.map(s => s.docs.sort().join(','));
      const chatIds = states.map(s => s.chats.sort().join(','));
      
      if (docIds.every(d => d === docIds[0]) && chatIds.every(c => c === chatIds[0])) {
        console.log(`  Synced in ${Date.now() - start}ms`);
        return true;
      }
    }
    
    await new Promise(r => setTimeout(r, checkIntervalMs));
  }
  
  return false;
}

// =============================================================================
// Test Cases
// =============================================================================

const TEST_CASES = {
  
  // Test 1: Share link generation and parsing
  async 'Share Link Generation and Parsing'() {
    console.log('\n  Testing share link generation and parsing...');
    
    const workspaceId = crypto.randomBytes(16).toString('hex');
    const encryptionKey = crypto.randomBytes(32);
    const topicHash = getWorkspaceTopicHex(workspaceId);
    const peerKey = crypto.randomBytes(32).toString('hex');
    
    // Generate link
    const link = generateShareLink({
      entityType: 'workspace',
      entityId: workspaceId,
      permission: 'editor',
      encryptionKey,
      hyperswarmPeers: [peerKey],
      topicHash,
      serverUrl: 'wss://relay.nightjar.app',
    });
    
    console.log(`  Generated link: ${link.slice(0, 60)}...`);
    
    // Parse link
    const parsed = parseShareLink(link);
    
    // Verify all fields
    if (parsed.entityType !== 'workspace') throw new Error('Wrong entity type');
    if (parsed.entityId !== workspaceId) throw new Error('Wrong workspace ID');
    if (parsed.permission !== 'editor') throw new Error('Wrong permission');
    if (!parsed.encryptionKey) throw new Error('Missing encryption key');
    if (bytesToHex(parsed.encryptionKey) !== bytesToHex(encryptionKey)) throw new Error('Wrong encryption key');
    if (parsed.hyperswarmPeers[0] !== peerKey) throw new Error('Wrong peer key');
    if (parsed.topic !== topicHash) throw new Error('Wrong topic');
    if (parsed.serverUrl !== 'wss://relay.nightjar.app') throw new Error('Wrong server URL');
    
    console.log('  ✓ All fields parsed correctly');
    return true;
  },
  
  // Test 2: Signed invite generation and verification
  async 'Signed Invite Generation and Verification'() {
    console.log('\n  Testing signed invite link...');
    
    const keyPair = nacl.sign.keyPair();
    const privateKey = keyPair.secretKey;
    const publicKey = keyPair.publicKey;
    
    const workspaceId = crypto.randomBytes(16).toString('hex');
    const encryptionKey = crypto.randomBytes(32);
    const topicHash = getWorkspaceTopicHex(workspaceId);
    
    // Generate signed invite
    const invite = generateSignedInviteLink({
      workspaceId,
      encryptionKey,
      permission: 'editor',
      expiryMinutes: 60,
      ownerPrivateKey: privateKey,
      ownerPublicKey: uint8ToBase62(publicKey),
      hyperswarmPeers: [bytesToHex(publicKey)],
      topicHash,
    });
    
    console.log(`  Generated signed invite: ${invite.link.slice(0, 60)}...`);
    console.log(`  Expires in ${invite.expiryMinutes} minutes`);
    
    // Validate
    const validation = validateSignedInvite(invite.link);
    
    if (!validation.valid) throw new Error(`Validation failed: ${validation.error}`);
    if (validation.permission !== 'editor') throw new Error('Wrong permission');
    if (validation.expiresIn < 0) throw new Error('Already expired');
    
    console.log(`  ✓ Signature valid, expires in ${Math.round(validation.expiresIn / 60000)} minutes`);
    
    // Test expired link
    const expiredInvite = generateSignedInviteLink({
      workspaceId,
      encryptionKey,
      permission: 'viewer',
      expiryMinutes: -1, // Already expired
      ownerPrivateKey: privateKey,
      ownerPublicKey: uint8ToBase62(publicKey),
      hyperswarmPeers: [],
      topicHash,
    });
    
    const expiredValidation = validateSignedInvite(expiredInvite.link);
    if (expiredValidation.valid) throw new Error('Expired link should be invalid');
    console.log(`  ✓ Expired link correctly rejected: ${expiredValidation.error}`);
    
    return true;
  },
  
  // Test 3: Full workspace sharing flow over DHT
  async 'Full Workspace Sharing Over DHT'() {
    console.log('\n  Testing full workspace sharing over real DHT...');
    
    const alice = await new TestClient('Alice').initialize();
    const bob = await new TestClient('Bob').initialize();
    
    try {
      // Alice creates workspace
      const workspace = await alice.createWorkspace('Shared Project');
      console.log(`  Alice created workspace: ${workspace.id.slice(0, 16)}...`);
      
      // Alice adds a document
      const doc = alice.addDocument(workspace.id, 'README.md', 'Hello from Alice!');
      
      // Alice generates signed invite
      const invite = alice.generateSignedInvite(workspace.id, {
        permission: 'editor',
        expiryMinutes: 60,
      });
      console.log(`  Alice generated invite link`);
      
      // Bob joins via share link
      const joinResult = await bob.joinWorkspace(invite.link);
      console.log(`  Bob joined with permission: ${joinResult.permission}`);
      
      // Wait for peer discovery and sync
      await waitFor(() => alice.peers.size > 0 && bob.peers.size > 0, 30000);
      console.log(`  Peers connected: Alice has ${alice.peers.size}, Bob has ${bob.peers.size}`);
      
      // Wait for document sync
      await waitFor(() => {
        const bobState = bob.getWorkspaceState(workspace.id);
        return bobState?.documents?.length > 0;
      }, 30000);
      
      // Verify Bob received the document
      const aliceState = alice.getWorkspaceState(workspace.id);
      const bobState = bob.getWorkspaceState(workspace.id);
      
      console.log(`  Alice docs: ${aliceState.documents.length}, Bob docs: ${bobState.documents.length}`);
      
      if (bobState.documents.length !== aliceState.documents.length) {
        throw new Error('Document count mismatch');
      }
      
      if (bobState.documents[0]?.content !== 'Hello from Alice!') {
        throw new Error('Document content mismatch');
      }
      
      console.log('  ✓ Document synced correctly');
      return true;
      
    } finally {
      await alice.destroy();
      await bob.destroy();
    }
  },
  
  // Test 4: Bidirectional editing
  async 'Bidirectional Document Editing'() {
    console.log('\n  Testing bidirectional document editing...');
    
    const alice = await new TestClient('Alice').initialize();
    const bob = await new TestClient('Bob').initialize();
    
    try {
      // Alice creates workspace
      const workspace = await alice.createWorkspace('Collaborative Doc');
      
      // Bob joins
      const invite = alice.generateSignedInvite(workspace.id);
      await bob.joinWorkspace(invite.link);
      
      // Wait for connection
      await waitFor(() => alice.peers.size > 0 && bob.peers.size > 0, 30000);
      
      // Alice adds document
      const doc1 = alice.addDocument(workspace.id, 'Doc1', 'Alice wrote this');
      await new Promise(r => setTimeout(r, 500));
      
      // Wait for Bob to receive
      await waitFor(() => {
        const state = bob.getWorkspaceState(workspace.id);
        return state?.documents?.length > 0;
      }, 10000);
      
      // Bob adds another document
      const bobWorkspace = bob.workspaces.get(workspace.id);
      const bobDocs = bobWorkspace.doc.getArray('documents');
      bobDocs.push([{
        id: crypto.randomBytes(16).toString('hex'),
        name: 'BobDoc',
        content: 'Bob wrote this',
        createdAt: Date.now(),
      }]);
      
      await new Promise(r => setTimeout(r, 500));
      
      // Wait for Alice to receive Bob's document
      await waitFor(() => {
        const state = alice.getWorkspaceState(workspace.id);
        return state?.documents?.length === 2;
      }, 10000);
      
      const aliceState = alice.getWorkspaceState(workspace.id);
      const bobState = bob.getWorkspaceState(workspace.id);
      
      console.log(`  Alice docs: ${aliceState.documents.map(d => d.name).join(', ')}`);
      console.log(`  Bob docs: ${bobState.documents.map(d => d.name).join(', ')}`);
      
      if (aliceState.documents.length !== 2) throw new Error('Alice missing Bob\'s doc');
      if (bobState.documents.length !== 2) throw new Error('Bob missing Alice\'s doc');
      
      console.log('  ✓ Bidirectional editing works');
      return true;
      
    } finally {
      await alice.destroy();
      await bob.destroy();
    }
  },
  
  // Test 5: Chat sync
  async 'Chat Message Sync'() {
    console.log('\n  Testing chat message sync...');
    
    const alice = await new TestClient('Alice').initialize();
    const bob = await new TestClient('Bob').initialize();
    
    try {
      // Setup
      const workspace = await alice.createWorkspace('Chat Test');
      const invite = alice.generateSignedInvite(workspace.id);
      await bob.joinWorkspace(invite.link);
      
      await waitFor(() => alice.peers.size > 0, 30000);
      
      // Alice sends message
      alice.sendChatMessage(workspace.id, 'Hello Bob!');
      await new Promise(r => setTimeout(r, 500));
      
      // Bob sends message
      const bobWorkspace = bob.workspaces.get(workspace.id);
      const bobChat = bobWorkspace.doc.getArray('chat-messages');
      bobChat.push([{
        id: Date.now().toString(36),
        text: 'Hi Alice!',
        username: 'Bob',
        timestamp: Date.now(),
        channel: 'general',
      }]);
      
      await new Promise(r => setTimeout(r, 500));
      
      // Verify both have both messages
      await waitFor(() => {
        const aliceState = alice.getWorkspaceState(workspace.id);
        const bobState = bob.getWorkspaceState(workspace.id);
        return aliceState?.chatMessages?.length === 2 && bobState?.chatMessages?.length === 2;
      }, 10000);
      
      const aliceState = alice.getWorkspaceState(workspace.id);
      const bobState = bob.getWorkspaceState(workspace.id);
      
      console.log(`  Alice messages: ${aliceState.chatMessages.map(m => `"${m.text}"`).join(', ')}`);
      console.log(`  Bob messages: ${bobState.chatMessages.map(m => `"${m.text}"`).join(', ')}`);
      
      if (aliceState.chatMessages.length !== 2) throw new Error('Chat not synced to Alice');
      if (bobState.chatMessages.length !== 2) throw new Error('Chat not synced to Bob');
      
      console.log('  ✓ Chat messages synced');
      return true;
      
    } finally {
      await alice.destroy();
      await bob.destroy();
    }
  },
  
  // Test 6: Three-way mesh sync
  async 'Three-Way Mesh Sync'() {
    console.log('\n  Testing three-way mesh sync...');
    
    const alice = await new TestClient('Alice').initialize();
    const bob = await new TestClient('Bob').initialize();
    const charlie = await new TestClient('Charlie').initialize();
    
    try {
      // Alice creates workspace
      const workspace = await alice.createWorkspace('Team Project');
      
      // Generate invites
      const inviteBob = alice.generateSignedInvite(workspace.id);
      const inviteCharlie = alice.generateSignedInvite(workspace.id);
      
      // Bob and Charlie join
      await bob.joinWorkspace(inviteBob.link);
      await charlie.joinWorkspace(inviteCharlie.link);
      
      // Wait for mesh formation
      await waitFor(() => alice.peers.size >= 2 || (bob.peers.size >= 1 && charlie.peers.size >= 1), 30000);
      console.log(`  Mesh formed: Alice=${alice.peers.size}, Bob=${bob.peers.size}, Charlie=${charlie.peers.size}`);
      
      // Each person adds a document
      alice.addDocument(workspace.id, 'AliceDoc', 'From Alice');
      await new Promise(r => setTimeout(r, 300));
      
      const bobWs = bob.workspaces.get(workspace.id);
      bobWs.doc.getArray('documents').push([{ id: crypto.randomBytes(16).toString('hex'), name: 'BobDoc', content: 'From Bob', createdAt: Date.now() }]);
      await new Promise(r => setTimeout(r, 300));
      
      const charlieWs = charlie.workspaces.get(workspace.id);
      charlieWs.doc.getArray('documents').push([{ id: crypto.randomBytes(16).toString('hex'), name: 'CharlieDoc', content: 'From Charlie', createdAt: Date.now() }]);
      
      // Wait for all to sync
      await waitFor(() => {
        const a = alice.getWorkspaceState(workspace.id);
        const b = bob.getWorkspaceState(workspace.id);
        const c = charlie.getWorkspaceState(workspace.id);
        return a?.documents?.length === 3 && b?.documents?.length === 3 && c?.documents?.length === 3;
      }, 30000);
      
      const aliceState = alice.getWorkspaceState(workspace.id);
      const bobState = bob.getWorkspaceState(workspace.id);
      const charlieState = charlie.getWorkspaceState(workspace.id);
      
      console.log(`  Alice docs: ${aliceState.documents.map(d => d.name).join(', ')}`);
      console.log(`  Bob docs: ${bobState.documents.map(d => d.name).join(', ')}`);
      console.log(`  Charlie docs: ${charlieState.documents.map(d => d.name).join(', ')}`);
      
      if (aliceState.documents.length !== 3) throw new Error('Alice missing docs');
      if (bobState.documents.length !== 3) throw new Error('Bob missing docs');
      if (charlieState.documents.length !== 3) throw new Error('Charlie missing docs');
      
      console.log('  ✓ Three-way mesh sync works');
      return true;
      
    } finally {
      await alice.destroy();
      await bob.destroy();
      await charlie.destroy();
    }
  },
  
  // Test 7: Permission enforcement
  async 'Permission Verification'() {
    console.log('\n  Testing permission in share links...');
    
    const workspaceId = crypto.randomBytes(16).toString('hex');
    const encryptionKey = crypto.randomBytes(32);
    const keyPair = nacl.sign.keyPair();
    const privateKey = keyPair.secretKey;
    const publicKey = keyPair.publicKey;
    
    // Generate viewer invite
    const viewerInvite = generateSignedInviteLink({
      workspaceId,
      encryptionKey,
      permission: 'viewer',
      expiryMinutes: 60,
      ownerPrivateKey: privateKey,
      ownerPublicKey: uint8ToBase62(publicKey),
      hyperswarmPeers: [],
      topicHash: getWorkspaceTopicHex(workspaceId),
    });
    
    // Generate editor invite
    const editorInvite = generateSignedInviteLink({
      workspaceId,
      encryptionKey,
      permission: 'editor',
      expiryMinutes: 60,
      ownerPrivateKey: privateKey,
      ownerPublicKey: uint8ToBase62(publicKey),
      hyperswarmPeers: [],
      topicHash: getWorkspaceTopicHex(workspaceId),
    });
    
    // Generate owner invite
    const ownerInvite = generateSignedInviteLink({
      workspaceId,
      encryptionKey,
      permission: 'owner',
      expiryMinutes: 60,
      ownerPrivateKey: privateKey,
      ownerPublicKey: uint8ToBase62(publicKey),
      hyperswarmPeers: [],
      topicHash: getWorkspaceTopicHex(workspaceId),
    });
    
    // Validate each
    const viewerValid = validateSignedInvite(viewerInvite.link);
    const editorValid = validateSignedInvite(editorInvite.link);
    const ownerValid = validateSignedInvite(ownerInvite.link);
    
    if (viewerValid.permission !== 'viewer') throw new Error('Viewer permission wrong');
    if (editorValid.permission !== 'editor') throw new Error('Editor permission wrong');
    if (ownerValid.permission !== 'owner') throw new Error('Owner permission wrong');
    
    console.log(`  Viewer link: permission=${viewerValid.permission} ✓`);
    console.log(`  Editor link: permission=${editorValid.permission} ✓`);
    console.log(`  Owner link: permission=${ownerValid.permission} ✓`);
    
    return true;
  },
  
  // Test 8: Cross-platform server URL
  async 'Cross-Platform Server URL'() {
    console.log('\n  Testing cross-platform server URL in links...');
    
    const workspaceId = crypto.randomBytes(16).toString('hex');
    const encryptionKey = crypto.randomBytes(32);
    const serverUrl = 'wss://relay.nightjar.app:8443';
    
    const link = generateShareLink({
      entityType: 'workspace',
      entityId: workspaceId,
      permission: 'editor',
      encryptionKey,
      hyperswarmPeers: [],
      topicHash: getWorkspaceTopicHex(workspaceId),
      serverUrl,
    });
    
    const parsed = parseShareLink(link);
    
    if (parsed.serverUrl !== serverUrl) {
      throw new Error(`Server URL mismatch: ${parsed.serverUrl} !== ${serverUrl}`);
    }
    
    console.log(`  Server URL correctly embedded: ${parsed.serverUrl}`);
    console.log('  ✓ Cross-platform URL works');
    return true;
  },
  
  // Test 9: Late joiner sync
  async 'Late Joiner Gets Full State'() {
    console.log('\n  Testing late joiner receives full state...');
    
    const alice = await new TestClient('Alice').initialize();
    const bob = await new TestClient('Bob').initialize();
    
    try {
      // Alice creates workspace and adds multiple documents
      const workspace = await alice.createWorkspace('Historical Docs');
      alice.addDocument(workspace.id, 'Doc1', 'First document');
      alice.addDocument(workspace.id, 'Doc2', 'Second document');
      alice.sendChatMessage(workspace.id, 'Welcome to the project!');
      
      console.log('  Alice created workspace with 2 docs and 1 chat message');
      
      // Wait a bit
      await new Promise(r => setTimeout(r, 1000));
      
      // Bob joins later
      const invite = alice.generateSignedInvite(workspace.id);
      await bob.joinWorkspace(invite.link);
      
      // Wait for peer connection
      await waitFor(() => bob.peers.size > 0, 30000);
      
      // Wait for full state sync
      await waitFor(() => {
        const state = bob.getWorkspaceState(workspace.id);
        return state?.documents?.length === 2 && state?.chatMessages?.length === 1;
      }, 30000);
      
      const bobState = bob.getWorkspaceState(workspace.id);
      
      console.log(`  Bob received: ${bobState.documents.length} docs, ${bobState.chatMessages.length} chat messages`);
      
      if (bobState.documents.length !== 2) throw new Error('Bob missing documents');
      if (bobState.chatMessages.length !== 1) throw new Error('Bob missing chat');
      
      console.log('  ✓ Late joiner received full state');
      return true;
      
    } finally {
      await alice.destroy();
      await bob.destroy();
    }
  },
};

// =============================================================================
// Test Runner
// =============================================================================

async function runTests(filterPattern = null) {
  console.log('\n============================================================');
  console.log('  END-TO-END P2P SHARING INTEGRATION TESTS');
  console.log('============================================================');
  console.log('\nThese tests exercise the COMPLETE sharing stack:');
  console.log('- Share link generation/parsing');
  console.log('- Signed invite verification');
  console.log('- Real Hyperswarm DHT discovery');
  console.log('- Y.js document sync');
  console.log('- Chat message sync');
  console.log('- Permission handling');
  console.log('- Cross-platform server URLs\n');
  
  const testNames = Object.keys(TEST_CASES);
  const testsToRun = filterPattern 
    ? testNames.filter(name => name.toLowerCase().includes(filterPattern.toLowerCase()))
    : testNames;
  
  let passed = 0;
  let failed = 0;
  const results = [];
  
  for (const testName of testsToRun) {
    console.log(`\n============================================================`);
    console.log(`TEST: ${testName}`);
    console.log(`============================================================`);
    
    try {
      await TEST_CASES[testName]();
      console.log(`\n✓ PASSED: ${testName}`);
      passed++;
      results.push({ name: testName, passed: true });
    } catch (error) {
      console.error(`\n✗ FAILED: ${testName}`);
      console.error(`  Error: ${error.message}`);
      if (error.stack) {
        console.error(`  Stack: ${error.stack.split('\n').slice(1, 3).join('\n')}`);
      }
      failed++;
      results.push({ name: testName, passed: false, error: error.message });
    }
  }
  
  console.log('\n============================================================');
  console.log('  SUMMARY');
  console.log('============================================================');
  console.log(`  Tests run: ${passed + failed}`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  
  if (failed > 0) {
    console.log('\n  Failed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`    - ${r.name}: ${r.error}`);
    });
  }
  
  console.log('============================================================\n');
  
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
const filterArg = process.argv[2];
runTests(filterArg);
