/**
 * InOutflowChart.jsx
 *
 * Recharts line chart showing requests in vs fulfilled over time,
 * with per-stage cumulative lines and per-catalog-item quantity lines.
 * All lines are toggleable via the legend (all visible by default).
 *
 * See docs/INVENTORY_SYSTEM_SPEC.md §8.4.2
 */

import React, { useMemo, useState, useCallback } from 'react';
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

/** Pipeline stages with their colors (matches PipelineFunnel.jsx) */
const PIPELINE_STAGES = [
  { key: 'open', label: 'Open', color: '#6366f1' },
  { key: 'claimed', label: 'Claimed', color: '#8b5cf6' },
  { key: 'pending_approval', label: 'Pending', color: '#a78bfa' },
  { key: 'approved', label: 'Approved', color: '#22c55e' },
  { key: 'in_progress', label: 'In Progress', color: '#10b981' },
  { key: 'shipped', label: 'Shipped', color: '#14b8a6' },
  { key: 'delivered', label: 'Delivered', color: '#06b6d4' },
  { key: 'blocked', label: 'Blocked', color: '#f59e0b' },
  { key: 'cancelled', label: 'Cancelled', color: '#ef4444' },
];

/** Extra colors for per-item quantity lines */
const ITEM_COLORS = [
  '#f97316', '#ec4899', '#84cc16', '#a855f7', '#3b82f6',
  '#facc15', '#f43f5e', '#0ea5e9', '#d946ef', '#64748b',
];

/**
 * @param {{ requests: object[], dateRange: [number,number], granularity?: 'day'|'week'|'month', catalogItems?: object[] }} props
 */
