/**
 * Relay Bridge - Connects local Yjs docs to public relay servers
 * 
 * This enables zero-config cross-platform sharing:
 * - When a workspace is shared, the sidecar connects to a public relay
 * - Yjs updates are synced bidirectionally between local and relay
 * - Web clients connecting to the relay receive the same updates
 * 
 * This works like BitTorrent trackers - the relay acts as a rendezvous point
 * for peers that can't connect directly.
 */

const WebSocket = require('ws');
const Y = require('yjs');
const { docs } = require('y-websocket/bin/utils');
const { BOOTSTRAP_NODES, DEV_BOOTSTRAP_NODES } = require('./mesh-constants');

// Use development nodes if not in production
const RELAY_NODES = process.env.NODE_ENV === 'development' ? DEV_BOOTSTRAP_NODES : BOOTSTRAP_NODES;

/**
 * RelayBridge - Manages connections to public relay servers
 */
class RelayBridge {
  constructor() {
    // Active relay connections: roomName -> { ws, ydoc, provider, status }
    this.connections = new Map();
    
    // Pending connections (waiting for relay)
    this.pending = new Set();
    
    // Connection retry state
    this.retryTimeouts = new Map();
    
    // Event handlers
    this.onStatusChange = null;
  }

  /**
   * Connect a local Yjs doc to the public relay
   * @param {string} roomName - The room name (e.g., 'workspace-meta:abc123')
   * @param {Y.Doc} ydoc - The local Yjs document
   * @param {string} [relayUrl] - Optional specific relay URL (defaults to first available)
   */
  async connect(roomName, ydoc, relayUrl = null) {
    // Already connected?
    if (this.connections.has(roomName)) {
      console.log(`[RelayBridge] Already connected to relay for ${roomName}`);
      return;
    }

    // Already pending?
    if (this.pending.has(roomName)) {
      console.log(`[RelayBridge] Connection already pending for ${roomName}`);
      return;
    }

    this.pending.add(roomName);

    // Try relay nodes in order
    const relays = relayUrl ? [relayUrl] : [...RELAY_NODES];
    
    for (const relay of relays) {
      try {
        await this._connectToRelay(roomName, ydoc, relay);
        this.pending.delete(roomName);
        return;
      } catch (err) {
        console.warn(`[RelayBridge] Failed to connect to ${relay}: ${err.message}`);
      }
    }

    this.pending.delete(roomName);
    console.error(`[RelayBridge] Failed to connect to any relay for ${roomName}`);
  }

  /**
   * Connect to a specific relay
   * @private
   */
  _connectToRelay(roomName, ydoc, relayUrl) {
    return new Promise((resolve, reject) => {
      console.log(`[RelayBridge] Connecting to ${relayUrl} for ${roomName}...`);
      
      // Build WebSocket URL with room name
      // The relay server uses y-websocket protocol: ws://host/roomName
      const wsUrl = relayUrl.endsWith('/') ? `${relayUrl}${roomName}` : `${relayUrl}/${roomName}`;
      
      const ws = new WebSocket(wsUrl);
      let connected = false;
      
      const connectionTimeout = setTimeout(() => {
        if (!connected) {
          ws.terminate();
          reject(new Error('Connection timeout'));
        }
      }, 10000);

      ws.on('open', () => {
        connected = true;
        clearTimeout(connectionTimeout);
        console.log(`[RelayBridge] ✓ Connected to relay for ${roomName}`);
        
        // Store connection
        this.connections.set(roomName, {
          ws,
          ydoc,
          relayUrl,
          status: 'connected',
          connectedAt: Date.now(),
        });
        
        // Set up Yjs sync
        this._setupSync(roomName, ws, ydoc);
        
        if (this.onStatusChange) {
          this.onStatusChange(roomName, 'connected');
        }
        
        resolve();
      });

      ws.on('error', (err) => {
        clearTimeout(connectionTimeout);
        if (!connected) {
          reject(err);
        } else {
          console.error(`[RelayBridge] WebSocket error for ${roomName}:`, err.message);
          this._handleDisconnect(roomName);
        }
      });

      ws.on('close', () => {
        clearTimeout(connectionTimeout);
        if (connected) {
          console.log(`[RelayBridge] Connection closed for ${roomName}`);
          this._handleDisconnect(roomName);
        }
      });
    });
  }

