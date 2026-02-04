/**
 * WebSocket client for sidecar metadata protocol
 */
const WebSocket = require('ws');

class SidecarClient {
  constructor(url, name = 'sidecar') {
    this.url = url;
    this.name = name;
    this.ws = null;
    this.messageQueue = [];
    this.connected = false;
    this.log('Created client for', url);
  }

  log(...args) {
    console.log(`[SidecarClient:${this.name}]`, ...args);
  }

  async connect(timeout = 30000) {
    this.log('Connecting to', this.url, '(timeout:', timeout, 'ms)');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.log('ERROR: Connection timeout after', timeout, 'ms');
        reject(new Error(`Connection timeout after ${timeout}ms`));
      }, timeout);

      this.ws = new WebSocket(this.url);

      this.ws.on('open', () => {
        clearTimeout(timer);
        this.connected = true;
        this.log('Connected successfully!');
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.log('Received message:', msg.type, JSON.stringify(msg).substring(0, 100));
          this.messageQueue.push(msg);
        } catch (e) {
          this.log('ERROR: Failed to parse message:', e.message, 'data:', data.toString().substring(0, 100));
        }
      });

      this.ws.on('error', (err) => {
        this.log('ERROR: WebSocket error:', err.message);
        clearTimeout(timer);
        reject(err);
      });

      this.ws.on('close', (code, reason) => {
        this.log('WebSocket closed, code:', code, 'reason:', reason?.toString());
        this.connected = false;
      });
    });
  }

  async disconnect() {
    if (this.ws && this.connected) {
      this.ws.close();
      this.connected = false;
    }
  }

  send(message) {
    if (!this.connected) {
      this.log('ERROR: Attempted to send while not connected');
      throw new Error('Not connected to sidecar');
    }
    this.log('Sending:', message.type, JSON.stringify(message).substring(0, 100));
    this.ws.send(JSON.stringify(message));
  }

  async waitForMessage(predicate, timeout = 30000) {
    const start = Date.now();
    this.log('Waiting for message (timeout:', timeout, 'ms), queue size:', this.messageQueue.length);
    
    // Check existing queue first
    const idx = this.messageQueue.findIndex(predicate);
    if (idx !== -1) {
      const msg = this.messageQueue.splice(idx, 1)[0];
      this.log('Found message in queue:', msg.type);
      return msg;
    }

    // Wait for new messages
    let lastLogTime = start;
    while (Date.now() - start < timeout) {
      await new Promise(r => setTimeout(r, 100));
      const idx = this.messageQueue.findIndex(predicate);
      if (idx !== -1) {
        const msg = this.messageQueue.splice(idx, 1)[0];
        this.log('Received expected message after', Date.now() - start, 'ms:', msg.type);
        return msg;
      }
      // Log progress every 5 seconds
      if (Date.now() - lastLogTime > 5000) {
        this.log('Still waiting... elapsed:', Date.now() - start, 'ms, queue:', this.messageQueue.map(m => m.type).join(','));
        lastLogTime = Date.now();
      }
    }

    this.log('ERROR: Timeout! Queue contents:', this.messageQueue.map(m => m.type).join(', '));
    throw new Error(`Timeout waiting for message after ${timeout}ms. Queue had: ${this.messageQueue.map(m => m.type).join(', ')}`);
  }

  async sendAndWait(message, responseType, timeout = 30000) {
    this.send(message);
    return this.waitForMessage(m => m.type === responseType, timeout);
  }

  // Workspace operations
  async listWorkspaces() {
    return this.sendAndWait({ type: 'list-workspaces' }, 'workspace-list');
  }

  async createWorkspace(data) {
    // Sidecar expects workspace data in 'workspace' property
    return this.sendAndWait({ type: 'create-workspace', workspace: data }, 'workspace-created');
  }

  async updateWorkspace(data) {
    return this.sendAndWait({ type: 'update-workspace', workspace: data }, 'workspace-updated');
  }

  async deleteWorkspace(workspaceId) {
    // Sidecar expects 'workspaceId' property
    return this.sendAndWait({ type: 'delete-workspace', workspaceId }, 'workspace-deleted');
  }

  async joinWorkspace(data) {
    // Sidecar expects workspace data in 'workspace' property
    return this.sendAndWait({ type: 'join-workspace', workspace: data }, 'workspace-joined');
  }

  // Document operations
  async listDocuments(workspaceId) {
    return this.sendAndWait({ type: 'list-documents', workspaceId }, 'document-list');
  }

  async createDocument(data) {
    // Sidecar expects document data in 'document' property
    return this.sendAndWait({ type: 'create-document', document: data }, 'document-created');
  }

  async deleteDocument(docId) {
    // Sidecar expects 'docId' property
    return this.sendAndWait({ type: 'delete-document', docId }, 'document-deleted');
  }

  async moveDocumentToFolder(documentId, folderId) {
    return this.sendAndWait(
      { type: 'move-document-to-folder', documentId, folderId },
      'document-moved'
    );
  }

  // Folder operations
  async listFolders(workspaceId) {
    return this.sendAndWait({ type: 'list-folders', workspaceId }, 'folder-list');
  }

  async createFolder(data) {
    // Sidecar expects folder data in 'folder' property
    return this.sendAndWait({ type: 'create-folder', folder: data }, 'folder-created');
  }

  async updateFolder(data) {
    return this.sendAndWait({ type: 'update-folder', folder: data }, 'folder-updated');
  }

  async deleteFolder(folderId) {
    // Sidecar expects 'folderId' property
    return this.sendAndWait({ type: 'delete-folder', folderId }, 'folder-deleted');
  }

  // Trash operations
  async trashDocument(docId) {
    return this.sendAndWait({ type: 'trash-document', docId }, 'document-trashed');
  }

  async restoreDocument(docId) {
    return this.sendAndWait({ type: 'restore-document', docId }, 'document-restored');
  }

  async permanentDeleteDocument(docId) {
    return this.sendAndWait({ type: 'permanent-delete-document', docId }, 'document-permanently-deleted');
  }

  async trashFolder(folderId) {
    return this.sendAndWait({ type: 'trash-folder', folderId }, 'folder-trashed');
  }

  async restoreFolder(folderId) {
    return this.sendAndWait({ type: 'restore-folder', folderId }, 'folder-restored');
  }

  async permanentDeleteFolder(folderId) {
    return this.sendAndWait({ type: 'permanent-delete-folder', folderId }, 'folder-permanently-deleted');
  }

  async listTrashed(workspaceId) {
    return this.sendAndWait({ type: 'list-trashed', workspaceId }, 'trashed-list');
  }

  // Workspace member operations
  async leaveWorkspace(workspaceId) {
    return this.sendAndWait({ type: 'leave-workspace', workspaceId }, 'workspace-left');
  }

  // Encryption operations
  async setEncryptionKey(entityId, key) {
    return this.sendAndWait({ type: 'set-encryption-key', entityId, key }, 'encryption-key-set');
  }

  // P2P operations
  async getStatus() {
    return this.sendAndWait({ type: 'get-status' }, 'status');
  }

  async getP2PInfo() {
    return this.sendAndWait({ type: 'get-p2p-info' }, 'p2p-info');
  }

  async toggleTor(enabled) {
    return this.sendAndWait({ type: 'toggle-tor', enabled }, 'tor-status');
  }

  async getMeshStatus() {
    return this.sendAndWait({ type: 'get-mesh-status' }, 'mesh-status');
  }

  async validateRelay(url) {
    return this.sendAndWait({ type: 'validate-relay', url }, 'relay-validated');
  }

  // Identity operations
  async listIdentities() {
    return this.sendAndWait({ type: 'list-identities' }, 'identity-list');
  }

  async switchIdentity(identityId) {
    return this.sendAndWait({ type: 'switch-identity', identityId }, 'identity-switched');
  }

  // Document update operations
  async updateDocument(data) {
    return this.sendAndWait({ type: 'update-document', document: data }, 'document-updated');
  }

  async updateDocumentMetadata(docId, metadata) {
    return this.sendAndWait({ type: 'update-document-metadata', docId, metadata }, 'document-metadata-updated');
  }

  // Utility - wait for any message without sending
  async waitForAnyMessage(timeout = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (this.messageQueue.length > 0) {
        return this.messageQueue.shift();
      }
      await new Promise(r => setTimeout(r, 100));
    }
    return null;
  }

  // Clear message queue (useful between tests)
  clearQueue() {
    this.messageQueue = [];
  }
}

module.exports = { SidecarClient };
