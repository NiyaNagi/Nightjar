/**
 * BootstrapManager - Recursive peer discovery
 * 
 * Handles initial connection and recursive peer discovery
 * until maxConnections is reached.
 */

import { EventEmitter } from './transports/BaseTransport.js';
import { 
  createPeerRequestMessage, 
  createPeerAnnounceMessage,
  createPeerListMessage,
  createPeerAddress,
  MessageTypes,
  isValidPeerAddress,
} from './protocol/messages.js';
import { generateTopic } from './protocol/serialization.js';

export class BootstrapManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.maxConnections = config.maxConnections || 50;
    this.bootstrapTimeout = config.bootstrapTimeout || 10000;
    this.discoveryInterval = config.discoveryInterval || 30000;
    
    this.localPeerId = null;
    this.localPeerAddress = null;
    this.knownPeers = new Map(); // peerId -> PeerAddress
    this.connectedPeers = new Set();
    this.queriedPeers = new Set();
    this.pendingConnections = new Set();
    this.peerManager = null;
    this.discoveryTimer = null;
    this.isBootstrapping = false;
    this.currentTopic = null;
  }

  /**
   * Initialize with PeerManager and local identity
   */
  initialize(peerId, peerManager, identity) {
    this.localPeerId = peerId;
    this.peerManager = peerManager;
    
    // Create local peer address
    this.localPeerAddress = createPeerAddress(
      peerId,
      {
        websocket: null,
        webrtc: true,
        hyperswarm: peerManager.transports.hyperswarm?.connected ? peerId : null,
        mdns: null,
      },
      identity?.displayName || 'Anonymous',
      identity?.color || '#808080'
    );
  }

  /**
   * Start bootstrap process with initial connection info
   */
  async bootstrap(connectionParams) {
    if (this.isBootstrapping) {
      console.log('[Bootstrap] Already bootstrapping');
      return;
    }

    this.isBootstrapping = true;
    console.log('[Bootstrap] Starting with params:', {
      serverUrl: connectionParams.serverUrl,
      bootstrapPeers: connectionParams.bootstrapPeers?.length || 0,
      workspaceId: connectionParams.workspaceId?.slice(0, 8),
    });

    const { serverUrl, bootstrapPeers, topic, workspaceId } = connectionParams;

    try {
      // Generate topic from workspace ID if not provided
      this.currentTopic = topic || (workspaceId ? await generateTopic(workspaceId) : null);

      // Step 1: Try all initial connection methods
      const connected = await this._seedConnections(serverUrl, bootstrapPeers, this.currentTopic);
      
      if (!connected) {
        console.warn('[Bootstrap] No initial connections established');
        // Don't throw - we might get connections later
      }

      // Step 2: Start recursive discovery
      await this._recursiveDiscover();

      // Step 3: Announce ourselves
      await this._announceSelf();

      // Step 4: Start periodic discovery
      this._startPeriodicDiscovery();

      console.log(`[Bootstrap] Complete. Connected to ${this.connectedPeers.size} peers`);
      this.emit('bootstrap-complete', { peerCount: this.connectedPeers.size });

    } catch (error) {
      console.error('[Bootstrap] Failed:', error);
      this.emit('bootstrap-failed', { error });
    } finally {
      this.isBootstrapping = false;
    }
  }

  /**
   * Seed initial connections
   */
  async _seedConnections(serverUrl, bootstrapPeers, topic) {
    const attempts = [];
    const transports = this.peerManager.transports;

    // Try WebSocket server
    if (serverUrl && transports.websocket) {
      attempts.push(
        transports.websocket.connectToServer(serverUrl)
          .then(() => {
            console.log('[Bootstrap] Connected to WebSocket server');
            if (topic) {
              return transports.websocket.joinTopic(topic);
            }
          })
          .then(() => true)
          .catch((e) => {
            console.warn('[Bootstrap] WebSocket connection failed:', e.message);
            return false;
          })
      );
    }

    // Try bootstrap peers (assume WebSocket URLs)
    if (bootstrapPeers && bootstrapPeers.length > 0) {
      for (const peer of bootstrapPeers) {
        attempts.push(
          this._tryBootstrapPeer(peer)
            .then(() => true)
            .catch(() => false)
        );
      }
    }

    // Try Hyperswarm topic
    if (topic && transports.hyperswarm?.connected) {
      attempts.push(
        transports.hyperswarm.joinTopic(topic)
          .then(() => {
            console.log('[Bootstrap] Joined Hyperswarm topic');
            return true;
          })
          .catch((e) => {
            console.warn('[Bootstrap] Hyperswarm join failed:', e.message);
            return false;
          })
      );
    }

    // Setup mDNS discovery events
    if (transports.mdns?.connected) {
      transports.mdns.on('peer-discovered', (peer) => {
        this._handleDiscoveredPeer(peer);
      });
      transports.mdns.startAdvertising().catch(() => {});
    }

    // Wait for at least one connection
    if (attempts.length === 0) {
      return false;
    }

    const results = await Promise.all(attempts);
    return results.some(r => r === true);
  }

  /**
   * Try connecting to a bootstrap peer
   */
  async _tryBootstrapPeer(peerAddress) {
    console.log('[Bootstrap] Trying bootstrap peer:', peerAddress);
    
    // Parse peer address
    let url = peerAddress;
    if (!peerAddress.includes('://')) {
      url = `ws://${peerAddress}`;
    }
    
    await this.peerManager.transports.websocket.connectToServer(url);
    
    if (this.currentTopic) {
      await this.peerManager.transports.websocket.joinTopic(this.currentTopic);
    }
  }

  /**
   * Recursive peer discovery
   */
  async _recursiveDiscover() {
    let newPeersFound = true;
    let rounds = 0;
    const maxRounds = 10;

    while (newPeersFound && rounds < maxRounds && this.connectedPeers.size < this.maxConnections) {
      newPeersFound = false;
      rounds++;

      // Get current connected peers
      const currentPeers = Array.from(this.connectedPeers);
      
      for (const peerId of currentPeers) {
        if (this.queriedPeers.has(peerId)) continue;
        this.queriedPeers.add(peerId);

        try {
          const peers = await this._requestPeersFrom(peerId);
          
          for (const peer of peers) {
            if (!isValidPeerAddress(peer)) continue;
            if (peer.peerId === this.localPeerId) continue;
            if (this.connectedPeers.has(peer.peerId)) continue;
            if (this.pendingConnections.has(peer.peerId)) continue;

            this.knownPeers.set(peer.peerId, peer);
            newPeersFound = true;

            if (this.connectedPeers.size < this.maxConnections) {
              await this._connectToPeer(peer);
            }
          }
        } catch (error) {
          // Peer didn't respond - that's okay
        }
      }
    }

    console.log(`[Bootstrap] Discovery complete after ${rounds} rounds, ${this.connectedPeers.size} peers`);
  }

  /**
   * Request peer list from a specific peer
   */
  _requestPeersFrom(peerId) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve([]); // Return empty list on timeout
      }, 5000);

      const handler = (event) => {
        if (event.message?.type === MessageTypes.PEER_LIST) {
          cleanup();
          resolve(event.message.peers || []);
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.peerManager.off('message', handler);
      };

      this.peerManager.on('message', handler);
      
      this.peerManager.send(peerId, createPeerRequestMessage())
        .catch(() => {
          cleanup();
          resolve([]);
        });
    });
  }

  /**
   * Connect to a discovered peer
   */
  async _connectToPeer(peer) {
    if (this.pendingConnections.has(peer.peerId)) return;
    if (this.connectedPeers.has(peer.peerId)) return;
    
    this.pendingConnections.add(peer.peerId);

    try {
      // Try WebRTC first for direct connection
      if (peer.transports?.webrtc && this.peerManager.transports.webrtc) {
        await this.peerManager.transports.webrtc.connect(peer.peerId, peer);
        this.connectedPeers.add(peer.peerId);
        this.emit('peer-connected', { peer });
        return;
      }

      // Fall back to other transports via PeerManager
      // The transport layer handles routing
      this.connectedPeers.add(peer.peerId);
      this.emit('peer-connected', { peer });

    } catch (error) {
      console.warn(`[Bootstrap] Failed to connect to ${peer.peerId}:`, error.message);
    } finally {
      this.pendingConnections.delete(peer.peerId);
    }
  }

  /**
   * Announce ourselves to all connected peers
   */
  async _announceSelf() {
    const announcement = createPeerAnnounceMessage(this.localPeerAddress);
    await this.peerManager.broadcast(announcement);
  }

  /**
   * Handle incoming peer request
   */
  handlePeerRequest(fromPeerId) {
    const peerList = this.getPeerList();
    const response = createPeerListMessage(peerList);
    this.peerManager.send(fromPeerId, response).catch(() => {});
  }

  /**
   * Handle incoming peer announcement
   */
  handlePeerAnnouncement(peer) {
    if (!isValidPeerAddress(peer)) return;
    if (peer.peerId === this.localPeerId) return;

    // Update known peers
    peer.lastSeen = Date.now();
    this.knownPeers.set(peer.peerId, peer);

    // Connect if under limit and not already connected
    if (this.connectedPeers.size < this.maxConnections && 
        !this.connectedPeers.has(peer.peerId)) {
      this._connectToPeer(peer).catch(() => {});
    }
  }

  /**
   * Handle peer discovery from transports
   */
  _handleDiscoveredPeer(peerInfo) {
    const { peerId, host, port } = peerInfo;
    
    if (peerId === this.localPeerId) return;

    // Create peer address from mDNS info
    const peer = createPeerAddress(
      peerId,
      {
        websocket: `ws://${host}:${port}`,
        webrtc: true,
        mdns: `${host}:${port}`,
      },
      peerInfo.displayName || 'Unknown',
      '#808080'
    );

    this.knownPeers.set(peerId, peer);
    this.emit('peer-discovered', { peer });

    if (this.connectedPeers.size < this.maxConnections && 
        !this.connectedPeers.has(peerId)) {
      this._connectToPeer(peer).catch(() => {});
    }
  }

  /**
   * Register a connected peer
   */
  registerConnectedPeer(peerId, peerInfo = {}) {
    this.connectedPeers.add(peerId);
    if (peerInfo.peerId) {
      this.knownPeers.set(peerId, peerInfo);
    }
  }

  /**
   * Handle peer disconnection
   */
  handlePeerDisconnect(peerId) {
    this.connectedPeers.delete(peerId);
    this.queriedPeers.delete(peerId);
    this.emit('peer-disconnected', { peerId });

    // Try to maintain connections
    if (this.connectedPeers.size < this.maxConnections && !this.isBootstrapping) {
      this._recursiveDiscover().catch(() => {});
    }
  }

  /**
   * Start periodic discovery
   */
  _startPeriodicDiscovery() {
    this._stopPeriodicDiscovery();

    this.discoveryTimer = setInterval(() => {
      if (this.connectedPeers.size < this.maxConnections) {
        this._recursiveDiscover().catch(() => {});
        this._announceSelf().catch(() => {});
      }
    }, this.discoveryInterval);
  }

  /**
   * Stop periodic discovery
   */
  _stopPeriodicDiscovery() {
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = null;
    }
  }

  /**
   * Get current peer list for responding to peer-request
   */
  getPeerList() {
    const peers = [];
    for (const [peerId, peer] of this.knownPeers) {
      if (this.connectedPeers.has(peerId)) {
        peers.push(peer);
      }
    }
    return peers;
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      knownPeers: this.knownPeers.size,
      connectedPeers: this.connectedPeers.size,
      maxConnections: this.maxConnections,
      isBootstrapping: this.isBootstrapping,
    };
  }

  /**
   * Cleanup
   */
  destroy() {
    this._stopPeriodicDiscovery();
    this.knownPeers.clear();
    this.connectedPeers.clear();
    this.queriedPeers.clear();
    this.pendingConnections.clear();
    this.removeAllListeners();
  }
}
