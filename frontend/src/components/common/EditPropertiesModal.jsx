/**
 * EditPropertiesModal Component
 * 
 * Modal for editing folder/document icon and color
 */

import React, { useState, useEffect } from 'react';
import IconColorPicker from './IconColorPicker';
import { ensureContrastWithWhite, createColorGradient } from '../../utils/colorUtils';
import './EditPropertiesModal.css';

export default function EditPropertiesModal({
    isOpen,
    onClose,
    item, // { id, name, icon, color, type: 'folder' | 'document' }
    onSave,
    parentFolder = null, // For gradient previews when editing documents
}) {
    const [icon, setIcon] = useState(item?.icon || (item?.type === 'folder' ? '📁' : '📄'));
    const [color, setColor] = useState(item?.color || null);
    const [isSaving, setIsSaving] = useState(false);
    
    // Sync local state when item changes (e.g., when modal opens with a new item)
    useEffect(() => {
        if (item) {
            setIcon(item.icon || (item.type === 'folder' ? '📁' : '📄'));
            setColor(item.color || null);
        }
    }, [item?.id, item?.icon, item?.color, item?.type]);
    
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
                    <div className="edit-properties-modal__content">
                        <div className="edit-properties-modal__field">
                            <label className="edit-properties-modal__label">Name</label>
                            <div className="edit-properties-modal__name">
                                {item.name}
                            </div>
                        </div>
                        
                        <div className="edit-properties-modal__field">
                            <label className="edit-properties-modal__label">Appearance</label>
                            <div className="edit-properties-modal__picker-compact">
                                <IconColorPicker
                                    icon={icon}
                                    color={color}
                                    onIconChange={setIcon}
                                    onColorChange={setColor}
                                    size="medium"
                                    showColorPreview={false}
                                    compact={true}
                                />
                            </div>
                        </div>
                    </div>
                    
                    <div className="edit-properties-modal__preview">
                        <div className="edit-properties-modal__preview-header">
                            <h4 className="edit-properties-modal__preview-title">Preview</h4>
                        </div>
                        
                        {/* Sidebar Preview */}
                        <div className="edit-properties-modal__preview-section">
                            <label className="edit-properties-modal__preview-label">In Sidebar:</label>
                            <div className="edit-properties-modal__sidebar-preview">
                                {item.type === 'document' && parentFolder && (
                                    <div className="preview-folder-context">
                                        <div className="preview-tree-item preview-tree-item--folder">
                                            <span className="preview-tree-toggle">▶</span>
                                            <span className="preview-tree-icon">{parentFolder.icon || '📁'}</span>
                                            <span className="preview-tree-name">{parentFolder.name}</span>
                                        </div>
                                    </div>
                                )}
                                <div 
                                    className={`preview-tree-item preview-tree-item--${item.type} ${item.type === 'document' && parentFolder ? 'preview-tree-item--nested' : ''}`}
                                    style={{
                                        background: item.type === 'document' && parentFolder?.color && color
                                            ? createColorGradient(parentFolder.color, color, 0.25)
                                            : color ? ensureContrastWithWhite(color, 0.3) : undefined,
                                        paddingLeft: item.type === 'document' && parentFolder ? '32px' : '12px'
                                    }}
                                >
                                    {item.type === 'document' && <span className="preview-tree-spacer"></span>}
                                    <span className="preview-tree-icon">{icon}</span>
                                    <span className="preview-tree-name">{item.name}</span>
                                    <div className="preview-tree-actions">
                                        <button className="preview-tree-edit" title="Edit properties">⚙️</button>
                                        <button className="preview-tree-delete" title="Delete">🗑</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        {/* Tab Preview */}
                        {item.type === 'document' && (
                            <div className="edit-properties-modal__preview-section">
                                <label className="edit-properties-modal__preview-label">As Tab:</label>
                                <div className="edit-properties-modal__tab-preview">
                                    <div 
                                        className="preview-tab preview-tab--active"
                                        style={{
                                            background: parentFolder?.color && color
                                                ? createColorGradient(parentFolder.color, color, 0.25)
                                                : color ? ensureContrastWithWhite(color, 0.3) : undefined
                                        }}
                                    >
                                        <span className="preview-tab-name">{item.name}</span>
                                        <span className="preview-tab-unsaved">●</span>
                                        <button className="preview-tab-close" title="Close tab">✕</button>
                                    </div>
                                </div>
                            </div>
                        )}
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
