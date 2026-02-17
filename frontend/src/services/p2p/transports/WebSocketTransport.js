/**
 * WebSocketTransport - WebSocket-based peer connections
 * 
 * Used by all client types for relay-based communication.
 * Connects to unified server or other WebSocket endpoints.
 */

import { BaseTransport } from './BaseTransport.js';
import { encodeMessage, decodeMessage } from '../protocol/serialization.js';
import { MessageTypes, createPeerRequestMessage } from '../protocol/messages.js';

export class WebSocketTransport extends BaseTransport {
  constructor() {
    super('websocket');
    this.serverSocket = null;
    this.serverUrl = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
    this.pingInterval = null;
    this.identity = null;
    this.currentTopic = null;
  }

  /**
   * Initialize with optional server URL
   */
  async initialize(config) {
    const { serverUrl, peerId, identity } = config;
    this.localPeerId = peerId;
    this.identity = identity;
    
    if (serverUrl) {
      await this.connectToServer(serverUrl);
    }
    
    this.connected = true;
  }

  /**
   * Connect to a WebSocket server
   * @param {string} url - WebSocket URL
   */
  async connectToServer(url) {
    // Close existing connection if any
    if (this.serverSocket) {
      this.serverSocket.close();
      this.serverSocket = null;
    }

    // Validate URL scheme - must be ws, wss, http, or https (not file://)
    if (!url || typeof url !== 'string') {
      throw new Error('Invalid server URL: URL is required');
    }
    
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.startsWith('file:')) {
      throw new Error('Invalid server URL: file:// protocol cannot be used for WebSocket connections');
    }
    
    if (!lowerUrl.startsWith('ws:') && !lowerUrl.startsWith('wss:') && 
        !lowerUrl.startsWith('http:') && !lowerUrl.startsWith('https:')) {
      throw new Error(`Invalid server URL: unsupported protocol in "${url}"`);
    }

    return new Promise((resolve, reject) => {
      try {
        // Convert http(s) to ws(s) if needed
        const wsUrl = url.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
        const ws = new WebSocket(wsUrl);
        this.serverUrl = wsUrl;
        
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('Connection timeout'));
        }, 10000);

        ws.onopen = () => {
          clearTimeout(timeout);
          this.serverSocket = ws;
          this._setupServerSocket(ws);
          this.reconnectAttempts = 0;
          console.log('[WebSocketTransport] Connected to server:', wsUrl);
          resolve();
        };

        ws.onerror = (error) => {
          clearTimeout(timeout);
          console.error('[WebSocketTransport] Connection error:', error);
          reject(new Error('WebSocket connection failed'));
        };

