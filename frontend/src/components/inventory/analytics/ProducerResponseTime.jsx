/**
 * ProducerResponseTime.jsx
 *
 * Horizontal bar chart showing each producer's average response time
 * (time from request creation to claim, and claim to in_progress).
 * Helps admins identify slow or fast producers.
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
  Cell,
} from 'recharts';

/**
 * @param {{ requests: object[], collaborators: object[], dateRange: [number,number] }} props
 */
export default function ProducerResponseTime({ requests, collaborators, dateRange }) {
  const data = useMemo(() => {
    const [from, to] = dateRange || [0, Date.now()];
    const inRange = requests.filter(r => {
      const ts = r.requestedAt || r.createdAt || 0;
      return ts >= from && ts <= to && r.assignedTo;
    });

    // Group by producer
    const byProducer = {};
    for (const r of inRange) {
      const key = r.assignedTo;
      if (!byProducer[key]) byProducer[key] = { claimTimes: [], startTimes: [], shipTimes: [] };

      if (r.claimedAt && (r.requestedAt || r.createdAt)) {
        byProducer[key].claimTimes.push(
          (r.claimedAt - (r.requestedAt || r.createdAt)) / 3600000
        );
      }
      if (r.inProgressAt && r.claimedAt) {
        byProducer[key].startTimes.push(
          (r.inProgressAt - r.claimedAt) / 3600000
        );
      }
      if (r.shippedAt && r.inProgressAt) {
        byProducer[key].shipTimes.push(
          (r.shippedAt - r.inProgressAt) / 3600000
        );
      }
    }

    const nameMap = {};
    for (const c of collaborators) {
      nameMap[c.publicKey] = c.displayName || c.publicKey?.slice(0, 8);
    }

    return Object.entries(byProducer)
      .map(([key, times]) => ({
        name: nameMap[key] || key.slice(0, 8),
        avgClaim: times.claimTimes.length > 0
          ? +(times.claimTimes.reduce((a, b) => a + b, 0) / times.claimTimes.length).toFixed(1)
          : 0,
        avgStart: times.startTimes.length > 0
          ? +(times.startTimes.reduce((a, b) => a + b, 0) / times.startTimes.length).toFixed(1)
          : 0,
        avgShip: times.shipTimes.length > 0
          ? +(times.shipTimes.reduce((a, b) => a + b, 0) / times.shipTimes.length).toFixed(1)
          : 0,
        total: times.claimTimes.length + times.startTimes.length,
      }))
      .filter(d => d.total > 0)
      .sort((a, b) => (a.avgClaim + a.avgStart) - (b.avgClaim + b.avgStart));
  }, [requests, collaborators, dateRange]);

  if (data.length === 0) {
    return <div className="chart-empty">No producer activity in this period</div>;
  }

  return (
    <div className="producer-response-time">
      <h4>Producer Response Times (hours)</h4>
      <ResponsiveContainer width="100%" height={Math.max(200, data.length * 50 + 60)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 5, right: 30, bottom: 5, left: 100 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" horizontal={false} />
          <XAxis type="number" stroke="var(--text-muted)" fontSize={12} />
          <YAxis
            type="category"
            dataKey="name"
            stroke="var(--text-muted)"
            fontSize={12}
            width={90}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 8,
              color: 'var(--text-primary)',
            }}
            formatter={(value) => [`${value}h`, '']}
          />
          <Legend />
          <Bar dataKey="avgClaim" name="Avg Claim Time" stackId="time" fill="#6366f1" barSize={20} />
          <Bar dataKey="avgStart" name="Avg Start Time" stackId="time" fill="#14b8a6" barSize={20} />
          <Bar dataKey="avgShip" name="Avg Ship Time" stackId="time" fill="#22c55e" barSize={20} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
