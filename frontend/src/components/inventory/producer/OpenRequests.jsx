// frontend/src/components/inventory/producer/OpenRequests.jsx
// Card grid of open requests producers can browse and claim

import React, { useState, useMemo, useCallback } from 'react';
import { useInventory } from '../../../contexts/InventoryContext';
import RequestCard from '../common/RequestCard';
import { generateId, formatRelativeDate } from '../../../utils/inventoryValidation';
import { pushNotification } from '../../../utils/inventoryNotifications';
import { estimateFulfillment, validateClaim } from '../../../utils/inventoryAssignment';
import SlidePanel from '../common/SlidePanel';
import RequestDetail from '../common/RequestDetail';
import './OpenRequests.css';

const PAGE_SIZE = 12;

export default function OpenRequests() {
  const ctx = useInventory();
  const { catalogItems, requests, producerCapacities } = ctx;

  const myKey = ctx.userIdentity?.publicKeyBase62;
  const myCap = producerCapacities?.[myKey] || {};

  const [filterItem, setFilterItem] = useState('');
  const [filterState, setFilterState] = useState('');
  const [filterUrgency, setFilterUrgency] = useState('');
  const [filterQtyMin, setFilterQtyMin] = useState('');
  const [filterQtyMax, setFilterQtyMax] = useState('');
  const [sortBy, setSortBy] = useState('urgency');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedRequest, setSelectedRequest] = useState(null);

  const catalogMap = useMemo(() => {
    const m = {};
    catalogItems.forEach(c => { m[c.id] = c; });
    return m;
  }, [catalogItems]);

  // States present in open requests
  const availableStates = useMemo(() => {
    const s = new Set();
    requests.forEach(r => { if (r.status === 'open' && r.state) s.add(r.state); });
    return [...s].sort();
  }, [requests]);

  // Filter and sort
  const openRequests = useMemo(() => {
    let list = requests.filter(r => r.status === 'open');
    if (filterItem) list = list.filter(r => r.catalogItemId === filterItem);
    if (filterState) list = list.filter(r => r.state === filterState);
    if (filterUrgency === 'urgent') list = list.filter(r => r.urgent);
    if (filterUrgency === 'normal') list = list.filter(r => !r.urgent);
    if (filterQtyMin) list = list.filter(r => (r.quantity || 0) >= Number(filterQtyMin));
    if (filterQtyMax) list = list.filter(r => (r.quantity || 0) <= Number(filterQtyMax));

    list.sort((a, b) => {
      switch (sortBy) {
        case 'urgency':
          if (a.urgent !== b.urgent) return b.urgent ? 1 : -1;
          return (a.requestedAt || 0) - (b.requestedAt || 0);
        case 'date':
          return (a.requestedAt || 0) - (b.requestedAt || 0);
        case 'quantity':
          return (b.quantity || 0) - (a.quantity || 0);
        case 'state':
          return (a.state || '').localeCompare(b.state || '');
        default:
          return 0;
      }
    });

    return list;
  }, [requests, filterItem, filterState, filterUrgency, filterQtyMin, filterQtyMax, sortBy]);

  // "Can fill" estimate per request
  const getEstimate = useCallback((req) => {
    const itemCap = myCap.items?.[req.catalogItemId];
    if (!itemCap) return null;
    const myAssigned = requests.filter(
      r => (r.assignedTo === myKey || r.claimedBy === myKey) &&
           r.catalogItemId === req.catalogItemId &&
           !['shipped', 'delivered', 'cancelled'].includes(r.status)
    );
    return estimateFulfillment(req.quantity, itemCap, myAssigned);
  }, [myCap, myKey, requests]);

  const formatEstimate = (est) => {
    if (!est) return 'No capacity declared';
    if (est.source === 'stock') return 'From stock';
    if (est.estimatedDate) {
      const d = new Date(est.estimatedDate);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    return 'Unknown';
  };

  const handleClaim = useCallback((requestId) => {
    const yArr = ctx.yInventoryRequests;
    if (!yArr || !myKey) return;

    const arr = yArr.toArray();
    const idx = arr.findIndex(r => r.id === requestId);
    if (idx === -1) return;

    const req = arr[idx];
    const valid = validateClaim(req);
    if (!valid.ok) {
      console.warn('[OpenRequests] Claim rejected:', valid.reason);
      return;
    }

    const updated = {
      ...req,
      status: 'claimed',
      assignedTo: myKey,
      assignedAt: Date.now(),
      claimedBy: myKey,
      claimedAt: Date.now(),
    };
    yArr.delete(idx, 1);
    yArr.insert(idx, [updated]);

    ctx.yInventoryAuditLog?.push([{
      id: generateId(),
      inventorySystemId: ctx.inventorySystemId,
      timestamp: Date.now(),
      actorId: myKey,
      actorRole: 'editor',
      action: 'request_claimed',
      targetType: 'request',
      targetId: requestId,
      summary: `Request ${requestId.slice(0, 8)} claimed by ${myKey.slice(0, 8)}`,
    }]);

    // Notify the requestor that their request was claimed
    pushNotification(ctx.yInventoryNotifications, {
      inventorySystemId: ctx.inventorySystemId,
      recipientId: req.requestedBy,
      type: 'request_claimed',
      message: `Your request for ${req.catalogItemName} was claimed by a producer`,
      relatedId: requestId,
    });
  }, [ctx, myKey]);

  return (
    <div className="open-requests">
      <div className="or-header">
        <h2>Open Requests</h2>
        <span className="or-count">{openRequests.length} available</span>
      </div>

      <div className="or-filters">
        <select value={filterItem} onChange={e => setFilterItem(e.target.value)}>
          <option value="">All Items</option>
          {catalogItems.filter(c => c.active !== false).map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select value={filterState} onChange={e => setFilterState(e.target.value)}>
          <option value="">All States</option>
          {availableStates.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select value={filterUrgency} onChange={e => setFilterUrgency(e.target.value)}>
          <option value="">Any Urgency</option>
          <option value="urgent">Urgent Only</option>
          <option value="normal">Normal Only</option>
        </select>
        <div className="or-qty-range">
          <input
            type="number"
            className="or-qty-input"
            placeholder="Min qty"
            value={filterQtyMin}
            onChange={e => setFilterQtyMin(e.target.value)}
            min="0"
          />
          <span>–</span>
          <input
            type="number"
            className="or-qty-input"
            placeholder="Max qty"
            value={filterQtyMax}
            onChange={e => setFilterQtyMax(e.target.value)}
            min="0"
          />
        </div>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="urgency">Sort: Urgency</option>
          <option value="date">Sort: Date</option>
          <option value="quantity">Sort: Quantity</option>
          <option value="state">Sort: State</option>
        </select>
      </div>

      <div className="or-grid">
        {openRequests.slice(0, visibleCount).map(req => {
          const est = getEstimate(req);
          return (
            <RequestCard
              key={req.id}
              request={req}
              showClaim={true}
              claimEstimate={formatEstimate(est)}
              onClaim={() => handleClaim(req.id)}
              onClick={() => setSelectedRequest(req)}
            />
          );
        })}
      </div>

      {openRequests.length === 0 && (
        <div className="or-empty">
          <span className="or-empty-icon">📋</span>
          <p>No open requests match your filters</p>
        </div>
      )}

      {visibleCount < openRequests.length && (
        <button className="or-load-more" onClick={() => setVisibleCount(v => v + PAGE_SIZE)}>
          Load More ({openRequests.length - visibleCount} remaining)
        </button>
      )}

      <p className="or-note">
        "Can fill" is calculated from your declared stock and capacity.
      </p>

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
            isProducer={true}
            collaborators={ctx.collaborators || []}
            onClose={() => setSelectedRequest(null)}
          />
        )}
      </SlidePanel>
    </div>
  );
}
