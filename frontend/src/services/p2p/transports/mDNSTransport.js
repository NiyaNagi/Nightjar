/**
 * mDNSTransport - Local network peer discovery
 * 
 * Only available in Electron. Uses mDNS/Bonjour for
 * discovering peers on the local network.
 */

import { BaseTransport } from './BaseTransport.js';
import { encodeMessage, decodeMessage } from '../protocol/serialization.js';

export class mDNSTransport extends BaseTransport {
  constructor() {
    super('mdns');
    this.socket = null;
    this.sidecarUrl = 'ws://localhost:8081';
    this.serviceName = 'nightjar-p2p';
    this.discoveredPeers = new Map();
    this.isElectron = false;
    this.isAdvertising = false;
  }

  /**
   * Check if mDNS is available (Electron only)
   */
  static isAvailable() {
    if (typeof window === 'undefined') return false;
    return window.electronAPI !== undefined;
  }

  /**
   * Initialize mDNS discovery
   */
  async initialize(config) {
    const { peerId, sidecarUrl, port, identity } = config;
    this.localPeerId = peerId;
    this.port = port || 8080;
    this.identity = identity;
    
    if (sidecarUrl) {
      this.sidecarUrl = sidecarUrl;
    }

    this.isElectron = mDNSTransport.isAvailable();
    
    if (!this.isElectron) {
      console.log('[mDNSTransport] Not in Electron, transport disabled');
      return;
    }

    try {
      await this._connectToSidecar();
      await this._startDiscovery();
      this.connected = true;
    } catch (error) {
      console.warn('[mDNSTransport] Failed to initialize:', error.message);
    }
  }

  /**
   * Connect to sidecar for mDNS operations
   */
  async _connectToSidecar() {
    return new Promise((resolve, reject) => {
      try {
        this.socket = new WebSocket(this.sidecarUrl);

        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 5000);

        this.socket.onopen = () => {
          clearTimeout(timeout);
          console.log('[mDNSTransport] Connected to sidecar');
          this._setupSocketHandlers();
          resolve();
        };

        this.socket.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('Connection error'));
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Setup sidecar socket handlers
   */
  _setupSocketHandlers() {
    this.socket.onmessage = (event) => {
      const message = decodeMessage(event.data);
      if (!message) return;

      switch (message.type) {
        case 'mdns-peer-discovered':
          this._handlePeerDiscovered(message);
          break;

        case 'mdns-peer-removed':
          this._handlePeerRemoved(message);
          break;

        case 'mdns-advertise-started':
          this.isAdvertising = true;
          console.log('[mDNSTransport] Advertising started');
          break;

        case 'mdns-error':
          console.error('[mDNSTransport] Error:', message.message);
          break;
      }
    };

    this.socket.onclose = () => {
      this.connected = false;
      this.isAdvertising = false;
    };
  }

  /**
   * Handle discovered peer
   */
  _handlePeerDiscovered(message) {
    const { peerId, host, port, addresses, displayName } = message;
    
    if (peerId === this.localPeerId) return; // Ignore self
    
    const peerInfo = { 
      host, 
      port, 
      addresses, 
      displayName,
      discoveredAt: Date.now() 
    };
    this.discoveredPeers.set(peerId, peerInfo);
    
    console.log(`[mDNSTransport] Discovered peer: ${displayName || peerId} at ${host}:${port}`);
    this.emit('peer-discovered', { peerId, ...peerInfo });
  }

  /**
   * Handle peer removal
   */
  _handlePeerRemoved(message) {
    const { peerId } = message;
    const peer = this.discoveredPeers.get(peerId);
    this.discoveredPeers.delete(peerId);
    
    if (peer) {
      console.log(`[mDNSTransport] Peer removed: ${peer.displayName || peerId}`);
      this.emit('peer-removed', { peerId, ...peer });
    }
  }

  /**
   * Start advertising our service
   */
  async startAdvertising() {
    if (!this.connected || this.isAdvertising) return;
    
    this._sendToSidecar({
      type: 'mdns-advertise',
      serviceName: this.serviceName,
      port: this.port,
      peerId: this.localPeerId,
      displayName: this.identity?.displayName,
    });
  }

  /**
   * Stop advertising
   */
  async stopAdvertising() {
    if (!this.connected || !this.isAdvertising) return;
    
    this._sendToSidecar({
      type: 'mdns-stop-advertise',
    });
    this.isAdvertising = false;
  }

  /**
   * Start discovering peers
   */
  async _startDiscovery() {
    this._sendToSidecar({
      type: 'mdns-discover',
      serviceName: this.serviceName,
    });
  }

  /**
   * Send message to sidecar
   */
  _sendToSidecar(message) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(encodeMessage(message));
  }

  /**
   * Get discovered peers
   */
  getDiscoveredPeers() {
    return Array.from(this.discoveredPeers.entries()).map(([peerId, info]) => ({
      peerId,
      ...info,
    }));
  }

  /**
   * Get address for a discovered peer
   */
  getPeerAddress(peerId) {
    const info = this.discoveredPeers.get(peerId);
    if (info) {
      return `${info.host}:${info.port}`;
    }
    return null;
  }

  /**
   * Connect to a discovered peer (registration only)
   * Actual connection happens via WebSocket or other transport
   */
  async connect(peerId, address) {
    const discovered = this.discoveredPeers.get(peerId);
    if (discovered) {
      this._onPeerConnected(peerId, { ...discovered, transport: 'mdns' });
    }
  }

  /**
   * Disconnect from a peer
   */
  async disconnect(peerId) {
    this._onPeerDisconnected(peerId);
  }

  /**
   * Send is not directly supported - mDNS is for discovery only
   */
  async send(peerId, message) {
    throw new Error('mDNS transport is discovery-only. Use another transport for messaging.');
  }

  /**
   * Broadcast is not supported
   */
  async broadcast(message) {
    throw new Error('mDNS transport is discovery-only. Use another transport for messaging.');
  }

  /**
   * Cleanup
   */
  async destroy() {
    await this.stopAdvertising();
    
    if (this.socket) {
      this._sendToSidecar({ type: 'mdns-stop' });
      this.socket.close();
      this.socket = null;
    }
    
    this.discoveredPeers.clear();
    await super.destroy();
  }
}
