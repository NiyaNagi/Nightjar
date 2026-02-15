/**
 * SavedAddresses
 * 
 * Requestor view for managing saved shipping addresses.
 * Backed by inventorySavedAddresses.js (encrypted local/IndexedDB storage).
 * 
 * See docs/INVENTORY_SYSTEM_SPEC.md §6.8 component hierarchy
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useInventory } from '../../../contexts/InventoryContext';
import { useToast } from '../../../contexts/ToastContext';
import { getSavedAddresses, storeSavedAddress, deleteSavedAddress } from '../../../utils/inventorySavedAddresses';
import { getWorkspaceKeyMaterial } from '../../../utils/inventoryAddressStore';
import { validateAddress, US_STATES } from '../../../utils/inventoryValidation';
import './SavedAddresses.css';

const EMPTY = {
  label: '',
  name: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  zip: '',
  phone: '',
};

export default function SavedAddresses({ currentWorkspace }) {
  const { workspaceId, userIdentity } = useInventory();
  const { showToast } = useToast();

  const [addresses, setAddresses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newAddr, setNewAddr] = useState({ ...EMPTY });
  const [editingId, setEditingId] = useState(null);
  const [editAddr, setEditAddr] = useState(null);

  const loadAddresses = useCallback(async () => {
    try {
      const km = await getWorkspaceKeyMaterial(currentWorkspace, workspaceId);
      if (!km || !userIdentity?.publicKeyBase62) {
        setAddresses([]);
        setLoading(false);
        return;
      }
      const addrs = await getSavedAddresses(km, userIdentity.publicKeyBase62);
      setAddresses(addrs);
    } catch {
      setAddresses([]);
    } finally {
      setLoading(false);
    }
  }, [currentWorkspace, workspaceId, userIdentity]);

  useEffect(() => { loadAddresses(); }, [loadAddresses]);

  const handleAdd = useCallback(async () => {
    const validation = validateAddress(newAddr);
    if (!validation.valid) {
      showToast(validation.errors[0], 'error');
      return;
    }
    if (!newAddr.label.trim()) {
      showToast('Please enter a label for this address', 'error');
      return;
    }
    try {
      const km = await getWorkspaceKeyMaterial(currentWorkspace, workspaceId);
      await storeSavedAddress(km, userIdentity.publicKeyBase62, newAddr);
      showToast('Address saved', 'success');
      setNewAddr({ ...EMPTY });
      setShowAdd(false);
      await loadAddresses();
    } catch (err) {
      showToast('Failed to save address: ' + err.message, 'error');
    }
  }, [newAddr, currentWorkspace, workspaceId, userIdentity, showToast, loadAddresses]);

  const handleDelete = useCallback(async (id) => {
    try {
      await deleteSavedAddress(userIdentity.publicKeyBase62, id);
      showToast('Address deleted', 'success');
      await loadAddresses();
    } catch (err) {
      showToast('Failed to delete: ' + err.message, 'error');
    }
  }, [userIdentity, showToast, loadAddresses]);

  const handleSaveEdit = useCallback(async () => {
    if (!editAddr || !editingId) return;
    const validation = validateAddress(editAddr);
    if (!validation.valid) {
      showToast(validation.errors[0], 'error');
      return;
    }
    try {
      // Delete old, store updated
      await deleteSavedAddress(userIdentity.publicKeyBase62, editingId);
      const km = await getWorkspaceKeyMaterial(currentWorkspace, workspaceId);
      await storeSavedAddress(km, userIdentity.publicKeyBase62, editAddr);
      showToast('Address updated', 'success');
      setEditingId(null);
      setEditAddr(null);
      await loadAddresses();
    } catch (err) {
      showToast('Failed to update: ' + err.message, 'error');
    }
  }, [editAddr, editingId, userIdentity, currentWorkspace, workspaceId, showToast, loadAddresses]);

  if (loading) return <div className="saved-addresses__loading">Loading addresses...</div>;

  return (
    <div className="saved-addresses">
      <div className="saved-addresses__header">
        <h2>Saved Addresses</h2>
        <button className="btn-primary" onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? '✕ Cancel' : '+ Add Address'}
        </button>
      </div>

      {showAdd && (
        <div className="saved-addresses__form">
          <h3>New Address</h3>
          <AddressForm addr={newAddr} onChange={setNewAddr} />
          <div className="saved-addresses__form-actions">
            <button className="btn-primary" onClick={handleAdd}>Save Address</button>
            <button className="btn-secondary" onClick={() => { setShowAdd(false); setNewAddr({ ...EMPTY }); }}>Cancel</button>
          </div>
        </div>
      )}

      {addresses.length === 0 && !showAdd ? (
        <p className="saved-addresses__empty">No saved addresses yet. Add one to speed up request submission.</p>
      ) : (
        <div className="saved-addresses__list">
          {addresses.map(addr => (
            <div key={addr.id} className="saved-address-card">
              {editingId === addr.id ? (
                <div className="saved-address-card__editing">
                  <AddressForm addr={editAddr} onChange={setEditAddr} />
                  <div className="saved-addresses__form-actions">
                    <button className="btn-primary" onClick={handleSaveEdit}>Save</button>
                    <button className="btn-secondary" onClick={() => { setEditingId(null); setEditAddr(null); }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="saved-address-card__header">
                    <strong>{addr.label || 'Address'}</strong>
                    {addr.isDefault && <span className="saved-address-card__default-badge">⭐ Default</span>}
                  </div>
                  <div className="saved-address-card__body">
                    <span>{addr.name}</span>
                    <span>{addr.line1}</span>
                    {addr.line2 && <span>{addr.line2}</span>}
                    <span>{addr.city}, {addr.state} {addr.zip}</span>
                    {addr.phone && <span>📞 {addr.phone}</span>}
                  </div>
                  <div className="saved-address-card__actions">
                    {!addr.isDefault && (
                      <button className="btn-sm" onClick={async () => {
                        try {
                          const km = await getWorkspaceKeyMaterial(currentWorkspace, workspaceId);
                          // Unmark all others, mark this as default
                          for (const a of addresses) {
                            if (a.isDefault) {
                              await deleteSavedAddress(userIdentity.publicKeyBase62, a.id);
                              await storeSavedAddress(km, userIdentity.publicKeyBase62, { ...a, isDefault: false });
                            }
                          }
                          await deleteSavedAddress(userIdentity.publicKeyBase62, addr.id);
                          await storeSavedAddress(km, userIdentity.publicKeyBase62, { ...addr, isDefault: true });
                          showToast('Default address updated', 'success');
                          await loadAddresses();
                        } catch (err) {
                          showToast('Failed to set default: ' + err.message, 'error');
                        }
                      }}>⭐ Set Default</button>
                    )}
                    <button className="btn-sm" onClick={() => { setEditingId(addr.id); setEditAddr({ ...addr }); }}>✏️ Edit</button>
                    <button className="btn-sm btn-sm--danger" onClick={() => handleDelete(addr.id)}>🗑️ Delete</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddressForm({ addr, onChange }) {
  const h = (field, value) => onChange({ ...addr, [field]: value });
  return (
    <div className="address-form">
      <label>
        Label *
        <input type="text" value={addr.label || ''} onChange={e => h('label', e.target.value)} placeholder="e.g., Home" />
      </label>
      <label>
        Full Name *
        <input type="text" value={addr.name} onChange={e => h('name', e.target.value)} placeholder="John Smith" />
      </label>
      <label>
        Address Line 1 *
        <input type="text" value={addr.line1} onChange={e => h('line1', e.target.value)} placeholder="123 Main St" />
      </label>
      <label>
        Address Line 2
        <input type="text" value={addr.line2 || ''} onChange={e => h('line2', e.target.value)} placeholder="Apt 4B" />
      </label>
      <div className="address-form__row">
        <label>
          City *
          <input type="text" value={addr.city} onChange={e => h('city', e.target.value)} placeholder="Nashville" />
        </label>
        <label>
          State *
          <select value={addr.state} onChange={e => h('state', e.target.value)}>
            <option value="">Select</option>
            {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          ZIP *
          <input type="text" value={addr.zip} onChange={e => h('zip', e.target.value)} placeholder="37201" maxLength={10} />
        </label>
      </div>
      <label>
        Phone (optional)
        <input type="text" value={addr.phone || ''} onChange={e => h('phone', e.target.value)} placeholder="(555) 123-4567" />
      </label>
    </div>
  );
}
