/**
 * HyperswarmTransport - Native P2P via Hyperswarm DHT
 * 
 * Only available in Electron (via sidecar) and Server environments.
 * Provides true decentralized peer discovery.
 */

import { BaseTransport } from './BaseTransport.js';
import { encodeMessage, decodeMessage } from '../protocol/serialization.js';

export class HyperswarmTransport extends BaseTransport {
  constructor() {
    super('hyperswarm');
    this.socket = null; // WebSocket to sidecar
    this.sidecarUrl = 'ws://localhost:8081';
    this.topics = new Set();
    this.isElectron = false;
    this.reconnectTimer = null;
  }

  /**
   * Check if Hyperswarm is available (Electron only)
   */
  static isAvailable() {
    if (typeof window === 'undefined') return false;
    return window.electronAPI !== undefined;
  }

  /**
   * Initialize connection to sidecar
   */
  async initialize(config) {
    const { peerId, sidecarUrl, identity } = config;
    this.localPeerId = peerId;
    this.identity = identity;
    
    if (sidecarUrl) {
      this.sidecarUrl = sidecarUrl;
    }

    // Check if running in Electron
    this.isElectron = HyperswarmTransport.isAvailable();
    
    if (!this.isElectron) {
      console.log('[HyperswarmTransport] Not in Electron, transport disabled');
      return;
    }

    try {
      await this._connectToSidecar();
      this.connected = true;
    } catch (error) {
      console.warn('[HyperswarmTransport] Failed to connect to sidecar:', error.message);
      // Don't throw - transport is optional
    }
  }

  /**
   * Connect to sidecar WebSocket
   */
  async _connectToSidecar() {
    return new Promise((resolve, reject) => {
      try {
        this.socket = new WebSocket(this.sidecarUrl);

        const timeout = setTimeout(() => {
          if (this.socket) {
            this.socket.close();
          }
          reject(new Error('Sidecar connection timeout'));
        }, 5000);

        this.socket.onopen = () => {
          clearTimeout(timeout);
          console.log('[HyperswarmTransport] Connected to sidecar');
          this._setupSocketHandlers();
          
          // Send identity
          if (this.identity) {
            this._sendToSidecar({
              type: 'p2p-identity',
              peerId: this.localPeerId,
              ...this.identity,
            });
          }
          
          resolve();
        };

        this.socket.onerror = (error) => {
          clearTimeout(timeout);
          reject(new Error('Sidecar connection error'));
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Setup sidecar socket event handlers
   */
  _setupSocketHandlers() {
    this.socket.onmessage = (event) => {
      const message = decodeMessage(event.data);
      if (!message) return;

      switch (message.type) {
        case 'p2p-peer-connected':
          this._onPeerConnected(message.peerId, message.info || {});
          break;

        case 'p2p-peer-disconnected':
          this._onPeerDisconnected(message.peerId);
          break;

        case 'p2p-message':
          this._onMessage(message.fromPeerId, message.payload);
          break;

        case 'p2p-topic-joined':
          console.log('[HyperswarmTransport] Joined topic:', message.topic?.slice(0, 16));
          this.emit('topic-joined', { topic: message.topic });
          break;

        case 'p2p-peers-discovered':
          this.emit('peers-discovered', { peers: message.peers });
          break;

        case 'p2p-error':
          this._onError(new Error(message.message));
          break;
      }
    };

    this.socket.onclose = () => {
      console.log('[HyperswarmTransport] Sidecar disconnected');
      this.connected = false;
      this._scheduleReconnect();
    };

    this.socket.onerror = (error) => {
      console.error('[HyperswarmTransport] Socket error');
    };
  }

  /**
   * Schedule reconnection attempt
   */
  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.isElectron && !this.connected) {
        try {
          await this._connectToSidecar();
          this.connected = true;
          // Rejoin topics
          for (const topic of this.topics) {
            await this.joinTopic(topic);
          }
        } catch (e) {
          console.warn('[HyperswarmTransport] Reconnect failed');
          this._scheduleReconnect();
        }
      }
    }, 5000);
  }

  /**
   * Send message to sidecar
   */
  _sendToSidecar(message) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to sidecar');
    }
    this.socket.send(encodeMessage(message));
  }

  /**
   * Join a Hyperswarm topic
   */
  async joinTopic(topic) {
    if (!this.connected) {
      console.warn('[HyperswarmTransport] Not connected, queueing topic join');
      this.topics.add(topic);
      return;
    }
    
    this.topics.add(topic);
    this._sendToSidecar({
      type: 'p2p-join-topic',
      topic,
      peerId: this.localPeerId,
    });
  }

  /**
   * Leave a Hyperswarm topic
   */
  async leaveTopic(topic) {
    this.topics.delete(topic);
    
    if (!this.connected) return;
    
    this._sendToSidecar({
      type: 'p2p-leave-topic',
      topic,
    });
  }

  /**
   * Connect to a specific peer via Hyperswarm
   */
  async connect(peerId, address) {
    if (!this.connected) return;
    
    this._sendToSidecar({
      type: 'p2p-connect-peer',
      targetPeerId: peerId,
      address,
    });
  }

  /**
   * Disconnect from a peer
   */
  async disconnect(peerId) {
    if (this.connected) {
      this._sendToSidecar({
        type: 'p2p-disconnect-peer',
        targetPeerId: peerId,
      });
    }
    this._onPeerDisconnected(peerId);
  }

  /**
   * Send message to a specific peer
   */
  async send(peerId, message) {
    if (!this.connected) {
      throw new Error('Not connected to sidecar');
    }
    
    this._sendToSidecar({
      type: 'p2p-send',
      targetPeerId: peerId,
      payload: message,
    });
  }

  /**
   * Broadcast to all peers on joined topics
   */
  async broadcast(message) {
    if (!this.connected) return;
    
    this._sendToSidecar({
      type: 'p2p-broadcast',
      payload: message,
    });
  }

  /**
   * Cleanup
   */
  async destroy() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    // Leave all topics
    for (const topic of this.topics) {
      try {
        await this.leaveTopic(topic);
      } catch (e) {
        // Ignore errors during cleanup
      }
    }
    this.topics.clear();
    
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    
    await super.destroy();
  }
}
