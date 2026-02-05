/**
 * WebSocket URL Utilities
 * 
 * Centralized WebSocket URL generation for consistent connectivity.
 * Electron connects to local sidecar; Web connects to deployment host.
 * 
 * For cross-platform sharing, a serverUrl can be passed to override
 * the default behavior - allowing Electron to connect to remote web servers.
 * 
 * P2P Mode:
 * When P2P is enabled via P2PContext, the getWebSocketPolyfill function
 * returns a P2P-aware adapter instead of raw WebSocket.
 */

import { isElectron } from '../hooks/useEnvironment';

// Sidecar ports (Electron only)
const SIDECAR_YJS_PORT = 8080;
const SIDECAR_METADATA_PORT = 8081;

// Global P2P configuration (set by P2PContext)
let globalP2PConfig = {
  enabled: false,
  getWebSocketFactory: null,
};

/**
 * Set the global P2P configuration
 * Called by P2PContext to enable P2P mode application-wide
 * @param {Object} config - P2P configuration
 */
export function setP2PConfig(config) {
  globalP2PConfig = { ...globalP2PConfig, ...config };
}

/**
 * Get WebSocket constructor/factory for Yjs providers
 * Returns P2P adapter when P2P is enabled, otherwise native WebSocket
 * @param {Object} options - Options passed to P2P adapter
 * @returns {Function} WebSocket constructor or P2P factory
 */
export function getWebSocketPolyfill(options = {}) {
  if (globalP2PConfig.enabled && globalP2PConfig.getWebSocketFactory) {
    return globalP2PConfig.getWebSocketFactory(options);
  }
  return WebSocket;
}

/**
 * Get the WebSocket URL for Yjs document sync
 * @param {string|null} serverUrl - Optional remote server URL (for cross-platform workspaces)
 * @returns {string}
 */
export function getYjsWebSocketUrl(serverUrl = null) {
    const isElectronMode = isElectron();
    let url;
    
    // If a remote serverUrl is provided, use it (cross-platform sharing)
    if (serverUrl) {
        // Convert http(s) URL to ws(s) URL
        const wsUrl = serverUrl
            .replace(/^https:/, 'wss:')
            .replace(/^http:/, 'ws:');
        url = wsUrl;
        console.log(`[WebSocket] getYjsWebSocketUrl(serverUrl: ${serverUrl}) => ${url} (remote workspace)`);
        return url;
    }
    
    // Check for mobile relay preference (non-Electron mode)
    if (!isElectronMode) {
        try {
            const useRelay = localStorage.getItem('Nightjar_use_relay') === 'true';
            const relayUrl = localStorage.getItem('Nightjar_relay_url');
            if (useRelay && relayUrl) {
                const wsUrl = relayUrl
                    .replace(/^https:/, 'wss:')
                    .replace(/^http:/, 'ws:');
                console.log(`[WebSocket] getYjsWebSocketUrl() => ${wsUrl} (mobile relay)`);
                return wsUrl;
            }
        } catch (e) {
            // Ignore localStorage errors
        }
    }
    
    if (isElectronMode) {
        url = `ws://localhost:${SIDECAR_YJS_PORT}`;
    } else {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host || 'localhost:3000';
        url = `${protocol}//${host}`;
    }
    console.log(`[WebSocket] getYjsWebSocketUrl() => ${url} (isElectron: ${isElectronMode})`);
    return url;
}

/**
 * Get the WebSocket URL for metadata sync (sidecar)
 * @returns {string | null} Returns null for web (no sidecar)
 */
export function getMetadataWebSocketUrl() {
    if (isElectron()) {
        return `ws://localhost:${SIDECAR_METADATA_PORT}`;
    }
    // Web mode uses the same connection as Yjs
    return null;
}

/**
 * Get the base URL for HTTP API calls
 * @returns {string}
 */
export function getApiBaseUrl() {
    if (isElectron()) {
        return 'http://localhost:3000';
    }
    return window.location.origin;
}

/**
 * Alias for backwards compatibility
 */
export const getWsUrl = getYjsWebSocketUrl;

export default {
    getYjsWebSocketUrl,
    getMetadataWebSocketUrl,
    getApiBaseUrl,
    getWsUrl,
    getWebSocketPolyfill,
    setP2PConfig,
};
