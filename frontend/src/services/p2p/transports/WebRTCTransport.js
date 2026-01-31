/**
 * WebRTCTransport - Direct peer-to-peer connections via WebRTC
 * 
 * Used by all client types for direct P2P communication.
 * Signaling is relayed through WebSocket connections.
 */

import { BaseTransport } from './BaseTransport.js';
import { encodeMessage, decodeMessage } from '../protocol/serialization.js';

// Default ICE servers for NAT traversal
const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export class WebRTCTransport extends BaseTransport {
  constructor() {
    super('webrtc');
    this.peerConnections = new Map(); // peerId -> RTCPeerConnection
    this.dataChannels = new Map(); // peerId -> RTCDataChannel
    this.pendingCandidates = new Map(); // peerId -> ICECandidate[]
    this.signalingCallback = null; // Function to relay signals
    this.iceServers = DEFAULT_ICE_SERVERS;
  }

  /**
   * Initialize with signaling callback
   */
  async initialize(config) {
    const { peerId, signalingCallback, iceServers } = config;
    this.localPeerId = peerId;
    this.signalingCallback = signalingCallback;
    if (iceServers) {
      this.iceServers = iceServers;
    }
    this.connected = true;
  }

  /**
   * Set the signaling callback (for relaying offers/answers/ICE)
   */
  setSignalingCallback(callback) {
    this.signalingCallback = callback;
  }

  /**
   * Create a new peer connection
   */
  _createPeerConnection(peerId) {
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
    });

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && this.signalingCallback) {
        this.signalingCallback(peerId, {
          type: 'ice-candidate',
          candidate: event.candidate.toJSON(),
        });
      }
    };

    // Handle ICE connection state changes
    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTCTransport] ICE state with ${peerId}: ${pc.iceConnectionState}`);
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      console.log(`[WebRTCTransport] Connection to ${peerId}: ${pc.connectionState}`);
      if (pc.connectionState === 'connected') {
        this._onPeerConnected(peerId, { connectionType: 'webrtc-direct' });
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this._handleDisconnect(peerId);
      }
    };

    // Handle incoming data channels
    pc.ondatachannel = (event) => {
      console.log(`[WebRTCTransport] Incoming data channel from ${peerId}`);
      this._setupDataChannel(peerId, event.channel);
    };

    this.peerConnections.set(peerId, pc);
    this.pendingCandidates.set(peerId, []);
    
    return pc;
  }

  /**
   * Setup data channel event handlers
   */
  _setupDataChannel(peerId, channel) {
    channel.onopen = () => {
      console.log(`[WebRTCTransport] Data channel opened with ${peerId}`);
      this.dataChannels.set(peerId, channel);
      this._onPeerConnected(peerId, { connectionType: 'webrtc-direct' });
    };

    channel.onclose = () => {
      console.log(`[WebRTCTransport] Data channel closed with ${peerId}`);
      this.dataChannels.delete(peerId);
    };

    channel.onerror = (error) => {
      console.error(`[WebRTCTransport] Data channel error with ${peerId}:`, error);
    };

    channel.onmessage = (event) => {
      const message = decodeMessage(event.data);
      if (message) {
        this._onMessage(peerId, message);
      }
    };

    // Store channel reference
    this.dataChannels.set(peerId, channel);
  }

  /**
   * Handle peer disconnect
   */
  _handleDisconnect(peerId) {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(peerId);
    }
    this.dataChannels.delete(peerId);
    this.pendingCandidates.delete(peerId);
    this._onPeerDisconnected(peerId);
  }

  /**
   * Initiate connection to a peer (creates offer)
   */
  async connect(peerId, address) {
    if (this.peerConnections.has(peerId)) {
      console.log(`[WebRTCTransport] Already have connection to ${peerId}`);
      return;
    }

    console.log(`[WebRTCTransport] Initiating connection to ${peerId}`);
    const pc = this._createPeerConnection(peerId);
    
    // Create data channel
    const channel = pc.createDataChannel('p2p-sync', {
      ordered: true,
    });
    this._setupDataChannel(peerId, channel);

    // Create and send offer
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      if (this.signalingCallback) {
        this.signalingCallback(peerId, {
          type: 'offer',
          sdp: pc.localDescription.sdp,
        });
      }
    } catch (error) {
      console.error(`[WebRTCTransport] Failed to create offer for ${peerId}:`, error);
      this._handleDisconnect(peerId);
      throw error;
    }
  }

  /**
   * Handle incoming signaling message
   */
  async handleSignal(fromPeerId, signalData) {
    console.log(`[WebRTCTransport] Signal from ${fromPeerId}:`, signalData.type);
    let pc = this.peerConnections.get(fromPeerId);

    try {
      if (signalData.type === 'offer') {
        // Incoming connection request
        if (!pc) {
          pc = this._createPeerConnection(fromPeerId);
        }

        await pc.setRemoteDescription(new RTCSessionDescription({
          type: 'offer',
          sdp: signalData.sdp,
        }));

        // Apply any pending ICE candidates
        const pending = this.pendingCandidates.get(fromPeerId) || [];
        for (const candidate of pending) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
        this.pendingCandidates.set(fromPeerId, []);

        // Create and send answer
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        if (this.signalingCallback) {
          this.signalingCallback(fromPeerId, {
            type: 'answer',
            sdp: pc.localDescription.sdp,
          });
        }

      } else if (signalData.type === 'answer') {
        // Answer to our offer
        if (pc && pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription({
            type: 'answer',
            sdp: signalData.sdp,
          }));

          // Apply any pending ICE candidates
          const pending = this.pendingCandidates.get(fromPeerId) || [];
          for (const candidate of pending) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          }
          this.pendingCandidates.set(fromPeerId, []);
        }

      } else if (signalData.type === 'ice-candidate' && signalData.candidate) {
        // ICE candidate
        if (pc && pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(new RTCIceCandidate(signalData.candidate));
        } else {
          // Queue candidate for later
          const pending = this.pendingCandidates.get(fromPeerId) || [];
          pending.push(signalData.candidate);
          this.pendingCandidates.set(fromPeerId, pending);
        }
      }
    } catch (error) {
      console.error(`[WebRTCTransport] Error handling signal from ${fromPeerId}:`, error);
    }
  }

  /**
   * Disconnect from a peer
   */
  async disconnect(peerId) {
    this._handleDisconnect(peerId);
  }

  /**
   * Send message to a specific peer
   */
  async send(peerId, message) {
    const channel = this.dataChannels.get(peerId);
    if (!channel || channel.readyState !== 'open') {
      throw new Error(`No open data channel to peer ${peerId}`);
    }
    channel.send(encodeMessage(message));
  }

  /**
   * Broadcast to all connected peers
   */
  async broadcast(message) {
    const encoded = encodeMessage(message);
    for (const [peerId, channel] of this.dataChannels) {
      if (channel.readyState === 'open') {
        try {
          channel.send(encoded);
        } catch (e) {
          console.warn(`[WebRTCTransport] Failed to send to ${peerId}:`, e.message);
        }
      }
    }
  }

  /**
   * Check if we have an open connection to a peer
   */
  isConnected(peerId) {
    const channel = this.dataChannels.get(peerId);
    return channel && channel.readyState === 'open';
  }

  /**
   * Get connected peers
   */
  getConnectedPeers() {
    const connected = [];
    for (const [peerId, channel] of this.dataChannels) {
      if (channel.readyState === 'open') {
        connected.push(peerId);
      }
    }
    return connected;
  }

  /**
   * Cleanup
   */
  async destroy() {
    for (const [peerId, pc] of this.peerConnections) {
      pc.close();
    }
    this.peerConnections.clear();
    this.dataChannels.clear();
    this.pendingCandidates.clear();
    this.signalingCallback = null;
    await super.destroy();
  }
}
