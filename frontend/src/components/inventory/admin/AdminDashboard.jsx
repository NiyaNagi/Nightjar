/**
 * AdminDashboard
 * 
 * Primary admin landing page. Summary cards, approval queue preview,
 * blocked requests, quick actions, aging requests.
 * 
 * See docs/INVENTORY_SYSTEM_SPEC.md §6.4.1 (Admin Dashboard)
 */

import React, { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import { useInventory } from '../../../contexts/InventoryContext';
import { useToast } from '../../../contexts/ToastContext';
import StatusBadge from '../common/StatusBadge';
import RequestCard from '../common/RequestCard';
import { formatDate, formatRelativeDate, generateId } from '../../../utils/inventoryValidation';
import { pushNotification } from '../../../utils/inventoryNotifications';
import { runAutoAssign } from '../../../utils/autoAssign';
import { exportRequests } from '../../../utils/inventoryExport';
import { resolveUserName } from '../../../utils/resolveUserName';
import { getPublicKeyHex, base62ToPublicKeyHex, createAddressReveal, decryptPendingAddress } from '../../../utils/addressCrypto';
import { getAddress, getWorkspaceKeyMaterial, storeAddress } from '../../../utils/inventoryAddressStore';
import ChatButton from '../../common/ChatButton';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, ComposedChart } from 'recharts';
import './AdminDashboard.css';

const MS_PER_DAY = 86400000;

