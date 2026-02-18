/**
 * BlockedAging.jsx
 *
 * Table + bar chart showing currently blocked/aging requests.
 * Aging distribution: 1-3d, 4-7d, 8-14d, >14d.
 *
 * See docs/INVENTORY_SYSTEM_SPEC.md §8.4.7
 */

import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts';

const AGE_BUCKETS = [
  { key: '0-3d', label: '0–3 days', min: 0, max: 3, color: '#facc15' },
  { key: '4-7d', label: '4–7 days', min: 4, max: 7, color: '#f59e0b' },
  { key: '8-14d', label: '8–14 days', min: 8, max: 14, color: '#f97316' },
  { key: '>14d', label: '>14 days', min: 15, max: Infinity, color: '#ef4444' },
];

/**
 * @param {{ requests: object[] }} props
 */
export default function BlockedAging({ requests }) {
  const { blocked, buckets } = useMemo(() => {
    const now = Date.now();
    const blocked = requests
      .filter(r => r.status === 'blocked')
      .map(r => ({
        ...r,
        ageDays: Math.floor((now - (r.requestedAt || r.createdAt || 0)) / 86400000),
      }))
      .sort((a, b) => b.ageDays - a.ageDays);

    const buckets = AGE_BUCKETS.map(b => ({ ...b, count: 0 }));
    for (const r of blocked) {
      for (const b of buckets) {
        if (r.ageDays >= b.min && r.ageDays <= b.max) {
          b.count++;
          break;
        }
      }
    }

    return { blocked, buckets };
  }, [requests]);

  return (
    <div className="blocked-aging">
      <h4>Blocked / Aging Requests ({blocked.length})</h4>

      {blocked.length === 0 ? (
        <p className="chart-empty">No blocked requests 🎉</p>
      ) : (
        <>
          {/* Age distribution chart */}
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={buckets} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
              <XAxis dataKey="label" stroke="var(--text-muted)" fontSize={12} />
              <YAxis stroke="var(--text-muted)" fontSize={12} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 8,
                  color: 'var(--text-primary)',
                }}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {buckets.map((b, i) => (
                  <Cell key={i} fill={b.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Blocked requests table */}
          <table className="ba-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>State</th>
                <th>Age</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {blocked.slice(0, 20).map(r => (
                <tr key={r.id} className={r.ageDays > 14 ? 'aged-out' : ''}>
                  <td>{r.catalogItemName || 'Unknown'}</td>
                  <td>{r.quantity}</td>
                  <td>{r.state || '—'}</td>
                  <td>{r.ageDays}d</td>
                  <td>
                    {r.ageDays > 14 && <span className="ba-alert">⚠️</span>}
                    Blocked
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {blocked.length > 20 && (
            <p className="ba-more">+ {blocked.length - 20} more blocked requests</p>
          )}
        </>
      )}
    </div>
  );
}
