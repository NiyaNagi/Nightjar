/**
 * StatusTransitions.jsx
 *
 * Shows a summary of request outcomes: how many ended up delivered, cancelled,
 * or are still in-flight. Also shows the average time in each stage.
 * Presented as a compact table with inline bar visualization.
 */

import React, { useMemo } from 'react';

const STAGES = [
  { key: 'open', label: 'Open', color: '#6366f1' },
  { key: 'claimed', label: 'Claimed', color: '#8b5cf6' },
  { key: 'approved', label: 'Approved', color: '#22c55e' },
  { key: 'in_progress', label: 'In Progress', color: '#14b8a6' },
  { key: 'shipped', label: 'Shipped', color: '#06b6d4' },
  { key: 'delivered', label: 'Delivered', color: '#10b981' },
];

/**
 * @param {{ requests: object[], dateRange: [number,number] }} props
 */
export default function StatusTransitions({ requests, dateRange }) {
  const stats = useMemo(() => {
    const [from, to] = dateRange || [0, Date.now()];
    const inRange = requests.filter(r => {
      const ts = r.requestedAt || r.createdAt || 0;
      return ts >= from && ts <= to;
    });

    const total = inRange.length;
    if (total === 0) return null;

    // Count by terminal / current status
    const delivered = inRange.filter(r => r.status === 'delivered').length;
    const cancelled = inRange.filter(r => r.status === 'cancelled').length;
    const blocked = inRange.filter(r => r.status === 'blocked').length;
    const inFlight = total - delivered - cancelled;

    // Average time in each stage (for completed requests)
    const completedRequests = inRange.filter(r => r.status === 'delivered' || r.status === 'shipped');
    const avgTimes = {};
    if (completedRequests.length > 0) {
      const timeDiffs = {
        'open → claimed': completedRequests.filter(r => r.claimedAt && r.requestedAt).map(r => r.claimedAt - (r.requestedAt || r.createdAt)),
        'claimed → approved': completedRequests.filter(r => r.approvedAt && r.claimedAt).map(r => r.approvedAt - r.claimedAt),
        'approved → in progress': completedRequests.filter(r => r.inProgressAt && r.approvedAt).map(r => r.inProgressAt - r.approvedAt),
        'in progress → shipped': completedRequests.filter(r => r.shippedAt && r.inProgressAt).map(r => r.shippedAt - r.inProgressAt),
      };

      for (const [label, times] of Object.entries(timeDiffs)) {
        if (times.length > 0) {
          const avg = times.reduce((a, b) => a + b, 0) / times.length;
          avgTimes[label] = avg;
        }
      }
    }

    // Delivery rate
    const deliveryRate = total > 0 ? (delivered / total) * 100 : 0;

    return { total, delivered, cancelled, blocked, inFlight, deliveryRate, avgTimes };
  }, [requests, dateRange]);

  if (!stats) {
    return <div className="chart-empty">No data in this period</div>;
  }

  const maxCount = Math.max(stats.delivered, stats.cancelled, stats.inFlight, 1);

  return (
    <div className="status-transitions">
      <h4>
        Request Outcomes
        <span className="st-delivery-rate">{stats.deliveryRate.toFixed(0)}% delivery rate</span>
      </h4>

      <div className="st-bars">
        {[
          { label: 'In Flight', count: stats.inFlight, color: '#6366f1' },
          { label: 'Delivered', count: stats.delivered, color: '#22c55e' },
          { label: 'Blocked', count: stats.blocked, color: '#f59e0b' },
          { label: 'Cancelled', count: stats.cancelled, color: '#ef4444' },
        ].map(item => (
          <div key={item.label} className="st-bar-row">
            <span className="st-bar-label">{item.label}</span>
            <div className="st-bar-track">
              <div
                className="st-bar-fill"
                style={{
                  width: `${(item.count / maxCount) * 100}%`,
                  backgroundColor: item.color,
                }}
              />
            </div>
            <span className="st-bar-count">{item.count}</span>
          </div>
        ))}
      </div>

      {Object.keys(stats.avgTimes).length > 0 && (
        <div className="st-avg-times">
          <div className="st-avg-title">Avg. Stage Duration</div>
          {Object.entries(stats.avgTimes).map(([label, ms]) => {
            const hours = ms / 3600000;
            const display = hours < 24 ? `${hours.toFixed(1)}h` : `${(hours / 24).toFixed(1)}d`;
            return (
              <div key={label} className="st-avg-row">
                <span className="st-avg-label">{label}</span>
                <span className="st-avg-value">{display}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
