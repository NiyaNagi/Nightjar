/**
 * IdentitySelector Component
 * 
 * Multi-identity selection with PIN unlock.
 * Shows all identities on device, allows PIN unlock or create new.
 */

import React, { useState, useEffect, useCallback } from 'react';
import identityManager from '../utils/identityManager';
import PinInput from './PinInput';
import './IdentitySelector.css';

// Views
const VIEWS = {
  LIST: 'list',
  UNLOCK: 'unlock',
  DELETE_CONFIRM: 'delete_confirm'
};

export default function IdentitySelector({ onSelect, onCreateNew, onNeedsMigration }) {
  const [identities, setIdentities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(VIEWS.LIST);
  const [selectedIdentity, setSelectedIdentity] = useState(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);
  const [unlocking, setUnlocking] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');

  // Load identities on mount
  useEffect(() => {
    loadIdentities();
  }, []);

  const loadIdentities = useCallback(() => {
    setLoading(true);
    try {
      // Check for migration need
      if (identityManager.needsMigration()) {
        onNeedsMigration?.();
        setLoading(false);
        return;
      }

      const list = identityManager.listIdentities();
      setIdentities(list);
      
      // Check for valid session
      if (identityManager.isSessionValid()) {
        const unlocked = identityManager.getUnlockedIdentity();
        if (unlocked) {
          onSelect?.(unlocked.identityData, unlocked.metadata);
          return;
        }
      }
    } catch (err) {
      console.error('[IdentitySelector] Error loading identities:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [onSelect, onNeedsMigration]);

  const handleSelectForUnlock = (identity) => {
    setSelectedIdentity(identity);
    setPin('');
    setError(null);
    setView(VIEWS.UNLOCK);
  };

  const handleUnlock = async (pinValue) => {
    if (!selectedIdentity || pinValue.length !== 6) return;

    setUnlocking(true);
    setError(null);

    try {
      const result = await identityManager.unlockIdentity(selectedIdentity.id, pinValue);
      onSelect?.(result.identityData, result.metadata);
    } catch (err) {
      console.error('[IdentitySelector] Unlock failed:', err);
      setError(err.message);
      setPin('');
      
      // Reload identities in case one was deleted due to too many attempts
      if (err.message.includes('deleted')) {
        loadIdentities();
        setView(VIEWS.LIST);
      }
    } finally {
      setUnlocking(false);
    }
  };

  const handleDeleteClick = (identity, e) => {
    e.stopPropagation();
    setSelectedIdentity(identity);
    setDeleteConfirmName('');
    setError(null);
    setView(VIEWS.DELETE_CONFIRM);
  };

  const handleConfirmDelete = async () => {
    if (!selectedIdentity) return;
    
    if (deleteConfirmName !== selectedIdentity.handle) {
      setError(`Type "${selectedIdentity.handle}" to confirm deletion`);
      return;
    }

    try {
      await identityManager.deleteIdentity(selectedIdentity.id);
      loadIdentities();
      setView(VIEWS.LIST);
    } catch (err) {
      setError(err.message);
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'Unknown';
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
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

  // No identities - should go to onboarding
  if (identities.length === 0) {
    onCreateNew?.();
    return null;
  }

  // Unlock view
  if (view === VIEWS.UNLOCK && selectedIdentity) {
    const remaining = identityManager.getRemainingAttempts(selectedIdentity.id);
    
    return (
      <div className="identity-selector">
        <div className="identity-selector__content identity-selector__unlock">
          <button 
            className="identity-selector__back" 
            onClick={() => setView(VIEWS.LIST)}
            type="button"
          >
            ← Back
          </button>
          
          <div className="identity-selector__unlock-identity">
            <div 
              className="identity-selector__unlock-icon" 
              style={{ backgroundColor: selectedIdentity.color + '20', color: selectedIdentity.color }}
            >
              {selectedIdentity.icon || '👤'}
            </div>
            <h2>{selectedIdentity.handle}</h2>
          </div>
          
          <PinInput
            value={pin}
            onChange={setPin}
            onComplete={handleUnlock}
            disabled={unlocking}
            error={error}
            label="Enter your 6-digit PIN"
            autoFocus
          />
          
          <div className="identity-selector__attempts">
            {remaining} attempts remaining
          </div>
          
          {unlocking && (
            <div className="identity-selector__unlocking">
              <div className="identity-selector__spinner" />
              Unlocking...
            </div>
          )}
        </div>
      </div>
    );
  }

  // Delete confirmation view
  if (view === VIEWS.DELETE_CONFIRM && selectedIdentity) {
    return (
      <div className="identity-selector">
        <div className="identity-selector__content identity-selector__delete-confirm">
          <button 
            className="identity-selector__back" 
            onClick={() => setView(VIEWS.LIST)}
            type="button"
          >
            ← Back
          </button>
          
          <div className="identity-selector__delete-warning">
            <span className="identity-selector__delete-icon">⚠️</span>
            <h2>Delete Identity</h2>
            <p>
              This will permanently delete the identity <strong>{selectedIdentity.handle}</strong> 
              and all associated data. This action cannot be undone.
            </p>
          </div>
          
          <div className="identity-selector__delete-confirm-input">
            <label>Type <strong>{selectedIdentity.handle}</strong> to confirm:</label>
            <input
              type="text"
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              placeholder={selectedIdentity.handle}
              autoFocus
            />
          </div>
          
          {error && <div className="identity-selector__error-message">{error}</div>}
          
          <div className="identity-selector__delete-actions">
            <button 
              className="identity-selector__btn identity-selector__btn--secondary"
              onClick={() => setView(VIEWS.LIST)}
              type="button"
            >
              Cancel
            </button>
            <button 
              className="identity-selector__btn identity-selector__btn--danger"
              onClick={handleConfirmDelete}
              disabled={deleteConfirmName !== selectedIdentity.handle}
              type="button"
            >
              Delete Identity
            </button>
          </div>
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="identity-selector">
      <div className="identity-selector__content">
        <div className="identity-selector__header">
          <div className="identity-selector__logo">🔐</div>
          <h1>Welcome Back</h1>
          <p>Select an identity to continue</p>
        </div>

        <div className="identity-selector__list">
          {identities.map((identity) => (
            <div
              key={identity.id}
              className="identity-selector__item"
              onClick={() => handleSelectForUnlock(identity)}
              onKeyDown={(e) => e.key === 'Enter' && handleSelectForUnlock(identity)}
              role="button"
              tabIndex={0}
            >
              <div 
                className="identity-selector__item-icon" 
                style={{ backgroundColor: identity.color + '20', color: identity.color }}
              >
                {identity.icon || '👤'}
              </div>
              <div className="identity-selector__item-info">
                <div className="identity-selector__item-name">{identity.handle}</div>
                <div className="identity-selector__item-meta">
                  <span>Created {formatDate(identity.createdAt)}</span>
                  {identity.docCount > 0 && (
                    <span> • {identity.docCount} document{identity.docCount !== 1 ? 's' : ''}</span>
                  )}
                </div>
              </div>
              <button
                className="identity-selector__item-delete"
                onClick={(e) => handleDeleteClick(identity, e)}
                title="Delete identity"
                type="button"
              >
                🗑️
              </button>
            </div>
          ))}
        </div>

        <div className="identity-selector__divider">
          <span>or</span>
        </div>

        <div className="identity-selector__actions">
          <button
            className="identity-selector__btn identity-selector__btn--primary"
            onClick={onCreateNew}
            type="button"
          >
            ➕ Create New Identity
          </button>
        </div>

        <div className="identity-selector__note">
          Each identity has its own separate data and documents.
        </div>
      </div>
    </div>
  );
}
