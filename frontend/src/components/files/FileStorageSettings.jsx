/**
 * FileStorageSettings
 * 
 * Admin settings form for the file storage system.
 * Storage Name, Max File Size, Auto-delete period,
 * Chunk redundancy, Empty Trash Now, Delete All Files danger zone.
 * 
 * See docs/FILE_STORAGE_SPEC.md §5.10
 */

import { useState, useCallback, useEffect } from 'react';
import { formatFileSize } from '../../utils/fileTypeCategories';
import {
  MAX_FILE_SIZE,
  DEFAULT_AUTO_DELETE_DAYS,
  DEFAULT_CHUNK_REDUNDANCY_TARGET,
} from '../../utils/fileStorageValidation';
import { useConfirmDialog } from '../common/ConfirmDialog';
import './FileStorageSettings.css';

export default function FileStorageSettings({
  currentSystem,
  settings,
  role,
  onUpdateSettings,
  onEmptyTrash,
  onDeleteAllFiles,
  trashedCount,
}) {
  const [localSettings, setLocalSettings] = useState({});
  const [dirty, setDirty] = useState(false);
  const { confirm, ConfirmDialogComponent } = useConfirmDialog();

  useEffect(() => {
    if (settings) {
      setLocalSettings(prev => {
        // Don't overwrite local edits if the form is dirty
        if (dirty) return prev;
        return { ...settings };
      });
      // Only reset dirty flag if we actually applied the incoming settings
      setDirty(prev => prev ? prev : false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const handleChange = useCallback((key, value) => {
    setLocalSettings(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  const handleSave = useCallback(() => {
    onUpdateSettings?.(localSettings);
    setDirty(false);
  }, [localSettings, onUpdateSettings]);

  const handleEmptyTrash = useCallback(async () => {
    const confirmed = await confirm({
      title: 'Empty Trash',
      message: 'Permanently delete all items in trash? This cannot be undone.',
      confirmText: 'Empty Trash',
      variant: 'danger'
    });
    if (confirmed) onEmptyTrash?.();
  }, [onEmptyTrash, confirm]);

  const handleDeleteAll = useCallback(async () => {
    const firstConfirm = await confirm({
      title: 'Delete All Files',
      message: 'Delete ALL files and folders permanently? This action cannot be undone and all data will be lost.',
      confirmText: 'Continue',
      variant: 'danger'
    });
    if (!firstConfirm) return;
    const finalConfirm = await confirm({
      title: '⚠️ Final Confirmation',
      message: 'This is your last chance to cancel. ALL files and folders will be permanently destroyed. Are you absolutely sure?',
      confirmText: 'Delete Everything',
      variant: 'danger'
    });
    if (finalConfirm) onDeleteAllFiles?.();
  }, [onDeleteAllFiles, confirm]);

  const isAdmin = role === 'admin';

  return (
    <div className="settings-view" data-testid="settings-view">
      {ConfirmDialogComponent}
      <div className="settings-header">
        <h3 className="settings-title">⚙️ Settings</h3>
        {dirty && isAdmin && (
          <button className="settings-save-btn" onClick={handleSave} data-testid="settings-save">
            Save Changes
          </button>
        )}
      </div>

      <div className="settings-body">
        {/* Storage Name */}
        <div className="settings-field">
          <label className="settings-label">Storage Name</label>
          <input
            className="settings-input"
            value={localSettings.name || currentSystem?.name || ''}
            onChange={e => handleChange('name', e.target.value)}
            disabled={!isAdmin}
            maxLength={100}
            data-testid="settings-name"
          />
          <span className="settings-hint">Display name for this file storage</span>
        </div>

        {/* Max File Size */}
        <div className="settings-field">
          <label className="settings-label">Max File Size</label>
          <select
            className="settings-select"
            value={localSettings.maxFileSize || MAX_FILE_SIZE}
            onChange={e => handleChange('maxFileSize', parseInt(e.target.value))}
            disabled={!isAdmin}
            data-testid="settings-max-size"
          >
            <option value={10 * 1024 * 1024}>10 MB</option>
            <option value={25 * 1024 * 1024}>25 MB</option>
            <option value={50 * 1024 * 1024}>50 MB</option>
            <option value={100 * 1024 * 1024}>100 MB</option>
          </select>
          <span className="settings-hint">Maximum allowed file size for uploads (default: {formatFileSize(MAX_FILE_SIZE)})</span>
        </div>

        {/* Auto-delete days */}
        <div className="settings-field">
          <label className="settings-label">Auto-Delete Period</label>
          <select
            className="settings-select"
            value={localSettings.autoDeleteDays ?? DEFAULT_AUTO_DELETE_DAYS}
            onChange={e => handleChange('autoDeleteDays', parseInt(e.target.value))}
            disabled={!isAdmin}
            data-testid="settings-auto-delete"
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
          </select>
          <span className="settings-hint">Trashed items are permanently deleted after this period</span>
        </div>

        {/* Chunk redundancy */}
        <div className="settings-field">
          <label className="settings-label">Chunk Redundancy Target</label>
          <select
            className="settings-select"
            value={localSettings.chunkRedundancyTarget ?? DEFAULT_CHUNK_REDUNDANCY_TARGET}
            onChange={e => handleChange('chunkRedundancyTarget', parseInt(e.target.value))}
            disabled={!isAdmin}
            data-testid="settings-redundancy"
          >
            <option value={1}>1 peer (no redundancy)</option>
            <option value={2}>2 peers</option>
            <option value={3}>3 peers</option>
            <option value={5}>5 peers (recommended)</option>
            <option value={10}>10 peers</option>
          </select>
          <span className="settings-hint">Target number of peers storing each file chunk</span>
        </div>

        {/* Danger zone */}
        {isAdmin && (
          <div className="settings-danger" data-testid="settings-danger-zone">
            <h4 className="settings-danger-title">⚠️ Danger Zone</h4>
            <div className="settings-danger-actions">
              <div className="settings-danger-item">
                <div>
                  <strong>Empty Trash</strong>
                  <p>Permanently delete all {trashedCount || 0} items in trash</p>
                </div>
                <button
                  className="settings-danger-btn"
                  onClick={handleEmptyTrash}
                  disabled={!trashedCount}
                  data-testid="settings-empty-trash"
                >
                  Empty Trash
                </button>
              </div>
              <div className="settings-danger-item">
                <div>
                  <strong>Delete All Files</strong>
                  <p>Permanently delete all files and folders. Cannot be undone.</p>
                </div>
                <button
                  className="settings-danger-btn settings-danger-btn--critical"
                  onClick={handleDeleteAll}
                  data-testid="settings-delete-all"
                >
                  Delete Everything
                </button>
              </div>
            </div>
          </div>
        )}

        {!isAdmin && (
          <div className="settings-notice">
            Only admins can modify settings.
          </div>
        )}
      </div>
    </div>
  );
}
