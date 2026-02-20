/**
 * P2PWebSocketAdapter - WebSocket-compatible interface backed by PeerManager
 * 
 * This adapter presents a standard WebSocket interface (onopen, onmessage, send, close)
 * that can be passed to y-websocket's WebsocketProvider as a polyfill.
 * 
 * Under the hood, it uses PeerManager to route messages through all available
 * transports (WebSocket relay, WebRTC direct, Hyperswarm, mDNS).
 * 
 * Usage:
 *   const adapter = new P2PWebSocketAdapter(peerManager, workspaceId, options);
 *   adapter.connect();
 *   const provider = new WebsocketProvider(url, roomName, ydoc, {
 *     WebSocketPolyfill: () => adapter,
 *   });
 */

import { getPeerManager } from './index.js';
import { MessageTypes } from './protocol/messages.js';

// WebSocket readyState constants
const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

/**
 * P2PWebSocketAdapter
 * 
 * Implements WebSocket interface for y-websocket compatibility while
 * using PeerManager's multi-transport P2P mesh.
 */
export class P2PWebSocketAdapter {
  /**
   * Create a new P2P WebSocket adapter
   * @param {Object} options - Adapter options
   * @param {string} options.workspaceId - Workspace ID to join
   * @param {string} [options.serverUrl] - Server URL for WebSocket relay
   * @param {Array} [options.bootstrapPeers] - Initial peers to connect to
   * @param {Object} [options.identity] - User identity for awareness
   * @param {string} [options.topic] - Topic/room to join (defaults to workspaceId)
   * @param {PeerManager} [options.peerManager] - Existing PeerManager instance
   */
  constructor(options = {}) {
    this.workspaceId = options.workspaceId;
    this.serverUrl = options.serverUrl;
    this.bootstrapPeers = options.bootstrapPeers || [];
    this.identity = options.identity || {};
    this.topic = options.topic || options.workspaceId;
    this.authToken = options.authToken || null;       // Fix 4: HMAC room auth
    this.workspaceKey = options.workspaceKey || null;  // Fix 6: relay encryption key
    
    // Use provided PeerManager or get singleton
    this.peerManager = options.peerManager || null;
    this.ownsManager = !options.peerManager;
    
    // WebSocket interface properties
    this.readyState = CONNECTING;
    this.url = options.serverUrl || `p2p://${this.workspaceId}`;
    this.protocol = '';
    this.extensions = '';
    this.bufferedAmount = 0;
    this.binaryType = 'arraybuffer';
    
    // Event handlers (set by consumer like y-websocket)
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    
    // Registered event listeners (addEventListener API, supports multiple per type)
    this._listeners = new Map(); // type -> Set<handler>
    
    // Internal state
    this._messageHandler = null;
    this._errorHandler = null;
    this._disconnectHandler = null;
    this._messageQueue = [];
    this._isConnecting = false;
    
    // Auto-connect if not explicitly disabled
    if (options.autoConnect !== false) {
      // Defer to allow event handlers to be set
      setTimeout(() => this.connect(), 0);
    }
  }

  /**
   * Connect to P2P network
   */
  async connect() {
    if (this._isConnecting || this.readyState === OPEN) {
      return;
    }
    
    this._isConnecting = true;
    this.readyState = CONNECTING;

    try {
      // Get or create PeerManager
      if (!this.peerManager) {
        this.peerManager = getPeerManager({
          sidecarUrl: this.serverUrl,
        });
      }

      // Initialize if needed
      if (!this.peerManager.isInitialized) {
        await this.peerManager.initialize(this.identity);
      }

      // Setup message handlers
      this._setupHandlers();

      // Join workspace/topic
      await this.peerManager.joinWorkspace(this.workspaceId, {
        serverUrl: this.serverUrl,
        bootstrapPeers: this.bootstrapPeers,
        topic: this.topic,
        authToken: this.authToken,
        workspaceKey: this.workspaceKey,
      });

      // Connection established
      this.readyState = OPEN;
      this._isConnecting = false;

      // Flush queued messages
      while (this._messageQueue.length > 0) {
        const msg = this._messageQueue.shift();
        this._doSend(msg);
      }

      // Notify consumer
      this._dispatch('open', { type: 'open', target: this });

    } catch (error) {
      this._isConnecting = false;
      this.readyState = CLOSED;
      
      console.error('[P2PWebSocketAdapter] Connection failed:', error);
      
      this._dispatch('error', { type: 'error', target: this, error });
      this._dispatch('close', { type: 'close', target: this, code: 1006, reason: error.message });
    }
  }

