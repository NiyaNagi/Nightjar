/**
 * UploadProgress
 * 
 * Shows active upload progress bars in a collapsible panel.
 * 
 * See docs/FILE_STORAGE_SPEC.md §6
 */

import { useMemo } from 'react';
import { UPLOAD_STATUS } from '../../utils/chunkStore';
import { formatFileSize } from '../../utils/fileTypeCategories';
import './UploadProgress.css';

export default function UploadProgress({ uploads, onClear, onClearCompleted }) {
  const activeUploads = useMemo(
    () => uploads.filter(u => u.status !== UPLOAD_STATUS.COMPLETE && u.status !== UPLOAD_STATUS.ERROR),
    [uploads]
  );
  const completedUploads = useMemo(
    () => uploads.filter(u => u.status === UPLOAD_STATUS.COMPLETE || u.status === UPLOAD_STATUS.ERROR),
    [uploads]
  );

  if (uploads.length === 0) return null;

  const getStatusLabel = (status) => {
    switch (status) {
      case UPLOAD_STATUS.READING: return 'Reading...';
      case UPLOAD_STATUS.CHUNKING: return 'Chunking...';
      case UPLOAD_STATUS.ENCRYPTING: return 'Encrypting...';
      case UPLOAD_STATUS.STORING: return 'Storing...';
      case UPLOAD_STATUS.COMPLETE: return 'Complete';
      case UPLOAD_STATUS.ERROR: return 'Failed';
      default: return 'Queued';
    }
  };

  const getProgress = (upload) => {
    if (!upload.totalChunks || upload.totalChunks === 0) return 0;
    return Math.min(100, Math.round((upload.chunksProcessed / upload.totalChunks) * 100));
  };

  return (
    <div className="upload-progress" data-testid="upload-progress">
      <div className="upload-progress-header">
        <span className="upload-progress-title">
          {activeUploads.length > 0
            ? `Uploading ${activeUploads.length} file${activeUploads.length !== 1 ? 's' : ''}...`
            : `${completedUploads.length} upload${completedUploads.length !== 1 ? 's' : ''} finished`
          }
        </span>
        {completedUploads.length > 0 && (
          <button
            className="upload-progress-clear-btn"
            onClick={onClearCompleted}
            data-testid="upload-clear-completed"
          >
            Clear
          </button>
        )}
      </div>
      <div className="upload-progress-list">
        {uploads.map(upload => (
          <div
            key={upload.uploadId}
            className={`upload-progress-item upload-progress-item--${upload.status}`}
            data-testid={`upload-item-${upload.uploadId}`}
          >
            <div className="upload-progress-item-info">
              <span className="upload-progress-item-name" title={upload.fileName}>
                {upload.fileName}
              </span>
              <span className="upload-progress-item-meta">
                {upload.status === UPLOAD_STATUS.ERROR
                  ? upload.error
                  : `${formatFileSize(upload.fileSize)} · ${getStatusLabel(upload.status)}`
                }
              </span>
            </div>
            {upload.status !== UPLOAD_STATUS.COMPLETE && upload.status !== UPLOAD_STATUS.ERROR && (
              <div className="upload-progress-bar-wrap">
                <div
                  className="upload-progress-bar"
                  style={{ width: `${getProgress(upload)}%` }}
                />
              </div>
            )}
            {upload.status === UPLOAD_STATUS.COMPLETE && (
              <span className="upload-progress-done-icon">✅</span>
            )}
            {upload.status === UPLOAD_STATUS.ERROR && (
              <span className="upload-progress-error-icon">❌</span>
            )}
            {(upload.status === UPLOAD_STATUS.COMPLETE || upload.status === UPLOAD_STATUS.ERROR) && (
              <button
                className="upload-progress-dismiss"
                onClick={() => onClear?.(upload.uploadId)}
                title="Dismiss"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
