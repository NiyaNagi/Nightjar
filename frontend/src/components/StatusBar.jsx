import React, { useState, useRef, useEffect } from 'react';
import { useEnvironment, isFeatureAvailable } from '../hooks/useEnvironment';
import UserFlyout from './UserFlyout';
import './StatusBar.css';

const StatusBar = ({ 
    p2pStatus, 
    inviteLink, 
    torEnabled,
    meshStatus,
    publicIP,
    onToggleTor,
    onOpenTorSettings,
    onCopyInvite,
    onOpenRelaySettings,
    wordCount,
    characterCount,
    cellCount,
    collaborators,
    onlineCount = 0,
    totalCollaborators = 0,
    // New peer status props
    activePeers = 0,
    totalSeenPeers = 0,
    relayConnected = false,
    onRequestSync,
    isRetrying = false,
    documentType = 'text',
    onStartChatWith,
    onFollowUser,
    // Sync phase tracking
    syncPhase = 'complete',
    workspaceSynced = true,
    workspaceConnected = false,
    // Sync verification props
    syncStatus = 'idle',
    syncDetails = null,
    onVerifySyncState,
    onForceFullSync,
}) => {
    const { isElectron } = useEnvironment();
    const [showCollaborators, setShowCollaborators] = useState(false);
    const [expandedChip, setExpandedChip] = useState(null);
    const [selectedUser, setSelectedUser] = useState(null);
    const [flyoutPosition, setFlyoutPosition] = useState({ x: 0, y: 0 });
    const [showTorMenu, setShowTorMenu] = useState(false);
    const [showSyncDetails, setShowSyncDetails] = useState(false);
    const containerRef = useRef(null);
    const torMenuRef = useRef(null);
    const syncMenuRef = useRef(null);
    const [maxVisible, setMaxVisible] = useState(5);

    // Close tor menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (torMenuRef.current && !torMenuRef.current.contains(e.target)) {
                setShowTorMenu(false);
            }
            if (syncMenuRef.current && !syncMenuRef.current.contains(e.target)) {
                setShowSyncDetails(false);
            }
        };
        if (showTorMenu || showSyncDetails) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [showTorMenu, showSyncDetails]);

    // Handle clicking on a collaborator
    const handleCollaboratorClick = (collab, event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        // Position flyout above the avatar (status bar is at bottom)
        // Flyout is approximately 200px tall
        const flyoutHeight = 200;
        setFlyoutPosition({
            x: Math.min(rect.left, window.innerWidth - 220),
            y: Math.max(10, rect.top - flyoutHeight - 10) // Position above, with minimum 10px from top
        });
        setSelectedUser(collab);
    };

    // Calculate how many collaborator chips can fit
    useEffect(() => {
        const updateMaxVisible = () => {
            if (containerRef.current) {
                const containerWidth = containerRef.current.offsetWidth;
                // Each chip is about 32px, plus some padding
                const chipWidth = 36;
                const available = Math.max(1, Math.floor(containerWidth / chipWidth) - 1);
                setMaxVisible(available);
            }
        };
        
        updateMaxVisible();
        window.addEventListener('resize', updateMaxVisible);
        return () => window.removeEventListener('resize', updateMaxVisible);
    }, []);

    // Connection status - unified across platforms with detailed peer info
    const getConnectionStatus = () => {
        // Show sync phase if not complete
        if (syncPhase && syncPhase !== 'complete' && syncPhase !== 'idle') {
            if (syncPhase === 'connecting') {
                return { label: 'Connecting...', className: 'connecting' };
            }
            if (syncPhase === 'awaiting-peers') {
                return { label: 'Finding peers...', className: 'connecting' };
            }
            if (syncPhase === 'receiving-metadata' || syncPhase === 'receiving-documents') {
                return { label: 'Syncing...', className: 'syncing' };
            }
            if (syncPhase === 'failed') {
                return { label: 'Sync failed', className: 'error' };
            }
            if (syncPhase === 'expired') {
                return { label: 'Link expired', className: 'error' };
            }
        }
        
        // Electron mode: use p2pStatus from sidecar
        if (isElectron) {
            if (p2pStatus === 'connected') {
                // Use activePeers if provided (new behavior), otherwise fall back to onlineCount
                // Add +1 to include self, consistent with web path
                const currentActivePeers = activePeers > 0 ? activePeers : onlineCount;
                if (currentActivePeers > 0) {
                    const totalOnline = currentActivePeers + 1;
                    return { label: `${totalOnline} online`, className: 'connected' };
                }
                // Connected to P2P but no active peers - show warning
                return { label: 'Offline copy', className: 'warning' };
            }
            if (p2pStatus === 'connecting') {
                return { label: 'Connecting...', className: 'connecting' };
            }
            return { label: 'Offline', className: 'offline' };
        }
        
        // Web mode: use workspaceConnected/workspaceSynced and onlineCount from Y.js sync
        // Consider connected if:
        // 1. WebSocket is connected (workspaceConnected), OR
        // 2. Sync phase completed (syncPhase === 'complete'), OR
        // 3. Provider synced (workspaceSynced)
        if (workspaceConnected || syncPhase === 'complete' || workspaceSynced) {
            // Use onlineCount from awareness for web mode
            if (onlineCount > 0) {
                return { label: `${onlineCount + 1} online`, className: 'connected' };
            }
            return { label: 'Connected', className: 'connected' };
        }
        
        return { label: 'Offline', className: 'offline' };
    };

    // Get sync verification status display
    const getSyncStatusDisplay = () => {
        switch (syncStatus) {
            case 'verified':
                return { icon: '✓', label: 'Synced', className: 'sync-verified' };
            case 'verifying':
                return { icon: '⟳', label: 'Verifying...', className: 'sync-verifying' };
            case 'syncing':
                return { icon: '↻', label: 'Syncing...', className: 'sync-syncing' };
            case 'incomplete':
                return { 
                    icon: '⚠', 
                    label: `${(syncDetails?.missingDocuments || 0) + (syncDetails?.missingFolders || 0)} missing`, 
                    className: 'sync-incomplete' 
                };
            case 'failed':
                return { icon: '✗', label: 'Sync failed', className: 'sync-failed' };
            case 'no-peers':
                return { icon: '○', label: 'No peers', className: 'sync-no-peers' };
            case 'retrying':
                return { icon: '↻', label: 'Retrying...', className: 'sync-retrying' };
            default:
                return { icon: '○', label: '', className: 'sync-idle' };
        }
    };

    // Format IP for display (show only for Electron)
    const getIPDisplay = () => {
        if (!isElectron || !publicIP) return null;
        // Truncate long IPs for display
        return publicIP.length > 15 ? publicIP.substring(0, 12) + '...' : publicIP;
    };

    const connectionStatus = getConnectionStatus();
    const ipDisplay = getIPDisplay();
    const visibleCollabs = collaborators?.slice(0, maxVisible) || [];
    const hiddenCollabs = collaborators?.slice(maxVisible) || [];

    // Handle Tor button click - show popup menu
    const handleTorClick = () => {
        setShowTorMenu(!showTorMenu);
    };

    const handleTorToggle = () => {
        onToggleTor?.();
        setShowTorMenu(false);
    };

    const handleTorSettingsClick = () => {
        onOpenTorSettings?.();
        setShowTorMenu(false);
    };

    return (
        <div className="status-bar-bottom">
            <div className="status-section left">
                {/* Tor toggle - Electron only */}
                {isElectron && isFeatureAvailable('tor') && (
                    <div className="tor-control" ref={torMenuRef}>
                        <button 
                            type="button"
                            className={`tor-toggle ${torEnabled ? 'enabled' : 'disabled'} ${p2pStatus}`}
                            onClick={handleTorClick}
                            title="Tor P2P options"
                            aria-label="Tor P2P options"
                        >
                            <span className="tor-icon">🧅</span>
                            <span className="tor-label">{torEnabled ? 'ON' : 'OFF'}</span>
                        </button>
                        
                        {/* Tor popup menu */}
                        {showTorMenu && (
                            <div className="tor-menu" role="menu">
                                <button type="button" className="tor-menu-item" onClick={handleTorToggle} role="menuitem">
                                    <span className="menu-icon">{torEnabled ? '⏹️' : '▶️'}</span>
                                    <span>{torEnabled ? 'Disconnect from Tor' : 'Connect to Tor'}</span>
                                </button>
                                <button type="button" className="tor-menu-item" onClick={handleTorSettingsClick} role="menuitem">
                                    <span className="menu-icon">⚙️</span>
                                    <span>Tor Settings...</span>
                                </button>
                                {onOpenRelaySettings && (
                                    <button type="button" className="tor-menu-item" onClick={() => { onOpenRelaySettings(); setShowTorMenu(false); }} role="menuitem">
                                        <span className="menu-icon">📡</span>
                                        <span>Relay Settings...</span>
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                )}
                
                {/* Connection status - shown on all platforms */}
                <div 
                    className={`connection-status ${connectionStatus.className}`}
                    data-testid="sync-status"
                    data-synced={workspaceSynced ? 'true' : 'false'}
                    data-phase={syncPhase}
                    title={[
                        publicIP ? `IP: ${publicIP}` : null,
                        (totalSeenPeers > 0 || totalCollaborators > 0) 
                            ? `${activePeers} active / ${totalSeenPeers || totalCollaborators} total peers` 
                            : null,
                        relayConnected ? 'Relay connected' : null,
                        meshStatus?.running 
                            ? `Mesh: ${meshStatus.connectedPeers || 0} peers, ${meshStatus.knownRelays || 0} relays` 
                            : null,
                    ].filter(Boolean).join(' · ') || 'Connection status'}
                    role="status"
                    aria-live="polite"
                    aria-label={`Connection status: ${connectionStatus.label}`}
                >
                    <span className="status-dot" aria-hidden="true"></span>
                    <span>{connectionStatus.label}</span>
                    {ipDisplay && (
                        <span className="ip-display" title={`Your public IP: ${publicIP}`}>
                            ({ipDisplay})
                        </span>
                    )}
                    {relayConnected && (
                        <span className="relay-indicator" title="Connected to relay server">📡</span>
                    )}
                    {activePeers === 0 && !relayConnected && onRequestSync && (
                        <button 
                            className={`retry-sync-btn ${isRetrying ? 'retrying' : ''}`}
                            onClick={onRequestSync}
                            disabled={isRetrying}
                            title="Retry connecting to peers"
                        >
                            {isRetrying ? '⟳' : '↻'}
                        </button>
                    )}
                </div>
                
                {/* Sync verification status indicator */}
                {syncStatus && syncStatus !== 'idle' && (
                    <div 
                        className="sync-status-control" 
                        ref={syncMenuRef}
                    >
                        <button
                            type="button"
                            className={`sync-status-btn ${getSyncStatusDisplay().className}`}
                            onClick={() => setShowSyncDetails(!showSyncDetails)}
                            title="Sync verification status - click for details"
                        >
                            <span className="sync-icon">{getSyncStatusDisplay().icon}</span>
                            <span className="sync-label">{getSyncStatusDisplay().label}</span>
                        </button>
                        
                        {/* Sync details popover */}
                        {showSyncDetails && (
                            <div className="sync-details-menu" role="menu">
                                <div className="sync-details-header">
                                    <span className="sync-details-title">Sync Status</span>
                                    <span className={`sync-details-status ${getSyncStatusDisplay().className}`}>
                                        {getSyncStatusDisplay().icon} {syncStatus}
                                    </span>
                                </div>
                                <div className="sync-details-body">
                                    <div className="sync-detail-row">
                                        <span>Documents:</span>
                                        <span>{syncDetails?.documentCount || 0}</span>
                                    </div>
                                    <div className="sync-detail-row">
                                        <span>Folders:</span>
                                        <span>{syncDetails?.folderCount || 0}</span>
                                    </div>
                                    {(syncDetails?.missingDocuments > 0 || syncDetails?.missingFolders > 0) && (
                                        <div className="sync-detail-row warning">
                                            <span>Missing:</span>
                                            <span>{syncDetails.missingDocuments} docs, {syncDetails.missingFolders} folders</span>
                                        </div>
                                    )}
                                    {syncDetails?.lastVerified && (
                                        <div className="sync-detail-row">
                                            <span>Last verified:</span>
                                            <span>{new Date(syncDetails.lastVerified).toLocaleTimeString()}</span>
                                        </div>
                                    )}
                                </div>
                                <div className="sync-details-actions">
                                    {onVerifySyncState && (
                                        <button 
                                            type="button" 
                                            className="sync-action-btn"
                                            onClick={() => { onVerifySyncState(); setShowSyncDetails(false); }}
                                        >
                                            <span>🔍</span> Verify Sync
                                        </button>
                                    )}
                                    {onForceFullSync && (
                                        <button 
                                            type="button" 
                                            className="sync-action-btn primary"
                                            onClick={() => { onForceFullSync(); setShowSyncDetails(false); }}
                                        >
                                            <span>↻</span> Force Full Sync
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}
                
                {collaborators && collaborators.length > 0 && (
                    <div className="collaborators" ref={containerRef} data-testid="collaborator-list">
                        {visibleCollabs.map((collab, idx) => (
                            <div 
                                key={idx}
                                className={`collaborator-avatar clickable ${expandedChip === idx ? 'expanded' : ''}`}
                                style={{ backgroundColor: collab.color }}
                                onMouseEnter={() => setExpandedChip(idx)}
                                onMouseLeave={() => setExpandedChip(null)}
                                onClick={(e) => handleCollaboratorClick(collab, e)}
                                data-testid={`collaborator-${collab.name?.replace(/\s+/g, '-') || idx}`}
                                title={`${collab.name || 'Unknown'}${collab.contextInfo ? ` (${collab.contextInfo})` : ''} - Click for options`}
                            >
                                <span className="avatar-icon">
                                    {collab.icon || collab.name?.charAt(0)?.toUpperCase() || '?'}
                                </span>
                                <span className="avatar-name">{collab.name || 'Unknown'}</span>
                                {collab.contextInfo && (
                                    <span className="avatar-context">{collab.contextInfo}</span>
                                )}
                            </div>
                        ))}
                        {hiddenCollabs.length > 0 && (
                            <div 
                                className="collaborator-avatar more"
                                onClick={() => setShowCollaborators(!showCollaborators)}
                            >
                                +{hiddenCollabs.length}
                            </div>
                        )}
                        
                        {showCollaborators && hiddenCollabs.length > 0 && (
                            <div className="collaborators-dropdown">
                                <div className="dropdown-header">
                                    <span>More Collaborators ({hiddenCollabs.length})</span>
                                </div>
                                <div className="dropdown-list">
                                    {hiddenCollabs.map((collab, idx) => (
                                        <div 
                                            key={idx} 
                                            className="collab-item clickable"
                                            onClick={(e) => {
                                                handleCollaboratorClick(collab, e);
                                                setShowCollaborators(false);
                                            }}
                                        >
                                            <span 
                                                className="collab-avatar"
                                                style={{ backgroundColor: collab.color }}
                                            >
                                                {collab.icon || collab.name?.charAt(0)?.toUpperCase() || '?'}
                                            </span>
                                            <span className="collab-name">{collab.name || 'Unknown'}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* User Flyout Menu */}
                {selectedUser && (
                    <UserFlyout
                        user={selectedUser}
                        position={flyoutPosition}
                        onClose={() => setSelectedUser(null)}
                        onStartChat={(user) => onStartChatWith?.(user)}
                        onFollow={null}
                        onViewProfile={null}
                    />
                )}
            </div>

            <div className="status-section center">
                {inviteLink && (
                    <button className="invite-btn" onClick={onCopyInvite} title="Copy invite link">
                        🔗 Share
                    </button>
                )}
            </div>

            <div className="status-section right">
                {documentType === 'text' && (
                    <>
                        <span className="stat">{wordCount} words</span>
                        <span className="stat">{characterCount} chars</span>
                    </>
                )}
                {documentType === 'sheet' && (
                    <>
                        <span className="stat">{cellCount || 0} cells</span>
                        <span className="stat">{characterCount || 0} chars</span>
                    </>
                )}
                {documentType === 'kanban' && (
                    <span className="stat">Kanban Board</span>
                )}
            </div>
        </div>
    );
};

export default StatusBar;
