// frontend/src/components/inventory/producer/AddressReveal.jsx
// Producer sees the decrypted shipping address for an approved request
// and marks it as shipped with tracking info — see spec §4.4

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useInventory } from '../../../contexts/InventoryContext';
import { decryptAddressReveal } from '../../../utils/addressCrypto';
import { generateId } from '../../../utils/inventoryValidation';
import { pushNotification } from '../../../utils/inventoryNotifications';
import { useCopyFeedback } from '../../../hooks/useCopyFeedback';
import { formatAddressForCopy, getEnabledProviders } from '../../../utils/shippingProviders';
import './AddressReveal.css';

/**
 * @param {{ requestId: string, reveal: Object, identity: Object, onShipped: Function, onClose: Function }} props
 */
export default function AddressReveal({ requestId, reveal, identity, onShipped, onClose }) {
  const ctx = useInventory();
  const [address, setAddress] = useState(null);
  const [decryptError, setDecryptError] = useState(null);
  const { copied, copyToClipboard } = useCopyFeedback();
  const [providerCopied, setProviderCopied] = useState(null); // tracks which provider ID was just copied
  const [trackingNumber, setTrackingNumber] = useState('');
  const [shippingNotes, setShippingNotes] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [shipping, setShipping] = useState(false);

  // Look up request details for the info section
  const requestInfo = useMemo(() => {
    const yArr = ctx.yInventoryRequests;
    if (!yArr) return null;
    const arr = yArr.toArray();
    return arr.find(r => r.id === requestId) || null;
  }, [ctx.yInventoryRequests, requestId]);

  // Get enabled shipping providers from system settings
  const enabledProviders = useMemo(() => {
    const system = ctx.yInventorySystems?.get(ctx.inventorySystemId);
    return getEnabledProviders(system?.settings);
  }, [ctx.yInventorySystems, ctx.inventorySystemId]);

  useEffect(() => {
    if (!reveal || !identity?.privateKey) return;
    let cancelled = false;

    (async () => {
      try {
        const addr = await decryptAddressReveal(reveal, identity.privateKey);
        if (!cancelled) setAddress(addr);
      } catch (err) {
        console.error('[AddressReveal] Decryption failed:', err);
        if (!cancelled) setDecryptError('Could not decrypt the shipping address. Make sure you are the assigned producer.');
      }
    })();

    return () => { cancelled = true; };
  }, [reveal, identity]);

  const handleCopy = useCallback(() => {
    if (!address) return;
    copyToClipboard(formatAddressForCopy(address));
  }, [address, copyToClipboard]);

  const handleShipWith = useCallback((provider) => {
    if (!address) return;
    const formatted = provider.formatAddress(address);
    copyToClipboard(formatted, () => {
      setProviderCopied(provider.id);
      setTimeout(() => setProviderCopied(null), 2500);
    });
    // Open shipping provider in new tab
    window.open(provider.url, '_blank', 'noopener,noreferrer');
  }, [address, copyToClipboard]);

  const handleMarkShipped = useCallback(async () => {
    if (!confirmed) return;
    setShipping(true);
    try {
      // Update request status
      const yArr = ctx.yInventoryRequests;
      if (yArr) {
        const arr = yArr.toArray();
        const idx = arr.findIndex(r => r.id === requestId);
        if (idx !== -1) {
          const updated = {
            ...arr[idx],
            status: 'shipped',
            shippedAt: Date.now(),
            trackingNumber: trackingNumber || undefined,
            printerNotes: shippingNotes || undefined,
          };
          yArr.delete(idx, 1);
          yArr.insert(idx, [updated]);
        }
      }

      // Delete the address reveal from Yjs
      ctx.yAddressReveals?.delete(requestId);

      // Audit log
      ctx.yInventoryAuditLog?.push([{
        id: generateId(),
        inventorySystemId: ctx.inventorySystemId,
        timestamp: Date.now(),
        actorId: ctx.userIdentity?.publicKeyBase62 || 'unknown',
        actorRole: 'editor',
        action: 'request_shipped',
        targetType: 'request',
        targetId: requestId,
        summary: `Request ${requestId.slice(0, 8)} marked as shipped${trackingNumber ? ` (tracking: ${trackingNumber})` : ''}`,
      }]);

      // Notify the requestor
      const req = yArr ? yArr.toArray().find(r => r.id === requestId) : null;
      if (req?.requestedBy) {
        pushNotification(ctx.yInventoryNotifications, {
          inventorySystemId: ctx.inventorySystemId,
          recipientId: req.requestedBy,
          type: 'request_shipped',
          message: `Your request for ${req.catalogItemName} has been shipped${trackingNumber ? ` (tracking: ${trackingNumber})` : ''}`,
          relatedId: requestId,
        });
      }

      onShipped?.(requestId);
    } catch (err) {
      console.error('[AddressReveal] Error marking shipped:', err);
    } finally {
      setShipping(false);
    }
  }, [confirmed, trackingNumber, shippingNotes, requestId, ctx, onShipped]);

  if (decryptError) {
    return (
      <div className="address-reveal">
        <div className="ar-header">
          <h3>Shipping Address</h3>
          {onClose && <button className="ar-close" onClick={onClose}>✕</button>}
        </div>
        <div className="ar-error">{decryptError}</div>
      </div>
    );
  }

  if (!address) {
    return (
      <div className="address-reveal">
        <div className="ar-header">
          <h3>Shipping Address</h3>
          {onClose && <button className="ar-close" onClick={onClose}>✕</button>}
        </div>
        <div className="ar-loading">Decrypting address…</div>
      </div>
    );
  }

  return (
    <div className="address-reveal">
      <div className="ar-header">
        <h3>Shipping Address</h3>
        {onClose && <button className="ar-close" onClick={onClose}>✕</button>}
      </div>

      {requestInfo && (
        <div className="ar-request-info">
          <div className="ar-request-info__row">
            <span className="ar-request-info__label">Item:</span>
            <span>{requestInfo.catalogItemName || requestInfo.itemName || 'Unknown'}</span>
          </div>
          <div className="ar-request-info__row">
            <span className="ar-request-info__label">Qty:</span>
            <span>{requestInfo.quantity?.toLocaleString()} {requestInfo.unit || 'units'}</span>
          </div>
          <div className="ar-request-info__row">
            <span className="ar-request-info__label">Location:</span>
            <span>{requestInfo.shippingCity || requestInfo.city}, {requestInfo.shippingState || requestInfo.state}</span>
          </div>
          <div className="ar-request-info__row">
            <span className="ar-request-info__label">Requested:</span>
            <span>{requestInfo.requestedAt ? new Date(requestInfo.requestedAt).toLocaleDateString() : '—'}</span>
          </div>
          {requestInfo.approvedAt && (
            <div className="ar-request-info__row">
              <span className="ar-request-info__label">Approved:</span>
              <span>{new Date(requestInfo.approvedAt).toLocaleDateString()}</span>
            </div>
          )}
        </div>
      )}

      <div className="ar-address-block">
        <span className="ar-decrypt-label">🔒 Decrypted with your private key</span>
        <p className="ar-name">{address.fullName || address.name}</p>
        <p>{address.street1 || address.line1}</p>
        {(address.street2 || address.line2) && <p>{address.street2 || address.line2}</p>}
        <p>{address.city}, {address.state} {address.zipCode || address.zip}</p>
        <p>{address.country || 'US'}</p>
        {address.phone && <p className="ar-phone">Phone: {address.phone}</p>}
      </div>

      <button className="ar-copy-btn" onClick={handleCopy}>
        {copied ? '✓ Copied!' : '📋 Copy Address'}
      </button>

      {enabledProviders.length > 0 && (
        <div className="ar-provider-group">
          <span className="ar-provider-label">Ship with</span>
          <div className="ar-provider-buttons">
            {enabledProviders.map(provider => (
              <button
                key={provider.id}
                className="ar-provider-btn"
                onClick={() => handleShipWith(provider)}
                title={`Copy address & open ${provider.name}`}
              >
                <span className="ar-provider-icon">{provider.icon}</span>
                <span className="ar-provider-name">{provider.name}</span>
                {providerCopied === provider.id && (
                  <span className="ar-provider-copied">✓ Copied</span>
                )}
              </button>
            ))}
          </div>
          <span className="ar-provider-hint">Address is copied to clipboard — paste into the shipping site</span>
        </div>
      )}

      <div className="ar-ship-section">
        <label className="ar-tracking-label">
          Tracking Number (optional)
          <input
            type="text"
            className="ar-tracking-input"
            value={trackingNumber}
            onChange={e => setTrackingNumber(e.target.value)}
            placeholder="e.g., 1Z999AA10123456784"
          />
        </label>

        <label className="ar-tracking-label">
          Notes (optional)
          <textarea
            className="ar-notes-input"
            value={shippingNotes}
            onChange={e => setShippingNotes(e.target.value)}
            placeholder="Any shipping notes..."
            rows={2}
          />
        </label>

        <label className="ar-confirm-label">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={e => setConfirmed(e.target.checked)}
          />
          I've recorded the shipping info and am ready to mark this as shipped
        </label>

        <button
          className="ar-ship-btn"
          disabled={!confirmed || shipping}
          onClick={handleMarkShipped}
        >
          {shipping ? 'Processing…' : '📦 Mark Shipped'}
        </button>

        <button
          className="ar-unclaim-btn btn-sm btn-secondary"
          onClick={() => {
            const yArr = ctx.yInventoryRequests;
            if (yArr) {
              const arr = yArr.toArray();
              const idx = arr.findIndex(r => r.id === requestId);
              if (idx !== -1) {
                const req = arr[idx];
                yArr.delete(idx, 1);
                yArr.insert(idx, [{ ...req, status: 'open', assignedTo: null, claimedBy: null, assignedAt: null, claimedAt: null, approvedAt: null, approvedBy: null }]);
                // Notify the requestor that the producer unclaimed
                if (req.requestedBy) {
                  pushNotification(ctx.yInventoryNotifications, {
                    inventorySystemId: ctx.inventorySystemId,
                    recipientId: req.requestedBy,
                    type: 'request_unclaimed',
                    message: `A producer unclaimed your request for ${req.catalogItemName}`,
                    relatedId: requestId,
                  });
                }
              }
            }
            ctx.yAddressReveals?.delete(requestId);
            ctx.yInventoryAuditLog?.push([{
              id: generateId(),
              inventorySystemId: ctx.inventorySystemId,
              timestamp: Date.now(),
              actorId: ctx.userIdentity?.publicKeyBase62 || 'unknown',
              actorRole: 'editor',
              action: 'request_unclaimed',
              targetType: 'request',
              targetId: requestId,
              summary: `Request ${requestId.slice(0, 8)} unclaimed by producer`,
            }]);
            onClose?.();
          }}
        >
          ↩️ Unclaim this request
        </button>

        <p className="ar-privacy-note">
          After marking shipped, the encrypted address will be permanently deleted from the network.
        </p>
      </div>
    </div>
  );
}
