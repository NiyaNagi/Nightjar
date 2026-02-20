// frontend/src/components/Onboarding/OnboardingFlow.jsx
// Main onboarding flow component - handles first-time setup

import React, { useState, useEffect } from 'react';
import CreateIdentity from './CreateIdentity';
import RestoreIdentity from './RestoreIdentity';
import { generateIdentity } from '../../utils/identity';
import { useIdentity } from '../../contexts/IdentityContext';
import identityManager from '../../utils/identityManager';
import { logBehavior } from '../../utils/logger';
import './Onboarding.css';

const STEPS = {
    WELCOME: 'welcome',
    CREATE: 'create',
    RESTORE: 'restore',
    SHOW_RECOVERY: 'show_recovery',
    MIGRATION: 'migration'
};

export default function OnboardingFlow({ onComplete, isMigration = false, legacyIdentity = null }) {
    const [step, setStep] = useState(isMigration ? STEPS.MIGRATION : STEPS.WELCOME);
    const [createdIdentity, setCreatedIdentity] = useState(null);
    const { hasExistingIdentity } = useIdentity();
    
    // If migration mode, pre-populate with legacy data
    useEffect(() => {
        if (isMigration && legacyIdentity) {
            setCreatedIdentity(legacyIdentity);
        }
    }, [isMigration, legacyIdentity]);
    
    const handleIdentityCreated = (identity) => {
        console.log('[OnboardingFlow] Identity created:', identity.handle, 'has PIN:', !!identity.pin);
        logBehavior('identity', 'onboarding_identity_created', { handle: identity.handle });
        setCreatedIdentity(identity);
        setStep(STEPS.SHOW_RECOVERY);
    };
    
    const handleRecoveryConfirmed = () => {
        console.log('[OnboardingFlow] Recovery confirmed, calling onComplete with:', createdIdentity?.handle);
        logBehavior('identity', 'onboarding_recovery_confirmed', { handle: createdIdentity?.handle });
        if (createdIdentity) {
            onComplete(createdIdentity);
        } else {
            console.error('[OnboardingFlow] No createdIdentity available!');
        }
    };
    
    const handleRestoreComplete = (identity, hadLocalData) => {
        logBehavior('identity', 'onboarding_restore_complete', { handle: identity?.handle, hadLocalData });
        onComplete(identity, hadLocalData);
    };
    
    const handleMigrationComplete = (identity) => {
        // Migration skips recovery phrase display since user already has it
        logBehavior('identity', 'onboarding_migration_complete', { handle: identity?.handle });
        onComplete(identity);
    };
    
    return (
        <div className="onboarding-overlay">
            <div className="onboarding-container">
                {step === STEPS.WELCOME && (
                    <WelcomeStep 
                        hasExistingIdentity={hasExistingIdentity}
                        onCreateNew={() => setStep(STEPS.CREATE)}
                        onRestore={() => setStep(STEPS.RESTORE)}
                    />
                )}
                
                {step === STEPS.CREATE && (
                    <CreateIdentity 
                        hasExistingIdentity={hasExistingIdentity}
                        onComplete={handleIdentityCreated}
                        onBack={() => setStep(STEPS.WELCOME)}
                    />
                )}
                
                {step === STEPS.RESTORE && (
                    <RestoreIdentity 
                        hasExistingIdentity={hasExistingIdentity}
                        onComplete={handleRestoreComplete}
                        onBack={() => setStep(STEPS.WELCOME)}
                    />
                )}
                
                {step === STEPS.SHOW_RECOVERY && createdIdentity && (
                    <ShowRecoveryStep 
                        mnemonic={createdIdentity.mnemonic}
                        onConfirm={handleRecoveryConfirmed}
                    />
                )}
                
                {step === STEPS.MIGRATION && legacyIdentity && (
                    <CreateIdentity 
                        hasExistingIdentity={false}
                        onComplete={handleMigrationComplete}
                        onBack={() => {}} // Can't go back during migration
                        isMigration={true}
                        migrationMessage="Your existing identity and data will be secured with a PIN. This is a one-time setup."
                    />
                )}
            </div>
        </div>
    );
}

