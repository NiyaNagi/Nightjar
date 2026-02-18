/**
 * MyRequests (Requestor)
 * 
 * Timeline-based view of the current user's submitted requests.
 * Shows status, timeline dots, tracking info, and cancel option.
 * 
 * See docs/INVENTORY_SYSTEM_SPEC.md §6.6.2 (My Requests View — Requestor)
 */

import React, { useState, useMemo, useCallback } from 'react';
import { useInventory } from '../../../contexts/InventoryContext';
import { useToast } from '../../../contexts/ToastContext';
import StatusBadge from '../common/StatusBadge';
import { formatDate, formatRelativeDate, generateId } from '../../../utils/inventoryValidation';
import { pushNotification } from '../../../utils/inventoryNotifications';
import { parseTrackingNumber, genericTrackingUrl } from '../../../utils/trackingLinks';
import { getPublicKeyHex, encryptAddressForAdmins } from '../../../utils/addressCrypto';
import { getAddress, getWorkspaceKeyMaterial, storeAddress } from '../../../utils/inventoryAddressStore';
import SlidePanel from '../common/SlidePanel';
import RequestDetail from '../common/RequestDetail';
import './MyRequests.css';

const STATUS_LABELS = {
  open: '⏳ Pending Assignment',
  claimed: '👋 Claimed by Producer',
  pending_approval: '⏳ Pending Approval',
  approved: '✅ Approved',
  in_progress: '🔄 In Progress',
  shipped: '📦 Shipped',
  delivered: '✅ Delivered',
  blocked: '⚠️ Blocked',
  cancelled: '❌ Cancelled',
};

const TIMELINE_ORDER = ['open', 'claimed', 'pending_approval', 'approved', 'in_progress', 'shipped', 'delivered'];