  /**
   * Set up Yjs sync protocol over WebSocket
   * @private
   */
  _setupSync(roomName, ws, ydoc) {
    // y-websocket protocol uses binary messages
    // Message format: [messageType, ...data]
    // messageType 0 = sync step 1
    // messageType 1 = sync step 2
    // messageType 2 = update
    // messageType 3 = awareness
    
    const encoding = require('lib0/encoding');
    const decoding = require('lib0/decoding');
    const syncProtocol = require('y-protocols/sync');
    
    // Track sync state
    let synced = false;
    
    // Handle incoming messages
    ws.on('message', (data) => {
      try {
        const decoder = decoding.createDecoder(new Uint8Array(data));
        const messageType = decoding.readVarUint(decoder);
        
        switch (messageType) {
          case 0: // sync step 1
          case 1: // sync step 2
            {
              const encoder = encoding.createEncoder();
              const syncMessageType = syncProtocol.readSyncMessage(decoder, encoder, ydoc, null);
              
              if (syncMessageType === 1) {
                synced = true;
                console.log(`[RelayBridge] ✓ Synced with relay for ${roomName}`);
              }
              
              if (encoding.length(encoder) > 0) {
                ws.send(encoding.toUint8Array(encoder));
              }
            }
            break;
            
          case 2: // update
            {
              const update = decoding.readVarUint8Array(decoder);
              Y.applyUpdate(ydoc, update, 'relay');
            }
            break;
            
          case 3: // awareness
            // Awareness updates - we can ignore these for now
            break;
        }
      } catch (err) {
        console.error(`[RelayBridge] Error processing message for ${roomName}:`, err.message);
      }
    });
    
    // Send initial sync step 1
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0); // sync step 1
    syncProtocol.writeSyncStep1(encoder, ydoc);
    ws.send(encoding.toUint8Array(encoder));
    
    // Forward local updates to relay
    const updateHandler = (update, origin) => {
      if (origin === 'relay') return; // Don't echo relay updates back
      
      if (ws.readyState === WebSocket.OPEN) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 2); // update message
        encoding.writeVarUint8Array(encoder, update);
        ws.send(encoding.toUint8Array(encoder));
      }
    };
    
    ydoc.on('update', updateHandler);
    
    // Store handler for cleanup
    const conn = this.connections.get(roomName);
    if (conn) {
      conn.updateHandler = updateHandler;
    }
  }

  /**
   * Handle disconnection from relay
   * @private
   */
  _handleDisconnect(roomName) {
    const conn = this.connections.get(roomName);
    if (!conn) return;
    
    // Clean up update handler
    if (conn.updateHandler && conn.ydoc) {
      conn.ydoc.off('update', conn.updateHandler);
    }
    
    // Close WebSocket if still open
    if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.close();
    }
    
    this.connections.delete(roomName);
    
    if (this.onStatusChange) {
      this.onStatusChange(roomName, 'disconnected');
    }
    
    // Schedule reconnect
    this._scheduleReconnect(roomName, conn.ydoc, conn.relayUrl);
  }

  /**
   * Schedule reconnection attempt
   * @private
   */
  _scheduleReconnect(roomName, ydoc, relayUrl) {
    // Clear any existing retry timeout
    if (this.retryTimeouts.has(roomName)) {
      clearTimeout(this.retryTimeouts.get(roomName));
    }
    
    // Retry after 5 seconds
    const timeout = setTimeout(() => {
      this.retryTimeouts.delete(roomName);
      
      // Only reconnect if doc still exists
      if (docs.has(roomName)) {
        console.log(`[RelayBridge] Attempting reconnect for ${roomName}...`);
        this.connect(roomName, ydoc, relayUrl).catch(err => {
          console.error(`[RelayBridge] Reconnect failed for ${roomName}:`, err.message);
        });
      }
    }, 5000);
    
    this.retryTimeouts.set(roomName, timeout);
  }

  /**
   * Disconnect from relay for a specific room
   * @param {string} roomName - The room name
   */
  disconnect(roomName) {
    // Clear any pending retry
    if (this.retryTimeouts.has(roomName)) {
      clearTimeout(this.retryTimeouts.get(roomName));
      this.retryTimeouts.delete(roomName);
    }
    
    const conn = this.connections.get(roomName);
    if (!conn) return;
    
    // Clean up update handler
    if (conn.updateHandler && conn.ydoc) {
      conn.ydoc.off('update', conn.updateHandler);
    }
    
    // Close WebSocket
    if (conn.ws) {
      conn.ws.close();
    }
    
    this.connections.delete(roomName);
    console.log(`[RelayBridge] Disconnected from relay for ${roomName}`);
  }

  /**
   * Disconnect all relay connections
   */
  disconnectAll() {
    for (const roomName of this.connections.keys()) {
      this.disconnect(roomName);
    }
    this.pending.clear();
  }

  /**
   * Get connection status for a room
   * @param {string} roomName - The room name
   * @returns {object|null} Connection status or null if not connected
   */
  getStatus(roomName) {
    const conn = this.connections.get(roomName);
    if (!conn) return null;
    
    return {
      status: conn.status,
      relayUrl: conn.relayUrl,
      connectedAt: conn.connectedAt,
      uptime: Date.now() - conn.connectedAt,
    };
  }

  /**
   * Get all connection statuses
   * @returns {object} Map of room names to statuses
   */
  getAllStatuses() {
    const statuses = {};
    for (const [roomName, conn] of this.connections) {
      statuses[roomName] = {
        status: conn.status,
        relayUrl: conn.relayUrl,
        connectedAt: conn.connectedAt,
        uptime: Date.now() - conn.connectedAt,
      };
    }
    return statuses;
  }
}

// Singleton instance
const relayBridge = new RelayBridge();

module.exports = {
  RelayBridge,
  relayBridge,
};
