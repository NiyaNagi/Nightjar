/**
 * ProducerManagement.jsx
 *
 * Admin view: list all producers with capacity overview.
 * Columns: Name, Status, Stock, Rate, Fulfilled, Avg Days.
 * Click row → detail panel with assigned requests + capacity history.
 *
 * See docs/INVENTORY_SYSTEM_SPEC.md §6.4.4
 */

import React, { useMemo, useState, useCallback } from 'react';
import { useInventory } from '../../../contexts/InventoryContext';
import { useInventorySync } from '../../../hooks/useInventorySync';
import StatusBadge from '../common/StatusBadge';
import RequestDetail from '../common/RequestDetail';
import './ProducerManagement.css';

export default function ProducerManagement() {
  const ctx = useInventory();
  const sync = useInventorySync(ctx, ctx.inventorySystemId);
  const [selectedProducer, setSelectedProducer] = useState(null);

  const requests = sync.requests || [];
  const capacities = sync.producerCapacities || {};

  // Build producer list from collaborators who are editors
  const producers = useMemo(() => {
    const collaborators = ctx.collaborators || [];
    const editors = collaborators.filter(c =>
      c.permission === 'editor' || c.permission === 'owner'
    );

    return editors.map(collab => {
      const key = collab.publicKey;
      const cap = capacities[key];
      const assigned = requests.filter(r => r.assignedTo === key);
      const fulfilled = assigned.filter(r => r.status === 'shipped' || r.status === 'delivered');
      const active = assigned.filter(r =>
        ['claimed', 'pending_approval', 'approved'].includes(r.status)
      );

      // Calculate total stock across items
      let totalStock = 0;
      let totalRate = 0;
      if (cap?.items) {
        for (const item of Object.values(cap.items)) {
          totalStock += item.currentStock || 0;
          totalRate += item.capacityPerDay || 0;
        }
      }

      // Avg fulfillment days
      let avgDays = null;
      if (fulfilled.length > 0) {
        const totalDays = fulfilled.reduce((s, r) => {
          if (r.shippedAt && r.createdAt) return s + (r.shippedAt - r.createdAt) / 86400000;
          return s;
        }, 0);
        const withDays = fulfilled.filter(r => r.shippedAt && r.createdAt).length;
        if (withDays > 0) avgDays = +(totalDays / withDays).toFixed(1);
      }

      // Status
      let status = 'none';
      if (active.length > 0 && totalStock > 0) status = 'active';
      else if (active.length > 0) status = 'busy';
      else if (totalStock > 0) status = 'active';

      return {
        id: key,
        displayName: collab.displayName || key.slice(0, 8),
        status,
        totalStock,
        totalRate,
        fulfilledCount: fulfilled.length,
        activeCount: active.length,
        avgDays,
        isOnline: collab.isOnline,
        capacity: cap,
        assignedRequests: assigned,
      };
    }).sort((a, b) => b.fulfilledCount - a.fulfilledCount);
  }, [ctx.collaborators, capacities, requests]);

  const activeCount = producers.filter(p => p.status !== 'none').length;

  const statusIndicator = (status) => {
    switch (status) {
      case 'active': return <span className="pm-status-dot active" title="Active">🟢</span>;
      case 'busy': return <span className="pm-status-dot busy" title="Busy">🟡</span>;
      default: return <span className="pm-status-dot none" title="No capacity">🔴</span>;
    }
  };

  return (
    <div className="producer-management">
      <div className="pm-header">
        <h2>Producer Management</h2>
        <span className="pm-badge">{activeCount} active</span>
      </div>

      <div className="pm-layout">
        {/* Producer table */}
        <div className="pm-table-section">
          {producers.length === 0 ? (
            <div className="pm-empty">
              <p>No producers found. Invite collaborators with editor permission to become producers.</p>
            </div>
          ) : (
            <table className="pm-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Producer</th>
                  <th>Status</th>
                  <th>Stock</th>
                  <th>Rate/day</th>
                  <th>Fulfilled</th>
                  <th>Active</th>
                  <th>Avg Days</th>
                </tr>
              </thead>
              <tbody>
                {producers.map(p => (
                  <tr
                    key={p.id}
                    className={`pm-row ${selectedProducer === p.id ? 'selected' : ''}`}
                    onClick={() => setSelectedProducer(selectedProducer === p.id ? null : p.id)}
                  >
                    <td>{p.isOnline ? '🟢' : '⚪'}</td>
                    <td className="pm-name">{p.displayName}</td>
                    <td>{statusIndicator(p.status)}</td>
                    <td>{p.totalStock}</td>
                    <td>{p.totalRate}</td>
                    <td>{p.fulfilledCount}</td>
                    <td>{p.activeCount}</td>
                    <td>{p.avgDays != null ? `${p.avgDays}d` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Detail panel */}
        {selectedProducer && (() => {
          const producer = producers.find(p => p.id === selectedProducer);
          if (!producer) return null;

          return (
            <div className="pm-detail">
              <div className="pm-detail-header">
                <h3>{producer.displayName}</h3>
                <button className="btn-sm btn-secondary" onClick={() => setSelectedProducer(null)}>✕</button>
              </div>

              {/* Capacity breakdown */}
              {producer.capacity?.items && Object.keys(producer.capacity.items).length > 0 && (
                <div className="pm-detail-section">
                  <h4>Capacity by Item</h4>
                  <table className="pm-cap-table">
                    <thead>
                      <tr><th>Item</th><th>Stock</th><th>Rate/day</th></tr>
                    </thead>
                    <tbody>
                      {Object.entries(producer.capacity.items).map(([itemId, cap]) => (
                        <tr key={itemId}>
                          <td>{itemId}</td>
                          <td>{cap.currentStock || 0}</td>
                          <td>{cap.capacityPerDay || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Assigned requests */}
              <div className="pm-detail-section">
                <h4>Assigned Requests ({producer.assignedRequests.length})</h4>
                {producer.assignedRequests.length === 0 ? (
                  <p className="pm-detail-empty">No assigned requests</p>
                ) : (
                  <div className="pm-detail-requests">
                    {producer.assignedRequests.slice(0, 10).map(r => (
                      <div key={r.id} className="pm-detail-req">
                        <span className="pm-detail-req-item">{r.item}</span>
                        <span className="pm-detail-req-qty">×{r.quantity}</span>
                        <StatusBadge status={r.status} />
                      </div>
                    ))}
                    {producer.assignedRequests.length > 10 && (
                      <p className="pm-detail-more">+ {producer.assignedRequests.length - 10} more</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
