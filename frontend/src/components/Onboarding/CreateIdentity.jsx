// frontend/src/components/Onboarding/CreateIdentity.jsx
// Component for creating a new identity

import React, { useState, useEffect } from 'react';
import { generateIdentity, EMOJI_OPTIONS, generateRandomColor } from '../../utils/identity';

const COLOR_PRESETS = [
    '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
    '#22c55e', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6',
    '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899'
];

export default function CreateIdentity({ onComplete, onBack }) {
    const [handle, setHandle] = useState('');
    const [selectedEmoji, setSelectedEmoji] = useState('');
    const [selectedColor, setSelectedColor] = useState('');
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState(null);
    
    // Initialize with random values
    useEffect(() => {
        const randomEmoji = EMOJI_OPTIONS[Math.floor(Math.random() * EMOJI_OPTIONS.length)];
        const randomColor = COLOR_PRESETS[Math.floor(Math.random() * COLOR_PRESETS.length)];
        setSelectedEmoji(randomEmoji);
        setSelectedColor(randomColor);
    }, []);
    
    const handleCreate = async () => {
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
        
        setCreating(true);
        setError(null);
        
        try {
            // Generate new identity
            const identity = generateIdentity();
            identity.handle = handle.trim();
            identity.icon = selectedEmoji;
            identity.color = selectedColor;
            
            onComplete(identity);
        } catch (e) {
            console.error('Failed to create identity:', e);
            setError('Failed to create identity: ' + e.message);
            setCreating(false);
        }
    };
    
    return (
        <div className="onboarding-step create-step">
            <button className="btn-back" onClick={onBack}>← Back</button>
            
            <h2>Create Your Identity</h2>
            <p className="onboarding-subtitle">
                Choose how you want to appear to collaborators
            </p>
            
            <div className="profile-preview" style={{ borderColor: selectedColor }}>
                <div 
                    className="avatar-large" 
                    style={{ backgroundColor: selectedColor }}
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
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
                <div className="avatar-selector">
                    <button 
                        className="current-avatar"
                        style={{ backgroundColor: selectedColor }}
                        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    >
                        {selectedEmoji}
                    </button>
                    <span className="selector-hint">Click to change</span>
                </div>
                
                {showEmojiPicker && (
                    <div className="emoji-picker">
                        {EMOJI_OPTIONS.map((emoji) => (
                            <button
                                key={emoji}
                                className={`emoji-option ${emoji === selectedEmoji ? 'selected' : ''}`}
                                onClick={() => {
                                    setSelectedEmoji(emoji);
                                    setShowEmojiPicker(false);
                                }}
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
                        />
                    ))}
                </div>
            </div>
            
            {error && (
                <div className="error-message">{error}</div>
            )}
            
            <button 
                className="btn-primary" 
                onClick={handleCreate}
                disabled={creating}
            >
                {creating ? 'Creating...' : 'Create Identity'}
            </button>
        </div>
    );
}
