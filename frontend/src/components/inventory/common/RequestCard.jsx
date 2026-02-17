/**
 * RequestCard
 * 
 * Compact card for displaying a request in grid/card layouts.
 * Used by OpenRequests (producer), AdminDashboard blocked section, etc.
 * 
 * See docs/INVENTORY_SYSTEM_SPEC.md §6.5.2 (card layout)
 */

import React from 'react';
import StatusBadge from './StatusBadge';
import { formatRelativeDate } from '../../../utils/inventoryValidation';
import './RequestCard.css';

export default function RequestCard({
  request,
  showClaim = false,
  claimEstimate = null,
  onClaim,
  onClick,
  compact = false,
}) {
  return (
    <div
      className={`request-card ${compact ? 'request-card--compact' : ''} ${request.urgent ? 'request-card--urgent' : ''}`}
      onClick={() => onClick?.(request)}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(request); } } : undefined}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      <div className="request-card__header">
        <span className="request-card__id">
          {request.urgent && '⚡ '}#{request.id?.slice(4, 10)}
        </span>
        <StatusBadge status={request.status} compact={compact} />
      </div>

      <div className="request-card__body">
        <span className="request-card__item">{request.catalogItemName || 'Item'}</span>
        <span className="request-card__qty">
          {request.quantity?.toLocaleString()} {request.unit || 'units'}
        </span>
        <span className="request-card__location">
          📍 {request.city && request.state ? `${request.city}, ${request.state}` : request.state || '—'}
        </span>
        {!compact && (
          <span className="request-card__date">{formatRelativeDate(request.requestedAt)}</span>
        )}
      </div>

      {claimEstimate && (
        <div className="request-card__estimate">
          Can fill: {claimEstimate}
        </div>
      )}

      {showClaim && request.status === 'open' && (
        <button
          className="request-card__claim-btn"
          onClick={e => { e.stopPropagation(); onClaim?.(request); }}
        >
          Claim ▶
        </button>
      )}
    </div>
  );
}
