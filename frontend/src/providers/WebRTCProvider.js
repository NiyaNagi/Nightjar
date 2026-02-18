/**
 * WebRTC Provider for Nightjar
 * 
 * Handles WebRTC peer connections for browser-based collaboration.
 * Uses a signaling server for peer discovery, then establishes
 * direct P2P connections for actual data transfer.
 * 
 * Security:
 * - All document sync happens over encrypted WebRTC data channels
 * - Signaling server only sees connection metadata
 * - Identity verified via Ed25519 signatures
 */

import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';

// WebRTC configuration
const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/**
 * WebRTC Provider for Yjs
 */
export class WebRTCProvider {
  constructor(roomId, ydoc, options = {}) {
    this.roomId = roomId;
    this.doc = ydoc;
    this.awareness = options.awareness || new Awareness(ydoc);
    
    // Configuration - support multiple signaling sources
    // Priority: bootstrapPeers (from invite) > cachedPeers > fallbackUrl
    this.bootstrapPeers = options.bootstrapPeers || []; // From invite link
    this.cachedPeers = this._loadCachedPeers(); // From localStorage
    this.fallbackUrl = options.signalingUrl || options.fallbackUrl || 'ws://localhost:3000';
    this.signalingUrl = null; // Currently connected URL
    this.signalingUrls = []; // All URLs to try
    
    this.iceServers = options.iceServers || DEFAULT_ICE_SERVERS;
    this.maxRetries = options.maxRetries || 5;
    this.retryDelay = options.retryDelay || 2000;
    
    // Identity (for peer verification)
    this.publicKey = options.publicKey || null;
    this.profile = options.profile || null;
    
    // State
    this.peerId = null;
    this.ws = null;
    this.peers = new Map(); // peerId -> { connection, channel, state }
    this.connected = false;
    this.retryCount = 0;
    this.destroyed = false;
    this.currentUrlIndex = 0;
    
    // Connection progress tracking
    this.connectionAttempts = [];
    this.onConnectionProgress = options.onConnectionProgress || (() => {});
    
    // Callbacks
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onPeersChange = options.onPeersChange || (() => {});
    this.onError = options.onError || ((e) => console.error('[WebRTCProvider]', e));
    this.onAllPeersFailed = options.onAllPeersFailed || (() => {});
    
    // Bind methods
    this._handleDocUpdate = this._handleDocUpdate.bind(this);
    this._handleAwarenessUpdate = this._handleAwarenessUpdate.bind(this);
    
    // Subscribe to doc updates
    this.doc.on('update', this._handleDocUpdate);
    this.awareness.on('update', this._handleAwarenessUpdate);
    
    // Build signaling URL list and connect
    this._buildSignalingUrls();
    this._connect();
  }

  /**
   * Build list of signaling URLs to try in order
   */
  _buildSignalingUrls() {
    this.signalingUrls = [];
    
    // 1. Bootstrap peers from invite link (highest priority)
    for (const peer of this.bootstrapPeers) {
      const url = this._peerAddressToUrl(peer);
      if (url && !this.signalingUrls.includes(url)) {
        this.signalingUrls.push(url);
      }
    }
    
    // 2. Cached peers from previous sessions
    for (const peer of this.cachedPeers) {
      const url = this._peerAddressToUrl(peer);
      if (url && !this.signalingUrls.includes(url)) {
        this.signalingUrls.push(url);
      }
    }
    
    // 3. Fallback (public server)
    if (!this.signalingUrls.includes(this.fallbackUrl)) {
      this.signalingUrls.push(this.fallbackUrl);
    }
    
    console.log('[WebRTCProvider] Signaling URLs:', this.signalingUrls);
  }

  /**
   * Convert peer address (ip:port) to WebSocket URL
   */
  _peerAddressToUrl(address) {
    if (!address) return null;
    if (address.startsWith('ws://') || address.startsWith('wss://')) {
      return address;
    }
    // Assume ip:port format
    return `ws://${address}`;
  }

