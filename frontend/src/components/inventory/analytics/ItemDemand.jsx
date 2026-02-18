/**
 * ItemDemand.jsx
 *
 * Pie chart / treemap showing relative demand per catalog item.
 *
 * See docs/INVENTORY_SYSTEM_SPEC.md §8.4.8
 */

import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  Treemap,
} from 'recharts';

const CHART_COLORS = [
  '#6366f1', '#8b5cf6', '#a78bfa', '#22c55e', '#14b8a6',
  '#06b6d4', '#f59e0b', '#ef4444', '#ec4899', '#f97316',
];

/**
 * @param {{ requests: object[], catalogItems: object[], dateRange: [number,number] }} props
 */
export default function ItemDemand({ requests, catalogItems, dateRange }) {
  const [view, setView] = useState('pie'); // 'pie' | 'treemap'

  const data = useMemo(() => {
    const [from, to] = dateRange || [0, Date.now()];
    const inRange = requests.filter(r => (r.requestedAt || r.createdAt || 0) >= from && (r.requestedAt || r.createdAt || 0) <= to);

    const byItem = {};
    for (const r of inRange) {
      const key = r.catalogItemName || 'Unknown';
      if (!byItem[key]) byItem[key] = { name: key, value: 0, units: 0 };
      byItem[key].value++;
      byItem[key].units += r.quantity || 0;
    }

    return Object.values(byItem)
      .sort((a, b) => b.value - a.value);
  }, [requests, dateRange]);

  if (data.length === 0) {
    return <div className="chart-empty">No request data in this period</div>;
  }

  return (
    <div className="item-demand">
      <div className="id-header">
        <h4>Item Demand</h4>
        <div className="id-view-toggle">
          <button
            className={`btn-sm ${view === 'pie' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setView('pie')}
          >
            Pie
          </button>
          <button
            className={`btn-sm ${view === 'treemap' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setView('treemap')}
          >
            Treemap
          </button>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        {view === 'pie' ? (
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={110}
              dataKey="value"
              nameKey="name"
              label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
              labelLine={false}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: 8,
                color: 'var(--text-primary)',
              }}
              formatter={(value, name, props) => [
                `${value} requests (${props.payload.units} units)`,
                props.payload.name,
              ]}
            />
          </PieChart>
        ) : (
          <Treemap
            data={data}
            dataKey="value"
            nameKey="name"
            stroke="var(--bg-primary)"
            fill="var(--accent-color)"
          >
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
            <Tooltip
              contentStyle={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: 8,
                color: 'var(--text-primary)',
              }}
            />
          </Treemap>
        )}
      </ResponsiveContainer>
    </div>
  );
}
