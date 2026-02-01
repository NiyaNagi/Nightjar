// frontend/src/contexts/IdentityContext.jsx
// React context for identity management

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import secureStorage from '../utils/secureStorage';
import { secureError, secureLog } from '../utils/secureLogger';

const IdentityContext = createContext(null);

// Storage key for identity
const IDENTITY_KEY = 'identity';
const LEGACY_KEY = 'Nightjar-identity';

export function useIdentity() {
    const context = useContext(IdentityContext);
    if (!context) {
        throw new Error('useIdentity must be used within IdentityProvider');
    }
    return context;
}

export function IdentityProvider({ children }) {
    const [identity, setIdentity] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [needsOnboarding, setNeedsOnboarding] = useState(false);
    
    // Load identity on mount
    useEffect(() => {
        loadIdentity();
    }, []);
    
    const loadIdentity = useCallback(async () => {
        setLoading(true);
        setError(null);
        
        try {
            // Check if running in Electron with IPC
            if (window.electronAPI?.identity) {
                const stored = await window.electronAPI.identity.load();
                if (stored) {
                    // Convert hex strings back to Uint8Arrays if needed
                    const parsed = typeof stored === 'string' ? JSON.parse(stored) : stored;
                    setIdentity(parsed);
                    setNeedsOnboarding(false);
                } else {
                    setNeedsOnboarding(true);
                }
            } else {
                // Fallback for dev: use encrypted secure storage
                // First try to migrate legacy unencrypted data
                secureStorage.migrate(LEGACY_KEY, IDENTITY_KEY);
                
                const stored = secureStorage.get(IDENTITY_KEY);
                if (stored) {
                    setIdentity(stored);
                    setNeedsOnboarding(false);
                } else {
                    setNeedsOnboarding(true);
                }
            }
        } catch (e) {
            secureError('[Identity] Failed to load:', e);
            setError(e.message);
            setNeedsOnboarding(true);
        } finally {
            setLoading(false);
        }
    }, []);
    
    const createIdentity = useCallback(async (identityData) => {
        setLoading(true);
        setError(null);
        
        try {
            // Save via IPC if available
            if (window.electronAPI?.identity) {
                await window.electronAPI.identity.store(identityData);
            } else {
                // Dev fallback: use encrypted secure storage
                secureStorage.set(IDENTITY_KEY, identityData);
            }
            
            setIdentity(identityData);
            setNeedsOnboarding(false);
            
            // Dispatch event to notify other contexts that identity was created
            // WorkspaceContext listens for this to reinitialize P2P
            window.dispatchEvent(new CustomEvent('identity-created', { detail: identityData }));
            secureLog('[Identity] Identity created, dispatched identity-created event');
            
            return true;
        } catch (e) {
            secureError('[Identity] Failed to create:', e);
            setError(e.message);
            return false;
        } finally {
            setLoading(false);
        }
    }, []);
    
    const updateIdentity = useCallback(async (updates) => {
        if (!identity) return false;
        
        try {
            const updated = { ...identity, ...updates };
            
            if (window.electronAPI?.identity) {
                await window.electronAPI.identity.update(updates);
            } else {
                secureStorage.set(IDENTITY_KEY, updated);
            }
            
            setIdentity(updated);
            return true;
        } catch (e) {
            secureError('[Identity] Failed to update:', e);
            setError(e.message);
            return false;
        }
    }, [identity]);
    
    const deleteIdentity = useCallback(async () => {
        try {
            if (window.electronAPI?.identity) {
                await window.electronAPI.identity.delete();
            } else {
                secureStorage.remove(IDENTITY_KEY);
            }
            
            setIdentity(null);
            setNeedsOnboarding(true);
            return true;
        } catch (e) {
            secureError('[Identity] Failed to delete:', e);
            setError(e.message);
            return false;
        }
    }, []);
    
    const exportIdentity = useCallback(async (password) => {
        try {
            if (window.electronAPI?.identity) {
                return await window.electronAPI.identity.export(password);
            } else {
                // Simplified export for dev
                return JSON.stringify({
                    version: 1,
                    identity: identity
                });
            }
        } catch (e) {
            secureError('[Identity] Failed to export:', e);
            throw e;
        }
    }, [identity]);
    
    const importIdentity = useCallback(async (exportedData, password) => {
        try {
            let restored;
            
            if (window.electronAPI?.identity) {
                restored = await window.electronAPI.identity.import(exportedData, password);
            } else {
                // Simplified import for dev
                const parsed = JSON.parse(exportedData);
                restored = parsed.identity;
            }
            
            setIdentity(restored);
            setNeedsOnboarding(false);
            return true;
        } catch (e) {
            secureError('[Identity] Failed to import:', e);
            throw e;
        }
    }, []);
    
    // Get current device info from identity
    const currentDevice = identity?.devices?.find(d => d.isCurrent);
    
    // Get public identity for sharing
    const publicIdentity = identity ? {
        publicKey: identity.publicKeyBase62,
        handle: identity.handle,
        color: identity.color,
        icon: identity.icon,
        deviceId: currentDevice?.id,
        deviceName: currentDevice?.name
    } : null;
    
    const value = {
        identity,
        publicIdentity,
        currentDevice,
        loading,
        error,
        needsOnboarding,
        createIdentity,
        updateIdentity,
        deleteIdentity,
        exportIdentity,
        importIdentity,
        reloadIdentity: loadIdentity
    };
    
    return (
        <IdentityContext.Provider value={value}>
            {children}
        </IdentityContext.Provider>
    );
}
