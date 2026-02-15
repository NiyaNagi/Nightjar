/**
 * tests/inventory-assignment.test.js
 *
 * Unit tests for the inventory assignment algorithm.
 * See docs/INVENTORY_SYSTEM_SPEC.md §5.2
 */

import { assignRequests, estimateFulfillment, validateClaim } from '../frontend/src/utils/inventoryAssignment';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86400000;

function makeRequest(overrides = {}) {
  return {
    id: `req-${Math.random().toString(36).slice(2, 8)}`,
    itemId: 'item-1',
    quantity: 1,
    status: 'open',
    urgent: false,
    requestedAt: Date.now() - MS_PER_DAY,
    assignedTo: null,
    ...overrides,
  };
}

function makeCapacities(items = {}) {
  return {
    'producer-a': { items },
    'producer-b': { items },
  };
}

// ---------------------------------------------------------------------------
// assignRequests
// ---------------------------------------------------------------------------

describe('assignRequests', () => {
  it('should return empty array for empty input', () => {
    expect(assignRequests([], {}, null)).toEqual([]);
  });

  it('should skip non-open requests', () => {
    const requests = [
      makeRequest({ status: 'shipped' }),
      makeRequest({ status: 'cancelled' }),
    ];
    const result = assignRequests(requests, {});
    expect(result).toEqual([]);
  });

  it('should mark requests as blocked when no producers exist', () => {
    const requests = [makeRequest(), makeRequest()];
    const result = assignRequests(requests, {});
    expect(result).toHaveLength(2);
    result.forEach(a => {
      expect(a.source).toBe('blocked');
      expect(a.producerId).toBeNull();
      expect(a.estimatedDate).toBeNull();
    });
  });

  it('should assign from stock (Phase 1) when producer has enough stock', () => {
    const requests = [makeRequest({ quantity: 5 })];
    const capacities = {
      'producer-a': { items: { 'item-1': { currentStock: 10, capacityPerDay: 0 } } },
    };
    const result = assignRequests(requests, capacities);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('stock');
    expect(result[0].producerId).toBe('producer-a');
    expect(result[0].estimatedDate).toBeGreaterThan(0);
  });

  it('should prefer producer with most stock for stock-based assignment', () => {
    const requests = [makeRequest({ quantity: 3 })];
    const capacities = {
      'producer-a': { items: { 'item-1': { currentStock: 5, capacityPerDay: 0 } } },
      'producer-b': { items: { 'item-1': { currentStock: 20, capacityPerDay: 0 } } },
    };
    const result = assignRequests(requests, capacities);
    expect(result).toHaveLength(1);
    expect(result[0].producerId).toBe('producer-b');
    expect(result[0].source).toBe('stock');
  });

  it('should deplete stock across multiple requests', () => {
    const requests = [
      makeRequest({ id: 'r1', quantity: 5 }),
      makeRequest({ id: 'r2', quantity: 5 }),
      makeRequest({ id: 'r3', quantity: 5 }),
    ];
    const capacities = {
      'producer-a': { items: { 'item-1': { currentStock: 10, capacityPerDay: 2 } } },
    };
    const result = assignRequests(requests, capacities);
    expect(result).toHaveLength(3);

    // First two should be from stock (10 total)
    const stockAssigned = result.filter(a => a.source === 'stock');
    const capAssigned = result.filter(a => a.source === 'capacity');
    expect(stockAssigned.length).toBe(2);
    expect(capAssigned.length).toBe(1);
  });

  it('should fall back to capacity (Phase 2) when stock is insufficient', () => {
    const requests = [makeRequest({ quantity: 5 })];
    const capacities = {
      'producer-a': { items: { 'item-1': { currentStock: 0, capacityPerDay: 2 } } },
    };
    const result = assignRequests(requests, capacities);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('capacity');
    expect(result[0].producerId).toBe('producer-a');
    expect(result[0].estimatedDate).toBeGreaterThan(Date.now());
  });

  it('should prioritize urgent requests over non-urgent', () => {
    const requests = [
      makeRequest({ id: 'normal', urgent: false, requestedAt: Date.now() - 2 * MS_PER_DAY }),
      makeRequest({ id: 'urgent', urgent: true, requestedAt: Date.now() }),
    ];
    const capacities = {
      'producer-a': { items: { 'item-1': { currentStock: 1, capacityPerDay: 1 } } },
    };
    const result = assignRequests(requests, capacities);
    expect(result).toHaveLength(2);

    // Urgent should get stock, normal should get capacity
    const urgentAssignment = result.find(a => a.requestId === 'urgent');
    expect(urgentAssignment.source).toBe('stock');
  });

  it('should prioritize older requests when urgency is equal', () => {
    const requests = [
      makeRequest({ id: 'newer', urgent: false, requestedAt: Date.now() }),
      makeRequest({ id: 'older', urgent: false, requestedAt: Date.now() - 5 * MS_PER_DAY }),
    ];
    const capacities = {
      'producer-a': { items: { 'item-1': { currentStock: 1, capacityPerDay: 1 } } },
    };
    const result = assignRequests(requests, capacities);
    const olderAssignment = result.find(a => a.requestId === 'older');
    expect(olderAssignment.source).toBe('stock');
  });

  it('should handle multiple items independently', () => {
    const requests = [
      makeRequest({ id: 'r-item1', itemId: 'item-1', quantity: 1 }),
      makeRequest({ id: 'r-item2', itemId: 'item-2', quantity: 1 }),
    ];
    const capacities = {
      'producer-a': {
        items: {
          'item-1': { currentStock: 10, capacityPerDay: 0 },
          // No item-2 capacity
        },
      },
    };
    const result = assignRequests(requests, capacities);
    expect(result).toHaveLength(2);

    const item1 = result.find(a => a.requestId === 'r-item1');
    const item2 = result.find(a => a.requestId === 'r-item2');
    expect(item1.source).toBe('stock');
    expect(item2.source).toBe('blocked');
  });

  it('should filter by itemId when provided', () => {
    const requests = [
      makeRequest({ id: 'r1', itemId: 'item-1', quantity: 1 }),
      makeRequest({ id: 'r2', itemId: 'item-2', quantity: 1 }),
    ];
    const capacities = {
      'producer-a': {
        items: {
          'item-1': { currentStock: 10, capacityPerDay: 0 },
          'item-2': { currentStock: 10, capacityPerDay: 0 },
        },
      },
    };
    const result = assignRequests(requests, capacities, 'item-1');
    expect(result).toHaveLength(1);
    expect(result[0].requestId).toBe('r1');
  });

  it('should mark as blocked when no producer has capacity and stock is zero', () => {
    const requests = [makeRequest({ quantity: 5 })];
    const capacities = {
      'producer-a': { items: { 'item-1': { currentStock: 0, capacityPerDay: 0 } } },
    };
    const result = assignRequests(requests, capacities);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('blocked');
  });
});