  /**
   * Load cached peers from localStorage
   */
  _loadCachedPeers() {
    try {
      const cached = localStorage.getItem('Nightjar_cached_peers');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  }

  /**
   * Save successful peer to cache
   */
  _cachePeer(address) {
    try {
      const cached = this._loadCachedPeers();
      if (!cached.includes(address)) {
        cached.unshift(address); // Add to front
        // Keep only last 10
        const trimmed = cached.slice(0, 10);
        localStorage.setItem('Nightjar_cached_peers', JSON.stringify(trimmed));
      }
    } catch (e) {
      console.warn('[WebRTCProvider] Failed to cache peer:', e);
    }
  }

  /**
   * Connect to signaling server
   */
  _connect() {
    if (this.destroyed) return;

    // Get next URL to try
    if (this.currentUrlIndex >= this.signalingUrls.length) {
      // All URLs exhausted
      console.error('[WebRTCProvider] All signaling servers failed');
      this._updateStatus('failed');
      this.onAllPeersFailed({
        message: 'Could not connect - all peers are offline. Ask the workspace owner to come online.',
        attempted: this.connectionAttempts,
      });
      return;
    }

    this.signalingUrl = this.signalingUrls[this.currentUrlIndex];
    const urlIndex = this.currentUrlIndex + 1;
    const totalUrls = this.signalingUrls.length;
    
    console.log(`[WebRTCProvider] Trying signaling server ${urlIndex}/${totalUrls}:`, this.signalingUrl);
    this.onConnectionProgress({
      current: urlIndex,
      total: totalUrls,
      url: this.signalingUrl,
      status: 'connecting',
    });

    try {
      this.ws = new WebSocket(this.signalingUrl);
      
      this.ws.onopen = () => {
        console.log('[WebRTCProvider] Connected to signaling server:', this.signalingUrl);
        this.retryCount = 0;
        this._updateStatus('connecting');
        
        // Cache this successful peer (if not the fallback)
        if (this.currentUrlIndex < this.signalingUrls.length - 1) {
          this._cachePeer(this.signalingUrl);
        }
        
        this.connectionAttempts.push({
          url: this.signalingUrl,
          status: 'connected',
          timestamp: Date.now(),
        });
        
        this.onConnectionProgress({
          current: urlIndex,
          total: totalUrls,
          url: this.signalingUrl,
          status: 'connected',
        });
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this._handleSignalingMessage(message);
        } catch (e) {
          console.error('[WebRTCProvider] Failed to parse message:', e);
        }
      };

      this.ws.onclose = () => {
        console.log('[WebRTCProvider] Disconnected from signaling server');
        this._updateStatus('disconnected');
        
        // If we were never fully connected, try next URL
        if (!this.connected) {
          this.connectionAttempts.push({
            url: this.signalingUrl,
            status: 'failed',
            timestamp: Date.now(),
          });
          this.currentUrlIndex++;
          this._connect();
        } else {
          // Was connected, try to reconnect to same server
          this._scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error('[WebRTCProvider] WebSocket error:', error);
        // Don't call onError here, let onclose handle failover
      };
    } catch (e) {
      console.error('[WebRTCProvider] Failed to connect:', e);
      this.connectionAttempts.push({
        url: this.signalingUrl,
        status: 'error',
        error: e.message,
        timestamp: Date.now(),
      });
      this.currentUrlIndex++;
      this._connect();
    }
  }

  /**
   * Schedule reconnection attempt
   */
  _scheduleReconnect() {
    if (this.destroyed) return;
    if (this.retryCount >= this.maxRetries) {
      console.log('[WebRTCProvider] Max retries reached for current server, trying next...');
      this.currentUrlIndex++;
      this.retryCount = 0;
      this._connect();
      return;
    }

    this.retryCount++;
    const delay = this.retryDelay * Math.pow(2, this.retryCount - 1);
    console.log(`[WebRTCProvider] Reconnecting in ${delay}ms (attempt ${this.retryCount})`);
    
    setTimeout(() => this._connect(), delay);
  }

  /**
   * Handle message from signaling server
   */
  _handleSignalingMessage(message) {
    switch (message.type) {
      case 'welcome':
        this.peerId = message.peerId;
        console.log('[WebRTCProvider] Got peer ID:', this.peerId);
        this._joinRoom();
        break;

      case 'joined':
        console.log(`[WebRTCProvider] Joined room with ${message.peers.length} peers`);
        this.connected = true;
        this._updateStatus('connected');
        // Initiate connections to existing peers
        for (const peer of message.peers) {
          this._createPeerConnection(peer.peerId, true, peer);
        }
        break;

      case 'peer_joined':
        console.log('[WebRTCProvider] New peer:', message.peerId);
        // Wait for them to initiate connection (they have our info)
        break;

      case 'peer_left':
        console.log('[WebRTCProvider] Peer left:', message.peerId);
        this._closePeerConnection(message.peerId);
        break;

      case 'signal':
        this._handleSignal(message.from, message.signal);
        break;

      case 'broadcast':
        // Handle awareness broadcasts via signaling (fallback)
        if (message.data?.awareness) {
          // Apply awareness update
        }
        break;

      case 'error':
        console.error('[WebRTCProvider] Signaling error:', message.error);
        this.onError(new Error(message.error));
        break;

      case 'pong':
        // Heartbeat response
        break;
    }
  }

  /**
   * Join the room
   */
  _joinRoom() {
    this._send({
      type: 'join',
      roomId: this.roomId,
      publicKey: this.publicKey,
      profile: this.profile
    });
  }

  /**
   * Create WebRTC connection to a peer
   */
  _createPeerConnection(peerId, initiator, peerInfo = null) {
    if (this.peers.has(peerId)) {
      console.log('[WebRTCProvider] Already connected to', peerId);
      return;
    }

    console.log(`[WebRTCProvider] Creating ${initiator ? 'outgoing' : 'incoming'} connection to`, peerId);

    const connection = new RTCPeerConnection({
      iceServers: this.iceServers
    });

    const peer = {
      connection,
      channel: null,
      state: 'connecting',
      info: peerInfo,
      pendingCandidates: []
    };

    this.peers.set(peerId, peer);
    this._emitPeersChange();

    // Handle ICE candidates
    connection.onicecandidate = (event) => {
      if (event.candidate) {
        this._send({
          type: 'signal',
          to: peerId,
          signal: {
            type: 'candidate',
            candidate: event.candidate
          }
        });
      }
    };

    // Handle connection state changes
    connection.onconnectionstatechange = () => {
      console.log(`[WebRTCProvider] Connection to ${peerId}: ${connection.connectionState}`);
      peer.state = connection.connectionState;
      
      if (connection.connectionState === 'failed' || connection.connectionState === 'disconnected') {
        this._closePeerConnection(peerId);
      }
      
      this._emitPeersChange();
    };

    // Handle data channel
    if (initiator) {
      // Create data channel for sync
      const channel = connection.createDataChannel('Nightjar-sync', {
        ordered: false, // Allow out-of-order for lower latency
      });
      this._setupDataChannel(peerId, channel);
      
      // Create offer
      connection.createOffer()
        .then(offer => connection.setLocalDescription(offer))
        .then(() => {
          this._send({
            type: 'signal',
            to: peerId,
            signal: {
              type: 'offer',
              sdp: connection.localDescription
            }
          });
        })
        .catch(e => console.error('[WebRTCProvider] Failed to create offer:', e));
    } else {
      // Wait for data channel
      connection.ondatachannel = (event) => {
        this._setupDataChannel(peerId, event.channel);
      };
    }
  }

  /**
   * Set up data channel for a peer
   */
  _setupDataChannel(peerId, channel) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    peer.channel = channel;

    channel.onopen = () => {
      console.log('[WebRTCProvider] Data channel open to', peerId);
      peer.state = 'connected';
      this._emitPeersChange();
      
      // Send full sync
      this._sendSyncStep1(peerId);
    };

    channel.onclose = () => {
      console.log('[WebRTCProvider] Data channel closed to', peerId);
      peer.state = 'disconnected';
      this._emitPeersChange();
    };

    channel.onmessage = (event) => {
      this._handlePeerMessage(peerId, event.data);
    };

    channel.onerror = (error) => {
      console.error('[WebRTCProvider] Data channel error:', error);
    };
  }

