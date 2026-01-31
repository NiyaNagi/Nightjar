/**
 * Provider Factory
 * 
 * Creates the appropriate sync provider based on the runtime environment.
 * - Electron: Uses Hyperswarm (native P2P)
 * - Browser: Uses WebRTC (with signaling server)
 * 
 * Both providers implement the same interface for Yjs sync.
 */

import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { WebRTCProvider } from './WebRTCProvider';

/**
 * Detect runtime environment
 */
export function getEnvironment() {
  // Check for Electron
  if (typeof window !== 'undefined' && window.process?.type === 'renderer') {
    return 'electron';
  }
  
  // Check for Node.js (server-side)
  if (typeof process !== 'undefined' && process.versions?.node) {
    return 'node';
  }
  
  // Check for browser
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    return 'browser';
  }
  
  return 'unknown';
}

/**
 * Check if running in Electron
 */
export function isElectron() {
  return getEnvironment() === 'electron';
}

/**
 * Check if running in browser
 */
export function isBrowser() {
  return getEnvironment() === 'browser';
}

/**
 * Check if running in Node.js
 */
export function isNode() {
  return getEnvironment() === 'node';
}

/**
 * Get default signaling server URL based on environment
 */
export function getDefaultSignalingUrl() {
  if (typeof window !== 'undefined') {
    // Use same host as the web app
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/signal`;
  }
  return 'ws://localhost:4444';
}

/**
 * Provider configuration
 */
export const DEFAULT_CONFIG = {
  // Signaling
  signalingUrl: null, // Will use getDefaultSignalingUrl() if not set
  
  // WebRTC ICE servers
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
  
  // Connection settings
  maxRetries: 5,
  retryDelay: 2000,
};

/**
 * Unified provider interface wrapper
 * Provides consistent API regardless of underlying transport
 */
export class SyncProvider {
  constructor(roomId, ydoc, options = {}) {
    this.roomId = roomId;
    this.doc = ydoc;
    this.options = { ...DEFAULT_CONFIG, ...options };
    this.provider = null;
    this.awareness = options.awareness || new Awareness(ydoc);
    this.environment = getEnvironment();
    
    // Status tracking
    this._status = 'initializing';
    this._peers = [];
    this._listeners = new Map();
    
    // Initialize appropriate provider
    this._initialize();
  }

  /**
   * Initialize the appropriate provider for this environment
   */
  async _initialize() {
    const signalingUrl = this.options.signalingUrl || getDefaultSignalingUrl();
    
    if (this.environment === 'electron') {
      // Use Electron IPC to Hyperswarm
      await this._initializeElectronProvider();
    } else if (this.environment === 'browser') {
      // Use WebRTC
      this._initializeWebRTCProvider(signalingUrl);
    } else if (this.environment === 'node') {
      // Server-side - use WebSocket or Hyperswarm
      await this._initializeNodeProvider();
    } else {
      console.error('[SyncProvider] Unknown environment:', this.environment);
      this._setStatus('error');
    }
  }

  /**
   * Initialize Electron provider (Hyperswarm via IPC)
   */
  async _initializeElectronProvider() {
    try {
      // Use existing Electron IPC mechanism
      if (window.electronAPI) {
        // The existing HyperswarmProvider should handle this
        // This is a pass-through to the existing implementation
        const { HyperswarmProvider } = await import('./HyperswarmProvider');
        this.provider = new HyperswarmProvider(this.roomId, this.doc, {
          awareness: this.awareness,
          ...this.options
        });
        
        // Proxy status
        this.provider.on('status', (status) => this._setStatus(status));
        this.provider.on('peers', (peers) => this._setPeers(peers));
      } else {
        // Fallback to WebRTC if Electron IPC not available
        console.warn('[SyncProvider] Electron IPC not available, falling back to WebRTC');
        this._initializeWebRTCProvider(this.options.signalingUrl || getDefaultSignalingUrl());
      }
    } catch (e) {
      console.error('[SyncProvider] Failed to initialize Electron provider:', e);
      this._setStatus('error');
    }
  }

  /**
   * Initialize WebRTC provider
   */
  _initializeWebRTCProvider(signalingUrl) {
    this.provider = new WebRTCProvider(this.roomId, this.doc, {
      awareness: this.awareness,
      signalingUrl,
      iceServers: this.options.iceServers,
      publicKey: this.options.publicKey,
      profile: this.options.profile,
      maxRetries: this.options.maxRetries,
      retryDelay: this.options.retryDelay,
      onStatusChange: (status) => this._setStatus(status),
      onPeersChange: (peers) => this._setPeers(peers),
      onError: (error) => this._emit('error', error)
    });
  }

  /**
   * Initialize Node.js provider (for persistence node)
   */
  async _initializeNodeProvider() {
    // For server-side, we'll use WebSocket or Hyperswarm
    // This will be implemented in the persistence node
    console.log('[SyncProvider] Node.js environment - use HyperswarmProvider directly');
    this._setStatus('connected');
  }

  /**
   * Set status and emit event
   */
  _setStatus(status) {
    this._status = status;
    this._emit('status', status);
  }

  /**
   * Set peers and emit event
   */
  _setPeers(peers) {
    this._peers = peers;
    this._emit('peers', peers);
  }

  /**
   * Emit event to listeners
   */
  _emit(event, data) {
    const listeners = this._listeners.get(event) || [];
    for (const listener of listeners) {
      try {
        listener(data);
      } catch (e) {
        console.error(`[SyncProvider] Event listener error (${event}):`, e);
      }
    }
  }

  /**
   * Add event listener
   */
  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event).push(callback);
    return () => this.off(event, callback);
  }

  /**
   * Remove event listener
   */
  off(event, callback) {
    const listeners = this._listeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * Get current status
   */
  get status() {
    return this._status;
  }

  /**
   * Get connected peers
   */
  get peers() {
    return this._peers;
  }

  /**
   * Get awareness instance
   */
  getAwareness() {
    return this.awareness;
  }

  /**
   * Check if connected
   */
  get connected() {
    return this._status === 'connected';
  }

  /**
   * Disconnect and clean up
   */
  destroy() {
    if (this.provider) {
      this.provider.destroy?.();
      this.provider = null;
    }
    this._listeners.clear();
    this._setStatus('destroyed');
  }
}

/**
 * Create a sync provider for a workspace
 */
export function createSyncProvider(roomId, ydoc, options = {}) {
  return new SyncProvider(roomId, ydoc, options);
}

/**
 * Create awareness with local user info
 */
export function createAwareness(ydoc, userInfo = {}) {
  const awareness = new Awareness(ydoc);
  
  awareness.setLocalStateField('user', {
    name: userInfo.name || 'Anonymous',
    color: userInfo.color || '#' + Math.floor(Math.random() * 16777215).toString(16),
    icon: userInfo.icon || '👤',
    ...userInfo
  });
  
  return awareness;
}

export default SyncProvider;
