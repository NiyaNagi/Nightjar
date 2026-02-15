// frontend/src/components/inventory/producer/ProducerStats.jsx
// Personal fulfillment statistics for the logged-in producer

import React, { useMemo } from 'react';
import { useInventory } from '../../../contexts/InventoryContext';
import useInventorySync from '../../../hooks/useInventorySync';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import './ProducerStats.css';

export default function ProducerStats() {
  const ctx = useInventory();
  const { catalogItems, requests, producerCapacities } = useInventorySync(
    { yInventorySystems: ctx.yInventorySystems, yCatalogItems: ctx.yCatalogItems, yInventoryRequests: ctx.yInventoryRequests,
      yProducerCapacities: ctx.yProducerCapacities, yAddressReveals: ctx.yAddressReveals, yPendingAddresses: ctx.yPendingAddresses,
      yInventoryAuditLog: ctx.yInventoryAuditLog },
    ctx.inventorySystemId
  );

  const myKey = ctx.userIdentity?.publicKeyBase62;

  const stats = useMemo(() => {
    const mine = requests.filter(r => r.assignedTo === myKey || r.claimedBy === myKey);
    const shipped = mine.filter(r => r.status === 'shipped' || r.status === 'delivered');
    const totalUnits = shipped.reduce((s, r) => s + (r.quantity || 0), 0);
    const active = mine.filter(r =>
      ['claimed', 'pending_approval', 'approved'].includes(r.status)
    );

    // Avg shipping time (requestedAt → shippedAt)
    const shippingTimes = shipped
      .filter(r => r.shippedAt && r.requestedAt)
      .map(r => (r.shippedAt - r.requestedAt) / 86400000);
    const avgShippingDays = shippingTimes.length > 0
      ? (shippingTimes.reduce((a, b) => a + b, 0) / shippingTimes.length).toFixed(1)
      : '—';

    // This month
    const now = Date.now();
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const thisMonth = shipped.filter(r => (r.shippedAt || 0) >= startOfMonth.getTime());

    // Per-item breakdown
    const byItem = {};
    shipped.forEach(r => {
      if (!byItem[r.itemId]) byItem[r.itemId] = { count: 0, units: 0 };
      byItem[r.itemId].count++;
      byItem[r.itemId].units += r.quantity || 0;
    });

    // Ranking among all producers
    const producerShipped = {};
    requests.forEach(r => {
      if (r.status === 'shipped' || r.status === 'delivered') {
        const key = r.assignedTo || r.claimedBy;
        if (key) producerShipped[key] = (producerShipped[key] || 0) + 1;
      }
    });
    const ranking = Object.entries(producerShipped)
      .sort(([, a], [, b]) => b - a);
    const myRank = ranking.findIndex(([k]) => k === myKey) + 1;
    const totalProducers = ranking.length;

    // On-time rate (shipped within 5 days)
    const onTimeCount = shippingTimes.filter(d => d <= 5).length;
    const onTimeRate = shippingTimes.length > 0
      ? Math.round((onTimeCount / shippingTimes.length) * 100)
      : null;

    return {
      fulfilled: shipped.length,
      units: totalUnits,
      active: active.length,
      avgShippingDays,
      thisMonth: thisMonth.length,
      byItem,
      rank: myRank || '—',
      totalProducers,
      onTimeRate,
    };
  }, [requests, myKey]);

  const catalogMap = useMemo(() => {
    const m = {};
    catalogItems.forEach(c => { m[c.id] = c; });
    return m;
  }, [catalogItems]);

  return (
    <div className="producer-stats">
      <h2>My Stats</h2>

      <div className="ps-cards">
        <div className="ps-card">
          <span className="ps-card-value">{stats.fulfilled}</span>
          <span className="ps-card-label">Requests Fulfilled</span>
        </div>
        <div className="ps-card">
          <span className="ps-card-value">{stats.units.toLocaleString()}</span>
          <span className="ps-card-label">Total Units Shipped</span>
        </div>
        <div className="ps-card">
          <span className="ps-card-value">{stats.active}</span>
          <span className="ps-card-label">Active Requests</span>
        </div>
        <div className="ps-card">
          <span className="ps-card-value">{stats.avgShippingDays}</span>
          <span className="ps-card-label">Avg Days to Ship</span>
        </div>
        <div className="ps-card">
          <span className="ps-card-value">{stats.thisMonth}</span>
          <span className="ps-card-label">This Month</span>
        </div>
        <div className="ps-card">
          <span className="ps-card-value">
            #{stats.rank} <span className="ps-card-sub">of {stats.totalProducers}</span>
          </span>
          <span className="ps-card-label">Rank</span>
        </div>
        <div className="ps-card">
          <span className="ps-card-value">
            {stats.onTimeRate != null ? `${stats.onTimeRate}%` : '—'}
          </span>
          <span className="ps-card-label">On-Time Rate</span>
        </div>
      </div>

      {/* Per-item breakdown */}
      <section className="ps-section">
        <h3>By Item</h3>
        {Object.keys(stats.byItem).length === 0 ? (
          <p className="ps-empty">No fulfilled requests yet</p>
        ) : (
          <table className="ps-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Requests</th>
                <th>Units</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(stats.byItem).map(([itemId, data]) => (
                <tr key={itemId}>
                  <td>{catalogMap[itemId]?.name || itemId.slice(0, 8)}</td>
                  <td>{data.count}</td>
                  <td>{data.units.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Fulfillment trend (last 8 weeks) */}
      <section className="ps-section">
        <h3>Fulfillment Trend (8 Weeks)</h3>
        <FulfillmentTrend requests={requests} myKey={myKey} />
      </section>

      {/* Community stats */}
      <section className="ps-section">
        <h3>Community Stats (Anonymized)</h3>
        <CommunityStats requests={requests} />
      </section>
    </div>
  );
}

function FulfillmentTrend({ requests, myKey }) {
  const data = useMemo(() => {
    const now = Date.now();
    const weeks = [];
    for (let i = 7; i >= 0; i--) {
      const weekStart = now - (i + 1) * 7 * 86400000;
      const weekEnd = now - i * 7 * 86400000;
      const count = requests.filter(r =>
        (r.assignedTo === myKey || r.claimedBy === myKey) &&
        (r.status === 'shipped' || r.status === 'delivered') &&
        r.shippedAt >= weekStart && r.shippedAt < weekEnd
      ).length;
      const label = new Date(weekEnd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      weeks.push({ week: label, fulfilled: count });
    }
    return weeks;
  }, [requests, myKey]);

  return (
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
          <XAxis dataKey="week" stroke="var(--text-secondary)" fontSize={12} />
          <YAxis allowDecimals={false} stroke="var(--text-secondary)" fontSize={12} />
          <Tooltip contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }} />
          <Line type="monotone" dataKey="fulfilled" stroke="var(--accent-color)" strokeWidth={2} dot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function CommunityStats({ requests }) {
  const stats = useMemo(() => {
    const shipped = requests.filter(r => r.status === 'shipped' || r.status === 'delivered');
    const totalRequests = requests.length;
    const totalUnits = shipped.reduce((s, r) => s + (r.quantity || 0), 0);
    const activeProducers = new Set(
      requests.filter(r => r.assignedTo).map(r => r.assignedTo)
    ).size;
    const shippingTimes = shipped
      .filter(r => r.shippedAt && r.requestedAt)
      .map(r => (r.shippedAt - r.requestedAt) / 86400000);
    const avgTime = shippingTimes.length > 0
      ? (shippingTimes.reduce((a, b) => a + b, 0) / shippingTimes.length).toFixed(1)
      : '—';
    return { totalRequests, totalUnits, activeProducers, avgTime };
  }, [requests]);

  return (
    <div className="ps-cards" style={{ marginTop: '0.5rem' }}>
      <div className="ps-card">
        <span className="ps-card-value">{stats.totalRequests}</span>
        <span className="ps-card-label">Total Requests</span>
      </div>
      <div className="ps-card">
        <span className="ps-card-value">{stats.totalUnits.toLocaleString()}</span>
        <span className="ps-card-label">Total Units</span>
      </div>
      <div className="ps-card">
        <span className="ps-card-value">{stats.activeProducers}</span>
        <span className="ps-card-label">Active Producers</span>
      </div>
      <div className="ps-card">
        <span className="ps-card-value">{stats.avgTime}</span>
        <span className="ps-card-label">Avg Days to Ship</span>
      </div>
    </div>
  );
}
