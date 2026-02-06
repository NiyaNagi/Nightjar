/**
 * usePeerManager - React hook for P2P functionality
 * 
 * Provides easy access to PeerManager from React components.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getPeerManager, destroyPeerManager } from '../services/p2p/index.js';

/**
 * Hook to access and manage the PeerManager
 * @param {Object} config - Configuration options
 * @returns {Object} PeerManager state and methods
 */
export function usePeerManager(config = {}) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [connectedPeers, setConnectedPeers] = useState(0);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  
  const peerManagerRef = useRef(null);
  const configRef = useRef(config);
  
  // Update config ref
  configRef.current = config;

  // Initialize PeerManager
  useEffect(() => {
    let isMounted = true;

    const updateStats = () => {
      if (peerManagerRef.current && isMounted) {
        setStats(peerManagerRef.current.getStats());
        setConnectedPeers(peerManagerRef.current.getConnectedPeerCount());
      }
    };

    // Named event handlers for proper cleanup
    const handleInitialized = () => {
      if (isMounted) {
        setIsInitialized(true);
        updateStats();
      }
    };

    const handlePeerConnected = () => {
      if (isMounted && peerManagerRef.current) {
        setConnectedPeers(peerManagerRef.current.getConnectedPeerCount());
        updateStats();
      }
    };

    const handlePeerDisconnected = () => {
      if (isMounted && peerManagerRef.current) {
        setConnectedPeers(peerManagerRef.current.getConnectedPeerCount());
        updateStats();
      }
    };

    const handleWorkspaceJoined = () => {
      if (isMounted) updateStats();
    };

    const handleWorkspaceLeft = () => {
      if (isMounted) updateStats();
    };

    const initPeerManager = async () => {
      try {
        const pm = getPeerManager(configRef.current);
        peerManagerRef.current = pm;

        // Initialize if identity is provided
        if (configRef.current.identity) {
          await pm.initialize(configRef.current.identity);
          if (isMounted) setIsInitialized(true);
        }

        // Setup event listeners
        pm.on('initialized', handleInitialized);
        pm.on('peer-connected', handlePeerConnected);
        pm.on('peer-disconnected', handlePeerDisconnected);
        pm.on('workspace-joined', handleWorkspaceJoined);
        pm.on('workspace-left', handleWorkspaceLeft);

        // Initial stats
        updateStats();
      } catch (err) {
        console.error('[usePeerManager] Initialization error:', err);
        if (isMounted) setError(err);
      }
    };

    initPeerManager();

    return () => {
      isMounted = false;
      // Remove event listeners on cleanup
      const pm = peerManagerRef.current;
      if (pm) {
        pm.removeListener('initialized', handleInitialized);
        pm.removeListener('peer-connected', handlePeerConnected);
        pm.removeListener('peer-disconnected', handlePeerDisconnected);
        pm.removeListener('workspace-joined', handleWorkspaceJoined);
        pm.removeListener('workspace-left', handleWorkspaceLeft);
      }
      // Don't destroy on unmount - PeerManager is a singleton
      // It will be destroyed when the app closes
    };
  }, []);

  // Initialize with identity
  const initialize = useCallback(async (identity) => {
    const pm = peerManagerRef.current;
    if (!pm) return;

    try {
      await pm.initialize(identity);
      setIsInitialized(true);
      setStats(pm.getStats());
    } catch (err) {
      setError(err);
      throw err;
    }
  }, []);

  // Join workspace
  const joinWorkspace = useCallback(async (workspaceId, connectionParams = {}) => {
    const pm = peerManagerRef.current;
    if (!pm) throw new Error('PeerManager not available');

    try {
      const result = await pm.joinWorkspace(workspaceId, connectionParams);
      setStats(pm.getStats());
      return result;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, []);

  // Leave workspace
  const leaveWorkspace = useCallback(async () => {
    const pm = peerManagerRef.current;
    if (!pm) return;

    try {
      await pm.leaveWorkspace();
      setStats(pm.getStats());
    } catch (err) {
      setError(err);
    }
  }, []);

  // Send message to peer
  const send = useCallback(async (peerId, message) => {
    const pm = peerManagerRef.current;
    if (!pm) throw new Error('PeerManager not available');
    return pm.send(peerId, message);
  }, []);

  // Broadcast message
  const broadcast = useCallback(async (message) => {
    const pm = peerManagerRef.current;
    if (!pm) return;
    return pm.broadcast(message);
  }, []);

  // Get awareness manager for a document
  const getAwarenessManager = useCallback((docId) => {
    const pm = peerManagerRef.current;
    if (!pm) return null;
    return pm.getAwarenessManager(docId);
  }, []);

  // Subscribe to events
  const on = useCallback((event, handler) => {
    const pm = peerManagerRef.current;
    if (!pm) return () => {};
    pm.on(event, handler);
    return () => pm.off(event, handler);
  }, []);

  // Get connected peers
  const getConnectedPeers = useCallback(() => {
    const pm = peerManagerRef.current;
    if (!pm) return [];
    return pm.getConnectedPeers();
  }, []);

  // Get known peers
  const getKnownPeers = useCallback(() => {
    const pm = peerManagerRef.current;
    if (!pm) return [];
    return pm.getKnownPeers();
  }, []);

  // Refresh stats
  const refreshStats = useCallback(() => {
    const pm = peerManagerRef.current;
    if (pm) {
      setStats(pm.getStats());
      setConnectedPeers(pm.getConnectedPeerCount());
    }
  }, []);

  return {
    // State
    isInitialized,
    connectedPeers,
    stats,
    error,
    peerManager: peerManagerRef.current,
    
    // Methods
    initialize,
    joinWorkspace,
    leaveWorkspace,
    send,
    broadcast,
    getAwarenessManager,
    getConnectedPeers,
    getKnownPeers,
    on,
    refreshStats,
  };
}

/**
 * Hook for awareness in a specific document
 * @param {string} docId - Document ID
 * @returns {Object} Awareness state and methods
 */
export function useP2PAwareness(docId) {
  const [states, setStates] = useState({});
  const [clientCount, setClientCount] = useState(0);
  const { peerManager, isInitialized } = usePeerManager();
  const managerRef = useRef(null);

  useEffect(() => {
    if (!isInitialized || !peerManager || !docId) return;

    const manager = peerManager.getAwarenessManager(docId);
    managerRef.current = manager;

    const handleChange = (newStates) => {
      setStates(newStates);
      setClientCount(Object.keys(newStates).length);
    };

    manager.on('change', handleChange);
    
    // Get initial states
    handleChange(manager.getStates());

    return () => {
      manager.off('change', handleChange);
    };
  }, [isInitialized, peerManager, docId]);

  const setLocalState = useCallback((state) => {
    if (managerRef.current) {
      managerRef.current.setLocalState(state);
    }
  }, []);

  const setLocalStateField = useCallback((field, value) => {
    if (managerRef.current) {
      managerRef.current.setLocalStateField(field, value);
    }
  }, []);

  return {
    states,
    clientCount,
    setLocalState,
    setLocalStateField,
    getStatesArray: () => managerRef.current?.getStatesArray() || [],
  };
}

export default usePeerManager;
