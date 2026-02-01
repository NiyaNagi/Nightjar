/**
 * RecoveryCodeModal Component
 * 
 * Displays the user's 12-word recovery phrase (BIP39 mnemonic)
 * with options to copy or save to file.
 */

import React, { useState, useRef, useEffect } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import './RecoveryCodeModal.css';

export default function RecoveryCodeModal({ 
  mnemonic,
  onClose,
  onConfirmed,
  isInitialSetup = false,
}) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const wordsRef = useRef(null);
  const modalRef = useRef(null);
  
  // Focus trap for accessibility
  useFocusTrap(modalRef, true);
  
  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isInitialSetup) {
        onClose?.();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isInitialSetup]);
  
  if (!mnemonic) return null;
  
  const words = mnemonic.split(' ');
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(mnemonic);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = mnemonic;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  
  const handleSaveToFile = () => {
    const content = `Nightjar Recovery Phrase
========================
Generated: ${new Date().toISOString()}

Your 12-word recovery phrase:

${words.map((word, i) => `${(i + 1).toString().padStart(2, ' ')}. ${word}`).join('\n')}

IMPORTANT:
- Keep this phrase secret and secure
- Anyone with this phrase can access your identity
- Store it offline in a safe place
- Never share it with anyone
- Nightjar will never ask for your recovery phrase
`;
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `nightjar-recovery-phrase-${Date.now()}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  
  const handleConfirm = () => {
    setConfirmed(true);
    if (onConfirmed) onConfirmed();
    if (onClose) onClose();
  };

  return (
    <div className="recovery-modal-overlay">
      <div 
        className="recovery-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recovery-modal-title"
      >
        <div className="recovery-modal__header">
          <div className="recovery-modal__icon" aria-hidden="true">
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h2 id="recovery-modal-title" className="recovery-modal__title">Your Recovery Phrase</h2>
          {!isInitialSetup && (
            <button type="button" className="recovery-modal__close" onClick={onClose} aria-label="Close">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
        
        <p className="recovery-modal__description">
          {isInitialSetup 
            ? "Write down these 12 words and store them securely. This is the only way to recover your identity if you lose access to this device."
            : "This is your 12-word recovery phrase. Keep it secret and secure."}
        </p>
        
        <div className="recovery-modal__warning">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>Never share this phrase. Anyone with these words can access your identity.</span>
        </div>
        
        <div className={`recovery-modal__words ${revealed ? 'revealed' : ''}`} ref={wordsRef}>
          {!revealed && (
            <button type="button" className="recovery-modal__reveal-btn" onClick={() => setRevealed(true)}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              Click to reveal
            </button>
          )}
          <div className="recovery-modal__word-grid">
            {words.map((word, index) => (
              <div key={index} className="recovery-modal__word">
                <span className="recovery-modal__word-num">{index + 1}</span>
                <span className="recovery-modal__word-text">{revealed ? word : '••••••'}</span>
              </div>
            ))}
          </div>
        </div>
        
        <div className="recovery-modal__actions">
          <button 
            type="button"
            className="recovery-modal__btn recovery-modal__btn--secondary"
            onClick={handleCopy}
            disabled={!revealed}
          >
            {copied ? (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                Copy
              </>
            )}
          </button>
          
          <button 
            type="button"
            className="recovery-modal__btn recovery-modal__btn--secondary"
            onClick={handleSaveToFile}
            disabled={!revealed}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Save to File
          </button>
        </div>
        
        {isInitialSetup && (
          <div className="recovery-modal__confirm">
            <label className="recovery-modal__checkbox">
              <input 
                type="checkbox" 
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                disabled={!revealed}
              />
              <span>I have saved my recovery phrase in a secure location</span>
            </label>
            
            <button 
              type="button"
              className="recovery-modal__btn recovery-modal__btn--primary"
              onClick={handleConfirm}
              disabled={!confirmed || !revealed}
            >
              Continue
            </button>
          </div>
        )}
        
        {!isInitialSetup && (
          <button 
            type="button"
            className="recovery-modal__btn recovery-modal__btn--primary recovery-modal__done-btn"
            onClick={onClose}
          >
            Done
          </button>
        )}
      </div>
    </div>
  );
}
