// frontend/src/components/Onboarding/OnboardingFlow.jsx
// Main onboarding flow component - handles first-time setup

import React, { useState } from 'react';
import CreateIdentity from './CreateIdentity';
import RestoreIdentity from './RestoreIdentity';
import { generateIdentity } from '../../utils/identity';
import { useIdentity } from '../../contexts/IdentityContext';
import './Onboarding.css';

const STEPS = {
    WELCOME: 'welcome',
    CREATE: 'create',
    RESTORE: 'restore',
    SHOW_RECOVERY: 'show_recovery'
};

export default function OnboardingFlow({ onComplete }) {
    const [step, setStep] = useState(STEPS.WELCOME);
    const [createdIdentity, setCreatedIdentity] = useState(null);
    const { hasExistingIdentity } = useIdentity();
    
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
            </div>
        </div>
    );
}

function WelcomeStep({ hasExistingIdentity, onCreateNew, onRestore }) {
    return (
        <div className="onboarding-step welcome-step">
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
                <button className="btn-primary" onClick={onCreateNew}>
                    Create New Identity
                </button>
                <button className="btn-secondary" onClick={onRestore}>
                    I Have a Recovery Phrase
                </button>
            </div>
        </div>
    );
}

function ShowRecoveryStep({ mnemonic, onConfirm }) {
    const [confirmed, setConfirmed] = useState(false);
    const words = mnemonic.split(' ');
    
    const copyToClipboard = async () => {
        try {
            await navigator.clipboard.writeText(mnemonic);
        } catch (e) {
            console.error('Failed to copy:', e);
        }
    };
    
    return (
        <div className="onboarding-step recovery-step">
            <h2>🔐 Save Your Recovery Phrase</h2>
            <p className="onboarding-subtitle">
                Write down these 12 words and keep them safe. You'll need them to recover your 
                identity if you lose access to this device.
            </p>
            
            <div className="recovery-phrase-grid">
                {words.map((word, index) => (
                    <div key={index} className="recovery-word">
                        <span className="word-number">{index + 1}</span>
                        <span className="word-text">{word}</span>
                    </div>
                ))}
            </div>
            
            <button className="btn-copy" onClick={copyToClipboard}>
                📋 Copy to Clipboard
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
                />
                <span>I have saved my recovery phrase in a safe place</span>
            </label>
            
            <button 
                className="btn-primary" 
                onClick={onConfirm}
                disabled={!confirmed}
            >
                Continue
            </button>
        </div>
    );
}
