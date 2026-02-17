/**
 * SlidePanel
 *
 * Right slide-over panel for drill-in views across the inventory system.
 * Wraps any child content (RequestDetail, AddressReveal, etc.) in a
 * fixed right-anchored overlay with proper a11y (focus trap, Escape, backdrop).
 *
 * Modelled after ConfirmDialog's accessibility patterns.
 *
 * See docs/INVENTORY_SYSTEM_SPEC.md §6.4.2 (detail panels)
 */

import React, { useEffect, useRef, useCallback } from 'react';
import './SlidePanel.css';

export default function SlidePanel({ isOpen, onClose, title, children }) {
  const panelRef = useRef(null);
  const closeBtnRef = useRef(null);

  // Focus the close button when the panel opens
  useEffect(() => {
    if (isOpen) {
      // Small delay to allow the transition to start before focusing
      const id = setTimeout(() => closeBtnRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [isOpen]);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [isOpen]);

  // Focus trap + Escape
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose?.();
      return;
    }

    if (e.key === 'Tab' && panelRef.current) {
      const focusable = panelRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="slide-panel__overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      role="presentation"
    >
      <div
        ref={panelRef}
        className="slide-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Detail panel'}
        onKeyDown={handleKeyDown}
      >
        <div className="slide-panel__header">
          <h3 className="slide-panel__title">{title || 'Details'}</h3>
          <button
            ref={closeBtnRef}
            className="slide-panel__close"
            onClick={onClose}
            aria-label="Close panel"
            type="button"
          >
            ✕
          </button>
        </div>
        <div className="slide-panel__body">
          {children}
        </div>
      </div>
    </div>
  );
}
