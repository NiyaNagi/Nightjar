/**
 * P2P Configuration Context
 * 
 * Provides configuration for P2P mesh networking.
 * When P2P is enabled, the P2PWebSocketAdapter is used instead of raw WebSockets.
 * 
 * This context allows components to check if P2P is enabled and access
 * the P2P-aware WebSocket factory.
 */

import React, { createContext, useContext, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { P2PWebSocketAdapter, createP2PWebSocketPolyfill, getPeerManager } from '../services/p2p/index.js';
import { setP2PConfig } from '../utils/websocket.js';

// Default configuration
const DEFAULT_P2P_CONFIG = {
  enabled: false,
  maxConnections: 50,
  useWebRTC: true,
  useHyperswarm: true, // Only works in Electron
  useMDNS: true, // Only works in Electron
};

const P2PContext = createContext(null);

/**
 * Hook to access P2P configuration and utilities
 */
export function useP2P() {
  const context = useContext(P2PContext);
  if (!context) {
    // Return default non-P2P behavior if provider not present
    return {
      isEnabled: false,
      peerManager: null,
      getWebSocketFactory: () => WebSocket,
      connectedPeers: 0,
      config: DEFAULT_P2P_CONFIG,
    };
  }
  return context;
}

/**
 * P2P Provider Component
 */
export function P2PProvider({ children, config = {} }) {
  const [isEnabled, setIsEnabled] = useState(config.enabled ?? DEFAULT_P2P_CONFIG.enabled);
  const [connectedPeers, setConnectedPeers] = useState(0);
  const [isInitialized, setIsInitialized] = useState(false);
  
  const peerManagerRef = useRef(null);
  const configRef = useRef({ ...DEFAULT_P2P_CONFIG, ...config });
  
  // Update config ref when config changes
  useEffect(() => {
    configRef.current = { ...DEFAULT_P2P_CONFIG, ...config };
    setIsEnabled(config.enabled ?? DEFAULT_P2P_CONFIG.enabled);
  }, [config]);

  /**
   * Get WebSocket factory for y-websocket WebsocketProvider
   * 
   * When P2P is enabled, returns P2PWebSocketAdapter factory.
   * Otherwise returns native WebSocket.
   * 
   * Defined early so it can be used in the global config sync.
   */
  const getWebSocketFactory = useCallback((options = {}) => {
    if (!isEnabled) {
      // Return native WebSocket constructor
      return WebSocket;
    }

    // Return P2P-aware factory
    return createP2PWebSocketPolyfill({
      workspaceId: options.workspaceId,
      serverUrl: options.serverUrl,
      identity: options.identity,
      peerManager: peerManagerRef.current,
      bootstrapPeers: options.bootstrapPeers,
    });
  }, [isEnabled]);

  // Sync P2P state to global websocket config (for backward compatibility)
  useEffect(() => {
    setP2PConfig({
      enabled: isEnabled,
      getWebSocketFactory: isEnabled ? getWebSocketFactory : null,
    });
  }, [isEnabled, getWebSocketFactory]);

  // Initialize PeerManager when P2P is enabled
  useEffect(() => {
    if (!isEnabled) {
      return;
    }

    let isMounted = true;
    
    // Event handlers that check mounted state before setState
    const handlePeerConnected = () => {
      if (isMounted && peerManagerRef.current) {
        setConnectedPeers(peerManagerRef.current.getConnectedPeerCount());
      }
    };

    const handlePeerDisconnected = () => {
      if (isMounted && peerManagerRef.current) {
        setConnectedPeers(peerManagerRef.current.getConnectedPeerCount());
      }
    };

    const handleInitialized = () => {
      if (isMounted) {
        setIsInitialized(true);
      }
    };

    const initP2P = async () => {
      try {
        const pm = getPeerManager({
          maxConnections: configRef.current.maxConnections,
        });
        peerManagerRef.current = pm;

        // Setup event listeners
        pm.on('peer-connected', handlePeerConnected);
        pm.on('peer-disconnected', handlePeerDisconnected);
        pm.on('initialized', handleInitialized);

        // Check if already initialized
        if (pm.isInitialized) {
          if (isMounted) {
            setIsInitialized(true);
            setConnectedPeers(pm.getConnectedPeerCount());
          }
        }

        console.log('[P2PProvider] PeerManager ready');
      } catch (err) {
        console.error('[P2PProvider] Failed to initialize:', err);
      }
    };

    initP2P();

    return () => {
      isMounted = false;
      // Remove event listeners to prevent setState after unmount and memory leaks
      // Don't destroy PeerManager itself - it's a singleton
      if (peerManagerRef.current) {
        peerManagerRef.current.off('peer-connected', handlePeerConnected);
        peerManagerRef.current.off('peer-disconnected', handlePeerDisconnected);
        peerManagerRef.current.off('initialized', handleInitialized);
      }
    };
  }, [isEnabled]);

  /**
   * Create a P2P WebSocket adapter directly
   * Useful when you need more control than the polyfill provides
   */
  const createP2PSocket = useCallback((options = {}) => {
    if (!isEnabled) {
      // Return null - caller should use regular WebSocket
      return null;
    }

    return new P2PWebSocketAdapter({
      ...options,
      peerManager: peerManagerRef.current,
    });
  }, [isEnabled]);

  /**
   * Enable or disable P2P mode at runtime
   */
  const setP2PEnabled = useCallback((enabled) => {
    setIsEnabled(enabled);
  }, []);

  const value = useMemo(() => ({
    // State
    isEnabled,
    isInitialized,
    peerManager: peerManagerRef.current,
    connectedPeers,
    config: configRef.current,
    
    // Methods
    getWebSocketFactory,
    createP2PSocket,
    setP2PEnabled,
  }), [isEnabled, isInitialized, connectedPeers, getWebSocketFactory, createP2PSocket, setP2PEnabled]);

  return (
    <P2PContext.Provider value={value}>
      {children}
    </P2PContext.Provider>
  );
}

export default P2PContext;
