import { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { addChangelogEntry, loadChangelogSync, saveChangelogSync } from '../utils/changelogStore';
import { getTextFromFragment } from '../utils/yjsTextExtraction';

// Convert Uint8Array to base64 for storage
const uint8ToBase64 = (arr) => {
    try {
        // Handle large arrays by chunking to avoid call stack size exceeded
        const chunkSize = 8192;
        let result = '';
        for (let i = 0; i < arr.length; i += chunkSize) {
            const chunk = arr.subarray(i, i + chunkSize);
            result += String.fromCharCode.apply(null, chunk);
        }
        return btoa(result);
    } catch (e) {
        console.warn('[ChangelogObserver] Failed to encode state:', e);
        return '';
    }
};

// Get summary text from sheet data
const getSheetSummary = (ysheet) => {
    if (!ysheet) return '';
    try {
        const sheets = ysheet.get('sheets');
        if (!sheets || !Array.isArray(sheets)) return '';
        
        // Count cells with data
        let cellCount = 0;
        let sheetNames = [];
        for (const sheet of sheets) {
            sheetNames.push(sheet.name || 'Sheet');
            if (sheet.celldata && Array.isArray(sheet.celldata)) {
                cellCount += sheet.celldata.length;
            }
        }
        return `${sheetNames.length} sheet(s), ${cellCount} cells`;
    } catch (e) {
        return '';
    }
};

// Get summary text from kanban data  
const getKanbanSummary = (ykanban) => {
    if (!ykanban) return '';
    try {
        const columns = ykanban.get('columns');
        if (!columns || !Array.isArray(columns)) return '';
        
        let cardCount = 0;
        let columnNames = [];
        for (const col of columns) {
            columnNames.push(col.name || 'Column');
            if (col.cards && Array.isArray(col.cards)) {
                cardCount += col.cards.length;
            }
        }
        return `${columns.length} column(s), ${cardCount} cards`;
    } catch (e) {
        return '';
    }
};

// Generate a diff summary based on document type
const generateDiffSummary = (docType, oldContent, newContent) => {
    if (docType === 'text') {
        const oldLen = oldContent?.length || 0;
        const newLen = newContent?.length || 0;
        const diff = newLen - oldLen;
        
        if (diff > 0) {
            return `Added ${diff} characters`;
        } else if (diff < 0) {
            return `Removed ${Math.abs(diff)} characters`;
        } else {
            return 'Modified content';
        }
    } else if (docType === 'sheet') {
        return `Spreadsheet updated: ${newContent}`;
    } else if (docType === 'kanban') {
        return `Kanban updated: ${newContent}`;
    }
    return 'Content modified';
};

/**
 * Hook to observe ydoc changes and record them to changelog.
 * Supports text documents (prosemirror), sheets, and kanban boards.
 * This should be used at the App level so it runs even when the changelog panel is closed.
 * 
 * @param {Y.Doc} ydoc - The Yjs document
 * @param {string} docId - Document ID
 * @param {Object} currentUser - Current user info {name, color, icon}
 * @param {string} documentType - 'text' | 'sheet' | 'kanban'
 */
export function useChangelogObserver(ydoc, docId, currentUser, documentType = 'text') {
    const lastContentRef = useRef('');
    const lastStateSizeRef = useRef(0);
    const debounceTimerRef = useRef(null);
    const currentUserRef = useRef(currentUser);
    const documentTypeRef = useRef(documentType);

    // Keep refs updated without re-running the effect
    useEffect(() => {
        currentUserRef.current = currentUser;
    }, [currentUser]);
    
    useEffect(() => {
        documentTypeRef.current = documentType;
    }, [documentType]);

    useEffect(() => {
        if (!ydoc || !docId) {
            return;
        }

        const docType = documentTypeRef.current;
        let getContent;
        let yDataSource;
        
        // Set up content extraction based on document type
        if (docType === 'sheet') {
            yDataSource = ydoc.getMap('sheet-data');
            getContent = () => getSheetSummary(yDataSource);
        } else if (docType === 'kanban') {
            yDataSource = ydoc.getMap('kanban');
            getContent = () => getKanbanSummary(yDataSource);
        } else {
            // Default to text (prosemirror)
            yDataSource = ydoc.get('prosemirror', Y.XmlFragment);
            getContent = () => getTextFromFragment(yDataSource);
        }
        
        lastContentRef.current = getContent();
        lastStateSizeRef.current = Y.encodeStateAsUpdate(ydoc).length;

        console.log(`[ChangelogObserver] Setting up for ${docType} doc: ${docId}`);

        const updateHandler = (update, origin) => {
            // Don't track changes from persistence or P2P (remote changes)
            if (origin === 'persistence' || origin === 'p2p') {
                return;
            }

            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = setTimeout(async () => {
                const newContent = getContent();
                const stateUpdate = Y.encodeStateAsUpdate(ydoc);
                const newStateSize = stateUpdate.length;

                const contentChanged = newContent !== lastContentRef.current;
                const sizeChanged = newStateSize !== lastStateSizeRef.current;

                if (contentChanged || sizeChanged) {
                    const stateSnapshot = uint8ToBase64(stateUpdate);
                    const currentDocType = documentTypeRef.current;

                    const entry = {
                        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
                        timestamp: Date.now(),
                        author: currentUserRef.current || { name: 'Anonymous', color: '#888888', publicKey: '' },
                        documentType: currentDocType,
                        type: newContent.length > lastContentRef.current.length ? 'add' :
                              newContent.length < lastContentRef.current.length ? 'delete' : 'edit',
                        summary: generateDiffSummary(currentDocType, lastContentRef.current, newContent),
                        contentSnapshot: newContent,
                        previousContentSnapshot: lastContentRef.current,
                        stateSnapshot: stateSnapshot
                    };

                    console.log('[ChangelogObserver] Recording entry:', entry.summary);
                    
                    // Try IndexedDB first, fall back to localStorage
                    try {
                        await addChangelogEntry(docId, entry);
                    } catch (e) {
                        // Fallback to sync localStorage
                        const existing = loadChangelogSync(docId);
                        saveChangelogSync(docId, [...existing, entry]);
                    }
                    
                    lastContentRef.current = newContent;
                    lastStateSizeRef.current = newStateSize;
                }
            }, 2000);
        };

        ydoc.on('update', updateHandler);

        return () => {
            clearTimeout(debounceTimerRef.current);
            ydoc.off('update', updateHandler);
        };
    }, [ydoc, docId, documentType]);
}

// Re-export for compatibility
export { loadChangelogSync as loadChangelog, saveChangelogSync as saveChangelog } from '../utils/changelogStore';