  /**
   * Setup event handlers on PeerManager
   */
  _setupHandlers() {
    // Remove any previously registered handlers to prevent leaks on reconnect
    this._removeHandlers();

    // Handle sync messages (Yjs updates)
    this._messageHandler = (event) => {
      const { message } = event;
      
      // Only forward SYNC messages to y-websocket
      if (!message || message.type !== MessageTypes.SYNC) {
        return;
      }
      
      // Extract the actual Yjs data
      let data = message.data || message.update || message.payload;
      
      // If it's a sync message with binary data, extract it
      if (message.type === MessageTypes.SYNC && message.data) {
        data = message.data;
      }
      
      // Convert to ArrayBuffer if it's a Uint8Array
      if (data instanceof Uint8Array) {
        data = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      } else if (typeof data === 'string') {
        // Keep as string for text protocol
      } else if (data && typeof data === 'object') {
        // Serialize objects
        data = JSON.stringify(data);
      }
      
      if (data !== undefined) {
        this._dispatch('message', {
          type: 'message',
          target: this,
          data,
          origin: this.url,
        });
      }
    };

    this._errorHandler = (event) => {
      console.error('[P2PWebSocketAdapter] Error:', event.error);
      this._dispatch('error', { type: 'error', target: this, error: event.error });
    };

    this._disconnectHandler = (event) => {
      // Only handle if this affects our workspace
      if (event.workspaceId && event.workspaceId !== this.workspaceId) {
        return;
      }
      
      console.log('[P2PWebSocketAdapter] Disconnected');
      this.readyState = CLOSED;
      
      this._dispatch('close', {
        type: 'close',
        target: this,
        code: 1000,
        reason: 'Peer disconnected',
        wasClean: true,
      });
    };

    // Subscribe to PeerManager events - only 'sync' to avoid duplicate delivery
    this.peerManager.on('sync', this._messageHandler);
    this.peerManager.on('transport-error', this._errorHandler);
    this.peerManager.on('workspace-left', this._disconnectHandler);
  }

  /**
   * Dispatch event to both the on* property handler and all addEventListener listeners
   * @param {string} type - Event type ('open', 'message', 'close', 'error')
   * @param {Object} event - Event object to dispatch
   */
  _dispatch(type, event) {
    // Call the on* property handler
    const propHandler = this[`on${type}`];
    if (propHandler) {
      propHandler(event);
    }
    // Call all addEventListener listeners
    const listeners = this._listeners.get(type);
    if (listeners) {
      for (const listener of listeners) {
        listener(event);
      }
    }
  }

  /**
   * Remove event handlers from PeerManager
   */
  _removeHandlers() {
    if (this.peerManager) {
      if (this._messageHandler) {
        this.peerManager.off('sync', this._messageHandler);
      }
      if (this._errorHandler) {
        this.peerManager.off('transport-error', this._errorHandler);
      }
      if (this._disconnectHandler) {
        this.peerManager.off('workspace-left', this._disconnectHandler);
      }
    }
  }

