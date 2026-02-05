// frontend/src/components/Onboarding/OnboardingFlow.jsx
// Main onboarding flow component - handles first-time setup

import React, { useState, useEffect } from 'react';
import CreateIdentity from './CreateIdentity';
import RestoreIdentity from './RestoreIdentity';
import { generateIdentity } from '../../utils/identity';
import { useIdentity } from '../../contexts/IdentityContext';
import identityManager from '../../utils/identityManager';
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
        setCreatedIdentity(identity);
        setStep(STEPS.SHOW_RECOVERY);
    };
    
    const handleRecoveryConfirmed = () => {
        onComplete(createdIdentity);
    };
    
    const handleRestoreComplete = (identity, hadLocalData) => {
        onComplete(identity, hadLocalData);
    };
    
    const handleMigrationComplete = (identity) => {
        // Migration skips recovery phrase display since user already has it
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
                <button className="btn-primary" onClick={onCreateNew} data-testid="create-identity-btn">
                    Create New Identity
                </button>
                <button className="btn-secondary" onClick={onRestore} data-testid="restore-identity-btn">
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
            setCopyStatus('success');
            setTimeout(() => setCopyStatus(null), 2000);
        } catch (e) {
            console.error('Failed to copy:', e);
            setCopyStatus('error');
            setTimeout(() => setCopyStatus(null), 3000);
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
            
            <button className="btn-copy" onClick={copyToClipboard} data-testid="copy-recovery-btn">
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
                    onChange={(e) => setConfirmed(e.target.checked)}
                    data-testid="understood-checkbox"
                />
                <span>I have saved my recovery phrase in a safe place</span>
            </label>
            
            <button 
                className="btn-primary" 
                onClick={onConfirm}
                disabled={!confirmed}
                data-testid="continue-btn"
            >
                Continue
            </button>
        </div>
    );
}
