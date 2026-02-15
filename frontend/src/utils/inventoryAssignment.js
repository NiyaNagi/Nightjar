// frontend/src/utils/inventoryAssignment.js
// Assignment algorithm for matching open requests to producers
// Runs locally on admin devices — see spec §5.2

const MS_PER_DAY = 86400000;

/**
 * Optimal producer selection algorithm.
 *
 * Phase 1 — assign from available stock (largest stock → largest request).
 * Phase 2 — pre-assign from future capacity (soonest availability first).
 *
 * @param {Array} requests      – All inventory requests
 * @param {Object} capacities   – Map of producerKey → { itemId, currentStock, capacityPerDay, ... }
 * @param {string} itemId       – Catalog item ID to filter by (optional – if null, groups by item)
 * @returns {Array} assignments – [{ requestId, producerId, estimatedDate, source }]
 */
export function assignRequests(requests, capacities, itemId = null) {
  const now = Date.now();
  const assignments = [];

  // Filter to open requests only
  const openRequests = requests.filter(
    r => r.status === 'open' && (!itemId || r.itemId === itemId)
  );

  // Group requests by itemId for per-item assignment
  const byItem = {};
  for (const r of openRequests) {
    if (!byItem[r.itemId]) byItem[r.itemId] = [];
    byItem[r.itemId].push(r);
  }

  for (const [currentItemId, itemRequests] of Object.entries(byItem)) {
    // Sort: urgent first, then oldest first
    const sorted = [...itemRequests].sort((a, b) => {
      if (a.urgent !== b.urgent) return b.urgent ? 1 : -1;
      return (a.requestedAt || 0) - (b.requestedAt || 0);
    });

    // Build producer availability for this item
    const producers = buildProducerPool(capacities, currentItemId, now);
    if (producers.length === 0) {
      // No producers with capacity — mark all as blocked
      for (const r of sorted) {
        assignments.push({
          requestId: r.id,
          producerId: null,
          estimatedDate: null,
          source: 'blocked',
        });
      }
      continue;
    }

    const assigned = new Set();

    // --- Phase 1: assign from available stock ---
    for (const r of sorted) {
      if (assigned.has(r.id)) continue;

      // Find producers with enough stock, sorted by stock descending (proportional matching)
      const candidates = producers
        .filter(p => p.availableStock >= r.quantity)
        .sort((a, b) => b.availableStock - a.availableStock);

      if (candidates.length > 0) {
        const best = candidates[0];
        best.availableStock -= r.quantity;
        assignments.push({
          requestId: r.id,
          producerId: best.producerKey,
          estimatedDate: now, // Immediate from stock
          source: 'stock',
        });
        assigned.add(r.id);
      }
    }

    // --- Phase 2: pre-assign from future capacity ---
    for (const r of sorted) {
      if (assigned.has(r.id)) continue;

      const candidates = producers
        .filter(p => p.capacityPerDay > 0)
        .sort((a, b) => {
          const daysA =
            Math.ceil(r.quantity / a.capacityPerDay) +
            a.dailyBacklog / a.capacityPerDay;
          const daysB =
            Math.ceil(r.quantity / b.capacityPerDay) +
            b.dailyBacklog / b.capacityPerDay;
          // Tiebreak: larger capacity handles larger requests
          if (Math.abs(daysA - daysB) < 1)
            return b.capacityPerDay - a.capacityPerDay;
          return daysA - daysB;
        });

      if (candidates.length > 0) {
        const best = candidates[0];
        const daysToFulfill = Math.ceil(r.quantity / best.capacityPerDay);
        const startDate = Math.max(now, best.nextAvailableDate);
        const estimatedDate = startDate + daysToFulfill * MS_PER_DAY;
        best.nextAvailableDate = estimatedDate;
        best.dailyBacklog += r.quantity;
        assignments.push({
          requestId: r.id,
          producerId: best.producerKey,
          estimatedDate,
          source: 'capacity',
        });
        assigned.add(r.id);
      } else {
        assignments.push({
          requestId: r.id,
          producerId: null,
          estimatedDate: null,
          source: 'blocked',
        });
      }
    }
  }

  return assignments;
}

/**
 * Build a mutable snapshot of producer availability for one catalog item.
 */
export function buildProducerPool(capacities, itemId, now) {
  const pool = [];
  if (!capacities) return pool;

  // capacities is a plain object keyed by producerKey (from Yjs map)
  for (const [producerKey, cap] of Object.entries(capacities)) {
    // Each capacity entry can hold per-item data.  The Yjs map stores
    // { items: { [itemId]: { currentStock, capacityPerDay } } }
    const itemCap = cap?.items?.[itemId];
    if (!itemCap) continue;

    pool.push({
      producerKey,
      availableStock: itemCap.currentStock || 0,
      capacityPerDay: itemCap.capacityPerDay || 0,
      nextAvailableDate: now,
      dailyBacklog: 0,
    });
  }
  return pool;
}

/**
 * Calculate an estimated fulfillment date for a single claim.
 *
 * @param {number} quantity        – Requested quantity
 * @param {Object} producerCap     – Producer's capacity for the item { currentStock, capacityPerDay }
 * @param {Array}  existingBacklog – Requests already assigned to this producer
 * @returns {{ estimatedDate: number|null, source: string }}
 */
export function estimateFulfillment(quantity, producerCap, existingBacklog = []) {
  if (!producerCap) return { estimatedDate: null, source: 'unknown' };

  const now = Date.now();
  const stock = producerCap.currentStock || 0;
  const rate = producerCap.capacityPerDay || 0;

  if (stock >= quantity) {
    return { estimatedDate: now, source: 'stock' };
  }

  if (rate <= 0) {
    return { estimatedDate: null, source: 'no-capacity' };
  }

  // Sum existing backlog
  const backlog = existingBacklog.reduce((sum, r) => sum + (r.quantity || 0), 0);
  const remaining = quantity - stock + backlog;
  const days = Math.ceil(remaining / rate);
  return {
    estimatedDate: now + days * MS_PER_DAY,
    source: 'capacity',
  };
}

/**
 * Validate that a producer can claim a request (race-condition guard).
 *
 * @param {Object} request
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateClaim(request) {
  if (!request) return { ok: false, reason: 'Request not found' };
  if (request.assignedTo) return { ok: false, reason: `Already claimed by another producer` };
  if (request.status !== 'open') return { ok: false, reason: `Request is ${request.status}` };
  return { ok: true };
}
