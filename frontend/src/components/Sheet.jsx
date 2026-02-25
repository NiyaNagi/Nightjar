/**
 * Sheet Component
 * 
 * Spreadsheet document type using Fortune Sheet with Yjs CRDT sync.
 * Supports multiple sheets, formulas, and real-time P2P collaboration.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Workbook } from '@fortune-sheet/react';
import '@fortune-sheet/react/dist/index.css';
import SheetSelectionToolbar from './SheetSelectionToolbar';
import './Sheet.css';

// Helper to convert column index to letter (0 -> A, 25 -> Z, 26 -> AA)
function colToLetter(col) {
    let letter = '';
    let c = col;
    while (c >= 0) {
        letter = String.fromCharCode(65 + (c % 26)) + letter;
        c = Math.floor(c / 26) - 1;
    }
    return letter;
}

// Helper to convert row/col to cell reference (e.g., 0,0 -> A1)
function getCellRef(row, col) {
    if (row == null || col == null) return null;
    return `${colToLetter(col)}${row + 1}`;
}

// Helper to get range reference (e.g., B5:E12 or just A1 if single cell)
function getRangeRef(selection) {
    if (!selection) return null;
    const { row, column } = selection;
    if (!row || !column) return null;
    
    // Ensure we have valid start values
    const rowStart = row[0] ?? 0;
    const rowEnd = row[1] ?? rowStart;
    const colStart = column[0] ?? 0;
    const colEnd = column[1] ?? colStart;
    
    const startRef = getCellRef(rowStart, colStart);
    const endRef = getCellRef(rowEnd, colEnd);
    
    if (!startRef) return null;
    if (startRef === endRef || !endRef) {
        return startRef;
    }
    return `${startRef}:${endRef}`;
}

// Debounce utility with flush capability
function debounce(func, wait) {
    let timeout;
    let pendingArgs;
    
    function executedFunction(...args) {
        pendingArgs = args;
        const later = () => {
            clearTimeout(timeout);
            timeout = null;
            pendingArgs = null;
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    }
    
    // Flush any pending call immediately
    executedFunction.flush = () => {
        if (timeout && pendingArgs) {
            clearTimeout(timeout);
            timeout = null;
            func(...pendingArgs);
            pendingArgs = null;
        }
    };
    
    // Cancel pending call
    executedFunction.cancel = () => {
        clearTimeout(timeout);
        timeout = null;
        pendingArgs = null;
    };
    
    return executedFunction;
}

// Default sheet configuration - matches Google Sheets
const DEFAULT_SHEET = {
    name: 'Sheet1',
    // id intentionally omitted — always use generateSheetId() to avoid collisions
    order: 0,
    row: 100,      // 100 rows like Google Sheets
    column: 26,    // 26 columns (A-Z) like Google Sheets
    celldata: [],
    config: {},
    status: 1,     // Active sheet
};

// Generate deterministic sheet ID so all peers produce the same default.
// Non-deterministic IDs caused Immer patch-path mismatches between peers
// which broke Fortune Sheet's applyOp (Immer error 15).  Accepts an
// optional 1-based index for multi-sheet support (defaults to 1).
const generateSheetId = (index = 1) => `sheet_${index}`;

// Tag for Yjs transactions initiated by this client.
// Observers check this origin to skip echoes of our own saves.
const SHEET_SYNC_ORIGIN = 'nightjar-sheet-save';

/**
 * Sheet Component
 * @param {Object} props
 * @param {Object} props.ydoc - Yjs document instance
 * @param {Object} props.provider - Yjs provider for sync
 * @param {string} props.userColor - User's collaboration color
 * @param {string} props.userHandle - User's display name
 * @param {boolean} props.readOnly - Whether sheet is in view-only mode
 * @param {function} props.onAddComment - Callback when user wants to add a comment
 */