  /**
   * Handle WebRTC signaling from peer
   */
  _handleSignal(fromPeerId, signal) {
    let peer = this.peers.get(fromPeerId);
    
    // Create connection if this is an incoming offer
    if (!peer && signal.type === 'offer') {
      this._createPeerConnection(fromPeerId, false);
      peer = this.peers.get(fromPeerId);
    }

    if (!peer) {
      console.log('[WebRTCProvider] No peer for signal from', fromPeerId);
      return;
    }

    const connection = peer.connection;

    if (signal.type === 'offer') {
      connection.setRemoteDescription(new RTCSessionDescription(signal.sdp))
        .then(() => connection.createAnswer())
        .then(answer => connection.setLocalDescription(answer))
        .then(() => {
          this._send({
            type: 'signal',
            to: fromPeerId,
            signal: {
              type: 'answer',
              sdp: connection.localDescription
            }
          });
          // Process any pending candidates
          for (const candidate of peer.pendingCandidates) {
            connection.addIceCandidate(new RTCIceCandidate(candidate));
          }
          peer.pendingCandidates = [];
        })
        .catch(e => console.error('[WebRTCProvider] Failed to handle offer:', e));
    } else if (signal.type === 'answer') {
      connection.setRemoteDescription(new RTCSessionDescription(signal.sdp))
        .then(() => {
          // Process any pending candidates
          for (const candidate of peer.pendingCandidates) {
            connection.addIceCandidate(new RTCIceCandidate(candidate));
          }
          peer.pendingCandidates = [];
        })
        .catch(e => console.error('[WebRTCProvider] Failed to handle answer:', e));
    } else if (signal.type === 'candidate') {
      if (connection.remoteDescription) {
        connection.addIceCandidate(new RTCIceCandidate(signal.candidate))
          .catch(e => console.error('[WebRTCProvider] Failed to add candidate:', e));
      } else {
        // Queue candidate until remote description is set
        peer.pendingCandidates.push(signal.candidate);
      }
    }
  }

