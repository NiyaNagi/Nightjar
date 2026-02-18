/**
 * FileDetailPanel
 * 
 * Slide-out sidebar showing all file metadata.
 * Tags editor, description editor, distribution health detail.
 * 
 * See docs/FILE_STORAGE_SPEC.md §7.1
 */

import { useState, useCallback, useEffect } from 'react';
import FileTypeIcon from './FileTypeIcon';
import DistributionBadge from './DistributionBadge';
import { formatFileSize, getRelativeTime } from '../../utils/fileTypeCategories';
import { validateDescription, validateTag, MAX_TAGS_PER_FILE } from '../../utils/fileStorageValidation';
import { resolveUserName } from '../../utils/resolveUserName';
import ChatButton from '../common/ChatButton';
import './FileDetailPanel.css';

export default function FileDetailPanel({
  file,
  isOpen,
  onClose,
  chunkAvailability,
  userPublicKey,
  onUpdateFile,
  onDownload,
  onDelete,
  onToggleFavorite,
  collaborators,
  isFavorite = false,
  canEdit = true,
}) {
  const [editingDescription, setEditingDescription] = useState(false);
  const [description, setDescription] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [descError, setDescError] = useState(null);

  useEffect(() => {
    if (file) {
      setDescription(file.description || '');
      setEditingDescription(false);
      setTagInput('');
      setDescError(null);
    }
  }, [file?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- only reset on file switch, not description changes

  const handleSaveDescription = useCallback(() => {
    const validation = validateDescription(description);
    if (!validation.valid) {
      setDescError(validation.error);
      return;
    }
    onUpdateFile?.(file.id, { description });
    setEditingDescription(false);
    setDescError(null);
  }, [file, description, onUpdateFile]);

  const handleAddTag = useCallback(() => {
    const tag = tagInput.trim();
    if (!tag) return;
    const validation = validateTag(tag);
    if (!validation.valid) return;
    const tags = file.tags || [];
    if (tags.length >= MAX_TAGS_PER_FILE) return;
    if (tags.includes(tag)) return;
    onUpdateFile?.(file.id, { tags: [...tags, tag] });
    setTagInput('');
  }, [file, tagInput, onUpdateFile]);

  const handleRemoveTag = useCallback((tag) => {
    const tags = (file.tags || []).filter(t => t !== tag);
    onUpdateFile?.(file.id, { tags });
  }, [file, onUpdateFile]);

  const handleTagKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  }, [handleAddTag]);

  if (!isOpen || !file) return null;

  const uploaderName = file.uploadedBy
    ? resolveUserName(collaborators, file.uploadedBy, file.uploadedByName)
    : file.uploadedByName || 'Unknown';

  return (
    <div className="file-detail-overlay" onClick={onClose} data-testid="file-detail-overlay">
      <div className="file-detail-panel" onClick={e => e.stopPropagation()} data-testid="file-detail-panel">
        <div className="file-detail-header">
          <h3 className="file-detail-title">File Details</h3>
          <button className="file-detail-close" onClick={onClose} title="Close" data-testid="file-detail-close">✕</button>
        </div>

        <div className="file-detail-body">
          {/* File icon + name */}
          <div className="file-detail-identity">
            <FileTypeIcon extension={file.extension} size="xl" />
            <div className="file-detail-name-wrap">
              <h4 className="file-detail-name">{file.name}</h4>
              <span className="file-detail-ext">{file.extension?.toUpperCase() || 'FILE'}</span>
            </div>
          </div>

          {/* Quick actions */}
          <div className="file-detail-actions">
            <button className="file-detail-action-btn file-detail-action-primary" onClick={() => onDownload?.(file)} data-testid="detail-download">
              ⬇️ Download
            </button>
            <button className="file-detail-action-btn" onClick={() => onToggleFavorite?.(file.id)} data-testid="detail-favorite">
              {isFavorite ? '⭐ Unfavorite' : '☆ Favorite'}
            </button>
            {canEdit && (
              <button className="file-detail-action-btn file-detail-action-danger" onClick={() => onDelete?.(file.id)} data-testid="detail-delete">
                🗑️ Delete
              </button>
            )}
          </div>

          {/* Metadata */}
          <div className="file-detail-section">
            <h5 className="file-detail-section-title">Info</h5>
            <div className="file-detail-meta-grid">
              <span className="file-detail-meta-label">Size</span>
              <span className="file-detail-meta-value">{formatFileSize(file.sizeBytes)}</span>
              <span className="file-detail-meta-label">Type</span>
              <span className="file-detail-meta-value">{file.typeCategory || 'other'}</span>
              <span className="file-detail-meta-label">Uploaded by</span>
              <span className="file-detail-meta-value">
                {uploaderName}
                <ChatButton
                  publicKey={file.uploadedBy}
                  name={uploaderName}
                  collaborators={collaborators}
                  onStartChatWith={null}
                  currentUserKey={userPublicKey}
                />
              </span>
              <span className="file-detail-meta-label">Created</span>
              <span className="file-detail-meta-value">{getRelativeTime(file.createdAt)}</span>
              <span className="file-detail-meta-label">Modified</span>
              <span className="file-detail-meta-value">{getRelativeTime(file.updatedAt || file.createdAt)}</span>
              <span className="file-detail-meta-label">Chunks</span>
              <span className="file-detail-meta-value">{file.chunkCount}</span>
              <span className="file-detail-meta-label">Version</span>
              <span className="file-detail-meta-value">{file.version || 1}</span>
            </div>
          </div>

          {/* Distribution */}
          <div className="file-detail-section">
            <h5 className="file-detail-section-title">Distribution</h5>
            <div className="file-detail-distribution">
              <DistributionBadge
                fileId={file.id}
                chunkCount={file.chunkCount}
                chunkAvailability={chunkAvailability}
                userPublicKey={userPublicKey}
              />
            </div>
          </div>

          {/* Description */}
          <div className="file-detail-section">
            <div className="file-detail-section-header">
              <h5 className="file-detail-section-title">Description</h5>
              {!editingDescription && canEdit && (
                <button className="file-detail-edit-btn" onClick={() => setEditingDescription(true)} data-testid="detail-edit-desc">
                  ✏️
                </button>
              )}
            </div>
            {editingDescription ? (
              <div className="file-detail-desc-edit">
                <textarea
                  className="file-detail-desc-input"
                  value={description}
                  onChange={e => { setDescription(e.target.value); setDescError(null); }}
                  rows={3}
                  placeholder="Add a description..."
                  data-testid="detail-desc-textarea"
                />
                {descError && <span className="file-detail-error">{descError}</span>}
                <div className="file-detail-desc-actions">
                  <button className="file-detail-save-btn" onClick={handleSaveDescription} data-testid="detail-desc-save">Save</button>
                  <button className="file-detail-cancel-btn" onClick={() => { setEditingDescription(false); setDescription(file.description || ''); }} data-testid="detail-desc-cancel">Cancel</button>
                </div>
              </div>
            ) : (
              <p className="file-detail-desc-text">{file.description || 'No description'}</p>
            )}
          </div>

          {/* Tags */}
          <div className="file-detail-section">
            <h5 className="file-detail-section-title">Tags</h5>
            <div className="file-detail-tags">
              {(file.tags || []).map(tag => (
                <span key={tag} className="file-detail-tag">
                  {tag}
                  {canEdit && (
                    <button onClick={() => handleRemoveTag(tag)} className="file-detail-tag-remove" data-testid={`detail-tag-remove-${tag}`}>✕</button>
                  )}
                </span>
              ))}
              {canEdit && (
                <div className="file-detail-tag-input-wrap">
                  <input
                    className="file-detail-tag-input"
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={handleTagKeyDown}
                    placeholder="Add tag..."
                    maxLength={50}
                    data-testid="detail-tag-input"
                  />
                  <button className="file-detail-tag-add" onClick={handleAddTag} data-testid="detail-tag-add">+</button>
                </div>
              )}
            </div>
          </div>

          {/* Hash */}
          <div className="file-detail-section">
            <h5 className="file-detail-section-title">File Hash</h5>
            <code className="file-detail-hash">{file.fileHash || 'N/A'}</code>
          </div>
        </div>
      </div>
    </div>
  );
}
