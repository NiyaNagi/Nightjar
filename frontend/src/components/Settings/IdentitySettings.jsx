// frontend/src/components/Settings/IdentitySettings.jsx
// Settings panel for managing identity

import React, { useState, useCallback } from 'react';
import { useIdentity } from '../../contexts/IdentityContext';
import { generateQRCode } from '../../utils/qrcode';
import { generateTransferQRData, EMOJI_OPTIONS } from '../../utils/identity';
import { useConfirmDialog } from '../common/ConfirmDialog';
import './Settings.css';

const COLOR_PRESETS = [
    '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
    '#22c55e', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6',
    '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899'
];

export default function IdentitySettings({ onClose }) {
    const { identity, publicIdentity, updateIdentity, deleteIdentity, currentDevice } = useIdentity();
    const [activeTab, setActiveTab] = useState('profile');
    const [handle, setHandle] = useState(publicIdentity?.handle || '');
    const [selectedEmoji, setSelectedEmoji] = useState(publicIdentity?.icon || '🦊');
    const [selectedColor, setSelectedColor] = useState(publicIdentity?.color || '#3b82f6');
    const [showMnemonic, setShowMnemonic] = useState(false);
    const [qrData, setQrData] = useState(null);
    const [qrPin, setQrPin] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const { confirm, ConfirmDialogComponent } = useConfirmDialog();
    
    const handleSaveProfile = async () => {
        if (!handle.trim()) {
            setError('Display name is required');
            return;
        }
        
        setSaving(true);
        setError(null);
        
        try {
            await updateIdentity({
                handle: handle.trim(),
                icon: selectedEmoji,
                color: selectedColor
            });
            setSuccess('Profile updated!');
            setTimeout(() => setSuccess(null), 2000);
        } catch (e) {
            setError('Failed to save: ' + e.message);
        } finally {
            setSaving(false);
        }
    };
    
    const generateTransferQR = async () => {
        // Generate cryptographically secure random 4-digit PIN
        const array = new Uint32Array(1);
        crypto.getRandomValues(array);
        const pin = String(1000 + (array[0] % 9000));
        setQrPin(pin);
        
        try {
            const transferData = generateTransferQRData(identity, pin, 5);
            const qrImage = await generateQRCode(transferData, { width: 280 });
            setQrData(qrImage);
        } catch (e) {
            setError('Failed to generate QR code: ' + e.message);
        }
    };
    
    const handleDeleteIdentity = useCallback(async () => {
        const confirmed = await confirm({
            title: 'Delete Identity',
            message: 'Are you sure you want to delete your identity? This cannot be undone unless you have your recovery phrase.',
            confirmText: 'Delete Identity',
            cancelText: 'Cancel',
            variant: 'danger'
        });
        
        if (confirmed) {
            await deleteIdentity();
            onClose();
        }
    }, [confirm, deleteIdentity, onClose]);
    
    return (
        <div className="settings-overlay" onClick={onClose}>
            <div className="settings-panel" onClick={e => e.stopPropagation()}>
                <div className="settings-header">
                    <h2>Settings</h2>
                    <button className="close-btn" onClick={onClose}>✕</button>
                </div>
                
                <div className="settings-tabs">
                    <button 
                        className={`tab ${activeTab === 'profile' ? 'active' : ''}`}
                        onClick={() => setActiveTab('profile')}
                    >
                        Profile
                    </button>
                    <button 
                        className={`tab ${activeTab === 'security' ? 'active' : ''}`}
                        onClick={() => setActiveTab('security')}
                    >
                        Security
                    </button>
                    <button 
                        className={`tab ${activeTab === 'transfer' ? 'active' : ''}`}
                        onClick={() => setActiveTab('transfer')}
                    >
                        Transfer
                    </button>
                    <button 
                        className={`tab ${activeTab === 'devices' ? 'active' : ''}`}
                        onClick={() => setActiveTab('devices')}
                    >
                        Devices
                    </button>
                </div>
                
                <div className="settings-content">
                    {activeTab === 'profile' && (
                        <div className="tab-content">
                            <div className="profile-preview-settings" style={{ borderColor: selectedColor }}>
                                <div 
                                    className="avatar-large" 
                                    style={{ backgroundColor: selectedColor }}
                                >
                                    {selectedEmoji}
                                </div>
                                <div className="preview-handle">{handle || 'Your Name'}</div>
                                <div className="preview-id">ID: {publicIdentity?.publicKeyBase62?.slice(0, 12)}...</div>
                            </div>
                            
                            <div className="form-group">
                                <label>Display Name</label>
                                <input
                                    type="text"
                                    value={handle}
                                    onChange={(e) => setHandle(e.target.value)}
                                    placeholder="Enter your name"
                                    maxLength={30}
                                />
                            </div>
                            
                            <div className="form-group">
                                <label>Avatar</label>
                                <div className="emoji-picker compact">
                                    {EMOJI_OPTIONS.slice(0, 30).map((emoji) => (
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
                            {success && <div className="success-message">{success}</div>}
                            
                            <button 
                                className="btn-primary" 
                                onClick={handleSaveProfile}
                                disabled={saving}
                            >
                                {saving ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>
                    )}
                    
                    {activeTab === 'security' && (
                        <div className="tab-content">
                            <h3>Recovery Phrase</h3>
                            <p className="settings-description">
                                Your recovery phrase can restore your identity on any device.
                                Keep it secret and safe.
                            </p>
                            
                            {!showMnemonic ? (
                                <button 
                                    className="btn-secondary" 
                                    onClick={() => setShowMnemonic(true)}
                                >
                                    🔐 Show Recovery Phrase
                                </button>
                            ) : (
                                <div className="mnemonic-display">
                                    <div className="recovery-phrase-grid compact">
                                        {identity?.mnemonic?.split(' ').map((word, i) => (
                                            <div key={i} className="recovery-word">
                                                <span className="word-number">{i + 1}</span>
                                                <span className="word-text">{word}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <button 
                                        className="btn-secondary"
                                        onClick={() => setShowMnemonic(false)}
                                    >
                                        Hide
                                    </button>
                                </div>
                            )}
                            
                            <div className="danger-zone">
                                <h3>Danger Zone</h3>
                                <p className="settings-description">
                                    Deleting your identity will remove it from this device.
                                    You can restore it with your recovery phrase.
                                </p>
                                <button 
                                    className="btn-danger"
                                    onClick={handleDeleteIdentity}
                                >
                                    🗑️ Delete Identity
                                </button>
                            </div>
                        </div>
                    )}
                    
                    {activeTab === 'transfer' && (
                        <div className="tab-content">
                            <h3>Transfer to Another Device</h3>
                            <p className="settings-description">
                                Generate a QR code to transfer your identity to another device.
                                The QR code expires in 5 minutes.
                            </p>
                            
                            {!qrData ? (
                                <button className="btn-primary" onClick={generateTransferQR}>
                                    📱 Generate Transfer QR
                                </button>
                            ) : (
                                <div className="qr-transfer">
                                    <img src={qrData} alt="Transfer QR Code" className="qr-image" />
                                    <div className="pin-display">
                                        <span className="pin-label">PIN:</span>
                                        <span className="pin-value">{qrPin}</span>
                                    </div>
                                    <p className="qr-hint">
                                        Scan this QR code on your other device and enter the PIN above.
                                    </p>
                                    <button 
                                        className="btn-secondary"
                                        onClick={() => { setQrData(null); setQrPin(''); }}
                                    >
                                        Generate New QR
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                    
                    {activeTab === 'devices' && (
                        <div className="tab-content">
                            <h3>Your Devices</h3>
                            <p className="settings-description">
                                Devices where your identity is active.
                            </p>
                            
                            <div className="devices-list">
                                {identity?.devices?.map((device) => (
                                    <div key={device.id} className={`device-item ${device.isCurrent ? 'current' : ''}`}>
                                        <div className="device-icon">
                                            {device.platform === 'android' ? '📱' : 
                                             device.platform === 'ios' ? '📱' :
                                             device.platform === 'macos' ? '💻' :
                                             device.platform === 'windows' ? '🖥️' :
                                             device.platform === 'linux' ? '🐧' : '💻'}
                                        </div>
                                        <div className="device-info">
                                            <div className="device-name">
                                                {device.name}
                                                {device.isCurrent && <span className="current-badge">This device</span>}
                                            </div>
                                            <div className="device-platform">{device.platform}</div>
                                            <div className="device-last-seen">
                                                Last seen: {new Date(device.lastSeen).toLocaleString()}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            
                            <p className="settings-note">
                                Note: Device revocation coming soon. For now, use your recovery phrase to manage access.
                            </p>
                        </div>
                    )}
                </div>
            </div>
            {ConfirmDialogComponent}
        </div>
    );
}