export default function InOutflowChart({ requests, dateRange, granularity = 'day', catalogItems }) {
  // Track which lines are hidden (all visible by default)
  const [hiddenLines, setHiddenLines] = useState(new Set());

  const { data, itemNames } = useMemo(() => {
    const [from, to] = dateRange || [Date.now() - 30 * 86400000, Date.now()];
    const result = bucketize(requests, from, to, granularity);
    // Collect unique item names for per-item quantity lines
    const names = new Set();
    for (const r of requests) {
      if (r.catalogItemName) names.add(r.catalogItemName);
    }
    return { data: result, itemNames: Array.from(names).sort() };
  }, [requests, dateRange, granularity]);

  /** Toggle a line's visibility when its legend entry is clicked */
  const handleLegendClick = useCallback((entry) => {
    const dataKey = entry.dataKey || entry.value;
    setHiddenLines(prev => {
      const next = new Set(prev);
      if (next.has(dataKey)) {
        next.delete(dataKey);
      } else {
        next.add(dataKey);
      }
      return next;
    });
  }, []);

  if (data.length === 0) {
    return <div className="chart-empty">No data for the selected period</div>;
  }

  return (
    <div className="inoutflow-chart">
      <h4>Request In / Out Flow</h4>
      <ResponsiveContainer width="100%" height={380}>
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
          <Legend
            onClick={handleLegendClick}
            wrapperStyle={{ cursor: 'pointer', fontSize: 11 }}
            formatter={(value, entry) => (
              <span style={{ color: hiddenLines.has(entry.dataKey) ? '#666' : entry.color, textDecoration: hiddenLines.has(entry.dataKey) ? 'line-through' : 'none' }}>
                {value}
              </span>
            )}
          />

          {/* Gap area (created − fulfilled) */}
          <Area
            type="monotone"
            dataKey="gap"
            fill="rgba(239,68,68,0.15)"
            stroke="none"
            name="Gap"
            hide={hiddenLines.has('gap')}
          />

          {/* Core lines: Requests In + Fulfilled */}
          <Line type="monotone" dataKey="created" stroke="#6366f1" strokeWidth={2} dot={false} name="Requests In" hide={hiddenLines.has('created')} />
          <Line type="monotone" dataKey="fulfilled" stroke="#22c55e" strokeWidth={2} dot={false} name="Fulfilled" hide={hiddenLines.has('fulfilled')} />

          {/* Per-stage cumulative lines */}
          {PIPELINE_STAGES.map(stage => (
            <Line
              key={stage.key}
              type="monotone"
              dataKey={`stage_${stage.key}`}
              stroke={stage.color}
              strokeWidth={1.5}
              strokeDasharray="4 2"
              dot={false}
              name={stage.label}
              hide={hiddenLines.has(`stage_${stage.key}`)}
            />
          ))}

          {/* Per-catalog-item quantity lines */}
          {itemNames.map((name, idx) => (
            <Line
              key={`item_${name}`}
              type="monotone"
              dataKey={`item_${name}`}
              stroke={ITEM_COLORS[idx % ITEM_COLORS.length]}
              strokeWidth={1.5}
              strokeDasharray="8 3"
              dot={false}
              name={`📦 ${name}`}
              hide={hiddenLines.has(`item_${name}`)}
            />
          ))}
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

  // Create empty buckets with proper boundaries
  const createEmptyBucket = (label) => {
    const bucket = { label, created: 0, fulfilled: 0, gap: 0 };
    // Add per-stage counters
    for (const stage of PIPELINE_STAGES) {
      bucket[`stage_${stage.key}`] = 0;
    }
    return bucket;
  };

  if (granularity === 'month') {
    // Use actual month boundaries to avoid drift
    const start = new Date(from);
    start.setDate(1); start.setHours(0, 0, 0, 0);
    const end = new Date(to);
    for (let d = new Date(start); d <= end; d.setMonth(d.getMonth() + 1)) {
      const label = formatBucketLabel(d.getTime(), granularity);
      buckets.set(label, createEmptyBucket(label));
    }
  } else {
    const msPerBucket = granularity === 'week' ? 7 * 86400000 : 86400000;
    for (let t = from; t <= to; t += msPerBucket) {
      const label = formatBucketLabel(t, granularity);
      buckets.set(label, createEmptyBucket(label));
    }
  }

  // Collect unique item names for dynamic columns
  const itemNames = new Set();
  for (const r of requests) {
    if (r.catalogItemName) itemNames.add(r.catalogItemName);
  }

  // Ensure all buckets have item columns initialized
  for (const name of itemNames) {
    for (const b of buckets.values()) {
      b[`item_${name}`] = 0;
    }
  }

  for (const r of requests) {
    const ts = r.requestedAt || r.createdAt || 0;
    if (ts >= from && ts <= to) {
      const label = formatBucketLabel(ts, granularity);
      const b = buckets.get(label);
      if (b) {
        b.created++;

        // Count per-stage
        const status = (r.status || 'open').toLowerCase().replace(/ /g, '_');
        const stageKey = `stage_${status}`;
        if (stageKey in b) {
          b[stageKey]++;
        }

        // Count per-item quantity
        if (r.catalogItemName) {
          b[`item_${r.catalogItemName}`] += (r.quantity || 1);
        }
      }
    }
    if (r.shippedAt && r.shippedAt >= from && r.shippedAt <= to) {
      const label = formatBucketLabel(r.shippedAt, granularity);
      const b = buckets.get(label);
      if (b) b.fulfilled++;
    }
  }

  // Calculate gap and make stage lines cumulative
  const result = Array.from(buckets.values());
  const cumulativeStage = {};
  const cumulativeItem = {};
  for (const stage of PIPELINE_STAGES) cumulativeStage[stage.key] = 0;
  for (const name of itemNames) cumulativeItem[name] = 0;

  for (const b of result) {
    b.gap = Math.max(0, b.created - b.fulfilled);

    // Accumulate per-stage
    for (const stage of PIPELINE_STAGES) {
      cumulativeStage[stage.key] += b[`stage_${stage.key}`];
      b[`stage_${stage.key}`] = cumulativeStage[stage.key];
    }

    // Accumulate per-item
    for (const name of itemNames) {
      cumulativeItem[name] += b[`item_${name}`];
      b[`item_${name}`] = cumulativeItem[name];
    }
  }
  return result;
}

function formatBucketLabel(ts, granularity) {
  const d = new Date(ts);
  if (granularity === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  if (granularity === 'week') {
    // ISO week start (Monday)
    const start = new Date(d);
    const dow = start.getDay() || 7;
    start.setDate(start.getDate() - dow + 1);
    return `${start.getMonth() + 1}/${start.getDate()}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
