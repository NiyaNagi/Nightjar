/**
 * RequestDetail
 * 
 * Expanded detail panel for a single request. Shows status banner, grouped info
 * sections, interactive stage bar for Approved ↔ In Progress ↔ Shipped transitions,
 * timeline, notes, and admin/producer actions.
 * 
 * See docs/INVENTORY_SYSTEM_SPEC.md §6.4.2, §6.6.2 (detail panels)
 */

import React, { useState, useCallback, useEffect } from 'react';
import StatusBadge from './StatusBadge';
import { useInventory } from '../../../contexts/InventoryContext';
import { useToast } from '../../../contexts/ToastContext';
import { formatDate, generateId } from '../../../utils/inventoryValidation';
import { getAddress, getWorkspaceKeyMaterial } from '../../../utils/inventoryAddressStore';
import { decryptAddressReveal } from '../../../utils/addressCrypto';
import { parseTrackingNumber, genericTrackingUrl } from '../../../utils/trackingLinks';
import { resolveUserName } from '../../../utils/resolveUserName';
import ChatButton from '../../common/ChatButton';
import AddressReveal from '../producer/AddressReveal';
import './RequestDetail.css';

const TIMELINE_STEPS = [
  { key: 'requestedAt', label: 'Requested' },
  { key: 'assignedAt', label: 'Assigned' },
  { key: 'approvedAt', label: 'Approved' },
  { key: 'shippedAt', label: 'Shipped' },
  { key: 'deliveredAt', label: 'Delivered' },
];

/** The three stages users can freely move between */
const FULFILLMENT_STAGES = [
  { key: 'approved', label: 'Approved', icon: '✓' },
  { key: 'in_progress', label: 'In Progress', icon: '🔨' },
  { key: 'shipped', label: 'Shipped', icon: '📦' },
];

const STAGE_INDEX = { approved: 0, in_progress: 1, shipped: 2 };

