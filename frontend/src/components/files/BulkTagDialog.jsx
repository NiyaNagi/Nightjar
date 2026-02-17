/**
 * BulkTagDialog
 * 
 * Modal for adding or replacing tags on multiple files at once.
 * Two modes: "add" (union with existing) and "replace" (overwrite).
 * 
 * Reuses the same validation from fileStorageValidation.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { validateTag, MAX_TAGS_PER_FILE } from '../../utils/fileStorageValidation';
import './BulkTagDialog.css';

export default function BulkTagDialog({
  isOpen,
  selectedFiles,       // array of file objects (with .id, .tags)
  onApply,             // (fileId, { tags }) => void — called per file
  onClose,
}) {
  const [mode, setMode] = useState('add'); // 'add' | 'replace'
  const [tags, setTags] = useState([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setTags([]);
      setInput('');
      setError(null);
      setMode('add');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const handleAddTag = useCallback(() => {
    const tag = input.trim().toLowerCase();
    if (!tag) return;
    const validation = validateTag(tag);
    if (!validation.valid) {
      setError(validation.error);
      return;
    }
    if (tags.includes(tag)) {
      setError('Tag already added');
      return;
    }
    if (tags.length >= MAX_TAGS_PER_FILE) {
      setError(`Maximum ${MAX_TAGS_PER_FILE} tags`);
      return;
    }
    setTags(prev => [...prev, tag]);
    setInput('');
    setError(null);
  }, [input, tags]);

  const handleRemoveTag = useCallback((tag) => {
    setTags(prev => prev.filter(t => t !== tag));
  }, []);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  }, [handleAddTag]);

  const handleApply = useCallback(() => {
    if (!selectedFiles?.length) return;

    for (const file of selectedFiles) {
      let newTags;
      if (mode === 'replace') {
        newTags = [...tags];
      } else {
        // Add mode: union existing + new
        const existing = file.tags || [];
        newTags = [...new Set([...existing, ...tags])];
        // Respect max
        newTags = newTags.slice(0, MAX_TAGS_PER_FILE);
      }
      onApply?.(file.id, { tags: newTags });
    }
    onClose();
  }, [selectedFiles, mode, tags, onApply, onClose]);

  const handleOverlayClick = useCallback((e) => {
    if (e.target === e.currentTarget) onClose?.();
  }, [onClose]);

  if (!isOpen) return null;

  const fileCount = selectedFiles?.length || 0;

  return (
    <div className="bulk-tag-overlay" onClick={handleOverlayClick} data-testid="bulk-tag-overlay">
      <div className="bulk-tag-dialog" onClick={e => e.stopPropagation()} data-testid="bulk-tag-dialog">
        <h3 className="bulk-tag-title">Edit Tags — {fileCount} file{fileCount !== 1 ? 's' : ''}</h3>

        <div className="bulk-tag-mode">
          <label className="bulk-tag-mode-option">
            <input
              type="radio"
              name="tagMode"
              value="add"
              checked={mode === 'add'}
              onChange={() => setMode('add')}
              data-testid="bulk-tag-mode-add"
            />
            <span>Add to existing tags</span>
          </label>
          <label className="bulk-tag-mode-option">
            <input
              type="radio"
              name="tagMode"
              value="replace"
              checked={mode === 'replace'}
              onChange={() => setMode('replace')}
              data-testid="bulk-tag-mode-replace"
            />
            <span>Replace all tags</span>
          </label>
        </div>

        <div className="bulk-tag-input-row">
          <input
            ref={inputRef}
            type="text"
            className="bulk-tag-input"
            value={input}
            onChange={e => { setInput(e.target.value); setError(null); }}
            onKeyDown={handleKeyDown}
            placeholder="Type a tag and press Enter"
            data-testid="bulk-tag-input"
          />
          <button
            className="bulk-tag-add-btn"
            onClick={handleAddTag}
            disabled={!input.trim()}
            data-testid="bulk-tag-add-btn"
          >
            +
          </button>
        </div>

        {error && <p className="bulk-tag-error" data-testid="bulk-tag-error">{error}</p>}

        {tags.length > 0 && (
          <div className="bulk-tag-chips" data-testid="bulk-tag-chips">
            {tags.map(tag => (
              <span key={tag} className="bulk-tag-chip">
                {tag}
                <button className="bulk-tag-chip-remove" onClick={() => handleRemoveTag(tag)} title="Remove">✕</button>
              </span>
            ))}
          </div>
        )}

        {mode === 'replace' && (
          <p className="bulk-tag-warning">
            ⚠️ This will replace all existing tags on the selected files.
          </p>
        )}

        <div className="bulk-tag-actions">
          <button className="bulk-tag-cancel" onClick={onClose} data-testid="bulk-tag-cancel">Cancel</button>
          <button
            className="bulk-tag-apply"
            onClick={handleApply}
            disabled={tags.length === 0}
            data-testid="bulk-tag-apply"
          >
            Apply to {fileCount} file{fileCount !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
