// frontend/src/components/Presence/PeerCursors.jsx
// Renders remote peer cursors in the editor

import React from 'react';
import { usePresence } from '../../contexts/PresenceContext';
import './Presence.css';

export default function PeerCursors({ editorRef }) {
    const { peers } = usePresence();
    
    if (!editorRef?.current) return null;
    
    const peerList = Array.from(peers.values()).filter(p => p.cursor);
    
    return (
        <div className="peer-cursors-container" data-testid="peer-cursors-container">
            {peerList.map((peer) => (
                <PeerCursor 
                    key={peer.clientId}
                    peer={peer}
                    editorRef={editorRef}
                />
            ))}
        </div>
    );
}

function PeerCursor({ peer, editorRef }) {
    // This is a simplified cursor - actual implementation
    // would need to convert Yjs positions to screen coordinates
    // using the specific editor's API (ProseMirror, CodeMirror, etc.)
    
    const { user, cursor, isTyping } = peer;
    
    if (!cursor) return null;
    
    // For now, return a placeholder - actual implementation
    // depends on the editor being used
    return (
        <div 
            className="peer-cursor"
            data-testid={`peer-cursor-${peer.clientId}`}
            data-peer-name={user.name}
            data-peer-typing={isTyping ? 'true' : 'false'}
            style={{ 
                '--cursor-color': user.color,
                // Position would be calculated from cursor data
            }}
        >
            <div className="cursor-caret" data-testid="peer-cursor-caret" style={{ backgroundColor: user.color }}></div>
            <div className="cursor-label" data-testid="peer-cursor-label" style={{ backgroundColor: user.color }}>
                {user.icon} {user.name}
                {isTyping && <span className="cursor-typing" data-testid="peer-cursor-typing">...</span>}
            </div>
        </div>
    );
}
