/**
 * StorageView
 * 
 * Storage overview with summary cards, category breakdown,
 * peer distribution stats, and trash summary.
 * 
 * See docs/FILE_STORAGE_SPEC.md §5.9
 */

import { useMemo } from 'react';
import { formatFileSize } from '../../utils/fileTypeCategories';
import { FILE_TYPE_COLORS } from '../../utils/fileTypeCategories';
import ChatButton from '../common/ChatButton';
import './StorageView.css';

export default function StorageView({
  activeFiles,
  activeFolders,
  trashedFiles,
  totalSizeBytes,
  sizeByCategory,
  chunkAvailability,
  collaborators,
  userPublicKey,
  onStartChatWith,
}) {
  const stats = useMemo(() => {
    const totalFiles = activeFiles?.length || 0;
    const totalFolders = activeFolders?.length || 0;
    const trashedCount = trashedFiles?.length || 0;

    // Peer distribution: count unique peers with availability data
    const peerSet = new Set();
    if (chunkAvailability) {
      // chunkAvailability can be a Y.Map, plain object, or native Map
      const entries = typeof chunkAvailability.entries === 'function'
        ? [...chunkAvailability.entries()]
        : typeof chunkAvailability === 'object'
          ? Object.entries(chunkAvailability)
          : [];
      for (const [, peers] of entries) {
        if (peers && typeof peers === 'object') {
          const holders = peers.holders || peers;
          const peerKeys = typeof holders === 'object'
            ? (Array.isArray(holders) ? holders : Object.keys(holders))
            : [];
          peerKeys.forEach(k => peerSet.add(k));
        }
      }
    }

    return {
      totalFiles,
      totalFolders,
      trashedCount,
      totalSize: totalSizeBytes || 0,
      peerCount: peerSet.size,
    };
  }, [activeFiles, activeFolders, trashedFiles, totalSizeBytes, chunkAvailability]);

  const categoryBreakdown = useMemo(() => {
    if (!sizeByCategory) return [];
    const entries = sizeByCategory instanceof Map
      ? [...sizeByCategory.entries()]
      : Object.entries(sizeByCategory);
    return entries
      .map(([cat, size]) => ({
        category: cat,
        size,
        color: FILE_TYPE_COLORS[cat]?.bg || '#6c7086',
        percentage: stats.totalSize > 0 ? (size / stats.totalSize) * 100 : 0,
      }))
      .sort((a, b) => b.size - a.size);
  }, [sizeByCategory, stats.totalSize]);

  return (
    <div className="storage-view" data-testid="storage-view">
      <div className="storage-header">
        <h3 className="storage-title">📊 Storage Overview</h3>
      </div>

      {/* Summary cards */}
      <div className="storage-cards">
        <div className="storage-card" data-testid="storage-card-size">
          <div className="storage-card-value">{formatFileSize(stats.totalSize)}</div>
          <div className="storage-card-label">Total Size</div>
        </div>
        <div className="storage-card" data-testid="storage-card-files">
          <div className="storage-card-value">{stats.totalFiles}</div>
          <div className="storage-card-label">Files</div>
        </div>
        <div className="storage-card" data-testid="storage-card-folders">
          <div className="storage-card-value">{stats.totalFolders}</div>
          <div className="storage-card-label">Folders</div>
        </div>
        <div className="storage-card" data-testid="storage-card-peers">
          <div className="storage-card-value">{stats.peerCount}</div>
          <div className="storage-card-label">Peers</div>
        </div>
        <div className="storage-card" data-testid="storage-card-trash">
          <div className="storage-card-value">{stats.trashedCount}</div>
          <div className="storage-card-label">In Trash</div>
        </div>
      </div>

      {/* Category breakdown */}
      <div className="storage-section">
        <h4 className="storage-section-title">Storage by Category</h4>
        {categoryBreakdown.length === 0 ? (
          <p className="storage-empty-text">No files uploaded yet</p>
        ) : (
          <>
            <div className="storage-bar" data-testid="storage-bar">
              {categoryBreakdown.map(cat => (
                <div
                  key={cat.category}
                  className="storage-bar-segment"
                  style={{ width: `${Math.max(cat.percentage, 1)}%`, background: cat.color }}
                  title={`${cat.category}: ${formatFileSize(cat.size)} (${cat.percentage.toFixed(1)}%)`}
                />
              ))}
            </div>
            <div className="storage-legend">
              {categoryBreakdown.map(cat => (
                <div key={cat.category} className="storage-legend-item">
                  <span className="storage-legend-dot" style={{ background: cat.color }} />
                  <span className="storage-legend-name">{cat.category}</span>
                  <span className="storage-legend-size">{formatFileSize(cat.size)}</span>
                  <span className="storage-legend-pct">{cat.percentage.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Collaborators */}
      {collaborators?.length > 0 && (
        <div className="storage-section">
          <h4 className="storage-section-title">Workspace Members</h4>
          <div className="storage-peers">
            {collaborators.map((c, i) => (
              <div key={c.publicKey || i} className="storage-peer">
                <div className="storage-peer-avatar">
                  {(c.displayName || 'U').charAt(0).toUpperCase()}
                </div>
                <span className="storage-peer-name">
                  {c.displayName || c.publicKey?.slice(0, 8) || 'Unknown'}
                  {c.publicKey === userPublicKey ? ' (you)' : ''}
                  <ChatButton
                    publicKey={c.publicKey || c.publicKeyBase62}
                    name={c.displayName || c.publicKey?.slice(0, 8) || 'Unknown'}
                    collaborators={collaborators}
                    onStartChatWith={onStartChatWith}
                    currentUserKey={userPublicKey}
                  />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