export default function AdminDashboard({ onNavigate }) {
  const ctx = useInventory();
  const { yInventoryRequests, yInventoryAuditLog, inventorySystemId, collaborators, userIdentity,
    currentSystem, requests, producerCapacities, openRequestCount, pendingApprovalCount } = ctx;
  const { showToast } = useToast();

  const [assigning, setAssigning] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef(null);

  // Close export dropdown on outside click
  useEffect(() => {
    if (!showExportMenu) return;
    const handler = (e) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExportMenu]);

  const handleRunAutoAssign = useCallback(() => {
    setAssigning(true);
    try {
      const result = runAutoAssign(ctx);
      if (result.error) {
        showToast(`Auto-assign failed: ${result.error}`, 'error');
      } else {
        showToast(`Auto-assigned ${result.applied} of ${result.total} requests${result.blocked ? ` (${result.blocked} blocked)` : ''}`, 'success');
      }
    } catch (err) {
      showToast(`Auto-assign error: ${err.message}`, 'error');
    } finally {
      setAssigning(false);
    }
  }, [ctx, showToast]);

  const handleExportCSV = useCallback(() => {
    exportRequests(requests, 'csv');
    setShowExportMenu(false);
    showToast('CSV export downloaded', 'success');
  }, [requests, showToast]);

  const handleExportSummary = useCallback(() => {
    const total = requests.length;
    const statusCounts = {};
    requests.forEach(r => { statusCounts[r.status] = (statusCounts[r.status] || 0) + 1; });
    const urgentCount = requests.filter(r => r.urgent).length;
    const totalUnits = requests.reduce((s, r) => s + (r.quantity || 0), 0);

    // Top producers
    const producerFulfilled = {};
    requests.filter(r => r.status === 'shipped' || r.status === 'delivered').forEach(r => {
      const key = r.assignedTo || r.claimedBy;
      if (key) {
        if (!producerFulfilled[key]) producerFulfilled[key] = { count: 0, units: 0 };
        producerFulfilled[key].count++;
        producerFulfilled[key].units += (r.quantity || 0);
      }
    });
    const topProducers = Object.entries(producerFulfilled)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 5)
      .map(([key, val]) => {
        const name = resolveUserName(collaborators, key);
        return `  - ${name}: ${val.count} requests (${val.units.toLocaleString()} units)`;
      });

    // Avg fulfillment time
    const fulfilled = requests.filter(r => r.shippedAt && r.requestedAt);
    const avgDays = fulfilled.length > 0
      ? (fulfilled.reduce((s, r) => s + (r.shippedAt - r.requestedAt) / 86400000, 0) / fulfilled.length).toFixed(1)
      : 'N/A';

    const lines = [
      `# Inventory Report — ${new Date().toLocaleDateString()}`,
      '',
      `## Summary`,
      `- **Total Requests:** ${total}`,
      `- **Total Units:** ${totalUnits.toLocaleString()}`,
      `- **Urgent Requests:** ${urgentCount}`,
      `- **Avg. Fulfillment Time:** ${avgDays} days`,
      '',
      `## Status Breakdown`,
      ...Object.entries(statusCounts).sort(([, a], [, b]) => b - a).map(([status, count]) => `  - ${status}: ${count}`),
      '',
      `## Top Producers`,
      ...(topProducers.length > 0 ? topProducers : ['  - No fulfillments yet']),
      '',
      `---`,
      `*Generated on ${new Date().toISOString()}*`,
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory-report-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
    showToast('Summary report downloaded', 'success');
  }, [requests, collaborators, showToast]);

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

  const handleApprove = useCallback(async (req) => {
    const items = yInventoryRequests.toArray();
    const idx = items.findIndex(r => r.id === req.id);
    if (idx === -1) return;
    const updated = { ...items[idx], status: 'approved', approvedAt: Date.now(), approvedBy: userIdentity?.publicKeyBase62, updatedAt: Date.now() };
    yInventoryRequests.delete(idx, 1);
    yInventoryRequests.insert(idx, [updated]);

    // Create address reveal for the assigned producer
    if (updated.assignedTo) {
      try {
        const adminHex = getPublicKeyHex(userIdentity);
        const producerHex = base62ToPublicKeyHex(updated.assignedTo);

        // 1. Try local encrypted store (owner-submitted addresses)
        let addr = null;
        try {
          const km = getWorkspaceKeyMaterial(ctx.currentWorkspace, ctx.workspaceId);
          addr = await getAddress(km, ctx.inventorySystemId, req.id);
        } catch {
          // Key material or local address not available
        }

        // 2. Fallback: decrypt pending address from non-owner requestor
        if (!addr && ctx.yPendingAddresses) {
          const pendingEntries = ctx.yPendingAddresses.get(req.id);
          if (pendingEntries && userIdentity?.privateKey) {
            addr = await decryptPendingAddress(pendingEntries, adminHex, userIdentity.privateKey);
            if (addr) {
              try {
                const km = getWorkspaceKeyMaterial(ctx.currentWorkspace, ctx.workspaceId);
                await storeAddress(km, ctx.inventorySystemId, req.id, addr);
              } catch {
                // Non-critical: local caching failed
              }
              ctx.yPendingAddresses.delete(req.id);
            }
          }
        }

        if (addr && userIdentity?.privateKey) {
          const reveal = await createAddressReveal(addr, producerHex, userIdentity.privateKey, adminHex);
          ctx.yAddressReveals?.set(req.id, { ...reveal, inventorySystemId: ctx.inventorySystemId });
        }
      } catch (err) {
        console.warn('[AdminDashboard] Could not create address reveal:', err);
      }
    }

    yInventoryAuditLog.push([{
      id: generateId('aud-'),
      inventorySystemId,
      action: 'request_approved',
      targetId: req.id,
      targetType: 'request',
      summary: `Request ${req.id?.slice(0, 8)} approved (${req.catalogItemName})`,
      actorId: userIdentity?.publicKeyBase62 || '',
      actorRole: 'owner',
      timestamp: Date.now(),
    }]);
    // Notify the requestor
    pushNotification(ctx.yInventoryNotifications, {
      inventorySystemId,
      recipientId: req.requestedBy,
      type: 'request_approved',
      message: `Your request for ${req.catalogItemName} has been approved`,
      relatedId: req.id,
    });
    // Notify the assigned producer (if any)
    if (req.assignedTo) {
      pushNotification(ctx.yInventoryNotifications, {
        inventorySystemId,
        recipientId: req.assignedTo,
        type: 'request_approved',
        message: `Request for ${req.catalogItemName} you claimed has been approved`,
        relatedId: req.id,
      });
    }
    showToast(`Request #${req.id?.slice(4, 10)} approved`, 'success');
  }, [yInventoryRequests, yInventoryAuditLog, inventorySystemId, userIdentity, showToast, ctx.yInventoryNotifications, ctx.currentWorkspace, ctx.workspaceId, ctx.yPendingAddresses, ctx.yAddressReveals]);

  const handleReject = useCallback((req) => {
    const items = yInventoryRequests.toArray();
    const idx = items.findIndex(r => r.id === req.id);
    if (idx === -1) return;
    const updated = { ...items[idx], status: 'open', assignedTo: null, assignedAt: null, claimedBy: null, claimedAt: null, approvedAt: null, approvedBy: null, updatedAt: Date.now() };
    yInventoryRequests.delete(idx, 1);
    yInventoryRequests.insert(idx, [updated]);
    yInventoryAuditLog.push([{
      id: generateId('aud-'),
      inventorySystemId,
      action: 'request_rejected',
      targetId: req.id,
      targetType: 'request',
      summary: `Request ${req.id?.slice(0, 8)} rejected (${req.catalogItemName})`,
      actorId: userIdentity?.publicKeyBase62 || '',
      actorRole: 'owner',
      timestamp: Date.now(),
    }]);
    // Notify the requestor
    pushNotification(ctx.yInventoryNotifications, {
      inventorySystemId,
      recipientId: req.requestedBy,
      type: 'request_rejected',
      message: `Your request for ${req.catalogItemName} was returned to open`,
      relatedId: req.id,
    });
    // Notify the producer if they claimed it
    if (req.assignedTo) {
      pushNotification(ctx.yInventoryNotifications, {
        inventorySystemId,
        recipientId: req.assignedTo,
        type: 'request_rejected',
        message: `Request for ${req.catalogItemName} you claimed was rejected`,
        relatedId: req.id,
      });
    }
    showToast(`Request #${req.id?.slice(4, 10)} rejected — returned to Open`, 'success');
  }, [yInventoryRequests, yInventoryAuditLog, inventorySystemId, userIdentity, showToast, ctx.yInventoryNotifications]);

  const getAssignedName = (pubkey) => {
    if (!pubkey) return null;
    return resolveUserName(collaborators, pubkey);
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
                    ? <>
                        {req.status === 'claimed' ? 'Claimed by' : 'Assigned to'}: {getAssignedName(req.assignedTo)}
                        <ChatButton
                          publicKey={req.assignedTo}
                          name={getAssignedName(req.assignedTo)}
                          collaborators={collaborators}
                          onStartChatWith={ctx.onStartChatWith}
                          currentUserKey={userIdentity?.publicKeyBase62}
                        />
                      </>
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
                  <button className="btn-sm" onClick={() => {
                    const producers = collaborators.filter(c => c.permission === 'editor');
                    producers.forEach(p => {
                      pushNotification(ctx.yInventoryNotifications, {
                        inventorySystemId,
                        recipientId: p.publicKeyBase62,
                        type: 'blocked_request',
                        message: `Blocked request for ${req.catalogItemName} (${req.quantity} ${req.unit}) needs a producer`,
                        relatedId: req.id,
                      });
                    });
                    showToast(`Notified ${producers.length} producer(s)`, 'success');
                  }}>📧 Notify Producers</button>
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
          <button className="btn-sm" onClick={handleRunAutoAssign} disabled={assigning}>
            {assigning ? '⏳ Running…' : '🔄 Run Auto-Assign'}
          </button>
          <div className="admin-dashboard__export-wrapper" ref={exportMenuRef}>
            <button className="btn-sm" onClick={() => setShowExportMenu(v => !v)}>📤 Export Report</button>
            {showExportMenu && (
              <div className="admin-dashboard__export-menu">
                <button className="admin-dashboard__export-option" onClick={handleExportCSV}>📄 Export as CSV</button>
                <button className="admin-dashboard__export-option" onClick={handleExportSummary}>📝 Export Summary (.md)</button>
              </div>
            )}
          </div>
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
