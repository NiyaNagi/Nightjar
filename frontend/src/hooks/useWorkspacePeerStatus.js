/**
 * useWorkspacePeerStatus Hook
 * 
 * Provides real-time peer connection status for a workspace.
 * Polls the sidecar for active peer counts and relay status.
 * Also provides sync verification status and manual retry capabilities.
 * 
 * Returns:
 * - activePeers: Number of currently connected peers
 * - totalSeenPeers: Total number of peers ever seen (capped at MAX_SEEN_PEERS_CAP)
 * - relayConnected: Whether relay server is connected as fallback
 * - isLoading: Whether initial status is being fetched
 * - lastError: Last error message if any
 * - requestSync: Function to manually trigger peer sync
 * - isRetrying: Whether a retry is in progress
 * - syncStatus: Sync verification status ('idle', 'syncing', 'verifying', 'verified', 'incomplete', 'failed')
 * - syncDetails: Detailed sync info (documentCount, folderCount, missing items, etc.)
 * - verifySyncState: Function to trigger sync verification
 * - forceFullSync: Function to request complete resync from peers
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { isElectron } from './useEnvironment';
import { 
    META_WS_PORT, 
    PEER_STATUS_POLL_INTERVAL_MS,
    PEER_SYNC_RETRY_BASE_MS,
    PEER_SYNC_RETRY_MAX_MS
} from '../config/constants';

/**
 * Load poll interval from settings, falling back to constant
 */
function getPollIntervalFromSettings() {
    try {
        const saved = localStorage.getItem('Nightjar-app-settings');
        if (saved) {
            const settings = JSON.parse(saved);
            if (settings.peerStatusPollIntervalMs) {
                return settings.peerStatusPollIntervalMs;
            }
        }
    } catch (e) {
        // Ignore parse errors
    }
    return PEER_STATUS_POLL_INTERVAL_MS;
}

/**
 * Hook to track workspace peer status
 * @param {string} workspaceId - Current workspace ID
 * @param {number} pollIntervalOverride - Optional polling interval override (defaults to settings or PEER_STATUS_POLL_INTERVAL_MS)
 * @returns {Object} Peer status info and sync function
 */
