/**
 * P2P-Aware Test Client
 * 
 * Extends the standard TestClient to support P2P transports for integration tests.
 * Uses real PeerManager, WebSocketTransport, WebRTCTransport (via wrtc), and
 * optionally Hyperswarm for Electron-like testing.
 * 
 * Usage:
 *   const client = new P2PTestClient('Client1', { enableWebRTC: true });
 *   await client.connectP2P(workspaceId, { serverUrl: 'ws://localhost:3000' });
 */

const WebSocket = require('ws');
const Y = require('yjs');
const { WebsocketProvider } = require('y-websocket');
const nacl = require('tweetnacl');
const crypto = require('crypto');
const { EventEmitter } = require('events');

// Try to import wrtc for WebRTC support in Node.js
let wrtc = null;
try {
  wrtc = require('wrtc');
  console.log('[P2PTestClient] wrtc module loaded - WebRTC available');
} catch (e) {
  console.log('[P2PTestClient] wrtc not available - WebRTC tests will be skipped');
}

// Configuration
const CONFIG = {
  DEFAULT_TIMEOUT: 5000,
  CONNECTION_TIMEOUT: 10000,
  SYNC_TIMEOUT: 3000,
};

/**
 * Generate random hex string
 */
function randomHex(length = 32) {
  return crypto.randomBytes(length / 2).toString('hex');
}

/**
 * Generate a test document ID
 */
function generateDocId() {
  return `test-doc-${Date.now()}-${randomHex(8)}`;
}

/**
 * Generate a test workspace ID
 */
function generateWorkspaceId() {
  return `test-ws-${randomHex(16)}`;
}

/**
 * Generate a test encryption key
 */
function generateKey() {
  return nacl.randomBytes(32);
}

/**
 * Generate topic from workspace ID
 */
