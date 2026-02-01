// frontend/src/components/Onboarding/OnboardingFlow.jsx
// Main onboarding flow component - handles first-time setup

import React, { useState } from 'react';
import CreateIdentity from './CreateIdentity';
import RestoreIdentity from './RestoreIdentity';
import ScanIdentity from './ScanIdentity';
import { generateIdentity } from '../../utils/identity';
import './Onboarding.css';

const STEPS = {
    WELCOME: 'welcome',
    CREATE: 'create',
    RESTORE: 'restore',
    SCAN: 'scan',
    SHOW_RECOVERY: 'show_recovery'
};

export default function OnboardingFlow({ onComplete }) {
    const [step, setStep] = useState(STEPS.WELCOME);
    const [createdIdentity, setCreatedIdentity] = useState(null);
    
    const handleIdentityCreated = (identity) => {
        setCreatedIdentity(identity);
        setStep(STEPS.SHOW_RECOVERY);
    };
    
    const handleRecoveryConfirmed = () => {
        onComplete(createdIdentity);
    };
    
    const handleRestoreComplete = (identity) => {
        onComplete(identity);
    };
    
    // Handle skip - create default identity
    const handleSkip = () => {
        const defaultIdentity = generateIdentity();
        // Auto-generate anonymous name with random number
        defaultIdentity.handle = 'User' + Math.floor(Math.random() * 10000);
        defaultIdentity.icon = '😊';
        defaultIdentity.color = '#6366f1';
        onComplete(defaultIdentity);
    };
    
    return (
        <div className="onboarding-overlay">
            <div className="onboarding-container">
                {step === STEPS.WELCOME && (
                    <WelcomeStep 
                        onCreateNew={() => setStep(STEPS.CREATE)}
                        onRestore={() => setStep(STEPS.RESTORE)}
                        onScan={() => setStep(STEPS.SCAN)}
                        onSkip={handleSkip}
                    />
                )}
                
                {step === STEPS.CREATE && (
                    <CreateIdentity 
                        onComplete={handleIdentityCreated}
                        onBack={() => setStep(STEPS.WELCOME)}
                    />
                )}
                
                {step === STEPS.RESTORE && (
                    <RestoreIdentity 
                        onComplete={handleRestoreComplete}
                        onBack={() => setStep(STEPS.WELCOME)}
                    />
                )}
                
                {step === STEPS.SCAN && (
                    <ScanIdentity 
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

function WelcomeStep({ onCreateNew, onRestore, onScan, onSkip }) {
    return (
        <div className="onboarding-step welcome-step">
            <div className="onboarding-logo">✨</div>
            <h1>Welcome to Nightjar</h1>
            <p className="onboarding-subtitle">
                Secure, decentralized collaborative writing
            </p>
            
            <div className="welcome-description">
                <p>
                    Create your identity to start collaborating. Your identity is stored locally 
                    and never sent to any server.
                </p>
            </div>
            
            <div className="onboarding-actions">
                <button className="btn-primary" onClick={onCreateNew}>
                    Create New Identity
                </button>
                <button className="btn-secondary" onClick={onRestore}>
                    Restore with Recovery Phrase
                </button>
                <button className="btn-secondary" onClick={onScan}>
                    📷 Scan QR from Another Device
                </button>
                <button className="btn-text" onClick={onSkip}>
                    Skip for now (use defaults)
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
