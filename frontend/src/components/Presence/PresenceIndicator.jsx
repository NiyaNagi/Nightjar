// frontend/src/components/Presence/PresenceIndicator.jsx
// Shows online users and their status

import React from 'react';
import { usePresence } from '../../contexts/PresenceContext';
import './Presence.css';

export default function PresenceIndicator() {
    const { peers, onlinePeersCount, typingPeers } = usePresence();
    
    const peerList = Array.from(peers.values());
    
    return (
        <div className="presence-indicator" data-testid="presence-indicator">
            <div className="presence-summary">
                <span className="online-dot" data-testid="presence-online-dot"></span>
                <span className="online-count" data-testid="presence-online-count">
                    {onlinePeersCount === 0 
                        ? 'Only you' 
                        : `${onlinePeersCount + 1} online`}
                </span>
            </div>
            
            {peerList.length > 0 && (
                <div className="peer-avatars" data-testid="presence-peer-avatars">
                    {peerList.slice(0, 5).map((peer) => (
                        <div 
                            key={peer.clientId}
                            className="peer-avatar"
                            data-testid={`presence-peer-${peer.clientId}`}
                            data-peer-name={peer.user.name}
                            data-peer-typing={peer.isTyping ? 'true' : 'false'}
                            style={{ backgroundColor: peer.user.color }}
                            title={`${peer.user.name}${peer.isTyping ? ' (typing...)' : ''}`}
                        >
                            {peer.user.icon}
                            {peer.isTyping && <span className="typing-dot" data-testid="presence-typing-dot"></span>}
                        </div>
                    ))}
                    {peerList.length > 5 && (
                        <div className="peer-overflow" data-testid="presence-peer-overflow">
                            +{peerList.length - 5}
                        </div>
                    )}
                </div>
            )}
            
            {typingPeers.length > 0 && (
                <div className="typing-indicator" data-testid="presence-typing-indicator">
                    {typingPeers.length === 1 
                        ? `${typingPeers[0].user.name} is typing...`
                        : `${typingPeers.length} people are typing...`}
                </div>
            )}
        </div>
    );
}
