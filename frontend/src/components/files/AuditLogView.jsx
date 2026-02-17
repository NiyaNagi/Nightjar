/**
 * AuditLogView
 * 
 * Shows file operation history.
 * Filters by date range + action type.
 * 
 * See docs/FILE_STORAGE_SPEC.md §5.11
 */

import { useMemo, useState, useCallback } from 'react';
import { getRelativeTime } from '../../utils/fileTypeCategories';
import { resolveUserName } from '../../utils/resolveUserName';
import ChatButton from '../common/ChatButton';
import './AuditLogView.css';

const ACTION_TYPES = [
  'file_uploaded', 'file_downloaded', 'delete', 'restore', 'move',
  'rename', 'tag', 'favorite', 'settings', 'create_folder', 'folder_created',
  'permanent_delete', 'replace',
];

const DATE_RANGES = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  'all': Infinity,
};

export default function AuditLogView({ auditLog = [], collaborators = [], onStartChatWith, currentUserKey }) {
  const [actionFilter, setActionFilter] = useState('all');
  const [dateRange, setDateRange] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  const getActorName = useCallback((actorKey) => {
    if (!actorKey) return 'Unknown';
    return resolveUserName(collaborators, actorKey);
  }, [collaborators]);

  const filteredLog = useMemo(() => {
    let entries = [...auditLog].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    if (actionFilter !== 'all') {
      entries = entries.filter(e => e.action === actionFilter);
    }

    if (dateRange !== 'all') {
      const cutoff = Date.now() - DATE_RANGES[dateRange];
      entries = entries.filter(e => e.timestamp >= cutoff);
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      entries = entries.filter(e =>
        (e.targetName || '').toLowerCase().includes(term) ||
        (e.action || '').toLowerCase().includes(term) ||
        getActorName(e.actorId).toLowerCase().includes(term)
      );
    }

    return entries.slice(0, 500);
  }, [auditLog, actionFilter, dateRange, searchTerm, getActorName]);

  const getActionIcon = (action) => {
    const icons = {
      file_uploaded: '⬆️', file_downloaded: '⬇️', upload: '⬆️', download: '⬇️',
      delete: '🗑️', restore: '↩️',
      move: '📦', rename: '✏️', tag: '🏷️', favorite: '⭐',
      settings: '⚙️', create_folder: '📁', folder_created: '📁',
      permanent_delete: '❌', replace: '🔄',
    };
    return icons[action] || '📝';
  };

  return (
    <div className="audit-view" data-testid="audit-view">
      <div className="audit-header">
        <h3 className="audit-title">📋 Audit Log</h3>
        <span className="audit-count">{filteredLog.length} entries</span>
      </div>

      <div className="audit-filters">
        <input
          className="audit-search"
          placeholder="Search log..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          data-testid="audit-search"
        />
        <select
          className="audit-filter-select"
          value={actionFilter}
          onChange={e => setActionFilter(e.target.value)}
          data-testid="audit-action-filter"
        >
          <option value="all">All Actions</option>
          {ACTION_TYPES.map(t => (
            <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <select
          className="audit-filter-select"
          value={dateRange}
          onChange={e => setDateRange(e.target.value)}
          data-testid="audit-date-filter"
        >
          <option value="all">All Time</option>
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
      </div>

      {filteredLog.length === 0 ? (
        <div className="audit-empty" data-testid="audit-empty">
          <div className="audit-empty-icon">📋</div>
          <p>No audit log entries</p>
        </div>
      ) : (
        <div className="audit-list" data-testid="audit-list">
          {filteredLog.map((entry, i) => (
            <div key={entry.id || i} className="audit-row" data-testid={`audit-entry-${entry.id || i}`}>
              <span className="audit-icon">{getActionIcon(entry.action)}</span>
              <div className="audit-content">
                <span className="audit-actor">
                  {getActorName(entry.actorId)}
                  <ChatButton
                    publicKey={entry.actorId}
                    name={getActorName(entry.actorId)}
                    collaborators={collaborators}
                    onStartChatWith={onStartChatWith}
                    currentUserKey={currentUserKey}
                  />
                </span>
                <span className="audit-action">{(entry.action || '').replace(/_/g, ' ')}</span>
                <span className="audit-target">{entry.targetName || entry.targetId?.slice(0, 8) || ''}</span>
                {entry.summary && <span className="audit-details">{entry.summary}</span>}
              </div>
              <span className="audit-time">{getRelativeTime(entry.timestamp)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
