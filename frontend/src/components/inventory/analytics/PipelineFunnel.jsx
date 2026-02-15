/**
 * PipelineFunnel.jsx
 *
 * Horizontal bar chart showing request pipeline:
 * Open → Claimed → Approved → Shipped → Delivered
 * with branches for Blocked and Cancelled.
 *
 * See docs/INVENTORY_SYSTEM_SPEC.md §8.4.6
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

const PIPELINE_STAGES = [
  { key: 'open', label: 'Open', color: '#6366f1' },
  { key: 'claimed', label: 'Claimed', color: '#8b5cf6' },
  { key: 'pending_approval', label: 'Pending', color: '#a78bfa' },
  { key: 'approved', label: 'Approved', color: '#22c55e' },
  { key: 'shipped', label: 'Shipped', color: '#14b8a6' },
  { key: 'delivered', label: 'Delivered', color: '#06b6d4' },
  { key: 'blocked', label: 'Blocked', color: '#f59e0b' },
  { key: 'cancelled', label: 'Cancelled', color: '#ef4444' },
];

/**
 * @param {{ requests: object[], dateRange: [number,number] }} props
 */
export default function PipelineFunnel({ requests, dateRange }) {
  const data = useMemo(() => {
    const [from, to] = dateRange || [0, Date.now()];
    const inRange = requests.filter(r => r.createdAt >= from && r.createdAt <= to);

    return PIPELINE_STAGES.map(stage => ({
      ...stage,
      count: inRange.filter(r => r.status === stage.key).length,
    }));
  }, [requests, dateRange]);

  const total = data.reduce((s, d) => s + d.count, 0);

  if (total === 0) {
    return <div className="chart-empty">No requests in this period</div>;
  }

  return (
    <div className="pipeline-funnel">
      <h4>Request Pipeline</h4>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 5, right: 30, bottom: 5, left: 80 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" horizontal={false} />
          <XAxis type="number" stroke="var(--text-muted)" fontSize={12} allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="label"
            stroke="var(--text-muted)"
            fontSize={12}
            width={75}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 8,
              color: 'var(--text-primary)',
            }}
            formatter={(value) => [`${value} (${total > 0 ? Math.round((value / total) * 100) : 0}%)`, 'Count']}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={24}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
