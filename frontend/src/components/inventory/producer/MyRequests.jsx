// frontend/src/components/inventory/producer/MyRequests.jsx
// Producer's kanban pipeline: Claimed → Approved → Shipped

import React, { useState, useMemo, useCallback } from 'react';
import { useInventory } from '../../../contexts/InventoryContext';
import StatusBadge from '../common/StatusBadge';
import AddressReveal from './AddressReveal';
import SlidePanel from '../common/SlidePanel';
import RequestDetail from '../common/RequestDetail';
import { generateId, formatRelativeDate } from '../../../utils/inventoryValidation';
import { pushNotification } from '../../../utils/inventoryNotifications';
import './ProducerMyRequests.css';

const PIPELINE = [
  { key: 'claimed', label: 'Claimed', desc: 'Waiting for approval' },
  { key: 'approved', label: 'Approved', desc: 'Address revealed' },
  { key: 'in_progress', label: 'In Progress', desc: 'Being prepared' },
  { key: 'shipped', label: 'Shipped', desc: 'In transit / delivered' },
];

export default function ProducerMyRequests() {
  const ctx = useInventory();
  const { catalogItems, requests, addressReveals } = ctx;

  const myKey = ctx.userIdentity?.publicKeyBase62;
  const [revealRequestId, setRevealRequestId] = useState(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [selectedRequest, setSelectedRequest] = useState(null);

  const catalogMap = useMemo(() => {
    const m = {};
    catalogItems.forEach(c => { m[c.id] = c; });
    return m;
  }, [catalogItems]);

  const myRequests = useMemo(() =>
    requests.filter(r => r.assignedTo === myKey || r.claimedBy === myKey),
    [requests, myKey]
  );

  const filteredPipeline = useMemo(() => {
    const statusToColumn = {
      'claimed': 'claimed',
      'pending_approval': 'claimed',
      'approved': 'approved',
      'in_progress': 'in_progress',
      'shipped': 'shipped',
      'delivered': 'shipped',
    };

    return PIPELINE.map(stage => ({
      ...stage,
      requests: myRequests.filter(r => {
        if (filterStatus && r.status !== filterStatus) return false;
        return statusToColumn[r.status] === stage.key;
      }),
    }));
  }, [myRequests, filterStatus]);

  const handleUnclaim = useCallback((requestId) => {
    const yArr = ctx.yInventoryRequests;
    if (!yArr) return;
    const arr = yArr.toArray();
    const idx = arr.findIndex(r => r.id === requestId);
    if (idx === -1) return;
    const updated = {
      ...arr[idx],
      status: 'open',
      assignedTo: null,
      assignedAt: null,
      claimedBy: null,
      claimedAt: null,
    };
    yArr.delete(idx, 1);
    yArr.insert(idx, [updated]);
    ctx.yAddressReveals?.delete(requestId);

    ctx.yInventoryAuditLog?.push([{
      id: generateId(),
      inventorySystemId: ctx.inventorySystemId,
      timestamp: Date.now(),
      actorId: myKey,
      actorRole: 'editor',
      action: 'request_unclaimed',
      targetType: 'request',
      targetId: requestId,
      summary: `Request ${requestId.slice(0, 8)} unclaimed`,
    }]);

    // Notify the requestor
    const req = arr[idx];
    pushNotification(ctx.yInventoryNotifications, {
      inventorySystemId: ctx.inventorySystemId,
      recipientId: req.requestedBy,
      type: 'request_unclaimed',
      message: `A producer unclaimed your request for ${req.catalogItemName}`,
      relatedId: requestId,
    });
  }, [ctx, myKey]);

  const handleMarkInProgress = useCallback((requestId) => {
    const yArr = ctx.yInventoryRequests;
    if (!yArr) return;
    const arr = yArr.toArray();
    const idx = arr.findIndex(r => r.id === requestId);
    if (idx === -1) return;
    const updated = { ...arr[idx], status: 'in_progress', inProgressAt: Date.now(), updatedAt: Date.now() };
    yArr.delete(idx, 1);
    yArr.insert(idx, [updated]);

    ctx.yInventoryAuditLog?.push([{
      id: generateId(),
      inventorySystemId: ctx.inventorySystemId,
      timestamp: Date.now(),
      actorId: myKey,
      actorRole: 'editor',
      action: 'request_in_progress',
      targetType: 'request',
      targetId: requestId,
      summary: `Request ${requestId.slice(0, 8)} marked in progress`,
    }]);

    // Notify the requestor
    const req = arr[idx];
    pushNotification(ctx.yInventoryNotifications, {
      inventorySystemId: ctx.inventorySystemId,
      recipientId: req.requestedBy,
      type: 'request_in_progress',
      message: `Your request for ${req.catalogItemName} is now in progress`,
      relatedId: requestId,
    });
  }, [ctx, myKey]);

  return (
    <div className="producer-my-requests">
      <div className="pmr-header">
        <h2>My Requests</h2>
        <span className="pmr-count">{myRequests.length} total</span>
      </div>

      <div className="pmr-filters">
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {PIPELINE.map(s => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
      </div>

      <div className="pmr-pipeline">
        {filteredPipeline.map(stage => (
          <div key={stage.key} className="pmr-stage">
            <div className="pmr-stage-header">
              <span className="pmr-stage-label">{stage.label}</span>
              <span className="pmr-stage-count">{stage.requests.length}</span>
            </div>
            <div className="pmr-stage-desc">{stage.desc}</div>
            <div className="pmr-stage-cards">
              {stage.requests.map(req => {
                const item = catalogMap[req.catalogItemId];
                const hasReveal = addressReveals?.[req.id];

                return (
                  <div key={req.id} className={`pmr-card ${req.urgent ? 'pmr-card--urgent' : ''}`}
                    onClick={() => setSelectedRequest(req)} tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') setSelectedRequest(req); }}
                    style={{ cursor: 'pointer' }}>
                    <div className="pmr-card-top">
                      <span className="pmr-card-id">#{req.id.slice(0, 6)}</span>
                      {req.urgent && <span className="pmr-card-urgent">⚡</span>}
                      <StatusBadge status={req.status} />
                    </div>
                    <div className="pmr-card-item">{item?.name || 'Unknown'}</div>
                    <div className="pmr-card-meta">
                      {req.quantity} {item?.unit || 'units'} • {req.city}, {req.state}
                    </div>
                    <div className="pmr-card-date">{formatRelativeDate(req.requestedAt)}</div>

                    {req.trackingNumber && (
                      <div className="pmr-card-tracking">
                        📦 {req.trackingNumber}
                      </div>
                    )}

                    <div className="pmr-card-actions">
                      {hasReveal && (req.status === 'approved' || req.status === 'in_progress') && (
                        <button className="pmr-btn pmr-btn--reveal" onClick={(e) => { e.stopPropagation(); setRevealRequestId(req.id); }}>
                          📍 View Address
                        </button>
                      )}
                      {req.status === 'approved' && (
                        <button className="pmr-btn pmr-btn--progress" onClick={(e) => { e.stopPropagation(); handleMarkInProgress(req.id); }}>
                          🔨 Mark In Progress
                        </button>
                      )}
                      {['claimed', 'pending_approval', 'approved', 'in_progress'].includes(req.status) && (
                        <button className="pmr-btn pmr-btn--unclaim" onClick={(e) => { e.stopPropagation(); handleUnclaim(req.id); }}>
                          ↩️ Unclaim
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {stage.requests.length === 0 && (
                <div className="pmr-stage-empty">—</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Address reveal slide panel */}
      {revealRequestId && addressReveals?.[revealRequestId] && (
        <SlidePanel
          isOpen={true}
          onClose={() => setRevealRequestId(null)}
          title="Address & Shipping"
        >
          <AddressReveal
            requestId={revealRequestId}
            reveal={addressReveals[revealRequestId]}
            identity={ctx.userIdentity}
            onShipped={() => setRevealRequestId(null)}
            onClose={() => setRevealRequestId(null)}
          />
        </SlidePanel>
      )}

      {/* Request drill-in slide panel */}
      {selectedRequest && !revealRequestId && (
        <SlidePanel
          isOpen={true}
          onClose={() => setSelectedRequest(null)}
          title={`Request #${selectedRequest.id?.slice(4, 10)}`}
        >
          <RequestDetail
            request={selectedRequest}
            isAdmin={false}
            isProducer={true}
            collaborators={ctx.collaborators || []}
            onClose={() => setSelectedRequest(null)}
            onCancel={() => { handleUnclaim(selectedRequest.id); setSelectedRequest(null); }}
            onMarkInProgress={(req) => { handleMarkInProgress(req.id); setSelectedRequest(null); }}
            onMarkShipped={(req, tracking) => {
              // If there's an address reveal, close detail and open AddressReveal panel
              // for the full shipping workflow. Otherwise close detail.
              setSelectedRequest(null);
              if (addressReveals?.[req.id]) {
                setRevealRequestId(req.id);
              }
            }}
          />
        </SlidePanel>
      )}
    </div>
  );
}
