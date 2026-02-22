/**
 * useVirtualKeyboard — tracks the virtual keyboard state on mobile devices.
 *
 * Updates the CSS custom property --keyboard-height on <html> so that
 * fixed-position elements (bottom toolbar, toasts, etc.) can shift up
 * when the keyboard is open.
 *
 * Uses the VirtualKeyboard API where available (Chrome 94+, Android WebView),
 * and falls back to a visualViewport resize heuristic for iOS Safari.
 *
 * @returns {{ isKeyboardOpen: boolean, keyboardHeight: number }}
 */

import { useState, useEffect, useCallback } from 'react';

export default function useVirtualKeyboard() {
    const [state, setState] = useState({ isKeyboardOpen: false, keyboardHeight: 0 });

    const updateCssVar = useCallback((height) => {
        document.documentElement.style.setProperty('--keyboard-height', `${height}px`);
    }, []);

    // Scroll the cursor/active element into view when keyboard opens
    const scrollCursorIntoView = useCallback(() => {
        requestAnimationFrame(() => {
            // Try TipTap cursor first
            const cursor = document.querySelector('.ProseMirror .ProseMirror-cursor, .ProseMirror .is-active');
            if (cursor) {
                cursor.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
            }
            // Fallback: scroll the focused element into view
            const active = document.activeElement;
            if (active && active !== document.body) {
                active.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        // ---- Strategy 1: VirtualKeyboard API (Chrome/Android) ----
        if ('virtualKeyboard' in navigator) {
            navigator.virtualKeyboard.overlaysContent = true;
            const handleGeometryChange = () => {
                const { height } = navigator.virtualKeyboard.boundingRect;
                const open = height > 0;
                setState({ isKeyboardOpen: open, keyboardHeight: height });
                updateCssVar(height);
                if (open) scrollCursorIntoView();
            };
            navigator.virtualKeyboard.addEventListener('geometrychange', handleGeometryChange);
            return () => {
                navigator.virtualKeyboard.removeEventListener('geometrychange', handleGeometryChange);
            };
        }

        // ---- Strategy 2: visualViewport heuristic (iOS Safari, etc.) ----
        const vv = window.visualViewport;
        if (!vv) return;

        const initialHeight = vv.height;
        let rafId = null;

        const handleResize = () => {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                // The keyboard is likely open if the viewport shrank significantly
                const heightDiff = window.innerHeight - vv.height;
                const open = heightDiff > 100; // threshold — keyboards are > 100px
                const kbHeight = open ? Math.round(heightDiff) : 0;
                setState({ isKeyboardOpen: open, keyboardHeight: kbHeight });
                updateCssVar(kbHeight);
                if (open) scrollCursorIntoView();
            });
        };

        vv.addEventListener('resize', handleResize);
        return () => {
            vv.removeEventListener('resize', handleResize);
            if (rafId) cancelAnimationFrame(rafId);
            updateCssVar(0);
        };
    }, [updateCssVar, scrollCursorIntoView]);

    return state;
}