export default function MyRequests() {
  const ctx = useInventory();
  const { yInventoryRequests, yInventoryAuditLog, inventorySystemId, userIdentity,
    requests, catalogItems } = ctx;
  const { showToast } = useToast();

  const [statusFilter, setStatusFilter] = useState('all');
  const [itemFilter, setItemFilter] = useState('all');
  const [editingId, setEditingId] = useState(null);
  const [editQty, setEditQty] = useState('');
  const [editUrgent, setEditUrgent] = useState(false);
  const [editNotes, setEditNotes] = useState('');
  const [selectedRequest, setSelectedRequest] = useState(null);

  // My requests only
  const myRequests = useMemo(() => {
    let result = requests.filter(r => r.requestedBy === userIdentity?.publicKeyBase62);

    if (statusFilter !== 'all') result = result.filter(r => r.status === statusFilter);
    if (itemFilter !== 'all') result = result.filter(r => r.catalogItemId === itemFilter);

    return result.sort((a, b) => b.requestedAt - a.requestedAt);
  }, [requests, userIdentity, statusFilter, itemFilter]);

  const handleCancel = useCallback((req) => {
    const items = yInventoryRequests.toArray();
    const idx = items.findIndex(r => r.id === req.id);
    if (idx === -1) return;
    yInventoryRequests.delete(idx, 1);
    yInventoryRequests.insert(idx, [{ ...items[idx], status: 'cancelled', updatedAt: Date.now() }]);
    // Terminal state: clean up address reveal
    ctx.yAddressReveals?.delete(req.id);
    yInventoryAuditLog.push([{
      id: generateId('aud-'),
      inventorySystemId,
      action: 'request_cancelled',
      targetId: req.id,
      targetType: 'request',
      summary: `Request cancelled by requestor: ${req.catalogItemName}`,
      actorId: userIdentity?.publicKeyBase62 || '',
      actorRole: 'viewer',
      timestamp: Date.now(),
    }]);
    // Notify the assigned producer if any
    if (req.assignedTo) {
      pushNotification(ctx.yInventoryNotifications, {
        inventorySystemId,
        recipientId: req.assignedTo,
        type: 'request_cancelled',
        message: `Request for ${req.catalogItemName} was cancelled by the requestor`,
        relatedId: req.id,
      });
    }
    showToast(`Request #${req.id?.slice(4, 10)} cancelled`, 'success');
  }, [yInventoryRequests, yInventoryAuditLog, inventorySystemId, showToast, userIdentity, ctx.yInventoryNotifications]);

  const handleConfirmDelivered = useCallback((req) => {
    const items = yInventoryRequests.toArray();
    const idx = items.findIndex(r => r.id === req.id);
    if (idx === -1) return;
    yInventoryRequests.delete(idx, 1);
    yInventoryRequests.insert(idx, [{ ...items[idx], status: 'delivered', deliveredAt: Date.now(), updatedAt: Date.now() }]);
    // Terminal state: clean up address reveal
    ctx.yAddressReveals?.delete(req.id);
    yInventoryAuditLog.push([{
      id: generateId('aud-'),
      inventorySystemId,
      action: 'request_delivered',
      targetId: req.id,
      targetType: 'request',
      summary: `Delivery confirmed by requestor: ${req.catalogItemName}`,
      actorId: userIdentity?.publicKeyBase62 || '',
      actorRole: 'viewer',
      timestamp: Date.now(),
    }]);
    // Notify the producer that delivery was confirmed
    if (req.assignedTo) {
      pushNotification(ctx.yInventoryNotifications, {
        inventorySystemId,
        recipientId: req.assignedTo,
        type: 'request_delivered',
        message: `Delivery confirmed for ${req.catalogItemName}`,
        relatedId: req.id,
      });
    }
    showToast(`Request #${req.id?.slice(4, 10)} marked as delivered`, 'success');
  }, [yInventoryRequests, yInventoryAuditLog, inventorySystemId, showToast, userIdentity, ctx.yInventoryNotifications]);

  const handleRequestAgain = useCallback(async (req) => {
    const now = Date.now();
    const requestId = generateId('req-');
    const newRequest = {
      id: requestId,
      displayId: '',
      inventorySystemId,
      catalogItemId: req.catalogItemId,
      catalogItemName: req.catalogItemName,
      quantity: req.quantity,
      unit: req.unit,
      city: req.city,
      state: req.state,
      country: req.country || 'US',
      urgent: false,
      notes: '',
      status: 'open',
      requestedBy: userIdentity?.publicKeyBase62 || 'unknown',
      requestedAt: now,
      assignedTo: null,
      approvedAt: null,
      shippedAt: null,
      trackingNumber: '',
      adminNotes: '',
      estimatedFulfillmentDate: null,
    };
    yInventoryRequests.push([newRequest]);

    // Re-encrypt the address for the new request
    // Try local store first, then copy pending entries from the original request
    try {
      const km = getWorkspaceKeyMaterial(ctx.currentWorkspace, ctx.workspaceId);
      const addr = await getAddress(km, inventorySystemId, req.id);
      if (addr) {
        // Store locally for the new request
        await storeAddress(km, inventorySystemId, requestId, addr);

        // Also encrypt for admin(s) in yPendingAddresses
        const admins = (ctx.collaborators || []).filter(
          c => c.permission === 'owner'
        );
        if (admins.length > 0 && userIdentity?.curveSecretKey) {
          const senderPubHex = getPublicKeyHex(userIdentity);
          const entries = await encryptAddressForAdmins(
            addr, admins, userIdentity.curveSecretKey, senderPubHex
          );
          ctx.yPendingAddresses?.set(requestId, entries);
        }
      }
    } catch {
      // Fallback: copy encrypted pending entries from the old request if available
      if (ctx.yPendingAddresses) {
        const oldEntries = ctx.yPendingAddresses.get(req.id);
        if (oldEntries) {
          ctx.yPendingAddresses.set(requestId, oldEntries);
        }
      }
    }

    yInventoryAuditLog.push([{
      id: generateId('aud-'),
      inventorySystemId,
      action: 'request_submitted',
      targetId: requestId,
      targetType: 'request',
      summary: `Re-request: ${req.catalogItemName} x${req.quantity} to ${req.city}, ${req.state}`,
      actorId: userIdentity?.publicKeyBase62 || '',
      actorRole: 'viewer',
      timestamp: now,
    }]);

    // Notify admins (owners) about the re-request
    if (ctx.yInventoryNotifications) {
      const admins = (ctx.collaborators || []).filter(c => c.permission === 'owner');
      for (const admin of admins) {
        const adminKey = admin.publicKeyBase62 || admin.publicKey;
        if (adminKey && adminKey !== userIdentity?.publicKeyBase62) {
          pushNotification(ctx.yInventoryNotifications, {
            inventorySystemId,
            recipientId: adminKey,
            type: 'request_submitted',
            message: `Re-request submitted: ${req.catalogItemName}`,
            relatedId: requestId,
          });
        }
      }
    }

    showToast(`New request for ${req.catalogItemName} submitted!`, 'success');
  }, [yInventoryRequests, yInventoryAuditLog, inventorySystemId, showToast, userIdentity, ctx]);

  const handleStartEdit = useCallback((req) => {
    setEditingId(req.id);
    setEditQty(String(req.quantity));
    setEditUrgent(req.urgent || false);
    setEditNotes(req.notes || '');
  }, []);

  const handleSaveEdit = useCallback((req) => {
    const qty = Number(editQty);
    if (!qty || qty <= 0) {
      showToast('Invalid quantity', 'error');
      return;
    }
    const catItem = catalogItems.find(c => c.id === req.catalogItemId);
    if (catItem) {
      if (catItem.quantityMin != null && qty < catItem.quantityMin) {
        showToast(`Minimum quantity is ${catItem.quantityMin}`, 'error');
        return;
      }
      if (catItem.quantityMax != null && qty > catItem.quantityMax) {
        showToast(`Maximum quantity is ${catItem.quantityMax}`, 'error');
        return;
      }
    }
    const items = yInventoryRequests.toArray();
    const idx = items.findIndex(r => r.id === req.id);
    if (idx === -1) return;
    yInventoryRequests.delete(idx, 1);
    yInventoryRequests.insert(idx, [{
      ...items[idx],
      quantity: qty,
      urgent: editUrgent,
      notes: editNotes.trim(),
      updatedAt: Date.now(),
    }]);
    yInventoryAuditLog.push([{
      id: generateId('aud-'),
      inventorySystemId,
      action: 'request_edited',
      targetId: req.id,
      targetType: 'request',
      summary: `Request edited: qty=${qty}, urgent=${editUrgent}`,
      actorId: userIdentity?.publicKeyBase62 || '',
      actorRole: 'viewer',
      timestamp: Date.now(),
    }]);
    setEditingId(null);
    showToast('Request updated', 'success');
  }, [editQty, editUrgent, editNotes, yInventoryRequests, yInventoryAuditLog, inventorySystemId, showToast, userIdentity, catalogItems]);

  // Build timeline for a request
  const getTimeline = (req) => {
    const steps = [];
    if (req.requestedAt) steps.push({ label: 'Requested', date: req.requestedAt });
    if (req.assignedAt) steps.push({ label: 'Assigned', date: req.assignedAt });
    if (req.approvedAt) steps.push({ label: 'Approved', date: req.approvedAt });
    if (req.shippedAt) steps.push({ label: 'Shipped', date: req.shippedAt });
    if (req.deliveredAt) steps.push({ label: 'Delivered', date: req.deliveredAt });
    return steps;
  };

  const canCancel = (status) => ['open', 'pending_approval', 'claimed'].includes(status);

  return (
    <div className="requestor-my-requests">
      <div className="requestor-my-requests__header">
        <h2>My Requests</h2>
        <span className="requestor-my-requests__count">{myRequests.length} total</span>
      </div>

      <div className="requestor-my-requests__filters">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All Statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select value={itemFilter} onChange={e => setItemFilter(e.target.value)}>
          <option value="all">All Items</option>
          {catalogItems.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </div>

      {myRequests.length === 0 ? (
        <div className="requestor-my-requests__empty">
          {statusFilter !== 'all' || itemFilter !== 'all'
            ? 'No requests match your filters.'
            : "You haven't submitted any requests yet."}
        </div>
      ) : (
        <div className="requestor-my-requests__list">
          {myRequests.map(req => {
            const timeline = getTimeline(req);
            return (
              <div key={req.id} className={`my-request-card ${req.urgent ? 'my-request-card--urgent' : ''}`}
                onClick={() => setSelectedRequest(req)} tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') setSelectedRequest(req); }}
                style={{ cursor: 'pointer' }}>
                <div className="my-request-card__header">
                  <span className="my-request-card__id">#{req.id?.slice(4, 10)}</span>
                  <span className="my-request-card__item">{req.catalogItemName}</span>
                  {editingId === req.id ? (
                    <span className="my-request-card__qty">
                      <input type="number" value={editQty} onChange={e => setEditQty(e.target.value)} min="1" className="edit-qty-input" />
                      {req.unit}
                    </span>
                  ) : (
                    <span className="my-request-card__qty">{req.quantity?.toLocaleString()} {req.unit}</span>
                  )}
                  {editingId === req.id ? (
                    <label className="my-request-card__urgent-edit">
                      <input type="checkbox" checked={editUrgent} onChange={e => setEditUrgent(e.target.checked)} /> ⚡
                    </label>
                  ) : (
                    req.urgent && <span className="my-request-card__urgent">⚡</span>
                  )}
                </div>

                {editingId === req.id && (
                  <div className="my-request-card__edit-notes">
                    <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Notes..." rows={2} />
                    <div className="my-request-card__edit-actions">
                      <button className="btn-sm btn-primary" onClick={() => handleSaveEdit(req)}>💾 Save</button>
                      <button className="btn-sm btn-secondary" onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  </div>
                )}

                <div className="my-request-card__status">
                  Status: <StatusBadge status={req.status} />
                </div>

                {req.trackingNumber && (
                  <div className="my-request-card__tracking">
                    {(() => {
                      const carrier = parseTrackingNumber(req.trackingNumber);
                      const url = carrier?.url || genericTrackingUrl(req.trackingNumber);
                      return (
                        <a href={url} target="_blank" rel="noopener noreferrer">
                          {carrier ? `${carrier.icon} ${carrier.carrier}: ` : 'Tracking: '}{req.trackingNumber} ↗
                        </a>
                      );
                    })()}
                  </div>
                )}

                {req.estimatedFulfillmentDate && req.status !== 'shipped' && req.status !== 'delivered' && (
                  <div className="my-request-card__estimate">
                    Est. Fulfillment: {formatDate(req.estimatedFulfillmentDate)}
                  </div>
                )}

                {/* Timeline */}
                {timeline.length > 0 && (
                  <div className="my-request-card__timeline">
                    <div className="my-timeline">
                      {timeline.map((step, i) => (
                        <div key={i} className="my-timeline__step">
                          <div className={`my-timeline__dot ${i === timeline.length - 1 ? 'current' : 'past'}`} />
                          {i < timeline.length - 1 && <div className="my-timeline__line" />}
                          <div className="my-timeline__info">
                            <span className="my-timeline__date">{formatDate(step.date, { short: true })}</span>
                            <span className="my-timeline__label">{step.label}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {canCancel(req.status) && (
                  <div className="my-request-card__actions">
                    {req.status === 'open' && editingId !== req.id && (
                      <button className="btn-sm btn-secondary" onClick={(e) => { e.stopPropagation(); handleStartEdit(req); }}>✏️ Edit</button>
                    )}
                    <button className="btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); handleCancel(req); }}>Cancel Request</button>
                  </div>
                )}
                {req.status === 'shipped' && (
                  <div className="my-request-card__actions">
                    <button className="btn-sm btn-success" onClick={(e) => { e.stopPropagation(); handleConfirmDelivered(req); }}>📬 Confirm Delivered</button>
                  </div>
                )}
                {['shipped', 'delivered', 'cancelled'].includes(req.status) && (
                  <div className="my-request-card__actions">
                    <button className="btn-sm btn-secondary" onClick={(e) => { e.stopPropagation(); handleRequestAgain(req); }}>🔄 Request Again</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Request drill-in slide panel */}
      <SlidePanel
        isOpen={!!selectedRequest}
        onClose={() => setSelectedRequest(null)}
        title={selectedRequest ? `Request #${selectedRequest.id?.slice(4, 10)}` : 'Request Detail'}
      >
        {selectedRequest && (
          <RequestDetail
            request={selectedRequest}
            isAdmin={false}
            isProducer={false}
            collaborators={ctx.collaborators || []}
            onClose={() => setSelectedRequest(null)}
            onCancel={(req) => { handleCancel(req); setSelectedRequest(null); }}
          />
        )}
      </SlidePanel>
    </div>
  );
}
