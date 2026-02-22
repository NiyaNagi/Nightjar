import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
    DndContext,
    DragOverlay,
    PointerSensor,
    TouchSensor,
    useSensor,
    useSensors,
    closestCorners,
} from '@dnd-kit/core';
import {
    SortableContext,
    arrayMove,
    verticalListSortingStrategy,
    horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import SortableKanbanCard from './SortableKanbanCard';
import SortableKanbanColumn from './SortableKanbanColumn';
import KanbanCardEditor from './KanbanCardEditor';
import SimpleMarkdown from './SimpleMarkdown';
import { useConfirmDialog } from './common/ConfirmDialog';
import { UnifiedPicker } from './common';
import useIsMobile from '../hooks/useIsMobile';
import { logBehavior } from '../utils/logger';
import './Kanban.css';

const generateId = () => crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

// Sync timeout - wait for provider to sync before initializing defaults
const SYNC_TIMEOUT_MS = 10000;

const Kanban = ({ ydoc, provider, userColor, userHandle, userPublicKey, readOnly = false, onAddComment }) => {
    const [columns, setColumns] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [syncError, setSyncError] = useState(null);
    const [activeId, setActiveId] = useState(null);
    const [activeData, setActiveData] = useState(null);
    const [editingCard, setEditingCard] = useState(null);
    const [editingColumn, setEditingColumn] = useState(null);
    const [newColumnName, setNewColumnName] = useState('');
    const [showNewColumn, setShowNewColumn] = useState(false);
    const [cardPresence, setCardPresence] = useState({}); // cardId -> [{ name, color }]
    const ykanbanRef = useRef(null);
    const hasSyncedRef = useRef(false);
    const syncTimeoutRef = useRef(null);
    const { confirm, ConfirmDialogComponent } = useConfirmDialog();
    const editCancelledRef = useRef(false); // Track Escape cancel to prevent onBlur race
    const boardRef = useRef(null);
    const [activeColumnIndex, setActiveColumnIndex] = useState(0);
    const isMobileNarrow = useIsMobile(480);

    // Track active column index from scroll position (mobile dots)
    const handleBoardScroll = useCallback(() => {
        const el = boardRef.current;
        if (!el || !isMobileNarrow) return;
        const colWidth = el.firstElementChild?.offsetWidth || 1;
        const gap = 8; // matches CSS gap at ≤480px
        const idx = Math.round(el.scrollLeft / (colWidth + gap));
        setActiveColumnIndex(Math.max(0, Math.min(idx, columns.length - 1)));
    }, [isMobileNarrow, columns.length]);

    // Scroll to a specific column when dot is tapped
    const scrollToColumn = useCallback((idx) => {
        const el = boardRef.current;
        if (!el) return;
        const child = el.children[idx];
        if (child) child.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }, []);

    // Initialize Yjs map for kanban data with sync awareness
    useEffect(() => {
        if (!ydoc) return;
        
        // Reset state on mount
        hasSyncedRef.current = false;
        setSyncError(null);
        setIsLoading(true);
        
        const ykanban = ydoc.getMap('kanban');
        ykanbanRef.current = ykanban;

        const updateFromYjs = () => {
            const data = ykanban.get('columns');
            if (data) {
                const parsed = JSON.parse(JSON.stringify(data));
                // Ensure every column has a cards array (remote sync may deliver malformed data)
                if (Array.isArray(parsed)) {
                    parsed.forEach(col => { if (!Array.isArray(col.cards)) col.cards = []; });
                }
                setColumns(parsed);
                setIsLoading(false);
                // Clear editing state if the edited card was removed by a remote change
                setEditingCard(prev => {
                    if (prev && !parsed.some(col => col.cards?.some(c => c.id === prev))) {
                        return null;
                    }
                    return prev;
                });
            } else if (hasSyncedRef.current) {
                // Only initialize defaults AFTER provider has synced and there's truly no data
                const defaultColumns = [
                    { id: generateId(), name: 'To Do', color: '#6366f1', cards: [] },
                    { id: generateId(), name: 'In Progress', color: '#f59e0b', cards: [] },
                    { id: generateId(), name: 'Done', color: '#22c55e', cards: [] }
                ];
                ykanban.set('columns', defaultColumns);
                setColumns(defaultColumns);
                setIsLoading(false);
            }
            // If not synced yet and no data, stay in loading state
        };

        // Handle provider sync
        const handleSync = (isSynced) => {
            if (isSynced && !hasSyncedRef.current) {
                hasSyncedRef.current = true;
                // Clear timeout since we synced
                if (syncTimeoutRef.current) {
                    clearTimeout(syncTimeoutRef.current);
                    syncTimeoutRef.current = null;
                }
                // Now check if we need to initialize with defaults
                updateFromYjs();
            }
        };

        // Set up observer
        ykanban.observe(updateFromYjs);
        
        // Check if already synced
        if (provider?.synced) {
            handleSync(true);
        } else if (provider) {
            // Listen for sync event
            provider.on('sync', handleSync);
            
            // Timeout fallback - if sync doesn't happen in time, show error
            syncTimeoutRef.current = setTimeout(() => {
                if (!hasSyncedRef.current) {
                    console.warn('[Kanban] Sync timeout - provider did not sync in time');
                    setSyncError('Unable to sync with server. You can retry or work offline.');
                    setIsLoading(false);
                }
            }, SYNC_TIMEOUT_MS);
        } else {
            // No provider - initialize immediately (offline mode)
            hasSyncedRef.current = true;
            updateFromYjs();
        }

        return () => {
            ykanban.unobserve(updateFromYjs);
            if (provider) {
                provider.off('sync', handleSync);
            }
            if (syncTimeoutRef.current) {
                clearTimeout(syncTimeoutRef.current);
            }
        };
    }, [ydoc, provider]);

    // Kanban card presence - track which cards other users are editing
    useEffect(() => {
        if (!provider?.awareness) return;
        
        const awareness = provider.awareness;
        
        // Set our user info in awareness, preserving existing fields (e.g. showCursor)
        const existingUser = awareness.getLocalState()?.user || {};
        awareness.setLocalStateField('user', {
            ...existingUser,
            name: userHandle || 'Anonymous',
            color: userColor || '#6366f1',
            publicKey: userPublicKey || existingUser.publicKey || null,
            lastActive: Date.now(),
        });
        
        const updatePresence = () => {
            const states = awareness.getStates();
            const presenceMap = {};
            
            states.forEach((state, clientId) => {
                if (clientId === awareness.clientID) return;
                if (state.focusedCardId && state.user?.name) {
                    if (!presenceMap[state.focusedCardId]) {
                        presenceMap[state.focusedCardId] = [];
                    }
                    presenceMap[state.focusedCardId].push({
                        name: state.user.name,
                        color: state.user.color || '#6366f1',
                    });
                }
            });
            
            setCardPresence(presenceMap);
        };
        
        awareness.on('change', updatePresence);
        updatePresence();
        
        return () => awareness.off('change', updatePresence);
    }, [provider, userHandle, userColor, userPublicKey]);

    // Update focused card in awareness when editing
    useEffect(() => {
        if (!provider?.awareness) return;
        provider.awareness.setLocalStateField('focusedCardId', editingCard);
    }, [provider, editingCard]);

    // Retry sync handler
    const handleRetrySync = useCallback(() => {
        logBehavior('document', 'kanban_retry_sync');
        setSyncError(null);
        setIsLoading(true);
        hasSyncedRef.current = false;
        
        if (provider) {
            // Try to reconnect
            if (provider.wsconnected === false && provider.connect) {
                provider.connect();
            }
            
            // Clear any existing timeout before setting a new one
            if (syncTimeoutRef.current) {
                clearTimeout(syncTimeoutRef.current);
            }
            
            // Set up timeout again
            syncTimeoutRef.current = setTimeout(() => {
                if (!hasSyncedRef.current) {
                    setSyncError('Still unable to sync. You can continue working offline.');
                    setIsLoading(false);
                }
            }, SYNC_TIMEOUT_MS);
        }
    }, [provider]);

    // Work offline handler
    const handleWorkOffline = useCallback(() => {
        logBehavior('document', 'kanban_work_offline');
        setSyncError(null);
        hasSyncedRef.current = true;
        // Initialize with defaults if no data
        const data = ykanbanRef.current?.get('columns');
        if (data) {
            const parsed = JSON.parse(JSON.stringify(data));
            if (Array.isArray(parsed)) {
                parsed.forEach(col => { if (!Array.isArray(col.cards)) col.cards = []; });
            }
            setColumns(parsed);
        } else {
            const defaultColumns = [
                { id: generateId(), name: 'To Do', color: '#6366f1', cards: [] },
                { id: generateId(), name: 'In Progress', color: '#f59e0b', cards: [] },
                { id: generateId(), name: 'Done', color: '#22c55e', cards: [] }
            ];
            if (ykanbanRef.current) {
                ykanbanRef.current.set('columns', defaultColumns);
            }
            setColumns(defaultColumns);
        }
        setIsLoading(false);
    }, []);

    const saveToYjs = useCallback((newColumns, changedColumnId = null) => {
        if (!ykanbanRef.current) return;
        const ykanban = ykanbanRef.current;
        const doc = ykanban.doc;
        const doSave = () => {
            if (changedColumnId) {
                // Only update the specific column that changed
                const existing = ykanban.get('columns');
                if (Array.isArray(existing)) {
                    const idx = existing.findIndex(c => c.id === changedColumnId);
                    const newCol = newColumns.find(c => c.id === changedColumnId);
                    if (idx !== -1 && newCol) {
                        const updated = JSON.parse(JSON.stringify(existing));
                        updated[idx] = JSON.parse(JSON.stringify(newCol));
                        ykanban.set('columns', updated);
                        return;
                    }
                }
            }
            // Fallback: replace entire array (for adds, deletes, reorders)
            ykanban.set('columns', JSON.parse(JSON.stringify(newColumns)));
        };
        if (doc) doc.transact(doSave);
        else doSave();
    }, []);

    // Column operations
    const addColumn = useCallback(() => {
        if (!newColumnName.trim()) return;
        const currentColumns = ykanbanRef.current?.get('columns');
        const base = currentColumns ? JSON.parse(JSON.stringify(currentColumns)) : columns;
        if (base.some(c => c.name.toLowerCase() === newColumnName.trim().toLowerCase())) return;
        const newColumn = {
            id: generateId(),
            name: newColumnName.trim(),
            color: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0'),
            cards: []
        };
        const newColumns = [...base, newColumn];
        setColumns(newColumns);
        saveToYjs(newColumns);
        logBehavior('document', 'kanban_add_column', { columnId: newColumn.id, name: newColumn.name });
        setNewColumnName('');
        setShowNewColumn(false);
    }, [columns, newColumnName, saveToYjs]);

    const deleteColumn = useCallback(async (columnId) => {
        const confirmed = await confirm({
            title: 'Delete Column',
            message: 'Are you sure? All cards in this column will be lost.',
            confirmText: 'Delete',
            variant: 'danger'
        });
        if (!confirmed) return;
        setEditingColumn(prev => prev === columnId ? null : prev);
        const currentColumns = ykanbanRef.current?.get('columns');
        const base = currentColumns ? JSON.parse(JSON.stringify(currentColumns)) : columns;
        const newColumns = base.filter(c => c.id !== columnId);
        setColumns(newColumns);
        saveToYjs(newColumns);
        logBehavior('document', 'kanban_delete_column', { columnId });
    }, [columns, saveToYjs, confirm]);

    const updateColumnName = useCallback((columnId, name) => {
        if (!name.trim()) return; // Guard empty names
        const currentColumns = ykanbanRef.current?.get('columns');
        const base = currentColumns ? JSON.parse(JSON.stringify(currentColumns)) : columns;
        // Reject if another column already has this name (case-insensitive)
        if (base.some(c => c.id !== columnId && c.name.toLowerCase() === name.trim().toLowerCase())) return;
        const newColumns = base.map(c => 
            c.id === columnId ? { ...c, name: name.trim() } : c
        );
        setColumns(newColumns);
        saveToYjs(newColumns, columnId);
        logBehavior('document', 'kanban_rename_column', { columnId, name: name.trim() });
        setEditingColumn(null);
    }, [columns, saveToYjs]);

    const updateColumnColor = useCallback((columnId, color) => {
        const currentColumns = ykanbanRef.current?.get('columns');
        const base = currentColumns ? JSON.parse(JSON.stringify(currentColumns)) : columns;
        const newColumns = base.map(c => 
            c.id === columnId ? { ...c, color } : c
        );
        setColumns(newColumns);
        saveToYjs(newColumns, columnId);
        logBehavior('document', 'kanban_change_column_color', { columnId, color });
    }, [columns, saveToYjs]);

    // Card operations
    const addCard = useCallback((columnId, position = 'bottom') => {
        const newCard = {
            id: generateId(),
            title: 'New Card',
            description: '',
            color: null,
            tags: [],
            createdAt: Date.now()
        };
        
        const currentColumns = ykanbanRef.current?.get('columns');
        const base = currentColumns ? JSON.parse(JSON.stringify(currentColumns)) : columns;
        const newColumns = base.map(c => {
            if (c.id === columnId) {
                const cards = position === 'top' 
                    ? [newCard, ...c.cards]
                    : [...c.cards, newCard];
                return { ...c, cards };
            }
            return c;
        });
        
        setColumns(newColumns);
        saveToYjs(newColumns, columnId);
        logBehavior('document', 'kanban_add_card', { columnId, cardId: newCard.id, position });
        setEditingCard(newCard.id);
    }, [columns, saveToYjs]);

    const updateCard = useCallback((columnId, cardId, updates) => {
        const currentColumns = ykanbanRef.current?.get('columns');
        const base = currentColumns ? JSON.parse(JSON.stringify(currentColumns)) : columns;
        // Find which column actually contains the card (may have been moved by a remote peer)
        const actualColumnId = base.find(c => c.cards?.some(card => card.id === cardId))?.id || columnId;
        const newColumns = base.map(c => {
            if (c.id === actualColumnId) {
                return {
                    ...c,
                    cards: c.cards.map(card =>
                        card.id === cardId ? { ...card, ...updates } : card
                    )
                };
            }
            return c;
        });
        setColumns(newColumns);
        saveToYjs(newColumns, actualColumnId);
        logBehavior('document', 'kanban_update_card', { columnId: actualColumnId, cardId, fields: Object.keys(updates) });
    }, [columns, saveToYjs]);

    const deleteCard = useCallback(async (columnId, cardId) => {
        const confirmed = await confirm({
            title: 'Delete Card',
            message: 'Are you sure you want to delete this card?',
            confirmText: 'Delete',
            variant: 'danger'
        });
        if (!confirmed) return;
        const currentColumns = ykanbanRef.current?.get('columns');
        const base = currentColumns ? JSON.parse(JSON.stringify(currentColumns)) : columns;
        // Find which column actually contains the card (may have been moved during confirm dialog)
        const actualColumnId = base.find(c => c.cards?.some(card => card.id === cardId))?.id || columnId;
        const newColumns = base.map(c => {
            if (c.id === actualColumnId) {
                return {
                    ...c,
                    cards: c.cards.filter(card => card.id !== cardId)
                };
            }
            return c;
        });
        setColumns(newColumns);
        saveToYjs(newColumns, actualColumnId);
        logBehavior('document', 'kanban_delete_card', { columnId: actualColumnId, cardId });
        if (editingCard === cardId) setEditingCard(null);
    }, [columns, saveToYjs, confirm, editingCard]);

    // ========== @dnd-kit drag-and-drop ==========

    // Sensors: pointer (mouse) + touch with activation constraints
    const dndSensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    );

    // Column IDs for the outer SortableContext
    const columnIds = useMemo(() => columns.map(c => `col-${c.id}`), [columns]);

    // Find which column a card belongs to
    const findColumnOfCard = useCallback((cardId) => {
        return columns.find(col => col.cards?.some(c => c.id === cardId));
    }, [columns]);

    // @dnd-kit onDragStart
    const handleDndStart = useCallback((event) => {
        const { active } = event;
        setActiveId(active.id);
        setActiveData(active.data.current);
    }, []);

    // @dnd-kit onDragOver — cross-container card moves (optimistic UI)
    const handleDndOver = useCallback((event) => {
        const { active, over } = event;
        if (!over || active.data.current?.type !== 'card') return;

        const activeCardId = active.id;
        const activeCol = columns.find(col => col.cards?.some(c => c.id === activeCardId));
        if (!activeCol) return;

        let overColumnId;
        if (over.data.current?.type === 'card') {
            const overCol = columns.find(col => col.cards?.some(c => c.id === over.id));
            overColumnId = overCol?.id;
        } else if (over.data.current?.type === 'column') {
            overColumnId = over.data.current.column.id;
        } else {
            overColumnId = columns.find(c => `col-${c.id}` === String(over.id))?.id;
        }

        if (!overColumnId || activeCol.id === overColumnId) return;

        // Move card between columns (optimistic state update)
        setColumns(prev => {
            const updated = JSON.parse(JSON.stringify(prev));
            const fromCol = updated.find(c => c.id === activeCol.id);
            const toCol = updated.find(c => c.id === overColumnId);
            if (!fromCol || !toCol) return prev;

            const cardIdx = fromCol.cards.findIndex(c => c.id === activeCardId);
            if (cardIdx === -1) return prev;

            const [card] = fromCol.cards.splice(cardIdx, 1);
            if (over.data.current?.type === 'card') {
                const overIdx = toCol.cards.findIndex(c => c.id === over.id);
                toCol.cards.splice(overIdx >= 0 ? overIdx : toCol.cards.length, 0, card);
            } else {
                toCol.cards.push(card);
            }
            return updated;
        });
    }, [columns]);

    // @dnd-kit onDragEnd — persist to Yjs
    const handleDndEnd = useCallback((event) => {
        const { active, over } = event;
        const data = active.data.current;

        setActiveId(null);
        setActiveData(null);

        // Cancelled — restore from Yjs
        if (!over) {
            if (ykanbanRef.current) {
                const latest = ykanbanRef.current.get('columns');
                if (latest) setColumns(JSON.parse(JSON.stringify(latest)));
            }
            return;
        }

        if (data?.type === 'column') {
            // Column reorder
            const fromColId = data.column.id;
            const toColId = over.data.current?.type === 'column'
                ? over.data.current.column.id
                : columns.find(c => `col-${c.id}` === String(over.id))?.id;
            if (!toColId || fromColId === toColId) return;

            if (ykanbanRef.current) {
                const ykanban = ykanbanRef.current;
                const doc = ykanban.doc;
                const doSave = () => {
                    const existing = ykanban.get('columns');
                    if (!Array.isArray(existing)) return;
                    const base = JSON.parse(JSON.stringify(existing));
                    const fi = base.findIndex(c => c.id === fromColId);
                    const ti = base.findIndex(c => c.id === toColId);
                    if (fi === -1 || ti === -1) return;
                    ykanban.set('columns', arrayMove(base, fi, ti));
                };
                if (doc) doc.transact(doSave);
                else doSave();
                const latest = ykanbanRef.current.get('columns');
                if (latest) setColumns(JSON.parse(JSON.stringify(latest)));
                logBehavior('document', 'kanban_reorder_column', { columnId: fromColId });
            }
        } else if (data?.type === 'card') {
            const activeCardId = active.id;
            const originalColumnId = data.columnId;

            if (over.data.current?.type === 'card' || over.data.current?.type === 'column') {
                // Determine current position after any handleDndOver moves
                const currentCol = columns.find(col => col.cards?.some(c => c.id === activeCardId));
                const sameColumn = currentCol?.id === originalColumnId;

                if (sameColumn && over.data.current?.type === 'card' && over.id !== activeCardId) {
                    // Same-column reorder — read from Yjs inside transaction
                    if (ykanbanRef.current) {
                        const ykanban = ykanbanRef.current;
                        const doc = ykanban.doc;
                        const overIdx = currentCol.cards.findIndex(c => c.id === over.id);
                        const doSave = () => {
                            const existing = ykanban.get('columns');
                            if (!Array.isArray(existing)) return;
                            const updated = JSON.parse(JSON.stringify(existing));
                            const col = updated.find(c => c.id === currentCol.id);
                            if (!col) return;
                            const fromIdx = col.cards.findIndex(cc => cc.id === activeCardId);
                            if (fromIdx === -1) return;
                            col.cards = arrayMove(col.cards, fromIdx, overIdx >= 0 ? overIdx : col.cards.length);
                            ykanban.set('columns', updated);
                        };
                        if (doc) doc.transact(doSave);
                        else doSave();
                        const latest = ykanbanRef.current.get('columns');
                        if (latest) setColumns(JSON.parse(JSON.stringify(latest)));
                        logBehavior('document', 'kanban_reorder_card', { columnId: currentCol.id, cardId: activeCardId });
                    }
                } else if (!sameColumn) {
                    // Cross-column move — state already updated by handleDndOver, persist
                    if (ykanbanRef.current) {
                        const ykanban = ykanbanRef.current;
                        const doc = ykanban.doc;
                        const doSave = () => {
                            ykanban.set('columns', JSON.parse(JSON.stringify(columns)));
                        };
                        if (doc) doc.transact(doSave);
                        else doSave();
                        const latest = ykanbanRef.current.get('columns');
                        if (latest) setColumns(JSON.parse(JSON.stringify(latest)));
                        logBehavior('document', 'kanban_move_card', { cardId: activeCardId, fromColumnId: originalColumnId, toColumnId: currentCol?.id });
                    }
                }
            }
        }

    }, [columns, saveToYjs]);

    return (
        <div 
            className={`kanban-container ${readOnly ? 'kanban-container--readonly' : ''}`}
            role="region"
            aria-label="Kanban Board"
            data-testid="kanban-container"
        >
            {ConfirmDialogComponent}
            <div className="kanban-header" data-testid="kanban-header">
                <h2>Kanban Board</h2>
                {readOnly && (
                    <span className="readonly-badge" data-testid="kanban-readonly-badge">📖 View Only</span>
                )}
                {!readOnly && (
                    <div className="kanban-actions">
                        <button 
                            type="button"
                            className="btn-add-column"
                            onClick={() => { logBehavior('document', 'kanban_show_add_column_form'); setShowNewColumn(true); }}
                            disabled={isLoading || syncError}
                            data-testid="kanban-add-column-btn"
                        >
                            + Add Column
                        </button>
                    </div>
                )}
            </div>

            {syncError ? (
                <div className="kanban-sync-error">
                    <div className="sync-error-icon">⚠️</div>
                    <p>{syncError}</p>
                    <div className="sync-error-actions">
                        <button 
                            type="button"
                            className="btn-retry"
                            onClick={handleRetrySync}
                        >
                            🔄 Retry
                        </button>
                        <button 
                            type="button"
                            className="btn-offline"
                            onClick={handleWorkOffline}
                        >
                            📴 Work Offline
                        </button>
                    </div>
                </div>
            ) : isLoading ? (
                <div className="kanban-loading" data-testid="kanban-loading">
                    <div className="kanban-loading__spinner"></div>
                    <p>Syncing board...</p>
                </div>
            ) : (
            <DndContext
                sensors={dndSensors}
                collisionDetection={closestCorners}
                onDragStart={handleDndStart}
                onDragOver={handleDndOver}
                onDragEnd={handleDndEnd}
            >
            <div className="kanban-board" data-testid="kanban-board" ref={boardRef} onScroll={handleBoardScroll}>
                <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
                {columns.map((column) => (
                    <SortableKanbanColumn key={column.id} column={column} disabled={readOnly}>
                        {(dragListeners) => (
                            <>
                        <div className="column-header" {...(readOnly ? {} : dragListeners)}>
                            {!readOnly && editingColumn === column.id ? (
                                <input
                                    type="text"
                                    defaultValue={column.name}
                                    autoFocus
                                    aria-label="Edit column name"
                                    onBlur={(e) => {
                                        if (!editCancelledRef.current) {
                                            updateColumnName(column.id, e.target.value);
                                        }
                                        editCancelledRef.current = false;
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            updateColumnName(column.id, e.target.value);
                                        }
                                        if (e.key === 'Escape') {
                                            editCancelledRef.current = true;
                                            setEditingColumn(null);
                                        }
                                    }}
                                />
                            ) : (
                                <h3 
                                    id={`column-header-${column.id}`}
                                    onClick={() => { if (!readOnly) { logBehavior('document', 'kanban_start_edit_column', { columnId: column.id }); setEditingColumn(column.id); } }}
                                >
                                    {column.name}
                                    <span className="card-count">{column.cards.length}</span>
                                </h3>
                            )}
                            {!readOnly && (
                                <div className="column-actions">
                                    <UnifiedPicker
                                        mode="color"
                                        color={column.color || '#6366f1'}
                                        onColorChange={(c) => updateColumnColor(column.id, c)}
                                        size="small"
                                    />
                                    <button 
                                        type="button"
                                        className="btn-delete-column"
                                        onClick={() => deleteColumn(column.id)}
                                        title="Delete column"
                                        aria-label={`Delete ${column.name} column`}
                                    >
                                        🗑
                                    </button>
                                </div>
                            )}
                        </div>

                        <SortableContext items={column.cards.map(c => c.id)} strategy={verticalListSortingStrategy}>
                        <div className="column-cards" role="list" aria-label={`${column.name} cards`}>
                            {column.cards.map((card) => (
                                <SortableKanbanCard
                                    key={card.id}
                                    id={card.id}
                                    card={card}
                                    columnId={column.id}
                                    disabled={readOnly || editingCard === card.id}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !readOnly) {
                                            e.preventDefault();
                                            logBehavior('document', 'kanban_open_card_editor', { cardId: card.id, columnId: column.id, via: 'keyboard' });
                                            setEditingCard(card.id);
                                        } else if (e.key === 'Delete' && !readOnly) {
                                            e.preventDefault();
                                            logBehavior('document', 'kanban_delete_card_keyboard', { cardId: card.id, columnId: column.id });
                                            deleteCard(column.id, card.id);
                                        }
                                    }}
                                >
                                    {/* Presence indicator - show who's editing this card */}
                                    {cardPresence[card.id]?.length > 0 && (
                                        <div className="card-presence-indicator">
                                            {cardPresence[card.id].map((user, idx) => (
                                                <span 
                                                    key={idx} 
                                                    className="presence-pip"
                                                    style={{ backgroundColor: user.color }}
                                                    title={`${user.name} is editing`}
                                                />
                                            ))}
                                        </div>
                                    )}
                                    {!readOnly && editingCard === card.id ? (
                                        <KanbanCardEditor
                                            card={card}
                                            onUpdate={(updates) => updateCard(column.id, card.id, updates)}
                                            onDelete={() => deleteCard(column.id, card.id)}
                                            onClose={() => setEditingCard(null)}
                                            onAddComment={onAddComment}
                                        />
                                    ) : (
                                        <div className="card-content">
                                            <div className="card-header">
                                                <h4>{card.title}</h4>
                                                {!readOnly && (
                                                    <button 
                                                        type="button"
                                                        className="btn-edit-card"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            logBehavior('document', 'kanban_open_card_editor', { cardId: card.id, columnId: column.id });
                                                            setEditingCard(card.id);
                                                        }}
                                                        title="Edit card"
                                                        aria-label={`Edit ${card.title} card`}
                                                    >
                                                        ✏️
                                                    </button>
                                                )}
                                            </div>
                                            {card.description && (
                                                <SimpleMarkdown 
                                                    text={card.description} 
                                                    className="card-description"
                                                />
                                            )}
                                            {card.tags && card.tags.length > 0 && (
                                                <div className="card-tags">
                                                    {card.tags.map(tag => (
                                                        <span key={tag} className="tag">{tag}</span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </SortableKanbanCard>
                            ))}
                        </div>
                        </SortableContext>

                        {!readOnly && (
                        <div className="column-footer">
                            <button 
                                type="button"
                                className="btn-add-card"
                                onClick={() => addCard(column.id, 'bottom')}
                            >
                                + Add Card
                            </button>
                        </div>
                        )}
                            </>
                        )}
                    </SortableKanbanColumn>
                ))}
                </SortableContext>

                {!readOnly && showNewColumn && (
                    <div className="kanban-column new-column">
                        <div className="new-column-form" role="form" aria-label="Add new column form">
                            <input
                                type="text"
                                value={newColumnName}
                                onChange={(e) => setNewColumnName(e.target.value)}
                                placeholder="Column name..."
                                autoFocus
                                aria-label="New column name"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') addColumn();
                                    if (e.key === 'Escape') {
                                        setShowNewColumn(false);
                                        setNewColumnName('');
                                    }
                                }}
                            />
                            <div className="new-column-actions">
                                <button type="button" onClick={addColumn} aria-label="Add column">Add</button>
                                <button type="button" onClick={() => {
                                    logBehavior('document', 'kanban_cancel_add_column');
                                    setShowNewColumn(false);
                                    setNewColumnName('');
                                }} aria-label="Cancel adding column">Cancel</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Pagination dots for mobile — visible only at ≤480px */}
            {isMobileNarrow && columns.length > 1 && (
                <div className="kanban-dots" data-testid="kanban-dots">
                    {columns.map((col, idx) => (
                        <button
                            key={col.id}
                            type="button"
                            className={`kanban-dot${idx === activeColumnIndex ? ' kanban-dot--active' : ''}`}
                            style={{ '--dot-color': col.color || '#6366f1' }}
                            onClick={() => scrollToColumn(idx)}
                            aria-label={`Go to ${col.name} column`}
                        />
                    ))}
                </div>
            )}

            {/* @dnd-kit drag overlay — shows preview while dragging */}
            <DragOverlay>
                {activeId && activeData?.type === 'card' ? (
                    <div className="kanban-card dragging" style={activeData.card?.color ? { borderLeftColor: activeData.card.color } : {}}>
                        <div className="card-content">
                            <div className="card-header"><h4>{activeData.card?.title}</h4></div>
                        </div>
                    </div>
                ) : activeId && activeData?.type === 'column' ? (
                    <div className="kanban-column" style={{ '--column-color': activeData.column?.color, opacity: 0.8 }}>
                        <div className="column-header">
                            <h3>{activeData.column?.name}</h3>
                        </div>
                    </div>
                ) : null}
            </DragOverlay>
            </DndContext>
            )}
        </div>
    );
};

export default React.memo(Kanban);
