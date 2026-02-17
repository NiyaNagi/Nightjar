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
  
  // P2P / Network
  peerStatusPollIntervalMs: 10000, // How often to check peer status (ms)

  // Downloads
  downloadLocation: '', // User-chosen download folder (set on first download)
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

// Load notification settings from localStorage
const loadNotificationSettings = () => {
  try {
    const saved = localStorage.getItem('Nightjar-notification-settings');
    if (saved) {
      return { ...DEFAULT_NOTIFICATION_SETTINGS, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.error('Failed to load notification settings:', e);
  }
  return { ...DEFAULT_NOTIFICATION_SETTINGS };
};

// Default notification settings with all fields
const DEFAULT_NOTIFICATION_SETTINGS = {
  enabled: true,
  soundEnabled: true,
  soundVolume: 0.5,
  selectedSound: 'chime',
  doNotDisturb: false,
  desktopNotifications: false,
  showPreview: true,
  // Per-type sound toggles
  soundOnDirectMessage: true,
  soundOnMention: true,
  soundOnGroupMessage: true,
  soundOnGeneralMessage: false,
  defaultChannelSetting: 'all', // 'all', 'mentions', 'muted'
  channelOverrides: {}, // channelId -> 'all' | 'mentions' | 'muted'
};

// Save notification settings to localStorage
const saveNotificationSettings = (settings) => {
  try {
    localStorage.setItem('Nightjar-notification-settings', JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save notification settings:', e);
  }
};

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
  
  // Notification settings state
  const [notificationSettings, setNotificationSettings] = useState(loadNotificationSettings);
  
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

  // Factory reset - wipe ALL local data
  const handleFactoryReset = useCallback(async () => {
    const confirmed = await confirm({
      title: '⚠️ Factory Reset',
      message: 'This will DELETE ALL local data including:\n\n• All identities and their keys\n• All workspaces\n• All documents\n• All settings\n\nThis action CANNOT be undone. The app will restart after reset.',
      confirmText: 'Delete Everything',
      cancelText: 'Cancel',
      variant: 'danger'
    });
    
    if (!confirmed) return;
    
    // Double-confirm for safety
    const doubleConfirmed = await confirm({
      title: '🚨 Final Confirmation',
      message: 'Are you ABSOLUTELY SURE? All your data will be permanently deleted.',
      confirmText: 'Yes, Delete All Data',
      cancelText: 'No, Keep My Data',
      variant: 'danger'
    });
    
    if (!doubleConfirmed) return;
    
    try {
      // 1. Clear localStorage
      localStorage.clear();
      
      // 2. Clear sessionStorage
      sessionStorage.clear();
      
      // 3. Send factory-reset command to sidecar (if Electron)
      if (isElectron && window.electronAPI?.invoke) {
        try {
          await window.electronAPI.invoke('factory-reset');
        } catch (e) {
          console.warn('[FactoryReset] Sidecar reset failed:', e);
        }
      }
      
      // 4. Clear IndexedDB databases
      if (window.indexedDB) {
        const databases = await window.indexedDB.databases?.() || [];
        for (const db of databases) {
          if (db.name) {
            window.indexedDB.deleteDatabase(db.name);
          }
        }
      }
      
      // 5. Reload the app
      window.location.reload();
    } catch (err) {
      console.error('[FactoryReset] Error:', err);
      alert('Factory reset failed: ' + err.message);
    }
  }, [confirm, isElectron]);

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
    { id: 'notifications', label: '🔔 Notifications', icon: '🔔' },
    { id: 'privacy', label: '🔒 Privacy', icon: '🔒' },
    ...(isElectron ? [{ id: 'network', label: '🌐 Network', icon: '🌐' }] : []),
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

            {/* Notifications Tab */}
            {activeTab === 'notifications' && (
              <div className="app-settings__section">
                <h3 className="app-settings__section-title">Notification Settings</h3>
                
                {/* Do Not Disturb Mode */}
                <div className="app-settings__field app-settings__field--toggle app-settings__field--dnd">
                  <label className="app-settings__toggle-label">
                    <input
                      type="checkbox"
                      checked={notificationSettings.doNotDisturb}
                      onChange={(e) => {
                        const newSettings = { ...notificationSettings, doNotDisturb: e.target.checked };
                        setNotificationSettings(newSettings);
                        saveNotificationSettings(newSettings);
                      }}
                    />
                    <span className="app-settings__toggle-text">🔕 Do Not Disturb</span>
                  </label>
                  <span className="app-settings__hint">Silences all sounds and notifications temporarily</span>
                </div>
                
                <div className="app-settings__field app-settings__field--toggle">
                  <label className="app-settings__toggle-label">
                    <input
                      type="checkbox"
                      checked={notificationSettings.enabled}
                      onChange={(e) => {
                        const newSettings = { ...notificationSettings, enabled: e.target.checked };
                        setNotificationSettings(newSettings);
                        saveNotificationSettings(newSettings);
                      }}
                    />
                    <span className="app-settings__toggle-text">Enable notifications</span>
                  </label>
                  <span className="app-settings__hint">Master toggle for all notification types</span>
                </div>

                <div className="app-settings__field app-settings__field--toggle">
                  <label className="app-settings__toggle-label">
                    <input
                      type="checkbox"
                      checked={notificationSettings.soundEnabled}
                      onChange={(e) => {
                        const newSettings = { ...notificationSettings, soundEnabled: e.target.checked };
                        setNotificationSettings(newSettings);
                        saveNotificationSettings(newSettings);
                      }}
                      disabled={!notificationSettings.enabled}
                    />
                    <span className="app-settings__toggle-text">Sound notifications</span>
                  </label>
                </div>

                {/* Sound Picker */}
                <h3 className="app-settings__section-title">Sound Selection</h3>
                
                <div className="app-settings__field">
                  <label className="app-settings__label">Notification Sound</label>
                  <div className="app-settings__sound-picker">
                    <select
                      className="app-settings__select"
                      value={notificationSettings.selectedSound || 'chime'}
                      onChange={(e) => {
                        const newSettings = { ...notificationSettings, selectedSound: e.target.value };
                        setNotificationSettings(newSettings);
                        saveNotificationSettings(newSettings);
                      }}
                      disabled={!notificationSettings.enabled || !notificationSettings.soundEnabled}
                    >
                      <option value="chime">🔔 Chime - Gentle bell chime</option>
                      <option value="pop">💭 Pop - Soft bubble pop</option>
                      <option value="ding">🛎️ Ding - Single notification ding</option>
                      <option value="bell">🔔 Bell - Clear bell tone</option>
                      <option value="subtle">💨 Subtle - Soft whoosh</option>
                      <option value="ping">📡 Ping - Digital ping</option>
                      <option value="drop">💧 Drop - Water drop sound</option>
                      <option value="blip">🎮 Blip - Retro blip</option>
                      <option value="tap">👆 Tap - Light tap</option>
                      <option value="sparkle">✨ Sparkle - Magical sparkle</option>
                    </select>
                    <button
                      type="button"
                      className="app-settings__btn-secondary app-settings__btn-test"
                      onClick={() => {
                        const basePath = window.location.protocol === 'file:' ? '.' : '';
                        const audio = new Audio(`${basePath}/sounds/${notificationSettings.selectedSound || 'chime'}.mp3`);
                        audio.volume = notificationSettings.soundVolume;
                        audio.play().catch(() => {});
                      }}
                      disabled={!notificationSettings.enabled || !notificationSettings.soundEnabled}
                    >
                      ▶ Test
                    </button>
                  </div>
                </div>

                <div className="app-settings__field">
                  <label className="app-settings__label">Sound Volume: {Math.round(notificationSettings.soundVolume * 100)}%</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={notificationSettings.soundVolume}
                    onChange={(e) => {
                      const newSettings = { ...notificationSettings, soundVolume: parseFloat(e.target.value) };
                      setNotificationSettings(newSettings);
                      saveNotificationSettings(newSettings);
                    }}
                    className="app-settings__range"
                    disabled={!notificationSettings.enabled || !notificationSettings.soundEnabled}
                  />
                </div>

                {/* Per-Message-Type Sound Settings */}
                <h3 className="app-settings__section-title">Play Sound For</h3>
                
                <div className="app-settings__field app-settings__field--toggle">
                  <label className="app-settings__toggle-label">
                    <input
                      type="checkbox"
                      checked={notificationSettings.soundOnDirectMessage !== false}
                      onChange={(e) => {
                        const newSettings = { ...notificationSettings, soundOnDirectMessage: e.target.checked };
                        setNotificationSettings(newSettings);
                        saveNotificationSettings(newSettings);
                      }}
                      disabled={!notificationSettings.enabled || !notificationSettings.soundEnabled}
                    />
                    <span className="app-settings__toggle-text">💬 Direct messages</span>
                  </label>
                </div>
                
                <div className="app-settings__field app-settings__field--toggle">
                  <label className="app-settings__toggle-label">
                    <input
                      type="checkbox"
                      checked={notificationSettings.soundOnMention !== false}
                      onChange={(e) => {
                        const newSettings = { ...notificationSettings, soundOnMention: e.target.checked };
                        setNotificationSettings(newSettings);
                        saveNotificationSettings(newSettings);
                      }}
                      disabled={!notificationSettings.enabled || !notificationSettings.soundEnabled}
                    />
                    <span className="app-settings__toggle-text">@️ Mentions (@username)</span>
                  </label>
                </div>
                
                <div className="app-settings__field app-settings__field--toggle">
                  <label className="app-settings__toggle-label">
                    <input
                      type="checkbox"
                      checked={notificationSettings.soundOnGroupMessage !== false}
                      onChange={(e) => {
                        const newSettings = { ...notificationSettings, soundOnGroupMessage: e.target.checked };
                        setNotificationSettings(newSettings);
                        saveNotificationSettings(newSettings);
                      }}
                      disabled={!notificationSettings.enabled || !notificationSettings.soundEnabled}
                    />
                    <span className="app-settings__toggle-text">👥 Group chat messages</span>
                  </label>
                </div>
                
                <div className="app-settings__field app-settings__field--toggle">
                  <label className="app-settings__toggle-label">
                    <input
                      type="checkbox"
                      checked={notificationSettings.soundOnGeneralMessage === true}
                      onChange={(e) => {
                        const newSettings = { ...notificationSettings, soundOnGeneralMessage: e.target.checked };
                        setNotificationSettings(newSettings);
                        saveNotificationSettings(newSettings);
                      }}
                      disabled={!notificationSettings.enabled || !notificationSettings.soundEnabled}
                    />
                    <span className="app-settings__toggle-text">📢 General channel messages</span>
                  </label>
                  <span className="app-settings__hint">Can be noisy in active workspaces</span>
                </div>

                <h3 className="app-settings__section-title">Desktop Notifications</h3>

                <div className="app-settings__field app-settings__field--toggle">
                  <label className="app-settings__toggle-label">
                    <input
                      type="checkbox"
                      checked={notificationSettings.desktopNotifications}
                      onChange={(e) => {
                        if (e.target.checked && 'Notification' in window) {
                          Notification.requestPermission().then(permission => {
                            const enabled = permission === 'granted';
                            const newSettings = { ...notificationSettings, desktopNotifications: enabled };
                            setNotificationSettings(newSettings);
                            saveNotificationSettings(newSettings);
                          });
                        } else {
                          const newSettings = { ...notificationSettings, desktopNotifications: e.target.checked };
                          setNotificationSettings(newSettings);
                          saveNotificationSettings(newSettings);
                        }
                      }}
                      disabled={!notificationSettings.enabled}
                    />
                    <span className="app-settings__toggle-text">Desktop notifications</span>
                  </label>
                  <span className="app-settings__hint">Show native OS notifications for new messages</span>
                </div>

                <div className="app-settings__field app-settings__field--toggle">
                  <label className="app-settings__toggle-label">
                    <input
                      type="checkbox"
                      checked={notificationSettings.showPreview}
                      onChange={(e) => {
                        const newSettings = { ...notificationSettings, showPreview: e.target.checked };
                        setNotificationSettings(newSettings);
                        saveNotificationSettings(newSettings);
                      }}
                      disabled={!notificationSettings.enabled || !notificationSettings.desktopNotifications}
                    />
                    <span className="app-settings__toggle-text">Show message preview</span>
                  </label>
                  <span className="app-settings__hint">Display message content in desktop notifications</span>
                </div>

                <h3 className="app-settings__section-title">Default Channel Behavior</h3>
                
                <div className="app-settings__field">
                  <label className="app-settings__label">Notify for:</label>
                  <select
                    className="app-settings__select"
                    value={notificationSettings.defaultChannelSetting}
                    onChange={(e) => {
                      const newSettings = { ...notificationSettings, defaultChannelSetting: e.target.value };
                      setNotificationSettings(newSettings);
                      saveNotificationSettings(newSettings);
                    }}
                    disabled={!notificationSettings.enabled}
                  >
                    <option value="all">All messages</option>
                    <option value="mentions">Mentions only (@username)</option>
                    <option value="muted">Nothing (muted)</option>
                  </select>
                  <span className="app-settings__hint">This applies to all channels unless overridden</span>
                </div>

                <div className="app-settings__info-box">
                  <span className="app-settings__info-icon">💡</span>
                  <div>
                    <strong>Per-Channel Settings</strong>
                    <p>You can override notification settings for individual channels by clicking the ⚙️ icon in the chat panel.</p>
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

            {/* Network Tab (Electron only) */}
            {activeTab === 'network' && isElectron && (
              <div className="app-settings__section">
                <h3 className="app-settings__section-title">P2P Network Settings</h3>
                
                <div className="app-settings__control">
                  <div className="app-settings__control-header">
                    <label htmlFor="peer-poll-interval">Peer Status Check Interval</label>
                    <span className="app-settings__control-hint">How often to check for connected peers</span>
                  </div>
                  <div className="app-settings__select-wrapper">
                    <select
                      id="peer-poll-interval"
                      value={settings.peerStatusPollIntervalMs}
                      onChange={(e) => updateSetting('peerStatusPollIntervalMs', parseInt(e.target.value, 10))}
                    >
                      <option value="5000">5 seconds (frequent)</option>
                      <option value="10000">10 seconds (recommended)</option>
                      <option value="15000">15 seconds</option>
                      <option value="30000">30 seconds (battery saver)</option>
                      <option value="60000">60 seconds (minimal)</option>
                    </select>
                  </div>
                </div>
                
                <div className="app-settings__info-box">
                  <span className="app-settings__info-icon">💡</span>
                  <div>
                    <strong>Peer Status</strong>
                    <p>The status bar shows "{`{active} / {total}`}" where active is currently connected peers and total is all peers ever seen for this workspace.</p>
                  </div>
                </div>
                
                <div className="app-settings__info-box">
                  <span className="app-settings__info-icon">📡</span>
                  <div>
                    <strong>Relay Fallback</strong>
                    <p>When no direct P2P peers are available, Nightjar will automatically attempt to connect via relay servers for sync.</p>
                  </div>
                </div>

                <div className="app-settings__control">
                  <div className="app-settings__control-header">
                    <label htmlFor="download-location">Download Location</label>
                    <span className="app-settings__control-hint">Where downloaded files are saved on this device</span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      id="download-location"
                      type="text"
                      readOnly
                      value={localStorage.getItem('nightjar_download_location') || 'Not set (will ask on first download)'}
                      style={{ flex: 1, padding: '6px 10px', background: 'var(--bg-primary, #11111b)', color: 'var(--text-secondary, #a6adc8)', border: '1px solid var(--border-color, #313244)', borderRadius: '6px', fontSize: '13px' }}
                    />
                    <button
                      onClick={async () => {
                        if (window.electronAPI?.fileSystem) {
                          const folder = await window.electronAPI.fileSystem.selectFolder({
                            title: 'Choose Download Location',
                          });
                          if (folder) {
                            localStorage.setItem('nightjar_download_location', folder);
                            setHasChanges(true);
                            setSettings(s => ({ ...s, downloadLocation: folder }));
                          }
                        }
                      }}
                      style={{ padding: '6px 14px', background: 'var(--accent-color, #89b4fa)', color: '#11111b', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 500, whiteSpace: 'nowrap' }}
                    >
                      Change…
                    </button>
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
                  
                  <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid rgba(255,0,0,0.2)' }}>
                    <p style={{ fontSize: '12px', color: '#ff6b6b', marginBottom: '8px' }}>
                      ⚠️ <strong>Factory Reset</strong> - This will delete ALL local data including all identities, workspaces, and documents. This action cannot be undone.
                    </p>
                    <button 
                      type="button"
                      className="app-settings__btn-danger"
                      style={{ backgroundColor: '#8b0000' }}
                      onClick={handleFactoryReset}
                    >
                      🗑️ Factory Reset - Delete Everything
                    </button>
                  </div>
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
