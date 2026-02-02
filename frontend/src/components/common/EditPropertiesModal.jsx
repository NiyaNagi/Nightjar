/**
 * EditPropertiesModal Component
 * 
 * Modal for editing folder/document icon and color
 */

import React, { useState } from 'react';
import IconColorPicker from './IconColorPicker';
import './EditPropertiesModal.css';

export default function EditPropertiesModal({
    isOpen,
    onClose,
    item, // { id, name, icon, color, type: 'folder' | 'document' }
    onSave,
}) {
    const [icon, setIcon] = useState(item?.icon || (item?.type === 'folder' ? '📁' : '📄'));
    const [color, setColor] = useState(item?.color || '#6366f1');
    const [isSaving, setIsSaving] = useState(false);
    
    if (!isOpen || !item) return null;
    
    const handleSave = async () => {
        setIsSaving(true);
        try {
            await onSave?.({ id: item.id, type: item.type, icon, color });
            onClose();
        } catch (error) {
            console.error('Failed to save properties:', error);
        } finally {
            setIsSaving(false);
        }
    };
    
    const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
            onClose();
        }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            handleSave();
        }
    };
    
    return (
        <div className="edit-properties-modal__overlay" onClick={onClose} onKeyDown={handleKeyDown}>
            <div className="edit-properties-modal" onClick={(e) => e.stopPropagation()}>
                <div className="edit-properties-modal__header">
                    <h3 className="edit-properties-modal__title">
                        Edit {item.type === 'folder' ? 'Folder' : 'Document'} Properties
                    </h3>
                    <button 
                        className="edit-properties-modal__close"
                        onClick={onClose}
                        aria-label="Close"
                    >
                        ×
                    </button>
                </div>
                
                <div className="edit-properties-modal__body">
                    <div className="edit-properties-modal__field">
                        <label className="edit-properties-modal__label">Name</label>
                        <div className="edit-properties-modal__name">
                            {item.name}
                        </div>
                    </div>
                    
                    <div className="edit-properties-modal__field">
                        <label className="edit-properties-modal__label">Icon & Color</label>
                        <div className="edit-properties-modal__picker">
                            <IconColorPicker
                                icon={icon}
                                color={color}
                                onIconChange={setIcon}
                                onColorChange={setColor}
                                size="large"
                                showColorPreview={true}
                            />
                        </div>
                    </div>
                    
                    <div className="edit-properties-modal__preview">
                        <div 
                            className="edit-properties-modal__preview-item"
                            style={{ backgroundColor: `${color}20`, borderColor: color }}
                        >
                            <span className="edit-properties-modal__preview-icon">{icon}</span>
                            <span className="edit-properties-modal__preview-name">{item.name}</span>
                        </div>
                    </div>
                </div>
                
                <div className="edit-properties-modal__footer">
                    <button 
                        className="edit-properties-modal__btn edit-properties-modal__btn--cancel"
                        onClick={onClose}
                        disabled={isSaving}
                    >
                        Cancel
                    </button>
                    <button 
                        className="edit-properties-modal__btn edit-properties-modal__btn--save"
                        onClick={handleSave}
                        disabled={isSaving}
                    >
                        {isSaving ? 'Saving...' : 'Save'}
                    </button>
                </div>
            </div>
        </div>
    );
}