        ws.onclose = () => {
          clearTimeout(timeout);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Setup event handlers for server socket
   */
  _setupServerSocket(ws) {
    ws.onmessage = (event) => {
      const message = decodeMessage(event.data);
      if (!message) return;

      // Handle special message types
      switch (message.type) {
        case MessageTypes.PEER_LIST:
          this.emit('peers-discovered', { peers: message.peers });
          break;
          
        case MessageTypes.PEER_ANNOUNCE:
          this.emit('peer-announced', { peer: message.peer });
          break;
          
        case MessageTypes.WEBRTC_SIGNAL:
          this.emit('webrtc-signal', {
            fromPeerId: message.fromPeerId,
            signalData: message.signalData,
          });
          break;
          
        case MessageTypes.PING:
          this.sendToServer({ type: MessageTypes.PONG, pingTimestamp: message.timestamp });
          break;
          
        case MessageTypes.PONG:
          // Calculate latency if needed
          break;
          
        case 'peer-joined':
          this._onPeerConnected(message.peerId, message);
          break;
          
        case 'peer-left':
          this._onPeerDisconnected(message.peerId);
          break;
          
        default:
          // Regular message - determine source peer
          const peerId = message._fromPeerId || message.origin || 'server';
          this._onMessage(peerId, message);
      }
    };

    ws.onclose = () => {
      this._handleServerDisconnect();
    };

    ws.onerror = (error) => {
      console.error('[WebSocketTransport] Socket error:', error);
    };

    // Start ping interval
    this._startPingInterval();
    
    // Send identity
    if (this.identity) {
      this.sendToServer({
        type: MessageTypes.IDENTITY,
        peerId: this.localPeerId,
        ...this.identity,
      });
    }

    // Rejoin topic if we had one
    if (this.currentTopic) {
      this.joinTopic(this.currentTopic);
    }
  }

  /**
   * Handle server disconnection with reconnect logic
   */
  _handleServerDisconnect() {
    console.log('[WebSocketTransport] Server disconnected');
    this.serverSocket = null;
    this._stopPingInterval();
    this.emit('server-disconnected');
    
    if (this.reconnectAttempts < this.maxReconnectAttempts && this.serverUrl) {
      this.reconnectAttempts++;
      const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);
      console.log(`[WebSocketTransport] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
      
      setTimeout(() => {
        this.connectToServer(this.serverUrl).catch((e) => {
          console.warn('[WebSocketTransport] Reconnect failed:', e.message);
        });
      }, delay);
    }
  }

  /**
   * Start ping interval for keepalive
   */
  _startPingInterval() {
    this._stopPingInterval();
    this.pingInterval = setInterval(() => {
      if (this.serverSocket?.readyState === WebSocket.OPEN) {
        this.sendToServer({ type: MessageTypes.PING, timestamp: Date.now() });
      }
    }, 30000);
  }

  /**
   * Stop ping interval
   */
  _stopPingInterval() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Send message to server
   * @param {Object} message - Message to send
   */
  async sendToServer(message) {
    if (!this.serverSocket || this.serverSocket.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to server');
    }
    this.serverSocket.send(encodeMessage(message));
  }

  /**
   * Check if connected to server
   */
  isServerConnected() {
    return this.serverSocket?.readyState === WebSocket.OPEN;
  }

  /**
   * Connect to a peer via the server relay
   */
  async connect(peerId, address) {
    // For WebSocket, "connecting" means registering interest in a peer
    // The server handles the actual routing
    this._onPeerConnected(peerId, { address, relay: true });
  }

  /**
   * Disconnect from a peer
   */
  async disconnect(peerId) {
    if (this.peers.has(peerId)) {
      this._onPeerDisconnected(peerId);
    }
  }

  /**
   * Send message to a specific peer via server relay
   */
  async send(peerId, message) {
    if (!this.serverSocket || this.serverSocket.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to server');
    }
    
    // Wrap in relay-message envelope so the server knows to forward it
    const relayEnvelope = {
      type: 'relay-message',
      targetPeerId: peerId,
      payload: {
        ...message,
        _fromPeerId: this.localPeerId,
      },
    };
    
    this.serverSocket.send(encodeMessage(relayEnvelope));
  }

  /**
   * Broadcast message to all peers via server
   */
  async broadcast(message) {
    if (!this.serverSocket || this.serverSocket.readyState !== WebSocket.OPEN) {
      return;
    }
    
    // Wrap in relay-broadcast envelope so the server broadcasts to all topic peers
    const broadcastEnvelope = {
      type: 'relay-broadcast',
      payload: {
        ...message,
        _fromPeerId: this.localPeerId,
      },
    };
    
    this.serverSocket.send(encodeMessage(broadcastEnvelope));
  }

  /**
   * Join a topic/room on the server
   */
  async joinTopic(topic) {
    this.currentTopic = topic;
    if (this.isServerConnected()) {
      await this.sendToServer({
        type: 'join-topic',
        topic,
        peerId: this.localPeerId,
      });
    }
  }

  /**
   * Leave a topic/room
   */
  async leaveTopic(topic) {
    if (this.currentTopic === topic) {
      this.currentTopic = null;
    }
    if (this.isServerConnected()) {
      await this.sendToServer({
        type: 'leave-topic',
        topic,
        peerId: this.localPeerId,
      });
    }
  }

  /**
   * Request peer list from server
   */
  async requestPeers() {
    await this.sendToServer(createPeerRequestMessage());
  }

  /**
   * Forward WebRTC signal through server
   */
  async forwardWebRTCSignal(targetPeerId, signalData) {
    await this.sendToServer({
      type: MessageTypes.WEBRTC_SIGNAL,
      targetPeerId,
      fromPeerId: this.localPeerId,
      signalData,
    });
  }

  /**
   * Cleanup
   */
  async destroy() {
    this._stopPingInterval();
    
    if (this.serverSocket) {
      this.serverSocket.close();
      this.serverSocket = null;
    }
    
    this.serverUrl = null;
    this.currentTopic = null;
    
    await super.destroy();
  }
}