function WelcomeStep({ hasExistingIdentity, onCreateNew, onRestore }) {
    return (
        <div className="onboarding-step welcome-step" data-testid="onboarding-welcome">
            <div className="onboarding-logo">
                <img 
                    src={`${window.location.protocol === 'file:' ? '.' : ''}/assets/nightjar-logo.png`}
                    alt="Nightjar" 
                    style={{ width: '200px', height: '200px' }} 
                />
            </div>
            <h1>Welcome to Nightjar</h1>
            <p className="onboarding-subtitle">
                Secure, decentralized collaborative writing
            </p>
            
            <div className="welcome-description">
                <p>
                    {hasExistingIdentity 
                        ? 'An identity exists on this device. Please choose an option:'
                        : 'Create your identity to start collaborating. Your identity is stored locally and never sent to any server.'
                    }
                </p>
            </div>
            
            <div className="onboarding-actions">
                <button className="btn-primary" onClick={() => { logBehavior('identity', 'onboarding_create_new_clicked'); onCreateNew(); }} data-testid="create-identity-btn">
                    Create New Identity
                </button>
                <button className="btn-secondary" onClick={() => { logBehavior('identity', 'onboarding_restore_clicked'); onRestore(); }} data-testid="restore-identity-btn">
                    I Have a Recovery Phrase
                </button>
            </div>
        </div>
    );
}

function ShowRecoveryStep({ mnemonic, onConfirm }) {
    const [confirmed, setConfirmed] = useState(false);
    const [copyStatus, setCopyStatus] = useState(null); // null | 'success' | 'error'
    const words = mnemonic.split(' ');
    
    const copyToClipboard = async () => {
        try {
            await navigator.clipboard.writeText(mnemonic);
            logBehavior('identity', 'onboarding_recovery_phrase_copied');
            setCopyStatus('success');
            setTimeout(() => setCopyStatus(null), 2000);
        } catch (e) {
            console.error('Failed to copy:', e);
            logBehavior('identity', 'onboarding_recovery_phrase_copy_failed');
            setCopyStatus('error');
            setTimeout(() => setCopyStatus(null), 3000);
        }
    };
    
    const handleContinue = () => {
        console.log('[ShowRecoveryStep] Continue clicked, confirmed:', confirmed);
        if (confirmed && onConfirm) {
            console.log('[ShowRecoveryStep] Calling onConfirm');
            onConfirm();
        }
    };
    
    return (
        <div className="onboarding-step recovery-step">
            <h2>🔐 Save Your Recovery Phrase</h2>
            <p className="onboarding-subtitle">
                Write down these 12 words and keep them safe. You'll need them to recover your 
                identity if you lose access to this device.
            </p>
            
            <div className="recovery-phrase-grid" data-testid="recovery-phrase">
                {words.map((word, index) => (
                    <div key={index} className="recovery-word">
                        <span className="word-number">{index + 1}</span>
                        <span className="word-text">{word}</span>
                    </div>
                ))}
            </div>
            
            <button className="btn-copy" onClick={copyToClipboard} type="button" data-testid="copy-recovery-btn">
                {copyStatus === 'success' ? '✓ Copied!' : copyStatus === 'error' ? '✗ Copy failed - please copy manually' : '📋 Copy to Clipboard'}
            </button>
            
            <div className="recovery-warning">
                <span className="warning-icon">⚠️</span>
                <div>
                    <strong>Important:</strong> Never share your recovery phrase with anyone. 
                    Anyone with these words can access your identity.
                </div>
            </div>
            
            <label className="confirm-checkbox">
                <input 
                    type="checkbox" 
                    checked={confirmed}
                    onChange={(e) => {
                        console.log('[ShowRecoveryStep] Checkbox changed:', e.target.checked);
                        setConfirmed(e.target.checked);
                    }}
                    data-testid="understood-checkbox"
                />
                <span>I have saved my recovery phrase in a safe place</span>
            </label>
            
            <button 
                type="button"
                className={`btn-primary ${confirmed ? '' : 'btn-disabled'}`}
                onClick={handleContinue}
                disabled={!confirmed}
                data-testid="continue-btn"
                aria-disabled={!confirmed}
            >
                Continue
            </button>
        </div>
    );
}
