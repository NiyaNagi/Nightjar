// frontend/src/contexts/IdentityContext.jsx
// React context for identity management

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import secureStorage from '../utils/secureStorage';
import { secureError, secureLog } from '../utils/secureLogger';
import identityManager from '../utils/identityManager';

const IdentityContext = createContext(null);

// Storage key for identity
const IDENTITY_KEY = 'identity';
const LEGACY_KEY = 'Nightjar-identity';

/**
 * Convert hex string keys from Electron IPC back to Uint8Array
 * Electron IPC returns privateKeyHex/publicKeyHex but crypto operations need Uint8Arrays
 */
function convertHexKeysToUint8Arrays(identityData) {
    if (!identityData) return identityData;
    
    const result = { ...identityData };
    
    // Convert privateKeyHex to privateKey (Uint8Array)
    if (result.privateKeyHex && !result.privateKey) {
        result.privateKey = new Uint8Array(
            result.privateKeyHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
        );
    }
    
    // Convert publicKeyHex to publicKey (Uint8Array)
    if (result.publicKeyHex && !result.publicKey) {
        result.publicKey = new Uint8Array(
            result.publicKeyHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
        );
    }
    
    return result;
}

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
    const [hasExistingIdentity, setHasExistingIdentity] = useState(false);
    
    // Load identity on mount - but DON'T auto-load if it exists
    useEffect(() => {
        checkIdentityExists();
    }, []);
    
    const checkIdentityExists = useCallback(async () => {
        setLoading(true);
        setError(null);
        
        try {
            // First check the new multi-identity system
            const newSystemIdentities = identityManager.listIdentities();
            if (newSystemIdentities.length > 0) {
                // Have identities in new system - don't need onboarding
                // The actual unlock will be handled by IdentitySelector in AppNew.jsx
                setHasExistingIdentity(true);
                setNeedsOnboarding(false);
                setLoading(false);
                return;
            }
            
            // Check if running in Electron with IPC (legacy system)
            if (window.electronAPI?.identity) {
                const exists = await window.electronAPI.identity.has();
                setHasExistingIdentity(exists);
                
                if (exists) {
                    // Identity exists - load it automatically
                    // This fixes the double-onboarding issue on Mac
                    const stored = await window.electronAPI.identity.load();
                    if (stored) {
                        const parsed = typeof stored === 'string' ? JSON.parse(stored) : stored;
                        // Convert hex keys from Electron IPC to Uint8Arrays for crypto operations
                        const converted = convertHexKeysToUint8Arrays(parsed);
                        setIdentity(converted);
                        setNeedsOnboarding(false);
                    } else {
                        setNeedsOnboarding(true);
                    }
                } else {
                    setNeedsOnboarding(true);
                }
            } else {
                // Fallback for dev: use encrypted secure storage
                secureStorage.migrate(LEGACY_KEY, IDENTITY_KEY);
                
                const stored = secureStorage.get(IDENTITY_KEY);
                setHasExistingIdentity(!!stored);
                
                if (stored) {
                    setIdentity(stored);
                    setNeedsOnboarding(false);
                } else {
                    setNeedsOnboarding(true);
                }
            }
        } catch (e) {
            secureError('[Identity] Failed to check:', e);
            setError(e.message);
            setNeedsOnboarding(true);
        } finally {
            setLoading(false);
        }
    }, []);
    
    const loadIdentity = useCallback(async () => {
        setLoading(true);
        setError(null);
        
        try {
            // Check if running in Electron with IPC
            if (window.electronAPI?.identity) {
                const stored = await window.electronAPI.identity.load();
                if (stored) {
                    // Convert hex strings back to Uint8Arrays for crypto operations
                    const parsed = typeof stored === 'string' ? JSON.parse(stored) : stored;
                    const converted = convertHexKeysToUint8Arrays(parsed);
                    setIdentity(converted);
                    setNeedsOnboarding(false);
                } else {
                    setNeedsOnboarding(true);
                }
            } else {
                // Fallback for dev: use encrypted secure storage
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
                // Web/Capacitor: Use WebCrypto for proper encryption
                if (!password) {
                    throw new Error('Password required for export');
                }
                
                // Generate random salt (16 bytes)
                const salt = crypto.getRandomValues(new Uint8Array(16));
                
                // Derive key from password using PBKDF2
                const encoder = new TextEncoder();
                const passwordKey = await crypto.subtle.importKey(
                    'raw',
                    encoder.encode(password),
                    'PBKDF2',
                    false,
                    ['deriveBits', 'deriveKey']
                );
                
                const derivedKey = await crypto.subtle.deriveKey(
                    {
                        name: 'PBKDF2',
                        salt: salt,
                        iterations: 100000,
                        hash: 'SHA-256'
                    },
                    passwordKey,
                    { name: 'AES-GCM', length: 256 },
                    false,
                    ['encrypt']
                );
                
                // Generate random IV (12 bytes for AES-GCM)
                const iv = crypto.getRandomValues(new Uint8Array(12));
                
                // Encrypt identity data
                const plaintext = encoder.encode(JSON.stringify(identity));
                const ciphertext = await crypto.subtle.encrypt(
                    { name: 'AES-GCM', iv: iv },
                    derivedKey,
                    plaintext
                );
                
                // Combine salt + iv + ciphertext and encode as base64
                const combined = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
                combined.set(salt, 0);
                combined.set(iv, salt.length);
                combined.set(new Uint8Array(ciphertext), salt.length + iv.length);
                
                // Return versioned export format
                return JSON.stringify({
                    version: 2,
                    data: btoa(String.fromCharCode(...combined))
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
                // Web/Capacitor: Decrypt using WebCrypto
                const parsed = JSON.parse(exportedData);
                
                if (parsed.version === 2) {
                    // New encrypted format
                    if (!password) {
                        throw new Error('Password required for import');
                    }
                    
                    // Decode base64 data
                    const combined = Uint8Array.from(atob(parsed.data), c => c.charCodeAt(0));
                    
                    // Extract salt (16 bytes), iv (12 bytes), and ciphertext
                    const salt = combined.slice(0, 16);
                    const iv = combined.slice(16, 28);
                    const ciphertext = combined.slice(28);
                    
                    // Derive key from password using PBKDF2
                    const encoder = new TextEncoder();
                    const passwordKey = await crypto.subtle.importKey(
                        'raw',
                        encoder.encode(password),
                        'PBKDF2',
                        false,
                        ['deriveBits', 'deriveKey']
                    );
                    
                    const derivedKey = await crypto.subtle.deriveKey(
                        {
                            name: 'PBKDF2',
                            salt: salt,
                            iterations: 100000,
                            hash: 'SHA-256'
                        },
                        passwordKey,
                        { name: 'AES-GCM', length: 256 },
                        false,
                        ['decrypt']
                    );
                    
                    // Decrypt
                    const plaintext = await crypto.subtle.decrypt(
                        { name: 'AES-GCM', iv: iv },
                        derivedKey,
                        ciphertext
                    );
                    
                    restored = JSON.parse(new TextDecoder().decode(plaintext));
                } else if (parsed.version === 1) {
                    // Legacy unencrypted format (for migration only)
                    restored = parsed.identity;
                } else {
                    throw new Error('Unsupported export format version');
                }
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