// ---------------------------------------------------------------------------
// estimateFulfillment
// ---------------------------------------------------------------------------

describe('estimateFulfillment', () => {
  it('should return unknown for null capacity', () => {
    const result = estimateFulfillment(10, null);
    expect(result.source).toBe('unknown');
    expect(result.estimatedDate).toBeNull();
  });

  it('should return immediate for sufficient stock', () => {
    const result = estimateFulfillment(5, { currentStock: 10, capacityPerDay: 0 });
    expect(result.source).toBe('stock');
    expect(result.estimatedDate).toBeGreaterThan(0);
  });

  it('should calculate capacity-based estimate', () => {
    const result = estimateFulfillment(10, { currentStock: 0, capacityPerDay: 5 });
    expect(result.source).toBe('capacity');
    expect(result.estimatedDate).toBeGreaterThan(Date.now());
    // 10 units / 5 per day = 2 days
    const daysDiff = (result.estimatedDate - Date.now()) / MS_PER_DAY;
    expect(Math.round(daysDiff)).toBe(2);
  });

  it('should account for existing backlog', () => {
    const backlog = [{ quantity: 10 }, { quantity: 5 }];
    const result = estimateFulfillment(5, { currentStock: 0, capacityPerDay: 5 }, backlog);
    expect(result.source).toBe('capacity');
    // (5 + 15 backlog) / 5 per day = 4 days
    const daysDiff = (result.estimatedDate - Date.now()) / MS_PER_DAY;
    expect(Math.round(daysDiff)).toBe(4);
  });

  it('should return no-capacity when rate is zero and stock insufficient', () => {
    const result = estimateFulfillment(10, { currentStock: 3, capacityPerDay: 0 });
    expect(result.source).toBe('no-capacity');
    expect(result.estimatedDate).toBeNull();
  });

  it('should subtract stock from capacity calculation', () => {
    const result = estimateFulfillment(10, { currentStock: 4, capacityPerDay: 3 });
    expect(result.source).toBe('capacity');
    // remaining = 10 - 4 = 6, days = ceil(6/3) = 2
    const daysDiff = (result.estimatedDate - Date.now()) / MS_PER_DAY;
    expect(Math.round(daysDiff)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// validateClaim
// ---------------------------------------------------------------------------

describe('validateClaim', () => {
  it('should reject null request', () => {
    const result = validateClaim(null);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('not found');
  });

  it('should reject already-claimed request', () => {
    const result = validateClaim({ id: 'r1', assignedTo: 'producer-x', status: 'open' });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Already claimed');
  });

  it('should reject non-open request', () => {
    const result = validateClaim({ id: 'r1', assignedTo: null, status: 'shipped' });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('shipped');
  });

  it('should allow valid open unclaimed request', () => {
    const result = validateClaim({ id: 'r1', assignedTo: null, status: 'open' });
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});
