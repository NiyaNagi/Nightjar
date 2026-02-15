/**
 * InOutflowChart.jsx
 *
 * Recharts line chart showing requests in vs fulfilled over time.
 * Blue line = requests created, Green line = fulfilled, Red shaded = gap.
 *
 * See docs/INVENTORY_SYSTEM_SPEC.md §8.4.2
 */

import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Area,
  ComposedChart,
  Legend,
} from 'recharts';

/**
 * @param {{ requests: object[], dateRange: [number,number], granularity?: 'day'|'week'|'month' }} props
 */
export default function InOutflowChart({ requests, dateRange, granularity = 'day' }) {
  const data = useMemo(() => {
    const [from, to] = dateRange || [Date.now() - 30 * 86400000, Date.now()];
    return bucketize(requests, from, to, granularity);
  }, [requests, dateRange, granularity]);

  if (data.length === 0) {
    return <div className="chart-empty">No data for the selected period</div>;
  }

  return (
    <div className="inoutflow-chart">
      <h4>Request In / Out Flow</h4>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
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
          <Legend />
          <Area
            type="monotone"
            dataKey="gap"
            fill="rgba(239,68,68,0.15)"
            stroke="none"
            name="Gap"
          />
          <Line
            type="monotone"
            dataKey="created"
            stroke="#6366f1"
            strokeWidth={2}
            dot={false}
            name="Requests In"
          />
          <Line
            type="monotone"
            dataKey="fulfilled"
            stroke="#22c55e"
            strokeWidth={2}
            dot={false}
            name="Fulfilled"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bucketize(requests, from, to, granularity) {
  const buckets = new Map();
  const msPerBucket = granularity === 'month' ? 30 * 86400000
    : granularity === 'week' ? 7 * 86400000
    : 86400000;

  // Create empty buckets
  for (let t = from; t <= to; t += msPerBucket) {
    const label = formatBucketLabel(t, granularity);
    buckets.set(label, { label, created: 0, fulfilled: 0, gap: 0 });
  }

  for (const r of requests) {
    if (r.createdAt >= from && r.createdAt <= to) {
      const label = formatBucketLabel(r.createdAt, granularity);
      const b = buckets.get(label);
      if (b) b.created++;
    }
    if (r.shippedAt && r.shippedAt >= from && r.shippedAt <= to) {
      const label = formatBucketLabel(r.shippedAt, granularity);
      const b = buckets.get(label);
      if (b) b.fulfilled++;
    }
  }

  // Calculate gap
  const result = Array.from(buckets.values());
  for (const b of result) {
    b.gap = Math.max(0, b.created - b.fulfilled);
  }
  return result;
}

function formatBucketLabel(ts, granularity) {
  const d = new Date(ts);
  if (granularity === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  if (granularity === 'week') {
    // ISO week start (Monday)
    const start = new Date(d);
    start.setDate(start.getDate() - start.getDay() + 1);
    return `${start.getMonth() + 1}/${start.getDate()}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
