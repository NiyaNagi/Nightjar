import React, { useRef, useState, useEffect } from 'react';
import MiniToolbar from './MiniToolbar';
import { UnifiedPicker } from './common';

const KanbanCardEditor = ({ card, onUpdate, onDelete, onClose, onAddComment }) => {
    const [title, setTitle] = useState(card.title);
    const [description, setDescription] = useState(card.description || '');
    const [color, setColor] = useState(card.color || '#6366f1');
    const textareaRef = useRef(null);
    const cancelledRef = useRef(false);
    const [now, setNow] = useState(Date.now());

    // Only re-sync when switching to a different card; preserve local edits
    // during remote updates to the same card to avoid overwriting in-progress work
    useEffect(() => {
        setTitle(card.title);
        setDescription(card.description || '');
        setColor(card.color || '#6366f1');
    }, [card.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // Keep relative time display updated every minute
    useEffect(() => {
        if (!card.createdAt) return;
        const interval = setInterval(() => setNow(Date.now()), 60_000);
        return () => clearInterval(interval);
    }, [card.createdAt]);

    const getRelativeTime = (timestamp) => {
        if (!timestamp) return '';
        const diff = now - timestamp;
        const minutes = Math.floor(diff / 60000);
        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    };

    const handleSave = () => {
        if (cancelledRef.current) return;
        onUpdate({ 
            title, 
            description, 
            color: color !== '#6366f1' ? color : null 
        });
    };

    const handleAddComment = () => {
        if (onAddComment) {
            onAddComment({
                type: 'card',
                cardId: card.id,
                cardTitle: title,
            });
        }
    };

    return (
        <div 
            className="card-edit" 
            onClick={(e) => e.stopPropagation()}
            onDragStart={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
        >
            <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={handleSave}
                placeholder="Card title"
                autoFocus
                draggable={false}
                onDragStart={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        handleSave();
                        onClose();
                    }
                    if (e.key === 'Escape') {
                        cancelledRef.current = true;
                        onClose();
                    }
                }}
            />
            
            <MiniToolbar 
                textareaRef={textareaRef}
                onTextChange={(text) => {
                    setDescription(text);
                }}
            />
            
            <textarea
                ref={textareaRef}
                value={description}
                draggable={false}
                onDragStart={(e) => e.stopPropagation()}
                onChange={(e) => {
                    setDescription(e.target.value);
                }}
                onBlur={() => {
                    if (!cancelledRef.current) {
                        onUpdate({ title, description, color: color !== '#6366f1' ? color : null });
                    }
                }}
                onKeyDown={(e) => {
                    // Allow Enter key to create new lines - don't let it propagate to parent
                    if (e.key === 'Enter') {
                        e.stopPropagation();
                    }
                    // Escape closes the editor
                    if (e.key === 'Escape') {
                        cancelledRef.current = true;
                        onClose();
                    }
                }}
                placeholder="Description (Markdown supported)"
                rows={5}
            />
            
            {card.createdAt && (
                <span className="card-created-time" title={new Date(card.createdAt).toLocaleString()}>
                    Created {getRelativeTime(card.createdAt)}
                </span>
            )}

            <div className="card-edit-actions">
                <UnifiedPicker
                    mode="color"
                    color={color}
                    onColorChange={(c) => {
                        setColor(c);
                        onUpdate({ title, description, color: c });
                    }}
                    size="small"
                />
                <button 
                    type="button"
                    className="btn-comment"
                    onClick={handleAddComment}
                    title="Add comment to this card"
                >
                    💬
                </button>
                <button type="button" onClick={onClose}>Done</button>
                <button 
                    type="button"
                    className="btn-delete"
                    onClick={onDelete}
                >
                    Delete
                </button>
            </div>
        </div>
    );
};

export default KanbanCardEditor;
