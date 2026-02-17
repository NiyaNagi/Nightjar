/**
 * DownloadsBar
 * 
 * Chrome-style fixed bottom panel showing active download progress.
 * 
 * See docs/FILE_STORAGE_SPEC.md §5.8
 */

import FileTypeIcon from './FileTypeIcon';
import { formatFileSize } from '../../utils/fileTypeCategories';
import './DownloadsBar.css';

export default function DownloadsBar({
  downloads = [],
  onClearDownload,
  onClearAll,
}) {
  const activeDownloads = downloads.filter(d => d.status !== 'complete' && d.status !== 'error');
  const completedDownloads = downloads.filter(d => d.status === 'complete');
  const errorDownloads = downloads.filter(d => d.status === 'error');

  if (downloads.length === 0) return null;

  return (
    <div className="downloads-bar" data-testid="downloads-bar">
      <div className="downloads-bar-items">
        {activeDownloads.map(d => (
          <div key={d.downloadId} className="downloads-bar-item downloads-bar-item--active">
            <FileTypeIcon extension={d.extension} size="sm" />
            <span className="downloads-bar-name">{d.fileName}</span>
            <div className="downloads-bar-progress">
              <div
                className="downloads-bar-progress-fill"
                style={{ width: `${d.totalChunks ? Math.round((d.chunksDownloaded / d.totalChunks) * 100) : 0}%` }}
              />
            </div>
            <button
              className="downloads-bar-close"
              onClick={() => onClearDownload?.(d.downloadId)}
              data-testid={`dbar-close-${d.downloadId}`}
            >
              ✕
            </button>
          </div>
        ))}
        {completedDownloads.map(d => (
          <div key={d.downloadId} className="downloads-bar-item downloads-bar-item--complete">
            <FileTypeIcon extension={d.extension} size="sm" />
            <span className="downloads-bar-name">{d.fileName}</span>
            <span className="downloads-bar-done">✓</span>
            {d.filePath && (
              <>
                <button
                  className="downloads-bar-action"
                  onClick={() => window.electronAPI?.fileSystem?.openFile(d.filePath)}
                  title="Open File"
                  data-testid={`dbar-open-${d.downloadId}`}
                >
                  📂
                </button>
                <button
                  className="downloads-bar-action"
                  onClick={() => window.electronAPI?.fileSystem?.showInFolder(d.filePath)}
                  title="Show in Folder"
                  data-testid={`dbar-folder-${d.downloadId}`}
                >
                  📁
                </button>
              </>
            )}
            <button
              className="downloads-bar-close"
              onClick={() => onClearDownload?.(d.downloadId)}
              data-testid={`dbar-close-${d.downloadId}`}
            >
              ✕
            </button>
          </div>
        ))}
        {errorDownloads.map(d => (
          <div key={d.downloadId} className="downloads-bar-item downloads-bar-item--error">
            <FileTypeIcon extension={d.extension} size="sm" />
            <span className="downloads-bar-name">{d.fileName}</span>
            <span className="downloads-bar-error">Failed</span>
            <button
              className="downloads-bar-close"
              onClick={() => onClearDownload?.(d.downloadId)}
              data-testid={`dbar-close-${d.downloadId}`}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      {downloads.length > 1 && (
        <button className="downloads-bar-clear-all" onClick={onClearAll} data-testid="dbar-clear-all">
          Clear all
        </button>
      )}
    </div>
  );
}
