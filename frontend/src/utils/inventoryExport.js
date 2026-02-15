/**
 * inventoryExport.js
 *
 * CSV / XLSX export utilities for inventory data.
 * Uses SheetJS (xlsx) for multi-format generation.
 *
 * See docs/INVENTORY_SYSTEM_SPEC.md §9.5
 */

import * as XLSX from 'xlsx';
import { formatDate } from './inventoryValidation';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Export an array of request objects to a downloadable file.
 *
 * @param {object[]} requests
 * @param {string} [format='csv'] – 'csv' | 'xlsx'
 * @param {string} [filename]
 */
export function exportRequests(requests, format = 'csv', filename) {
  const rows = requests.map(r => ({
    ID: r.id,
    Item: r.item,
    Quantity: r.quantity,
    Status: r.status,
    Urgency: r.urgency || 'normal',
    'Requester Name': r.requesterName || '',
    State: r.requesterState || '',
    City: r.requesterCity || '',
    'Assigned To': r.assignedTo || '',
    'Created At': r.createdAt ? formatDate(r.createdAt) : '',
    'Shipped At': r.shippedAt ? formatDate(r.shippedAt) : '',
    'Delivered At': r.deliveredAt ? formatDate(r.deliveredAt) : '',
    Tracking: r.trackingNumber || '',
    Notes: r.notes || '',
  }));

  const name = filename || `inventory-requests-${new Date().toISOString().slice(0, 10)}`;
  downloadSheet(rows, name, format);
}

/**
 * Export audit log entries to CSV.
 *
 * @param {object[]} entries
 * @param {{ from?: number, to?: number }} [dateRange]
 * @param {string} [filename]
 */
export function exportAuditLog(entries, dateRange, filename) {
  let filtered = entries;
  if (dateRange) {
    if (dateRange.from) filtered = filtered.filter(e => e.timestamp >= dateRange.from);
    if (dateRange.to) filtered = filtered.filter(e => e.timestamp <= dateRange.to);
  }

  const rows = filtered.map(e => ({
    ID: e.id,
    Timestamp: e.timestamp ? formatDate(e.timestamp) : '',
    Actor: e.actorName || e.actorId || '',
    Role: e.actorRole || '',
    Action: e.action || '',
    'Target Type': e.targetType || '',
    'Target ID': e.targetId || '',
    Summary: e.summary || '',
  }));

  const name = filename || `audit-log-${new Date().toISOString().slice(0, 10)}`;
  downloadSheet(rows, name, 'csv');
}

/**
 * Export producer leaderboard / capacity data.
 *
 * @param {object[]} producers
 * @param {string} [format='csv']
 */
export function exportProducers(producers, format = 'csv') {
  const rows = producers.map(p => ({
    Name: p.displayName || p.id,
    'Requests Fulfilled': p.fulfilled || 0,
    'Units Shipped': p.units || 0,
    'Avg Days': p.avgDays || '',
    'On-Time %': p.onTimePercent != null ? `${p.onTimePercent}%` : '',
  }));

  const name = `producer-report-${new Date().toISOString().slice(0, 10)}`;
  downloadSheet(rows, name, format);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function downloadSheet(rows, filename, format) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

  if (format === 'xlsx') {
    XLSX.writeFile(wb, `${filename}.xlsx`);
  } else {
    XLSX.writeFile(wb, `${filename}.csv`, { bookType: 'csv' });
  }
}

/**
 * Export a canvas element as a PNG download (for chart screenshots).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {string} [filename='chart']
 */
export function exportChartPng(canvas, filename = 'chart') {
  if (!canvas) return;
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
