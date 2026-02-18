/**
 * UnitsShippedByType.jsx
 *
 * Stacked bar chart showing total units shipped broken down by catalog item type.
 * Each bar is a time bucket (day/week/month), segments are colored by item.
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
  Legend,
} from 'recharts';

const CHART_COLORS = [
  '#6366f1', '#22c55e', '#f59e0b', '#14b8a6', '#ec4899',
  '#8b5cf6', '#06b6d4', '#ef4444', '#f97316', '#a78bfa',
];

/**
 * @param {{ requests: object[], catalogItems: object[], dateRange: [number,number], granularity?: 'day'|'week'|'month' }} props
 */
export default function UnitsShippedByType({ requests, catalogItems, dateRange, granularity = 'day' }) {
  const { data, itemKeys } = useMemo(() => {
    const [from, to] = dateRange || [Date.now() - 30 * 86400000, Date.now()];

    // Only shipped / delivered requests count
    const shipped = requests.filter(r =>
      (r.status === 'shipped' || r.status === 'delivered') &&
      r.shippedAt && r.shippedAt >= from && r.shippedAt <= to
    );

    // Collect unique item names
    const itemSet = new Set();
    shipped.forEach(r => itemSet.add(r.catalogItemName || 'Unknown'));
    const itemKeys = [...itemSet].sort();

    // Build time buckets
    const buckets = new Map();
    const msPerBucket = granularity === 'month' ? 30 * 86400000 : granularity === 'week' ? 7 * 86400000 : 86400000;

    for (let t = from; t <= to; t += msPerBucket) {
      const label = formatLabel(t, granularity);
      const entry = { label };
      itemKeys.forEach(k => { entry[k] = 0; });
      entry._total = 0;
      buckets.set(label, entry);
    }

    for (const r of shipped) {
      const label = formatLabel(r.shippedAt, granularity);
      const b = buckets.get(label);
      if (b) {
        const key = r.catalogItemName || 'Unknown';
        b[key] = (b[key] || 0) + (r.quantity || 0);
        b._total += (r.quantity || 0);
      }
    }

    return { data: Array.from(buckets.values()), itemKeys };
  }, [requests, dateRange, granularity]);

  // Also build a totals summary
  const totals = useMemo(() => {
    const t = {};
    for (const row of data) {
      for (const key of itemKeys) {
        t[key] = (t[key] || 0) + (row[key] || 0);
      }
    }
    return t;
  }, [data, itemKeys]);

  const grandTotal = Object.values(totals).reduce((s, v) => s + v, 0);

  if (grandTotal === 0) {
    return <div className="chart-empty">No units shipped in this period</div>;
  }

  return (
    <div className="units-shipped-chart">
      <h4>
        Units Shipped by Type
        <span className="usbt-total">{grandTotal.toLocaleString()} total units</span>
      </h4>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
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
            formatter={(value, name) => [`${value} units`, name]}
          />
          <Legend />
          {itemKeys.map((key, i) => (
            <Bar
              key={key}
              dataKey={key}
              stackId="units"
              fill={CHART_COLORS[i % CHART_COLORS.length]}
              radius={i === itemKeys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function formatLabel(ts, granularity) {
  const d = new Date(ts);
  if (granularity === 'month') {
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  }
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
}
