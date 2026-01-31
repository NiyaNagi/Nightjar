/**
 * AwarenessManager - Unified awareness sync across all transports
 * 
 * Aggregates awareness from all P2P transports, deduplicates by timestamp,
 * and provides unified awareness state to the application.
 */

import { EventEmitter } from './transports/BaseTransport.js';
import { createAwarenessMessage, MessageTypes } from './protocol/messages.js';

export class AwarenessManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.throttleMs = config.throttleMs || 100; // Max 10 updates/sec
    
    this.localClientId = null;
    this.localState = null;
    this.remoteStates = new Map(); // clientId -> { state, timestamp, peerId }
    this.lastBroadcast = 0;
    this.pendingBroadcast = null;
    this.peerManager = null;
    this.docId = null;
    
    // Track which peers have which clients (for cleanup on disconnect)
    this.peerClients = new Map(); // peerId -> Set<clientId>
  }

  /**
   * Initialize with PeerManager and document ID
   */
  initialize(peerManager, docId, localClientId) {
    this.peerManager = peerManager;
    this.docId = docId;
    this.localClientId = localClientId || this._generateClientId();
    
    // Listen for awareness messages from PeerManager
    this.peerManager.on('message', this._handleMessage.bind(this));
    this.peerManager.on('peer-disconnected', this._handlePeerDisconnect.bind(this));
  }

  /**
   * Generate a unique client ID
   */
  _generateClientId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Set local awareness state
   */
  setLocalState(state) {
    this.localState = {
      ...state,
      clientId: this.localClientId,
      timestamp: Date.now(),
    };
    
    this._scheduleBroadcast();
    this.emit('change', this.getStates());
  }

  /**
   * Update a specific field in local state
   */
  setLocalStateField(field, value) {
    if (!this.localState) {
      this.localState = { clientId: this.localClientId };
    }
    
    this.localState[field] = value;
    this.localState.timestamp = Date.now();
    
    this._scheduleBroadcast();
    this.emit('change', this.getStates());
  }

  /**
   * Get local awareness state
   */
  getLocalState() {
    return this.localState;
  }

  /**
   * Schedule a throttled broadcast
   */
  _scheduleBroadcast() {
    const now = Date.now();
    const timeSinceLastBroadcast = now - this.lastBroadcast;
    
    if (timeSinceLastBroadcast >= this.throttleMs) {
      // Can broadcast immediately
      this._broadcast();
    } else if (!this.pendingBroadcast) {
      // Schedule broadcast
      const delay = this.throttleMs - timeSinceLastBroadcast;
      this.pendingBroadcast = setTimeout(() => {
        this.pendingBroadcast = null;
        this._broadcast();
      }, delay);
    }
    // Else: broadcast already scheduled, will include latest state
  }

  /**
   * Broadcast local state to all peers
   */
  async _broadcast() {
    if (!this.peerManager || !this.localState) return;
    
    this.lastBroadcast = Date.now();
    
    const message = createAwarenessMessage(this.docId, {
      [this.localClientId]: this.localState,
    });
    
    try {
      await this.peerManager.broadcast(message);
    } catch (error) {
      console.warn('[AwarenessManager] Broadcast failed:', error.message);
    }
  }

  /**
   * Handle incoming message
   */
  _handleMessage(event) {
    const { peerId, message } = event;
    
    if (message.type !== MessageTypes.AWARENESS) return;
    if (message.docId !== this.docId) return;
    
    this._applyRemote(peerId, message.states, message.timestamp);
  }

  /**
   * Apply remote awareness states
   */
  _applyRemote(peerId, states, messageTimestamp) {
    if (!states || typeof states !== 'object') return;
    
    let changed = false;
    
    for (const [clientId, state] of Object.entries(states)) {
      // Skip our own state
      if (clientId === this.localClientId) continue;
      
      const existing = this.remoteStates.get(clientId);
      const stateTimestamp = state.timestamp || messageTimestamp;
      
      // Only update if newer
      if (!existing || stateTimestamp > existing.timestamp) {
        this.remoteStates.set(clientId, {
          state,
          timestamp: stateTimestamp,
          peerId,
        });
        
        // Track client -> peer mapping for cleanup
        if (!this.peerClients.has(peerId)) {
          this.peerClients.set(peerId, new Set());
        }
        this.peerClients.get(peerId).add(clientId);
        
        changed = true;
      }
    }
    
    if (changed) {
      this.emit('change', this.getStates());
    }
  }

  /**
   * Handle peer disconnect - remove their awareness states
   */
  _handlePeerDisconnect(event) {
    const { peerId } = event;
    
    const clientIds = this.peerClients.get(peerId);
    if (!clientIds) return;
    
    let changed = false;
    for (const clientId of clientIds) {
      if (this.remoteStates.delete(clientId)) {
        changed = true;
      }
    }
    
    this.peerClients.delete(peerId);
    
    if (changed) {
      this.emit('change', this.getStates());
    }
  }

  /**
   * Get all awareness states (local + remote)
   */
  getStates() {
    const states = {};
    
    // Add local state
    if (this.localState) {
      states[this.localClientId] = this.localState;
    }
    
    // Add remote states
    for (const [clientId, { state }] of this.remoteStates) {
      states[clientId] = state;
    }
    
    return states;
  }

  /**
   * Get states as array (for easier iteration)
   */
  getStatesArray() {
    const states = this.getStates();
    return Object.entries(states).map(([clientId, state]) => ({
      clientId,
      ...state,
      isLocal: clientId === this.localClientId,
    }));
  }

  /**
   * Get count of aware clients
   */
  getClientCount() {
    return (this.localState ? 1 : 0) + this.remoteStates.size;
  }

  /**
   * Remove stale clients (not seen in specified ms)
   */
  removeStale(maxAge = 60000) {
    const now = Date.now();
    let changed = false;
    
    for (const [clientId, { timestamp }] of this.remoteStates) {
      if (now - timestamp > maxAge) {
        this.remoteStates.delete(clientId);
        changed = true;
      }
    }
    
    if (changed) {
      this.emit('change', this.getStates());
    }
  }

  /**
   * Clear all remote states
   */
  clearRemote() {
    this.remoteStates.clear();
    this.peerClients.clear();
    this.emit('change', this.getStates());
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this.pendingBroadcast) {
      clearTimeout(this.pendingBroadcast);
      this.pendingBroadcast = null;
    }
    
    if (this.peerManager) {
      this.peerManager.off('message', this._handleMessage);
      this.peerManager.off('peer-disconnected', this._handlePeerDisconnect);
    }
    
    this.localState = null;
    this.remoteStates.clear();
    this.peerClients.clear();
    this.removeAllListeners();
  }
}
