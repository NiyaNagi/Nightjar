/**
 * PivotTable.jsx
 *
 * Groupable, filterable data table for analytics.
 * Supports grouping by item, state, status, urgency, producer.
 *
 * See docs/INVENTORY_SYSTEM_SPEC.md §8 (pivot controls)
 */

import React, { useMemo, useState } from 'react';
import { resolveUserName } from '../../../utils/resolveUserName';

const GROUP_KEYS = [
  { key: 'item', label: 'Item', accessor: r => r.catalogItemName || 'Unknown' },
  { key: 'requesterState', label: 'State', accessor: r => r.state || 'Unknown' },
  { key: 'status', label: 'Status', accessor: r => r.status || 'Unknown' },
  { key: 'urgency', label: 'Urgency', accessor: r => r.urgent ? 'urgent' : 'normal' },
  { key: 'assignedTo', label: 'Producer', accessor: r => r.assignedTo || 'Unassigned' },
];

/**
 * @param {{ requests: object[], collaborators: object[], dateRange: [number,number] }} props
 */
export default function PivotTable({ requests, collaborators, dateRange }) {
  const [groupBy, setGroupBy] = useState('item');

  const grouped = useMemo(() => {
    const [from, to] = dateRange || [0, Date.now()];
    const inRange = requests.filter(r => (r.requestedAt || r.createdAt || 0) >= from && (r.requestedAt || r.createdAt || 0) <= to);

    const gDef = GROUP_KEYS.find(g => g.key === groupBy);
    if (!gDef) return [];

    const buckets = {};
    for (const r of inRange) {
      let key = gDef.accessor(r);
      // Resolve producer names
      if (groupBy === 'assignedTo' && key !== 'Unassigned') {
        key = resolveUserName(collaborators, key);
      }
      if (!buckets[key]) buckets[key] = { group: key, count: 0, units: 0, shipped: 0, avgDays: 0, totalDays: 0, fulfilledCount: 0 };
      const b = buckets[key];
      b.count++;
      b.units += r.quantity || 0;
      if (r.status === 'shipped' || r.status === 'delivered') {
        b.shipped++;
        if (r.shippedAt && r.requestedAt) {
          b.totalDays += (r.shippedAt - r.requestedAt) / 86400000;
          b.fulfilledCount++;
        }
      }
    }

    return Object.values(buckets)
      .map(b => ({
        ...b,
        avgDays: b.fulfilledCount > 0 ? +(b.totalDays / b.fulfilledCount).toFixed(1) : null,
        fulfillRate: b.count > 0 ? Math.round((b.shipped / b.count) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }, [requests, collaborators, dateRange, groupBy]);

  return (
    <div className="pivot-table">
      <div className="pt-header">
        <h4>Pivot Table</h4>
        <div className="pt-group-select">
          <label>Group by:</label>
          <select value={groupBy} onChange={e => setGroupBy(e.target.value)}>
            {GROUP_KEYS.map(g => (
              <option key={g.key} value={g.key}>{g.label}</option>
            ))}
          </select>
        </div>
      </div>

      {grouped.length === 0 ? (
        <p className="chart-empty">No data to display</p>
      ) : (
        <table className="pt-data-table">
          <thead>
            <tr>
              <th>{GROUP_KEYS.find(g => g.key === groupBy)?.label || 'Group'}</th>
              <th>Requests</th>
              <th>Units</th>
              <th>Shipped</th>
              <th>Fulfill %</th>
              <th>Avg Days</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(row => (
              <tr key={row.group}>
                <td>{row.group}</td>
                <td>{row.count}</td>
                <td>{row.units}</td>
                <td>{row.shipped}</td>
                <td>{row.fulfillRate}%</td>
                <td>{row.avgDays != null ? `${row.avgDays}d` : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td><strong>Total</strong></td>
              <td><strong>{grouped.reduce((s, r) => s + r.count, 0)}</strong></td>
              <td><strong>{grouped.reduce((s, r) => s + r.units, 0)}</strong></td>
              <td><strong>{grouped.reduce((s, r) => s + r.shipped, 0)}</strong></td>
              <td></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
