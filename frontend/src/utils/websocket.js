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
import { YJS_WS_PORT, META_WS_PORT, WEB_SERVER_PORT } from '../config/constants';
import nacl from 'tweetnacl';
import { getUnlockedIdentity } from './identityManager';
import { computeRoomAuthToken, computeRoomAuthTokenSync } from './roomAuth';

// Re-export for convenience
export { computeRoomAuthToken, computeRoomAuthTokenSync };

/**
 * Get the deployment base path (e.g., '/app' for sub-path deployments).
 * Injected by the server at runtime via <script> tag in index.html.
 * Returns empty string for root deployments.
 */
export function getBasePath() {
  return (typeof window !== 'undefined' && window.__NIGHTJAR_BASE_PATH__) || '';
}

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
 * @param {string|null} authToken - Optional HMAC auth token for room authentication (Fix 4)
 * @returns {string}
 */
export function getYjsWebSocketUrl(serverUrl = null, authToken = null) {
    const isElectronMode = isElectron();
    let url;
    
    // Helper to append auth token as query parameter
    const appendAuth = (baseUrl) => {
        if (!authToken) return baseUrl;
        const separator = baseUrl.includes('?') ? '&' : '?';
        return `${baseUrl}${separator}auth=${encodeURIComponent(authToken)}`;
    };
    
    // If a remote serverUrl is provided, use it (cross-platform sharing)
    if (serverUrl) {
        // Validate the URL scheme - reject file:// and other invalid schemes
        const lowerUrl = serverUrl.toLowerCase();
        if (lowerUrl.startsWith('file:')) {
            console.warn(`[WebSocket] Invalid serverUrl: file:// protocol cannot be used for WebSocket connections. Using local server.`);
            // Fall through to use local server instead
        } else if (lowerUrl.startsWith('ws:') || lowerUrl.startsWith('wss:') || 
                   lowerUrl.startsWith('http:') || lowerUrl.startsWith('https:')) {
            // Convert http(s) URL to ws(s) URL
            const wsUrl = serverUrl
                .replace(/^https:/i, 'wss:')
                .replace(/^http:/i, 'ws:');
            url = wsUrl;
            console.log(`[WebSocket] getYjsWebSocketUrl(serverUrl: ${serverUrl}) => ${url} (remote workspace)`);
            return appendAuth(url);
        } else {
            console.warn(`[WebSocket] Invalid serverUrl protocol: ${serverUrl}. Using local server.`);
            // Fall through to use local server instead
        }
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
                return appendAuth(wsUrl);
            }
        } catch (e) {
            // Ignore localStorage errors
        }
    }
    
    if (isElectronMode) {
        url = `ws://localhost:${YJS_WS_PORT}`;
    } else {
        // Check if we're in a file:// context (Electron with failed preload)
        // This is a fallback - normally isElectron() would be true
        const protocol = window.location.protocol;
        if (protocol === 'file:') {
            // We're likely in Electron but preload failed - use local sidecar
            console.warn('[WebSocket] Detected file:// protocol but isElectron=false. Using local sidecar as fallback.');
            url = `ws://localhost:${YJS_WS_PORT}`;
        } else {
            const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
            const host = window.location.host || `localhost:${WEB_SERVER_PORT}`;
            const basePath = getBasePath();
            url = `${wsProtocol}//${host}${basePath}`;
        }
    }
    console.log(`[WebSocket] getYjsWebSocketUrl() => ${url} (isElectron: ${isElectronMode})`);
    return appendAuth(url);
}

/**
 * Get the WebSocket URL for metadata sync (sidecar)
 * @returns {string | null} Returns null for web (no sidecar)
 */
export function getMetadataWebSocketUrl() {
    if (isElectron()) {
        return `ws://localhost:${META_WS_PORT}`;
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
        return `http://localhost:${WEB_SERVER_PORT}`;
    }
    return window.location.origin + getBasePath();
}

