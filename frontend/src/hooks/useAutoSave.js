import { useEffect, useRef, useCallback, useState } from 'react';

// Debounced auto-save hook
export function useAutoSave(content, onSave, delay = 1000) {
    const timeoutRef = useRef(null);
    const lastSavedRef = useRef(content);
    const [isSaving, setIsSaving] = useState(false);
    const isSavingRef = useRef(false);
    const isMountedRef = useRef(true);
    const saveRef = useRef(null);
    const onSaveRef = useRef(onSave);
    const contentRef = useRef(content);

    // Keep refs up to date
    onSaveRef.current = onSave;
    contentRef.current = content;

    // Track mount state
    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    const save = useCallback(async () => {
        if (isSavingRef.current) {
            // Retry after a short delay so we don't drop the save
            setTimeout(() => { if (isMountedRef.current) saveRef.current?.(); }, 200);
            return;
        }
        if (content === lastSavedRef.current) return;
        
        isSavingRef.current = true;
        setIsSaving(true);
        try {
            await onSaveRef.current(content);
            if (isMountedRef.current) {
                lastSavedRef.current = content;
            }
        } catch (error) {
            console.error('Auto-save failed:', error);
        } finally {
            isSavingRef.current = false;
            if (isMountedRef.current) {
                setIsSaving(false);
            }
        }
    }, [content]);

    saveRef.current = save;

    useEffect(() => {
        // Clear existing timeout
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        // Set new timeout for debounced save
        timeoutRef.current = setTimeout(() => {
            save();
        }, delay);

        // Cleanup: cancel pending timer
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, [content, delay, save]);

    // Separate effect for unmount-only flush (runs last, after all other cleanups)
    useEffect(() => {
        return () => {
            // This cleanup runs on unmount. Flush unsaved content.
            const latestContent = contentRef.current;
            if (latestContent !== lastSavedRef.current && !isSavingRef.current) {
                try {
                    const result = onSaveRef.current(latestContent);
                    if (result?.catch) result.catch(err => console.error('Auto-save flush on unmount failed:', err));
                    lastSavedRef.current = latestContent;
                } catch (err) {
                    console.error('Auto-save flush on unmount failed:', err);
                }
            }
        };
    }, []); // Empty deps = only runs on unmount

    // Force save immediately (for manual save or before close)
    const forceSave = useCallback(async () => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }
        await save();
    }, [save]);

    return { forceSave, isSaving };
}