  /**
   * Send data through P2P network
   * @param {string|ArrayBuffer|Uint8Array} data - Data to send
   */
  send(data) {
    if (this.readyState === CONNECTING) {
      // Queue messages until connected
      this._messageQueue.push(data);
      return;
    }
    
    if (this.readyState !== OPEN) {
      throw new Error('WebSocket is not open');
    }
    
    this._doSend(data);
  }

  /**
   * Actually send the data
   * @private
   */
  _doSend(data) {
    // Convert data to appropriate format
    let messageData = data;
    
    if (data instanceof ArrayBuffer) {
      messageData = new Uint8Array(data);
    } else if (typeof data === 'string') {
      // Try to parse as JSON for structured messages
      try {
        messageData = JSON.parse(data);
      } catch {
        // Keep as string
      }
    }
    
    // Create sync message and broadcast
    const message = {
      type: MessageTypes.SYNC,
      data: messageData,
      timestamp: Date.now(),
    };
    
    this.peerManager.broadcast(message).catch((err) => {
      console.warn('[P2PWebSocketAdapter] Broadcast error:', err);
    });
  }

  /**
   * Close the P2P connection
   * @param {number} [code=1000] - Close code
   * @param {string} [reason=''] - Close reason
   */
  close(code = 1000, reason = '') {
    if (this.readyState === CLOSED || this.readyState === CLOSING) {
      return;
    }
    
    this.readyState = CLOSING;
    
    // Remove handlers
    this._removeHandlers();

    // Clear any queued messages to release memory
    this._messageQueue.length = 0;
    
    // Leave workspace if we own the manager, then dispatch close event
    // after the workspace is actually left to prevent race conditions
    const finishClose = () => {
      this.readyState = CLOSED;
      this._dispatch('close', {
        type: 'close',
        target: this,
        code,
        reason,
        wasClean: true,
      });
    };

    if (this.peerManager && this.ownsManager) {
      this.peerManager.leaveWorkspace().then(finishClose).catch(finishClose);
    } else {
      finishClose();
    }
  }

  /**
   * Add event listener (for compatibility with EventTarget interface)
   */
  addEventListener(type, listener) {
    if (!this._listeners.has(type)) {
      this._listeners.set(type, new Set());
    }
    this._listeners.get(type).add(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(type, listener) {
    const listeners = this._listeners.get(type);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  /**
   * Dispatch event (for compatibility)
   */
  dispatchEvent(event) {
    this._dispatch(event.type, event);
    return true;
  }
}

/**
 * Factory function to create P2PWebSocketAdapter as WebSocket polyfill
 * 
 * Usage with y-websocket:
 *   const provider = new WebsocketProvider(url, roomName, ydoc, {
 *     WebSocketPolyfill: createP2PWebSocketPolyfill({ workspaceId, serverUrl }),
 *   });
 */
export function createP2PWebSocketPolyfill(options) {
  // Get or create the shared PeerManager once so individual adapters don't
  // each think they own (and can destroy) the singleton.
  const sharedManager = options.peerManager || getPeerManager({
    sidecarUrl: options.serverUrl,
  });

  // Return a constructor-like function that creates adapters
  return function P2PWebSocket(url) {
    // Parse URL to extract room/document ID if present
    let workspaceId = options.workspaceId;
    
    // If URL contains path, extract document ID
    try {
      const parsed = new URL(url);
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      if (pathParts.length > 0) {
        // Use last path segment as document ID
        workspaceId = pathParts[pathParts.length - 1] || workspaceId;
      }
    } catch {
      // URL parsing failed, use provided workspaceId
    }
    
    return new P2PWebSocketAdapter({
      ...options,
      workspaceId,
      peerManager: sharedManager,
      url,
    });
  };
}

// Export constants for compatibility
P2PWebSocketAdapter.CONNECTING = CONNECTING;
P2PWebSocketAdapter.OPEN = OPEN;
P2PWebSocketAdapter.CLOSING = CLOSING;
P2PWebSocketAdapter.CLOSED = CLOSED;

export default P2PWebSocketAdapter;
