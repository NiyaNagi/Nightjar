/**
 * MeshView
 * 
 * Mesh network dashboard showing:
 * 1. Stat cards: peers online, chunks seeded, under-replicated, bandwidth
 * 2. Per-file seeding progress table
 * 3. Bandwidth chart (Recharts AreaChart) with time range selector
 * 4. Connected peers table
 * 
 * See docs/FILE_STORAGE_SPEC.md §8
 */

import { useState, useMemo } from 'react';
import { formatFileSize, getRelativeTime } from '../../utils/fileTypeCategories';
import './MeshView.css';

/**
 * Dynamically import Recharts. In test environments, this will be mocked.
 */
let AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer;
try {
  const recharts = require('recharts');
  AreaChart = recharts.AreaChart;
  Area = recharts.Area;
  XAxis = recharts.XAxis;
  YAxis = recharts.YAxis;
  CartesianGrid = recharts.CartesianGrid;
  Tooltip = recharts.Tooltip;
  ResponsiveContainer = recharts.ResponsiveContainer;
} catch {
  // Recharts not available — bandwidth chart will show fallback
}

/** Time range options for bandwidth chart */
const TIME_RANGES = [
  { label: '1m', minutes: 1, samples: 2 },
  { label: '1h', minutes: 60, samples: 120 },
  { label: '8h', minutes: 480, samples: 960 },
  { label: '24h', minutes: 1440, samples: 2880 },
];

