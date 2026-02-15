/**
 * DocumentCollaborators Component
 * 
 * Unified collaborator presence display that shows in the header of all document types.
 * Displays avatars of collaborators currently viewing/editing the document.
 * Optionally shows context-specific info (cell reference for sheets, etc).
 */

import React, { useState, useEffect, useCallback } from 'react';
import UserFlyout from './UserFlyout';
import './DocumentCollaborators.css';

const DocumentCollaborators = ({ 
    provider,          // Yjs provider with awareness
    userHandle,        // Current user's handle
    userColor,         // Current user's color
    documentType = 'text', // 'text', 'sheet', 'kanban'
    onFollowUser,      // Optional: callback when user clicks "follow"
    onStartChatWith,   // Optional: callback to start DM
}) => {
    const [collaborators, setCollaborators] = useState([]);
    const [selectedUser, setSelectedUser] = useState(null);
    const [flyoutPosition, setFlyoutPosition] = useState({ x: 0, y: 0 });

    // Subscribe to awareness changes
    useEffect(() => {
        if (!provider?.awareness) return;
        
        const awareness = provider.awareness;
        
        const updateCollaborators = () => {
            const states = awareness.getStates();
            const myClientId = awareness.clientID;
            const collabs = [];
            
            states.forEach((state, clientId) => {
                // Skip ourselves
                if (clientId === myClientId) return;
                
                if (state?.user) {
                    const selection = state.selection;
                    
                    // Build context info based on document type
                    let contextInfo = null;
                    if (documentType === 'sheet' && selection?.row && selection?.column) {
                        contextInfo = getCellRef(selection);
                    }
                    
                    collabs.push({
                        clientId,
                        name: state.user.name || 'Anonymous',
                        color: state.user.color || '#6366f1',
                        icon: state.user.icon,
                        contextInfo, // e.g., "A1", "B5:E12" for sheets
                        selection,
                    });
                }
            });
            
            setCollaborators(collabs);
        };
        
        // Initial update
        updateCollaborators();
        
        // Subscribe to changes
        awareness.on('change', updateCollaborators);
        
        return () => {
            awareness.off('change', updateCollaborators);
        };
    }, [provider, documentType]);

    // Handle clicking on a collaborator avatar
    const handleCollaboratorClick = useCallback((collab, event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        // Position flyout below the avatar
        setFlyoutPosition({
            x: Math.min(rect.left, window.innerWidth - 220),
            y: rect.bottom + 5
        });
        setSelectedUser(collab);
    }, []);

    if (collaborators.length === 0) return null;
    
    const maxDisplay = 5;
    const visible = collaborators.slice(0, maxDisplay);
    const overflow = collaborators.length - maxDisplay;
    
    return (
        <>
            <div className="doc-collaborators" data-testid="doc-collaborators">
                <span className="doc-collaborators__label">Collaborators:</span>
                <div className="doc-collaborators__bubbles" data-testid="doc-collaborators-bubbles">
                    {visible.map((user, idx) => (
                        <div
                            key={user.clientId || idx}
                            className="doc-collaborators__bubble"
                            data-testid={`doc-collaborator-${user.clientId || idx}`}
                            data-collaborator-name={user.name || 'Anonymous'}
                            data-collaborator-context={user.contextInfo || ''}
                            style={{ backgroundColor: user.color || '#6366f1' }}
                            title={`${user.name || 'Anonymous'}${user.contextInfo ? ` (${user.contextInfo})` : ''}`}
                            onClick={(e) => handleCollaboratorClick(user, e)}
                        >
                            <span className="doc-collaborators__bubble-initial">
                                {user.icon || user.name?.charAt(0).toUpperCase() || '?'}
                            </span>
                            {user.contextInfo && (
                                <span className="doc-collaborators__bubble-context" data-testid="collaborator-context">{user.contextInfo}</span>
                            )}
                        </div>
                    ))}
                    {overflow > 0 && (
                        <div className="doc-collaborators__bubble doc-collaborators__bubble--more" data-testid="doc-collaborators-overflow">
                            +{overflow}
                        </div>
                    )}
                </div>
            </div>
            
            {selectedUser && (
                <UserFlyout
                    user={{
                        name: selectedUser.name,
                        color: selectedUser.color,
                        icon: selectedUser.icon,
                    }}
                    position={flyoutPosition}
                    onClose={() => setSelectedUser(null)}
                    onFollow={onFollowUser ? () => onFollowUser(selectedUser) : null}
                    onStartChat={onStartChatWith ? () => onStartChatWith(selectedUser) : null}
                />
            )}
        </>
    );
};

// Helper: Convert column index to letter (0 -> A, 25 -> Z, 26 -> AA)
function colToLetter(col) {
    let letter = '';
    let c = col;
    while (c >= 0) {
        letter = String.fromCharCode(65 + (c % 26)) + letter;
        c = Math.floor(c / 26) - 1;
    }
    return letter;
}

// Helper: Get cell reference from selection
function getCellRef(selection) {
    if (!selection?.row || !selection?.column) return null;
    
    const rowStart = selection.row[0] ?? 0;
    const rowEnd = selection.row[1] ?? rowStart;
    const colStart = selection.column[0] ?? 0;
    const colEnd = selection.column[1] ?? colStart;
    
    const startRef = `${colToLetter(colStart)}${rowStart + 1}`;
    const endRef = `${colToLetter(colEnd)}${rowEnd + 1}`;
    
    if (startRef === endRef) {
        return startRef;
    }
    return `${startRef}:${endRef}`;
}

export default DocumentCollaborators;
