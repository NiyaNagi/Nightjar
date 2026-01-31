/**
 * useFocusTrap Hook
 * 
 * Traps keyboard focus within a container element (e.g., modal dialog).
 * Ensures accessibility by preventing focus from leaving the modal.
 */

import { useEffect, useCallback } from 'react';

/**
 * Get all focusable elements within a container
 */
const getFocusableElements = (container) => {
    if (!container) return [];
    
    const selector = [
        'button:not([disabled]):not([tabindex="-1"])',
        'a[href]:not([tabindex="-1"])',
        'input:not([disabled]):not([tabindex="-1"])',
        'select:not([disabled]):not([tabindex="-1"])',
        'textarea:not([disabled]):not([tabindex="-1"])',
        '[tabindex]:not([tabindex="-1"]):not([disabled])',
        '[contenteditable="true"]:not([tabindex="-1"])',
    ].join(', ');
    
    return Array.from(container.querySelectorAll(selector)).filter(
        (el) => el.offsetParent !== null // Filter out hidden elements
    );
};

/**
 * useFocusTrap - Traps focus within a container element
 * 
 * @param {React.RefObject} containerRef - Ref to the container element
 * @param {boolean} isActive - Whether the focus trap is active
 * @param {Object} options - Configuration options
 * @param {boolean} options.autoFocus - Auto-focus first element on mount (default: true)
 * @param {boolean} options.returnFocus - Return focus to previous element on unmount (default: true)
 * @param {Function} options.onEscape - Callback when Escape is pressed
 */
export function useFocusTrap(containerRef, isActive = true, options = {}) {
    const {
        autoFocus = true,
        returnFocus = true,
        onEscape = null,
    } = options;
    
    const handleKeyDown = useCallback((event) => {
        if (!containerRef.current || !isActive) return;
        
        // Handle Escape key
        if (event.key === 'Escape' && onEscape) {
            event.preventDefault();
            onEscape();
            return;
        }
        
        // Only handle Tab key for focus trapping
        if (event.key !== 'Tab') return;
        
        const focusableElements = getFocusableElements(containerRef.current);
        if (focusableElements.length === 0) return;
        
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        
        // Shift+Tab on first element -> go to last
        if (event.shiftKey && document.activeElement === firstElement) {
            event.preventDefault();
            lastElement.focus();
        }
        // Tab on last element -> go to first
        else if (!event.shiftKey && document.activeElement === lastElement) {
            event.preventDefault();
            firstElement.focus();
        }
    }, [containerRef, isActive, onEscape]);
    
    useEffect(() => {
        if (!isActive || !containerRef.current) return;
        
        // Store previously focused element
        const previouslyFocused = document.activeElement;
        
        // Auto-focus first focusable element
        if (autoFocus) {
            const focusableElements = getFocusableElements(containerRef.current);
            if (focusableElements.length > 0) {
                // Small delay to ensure the modal is fully rendered
                setTimeout(() => {
                    focusableElements[0].focus();
                }, 0);
            }
        }
        
        // Add keydown listener
        document.addEventListener('keydown', handleKeyDown);
        
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            
            // Return focus to previous element
            if (returnFocus && previouslyFocused && previouslyFocused.focus) {
                previouslyFocused.focus();
            }
        };
    }, [isActive, containerRef, autoFocus, returnFocus, handleKeyDown]);
}

export default useFocusTrap;