function generateTopic(workspaceId) {
  return crypto.createHash('sha256').update(`nightjar:${workspaceId}`).digest('hex');
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * P2PTestClient - P2P-aware test client for integration tests
 */
class P2PTestClient extends EventEmitter {
  constructor(name, options = {}) {
    super();
    this.name = name;
    this.peerId = options.peerId || `peer-${randomHex(16)}`;
    this.sessionKey = options.sessionKey || generateKey();
    this.clientId = options.clientId || `client-${randomHex(8)}`;
    
    // Y.js document
    this.ydoc = new Y.Doc();
    this.yjsProvider = null;
    
    // WebSocket connections
    this.metaWs = null;
    this.signalingWs = null;
    
    // P2P state
    this.connectedPeers = new Map(); // peerId -> { transport, ws, rtc }
    this.currentWorkspaceId = null;
    this.currentTopic = null;
    
    // WebRTC support
    this.enableWebRTC = options.enableWebRTC && wrtc !== null;
    this.rtcConnections = new Map(); // peerId -> RTCPeerConnection
    this.rtcDataChannels = new Map(); // peerId -> RTCDataChannel
    
    // Message tracking
    this.messages = [];
    this.connected = false;
    
    // Callbacks
    this.onMessage = options.onMessage || null;
    
    // Identity
    this.identity = {
      peerId: this.peerId,
      displayName: options.displayName || name,
      color: options.color || '#' + randomHex(6),
    };
  }

  /**
   * Connect to the metadata/signaling WebSocket
   */
  async connectMeta(port = 8081) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, CONFIG.CONNECTION_TIMEOUT);

      this.metaWs = new WebSocket(`ws://localhost:${port}`);

      this.metaWs.on('open', () => {
        clearTimeout(timeout);
        console.log(`[${this.name}] Connected to metadata WS`);
        
        // Send identity
        this.metaWs.send(JSON.stringify({
          type: 'identity',
          peerId: this.peerId,
          ...this.identity,
        }));

        this.connected = true;
        resolve();
      });

      this.metaWs.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.messages.push({ ...msg, timestamp: Date.now() });
          this._handleMessage(msg);
          if (this.onMessage) {
            this.onMessage(msg);
          }
        } catch (e) {
          console.error(`[${this.name}] Parse error:`, e.message);
        }
      });

      this.metaWs.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      this.metaWs.on('close', () => {
        this.connected = false;
      });
    });
  }

  /**
   * Connect to signaling server for P2P coordination
   */
  async connectSignaling(port = 3000) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Signaling connection timeout'));
      }, CONFIG.CONNECTION_TIMEOUT);

      this.signalingWs = new WebSocket(`ws://localhost:${port}/signal`);

      this.signalingWs.on('open', () => {
        clearTimeout(timeout);
        console.log(`[${this.name}] Connected to signaling WS`);
        resolve();
      });

      this.signalingWs.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this._handleSignalingMessage(msg);
        } catch (e) {
          console.error(`[${this.name}] Signaling parse error:`, e.message);
        }
      });

      this.signalingWs.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * Connect to Y.js WebSocket for document sync
   */
  async connectYjs(docId, port = 8080) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Yjs connection timeout'));
      }, CONFIG.CONNECTION_TIMEOUT);

      const wsUrl = `ws://localhost:${port}`;
      
      this.yjsProvider = new WebsocketProvider(wsUrl, docId, this.ydoc, {
        WebSocketPolyfill: WebSocket,
        connect: true,
      });

      const onSync = (synced) => {
        if (synced) {
          clearTimeout(timeout);
          console.log(`[${this.name}] Connected to Yjs WS for doc: ${docId}`);
          this.yjsProvider.off('sync', onSync);
          resolve();
        }
      };

      this.yjsProvider.on('sync', onSync);

      this.yjsProvider.on('status', ({ status }) => {
        if (status === 'connected' && this.yjsProvider.synced) {
          clearTimeout(timeout);
          this.yjsProvider.off('sync', onSync);
          resolve();
        }
      });

      if (this.yjsProvider.synced) {
        clearTimeout(timeout);
        console.log(`[${this.name}] Connected to Yjs WS for doc: ${docId}`);
        resolve();
      }
    });
  }

  /**
   * Join a P2P workspace via signaling
   */
  async joinP2P(workspaceId, options = {}) {
    this.currentWorkspaceId = workspaceId;
    this.currentTopic = generateTopic(workspaceId);
    
    // Connect to signaling if not connected
    if (!this.signalingWs) {
      await this.connectSignaling(options.port || 3000);
    }

    // Join the topic
    this.signalingWs.send(JSON.stringify({
      type: 'join',
      roomId: workspaceId,
      profile: this.identity,
    }));

    // Wait for join confirmation
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Join timeout'));
      }, CONFIG.CONNECTION_TIMEOUT);

      const handler = (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'joined') {
            clearTimeout(timeout);
            this.signalingWs.off('message', handler);
            console.log(`[${this.name}] Joined P2P workspace: ${workspaceId.slice(0, 8)}... (${msg.peers?.length || 0} peers)`);
            
            // Store peers
            for (const peer of (msg.peers || [])) {
              this.connectedPeers.set(peer.peerId, { transport: 'websocket', info: peer });
            }
            
            resolve(msg);
          }
        } catch (e) {
          // Ignore parse errors here
        }
      };

      this.signalingWs.on('message', handler);
    });
  }

  /**
   * Handle incoming messages
   */
  _handleMessage(msg) {
    switch (msg.type) {
      case 'peer-list':
        for (const peer of (msg.peers || [])) {
          if (!this.connectedPeers.has(peer.peerId)) {
            this.connectedPeers.set(peer.peerId, { transport: 'websocket', info: peer });
            this.emit('peer-connected', peer);
          }
        }
        break;
        
      case 'peer-joined':
      case 'peer_joined':
        if (msg.peerId && msg.peerId !== this.peerId) {
          this.connectedPeers.set(msg.peerId, { transport: 'websocket', info: msg.profile || {} });
          this.emit('peer-connected', { peerId: msg.peerId, ...msg.profile });
          
          // Try to establish WebRTC if enabled
          if (this.enableWebRTC) {
            this._initiateWebRTC(msg.peerId);
          }
        }
        break;
        
      case 'peer-left':
      case 'peer_left':
        if (msg.peerId) {
          this.connectedPeers.delete(msg.peerId);
          this._cleanupWebRTC(msg.peerId);
          this.emit('peer-disconnected', { peerId: msg.peerId });
        }
        break;
        
      case 'webrtc-signal':
        if (this.enableWebRTC) {
          this._handleWebRTCSignal(msg);
        }
        break;
    }
  }

  /**
   * Handle signaling messages
   */
  _handleSignalingMessage(msg) {
    switch (msg.type) {
      case 'welcome':
        // Server assigned us a peer ID
        if (msg.peerId) {
          this.peerId = msg.peerId;
        }
        break;
        
      case 'peer_joined':
        if (msg.peerId && msg.peerId !== this.peerId) {
          this.connectedPeers.set(msg.peerId, { transport: 'websocket', info: msg.profile || {} });
          this.emit('peer-connected', { peerId: msg.peerId, ...msg.profile });
        }
        break;
        
      case 'peer_left':
        if (msg.peerId) {
          this.connectedPeers.delete(msg.peerId);
          this.emit('peer-disconnected', { peerId: msg.peerId });
        }
        break;
        
      case 'signal':
        // WebRTC signaling
        if (this.enableWebRTC && msg.signal) {
          this._handleWebRTCSignal({
            fromPeerId: msg.from,
            signalData: msg.signal,
          });
        }
        break;
    }
  }

  /**
   * Initiate WebRTC connection to peer
   */
  async _initiateWebRTC(peerId) {
    if (!wrtc) return;
    
    console.log(`[${this.name}] Initiating WebRTC to ${peerId.slice(0, 8)}...`);
    
    const pc = new wrtc.RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    
    this.rtcConnections.set(peerId, pc);
    
    // Create data channel
    const dc = pc.createDataChannel('nightjar-sync', {
      ordered: true,
    });
    
    dc.onopen = () => {
      console.log(`[${this.name}] WebRTC data channel open to ${peerId.slice(0, 8)}`);
      this.rtcDataChannels.set(peerId, dc);
      this.connectedPeers.set(peerId, { 
        ...this.connectedPeers.get(peerId), 
        transport: 'webrtc' 
      });
      this.emit('webrtc-connected', { peerId });
    };
    
    dc.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.emit('p2p-message', { peerId, message: msg });
      } catch (e) {
        // Binary data - might be Yjs update
        this.emit('p2p-data', { peerId, data: event.data });
      }
    };
    
    dc.onclose = () => {
      this.rtcDataChannels.delete(peerId);
    };
    
    // ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this._sendSignal(peerId, { type: 'candidate', candidate: event.candidate });
      }
    };
    
    // Create offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this._sendSignal(peerId, { type: 'offer', sdp: offer.sdp });
  }

  /**
   * Handle incoming WebRTC signal
   */
  async _handleWebRTCSignal(msg) {
    if (!wrtc) return;
    
    const { fromPeerId, signalData } = msg;
    if (!signalData) return;
    
    let pc = this.rtcConnections.get(fromPeerId);
    
    if (signalData.type === 'offer') {
      // Create connection if needed
      if (!pc) {
        pc = new wrtc.RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });
        this.rtcConnections.set(fromPeerId, pc);
        
        pc.ondatachannel = (event) => {
          const dc = event.channel;
          dc.onopen = () => {
            console.log(`[${this.name}] WebRTC data channel received from ${fromPeerId.slice(0, 8)}`);
            this.rtcDataChannels.set(fromPeerId, dc);
            this.emit('webrtc-connected', { peerId: fromPeerId });
          };
          dc.onmessage = (ev) => {
            try {
              const m = JSON.parse(ev.data);
              this.emit('p2p-message', { peerId: fromPeerId, message: m });
            } catch (e) {
              this.emit('p2p-data', { peerId: fromPeerId, data: ev.data });
            }
          };
        };
        
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            this._sendSignal(fromPeerId, { type: 'candidate', candidate: event.candidate });
          }
        };
      }
      
      await pc.setRemoteDescription({ type: 'offer', sdp: signalData.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this._sendSignal(fromPeerId, { type: 'answer', sdp: answer.sdp });
      
    } else if (signalData.type === 'answer') {
      if (pc) {
        await pc.setRemoteDescription({ type: 'answer', sdp: signalData.sdp });
      }
      
    } else if (signalData.type === 'candidate') {
      if (pc) {
        await pc.addIceCandidate(signalData.candidate);
      }
    }
  }

  /**
   * Send signal to peer via signaling server
   */
  _sendSignal(peerId, signal) {
    const ws = this.signalingWs || this.metaWs;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'signal',
        to: peerId,
        signal,
      }));
    }
  }

  /**
   * Cleanup WebRTC connection
   */
  _cleanupWebRTC(peerId) {
    const dc = this.rtcDataChannels.get(peerId);
    if (dc) {
      dc.close();
      this.rtcDataChannels.delete(peerId);
    }
    
    const pc = this.rtcConnections.get(peerId);
    if (pc) {
      pc.close();
      this.rtcConnections.delete(peerId);
    }
  }

  /**
   * Send message via P2P (prefers WebRTC if available)
   */
  sendP2P(peerId, message) {
    const dc = this.rtcDataChannels.get(peerId);
    if (dc && dc.readyState === 'open') {
      dc.send(JSON.stringify(message));
      return true;
    }
    
    // Fall back to signaling relay
    const ws = this.signalingWs || this.metaWs;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'relay',
        to: peerId,
        message,
      }));
      return true;
    }
    
    return false;
  }

  /**
   * Broadcast message to all peers
   */
  broadcastP2P(message) {
    for (const peerId of this.connectedPeers.keys()) {
      this.sendP2P(peerId, message);
    }
  }

  /**
   * Get text content from Yjs document
   */
  getText(field = 'content') {
    return this.ydoc.getText(field).toString();
  }

  /**
   * Insert text into Yjs document
   */
  insertText(text, pos = 0, field = 'content') {
    this.ydoc.getText(field).insert(pos, text);
  }

  /**
   * Delete text from Yjs document
   */
  deleteText(pos, length, field = 'content') {
    this.ydoc.getText(field).delete(pos, length);
  }

  /**
   * Get connected peer count
   */
  getConnectedPeerCount() {
    return this.connectedPeers.size;
  }

  /**
   * Get WebRTC connected peers
   */
  getWebRTCPeers() {
    return Array.from(this.rtcDataChannels.keys());
  }

  /**
   * Check if WebRTC is available
   */
  static hasWebRTC() {
    return wrtc !== null;
  }

  /**
   * Cleanup all connections
   */
  async disconnect() {
    // Close WebRTC
    for (const peerId of this.rtcDataChannels.keys()) {
      this._cleanupWebRTC(peerId);
    }
    
    // Close Yjs provider
    if (this.yjsProvider) {
      this.yjsProvider.destroy();
      this.yjsProvider = null;
    }
    
    // Close WebSockets
    if (this.signalingWs) {
      this.signalingWs.close();
      this.signalingWs = null;
    }
    
    if (this.metaWs) {
      this.metaWs.close();
      this.metaWs = null;
    }
    
    this.connected = false;
    this.connectedPeers.clear();
  }
}

// Export
module.exports = {
  P2PTestClient,
  generateDocId,
  generateWorkspaceId,
  generateTopic,
  generateKey,
  randomHex,
  sleep,
  hasWebRTC: () => wrtc !== null,
  CONFIG,
};