export default function Sheet({ ydoc, provider, userColor, userHandle, userPublicKey, readOnly = false, onStatsChange, onAddComment }) {
    const [data, setData] = useState(null);
    const [isInitialized, setIsInitialized] = useState(false);
    const [collaborators, setCollaborators] = useState([]);
    const [currentSheetId, setCurrentSheetId] = useState(null);
    const [currentSelection, setCurrentSelection] = useState(null); // For toolbar
    const [toolbarPosition, setToolbarPosition] = useState(null);   // For toolbar positioning
    const workbookRef = useRef(null);
    const containerRef = useRef(null);
    // Cell-level CRDT refs (replace old blob-based ysheetRef)
    const ycellsRef = useRef(null);  // ydoc.getMap('sheet-cells') — one entry per cell
    const ymetaRef = useRef(null);   // ydoc.getMap('sheet-meta') — one entry per sheet
    const hasSyncedRef = useRef(false);
    const debouncedSaveRef = useRef(null);
    const hasReceivedFirstData = useRef(false); // Track if we've received initial data from Yjs
    const onChangeCountRef = useRef(0);         // Count onChange calls to skip the first one after mount
    const dataRef = useRef(null); // Always holds latest data for stale-closure-safe reads
    
    // Custom presence overlays (Fortune Sheet's API is unreliable)
    const [presenceOverlays, setPresenceOverlays] = useState([]);
    // Store raw presence data separately from computed overlay positions
    const presenceDataRef = useRef([]);
    
    // Ref-stable callback for stats so the debounced function never goes stale
    const onStatsChangeRef = useRef(onStatsChange);
    onStatsChangeRef.current = onStatsChange;
    
    // Debounced stats calculator — avoids O(cells × sheets) work on every keystroke.
    // Uses a stable ref for the callback so it never needs to be recreated.
    const debouncedReportStats = useMemo(() => {
        const fn = debounce((sheets) => {
            const callback = onStatsChangeRef.current;
            if (!callback) return;
            let nonEmptyCells = 0;
            let totalCharacters = 0;
            for (const sheet of sheets) {
                const sheetData = sheet?.data;
                if (sheetData && Array.isArray(sheetData)) {
                    for (const row of sheetData) {
                        if (row && Array.isArray(row)) {
                            for (const cell of row) {
                                if (cell && cell.v !== null && cell.v !== undefined && cell.v !== '') {
                                    nonEmptyCells++;
                                    totalCharacters += String(cell.v).length;
                                }
                            }
                        }
                    }
                }
            }
            callback({ cellCount: nonEmptyCells, characterCount: totalCharacters });
        }, 500);
        return fn;
    }, []);

    // Keep dataRef in sync with the latest data state
    // Updated at render time (not in useEffect) to avoid one-frame stale reads
    dataRef.current = data;

    /**
     * Compute pixel positions for presence overlays using actual cell dimensions
     * from Fortune Sheet's API rather than hardcoded defaults.
     * This is called when:
     *  - awareness state changes (collaborator moves)
     *  - the user scrolls the sheet
     *  - the sheet resizes
     */
    const computePresenceOverlays = useCallback(() => {
        const presences = presenceDataRef.current;
        if (!presences || presences.length === 0) {
            setPresenceOverlays([]);
            return;
        }

        // Read actual cell dimensions from the Fortune Sheet workbook API
        const wb = workbookRef.current;
        
        // Collect all unique row and column indices we need dimensions for
        const rowIndices = [...new Set(presences.map(p => p.selection.r))];
        const colIndices = [...new Set(presences.map(p => p.selection.c))];
        
        // For positioning, we need cumulative heights/widths up to each index.
        // getRowHeight / getColumnWidth return the size of the requested rows/columns.
        // We need to sum all rows from 0..r-1 for the top edge and add row r's height for the bottom.
        
        // Find the max row/col index we need and request all rows/cols from 0 to max
        const maxRow = Math.max(...rowIndices);
        const maxCol = Math.max(...colIndices);
        
        // Build arrays [0, 1, 2, ..., maxRow] and [0, 1, ..., maxCol]
        const allRows = Array.from({ length: maxRow + 1 }, (_, i) => i);
        const allCols = Array.from({ length: maxCol + 1 }, (_, i) => i);
        
        // Default dimensions as fallback
        const defaultRowH = 25;
        const defaultColW = 100;
        
        // Get actual dimensions from the API (returns Record<number, number>)
        let rowHeights = {};
        let colWidths = {};
        try {
            if (wb?.getRowHeight && allRows.length > 0) {
                rowHeights = wb.getRowHeight(allRows) || {};
            }
        } catch (e) {
            console.warn('[Sheet] getRowHeight failed, using defaults:', e);
        }
        try {
            if (wb?.getColumnWidth && allCols.length > 0) {
                colWidths = wb.getColumnWidth(allCols) || {};
            }
        } catch (e) {
            console.warn('[Sheet] getColumnWidth failed, using defaults:', e);
        }
        
        // Build cumulative position arrays
        // cumulativeRowY[r] = top edge of row r (sum of heights of rows 0..r-1)
        const cumulativeRowY = new Array(maxRow + 2);
        cumulativeRowY[0] = 0;
        for (let r = 0; r <= maxRow; r++) {
            const h = rowHeights[r] ?? defaultRowH;
            cumulativeRowY[r + 1] = cumulativeRowY[r] + h;
        }
        
        // cumulativeColX[c] = left edge of column c (sum of widths of columns 0..c-1)
        const cumulativeColX = new Array(maxCol + 2);
        cumulativeColX[0] = 0;
        for (let c = 0; c <= maxCol; c++) {
            const w = colWidths[c] ?? defaultColW;
            cumulativeColX[c + 1] = cumulativeColX[c] + w;
        }
        
        // Read Fortune Sheet's internal scroll position from the DOM
        let scrollLeft = 0;
        let scrollTop = 0;
        if (containerRef.current) {
            const scrollXEl = containerRef.current.querySelector('.luckysheet-scrollbar-x');
            const scrollYEl = containerRef.current.querySelector('.luckysheet-scrollbar-y');
            if (scrollXEl) scrollLeft = scrollXEl.scrollLeft || 0;
            if (scrollYEl) scrollTop = scrollYEl.scrollTop || 0;
        }
        
        // Measure actual header dimensions from the DOM for precision
        let topOffset = 93; // fallback: toolbar(40) + formula-bar(28) + col-headers(25)
        let rowHeaderWidth = 46; // fallback
        if (containerRef.current) {
            // The column header row sits above the cells
            const colHeader = containerRef.current.querySelector('.fortune-col-header');
            const cellArea = containerRef.current.querySelector('.fortune-cell-area');
            const toolbar = containerRef.current.querySelector('.fortune-toolbar');
            const formulaBar = containerRef.current.querySelector('.fortune-formula-bar');
            
            // Calculate topOffset from actual DOM elements if available
            if (cellArea) {
                // cellArea's offsetTop relative to the sheet-workbook-wrapper gives us the exact top offset
                const wrapperEl = containerRef.current.querySelector('.sheet-workbook-wrapper') || containerRef.current;
                const wrapperRect = wrapperEl.getBoundingClientRect();
                const cellAreaRect = cellArea.getBoundingClientRect();
                topOffset = cellAreaRect.top - wrapperRect.top;
            }
            
            // Measure row header width from DOM
            const rowHeader = containerRef.current.querySelector('.fortune-row-header');
            if (rowHeader) {
                rowHeaderWidth = rowHeader.offsetWidth || 46;
            }
        }
        
        const overlays = presences.map(p => {
            const r = p.selection.r;
            const c = p.selection.c;
            
            // Add +r and +c to account for 1px grid lines between cells.
            // Fortune Sheet renders 1px borders between each row/column;
            // getRowHeight/getColumnWidth return content dimensions only.
            const cellTop = (cumulativeRowY[r] ?? (r * defaultRowH)) + r;
            const cellLeft = (cumulativeColX[c] ?? (c * defaultColW)) + c;
            const cellHeight = rowHeights[r] ?? defaultRowH;
            const cellWidth = colWidths[c] ?? defaultColW;
            
            // Position relative to the wrapper: header offsets + cell position - scroll
            const cellX = rowHeaderWidth + cellLeft - scrollLeft;
            const cellY = topOffset + cellTop - scrollTop;
            
            return {
                clientId: p.userId,
                name: p.username,
                color: p.color,
                cellX,
                cellY,
                cellWidth,
                cellHeight,
                // Dot position: upper-right corner of the cell
                dotX: cellX + cellWidth - 12,
                dotY: cellY + 2,
                row: r,
                col: c,
                // Hide if scrolled out of view
                visible: cellX + cellWidth > rowHeaderWidth && cellY + cellHeight > topOffset,
            };
        });
        
        setPresenceOverlays(overlays);
    }, []); // No deps — reads from refs and DOM

    // Subscribe to awareness for collaborator presence and selections
    useEffect(() => {
        if (!provider?.awareness) return;
        
        const awareness = provider.awareness;
        
        // CRITICAL: Preserve existing awareness fields (especially publicKey)
        // Without this, opening a sheet destroys the publicKey set by useWorkspaceSync
        const currentUser = awareness.getLocalState()?.user || {};
        
        // Set our own user info in awareness (selection is updated separately)
        awareness.setLocalStateField('user', {
            ...currentUser, // Preserve publicKey and other identity fields
            name: userHandle || 'Anonymous',
            color: userColor || '#6366f1',
            publicKey: userPublicKey || currentUser.publicKey, // Ensure publicKey persists
            lastActive: Date.now(),
        });
        
        // Periodic heartbeat to keep lastActive fresh
        const heartbeat = setInterval(() => {
            const currentState = awareness.getLocalState();
            if (currentState?.user) {
                awareness.setLocalStateField('user', {
                    ...currentState.user,
                    lastActive: Date.now(),
                });
            }
        }, 30000);
        
        // Track previous clientIds to detect disconnections
        let previousClientIds = new Set();
        
        const updateCollaborators = () => {
            const states = awareness.getStates();
            const myClientId = awareness.clientID;
            const collabs = [];
            const presences = [];
            const currentClientIds = new Set();
            const now = Date.now();
            const seenClientIds = new Set(); // Deduplicate by clientID to avoid hiding distinct users with the same name
            
            states.forEach((state, clientId) => {
                // Skip ourselves
                if (clientId === myClientId) return;
                
                // Skip if no user state
                if (!state?.user) return;
                
                // Skip stale awareness states - require lastActive and not older than 2 minutes
                const lastActive = state.user?.lastActive;
                if (!lastActive || (now - lastActive) > 120000) {
                    console.log(`[Sheet] Skipping stale user ${state.user?.name}, lastActive: ${lastActive ? Math.round((now - lastActive) / 1000) + 's ago' : 'never'}`);
                    return;
                }
                
                // Skip duplicate clientIDs
                const userName = state.user.name || 'Anonymous';
                if (seenClientIds.has(clientId)) return;
                seenClientIds.add(clientId);
                
                currentClientIds.add(clientId);
                
                const selection = state.selection;
                // Get range reference (e.g., "B5:E12" or "A1")
                const cellRef = selection ? getRangeRef(selection) : null;
                
                collabs.push({
                    clientId,
                    name: userName,
                    color: state.user.color || '#6366f1',
                    icon: state.user.icon,
                    cellRef, // e.g., "A1", "B5:E12"
                    selection,
                });
                
                // Build presence object for Fortune Sheet's visual cursor display
                // Note: Fortune Sheet's presence API only supports single-cell display,
                // so we use the top-left cell of the selection
                if (selection && selection.sheetId && selection.row && selection.column) {
                    presences.push({
                        sheetId: selection.sheetId,
                        username: userName,
                        userId: String(clientId),
                        color: state.user.color || '#6366f1',
                        selection: { r: selection.row[0], c: selection.column[0] },
                    });
                }
            });
            
            setCollaborators(collabs);
            
            // Store raw presence data — pixel positions are computed separately
            // in computePresenceOverlays() which reads actual cell dimensions from the API
            presenceDataRef.current = presences;
            computePresenceOverlays();
            
            // Update previousClientIds for next comparison
            previousClientIds = currentClientIds;
        };
        
        // Initial update
        updateCollaborators();
        
        // Subscribe to changes
        awareness.on('change', updateCollaborators);
        
        return () => {
            awareness.off('change', updateCollaborators);
            clearInterval(heartbeat);
            // Clear our selection when leaving the sheet
            awareness.setLocalStateField('selection', null);
        };
    }, [provider, userHandle, userColor, userPublicKey, computePresenceOverlays]);

    // Recompute presence overlays when the user scrolls or resizes the sheet.
    // Fortune Sheet uses custom scrollbar divs, so we attach listeners to those.
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        // Debounce scroll/resize handler for performance (16ms ≈ 1 frame)
        let rafId = null;
        const handleScrollOrResize = () => {
            if (rafId) return; // already scheduled
            rafId = requestAnimationFrame(() => {
                rafId = null;
                computePresenceOverlays();
            });
        };

        // Attach to Fortune Sheet's custom scrollbar elements.
        // They may not exist until the workbook mounts, so use MutationObserver
        // to detect when they appear.
        let scrollXEl = container.querySelector('.luckysheet-scrollbar-x');
        let scrollYEl = container.querySelector('.luckysheet-scrollbar-y');

        const attachScrollListeners = () => {
            scrollXEl = container.querySelector('.luckysheet-scrollbar-x');
            scrollYEl = container.querySelector('.luckysheet-scrollbar-y');
            if (scrollXEl) scrollXEl.addEventListener('scroll', handleScrollOrResize, { passive: true });
            if (scrollYEl) scrollYEl.addEventListener('scroll', handleScrollOrResize, { passive: true });
        };

        attachScrollListeners();

        // Also listen for window resize
        window.addEventListener('resize', handleScrollOrResize, { passive: true });

        // Use MutationObserver in case scrollbar elements mount after this effect runs
        const observer = new MutationObserver(() => {
            const newX = container.querySelector('.luckysheet-scrollbar-x');
            const newY = container.querySelector('.luckysheet-scrollbar-y');
            if (newX !== scrollXEl || newY !== scrollYEl) {
                // Detach old
                if (scrollXEl) scrollXEl.removeEventListener('scroll', handleScrollOrResize);
                if (scrollYEl) scrollYEl.removeEventListener('scroll', handleScrollOrResize);
                // Attach new
                attachScrollListeners();
            }
        });
        observer.observe(container, { childList: true, subtree: true });

        return () => {
            if (scrollXEl) scrollXEl.removeEventListener('scroll', handleScrollOrResize);
            if (scrollYEl) scrollYEl.removeEventListener('scroll', handleScrollOrResize);
            window.removeEventListener('resize', handleScrollOrResize);
            observer.disconnect();
            if (rafId) cancelAnimationFrame(rafId);
        };
    }, [computePresenceOverlays]);

    // Helper to convert Fortune Sheet's 2D data array to celldata sparse format
    const convertDataToCelldata = useCallback((sheets) => {
        return sheets.map(sheet => {
            const newSheet = { ...sheet };
            // Convert 2D data array to celldata if data exists
            if (sheet.data && Array.isArray(sheet.data)) {
                const celldata = [];
                sheet.data.forEach((row, r) => {
                    if (row && Array.isArray(row)) {
                        row.forEach((cell, c) => {
                            if (cell !== null && cell !== undefined) {
                                celldata.push({ r, c, v: cell });
                            }
                        });
                    }
                });
                newSheet.celldata = celldata;
                // Remove data to avoid doubling Yjs storage
                delete newSheet.data;
                console.log('[Sheet] Converted data to celldata:', celldata.length, 'cells');
            }
            return newSheet;
        });
    }, []);

    // Helper to convert celldata (sparse format) back to 2D data array
    // This is the inverse of convertDataToCelldata — needed when receiving
    // remote data that only contains celldata (no 2D data array) from Yjs.
    const convertCelldataToData = useCallback((sheets) => {
        return sheets.map(sheet => {
            const newSheet = { ...sheet };
            // Only convert if sheet has celldata but no data (2D array)
            if (sheet.celldata && Array.isArray(sheet.celldata) && !sheet.data) {
                const rows = sheet.row || 100;
                const cols = sheet.column || 26;
                // Build a 2D array initialized with nulls
                const data = Array.from({ length: rows }, () => Array(cols).fill(null));
                // Place each cell entry into the 2D array
                for (const cell of sheet.celldata) {
                    if (cell && cell.r != null && cell.c != null && cell.r < rows && cell.c < cols) {
                        data[cell.r][cell.c] = cell.v !== undefined ? cell.v : null;
                    }
                }
                newSheet.data = data;
                console.log('[Sheet] Converted celldata to data: placed', sheet.celldata.length, 'cells into', rows, 'x', cols, 'grid');
            }
            return newSheet;
        });
    }, []);

    // Build Fortune Sheet data from the cell-level Y.Maps.
    // Returns an array of sheet objects (with 2D data array) or null if empty.
    const buildSheetsFromYMap = useCallback((ycells, ymeta) => {
        // Group cells by sheet ID
        const sheetCells = new Map(); // sheetId → Map('r:c' → value)
        for (const [key, value] of ycells.entries()) {
            const colonIdx1 = key.indexOf(':');
            const colonIdx2 = key.indexOf(':', colonIdx1 + 1);
            if (colonIdx1 === -1 || colonIdx2 === -1) continue;
            const sheetId = key.slice(0, colonIdx1);
            const r = parseInt(key.slice(colonIdx1 + 1, colonIdx2), 10);
            const c = parseInt(key.slice(colonIdx2 + 1), 10);
            if (!sheetCells.has(sheetId)) sheetCells.set(sheetId, new Map());
            sheetCells.get(sheetId).set(`${r}:${c}`, value);
        }

        const allSheetIds = new Set([...ymeta.keys(), ...sheetCells.keys()]);
        if (allSheetIds.size === 0) return null;

        const sheets = [];
        for (const sheetId of allSheetIds) {
            const meta = ymeta.get(sheetId) || {};
            const rows = meta.row || 100;
            const cols = meta.column || 26;

            const celldata = [];
            const cells = sheetCells.get(sheetId) || new Map();
            for (const [rc, value] of cells.entries()) {
                const colonIdx = rc.indexOf(':');
                const r = parseInt(rc.slice(0, colonIdx), 10);
                const c = parseInt(rc.slice(colonIdx + 1), 10);
                if (value !== null && value !== undefined) {
                    celldata.push({ r, c, v: value });
                }
            }

            sheets.push({
                id: sheetId,
                name: meta.name || sheetId,
                order: meta.order || 0,
                row: rows,
                column: cols,
                status: meta.status || 1,
                celldata,
                config: meta.config || {},
            });
        }

        sheets.sort((a, b) => (a.order || 0) - (b.order || 0));
        return convertCelldataToData(sheets);
    }, [convertCelldataToData]);

    // Initialize Yjs cell-level sync
    useEffect(() => {
        if (!ydoc) {
            console.log('[Sheet] No ydoc, skipping init');
            return;
        }

        console.log('[Sheet] Initializing with ydoc:', ydoc.clientID);

        const ycells = ydoc.getMap('sheet-cells');
        const ymeta = ydoc.getMap('sheet-meta');
        ycellsRef.current = ycells;
        ymetaRef.current = ymeta;

        // Clean up legacy Y.Array ops from older versions (no longer used)
        const yOps = ydoc.getArray('sheet-ops');
        if (yOps.length > 0) {
            ydoc.transact(() => { yOps.delete(0, yOps.length); }, SHEET_SYNC_ORIGIN);
            console.log('[Sheet] Cleaned up', yOps.length, 'stale ops from legacy Y.Array');
        }

        // One-time migration: convert legacy blob storage to cell-level Y.Map entries.
        // Runs only if sheet-cells is empty (new format) but sheet-data has blob (old format).
        const ylegacy = ydoc.getMap('sheet-data');
        const legacyBlob = ylegacy.get('sheets');
        if (legacyBlob && ycells.size === 0) {
            console.log('[Sheet] Migrating legacy blob to cell-level Y.Map');
            try {
                const legacySheets = JSON.parse(JSON.stringify(legacyBlob));
                ydoc.transact(() => {
                    for (const sheet of legacySheets) {
                        const sheetId = sheet.id || generateSheetId();
                        ymeta.set(sheetId, {
                            name: sheet.name || 'Sheet1',
                            order: sheet.order || 0,
                            status: sheet.status || 1,
                            row: sheet.row || 100,
                            column: sheet.column || 26,
                            config: sheet.config || {},
                        });
                        const cells = sheet.celldata || [];
                        for (const cell of cells) {
                            if (cell && cell.r != null && cell.c != null) {
                                ycells.set(`${sheetId}:${cell.r}:${cell.c}`, cell.v);
                            }
                        }
                    }
                }, SHEET_SYNC_ORIGIN);
                console.log('[Sheet] Legacy migration complete:', legacySheets.length, 'sheets migrated');
            } catch (e) {
                console.error('[Sheet] Legacy migration failed:', e);
            }
        }

        // Observer for remote cell/meta changes.
        // Skips writes tagged with SHEET_SYNC_ORIGIN (our own saves) to prevent echo.
        // With cell-level diffs there is no protection window needed — if FortuneSheet
        // fires onChange after setData(), saveToYjs computes a zero-length diff and exits.
        const handleRemoteChange = (event) => {
            if (event.transaction.origin === SHEET_SYNC_ORIGIN) return; // our own write, ignore
            console.log('[Sheet] Remote cell/meta change received from peer');
            const sheets = buildSheetsFromYMap(ycells, ymeta);
            if (sheets) {
                hasReceivedFirstData.current = true;
                onChangeCountRef.current = 0;
                setData(sheets);
                setIsInitialized(true);
                hasSyncedRef.current = true;
            }
        };

        ycells.observe(handleRemoteChange);
        ymeta.observe(handleRemoteChange);

        // Initial synchronous load from Y.Maps (populated if peers already shared data)
        const initialSheets = buildSheetsFromYMap(ycells, ymeta);
        if (initialSheets) {
            console.log('[Sheet] Loaded', initialSheets.length, 'sheets from Y.Maps on init');
            hasReceivedFirstData.current = true;
            onChangeCountRef.current = 0;
            setData(initialSheets);
            setIsInitialized(true);
            hasSyncedRef.current = true;
        }

        return () => {
            console.log('[Sheet] Cleanup - unobserving ycells/ymeta');
            ycells.unobserve(handleRemoteChange);
            ymeta.unobserve(handleRemoteChange);
        };
    }, [ydoc, buildSheetsFromYMap]);

    // Wait for provider sync before initializing with defaults
    useEffect(() => {
        if (!provider) return;

        const handleSync = (isSynced) => {
            if (isSynced && !hasSyncedRef.current) {
                hasSyncedRef.current = true;
                const ycells = ycellsRef.current;
                const ymeta = ymetaRef.current;
                if (!ycells || !ymeta) return;
                const sheets = buildSheetsFromYMap(ycells, ymeta);
                if (sheets) {
                    hasReceivedFirstData.current = true;
                    onChangeCountRef.current = 0;
                    setData(sheets);
                    setIsInitialized(true);
                } else {
                    // Provider synced but sheet is brand new — write default metadata
                    const defaultId = generateSheetId();
                    ydoc && ydoc.transact(() => {
                        ymeta.set(defaultId, {
                            name: DEFAULT_SHEET.name,
                            order: 0,
                            status: 1,
                            row: DEFAULT_SHEET.row,
                            column: DEFAULT_SHEET.column,
                            config: {},
                        });
                    }, SHEET_SYNC_ORIGIN);
                    const defaultSheets = [{ ...DEFAULT_SHEET, id: defaultId }];
                    setData(defaultSheets);
                    setIsInitialized(true);
                }
            }
        };

        if (provider.synced) {
            handleSync(true);
        }

        provider.on('sync', handleSync);

        // Fallback: initialize with defaults if provider never syncs (sidecar down, etc.)
        const fallbackTimeout = setTimeout(() => {
            if (!isInitialized && !hasSyncedRef.current) {
                console.log('[Sheet] Provider sync timeout, initializing with defaults');
                hasSyncedRef.current = true;
                const ycells = ycellsRef.current;
                const ymeta = ymetaRef.current;
                if (ycells && ymeta) {
                    const sheets = buildSheetsFromYMap(ycells, ymeta);
                    if (sheets) {
                        hasReceivedFirstData.current = true;
                        onChangeCountRef.current = 0;
                        setData(sheets);
                        setIsInitialized(true);
                        return;
                    }
                }
                // Truly no data — fall back to empty sheet
                const defaultSheets = [{ ...DEFAULT_SHEET, id: generateSheetId() }];
                setData(defaultSheets);
                setIsInitialized(true);
            }
        }, 3000);

        return () => {
            provider.off('sync', handleSync);
            clearTimeout(fallbackTimeout);
        };
    }, [provider, isInitialized, buildSheetsFromYMap, ydoc]);

    // Save to Yjs — cell-level CRDT diff.
    // Only writes cells that actually changed vs the current Y.Map state.
    // If FortuneSheet fires onChange after we applied remote data, the diff
    // will be empty (remote data is already in the Y.Map) → nothing is written.
    // This eliminates the echo-overwrite race condition entirely.
    const saveToYjs = useCallback((sheets) => {
        if (!ydoc) return;
        const ycells = ycellsRef.current;
        const ymeta = ymetaRef.current;
        if (!ycells || !ymeta) return;

        try {
            // Prefer getAllSheets() which always returns the live workbook state
            // (avoids the stale-closure problem where debounced `sheets` arg is old)
            const allSheets = workbookRef.current?.getAllSheets
                ? workbookRef.current.getAllSheets()
                : sheets;
            if (!allSheets || !Array.isArray(allSheets)) return;

            const converted = convertDataToCelldata(allSheets);

            const cellChanges = [];  // { key, value?, action: 'set'|'delete' }
            const metaChanges = [];
            const newCellKeys = new Set();

            for (const sheet of converted) {
                const sheetId = sheet.id || generateSheetId();

                // Sheet metadata
                const existingMeta = ymeta.get(sheetId);
                const newMeta = {
                    name: sheet.name || 'Sheet1',
                    order: sheet.order || 0,
                    status: sheet.status || 1,
                    row: sheet.row || 100,
                    column: sheet.column || 26,
                    config: sheet.config || {},
                };
                if (JSON.stringify(existingMeta) !== JSON.stringify(newMeta)) {
                    metaChanges.push({ key: sheetId, value: newMeta });
                }

                // Cell data
                for (const cell of (sheet.celldata || [])) {
                    const key = `${sheetId}:${cell.r}:${cell.c}`;
                    newCellKeys.add(key);
                    const existing = ycells.get(key);
                    if (JSON.stringify(existing) !== JSON.stringify(cell.v)) {
                        cellChanges.push({ key, value: cell.v, action: 'set' });
                    }
                }
            }

            // Find deleted cells (in Yjs but not in the new data)
            const sheetIds = converted.map(s => s.id || generateSheetId());
            for (const key of ycells.keys()) {
                const colonIdx = key.indexOf(':');
                const sheetId = colonIdx !== -1 ? key.slice(0, colonIdx) : key;
                if (sheetIds.includes(sheetId) && !newCellKeys.has(key)) {
                    cellChanges.push({ key, action: 'delete' });
                }
            }

            const totalChanges = cellChanges.length + metaChanges.length;
            if (totalChanges === 0) return; // Nothing changed — skip (prevents echo writes)

            const totalCells = converted[0]?.celldata?.length || 0;
            console.log('[Sheet] saveToYjs -', cellChanges.length, 'cell changes,', metaChanges.length, 'meta changes, total cells:', totalCells);

            ydoc.transact(() => {
                for (const m of metaChanges) ymeta.set(m.key, m.value);
                for (const c of cellChanges) {
                    if (c.action === 'set') ycells.set(c.key, c.value);
                    else ycells.delete(c.key);
                }
            }, SHEET_SYNC_ORIGIN);

            console.log('[Sheet] Saved sheet data to Yjs');
        } catch (e) {
            console.error('[Sheet] Failed to save to Yjs:', e);
        }
    }, [ydoc, convertDataToCelldata]);

    // Debounced version for onChange (which fires frequently)
    const debouncedSaveToYjs = useMemo(() => {
        // Cancel any pending call from the previous debounced function
        debouncedSaveRef.current?.cancel();
        const fn = debounce(saveToYjs, 300);
        debouncedSaveRef.current = fn;
        return fn;
    }, [saveToYjs]);

    // Cleanup: cancel pending debounced save and stats on unmount or when debounced fn changes
    useEffect(() => {
        return () => {
            debouncedSaveToYjs.cancel();
            debouncedReportStats.cancel();
        };
    }, [debouncedSaveToYjs, debouncedReportStats]);

    // Flush pending saves on unmount — write any unsaved cells to Yjs
    useEffect(() => {
        const capturedYdoc = ydoc;
        const capturedYcells = ydoc ? ydoc.getMap('sheet-cells') : null;
        const capturedYmeta = ydoc ? ydoc.getMap('sheet-meta') : null;
        return () => {
            console.log('[Sheet] Unmounting - saving current state');
            // Guard: only save if the refs still point to the same maps we set up with.
            // If the document switched, ycellsRef points to the new doc's map and we
            // must NOT write stale data into it.
            if (ycellsRef.current !== capturedYcells) {
                console.warn('[Sheet] Unmount save skipped - ydoc has changed since setup');
                debouncedSaveRef.current?.cancel();
                return;
            }
            debouncedSaveRef.current?.cancel();
            if (!capturedYcells || !capturedYmeta || !capturedYdoc) return;

            try {
                const finalData = workbookRef.current?.getAllSheets
                    ? workbookRef.current.getAllSheets()
                    : dataRef.current;
                if (!finalData) return;

                const converted = convertDataToCelldata(finalData);
                const newCellKeys = new Set();

                capturedYdoc.transact(() => {
                    for (const sheet of converted) {
                        const sheetId = sheet.id || generateSheetId();
                        capturedYmeta.set(sheetId, {
                            name: sheet.name || 'Sheet1',
                            order: sheet.order || 0,
                            status: sheet.status || 1,
                            row: sheet.row || 100,
                            column: sheet.column || 26,
                            config: sheet.config || {},
                        });
                        for (const cell of (sheet.celldata || [])) {
                            const key = `${sheetId}:${cell.r}:${cell.c}`;
                            newCellKeys.add(key);
                            capturedYcells.set(key, cell.v);
                        }
                    }
                    // Delete cells no longer present
                    const sheetIds = converted.map(s => s.id || generateSheetId());
                    for (const key of capturedYcells.keys()) {
                        const colonIdx = key.indexOf(':');
                        const sheetId = colonIdx !== -1 ? key.slice(0, colonIdx) : key;
                        if (sheetIds.includes(sheetId) && !newCellKeys.has(key)) {
                            capturedYcells.delete(key);
                        }
                    }
                }, SHEET_SYNC_ORIGIN);
                console.log('[Sheet] Final state saved to Yjs on unmount');
            } catch (e) {
                console.error('[Sheet] Failed to save final state on unmount:', e);
            }
        };
    }, [ydoc, convertDataToCelldata]);

    // Handle sheet data changes from FortuneSheet.
    // With cell-level diff saves, there is no longer any need for a
    // 'remote update protection window' — if FortuneSheet fires onChange
    // after we applied remote data via setData, saveToYjs computes a zero-
    // length diff (remote data already in Y.Map) and returns immediately.
    const handleChange = useCallback((newData) => {
        // Guard against null/undefined data from Fortune Sheet
        if (!newData || !Array.isArray(newData)) {
            console.warn('[Sheet] handleChange received invalid data, ignoring:', newData);
            return;
        }

        // Increment onChange counter
        onChangeCountRef.current++;

        if (newData?.[0]) {
            console.log('[Sheet] handleChange #' + onChangeCountRef.current + ' - sheets:', newData.length);

            // Skip the FIRST onChange after receiving data from Yjs.
            // FortuneSheet fires onChange when it first renders with existing data;
            // the diff-based saveToYjs would also return 0 here, but skipping
            // avoids the unnecessary getAllSheets() call and log noise.
            if (onChangeCountRef.current === 1 && hasReceivedFirstData.current) {
                console.log('[Sheet] Skipping first onChange after data load (Fortune Sheet init event)');
                setData(newData);
                return;
            }

            // Report stats via debounced calculator (avoids O(cells) on every keystroke)
            debouncedReportStats(newData);
        }

        setData(newData);
        // Diff-based save: writes only changed cells; returns early if nothing changed.
        debouncedSaveToYjs(newData);
    }, [debouncedSaveToYjs, debouncedReportStats]);

    // Handle selection change - send to awareness for other users to see and show toolbar
    const handleSelectionChange = useCallback((sheetId, selection) => {
        console.log('[Sheet] Selection changed:', sheetId, selection);
        
        // Update current sheet ID for presence
        if (sheetId !== currentSheetId) {
            setCurrentSheetId(sheetId);
        }
        
        // Fortune Sheet selection format may be:
        // - { row: [start, end], column: [start, end] } (range)
        // - { row_focus: number, column_focus: number } (single cell)
        // - Array of selections for multi-select
        
        let row, column;
        if (Array.isArray(selection) && selection.length > 0) {
            // Multi-select: use first selection
            const sel = selection[0];
            const r = sel.row ?? (sel.row_focus != null ? [sel.row_focus, sel.row_focus] : null);
            const c = sel.column ?? (sel.column_focus != null ? [sel.column_focus, sel.column_focus] : null);
            row = r && [r[0] ?? 0, r[1] ?? r[0] ?? 0];
            column = c && [c[0] ?? 0, c[1] ?? c[0] ?? 0];
        } else if (selection) {
            const r = selection.row ?? (selection.row_focus != null ? [selection.row_focus, selection.row_focus] : null);
            const c = selection.column ?? (selection.column_focus != null ? [selection.column_focus, selection.column_focus] : null);
            row = r && [r[0] ?? 0, r[1] ?? r[0] ?? 0];
            column = c && [c[0] ?? 0, c[1] ?? c[0] ?? 0];
        }
        
        if (row && column && row[0] != null && column[0] != null) {
            // Update selection state for toolbar
            setCurrentSelection({
                sheetId,
                row,
                column,
            });
            
            // Calculate toolbar position based on container and selection
            // Position below the selected cell(s)
            if (containerRef.current) {
                const container = containerRef.current;
                const rect = container.getBoundingClientRect();
                
                // Use actual cell dimensions from workbook API when available
                const wb = workbookRef.current;
                let colOffset = 0;
                let rowOffset = 0;
                let cellWidth = 100;
                let cellHeight = 25;
                const rowHeaderW = 46;
                
                try {
                    if (wb?.getColumnWidth) {
                        const colsNeeded = Array.from({ length: column[0] + 1 }, (_, i) => i);
                        const widths = wb.getColumnWidth(colsNeeded) || {};
                        for (let i = 0; i < column[0]; i++) colOffset += widths[i] ?? 100;
                        cellWidth = widths[column[0]] ?? 100;
                    } else {
                        colOffset = column[0] * 100;
                    }
                    if (wb?.getRowHeight) {
                        const rowsNeeded = Array.from({ length: row[0] + 2 }, (_, i) => i);
                        const heights = wb.getRowHeight(rowsNeeded) || {};
                        for (let i = 0; i <= row[0]; i++) rowOffset += heights[i] ?? 25;
                        cellHeight = heights[row[0]] ?? 25;
                    } else {
                        rowOffset = (row[0] + 1) * 25;
                    }
                } catch (e) {
                    // Fallback to defaults
                    colOffset = column[0] * 100;
                    rowOffset = (row[0] + 1) * 25;
                }
                
                // Read scroll offset
                let scrollLeft = 0;
                let scrollTop = 0;
                const scrollXEl = container.querySelector('.luckysheet-scrollbar-x');
                const scrollYEl = container.querySelector('.luckysheet-scrollbar-y');
                if (scrollXEl) scrollLeft = scrollXEl.scrollLeft || 0;
                if (scrollYEl) scrollTop = scrollYEl.scrollTop || 0;
                
                // Measure header height from DOM
                let headerHeight = 30;
                const cellArea = container.querySelector('.fortune-cell-area');
                if (cellArea) {
                    const cellAreaRect = cellArea.getBoundingClientRect();
                    headerHeight = cellAreaRect.top - rect.top;
                }
                
                const x = rect.left + rowHeaderW + colOffset + (cellWidth / 2) - scrollLeft;
                const y = rect.top + headerHeight + rowOffset - scrollTop;
                
                setToolbarPosition({ x, y });
            }
            
            // Update awareness for other users
            if (provider?.awareness) {
                provider.awareness.setLocalStateField('selection', {
                    sheetId,
                    row,      // [start, end]
                    column,   // [start, end]
                });
            }
        } else {
            // Clear selection
            setCurrentSelection(null);
            setToolbarPosition(null);
        }
    }, [provider, currentSheetId]);

    // Hooks for Fortune Sheet events
    const hooks = useMemo(() => ({
        afterSelectionChange: handleSelectionChange,
    }), [handleSelectionChange]);

    // Sheet settings
    const settings = useMemo(() => ({
        // Show toolbar and formula bar (hide for readonly)
        showToolbar: !readOnly,
        showFormulaBar: !readOnly,
        showSheetTabs: true,
        
        // Enable features based on permissions
        enableAddRow: !readOnly,
        enableAddBackTop: !readOnly,
        allowEdit: !readOnly,
        
        // Row and column defaults
        defaultRowHeight: 25,
        defaultColWidth: 100,
        
        // Default font settings
        defaultFontSize: 11,
        
        // Collaboration indicator
        userInfo: userHandle ? {
            name: userHandle,
            color: userColor || '#3b82f6',
        } : undefined,

        // Language - set to English
        lang: 'en',
        
        // Toolbar customization - Fortune Sheet v1.0.3
        // Full feature set for spreadsheet editing
        toolbarItems: [
            'undo', 'redo', 'format-painter', 'clear-format', '|',
            'currency-format', 'percentage-format', 'number-decrease', 'number-increase', 'format', '|',
            'font', '|',
            'font-size', '|',
            'bold', 'italic', 'strike-through', 'underline', '|',
            'font-color', 'background', 'border', 'merge-cell', '|',
            'horizontal-align', 'vertical-align', 'text-wrap', 'text-rotation', '|',
            'freeze', 'sort', 'filter', 'conditionFormat', '|',
            'link', 'image', '|',
            'dataVerification', 'splitColumn', '|',
            'quick-formula', 'screenshot', 'search'
            // Note: 'comment' excluded - we use our own comment system
        ],
        
        // Context menu customization - full feature set
        cellContextMenu: [
            'copy', 'paste', '|',
            'insert-row', 'insert-column', 'delete-row', 'delete-column', 'delete-cell', '|',
            'hide-row', 'hide-column', 'set-row-height', 'set-column-width', '|',
            'clear', 'sort', 'orderAZ', 'orderZA', 'filter', '|',
            'image', 'link', 'data', 'cell-format'
        ],
    }), [userHandle, userColor, readOnly]);

    // Handle add comment from toolbar
    const handleToolbarAddComment = useCallback((commentData) => {
        if (onAddComment) {
            onAddComment(commentData);
        }
        // Clear selection after adding comment
        setCurrentSelection(null);
        setToolbarPosition(null);
    }, [onAddComment]);

    // Loading state
    if (!isInitialized || !data) {
        return (
            <div className="sheet-loading">
                <div className="sheet-loading__spinner"></div>
                <p>Loading spreadsheet...</p>
            </div>
        );
    }

    return (
        <div 
            ref={containerRef}
            className={`sheet-container ${readOnly ? 'sheet-container--readonly' : ''}`}
            data-testid="sheet-container"
        >
            {readOnly && (
                <div className="sheet-readonly-banner" data-testid="sheet-readonly-banner">
                    <span>📖</span> View Only
                </div>
            )}
            
            {/* Selection Toolbar */}
            {currentSelection && toolbarPosition && (
                <SheetSelectionToolbar
                    selection={currentSelection}
                    position={toolbarPosition}
                    workbookRef={workbookRef}
                    onAddComment={handleToolbarAddComment}
                    readOnly={readOnly}
                    containerRef={containerRef}
                />
            )}
            
            <div className="sheet-workbook-wrapper" style={{ position: 'relative' }}>
                <Workbook
                    ref={workbookRef}
                    data={data}
                    onChange={readOnly ? undefined : handleChange}
                    hooks={hooks}
                    {...settings}
                />
                {/* Custom presence overlays - uses actual cell dimensions from Fortune Sheet API */}
                {presenceOverlays.filter(p => p.visible !== false).map((p) => (
                    <React.Fragment key={p.clientId}>
                        {/* Cell border showing selection */}
                        <div
                            className="sheet-presence-border"
                            style={{
                                position: 'absolute',
                                left: p.cellX,
                                top: p.cellY,
                                width: p.cellWidth,
                                height: p.cellHeight,
                                border: `2px solid ${p.color}`,
                                pointerEvents: 'none',
                                boxSizing: 'border-box',
                            }}
                        />
                        {/* Presence dot in upper-right corner */}
                        <div
                            className="sheet-presence-dot"
                            style={{
                                position: 'absolute',
                                left: p.dotX,
                                top: p.dotY,
                                backgroundColor: p.color,
                            }}
                            title={p.name}
                        >
                            <span className="sheet-presence-name">{p.name}</span>
                        </div>
                    </React.Fragment>
                ))}
            </div>
        </div>
    );
}

// Export for use in type detection
export const SHEET_TYPE = 'sheet';
export const SHEET_ICON = '📊';
