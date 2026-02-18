/**
 * AnalyticsDashboard.jsx
 *
 * Container component for analytics views.
 * Provides date range / period controls, renders chart sub-components.
 *
 * See docs/INVENTORY_SYSTEM_SPEC.md §8
 */

import React, { useState, useMemo, useCallback } from 'react';
import { useInventory } from '../../../contexts/InventoryContext';
import SummaryMetrics from './SummaryMetrics';
import InOutflowChart from './InOutflowChart';
import FulfillmentHistogram from './FulfillmentHistogram';
import PipelineFunnel from './PipelineFunnel';
import ProducerLeaderboard from './ProducerLeaderboard';
import BlockedAging from './BlockedAging';
import ItemDemand from './ItemDemand';
import PivotTable from './PivotTable';
import USHeatmap from './USHeatmap';
import './AnalyticsDashboard.css';

const PRESETS = [
  { key: '7d', label: 'This Week', offset: 7 * 86400000 },
  { key: '30d', label: 'Last 30d', offset: 30 * 86400000 },
  { key: '90d', label: 'Last 90d', offset: 90 * 86400000 },
  { key: 'all', label: 'All Time', offset: null },
];

const GRANULARITIES = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

export default function AnalyticsDashboard() {
  const ctx = useInventory();
  const sync = ctx;

  const [preset, setPreset] = useState('30d');
  const [granularity, setGranularity] = useState('day');
  const [groupBy, setGroupBy] = useState('none');
  const [filterItem, setFilterItem] = useState('all');
  const [filterState, setFilterState] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  const dateRange = useMemo(() => {
    const p = PRESETS.find(p => p.key === preset);
    if (!p || !p.offset) return [0, Date.now()];
    return [Date.now() - p.offset, Date.now()];
  }, [preset]);

  const allRequests = sync.requests || [];
  const catalogItems = sync.catalogItems || [];
  const producerCapacities = sync.producerCapacities || {};

  // Apply analytics filters
  const requests = useMemo(() => {
    let result = allRequests;
    if (filterItem !== 'all') result = result.filter(r => r.catalogItemId === filterItem);
    if (filterState !== 'all') result = result.filter(r => (r.state || '').toUpperCase() === filterState.toUpperCase());
    if (filterStatus !== 'all') result = result.filter(r => r.status === filterStatus);
    return result;
  }, [allRequests, filterItem, filterState, filterStatus]);

  return (
    <div className="analytics-dashboard">
      {/* Controls bar */}
      <div className="ad-controls">
        <h2>Analytics</h2>
        <div className="ad-controls-right">
          <div className="ad-presets">
            {PRESETS.map(p => (
              <button
                key={p.key}
                className={`ad-preset-btn ${preset === p.key ? 'active' : ''}`}
                onClick={() => setPreset(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="ad-granularity">
            {GRANULARITIES.map(g => (
              <button
                key={g.key}
                className={`ad-gran-btn ${granularity === g.key ? 'active' : ''}`}
                onClick={() => setGranularity(g.key)}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Filter / group-by controls */}
      <div className="ad-filter-bar">
        <label className="ad-filter">
          Group by:
          <select value={groupBy} onChange={e => setGroupBy(e.target.value)}>
            <option value="none">None</option>
            <option value="item">Item</option>
            <option value="state">State</option>
            <option value="producer">Producer</option>
            <option value="week">Week</option>
          </select>
        </label>
        <label className="ad-filter">
          Item:
          <select value={filterItem} onChange={e => setFilterItem(e.target.value)}>
            <option value="all">All Items</option>
            {catalogItems.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
        <label className="ad-filter">
          State:
          <select value={filterState} onChange={e => setFilterState(e.target.value)}>
            <option value="all">All States</option>
            {[...new Set(allRequests.map(r => r.state).filter(Boolean))].sort().map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="ad-filter">
          Status:
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="all">All Statuses</option>
            {['open', 'claimed', 'pending_approval', 'approved', 'shipped', 'delivered', 'blocked', 'cancelled'].map(s => (
              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </label>
      </div>

      {/* KPI cards */}
      <SummaryMetrics
        requests={requests}
        producerCapacities={producerCapacities}
        dateRange={dateRange}
      />

      {/* Charts grid */}
      <div className="ad-charts-grid">
        <div className="ad-chart-panel ad-chart-wide">
          <InOutflowChart
            requests={requests}
            dateRange={dateRange}
            granularity={granularity}
          />
        </div>

        <div className="ad-chart-panel">
          <FulfillmentHistogram
            requests={requests}
            dateRange={dateRange}
          />
        </div>

        <div className="ad-chart-panel">
          <PipelineFunnel
            requests={requests}
            dateRange={dateRange}
          />
        </div>

        <div className="ad-chart-panel">
          <ItemDemand
            requests={requests}
            catalogItems={catalogItems}
            dateRange={dateRange}
          />
        </div>

        <div className="ad-chart-panel">
          <BlockedAging requests={requests} />
        </div>

        <div className="ad-chart-panel ad-chart-wide">
          <ProducerLeaderboard
            requests={requests}
            collaborators={ctx.collaborators}
            dateRange={dateRange}
            catalogItems={catalogItems}
          />
        </div>

        <div className="ad-chart-panel ad-chart-wide">
          <PivotTable
            requests={requests}
            collaborators={ctx.collaborators}
            dateRange={dateRange}
          />
        </div>

        <div className="ad-chart-panel ad-chart-wide">
          <USHeatmap
            requests={requests}
            dateRange={dateRange}
            onStateFilter={(stateCode) => setFilterState(stateCode || 'all')}
          />
        </div>
      </div>
    </div>
  );
}
