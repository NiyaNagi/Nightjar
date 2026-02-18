/**
 * FileCard
 * 
 * Renders a file in Grid, Table, or Compact mode.
 * Shows type-colored icon, name, size, uploader, date,
 * distribution badge, and favorite toggle.
 * 
 * See docs/FILE_STORAGE_SPEC.md §6.5
 */

import { useCallback } from 'react';
import FileTypeIcon from './FileTypeIcon';
import DistributionBadge from './DistributionBadge';
import { formatFileSize, getRelativeTime } from '../../utils/fileTypeCategories';
import './FileCard.css';

export default function FileCard({
  file,
  viewMode = 'grid',
  chunkAvailability,
  userPublicKey,
  isFavorite = false,
  isSelected = false,
  selectedFileIds = [],
  onSelect,
  onClick,
  onContextMenu,
  onToggleFavorite,
  onDragStart,
}) {
  const handleClick = useCallback((e) => {
    if (e.shiftKey) {
      onSelect?.(file.id, { ctrl: false, shift: true });
    } else if (e.ctrlKey || e.metaKey) {
      onSelect?.(file.id, { ctrl: true, shift: false });
    } else {
      onSelect?.(file.id, { ctrl: false, shift: false });
    }
  }, [file, onSelect]);

  const handleDoubleClick = useCallback((e) => {
    onClick?.(file);
  }, [file, onClick]);

  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
    onContextMenu?.(e, { type: 'file', item: file });
  }, [file, onContextMenu]);

  const handleFavorite = useCallback((e) => {
    e.stopPropagation();
    onToggleFavorite?.(file.id);
  }, [file.id, onToggleFavorite]);

  const handleDragStart = useCallback((e) => {
    // When this file is part of a multi-selection, carry all selected IDs
    const idsToMove = isSelected && selectedFileIds.length > 1
      ? selectedFileIds
      : [file.id];
    e.dataTransfer.setData('application/json', JSON.stringify({ type: 'file', ids: idsToMove, id: idsToMove[0] }));
    e.dataTransfer.effectAllowed = 'move';
    onDragStart?.(file);
  }, [file, onDragStart, isSelected, selectedFileIds]);

  const handleCheckbox = useCallback((e) => {
    e.stopPropagation();
    onSelect?.(file.id, { ctrl: true, shift: false });
  }, [file.id, onSelect]);

  if (viewMode === 'table') {
    return (
      <tr
        className={`file-table-row ${isSelected ? 'file-table-row--selected' : ''}`}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        draggable
        onDragStart={handleDragStart}
        data-testid={`fs-file-${file.id}`}
        role="row"
        aria-selected={isSelected}
        tabIndex={0}
        aria-label={`File ${file.name}`}
      >
        <td className="file-table-cell file-table-check">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={handleCheckbox}
            className="file-table-checkbox"
          />
        </td>
        <td className="file-table-cell file-table-name">
          <FileTypeIcon extension={file.extension} size="sm" />
          <span className="file-table-name-text" title={file.name}>{file.name}</span>
        </td>
        <td className="file-table-cell file-table-size">{formatFileSize(file.sizeBytes)}</td>
        <td className="file-table-cell file-table-type">{file.extension?.toUpperCase() || '—'}</td>
        <td className="file-table-cell file-table-uploader">{file.uploadedByName || 'Unknown'}</td>
        <td className="file-table-cell file-table-date">{getRelativeTime(file.updatedAt || file.createdAt)}</td>
        <td className="file-table-cell file-table-status">
          <DistributionBadge
            fileId={file.id}
            chunkCount={file.chunkCount}
            chunkAvailability={chunkAvailability}
            userPublicKey={userPublicKey}
          />
        </td>
        <td className="file-table-cell file-table-fav">
          <button className="file-fav-btn" onClick={handleFavorite} title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}>
            {isFavorite ? '⭐' : '☆'}
          </button>
        </td>
      </tr>
    );
  }

  if (viewMode === 'compact') {
    return (
      <div
        className={`file-compact-row ${isSelected ? 'file-compact-row--selected' : ''}`}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        draggable
        onDragStart={handleDragStart}
        data-testid={`fs-file-${file.id}`}
        role="option"
        aria-selected={isSelected}
        tabIndex={0}
        aria-label={`File ${file.name}, ${formatFileSize(file.sizeBytes)}`}
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={handleCheckbox}
          className="file-compact-checkbox"
        />
        <FileTypeIcon extension={file.extension} size="sm" />
        <span className="file-compact-name" title={file.name}>{file.name}</span>
        <span className="file-compact-size">{formatFileSize(file.sizeBytes)}</span>
        <span className="file-compact-date">{getRelativeTime(file.updatedAt || file.createdAt)}</span>
        <DistributionBadge
          fileId={file.id}
          chunkCount={file.chunkCount}
          chunkAvailability={chunkAvailability}
          userPublicKey={userPublicKey}
        />
        <button className="file-fav-btn" onClick={handleFavorite} title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}>
          {isFavorite ? '⭐' : '☆'}
        </button>
      </div>
    );
  }

  // Grid view (default)
  return (
    <div
      className={`file-card ${isSelected ? 'file-card--selected' : ''}`}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      draggable
      onDragStart={handleDragStart}
      data-testid={`fs-file-${file.id}`}
      role="option"
      aria-selected={isSelected}
      tabIndex={0}
      aria-label={`File ${file.name}, ${formatFileSize(file.sizeBytes)}`}
    >
      <div className="file-card-header">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={handleCheckbox}
          className="file-card-checkbox"
        />
        <FileTypeIcon extension={file.extension} size="lg" />
      </div>
      <div className="file-card-name" title={file.name}>{file.name}</div>
      <div className="file-card-meta">
        {formatFileSize(file.sizeBytes)} · {file.extension?.toUpperCase() || 'FILE'}
      </div>
      <div className="file-card-footer">
        <span className="file-card-uploader">{file.uploadedByName || 'Unknown'}</span>
        <span className="file-card-dot">·</span>
        <span className="file-card-date">{getRelativeTime(file.updatedAt || file.createdAt)}</span>
      </div>
      <div className="file-card-actions">
        <DistributionBadge
          fileId={file.id}
          chunkCount={file.chunkCount}
          chunkAvailability={chunkAvailability}
          userPublicKey={userPublicKey}
        />
        <button className="file-fav-btn" onClick={handleFavorite} title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}>
          {isFavorite ? '⭐' : '☆'}
        </button>
      </div>
    </div>
  );
}
