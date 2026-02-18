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
const { docs, getYDoc } = require('y-websocket/bin/utils');
const awarenessProtocol = require('y-protocols/awareness');

// Lazy-load socks-proxy-agent (only needed when Tor is enabled)
let SocksProxyAgent = null;
function getSocksProxyAgent(proxyUrl) {
  if (!SocksProxyAgent) {
    try {
      SocksProxyAgent = require('socks-proxy-agent').SocksProxyAgent;
    } catch (err) {
      console.warn('[RelayBridge] socks-proxy-agent not available, Tor routing disabled');
      return null;
    }
  }
  return new SocksProxyAgent(proxyUrl);
}
const { BOOTSTRAP_NODES, DEV_BOOTSTRAP_NODES } = require('./mesh-constants');

// RELAY_OVERRIDE allows tests to specify a custom relay URL
const RELAY_OVERRIDE = process.env.RELAY_OVERRIDE;

// Use development nodes if not in production, but prefer RELAY_OVERRIDE if set
const RELAY_NODES = RELAY_OVERRIDE 
  ? [RELAY_OVERRIDE] 
  : (process.env.NODE_ENV === 'development' ? DEV_BOOTSTRAP_NODES : BOOTSTRAP_NODES);

if (RELAY_OVERRIDE) {
  console.log(`[RelayBridge] Using RELAY_OVERRIDE: ${RELAY_OVERRIDE}`);
}

