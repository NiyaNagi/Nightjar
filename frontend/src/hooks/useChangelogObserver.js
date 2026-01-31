import { useEffect, useRef } from 'react';
import * as Y from 'yjs';

// Storage key prefix for changelog
const CHANGELOG_STORAGE_KEY = 'Nightjar-changelog-';

// Convert Uint8Array to base64 for storage
const uint8ToBase64 = (arr) => {
    return btoa(String.fromCharCode.apply(null, arr));
};

// Load changelog from localStorage
const loadChangelog = (docId) => {
    try {
        const stored = localStorage.getItem(CHANGELOG_STORAGE_KEY + docId);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        console.error('Failed to load changelog:', e);
        return [];
    }
};

// Save changelog to localStorage (keep last 50 entries)
const saveChangelog = (docId, changelog) => {
    try {
        const trimmed = changelog.slice(-50);
        localStorage.setItem(CHANGELOG_STORAGE_KEY + docId, JSON.stringify(trimmed));
    } catch (e) {
        console.error('Failed to save changelog:', e);
    }
};

// Helper to get text content from XmlFragment
const getTextFromFragment = (fragment) => {
    if (!fragment) return '';
    try {
        let text = '';
        
        const traverse = (node) => {
            if (!node) return;
            
            if (typeof node === 'string') {
                text += node;
                return;
            }
            
            // Y.XmlText - use toString() method
            if (node.constructor?.name === 'YXmlText' || node.toString !== Object.prototype.toString) {
                try {
                    const str = node.toString();
                    if (str && typeof str === 'string') {
                        text += str;
                        return;
                    }
                } catch (e) {
                    // Fall through to other methods
                }
            }
            
            // XmlText - has _start property (internal structure)
            if (node._start !== undefined) {
                let item = node._start;
                while (item) {
                    if (item.content && typeof item.content.str === 'string') {
                        text += item.content.str;
                    }
                    item = item.right;
                }
                return;
            }
            
            // XmlElement or XmlFragment - has toArray
            if (typeof node.toArray === 'function') {
                const children = node.toArray();
                children.forEach(child => traverse(child));
                if (node.nodeName && ['paragraph', 'heading', 'blockquote'].includes(node.nodeName)) {
                    text += '\n';
                }
                return;
            }
            
            // Last resort: try to iterate over children
            if (typeof node.forEach === 'function') {
                node.forEach(child => traverse(child));
            }
        };
        
        traverse(fragment);
        return text.trim();
    } catch (e) {
        console.warn('[ChangelogObserver] Failed to extract text from fragment:', e);
        return '';
    }
};

// Generate a diff summary
const generateDiffSummary = (oldText, newText) => {
    const oldLen = oldText?.length || 0;
    const newLen = newText?.length || 0;
    const diff = newLen - oldLen;
    
    if (diff > 0) {
        return `Added ${diff} characters`;
    } else if (diff < 0) {
        return `Removed ${Math.abs(diff)} characters`;
    } else {
        return 'Modified content';
    }
};

/**
 * Hook to observe ydoc changes and record them to changelog.
 * This should be used at the App level so it runs even when the changelog panel is closed.
 */
export function useChangelogObserver(ydoc, docId, currentUser) {
    const lastTextRef = useRef('');
    const lastStateSizeRef = useRef(0);
    const debounceTimerRef = useRef(null);
    const currentUserRef = useRef(currentUser);

    // Keep currentUser ref updated without re-running the effect
    useEffect(() => {
        currentUserRef.current = currentUser;
    }, [currentUser]);

    useEffect(() => {
        console.log('[ChangelogObserver] Effect running with ydoc:', !!ydoc, 'docId:', docId);
        
        if (!ydoc || !docId) {
            console.log('[ChangelogObserver] No ydoc or docId, skipping setup');
            return;
        }

        const fragment = ydoc.get('prosemirror', Y.XmlFragment);
        
        // Debug: log fragment structure
        console.log('[ChangelogObserver] Fragment type:', fragment?.constructor?.name);
        console.log('[ChangelogObserver] Fragment toArray length:', fragment?.toArray?.()?.length);
        if (fragment?.toArray) {
            const arr = fragment.toArray();
            if (arr.length > 0) {
                console.log('[ChangelogObserver] First child type:', arr[0]?.constructor?.name);
                console.log('[ChangelogObserver] First child toString:', arr[0]?.toString?.());
            }
        }
        
        lastTextRef.current = getTextFromFragment(fragment);
        lastStateSizeRef.current = Y.encodeStateAsUpdate(ydoc).length;

        console.log('[ChangelogObserver] Setting up for doc:', docId);
        console.log('[ChangelogObserver] Initial text length:', lastTextRef.current.length);
        console.log('[ChangelogObserver] Initial text preview:', lastTextRef.current.substring(0, 100));
        console.log('[ChangelogObserver] ydoc type:', ydoc.constructor?.name);
        console.log('[ChangelogObserver] ydoc has "on" method:', typeof ydoc.on);

        const updateHandler = (update, origin) => {
            console.log('[ChangelogObserver] Update received, origin:', origin, 'type:', typeof origin, 'size:', update?.length);
            
            // Don't track changes from persistence or y-websocket provider (remote changes)
            // Local changes from user typing typically have origin = null or undefined
            if (origin === 'persistence') {
                console.log('[ChangelogObserver] Skipping persistence origin');
                return;
            }

            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = setTimeout(() => {
                const newText = getTextFromFragment(fragment);
                const newStateSize = Y.encodeStateAsUpdate(ydoc).length;

                const textChanged = newText !== lastTextRef.current;
                const sizeChanged = newStateSize !== lastStateSizeRef.current;

                console.log('[ChangelogObserver] Debounced check:', {
                    textChanged,
                    sizeChanged,
                    newTextLen: newText.length,
                    lastTextLen: lastTextRef.current.length
                });

                if ((textChanged || sizeChanged) && (newText.length > 0 || lastTextRef.current.length > 0)) {
                    const stateSnapshot = uint8ToBase64(Y.encodeStateAsUpdate(ydoc));

                    const entry = {
                        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
                        timestamp: Date.now(),
                        author: currentUserRef.current || { name: 'Anonymous', color: '#888888' },
                        type: newText.length > lastTextRef.current.length ? 'add' :
                              newText.length < lastTextRef.current.length ? 'delete' : 'edit',
                        summary: generateDiffSummary(lastTextRef.current, newText),
                        textSnapshot: newText,
                        previousTextSnapshot: lastTextRef.current,
                        stateSnapshot: stateSnapshot
                    };

                    console.log('[ChangelogObserver] Recording entry:', entry.summary);
                    const updatedChangelog = [...loadChangelog(docId), entry];
                    saveChangelog(docId, updatedChangelog);
                    
                    lastTextRef.current = newText;
                    lastStateSizeRef.current = newStateSize;
                }
            }, 2000);
        };

        ydoc.on('update', updateHandler);

        return () => {
            console.log('[ChangelogObserver] Cleaning up for doc:', docId);
            clearTimeout(debounceTimerRef.current);
            ydoc.off('update', updateHandler);
        };
    }, [ydoc, docId]); // Removed currentUser from deps - using ref instead
}

export { loadChangelog, saveChangelog };
