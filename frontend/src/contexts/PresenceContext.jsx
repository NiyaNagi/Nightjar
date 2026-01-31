// frontend/src/contexts/PresenceContext.jsx
// React context for presence/awareness management

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Awareness } from 'y-protocols/awareness';
import { useIdentity } from './IdentityContext';

const PresenceContext = createContext(null);

export function usePresence() {
    const context = useContext(PresenceContext);
    if (!context) {
        throw new Error('usePresence must be used within PresenceProvider');
    }
    return context;
}

export function PresenceProvider({ children, awareness }) {
    const { publicIdentity } = useIdentity();
    const [peers, setPeers] = useState(new Map());
    const [isTyping, setIsTyping] = useState(false);
    const typingTimeoutRef = useRef(null);
    
    // Update local awareness state when identity changes
    useEffect(() => {
        if (!awareness || !publicIdentity) return;
        
        const localState = {
            user: {
                id: publicIdentity.publicKey,
                name: publicIdentity.handle,
                color: publicIdentity.color,
                icon: publicIdentity.icon,
                deviceId: publicIdentity.deviceId,
                deviceName: publicIdentity.deviceName
            },
            cursor: null,
            selection: null,
            isTyping: false,
            lastSeen: Date.now()
        };
        
        awareness.setLocalStateField('user', localState.user);
        awareness.setLocalStateField('lastSeen', localState.lastSeen);
        awareness.setLocalStateField('isTyping', false);
    }, [awareness, publicIdentity]);
    
    // Listen for awareness changes
    useEffect(() => {
        if (!awareness) return;
        
        const handleChange = () => {
            const states = awareness.getStates();
            const newPeers = new Map();
            
            states.forEach((state, clientId) => {
                if (clientId === awareness.clientID) return; // Skip self
                
                if (state.user) {
                    newPeers.set(clientId, {
                        clientId,
                        user: state.user,
                        cursor: state.cursor,
                        selection: state.selection,
                        isTyping: state.isTyping || false,
                        lastSeen: state.lastSeen || Date.now()
                    });
                }
            });
            
            setPeers(newPeers);
        };
        
        awareness.on('change', handleChange);
        handleChange(); // Initial load
        
        return () => {
            awareness.off('change', handleChange);
        };
    }, [awareness]);
    
    // Update cursor position
    const updateCursor = useCallback((position) => {
        if (!awareness) return;
        awareness.setLocalStateField('cursor', position);
    }, [awareness]);
    
    // Update selection
    const updateSelection = useCallback((selection) => {
        if (!awareness) return;
        awareness.setLocalStateField('selection', selection);
    }, [awareness]);
    
    // Set typing indicator
    const setTypingIndicator = useCallback((typing) => {
        if (!awareness) return;
        
        setIsTyping(typing);
        awareness.setLocalStateField('isTyping', typing);
        
        // Auto-clear typing after 3 seconds
        if (typing) {
            if (typingTimeoutRef.current) {
                clearTimeout(typingTimeoutRef.current);
            }
            typingTimeoutRef.current = setTimeout(() => {
                setIsTyping(false);
                awareness.setLocalStateField('isTyping', false);
            }, 3000);
        }
    }, [awareness]);
    
    // Cleanup typing timeout on unmount to prevent state updates after unmount
    useEffect(() => {
        return () => {
            if (typingTimeoutRef.current) {
                clearTimeout(typingTimeoutRef.current);
            }
        };
    }, []);
    
    // Update last seen timestamp
    const updateLastSeen = useCallback(() => {
        if (!awareness) return;
        awareness.setLocalStateField('lastSeen', Date.now());
    }, [awareness]);
    
    // Get online peers count
    const onlinePeersCount = peers.size;
    
    // Get typing peers
    const typingPeers = Array.from(peers.values()).filter(p => p.isTyping);
    
    const value = {
        peers,
        onlinePeersCount,
        typingPeers,
        isTyping,
        updateCursor,
        updateSelection,
        setTypingIndicator,
        updateLastSeen
    };
    
    return (
        <PresenceContext.Provider value={value}>
            {children}
        </PresenceContext.Provider>
    );
}