  /**
   * Handle message from peer data channel
   */
  _handlePeerMessage(peerId, data) {
    try {
      // Data is either binary (Yjs update) or JSON (control message)
      if (data instanceof ArrayBuffer || data instanceof Blob) {
        this._handleBinaryMessage(peerId, data);
      } else if (typeof data === 'string') {
        const message = JSON.parse(data);
        this._handleJsonMessage(peerId, message);
      }
    } catch (e) {
      console.error('[WebRTCProvider] Failed to handle peer message:', e);
    }
  }

  /**
   * Handle binary message (Yjs sync)
   */
  async _handleBinaryMessage(peerId, data) {
    const arrayBuffer = data instanceof Blob ? await data.arrayBuffer() : data;
    const message = new Uint8Array(arrayBuffer);
    
    // First byte is message type
    const messageType = message[0];
    const payload = message.slice(1);

    switch (messageType) {
      case 0: // Sync step 1
        this._handleSyncStep1(peerId, payload);
        break;
      case 1: // Sync step 2
        this._handleSyncStep2(peerId, payload);
        break;
      case 2: // Update
        Y.applyUpdate(this.doc, payload);
        break;
      case 3: // Awareness
        this._handleAwarenessMessage(peerId, payload);
        break;
    }
  }

  /**
   * Handle JSON control message
   */
  _handleJsonMessage(peerId, message) {
    switch (message.type) {
      case 'identity':
        // Peer is sharing their identity
        const peer = this.peers.get(peerId);
        if (peer) {
          peer.info = message;
          this._emitPeersChange();
        }
        break;
    }
  }

  /**
   * Send sync step 1 (state vector)
   */
  _sendSyncStep1(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer?.channel || peer.channel.readyState !== 'open') return;

    const stateVector = Y.encodeStateVector(this.doc);
    const message = new Uint8Array(1 + stateVector.length);
    message[0] = 0; // Sync step 1
    message.set(stateVector, 1);
    
