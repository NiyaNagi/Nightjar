// frontend/src/components/Onboarding/CreateIdentity.jsx
// Component for creating a new identity with PIN protection

import React, { useState, useEffect } from 'react';
import { generateIdentity, EMOJI_OPTIONS, generateRandomColor } from '../../utils/identity';
import PinInput from '../PinInput';

const COLOR_PRESETS = [
    '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
    '#22c55e', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6',
    '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899'
];

const STEPS = {
    PROFILE: 'profile',
    PIN_CREATE: 'pin_create',
    PIN_CONFIRM: 'pin_confirm'
};

export default function CreateIdentity({ hasExistingIdentity, onComplete, onBack, isMigration = false, migrationMessage = null }) {
    const [step, setStep] = useState(STEPS.PROFILE);
    const [handle, setHandle] = useState('');
    const [selectedEmoji, setSelectedEmoji] = useState('');
    const [selectedColor, setSelectedColor] = useState('');
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState(null);
    const [showDeleteWarning, setShowDeleteWarning] = useState(false);
    const [deleteConfirmation, setDeleteConfirmation] = useState('');
    
    // PIN state
    const [pin, setPin] = useState('');
    const [pinConfirm, setPinConfirm] = useState('');
    const [pinError, setPinError] = useState(null);
    
    // Initialize with random values
    useEffect(() => {
        const randomEmoji = EMOJI_OPTIONS[Math.floor(Math.random() * EMOJI_OPTIONS.length)];
        const randomColor = COLOR_PRESETS[Math.floor(Math.random() * COLOR_PRESETS.length)];
        setSelectedEmoji(randomEmoji);
        setSelectedColor(randomColor);
    }, []);
    
    const handleProfileNext = () => {
        if (!handle.trim()) {
            setError('Please enter a display name');
            return;
        }
        
        if (handle.trim().length < 2) {
            setError('Display name must be at least 2 characters');
            return;
        }
        
        if (handle.trim().length > 30) {
            setError('Display name must be 30 characters or less');
            return;
        }
        
        // Check if existing identity and not migration mode
        if (hasExistingIdentity && !isMigration) {
            setShowDeleteWarning(true);
        } else {
            setError(null);
            setStep(STEPS.PIN_CREATE);
        }
    };
    
    const handleConfirmDelete = async () => {
        if (deleteConfirmation !== 'DELETE') {
            setError('Please type DELETE to confirm');
            return;
        }
        
        // Delete existing identity
        if (window.electronAPI?.identity) {
            await window.electronAPI.identity.delete();
        }
        
        // Proceed to PIN creation
        setShowDeleteWarning(false);
        setError(null);
        setStep(STEPS.PIN_CREATE);
    };
    
    const handlePinCreated = (pinValue) => {
        if (pinValue.length !== 6) {
            setPinError('PIN must be 6 digits');
            return;
        }
        setPin(pinValue);
        setPinError(null);
        setStep(STEPS.PIN_CONFIRM);
    };
    
    const handlePinConfirmed = (confirmValue) => {
        if (confirmValue !== pin) {
            setPinError('PINs do not match');
            setPinConfirm('');
            return;
        }
        
        // PINs match - create the identity
        handleCreate(confirmValue);
    };
    
    const handleCreate = async (confirmedPin) => {
        setCreating(true);
        setPinError(null);
        
        try {
            // Generate new identity
            const identity = generateIdentity();
            identity.handle = handle.trim();
            identity.icon = selectedEmoji;
            identity.color = selectedColor;
            identity.pin = confirmedPin; // Pass PIN for storage
            
            // Also set user profile to match
            const profileData = {
                name: handle.trim(),
                icon: selectedEmoji,
                color: selectedColor
            };
            localStorage.setItem('nahma-user-profile', JSON.stringify(profileData));
            
            onComplete(identity);
        } catch (e) {
            console.error('Failed to create identity:', e);
            setPinError('Failed to create identity: ' + e.message);
            setCreating(false);
        }
    };
    
    if (showDeleteWarning) {
        return (
            <div className="onboarding-step create-step">
                <div className="warning-box">
                    <div className="warning-icon">⚠️</div>
                    <h2>Warning: Existing Data Will Be Deleted</h2>
                    <p>
                        An identity already exists on this device. Creating a new identity will
                        <strong> permanently delete</strong>:
                    </p>
                    <ul style={{ textAlign: 'left', marginTop: '1rem' }}>
                        <li>Your current identity and recovery phrase</li>
                        <li>All workspace data</li>
                        <li>All documents and folders</li>
                        <li>All collaboration history</li>
                    </ul>
                    <p style={{ marginTop: '1rem' }}>
                        <strong>This cannot be undone</strong> unless you have your recovery phrase saved.
                    </p>
                    
                    <div className="form-group" style={{ marginTop: '2rem' }}>
                        <label htmlFor="delete-confirm">Type <code>DELETE</code> to confirm:</label>
                        <input
                            id="delete-confirm"
                            type="text"
                            value={deleteConfirmation}
                            onChange={(e) => setDeleteConfirmation(e.target.value)}
                            placeholder="DELETE"
                            autoFocus
                        />
                    </div>
                    
                    {error && <div className="error-message">{error}</div>}
                    
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                        <button 
                            className="btn-secondary" 
                            onClick={() => {
                                setShowDeleteWarning(false);
                                setDeleteConfirmation('');
                                setError(null);
                            }}
                            type="button"
                        >
                            Cancel
                        </button>
                        <button 
                            className="btn-danger" 
                            onClick={handleConfirmDelete}
                            disabled={deleteConfirmation !== 'DELETE'}
                            type="button"
                        >
                            Delete and Create New
                        </button>
                    </div>
                </div>
            </div>
        );
    }
    
    // PIN Creation step
    if (step === STEPS.PIN_CREATE) {
        return (
            <div className="onboarding-step create-step pin-step">
                <button className="btn-back" onClick={() => setStep(STEPS.PROFILE)} type="button">← Back</button>
                
                <div className="pin-step-header">
                    <div className="pin-icon">🔐</div>
                    <h2>Create a PIN</h2>
                    <p className="onboarding-subtitle">
                        Choose a 6-digit PIN to protect your identity. 
                        You'll need this PIN each time you open the app.
                    </p>
                </div>
                
                <div className="pin-step-content">
                    <PinInput
                        value={pin}
                        onChange={(val) => {
                            setPin(val);
                            setPinError(null);
                        }}
                        onComplete={handlePinCreated}
                        error={pinError}
                        label="Create your PIN"
                        autoFocus
                    />
                    
                    <div className="pin-security-note">
                        <span className="warning-icon">⚠️</span>
                        <div>
                            <strong>Security Warning:</strong> After 10 incorrect PIN attempts within an hour, 
                            your identity will be permanently deleted for security.
                        </div>
                    </div>
                </div>
            </div>
        );
    }
    
    // PIN Confirmation step
    if (step === STEPS.PIN_CONFIRM) {
        return (
            <div className="onboarding-step create-step pin-step">
                <button className="btn-back" onClick={() => {
                    setStep(STEPS.PIN_CREATE);
                    setPin('');
                    setPinConfirm('');
                    setPinError(null);
                }} type="button">← Back</button>
                
                <div className="pin-step-header">
                    <div className="pin-icon">🔐</div>
                    <h2>Confirm Your PIN</h2>
                    <p className="onboarding-subtitle">
                        Enter your PIN again to confirm
                    </p>
                </div>
                
                <div className="pin-step-content">
                    <PinInput
                        value={pinConfirm}
                        onChange={(val) => {
                            setPinConfirm(val);
                            setPinError(null);
                        }}
                        onComplete={handlePinConfirmed}
                        disabled={creating}
                        error={pinError}
                        label="Confirm your PIN"
                        autoFocus
                    />
                    
                    {creating && (
                        <div className="creating-indicator">
                            <div className="spinner" />
                            Creating your identity...
                        </div>
                    )}
                </div>
            </div>
        );
    }
    
    // Profile step (default)
    return (
        <div className="onboarding-step create-step">
            <button className="btn-back" onClick={onBack} type="button">← Back</button>
            
            <h2>{isMigration ? 'Secure Your Identity' : 'Create Your Identity'}</h2>
            <p className="onboarding-subtitle">
                {isMigration 
                    ? 'Set up a PIN to protect your existing data'
                    : 'Choose how you want to appear to collaborators'
                }
            </p>
            
            {migrationMessage && (
                <div className="migration-notice">
                    <span className="info-icon">ℹ️</span>
                    <div>{migrationMessage}</div>
                </div>
            )}
            
            <div className="profile-preview" style={{ borderColor: selectedColor }}>
                <div 
                    className="avatar-large" 
                    style={{ backgroundColor: selectedColor }}
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    onKeyDown={(e) => e.key === 'Enter' && setShowEmojiPicker(!showEmojiPicker)}
                    role="button"
                    tabIndex={0}
                >
                    {selectedEmoji}
                </div>
                <div className="preview-handle">{handle || 'Your Name'}</div>
            </div>
            
            <div className="form-group">
                <label htmlFor="handle">Display Name</label>
                <input
                    id="handle"
                    type="text"
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    placeholder="Enter your name"
                    maxLength={30}
                    autoFocus
                    data-testid="identity-name-input"
                />
            </div>
            
            <div className="form-group">
                <label>Avatar</label>
                <div className="avatar-selector">
                    <button 
                        className="current-avatar"
                        style={{ backgroundColor: selectedColor }}
                        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                        data-testid="emoji-picker-trigger"
                        type="button"
                    >
                        {selectedEmoji}
                    </button>
                    <span className="selector-hint">Click to change</span>
                </div>
                
                {showEmojiPicker && (
                    <div className="emoji-picker" data-testid="emoji-picker">
                        {EMOJI_OPTIONS.map((emoji) => (
                            <button
                                key={emoji}
                                className={`emoji-option ${emoji === selectedEmoji ? 'selected' : ''}`}
                                onClick={() => {
                                    setSelectedEmoji(emoji);
                                    setShowEmojiPicker(false);
                                }}
                                data-testid={`emoji-${emoji}`}
                                type="button"
                            >
                                {emoji}
                            </button>
                        ))}
                    </div>
                )}
            </div>
            
            <div className="form-group">
                <label>Color</label>
                <div className="color-picker">
                    {COLOR_PRESETS.map((color) => (
                        <button
                            key={color}
                            className={`color-option ${color === selectedColor ? 'selected' : ''}`}
                            style={{ backgroundColor: color }}
                            onClick={() => setSelectedColor(color)}
                            type="button"
                        />
                    ))}
                </div>
            </div>
            
            {error && (
                <div className="error-message">{error}</div>
            )}
            
            <button 
                className="btn-primary" 
                onClick={handleProfileNext}
                disabled={creating}
                data-testid="confirm-identity-btn"
                type="button"
            >
                Next: Set Up PIN →
            </button>
        </div>
    );
}
