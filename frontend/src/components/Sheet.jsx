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
    id: 'sheet-' + Date.now().toString(36),
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
    const lastSavedVersion = useRef(0);         // Version we last saved - to detect our own echoes
    const lastLoadedVersion = useRef(0);        // Version we last loaded from Yjs - to avoid redundant loads
    const hasReceivedFirstData = useRef(false); // Track if we've received initial data from Yjs
    const onChangeCountRef = useRef(0);         // Count onChange calls to skip the first one after mount
    const isReceivingRemoteUpdate = useRef(false); // Track when we're applying a remote update (to skip saving)
    const pendingRemoteUpdateTimeout = useRef(null); // Timeout to clear the remote update flag
    
    // Custom presence overlays (Fortune Sheet's API is unreliable)
    const [presenceOverlays, setPresenceOverlays] = useState([]);

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
            const seenNames = new Set(); // Deduplicate by name
            
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
                
                // Skip duplicate names (keep first seen, which will be most recent due to Map ordering)
                const userName = state.user.name || 'Anonymous';
                if (seenNames.has(userName)) return;
                seenNames.add(userName);
                
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
            
            // Build custom presence overlay positions
            // Fortune Sheet's presence API is unreliable, so we render our own
            const defaultColWidth = 100;
            const defaultRowHeight = 25;
            // Formula bar + toolbar height - these are fixed in Fortune Sheet
            // Toolbar: ~40px, Formula bar: ~28px, Column headers: ~25px
            const toolbarHeight = 40;
            const formulaBarHeight = 28;
            const columnHeaderHeight = 25;
            const topOffset = toolbarHeight + formulaBarHeight + columnHeaderHeight;
            const rowHeaderWidth = 46;
            
            const overlays = presences.map(p => ({
                clientId: p.userId,
                name: p.username,
                color: p.color,
                // Cell position for border
                cellX: rowHeaderWidth + (p.selection.c * defaultColWidth),
                cellY: topOffset + (p.selection.r * defaultRowHeight),
                cellWidth: defaultColWidth,
                cellHeight: defaultRowHeight,
                // Dot position: upper-right corner of the cell (inside the cell, offset from corner)
                dotX: rowHeaderWidth + ((p.selection.c + 1) * defaultColWidth) - 12,
                dotY: topOffset + (p.selection.r * defaultRowHeight) + 2,
                row: p.selection.r,
                col: p.selection.c,
            }));
            setPresenceOverlays(overlays);
            
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
    }, [provider, userHandle, userColor]);

    // Initialize Yjs map for sheet data
    useEffect(() => {
        if (!ydoc) {
            console.log('[Sheet] No ydoc, skipping init');
            return;
        }

        console.log('[Sheet] Initializing with ydoc:', ydoc.clientID);
        const ysheet = ydoc.getMap('sheet-data');
        ysheetRef.current = ysheet;

        // Handler for remote changes
        const updateFromYjs = () => {
            // Don't update if we're applying local changes
            if (isApplyingRemoteOps.current) {
                console.log('[Sheet] updateFromYjs skipped - applying remote ops');
                return;
            }

            const storedData = ysheet.get('sheets');
            const storedOps = ysheet.get('pendingOps');
            const storedVersion = ysheet.get('version') || 0;
            
            console.log('[Sheet] updateFromYjs - version:', storedVersion, 'lastSaved:', lastSavedVersion.current, 'lastLoaded:', lastLoadedVersion.current, 'sheetCount:', storedData?.length);
            
            // Skip if this is our own save echoing back
            if (storedVersion === lastSavedVersion.current && lastSavedVersion.current > 0) {
                console.log('[Sheet] updateFromYjs skipped - our own save (version match)');
                return;
            }
            
            // Skip if we've already loaded this version (avoid redundant loads from observe + observeDeep)
            if (storedVersion === lastLoadedVersion.current && lastLoadedVersion.current > 0) {
                console.log('[Sheet] updateFromYjs skipped - already loaded this version');
                return;
            }

            if (storedData) {
                try {
                    const sheets = JSON.parse(JSON.stringify(storedData));
                    // Fortune Sheet uses 'data' (2D array) after initialization, not 'celldata'
                    const cellCount = sheets[0]?.celldata?.length || 0;
                    const dataRows = sheets[0]?.data?.length || 0;
                    const nonEmptyCells = sheets[0]?.data?.flat().filter(c => c !== null && c !== undefined).length || 0;
                    console.log('[Sheet] Loaded', sheets.length, 'sheets from Yjs, celldata:', cellCount, 'data rows:', dataRows, 'non-empty cells:', nonEmptyCells);
                    
                    // Check if this is a genuinely new remote update (not initial load or our save)
                    const isNewRemoteUpdate = lastLoadedVersion.current > 0 && storedVersion !== lastLoadedVersion.current;
                    
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
                        
                        // Clear any pending timeout
                        if (pendingRemoteUpdateTimeout.current) {
                            clearTimeout(pendingRemoteUpdateTimeout.current);
                        }
                        
                        // Clear the flag after a delay that exceeds the debounce delay (300ms)
                        // This ensures we don't overwrite remote changes with pending local debounced saves
                        pendingRemoteUpdateTimeout.current = setTimeout(() => {
                            isReceivingRemoteUpdate.current = false;
                            console.log('[Sheet] Remote update window closed, saves enabled');
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
                ysheet.set('sheets', defaultSheets);
                ysheet.set('pendingOps', []);
                setData(defaultSheets);
                setIsInitialized(true);
            }

            // Apply any pending operations from other peers
            if (storedOps && Array.isArray(storedOps) && storedOps.length > 0) {
                isApplyingRemoteOps.current = true;
                try {
                    workbookRef.current?.applyOp(storedOps);
                } catch (e) {
                    console.error('[Sheet] Failed to apply remote ops:', e);
                } finally {
                    isApplyingRemoteOps.current = false;
                    // Clear applied ops
                    ysheet.set('pendingOps', []);
                }
            }
        };

        ysheet.observe(updateFromYjs);
        // Also observe deep changes in case values are nested Yjs types
        ysheet.observeDeep(updateFromYjs);
        updateFromYjs();

        return () => {
            console.log('[Sheet] Cleanup - unobserving ysheet');
            ysheet.unobserve(updateFromYjs);
            ysheet.unobserveDeep(updateFromYjs);
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
                    ysheetRef.current.set('sheets', defaultSheets);
                    ysheetRef.current.set('pendingOps', []);
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
                    ysheetRef.current.set('sheets', defaultSheets);
                    ysheetRef.current.set('pendingOps', []);
                    setData(defaultSheets);
                    setIsInitialized(true);
                } else if (!data) {
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
    }, [provider, isInitialized, data]);

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
                // Keep data for initialization but ensure celldata is primary
                console.log('[Sheet] Converted data to celldata:', celldata.length, 'cells');
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
            
            // Use version number to track our saves and distinguish from remote updates
            const newVersion = Date.now();
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
        const fn = debounce(saveToYjs, 300);
        debouncedSaveRef.current = fn;
        return fn;
    }, [saveToYjs]);

    // Flush pending saves on unmount and force save current state
    useEffect(() => {
        return () => {
            console.log('[Sheet] Unmounting - saving current state');
            // Try to save using workbook ref first (most accurate)
            if (workbookRef.current?.getAllSheets && ysheetRef.current && ydoc) {
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
                            console.log('[Sheet] Unmount - converted', celldata.length, 'cells');
                        }
                        return newSheet;
                    });
                    console.log('[Sheet] Final save on unmount, sheets:', convertedData?.length);
                    ydoc.transact(() => {
                        ysheetRef.current.set('sheets', JSON.parse(JSON.stringify(convertedData)));
                    });
                    console.log('[Sheet] Final state saved to Yjs');
                } catch (e) {
                    console.error('[Sheet] Failed to save final state:', e);
                }
            }
            // Also flush any pending debounced saves
            debouncedSaveRef.current?.flush();
        };
    }, [ydoc]);

    // Handle sheet data changes
    const handleChange = useCallback((newData) => {
        // Increment onChange counter
        onChangeCountRef.current++;
        
        // Debug: check if data has the expected structure
        if (newData?.[0]) {
            // Count non-blank cells - a cell is non-blank if it has actual content (v property with value)
            let nonEmptyCells = 0;
            let totalCharacters = 0;
            
            const sheetData = newData[0].data;
            if (sheetData && Array.isArray(sheetData)) {
                for (const row of sheetData) {
                    if (row && Array.isArray(row)) {
                        for (const cell of row) {
                            // Check if cell has actual content
                            if (cell && cell.v !== null && cell.v !== undefined && cell.v !== '') {
                                nonEmptyCells++;
                                // Count characters in the cell value
                                const cellValue = String(cell.v);
                                totalCharacters += cellValue.length;
                            }
                        }
                    }
                }
            }
            
            console.log('[Sheet] handleChange #' + onChangeCountRef.current + ' - sheets:', newData.length, 'non-empty cells:', nonEmptyCells, 'chars:', totalCharacters);
            
            // Report stats (non-blank cell count and character count)
            if (onStatsChange) {
                onStatsChange({ cellCount: nonEmptyCells, characterCount: totalCharacters });
            }
            
            // Skip the FIRST onChange after receiving data from Yjs
            // Fortune Sheet fires onChange with empty/stale data when it first renders with existing data
            if (onChangeCountRef.current === 1 && hasReceivedFirstData.current) {
                console.log('[Sheet] Skipping first onChange after data load (Fortune Sheet init event)');
                setData(newData);
                return;
            }
            
            // CRITICAL: Skip saving if we're in the middle of receiving a remote update
            // When setData() is called with remote data, Fortune Sheet fires onChange with its
            // internal merged/stale state. If we save that back, we overwrite the remote update!
            if (isReceivingRemoteUpdate.current) {
                console.log('[Sheet] Skipping save - receiving remote update (would overwrite remote data)');
                setData(newData);
                return;
            }
        }
        setData(newData);
        // Save via debounced function for full data sync
        debouncedSaveToYjs(newData);
    }, [debouncedSaveToYjs]);

    // Handle operations for real-time sync (immediate, not debounced)
    const handleOp = useCallback((ops) => {
        // Don't sync our own application of remote ops
        if (isApplyingRemoteOps.current) return;
        if (!ysheetRef.current || !ydoc) return;

        try {
            // Immediately send ops to peers
            ydoc.transact(() => {
                const existingOps = ysheetRef.current.get('pendingOps') || [];
                ysheetRef.current.set('pendingOps', [...existingOps, ...ops]);
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
            // Position above the selected cell(s)
            if (containerRef.current) {
                const container = containerRef.current;
                const rect = container.getBoundingClientRect();
                
                // Estimate cell position (approximate - Fortune Sheet doesn't expose exact positions)
                const defaultColWidth = 100;
                const defaultRowHeight = 25;
                const headerHeight = 30;
                const rowHeaderWidth = 46;
                
                const x = rect.left + rowHeaderWidth + (column[0] * defaultColWidth) + (defaultColWidth / 2);
                // Position toolbar below the selected cell (add 1 row height offset)
                const y = rect.top + headerHeight + ((row[0] + 1) * defaultRowHeight);
                
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

    // Loading state
    if (!isInitialized || !data) {
        return (
            <div className="sheet-loading">
                <div className="sheet-loading__spinner"></div>
                <p>Loading spreadsheet...</p>
            </div>
        );
    }

    // Handle add comment from toolbar
    const handleToolbarAddComment = (commentData) => {
        if (onAddComment) {
            onAddComment(commentData);
        }
        // Clear selection after adding comment
        setCurrentSelection(null);
        setToolbarPosition(null);
    };

    return (
        <div 
            ref={containerRef}
            className={`sheet-container ${readOnly ? 'sheet-container--readonly' : ''}`}
        >
            {readOnly && (
                <div className="sheet-readonly-banner">
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
                {/* Custom presence overlays - Fortune Sheet's API is unreliable */}
                {presenceOverlays.map((p) => (
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
