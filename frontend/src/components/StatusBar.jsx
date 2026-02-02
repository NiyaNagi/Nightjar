import React, { useState, useRef, useEffect } from 'react';
import { useEnvironment, isFeatureAvailable } from '../hooks/useEnvironment';
import UserFlyout from './UserFlyout';
import './StatusBar.css';

const StatusBar = ({ 
    p2pStatus, 
    inviteLink, 
    torEnabled,
    meshStatus,
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
    documentType = 'text',
    onStartChatWith,
    onFollowUser
}) => {
    const { isElectron } = useEnvironment();
    const [showCollaborators, setShowCollaborators] = useState(false);
    const [expandedChip, setExpandedChip] = useState(null);
    const [selectedUser, setSelectedUser] = useState(null);
    const [flyoutPosition, setFlyoutPosition] = useState({ x: 0, y: 0 });
    const [showTorMenu, setShowTorMenu] = useState(false);
    const containerRef = useRef(null);
    const torMenuRef = useRef(null);
    const [maxVisible, setMaxVisible] = useState(5);

    // Close tor menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (torMenuRef.current && !torMenuRef.current.contains(e.target)) {
                setShowTorMenu(false);
            }
        };
        if (showTorMenu) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [showTorMenu]);

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
        if (p2pStatus === 'connected') {
            if (onlineCount > 0) {
                return { label: `${onlineCount} peer${onlineCount !== 1 ? 's' : ''} connected`, className: 'connected' };
            }
            return { label: 'Connected', className: 'connected' };
        }
        if (p2pStatus === 'connecting') {
            return { label: 'Connecting...', className: 'connecting' };
        }
        return { label: 'Offline', className: 'offline' };
    };

    const connectionStatus = getConnectionStatus();
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
                            className={`tor-toggle ${torEnabled ? 'enabled' : 'disabled'} ${p2pStatus}`}
                            onClick={handleTorClick}
                            title="Tor P2P options"
                        >
                            <span className="tor-icon">🧅</span>
                            <span className="tor-label">{torEnabled ? 'ON' : 'OFF'}</span>
                        </button>
                        
                        {/* Tor popup menu */}
                        {showTorMenu && (
                            <div className="tor-menu">
                                <button className="tor-menu-item" onClick={handleTorToggle}>
                                    <span className="menu-icon">{torEnabled ? '⏹️' : '▶️'}</span>
                                    <span>{torEnabled ? 'Disconnect from Tor' : 'Connect to Tor'}</span>
                                </button>
                                <button className="tor-menu-item" onClick={handleTorSettingsClick}>
                                    <span className="menu-icon">⚙️</span>
                                    <span>Tor Settings...</span>
                                </button>
                            </div>
                        )}
                    </div>
                )}
                
                {/* Mesh network status indicator - Electron only */}
                {isElectron && meshStatus && (
                    <div 
                        className={`mesh-status ${meshStatus.running ? 'active' : 'inactive'}`}
                        title={meshStatus.running 
                            ? `Mesh: ${meshStatus.connectedPeers || 0} peers, ${meshStatus.knownRelays || 0} relays` 
                            : 'Mesh network disabled'
                        }
                    >
                        <span className="mesh-icon">🌐</span>
                        <span className="mesh-label">
                            {meshStatus.running ? `${meshStatus.knownRelays || 0}` : 'OFF'}
                        </span>
                    </div>
                )}
                
                {/* Relay settings button - Electron only */}
                {isElectron && isFeatureAvailable('relay') && onOpenRelaySettings && (
                    <button 
                        className="relay-settings-btn"
                        onClick={onOpenRelaySettings}
                        title="Configure relay settings"
                    >
                        <span className="relay-icon">📡</span>
                        <span className="relay-label">Relay</span>
                    </button>
                )}
                
                {/* Connection status - shown on all platforms */}
                <div className={`connection-status ${connectionStatus.className}`}>
                    <span className="status-dot"></span>
                    <span>{connectionStatus.label}</span>
                </div>

                {/* Peer counts display - only show if there are peers */}
                {totalCollaborators > 0 && (onlineCount > 0 || totalCollaborators > 0) && (
                    <div className="peer-counts" title={`${onlineCount} online now · ${totalCollaborators} total collaborators`}>
                        <span className="online-count">
                            <span className="online-dot">🟢</span>
                            {onlineCount}
                        </span>
                        <span className="count-separator">·</span>
                        <span className="total-count">
                            <span className="total-icon">👤</span>
                            {totalCollaborators}
                        </span>
                    </div>
                )}
                
                {collaborators && collaborators.length > 0 && (
                    <div className="collaborators" ref={containerRef}>
                        {visibleCollabs.map((collab, idx) => (
                            <div 
                                key={idx}
                                className={`collaborator-avatar clickable ${expandedChip === idx ? 'expanded' : ''}`}
                                style={{ backgroundColor: collab.color }}
                                onMouseEnter={() => setExpandedChip(idx)}
                                onMouseLeave={() => setExpandedChip(null)}
                                onClick={(e) => handleCollaboratorClick(collab, e)}
                                title={`${collab.name}${collab.contextInfo ? ` (${collab.contextInfo})` : ''} - Click for options`}
                            >
                                <span className="avatar-icon">
                                    {collab.icon || collab.name.charAt(0).toUpperCase()}
                                </span>
                                <span className="avatar-name">{collab.name}</span>
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
                                                {collab.icon || collab.name.charAt(0).toUpperCase()}
                                            </span>
                                            <span className="collab-name">{collab.name}</span>
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
