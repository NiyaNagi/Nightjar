/**
 * USHeatmap.jsx
 *
 * SVG US state heatmap using react-simple-maps.
 * Colors states by request count, units, or avg fulfillment time.
 *
 * See docs/INVENTORY_SYSTEM_SPEC.md §8.4.4
 */

import React, { useMemo, useState, useCallback } from 'react';
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
} from 'react-simple-maps';
import usStatesData from '../../../assets/us-states-10m.json';
import './USHeatmap.css';

const METRICS = [
  { key: 'requests', label: 'Requests' },
  { key: 'units', label: 'Units' },
  { key: 'avgTime', label: 'Avg Days' },
];

// Simple quantile color scale (5 steps)
const COLORS = ['#a78bfa', '#6366f1', '#4338ca', '#2d2d6b', '#1a1a2e'];

/**
 * @param {{ requests: object[], dateRange: [number,number] }} props
 */
export default function USHeatmap({ requests, dateRange, onStateFilter }) {
  const [metric, setMetric] = useState('requests');
  const [tooltip, setTooltip] = useState(null);
  const [selectedState, setSelectedState] = useState(null);

  const stateData = useMemo(() => {
    const [from, to] = dateRange || [0, Date.now()];
    const inRange = requests.filter(r => r.createdAt >= from && r.createdAt <= to);

    const byState = {};
    for (const r of inRange) {
      const st = (r.requesterState || '').toUpperCase().trim();
      if (!st) continue;
      if (!byState[st]) byState[st] = { requests: 0, units: 0, totalDays: 0, fulfilled: 0 };
      byState[st].requests++;
      byState[st].units += r.quantity || 0;
      if (r.shippedAt && r.createdAt) {
        byState[st].totalDays += (r.shippedAt - r.createdAt) / 86400000;
        byState[st].fulfilled++;
      }
    }

    // Calculate avgTime
    for (const st of Object.keys(byState)) {
      byState[st].avgTime = byState[st].fulfilled > 0
        ? byState[st].totalDays / byState[st].fulfilled
        : 0;
    }

    return byState;
  }, [requests, dateRange]);

  // Build quantile thresholds
  const { thresholds, maxVal } = useMemo(() => {
    const values = Object.values(stateData).map(d => d[metric]).filter(v => v > 0).sort((a, b) => a - b);
    if (values.length === 0) return { thresholds: [], maxVal: 0 };
    const step = Math.max(1, Math.floor(values.length / COLORS.length));
    const t = [];
    for (let i = 1; i < COLORS.length; i++) {
      t.push(values[Math.min(i * step, values.length - 1)]);
    }
    return { thresholds: t, maxVal: values[values.length - 1] };
  }, [stateData, metric]);

  const getColor = useCallback((stateName) => {
    // Map full state name to abbreviation for lookup
    const abbr = STATE_NAME_TO_ABBR[stateName] || '';
    const d = stateData[abbr];
    if (!d) return 'var(--bg-tertiary)';
    const val = d[metric];
    if (val <= 0) return 'var(--bg-tertiary)';
    for (let i = 0; i < thresholds.length; i++) {
      if (val <= thresholds[i]) return COLORS[i];
    }
    return COLORS[COLORS.length - 1];
  }, [stateData, metric, thresholds]);

  const handleMouseEnter = useCallback((geo) => {
    const name = geo.properties.name;
    const abbr = STATE_NAME_TO_ABBR[name] || '';
    const d = stateData[abbr];
    setTooltip({
      name,
      requests: d?.requests || 0,
      units: d?.units || 0,
      avgTime: d?.avgTime ? d.avgTime.toFixed(1) : '—',
    });
  }, [stateData]);

  const handleStateClick = useCallback((geo) => {
    const name = geo.properties.name;
    const abbr = STATE_NAME_TO_ABBR[name] || '';
    const newSelected = selectedState === abbr ? null : abbr;
    setSelectedState(newSelected);
    onStateFilter?.(newSelected);
  }, [selectedState, onStateFilter]);

  return (
    <div className="us-heatmap">
      <div className="ush-header">
        <h4>Geographic Distribution</h4>
        <div className="ush-metric-toggle">
          {METRICS.map(m => (
            <button
              key={m.key}
              className={`ush-toggle-btn ${metric === m.key ? 'active' : ''}`}
              onClick={() => setMetric(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ush-map-container">
        <ComposableMap projection="geoAlbersUsa" width={800} height={500}>
          <ZoomableGroup>
            <Geographies geography={usStatesData}>
              {({ geographies }) =>
                geographies.map(geo => (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={getColor(geo.properties.name)}
                    stroke={selectedState === STATE_NAME_TO_ABBR[geo.properties.name] ? 'var(--accent-color)' : 'var(--border-color)'}
                    strokeWidth={selectedState === STATE_NAME_TO_ABBR[geo.properties.name] ? 2 : 0.5}
                    onMouseEnter={() => handleMouseEnter(geo)}
                    onMouseLeave={() => setTooltip(null)}
                    onClick={() => handleStateClick(geo)}
                    style={{
                      hover: { fill: 'var(--accent-color)', outline: 'none', cursor: 'pointer' },
                      pressed: { outline: 'none' },
                      default: { outline: 'none' },
                    }}
                  />
                ))
              }
            </Geographies>
          </ZoomableGroup>
        </ComposableMap>

        {tooltip && (
          <div className="ush-tooltip">
            <strong>{tooltip.name}</strong>
            <span>{tooltip.requests} requests</span>
            <span>{tooltip.units} units</span>
            <span>Avg: {tooltip.avgTime}d</span>
          </div>
        )}

        {/* Legend gradient */}
        <div className="ush-legend">
          <span>0</span>
          <div className="ush-legend-bar">
            {COLORS.map((c, i) => (
              <div key={i} className="ush-legend-step" style={{ background: c }} />
            ))}
          </div>
          <span>{maxVal > 0 ? maxVal.toLocaleString() : '—'}</span>
        </div>
      </div>
    </div>
  );
}

// Full state name → abbreviation mapping
const STATE_NAME_TO_ABBR = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
  'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
  'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
  'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
  'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
  'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
  'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
  'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
  'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
  'Wisconsin': 'WI', 'Wyoming': 'WY', 'District of Columbia': 'DC',
  'Puerto Rico': 'PR',
};
