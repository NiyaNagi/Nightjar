/**
 * AllRequests
 * 
 * Admin view showing all requests in a sortable, filterable table.
 * Clicking a row expands to show RequestDetail inline.
 * 
 * See docs/INVENTORY_SYSTEM_SPEC.md §6.4.2 (All Requests View)
 */

import React, { useState, useMemo, useCallback } from 'react';
import { useInventory } from '../../../contexts/InventoryContext';
import { useInventorySync } from '../../../hooks/useInventorySync';
import { useToast } from '../../../contexts/ToastContext';
import RequestRow from '../common/RequestRow';
import RequestDetail from '../common/RequestDetail';
import { generateId, US_STATES } from '../../../utils/inventoryValidation';
import { exportRequests } from '../../../utils/inventoryExport';
import './AllRequests.css';

const PAGE_SIZE = 50;
const STATUS_OPTIONS = ['all', 'open', 'claimed', 'pending_approval', 'approved', 'in_progress', 'shipped', 'delivered', 'blocked', 'cancelled'];

export default function AllRequests() {
  const ctx = useInventory();
  const { yInventoryRequests, yInventoryAuditLog, inventorySystemId, collaborators } = ctx;
  const { requests, catalogItems } = useInventorySync(
    { yInventorySystems: ctx.yInventorySystems, yCatalogItems: ctx.yCatalogItems,
      yInventoryRequests, yProducerCapacities: ctx.yProducerCapacities,
      yAddressReveals: ctx.yAddressReveals, yPendingAddresses: ctx.yPendingAddresses,
      yInventoryAuditLog },
    inventorySystemId
  );
  const { showToast } = useToast();

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [itemFilter, setItemFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [urgencyFilter, setUrgencyFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [producerFilter, setProducerFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Sort
  const [sortField, setSortField] = useState('requestedAt');
  const [sortDir, setSortDir] = useState('desc');

  // Pagination
  const [page, setPage] = useState(1);

  // Expanded row
  const [expandedId, setExpandedId] = useState(null);

  // Apply filters
  const filtered = useMemo(() => {
    let result = [...requests];

    if (statusFilter !== 'all') result = result.filter(r => r.status === statusFilter);
    if (itemFilter !== 'all') result = result.filter(r => r.catalogItemId === itemFilter);
    if (stateFilter !== 'all') result = result.filter(r => r.state === stateFilter);
    if (urgencyFilter === 'urgent') result = result.filter(r => r.urgent);
    if (urgencyFilter === 'normal') result = result.filter(r => !r.urgent);
    if (producerFilter !== 'all') result = result.filter(r => r.assignedTo === producerFilter);
    if (dateFrom) {
      const fromTs = new Date(dateFrom).getTime();
      result = result.filter(r => (r.requestedAt || 0) >= fromTs);
    }
    if (dateTo) {
      const toTs = new Date(dateTo).getTime() + 86400000; // end of day
      result = result.filter(r => (r.requestedAt || 0) < toTs);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        (r.id?.toLowerCase().includes(q)) ||
        (r.catalogItemName?.toLowerCase().includes(q)) ||
        (r.city?.toLowerCase().includes(q)) ||
        (r.state?.toLowerCase().includes(q)) ||
        (r.notes?.toLowerCase().includes(q))
      );
    }

    // Sort
    result.sort((a, b) => {
      let va = a[sortField];
      let vb = b[sortField];
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [requests, statusFilter, itemFilter, stateFilter, urgencyFilter, search, sortField, sortDir]);

  // Paginate
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageData = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const handleRowClick = (req) => {
    setExpandedId(expandedId === req.id ? null : req.id);
  };

  // Admin actions on detail panel
  const handleApprove = useCallback((req) => {
    const items = yInventoryRequests.toArray();
    const idx = items.findIndex(r => r.id === req.id);
    if (idx === -1) return;
    yInventoryRequests.delete(idx, 1);
    yInventoryRequests.insert(idx, [{ ...items[idx], status: 'approved', approvedAt: Date.now(), updatedAt: Date.now() }]);
    yInventoryAuditLog.push([{ id: generateId('aud-'), inventorySystemId, action: 'request_approved', entityId: req.id, entityType: 'request', details: { item: req.catalogItemName }, timestamp: Date.now() }]);
    showToast(`#${req.id?.slice(4, 10)} approved`, 'success');
  }, [yInventoryRequests, yInventoryAuditLog, inventorySystemId, showToast]);

  const handleReject = useCallback((req) => {
    const items = yInventoryRequests.toArray();
    const idx = items.findIndex(r => r.id === req.id);
    if (idx === -1) return;
    yInventoryRequests.delete(idx, 1);
    yInventoryRequests.insert(idx, [{ ...items[idx], status: 'open', assignedTo: null, updatedAt: Date.now() }]);
    yInventoryAuditLog.push([{ id: generateId('aud-'), inventorySystemId, action: 'request_rejected', entityId: req.id, entityType: 'request', details: { item: req.catalogItemName }, timestamp: Date.now() }]);
    showToast(`#${req.id?.slice(4, 10)} returned to Open`, 'success');
  }, [yInventoryRequests, yInventoryAuditLog, inventorySystemId, showToast]);

  const handleCancel = useCallback((req) => {
    const items = yInventoryRequests.toArray();
    const idx = items.findIndex(r => r.id === req.id);
    if (idx === -1) return;
    yInventoryRequests.delete(idx, 1);
    yInventoryRequests.insert(idx, [{ ...items[idx], status: 'cancelled', updatedAt: Date.now() }]);
    yInventoryAuditLog.push([{ id: generateId('aud-'), inventorySystemId, action: 'request_cancelled', entityId: req.id, entityType: 'request', details: { item: req.catalogItemName }, timestamp: Date.now() }]);
    showToast(`#${req.id?.slice(4, 10)} cancelled`, 'success');
  }, [yInventoryRequests, yInventoryAuditLog, inventorySystemId, showToast]);

  // Unique states appearing in requests
  const usedStates = [...new Set(requests.map(r => r.state).filter(Boolean))].sort();
  const sortIndicator = (field) => sortField === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  return (
    <div className="all-requests">
      <div className="all-requests__header">
        <h2>All Requests</h2>
        <span className="all-requests__total">Total: {filtered.length.toLocaleString()}</span>
      </div>

      {/* Filters */}
      <div className="all-requests__filters">
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s === 'all' ? 'All Statuses' : s.replace(/_/g, ' ')}</option>)}
        </select>
        <select value={itemFilter} onChange={e => { setItemFilter(e.target.value); setPage(1); }}>
          <option value="all">All Items</option>
          {catalogItems.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <select value={stateFilter} onChange={e => { setStateFilter(e.target.value); setPage(1); }}>
          <option value="all">All States</option>
          {usedStates.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={urgencyFilter} onChange={e => { setUrgencyFilter(e.target.value); setPage(1); }}>
          <option value="all">All Urgencies</option>
          <option value="urgent">⚡ Urgent</option>
          <option value="normal">Normal</option>
        </select>
        <select value={producerFilter} onChange={e => { setProducerFilter(e.target.value); setPage(1); }}>
          <option value="all">All Producers</option>
          {(collaborators || []).filter(c => c.permission === 'owner' || c.permission === 'editor').map(c => (
            <option key={c.publicKeyBase62 || c.publicKey} value={c.publicKeyBase62 || c.publicKey}>
              {c.displayName || c.name || (c.publicKeyBase62 || c.publicKey || '').slice(0, 8)}
            </option>
          ))}
        </select>
        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} title="From date" />
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} title="To date" />
        <button className="btn-sm btn-secondary" onClick={() => exportRequests(filtered)}>📤 Export CSV</button>
        <div className="all-requests__search">
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search..."
          />
          🔍
        </div>
      </div>

      {/* Table */}
      <div className="all-requests__table-wrap">
        <table className="all-requests__table">
          <thead>
            <tr>
              <th style={{ width: 28 }}>⚡</th>
              <th onClick={() => handleSort('id')}>ID{sortIndicator('id')}</th>
              <th onClick={() => handleSort('catalogItemName')}>Item{sortIndicator('catalogItemName')}</th>
              <th onClick={() => handleSort('quantity')}>Qty{sortIndicator('quantity')}</th>
              <th onClick={() => handleSort('state')}>Loc{sortIndicator('state')}</th>
              <th onClick={() => handleSort('status')}>Status{sortIndicator('status')}</th>
              <th>Assigned</th>
              <th onClick={() => handleSort('requestedAt')}>Date{sortIndicator('requestedAt')}</th>
            </tr>
          </thead>
          <tbody>
            {pageData.map(req => (
              <React.Fragment key={req.id}>
                <RequestRow
                  request={req}
                  collaborators={collaborators}
                  isExpanded={expandedId === req.id}
                  onClick={handleRowClick}
                />
                {expandedId === req.id && (
                  <tr className="all-requests__detail-row">
                    <td colSpan={8}>
                      <RequestDetail
                        request={req}
                        isAdmin
                        collaborators={collaborators}
                        onClose={() => setExpandedId(null)}
                        onApprove={handleApprove}
                        onReject={handleReject}
                        onCancel={handleCancel}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <div className="all-requests__empty">No requests match your filters.</div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="all-requests__pagination">
          <span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
          <div className="all-requests__page-btns">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>◀ Prev</button>
            <span>Page {page} of {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next ▶</button>
          </div>
        </div>
      )}
    </div>
  );
}
