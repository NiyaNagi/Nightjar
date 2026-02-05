import React, { useState, useEffect, useCallback, useRef } from 'react';
import './Settings.css';

/**
 * Tor Settings Component
 * Configure Tor mode and view status
 */
export function TorSettings({ isOpen, onClose }) {
  const [torMode, setTorMode] = useState('disabled'); // 'disabled' | 'bundled' | 'external'
  const [torStatus, setTorStatus] = useState({
    running: false,
    bootstrapped: false,
    onionAddress: null,
    circuitEstablished: false
  });
  const [bootstrapProgress, setBootstrapProgress] = useState(0);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState('');
  const [relayUrl, setRelayUrl] = useState('');
  const [useRelay, setUseRelay] = useState(false);
  
  // Track component mount state for async operations
  const isMountedRef = useRef(true);
  
  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  
  // Load saved settings
  useEffect(() => {
    const savedMode = localStorage.getItem('Nightjar_tor_mode') || 'disabled';
    const savedRelayUrl = localStorage.getItem('Nightjar_relay_url') || '';
    const savedUseRelay = localStorage.getItem('Nightjar_use_relay') === 'true';
    
    setTorMode(savedMode);
    setRelayUrl(savedRelayUrl);
    setUseRelay(savedUseRelay);
    
    // Check current status
    checkTorStatus();
  }, []);
  
  const checkTorStatus = useCallback(async () => {
    if (window.electronAPI?.tor) {
      try {
        const status = await window.electronAPI.tor.getStatus();
        // Only update state if still mounted
        if (isMountedRef.current) {
          setTorStatus(status);
        }
      } catch (err) {
        console.error('Failed to get Tor status:', err);
      }
    }
  }, []);
  
  // Poll status while starting
  useEffect(() => {
    if (isStarting) {
      const interval = setInterval(checkTorStatus, 1000);
      return () => clearInterval(interval);
    }
  }, [isStarting, checkTorStatus]);
  
  const handleModeChange = async (newMode) => {
    setError('');
    setTorMode(newMode);
    localStorage.setItem('Nightjar_tor_mode', newMode);
    
    if (window.electronAPI?.tor) {
      if (newMode === 'disabled') {
        await window.electronAPI.tor.stop();
        setTorStatus({ running: false, bootstrapped: false, onionAddress: null, circuitEstablished: false });
      }
    }
  };
  
  const handleStartTor = async () => {
    setError('');
    setIsStarting(true);
    setBootstrapProgress(0);
    
    try {
      if (window.electronAPI?.tor) {
        // Listen for bootstrap progress with mount check
        window.electronAPI.tor.onBootstrap((progress) => {
          if (isMountedRef.current) {
            setBootstrapProgress(progress);
          }
        });
        
        await window.electronAPI.tor.start(torMode);
        if (isMountedRef.current) {
          await checkTorStatus();
        }
      } else {
        setError('Tor is only available on desktop');
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(err.message || 'Failed to start Tor');
      }
    } finally {
      if (isMountedRef.current) {
        setIsStarting(false);
      }
    }
  };
  
  const handleStopTor = async () => {
    setError('');
    
    try {
      if (window.electronAPI?.tor) {
        await window.electronAPI.tor.stop();
        setTorStatus({ running: false, bootstrapped: false, onionAddress: null, circuitEstablished: false });
      }
    } catch (err) {
      setError(err.message || 'Failed to stop Tor');
    }
  };
  
  const handleNewIdentity = async () => {
    try {
      if (window.electronAPI?.tor) {
        await window.electronAPI.tor.newIdentity();
        // Brief delay to allow circuit rebuild
        setTimeout(checkTorStatus, 1000);
      }
    } catch (err) {
      setError(err.message || 'Failed to get new identity');
    }
  };
  
  const [relaySaved, setRelaySaved] = useState(false);
  
  const handleSaveRelaySettings = () => {
    localStorage.setItem('Nightjar_relay_url', relayUrl);
    localStorage.setItem('Nightjar_use_relay', useRelay.toString());
    setRelaySaved(true);
    setTimeout(() => setRelaySaved(false), 2000);
  };
  
  const copyOnionAddress = () => {
    if (torStatus.onionAddress) {
      navigator.clipboard.writeText(torStatus.onionAddress);
    }
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal tor-settings" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <h2>🧅 Tor & Privacy Settings</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        
        <div className="settings-content">
          {/* Tor Mode Selection */}
          <section className="settings-section">
            <h3>Tor Mode</h3>
            <p className="section-description">
              Enable Tor for enhanced privacy and NAT traversal
            </p>
            
            <div className="tor-mode-options">
              <label className={`tor-mode-option ${torMode === 'disabled' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="torMode"
                  value="disabled"
                  checked={torMode === 'disabled'}
                  onChange={() => handleModeChange('disabled')}
                />
                <div className="option-content">
                  <span className="option-icon">🌐</span>
                  <div className="option-text">
                    <strong>Disabled</strong>
                    <p>Use regular P2P connections (Hyperswarm DHT)</p>
                  </div>
                </div>
              </label>
              
              <label className={`tor-mode-option ${torMode === 'bundled' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="torMode"
                  value="bundled"
                  checked={torMode === 'bundled'}
                  onChange={() => handleModeChange('bundled')}
                />
                <div className="option-content">
                  <span className="option-icon">📦</span>
                  <div className="option-text">
                    <strong>Bundled Tor</strong>
                    <p>Use built-in Tor (recommended for privacy)</p>
                  </div>
                </div>
              </label>
              
              <label className={`tor-mode-option ${torMode === 'external' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="torMode"
                  value="external"
                  checked={torMode === 'external'}
                  onChange={() => handleModeChange('external')}
                />
                <div className="option-content">
                  <span className="option-icon">🔌</span>
                  <div className="option-text">
                    <strong>External Tor</strong>
                    <p>Connect to existing Tor daemon (port 9051)</p>
                  </div>
                </div>
              </label>
            </div>
          </section>
          
          {/* Tor Status & Controls */}
          {torMode !== 'disabled' && (
            <section className="settings-section">
              <h3>Tor Status</h3>
              
              <div className="tor-status-display">
                <div className={`status-indicator ${torStatus.running ? 'running' : 'stopped'}`}>
                  <span className="status-dot"></span>
                  <span className="status-text">
                    {torStatus.running 
                      ? (torStatus.bootstrapped ? 'Connected' : 'Connecting...') 
                      : 'Stopped'}
                  </span>
                </div>
                
                {isStarting && (
                  <div className="bootstrap-progress">
                    <div 
                      className="progress-bar" 
                      style={{ width: `${bootstrapProgress}%` }}
                    ></div>
                    <span className="progress-text">{bootstrapProgress}%</span>
                  </div>
                )}
                
                {torStatus.onionAddress && (
                  <div className="onion-address">
                    <label>Your Onion Address:</label>
                    <div className="onion-address-value">
                      <code>{torStatus.onionAddress}</code>
                      <button onClick={copyOnionAddress} title="Copy">📋</button>
                    </div>
                  </div>
                )}
              </div>
              
              <div className="tor-controls">
                {!torStatus.running ? (
                  <button 
                    className="tor-button start"
                    onClick={handleStartTor}
                    disabled={isStarting}
                  >
                    {isStarting ? 'Starting...' : 'Start Tor'}
                  </button>
                ) : (
                  <>
                    <button 
                      className="tor-button stop"
                      onClick={handleStopTor}
                    >
                      Stop Tor
                    </button>
                    <button 
                      className="tor-button identity"
                      onClick={handleNewIdentity}
                      title="Get new Tor circuit"
                    >
                      🔄 New Identity
                    </button>
                  </>
                )}
              </div>
              
              {error && <p className="tor-error">{error}</p>}
            </section>
          )}
          
          {/* Mobile Relay Settings */}
          <section className="settings-section">
            <h3>Mobile Relay</h3>
            <p className="section-description">
              For mobile devices, you can connect through a relay server
            </p>
            
            <label className="relay-toggle">
              <input
                type="checkbox"
                checked={useRelay}
                onChange={e => setUseRelay(e.target.checked)}
              />
              <span>Use relay server for mobile P2P</span>
            </label>
            
            {useRelay && (
              <div className="relay-url-input">
                <input
                  type="text"
                  placeholder="wss://relay.example.com"
                  value={relayUrl}
                  onChange={e => setRelayUrl(e.target.value)}
                />
                <button type="button" onClick={handleSaveRelaySettings}>
                  {relaySaved ? '✓ Saved!' : 'Save'}
                </button>
              </div>
            )}
            
            <p className="relay-hint">
              You can self-host a relay server using <code>npm run relay</code>
            </p>
          </section>
          
          {/* Privacy Info */}
          <section className="settings-section">
            <h3>Privacy Information</h3>
            <div className="privacy-info">
              <div className="info-item">
                <span className="info-icon">🔐</span>
                <div className="info-text">
                  <strong>End-to-End Encryption</strong>
                  <p>All document content is encrypted before transmission</p>
                </div>
              </div>
              <div className="info-item">
                <span className="info-icon">🌐</span>
                <div className="info-text">
                  <strong>No Central Servers</strong>
                  <p>Documents are synced directly between peers</p>
                </div>
              </div>
              <div className="info-item">
                <span className="info-icon">🧅</span>
                <div className="info-text">
                  <strong>Tor Hidden Services</strong>
                  <p>When enabled, your IP address is hidden from peers</p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default TorSettings;