/**
 * Deliver an encryption key to the server for a specific room.
 * Must be called BEFORE creating the WebSocket provider so the server
 * can decrypt persisted state during bindState.
 * 
 * Only sends the key in web mode when the server has encrypted persistence enabled.
 * In Electron mode, keys are sent to the sidecar via WebSocket (different path).
 * 
 * @param {string} roomName - The Yjs room name
 * @param {string} keyBase64 - Base64-encoded 32-byte encryption key
 * @param {string|null} serverUrl - Optional remote server URL
 * @returns {Promise<boolean>} True if key was delivered (or not needed), false on error
 */
export async function deliverKeyToServer(roomName, keyBase64, serverUrl = null) {
    // Skip in Electron mode — keys go to sidecar via WebSocket
    if (isElectron() && !serverUrl) {
        return true;
    }
    
    if (!roomName || !keyBase64) {
        console.warn('[KeyDelivery] Missing roomName or key');
        return false;
    }

    try {
        // Determine the API base URL
        let apiBase;
        if (serverUrl) {
            // Remote server: convert ws(s) URL to http(s)
            apiBase = serverUrl
                .replace(/^wss:/i, 'https:')
                .replace(/^ws:/i, 'http:');
        } else {
            apiBase = getApiBaseUrl();
        }

        // First check if server has encrypted persistence enabled
        const checkRes = await fetch(`${apiBase}/api/encrypted-persistence`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
        });
        
        if (!checkRes.ok) {
            // Server might not support this endpoint (older version) — that's fine
            console.debug('[KeyDelivery] Server does not support encrypted persistence check');
            return true;
        }
        
        const { enabled } = await checkRes.json();
        if (!enabled) {
            // Encrypted persistence not enabled on this server — no need to send key
            console.debug('[KeyDelivery] Server does not have encrypted persistence enabled');
            return true;
        }

        // Deliver the key with Ed25519 signature for authentication
        const encodedRoom = encodeURIComponent(roomName);
        const timestamp = Date.now();
        
        // Build the request body — always include the key
        const body = { key: keyBase64, timestamp };
        
        // Sign the request if identity is available (backward-compatible: server
        // accepts unsigned requests from older clients but verifies if present)
        try {
            const unlockedIdentity = getUnlockedIdentity();
            if (unlockedIdentity?.identityData?.keypair) {
                const { secretKey, publicKey } = unlockedIdentity.identityData.keypair;
                if (secretKey && publicKey) {
                    const signedMessage = `key-delivery:${roomName}:${keyBase64}:${timestamp}`;
                    const messageBytes = new TextEncoder().encode(signedMessage);
                    const signature = nacl.sign.detached(messageBytes, secretKey);
                    
                    // Convert to base64 for JSON transport
                    let pubBinary = '';
                    for (let i = 0; i < publicKey.length; i++) pubBinary += String.fromCharCode(publicKey[i]);
                    let sigBinary = '';
                    for (let i = 0; i < signature.length; i++) sigBinary += String.fromCharCode(signature[i]);
                    
                    body.publicKey = btoa(pubBinary);
                    body.signature = btoa(sigBinary);
                }
            }
        } catch (signErr) {
            // Signing failed — proceed without signature (backward compat)
            console.debug('[KeyDelivery] Could not sign key delivery (identity may not be unlocked):', signErr.message);
        }
        
        const res = await fetch(`${apiBase}/api/rooms/${encodedRoom}/key`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Unknown error' }));
            console.error(`[KeyDelivery] Failed to deliver key for ${roomName}: ${err.error}`);
            return false;
        }

        console.log(`[KeyDelivery] Key delivered for room: ${roomName.slice(0, 30)}...`);
        return true;
    } catch (e) {
        console.error(`[KeyDelivery] Error delivering key for ${roomName}:`, e);
        return false;
    }
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
    deliverKeyToServer,
};
