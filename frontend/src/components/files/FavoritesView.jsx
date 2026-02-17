/**
 * FavoritesView
 * 
 * Shows files favorited by the current user.
 * 
 * See docs/FILE_STORAGE_SPEC.md §5.7
 */

import { useMemo } from 'react';
import FileTypeIcon from './FileTypeIcon';
import { formatFileSize, getRelativeTime } from '../../utils/fileTypeCategories';
import './FavoritesView.css';

export default function FavoritesView({
  activeFiles,
  userIdentity,
  onSelectFile,
  onToggleFavorite,
}) {
  const favoriteFiles = useMemo(() => {
    const pubKey = userIdentity?.publicKeyBase62 || userIdentity?.publicKey;
    if (!pubKey) return [];
    return activeFiles
      .filter(f => f.favoritedBy && f.favoritedBy.includes(pubKey))
      .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  }, [activeFiles, userIdentity]);

  return (
    <div className="favorites-view" data-testid="favorites-view">
      <div className="favorites-header">
        <h3 className="favorites-title">⭐ Favorites</h3>
        <span className="favorites-count">{favoriteFiles.length} files</span>
      </div>

      {favoriteFiles.length === 0 ? (
        <div className="favorites-empty" data-testid="favorites-empty">
          <div className="favorites-empty-icon">⭐</div>
          <p>No favorite files yet</p>
          <p className="favorites-empty-hint">Star files to see them here</p>
        </div>
      ) : (
        <div className="favorites-list" data-testid="favorites-list">
          {favoriteFiles.map(file => (
            <div
              key={file.id}
              className="favorites-row"
              onClick={() => onSelectFile?.(file)}
              data-testid={`favorite-${file.id}`}
            >
              <FileTypeIcon extension={file.extension} size="sm" />
              <span className="favorites-name">{file.name}</span>
              <span className="favorites-size">{formatFileSize(file.sizeBytes)}</span>
              <span className="favorites-date">{getRelativeTime(file.updatedAt || file.createdAt)}</span>
              <button
                className="favorites-unfav-btn"
                onClick={(e) => { e.stopPropagation(); onToggleFavorite?.(file.id); }}
                title="Unfavorite"
                data-testid={`unfav-${file.id}`}
              >
                ⭐
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