export default function RequestDetail({
  request,
  isAdmin = false,
  isProducer = false,
  collaborators = [],
  onClose,
  onApprove,
  onReject,
  onReassign,
  onCancel,
  onMarkShipped,
  onMarkInProgress,
  onRevertToApproved,
  onRevertToInProgress,
}) {
  const { yInventoryRequests, yInventoryAuditLog, inventorySystemId, currentWorkspace, workspaceId, addressReveals, onStartChatWith, userIdentity: ctxIdentity } = useInventory();
  const { showToast } = useToast();
  const [adminNotes, setAdminNotes] = useState(request.adminNotes || '');
  const [trackingNumber, setTrackingNumber] = useState(request.trackingNumber || '');
  const [fullAddress, setFullAddress] = useState(null);

  // Re-sync local state when request prop changes (e.g., navigating between requests)
  useEffect(() => {
    setAdminNotes(request.adminNotes || '');
    setTrackingNumber(request.trackingNumber || '');
  }, [request.id, request.adminNotes, request.trackingNumber]);
  const currentUserKey = ctxIdentity?.publicKeyBase62;

  // Admin: attempt to load the full address from local encrypted store
  useEffect(() => {
    if (!isAdmin || !request.id) return;
    let cancelled = false;
    (async () => {
      try {
        const km = getWorkspaceKeyMaterial(currentWorkspace, workspaceId);
        const addr = await getAddress(km, inventorySystemId, request.id);
        if (!cancelled && addr) setFullAddress(addr);
      } catch {
        // Address may not exist locally for this admin
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin, request.id, inventorySystemId, currentWorkspace, workspaceId]);

  // Producer: decrypt address reveal once approved/in-progress/shipped (reveal now persists)
  useEffect(() => {
    if (!isProducer || !request.id) return;
    const reveal = addressReveals?.[request.id];
    if (!reveal || !ctxIdentity?.curveSecretKey) return;
    if (!['approved', 'in_progress', 'shipped'].includes(request.status)) return;
    let cancelled = false;
    (async () => {
      try {
        const addr = await decryptAddressReveal(reveal, ctxIdentity.curveSecretKey);
        if (!cancelled && addr) setFullAddress(addr);
      } catch (err) {
        console.warn('[RequestDetail] Could not decrypt address reveal:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [isProducer, request.id, request.status, addressReveals, ctxIdentity]);

  const assignedName = request.assignedTo
    ? resolveUserName(collaborators, request.assignedTo)
    : null;

  const requestedByName = request.requestedBy
    ? resolveUserName(collaborators, request.requestedBy)
    : 'Unknown';

  const handleSaveNotes = useCallback(() => {
    const items = yInventoryRequests.toArray();
    const idx = items.findIndex(r => r.id === request.id);
    if (idx === -1) return;
    const updated = { ...items[idx], adminNotes: adminNotes.trim(), updatedAt: Date.now() };
    yInventoryRequests.delete(idx, 1);
    yInventoryRequests.insert(idx, [updated]);
    showToast('Notes saved', 'success');
  }, [adminNotes, request.id, yInventoryRequests, showToast]);

  const canCancel = ['open', 'pending_approval', 'claimed'].includes(request.status);
  const showStageBar = ['approved', 'in_progress', 'shipped'].includes(request.status);
  const canInteractStageBar = isAdmin || isProducer;

  // Handle stage bar clicks
  const handleStageClick = useCallback((targetStage) => {
    if (!canInteractStageBar) return;
    const currentIdx = STAGE_INDEX[request.status];
    const targetIdx = STAGE_INDEX[targetStage];
    if (currentIdx === undefined || targetIdx === undefined || currentIdx === targetIdx) return;

    if (targetIdx > currentIdx) {
      // Forward transition
      if (targetStage === 'in_progress') {
        onMarkInProgress?.(request);
      } else if (targetStage === 'shipped') {
        onMarkShipped?.(request, trackingNumber);
      }
    } else {
      // Backward transition
      if (targetStage === 'approved') {
        onRevertToApproved?.(request);
      } else if (targetStage === 'in_progress') {
        onRevertToInProgress?.(request);
      }
    }
  }, [request, canInteractStageBar, onMarkInProgress, onMarkShipped, onRevertToApproved, onRevertToInProgress, trackingNumber]);

  // Build timeline (early non-interactive steps only)
  const earlyTimelineEntries = TIMELINE_STEPS
    .filter(step => step.key === 'requestedAt' || step.key === 'assignedAt')
    .filter(step => request[step.key])
    .map(step => ({ ...step, date: request[step.key] }));

  // Full timeline for non-stage-bar statuses
  const fullTimelineEntries = TIMELINE_STEPS.filter(step => request[step.key]).map(step => ({
    ...step,
    date: request[step.key],
  }));

  // Render an address block (shared between admin and producer views)
  const renderAddressBlock = (addr, label) => (
    <div className="request-detail__field request-detail__field--full">
      <span className="request-detail__label">{label}</span>
      <div className="request-detail__address-block">
        <p>{addr.name || addr.fullName || addr.recipientName}</p>
        <p>{addr.line1 || addr.street1}</p>
        {(addr.line2 || addr.street2) && <p>{addr.line2 || addr.street2}</p>}
        <p>{addr.city}, {addr.state} {addr.zip || addr.zipCode}</p>
        {addr.phone && <p>Phone: {addr.phone}</p>}
      </div>
    </div>
  );

  return (
    <div className="request-detail" data-testid="request-detail">
      {/* Header */}
      <div className="request-detail__header">
        <h3>
          {request.urgent && '⚡ '}Request #{request.id?.slice(4, 10)}
        </h3>
        {onClose && (
          <button className="request-detail__close" onClick={onClose} aria-label="Close">✕</button>
        )}
      </div>

      {/* Status banner */}
      <div className={`request-detail__status-banner request-detail__status-banner--${request.status}`}>
        <StatusBadge status={request.status} />
        {request.urgent && <span className="request-detail__urgent-flag">⚡ Urgent</span>}
      </div>

      {/* Request Info section */}
      <div className="request-detail__section">
        <div className="request-detail__section-title">Request Info</div>
        <div className="request-detail__grid">
          <div className="request-detail__field">
            <span className="request-detail__label">Item</span>
            <span className="request-detail__value">{request.catalogItemName}</span>
          </div>
          <div className="request-detail__field">
            <span className="request-detail__label">Quantity</span>
            <span className="request-detail__value">{request.quantity?.toLocaleString()} {request.unit || 'units'}</span>
          </div>
          {request.notes && (
            <div className="request-detail__field request-detail__field--full">
              <span className="request-detail__label">Notes</span>
              <span className="request-detail__value">{request.notes}</span>
            </div>
          )}
        </div>
      </div>

      {/* Location section */}
      <div className="request-detail__section">
        <div className="request-detail__section-title">Location</div>
        <div className="request-detail__grid">
          <div className="request-detail__field">
            <span className="request-detail__label">City / State</span>
            <span className="request-detail__value">{request.city}, {request.state}</span>
          </div>
          {isAdmin && fullAddress && renderAddressBlock(fullAddress, '🔒 Full Address')}
          {isProducer && fullAddress && renderAddressBlock(fullAddress, '📍 Shipping Address')}
        </div>
      </div>

      {/* People section */}
      <div className="request-detail__section">
        <div className="request-detail__section-title">People</div>
        <div className="request-detail__grid">
          <div className="request-detail__field">
            <span className="request-detail__label">Requested by</span>
            <span className="request-detail__value">
              {requestedByName}
              <ChatButton
                publicKey={request.requestedBy}
                name={requestedByName}
                collaborators={collaborators}
                onStartChatWith={onStartChatWith}
                currentUserKey={currentUserKey}
              />
            </span>
          </div>
          {assignedName && (
            <div className="request-detail__field">
              <span className="request-detail__label">Assigned to</span>
              <span className="request-detail__value">
                {assignedName}
                <ChatButton
                  publicKey={request.assignedTo}
                  name={assignedName}
                  collaborators={collaborators}
                  onStartChatWith={onStartChatWith}
                  currentUserKey={currentUserKey}
                />
              </span>
            </div>
          )}
          {request.estimatedFulfillmentDate && (
            <div className="request-detail__field">
              <span className="request-detail__label">Est. Fulfillment</span>
              <span className="request-detail__value">{formatDate(request.estimatedFulfillmentDate)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Shipping section — tracking & fulfillment info */}
      {(request.trackingNumber || showStageBar) && (
        <div className="request-detail__section">
          <div className="request-detail__section-title">Shipping</div>
          <div className="request-detail__grid">
            {request.trackingNumber && (
              <div className="request-detail__field request-detail__field--full">
                <span className="request-detail__label">Tracking #</span>
                <span className="request-detail__value">
                  {(() => {
                    const carrier = parseTrackingNumber(request.trackingNumber);
                    const url = carrier?.url || genericTrackingUrl(request.trackingNumber);
                    return (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="request-detail__tracking-link">
                        {carrier ? `${carrier.icon} ${carrier.carrier}: ` : ''}{request.trackingNumber} ↗
                      </a>
                    );
                  })()}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Interactive Stage Bar — Approved ↔ In Progress ↔ Shipped */}
      {showStageBar && (
        <div className="request-detail__stage-section">
          {/* Early timeline checkmarks */}
          {earlyTimelineEntries.length > 0 && (
            <div className="request-detail__early-timeline">
              {earlyTimelineEntries.map((entry, i) => (
                <div key={entry.key} className="request-detail__early-step">
                  <span className="request-detail__early-check">✓</span>
                  <span className="request-detail__early-label">{entry.label}</span>
                  <span className="request-detail__early-date">{formatDate(entry.date)}</span>
                  {i < earlyTimelineEntries.length - 1 && (
                    <span className="request-detail__early-connector">→</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Stage bar */}
          <div className="request-detail__stage-bar" data-testid="stage-bar" role="group" aria-label="Fulfillment stage">
            {FULFILLMENT_STAGES.map((stage, idx) => {
              const currentIdx = STAGE_INDEX[request.status];
              const isPast = idx < currentIdx;
              const isActive = idx === currentIdx;
              const isFuture = idx > currentIdx;
              const isClickable = canInteractStageBar && !isActive;

              let className = 'stage-btn';
              if (isActive) className += ' stage-btn--active';
              else if (isPast) className += ' stage-btn--past';
              else className += ' stage-btn--future';
              className += ` stage-btn--${stage.key}`;

              return (
                <button
                  key={stage.key}
                  className={className}
                  onClick={() => isClickable && handleStageClick(stage.key)}
                  disabled={!isClickable}
                  aria-current={isActive ? 'step' : undefined}
                  data-testid={`stage-btn-${stage.key}`}
                  title={
                    isActive ? `Current stage: ${stage.label}`
                    : isClickable ? `Move to ${stage.label}`
                    : stage.label
                  }
                >
                  <span className="stage-btn__icon">{stage.icon}</span>
                  <span className="stage-btn__label">{stage.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Read-only timeline for non-stage-bar statuses */}
      {!showStageBar && fullTimelineEntries.length > 0 && (
        <div className="request-detail__timeline">
          <h4>Timeline</h4>
          <div className="request-timeline">
            {fullTimelineEntries.map((entry, i) => (
              <div key={entry.key} className="request-timeline__step">
                <div className={`request-timeline__dot ${i === fullTimelineEntries.length - 1 ? 'current' : 'past'}`} />
                <div className="request-timeline__info">
                  <span className="request-timeline__label">{entry.label}</span>
                  <span className="request-timeline__date">{formatDate(entry.date)}</span>
                </div>
                {i < fullTimelineEntries.length - 1 && <div className="request-timeline__line" />}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Admin notes */}
      {isAdmin && (
        <div className="request-detail__admin-notes">
          <h4>Admin Notes</h4>
          <textarea
            value={adminNotes}
            onChange={e => setAdminNotes(e.target.value)}
            placeholder="Internal notes..."
            rows={2}
          />
          <button className="btn-sm" onClick={handleSaveNotes}>💾 Save Notes</button>
        </div>
      )}

      {/* Actions */}
      <div className="request-detail__actions">
        {/* Pre-approval admin actions */}
        {isAdmin && (request.status === 'claimed' || request.status === 'pending_approval') && (
          <>
            <button className="btn-primary" onClick={() => onApprove?.(request)}>✓ Approve</button>
            <button className="btn-secondary btn-danger" onClick={() => onReject?.(request)}>✗ Reject</button>
            <button className="btn-secondary" onClick={() => onReassign?.(request.id)}>→ Reassign</button>
          </>
        )}

        {/* Producer: inline AddressReveal when approved/in_progress */}
        {isProducer && (request.status === 'approved' || request.status === 'in_progress') && (
          <>
            {addressReveals?.[request.id] ? (
              <div className="request-detail__address-reveal-inline">
                <AddressReveal
                  requestId={request.id}
                  reveal={addressReveals[request.id]}
                  identity={ctxIdentity}
                  onShipped={() => onMarkShipped?.(request)}
                  onClose={onClose}
                />
              </div>
            ) : (
              <div className="request-detail__ship-form">
                <p className="request-detail__no-reveal">
                  ⏳ Address reveal pending — the reveal hasn't synced yet.
                </p>
                <label>
                  Tracking # (optional)
                  <input
                    type="text"
                    value={trackingNumber}
                    onChange={e => setTrackingNumber(e.target.value)}
                    placeholder="1Z999AA10123456784"
                  />
                </label>
                <button className="btn-primary" onClick={() => onMarkShipped?.(request, trackingNumber)}>📦 Mark as Shipped</button>
              </div>
            )}
          </>
        )}

        {/* Cancel — early statuses only */}
        {canCancel && onCancel && (
          <button className="btn-secondary btn-danger" onClick={() => onCancel(request)}>Cancel Request</button>
        )}
      </div>
    </div>
  );
}
