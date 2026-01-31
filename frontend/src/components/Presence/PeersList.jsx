// frontend/src/components/Presence/PeersList.jsx
// Shows detailed list of online peers

import React from 'react';
import { usePresence } from '../../contexts/PresenceContext';
import { useCopyFeedback } from '../../hooks/useCopyFeedback';
import './Presence.css';

export default function PeersList({ isOpen, onClose, onCopyInvite }) {
    const { peers } = usePresence();
    const { copied, triggerCopied } = useCopyFeedback();
    
    const peerList = Array.from(peers.values());
    
    if (!isOpen) return null;
    
    const handleCopyInvite = () => {
        onCopyInvite?.();
        triggerCopied();
    };
    
    const getLastSeenText = (timestamp) => {
        const now = Date.now();
        const diff = now - timestamp;
        
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        return new Date(timestamp).toLocaleDateString();
    };
    
    return (
        <div className="peers-list-overlay" onClick={onClose}>
            <div className="peers-list-panel" onClick={e => e.stopPropagation()}>
                <div className="peers-list-header">
                    <h3>Collaborators</h3>
                    <button className="close-btn" onClick={onClose} aria-label="Close collaborators panel">✕</button>
                </div>
                
                <div className="peers-list-content">
                    {peerList.length === 0 ? (
                        <div className="no-peers">
                            <p>No other collaborators online</p>
                            <p className="hint">Share the invite link to collaborate!</p>
                            {onCopyInvite && (
                                <button 
                                    className="no-peers__invite-btn"
                                    onClick={handleCopyInvite}
                                >
                                    {copied ? '✓ Copied!' : '🔗 Copy Invite Link'}
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="peers-items">
                            {peerList.map((peer) => (
                                <div key={peer.clientId} className="peer-item">
                                    <div 
                                        className="peer-avatar-large"
                                        style={{ backgroundColor: peer.user.color }}
                                    >
                                        {peer.user.icon}
                                    </div>
                                    <div className="peer-info">
                                        <div className="peer-name">{peer.user.name}</div>
                                        <div className="peer-device">{peer.user.deviceName}</div>
                                        <div className="peer-status">
                                            {peer.isTyping ? (
                                                <span className="status-typing">Typing...</span>
                                            ) : (
                                                <span className="status-online">
                                                    Online • {getLastSeenText(peer.lastSeen)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
