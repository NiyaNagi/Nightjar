/**
 * useAutoLock Hook
 * 
 * Monitors user activity and locks the app after configurable timeout.
 * Uses identityManager to manage session state.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import identityManager from '../utils/identityManager';

// Activity events to monitor
const ACTIVITY_EVENTS = [
    'mousedown',
    'mousemove',
    'keydown',
    'scroll',
    'touchstart',
    'click'
];

/**
 * Hook to manage auto-lock behavior
 * @returns {{ isLocked: boolean, lock: () => void, unlock: () => void }}
 */
export function useAutoLock() {
    const [isLocked, setIsLocked] = useState(false);
    const checkIntervalRef = useRef(null);
    const lastActivityRef = useRef(Date.now());
    
    // Check session validity
    const checkSession = useCallback(() => {
        // Only check if we have identities in the new PIN-protected system
        const identities = identityManager.listIdentities();
        if (identities.length === 0) {
            // No identities yet (fresh install or onboarding) - don't lock
            return;
        }
        
        // Check if there's an active identity ID
        const activeId = identityManager.getActiveIdentityId();
        if (!activeId) {
            // No active identity set - need to show identity selector, not lock screen
            return;
        }
        
        // Verify the active identity still exists (wasn't deleted)
        const activeExists = identities.some(i => i.id === activeId);
        if (!activeExists) {
            // Active identity was deleted - clear it and don't lock
            // This will cause IdentitySelector to show instead
            console.log('[useAutoLock] Active identity no longer exists, clearing');
            return;
        }
        
        // Check if session is valid
        if (!identityManager.isSessionValid()) {
            setIsLocked(true);
        }
    }, []);
    
    // Handle user activity - refresh session
    const handleActivity = useCallback(() => {
        lastActivityRef.current = Date.now();
        identityManager.refreshSession();
    }, []);
    
    // Lock manually
    const lock = useCallback(() => {
        identityManager.clearSession();
        setIsLocked(true);
    }, []);
    
    // Unlock callback
    const unlock = useCallback(() => {
        setIsLocked(false);
    }, []);
    
    // Set up activity listeners and session check interval
    useEffect(() => {
        // Initial check
        checkSession();
        
        // Set up interval to check session validity
        checkIntervalRef.current = setInterval(checkSession, 10000); // Check every 10 seconds
        
        // Set up activity listeners
        ACTIVITY_EVENTS.forEach(event => {
            window.addEventListener(event, handleActivity, { passive: true });
        });
        
        // Handle visibility change (tab becomes visible again)
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                checkSession();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        
        return () => {
            if (checkIntervalRef.current) {
                clearInterval(checkIntervalRef.current);
            }
            
            ACTIVITY_EVENTS.forEach(event => {
                window.removeEventListener(event, handleActivity);
            });
            
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [checkSession, handleActivity]);
    
    return {
        isLocked,
        lock,
        unlock,
        setIsLocked
    };
}

export default useAutoLock;
