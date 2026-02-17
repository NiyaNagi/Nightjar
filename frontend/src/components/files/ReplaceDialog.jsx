/**
 * ReplaceDialog
 * 
 * Upload collision dialog: Replace / Keep Both / Cancel
 * 
 * See docs/FILE_STORAGE_SPEC.md §5.2
 */

import './ReplaceDialog.css';

export default function ReplaceDialog({
  isOpen,
  fileName,
  onReplace,
  onKeepBoth,
  onCancel,
}) {
  if (!isOpen) return null;

  return (
    <div className="replace-dialog-overlay" onClick={onCancel} data-testid="replace-dialog-overlay">
      <div className="replace-dialog" onClick={e => e.stopPropagation()} data-testid="replace-dialog">
        <div className="replace-dialog-icon">⚠️</div>
        <h3 className="replace-dialog-title">File Already Exists</h3>
        <p className="replace-dialog-message">
          A file named <strong>"{fileName}"</strong> already exists in this folder.
        </p>
        <div className="replace-dialog-actions">
          <button className="replace-dialog-btn replace-dialog-btn--danger" onClick={onReplace} data-testid="replace-btn-replace">
            Replace
          </button>
          <button className="replace-dialog-btn replace-dialog-btn--secondary" onClick={onKeepBoth} data-testid="replace-btn-keep">
            Keep Both
          </button>
          <button className="replace-dialog-btn replace-dialog-btn--cancel" onClick={onCancel} data-testid="replace-btn-cancel">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
