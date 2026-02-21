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

// Generate unique ID for sheets
const generateSheetId = () => 'sheet-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);

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
    const ysheetRef = useRef(null);
    const isApplyingRemoteOps = useRef(false);
    const hasSyncedRef = useRef(false);
    const debouncedSaveRef = useRef(null);
    const lastSavedVersion = useRef(null);      // Version we last saved - to detect our own echoes
    const lastLoadedVersion = useRef(null);     // Version we last loaded from Yjs - to avoid redundant loads
    const hasReceivedFirstData = useRef(false); // Track if we've received initial data from Yjs
    const onChangeCountRef = useRef(0);         // Count onChange calls to skip the first one after mount
    const isReceivingRemoteUpdate = useRef(false); // Track when we're applying a remote update (to skip saving)
    const pendingRemoteUpdateTimeout = useRef(null); // Timeout to clear the remote update flag
    const dirtyDuringProtection = useRef(false); // True if local edits happened during the remote update protection window
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
            
            const cellTop = cumulativeRowY[r] ?? (r * defaultRowH);
            const cellLeft = cumulativeColX[c] ?? (c * defaultColW);
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

    // Initialize Yjs map for sheet data
    useEffect(() => {
        if (!ydoc) {
            console.log('[Sheet] No ydoc, skipping init');
            return;
        }

        console.log('[Sheet] Initializing with ydoc:', ydoc.clientID);
        const ysheet = ydoc.getMap('sheet-data');
        ysheetRef.current = ysheet;

        // Use Y.Array for ops — CRDT-safe append/delete replaces the old
        // Y.Map.set('pendingOps', [...]) which was last-writer-wins.
        const yOps = ydoc.getArray('sheet-ops');

        // Clean up legacy pendingOps key from old Y.Map-based approach
        if (ysheet.has('pendingOps')) {
            ydoc.transact(() => { ysheet.delete('pendingOps'); });
            console.log('[Sheet] Cleaned up legacy pendingOps key from Y.Map');
        }

        // Track whether ops were successfully applied this cycle
        let opsAppliedThisCycle = false;

        // Observe Y.Array for real-time op-based sync
        const handleOpsChange = (event) => {
            if (isApplyingRemoteOps.current) return;
            // Collect all newly inserted items from the Y.Array event
            const newItems = [];
            if (event.changes && event.changes.added) {
                event.changes.added.forEach(item => {
                    let content = item.content;
                    if (content && content.getContent) {
                        newItems.push(...content.getContent());
                    }
                });
            }
            if (newItems.length === 0) return;
            // Filter to only remote ops
            const remoteOps = newItems.filter(op => op && op.clientId !== ydoc.clientID);
            if (remoteOps.length > 0 && workbookRef.current) {
                isApplyingRemoteOps.current = true;
                try {
                    const opsToApply = remoteOps.flatMap(entry => entry.ops || (Array.isArray(entry) ? entry : [entry]));
                    workbookRef.current.applyOp(opsToApply);
                    opsAppliedThisCycle = true;
                    console.log('[Sheet] Applied', opsToApply.length, 'remote ops via Y.Array');
                } catch (e) {
                    console.error('[Sheet] Failed to apply remote ops:', e);
                } finally {
                    isApplyingRemoteOps.current = false;
                }
            }
            // Clean up processed ops in a transaction to avoid growing unboundedly
            if (yOps.length > 0) {
                ydoc.transact(() => {
                    yOps.delete(0, yOps.length);
                });
            }
        };
        yOps.observe(handleOpsChange);

        // Handler for remote changes (full-sheet data path)
        const updateFromYjs = () => {
            // Don't update if we're applying local changes
            if (isApplyingRemoteOps.current) {
                console.log('[Sheet] updateFromYjs skipped - applying remote ops');
                return;
            }

            const storedData = ysheet.get('sheets');
            const storedVersion = ysheet.get('version') || null;

            // If ops were already applied this cycle via Y.Array observer,
            // skip the full-sheet setData to avoid double-applying and flicker.
            if (opsAppliedThisCycle) {
                opsAppliedThisCycle = false;
                // Still update version tracking
                if (storedVersion) {
                    lastLoadedVersion.current = storedVersion;
                }
                console.log('[Sheet] Skipping full-sheet setData - ops already applied via Y.Array');
                return;
            }
            
            console.log('[Sheet] updateFromYjs - version:', storedVersion, 'lastSaved:', lastSavedVersion.current, 'lastLoaded:', lastLoadedVersion.current, 'sheetCount:', storedData?.length);
            
            // Skip if this is our own save echoing back
            if (storedVersion === lastSavedVersion.current && lastSavedVersion.current !== null) {
                console.log('[Sheet] updateFromYjs skipped - our own save (version match)');
                return;
            }
            
            // Skip if we've already loaded this version (avoid redundant loads from observe + observeDeep)
            if (storedVersion === lastLoadedVersion.current && lastLoadedVersion.current !== null) {
                console.log('[Sheet] updateFromYjs skipped - already loaded this version');
                return;
            }

            if (storedData) {
                try {
                    let sheets = JSON.parse(JSON.stringify(storedData));
                    
                    // Convert celldata → 2D data array for sheets missing it.
                    // Remote data arrives as celldata-only from Yjs, but Fortune
                    // Sheet needs the 2D data array after initial initialization.
                    sheets = convertCelldataToData(sheets);
                    
                    // Fortune Sheet uses 'data' (2D array) after initialization, not 'celldata'
                    const cellCount = sheets[0]?.celldata?.length || 0;
                    const dataRows = sheets[0]?.data?.length || 0;
                    const nonEmptyCells = sheets[0]?.data?.flat().filter(c => c !== null && c !== undefined).length || 0;
                    console.log('[Sheet] Loaded', sheets.length, 'sheets from Yjs, celldata:', cellCount, 'data rows:', dataRows, 'non-empty cells:', nonEmptyCells);
                    
                    // Check if this is a genuinely new remote update (not initial load or our save)
                    const isNewRemoteUpdate = lastLoadedVersion.current !== null && storedVersion !== lastLoadedVersion.current;
                    
                    // Mark that we've received data - used to determine when to start saving
                    if (!hasReceivedFirstData.current) {
                        hasReceivedFirstData.current = true;
                        // Reset onChange counter - we'll skip the first onChange after receiving data
                        onChangeCountRef.current = 0;
                        console.log('[Sheet] First data received from Yjs, will skip first onChange');
                    }
                    
                    // Only set protection flag for NEW remote updates (not initial load)
                    // This prevents Fortune Sheet's onChange from overwriting remote data
                    if (isNewRemoteUpdate) {
                        console.log('[Sheet] New remote update detected, enabling protection');
                        isReceivingRemoteUpdate.current = true;
                        dirtyDuringProtection.current = false;
                        
                        // Cancel pending debounced saves during protection window
                        if (debouncedSaveRef.current) {
                            debouncedSaveRef.current.cancel();
                        }
                        
                        // Clear any pending timeout
                        if (pendingRemoteUpdateTimeout.current) {
                            clearTimeout(pendingRemoteUpdateTimeout.current);
                        }
                        
                        // Clear the flag after a delay that exceeds the debounce delay (300ms)
                        // Then save the LIVE workbook state if any local edits happened during the window
                        pendingRemoteUpdateTimeout.current = setTimeout(() => {
                            isReceivingRemoteUpdate.current = false;
                            console.log('[Sheet] Remote update window closed, saves enabled');
                            // If any local edits happened during the protection window,
                            // capture the latest live state from the workbook (not a stale snapshot)
                            if (dirtyDuringProtection.current) {
                                console.log('[Sheet] Saving dirty state after protection window');
                                dirtyDuringProtection.current = false;
                                // Use debouncedSaveRef (ref-stable) to avoid stale closure over saveToYjs
                                const liveData = workbookRef.current?.getAllSheets?.() || dataRef.current;
                                if (liveData && debouncedSaveRef.current) {
                                    debouncedSaveRef.current(liveData);
                                }
                            }
                        }, 350);
                    }
                    
                    // Update lastLoadedVersion BEFORE setData
                    lastLoadedVersion.current = storedVersion;
                    
                    setData(sheets);
                    setIsInitialized(true);
                    hasSyncedRef.current = true;
                } catch (e) {
                    console.error('[Sheet] Failed to parse Yjs data:', e);
                }
            } else if (hasSyncedRef.current) {
                // Only initialize with default if we've synced and there's truly no data
                const defaultSheets = [{ ...DEFAULT_SHEET, id: generateSheetId() }];
                ydoc.transact(() => {
                    ysheet.set('sheets', defaultSheets);
                });
                setData(defaultSheets);
                setIsInitialized(true);
            }
        };

        ysheet.observeDeep(updateFromYjs);
        updateFromYjs();

        return () => {
            console.log('[Sheet] Cleanup - unobserving ysheet and yOps');
            ysheet.unobserveDeep(updateFromYjs);
            yOps.unobserve(handleOpsChange);
            // Clear any pending timeout
            if (pendingRemoteUpdateTimeout.current) {
                clearTimeout(pendingRemoteUpdateTimeout.current);
            }
        };
    }, [ydoc]);

    // Wait for provider sync before initializing with defaults
    useEffect(() => {
        if (!provider) return;

        const handleSync = (isSynced) => {
            if (isSynced && !hasSyncedRef.current) {
                hasSyncedRef.current = true;
                // Check if we need to initialize with defaults after sync
                if (ysheetRef.current && !ysheetRef.current.get('sheets')) {
                    const defaultSheets = [{ ...DEFAULT_SHEET, id: generateSheetId() }];
                    ydoc.transact(() => {
                        ysheetRef.current.set('sheets', defaultSheets);
                    });
                    setData(defaultSheets);
                    setIsInitialized(true);
                }
            }
        };

        // Check if already synced
        if (provider.synced) {
            handleSync(true);
        }

        provider.on('sync', handleSync);
        
        // Fallback: Initialize with defaults after timeout if provider never syncs
        // This handles the case when sidecar is down or connection fails
        const fallbackTimeout = setTimeout(() => {
            if (!isInitialized && !hasSyncedRef.current) {
                console.log('[Sheet] Provider sync timeout, initializing with defaults');
                hasSyncedRef.current = true;
                if (ysheetRef.current && !ysheetRef.current.get('sheets')) {
                    const defaultSheets = [{ ...DEFAULT_SHEET, id: generateSheetId() }];
                    ydoc.transact(() => {
                        ysheetRef.current.set('sheets', defaultSheets);
                    });
                    setData(defaultSheets);
                    setIsInitialized(true);
                } else if (!dataRef.current) {
                    // Even if ysheetRef is not ready, initialize local state
                    const defaultSheets = [{ ...DEFAULT_SHEET, id: generateSheetId() }];
                    setData(defaultSheets);
                    setIsInitialized(true);
                }
            }
        }, 3000); // 3 second fallback
        
        return () => {
            provider.off('sync', handleSync);
            clearTimeout(fallbackTimeout);
        };
    }, [provider, isInitialized]);

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

    // Save to Yjs - debounced for full sheet data, immediate for ops
    const saveToYjs = useCallback((sheets) => {
        if (!ysheetRef.current || !ydoc) return;
        
        try {
            // Use getAllSheets() to get the complete data if workbook ref is available
            let dataToSave = sheets;
            if (workbookRef.current?.getAllSheets) {
                dataToSave = workbookRef.current.getAllSheets();
                console.log('[Sheet] Using getAllSheets() for complete data');
            }
            
            // Convert data (2D array) to celldata (sparse array) for proper persistence
            const convertedData = convertDataToCelldata(dataToSave);
            
            // Debug: log what we're saving
            const cellCount = convertedData?.[0]?.celldata?.length || 0;
            
            // Use composite version to avoid collisions between peers
            // TODO: Migrate to cell-level CRDT (Yjs Y.Map per cell) to eliminate
            // the JSON-blob full-sheet replacement strategy. This would give true
            // conflict-free merging at the cell granularity and remove the need
            // for the remote-update protection window entirely.
            const newVersion = `${ydoc.clientID}-${Date.now()}`;
            lastSavedVersion.current = newVersion;
            
            console.log('[Sheet] saveToYjs - saving', cellCount, 'cells, version:', newVersion);
            
            // Store the full sheet data in a transaction
            ydoc.transact(() => {
                ysheetRef.current.set('sheets', JSON.parse(JSON.stringify(convertedData)));
                ysheetRef.current.set('version', newVersion);
            });
            
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

    // Flush pending saves on unmount and force save current state
    useEffect(() => {
        // Capture the ydoc and ysheet at setup time so cleanup can verify they still match
        const capturedYdoc = ydoc;
        const capturedYsheet = ydoc ? ydoc.getMap('sheet-data') : null;
        return () => {
            console.log('[Sheet] Unmounting - saving current state');
            // Guard: only save if the current ysheetRef still points to the same
            // Yjs map we set up with. If the document switched, ysheetRef will
            // point to the new doc's map, and we must NOT write stale data into it.
            if (ysheetRef.current !== capturedYsheet) {
                console.warn('[Sheet] Unmount save skipped - ydoc has changed since setup');
                debouncedSaveRef.current?.cancel();
                return;
            }
            // Try to save using workbook ref first (most accurate)
            if (workbookRef.current?.getAllSheets && capturedYsheet && capturedYdoc) {
                try {
                    const finalData = workbookRef.current.getAllSheets();
                    // Convert data to celldata for persistence
                    const convertedData = finalData.map(sheet => {
                        const newSheet = { ...sheet };
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
                            delete newSheet.data;
                            console.log('[Sheet] Unmount - converted', celldata.length, 'cells');
                        }
                        return newSheet;
                    });
                    console.log('[Sheet] Final save on unmount, sheets:', convertedData?.length);
                    capturedYdoc.transact(() => {
                        capturedYsheet.set('sheets', JSON.parse(JSON.stringify(convertedData)));
                        capturedYsheet.set('version', `${capturedYdoc.clientID}-${Date.now()}`);
                    });
                    console.log('[Sheet] Final state saved to Yjs');
                } catch (e) {
                    console.error('[Sheet] Failed to save final state:', e);
                }
            } else if (dataRef.current && capturedYsheet && capturedYdoc) {
                // Fallback: workbook ref unavailable, save from latest data ref
                try {
                    const fallbackData = dataRef.current.map(sheet => {
                        const newSheet = { ...sheet };
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
                            delete newSheet.data;
                        }
                        return newSheet;
                    });
                    console.log('[Sheet] Unmount fallback save from dataRef, sheets:', fallbackData?.length);
                    capturedYdoc.transact(() => {
                        capturedYsheet.set('sheets', JSON.parse(JSON.stringify(fallbackData)));
                        capturedYsheet.set('version', `${capturedYdoc.clientID}-${Date.now()}`);
                    });
                } catch (e) {
                    console.error('[Sheet] Failed fallback save from dataRef:', e);
                }
            }
            // Cancel any pending debounced saves to prevent overwriting the fresh unmount save
            debouncedSaveRef.current?.cancel();
        };
    }, [ydoc]);

    // Handle sheet data changes
    const handleChange = useCallback((newData) => {
        // Guard against null/undefined data from Fortune Sheet
        if (!newData || !Array.isArray(newData)) {
            console.warn('[Sheet] handleChange received invalid data, ignoring:', newData);
            return;
        }
        
        // Increment onChange counter
        onChangeCountRef.current++;
        
        // Debug: check if data has the expected structure
        if (newData?.[0]) {
            console.log('[Sheet] handleChange #' + onChangeCountRef.current + ' - sheets:', newData.length);
            
            // Skip the FIRST onChange after receiving data from Yjs
            // Fortune Sheet fires onChange with empty/stale data when it first renders with existing data
            if (onChangeCountRef.current === 1 && hasReceivedFirstData.current) {
                console.log('[Sheet] Skipping first onChange after data load (Fortune Sheet init event)');
                setData(newData);
                return;
            }
            
            // Report stats via debounced calculator (avoids O(cells) on every keystroke)
            debouncedReportStats(newData);
            
            // During the remote update protection window, mark dirty so the
            // latest live workbook state is saved when the window closes.
            // This replaces the old stale-snapshot queue approach.
            if (isReceivingRemoteUpdate.current) {
                console.log('[Sheet] Marking dirty during protection window (will save live state when window closes)');
                dirtyDuringProtection.current = true;
                setData(newData);
                return;
            }
        }
        setData(newData);
        // Save via debounced function for full data sync
        debouncedSaveToYjs(newData);
    }, [debouncedSaveToYjs, debouncedReportStats]);

    // Handle operations for real-time sync (immediate, not debounced)
    // Uses Y.Array ('sheet-ops') for CRDT-safe append — concurrent pushes
    // from different clients are all preserved (unlike Y.Map.set which was
    // last-writer-wins and silently lost ops).
    const handleOp = useCallback((ops) => {
        // Don't sync our own application of remote ops
        if (isApplyingRemoteOps.current) return;
        if (!ydoc) return;

        try {
            const yOps = ydoc.getArray('sheet-ops');
            ydoc.transact(() => {
                yOps.push([{ ops, clientId: ydoc.clientID }]);
            });
        } catch (e) {
            console.error('[Sheet] Failed to send ops to Yjs:', e);
        }
    }, [ydoc]);

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
                    onOp={readOnly ? undefined : handleOp}
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
