/**
 * FulfillmentHistogram.jsx
 *
 * Recharts bar chart showing distribution of fulfillment times.
 * Buckets: Same day, 1-2d, 3-4d, 5-7d, 8-14d, >14d
 * Color gradient: green → yellow → red.  Target line at 5 days.
 *
 * See docs/INVENTORY_SYSTEM_SPEC.md §8.4.3
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
  ReferenceLine,
  Cell,
} from 'recharts';

const BUCKETS = [
  { key: 'sameDay', label: 'Same day', max: 1, color: '#22c55e' },
  { key: '1-2d', label: '1-2 days', max: 3, color: '#4ade80' },
  { key: '3-4d', label: '3-4 days', max: 5, color: '#facc15' },
  { key: '5-7d', label: '5-7 days', max: 8, color: '#f59e0b' },
  { key: '8-14d', label: '8-14 days', max: 15, color: '#f97316' },
  { key: '>14d', label: '>14 days', max: Infinity, color: '#ef4444' },
];

/**
 * @param {{ requests: object[], dateRange: [number,number], targetDays?: number }} props
 */
export default function FulfillmentHistogram({ requests, dateRange, targetDays = 5 }) {
  const { data, withinTarget } = useMemo(() => {
    const [from, to] = dateRange || [0, Date.now()];
    const fulfilled = requests.filter(r =>
      r.shippedAt && r.createdAt &&
      r.createdAt >= from && r.createdAt <= to
    );

    const counts = BUCKETS.map(b => ({ ...b, count: 0 }));
    let inTarget = 0;

    for (const r of fulfilled) {
      const days = (r.shippedAt - r.createdAt) / 86400000;
      if (days <= targetDays) inTarget++;
      for (let i = 0; i < BUCKETS.length; i++) {
        if (days < BUCKETS[i].max) {
          counts[i].count++;
          break;
        }
      }
    }

    return {
      data: counts,
      withinTarget: fulfilled.length > 0 ? Math.round((inTarget / fulfilled.length) * 100) : 0,
    };
  }, [requests, dateRange, targetDays]);

  if (data.every(d => d.count === 0)) {
    return <div className="chart-empty">No fulfilled requests in this period</div>;
  }

  return (
    <div className="fulfillment-histogram">
      <h4>
        Fulfillment Time Distribution
        <span className="fh-target-label">{withinTarget}% within {targetDays}d target</span>
      </h4>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 10, right: 20, bottom: 5, left: 0 }}>
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
          <ReferenceLine
            x="3-4 days"
            stroke="var(--accent-color)"
            strokeDasharray="4 4"
            label={{ value: `${targetDays}d target`, position: 'top', fill: 'var(--accent-color)', fontSize: 11 }}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
