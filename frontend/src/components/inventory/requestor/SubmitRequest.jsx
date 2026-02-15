/**
 * SubmitRequest
 * 
 * Requestor (Viewer) or Admin view for submitting a new inventory request.
 * Select catalog item, set quantity, choose/enter address, set urgency, submit.
 * 
 * See docs/INVENTORY_SYSTEM_SPEC.md §6.6.1 (Submit Request View)
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useInventory } from '../../../contexts/InventoryContext';
import { useInventorySync } from '../../../hooks/useInventorySync';
import { useToast } from '../../../contexts/ToastContext';
import { validateQuantity, validateAddress, generateId, US_STATES } from '../../../utils/inventoryValidation';
import { getSavedAddresses, storeSavedAddress } from '../../../utils/inventorySavedAddresses';
import { storeAddress, getWorkspaceKeyMaterial } from '../../../utils/inventoryAddressStore';
import { encryptAddressForAdmins, getPublicKeyHex } from '../../../utils/addressCrypto';
import './SubmitRequest.css';

const EMPTY_ADDRESS = {
  name: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  zip: '',
  phone: '',
};

export default function SubmitRequest({ currentWorkspace, isOwner }) {
  const ctx = useInventory();
  const { yInventoryRequests, yInventoryAuditLog, yPendingAddresses,
    inventorySystemId, workspaceId, userIdentity, collaborators } = ctx;
  const { catalogItems } = useInventorySync(
    { yCatalogItems: ctx.yCatalogItems, yInventoryRequests, yInventorySystems: ctx.yInventorySystems,
      yProducerCapacities: ctx.yProducerCapacities, yAddressReveals: ctx.yAddressReveals,
      yPendingAddresses, yInventoryAuditLog },
    inventorySystemId
  );
  const { showToast } = useToast();

  // Active catalog items only
  const activeItems = catalogItems.filter(i => i.active);

  // Form state
  const [selectedItemId, setSelectedItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [notes, setNotes] = useState('');

  // Address state
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const [showNewAddress, setShowNewAddress] = useState(false);
  const [newAddress, setNewAddress] = useState({ ...EMPTY_ADDRESS });
  const [saveNewAddress, setSaveNewAddress] = useState(false);
  const [newAddressLabel, setNewAddressLabel] = useState('');

  const [submitting, setSubmitting] = useState(false);

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

  const handleSubmit = useCallback(async () => {
    if (submitting) return;

    // Validate item
    if (!selectedItem) {
      showToast('Please select a catalog item', 'error');
      return;
    }

    // Validate quantity
    if (!qtyValidation.valid) {
      showToast(qtyValidation.error, 'error');
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
      const requestId = generateId('req-');
      const now = Date.now();

      // Address encryption path depends on role (spec §7.2.6)
      const km = await getWorkspaceKeyMaterial(currentWorkspace, workspaceId);

      if (isOwner) {
        // Admin: store address locally with symmetric encryption
        if (km) {
          await storeAddress(km, inventorySystemId, requestId, address);
        }
      } else {
        // Requestor: encrypt address to each admin's public key via nacl.box
        // and write to yPendingAddresses for admin pickup
        const admins = (collaborators || []).filter(
          c => c.permission === 'owner' || c.permission === 'admin'
        );
        if (admins.length > 0 && userIdentity?.privateKey) {
          const senderPubHex = getPublicKeyHex(userIdentity);
          const entries = await encryptAddressForAdmins(
            address, admins, userIdentity.privateKey, senderPubHex
          );
          yPendingAddresses.set(requestId, entries);
        }
      }

      // Save new address if requested
      if (showNewAddress && saveNewAddress && newAddressLabel.trim() && km) {
        await storeSavedAddress(km, userIdentity.publicKeyBase62, {
          label: newAddressLabel.trim(),
          ...newAddress,
        });
        // Refresh saved list
        const refreshed = await getSavedAddresses(km, userIdentity.publicKeyBase62);
        setSavedAddresses(refreshed);
      }

      // Create request in Yjs (city/state only — no full address in CRDT)
      const request = {
        id: requestId,
        inventorySystemId,
        catalogItemId: selectedItem.id,
        catalogItemName: selectedItem.name,
        quantity: qtyNum,
        unit: selectedItem.unit,
        city: address.city,
        state: address.state,
        urgent,
        notes: notes.trim(),
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
        entityId: requestId,
        entityType: 'request',
        details: { item: selectedItem.name, quantity: qtyNum, city: address.city, state: address.state },
        timestamp: now,
      }]);

      showToast(`Request #${requestId.slice(4, 10)} submitted!`, 'success');

      // Reset form
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
    inventorySystemId, userIdentity, yInventoryRequests, yInventoryAuditLog, showToast]);

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
                    {item.quantityMin?.toLocaleString()} – {item.quantityMax?.toLocaleString()} {item.unit}
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
              placeholder={`${selectedItem.quantityMin} – ${selectedItem.quantityMax}`}
              min={selectedItem.quantityMin}
              max={selectedItem.quantityMax}
              step={selectedItem.quantityStep}
            />
            <span className="submit-request__unit">{selectedItem.unit}</span>
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
            <div className="submit-request__field-row two-col">
              <label>
                City *
                <input type="text" value={newAddress.city}
                  onChange={e => setNewAddress({ ...newAddress, city: e.target.value })}
                  placeholder="Nashville" />
              </label>
              <label>
                State *
                <select value={newAddress.state}
                  onChange={e => setNewAddress({ ...newAddress, state: e.target.value })}>
                  <option value="">Select state</option>
                  {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            </div>
            <div className="submit-request__field-row two-col">
              <label>
                ZIP *
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
        <p className="submit-request__privacy">
          🔒 Your full address is encrypted and only visible to workspace admins.
          Producers see only your city and state.
        </p>
        <button
          className="btn-primary submit-request__submit-btn"
          onClick={handleSubmit}
          disabled={submitting || !selectedItem || !qtyValidation.valid}
        >
          {submitting ? 'Submitting...' : 'Submit Request →'}
        </button>
      </div>
    </div>
  );
}
