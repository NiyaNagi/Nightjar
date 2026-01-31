/**
 * Peer Relay Integration for Nightjar
 * 
 * Combines UPnP, embedded relay server, and Hyperswarm to enable
 * any Electron user to serve as a relay node for others.
 * 
 * This module:
 * 1. Starts the embedded relay server
 * 2. Opens a port via UPnP
 * 3. Publishes the external address to the Hyperswarm DHT
 * 4. Makes the address available for invite links
 */

import { getUPnPManager } from './upnp-manager.js';
import { getRelayServer } from './relay-server.js';
import crypto from 'crypto';

// Well-known topic for relay discovery (SHA256 of "Nightjar-relays-v1")
const RELAY_DISCOVERY_TOPIC = crypto.createHash('sha256').update('Nightjar-relays-v1').digest();

class PeerRelayManager {
  constructor(options = {}) {
    this.upnpManager = null;
    this.relayServer = null;
    this.swarm = null; // Hyperswarm instance (injected)
    
    // Configuration
    this.relayPort = options.relayPort || 4445;
    this.maxConnections = options.maxConnections || 100;
    this.anonymousMode = options.anonymousMode !== false;
    
    // State
    this.isEnabled = false;
    this.externalAddress = null;
    this.discoveredRelays = []; // Other relays discovered via DHT
    
    // Callbacks
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onError = options.onError || ((err) => console.error('[PeerRelay]', err));
    this.onRelaysDiscovered = options.onRelaysDiscovered || (() => {});
  }

  /**
   * Start acting as a relay node
   * @param {Object} swarm - Hyperswarm instance
   * @returns {Promise<{success: boolean, address: string|null}>}
   */
  async start(swarm) {
    if (this.isEnabled) {
      return { success: true, address: this.externalAddress };
    }

    console.log('[PeerRelay] Starting relay mode...');
    this.swarm = swarm;

    try {
      // Step 1: Start the embedded relay server
      this.relayServer = getRelayServer({
        port: this.relayPort,
        maxTotalConnections: this.maxConnections,
        anonymousMode: this.anonymousMode,
        onStatusChange: (status) => this._handleRelayStatus(status),
        onError: (err) => this.onError(err),
      });

      const relayResult = await this.relayServer.start();
      if (!relayResult.success) {
        throw new Error('Failed to start relay server');
      }

      console.log('[PeerRelay] Relay server started on port', this.relayPort);

      // Step 2: Open port via UPnP
      this.upnpManager = getUPnPManager({
        internalPort: this.relayPort,
        externalPort: this.relayPort,
        description: 'Nightjar P2P Relay',
        onStatusChange: (status) => this._handleUPnPStatus(status),
        onError: (err) => this.onError(err),
      });

      const upnpResult = await this.upnpManager.start();
      
      if (upnpResult.success) {
        this.externalAddress = upnpResult.address;
        console.log('[PeerRelay] UPnP mapping successful:', this.externalAddress);
      } else {
        // UPnP failed, but relay is still running locally
        console.warn('[PeerRelay] UPnP failed, relay only available locally');
        console.warn('[PeerRelay] Guide:', upnpResult.error);
        // Continue without external address
      }

      // Step 3: Publish our relay address to DHT (if we have external address)
      if (this.externalAddress && this.swarm) {
        await this._publishToSwarm();
      }

      // Step 4: Discover other relays
      if (this.swarm) {
        await this._discoverRelays();
      }

      this.isEnabled = true;
      this.onStatusChange({
        status: 'active',
        externalAddress: this.externalAddress,
        localPort: this.relayPort,
        upnpEnabled: !!this.externalAddress,
      });

      return { success: true, address: this.externalAddress };

    } catch (error) {
      this.onError(error);
      await this.stop();
      return { success: false, address: null, error: error.message };
    }
  }

