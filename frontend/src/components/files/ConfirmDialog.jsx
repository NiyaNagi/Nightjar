/**
 * ConfirmDialog
 * 
 * Themed confirmation modal for destructive actions.
 * Replaces window.confirm with a dark-themed dialog.
 */

import { useEffect, useRef, useCallback } from 'react';
import './ConfirmDialog.css';

export default function ConfirmDialog({
  isOpen,
  title = 'Confirm',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger', // 'danger' | 'default'
  onConfirm,
  onCancel,
}) {
  const confirmBtnRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    // Focus confirm button on open
    setTimeout(() => confirmBtnRef.current?.focus(), 50);

    const handleEsc = (e) => {
      if (e.key === 'Escape') onCancel?.();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onCancel]);

  const handleOverlayClick = useCallback((e) => {
    if (e.target === e.currentTarget) onCancel?.();
  }, [onCancel]);

  if (!isOpen) return null;

  return (
    <div className="confirm-dialog-overlay" onClick={handleOverlayClick} data-testid="confirm-dialog-overlay">
      <div className="confirm-dialog" role="alertdialog" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-msg" data-testid="confirm-dialog">
        <h3 id="confirm-dialog-title" className="confirm-dialog-title">{title}</h3>
        <p id="confirm-dialog-msg" className="confirm-dialog-message">{message}</p>
        <div className="confirm-dialog-actions">
          <button
            className="confirm-dialog-btn confirm-dialog-btn--cancel"
            onClick={onCancel}
            data-testid="confirm-dialog-cancel"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            className={`confirm-dialog-btn confirm-dialog-btn--${variant}`}
            onClick={onConfirm}
            data-testid="confirm-dialog-confirm"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
