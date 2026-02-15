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
import { useInventorySync } from '../../../hooks/useInventorySync';
import { useToast } from '../../../contexts/ToastContext';
import StatusBadge from '../common/StatusBadge';
import { formatDate, formatRelativeDate, generateId } from '../../../utils/inventoryValidation';
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
  const { yInventoryRequests, yInventoryAuditLog, inventorySystemId, userIdentity } = ctx;
  const { requests, catalogItems } = useInventorySync(
    { yInventorySystems: ctx.yInventorySystems, yCatalogItems: ctx.yCatalogItems,
      yInventoryRequests, yProducerCapacities: ctx.yProducerCapacities,
      yAddressReveals: ctx.yAddressReveals, yPendingAddresses: ctx.yPendingAddresses,
      yInventoryAuditLog },
    inventorySystemId
  );
  const { showToast } = useToast();

  const [statusFilter, setStatusFilter] = useState('all');
  const [itemFilter, setItemFilter] = useState('all');

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
    yInventoryAuditLog.push([{
      id: generateId('aud-'),
      inventorySystemId,
      action: 'request_cancelled',
      entityId: req.id,
      entityType: 'request',
      details: { item: req.catalogItemName, cancelledBy: 'requestor' },
      timestamp: Date.now(),
    }]);
    showToast(`Request #${req.id?.slice(4, 10)} cancelled`, 'success');
  }, [yInventoryRequests, yInventoryAuditLog, inventorySystemId, showToast]);

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
              <div key={req.id} className={`my-request-card ${req.urgent ? 'my-request-card--urgent' : ''}`}>
                <div className="my-request-card__header">
                  <span className="my-request-card__id">#{req.id?.slice(4, 10)}</span>
                  <span className="my-request-card__item">{req.catalogItemName}</span>
                  <span className="my-request-card__qty">{req.quantity?.toLocaleString()} {req.unit}</span>
                  {req.urgent && <span className="my-request-card__urgent">⚡</span>}
                </div>

                <div className="my-request-card__status">
                  Status: <StatusBadge status={req.status} />
                </div>

                {req.trackingNumber && (
                  <div className="my-request-card__tracking">
                    Tracking: {req.trackingNumber}
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
                    <button className="btn-sm btn-danger" onClick={() => handleCancel(req)}>Cancel Request</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
