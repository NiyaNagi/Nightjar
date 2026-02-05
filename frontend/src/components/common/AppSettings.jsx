/**
 * AppSettings Modal
 * 
 * Comprehensive settings modal for the entire application.
 * Organized into tabs for different categories of settings.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import './AppSettings.css';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useConfirmDialog } from './ConfirmDialog';
import { useEnvironment, isFeatureAvailable } from '../../hooks/useEnvironment';

// Default settings values
const DEFAULT_SETTINGS = {
  // General
  theme: 'system', // 'light', 'dark', 'system'
  
  // Editor
  fontSize: 16,
  fontFamily: 'system',
  lineHeight: 1.6,
  spellCheck: true,
  wordWrap: true,
};

// Font options
const FONT_OPTIONS = [
  { value: 'system', label: 'System Default' },
  { value: 'inter', label: 'Inter' },
  { value: 'roboto', label: 'Roboto' },
  { value: 'fira-code', label: 'Fira Code (Monospace)' },
  { value: 'jetbrains-mono', label: 'JetBrains Mono' },
  { value: 'source-sans', label: 'Source Sans Pro' },
];

// Load settings from localStorage
const loadSettings = () => {
  try {
    const saved = localStorage.getItem('Nightjar-app-settings');
    if (saved) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
  return { ...DEFAULT_SETTINGS };
};

// Save settings to localStorage
const saveSettings = (settings) => {
  try {
    localStorage.setItem('Nightjar-app-settings', JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
};

// Apply theme to document (also handles system preference)
const applyTheme = (theme) => {
  if (theme === 'system') {
    // Remove manual override, let system preference take over
    document.documentElement.removeAttribute('data-theme');
    // Check system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (!prefersDark) {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
};

// Apply editor settings to document (font size, line height, etc.)
const applyEditorSettings = (settings) => {
  document.documentElement.style.setProperty('--editor-font-size', `${settings.fontSize}px`);
  document.documentElement.style.setProperty('--editor-line-height', settings.lineHeight);
  
  // Apply font family
  const fontFamilyMap = {
    'system': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    'inter': '"Inter", sans-serif',
    'roboto': '"Roboto", sans-serif',
    'fira-code': '"Fira Code", monospace',
    'jetbrains-mono': '"JetBrains Mono", monospace',
    'source-sans': '"Source Sans Pro", sans-serif',
  };
  document.documentElement.style.setProperty(
    '--editor-font-family', 
    fontFamilyMap[settings.fontFamily] || fontFamilyMap['system']
  );
  
  // Apply word wrap setting
  document.documentElement.setAttribute('data-word-wrap', settings.wordWrap ? 'on' : 'off');
  
  // Apply spell check setting
  document.documentElement.setAttribute('data-spell-check', settings.spellCheck ? 'on' : 'off');
};

// Apply all settings on initial page load
const initializeSettings = () => {
  const savedSettings = loadSettings();
  applyTheme(savedSettings.theme);
  applyEditorSettings(savedSettings);
};

// Run settings initialization immediately
initializeSettings();

export default function AppSettings({ isOpen, onClose }) {
  const { isElectron } = useEnvironment();
  const [activeTab, setActiveTab] = useState('general');
  const [settings, setSettings] = useState(loadSettings);
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const modalRef = useRef(null);
  const { confirm, ConfirmDialogComponent } = useConfirmDialog();
  
  // Desktop-only settings state (Electron)
  const [torMode, setTorMode] = useState('disabled');
  const [torStatus, setTorStatus] = useState({ running: false, bootstrapped: false, onionAddress: null });
  const [relayEnabled, setRelayEnabled] = useState(false);
  const [relaySettings, setRelaySettings] = useState({ port: 4445, maxConnections: 10, announceOnDHT: true });
  const [relayStatus, setRelayStatus] = useState({ running: false, activeConnections: 0 });
  
  // Focus trap for modal accessibility
  useFocusTrap(modalRef, isOpen, { onEscape: onClose });

  // Load settings on open
  useEffect(() => {
    if (isOpen) {
      setSettings(loadSettings());
      setHasChanges(false);
      
      // Load desktop-only settings from Electron
      if (isElectron && isFeatureAvailable('tor')) {
        loadDesktopSettings();
      }
    }
  }, [isOpen, isElectron]);
  
  // Load desktop-only settings (Tor, Relay)
  const loadDesktopSettings = async () => {
    try {
      // Load Tor status
      if (window.electronAPI?.tor) {
        const status = await window.electronAPI.tor.getStatus();
        setTorStatus(status);
        const savedMode = localStorage.getItem('Nightjar_tor_mode') || 'disabled';
        setTorMode(savedMode);
      }
      
      // Load Relay settings
      if (window.electronAPI?.invoke) {
        const result = await window.electronAPI.invoke('relay:getSettings');
        if (result?.settings) {
          setRelaySettings(result.settings);
          setRelayEnabled(result.settings.enabled || false);
        }
        if (result?.relayStatus) {
          setRelayStatus(result.relayStatus);
        }
      }
    } catch (err) {
      console.warn('Failed to load desktop settings:', err);
    }
  };

  // Update a setting and apply immediately for visual settings
  const updateSetting = useCallback((key, value) => {
    setSettings(prev => {
      const newSettings = { ...prev, [key]: value };
      
      // Apply visual settings immediately when changed
      if (key === 'theme') {
        applyTheme(value);
      } else if (['fontSize', 'fontFamily', 'lineHeight'].includes(key)) {
        applyEditorSettings(newSettings);
      }
      
      return newSettings;
    });
    setHasChanges(true);
  }, []);

  // Save all settings
  const handleSave = useCallback(() => {
    setSaving(true);
    saveSettings(settings);
    
    // Apply all settings
    applyTheme(settings.theme);
    applyEditorSettings(settings);
    
    setTimeout(() => {
      setSaving(false);
      setHasChanges(false);
    }, 300);
  }, [settings]);

  // Reset to defaults
  const handleReset = useCallback(async () => {
    const confirmed = await confirm({
      title: 'Reset Settings',
      message: 'Reset all settings to defaults? This cannot be undone.',
      confirmText: 'Reset',
      cancelText: 'Cancel',
      variant: 'warning'
    });
    if (confirmed) {
      setSettings({ ...DEFAULT_SETTINGS });
      setHasChanges(true);
    }
  }, [confirm]);

  // Handle keyboard
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose?.();
    }
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSave();
    }
  };

  if (!isOpen) return null;

  const tabs = [
    { id: 'general', label: '⚙️ General', icon: '⚙️' },
    { id: 'editor', label: '✏️ Editor', icon: '✏️' },
    { id: 'privacy', label: '🔒 Privacy', icon: '🔒' },
    { id: 'shortcuts', label: '⌨️ Shortcuts', icon: '⌨️' },
    { id: 'advanced', label: '🛠️ Advanced', icon: '🛠️' },
    ...(isElectron ? [{ id: 'desktop', label: '🖥️ Desktop', icon: '🖥️' }] : []),
    { id: 'about', label: 'ℹ️ About', icon: 'ℹ️' },
  ];
  
  // Handle Tor mode change
  const handleTorModeChange = async (newMode) => {
    setTorMode(newMode);
    localStorage.setItem('Nightjar_tor_mode', newMode);
    
    if (window.electronAPI?.tor) {
      if (newMode === 'disabled') {
        await window.electronAPI.tor.stop();
        setTorStatus({ running: false, bootstrapped: false, onionAddress: null });
      }
    }
  };
  
  // Handle Tor start
  const handleStartTor = async () => {
    if (window.electronAPI?.tor) {
      try {
        await window.electronAPI.tor.start(torMode);
        const status = await window.electronAPI.tor.getStatus();
        setTorStatus(status);
      } catch (err) {
        console.error('Failed to start Tor:', err);
      }
    }
  };
  
  // Handle Tor stop
  const handleStopTor = async () => {
    if (window.electronAPI?.tor) {
      try {
        await window.electronAPI.tor.stop();
        setTorStatus({ running: false, bootstrapped: false, onionAddress: null });
      } catch (err) {
        console.error('Failed to stop Tor:', err);
      }
    }
  };
  
  // Toggle relay
  const handleToggleRelay = async () => {
    if (window.electronAPI?.invoke) {
      try {
        const newEnabled = !relayEnabled;
        await window.electronAPI.invoke(
          newEnabled ? 'relay:start' : 'relay:stop',
          { ...relaySettings, enabled: newEnabled }
        );
        setRelayEnabled(newEnabled);
        
        // Refresh status
        const result = await window.electronAPI.invoke('relay:getSettings');
        if (result?.relayStatus) {
          setRelayStatus(result.relayStatus);
        }
      } catch (err) {
        console.error('Failed to toggle relay:', err);
      }
    }
  };

  return (
    <div 
      className="app-settings-overlay" 
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
      onKeyDown={handleKeyDown}
    >
      <div ref={modalRef} className="app-settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        {/* Header */}
        <div className="app-settings__header">
          <h2 id="settings-title" className="app-settings__title">Settings</h2>
          <button 
            type="button"
            className="app-settings__close"
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <div className="app-settings__body">
          {/* Sidebar tabs */}
          <nav className="app-settings__nav">
            {tabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                className={`app-settings__nav-item ${activeTab === tab.id ? 'app-settings__nav-item--active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="app-settings__content">
            {/* General Tab */}
            {activeTab === 'general' && (
              <div className="app-settings__section">
                <h3 className="app-settings__section-title">Appearance</h3>
                
                <div className="app-settings__field">
                  <label className="app-settings__label">Theme</label>
                  <select
                    className="app-settings__select"
                    value={settings.theme}
                    onChange={(e) => updateSetting('theme', e.target.value)}
                  >
                    <option value="system">System Default</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                  <p className="app-settings__hint">Choose your preferred color scheme</p>
                </div>
              </div>
            )}

            {/* Editor Tab */}
            {activeTab === 'editor' && (
              <div className="app-settings__section">
                <h3 className="app-settings__section-title">Typography</h3>
                
                <div className="app-settings__field">
                  <label className="app-settings__label">Font Family</label>
                  <select
                    className="app-settings__select"
                    value={settings.fontFamily}
                    onChange={(e) => updateSetting('fontFamily', e.target.value)}
                  >
                    {FONT_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                <div className="app-settings__field">
                  <label className="app-settings__label">Font Size: {settings.fontSize}px</label>
                  <input
                    type="range"
                    min="12"
                    max="24"
                    value={settings.fontSize}
                    onChange={(e) => updateSetting('fontSize', parseInt(e.target.value))}
                    className="app-settings__range"
                  />
                </div>

                <div className="app-settings__field">
                  <label className="app-settings__label">Line Height: {settings.lineHeight}</label>
                  <input
                    type="range"
                    min="1.2"
                    max="2.0"
                    step="0.1"
                    value={settings.lineHeight}
                    onChange={(e) => updateSetting('lineHeight', parseFloat(e.target.value))}
                    className="app-settings__range"
                  />
                </div>

                <h3 className="app-settings__section-title">Editing</h3>

                <div className="app-settings__field app-settings__field--toggle">
                  <label className="app-settings__toggle-label">
                    <input
                      type="checkbox"
                      checked={settings.wordWrap}
                      onChange={(e) => updateSetting('wordWrap', e.target.checked)}
                    />
                    <span className="app-settings__toggle-text">Word wrap</span>
                  </label>
                </div>

                <div className="app-settings__field app-settings__field--toggle">
                  <label className="app-settings__toggle-label">
                    <input
                      type="checkbox"
                      checked={settings.spellCheck}
                      onChange={(e) => updateSetting('spellCheck', e.target.checked)}
                    />
                    <span className="app-settings__toggle-text">Spell check</span>
                  </label>
                </div>

                <div className="app-settings__info-box">
                  <span className="app-settings__info-icon">💾</span>
                  <div>
                    <strong>Real-time Sync</strong>
                    <p>Changes are automatically synced in real-time. No manual saving required.</p>
                  </div>
                </div>
              </div>
            )}

            {/* Privacy Tab */}
            {activeTab === 'privacy' && (
              <div className="app-settings__section">
                <h3 className="app-settings__section-title">Auto-Lock</h3>
                
                <div className="app-settings__group">
                  <label className="app-settings__label" htmlFor="lockTimeout">
                    Lock Timeout
                    <span className="app-settings__hint">Automatically lock after inactivity</span>
                  </label>
                  <select
                    id="lockTimeout"
                    className="app-settings__select"
                    value={settings.lockTimeout || 15}
                    onChange={(e) => {
                      const value = parseInt(e.target.value, 10);
                      updateSetting('lockTimeout', value);
                      // Also update the identity manager
                      import('../../utils/identityManager').then(m => {
                        m.setLockTimeout(value);
                      });
                    }}
                  >
                    <option value={5}>5 minutes</option>
                    <option value={10}>10 minutes</option>
                    <option value={15}>15 minutes (default)</option>
                    <option value={30}>30 minutes</option>
                    <option value={60}>1 hour</option>
                    <option value={120}>2 hours</option>
                    <option value={480}>8 hours</option>
                  </select>
                </div>
                
                <div className="app-settings__divider" />
                
                <h3 className="app-settings__section-title">Encryption</h3>
                
                <div className="app-settings__info-box">
                  <span className="app-settings__info-icon">🔐</span>
                  <div>
                    <strong>End-to-End Encryption</strong>
                    <p>All document content is encrypted before transmission. Only you and your collaborators can read your documents.</p>
                  </div>
                </div>

                <div className="app-settings__info-box">
                  <span className="app-settings__info-icon">🔒</span>
                  <div>
                    <strong>Local Encryption</strong>
                    <p>Documents are encrypted at rest in your browser storage using your workspace key.</p>
                  </div>
                </div>

                <div className="app-settings__info-box">
                  <span className="app-settings__info-icon">👤</span>
                  <div>
                    <strong>Anonymous Collaboration</strong>
                    <p>Share documents using links. No accounts or personal information required.</p>
                  </div>
                </div>
                
                <div className="app-settings__info-box app-settings__info-box--warning">
                  <span className="app-settings__info-icon">⚠️</span>
                  <div>
                    <strong>PIN Protection</strong>
                    <p>Your identity is protected by a 6-digit PIN. After 10 incorrect attempts within an hour, your identity will be permanently deleted.</p>
                  </div>
                </div>
              </div>
            )}

            {/* Shortcuts Tab */}
            {activeTab === 'shortcuts' && (
              <div className="app-settings__section">
                <h3 className="app-settings__section-title">Keyboard Shortcuts</h3>
                
                <div className="app-settings__shortcuts">
                  <div className="app-settings__shortcut">
                    <span className="app-settings__shortcut-keys"><kbd>Ctrl</kbd> + <kbd>N</kbd></span>
                    <span className="app-settings__shortcut-action">New document</span>
                  </div>
                  <div className="app-settings__shortcut">
                    <span className="app-settings__shortcut-keys"><kbd>Ctrl</kbd> + <kbd>S</kbd></span>
                    <span className="app-settings__shortcut-action">Save document</span>
                  </div>
                  <div className="app-settings__shortcut">
                    <span className="app-settings__shortcut-keys"><kbd>Ctrl</kbd> + <kbd>Z</kbd></span>
                    <span className="app-settings__shortcut-action">Undo</span>
                  </div>
                  <div className="app-settings__shortcut">
                    <span className="app-settings__shortcut-keys"><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd></span>
                    <span className="app-settings__shortcut-action">Redo</span>
                  </div>
                  <div className="app-settings__shortcut">
                    <span className="app-settings__shortcut-keys"><kbd>Ctrl</kbd> + <kbd>B</kbd></span>
                    <span className="app-settings__shortcut-action">Bold</span>
                  </div>
                  <div className="app-settings__shortcut">
                    <span className="app-settings__shortcut-keys"><kbd>Ctrl</kbd> + <kbd>I</kbd></span>
                    <span className="app-settings__shortcut-action">Italic</span>
                  </div>
                  <div className="app-settings__shortcut">
                    <span className="app-settings__shortcut-keys"><kbd>Ctrl</kbd> + <kbd>K</kbd></span>
                    <span className="app-settings__shortcut-action">Insert link</span>
                  </div>
                  <div className="app-settings__shortcut">
                    <span className="app-settings__shortcut-keys"><kbd>Ctrl</kbd> + <kbd>/</kbd></span>
                    <span className="app-settings__shortcut-action">Toggle comment</span>
                  </div>
                  <div className="app-settings__shortcut">
                    <span className="app-settings__shortcut-keys"><kbd>Ctrl</kbd> + <kbd>,</kbd></span>
                    <span className="app-settings__shortcut-action">Open settings</span>
                  </div>
                  <div className="app-settings__shortcut">
                    <span className="app-settings__shortcut-keys"><kbd>Ctrl</kbd> + <kbd>\\</kbd></span>
                    <span className="app-settings__shortcut-action">Toggle sidebar</span>
                  </div>
                </div>
              </div>
            )}

            {/* Advanced Tab */}
            {activeTab === 'advanced' && (
              <div className="app-settings__section">
                <div className="app-settings__info-box">
                  <span className="app-settings__info-icon">💾</span>
                  <div>
                    <strong>Data Storage</strong>
                    <p>Documents are stored in your browser's local storage and synced with the server.</p>
                  </div>
                </div>

                <div className="app-settings__danger-zone">
                  <h4>Danger Zone</h4>
                  <button 
                    type="button"
                    className="app-settings__btn-danger"
                    onClick={handleReset}
                  >
                    Reset All Settings
                  </button>
                </div>
              </div>
            )}

            {/* Desktop Tab (Electron only) */}
            {activeTab === 'desktop' && isElectron && (
              <div className="app-settings__section">
                <h3 className="app-settings__section-title">🧅 Tor Network</h3>
                <p className="app-settings__hint">
                  Enable Tor for enhanced privacy and NAT traversal.
                </p>
                
                <div className="app-settings__field">
                  <label className="app-settings__label">Tor Mode</label>
                  <select
                    className="app-settings__select"
                    value={torMode}
                    onChange={(e) => handleTorModeChange(e.target.value)}
                  >
                    <option value="disabled">Disabled</option>
                    <option value="bundled">Bundled Tor (Recommended)</option>
                    <option value="external">External Tor Daemon</option>
                  </select>
                </div>
                
                {torMode !== 'disabled' && (
                  <>
                    <div className="app-settings__info-box">
                      <span className="app-settings__info-icon">
                        {torStatus.running ? '🟢' : '🔴'}
                      </span>
                      <div>
                        <strong>{torStatus.running ? 'Tor Connected' : 'Tor Disconnected'}</strong>
                        <p>{torStatus.running ? 'Your connection is private' : 'Click Start to connect'}</p>
                      </div>
                    </div>
                    
                    {torStatus.onionAddress && (
                      <div className="app-settings__field">
                        <label className="app-settings__label">Your Onion Address</label>
                        <div className="app-settings__code-display">
                          <code>{torStatus.onionAddress}</code>
                        </div>
                      </div>
                    )}
                    
                    <div className="app-settings__button-group">
                      {!torStatus.running ? (
                        <button
                          type="button"
                          className="app-settings__btn-primary"
                          onClick={handleStartTor}
                        >
                          ▶️ Start Tor
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="app-settings__btn-secondary"
                          onClick={handleStopTor}
                        >
                          ⏹️ Stop Tor
                        </button>
                      )}
                    </div>
                  </>
                )}

                <h3 className="app-settings__section-title" style={{ marginTop: '24px' }}>🌐 Relay Server</h3>
                <p className="app-settings__hint">
                  Help other peers connect by acting as a relay server.
                </p>
                
                <div className="app-settings__field app-settings__field--toggle">
                  <label className="app-settings__toggle-label">
                    <input
                      type="checkbox"
                      checked={relayEnabled}
                      onChange={handleToggleRelay}
                    />
                    <span className="app-settings__toggle-text">Enable Relay Mode</span>
                  </label>
                </div>
                
                {relayEnabled && (
                  <div className="app-settings__info-box">
                    <span className="app-settings__info-icon">
                      {relayStatus.running ? '🟢' : '🔴'}
                    </span>
                    <div>
                      <strong>{relayStatus.running ? 'Relay Active' : 'Relay Inactive'}</strong>
                      <p>{relayStatus.activeConnections || 0} active connections</p>
                    </div>
                  </div>
                )}
                
                <div className="app-settings__info-box" style={{ marginTop: '16px' }}>
                  <span className="app-settings__info-icon">🔒</span>
                  <div>
                    <strong>Privacy Note</strong>
                    <p>Relays only forward encrypted data. They cannot read your documents.</p>
                  </div>
                </div>
              </div>
            )}

            {/* About Tab */}
            {activeTab === 'about' && (
              <div className="app-settings__section">
                <div className="app-settings__about">
                  <div className="app-settings__about-logo">📝</div>
                  <h3 className="app-settings__about-name">Nightjar</h3>
                  <p className="app-settings__about-version">Version 1.0.0</p>
                  <p className="app-settings__about-desc">
                    Secure, decentralized collaborative text editor with end-to-end encryption and peer-to-peer sync.
                  </p>
                  
                  <div className="app-settings__about-links">
                    <a href="https://github.com/Nightjar/Nightjar" target="_blank" rel="noopener noreferrer">
                      GitHub Repository
                    </a>
                    <a href="https://Nightjar.dev/docs" target="_blank" rel="noopener noreferrer">
                      Documentation
                    </a>
                    <a href="https://Nightjar.dev/support" target="_blank" rel="noopener noreferrer">
                      Support
                    </a>
                  </div>

                  <div className="app-settings__about-credits">
                    <p>Built with ❤️ using React, Yjs, and Hyperswarm</p>
                    <p className="app-settings__about-license">MIT License</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="app-settings__footer">
          <button
            type="button"
            className="app-settings__btn-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="app-settings__btn-primary"
            onClick={handleSave}
            disabled={!hasChanges || saving}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
      {ConfirmDialogComponent}
    </div>
  );
}

export { loadSettings, saveSettings, DEFAULT_SETTINGS };
