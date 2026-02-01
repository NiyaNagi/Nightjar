/**
 * JoinWithLink Modal
 * 
 * A modal for joining workspaces/documents via share link.
 * Features real-time link validation with visual feedback.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import './JoinWithLink.css';

// Regex patterns for different link types (case-insensitive for protocol)
const LINK_PATTERNS = {
  workspace: /^nightjar:\/\/w(?:orkspace)?\/([a-zA-Z0-9_-]+)/i,
  document: /^nightjar:\/\/d(?:oc)?\/([a-zA-Z0-9_-]+)/i,
  shortCode: /^[A-Z0-9]{6,12}$/i,
};

// Parse and validate a share link
const validateLink = (link) => {
  if (!link || !link.trim()) {
    return { valid: false, type: null, id: null, error: null };
  }

  const trimmed = link.trim();

  // Check workspace link
  const workspaceMatch = trimmed.match(LINK_PATTERNS.workspace);
  if (workspaceMatch) {
    return { valid: true, type: 'workspace', id: workspaceMatch[1], error: null };
  }

  // Check document link
  const docMatch = trimmed.match(LINK_PATTERNS.document);
  if (docMatch) {
    return { valid: true, type: 'document', id: docMatch[1], error: null };
  }

  // Check short code
  if (LINK_PATTERNS.shortCode.test(trimmed)) {
    return { valid: true, type: 'code', id: trimmed.toUpperCase(), error: null };
  }

  // Check if it looks like a partial nightjar:// link (case-insensitive)
  if (trimmed.toLowerCase().startsWith('nightjar://')) {
    return { valid: false, type: null, id: null, error: 'Invalid link format' };
  }

  // Unknown format
  return { valid: false, type: null, id: null, error: 'Paste a nightjar:// link or share code' };
};

export default function JoinWithLink({ isOpen, onClose, onJoin }) {
  const [link, setLink] = useState('');
  const [password, setPassword] = useState('');
  const [validation, setValidation] = useState({ valid: false, type: null, id: null, error: null });
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState(null);
  const inputRef = useRef(null);
  const modalRef = useRef(null);

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setLink('');
      setPassword('');
      setValidation({ valid: false, type: null, id: null, error: null });
      setJoinError(null);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Validate link on change with debounce
  useEffect(() => {
    const result = validateLink(link);
    setValidation(result);
    setJoinError(null);
  }, [link]);

  // Handle paste from clipboard
  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      setLink(text);
    } catch (err) {
      console.error('Failed to read clipboard:', err);
    }
  }, []);

  // Handle join
  const handleJoin = async () => {
    if (!validation.valid || isJoining) return;

    setIsJoining(true);
    setJoinError(null);

    try {
      await onJoin?.(link.trim(), password || undefined);
      onClose?.();
    } catch (err) {
      setJoinError(err.message || 'Failed to join. Please check the link and try again.');
    } finally {
      setIsJoining(false);
    }
  };

  // Handle keyboard
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose?.();
    }
    if (e.key === 'Enter' && validation.valid && !isJoining) {
      handleJoin();
    }
  };

  // Handle backdrop click
  const handleBackdropClick = (e) => {
    if (e.target === modalRef.current) {
      onClose?.();
    }
  };

  if (!isOpen) return null;

  const getValidationIcon = () => {
    if (!link) return null;
    if (validation.valid) return '✓';
    if (validation.error) return '✕';
    return null;
  };

  const getTypeLabel = () => {
    switch (validation.type) {
      case 'workspace': return 'Workspace';
      case 'document': return 'Document';
      case 'code': return 'Share Code';
      default: return null;
    }
  };

  return (
    <div 
      className="join-modal-overlay" 
      ref={modalRef}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div className="join-modal" role="dialog" aria-labelledby="join-modal-title">
        {/* Header */}
        <div className="join-modal__header">
          <h2 id="join-modal-title" className="join-modal__title">
            🔗 Join with Link
          </h2>
          <button 
            type="button"
            className="join-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="join-modal__content">
          <p className="join-modal__description">
            Paste a share link or code to join a workspace or document.
          </p>

          {/* Link input */}
          <div className="join-modal__field">
            <label className="join-modal__label" htmlFor="join-link">
              Share Link or Code
            </label>
            <div className={`join-modal__input-wrapper ${validation.valid ? 'join-modal__input-wrapper--valid' : ''} ${validation.error ? 'join-modal__input-wrapper--error' : ''}`}>
              <input
                ref={inputRef}
                id="join-link"
                type="text"
                className="join-modal__input"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="nightjar://workspace/abc123 or SHARE-CODE"
                autoComplete="off"
                spellCheck="false"
              />
              <button 
                type="button"
                className="join-modal__paste-btn"
                onClick={handlePaste}
                title="Paste from clipboard"
              >
                📋
              </button>
              {getValidationIcon() && (
                <span className={`join-modal__validation-icon ${validation.valid ? 'join-modal__validation-icon--valid' : 'join-modal__validation-icon--error'}`}>
                  {getValidationIcon()}
                </span>
              )}
            </div>
            
            {/* Validation feedback */}
            {validation.valid && (
              <div className="join-modal__validation-success">
                <span className="join-modal__type-badge">{getTypeLabel()}</span>
                <span className="join-modal__id-preview">{validation.id}</span>
              </div>
            )}
            {validation.error && (
              <div className="join-modal__validation-error">
                {validation.error}
              </div>
            )}
          </div>

          {/* Password field (optional) */}
          {validation.valid && (
            <div className="join-modal__field">
              <label className="join-modal__label" htmlFor="join-password">
                Password <span className="join-modal__label-optional">(if required)</span>
              </label>
              <input
                id="join-password"
                type="password"
                className="join-modal__input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password if the link is protected"
              />
            </div>
          )}

          {/* Join error */}
          {joinError && (
            <div className="join-modal__error">
              {joinError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="join-modal__footer">
          <button
            type="button"
            className="join-modal__cancel-btn"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="join-modal__join-btn"
            onClick={handleJoin}
            disabled={!validation.valid || isJoining}
          >
            {isJoining ? 'Joining...' : 'Join'}
          </button>
        </div>
      </div>
    </div>
  );
}

export { validateLink, LINK_PATTERNS };
