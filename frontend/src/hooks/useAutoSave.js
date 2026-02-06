import { useEffect, useRef, useCallback } from 'react';

// Debounced auto-save hook
export function useAutoSave(content, onSave, delay = 1000) {
    const timeoutRef = useRef(null);
    const lastSavedRef = useRef(content);
    const isSavingRef = useRef(false);
    const isMountedRef = useRef(true);

    // Track mount state
    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    const save = useCallback(async () => {
        if (isSavingRef.current) return;
        if (content === lastSavedRef.current) return;
        
        isSavingRef.current = true;
        try {
            await onSave(content);
            if (isMountedRef.current) {
                lastSavedRef.current = content;
            }
        } catch (error) {
            console.error('Auto-save failed:', error);
        } finally {
            if (isMountedRef.current) {
                isSavingRef.current = false;
            }
        }
    }, [content, onSave]);

    useEffect(() => {
        // Clear existing timeout
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        // Set new timeout for debounced save
        timeoutRef.current = setTimeout(() => {
            save();
        }, delay);

        // Cleanup on unmount
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, [content, delay, save]);

    // Force save immediately (for manual save or before close)
    const forceSave = useCallback(async () => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }
        await save();
    }, [save]);

    return { forceSave, isSaving: isSavingRef.current };
}
