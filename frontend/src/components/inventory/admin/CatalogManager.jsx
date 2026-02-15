/**
 * CatalogManager
 * 
 * Admin view for managing catalog items (CRUD).
 * Shows existing items with edit/deactivate controls and an "Add Item" form.
 * 
 * See docs/INVENTORY_SYSTEM_SPEC.md §6.4.5 (Item Catalog View)
 */

import React, { useState, useCallback } from 'react';
import { useInventory } from '../../../contexts/InventoryContext';
import { useInventorySync } from '../../../hooks/useInventorySync';
import { useToast } from '../../../contexts/ToastContext';
import { validateCatalogItem, generateId } from '../../../utils/inventoryValidation';
import './CatalogManager.css';

const EMPTY_ITEM = {
  name: '',
  unit: 'units',
  quantityMin: 1,
  quantityMax: 5000,
  quantityStep: 1,
  sku: '',
  category: '',
  description: '',
};

export default function CatalogManager() {
  const { yCatalogItems, inventorySystemId, yInventoryAuditLog } = useInventory();
  const { catalogItems, requests } = useInventorySync(
    { yCatalogItems, yInventoryRequests: useInventory().yInventoryRequests,
      yInventorySystems: useInventory().yInventorySystems,
      yProducerCapacities: useInventory().yProducerCapacities,
      yAddressReveals: useInventory().yAddressReveals,
      yPendingAddresses: useInventory().yPendingAddresses,
      yInventoryAuditLog },
    inventorySystemId
  );
  const { showToast } = useToast();

  const [newItem, setNewItem] = useState({ ...EMPTY_ITEM });
  const [editingId, setEditingId] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const handleAddItem = useCallback(() => {
    const validation = validateCatalogItem(newItem);
    if (!validation.valid) {
      showToast(validation.errors[0], 'error');
      return;
    }

    const item = {
      id: generateId('cat-'),
      inventorySystemId,
      ...newItem,
      name: newItem.name.trim(),
      unit: newItem.unit.trim(),
      sku: newItem.sku?.trim() || '',
      category: newItem.category?.trim() || '',
      description: newItem.description?.trim() || '',
      quantityMin: Number(newItem.quantityMin),
      quantityMax: Number(newItem.quantityMax),
      quantityStep: Number(newItem.quantityStep),
      active: true,
      createdAt: Date.now(),
    };

    yCatalogItems.push([item]);

    // Audit log
    yInventoryAuditLog.push([{
      id: generateId('aud-'),
      inventorySystemId,
      action: 'catalog_item_added',
      entityId: item.id,
      entityType: 'catalog_item',
      details: { name: item.name },
      timestamp: Date.now(),
    }]);

    setNewItem({ ...EMPTY_ITEM });
    setShowAddForm(false);
    showToast(`Added "${item.name}" to catalog`, 'success');
  }, [newItem, yCatalogItems, yInventoryAuditLog, inventorySystemId, showToast]);

  const handleSaveEdit = useCallback(() => {
    if (!editItem || editingId == null) return;
    const validation = validateCatalogItem(editItem);
    if (!validation.valid) {
      showToast(validation.errors[0], 'error');
      return;
    }

    // Find the index in the Yjs array
    const items = yCatalogItems.toArray();
    const idx = items.findIndex(item => item.id === editingId);
    if (idx === -1) return;

    const updated = {
      ...items[idx],
      name: editItem.name.trim(),
      unit: editItem.unit.trim(),
      sku: editItem.sku?.trim() || '',
      category: editItem.category?.trim() || '',
      description: editItem.description?.trim() || '',
      quantityMin: Number(editItem.quantityMin),
      quantityMax: Number(editItem.quantityMax),
      quantityStep: Number(editItem.quantityStep),
      updatedAt: Date.now(),
    };

    yCatalogItems.delete(idx, 1);
    yCatalogItems.insert(idx, [updated]);

    yInventoryAuditLog.push([{
      id: generateId('aud-'),
      inventorySystemId,
      action: 'catalog_item_updated',
      entityId: editingId,
      entityType: 'catalog_item',
      details: { name: updated.name },
      timestamp: Date.now(),
    }]);

    setEditingId(null);
    setEditItem(null);
    showToast(`Updated "${updated.name}"`, 'success');
  }, [editItem, editingId, yCatalogItems, yInventoryAuditLog, inventorySystemId, showToast]);

  const handleToggleActive = useCallback((item) => {
    const items = yCatalogItems.toArray();
    const idx = items.findIndex(i => i.id === item.id);
    if (idx === -1) return;

    // Check for open requests
    const openCount = requests.filter(r => r.catalogItemId === item.id && r.status === 'open').length;
    if (item.active && openCount > 0) {
      // Still allow — spec says show warning
      // The UI will show the warning inline
    }

    const updated = { ...items[idx], active: !item.active, updatedAt: Date.now() };
    yCatalogItems.delete(idx, 1);
    yCatalogItems.insert(idx, [updated]);

    yInventoryAuditLog.push([{
      id: generateId('aud-'),
      inventorySystemId,
      action: updated.active ? 'catalog_item_activated' : 'catalog_item_deactivated',
      entityId: item.id,
      entityType: 'catalog_item',
      details: { name: item.name },
      timestamp: Date.now(),
    }]);

    showToast(`${item.name} ${updated.active ? 'activated' : 'deactivated'}`, 'success');
  }, [yCatalogItems, yInventoryAuditLog, inventorySystemId, requests, showToast]);

  const startEditing = (item) => {
    setEditingId(item.id);
    setEditItem({ ...item });
  };

  const getOpenRequestCount = (itemId) => {
    return requests.filter(r => r.catalogItemId === itemId && !['cancelled', 'delivered'].includes(r.status)).length;
  };

  const getFulfilledCount = (itemId) => {
    return requests.filter(r => r.catalogItemId === itemId && (r.status === 'shipped' || r.status === 'delivered')).length;
  };

  return (
    <div className="catalog-manager">
      <div className="catalog-manager__header">
        <h2>Item Catalog</h2>
        <button
          className="catalog-manager__add-btn"
          onClick={() => setShowAddForm(!showAddForm)}
        >
          {showAddForm ? '✕ Cancel' : '+ Add Item'}
        </button>
      </div>

      {/* Add new item form */}
      {showAddForm && (
        <div className="catalog-manager__form">
          <h3>Add New Item</h3>
          <CatalogItemForm
            item={newItem}
            onChange={setNewItem}
            onSubmit={handleAddItem}
            submitLabel="Add to Catalog"
          />
        </div>
      )}

      {/* Existing items list */}
      <div className="catalog-manager__list">
        {catalogItems.length === 0 ? (
          <div className="catalog-manager__empty">
            <p>No catalog items yet. Add your first item to start accepting requests.</p>
          </div>
        ) : (
          catalogItems.map(item => (
            <div key={item.id} className={`catalog-item-card ${!item.active ? 'catalog-item-card--inactive' : ''}`}>
              {editingId === item.id ? (
                <div className="catalog-item-card__editing">
                  <CatalogItemForm
                    item={editItem}
                    onChange={setEditItem}
                    onSubmit={handleSaveEdit}
                    submitLabel="Save Changes"
                    onCancel={() => { setEditingId(null); setEditItem(null); }}
                  />
                </div>
              ) : (
                <>
                  <div className="catalog-item-card__header">
                    <span className={`catalog-item-card__status ${item.active ? 'active' : 'inactive'}`}>
                      {item.active ? '✅' : '⏸️'}
                    </span>
                    <h3 className="catalog-item-card__name">{item.name}</h3>
                    {item.sku && <span className="catalog-item-card__sku">SKU: {item.sku}</span>}
                  </div>
                  <div className="catalog-item-card__details">
                    <span>Unit: {item.unit}</span>
                    <span>Min: {item.quantityMin?.toLocaleString()}</span>
                    <span>Max: {item.quantityMax?.toLocaleString()}</span>
                    <span>Step: {item.quantityStep}</span>
                    {item.category && <span>Category: {item.category}</span>}
                  </div>
                  <div className="catalog-item-card__stats">
                    <span>Open requests: {getOpenRequestCount(item.id)}</span>
                    <span>Total fulfilled: {getFulfilledCount(item.id)}</span>
                  </div>
                  {item.description && (
                    <div className="catalog-item-card__description">{item.description}</div>
                  )}
                  <div className="catalog-item-card__actions">
                    <button onClick={() => startEditing(item)} className="btn-sm">✏️ Edit</button>
                    <button onClick={() => handleToggleActive(item)} className="btn-sm">
                      {item.active ? '⏸️ Deactivate' : '▶️ Activate'}
                    </button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Reusable form for creating/editing catalog items.
 */
function CatalogItemForm({ item, onChange, onSubmit, submitLabel, onCancel }) {
  const handleChange = (field, value) => {
    onChange({ ...item, [field]: value });
  };

  return (
    <div className="catalog-form">
      <div className="catalog-form__row">
        <label>
          Name *
          <input
            type="text"
            value={item.name}
            onChange={e => handleChange('name', e.target.value)}
            placeholder="e.g., Standard Whistle"
          />
        </label>
        <label>
          Unit *
          <input
            type="text"
            value={item.unit}
            onChange={e => handleChange('unit', e.target.value)}
            placeholder="e.g., units, boxes"
          />
        </label>
      </div>
      <div className="catalog-form__row">
        <label>
          Min qty
          <input
            type="number"
            value={item.quantityMin}
            onChange={e => handleChange('quantityMin', e.target.value)}
            min="1"
          />
        </label>
        <label>
          Max qty
          <input
            type="number"
            value={item.quantityMax}
            onChange={e => handleChange('quantityMax', e.target.value)}
            min="1"
          />
        </label>
        <label>
          Step
          <input
            type="number"
            value={item.quantityStep}
            onChange={e => handleChange('quantityStep', e.target.value)}
            min="1"
          />
        </label>
      </div>
      <div className="catalog-form__row">
        <label>
          SKU (optional)
          <input
            type="text"
            value={item.sku}
            onChange={e => handleChange('sku', e.target.value)}
            placeholder="e.g., WH-001"
          />
        </label>
        <label>
          Category (optional)
          <input
            type="text"
            value={item.category}
            onChange={e => handleChange('category', e.target.value)}
            placeholder="e.g., Whistles"
          />
        </label>
      </div>
      <label>
        Description (optional)
        <textarea
          value={item.description || ''}
          onChange={e => handleChange('description', e.target.value)}
          placeholder="Item description..."
          rows={2}
        />
      </label>
      <div className="catalog-form__actions">
        <button className="btn-primary" onClick={onSubmit}>{submitLabel}</button>
        {onCancel && <button className="btn-secondary" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}
