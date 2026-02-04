/**
 * IdentitySelector Component
 * 
 * Displays when multiple identities exist on the device
 * Allows user to select an existing identity or create a new one
 */

import React, { useState, useEffect } from 'react';
import { isElectron } from '../hooks/useEnvironment';
import './IdentitySelector.css';

export default function IdentitySelector({ onSelect, onCreateNew }) {
  const [identities, setIdentities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedIdentity, setSelectedIdentity] = useState(null);

  useEffect(() => {
    if (!isElectron()) {
      setLoading(false);
      return;
    }

    // Request identity list from sidecar
    const metadataWs = window.metadataWs;
    if (!metadataWs || metadataWs.readyState !== WebSocket.OPEN) {
      setError('Connection to sidecar not ready');
      setLoading(false);
      return;
    }

    const handleMessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'identity-list') {
          setIdentities(data.identities || []);
          setLoading(false);
        }
      } catch (err) {
        console.error('[IdentitySelector] Message parse error:', err);
      }
    };

    metadataWs.addEventListener('message', handleMessage);

    // Request identity list
    metadataWs.send(JSON.stringify({
      type: 'list-identities'
    }));

    // Cleanup timeout
    const timeout = setTimeout(() => {
      if (loading) {
        setError('Timeout loading identities');
        setLoading(false);
      }
    }, 5000);

    return () => {
      metadataWs.removeEventListener('message', handleMessage);
      clearTimeout(timeout);
    };
  }, [loading]);

  const handleSelectIdentity = async (identity) => {
    if (!identity.filename) return;

    try {
      const metadataWs = window.metadataWs;
      if (!metadataWs || metadataWs.readyState !== WebSocket.OPEN) {
        throw new Error('Connection to sidecar not ready');
      }

      // Wait for switch confirmation
      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Switch timeout')), 5000);
        
        const handler = (event) => {
          const data = JSON.parse(event.data);
          if (data.type === 'identity-switched') {
            clearTimeout(timeout);
            metadataWs.removeEventListener('message', handler);
            resolve(data);
          }
        };

        metadataWs.addEventListener('message', handler);
        
        metadataWs.send(JSON.stringify({
          type: 'switch-identity',
          payload: { filename: identity.filename }
        }));
      });

      if (response.success) {
        onSelect?.(response.identity);
      } else {
        setError(response.error || 'Failed to switch identity');
      }
    } catch (err) {
      console.error('[IdentitySelector] Switch error:', err);
      setError(err.message);
    }
  };

  if (loading) {
    return (
      <div className="identity-selector">
        <div className="identity-selector__loading">
          <div className="identity-selector__spinner" />
          <p>Loading identities...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="identity-selector">
        <div className="identity-selector__error">
          <p>⚠️ {error}</p>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    );
  }

  // Filter out the currently active identity
  const inactiveIdentities = identities.filter(id => !id.isActive);

  // If only one identity exists (the active one), skip selector
  if (inactiveIdentities.length === 0) {
    return null;
  }

  return (
    <div className="identity-selector">
      <div className="identity-selector__content">
        <div className="identity-selector__header">
          <h1>🔐 Select Identity</h1>
          <p>Multiple identities found on this device. Which one would you like to use?</p>
        </div>

        <div className="identity-selector__list">
          {inactiveIdentities.map((identity) => (
            <button
              key={identity.filename}
              className={`identity-selector__item ${selectedIdentity === identity.filename ? 'identity-selector__item--selected' : ''}`}
              onClick={() => {
                setSelectedIdentity(identity.filename);
                handleSelectIdentity(identity);
              }}
            >
              <div className="identity-selector__item-icon" style={{ color: identity.color }}>
                {identity.icon || '👤'}
              </div>
              <div className="identity-selector__item-info">
                <div className="identity-selector__item-name">{identity.handle}</div>
                <div className="identity-selector__item-key">{identity.publicKeyBase62?.slice(0, 20)}...</div>
              </div>
            </button>
          ))}
        </div>

        <div className="identity-selector__actions">
          <button
            className="identity-selector__btn identity-selector__btn--primary"
            onClick={onCreateNew}
          >
            ➕ Create New Identity
          </button>
        </div>

        <div className="identity-selector__note">
          Creating a new identity will keep your existing identities. You can switch between them later.
        </div>
      </div>
    </div>
  );
}
