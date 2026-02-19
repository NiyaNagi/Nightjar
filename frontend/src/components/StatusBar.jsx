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
    const [showNetworkPopover, setShowNetworkPopover] = useState(false);
    const containerRef = useRef(null);
    const networkPopoverRef = useRef(null);
    const [maxVisible, setMaxVisible] = useState(5);

    // Close network popover when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (networkPopoverRef.current && !networkPopoverRef.current.contains(e.target)) {
                setShowNetworkPopover(false);
            }
        };
        if (showNetworkPopover) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [showNetworkPopover]);

    // Handle clicking on a collaborator
    const handleCollaboratorClick = (collab, event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const flyoutHeight = 200;
        setFlyoutPosition({
            x: Math.min(rect.left, window.innerWidth - 220),
            y: Math.max(10, rect.top - flyoutHeight - 10)
        });
        setSelectedUser(collab);
    };

    // Calculate how many collaborator chips can fit
    useEffect(() => {
        const updateMaxVisible = () => {
            if (containerRef.current) {
                const containerWidth = containerRef.current.offsetWidth;
                const chipWidth = 36;
                const available = Math.max(1, Math.floor(containerWidth / chipWidth) - 1);
                setMaxVisible(available);
            }
        };
        updateMaxVisible();
        window.addEventListener('resize', updateMaxVisible);
        return () => window.removeEventListener('resize', updateMaxVisible);
    }, []);

    // ── Unified connection status ──
    const getConnectionStatus = () => {
        if (syncPhase && syncPhase !== 'complete' && syncPhase !== 'idle') {
            if (syncPhase === 'connecting') return { label: 'Connecting...', className: 'connecting', icon: '⟳' };
            if (syncPhase === 'awaiting-peers') return { label: 'Finding peers...', className: 'connecting', icon: '⟳' };
            if (syncPhase === 'receiving-metadata' || syncPhase === 'receiving-documents') return { label: 'Syncing...', className: 'syncing', icon: '↻' };
            if (syncPhase === 'failed') return { label: 'Sync failed', className: 'error', icon: '✗' };
            if (syncPhase === 'expired') return { label: 'Link expired', className: 'error', icon: '✗' };
        }
        if (isElectron) {
            if (p2pStatus === 'connected') {
                const currentActivePeers = activePeers > 0 ? activePeers : onlineCount;
                if (currentActivePeers > 0) {
                    const totalOnline = currentActivePeers + 1;
                    return { label: `${totalOnline} online`, className: 'connected', icon: '●' };
                }
                return { label: 'Offline copy', className: 'warning', icon: '○' };
            }
            if (p2pStatus === 'connecting') return { label: 'Connecting...', className: 'connecting', icon: '⟳' };
            return { label: 'Offline', className: 'offline', icon: '○' };
        }
        if (workspaceConnected || syncPhase === 'complete' || workspaceSynced) {
            if (onlineCount > 0) return { label: `${onlineCount + 1} online`, className: 'connected', icon: '●' };
            return { label: 'Connected', className: 'connected', icon: '●' };
        }
        return { label: 'Offline', className: 'offline', icon: '○' };
    };

    // ── Sync verification display ──
    const getSyncStatusDisplay = () => {
        switch (syncStatus) {
            case 'verified': return { icon: '✓', label: 'Synced', className: 'sync-verified' };
            case 'verifying': return { icon: '⟳', label: 'Verifying...', className: 'sync-verifying' };
            case 'syncing': return { icon: '↻', label: 'Syncing...', className: 'sync-syncing' };
            case 'incomplete': return { 
                icon: '⚠', 
                label: `${(syncDetails?.missingDocuments || 0) + (syncDetails?.missingFolders || 0)} missing`, 
                className: 'sync-incomplete' 
            };
            case 'failed': return { icon: '✗', label: 'Sync failed', className: 'sync-failed' };
            case 'no-peers': return { icon: '○', label: 'No peers', className: 'sync-no-peers' };
            case 'retrying': return { icon: '↻', label: 'Retrying...', className: 'sync-retrying' };
            default: return null;
        }
    };

    const connectionStatus = getConnectionStatus();
    const syncDisplay = getSyncStatusDisplay();
    const visibleCollabs = collaborators?.slice(0, maxVisible) || [];
    const hiddenCollabs = collaborators?.slice(maxVisible) || [];

    return (
        <div className="status-bar-bottom">
            <div className="status-section left">
                {/* ── Unified SyncChip: single clickable chip with network popover ── */}
                <div className="sync-chip-wrapper" ref={networkPopoverRef}>
                    <button 
                        type="button"
                        className={`sync-chip ${connectionStatus.className}`}
                        onClick={() => setShowNetworkPopover(!showNetworkPopover)}
                        data-testid="sync-status"
                        data-synced={workspaceSynced ? 'true' : 'false'}
                        data-phase={syncPhase}
                        title="Network & sync status — click for details"
                        role="status"
                        aria-live="polite"
                        aria-label={`Connection: ${connectionStatus.label}${syncDisplay ? `, Sync: ${syncDisplay.label}` : ''}`}
                    >
                        <span className="sync-chip-dot" aria-hidden="true">{connectionStatus.icon}</span>
                        <span className="sync-chip-label">{connectionStatus.label}</span>
                        {syncDisplay && (
                            <span className={`sync-chip-badge ${syncDisplay.className}`} title={`Sync: ${syncDisplay.label}`}>
                                {syncDisplay.icon}
                            </span>
                        )}
                        {relayConnected && <span className="sync-chip-relay" title="Relay connected">📡</span>}
                        {isElectron && torEnabled && <span className="sync-chip-tor" title="Tor enabled">🧅</span>}
                        <span className="sync-chip-arrow" aria-hidden="true">▾</span>
                    </button>

                    {/* ── Network popover ── */}
                    {showNetworkPopover && (
                        <div className="network-popover" role="menu">
                            <div className="network-popover-header">
                                <span className="network-popover-title">⚙ Network Settings</span>
                            </div>
                            
                            {/* Connection details */}
                            <div className="network-popover-section">
                                <div className="network-popover-row">
                                    <span className="network-row-label">Status</span>
                                    <span className={`network-row-value ${connectionStatus.className}`}>
                                        {connectionStatus.icon} {connectionStatus.label}
                                    </span>
                                </div>
                                {publicIP && (
                                    <div className="network-popover-row">
                                        <span className="network-row-label">Public IP</span>
                                        <span className="network-row-value">{publicIP}</span>
                                    </div>
                                )}
                                <div className="network-popover-row">
                                    <span className="network-row-label">Peers</span>
                                    <span className="network-row-value">
                                        {activePeers} active / {totalSeenPeers || totalCollaborators} total
                                    </span>
                                </div>
                                {relayConnected && (
                                    <div className="network-popover-row">
                                        <span className="network-row-label">Relay</span>
                                        <span className="network-row-value connected">📡 Connected</span>
                                    </div>
                                )}
                                {meshStatus?.running && (
                                    <div className="network-popover-row">
                                        <span className="network-row-label">Mesh</span>
                                        <span className="network-row-value">
                                            {meshStatus.connectedPeers || 0} peers, {meshStatus.knownRelays || 0} relays
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Sync verification details */}
                            {syncDisplay && (
                                <div className="network-popover-section">
                                    <div className="network-popover-row">
                                        <span className="network-row-label">Sync</span>
                                        <span className={`network-row-value ${syncDisplay.className}`}>
                                            {syncDisplay.icon} {syncDisplay.label}
                                        </span>
                                    </div>
                                    {syncDetails && (
                                        <>
                                            <div className="network-popover-row">
                                                <span className="network-row-label">Documents</span>
                                                <span className="network-row-value">{syncDetails.documentCount || 0}</span>
                                            </div>
                                            <div className="network-popover-row">
                                                <span className="network-row-label">Folders</span>
                                                <span className="network-row-value">{syncDetails.folderCount || 0}</span>
                                            </div>
                                            {(syncDetails.missingDocuments > 0 || syncDetails.missingFolders > 0) && (
                                                <div className="network-popover-row warning">
                                                    <span className="network-row-label">Missing</span>
                                                    <span className="network-row-value">{syncDetails.missingDocuments} docs, {syncDetails.missingFolders} folders</span>
                                                </div>
                                            )}
                                            {syncDetails.lastVerified && (
                                                <div className="network-popover-row">
                                                    <span className="network-row-label">Verified</span>
                                                    <span className="network-row-value">{new Date(syncDetails.lastVerified).toLocaleTimeString()}</span>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}

                            {/* Tor toggle - inside popover for Electron */}
                            {isElectron && isFeatureAvailable('tor') && (
                                <div className="network-popover-section">
                                    <button 
                                        type="button" 
                                        className="network-action-btn"
                                        onClick={() => { onToggleTor?.(); }}
                                        role="menuitem"
                                    >
                                        <span className="menu-icon">🧅</span>
                                        <span>{torEnabled ? 'Disconnect from Tor' : 'Connect to Tor'}</span>
                                        <span className={`tor-status-pill ${torEnabled ? 'on' : 'off'}`}>
                                            {torEnabled ? 'ON' : 'OFF'}
                                        </span>
                                    </button>
                                    <button 
                                        type="button" 
                                        className="network-action-btn"
                                        onClick={() => { onOpenTorSettings?.(); setShowNetworkPopover(false); }}
                                        role="menuitem"
                                    >
                                        <span className="menu-icon">⚙️</span>
                                        <span>Tor Settings...</span>
                                    </button>
                                </div>
                            )}

                            {/* Actions */}
                            <div className="network-popover-section network-popover-actions">
                                {onOpenRelaySettings && (
                                    <button 
                                        type="button" 
                                        className="network-action-btn"
                                        onClick={() => { onOpenRelaySettings(); setShowNetworkPopover(false); }}
                                        role="menuitem"
                                    >
                                        <span className="menu-icon">📡</span>
                                        <span>Relay Settings...</span>
                                    </button>
                                )}
                                {activePeers === 0 && !relayConnected && onRequestSync && (
                                    <button 
                                        type="button"
                                        className={`network-action-btn ${isRetrying ? 'retrying' : ''}`}
                                        onClick={() => { onRequestSync(); }}
                                        disabled={isRetrying}
                                        role="menuitem"
                                    >
                                        <span className="menu-icon">{isRetrying ? '⟳' : '↻'}</span>
                                        <span>Retry Connection</span>
                                    </button>
                                )}
                                {onVerifySyncState && (
                                    <button 
                                        type="button" 
                                        className="network-action-btn"
                                        onClick={() => { onVerifySyncState(); setShowNetworkPopover(false); }}
                                        role="menuitem"
                                    >
                                        <span className="menu-icon">🔍</span>
                                        <span>Verify Sync</span>
                                    </button>
                                )}
                                {onForceFullSync && (
                                    <button 
                                        type="button" 
                                        className="network-action-btn primary"
                                        onClick={() => { onForceFullSync(); setShowNetworkPopover(false); }}
                                        role="menuitem"
                                    >
                                        <span className="menu-icon">↻</span>
                                        <span>Force Full Sync</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Collaborators */}
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
