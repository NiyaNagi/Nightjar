import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useIdentity } from '../contexts/IdentityContext';
import { useConfirmDialog } from './common/ConfirmDialog';
import { useEnvironment } from '../hooks/useEnvironment';
import RecoveryCodeModal from './RecoveryCodeModal';
import { createBackup, downloadBackup } from '../utils/backup';
import { copyDiagnosticReportToClipboard } from '../utils/diagnostics';
import './UserProfile.css';

// Preset emoji icons
const PRESET_ICONS = [
    '🦅', '😀', '😊', '🙂', '😎', '🤓', '🤠', '🥳', '😇', '🤔',
    '🧐', '👻', '🤖', '👽', '💀', '🎭', '🦸', '🦹', '🧙', '🧝',
    '🧛', '🐱', '🐶', '🦊', '🐻', '🐼', '🐨', '🦁', '🐯', '🐮',
    '🐷', '🐸', '🐵', '🐔', '🦉', '🐧', '🐝', '🦋', '🐙', '🦄',
    '🌸', '🌺', '🌻', '🌹', '🌵', '🌲', '🍀', '🌈', '⭐', '🌙',
    '☀️', '🔥', '💧', '❄️', '⚡', '💎', '🎯', '🎲', '🎮', '🎸',
];

// Preset colors
const PRESET_COLORS = [
    '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
    '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
    '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
    '#ec4899', '#f43f5e', '#64748b', '#1e293b', '#ffffff'
];

// Test user profiles for multi-client testing
const TEST_USER_PROFILES = [
    { name: 'Alice', color: '#ef4444', icon: '👩' },
    { name: 'Bob', color: '#3b82f6', icon: '👨' },
    { name: 'Charlie', color: '#22c55e', icon: '🧑' },
    { name: 'Diana', color: '#a855f7', icon: '👸' },
    { name: 'Eve', color: '#f59e0b', icon: '🦊' },
];

// Get test user from URL param (e.g., ?testUser=1 or ?testUser=Alice)
const getTestUserProfile = () => {
    const params = new URLSearchParams(window.location.search);
    const testUser = params.get('testUser');
    if (!testUser) return null;
    
    const index = parseInt(testUser, 10);
    if (!isNaN(index) && index >= 1 && index <= TEST_USER_PROFILES.length) {
        return TEST_USER_PROFILES[index - 1];
    }
    
    const byName = TEST_USER_PROFILES.find(p => 
        p.name.toLowerCase() === testUser.toLowerCase()
    );
    if (byName) return byName;
    
    const colors = ['#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#f59e0b'];
    const colorIndex = testUser.charCodeAt(0) % colors.length;
    return { name: testUser, color: colors[colorIndex], icon: '🧪' };
};

// Load user profile from localStorage
const loadUserProfile = () => {
    const testProfile = getTestUserProfile();
    if (testProfile) {
        console.log('[Dev] Using test user profile:', testProfile.name);
        return testProfile;
    }
    
    try {
        const saved = localStorage.getItem('nahma-user-profile');
        if (saved) {
            return JSON.parse(saved);
        }
    } catch (e) {
        console.error('Failed to load user profile:', e);
    }
    return {
        name: 'User' + Math.floor(Math.random() * 100),
        color: '#6366f1',
        icon: '😊'
    };
};

// Save user profile to localStorage
const saveUserProfile = (profile) => {
    try {
        localStorage.setItem('nahma-user-profile', JSON.stringify(profile));
    } catch (e) {
        console.error('Failed to save user profile:', e);
    }
};

