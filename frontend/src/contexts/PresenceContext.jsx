// frontend/src/contexts/PresenceContext.jsx
// React context for presence/awareness management

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Awareness } from 'y-protocols/awareness';
import { useIdentity } from './IdentityContext';
import { generateIdentityColor } from '../utils/colorUtils';

// Presence update throttle in milliseconds (matches sidecar AWARENESS_THROTTLE_MS)
const PRESENCE_THROTTLE_MS = 100;

const PresenceContext = createContext(null);

export function usePresence() {
    const context = useContext(PresenceContext);
    if (!context) {
        throw new Error('usePresence must be used within PresenceProvider');
    }
    return context;
}

// Simple throttle function
function throttle(func, limit) {
    let inThrottle = false;
    let lastArgs = null;
    
    return function(...args) {
        lastArgs = args;
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => {
                inThrottle = false;
                // Execute with last args if any were queued
                if (lastArgs) {
                    func.apply(this, lastArgs);
                    lastArgs = null;
                }
            }, limit);
        }
    };
}

export function PresenceProvider({ children, awareness }) {
    const { publicIdentity } = useIdentity();
    const [peers, setPeers] = useState(new Map());
    const [isTyping, setIsTyping] = useState(false);
    const typingTimeoutRef = useRef(null);
    // Track mounted state to prevent setState after unmount
    const isMountedRef = useRef(true);
    
    // Update local awareness state when identity changes
    // Use deterministic color based on publicKey for consistent identity colors
    useEffect(() => {
        if (!awareness || !publicIdentity) return;
        
        // Generate deterministic color from publicKey
        const identityColor = publicIdentity.color || generateIdentityColor(publicIdentity.publicKey);
        
        const localState = {
            user: {
                id: publicIdentity.publicKey,
                name: publicIdentity.handle,
                color: identityColor,
                icon: publicIdentity.icon,
                deviceId: publicIdentity.deviceId,
                deviceName: publicIdentity.deviceName,
                publicKey: publicIdentity.publicKey, // Include publicKey for DM routing
                lastActive: Date.now()
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
                        lastSeen: state.lastSeen || Date.now(),
                        openDocumentId: state.openDocumentId || null
                    });
                }
            });
            
            setPeers(newPeers);
        };
        
        awareness.on('change', handleChange);
        handleChange(); // Initial load
        
        return () => {
            awareness.off('change', handleChange);
            // Clear local awareness state on unmount to remove stale presence
            try {
                awareness.setLocalState(null);
            } catch (e) {
                // Ignore errors if awareness is already destroyed
            }
        };
    }, [awareness]);
    
    // Update cursor position with optional documentId for per-document filtering
    // Throttled to 100ms to match sidecar and prevent excessive network traffic
    const updateCursorRaw = useCallback((position, documentId = null) => {
        if (!awareness) return;
        awareness.setLocalStateField('cursor', position);
        if (documentId) {
            awareness.setLocalStateField('openDocumentId', documentId);
        }
    }, [awareness]);
    
    // Memoize throttled version
    const updateCursor = useMemo(
        () => throttle(updateCursorRaw, PRESENCE_THROTTLE_MS),
        [updateCursorRaw]
    );
    
    // Update selection with optional documentId for per-document filtering
    // Throttled to 100ms to match sidecar and prevent excessive network traffic
    const updateSelectionRaw = useCallback((selection, documentId = null) => {
        if (!awareness) return;
        awareness.setLocalStateField('selection', selection);
        if (documentId) {
            awareness.setLocalStateField('openDocumentId', documentId);
        }
    }, [awareness]);
    
    // Memoize throttled version
    const updateSelection = useMemo(
        () => throttle(updateSelectionRaw, PRESENCE_THROTTLE_MS),
        [updateSelectionRaw]
    );
    
    // Update which document is currently open (for presence indicators)
    const updateOpenDocument = useCallback((documentId) => {
        if (!awareness) return;
        awareness.setLocalStateField('openDocumentId', documentId);
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
                // Check if component is still mounted before setState
                if (!isMountedRef.current) return;
                setIsTyping(false);
                if (awareness) {
                    awareness.setLocalStateField('isTyping', false);
                }
            }, 3000);
        }
    }, [awareness]);
    
    // Cleanup typing timeout on unmount to prevent state updates after unmount
    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
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
    
    // Get typing peers - memoize to prevent unnecessary re-renders
    const typingPeers = useMemo(() => 
        Array.from(peers.values()).filter(p => p.isTyping), 
        [peers]
    );
    
    // Get peers on a specific document
    const getPeersOnDocument = useCallback((documentId) => {
        if (!documentId) return [];
        return Array.from(peers.values()).filter(p => 
            p.openDocumentId === documentId
        );
    }, [peers]);
    
    // Memoize context value to prevent unnecessary re-renders of consumers
    const value = useMemo(() => ({
        peers,
        onlinePeersCount,
        typingPeers,
        isTyping,
        updateCursor,
        updateSelection,
        updateOpenDocument,
        setTypingIndicator,
        updateLastSeen,
        getPeersOnDocument
    }), [peers, onlinePeersCount, typingPeers, isTyping, updateCursor, updateSelection, 
         updateOpenDocument, setTypingIndicator, updateLastSeen, getPeersOnDocument]);
    
    return (
        <PresenceContext.Provider value={value}>
            {children}
        </PresenceContext.Provider>
    );
}
