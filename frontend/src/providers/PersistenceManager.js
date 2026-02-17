/**
 * Workspace Persistence Provider
 * 
 * Handles the choice between:
 * - Pure P2P (no server storage)
 * - Server-assisted persistence (encrypted blobs)
 * 
 * SECURITY: All encryption happens HERE, client-side.
 * Server only ever sees encrypted blobs it cannot decrypt.
 */

import * as Y from 'yjs';

// Encryption using Web Crypto API
const ALGO = { name: 'AES-GCM', length: 256 };

/**
 * Derive workspace encryption key from workspace ID + user secret
 * The server NEVER sees the secret or derived key
 */
export async function deriveWorkspaceKey(workspaceId, userSecret) {
  const encoder = new TextEncoder();
  
  // Import user secret as key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(userSecret),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  // Derive workspace-specific key
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(`Nightjar-workspace-${workspaceId}`),
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    ALGO,
    true,
    ['encrypt', 'decrypt']
  );

  return key;
}

/**
 * Encrypt data for server storage
 */
export async function encryptForServer(key, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  // Prepend IV to ciphertext
  const result = new Uint8Array(iv.length + encrypted.byteLength);
  result.set(iv);
  result.set(new Uint8Array(encrypted), iv.length);
  
  return result;
}

/**
 * Decrypt data from server
 */
export async function decryptFromServer(key, encryptedData) {
  const iv = encryptedData.slice(0, 12);
  const ciphertext = encryptedData.slice(12);
  
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  return new Uint8Array(decrypted);
}

/**
 * Persistence Manager
 * 
 * Connects to unified server and handles encrypted storage
 */
export class PersistenceManager {
  constructor(signalingUrl) {
    this.signalingUrl = signalingUrl;
    this.ws = null;
    this.workspaceKey = null;
    this.workspaceId = null;
    this.persistenceEnabled = false;
    this.pendingRequests = new Map();
    this.onPersistenceChange = null;
  }

  /**
   * Connect to server and join workspace
   */
  async connect(workspaceId, workspaceSecret, options = {}) {
    this.workspaceId = workspaceId;
    
    // Derive encryption key client-side
    if (workspaceSecret) {
      this.workspaceKey = await deriveWorkspaceKey(workspaceId, workspaceSecret);
    }

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.signalingUrl);
      
      this.ws.onopen = () => {
        this.ws.send(JSON.stringify({
          type: 'join',
          roomId: workspaceId,
          profile: options.profile
        }));
      };

      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        this._handleMessage(msg, resolve, reject);
      };

      this.ws.onerror = (err) => reject(err);
      this.ws.onclose = () => {
        // Reconnect logic could go here
      };
    });
  }

  /**
   * Handle incoming server messages
   */
  _handleMessage(msg, resolve, reject) {
    switch (msg.type) {
      case 'joined':
        this.persistenceEnabled = msg.persisted;
        resolve({
          peers: msg.peers,
          persisted: msg.persisted
        });
        break;

      case 'persistence_enabled':
        this.persistenceEnabled = true;
        if (this.onPersistenceChange) {
          this.onPersistenceChange(true);
        }
        break;

      case 'persistence_confirmed':
        this.persistenceEnabled = true;
        break;

      case 'sync_response':
        this._handleSyncResponse(msg);
        break;

      case 'stored':
        // Acknowledge storage
        break;

      case 'error':
        console.error('[Persistence] Server error:', msg.error);
        break;
    }
  }

  /**
   * Enable server persistence for current workspace
   * After this, encrypted data will be stored on server
   */
  enablePersistence() {
    if (!this.ws || !this.workspaceKey) {
      throw new Error('Must have encryption key to enable persistence');
    }

    this.ws.send(JSON.stringify({
      type: 'enable_persistence'
    }));
  }

  /**
   * Store encrypted Yjs state on server
   */
  async storeState(docId, ydoc) {
    if (!this.persistenceEnabled || !this.workspaceKey) return;

    const state = Y.encodeStateAsUpdate(ydoc);
    const encrypted = await encryptForServer(this.workspaceKey, state);
    
    this.ws.send(JSON.stringify({
      type: 'store',
      docId,
      encryptedState: this._toBase64(encrypted)
    }));
  }

  /**
   * Store encrypted Yjs update on server
   */
  async storeUpdate(docId, update) {
    if (!this.persistenceEnabled || !this.workspaceKey) return;

    const encrypted = await encryptForServer(this.workspaceKey, update);
    
    this.ws.send(JSON.stringify({
      type: 'store',
      docId,
      encryptedUpdate: this._toBase64(encrypted)
    }));
  }

  /**
   * Request stored data from server
   */
  async requestSync(docId) {
    if (!this.workspaceKey) {
      return null;
    }

    return new Promise((resolve) => {
      this.pendingRequests.set(docId, resolve);
      
      this.ws.send(JSON.stringify({
        type: 'sync_request',
        docId
      }));

      // Timeout after 5 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(docId)) {
          this.pendingRequests.delete(docId);
          resolve(null);
        }
      }, 5000);
    });
  }

  /**
   * Handle sync response from server
   */
  async _handleSyncResponse(msg) {
    const resolve = this.pendingRequests.get(msg.docId);
    if (!resolve) return;

    this.pendingRequests.delete(msg.docId);

    if (!msg.encryptedState && (!msg.encryptedUpdates || msg.encryptedUpdates.length === 0)) {
      resolve(null);
      return;
    }

    try {
      const updates = [];

      // Decrypt state
      if (msg.encryptedState) {
        const encrypted = this._fromBase64(msg.encryptedState);
        const state = await decryptFromServer(this.workspaceKey, encrypted);
        updates.push(state);
      }

      // Decrypt updates
      if (msg.encryptedUpdates) {
        for (const encUpdate of msg.encryptedUpdates) {
          const encrypted = this._fromBase64(encUpdate);
          const update = await decryptFromServer(this.workspaceKey, encrypted);
          updates.push(update);
        }
      }

      resolve(updates);
    } catch (err) {
      console.error('[Persistence] Decryption failed:', err);
      resolve(null);
    }
  }

  /**
   * Apply stored data to a Yjs doc
   */
  async syncFromServer(docId, ydoc) {
    const updates = await this.requestSync(docId);
    
    if (updates && updates.length > 0) {
      Y.transact(ydoc, () => {
        for (const update of updates) {
          Y.applyUpdate(ydoc, update);
        }
      }, 'server-sync');
      return true;
    }
    
    return false;
  }

  _toBase64(data) {
    let binary = '';
    for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]);
    return btoa(binary);
  }

  _fromBase64(str) {
    return new Uint8Array([...atob(str)].map(c => c.charCodeAt(0)));
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
