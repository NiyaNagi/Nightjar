/**
 * Mobile P2P Service
 * Provides P2P-like functionality for mobile platforms using WebSocket relay
 * Since Hyperswarm doesn't work directly on mobile, we use a relay approach
 */

import { Platform } from './platform';

class MobileP2PService {
  constructor() {
    this.socket = null;
    this.identity = null;
    this.topics = new Set();
    this.peers = new Map();
    this.listeners = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.isConnected = false;
    
    // Default relay server (users can self-host)
    this.relayUrl = 'wss://localhost:8082'; // Will be configurable
  }
  
  /**
   * Set custom relay server URL
   */
  setRelayUrl(url) {
    this.relayUrl = url;
  }
  
  /**
   * Initialize the mobile P2P service
   */
  async initialize(identity) {
    this.identity = {
      publicKey: identity.publicKeyHex || identity.publicKey,
      displayName: identity.handle || 'Anonymous',
      color: identity.color || '#6366f1'
    };
    
    return this.connect();
  }
  
  /**
   * Connect to relay server
   */
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        this.socket = new WebSocket(this.relayUrl);
        
        this.socket.onopen = () => {
          console.log('[MobileP2P] Connected to relay');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          
          // Send identity
          this.send({
            type: 'identity',
            ...this.identity
          });
          
          // Rejoin topics
          for (const topic of this.topics) {
            this.send({
              type: 'join-topic',
              topic
            });
          }
          
          resolve(true);
        };
        
        this.socket.onmessage = (event) => {
          this.handleMessage(event.data);
        };
        
        this.socket.onclose = () => {
          console.log('[MobileP2P] Disconnected from relay');
          this.isConnected = false;
          this.emit('disconnected');
          this.attemptReconnect();
        };
        
        this.socket.onerror = (error) => {
          console.error('[MobileP2P] WebSocket error:', error);
          if (!this.isConnected) {
            reject(error);
          }
        };
      } catch (err) {
        reject(err);
      }
    });
  }
  
  /**
   * Attempt to reconnect
   */
  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[MobileP2P] Max reconnect attempts reached');
      return;
    }
    
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    console.log(`[MobileP2P] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connect().catch(() => {
        // Will trigger attemptReconnect again on failure
      });
    }, delay);
  }
  
  /**
   * Send message to relay
   */
  send(message) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }
  
  /**
   * Handle incoming message
   */
  handleMessage(data) {
    try {
      const message = JSON.parse(data);
      
      switch (message.type) {
        case 'peer-joined':
          this.peers.set(message.peerId, message.identity);
          this.emit('peer-joined', message);
          break;
          
        case 'peer-left':
          this.peers.delete(message.peerId);
          this.emit('peer-left', message);
          break;
          
        case 'peer-identity':
          this.peers.set(message.peerId, message.identity);
          this.emit('peer-identity', message);
          break;
          
        case 'sync':
          this.emit('sync-message', message);
          break;
          
        case 'awareness':
          this.emit('awareness-update', message);
          break;
          
        case 'peers-list':
          for (const peer of message.peers) {
            this.peers.set(peer.peerId, peer);
          }
          this.emit('peers-list', message);
          break;
          
        default:
          this.emit('message', message);
      }
    } catch (err) {
      console.error('[MobileP2P] Failed to parse message:', err);
    }
  }
  
  /**
   * Join a topic
   */
  async joinTopic(topicHex) {
    this.topics.add(topicHex);
    
    this.send({
      type: 'join-topic',
      topic: topicHex
    });
    
    this.emit('topic-joined', { topic: topicHex });
    return true;
  }
  
  /**
   * Leave a topic
   */
  async leaveTopic(topicHex) {
    this.topics.delete(topicHex);
    
    this.send({
      type: 'leave-topic',
      topic: topicHex
    });
    
    this.emit('topic-left', { topic: topicHex });
    return true;
  }
  
  /**
   * Broadcast sync data
   */
  broadcastSync(topicHex, data) {
    let dataStr;
    if (data instanceof Uint8Array) {
      let binary = '';
      for (let i = 0; i < data.length; i++) {
        binary += String.fromCharCode(data[i]);
      }
      dataStr = btoa(binary);
    } else {
      dataStr = data;
    }
    
    this.send({
      type: 'sync',
      topic: topicHex,
      data: dataStr
    });
  }
  
  /**
   * Broadcast awareness state
   */
  broadcastAwareness(topicHex, state) {
    this.send({
      type: 'awareness',
      topic: topicHex,
      state
    });
  }
  
  /**
   * Get peers for a topic
   */
  getPeers(topicHex) {
    const peers = [];
    for (const [peerId, peer] of this.peers) {
      if (peer.topics?.includes(topicHex) || true) { // Simplified for now
        peers.push({ peerId, ...peer });
      }
    }
    return peers;
  }
  
  /**
   * Get connection count
   */
  getConnectionCount() {
    return this.peers.size;
  }
  
  /**
   * Event emitter
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }
  
  off(event, callback) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index !== -1) {
        callbacks.splice(index, 1);
      }
    }
  }
  
  emit(event, data) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(data);
        } catch (err) {
          console.error(`[MobileP2P] Error in ${event} listener:`, err);
        }
      }
    }
  }
  
  /**
   * Destroy the service
   */
  async destroy() {
    // Leave all topics
    for (const topic of this.topics) {
      await this.leaveTopic(topic);
    }
    
    // Close socket
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    
    this.topics.clear();
    this.peers.clear();
    this.listeners.clear();
    this.isConnected = false;
  }
}

// Singleton instance
let mobileP2PInstance = null;

export function getMobileP2PService() {
  if (!mobileP2PInstance) {
    mobileP2PInstance = new MobileP2PService();
  }
  return mobileP2PInstance;
}

/**
 * Unified P2P service that uses the appropriate backend
 */
export function getP2PService() {
  if (Platform.isElectron()) {
    // On Electron, use the Hyperswarm IPC bridge
    return {
      initialize: (identity) => window.electronAPI.hyperswarm.initialize(identity),
      joinTopic: (topic) => window.electronAPI.hyperswarm.joinTopic(topic),
      leaveTopic: (topic) => window.electronAPI.hyperswarm.leaveTopic(topic),
      broadcastSync: (topic, data) => window.electronAPI.hyperswarm.broadcastSync(topic, data),
      broadcastAwareness: (topic, state) => window.electronAPI.hyperswarm.broadcastAwareness(topic, state),
      getPeers: (topic) => window.electronAPI.hyperswarm.getPeers(topic),
      getConnectionCount: () => window.electronAPI.hyperswarm.getConnectionCount(),
      destroy: () => window.electronAPI.hyperswarm.destroy(),
      on: (event, callback) => {
        const handlers = {
          'peer-joined': window.electronAPI.hyperswarm.onPeerJoined,
          'peer-left': window.electronAPI.hyperswarm.onPeerLeft,
          'peer-identity': window.electronAPI.hyperswarm.onPeerIdentity,
          'sync-message': window.electronAPI.hyperswarm.onSyncMessage,
          'awareness-update': window.electronAPI.hyperswarm.onAwarenessUpdate
        };
        if (handlers[event]) {
          handlers[event](callback);
        }
      },
      off: () => {} // Not easily removable with IPC
    };
  }
  
  // On mobile/web, use the WebSocket relay
  return getMobileP2PService();
}

export default MobileP2PService;
