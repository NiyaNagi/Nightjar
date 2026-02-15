/**
 * StatusBadge
 * 
 * Color-coded status indicator for inventory request statuses.
 * Maps each RequestStatus to a color using the app's CSS variable palette.
 * 
 * See docs/INVENTORY_SYSTEM_SPEC.md §3.3 (RequestStatus type)
 */

import React from 'react';
import './StatusBadge.css';

/**
 * Status → display configuration
 * Colors chosen from global.css variables: success (#22c55e), warning (#f59e0b),
 * error (#ef4444), accent (#6366f1), plus contextual colors for statuses.
 */
const STATUS_CONFIG = {
  open: {
    label: 'Open',
    className: 'status-badge--open',
  },
  claimed: {
    label: 'Claimed',
    className: 'status-badge--claimed',
  },
  pending_approval: {
    label: 'Pending Approval',
    className: 'status-badge--pending',
  },
  approved: {
    label: 'Approved',
    className: 'status-badge--approved',
  },
  shipped: {
    label: 'Shipped',
    className: 'status-badge--shipped',
  },
  delivered: {
    label: 'Delivered',
    className: 'status-badge--delivered',
  },
  blocked: {
    label: 'Blocked',
    className: 'status-badge--blocked',
  },
  cancelled: {
    label: 'Cancelled',
    className: 'status-badge--cancelled',
  },
};

/**
 * @param {Object} props
 * @param {string} props.status - One of the RequestStatus values
 * @param {string} [props.className] - Additional CSS class
 * @param {boolean} [props.compact] - If true, renders as a small dot instead of pill
 */
export default function StatusBadge({ status, className = '', compact = false }) {
  const config = STATUS_CONFIG[status] || { label: status || 'Unknown', className: '' };

  if (compact) {
    return (
      <span
        className={`status-badge status-badge--compact ${config.className} ${className}`}
        title={config.label}
        aria-label={config.label}
      />
    );
  }

  return (
    <span className={`status-badge ${config.className} ${className}`}>
      {config.label}
    </span>
  );
}
