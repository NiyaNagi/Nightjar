// frontend/src/components/inventory/admin/ApprovalQueue.jsx
// Focused queue of requests needing admin approval — bulk approve/reject

import React, { useState, useMemo, useCallback } from 'react';
import { useInventory } from '../../../contexts/InventoryContext';
import StatusBadge from '../common/StatusBadge';
import RequestDetail from '../common/RequestDetail';
import { generateId, formatRelativeDate } from '../../../utils/inventoryValidation';
import { pushNotification } from '../../../utils/inventoryNotifications';
import { getPublicKeyHex, base62ToPublicKeyHex, createAddressReveal, decryptPendingAddress } from '../../../utils/addressCrypto';
import { getAddress, getWorkspaceKeyMaterial, storeAddress } from '../../../utils/inventoryAddressStore';
import { resolveUserName } from '../../../utils/resolveUserName';
import ChatButton from '../../common/ChatButton';
import './ApprovalQueue.css';

export default function ApprovalQueue() {
  const ctx = useInventory();
  const { requests, catalogItems, producerCapacities } = ctx;

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
  }, [ctx.yInventoryAuditLog, ctx.inventorySystemId, ctx.userIdentity]);

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

        // 1. Try local encrypted store (owner-submitted addresses)
        let addr = null;
        try {
          const km = getWorkspaceKeyMaterial(ctx.currentWorkspace, ctx.workspaceId);
          addr = await getAddress(km, ctx.inventorySystemId, requestId);
        } catch {
          // Key material or local address not available
        }

        // 2. Fallback: decrypt pending address from non-owner requestor
        if (!addr && ctx.yPendingAddresses) {
          const pendingEntries = ctx.yPendingAddresses.get(requestId);
          if (pendingEntries && ctx.userIdentity?.curveSecretKey) {
            addr = await decryptPendingAddress(pendingEntries, adminHex, ctx.userIdentity.curveSecretKey);
            // Store locally for future reference, then clean up pending entry
            if (addr) {
              try {
                const km = getWorkspaceKeyMaterial(ctx.currentWorkspace, ctx.workspaceId);
                await storeAddress(km, ctx.inventorySystemId, requestId, addr);
              } catch {
                // Non-critical: local caching failed
              }
              ctx.yPendingAddresses.delete(requestId);
            }
          }
        }

        if (addr && ctx.userIdentity?.curveSecretKey) {
          const reveal = await createAddressReveal(addr, producerHex, ctx.userIdentity.curveSecretKey, adminHex);
          // Attach inventorySystemId so useInventorySync can filter reveals per system
          ctx.yAddressReveals?.set(requestId, { ...reveal, inventorySystemId: ctx.inventorySystemId });
        } else if (!addr) {
          console.warn('[ApprovalQueue] Address reveal not created — address not found in local store or pending addresses for request', requestId?.slice(0, 8));
        } else if (!ctx.userIdentity?.curveSecretKey) {
          console.warn('[ApprovalQueue] Address reveal not created — admin encryption key not available');
        }
      } catch (err) {
        console.warn('[ApprovalQueue] Could not create address reveal:', err);
      }
    }

    logAudit('request_approved', requestId, `Request ${requestId.slice(0, 8)} approved`);

    // Notify the requestor
    if (updated?.requestedBy) {
      pushNotification(ctx.yInventoryNotifications, {
        inventorySystemId: ctx.inventorySystemId,
        recipientId: updated.requestedBy,
        type: 'request_approved',
        message: `Your request for ${updated.catalogItemName || 'item'} has been approved`,
        relatedId: requestId,
      });
    }
    // Notify the assigned producer (if any)
    if (updated?.assignedTo) {
      pushNotification(ctx.yInventoryNotifications, {
        inventorySystemId: ctx.inventorySystemId,
        recipientId: updated.assignedTo,
        type: 'request_approved',
        message: `Request for ${updated.catalogItemName || 'item'} you claimed has been approved`,
        relatedId: requestId,
      });
    }

    setSelected(prev => { const n = new Set(prev); n.delete(requestId); return n; });
  }, [findAndUpdateRequest, adminNotes, logAudit, ctx.userIdentity, ctx.yInventoryNotifications, ctx.inventorySystemId, ctx.currentWorkspace, ctx.workspaceId, ctx.yPendingAddresses, ctx.yAddressReveals]);

  const handleReject = useCallback((requestId) => {
    const notes = adminNotes[requestId] || '';

    // Capture original request data BEFORE modifying it (we need requestedBy and assignedTo)
    const items = ctx.yInventoryRequests?.toArray() || [];
    const originalReq = items.find(r => r.id === requestId);

    findAndUpdateRequest(requestId, r => ({
      ...r,
      status: 'open',
      assignedTo: null,
      assignedAt: null,
      claimedBy: null,
      claimedAt: null,
      approvedBy: null,
      approvedAt: null,
      adminNotes: notes || r.adminNotes,
    }));
    logAudit('request_rejected', requestId, `Request ${requestId.slice(0, 8)} rejected — returned to open pool`);

    // Notify the requestor
    if (originalReq?.requestedBy) {
      pushNotification(ctx.yInventoryNotifications, {
        inventorySystemId: ctx.inventorySystemId,
        recipientId: originalReq.requestedBy,
        type: 'request_rejected',
        message: `Your request for ${originalReq.catalogItemName || 'item'} was returned to open`,
        relatedId: requestId,
      });
    }
    // Notify the producer if they claimed it
    if (originalReq?.assignedTo) {
      pushNotification(ctx.yInventoryNotifications, {
        inventorySystemId: ctx.inventorySystemId,
        recipientId: originalReq.assignedTo,
        type: 'request_rejected',
        message: `Request for ${originalReq.catalogItemName || 'item'} you claimed was rejected`,
        relatedId: requestId,
      });
    }

    setSelected(prev => { const n = new Set(prev); n.delete(requestId); return n; });
  }, [findAndUpdateRequest, adminNotes, logAudit, ctx.yInventoryRequests, ctx.yInventoryNotifications, ctx.inventorySystemId]);

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

  // ── Stage transition handlers (admin) for RequestDetail stage bar ──

  const handleMarkInProgress = useCallback((req) => {
    findAndUpdateRequest(req.id, r => ({ ...r, status: 'in_progress', inProgressAt: Date.now(), updatedAt: Date.now() }));
    logAudit('request_in_progress', req.id, `Request ${req.id?.slice(0, 8)} marked in progress by admin`);
    if (req.requestedBy) {
      pushNotification(ctx.yInventoryNotifications, { inventorySystemId: ctx.inventorySystemId, recipientId: req.requestedBy, type: 'request_in_progress', message: `Your request for ${req.catalogItemName || 'item'} is now in progress`, relatedId: req.id });
    }
    if (req.assignedTo && req.assignedTo !== req.requestedBy) {
      pushNotification(ctx.yInventoryNotifications, { inventorySystemId: ctx.inventorySystemId, recipientId: req.assignedTo, type: 'request_in_progress', message: `Request for ${req.catalogItemName || 'item'} is now in progress`, relatedId: req.id });
    }
  }, [findAndUpdateRequest, logAudit, ctx.yInventoryNotifications, ctx.inventorySystemId]);

  const handleMarkShipped = useCallback((req, trackingNumber) => {
    findAndUpdateRequest(req.id, r => {
      const updates = { ...r, status: 'shipped', shippedAt: Date.now(), updatedAt: Date.now() };
      if (trackingNumber) updates.trackingNumber = trackingNumber;
      return updates;
    });
    logAudit('request_shipped', req.id, `Request ${req.id?.slice(0, 8)} marked shipped by admin`);
    if (req.requestedBy) {
      pushNotification(ctx.yInventoryNotifications, { inventorySystemId: ctx.inventorySystemId, recipientId: req.requestedBy, type: 'request_shipped', message: `Your request for ${req.catalogItemName || 'item'} has been shipped`, relatedId: req.id });
    }
    if (req.assignedTo && req.assignedTo !== req.requestedBy) {
      pushNotification(ctx.yInventoryNotifications, { inventorySystemId: ctx.inventorySystemId, recipientId: req.assignedTo, type: 'request_shipped', message: `Request for ${req.catalogItemName || 'item'} has been shipped`, relatedId: req.id });
    }
  }, [findAndUpdateRequest, logAudit, ctx.yInventoryNotifications, ctx.inventorySystemId]);

  const handleRevertToApproved = useCallback((req) => {
    findAndUpdateRequest(req.id, r => ({ ...r, status: 'approved', shippedAt: null, inProgressAt: null, trackingNumber: null, updatedAt: Date.now() }));
    logAudit('request_reverted_approved', req.id, `Request ${req.id?.slice(0, 8)} reverted to approved by admin`);
    if (req.requestedBy) {
      pushNotification(ctx.yInventoryNotifications, { inventorySystemId: ctx.inventorySystemId, recipientId: req.requestedBy, type: 'status_change', message: `Your request for ${req.catalogItemName || 'item'} was reverted to approved`, relatedId: req.id });
    }
    if (req.assignedTo && req.assignedTo !== req.requestedBy) {
      pushNotification(ctx.yInventoryNotifications, { inventorySystemId: ctx.inventorySystemId, recipientId: req.assignedTo, type: 'status_change', message: `Request for ${req.catalogItemName || 'item'} was reverted to approved`, relatedId: req.id });
    }
  }, [findAndUpdateRequest, logAudit, ctx.yInventoryNotifications, ctx.inventorySystemId]);

  const handleRevertToInProgress = useCallback((req) => {
    findAndUpdateRequest(req.id, r => ({ ...r, status: 'in_progress', shippedAt: null, trackingNumber: null, updatedAt: Date.now() }));
    logAudit('request_reverted_in_progress', req.id, `Request ${req.id?.slice(0, 8)} reverted to in progress by admin`);
    if (req.requestedBy) {
      pushNotification(ctx.yInventoryNotifications, { inventorySystemId: ctx.inventorySystemId, recipientId: req.requestedBy, type: 'status_change', message: `Your request for ${req.catalogItemName || 'item'} was reverted to in progress`, relatedId: req.id });
    }
    if (req.assignedTo && req.assignedTo !== req.requestedBy) {
      pushNotification(ctx.yInventoryNotifications, { inventorySystemId: ctx.inventorySystemId, recipientId: req.assignedTo, type: 'status_change', message: `Request for ${req.catalogItemName || 'item'} was reverted to in progress`, relatedId: req.id });
    }
  }, [findAndUpdateRequest, logAudit, ctx.yInventoryNotifications, ctx.inventorySystemId]);

  const getProducerName = (key) => {
    if (!key) return 'Unassigned';
    return resolveUserName(ctx.collaborators, key);
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
          const item = catalogMap[req.catalogItemId];
          const producerCap = req.assignedTo
            ? getProducerCapForItem(req.assignedTo, req.catalogItemId)
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
                  <span>{req.quantity} {item?.unit || 'units'}</span>
                  <span>{req.city}, {req.state}</span>
                  <span>{formatRelativeDate(req.requestedAt)}</span>
                </div>

                {req.assignedTo && (
                  <div className="aq-assignment">
                    <span className="aq-assignment-label">
                      {req.status === 'claimed' ? 'Claimed by' : 'Assigned to'}:
                    </span>
                    <span className="aq-producer-name">
                      {getProducerName(req.assignedTo)}
                      <ChatButton
                        publicKey={req.assignedTo}
                        name={getProducerName(req.assignedTo)}
                        collaborators={ctx.collaborators}
                        onStartChatWith={ctx.onStartChatWith}
                        currentUserKey={ctx.userIdentity?.publicKeyBase62}
                      />
                    </span>
                    {producerCap && (
                      <span className="aq-producer-detail">
                        Stock: {producerCap.currentStock || 0} {item?.unit || 'units'}
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
                          {resolveUserName(ctx.collaborators, c.publicKeyBase62 || c.publicKey)}
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
                    onMarkInProgress={() => handleMarkInProgress(req)}
                    onMarkShipped={(r, tracking) => handleMarkShipped(req, tracking)}
                    onRevertToApproved={() => handleRevertToApproved(req)}
                    onRevertToInProgress={() => handleRevertToInProgress(req)}
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
