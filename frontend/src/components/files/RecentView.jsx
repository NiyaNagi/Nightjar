/**
 * RecentView
 * 
 * Shows files sorted by updatedAt descending.
 * Flat list with location breadcrumb.
 * 
 * See docs/FILE_STORAGE_SPEC.md §5.7
 */

import { useMemo } from 'react';
import FileTypeIcon from './FileTypeIcon';
import DistributionBadge from './DistributionBadge';
import { formatFileSize, getRelativeTime } from '../../utils/fileTypeCategories';
import './RecentView.css';

export default function RecentView({
  activeFiles,
  activeFolders,
  chunkAvailability,
  userPublicKey,
  onSelectFile,
  onDownloadFile,
}) {
  const recentFiles = useMemo(() => {
    return [...activeFiles]
      .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
      .slice(0, 100);
  }, [activeFiles]);

  const getFolderPath = (folderId) => {
    if (!folderId) return 'Root';
    const parts = [];
    let id = folderId;
    let safety = 0;
    while (id && safety < 10) {
      const folder = activeFolders.find(f => f.id === id);
      if (!folder) break;
      parts.unshift(folder.name);
      id = folder.parentId;
      safety++;
    }
    return parts.join(' / ') || 'Root';
  };

  return (
    <div className="recent-view" data-testid="recent-view">
      <div className="recent-header">
        <h3 className="recent-title">Recent Files</h3>
        <span className="recent-count">{recentFiles.length} files</span>
      </div>

      {recentFiles.length === 0 ? (
        <div className="recent-empty" data-testid="recent-empty">
          <div className="recent-empty-icon">🕐</div>
          <p>No recent files</p>
        </div>
      ) : (
        <div className="recent-list" data-testid="recent-list">
          <div className="recent-table-header">
            <span className="recent-col-name">Name</span>
            <span className="recent-col-loc">Location</span>
            <span className="recent-col-size">Size</span>
            <span className="recent-col-date">Modified</span>
            <span className="recent-col-status">Status</span>
          </div>
          {recentFiles.map(file => (
            <div
              key={file.id}
              className="recent-row"
              onClick={() => onSelectFile?.(file)}
              data-testid={`recent-file-${file.id}`}
            >
              <span className="recent-col-name">
                <FileTypeIcon extension={file.extension} size="sm" />
                <span className="recent-file-name">{file.name}</span>
              </span>
              <span className="recent-col-loc">
                <span className="recent-location">{getFolderPath(file.folderId)}</span>
              </span>
              <span className="recent-col-size">{formatFileSize(file.sizeBytes)}</span>
              <span className="recent-col-date">{getRelativeTime(file.updatedAt || file.createdAt)}</span>
              <span className="recent-col-status">
                <DistributionBadge
                  fileId={file.id}
                  chunkCount={file.chunkCount}
                  chunkAvailability={chunkAvailability}
                  userPublicKey={userPublicKey}
                />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
