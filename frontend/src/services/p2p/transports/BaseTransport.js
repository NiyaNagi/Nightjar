/**
 * BaseTransport - Abstract base class for P2P transports
 * 
 * All transports (WebSocket, WebRTC, Hyperswarm, mDNS) extend this class.
 * Provides consistent interface for peer connections and messaging.
 */

/**
 * Simple EventEmitter implementation for browser compatibility
 */
class EventEmitter {
  constructor() {
    this._events = {};
  }

  on(event, listener) {
    if (!this._events[event]) {
      this._events[event] = [];
    }
    this._events[event].push(listener);
    return this;
  }

  off(event, listener) {
    if (!this._events[event]) return this;
    if (listener) {
      this._events[event] = this._events[event].filter(l => l !== listener);
    } else {
      delete this._events[event];
    }
    return this;
  }

  emit(event, ...args) {
    if (!this._events[event]) return false;
    this._events[event].forEach(listener => {
      try {
        listener(...args);
      } catch (e) {
        console.error(`[EventEmitter] Error in ${event} listener:`, e);
      }
    });
    return true;
  }

  once(event, listener) {
    const onceListener = (...args) => {
      this.off(event, onceListener);
      listener(...args);
    };
    return this.on(event, onceListener);
  }

  removeAllListeners(event) {
    if (event) {
      delete this._events[event];
    } else {
      this._events = {};
    }
    return this;
  }
}

export { EventEmitter };

export class BaseTransport extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
    this.connected = false;
    this.peers = new Map(); // peerId -> connection info
    this.localPeerId = null;
  }

  /**
   * Initialize the transport
   * @param {Object} config - Transport configuration
   */
  async initialize(config) {
    throw new Error('initialize() must be implemented by subclass');
  }

  /**
   * Connect to a peer
   * @param {string} peerId - Peer identifier
   * @param {Object} address - Connection address/info
   */
  async connect(peerId, address) {
    throw new Error('connect() must be implemented by subclass');
  }

  /**
   * Disconnect from a peer
   * @param {string} peerId - Peer identifier
   */
  async disconnect(peerId) {
    throw new Error('disconnect() must be implemented by subclass');
  }

  /**
   * Send a message to a specific peer
   * @param {string} peerId - Target peer
   * @param {Object} message - Message to send
   */
  async send(peerId, message) {
    throw new Error('send() must be implemented by subclass');
  }

  /**
   * Broadcast a message to all connected peers
   * @param {Object} message - Message to broadcast
   */
  async broadcast(message) {
    const promises = [];
    for (const peerId of this.peers.keys()) {
      promises.push(this.send(peerId, message).catch(e => {
        console.warn(`[${this.name}] Failed to send to ${peerId}:`, e.message);
      }));
    }
    await Promise.all(promises);
  }

  /**
   * Join a topic/room for peer discovery
   * @param {string} topic - Topic identifier
   */
  async joinTopic(topic) {
    // Override in transports that support topics
  }

  /**
   * Leave a topic/room
   * @param {string} topic - Topic identifier
   */
  async leaveTopic(topic) {
    // Override in transports that support topics
  }

  /**
   * Get all connected peer IDs
   * @returns {string[]} Array of peer IDs
   */
  getConnectedPeers() {
    return Array.from(this.peers.keys());
  }

  /**
   * Check if connected to a specific peer
   * @param {string} peerId - Peer identifier
   * @returns {boolean}
   */
  isConnected(peerId) {
    return this.peers.has(peerId);
  }

  /**
   * Get peer count
   * @returns {number}
   */
  getPeerCount() {
    return this.peers.size;
  }

  /**
   * Cleanup and close all connections
   */
  async destroy() {
    const disconnectPromises = [];
    for (const peerId of this.peers.keys()) {
      disconnectPromises.push(this.disconnect(peerId).catch(() => {}));
    }
    await Promise.all(disconnectPromises);
    this.peers.clear();
    this.connected = false;
    this.removeAllListeners();
  }

  /**
   * Handle incoming message (called by subclass)
   * @param {string} peerId - Source peer
   * @param {Object} message - Received message
   */
  _onMessage(peerId, message) {
    this.emit('message', { peerId, message, transport: this.name });
  }

  /**
   * Handle peer connection (called by subclass)
   * @param {string} peerId - Connected peer
   * @param {Object} info - Connection info
   */
  _onPeerConnected(peerId, info = {}) {
    this.peers.set(peerId, { ...info, connectedAt: Date.now() });
    this.emit('peer-connected', { peerId, transport: this.name, info });
  }

  /**
   * Handle peer disconnection (called by subclass)
   * @param {string} peerId - Disconnected peer
   */
  _onPeerDisconnected(peerId) {
    this.peers.delete(peerId);
    this.emit('peer-disconnected', { peerId, transport: this.name });
  }

  /**
   * Handle transport error (called by subclass)
   * @param {Error} error - Error object
   */
  _onError(error) {
    this.emit('error', { error, transport: this.name });
  }
}
