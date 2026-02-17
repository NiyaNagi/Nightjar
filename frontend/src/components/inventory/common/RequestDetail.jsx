/**
 * RequestDetail
 * 
 * Expanded detail panel for a single request. Shows timeline, notes, admin actions.
 * Used inline below an expanded RequestRow or in a modal/drawer.
 * 
 * See docs/INVENTORY_SYSTEM_SPEC.md §6.4.2, §6.6.2 (detail panels)
 */

import React, { useState, useCallback, useEffect } from 'react';
import StatusBadge from './StatusBadge';
import { useInventory } from '../../../contexts/InventoryContext';
import { useToast } from '../../../contexts/ToastContext';
import { formatDate, generateId } from '../../../utils/inventoryValidation';
import { getAddress, getWorkspaceKeyMaterial } from '../../../utils/inventoryAddressStore';
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

  // Build timeline
  const timelineEntries = TIMELINE_STEPS.filter(step => request[step.key]).map(step => ({
    ...step,
    date: request[step.key],
  }));

  return (
    <div className="request-detail">
      <div className="request-detail__header">
        <h3>
          {request.urgent && '⚡ '}Request #{request.id?.slice(4, 10)}
        </h3>
        <StatusBadge status={request.status} />
        {onClose && (
          <button className="request-detail__close" onClick={onClose}>✕</button>
        )}
      </div>

      <div className="request-detail__grid">
        <div className="request-detail__field">
          <span className="request-detail__label">Item</span>
          <span>{request.catalogItemName}</span>
        </div>
        <div className="request-detail__field">
          <span className="request-detail__label">Quantity</span>
          <span>{request.quantity?.toLocaleString()} {request.unit || 'units'}</span>
        </div>
        <div className="request-detail__field">
          <span className="request-detail__label">Location</span>
          <span>{request.city}, {request.state}</span>
        </div>
        {isAdmin && fullAddress && (
          <div className="request-detail__field request-detail__field--full">
            <span className="request-detail__label">🔒 Full Address (admin only)</span>
            <div className="request-detail__address-block">
              <p>{fullAddress.name || fullAddress.fullName || fullAddress.recipientName}</p>
              <p>{fullAddress.line1 || fullAddress.street1}</p>
              {(fullAddress.line2 || fullAddress.street2) && <p>{fullAddress.line2 || fullAddress.street2}</p>}
              <p>{fullAddress.city}, {fullAddress.state} {fullAddress.zip || fullAddress.zipCode}</p>
              {fullAddress.phone && <p>Phone: {fullAddress.phone}</p>}
            </div>
          </div>
        )}
        <div className="request-detail__field">
          <span className="request-detail__label">Requested by</span>
          <span>
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
            <span>
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
            <span>{formatDate(request.estimatedFulfillmentDate)}</span>
          </div>
        )}
        {request.trackingNumber && (
          <div className="request-detail__field">
            <span className="request-detail__label">Tracking #</span>
            <span>
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
        {request.notes && (
          <div className="request-detail__field request-detail__field--full">
            <span className="request-detail__label">Requestor Notes</span>
            <span>{request.notes}</span>
          </div>
        )}
      </div>

      {/* Timeline */}
      {timelineEntries.length > 0 && (
        <div className="request-detail__timeline">
          <h4>Timeline</h4>
          <div className="request-timeline">
            {timelineEntries.map((entry, i) => (
              <div key={entry.key} className="request-timeline__step">
                <div className={`request-timeline__dot ${i === timelineEntries.length - 1 ? 'current' : 'past'}`} />
                <div className="request-timeline__info">
                  <span className="request-timeline__label">{entry.label}</span>
                  <span className="request-timeline__date">{formatDate(entry.date)}</span>
                </div>
                {i < timelineEntries.length - 1 && <div className="request-timeline__line" />}
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
        {isAdmin && (request.status === 'claimed' || request.status === 'pending_approval') && (
          <>
            <button className="btn-primary" onClick={() => onApprove?.(request)}>✓ Approve</button>
            <button className="btn-secondary btn-danger" onClick={() => onReject?.(request)}>✗ Reject</button>
            <button className="btn-secondary" onClick={() => onReassign?.(request)}>→ Reassign</button>
          </>
        )}
        {isProducer && request.status === 'approved' && onMarkInProgress && (
          <button className="btn-secondary" onClick={() => onMarkInProgress?.(request)}>🔨 Mark In Progress</button>
        )}
        {isProducer && (request.status === 'approved' || request.status === 'in_progress') && (
          <>
            {/* Inline AddressReveal with shipping providers — spec §4.4 */}
            {addressReveals?.[request.id] ? (
              <div className="request-detail__address-reveal-inline">
                <AddressReveal
                  requestId={request.id}
                  reveal={addressReveals[request.id]}
                  identity={ctxIdentity}
                  onShipped={() => onMarkShipped?.(request, trackingNumber)}
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
        {canCancel && (
          <button className="btn-secondary btn-danger" onClick={() => onCancel?.(request)}>Cancel Request</button>
        )}
      </div>
    </div>
  );
}
