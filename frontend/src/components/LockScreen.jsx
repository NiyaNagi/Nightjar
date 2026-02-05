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
    
    useEffect(() => {
        // Get the active identity metadata
        const activeId = identityManager.getActiveIdentityId();
        if (activeId) {
            const identities = identityManager.listIdentities();
            const active = identities.find(i => i.id === activeId);
            setIdentity(active);
        }
    }, []);
    
    const handleUnlock = async (pinValue) => {
        if (!identity || pinValue.length !== 6) return;
        
        setUnlocking(true);
        setError(null);
        
        try {
            const result = await identityManager.unlockIdentity(identity.id, pinValue);
            onUnlock?.(result.identityData, result.metadata);
        } catch (err) {
            console.error('[LockScreen] Unlock failed:', err);
            setError(err.message);
            setPin('');
            
            // If deleted due to too many attempts
            if (err.message.includes('deleted')) {
                onSwitchIdentity?.();
            }
        } finally {
            setUnlocking(false);
        }
    };
    
    const remaining = identity ? identityManager.getRemainingAttempts(identity.id) : 10;
    
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
                            style={{ backgroundColor: identity.color + '20', color: identity.color }}
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
