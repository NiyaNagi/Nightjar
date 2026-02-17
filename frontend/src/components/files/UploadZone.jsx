/**
 * UploadZone
 * 
 * Drag-and-drop zone + click-to-upload area.
 * Wraps children, highlights on drag-over.
 * 
 * See docs/FILE_STORAGE_SPEC.md §6, §7.1
 */

import { useState, useCallback, useRef } from 'react';
import './UploadZone.css';

export default function UploadZone({
  children,
  onFilesSelected,
  disabled = false,
  className = '',
  multiple = true,
  accept,
}) {
  const [isDragging, setIsDragging] = useState(false);
  const dragCountRef = useRef(0);
  const fileInputRef = useRef(null);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    dragCountRef.current++;
    if (dragCountRef.current === 1) {
      setIsDragging(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current--;
    if (dragCountRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // Reset drag state when drag is cancelled (user presses Escape or leaves window)
  const handleDragEnd = useCallback(() => {
    dragCountRef.current = 0;
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current = 0;
    setIsDragging(false);
    if (disabled) return;

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      onFilesSelected?.(files);
    }
  }, [disabled, onFilesSelected]);

  const handleFileInputChange = useCallback((e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onFilesSelected?.(files);
    }
    // Reset input so same file can be re-selected
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [onFilesSelected]);

  const triggerFileInput = useCallback(() => {
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, [disabled]);

  return (
    <div
      className={`upload-zone ${isDragging ? 'upload-zone--dragging' : ''} ${disabled ? 'upload-zone--disabled' : ''} ${className}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDrop={handleDrop}
      data-testid="upload-zone"
    >
      {children}
      
      {isDragging && (
        <div className="upload-zone-overlay" data-testid="upload-zone-overlay">
          <div className="upload-zone-overlay-content">
            <span className="upload-zone-overlay-icon">📂</span>
            <p className="upload-zone-overlay-text">Drop files here to upload</p>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple={multiple}
        accept={accept}
        onChange={handleFileInputChange}
        className="upload-zone-input"
        data-testid="upload-zone-input"
        tabIndex={-1}
      />
    </div>
  );
}

/** Convenience export for the upload button to trigger */
UploadZone.TriggerButton = function UploadTriggerButton({ onClick, children, className = '', ...props }) {
  return (
    <button className={`upload-trigger-btn ${className}`} onClick={onClick} {...props}>
      {children || '📤 Upload'}
    </button>
  );
};
