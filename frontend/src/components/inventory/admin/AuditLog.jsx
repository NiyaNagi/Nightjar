/**
 * AuditLog.jsx
 *
 * Paginated audit trail viewer (admin-only).
 * Reads from yInventoryAuditLog, filters by action/target/actor, exports to CSV.
 *
 * See docs/INVENTORY_SYSTEM_SPEC.md §6.5, §3.8
 */

import React, { useMemo, useState, useCallback } from 'react';
import { useInventory } from '../../../contexts/InventoryContext';
import { formatRelativeDate } from '../../../utils/inventoryValidation';
import { exportAuditLog } from '../../../utils/inventoryExport';
import { resolveUserName } from '../../../utils/resolveUserName';
import ChatButton from '../../common/ChatButton';
import './AuditLog.css';

const PAGE_SIZE = 50;

const ACTION_LABELS = {
  request_created: 'Request Created',
  request_claimed: 'Request Claimed',
  request_auto_assigned: 'Auto-Assigned',
  request_manually_assigned: 'Manually Assigned',
  request_approved: 'Request Approved',
  request_rejected: 'Request Rejected',
  request_shipped: 'Request Shipped',
  request_delivered: 'Request Delivered',
  request_cancelled: 'Request Cancelled',
  request_unclaimed: 'Request Unclaimed',
  address_revealed: 'Address Revealed',
  address_purged: 'Address Purged',
  capacity_updated: 'Capacity Updated',
  catalog_item_added: 'Catalog Item Added',
  catalog_item_updated: 'Catalog Item Updated',
  catalog_item_deactivated: 'Item Deactivated',
  settings_changed: 'Settings Changed',
  data_imported: 'Data Imported',
  request_submitted: 'Request Submitted',
  request_edited: 'Request Edited',
  request_reassigned: 'Request Reassigned',
  producer_names_mapped: 'Producer Names Mapped',
  bulk_claim_imported: 'Bulk Claim Imported',
  system_configured: 'System Configured',
};

const ACTION_ICONS = {
  request_created: '📝',
  request_claimed: '🤝',
  request_auto_assigned: '🤖',
  request_manually_assigned: '👆',
  request_approved: '✅',
  request_rejected: '❌',
  request_shipped: '📦',
  request_delivered: '🎉',
  request_cancelled: '🚫',
  request_unclaimed: '↩️',
  address_revealed: '🔓',
  address_purged: '🗑️',
  capacity_updated: '📊',
  catalog_item_added: '➕',
  catalog_item_updated: '✏️',
  catalog_item_deactivated: '🔴',
  settings_changed: '⚙️',
  data_imported: '📥',
  request_submitted: '📋',
  request_edited: '✏️',
  request_reassigned: '🔀',
  producer_names_mapped: '🔗',
  bulk_claim_imported: '📎',
  system_configured: '🛠️',
};

export default function AuditLog() {
  const ctx = useInventory();
  const sync = ctx;

  const [filterAction, setFilterAction] = useState('');
  const [filterTarget, setFilterTarget] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(0);

  const allEntries = sync.auditLog || [];

  // Filter + search
  const filtered = useMemo(() => {
    let entries = [...allEntries].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    if (filterAction) {
      entries = entries.filter(e => e.action === filterAction);
    }
    if (filterTarget) {
      entries = entries.filter(e => e.targetType === filterTarget);
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      entries = entries.filter(e =>
        (e.summary || '').toLowerCase().includes(term) ||
        (e.actorName || '').toLowerCase().includes(term) ||
        (e.targetId || '').toLowerCase().includes(term)
      );
    }

    return entries;
  }, [allEntries, filterAction, filterTarget, searchTerm]);

  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);
  const pageData = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleExport = useCallback(() => {
    exportAuditLog(filtered);
  }, [filtered]);

  // Resolve actor display name from collaborators
  const getActorName = useCallback((entry) => {
    if (entry.actorName) return entry.actorName;
    if (!entry.actorId) return 'System';
    return resolveUserName(ctx.collaborators, entry.actorId);
  }, [ctx.collaborators]);

  // Unique actions for filter
  const uniqueActions = useMemo(() => {
    return [...new Set(allEntries.map(e => e.action).filter(Boolean))].sort();
  }, [allEntries]);

  const uniqueTargets = useMemo(() => {
    return [...new Set(allEntries.map(e => e.targetType).filter(Boolean))].sort();
  }, [allEntries]);

  return (
    <div className="audit-log">
      <div className="al-header">
        <h2>Audit Log</h2>
        <div className="al-actions">
          <span className="al-count">{filtered.length} entries</span>
          <button className="btn-sm btn-secondary" onClick={handleExport}>
            Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="al-filters">
        <input
          type="text"
          placeholder="Search entries..."
          value={searchTerm}
          onChange={e => { setSearchTerm(e.target.value); setPage(0); }}
          className="al-search"
        />
        <select
          value={filterAction}
          onChange={e => { setFilterAction(e.target.value); setPage(0); }}
          className="al-filter-select"
        >
          <option value="">All Actions</option>
          {uniqueActions.map(a => (
            <option key={a} value={a}>{ACTION_LABELS[a] || a}</option>
          ))}
        </select>
        <select
          value={filterTarget}
          onChange={e => { setFilterTarget(e.target.value); setPage(0); }}
          className="al-filter-select"
        >
          <option value="">All Targets</option>
          {uniqueTargets.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {/* Entries list */}
      {pageData.length === 0 ? (
        <div className="al-empty">
          <p>No audit log entries{filterAction || filterTarget || searchTerm ? ' match your filters' : ' yet'}</p>
        </div>
      ) : (
        <div className="al-entries">
          {pageData.map(entry => (
            <div key={entry.id} className="al-entry">
              <div className="al-entry-icon">
                {ACTION_ICONS[entry.action] || '📋'}
              </div>
              <div className="al-entry-content">
                <div className="al-entry-summary">{entry.summary}</div>
                <div className="al-entry-meta">
                  <span className="al-entry-actor">
                    {getActorName(entry)}
                    <ChatButton
                      publicKey={entry.actorId}
                      name={getActorName(entry)}
                      collaborators={ctx.collaborators}
                      onStartChatWith={ctx.onStartChatWith}
                      currentUserKey={ctx.userIdentity?.publicKeyBase62}
                    />
                  </span>
                  <span className="al-entry-action">{ACTION_LABELS[entry.action] || entry.action}</span>
                  {entry.targetType && (
                    <span className="al-entry-target">{entry.targetType}</span>
                  )}
                  <span className="al-entry-time">
                    {entry.timestamp ? formatRelativeDate(entry.timestamp) : '—'}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="al-pagination">
          <button
            className="btn-sm btn-secondary"
            disabled={page === 0}
            onClick={() => setPage(p => p - 1)}
          >
            ← Newer
          </button>
          <span>Page {page + 1} of {pageCount}</span>
          <button
            className="btn-sm btn-secondary"
            disabled={page >= pageCount - 1}
            onClick={() => setPage(p => p + 1)}
          >
            Older →
          </button>
        </div>
      )}
    </div>
  );
}