export function useWorkspacePeerStatus(workspaceId, pollIntervalOverride = null) {
    // Get poll interval from settings or use override
    const pollIntervalMs = pollIntervalOverride || getPollIntervalFromSettings();
    const [activePeers, setActivePeers] = useState(0);
    const [totalSeenPeers, setTotalSeenPeers] = useState(0);
    const [relayConnected, setRelayConnected] = useState(false);
    const [p2pInitialized, setP2pInitialized] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [lastError, setLastError] = useState(null);
    const [isRetrying, setIsRetrying] = useState(false);
    const [retryCount, setRetryCount] = useState(0);
    
    // Sync verification state
    const [syncStatus, setSyncStatus] = useState('idle'); // 'idle', 'syncing', 'verifying', 'verified', 'incomplete', 'failed', 'no-peers'
    const [syncDetails, setSyncDetails] = useState({
        documentCount: 0,
        folderCount: 0,
        missingDocuments: 0,
        missingFolders: 0,
        lastVerified: null,
    });
    
    const wsRef = useRef(null);
    const pollIntervalRef = useRef(null);
    const retryTimeoutRef = useRef(null);
    const mountedRef = useRef(true);
    
    // Fetch peer status from sidecar
    const fetchPeerStatus = useCallback(() => {
        if (!workspaceId || !isElectron()) return;
        
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        
        ws.send(JSON.stringify({
            type: 'get-workspace-peer-status',
            workspaceId
        }));
    }, [workspaceId]);
    
    // Request manual sync
    const requestSync = useCallback(async () => {
        if (!workspaceId || !isElectron()) {
            return { success: false, message: 'Not available' };
        }
        
        return new Promise((resolve) => {
            const ws = wsRef.current;
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                resolve({ success: false, message: 'Not connected to sidecar' });
                return;
            }
            
            setIsRetrying(true);
            setSyncStatus('syncing');
            
            let timeoutId = null;
            
            // Set up one-time handler for the response
            const handleMessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'peer-sync-result') {
                        clearTimeout(timeoutId);
                        ws.removeEventListener('message', handleMessage);
                        if (mountedRef.current) {
                            setIsRetrying(false);
                            if (data.success) {
                                setRetryCount(0);
                                setLastError(null);
                                setSyncStatus('verifying');
                            } else {
                                // Calculate exponential backoff for next retry hint
                                const nextRetryMs = Math.min(
                                    PEER_SYNC_RETRY_BASE_MS * Math.pow(2, retryCount),
                                    PEER_SYNC_RETRY_MAX_MS
                                );
                                setRetryCount(prev => prev + 1);
                                setLastError(data.error || data.message || 'Sync failed');
                                setSyncStatus('failed');
                            }
                        }
                        resolve(data);
                    }
                } catch (e) {
                    // Ignore parse errors for other messages
                }
            };
            
            ws.addEventListener('message', handleMessage);
            
            // Timeout after 10 seconds - store for cleanup
            timeoutId = setTimeout(() => {
                ws.removeEventListener('message', handleMessage);
                if (mountedRef.current) {
                    setIsRetrying(false);
                }
                resolve({ success: false, message: 'Request timed out' });
            }, 10000);
            
            // Store timeout for potential cleanup on unmount
            retryTimeoutRef.current = timeoutId;
            
            ws.send(JSON.stringify({
                type: 'request-peer-sync',
                workspaceId
            }));
        });
    }, [workspaceId, retryCount]);
    
    // Request sync verification (check manifest against peers)
    const verifySyncState = useCallback(() => {
        if (!workspaceId || !isElectron()) return;
        
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        
        setSyncStatus('verifying');
        
        ws.send(JSON.stringify({
            type: 'verify-sync-state',
            workspaceId
        }));
    }, [workspaceId]);
    
    // Request complete resync from all connected peers
    const forceFullSync = useCallback(async () => {
        if (!workspaceId || !isElectron()) {
            return { success: false, message: 'Not available' };
        }
        
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            return { success: false, message: 'Not connected to sidecar' };
        }
        
        setSyncStatus('syncing');
        
        ws.send(JSON.stringify({
            type: 'force-full-sync',
            workspaceId
        }));
        
        return { success: true, message: 'Full sync requested' };
    }, [workspaceId]);
    
    // Set up WebSocket connection and polling
    useEffect(() => {
        mountedRef.current = true;
        
        // Reset all state when workspace changes or is cleared
        setActivePeers(0);
        setTotalSeenPeers(0);
        setRelayConnected(false);
        setP2pInitialized(false);
        setLastError(null);
        setIsRetrying(false);
        setRetryCount(0);
        setSyncStatus('idle');
        setSyncDetails({
            documentCount: 0,
            folderCount: 0,
            missingDocuments: 0,
            missingFolders: 0,
            lastVerified: null,
        });
        
        if (!workspaceId || !isElectron()) {
            setIsLoading(false);
            return;
        }
        
        // Create WebSocket connection
        const ws = new WebSocket(`ws://localhost:${META_WS_PORT}`);
        wsRef.current = ws;
        
        ws.onopen = () => {
            console.log('[PeerStatus] Connected to sidecar');
            // Fetch initial status
            fetchPeerStatus();
            
            // Set up polling interval
            pollIntervalRef.current = setInterval(fetchPeerStatus, pollIntervalMs);
        };
        
        ws.onmessage = (event) => {
            if (!mountedRef.current) return;
            
            try {
                const data = JSON.parse(event.data);
                
                if (data.type === 'workspace-peer-status') {
                    if (data.error) {
                        setLastError(data.error);
                    } else {
                        setActivePeers(data.activePeers || 0);
                        setTotalSeenPeers(data.totalSeenPeers || 0);
                        setRelayConnected(data.relayConnected || false);
                        setP2pInitialized(data.p2pInitialized || false);
                        setLastError(null);
                    }
                    setIsLoading(false);
                }
                
                // Handle sync status updates from sidecar
                if (data.type === 'sync-status' && data.workspaceId === workspaceId) {
                    console.log('[PeerStatus] Sync status update:', data.status, data.details);
                    setSyncStatus(data.status);
                    
                    if (data.details) {
                        setSyncDetails(prev => ({
                            ...prev,
                            documentCount: data.details.documentCount ?? prev.documentCount,
                            folderCount: data.details.folderCount ?? prev.folderCount,
                            missingDocuments: data.details.missing?.missingDocumentIds?.length ?? 0,
                            missingFolders: data.details.missing?.missingFolderIds?.length ?? 0,
                            lastVerified: data.status === 'verified' ? Date.now() : prev.lastVerified,
                        }));
                    }
                }
            } catch (e) {
                console.warn('[PeerStatus] Failed to parse message:', e);
            }
        };
        
        ws.onerror = (error) => {
            console.warn('[PeerStatus] WebSocket error:', error);
            if (mountedRef.current) {
                setLastError('Connection error');
                setIsLoading(false);
            }
        };
        
        ws.onclose = () => {
            console.log('[PeerStatus] Disconnected from sidecar');
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
            }
        };
        
        return () => {
            mountedRef.current = false;
            
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
            }
            
            if (retryTimeoutRef.current) {
                clearTimeout(retryTimeoutRef.current);
                retryTimeoutRef.current = null;
            }
            
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
            wsRef.current = null;
        };
    }, [workspaceId, pollIntervalMs, fetchPeerStatus]);
    
    // Calculate next retry delay for UI hint
    const nextRetryDelayMs = retryCount > 0 
        ? Math.min(PEER_SYNC_RETRY_BASE_MS * Math.pow(2, retryCount - 1), PEER_SYNC_RETRY_MAX_MS)
        : 0;
    
    return {
        activePeers,
        totalSeenPeers,
        relayConnected,
        p2pInitialized,
        isLoading,
        lastError,
        requestSync,
        isRetrying,
        retryCount,
        nextRetryDelayMs,
        // Sync verification
        syncStatus,
        syncDetails,
        verifySyncState,
        forceFullSync,
    };
}

export default useWorkspacePeerStatus;
