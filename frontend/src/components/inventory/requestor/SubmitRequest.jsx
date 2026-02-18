/**
 * SubmitRequest
 * 
 * Requestor (Viewer) or Admin view for submitting a new inventory request.
 * Select catalog item, set quantity, choose/enter address, set urgency, submit.
 * 
 * See docs/INVENTORY_SYSTEM_SPEC.md §6.6.1 (Submit Request View)
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useInventory } from '../../../contexts/InventoryContext';
import { useToast } from '../../../contexts/ToastContext';
import { validateQuantity, validateAddress, generateId, US_STATES, COUNTRIES } from '../../../utils/inventoryValidation';
import { getSavedAddresses, storeSavedAddress } from '../../../utils/inventorySavedAddresses';
import { storeAddress, getWorkspaceKeyMaterial } from '../../../utils/inventoryAddressStore';
import { encryptAddressForAdmins, getPublicKeyHex } from '../../../utils/addressCrypto';
import { assignRequests } from '../../../utils/inventoryAssignment';
import { pushNotification } from '../../../utils/inventoryNotifications';
import './SubmitRequest.css';

const EMPTY_ADDRESS = {
  name: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  zip: '',
  phone: '',
  country: 'US',
};

export default function SubmitRequest({ currentWorkspace, isOwner }) {
  const ctx = useInventory();
  const { yInventoryRequests, yInventoryAuditLog, yPendingAddresses, yInventoryNotifications,
    inventorySystemId, workspaceId, userIdentity, collaborators,
    catalogItems, currentSystem, producerCapacities, requests: existingRequests } = ctx;
  const { showToast } = useToast();

  // Active catalog items only
  const activeItems = catalogItems.filter(i => i.active);

  // Form state
  const [selectedItemId, setSelectedItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [notes, setNotes] = useState('');

  // Cart state (batch submit)
  const [cart, setCart] = useState([]);

  // Address state
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const [showNewAddress, setShowNewAddress] = useState(false);
  const [newAddress, setNewAddress] = useState({ ...EMPTY_ADDRESS });
  const [saveNewAddress, setSaveNewAddress] = useState(false);
  const [newAddressLabel, setNewAddressLabel] = useState('');

  const [submitting, setSubmitting] = useState(false);

  // Rate limiting: 10 requests/day for non-admins
  const DAILY_LIMIT = 10;
  const todayRequestCount = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return existingRequests.filter(
      r => r.requestedBy === userIdentity?.publicKeyBase62 && r.requestedAt >= todayStart.getTime()
    ).length;
  }, [existingRequests, userIdentity?.publicKeyBase62]);
  const rateLimitReached = !isOwner && todayRequestCount >= DAILY_LIMIT;

  const selectedItem = activeItems.find(i => i.id === selectedItemId);

  // Load saved addresses
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const km = await getWorkspaceKeyMaterial(currentWorkspace, workspaceId);
        if (!km || !userIdentity?.publicKeyBase62) return;
        const addrs = await getSavedAddresses(km, userIdentity.publicKeyBase62);
        if (!cancelled) setSavedAddresses(addrs);
      } catch {
        // No saved addresses yet — fine
      }
    })();
    return () => { cancelled = true; };
  }, [currentWorkspace, workspaceId, userIdentity]);

  // Auto-select first item
  useEffect(() => {
    if (!selectedItemId && activeItems.length > 0) {
      setSelectedItemId(activeItems[0].id);
    }
  }, [activeItems, selectedItemId]);

  // Quantity validation
  const qtyNum = Number(quantity);
  const qtyValidation = selectedItem ? validateQuantity(qtyNum, selectedItem) : { valid: false, error: 'Select an item' };

  const getActiveAddress = () => {
    if (showNewAddress) return newAddress;
    return savedAddresses.find(a => a.id === selectedAddressId) || null;
  };

  const handleAddToCart = useCallback(() => {
    if (!selectedItem) {
      showToast('Please select a catalog item', 'error');
      return;
    }
    if (!qtyValidation.valid) {
      showToast(qtyValidation.error, 'error');
      return;
    }
    setCart(prev => [...prev, {
      id: Date.now().toString(36),
      itemId: selectedItem.id,
      itemName: selectedItem.name,
      quantity: qtyNum,
      unitName: selectedItem.unitName,
      urgent,
      notes: notes.trim(),
    }]);
    // Reset item fields but keep address
    setQuantity('');
    setUrgent(false);
    setNotes('');
    showToast(`Added ${selectedItem.name} x${qtyNum} to cart`, 'success');
  }, [selectedItem, qtyNum, qtyValidation, urgent, notes, showToast]);

  const handleRemoveFromCart = useCallback((cartId) => {
    setCart(prev => prev.filter(c => c.id !== cartId));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;

    // Rate limit check
    if (rateLimitReached) {
      showToast(`Daily limit reached (${DAILY_LIMIT} requests/day). Try again tomorrow.`, 'error');
      return;
    }

    // Build list of items to submit: cart items + current form item (if filled)
    const itemsToSubmit = [...cart];
    if (selectedItem && qtyValidation.valid) {
      itemsToSubmit.push({
        id: 'current',
        itemId: selectedItem.id,
        itemName: selectedItem.name,
        quantity: qtyNum,
        unitName: selectedItem.unitName,
        urgent,
        notes: notes.trim(),
      });
    }

    if (itemsToSubmit.length === 0) {
      showToast('Please select an item and quantity, or add items to your cart', 'error');
      return;
    }

    // Validate address
    const address = getActiveAddress();
    const addrValidation = validateAddress(address);
    if (!addrValidation.valid) {
      showToast(addrValidation.errors[0], 'error');
      return;
    }

    setSubmitting(true);

    try {
      const now = Date.now();

      // Compute displayId base
      let nextDisplayId = 0;
      let hasAnyDisplayId = false;
      try {
        const existingReqs = yInventoryRequests.toArray();
        for (const r of existingReqs) {
          if (r.displayId) hasAnyDisplayId = true;
          const did = parseInt(r.displayId, 10);
          if (!isNaN(did) && did > nextDisplayId) nextDisplayId = did;
        }
      } catch { /* ignore */ }

      // Address encryption (once for all requests)
      const km = await getWorkspaceKeyMaterial(currentWorkspace, workspaceId);

      // Save new address if requested
      if (showNewAddress && saveNewAddress && newAddressLabel.trim() && km) {
        await storeSavedAddress(km, userIdentity.publicKeyBase62, {
          label: newAddressLabel.trim(),
          ...newAddress,
        });
        const refreshed = await getSavedAddresses(km, userIdentity.publicKeyBase62);
        setSavedAddresses(refreshed);
      }

      const requestIds = [];
      for (const item of itemsToSubmit) {
        const requestId = generateId('req-');
        requestIds.push(requestId);
        const displayId = hasAnyDisplayId ? String(++nextDisplayId) : '';

        // Address encryption per request
        if (isOwner) {
          // Store locally for fast retrieval on this device
          if (km) {
            await storeAddress(km, inventorySystemId, requestId, address);
          }
          // Also encrypt to yPendingAddresses so admins on other devices can decrypt
          const admins = (collaborators || []).filter(
            c => c.permission === 'owner'
          );
          if (admins.length > 0 && userIdentity?.curveSecretKey) {
            const senderPubHex = getPublicKeyHex(userIdentity);
            const entries = await encryptAddressForAdmins(
              address, admins, userIdentity.curveSecretKey, senderPubHex
            );
            yPendingAddresses.set(requestId, entries);
          }
        } else {
          const admins = (collaborators || []).filter(
            c => c.permission === 'owner'
          );
          if (admins.length > 0 && userIdentity?.curveSecretKey) {
            const senderPubHex = getPublicKeyHex(userIdentity);
            const entries = await encryptAddressForAdmins(
              address, admins, userIdentity.curveSecretKey, senderPubHex
            );
            yPendingAddresses.set(requestId, entries);
          }
        }

        const request = {
          id: requestId,
          displayId,
          inventorySystemId,
          catalogItemId: item.itemId,
          catalogItemName: item.itemName,
          quantity: item.quantity,
          unit: item.unitName,
          city: address.city,
          state: address.state,
          country: address.country || 'US',
          urgent: item.urgent,
          notes: item.notes,
          status: 'open',
          requestedBy: userIdentity?.publicKeyBase62 || 'unknown',
          requestedAt: now,
          assignedTo: null,
          approvedAt: null,
          shippedAt: null,
          trackingNumber: '',
          adminNotes: '',
          estimatedFulfillmentDate: null,
        };

        yInventoryRequests.push([request]);

        yInventoryAuditLog.push([{
          id: generateId('aud-'),
          inventorySystemId,
          action: 'request_submitted',
          targetId: requestId,
          targetType: 'request',
          summary: `Request submitted: ${item.itemName} x${item.quantity} to ${address.city}, ${address.state}`,
          actorId: userIdentity?.publicKeyBase62 || '',
          actorRole: isOwner ? 'owner' : 'viewer',
          timestamp: now,
        }]);
      }

      // Auto-assign if enabled (spec §5.2)
      const settings = currentSystem?.settings || {};
      if (settings.autoAssignEnabled !== false) {
        try {
          const capMap = {};
          if (ctx.yProducerCapacities?.forEach) {
            ctx.yProducerCapacities.forEach((val, key) => { capMap[key] = val; });
          }
          const allReqs = yInventoryRequests.toArray();
          for (const requestId of requestIds) {
            const req = allReqs.find(r => r.id === requestId);
            if (!req) continue;
            const results = assignRequests(allReqs, capMap, req.catalogItemId);
            const myAssignment = results.find(a => a.requestId === requestId && a.producerId);
            if (myAssignment) {
              const arr = yInventoryRequests.toArray();
              const idx = arr.findIndex(r => r.id === requestId);
              if (idx !== -1) {
                yInventoryRequests.delete(idx, 1);
                yInventoryRequests.insert(idx, [{
                  ...arr[idx],
                  status: settings.requireApproval ? 'pending_approval' : 'claimed',
                  assignedTo: myAssignment.producerId,
                  assignedAt: now,
                  estimatedFulfillmentDate: myAssignment.estimatedDate,
                }]);
              }
            }
          }
        } catch {
          // Auto-assign is best-effort
        }
      }

      const count = itemsToSubmit.length;
      showToast(`${count} request${count > 1 ? 's' : ''} submitted!`, 'success');

      // Notify admins (owners only) about new request(s)
      if (yInventoryNotifications) {
        const admins = (collaborators || []).filter(c => c.permission === 'owner');
        const myKey = userIdentity?.publicKeyBase62;
        for (const admin of admins) {
          const adminKey = admin.publicKeyBase62 || admin.publicKey;
          if (adminKey && adminKey !== myKey) {
            pushNotification(yInventoryNotifications, {
              inventorySystemId,
              recipientId: adminKey,
              type: 'request_submitted',
              message: `New request${count > 1 ? 's' : ''} submitted: ${itemsToSubmit.map(i => i.itemName).join(', ')}`,
              relatedId: requestIds[0],
            });
          }
        }
      }

      // Reset form
      setCart([]);
      setQuantity('');
      setUrgent(false);
      setNotes('');
      setShowNewAddress(false);
      setNewAddress({ ...EMPTY_ADDRESS });
      setSaveNewAddress(false);
      setNewAddressLabel('');
    } catch (err) {
      showToast('Failed to submit request: ' + (err.message || err), 'error');
    } finally {
      setSubmitting(false);
    }
  }, [selectedItem, qtyNum, qtyValidation, urgent, notes, showNewAddress, newAddress,
    saveNewAddress, newAddressLabel, submitting, currentWorkspace, workspaceId,
    inventorySystemId, userIdentity, yInventoryRequests, yInventoryAuditLog, yInventoryNotifications, showToast, cart,
    currentSystem, ctx, collaborators, isOwner, yPendingAddresses]);

  return (
    <div className="submit-request">
      <h2>Submit a New Request</h2>

      {/* Item selection */}
      <section className="submit-request__section">
        <h3>What do you need?</h3>
        {activeItems.length === 0 ? (
          <p className="submit-request__empty">No items available yet. Ask an admin to add items to the catalog.</p>
        ) : (
          <div className="submit-request__items">
            {activeItems.map(item => (
              <label
                key={item.id}
                className={`submit-request__item-card ${selectedItemId === item.id ? 'selected' : ''}`}
              >
                <input
                  type="radio"
                  name="catalog-item"
                  value={item.id}
                  checked={selectedItemId === item.id}
                  onChange={() => setSelectedItemId(item.id)}
                />
                <div>
                  <strong>{item.name}</strong>
                  <span className="submit-request__item-range">
                    {item.quantityMin?.toLocaleString()} – {item.quantityMax != null ? item.quantityMax.toLocaleString() : '∞'} {item.unitName}
                    {item.quantityStep > 1 && ` (multiples of ${item.quantityStep})`}
                  </span>
                </div>
              </label>
            ))}
          </div>
        )}
      </section>

      {/* Quantity */}
      {selectedItem && (
        <section className="submit-request__section">
          <h3>Quantity</h3>
          <div className="submit-request__qty-row">
            <input
              type="number"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              placeholder={`${selectedItem.quantityMin}${selectedItem.quantityMax != null ? ` – ${selectedItem.quantityMax}` : '+'}`}
              min={selectedItem.quantityMin}
              max={selectedItem.quantityMax != null ? selectedItem.quantityMax : undefined}
              step={selectedItem.quantityStep}
            />
            <span className="submit-request__unit">{selectedItem.unitName}</span>
            {quantity && (
              <span className={`submit-request__validation ${qtyValidation.valid ? 'valid' : 'invalid'}`}>
                {qtyValidation.valid ? '✅ Valid' : `❌ ${qtyValidation.error}`}
              </span>
            )}
          </div>
        </section>
      )}

      {/* Address */}
      <section className="submit-request__section">
        <h3>Shipping Address</h3>

        {savedAddresses.length > 0 && !showNewAddress && (
          <div className="submit-request__saved-addresses">
            <p className="submit-request__saved-label">📍 Saved Addresses:</p>
            <div className="submit-request__address-grid">
              {savedAddresses.map(addr => (
                <label
                  key={addr.id}
                  className={`submit-request__address-card ${selectedAddressId === addr.id ? 'selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="address"
                    value={addr.id}
                    checked={selectedAddressId === addr.id}
                    onChange={() => setSelectedAddressId(addr.id)}
                  />
                  <div>
                    <strong>{addr.label || 'Address'}</strong>
                    <span>{addr.line1}</span>
                    <span>{addr.city}, {addr.state} {addr.zip}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        <button
          className="submit-request__new-addr-toggle"
          onClick={() => setShowNewAddress(!showNewAddress)}
        >
          {showNewAddress ? '← Use saved address' : '+ Enter a new address'}
        </button>

        {showNewAddress && (
          <div className="submit-request__new-address">
            <div className="submit-request__field-row">
              <label>
                Full Name *
                <input type="text" value={newAddress.name}
                  onChange={e => setNewAddress({ ...newAddress, name: e.target.value })}
                  placeholder="John Smith" />
              </label>
            </div>
            <div className="submit-request__field-row">
              <label>
                Address Line 1 *
                <input type="text" value={newAddress.line1}
                  onChange={e => setNewAddress({ ...newAddress, line1: e.target.value })}
                  placeholder="123 Main Street" />
              </label>
            </div>
            <div className="submit-request__field-row">
              <label>
                Address Line 2
                <input type="text" value={newAddress.line2}
                  onChange={e => setNewAddress({ ...newAddress, line2: e.target.value })}
                  placeholder="Apt 4B" />
              </label>
            </div>
            <div className="submit-request__field-row">
              <label>
                Country
                <select value={newAddress.country || 'US'}
                  onChange={e => setNewAddress({ ...newAddress, country: e.target.value, state: '' })}>
                  {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            </div>
            <div className="submit-request__field-row two-col">
              <label>
                City *
                <input type="text" value={newAddress.city}
                  onChange={e => setNewAddress({ ...newAddress, city: e.target.value })}
                  placeholder="Nashville" />
              </label>
              <label>
                {(newAddress.country || 'US') === 'US' ? 'State *' : 'State/Province *'}
                {(newAddress.country || 'US') === 'US' ? (
                  <select value={newAddress.state}
                    onChange={e => setNewAddress({ ...newAddress, state: e.target.value })}>
                    <option value="">Select state</option>
                    {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <input type="text" value={newAddress.state}
                    onChange={e => setNewAddress({ ...newAddress, state: e.target.value })}
                    placeholder="Province / State" />
                )}
              </label>
            </div>
            <div className="submit-request__field-row two-col">
              <label>
                {(newAddress.country || 'US') === 'US' ? 'ZIP *' : 'Postal Code *'}
                <input type="text" value={newAddress.zip}
                  onChange={e => setNewAddress({ ...newAddress, zip: e.target.value })}
                  placeholder="37201" maxLength={10} />
              </label>
              <label>
                Phone (optional)
                <input type="text" value={newAddress.phone}
                  onChange={e => setNewAddress({ ...newAddress, phone: e.target.value })}
                  placeholder="(555) 123-4567" />
              </label>
            </div>

            {/* Save new address option */}
            <label className="submit-request__save-toggle">
              <input type="checkbox" checked={saveNewAddress}
                onChange={e => setSaveNewAddress(e.target.checked)} />
              Save this address for future requests
            </label>
            {saveNewAddress && (
              <label className="submit-request__save-label-input">
                Label
                <input type="text" value={newAddressLabel}
                  onChange={e => setNewAddressLabel(e.target.value)}
                  placeholder="e.g., Home, Office" />
              </label>
            )}
          </div>
        )}
      </section>

      {/* Urgency */}
      <section className="submit-request__section">
        <h3>Urgency</h3>
        <div className="submit-request__urgency">
          <label className={`submit-request__urgency-option ${!urgent ? 'selected' : ''}`}>
            <input type="radio" name="urgency" checked={!urgent}
              onChange={() => setUrgent(false)} />
            <div>
              <strong>Normal</strong>
              <span>Est. 5–7 days</span>
            </div>
          </label>
          <label className={`submit-request__urgency-option ${urgent ? 'selected' : ''}`}>
            <input type="radio" name="urgency" checked={urgent}
              onChange={() => setUrgent(true)} />
            <div>
              <strong>⚡ Urgent</strong>
              <span>Prioritized in assignment queue</span>
            </div>
          </label>
        </div>
      </section>

      {/* Notes */}
      <section className="submit-request__section">
        <h3>Notes (optional)</h3>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Any special instructions..."
          rows={3}
        />
      </section>

      {/* Submit */}
      <div className="submit-request__footer">
        {/* Cart display */}
        {cart.length > 0 && (
          <div className="submit-request__cart">
            <h4>🛒 Cart ({cart.length} item{cart.length > 1 ? 's' : ''})</h4>
            <ul className="submit-request__cart-list">
              {cart.map(c => (
                <li key={c.id} className="submit-request__cart-item">
                  <span>{c.itemName} × {c.quantity} {c.unit} {c.urgent ? '⚡' : ''}</span>
                  <button className="btn-sm btn-sm--danger" onClick={() => handleRemoveFromCart(c.id)}>✕</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {selectedItem && qtyValidation.valid && (
          <button
            className="btn-secondary submit-request__add-cart-btn"
            onClick={handleAddToCart}
          >
            + Add to Cart
          </button>
        )}
        <p className="submit-request__privacy">
          🔒 Your full address is encrypted and only visible to workspace admins.
          Producers see only your city and state.
        </p>
        {!isOwner && (
          <p className={`submit-request__rate-limit ${rateLimitReached ? 'submit-request__rate-limit--exceeded' : ''}`}>
            {rateLimitReached
              ? `⚠️ Daily limit reached (${DAILY_LIMIT}/${DAILY_LIMIT})`
              : `📊 ${todayRequestCount}/${DAILY_LIMIT} requests used today`}
          </p>
        )}
        <button
          className="btn-primary submit-request__submit-btn"
          onClick={handleSubmit}
          disabled={submitting || rateLimitReached || (cart.length === 0 && (!selectedItem || !qtyValidation.valid))}
        >
          {submitting ? 'Submitting...' : cart.length > 0 ? `Submit ${cart.length + (selectedItem && qtyValidation.valid ? 1 : 0)} Request${cart.length + (selectedItem && qtyValidation.valid ? 1 : 0) > 1 ? 's' : ''} →` : 'Submit Request →'}
        </button>
      </div>
    </div>
  );
}
