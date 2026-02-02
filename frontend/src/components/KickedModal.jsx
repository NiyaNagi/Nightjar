/**
 * KickedModal Component
 * 
 * Displayed when a user has been removed from a workspace by the owner.
 * Shows a notification and handles cleanup of local workspace data.
 */

import React, { useEffect, useRef } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import './KickedModal.css';

export default function KickedModal({ 
  workspaceName = 'this workspace',
  kickedBy = 'the owner',
  reason = '',
  onClose,
  onClearData,
}) {
  const modalRef = useRef(null);
  
  // Focus trap for accessibility
  useFocusTrap(modalRef, true);
  
  // Automatically trigger data cleanup when modal shows
  useEffect(() => {
    // Give user time to read the message, then clear
    const timer = setTimeout(() => {
      if (onClearData) {
        onClearData();
      }
      // Auto-close after clearing
      onClose?.();
    }, 5000); // Clear after 5 seconds
    
    return () => clearTimeout(timer);
  }, [onClearData, onClose]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="kicked-modal-overlay">
      <div 
        className="kicked-modal"
        ref={modalRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="kicked-modal-title"
        aria-describedby="kicked-modal-message"
      >
        <div className="kicked-modal__icon">
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2"
            strokeLinecap="round" 
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        </div>
        
        <h2 id="kicked-modal-title" className="kicked-modal__title">You've been removed</h2>
        
        <p id="kicked-modal-message" className="kicked-modal__message">
          You have been removed from <strong>{workspaceName}</strong> by {kickedBy}.
        </p>
        
        {reason && (
          <p className="kicked-modal__reason">
            Reason: {reason}
          </p>
        )}
        
        <div className="kicked-modal__info">
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <span>
            Your local copy of this workspace will be removed. Any changes you made will be preserved in the workspace for other members.
          </span>
        </div>
        
        <div className="kicked-modal__actions">
          <button 
            type="button"
            className="kicked-modal__button kicked-modal__button--primary"
            onClick={onClose}
            autoFocus
          >
            I understand
          </button>
        </div>
        
        <p className="kicked-modal__countdown">
          Local data will be cleared automatically...
        </p>
      </div>
    </div>
  );
}
