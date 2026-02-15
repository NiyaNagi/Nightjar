/**
 * SummaryMetrics.jsx
 *
 * KPI cards for the analytics dashboard.
 * Shows 8 key metrics with delta vs previous period.
 *
 * See docs/INVENTORY_SYSTEM_SPEC.md §8.4.1
 */

import React, { useMemo } from 'react';

const METRIC_DEFS = [
  { key: 'totalRequests', label: 'Total Requests', format: 'number' },
  { key: 'totalUnitsShipped', label: 'Units Shipped', format: 'number' },
  { key: 'avgFulfillmentDays', label: 'Avg Fulfillment', format: 'days' },
  { key: 'blockedRate', label: 'Blocked Rate', format: 'percent' },
  { key: 'activeProducers', label: 'Active Producers', format: 'number' },
  { key: 'claimRate', label: 'Claim Rate', format: 'percent' },
  { key: 'urgentPercent', label: 'Urgent %', format: 'percent' },
  { key: 'cancellationRate', label: 'Cancel Rate', format: 'percent' },
];

/**
 * @param {{ requests: object[], producerCapacities: Map, dateRange: [number,number] }} props
 */
export default function SummaryMetrics({ requests, producerCapacities, dateRange }) {
  const metrics = useMemo(() => {
    const [from, to] = dateRange || [0, Date.now()];
    const inRange = requests.filter(r => r.createdAt >= from && r.createdAt <= to);
    const total = inRange.length;

    // Previous period (same duration, offset backwards)
    const duration = to - from;
    const prevFrom = from - duration;
    const prevTo = from;
    const prevRange = requests.filter(r => r.createdAt >= prevFrom && r.createdAt <= prevTo);
    const prevTotal = prevRange.length;

    const shipped = inRange.filter(r => r.status === 'shipped' || r.status === 'delivered');
    const totalUnits = shipped.reduce((s, r) => s + (r.quantity || 0), 0);
    const prevShipped = prevRange.filter(r => r.status === 'shipped' || r.status === 'delivered');
    const prevUnits = prevShipped.reduce((s, r) => s + (r.quantity || 0), 0);

    // Avg fulfillment days
    const fulfilled = inRange.filter(r => r.shippedAt && r.createdAt);
    const avgDays = fulfilled.length > 0
      ? fulfilled.reduce((s, r) => s + (r.shippedAt - r.createdAt) / 86400000, 0) / fulfilled.length
      : 0;
    const prevFulfilled = prevRange.filter(r => r.shippedAt && r.createdAt);
    const prevAvgDays = prevFulfilled.length > 0
      ? prevFulfilled.reduce((s, r) => s + (r.shippedAt - r.createdAt) / 86400000, 0) / prevFulfilled.length
      : 0;

    const blocked = inRange.filter(r => r.status === 'blocked').length;
    const prevBlocked = prevRange.filter(r => r.status === 'blocked').length;

    const claimed = inRange.filter(r => r.assignedTo).length;
    const prevClaimed = prevRange.filter(r => r.assignedTo).length;

    const urgent = inRange.filter(r => r.urgency === 'urgent').length;
    const prevUrgent = prevRange.filter(r => r.urgency === 'urgent').length;

    const cancelled = inRange.filter(r => r.status === 'cancelled').length;
    const prevCancelled = prevRange.filter(r => r.status === 'cancelled').length;

    const activeProds = producerCapacities ? Object.keys(producerCapacities).length : 0;

    return {
      totalRequests: { value: total, prev: prevTotal },
      totalUnitsShipped: { value: totalUnits, prev: prevUnits },
      avgFulfillmentDays: { value: avgDays, prev: prevAvgDays },
      blockedRate: { value: total > 0 ? (blocked / total) * 100 : 0, prev: prevTotal > 0 ? (prevBlocked / prevTotal) * 100 : 0 },
      activeProducers: { value: activeProds, prev: activeProds },
      claimRate: { value: total > 0 ? (claimed / total) * 100 : 0, prev: prevTotal > 0 ? (prevClaimed / prevTotal) * 100 : 0 },
      urgentPercent: { value: total > 0 ? (urgent / total) * 100 : 0, prev: prevTotal > 0 ? (prevUrgent / prevTotal) * 100 : 0 },
      cancellationRate: { value: total > 0 ? (cancelled / total) * 100 : 0, prev: prevTotal > 0 ? (prevCancelled / prevTotal) * 100 : 0 },
    };
  }, [requests, producerCapacities, dateRange]);

  return (
    <div className="summary-metrics">
      {METRIC_DEFS.map(def => {
        const m = metrics[def.key];
        if (!m) return null;
        const delta = m.prev > 0 ? ((m.value - m.prev) / m.prev) * 100 : 0;
        const isUp = delta > 0;
        const isNeutral = Math.abs(delta) < 0.5;
        // For blocked/cancel rate, up is bad
        const isBad = ['blockedRate', 'cancellationRate', 'urgentPercent'].includes(def.key) && isUp;
        const isGood = ['blockedRate', 'cancellationRate', 'urgentPercent'].includes(def.key) ? !isUp : isUp;

        let displayValue;
        if (def.format === 'percent') displayValue = `${m.value.toFixed(1)}%`;
        else if (def.format === 'days') displayValue = `${m.value.toFixed(1)}d`;
        else displayValue = m.value.toLocaleString();

        return (
          <div key={def.key} className="sm-card">
            <span className="sm-card-value">{displayValue}</span>
            {!isNeutral && (
              <span className={`sm-card-delta ${isBad ? 'bad' : isGood ? 'good' : ''}`}>
                {isUp ? '↑' : '↓'} {Math.abs(delta).toFixed(0)}%
              </span>
            )}
            <span className="sm-card-label">{def.label}</span>
          </div>
        );
      })}
    </div>
  );
}
