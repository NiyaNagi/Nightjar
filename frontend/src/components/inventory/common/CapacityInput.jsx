// frontend/src/components/inventory/common/CapacityInput.jsx
// Editable stock / rate input for a single catalog item — used by ProducerDashboard

import React, { useState, useCallback } from 'react';
import './CapacityInput.css';

/**
 * @param {{ item: Object, capacity: Object|null, onSave: (itemId, { currentStock, capacityPerDay }) => void }} props
 */
export default function CapacityInput({ item, capacity, onSave }) {
  const [stock, setStock] = useState(capacity?.currentStock ?? 0);
  const [rate, setRate] = useState(capacity?.capacityPerDay ?? 0);
  const [dirty, setDirty] = useState(false);

  const handleSave = useCallback(() => {
    onSave?.(item.id, {
      currentStock: Math.max(0, parseInt(stock, 10) || 0),
      capacityPerDay: Math.max(0, parseInt(rate, 10) || 0),
    });
    setDirty(false);
  }, [item.id, stock, rate, onSave]);

  // Compute availability info
  const backlog = capacity?.backlog || 0;
  const availableNow = (parseInt(stock, 10) || 0) - backlog;
  const daysToBacklog =
    parseInt(rate, 10) > 0 && backlog > 0
      ? Math.ceil(backlog / parseInt(rate, 10))
      : 0;

  return (
    <div className="capacity-input">
      <div className="ci-header">
        <span className="ci-name">{item.name}</span>
        {item.sku && <span className="ci-sku">{item.sku}</span>}
      </div>

      <div className="ci-fields">
        <label className="ci-field">
          <span className="ci-label">Stock</span>
          <div className="ci-input-row">
            <input
              type="number"
              min={0}
              value={stock}
              onChange={e => { setStock(e.target.value); setDirty(true); }}
              className="ci-input"
            />
            <span className="ci-unit">{item.unitName || 'units'}</span>
          </div>
        </label>

        <label className="ci-field">
          <span className="ci-label">Rate</span>
          <div className="ci-input-row">
            <input
              type="number"
              min={0}
              value={rate}
              onChange={e => { setRate(e.target.value); setDirty(true); }}
              className="ci-input"
            />
            <span className="ci-unit">/ day</span>
          </div>
        </label>
      </div>

      <div className="ci-meta">
        <span>Available: {availableNow > 0 ? 'Now' : daysToBacklog > 0 ? `~${daysToBacklog}d` : '—'}</span>
        {backlog > 0 && <span>Backlog: {backlog} {item.unitName || 'units'}</span>}
      </div>

      {dirty && (
        <button className="ci-save" onClick={handleSave}>💾 Save Changes</button>
      )}
    </div>
  );
}
