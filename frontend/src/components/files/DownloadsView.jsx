/**
 * DownloadsView
 * 
 * Full download history table.
 * Persists to localStorage.
 * 
 * See docs/FILE_STORAGE_SPEC.md §5.8
 */

import { useMemo } from 'react';
import FileTypeIcon from './FileTypeIcon';
import { formatFileSize, getRelativeTime } from '../../utils/fileTypeCategories';
import './DownloadsView.css';

export default function DownloadsView({
  downloads = [],
  downloadHistory = [],
  onClearDownload,
  onClearHistory,
  onRetryDownload,
}) {
  // Merge active downloads with persisted history
  const allDownloads = useMemo(() => {
    const activeIds = new Set(downloads.map(d => d.downloadId));
    const history = (downloadHistory || []).filter(h => !activeIds.has(h.downloadId));
    return [
      ...downloads.map(d => ({ ...d, isActive: true })),
      ...history.map(h => ({ ...h, isActive: false })),
    ].sort((a, b) => (b.startedAt || b.completedAt || 0) - (a.startedAt || a.completedAt || 0));
  }, [downloads, downloadHistory]);

  const getStatusLabel = (item) => {
    if (item.isActive && item.status) {
      const labels = {
        idle: 'Queued',
        fetching: 'Downloading...',
        decrypting: 'Decrypting...',
        assembling: 'Assembling...',
        complete: 'Complete',
        error: 'Failed',
      };
      return labels[item.status] || item.status;
    }
    return item.error ? 'Failed' : 'Complete';
  };

  const getStatusClass = (item) => {
    if (item.error || item.status === 'error') return 'downloads-status--error';
    if (item.status === 'complete' || !item.isActive) return 'downloads-status--complete';
    return 'downloads-status--active';
  };

  return (
    <div className="downloads-view" data-testid="downloads-view">
      <div className="downloads-header">
        <h3 className="downloads-title">⬇️ Downloads</h3>
        <div className="downloads-header-right">
          <span className="downloads-count">{allDownloads.length} total</span>
          {downloadHistory?.length > 0 && (
            <button className="downloads-clear-all" onClick={onClearHistory} data-testid="downloads-clear-all">
              Clear History
            </button>
          )}
        </div>
      </div>

      {allDownloads.length === 0 ? (
        <div className="downloads-empty" data-testid="downloads-empty">
          <div className="downloads-empty-icon">⬇️</div>
          <p>No downloads yet</p>
        </div>
      ) : (
        <div className="downloads-list" data-testid="downloads-list">
          <div className="downloads-table-header">
            <span className="downloads-col-name">File</span>
            <span className="downloads-col-size">Size</span>
            <span className="downloads-col-status">Status</span>
            <span className="downloads-col-date">Date</span>
            <span className="downloads-col-actions">Actions</span>
          </div>
          {allDownloads.map((item, i) => (
            <div key={item.downloadId || i} className="downloads-row" data-testid={`download-${item.downloadId || i}`}>
              <span className="downloads-col-name">
                <FileTypeIcon extension={item.extension} size="sm" />
                <span className="downloads-file-name">{item.fileName || 'Unknown'}</span>
              </span>
              <span className="downloads-col-size">
                {item.fileSize ? formatFileSize(item.fileSize) : '-'}
              </span>
              <span className={`downloads-col-status ${getStatusClass(item)}`}>
                {getStatusLabel(item)}
              </span>
              <span className="downloads-col-date">
                {getRelativeTime(item.completedAt || item.startedAt)}
              </span>
              <span className="downloads-col-actions">
                {item.filePath && (item.status === 'complete' || (!item.isActive && !item.error)) && (
                  <>
                    <button
                      className="downloads-action-btn"
                      onClick={() => window.electronAPI?.fileSystem?.openFile(item.filePath)}
                      title="Open File"
                      data-testid={`download-open-${item.downloadId}`}
                    >
                      📂
                    </button>
                    <button
                      className="downloads-action-btn"
                      onClick={() => window.electronAPI?.fileSystem?.showInFolder(item.filePath)}
                      title="Show in Folder"
                      data-testid={`download-folder-${item.downloadId}`}
                    >
                      📁
                    </button>
                  </>
                )}
                {item.error && onRetryDownload && (
                  <button
                    className="downloads-action-btn"
                    onClick={() => onRetryDownload?.(item)}
                    title="Retry"
                    data-testid={`download-retry-${item.downloadId}`}
                  >
                    🔄
                  </button>
                )}
                <button
                  className="downloads-action-btn"
                  onClick={() => onClearDownload?.(item.downloadId)}
                  title="Remove"
                  data-testid={`download-clear-${item.downloadId}`}
                >
                  ✕
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
