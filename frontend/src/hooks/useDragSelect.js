/**
 * useDragSelect
 * 
 * Custom hook for lasso / rubber-band selection within a scrollable container.
 * Draws a semi-transparent rectangle on mousedown→mousemove, computes which
 * child elements intersect the rectangle, and reports selected IDs.
 * 
 * Ctrl-held during lasso adds to existing selection; otherwise replaces.
 * Only activates when the mousedown target is empty space (not a card).
 */

import { useRef, useEffect, useCallback } from 'react';

/**
 * Extract the item ID from a data-testid attribute.
 * Strips 'fs-file-' or 'fs-folder-' prefix.
 * @param {string} testId 
 * @returns {string|null}
 */
function extractIdFromTestId(testId) {
  if (!testId) return null;
  if (testId.startsWith('fs-file-')) return testId.slice(8);
  if (testId.startsWith('fs-folder-')) return testId.slice(10);
  return null;
}

/**
 * Check if two rectangles intersect.
 */
function rectsIntersect(a, b) {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

/**
 * @param {Object} options
 * @param {React.RefObject<HTMLElement>} options.containerRef - ref to the scrollable container
 * @param {string} options.itemSelector - CSS selector for selectable items (should have data-testid)
 * @param {(ids: Set<string>, additive: boolean) => void} options.onSelectionChange - called with IDs of intersected items
 * @param {boolean} [options.enabled=true] - whether drag-select is active
 */
export default function useDragSelect({ containerRef, itemSelector, onSelectionChange, enabled = true }) {
  const draggingRef = useRef(false);
  const startRef = useRef({ x: 0, y: 0 });
  const overlayRef = useRef(null);
  const additiveRef = useRef(false);

  // Create or get the overlay element for the lasso rectangle
  const getOverlay = useCallback(() => {
    if (overlayRef.current) return overlayRef.current;
    const el = document.createElement('div');
    el.className = 'drag-select-overlay';
    el.style.cssText = `
      position: absolute;
      background: rgba(137, 180, 250, 0.15);
      border: 1px solid rgba(137, 180, 250, 0.5);
      border-radius: 2px;
      pointer-events: none;
      z-index: 50;
      display: none;
    `;
    overlayRef.current = el;
    return el;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    const overlay = getOverlay();
    // Ensure the container is positioned so overlay absolute positioning works
    const computedPos = getComputedStyle(container).position;
    if (computedPos === 'static') {
      container.style.position = 'relative';
    }
    container.appendChild(overlay);

    const handleMouseDown = (e) => {
      // Only left-click
      if (e.button !== 0) return;
      // Don't start if clicking on a card, button, input, or interactive element
      const closest = e.target.closest(itemSelector + ', button, input, a, [role="menu"], .file-context-menu, .bulk-action-bar');
      if (closest) return;
      // Must start within the container's content area
      if (!container.contains(e.target)) return;

      draggingRef.current = true;
      additiveRef.current = e.ctrlKey || e.metaKey;
      
      const rect = container.getBoundingClientRect();
      startRef.current = {
        x: e.clientX - rect.left + container.scrollLeft,
        y: e.clientY - rect.top + container.scrollTop,
      };

      overlay.style.display = 'block';
      overlay.style.left = `${startRef.current.x}px`;
      overlay.style.top = `${startRef.current.y}px`;
      overlay.style.width = '0px';
      overlay.style.height = '0px';

      e.preventDefault();
    };

    const handleMouseMove = (e) => {
      if (!draggingRef.current) return;

      const rect = container.getBoundingClientRect();
      const currentX = e.clientX - rect.left + container.scrollLeft;
      const currentY = e.clientY - rect.top + container.scrollTop;

      const left = Math.min(startRef.current.x, currentX);
      const top = Math.min(startRef.current.y, currentY);
      const width = Math.abs(currentX - startRef.current.x);
      const height = Math.abs(currentY - startRef.current.y);

      overlay.style.left = `${left}px`;
      overlay.style.top = `${top}px`;
      overlay.style.width = `${width}px`;
      overlay.style.height = `${height}px`;
    };

    const handleMouseUp = (e) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      overlay.style.display = 'none';

      const containerRect = container.getBoundingClientRect();
      const currentX = e.clientX - containerRect.left + container.scrollLeft;
      const currentY = e.clientY - containerRect.top + container.scrollTop;

      const lassoLeft = Math.min(startRef.current.x, currentX);
      const lassoTop = Math.min(startRef.current.y, currentY);
      const lassoRight = Math.max(startRef.current.x, currentX);
      const lassoBottom = Math.max(startRef.current.y, currentY);

      // Minimum drag distance to avoid accidental selections on click
      if ((lassoRight - lassoLeft) < 5 && (lassoBottom - lassoTop) < 5) return;

      const lassoRect = { left: lassoLeft, top: lassoTop, right: lassoRight, bottom: lassoBottom };

      // Find all items that intersect the lasso
      const items = container.querySelectorAll(itemSelector);
      const selectedIds = new Set();

      items.forEach(item => {
        const itemRect = item.getBoundingClientRect();
        // Convert item rect to container-relative coordinates
        const relRect = {
          left: itemRect.left - containerRect.left + container.scrollLeft,
          top: itemRect.top - containerRect.top + container.scrollTop,
          right: itemRect.right - containerRect.left + container.scrollLeft,
          bottom: itemRect.bottom - containerRect.top + container.scrollTop,
        };

        if (rectsIntersect(lassoRect, relRect)) {
          const testId = item.getAttribute('data-testid');
          const id = extractIdFromTestId(testId);
          if (id) selectedIds.add(id);
        }
      });

      if (selectedIds.size > 0) {
        onSelectionChange(selectedIds, additiveRef.current);
      }
    };

    container.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      overlayRef.current = null;
    };
  }, [enabled, containerRef, itemSelector, onSelectionChange, getOverlay]);
}
