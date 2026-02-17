/**
 * ProducerLeaderboard.jsx
 *
 * Sortable table ranking producers by fulfillment metrics.
 * Columns: Rank, Name, Fulfilled, Units, Avg Days, On-Time %.
 *
 * See docs/INVENTORY_SYSTEM_SPEC.md §8.4.5
 */

import React, { useMemo, useState } from 'react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { exportProducers } from '../../../utils/inventoryExport';
import { resolveUserName } from '../../../utils/resolveUserName';
import ChatButton from '../../common/ChatButton';
import { useInventory } from '../../../contexts/InventoryContext';

/**
 * @param {{ requests: object[], collaborators: object[], dateRange: [number,number], catalogItems: object[] }} props
 */
export default function ProducerLeaderboard({ requests, collaborators, dateRange, catalogItems }) {
  const { onStartChatWith, userIdentity } = useInventory();
  const [sortKey, setSortKey] = useState('fulfilled');
  const [sortDir, setSortDir] = useState('desc');
  const [filterItemId, setFilterItemId] = useState('');

  const producers = useMemo(() => {
    const [from, to] = dateRange || [0, Date.now()];
    let inRange = requests.filter(r => (r.requestedAt || r.createdAt || 0) >= from && (r.requestedAt || r.createdAt || 0) <= to);
    if (filterItemId) inRange = inRange.filter(r => (r.catalogItemId || r.itemId) === filterItemId);

    const map = {};
    for (const r of inRange) {
      if (!r.assignedTo) continue;
      if (!map[r.assignedTo]) {
        const collab = collaborators?.find(c => c.publicKey === r.assignedTo || c.publicKeyBase62 === r.assignedTo);
        map[r.assignedTo] = {
          id: r.assignedTo,
          displayName: resolveUserName(collaborators, r.assignedTo),
          fulfilled: 0,
          units: 0,
          totalDays: 0,
          onTime: 0,
          total: 0,
        };
      }
      const p = map[r.assignedTo];
      p.total++;
      if (r.status === 'shipped' || r.status === 'delivered') {
        p.fulfilled++;
        p.units += r.quantity || 0;
        if (r.shippedAt && (r.requestedAt || r.createdAt)) {
          const days = (r.shippedAt - (r.requestedAt || r.createdAt)) / 86400000;
          p.totalDays += days;
          if (days <= 5) p.onTime++;
        }
      }
    }

    // Compute sparkline data (last 30 days, grouped into 6 periods of 5 days)
    const now = Date.now();
    for (const p of Object.values(map)) {
      const sparkline = [];
      for (let i = 5; i >= 0; i--) {
        const periodStart = now - (i + 1) * 5 * 86400000;
        const periodEnd = now - i * 5 * 86400000;
        let filteredReqs = requests.filter(r =>
          r.assignedTo === p.id &&
          (r.status === 'shipped' || r.status === 'delivered') &&
          r.shippedAt >= periodStart && r.shippedAt < periodEnd
        );
        if (filterItemId) filteredReqs = filteredReqs.filter(r => (r.catalogItemId || r.itemId) === filterItemId);
        sparkline.push({ v: filteredReqs.length });
      }
      p.sparkline = sparkline;
    }

    return Object.values(map).map(p => ({
      ...p,
      avgDays: p.fulfilled > 0 ? +(p.totalDays / p.fulfilled).toFixed(1) : null,
      onTimePercent: p.fulfilled > 0 ? Math.round((p.onTime / p.fulfilled) * 100) : null,
    }));
  }, [requests, collaborators, dateRange, filterItemId]);

  const sorted = useMemo(() => {
    return [...producers].sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      return sortDir === 'desc' ? bv - av : av - bv;
    });
  }, [producers, sortKey, sortDir]);

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const arrow = (key) => {
    if (sortKey !== key) return '';
    return sortDir === 'desc' ? ' ↓' : ' ↑';
  };

  return (
    <div className="producer-leaderboard">
      <div className="pl-header">
        <h4>Producer Leaderboard</h4>
        <div className="pl-header-actions">
          <select
            className="pl-item-filter"
            value={filterItemId}
            onChange={e => setFilterItemId(e.target.value)}
          >
            <option value="">All Items</option>
            {(catalogItems || []).filter(c => c.active !== false).map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button className="btn-sm btn-secondary" onClick={() => exportProducers(sorted)}>
            Export CSV
          </button>
        </div>
      </div>
      {sorted.length === 0 ? (
        <p className="chart-empty">No producer activity in this period</p>
      ) : (
        <table className="pl-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Producer</th>
              <th className="sortable" onClick={() => handleSort('fulfilled')}>
                Fulfilled{arrow('fulfilled')}
              </th>
              <th className="sortable" onClick={() => handleSort('units')}>
                Units{arrow('units')}
              </th>
              <th className="sortable" onClick={() => handleSort('avgDays')}>
                Avg Days{arrow('avgDays')}
              </th>
              <th className="sortable" onClick={() => handleSort('onTimePercent')}>
                On-Time %{arrow('onTimePercent')}
              </th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => (
              <tr key={p.id}>
                <td>{i + 1}</td>
                <td>
                  {p.displayName}
                  <ChatButton
                    publicKey={p.id}
                    name={p.displayName}
                    collaborators={collaborators}
                    onStartChatWith={onStartChatWith}
                    currentUserKey={userIdentity?.publicKeyBase62}
                  />
                </td>
                <td>{p.fulfilled}</td>
                <td>{p.units}</td>
                <td>{p.avgDays != null ? `${p.avgDays}d` : '—'}</td>
                <td>{p.onTimePercent != null ? `${p.onTimePercent}%` : '—'}</td>
                <td className="pl-sparkline-cell">
                  {p.sparkline && (
                    <ResponsiveContainer width={80} height={24}>
                      <LineChart data={p.sparkline}>
                        <Line type="monotone" dataKey="v" stroke="var(--accent-color)" strokeWidth={1.5} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
