import useIsMobile from '../../hooks/useIsMobile';
import BottomSheet from './BottomSheet';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useCallback } from 'react';
import './ResponsiveModal.css';

/**
 * ResponsiveModal — renders a standard centered modal on desktop,
 * or a BottomSheet with drag-to-dismiss on mobile.
 *
 * Props:
 *   isOpen       – boolean – controls visibility
 *   onClose      – () => void – called when dismissed
 *   title        – string (optional header text)
 *   children     – modal body content
 *   className    – extra CSS class applied to the container
 *   snapPoints   – BottomSheet snap points (default [50, 90])
 *   size         – desktop modal width: 'small' | 'medium' | 'large' | 'full'
 *   ariaLabel    – accessible label (falls back to title)
 */
export default function ResponsiveModal({
  isOpen,
  onClose,
  title,
  children,
  className = '',
  snapPoints = [50, 90],
  size = 'medium',
  ariaLabel,
}) {
  const isMobile = useIsMobile(768);
  const modalRef = useRef(null);

  // Body scroll-lock on desktop
  useEffect(() => {
    if (!isOpen || isMobile) return;
    const orig = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = orig; };
  }, [isOpen, isMobile]);

  // Escape to close on desktop (BottomSheet handles its own)
  useEffect(() => {
    if (!isOpen || isMobile) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, isMobile, onClose]);

  // Backdrop click handler
  const handleBackdrop = useCallback(
    (e) => { if (e.target === e.currentTarget) onClose?.(); },
    [onClose],
  );

  if (!isOpen) return null;

  /* ---- Mobile: delegate to BottomSheet ---- */
  if (isMobile) {
    return (
      <BottomSheet
        isOpen={isOpen}
        onClose={onClose}
        title={title}
        snapPoints={snapPoints}
        className={className}
      >
        {children}
      </BottomSheet>
    );
  }

  /* ---- Desktop: standard centered modal ---- */
  return createPortal(
    <div
      className="responsive-modal__overlay"
      onClick={handleBackdrop}
      role="presentation"
    >
      <div
        ref={modalRef}
        className={`responsive-modal responsive-modal--${size} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel || title || 'Dialog'}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
