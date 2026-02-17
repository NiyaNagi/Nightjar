/**
 * FolderCreateDialog
 * 
 * Modal dialog for creating a new folder.
 * Name input + optional color + optional icon.
 * Validates nesting depth (max 10).
 * 
 * See docs/FILE_STORAGE_SPEC.md §5.5
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { validateFolderName, validateFolderDepth } from '../../utils/fileStorageValidation';
import './FolderCreateDialog.css';

export default function FolderCreateDialog({
  isOpen,
  onClose,
  onCreateFolder,
  parentId = null,
  allFolders = [],
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [icon, setIcon] = useState('');
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setColor('');
      setIcon('');
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const handleCreate = useCallback(() => {
    const nameValidation = validateFolderName(name);
    if (!nameValidation.valid) {
      setError(nameValidation.error);
      return;
    }

    const depthValidation = validateFolderDepth(parentId, allFolders);
    if (!depthValidation.valid) {
      setError(depthValidation.error);
      return;
    }

    // Check for duplicate folder name in same parent
    const duplicate = allFolders.some(
      f => f.name === name.trim() && f.parentId === parentId && !f.deletedAt
    );
    if (duplicate) {
      setError('A folder with this name already exists here');
      return;
    }

    onCreateFolder?.({
      name: name.trim(),
      parentId,
      color: color || null,
      icon: icon || null,
    });
    onClose();
  }, [name, color, icon, parentId, allFolders, onCreateFolder, onClose]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') handleCreate();
    if (e.key === 'Escape') onClose();
  }, [handleCreate, onClose]);

  if (!isOpen) return null;

  const FOLDER_COLORS = ['#89b4fa', '#a6e3a1', '#fab387', '#f38ba8', '#cba6f7', '#f9e2af', '#94e2d5', '#f5c2e7'];
  const FOLDER_ICONS = ['📁', '📂', '🗂️', '📦', '🎯', '💡', '🔬', '📊', '🎨', '🎵', '🎬', '📝'];

  return (
    <div className="folder-create-overlay" onClick={onClose} data-testid="folder-create-overlay">
      <div className="folder-create-dialog" onClick={e => e.stopPropagation()} data-testid="folder-create-dialog">
        <h3 className="folder-create-title">New Folder</h3>
        
        <div className="folder-create-field">
          <label className="folder-create-label">Name</label>
          <input
            ref={inputRef}
            className="folder-create-input"
            value={name}
            onChange={e => { setName(e.target.value); setError(null); }}
            onKeyDown={handleKeyDown}
            placeholder="Folder name"
            maxLength={100}
            data-testid="folder-create-name-input"
          />
        </div>

        <div className="folder-create-field">
          <label className="folder-create-label">Color (optional)</label>
          <div className="folder-create-colors">
            {FOLDER_COLORS.map(c => (
              <button
                key={c}
                className={`folder-create-color-btn ${color === c ? 'folder-create-color-btn--selected' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(color === c ? '' : c)}
                title={c}
                data-testid={`folder-color-${c}`}
              />
            ))}
          </div>
        </div>

        <div className="folder-create-field">
          <label className="folder-create-label">Icon (optional)</label>
          <div className="folder-create-icons">
            {FOLDER_ICONS.map(ic => (
              <button
                key={ic}
                className={`folder-create-icon-btn ${icon === ic ? 'folder-create-icon-btn--selected' : ''}`}
                onClick={() => setIcon(icon === ic ? '' : ic)}
                data-testid={`folder-icon-${ic}`}
              >
                {ic}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="folder-create-error" data-testid="folder-create-error">{error}</p>}

        <div className="folder-create-actions">
          <button className="folder-create-cancel" onClick={onClose} data-testid="folder-create-cancel">Cancel</button>
          <button className="folder-create-submit" onClick={handleCreate} disabled={!name.trim()} data-testid="folder-create-submit">
            Create Folder
          </button>
        </div>
      </div>
    </div>
  );
}