export default function MeshView({
  activeFiles = [],
  chunkAvailability = {},
  seedingStats = {},
  bandwidthHistory = [],
  transferStats = {},
  redundancyTarget = 5,
  userPublicKey,
  connectedPeers = [],
  onResetStats,
}) {
  const [timeRange, setTimeRange] = useState('1h');

  // ── Stat cards ──
  const stats = useMemo(() => {
    const peersOnline = connectedPeers.length;

    // Count total chunks and under-replicated
    let totalChunks = 0;
    let underReplicated = 0;
    const effectiveTarget = Math.min(redundancyTarget, peersOnline + 1);

    for (const file of activeFiles) {
      const chunkCount = file.chunkCount || 0;
      for (let i = 0; i < chunkCount; i++) {
        totalChunks++;
        const key = `${file.id}:${i}`;
        const entry = chunkAvailability[key];
        const holders = (entry && Array.isArray(entry.holders)) ? entry.holders : (Array.isArray(entry) ? entry : []);
        if (holders.length < effectiveTarget) {
          underReplicated++;
        }
      }
    }

    return {
      peersOnline,
      totalChunks,
      underReplicated,
      chunksSeeded: seedingStats.chunksSeeded || 0,
      bytesSeeded: seedingStats.bytesSeeded || 0,
      seedingActive: seedingStats.seedingActive || false,
      lastSeedRun: seedingStats.lastSeedRun,
      chunksFetched: transferStats.chunksFetched || 0,
      chunksServed: transferStats.chunksServed || 0,
      bytesServed: transferStats.bytesServed || 0,
      bytesFetched: transferStats.bytesFetched || 0,
    };
  }, [activeFiles, chunkAvailability, seedingStats, transferStats, connectedPeers, redundancyTarget]);

  // ── Per-file replication status ──
  const fileReplicationStatus = useMemo(() => {
    return activeFiles.map(file => {
      const chunkCount = file.chunkCount || 0;
      let localChunks = 0;
      let totalReplication = 0;
      let minReplication = Infinity;

      for (let i = 0; i < chunkCount; i++) {
        const key = `${file.id}:${i}`;
        const entry = chunkAvailability[key];
        const holders = (entry && Array.isArray(entry.holders)) ? entry.holders : (Array.isArray(entry) ? entry : []);
        totalReplication += holders.length;
        if (holders.length < minReplication) minReplication = holders.length;
        if (holders.includes(userPublicKey)) localChunks++;
      }

      const avgReplication = chunkCount > 0 ? totalReplication / chunkCount : 0;
      if (minReplication === Infinity) minReplication = 0;

      return {
        id: file.id,
        name: file.name,
        size: file.sizeBytes || 0,
        chunkCount,
        localChunks,
        avgReplication: Math.round(avgReplication * 10) / 10,
        minReplication,
        fullyReplicated: minReplication >= Math.min(redundancyTarget, connectedPeers.length + 1),
      };
    });
  }, [activeFiles, chunkAvailability, userPublicKey, redundancyTarget, connectedPeers]);

  // ── Bandwidth chart data ──
  const chartData = useMemo(() => {
    const rangeConfig = TIME_RANGES.find(r => r.label === timeRange) || TIME_RANGES[1];
    const cutoff = Date.now() - rangeConfig.minutes * 60 * 1000;
    const filtered = bandwidthHistory.filter(s => s.timestamp >= cutoff);

    return filtered.map(s => ({
      time: new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      sent: Math.round(s.bytesSent / 1024), // KB
      received: Math.round(s.bytesReceived / 1024), // KB
    }));
  }, [bandwidthHistory, timeRange]);

  return (
    <div className="mesh-view" data-testid="mesh-view">
      <div className="mesh-header">
        <h3 className="mesh-title">
          🌐 Mesh Network
          {stats.seedingActive && <span className="mesh-seeding-badge">⟳ Seeding</span>}
        </h3>
        {onResetStats && (
          <button
            className="mesh-reset-btn"
            onClick={onResetStats}
            title="Reset accumulated transfer statistics"
            data-testid="mesh-reset-stats"
          >
            ↺ Reset Stats
          </button>
        )}
      </div>

      {/* Stat cards */}
      <div className="mesh-cards" data-testid="mesh-stats">
        <div className="mesh-card">
          <div className="mesh-card-value">{stats.peersOnline}</div>
          <div className="mesh-card-label">Peers Online</div>
        </div>
        <div className="mesh-card">
          <div className="mesh-card-value">{stats.totalChunks}</div>
          <div className="mesh-card-label">Total Chunks</div>
        </div>
        <div className="mesh-card">
          <div className={`mesh-card-value ${stats.underReplicated > 0 ? 'mesh-card-warn' : 'mesh-card-ok'}`}>
            {stats.underReplicated}
          </div>
          <div className="mesh-card-label">Under-replicated</div>
        </div>
        <div className="mesh-card">
          <div className="mesh-card-value">{stats.chunksSeeded}</div>
          <div className="mesh-card-label">Chunks Seeded</div>
        </div>
        <div className="mesh-card">
          <div className="mesh-card-value">{formatFileSize(stats.bytesSeeded + stats.bytesServed)}</div>
          <div className="mesh-card-label">Uploaded</div>
        </div>
        <div className="mesh-card">
          <div className="mesh-card-value">{formatFileSize(stats.bytesFetched)}</div>
          <div className="mesh-card-label">Downloaded</div>
        </div>
      </div>

      {/* File replication table */}
      <div className="mesh-section">
        <h4 className="mesh-section-title">File Replication</h4>
        {fileReplicationStatus.length === 0 ? (
          <p className="mesh-empty-text">No files in storage</p>
        ) : (
          <div className="mesh-table-wrapper">
            <table className="mesh-table" data-testid="mesh-file-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Size</th>
                  <th>Local</th>
                  <th>Avg Replication</th>
                  <th>Min</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {fileReplicationStatus.map(file => (
                  <tr key={file.id}>
                    <td className="mesh-file-name" title={file.name}>
                      {file.name}
                    </td>
                    <td>{formatFileSize(file.size)}</td>
                    <td>{file.localChunks}/{file.chunkCount}</td>
                    <td>{file.avgReplication}×</td>
                    <td>{file.minReplication}×</td>
                    <td>
                      <span className={`mesh-status ${file.fullyReplicated ? 'mesh-status-ok' : 'mesh-status-warn'}`}>
                        {file.fullyReplicated ? '✓ Healthy' : '⚠ Under-replicated'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bandwidth chart */}
      <div className="mesh-section">
        <div className="mesh-section-header">
          <h4 className="mesh-section-title">Bandwidth</h4>
          <div className="mesh-time-range" data-testid="mesh-time-range">
            {TIME_RANGES.map(r => (
              <button
                key={r.label}
                className={`mesh-time-btn ${timeRange === r.label ? 'active' : ''}`}
                onClick={() => setTimeRange(r.label)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {AreaChart && chartData.length > 0 ? (
          <div className="mesh-chart" data-testid="mesh-bandwidth-chart">
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #313244)" />
                <XAxis
                  dataKey="time"
                  stroke="var(--text-tertiary, #6c7086)"
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  stroke="var(--text-tertiary, #6c7086)"
                  tick={{ fontSize: 11 }}
                  tickFormatter={v => `${v} KB`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--bg-primary, #11111b)',
                    border: '1px solid var(--border-color, #313244)',
                    borderRadius: '8px',
                    color: 'var(--text-primary, #cdd6f4)',
                    fontSize: '12px',
                  }}
                  formatter={(value) => [`${value} KB`]}
                />
                <Area
                  type="monotone"
                  dataKey="sent"
                  name="Sent"
                  stroke="#89b4fa"
                  fill="#89b4fa"
                  fillOpacity={0.2}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="received"
                  name="Received"
                  stroke="#a6e3a1"
                  fill="#a6e3a1"
                  fillOpacity={0.2}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="mesh-empty-text">
            {chartData.length === 0 ? 'No bandwidth data yet. Data will appear as chunks are transferred.' : 'Chart library not available.'}
          </p>
        )}
      </div>

      {/* Connected peers */}
      <div className="mesh-section">
        <h4 className="mesh-section-title">Connected Peers ({stats.peersOnline})</h4>
        {connectedPeers.length === 0 ? (
          <p className="mesh-empty-text">No peers connected</p>
        ) : (
          <div className="mesh-table-wrapper">
            <table className="mesh-table" data-testid="mesh-peer-table">
              <thead>
                <tr>
                  <th>Peer ID</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {connectedPeers.map(peerId => (
                  <tr key={peerId}>
                    <td className="mesh-peer-id" title={peerId}>
                      {peerId.slice(0, 8)}…{peerId.slice(-6)}
                    </td>
                    <td>
                      <span className="mesh-status mesh-status-ok">● Connected</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Last seed run */}
      {stats.lastSeedRun && (
        <div className="mesh-footer">
          Last seed: {getRelativeTime(stats.lastSeedRun)} • Target: {redundancyTarget}× redundancy
        </div>
      )}
    </div>
  );
}