  /**
   * Stop relay mode
   */
  async stop() {
    console.log('[PeerRelay] Stopping relay mode...');

    // Stop publishing to DHT
    if (this.swarm && this._discovery) {
      try {
        await this._discovery.destroy();
      } catch (e) {
        // Ignore
      }
      this._discovery = null;
    }

    // Stop UPnP
    if (this.upnpManager) {
      await this.upnpManager.stop();
      this.upnpManager = null;
    }

    // Stop relay server
    if (this.relayServer) {
      await this.relayServer.stop();
      this.relayServer = null;
    }

    this.isEnabled = false;
    this.externalAddress = null;
    this.onStatusChange({ status: 'stopped' });
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      isEnabled: this.isEnabled,
      externalAddress: this.externalAddress,
      localPort: this.relayPort,
      discoveredRelays: this.discoveredRelays,
      relayStats: this.relayServer?.getStatus() || null,
      upnpStatus: this.upnpManager?.getStatus() || null,
    };
  }

  /**
   * Get relay addresses for invite links
   * @returns {Array<string>} List of relay addresses (includes self and discovered)
   */
  getRelayAddresses() {
    const addresses = [];
    
    // Add our own address if available
    if (this.externalAddress) {
      addresses.push(this.externalAddress);
    }
    
    // Add discovered relays
    addresses.push(...this.discoveredRelays);
    
    return addresses;
  }

  /**
   * Connect to specific relay addresses (for joining via invite link)
   * @param {Array<string>} addresses - Array of "ip:port" addresses
   * @returns {Promise<{success: boolean, connectedTo: string|null}>}
   */
  async connectToRelays(addresses) {
    for (const address of addresses) {
      try {
        console.log('[PeerRelay] Trying to connect to relay:', address);
        // Connection is handled by WebRTCProvider - this just validates
        const [host, port] = address.split(':');
        if (host && port && !isNaN(parseInt(port))) {
          return { success: true, connectedTo: address };
        }
      } catch (err) {
        console.warn('[PeerRelay] Failed to connect to relay:', address, err.message);
      }
    }

    return { success: false, connectedTo: null, error: 'All relays offline' };
  }

  // ==========================================================================
  // Private methods
  // ==========================================================================

  _handleRelayStatus(status) {
    console.log('[PeerRelay] Relay status:', status);
  }

  _handleUPnPStatus(status) {
    console.log('[PeerRelay] UPnP status:', status);
  }

  /**
   * Publish our relay address to Hyperswarm DHT
   */
  async _publishToSwarm() {
    if (!this.swarm || !this.externalAddress) return;

    console.log('[PeerRelay] Publishing relay address to DHT...');

    // Join the relay discovery topic as a server
    this._discovery = this.swarm.join(RELAY_DISCOVERY_TOPIC, { server: true, client: false });
    await this._discovery.flushed();

    // Listen for connections on this topic
    this.swarm.on('connection', (socket, peerInfo) => {
      // When a peer connects looking for relays, send our address
      const message = JSON.stringify({
        type: 'relay-address',
        address: this.externalAddress,
        timestamp: Date.now(),
      });
      socket.write(message);
    });

    console.log('[PeerRelay] Published relay address to DHT');
  }

  /**
   * Discover other relays via DHT
   */
  async _discoverRelays() {
    if (!this.swarm) return;

    console.log('[PeerRelay] Discovering other relays via DHT...');

    // Join the relay discovery topic as a client
    const discovery = this.swarm.join(RELAY_DISCOVERY_TOPIC, { server: false, client: true });
    
    this.swarm.on('connection', (socket, peerInfo) => {
      socket.on('data', (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'relay-address' && message.address) {
            // Add to discovered relays if not already known
            if (!this.discoveredRelays.includes(message.address) && 
                message.address !== this.externalAddress) {
              this.discoveredRelays.push(message.address);
              console.log('[PeerRelay] Discovered relay:', message.address);
              this.onRelaysDiscovered(this.discoveredRelays);
            }
          }
        } catch (e) {
          // Ignore non-relay messages
        }
      });
    });

    await discovery.flushed();
  }
}

// Export singleton and class
let instance = null;

export function getPeerRelayManager(options) {
  if (!instance) {
    instance = new PeerRelayManager(options);
  }
  return instance;
}

export { PeerRelayManager, RELAY_DISCOVERY_TOPIC };
export default PeerRelayManager;
