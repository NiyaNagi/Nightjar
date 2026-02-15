import React, { useState, useEffect, useCallback, useRef } from 'react';
import KanbanCardEditor from './KanbanCardEditor';
import SimpleMarkdown from './SimpleMarkdown';
import { useConfirmDialog } from './common/ConfirmDialog';
import './Kanban.css';

const generateId = () => Date.now().toString(36) + Math.random().toString(36).substring(2, 11);

// Sync timeout - wait for provider to sync before initializing defaults
const SYNC_TIMEOUT_MS = 10000;

const Kanban = ({ ydoc, provider, userColor, userHandle, userPublicKey, readOnly = false, onAddComment }) => {
    const [columns, setColumns] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [syncError, setSyncError] = useState(null);
    const [draggedCard, setDraggedCard] = useState(null);
    const [draggedColumn, setDraggedColumn] = useState(null);
    const [editingCard, setEditingCard] = useState(null);
    const [editingColumn, setEditingColumn] = useState(null);
    const [newColumnName, setNewColumnName] = useState('');
    const [showNewColumn, setShowNewColumn] = useState(false);
    const [cardPresence, setCardPresence] = useState({}); // cardId -> [{ name, color }]
    const ykanbanRef = useRef(null);
    const hasSyncedRef = useRef(false);
    const syncTimeoutRef = useRef(null);
    const { confirm, ConfirmDialogComponent } = useConfirmDialog();

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
                setColumns(JSON.parse(JSON.stringify(data)));
                setIsLoading(false);
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
        
        // Set our user info in awareness
        awareness.setLocalStateField('user', {
            name: userHandle || 'Anonymous',
            color: userColor || '#6366f1',
            publicKey: userPublicKey || null,
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
        setSyncError(null);
        setIsLoading(true);
        hasSyncedRef.current = false;
        
        if (provider) {
            // Try to reconnect
            if (provider.wsconnected === false && provider.connect) {
                provider.connect();
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
        setSyncError(null);
        hasSyncedRef.current = true;
        // Initialize with defaults if no data
        const data = ykanbanRef.current?.get('columns');
        if (data) {
            setColumns(JSON.parse(JSON.stringify(data)));
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

    const saveToYjs = useCallback((newColumns) => {
        if (ykanbanRef.current) {
            ykanbanRef.current.set('columns', JSON.parse(JSON.stringify(newColumns)));
        }
    }, []);

    // Column operations
    const addColumn = useCallback(() => {
        if (!newColumnName.trim()) return;
        const newColumn = {
            id: generateId(),
            name: newColumnName.trim(),
            color: '#' + Math.floor(Math.random()*16777215).toString(16),
            cards: []
        };
        const newColumns = [...columns, newColumn];
        setColumns(newColumns);
        saveToYjs(newColumns);
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
        const newColumns = columns.filter(c => c.id !== columnId);
        setColumns(newColumns);
        saveToYjs(newColumns);
    }, [columns, saveToYjs, confirm]);

    const updateColumnName = useCallback((columnId, name) => {
        const newColumns = columns.map(c => 
            c.id === columnId ? { ...c, name } : c
        );
        setColumns(newColumns);
        saveToYjs(newColumns);
        setEditingColumn(null);
    }, [columns, saveToYjs]);

    const updateColumnColor = useCallback((columnId, color) => {
        const newColumns = columns.map(c => 
            c.id === columnId ? { ...c, color } : c
        );
        setColumns(newColumns);
        saveToYjs(newColumns);
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
        
        const newColumns = columns.map(c => {
            if (c.id === columnId) {
                const cards = position === 'top' 
                    ? [newCard, ...c.cards]
                    : [...c.cards, newCard];
                return { ...c, cards };
            }
            return c;
        });
        
        setColumns(newColumns);
        saveToYjs(newColumns);
        setEditingCard(newCard.id);
    }, [columns, saveToYjs]);

    const updateCard = useCallback((columnId, cardId, updates) => {
        const newColumns = columns.map(c => {
            if (c.id === columnId) {
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
        saveToYjs(newColumns);
    }, [columns, saveToYjs]);

    const deleteCard = useCallback(async (columnId, cardId) => {
        const confirmed = await confirm({
            title: 'Delete Card',
            message: 'Are you sure you want to delete this card?',
            confirmText: 'Delete',
            variant: 'danger'
        });
        if (!confirmed) return;
        const newColumns = columns.map(c => {
            if (c.id === columnId) {
                return {
                    ...c,
                    cards: c.cards.filter(card => card.id !== cardId)
                };
            }
            return c;
        });
        setColumns(newColumns);
        saveToYjs(newColumns);
    }, [columns, saveToYjs, confirm]);

    // Drag and drop for cards
    const handleDragStart = (e, card, fromColumnId) => {
        // Stop propagation to prevent column from also being dragged
        e.stopPropagation();
        setDraggedCard({ card, fromColumnId });
        setDraggedColumn(null); // Clear any column drag state
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragEnd = () => {
        // Always clear the dragged card state when drag ends
        setDraggedCard(null);
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e, toColumnId, toIndex = null) => {
        e.preventDefault();
        
        if (!draggedCard) return;
        
        const { card, fromColumnId } = draggedCard;
        
        const newColumns = columns.map(c => {
            // Remove from source column
            if (c.id === fromColumnId) {
                return {
                    ...c,
                    cards: c.cards.filter(cc => cc.id !== card.id)
                };
            }
            return c;
        }).map(c => {
            // Add to destination column
            if (c.id === toColumnId) {
                const cards = [...c.cards];
                if (toIndex !== null) {
                    cards.splice(toIndex, 0, card);
                } else {
                    cards.push(card);
                }
                return { ...c, cards };
            }
            return c;
        });
        
        setColumns(newColumns);
        saveToYjs(newColumns);
        setDraggedCard(null);
    };

    // Drag and drop for columns
    const handleColumnDragStart = (e, column) => {
        // Only set column drag if not already dragging a card
        if (draggedCard) {
            e.preventDefault();
            return;
        }
        setDraggedColumn(column);
        setDraggedCard(null); // Clear any card drag state
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleColumnDragEnd = () => {
        setDraggedColumn(null);
    };

    const handleColumnDrop = (e, targetColumnId) => {
        e.preventDefault();
        
        if (!draggedColumn || draggedColumn.id === targetColumnId) return;
        
        const fromIndex = columns.findIndex(c => c.id === draggedColumn.id);
        const toIndex = columns.findIndex(c => c.id === targetColumnId);
        
        const newColumns = [...columns];
        newColumns.splice(fromIndex, 1);
        newColumns.splice(toIndex, 0, draggedColumn);
        
        setColumns(newColumns);
        saveToYjs(newColumns);
        setDraggedColumn(null);
    };

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
                            onClick={() => setShowNewColumn(true)}
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
            <div className="kanban-board" data-testid="kanban-board">
                {columns.map((column) => (
                    <div
                        key={column.id}
                        className="kanban-column"
                        style={{ '--column-color': column.color }}
                        role="region"
                        aria-labelledby={`column-header-${column.id}`}
                        data-testid={`kanban-column-${column.name.toLowerCase().replace(/\s+/g, '-')}`}
                        draggable={!readOnly}
                        onDragStart={(e) => !readOnly && handleColumnDragStart(e, column)}
                        onDragEnd={!readOnly ? handleColumnDragEnd : undefined}
                        onDragOver={!readOnly ? handleDragOver : undefined}
                        onDrop={!readOnly ? (e) => {
                            if (draggedColumn) {
                                handleColumnDrop(e, column.id);
                            } else {
                                handleDrop(e, column.id);
                            }
                        } : undefined}
                    >
                        <div className="column-header">
                            {!readOnly && editingColumn === column.id ? (
                                <input
                                    type="text"
                                    defaultValue={column.name}
                                    autoFocus
                                    aria-label="Edit column name"
                                    onBlur={(e) => updateColumnName(column.id, e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            updateColumnName(column.id, e.target.value);
                                        }
                                        if (e.key === 'Escape') {
                                            setEditingColumn(null);
                                        }
                                    }}
                                />
                            ) : (
                                <h3 
                                    id={`column-header-${column.id}`}
                                    onClick={() => !readOnly && setEditingColumn(column.id)}
                                >
                                    {column.name}
                                    <span className="card-count">{column.cards.length}</span>
                                </h3>
                            )}
                            {!readOnly && (
                                <div className="column-actions">
                                    <input
                                        type="color"
                                        value={column.color}
                                        onChange={(e) => updateColumnColor(column.id, e.target.value)}
                                        title="Change color"
                                        aria-label={`Change ${column.name} column color`}
                                    />
                                    <button 
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

                        <div className="column-cards" role="list" aria-label={`${column.name} cards`}>
                            {column.cards.map((card, index) => (
                                <div
                                    key={card.id}
                                    className={`kanban-card ${draggedCard?.card.id === card.id ? 'dragging' : ''}`}
                                    style={card.color ? { borderLeftColor: card.color } : {}}
                                    draggable={!readOnly && editingCard !== card.id}
                                    tabIndex={0}
                                    role="listitem"
                                    aria-label={`Card: ${card.title}${card.description ? '. ' + card.description.substring(0, 50) : ''}`}
                                    onDragStart={(e) => {
                                        // Don't start drag if clicking on input/textarea elements
                                        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || editingCard === card.id) {
                                            e.preventDefault();
                                            return;
                                        }
                                        !readOnly && handleDragStart(e, card, column.id);
                                    }}
                                    onDragEnd={!readOnly ? handleDragEnd : undefined}
                                    onDragOver={!readOnly ? (e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                    } : undefined}
                                    onDrop={!readOnly ? (e) => {
                                        e.stopPropagation();
                                        handleDrop(e, column.id, index);
                                    } : undefined}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !readOnly) {
                                            e.preventDefault();
                                            setEditingCard(card.id);
                                        } else if (e.key === 'Delete' && !readOnly) {
                                            e.preventDefault();
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
                                                        className="btn-edit-card"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
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
                                </div>
                            ))}
                        </div>

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
                    </div>
                ))}

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
                                    setShowNewColumn(false);
                                    setNewColumnName('');
                                }} aria-label="Cancel adding column">Cancel</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
            )}
        </div>
    );
};

export default React.memo(Kanban);
