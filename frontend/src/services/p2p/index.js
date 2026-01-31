/**
 * P2P Services - Main exports
 * 
 * Provides unified P2P layer for all client types (Electron, Browser, Mobile).
 */

// Core
export { PeerManager, getPeerManager, destroyPeerManager } from './PeerManager.js';
export { BootstrapManager } from './BootstrapManager.js';
export { AwarenessManager } from './AwarenessManager.js';

// Transports
export { BaseTransport, EventEmitter } from './transports/BaseTransport.js';
export { WebSocketTransport } from './transports/WebSocketTransport.js';
export { WebRTCTransport } from './transports/WebRTCTransport.js';
export { HyperswarmTransport } from './transports/HyperswarmTransport.js';
export { mDNSTransport } from './transports/mDNSTransport.js';

// Protocol
export * from './protocol/messages.js';
export * from './protocol/serialization.js';

// Adapters
export { P2PWebSocketAdapter, createP2PWebSocketPolyfill } from './P2PWebSocketAdapter.js';
