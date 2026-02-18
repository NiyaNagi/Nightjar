/**
 * LockScreen Component
 * 
 * Displayed when the app is locked due to inactivity timeout.
 * Requires PIN to unlock.
 */

import React, { useState, useEffect } from 'react';
import identityManager from '../utils/identityManager';
import PinInput from './PinInput';
import './LockScreen.css';

export default function LockScreen({ onUnlock, onSwitchIdentity }) {
    const [pin, setPin] = useState('');
    const [error, setError] = useState(null);
    const [unlocking, setUnlocking] = useState(false);
    const [identity, setIdentity] = useState(null);
    const [remaining, setRemaining] = useState(10);
    
    useEffect(() => {
        // Get the active identity metadata
        const activeId = identityManager.getActiveIdentityId();
        const identities = identityManager.listIdentities();
        
        // If no identities exist at all, this shouldn't be showing - switch to onboarding
        if (identities.length === 0) {
            console.warn('[LockScreen] No identities exist, should show onboarding instead');
            onSwitchIdentity?.();
            return;
        }
        
        if (activeId) {
            const active = identities.find(i => i.id === activeId);
            if (active) {
                setIdentity(active);
            } else {
                // Active identity not found (was deleted), clear and switch to identity selector
                console.warn('[LockScreen] Active identity not found, clearing and switching to identity selector');
                // Clear the stale active identity reference
                identityManager.clearSession();
                onSwitchIdentity?.();
            }
        } else {
            // No active identity, need to select one
            console.warn('[LockScreen] No active identity, switching to identity selector');
            onSwitchIdentity?.();
        }
    }, [onSwitchIdentity]);

    // Reset input state when identity changes
    useEffect(() => {
        setPin('');
        setError(null);
        setUnlocking(false);
        if (identity) {
            setRemaining(identityManager.getRemainingAttempts(identity.id));
        }
    }, [identity]);
    
    const handleUnlock = async (pinValue) => {
        if (!identity || pinValue.length !== 6) return;
        
        setUnlocking(true);
        setError(null);
        
        try {
            const result = await identityManager.unlockIdentity(identity.id, pinValue);
            setPin(''); // Clear PIN from state immediately on success
            onUnlock?.(result.identityData, result.metadata);
        } catch (err) {
            console.error('[LockScreen] Unlock failed:', err);
            setError(err.message);
            setPin('');
            if (identity) {
                setRemaining(identityManager.getRemainingAttempts(identity.id));
            }
            
            // If deleted due to too many attempts
            if (err.message.includes('deleted')) {
                setIdentity(null);
                onSwitchIdentity?.();
            }
        } finally {
            setUnlocking(false);
        }
    };
    
    return (
        <div className="lock-screen">
            <div className="lock-screen__content">
                <div className="lock-screen__header">
                    <div className="lock-screen__lock-icon">🔒</div>
                    <h1>Nightjar is Locked</h1>
                    <p>Enter your PIN to continue</p>
                </div>
                
                {identity && (
                    <div className="lock-screen__identity">
                        <div 
                            className="lock-screen__identity-icon"
                            style={{ backgroundColor: (identity.color || '#888888') + '20', color: identity.color || '#888888' }}
                        >
                            {identity.icon || '👤'}
                        </div>
                        <div className="lock-screen__identity-name">{identity.handle}</div>
                    </div>
                )}
                
                <div className="lock-screen__pin-area">
                    <PinInput
                        value={pin}
                        onChange={(val) => {
                            setPin(val);
                            setError(null);
                        }}
                        onComplete={handleUnlock}
                        disabled={unlocking}
                        error={error}
                        autoFocus
                    />
                    
                    <div className="lock-screen__attempts">
                        {remaining} attempts remaining
                    </div>
                    
                    {unlocking && (
                        <div className="lock-screen__unlocking">
                            <div className="lock-screen__spinner" />
                            Unlocking...
                        </div>
                    )}
                </div>
                
                <button 
                    className="lock-screen__switch-btn"
                    onClick={onSwitchIdentity}
                    type="button"
                >
                    Switch Identity
                </button>
            </div>
        </div>
    );
}