const UserProfile = ({ onProfileChange, initialProfile, userProfile }) => {
    // Try to get identity context, but don't fail if not available
    let identityContext = { identity: null, publicIdentity: null, deleteIdentity: null };
    try {
        identityContext = useIdentity() || identityContext;
    } catch (e) {
        // IdentityContext not available, use defaults
    }
    const { identity, publicIdentity, deleteIdentity, updateIdentity } = identityContext;
    
    // Try to get confirm dialog, but don't fail if not available
    let confirmDialog = { confirm: null, ConfirmDialogComponent: null };
    try {
        confirmDialog = useConfirmDialog() || confirmDialog;
    } catch (e) {
        // ConfirmDialog not available
    }
    const { confirm, ConfirmDialogComponent } = confirmDialog;
    
    const { isElectron } = useEnvironment();

    const [profile, setProfile] = useState(() => {
        const loadedProfile = userProfile || initialProfile || loadUserProfile();
        // Sync with identity handle if it exists
        if (identity?.handle) {
            loadedProfile.name = identity.handle;
        }
        return loadedProfile;
    });
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState('appearance');
    const [showRecoveryModal, setShowRecoveryModal] = useState(false);
    const [success, setSuccess] = useState(null);
    const [preferences, setPreferences] = useState(() => {
        try {
            const saved = localStorage.getItem('nahma_preferences');
            return saved ? JSON.parse(saved) : {
                showCursor: true,
                showSelection: true,
                desktopNotifications: false,
                soundEffects: true,
                spellCheck: true,
                autoSave: true,
            };
        } catch {
            return { showCursor: true, showSelection: true, desktopNotifications: false, soundEffects: true, spellCheck: true, autoSave: true };
        }
    });
    const panelRef = useRef(null);

    // Sync profile name with identity handle
    useEffect(() => {
        if (identity?.handle && profile.name !== identity.handle) {
            setProfile(prev => ({ ...prev, name: identity.handle }));
        }
    }, [identity?.handle]);

    // Sync with external profile changes
    useEffect(() => {
        if (userProfile) {
            setProfile(userProfile);
        }
    }, [userProfile]);

    // Update parent and persist on profile change
    useEffect(() => {
        saveUserProfile(profile);
        if (onProfileChange) {
            onProfileChange(profile);
        }
    }, [profile, onProfileChange]);

    // Close panel when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (panelRef.current && !panelRef.current.contains(e.target)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen]);

    // Handle escape key
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && isOpen) {
                setIsOpen(false);
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    const updateProfile = (updates) => {
        setProfile(prev => ({ ...prev, ...updates }));
        // Sync name changes to identity handle
        if (updates.name && identity && updateIdentity) {
            updateIdentity({ handle: updates.name }).catch(e => {
                console.error('[UserProfile] Failed to sync name to identity:', e);
            });
        }
    };

    const handleDeleteIdentity = useCallback(async () => {
        if (!confirm || !deleteIdentity) return;
        
        const confirmed = await confirm({
            title: 'Delete Identity',
            message: 'Are you sure you want to delete your identity? This cannot be undone unless you have your recovery phrase.',
            confirmText: 'Delete Identity',
            cancelText: 'Cancel',
            variant: 'danger'
        });
        
        if (confirmed) {
            await deleteIdentity();
            setIsOpen(false);
        }
    }, [confirm, deleteIdentity]);

    const updatePreference = (key, value) => {
        setPreferences(prev => {
            const updated = { ...prev, [key]: value };
            try {
                localStorage.setItem('nahma_preferences', JSON.stringify(updated));
            } catch (e) {
                console.error('Failed to save preferences:', e);
            }
            return updated;
        });
    };

    const handleExportBackup = useCallback(() => {
        if (!identity) return;
        try {
            // Get workspaces from localStorage for backup
            const workspacesData = localStorage.getItem('nahma-workspaces');
            const workspaces = workspacesData ? JSON.parse(workspacesData) : [];
            const backup = createBackup(identity, workspaces);
            downloadBackup(backup);
            setSuccess('Backup downloaded!');
            setTimeout(() => setSuccess(null), 2000);
        } catch (e) {
            console.error('Failed to create backup:', e);
            setSuccess('Failed to create backup');
            setTimeout(() => setSuccess(null), 2000);
        }
    }, [identity]);

    return (
        <div className="user-profile" ref={panelRef}>
            <button 
                className="profile-trigger"
                onClick={() => setIsOpen(!isOpen)}
                style={{ borderColor: profile.color }}
                aria-label="Open profile settings"
            >
                <span className="profile-icon">{profile.icon}</span>
                <span className="profile-name">{profile.name}</span>
                <span className="profile-color-dot" style={{ backgroundColor: profile.color }} />
            </button>

            {isOpen && (
                <div className="profile-panel profile-panel--large" role="dialog" aria-modal="true">
                    <div className="profile-header">
                        <h3>Your Profile</h3>
                        <button className="btn-close" onClick={() => setIsOpen(false)} aria-label="Close">✕</button>
                    </div>

                    <div className="profile-preview">
                        <span 
                            className="preview-avatar"
                            style={{ backgroundColor: profile.color }}
                        >
                            {profile.icon}
                        </span>
                        <input
                            type="text"
                            value={profile.name}
                            onChange={(e) => updateProfile({ name: e.target.value })}
                            placeholder="Your name..."
                            className="name-input"
                        />
                    </div>

                    {/* Success message */}
                    {success && <div className="profile-success">{success}</div>}

                    <div className="profile-tabs">
                        <button 
                            className={`tab ${activeTab === 'appearance' ? 'active' : ''}`}
                            onClick={() => setActiveTab('appearance')}
                        >
                            🎨 Appearance
                        </button>
                        {identity && (
                            <button 
                                className={`tab ${activeTab === 'security' ? 'active' : ''}`}
                                onClick={() => setActiveTab('security')}
                            >
                                🔐 Security
                            </button>
                        )}
                        <button 
                            className={`tab ${activeTab === 'preferences' ? 'active' : ''}`}
                            onClick={() => setActiveTab('preferences')}
                        >
                            ⚙️ Preferences
                        </button>
                        <button 
                            className={`tab ${activeTab === 'support' ? 'active' : ''}`}
                            onClick={() => setActiveTab('support')}
                        >
                            🐛 Support
                        </button>
                    </div>

                    {activeTab === 'appearance' && (
                        <div className="tab-content">
                            <div className="section">
                                <label className="section-label">Color</label>
                                <div className="preset-colors">
                                    {PRESET_COLORS.map(color => (
                                        <button
                                            key={color}
                                            type="button"
                                            className={`color-option ${profile.color === color ? 'selected' : ''}`}
                                            style={{ backgroundColor: color }}
                                            onClick={() => updateProfile({ color })}
                                            title={color}
                                            aria-label={`Select color ${color}`}
                                            aria-pressed={profile.color === color}
                                        />
                                    ))}
                                </div>
                                <div className="custom-color">
                                    <label>Custom:</label>
                                    <input
                                        type="color"
                                        value={profile.color}
                                        onChange={(e) => updateProfile({ color: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="section">
                                <label className="section-label">Icon</label>
                                <div className="preset-icons">
                                    {PRESET_ICONS.map(icon => (
                                        <button
                                            key={icon}
                                            type="button"
                                            className={`icon-option ${profile.icon === icon ? 'selected' : ''}`}
                                            onClick={() => updateProfile({ icon })}
                                            aria-label={`Select icon ${icon}`}
                                            aria-pressed={profile.icon === icon}
                                        >
                                            {icon}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'security' && identity && (
                        <div className="tab-content security-tab">
                            <div className="section">
                                <label className="section-label">Your ID</label>
                                <div className="id-display">
                                    <code>{publicIdentity?.publicKey?.slice(0, 24)}...</code>
                                </div>
                            </div>

                            <div className="section">
                                <label className="section-label">Recovery Phrase</label>
                                <p className="section-hint">
                                    Your recovery phrase can restore your identity on any device. Keep it secret and safe.
                                </p>
                                <button 
                                    className="btn-secondary" 
                                    onClick={() => setShowRecoveryModal(true)}
                                >
                                    🔐 View Recovery Phrase
                                </button>
                            </div>

                            <div className="section">
                                <label className="section-label">Backup</label>
                                <p className="section-hint">
                                    Download an encrypted backup of your identity and workspace keys.
                                </p>
                                <button 
                                    className="btn-secondary" 
                                    onClick={handleExportBackup}
                                >
                                    💾 Export Backup
                                </button>
                            </div>

                            <div className="section">
                                <label className="section-label">Devices</label>
                                <div className="device-list">
                                    {identity?.devices?.map((device, i) => (
                                        <div key={device.id || i} className={`device-item ${device.isCurrent ? 'current' : ''}`}>
                                            <span className="device-icon">{device.platform === 'windows' ? '💻' : device.platform === 'macos' ? '🖥️' : device.platform === 'android' ? '📱' : '💻'}</span>
                                            <span className="device-name">{device.name || 'Unknown Device'}</span>
                                            {device.isCurrent && <span className="device-badge">This device</span>}
                                        </div>
                                    )) || <p className="section-hint">No devices registered</p>}
                                </div>
                            </div>

                            <div className="section danger-zone">
                                <label className="section-label">Danger Zone</label>
                                <p className="section-hint">
                                    Deleting your identity removes it from this device. Restore with your recovery phrase.
                                </p>
                                <button type="button" className="btn-danger" onClick={handleDeleteIdentity}>
                                    🗑️ Delete Identity
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'preferences' && (
                        <div className="tab-content preferences-tab">
                            <div className="section">
                                <label className="section-label">Collaboration</label>
                                <div className="toggle-row">
                                    <span className="toggle-label">Show my cursor to others</span>
                                    <label className="toggle-switch">
                                        <input 
                                            type="checkbox" 
                                            checked={preferences.showCursor ?? true}
                                            onChange={(e) => updatePreference('showCursor', e.target.checked)}
                                        />
                                        <span className="toggle-slider"></span>
                                    </label>
                                </div>
                                <div className="toggle-row">
                                    <span className="toggle-label">Show selection to others</span>
                                    <label className="toggle-switch">
                                        <input 
                                            type="checkbox" 
                                            checked={preferences.showSelection ?? true}
                                            onChange={(e) => updatePreference('showSelection', e.target.checked)}
                                        />
                                        <span className="toggle-slider"></span>
                                    </label>
                                </div>
                            </div>

                            <div className="section">
                                <label className="section-label">Notifications</label>
                                <div className="toggle-row">
                                    <span className="toggle-label">Desktop notifications</span>
                                    <label className="toggle-switch">
                                        <input 
                                            type="checkbox" 
                                            checked={preferences.desktopNotifications ?? false}
                                            onChange={(e) => updatePreference('desktopNotifications', e.target.checked)}
                                        />
                                        <span className="toggle-slider"></span>
                                    </label>
                                </div>
                                <div className="toggle-row">
                                    <span className="toggle-label">Sound effects</span>
                                    <label className="toggle-switch">
                                        <input 
                                            type="checkbox" 
                                            checked={preferences.soundEffects ?? true}
                                            onChange={(e) => updatePreference('soundEffects', e.target.checked)}
                                        />
                                        <span className="toggle-slider"></span>
                                    </label>
                                </div>
                            </div>

                            <div className="section">
                                <label className="section-label">Editor</label>
                                <div className="toggle-row">
                                    <span className="toggle-label">Spell check</span>
                                    <label className="toggle-switch">
                                        <input 
                                            type="checkbox" 
                                            checked={preferences.spellCheck ?? true}
                                            onChange={(e) => updatePreference('spellCheck', e.target.checked)}
                                        />
                                        <span className="toggle-slider"></span>
                                    </label>
                                </div>
                                <div className="toggle-row">
                                    <span className="toggle-label">Auto-save</span>
                                    <label className="toggle-switch">
                                        <input 
                                            type="checkbox" 
                                            checked={preferences.autoSave ?? true}
                                            onChange={(e) => updatePreference('autoSave', e.target.checked)}
                                        />
                                        <span className="toggle-slider"></span>
                                    </label>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'support' && (
                        <div className="tab-content support-tab">
                            <div className="section">
                                <label className="section-label">Report an Issue</label>
                                <p className="section-hint">
                                    Copy comprehensive diagnostic information to your clipboard for debugging.
                                    This includes console logs, system info, and P2P status.
                                </p>
                                <button 
                                    className="btn-secondary" 
                                    onClick={async () => {
                                        const result = await copyDiagnosticReportToClipboard();
                                        if (result.success) {
                                            setSuccess(`✓ Copied ${(result.size / 1024).toFixed(1)}KB of diagnostic data to clipboard`);
                                            setTimeout(() => setSuccess(null), 3000);
                                        } else {
                                            setSuccess(`✗ Failed to copy: ${result.error}`);
                                            setTimeout(() => setSuccess(null), 5000);
                                        }
                                    }}
                                >
                                    📋 Copy Diagnostic Report
                                </button>
                            </div>

                            <div className="section">
                                <label className="section-label">About</label>
                                <div className="about-info">
                                    <p><strong>Nightjar</strong></p>
                                    <p className="section-hint">Secure P2P Collaborative Text Editor</p>
                                    <p className="section-hint">Version: {isElectron ? window.electron?.appVersion || '1.0.0' : 'Web'}</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* RecoveryCodeModal overlay */}
            {showRecoveryModal && identity?.mnemonic && (
                <RecoveryCodeModal
                    mnemonic={identity.mnemonic}
                    onClose={() => setShowRecoveryModal(false)}
                />
            )}

            {ConfirmDialogComponent}
        </div>
    );
};

export { loadUserProfile, saveUserProfile, PRESET_ICONS, PRESET_COLORS };
export default UserProfile;
