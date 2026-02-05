import React, { useState, useEffect, useCallback, useRef } from 'react';
import KanbanCardEditor from './KanbanCardEditor';
import SimpleMarkdown from './SimpleMarkdown';
import './Kanban.css';

const generateId = () => Date.now().toString(36) + Math.random().toString(36).substring(2, 11);

const Kanban = ({ ydoc, provider, userColor, readOnly = false, onAddComment }) => {
    const [columns, setColumns] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [draggedCard, setDraggedCard] = useState(null);
    const [draggedColumn, setDraggedColumn] = useState(null);
    const [editingCard, setEditingCard] = useState(null);
    const [editingColumn, setEditingColumn] = useState(null);
    const [newColumnName, setNewColumnName] = useState('');
    const [showNewColumn, setShowNewColumn] = useState(false);
    const ykanbanRef = useRef(null);

    // Initialize Yjs map for kanban data
    useEffect(() => {
        if (!ydoc) return;
        
        const ykanban = ydoc.getMap('kanban');
        ykanbanRef.current = ykanban;

        const updateFromYjs = () => {
            const data = ykanban.get('columns');
            if (data) {
                setColumns(JSON.parse(JSON.stringify(data)));
            } else {
                // Initialize with default columns
                const defaultColumns = [
                    { id: generateId(), name: 'To Do', color: '#6366f1', cards: [] },
                    { id: generateId(), name: 'In Progress', color: '#f59e0b', cards: [] },
                    { id: generateId(), name: 'Done', color: '#22c55e', cards: [] }
                ];
                ykanban.set('columns', defaultColumns);
                setColumns(defaultColumns);
            }
            setIsLoading(false);
        };

        ykanban.observe(updateFromYjs);
        updateFromYjs();

        return () => {
            ykanban.unobserve(updateFromYjs);
        };
    }, [ydoc]);

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

    const deleteColumn = useCallback((columnId) => {
        const newColumns = columns.filter(c => c.id !== columnId);
        setColumns(newColumns);
        saveToYjs(newColumns);
    }, [columns, saveToYjs]);

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

    const deleteCard = useCallback((columnId, cardId) => {
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
    }, [columns, saveToYjs]);

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
        <div className={`kanban-container ${readOnly ? 'kanban-container--readonly' : ''}`}>
            <div className="kanban-header">
                <h2>Kanban Board</h2>
                {readOnly && (
                    <span className="readonly-badge">📖 View Only</span>
                )}
                {!readOnly && (
                    <div className="kanban-actions">
                        <button 
                            type="button"
                            className="btn-add-column"
                            onClick={() => setShowNewColumn(true)}
                            disabled={isLoading}
                        >
                            + Add Column
                        </button>
                    </div>
                )}
            </div>

            {isLoading ? (
                <div className="kanban-loading">
                    <div className="kanban-loading__spinner"></div>
                    <p>Loading board...</p>
                </div>
            ) : (
            <div className="kanban-board">
                {columns.map((column) => (
                    <div
                        key={column.id}
                        className="kanban-column"
                        style={{ '--column-color': column.color }}
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
                                <h3 onClick={() => !readOnly && setEditingColumn(column.id)}>
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

                        <div className="column-cards">
                            {column.cards.map((card, index) => (
                                <div
                                    key={card.id}
                                    className={`kanban-card ${draggedCard?.card.id === card.id ? 'dragging' : ''}`}
                                    style={card.color ? { borderLeftColor: card.color } : {}}
                                    draggable={!readOnly}
                                    onDragStart={(e) => !readOnly && handleDragStart(e, card, column.id)}
                                    onDragEnd={!readOnly ? handleDragEnd : undefined}
                                    onDragOver={!readOnly ? (e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                    } : undefined}
                                    onDrop={!readOnly ? (e) => {
                                        e.stopPropagation();
                                        handleDrop(e, column.id, index);
                                    } : undefined}
                                >
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
                        <div className="new-column-form">
                            <input
                                type="text"
                                value={newColumnName}
                                onChange={(e) => setNewColumnName(e.target.value)}
                                placeholder="Column name..."
                                autoFocus
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') addColumn();
                                    if (e.key === 'Escape') {
                                        setShowNewColumn(false);
                                        setNewColumnName('');
                                    }
                                }}
                            />
                            <div className="new-column-actions">
                                <button type="button" onClick={addColumn}>Add</button>
                                <button type="button" onClick={() => {
                                    setShowNewColumn(false);
                                    setNewColumnName('');
                                }}>Cancel</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
            )}
        </div>
    );
};

export default Kanban;
