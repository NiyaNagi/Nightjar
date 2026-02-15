// frontend/src/components/inventory/admin/ApprovalQueue.jsx
// Focused queue of requests needing admin approval — bulk approve/reject

import React, { useState, useMemo, useCallback } from 'react';
import { useInventory } from '../../../contexts/InventoryContext';
import useInventorySync from '../../../hooks/useInventorySync';
import StatusBadge from '../common/StatusBadge';
import RequestDetail from '../common/RequestDetail';
import { generateId, formatRelativeDate } from '../../../utils/inventoryValidation';
import { getPublicKeyHex, base62ToPublicKeyHex, createAddressReveal } from '../../../utils/addressCrypto';
import { getAddress } from '../../../utils/inventoryAddressStore';
import './ApprovalQueue.css';

export default function ApprovalQueue() {
  const ctx = useInventory();
  const { requests, catalogItems, producerCapacities } = useInventorySync(
    { yInventorySystems: ctx.yInventorySystems, yCatalogItems: ctx.yCatalogItems, yInventoryRequests: ctx.yInventoryRequests,
      yProducerCapacities: ctx.yProducerCapacities, yAddressReveals: ctx.yAddressReveals, yPendingAddresses: ctx.yPendingAddresses,
      yInventoryAuditLog: ctx.yInventoryAuditLog },
    ctx.inventorySystemId
  );

  const [selected, setSelected] = useState(new Set());
  const [expandedId, setExpandedId] = useState(null);
  const [adminNotes, setAdminNotes] = useState({});

  // Pending approval or claimed requests
  const pendingRequests = useMemo(() =>
    requests
      .filter(r => r.status === 'pending_approval' || r.status === 'claimed')
      .sort((a, b) => {
        if (a.urgent !== b.urgent) return b.urgent ? 1 : -1;
        return (a.requestedAt || 0) - (b.requestedAt || 0);
      }),
    [requests]
  );

  const catalogMap = useMemo(() => {
    const m = {};
    catalogItems.forEach(c => { m[c.id] = c; });
    return m;
  }, [catalogItems]);

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === pendingRequests.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(pendingRequests.map(r => r.id)));
    }
  };

  const findAndUpdateRequest = useCallback((requestId, updater) => {
    const yArr = ctx.yInventoryRequests;
    if (!yArr) return;
    const arr = yArr.toArray();
    const idx = arr.findIndex(r => r.id === requestId);
    if (idx === -1) return;
    const updated = updater({ ...arr[idx] });
    yArr.delete(idx, 1);
    yArr.insert(idx, [updated]);
    return updated;
  }, [ctx.yInventoryRequests]);

  const logAudit = useCallback((action, targetId, summary) => {
    ctx.yInventoryAuditLog?.push([{
      id: generateId(),
      inventorySystemId: ctx.inventorySystemId,
      timestamp: Date.now(),
      actorId: ctx.userIdentity?.publicKeyBase62 || 'unknown',
      actorRole: 'owner',
      action,
      targetType: 'request',
      targetId,
      summary,
    }]);
  }, [ctx]);

  const handleApprove = useCallback(async (requestId) => {
    const notes = adminNotes[requestId] || '';
    const updated = findAndUpdateRequest(requestId, r => ({
      ...r,
      status: 'approved',
      approvedAt: Date.now(),
      approvedBy: ctx.userIdentity?.publicKeyBase62,
      adminNotes: notes || r.adminNotes,
    }));

    if (updated?.assignedTo) {
      // Try to create address reveal for the producer
      try {
        const adminHex = getPublicKeyHex(ctx.userIdentity);
        const producerHex = base62ToPublicKeyHex(updated.assignedTo);
        const addr = await getAddress(requestId, ctx.inventorySystemId);
        if (addr && ctx.userIdentity?.privateKey) {
          const reveal = await createAddressReveal(addr, producerHex, ctx.userIdentity.privateKey, adminHex);
          ctx.yAddressReveals?.set(requestId, reveal);
        }
      } catch (err) {
        console.warn('[ApprovalQueue] Could not create address reveal:', err);
      }
    }

    logAudit('request_approved', requestId, `Request ${requestId.slice(0, 8)} approved`);
    setSelected(prev => { const n = new Set(prev); n.delete(requestId); return n; });
  }, [findAndUpdateRequest, logAudit, ctx]);

  const handleReject = useCallback((requestId) => {
    const notes = adminNotes[requestId] || '';
    findAndUpdateRequest(requestId, r => ({
      ...r,
      status: 'open',
      assignedTo: null,
      assignedAt: null,
      claimedBy: null,
      claimedAt: null,
      adminNotes: notes || r.adminNotes,
    }));
    logAudit('request_rejected', requestId, `Request ${requestId.slice(0, 8)} rejected — returned to open pool`);
    setSelected(prev => { const n = new Set(prev); n.delete(requestId); return n; });
  }, [findAndUpdateRequest, logAudit]);

  const handleBulkApprove = async () => {
    for (const id of selected) {
      await handleApprove(id);
    }
    setSelected(new Set());
  };

  const handleBulkReject = () => {
    for (const id of selected) {
      handleReject(id);
    }
    setSelected(new Set());
  };

  const getProducerName = (key) => {
    if (!key) return 'Unassigned';
    const collab = ctx.collaborators?.find(
      c => c.publicKey === key || c.publicKeyBase62 === key
    );
    return collab?.displayName || collab?.name || key.slice(0, 8);
  };

  const getProducerCapForItem = (producerKey, itemId) => {
    const cap = producerCapacities?.[producerKey];
    return cap?.items?.[itemId] || null;
  };

  const getProducerAvgShipTime = useCallback((producerKey) => {
    if (!producerKey) return null;
    const shipped = requests.filter(r =>
      (r.assignedTo === producerKey || r.claimedBy === producerKey) &&
      (r.status === 'shipped' || r.status === 'delivered') &&
      r.shippedAt && r.requestedAt
    );
    if (shipped.length === 0) return null;
    const totalDays = shipped.reduce((s, r) => s + (r.shippedAt - r.requestedAt) / 86400000, 0);
    return (totalDays / shipped.length).toFixed(1);
  }, [requests]);

  if (pendingRequests.length === 0) {
    return (
      <div className="approval-queue">
        <div className="aq-header">
          <h2>Approval Queue</h2>
        </div>
        <div className="aq-empty">
          <span className="aq-empty-icon">✅</span>
          <p>No requests pending approval</p>
        </div>
      </div>
    );
  }

  return (
    <div className="approval-queue">
      <div className="aq-header">
        <h2>Approval Queue</h2>
        <span className="aq-badge">{pendingRequests.length} pending</span>
      </div>

      <div className="aq-actions">
        <label className="aq-select-all">
          <input
            type="checkbox"
            checked={selected.size === pendingRequests.length}
            onChange={toggleSelectAll}
          />
          Select All
        </label>
        {selected.size > 0 && (
          <>
            <button className="btn-sm btn-primary" onClick={handleBulkApprove}>
              ✓ Approve ({selected.size})
            </button>
            <button className="btn-sm btn-secondary" onClick={handleBulkReject}>
              ✗ Reject ({selected.size})
            </button>
          </>
        )}
      </div>

      <div className="aq-list">
        {pendingRequests.map(req => {
          const item = catalogMap[req.itemId];
          const producerCap = req.assignedTo
            ? getProducerCapForItem(req.assignedTo, req.itemId)
            : null;

          return (
            <div
              key={req.id}
              className={`aq-card ${req.urgent ? 'aq-card--urgent' : ''} ${expandedId === req.id ? 'aq-card--expanded' : ''}`}
            >
              <div className="aq-card-header" onClick={() => setExpandedId(expandedId === req.id ? null : req.id)}>
                <input
                  type="checkbox"
                  checked={selected.has(req.id)}
                  onClick={e => e.stopPropagation()}
                  onChange={() => toggleSelect(req.id)}
                />
                <div className="aq-card-title">
                  {req.urgent && <span className="aq-urgent">⚡</span>}
                  <span className="aq-req-id">#{req.id.slice(0, 8)}</span>
                  <StatusBadge status={req.status} />
                </div>
                <span className="aq-expand-icon">{expandedId === req.id ? '▲' : '▼'}</span>
              </div>

              <div className="aq-card-body">
                <div className="aq-card-info">
                  <span><strong>{item?.name || 'Unknown Item'}</strong></span>
                  <span>{req.quantity} {item?.unitName || 'units'}</span>
                  <span>{req.shippingCity}, {req.shippingState}</span>
                  <span>{formatRelativeDate(req.requestedAt)}</span>
                </div>

                {req.assignedTo && (
                  <div className="aq-assignment">
                    <span className="aq-assignment-label">
                      {req.status === 'claimed' ? 'Claimed by' : 'Assigned to'}:
                    </span>
                    <span className="aq-producer-name">{getProducerName(req.assignedTo)}</span>
                    {producerCap && (
                      <span className="aq-producer-detail">
                        Stock: {producerCap.currentStock || 0} {item?.unitName || 'units'}
                        {producerCap.currentStock >= req.quantity
                          ? ' (sufficient)'
                          : producerCap.capacityPerDay > 0
                            ? ` — ${Math.ceil(req.quantity / producerCap.capacityPerDay)}d production`
                            : ' (insufficient)'}
                      </span>
                    )}
                    {!producerCap && (
                      <span className="aq-no-capacity">⚠️ No capacity declared</span>
                    )}
                    {(() => {
                      const avgTime = getProducerAvgShipTime(req.assignedTo);
                      return avgTime ? (
                        <span className="aq-producer-detail">
                          Avg shipping time: {avgTime} days
                        </span>
                      ) : null;
                    })()}
                  </div>
                )}

                <div className="aq-admin-notes">
                  <label className="aq-notes-label">
                    Admin notes:
                    <input
                      type="text"
                      className="aq-notes-input"
                      value={adminNotes[req.id] || ''}
                      onChange={e => setAdminNotes(prev => ({ ...prev, [req.id]: e.target.value }))}
                      placeholder="Add note…"
                      onClick={e => e.stopPropagation()}
                    />
                  </label>
                </div>

                <div className="aq-card-actions">
                  <button className="btn-sm btn-primary" onClick={() => handleApprove(req.id)}>
                    ✓ Approve
                  </button>
                  <button className="btn-sm btn-secondary" onClick={() => handleReject(req.id)}>
                    ✗ Reject
                  </button>
                  <select
                    className="aq-reassign-select"
                    defaultValue=""
                    onChange={e => {
                      if (!e.target.value) return;
                      findAndUpdateRequest(req.id, r => ({
                        ...r,
                        assignedTo: e.target.value,
                        assignedAt: Date.now(),
                      }));
                      logAudit('request_reassigned', req.id, `Reassigned to ${e.target.value.slice(0, 8)}`);
                      e.target.value = '';
                    }}
                  >
                    <option value="">→ Reassign to…</option>
                    {(ctx.collaborators || [])
                      .filter(c => c.permission === 'editor' || c.permission === 'owner')
                      .map(c => (
                        <option key={c.publicKeyBase62 || c.publicKey} value={c.publicKeyBase62 || c.publicKey}>
                          {c.displayName || c.name || (c.publicKeyBase62 || c.publicKey || '').slice(0, 8)}
                        </option>
                      ))
                    }
                  </select>
                </div>
              </div>

              {expandedId === req.id && (
                <div className="aq-detail-wrapper">
                  <RequestDetail
                    request={req}
                    isAdmin={true}
                    isProducer={false}
                    collaborators={ctx.collaborators || []}
                    onClose={() => setExpandedId(null)}
                    onApprove={() => handleApprove(req.id)}
                    onReject={() => handleReject(req.id)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
