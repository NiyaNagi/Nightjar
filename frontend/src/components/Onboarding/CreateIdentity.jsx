// frontend/src/components/Onboarding/CreateIdentity.jsx
// Component for creating a new identity

import React, { useState, useEffect } from 'react';
import { generateIdentity, EMOJI_OPTIONS, generateRandomColor } from '../../utils/identity';

const COLOR_PRESETS = [
    '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
    '#22c55e', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6',
    '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899'
];

export default function CreateIdentity({ hasExistingIdentity, onComplete, onBack }) {
    const [handle, setHandle] = useState('');
    const [selectedEmoji, setSelectedEmoji] = useState('');
    const [selectedColor, setSelectedColor] = useState('');
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState(null);
    const [showDeleteWarning, setShowDeleteWarning] = useState(false);
    const [deleteConfirmation, setDeleteConfirmation] = useState('');
    
    // Initialize with random values
    useEffect(() => {
        const randomEmoji = EMOJI_OPTIONS[Math.floor(Math.random() * EMOJI_OPTIONS.length)];
        const randomColor = COLOR_PRESETS[Math.floor(Math.random() * COLOR_PRESETS.length)];
        setSelectedEmoji(randomEmoji);
        setSelectedColor(randomColor);
    }, []);
    
    const handleCreateClick = () => {
        if (hasExistingIdentity) {
            setShowDeleteWarning(true);
        } else {
            handleCreate();
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
        
        // Proceed with creation
        setShowDeleteWarning(false);
        handleCreate();
    };
    
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
            setError('Failed to create identity: ' + e.message);
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
                        >
                            Cancel
                        </button>
                        <button 
                            className="btn-danger" 
                            onClick={handleConfirmDelete}
                            disabled={deleteConfirmation !== 'DELETE'}
                        >
                            Delete and Create New
                        </button>
                    </div>
                </div>
            </div>
        );
    }
    
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
                onClick={handleCreateClick}
                disabled={creating}
                data-testid="confirm-identity-btn"
            >
                {creating ? 'Creating...' : 'Create Identity'}
            </button>
        </div>
    );
}
