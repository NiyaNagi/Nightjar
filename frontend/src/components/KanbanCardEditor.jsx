import React, { useRef, useState } from 'react';
import MiniToolbar from './MiniToolbar';

const KanbanCardEditor = ({ card, onUpdate, onDelete, onClose, onAddComment }) => {
    const [title, setTitle] = useState(card.title);
    const [description, setDescription] = useState(card.description || '');
    const [color, setColor] = useState(card.color || '#6366f1');
    const textareaRef = useRef(null);

    const handleSave = () => {
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
        <div className="card-edit" onClick={(e) => e.stopPropagation()}>
            <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={handleSave}
                placeholder="Card title"
                autoFocus
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        handleSave();
                        onClose();
                    }
                    if (e.key === 'Escape') {
                        onClose();
                    }
                }}
            />
            
            <MiniToolbar 
                textareaRef={textareaRef}
                onTextChange={(text) => {
                    setDescription(text);
                    onUpdate({ title, description: text, color: color !== '#6366f1' ? color : null });
                }}
            />
            
            <textarea
                ref={textareaRef}
                value={description}
                onChange={(e) => {
                    setDescription(e.target.value);
                    onUpdate({ title, description: e.target.value, color: color !== '#6366f1' ? color : null });
                }}
                placeholder="Description (Markdown supported)"
                rows={5}
            />
            
            <div className="card-edit-actions">
                <input
                    type="color"
                    value={color}
                    onChange={(e) => {
                        setColor(e.target.value);
                        onUpdate({ title, description, color: e.target.value });
                    }}
                    aria-label="Card color"
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
