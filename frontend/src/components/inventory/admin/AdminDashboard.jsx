/**
 * AdminDashboard
 * 
 * Primary admin landing page. Summary cards, approval queue preview,
 * blocked requests, quick actions, aging requests.
 * 
 * See docs/INVENTORY_SYSTEM_SPEC.md §6.4.1 (Admin Dashboard)
 */

import React, { useMemo, useCallback } from 'react';
import { useInventory } from '../../../contexts/InventoryContext';
import { useInventorySync } from '../../../hooks/useInventorySync';
import { useToast } from '../../../contexts/ToastContext';
import StatusBadge from '../common/StatusBadge';
import RequestCard from '../common/RequestCard';
import { formatDate, formatRelativeDate, generateId } from '../../../utils/inventoryValidation';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, ComposedChart } from 'recharts';
import './AdminDashboard.css';

const MS_PER_DAY = 86400000;

export default function AdminDashboard({ onNavigate }) {
  const ctx = useInventory();
  const { yInventoryRequests, yInventoryAuditLog, inventorySystemId, collaborators } = ctx;
  const { currentSystem, requests, producerCapacities, openRequestCount, pendingApprovalCount } =
    useInventorySync(
      { yInventorySystems: ctx.yInventorySystems, yCatalogItems: ctx.yCatalogItems,
        yInventoryRequests, yProducerCapacities: ctx.yProducerCapacities,
        yAddressReveals: ctx.yAddressReveals, yPendingAddresses: ctx.yPendingAddresses,
        yInventoryAuditLog },
      inventorySystemId
    );
  const { showToast } = useToast();

  // Derived counts
  const inProgressCount = requests.filter(r => ['approved', 'in_progress'].includes(r.status)).length;
  const blockedCount = requests.filter(r => r.status === 'blocked').length;
  const shippedCount = requests.filter(r => r.status === 'shipped').length;

  // Approval queue preview (up to 5)
  const pendingApprovals = useMemo(() =>
    requests.filter(r => r.status === 'claimed' || r.status === 'pending_approval')
      .sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || a.requestedAt - b.requestedAt)
      .slice(0, 5),
    [requests]
  );

  // Blocked requests
  const blockedRequests = useMemo(() =>
    requests.filter(r => r.status === 'blocked')
      .sort((a, b) => a.requestedAt - b.requestedAt),
    [requests]
  );

  // Aging analysis
  const now = Date.now();
  const aging7 = requests.filter(r => !['cancelled', 'delivered', 'shipped'].includes(r.status) && (now - r.requestedAt) > 7 * MS_PER_DAY).length;
  const aging14 = requests.filter(r => !['cancelled', 'delivered', 'shipped'].includes(r.status) && (now - r.requestedAt) > 14 * MS_PER_DAY).length;

  const handleApprove = useCallback((req) => {
    const items = yInventoryRequests.toArray();
    const idx = items.findIndex(r => r.id === req.id);
    if (idx === -1) return;
    const updated = { ...items[idx], status: 'approved', approvedAt: Date.now(), updatedAt: Date.now() };
    yInventoryRequests.delete(idx, 1);
    yInventoryRequests.insert(idx, [updated]);
    yInventoryAuditLog.push([{
      id: generateId('aud-'),
      inventorySystemId,
      action: 'request_approved',
      entityId: req.id,
      entityType: 'request',
      details: { item: req.catalogItemName },
      timestamp: Date.now(),
    }]);
    showToast(`Request #${req.id?.slice(4, 10)} approved`, 'success');
  }, [yInventoryRequests, yInventoryAuditLog, inventorySystemId, showToast]);

  const handleReject = useCallback((req) => {
    const items = yInventoryRequests.toArray();
    const idx = items.findIndex(r => r.id === req.id);
    if (idx === -1) return;
    const updated = { ...items[idx], status: 'open', assignedTo: null, approvedAt: null, updatedAt: Date.now() };
    yInventoryRequests.delete(idx, 1);
    yInventoryRequests.insert(idx, [updated]);
    yInventoryAuditLog.push([{
      id: generateId('aud-'),
      inventorySystemId,
      action: 'request_rejected',
      entityId: req.id,
      entityType: 'request',
      details: { item: req.catalogItemName },
      timestamp: Date.now(),
    }]);
    showToast(`Request #${req.id?.slice(4, 10)} rejected — returned to Open`, 'success');
  }, [yInventoryRequests, yInventoryAuditLog, inventorySystemId, showToast]);

  const getAssignedName = (pubkey) => {
    if (!pubkey) return null;
    return collaborators.find(c => c.publicKeyBase62 === pubkey)?.name || pubkey.slice(0, 8) + '…';
  };

  return (
    <div className="admin-dashboard">
      <div className="admin-dashboard__header">
        <h2>Dashboard</h2>
        <span className="admin-dashboard__date">{formatDate(Date.now())}</span>
      </div>

      {/* Summary cards */}
      <div className="admin-dashboard__cards">
        <SummaryCard label="Open" value={openRequestCount} subtitle="requests" color="var(--accent-color)"
          onClick={() => onNavigate?.('all-requests')} />
        <SummaryCard label="Pending" value={pendingApprovalCount} subtitle="approval" color="var(--warning-color)"
          onClick={() => onNavigate?.('approval-queue')} />
        <SummaryCard label="In Progress" value={inProgressCount} subtitle="requests" color="var(--success-color)" />
        <SummaryCard label="Blocked" value={blockedCount} subtitle="requests" color="var(--error-color)" />
      </div>

      {/* Approval preview */}
      {pendingApprovals.length > 0 && (
        <section className="admin-dashboard__section">
          <div className="admin-dashboard__section-header">
            <h3>Needs Your Attention</h3>
            <span className="admin-dashboard__count">{pendingApprovalCount} pending</span>
          </div>
          <div className="admin-dashboard__approval-list">
            {pendingApprovals.map(req => (
              <div key={req.id} className={`admin-approval-card ${req.urgent ? 'admin-approval-card--urgent' : ''}`}>
                <div className="admin-approval-card__header">
                  <span>{req.urgent && '⚡ '}#{req.id?.slice(4, 10)}</span>
                  <span>{req.catalogItemName}</span>
                  <span>{req.quantity?.toLocaleString()} {req.unit}</span>
                  <span>{req.city}, {req.state}</span>
                </div>
                <div className="admin-approval-card__info">
                  {req.assignedTo
                    ? `${req.status === 'claimed' ? 'Claimed by' : 'Assigned to'}: ${getAssignedName(req.assignedTo)}`
                    : 'Unassigned'}
                  {req.estimatedFulfillmentDate && ` │ Est: ${formatDate(req.estimatedFulfillmentDate, { short: true })}`}
                </div>
                <div className="admin-approval-card__actions">
                  <button className="btn-sm btn-approve" onClick={() => handleApprove(req)}>✓ Approve</button>
                  <button className="btn-sm" onClick={() => handleReject(req)}>✗ Reject</button>
                  <button className="btn-sm" onClick={() => onNavigate?.('approval-queue')}>→ Reassign</button>
                  <button className="btn-sm" onClick={() => onNavigate?.('approval-queue')}>👁️ Detail</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Blocked requests */}
      {blockedRequests.length > 0 && (
        <section className="admin-dashboard__section">
          <div className="admin-dashboard__section-header">
            <h3>Blocked Requests</h3>
            <span className="admin-dashboard__count">{blockedCount} — no capacity</span>
          </div>
          <div className="admin-dashboard__blocked-list">
            {blockedRequests.slice(0, 3).map(req => (
              <div key={req.id} className="admin-blocked-card">
                <span>#{req.id?.slice(4, 10)} │ {req.catalogItemName} │ {req.quantity?.toLocaleString()} │ {req.state}</span>
                <span className="admin-blocked-card__age">
                  Blocked since: {formatRelativeDate(req.requestedAt)}
                  {req.urgent && ' │ ⚡ Urgent'}
                </span>
                <div className="admin-blocked-card__actions">
                  <button className="btn-sm" onClick={() => onNavigate?.('approval-queue')}>→ Manual Assign</button>
                  <button className="btn-sm" onClick={() => showToast('Producer notification sent', 'info')}>📧 Notify Producers</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Quick actions */}
      <section className="admin-dashboard__section">
        <h3>Quick Actions</h3>
        <div className="admin-dashboard__quick-actions">
          <button className="btn-sm" onClick={() => onNavigate?.('submit-request')}>➕ Submit Request</button>
          <button className="btn-sm" onClick={() => onNavigate?.('all-requests')}>📋 All Requests</button>
          <button className="btn-sm" onClick={() => onNavigate?.('producers')}>👥 Manage Producers</button>
          <button className="btn-sm" onClick={() => onNavigate?.('catalog')}>📦 Edit Catalog</button>
          <button className="btn-sm" onClick={() => onNavigate?.('import-export')}>📥 Import</button>
          <button className="btn-sm" onClick={() => onNavigate?.('settings')}>🔄 Run Auto-Assign</button>
          <button className="btn-sm" onClick={() => onNavigate?.('analytics')}>📤 Export Report</button>
        </div>
      </section>

      {/* Inflow / Outflow chart */}
      <section className="admin-dashboard__section">
        <h3>Inflow / Outflow (Last 30 Days)</h3>
        <InflowOutflowChart requests={requests} />
      </section>

      {/* Aging */}
      {(aging7 > 0 || aging14 > 0) && (
        <section className="admin-dashboard__section">
          <h3>Aging Requests</h3>
          <div className="admin-dashboard__aging">
            {aging7 > 0 && <span>Unfulfilled {'>'} 7 days: <strong>{aging7}</strong> requests</span>}
            {aging14 > 0 && <span>Unfulfilled {'>'} 14 days: <strong>{aging14}</strong> requests</span>}
            <button className="btn-sm" onClick={() => onNavigate?.('all-requests')}>View Details</button>
          </div>
        </section>
      )}
    </div>
  );
}

function SummaryCard({ label, value, subtitle, color, onClick }) {
  return (
    <div className="summary-card" style={{ borderTopColor: color }} onClick={onClick} role={onClick ? 'button' : undefined}>
      <span className="summary-card__label">{label}</span>
      <span className="summary-card__value" style={{ color }}>{value}</span>
      <span className="summary-card__subtitle">{subtitle}</span>
    </div>
  );
}

function InflowOutflowChart({ requests }) {
  const data = useMemo(() => {
    const now = Date.now();
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const dayStart = now - (i + 1) * MS_PER_DAY;
      const dayEnd = now - i * MS_PER_DAY;
      const incoming = requests.filter(r => r.requestedAt >= dayStart && r.requestedAt < dayEnd).length;
      const fulfilled = requests.filter(r =>
        (r.status === 'shipped' || r.status === 'delivered') &&
        r.shippedAt >= dayStart && r.shippedAt < dayEnd
      ).length;
      const blocked = requests.filter(r =>
        r.status === 'blocked' &&
        r.requestedAt <= dayEnd
      ).length;
      const label = new Date(dayEnd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      days.push({ date: label, incoming, fulfilled, blocked });
    }
    return days;
  }, [requests]);

  return (
    <div style={{ width: '100%', height: 240 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
          <XAxis dataKey="date" stroke="var(--text-secondary)" fontSize={11} interval={4} />
          <YAxis allowDecimals={false} stroke="var(--text-secondary)" fontSize={12} />
          <Tooltip contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }} />
          <Area type="monotone" dataKey="blocked" fill="var(--error-color)" fillOpacity={0.2} stroke="var(--error-color)" strokeWidth={1} name="Blocked" />
          <Line type="monotone" dataKey="incoming" stroke="var(--accent-color)" strokeWidth={2} dot={false} name="Incoming" />
          <Line type="monotone" dataKey="fulfilled" stroke="var(--success-color)" strokeWidth={2} dot={false} name="Fulfilled" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
