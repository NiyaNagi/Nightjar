// frontend/src/components/inventory/producer/ProducerDashboard.jsx
// Producer's main view: capacity inputs + kanban of active requests

import React, { useState, useMemo, useCallback } from 'react';
import { useInventory } from '../../../contexts/InventoryContext';
import useInventorySync from '../../../hooks/useInventorySync';
import CapacityInput from '../common/CapacityInput';
import StatusBadge from '../common/StatusBadge';
import AddressReveal from './AddressReveal';
import { generateId, formatRelativeDate } from '../../../utils/inventoryValidation';
import './ProducerDashboard.css';

const KANBAN_COLUMNS = [
  { key: 'claimed', label: 'Claimed', statuses: ['claimed'] },
  { key: 'approved', label: 'Approved', statuses: ['approved'] },
  { key: 'ready', label: 'Ready to Ship', statuses: ['pending_approval'] },
  { key: 'shipped', label: 'Shipped', statuses: ['shipped'] },
];

export default function ProducerDashboard() {
  const ctx = useInventory();
  const { catalogItems, requests, producerCapacities, addressReveals } = useInventorySync(
    { yInventorySystems: ctx.yInventorySystems, yCatalogItems: ctx.yCatalogItems, yInventoryRequests: ctx.yInventoryRequests,
      yProducerCapacities: ctx.yProducerCapacities, yAddressReveals: ctx.yAddressReveals, yPendingAddresses: ctx.yPendingAddresses,
      yInventoryAuditLog: ctx.yInventoryAuditLog },
    ctx.inventorySystemId
  );

  const myKey = ctx.userIdentity?.publicKeyBase62;
  const [revealRequestId, setRevealRequestId] = useState(null);

  // My capacity data
  const myCap = producerCapacities?.[myKey] || {};

  // My requests — kanban cards
  const myRequests = useMemo(() =>
    requests.filter(r => r.assignedTo === myKey || r.claimedBy === myKey),
    [requests, myKey]
  );

  const catalogMap = useMemo(() => {
    const m = {};
    catalogItems.forEach(c => { m[c.id] = c; });
    return m;
  }, [catalogItems]);

  // Save capacity for one item
  const handleSaveCapacity = useCallback((itemId, values) => {
    if (!ctx.yProducerCapacities || !myKey) return;
    const existing = ctx.yProducerCapacities.get(myKey) || {};
    const updated = {
      ...existing,
      items: {
        ...(existing.items || {}),
        [itemId]: {
          ...(existing.items?.[itemId] || {}),
          ...values,
          updatedAt: Date.now(),
        },
      },
      updatedAt: Date.now(),
    };
    ctx.yProducerCapacities.set(myKey, updated);

    ctx.yInventoryAuditLog?.push([{
      id: generateId(),
      inventorySystemId: ctx.inventorySystemId,
      timestamp: Date.now(),
      actorId: myKey,
      actorRole: 'editor',
      action: 'capacity_updated',
      targetType: 'capacity',
      targetId: itemId,
      summary: `Capacity updated: stock=${values.currentStock}, rate=${values.capacityPerDay}/day`,
    }]);
  }, [ctx, myKey]);

  const handleUnclaim = useCallback((requestId) => {
    const yArr = ctx.yInventoryRequests;
    if (!yArr) return;
    const arr = yArr.toArray();
    const idx = arr.findIndex(r => r.id === requestId);
    if (idx === -1) return;
    const req = arr[idx];
    const updated = {
      ...req,
      status: 'open',
      assignedTo: null,
      assignedAt: null,
      claimedBy: null,
      claimedAt: null,
    };
    yArr.delete(idx, 1);
    yArr.insert(idx, [updated]);

    // Delete address reveal if exists
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
  }, [ctx, myKey]);

  // My stats
  const stats = useMemo(() => {
    const shipped = myRequests.filter(r => r.status === 'shipped' || r.status === 'delivered');
    const totalUnits = shipped.reduce((s, r) => s + (r.quantity || 0), 0);

    // Avg shipping time
    const shippingTimes = shipped
      .filter(r => r.shippedAt && r.requestedAt)
      .map(r => (r.shippedAt - r.requestedAt) / 86400000);
    const avgShippingDays = shippingTimes.length > 0
      ? (shippingTimes.reduce((a, b) => a + b, 0) / shippingTimes.length).toFixed(1)
      : '—';

    // This month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const thisMonth = shipped.filter(r => (r.shippedAt || 0) >= startOfMonth.getTime()).length;

    // Rank among all producers
    const producerShipped = {};
    requests.forEach(r => {
      if (r.status === 'shipped' || r.status === 'delivered') {
        const key = r.assignedTo || r.claimedBy;
        if (key) producerShipped[key] = (producerShipped[key] || 0) + 1;
      }
    });
    const ranking = Object.entries(producerShipped).sort(([, a], [, b]) => b - a);
    const myRank = ranking.findIndex(([k]) => k === myKey) + 1;

    return { fulfilled: shipped.length, units: totalUnits, avgShippingDays, thisMonth, rank: myRank || '—', totalProducers: ranking.length };
  }, [myRequests, requests, myKey]);

  return (
    <div className="producer-dashboard">
      <div className="pd-header">
        <h2>Producer Dashboard</h2>
        <span className="pd-welcome">
          Welcome, {ctx.userIdentity?.displayName || ctx.userIdentity?.name || 'Producer'} 🏭
        </span>
      </div>

      {/* Capacity section */}
      <section className="pd-section">
        <h3>My Capacity</h3>
        <div className="pd-capacity-grid">
          {catalogItems.filter(c => c.isActive !== false).map(item => (
            <CapacityInput
              key={item.id}
              item={item}
              capacity={myCap.items?.[item.id] || null}
              onSave={handleSaveCapacity}
            />
          ))}
        </div>
      </section>

      {/* Kanban pipeline */}
      <section className="pd-section">
        <h3>My Active Requests</h3>
        <div className="pd-kanban">
          {KANBAN_COLUMNS.map(col => {
            const colReqs = myRequests.filter(r => col.statuses.includes(r.status));
            return (
              <div key={col.key} className="pd-kanban-col">
                <div className="pd-kanban-col-header">
                  <span>{col.label}</span>
                  <span className="pd-kanban-count">{colReqs.length}</span>
                </div>
                <div className="pd-kanban-cards">
                  {colReqs.map(req => {
                    const item = catalogMap[req.itemId];
                    const hasReveal = addressReveals?.[req.id];
                    return (
                      <div key={req.id} className={`pd-kanban-card ${req.urgent ? 'pd-kanban-card--urgent' : ''}`}>
                        <div className="pd-kanban-card-top">
                          <span className="pd-card-id">#{req.id.slice(0, 6)}</span>
                          {req.urgent && <span className="pd-urgent">⚡</span>}
                        </div>
                        <div className="pd-card-item">{item?.name || 'Unknown'}</div>
                        <div className="pd-card-detail">
                          {req.quantity} {item?.unitName || 'un'} • {req.shippingState}
                        </div>
                        <StatusBadge status={req.status} />

                        {hasReveal && req.status === 'approved' && (
                          <button
                            className="pd-reveal-btn"
                            onClick={() => setRevealRequestId(req.id)}
                          >
                            📍 View Address
                          </button>
                        )}

                        {(req.status === 'claimed' || req.status === 'approved') && (
                          <button
                            className="pd-unclaim-btn"
                            onClick={() => handleUnclaim(req.id)}
                          >
                            ↩️ Unclaim
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {colReqs.length === 0 && (
                    <div className="pd-kanban-empty">No requests</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Stats */}
      <section className="pd-section pd-stats-bar">
        <span>Fulfilled: <strong>{stats.fulfilled}</strong></span>
        <span>{stats.units.toLocaleString()} units</span>
        <span>Avg ship: <strong>{stats.avgShippingDays}d</strong></span>
        <span>This month: <strong>{stats.thisMonth}</strong></span>
        <span>Rank: <strong>#{stats.rank}</strong> of {stats.totalProducers}</span>
      </section>

      {/* Address reveal modal */}
      {revealRequestId && addressReveals?.[revealRequestId] && (
        <div className="pd-overlay" onClick={() => setRevealRequestId(null)}>
          <div className="pd-modal" onClick={e => e.stopPropagation()}>
            <AddressReveal
              requestId={revealRequestId}
              reveal={addressReveals[revealRequestId]}
              identity={ctx.userIdentity}
              onShipped={() => setRevealRequestId(null)}
              onClose={() => setRevealRequestId(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
