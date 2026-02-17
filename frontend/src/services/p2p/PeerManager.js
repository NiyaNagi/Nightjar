/**
 * PeerManager - Main P2P orchestrator
 * 
 * Manages all transports, routes messages, and provides unified API
 * for peer-to-peer communication across Electron, Browser, and Mobile.
 */

import { EventEmitter } from './transports/BaseTransport.js';
import { WebSocketTransport } from './transports/WebSocketTransport.js';
import { WebRTCTransport } from './transports/WebRTCTransport.js';
import { HyperswarmTransport } from './transports/HyperswarmTransport.js';
import { mDNSTransport } from './transports/mDNSTransport.js';
import { BootstrapManager } from './BootstrapManager.js';
import { AwarenessManager } from './AwarenessManager.js';
import { 
  MessageTypes, 
  createPeerListMessage,
  isValidSyncMessage,
} from './protocol/messages.js';
import { generatePeerId, generateTopic } from './protocol/serialization.js';

// Default configuration
const DEFAULT_CONFIG = {
  maxConnections: 50,
  bootstrapTimeout: 10000,
  discoveryInterval: 30000,
  awarenessThrottle: 100,
  // Get port from electronAPI if available, otherwise use default
  sidecarUrl: `ws://localhost:${window.electronAPI?.sidecarPorts?.meta || 8081}`,
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export class PeerManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    this.peerId = null;
    this.identity = null;
    this.isInitialized = false;
    this.currentWorkspaceId = null;
    this.currentTopic = null;
    
    // Transports
    this.transports = {
      websocket: new WebSocketTransport(),
      webrtc: new WebRTCTransport(),
      hyperswarm: new HyperswarmTransport(),
      mdns: new mDNSTransport(),
    };
    
    // Managers
    this.bootstrapManager = new BootstrapManager({
      maxConnections: this.config.maxConnections,
      bootstrapTimeout: this.config.bootstrapTimeout,
      discoveryInterval: this.config.discoveryInterval,
    });
    
    // Awareness managers per document
    this.awarenessManagers = new Map(); // docId -> AwarenessManager
    
    // Message handlers by type
    this.messageHandlers = new Map();
    
    // Setup internal event routing
    this._setupEventRouting();
  }

  /**
   * Initialize PeerManager with identity
   */
  async initialize(identity = {}) {
    if (this.isInitialized) {
      console.log('[PeerManager] Already initialized');
      return;
    }

    console.log('[PeerManager] Initializing...');
    
    // Generate or use provided peer ID
    this.peerId = identity.peerId || generatePeerId();
    this.identity = {
      displayName: identity.displayName || 'Anonymous',
      color: identity.color || '#808080',
      icon: identity.icon || '👤',
      ...identity,
      peerId: this.peerId,
    };

    // Initialize transports
    const transportConfig = {
      peerId: this.peerId,
      identity: this.identity,
      sidecarUrl: this.config.sidecarUrl,
      iceServers: this.config.iceServers,
    };

    // Initialize WebSocket transport (always available)
    await this.transports.websocket.initialize(transportConfig);

    // Initialize WebRTC transport with signaling callback
    await this.transports.webrtc.initialize({
      ...transportConfig,
      signalingCallback: this._handleWebRTCSignal.bind(this),
    });

    // Initialize Hyperswarm (Electron only)
    if (HyperswarmTransport.isAvailable()) {
      await this.transports.hyperswarm.initialize(transportConfig);
    }

    // Initialize mDNS (Electron only)
    if (mDNSTransport.isAvailable()) {
      await this.transports.mdns.initialize(transportConfig);
    }

    // Initialize BootstrapManager
    this.bootstrapManager.initialize(this.peerId, this, this.identity);

    this.isInitialized = true;
    console.log('[PeerManager] Initialized with peer ID:', this.peerId.slice(0, 16));
    
    this.emit('initialized', { peerId: this.peerId });
  }

  /**
   * Setup event routing from transports
   */
  _setupEventRouting() {
    // Route messages from all transports
    for (const [name, transport] of Object.entries(this.transports)) {
      transport.on('message', (event) => {
        this._handleIncomingMessage(event);
      });

      transport.on('peer-connected', (event) => {
        this.bootstrapManager.registerConnectedPeer(event.peerId, event.info);
        this.emit('peer-connected', event);
      });

      transport.on('peer-disconnected', (event) => {
        this.bootstrapManager.handlePeerDisconnect(event.peerId);
        this.emit('peer-disconnected', event);
      });

      transport.on('error', (event) => {
        console.error(`[PeerManager] ${name} error:`, event.error);
        this.emit('transport-error', event);
      });
    }

    // Handle WebSocket-specific events
    this.transports.websocket.on('peers-discovered', (event) => {
      for (const peer of event.peers || []) {
        this.bootstrapManager.handlePeerAnnouncement(peer);
      }
    });

    this.transports.websocket.on('peer-announced', (event) => {
      this.bootstrapManager.handlePeerAnnouncement(event.peer);
    });

    this.transports.websocket.on('webrtc-signal', (event) => {
      this.transports.webrtc.handleSignal(event.fromPeerId, event.signalData);
    });

    // Handle Hyperswarm peer discoveries - these are already-connected
    // remote peers at the sidecar level, so register them as connected
    // (not just "announced") so getConnectedPeers() includes them.
    // We call _onPeerConnected on the transport to also populate the
    // transport's internal peers map (needed for isConnected/send).
    this.transports.hyperswarm.on('peers-discovered', (event) => {
      for (const peer of event.peers || []) {
        if (peer.peerId && peer.peerId !== this.peerId) {
          // Add to transport's peer map AND trigger peer-connected event
          // which flows through _setupEventRouting → registerConnectedPeer
          this.transports.hyperswarm._onPeerConnected(peer.peerId, peer);
          console.log(`[PeerManager] Hyperswarm peer discovered: ${peer.peerId?.slice(0, 16)}`);
        }
      }
    });

    // Handle mDNS discoveries
    this.transports.mdns.on('peer-discovered', (event) => {
      this.emit('mdns-peer-discovered', event);
    });
  }

  /**
   * Handle WebRTC signaling
   */
  _handleWebRTCSignal(targetPeerId, signalData) {
    // Forward signal through WebSocket
    this.transports.websocket.forwardWebRTCSignal(targetPeerId, signalData)
      .catch((e) => {
        console.warn('[PeerManager] Failed to forward WebRTC signal:', e.message);
      });
  }

  /**
   * Handle incoming message from any transport
   */
  _handleIncomingMessage(event) {
    const { peerId, message, transport } = event;
    
    if (!message || !message.type) return;

    // Handle protocol messages
    switch (message.type) {
      case MessageTypes.PEER_REQUEST:
        this.bootstrapManager.handlePeerRequest(peerId);
        break;

      case MessageTypes.PEER_ANNOUNCE:
        this.bootstrapManager.handlePeerAnnouncement(message.peer);
        break;

      case MessageTypes.SYNC:
        // Emit for Y.js integration
        this.emit('sync', { peerId, message, transport });
        break;

      case MessageTypes.AWARENESS:
        // Handled by AwarenessManager
        this.emit('awareness', { peerId, message, transport });
        break;

      case MessageTypes.PING:
        this.send(peerId, { type: MessageTypes.PONG, pingTimestamp: message.timestamp });
        break;

      default:
        // Check custom handlers
        const handler = this.messageHandlers.get(message.type);
        if (handler) {
          handler(peerId, message, transport);
        }
    }

    // Always emit generic message event
    this.emit('message', event);
  }

  /**
   * Join a workspace
   */
  async joinWorkspace(workspaceId, connectionParams = {}) {
    if (!this.isInitialized) {
      throw new Error('PeerManager not initialized');
    }

    console.log('[PeerManager] Joining workspace:', workspaceId.slice(0, 8));
    
    this.currentWorkspaceId = workspaceId;
    this.currentTopic = connectionParams.topic || await generateTopic(workspaceId);

    // Start bootstrap process
    await this.bootstrapManager.bootstrap({
      workspaceId,
      topic: this.currentTopic,
      serverUrl: connectionParams.serverUrl,
      bootstrapPeers: connectionParams.bootstrapPeers,
    });

    this.emit('workspace-joined', { 
      workspaceId, 
      topic: this.currentTopic,
      peerCount: this.bootstrapManager.connectedPeers.size,
    });

    return {
      workspaceId,
      topic: this.currentTopic,
      peerCount: this.getConnectedPeerCount(),
    };
  }

  /**
   * Leave current workspace
   */
  async leaveWorkspace() {
    if (!this.currentWorkspaceId) return;

    console.log('[PeerManager] Leaving workspace:', this.currentWorkspaceId.slice(0, 8));

    // Leave topics on all transports
    if (this.currentTopic) {
      await Promise.all([
        this.transports.websocket.leaveTopic(this.currentTopic),
        this.transports.hyperswarm.leaveTopic(this.currentTopic),
      ]);
    }

    // Clear awareness managers
    for (const manager of this.awarenessManagers.values()) {
      manager.destroy();
    }
    this.awarenessManagers.clear();

    const workspaceId = this.currentWorkspaceId;
    this.currentWorkspaceId = null;
    this.currentTopic = null;

    this.emit('workspace-left', { workspaceId });
  }

  /**
   * Get or create awareness manager for a document
   */
  getAwarenessManager(docId) {
    if (!this.awarenessManagers.has(docId)) {
      const manager = new AwarenessManager({
        throttleMs: this.config.awarenessThrottle,
      });
      manager.initialize(this, docId, `${this.peerId}-${docId}`);
      this.awarenessManagers.set(docId, manager);
    }
    return this.awarenessManagers.get(docId);
  }

  /**
   * Send message to a specific peer
   */
  async send(peerId, message) {
    // Try transports in order of preference: WebRTC (direct) -> WebSocket -> Hyperswarm
    
    // Try WebRTC first (direct connection)
    if (this.transports.webrtc.isConnected(peerId)) {
      try {
        await this.transports.webrtc.send(peerId, message);
        return;
      } catch (e) {
        // Fall through to next transport
      }
    }

    // Try WebSocket (relay through server)
    if (this.transports.websocket.isServerConnected()) {
      try {
        await this.transports.websocket.send(peerId, message);
        return;
      } catch (e) {
        // Fall through to next transport
      }
    }

    // Try Hyperswarm
    if (this.transports.hyperswarm.isConnected(peerId)) {
      try {
        await this.transports.hyperswarm.send(peerId, message);
        return;
      } catch (e) {
        // Fall through
      }
    }

    throw new Error(`No transport available for peer ${peerId}`);
  }

  /**
   * Broadcast message to all connected peers
   */
  async broadcast(message) {
    const promises = [];

    // Broadcast through all active transports
    if (this.transports.websocket.isServerConnected()) {
      promises.push(this.transports.websocket.broadcast(message));
    }

    if (this.transports.webrtc.getConnectedPeers().length > 0) {
      promises.push(this.transports.webrtc.broadcast(message));
    }

    if (this.transports.hyperswarm.connected) {
      promises.push(this.transports.hyperswarm.broadcast(message));
    }

    await Promise.all(promises.map(p => p.catch(() => {})));
  }

  /**
   * Register a custom message handler
   */
  registerHandler(messageType, handler) {
    this.messageHandlers.set(messageType, handler);
  }

  /**
   * Unregister a custom message handler
   */
  unregisterHandler(messageType) {
    this.messageHandlers.delete(messageType);
  }

  /**
   * Get connected peer count
   */
  getConnectedPeerCount() {
    return this.bootstrapManager.connectedPeers.size;
  }

  /**
   * Get connected peers
   */
  getConnectedPeers() {
    return Array.from(this.bootstrapManager.connectedPeers);
  }

  /**
   * Get known peers
   */
  getKnownPeers() {
    return Array.from(this.bootstrapManager.knownPeers.values());
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      peerId: this.peerId,
      isInitialized: this.isInitialized,
      currentWorkspaceId: this.currentWorkspaceId,
      currentTopic: this.currentTopic?.slice(0, 16),
      ...this.bootstrapManager.getStats(),
      transports: {
        websocket: {
          connected: this.transports.websocket.isServerConnected(),
          peers: this.transports.websocket.getPeerCount(),
        },
        webrtc: {
          connected: this.transports.webrtc.connected,
          peers: this.transports.webrtc.getConnectedPeers().length,
        },
        hyperswarm: {
          available: HyperswarmTransport.isAvailable(),
          connected: this.transports.hyperswarm.connected,
          peers: this.transports.hyperswarm.getPeerCount(),
        },
        mdns: {
          available: mDNSTransport.isAvailable(),
          connected: this.transports.mdns.connected,
          discovered: this.transports.mdns.discoveredPeers.size,
        },
      },
    };
  }

  /**
   * Cleanup
   */
  async destroy() {
    console.log('[PeerManager] Destroying...');

    // Leave workspace
    await this.leaveWorkspace();

    // Destroy bootstrap manager
    this.bootstrapManager.destroy();

    // Destroy all transports
    await Promise.all([
      this.transports.websocket.destroy(),
      this.transports.webrtc.destroy(),
      this.transports.hyperswarm.destroy(),
      this.transports.mdns.destroy(),
    ]);

    this.messageHandlers.clear();
    this.isInitialized = false;
    this.removeAllListeners();

    console.log('[PeerManager] Destroyed');
  }
}

// Singleton instance for app-wide use
let instance = null;

/**
 * Get or create the singleton PeerManager instance
 */
export function getPeerManager(config) {
  if (!instance) {
    instance = new PeerManager(config);
  }
  return instance;
}

/**
 * Destroy the singleton instance
 */
export async function destroyPeerManager() {
  if (instance) {
    await instance.destroy();
    instance = null;
  }
}
