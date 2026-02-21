import { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useDrag } from '@use-gesture/react';
import './BottomSheet.css';

/**
 * BottomSheet — mobile-optimised slide-up panel.
 *
 * Props:
 *   isOpen       – boolean – controls visibility
 *   onClose      – () => void – called when dismissed
 *   title        – string (optional header text)
 *   snapPoints   – number[] of vh percentages, default [50, 90]
 *   children     – content
 *   className    – extra CSS class on the sheet body
 */
export default function BottomSheet({
  isOpen,
  onClose,
  title,
  snapPoints = [50, 90],
  children,
  className = '',
}) {
  const sheetRef = useRef(null);
  const currentY = useRef(0);
  const startSnap = useRef(0);

  // Convert snap-point vh → px
  const snapToPx = useCallback(
    (vh) => window.innerHeight * (1 - vh / 100),
    [],
  );

  // On open, animate to first snap point
  useEffect(() => {
    if (!isOpen) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const target = snapToPx(snapPoints[0]);
    sheet.style.transition = 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)';
    sheet.style.transform = `translateY(${target}px)`;
    currentY.current = target;
    startSnap.current = target;
  }, [isOpen, snapPoints, snapToPx]);

  // Drag gesture on the handle
  const bind = useDrag(
    ({ down, movement: [, my], velocity: [, vy], cancel, direction: [, dy] }) => {
      const sheet = sheetRef.current;
      if (!sheet) return;

      if (down) {
        // While dragging — follow finger (no transition)
        const newY = Math.max(0, startSnap.current + my);
        sheet.style.transition = 'none';
        sheet.style.transform = `translateY(${newY}px)`;
        currentY.current = newY;
      } else {
        // Released — decide snap or dismiss
        const dismissThreshold = window.innerHeight * 0.4;
        const fastSwipeDown = vy > 0.5 && dy > 0;

        if (currentY.current > dismissThreshold || fastSwipeDown) {
          // Dismiss
          sheet.style.transition = 'transform 0.25s cubic-bezier(0.32, 0.72, 0, 1)';
          sheet.style.transform = `translateY(${window.innerHeight}px)`;
          setTimeout(onClose, 260);
        } else {
          // Snap to nearest snap-point
          const snapPxArr = snapPoints.map(snapToPx);
          let closest = snapPxArr[0];
          let minDist = Math.abs(currentY.current - closest);
          for (let i = 1; i < snapPxArr.length; i++) {
            const d = Math.abs(currentY.current - snapPxArr[i]);
            if (d < minDist) {
              minDist = d;
              closest = snapPxArr[i];
            }
          }
          sheet.style.transition = 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)';
          sheet.style.transform = `translateY(${closest}px)`;
          currentY.current = closest;
          startSnap.current = closest;
        }
      }
    },
    { axis: 'y', filterTaps: true },
  );

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="bottom-sheet-backdrop" onClick={onClose} role="presentation">
      <div
        ref={sheetRef}
        className={`bottom-sheet ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Bottom sheet'}
        onClick={(e) => e.stopPropagation()}
        style={{ transform: `translateY(${window.innerHeight}px)` }}
      >
        <div className="bottom-sheet__handle-area" {...bind()}>
          <div className="bottom-sheet__handle" />
        </div>
        {title && <div className="bottom-sheet__title">{title}</div>}
        <div className="bottom-sheet__content">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