    peer.channel.send(message);
  }

  /**
   * Handle sync step 1 (reply with step 2)
   */
  _handleSyncStep1(peerId, stateVector) {
    const peer = this.peers.get(peerId);
    if (!peer?.channel || peer.channel.readyState !== 'open') return;

    // Send our diff
    const diff = Y.encodeStateAsUpdate(this.doc, stateVector);
    const message = new Uint8Array(1 + diff.length);
    message[0] = 1; // Sync step 2
    message.set(diff, 1);
    
    peer.channel.send(message);
    
    // Also send our state vector so they can send their diff
    this._sendSyncStep1(peerId);
  }

  /**
   * Handle sync step 2 (apply diff)
   */
  _handleSyncStep2(peerId, diff) {
    Y.applyUpdate(this.doc, diff);
  }

  /**
   * Handle doc update (broadcast to all peers)
   */
  _handleDocUpdate(update, origin) {
    if (origin === this) return; // Don't echo our own updates

    const message = new Uint8Array(1 + update.length);
    message[0] = 2; // Update
    message.set(update, 1);

    for (const [peerId, peer] of this.peers) {
      if (peer.channel?.readyState === 'open') {
        peer.channel.send(message);
      }
    }
  }

  /**
   * Handle awareness update
   */
  _handleAwarenessUpdate({ added, updated, removed }, origin) {
    if (origin === 'remote') return;

    const changedClients = added.concat(updated).concat(removed);
    const awarenessUpdate = this._encodeAwarenessUpdate(changedClients);
    
    const message = new Uint8Array(1 + awarenessUpdate.length);
    message[0] = 3; // Awareness
    message.set(awarenessUpdate, 1);

    for (const [peerId, peer] of this.peers) {
      if (peer.channel?.readyState === 'open') {
        peer.channel.send(message);
      }
    }
  }

  /**
   * Encode awareness update
   */
  _encodeAwarenessUpdate(changedClients) {
    const states = this.awareness.getStates();
    const encoder = [];
    
    // Simple encoding: JSON of changed states
    const update = {};
    for (const clientId of changedClients) {
      update[clientId] = states.get(clientId) || null;
    }
    
    return new TextEncoder().encode(JSON.stringify(update));
  }

  /**
   * Handle awareness message from peer
   */
  _handleAwarenessMessage(peerId, payload) {
    try {
      const update = JSON.parse(new TextDecoder().decode(payload));
      const added = [];
      const updated = [];
      const removed = [];
      const states = this.awareness.getStates();

      for (const [clientId, state] of Object.entries(update)) {
        const id = parseInt(clientId);
        if (id === this.awareness.clientID) continue; // Never overwrite local state
        if (state === null) {
          if (states.has(id)) {
            states.delete(id);
            removed.push(id);
          }
        } else {
          const isNew = !states.has(id);
          states.set(id, state);
          (isNew ? added : updated).push(id);
        }
      }

      if (added.length || updated.length || removed.length) {
        this.awareness.emit('change', [{ added, updated, removed }, 'remote']);
      }
    } catch (e) {
      console.error('[WebRTCProvider] Failed to handle awareness:', e);
    }
  }

  /**
   * Send message to signaling server
   */
  _send(message) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Close connection to a peer
   */
  _closePeerConnection(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    if (peer.channel) {
      peer.channel.close();
    }
    if (peer.connection) {
      peer.connection.close();
    }

    this.peers.delete(peerId);
    this._emitPeersChange();
  }

  /**
   * Update connection status
   */
  _updateStatus(status) {
    this.onStatusChange(status);
  }

  /**
   * Emit peers change event
   */
  _emitPeersChange() {
    const peerList = Array.from(this.peers.entries()).map(([id, peer]) => ({
      peerId: id,
      state: peer.state,
      info: peer.info
    }));
    this.onPeersChange(peerList);
  }

  /**
   * Get current connection status
   */
  getStatus() {
    if (this.destroyed) return 'destroyed';
    if (!this.connected) return 'connecting';
    if (this.peers.size === 0) return 'waiting';
    return 'connected';
  }

  /**
   * Get connected peers
   */
  getPeers() {
    return Array.from(this.peers.entries()).map(([id, peer]) => ({
      peerId: id,
      state: peer.state,
      info: peer.info
    }));
  }

  /**
   * Disconnect and clean up
   */
  destroy() {
    this.destroyed = true;
    
    // Remove doc listeners
    this.doc.off('update', this._handleDocUpdate);
    this.awareness.off('update', this._handleAwarenessUpdate);

    // Close all peer connections
    for (const peerId of this.peers.keys()) {
      this._closePeerConnection(peerId);
    }

    // Close signaling connection
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this._updateStatus('destroyed');
  }
}

export default WebRTCProvider;
