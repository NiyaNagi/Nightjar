/**
 * RelaySettings Panel
 * 
 * Allows users to configure their Electron app as a P2P relay server.
 * Settings include:
 * - Enable/disable relay mode
 * - Maximum connections (default 10)
 * - UPnP status display
 * - Port configuration
 * 
 * This component is Electron-only since web users cannot host relays.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { isElectron } from '../hooks/useEnvironment';
import './RelaySettings.css';

// Default relay settings
const DEFAULT_SETTINGS = {
  enabled: false,
  maxConnections: 10,
  port: 4445,
  announceOnDHT: true,
};

export default function RelaySettings({ isOpen, onClose }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [upnpStatus, setUpnpStatus] = useState({
    available: false,
    externalIp: null,
    mappedPort: null,
    error: null,
  });
  const [relayStatus, setRelayStatus] = useState({
    running: false,
    activeConnections: 0,
    relayedMessages: 0,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);
  const modalRef = useRef(null);
  
  // Focus trap for modal accessibility
  useFocusTrap(modalRef, isOpen, { onEscape: onClose });
  
  // Load settings from Electron on mount
  useEffect(() => {
    if (!isOpen || !isElectron()) return;
    
    const loadSettings = async () => {
      try {
        const result = await window.electronAPI.invoke('relay:getSettings');
        if (result?.settings) {
          setSettings(result.settings);
        }
        if (result?.upnpStatus) {
          setUpnpStatus(result.upnpStatus);
        }
        if (result?.relayStatus) {
          setRelayStatus(result.relayStatus);
        }
      } catch (err) {
        console.warn('Failed to load relay settings:', err);
      }
    };
    
    loadSettings();
    
    // Poll for status updates while open
    const interval = setInterval(loadSettings, 5000);
    return () => clearInterval(interval);
  }, [isOpen]);
  
  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose?.();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);
  
  // Toggle relay on/off
  const handleToggleRelay = useCallback(async () => {
    if (!isElectron()) return;
    
    setIsSaving(true);
    setStatusMessage(null);
    
    try {
      const newEnabled = !settings.enabled;
      const result = await window.electronAPI.invoke(
        newEnabled ? 'relay:start' : 'relay:stop',
        { ...settings, enabled: newEnabled }
      );
      
      if (result.success) {
        setSettings(prev => ({ ...prev, enabled: newEnabled }));
        if (result.upnpStatus) setUpnpStatus(result.upnpStatus);
        if (result.relayStatus) setRelayStatus(result.relayStatus);
        setStatusMessage({
          type: 'success',
          text: newEnabled ? 'Relay started successfully' : 'Relay stopped',
        });
      } else {
        setStatusMessage({
          type: 'error',
          text: result.error || 'Failed to toggle relay',
        });
      }
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err.message || 'Failed to toggle relay',
      });
    } finally {
      setIsSaving(false);
    }
  }, [settings]);
  
  // Update settings
  const handleSettingChange = useCallback((key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);
  
  // Save settings (without toggling)
  const handleSaveSettings = useCallback(async () => {
    if (!isElectron()) return;
    
    setIsSaving(true);
    setStatusMessage(null);
    
    try {
      const result = await window.electronAPI.invoke('relay:updateSettings', settings);
      
      if (result.success) {
        setStatusMessage({
          type: 'success',
          text: 'Settings saved',
        });
      } else {
        setStatusMessage({
          type: 'error',
          text: result.error || 'Failed to save settings',
        });
      }
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err.message || 'Failed to save settings',
      });
    } finally {
      setIsSaving(false);
    }
  }, [settings]);
  
  // Test UPnP mapping
  const handleTestUpnp = useCallback(async () => {
    if (!isElectron()) return;
    
    setIsSaving(true);
    setStatusMessage(null);
    
    try {
      const result = await window.electronAPI.invoke('relay:testUpnp', {
        port: settings.port,
      });
      
      if (result.success) {
        setUpnpStatus({
          available: true,
          externalIp: result.externalIp,
          mappedPort: result.mappedPort,
          error: null,
        });
        setStatusMessage({
          type: 'success',
          text: `UPnP working! External: ${result.externalIp}:${result.mappedPort}`,
        });
      } else {
        setUpnpStatus({
          available: false,
          externalIp: null,
          mappedPort: null,
          error: result.error,
        });
        setStatusMessage({
          type: 'warning',
          text: result.error || 'UPnP not available',
        });
      }
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err.message || 'Failed to test UPnP',
      });
    } finally {
      setIsSaving(false);
    }
  }, [settings.port]);
  
  if (!isOpen) return null;
  
  // Web users can't be relays
  if (!isElectron()) {
    return (
      <div className="relay-settings-overlay" onClick={onClose}>
        <div 
          className="relay-settings-modal"
          onClick={e => e.stopPropagation()}
          ref={modalRef}
          role="dialog"
          aria-labelledby="relay-settings-title"
        >
          <div className="relay-settings-header">
            <h2 id="relay-settings-title">Relay Settings</h2>
            <button 
              className="close-btn" 
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          
          <div className="relay-settings-content">
            <div className="info-message">
              <span className="info-icon">ℹ️</span>
              <p>
                Relay functionality is only available in the Nightjar desktop app. 
                Download it to help strengthen the P2P network and improve 
                connectivity for all users.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="relay-settings-overlay" onClick={onClose}>
      <div 
        className="relay-settings-modal"
        onClick={e => e.stopPropagation()}
        ref={modalRef}
        role="dialog"
        aria-labelledby="relay-settings-title"
      >
        <div className="relay-settings-header">
          <h2 id="relay-settings-title">🌐 Relay Settings</h2>
          <button 
            className="close-btn" 
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        
        <div className="relay-settings-content">
          {/* Status message */}
          {statusMessage && (
            <div className={`status-message ${statusMessage.type}`}>
              {statusMessage.text}
            </div>
          )}
          
          {/* Main toggle */}
          <div className="setting-group main-toggle">
            <div className="setting-row">
              <div className="setting-info">
                <label htmlFor="relay-enabled">Enable Relay Mode</label>
                <p className="setting-description">
                  Act as a relay server to help other peers connect
                </p>
              </div>
              <button
                id="relay-enabled"
                className={`toggle-btn ${settings.enabled ? 'enabled' : ''}`}
                onClick={handleToggleRelay}
                disabled={isSaving}
                aria-pressed={settings.enabled}
              >
                {settings.enabled ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>
          
          {/* Relay status */}
          {settings.enabled && (
            <div className="setting-group status-group">
              <h3>Status</h3>
              <div className="status-grid">
                <div className="status-item">
                  <span className="status-label">Running</span>
                  <span className={`status-value ${relayStatus.running ? 'active' : 'inactive'}`}>
                    {relayStatus.running ? '🟢 Yes' : '🔴 No'}
                  </span>
                </div>
                <div className="status-item">
                  <span className="status-label">Active Connections</span>
                  <span className="status-value">{relayStatus.activeConnections}</span>
                </div>
                <div className="status-item">
                  <span className="status-label">Messages Relayed</span>
                  <span className="status-value">{relayStatus.relayedMessages}</span>
                </div>
              </div>
            </div>
          )}
          
          {/* UPnP Status */}
          <div className="setting-group">
            <h3>Network Configuration</h3>
            <div className="upnp-status">
              <div className="upnp-row">
                <span className="upnp-label">UPnP Status:</span>
                <span className={`upnp-value ${upnpStatus.available ? 'available' : 'unavailable'}`}>
                  {upnpStatus.available ? '✅ Available' : '❌ Not available'}
                </span>
              </div>
              {upnpStatus.externalIp && (
                <div className="upnp-row">
                  <span className="upnp-label">External Address:</span>
                  <span className="upnp-value">
                    {upnpStatus.externalIp}:{upnpStatus.mappedPort}
                  </span>
                </div>
              )}
              {upnpStatus.error && (
                <div className="upnp-error">
                  ⚠️ {upnpStatus.error}
                </div>
              )}
              <button
                className="test-upnp-btn"
                onClick={handleTestUpnp}
                disabled={isSaving}
              >
                {isSaving ? 'Testing...' : 'Test UPnP'}
              </button>
            </div>
          </div>
          
          {/* Configuration */}
          <div className="setting-group">
            <h3>Configuration</h3>
            
            <div className="setting-row">
              <div className="setting-info">
                <label htmlFor="relay-port">Relay Port</label>
                <p className="setting-description">
                  Port to listen on (requires restart)
                </p>
              </div>
              <input
                id="relay-port"
                type="number"
                min="1024"
                max="65535"
                value={settings.port}
                onChange={e => handleSettingChange('port', parseInt(e.target.value) || 4445)}
                disabled={settings.enabled}
              />
            </div>
            
            <div className="setting-row">
              <div className="setting-info">
                <label htmlFor="max-connections">Max Connections</label>
                <p className="setting-description">
                  Maximum simultaneous peer connections
                </p>
              </div>
              <input
                id="max-connections"
                type="number"
                min="1"
                max="100"
                value={settings.maxConnections}
                onChange={e => handleSettingChange('maxConnections', parseInt(e.target.value) || 10)}
              />
            </div>
            
            <div className="setting-row">
              <div className="setting-info">
                <label htmlFor="announce-dht">Announce on DHT</label>
                <p className="setting-description">
                  Let other peers discover your relay automatically
                </p>
              </div>
              <input
                id="announce-dht"
                type="checkbox"
                checked={settings.announceOnDHT}
                onChange={e => handleSettingChange('announceOnDHT', e.target.checked)}
              />
            </div>
          </div>
          
          {/* Privacy note */}
          <div className="privacy-note">
            <span className="privacy-icon">🔒</span>
            <p>
              <strong>Privacy:</strong> Relays only forward encrypted messages. 
              They cannot read document content or identify users.
            </p>
          </div>
        </div>
        
        <div className="relay-settings-footer">
          <button className="cancel-btn" onClick={onClose}>
            Close
          </button>
          <button 
            className="save-btn" 
            onClick={handleSaveSettings}
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : settings.enabled ? 'Save & Restart Relay' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
