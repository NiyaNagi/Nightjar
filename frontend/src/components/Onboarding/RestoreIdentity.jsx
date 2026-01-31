// frontend/src/components/Onboarding/RestoreIdentity.jsx
// Component for restoring identity from recovery phrase

import React, { useState } from 'react';
import { restoreIdentityFromMnemonic, validateMnemonic, EMOJI_OPTIONS } from '../../utils/identity';

const COLOR_PRESETS = [
    '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
    '#22c55e', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6',
    '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899'
];

export default function RestoreIdentity({ onComplete, onBack }) {
    const [words, setWords] = useState(Array(12).fill(''));
    const [handle, setHandle] = useState('');
    const [selectedEmoji, setSelectedEmoji] = useState(EMOJI_OPTIONS[0]);
    const [selectedColor, setSelectedColor] = useState(COLOR_PRESETS[0]);
    const [step, setStep] = useState('phrase'); // 'phrase' or 'profile'
    const [restoring, setRestoring] = useState(false);
    const [error, setError] = useState(null);
    
    const handleWordChange = (index, value) => {
        const newWords = [...words];
        
        // Check if user pasted multiple words
        const pastedWords = value.trim().split(/\s+/);
        if (pastedWords.length > 1) {
            // Fill in as many words as we can from the paste
            for (let i = 0; i < Math.min(pastedWords.length, 12 - index); i++) {
                newWords[index + i] = pastedWords[i].toLowerCase().trim();
            }
        } else {
            newWords[index] = value.toLowerCase().trim();
        }
        
        setWords(newWords);
        setError(null);
    };
    
    const handleValidatePhrase = () => {
        const mnemonic = words.join(' ').trim();
        
        if (words.some(w => !w)) {
            setError('Please fill in all 12 words');
            return;
        }
        
        if (!validateMnemonic(mnemonic)) {
            setError('Invalid recovery phrase. Please check each word carefully.');
            return;
        }
        
        setStep('profile');
    };
    
    const handleRestore = async () => {
        if (!handle.trim()) {
            setError('Please enter a display name');
            return;
        }
        
        setRestoring(true);
        setError(null);
        
        try {
            const mnemonic = words.join(' ').trim();
            const identity = restoreIdentityFromMnemonic(mnemonic);
            identity.handle = handle.trim();
            identity.icon = selectedEmoji;
            identity.color = selectedColor;
            
            onComplete(identity);
        } catch (e) {
            console.error('Failed to restore identity:', e);
            setError('Failed to restore: ' + e.message);
            setRestoring(false);
        }
    };
    
    if (step === 'profile') {
        return (
            <div className="onboarding-step create-step">
                <button className="btn-back" onClick={() => setStep('phrase')}>← Back</button>
                
                <h2>Set Up Your Profile</h2>
                <p className="onboarding-subtitle">
                    Recovery phrase verified! Now set up your profile.
                </p>
                
                <div className="profile-preview" style={{ borderColor: selectedColor }}>
                    <div 
                        className="avatar-large" 
                        style={{ backgroundColor: selectedColor }}
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
                    />
                </div>
                
                <div className="form-group">
                    <label>Avatar</label>
                    <div className="emoji-picker compact">
                        {EMOJI_OPTIONS.slice(0, 20).map((emoji) => (
                            <button
                                key={emoji}
                                className={`emoji-option ${emoji === selectedEmoji ? 'selected' : ''}`}
                                onClick={() => setSelectedEmoji(emoji)}
                            >
                                {emoji}
                            </button>
                        ))}
                    </div>
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
                            />
                        ))}
                    </div>
                </div>
                
                {error && <div className="error-message">{error}</div>}
                
                <button 
                    className="btn-primary" 
                    onClick={handleRestore}
                    disabled={restoring}
                >
                    {restoring ? 'Restoring...' : 'Restore Identity'}
                </button>
            </div>
        );
    }
    
    return (
        <div className="onboarding-step restore-step">
            <button className="btn-back" onClick={onBack}>← Back</button>
            
            <h2>Restore Your Identity</h2>
            <p className="onboarding-subtitle">
                Enter your 12-word recovery phrase
            </p>
            
            <div className="recovery-input-grid">
                {words.map((word, index) => (
                    <div key={index} className="word-input-wrapper">
                        <span className="word-number">{index + 1}</span>
                        <input
                            type="text"
                            value={word}
                            onChange={(e) => handleWordChange(index, e.target.value)}
                            placeholder="word"
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="off"
                            spellCheck="false"
                        />
                    </div>
                ))}
            </div>
            
            <p className="paste-hint">
                💡 Tip: You can paste all 12 words at once into the first field
            </p>
            
            {error && <div className="error-message">{error}</div>}
            
            <button className="btn-primary" onClick={handleValidatePhrase}>
                Continue
            </button>
        </div>
    );
}