// Exponential backoff configuration
const BACKOFF_INITIAL_DELAY = 1000; // Start with 1 second
const BACKOFF_MAX_DELAY = 60000; // Max 60 seconds
const BACKOFF_MULTIPLIER = 2; // Double each time
const BACKOFF_JITTER = 0.3; // 30% jitter

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
    
    // Retry attempt counters for exponential backoff: roomName -> attemptCount
    this.retryAttempts = new Map();
    
    // Reconnecting flag per room to prevent duplicate reconnect scheduling
    this.reconnecting = new Set();
    
    // SOCKS proxy URL for Tor routing (set externally when Tor is enabled)
    this.socksProxy = null;
    
    // Event handlers
    this.onStatusChange = null;
  }

  /**
   * Calculate exponential backoff delay with jitter
   * @param {number} attempt - Current attempt number (0-based)
   * @returns {number} Delay in milliseconds
   * @private
   */
  _calculateBackoffDelay(attempt) {
    // Calculate base delay with exponential backoff
    const baseDelay = Math.min(
      BACKOFF_INITIAL_DELAY * Math.pow(BACKOFF_MULTIPLIER, attempt),
      BACKOFF_MAX_DELAY
    );
    
    // Add jitter (random value between -jitter% and +jitter%)
    const jitterRange = baseDelay * BACKOFF_JITTER;
    const jitter = (Math.random() * 2 - 1) * jitterRange;
    
    return Math.round(baseDelay + jitter);
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

    // If no relay nodes are configured, skip silently (direct P2P only)
    const relays = relayUrl ? [relayUrl] : [...RELAY_NODES];
    if (relays.length === 0) {
      console.log(`[RelayBridge] No relay nodes configured, using direct P2P only`);
      return;
    }

    this.pending.add(roomName);

    // Try relay nodes in order
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
    // Graceful degradation: relay is unreachable, continue with direct Hyperswarm P2P
    console.warn(`[RelayBridge] All relay nodes unreachable for ${roomName} — falling back to direct P2P`);
    
    // Schedule a background retry so we auto-connect when relay comes online
    if (relays.length > 0) {
      this._scheduleReconnect(roomName, ydoc, relays[0]);
    }
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
      
      // Route through Tor SOCKS proxy if available
      const wsOptions = {};
      if (this.socksProxy) {
        const agent = getSocksProxyAgent(this.socksProxy);
        if (agent) {
          wsOptions.agent = agent;
          console.log(`[RelayBridge] Routing through Tor: ${this.socksProxy}`);
        }
      }
      
      const ws = new WebSocket(wsUrl, wsOptions);
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
        
        // Reset retry counter on successful connection
        this.retryAttempts.delete(roomName);
        
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
          // Clean up connection on error (same as close handler)
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
    
    // Get awareness from WSSharedDoc (if available)
    // WSSharedDoc from y-websocket/bin/utils has awareness attached
    const awareness = ydoc.awareness;
    
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
              // Validate update size to prevent malformed updates from corrupting Yjs documents
              const MAX_UPDATE_SIZE = 10 * 1024 * 1024; // 10MB max update size
              if (update.length > MAX_UPDATE_SIZE) {
                console.warn(`[RelayBridge] Rejecting oversized update (${update.length} bytes) for ${roomName}`);
                break;
              }
              try {
                Y.applyUpdate(ydoc, update, 'relay');
              } catch (applyErr) {
                console.error(`[RelayBridge] Failed to apply update for ${roomName}:`, applyErr.message);
                // Don't propagate corrupted updates - just log and continue
              }
            }
            break;
            
          case 3: // awareness
            // Apply incoming awareness updates from relay to local awareness
            if (awareness) {
              try {
                const awarenessUpdate = decoding.readVarUint8Array(decoder);
                awarenessProtocol.applyAwarenessUpdate(awareness, awarenessUpdate, 'relay');
              } catch (awarenessErr) {
                console.error(`[RelayBridge] Failed to apply awareness update for ${roomName}:`, awarenessErr.message);
              }
            }
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
    
    // Send our current awareness state
    if (awareness) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, 3); // awareness message
      encoding.writeVarUint8Array(awarenessEncoder, 
        awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID])
      );
      ws.send(encoding.toUint8Array(awarenessEncoder));
    }
    
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
    
    // Forward local awareness changes to relay
    const awarenessHandler = ({ added, updated, removed }, origin) => {
      if (origin === 'relay') return; // Don't echo relay awareness back
      
      const changedClients = added.concat(updated).concat(removed);
      if (changedClients.length === 0) return;
      
      if (ws.readyState === WebSocket.OPEN) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 3); // awareness message
        encoding.writeVarUint8Array(encoder, 
          awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
        );
        ws.send(encoding.toUint8Array(encoder));
      }
    };
    
    if (awareness) {
      awareness.on('update', awarenessHandler);
    }
    
    // Store handlers for cleanup (store awareness reference directly to avoid stale refs)
    const conn = this.connections.get(roomName);
    if (conn) {
      conn.updateHandler = updateHandler;
      conn.awarenessHandler = awarenessHandler;
      conn.awareness = awareness;
    } else {
      // Connection was removed during setup — unbind handlers to prevent leaks
      ydoc.off('update', updateHandler);
      if (awareness) {
        awareness.off('update', awarenessHandler);
      }
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
    
    // Clean up awareness handler (use stored awareness ref to avoid stale ydoc.awareness)
    if (conn.awarenessHandler && conn.awareness) {
      conn.awareness.off('update', conn.awarenessHandler);
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
   * Schedule reconnection attempt with exponential backoff
   * @private
   */
  _scheduleReconnect(roomName, ydoc, relayUrl) {
    // Prevent duplicate reconnect scheduling from rapid disconnects
    if (this.reconnecting.has(roomName)) {
      console.log(`[RelayBridge] Reconnect already scheduled for ${roomName}, skipping duplicate`);
      return;
    }
    
    // Clear any existing retry timeout
    if (this.retryTimeouts.has(roomName)) {
      clearTimeout(this.retryTimeouts.get(roomName));
    }
    
    this.reconnecting.add(roomName);
    
    // Get current attempt count and calculate delay
    const attempt = this.retryAttempts.get(roomName) || 0;
    const delay = this._calculateBackoffDelay(attempt);
    
    console.log(`[RelayBridge] Scheduling reconnect for ${roomName} in ${delay}ms (attempt ${attempt + 1})`);
    
    const timeout = setTimeout(() => {
      this.retryTimeouts.delete(roomName);
      this.reconnecting.delete(roomName);
      
      // Only reconnect if doc still exists
      if (docs.has(roomName)) {
        const freshDoc = docs.get(roomName);
        console.log(`[RelayBridge] Attempting reconnect for ${roomName} (attempt ${attempt + 1})...`);
        this.connect(roomName, freshDoc, relayUrl)
          .then(() => {
            // Reset retry counter on successful connection
            this.retryAttempts.delete(roomName);
            console.log(`[RelayBridge] Reconnect successful for ${roomName}, reset backoff`);
          })
          .catch(err => {
            console.error(`[RelayBridge] Reconnect failed for ${roomName}:`, err.message);
            // Increment attempt counter for next retry
            this.retryAttempts.set(roomName, attempt + 1);
          });
      } else {
        // Doc no longer exists, clean up retry state
        this.retryAttempts.delete(roomName);
      }
    }, delay);
    
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
    
    // Clear retry attempt counter and reconnecting flag
    this.retryAttempts.delete(roomName);
    this.reconnecting.delete(roomName);
    
    const conn = this.connections.get(roomName);
    if (!conn) return;
    
    // Clean up update handler
    if (conn.updateHandler && conn.ydoc) {
      conn.ydoc.off('update', conn.updateHandler);
    }
    
    // Clean up awareness handler (use stored awareness ref to avoid stale ydoc.awareness)
    if (conn.awarenessHandler && conn.awareness) {
      conn.awareness.off('update', conn.awarenessHandler);
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
    this.retryAttempts.clear();
    this.reconnecting.clear();
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
