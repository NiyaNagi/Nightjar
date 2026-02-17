// frontend/src/components/inventory/admin/InventorySettings.jsx
// System settings panel for admins — see spec §3.1 InventorySettings

import React, { useState, useCallback } from 'react';
import { useInventory } from '../../../contexts/InventoryContext';
import { generateId } from '../../../utils/inventoryValidation';
import { assignRequests } from '../../../utils/inventoryAssignment';
import { runAutoAssign } from '../../../utils/autoAssign';
import { SHIPPING_PROVIDERS, getAllProviderIds } from '../../../utils/shippingProviders';
import './InventorySettings.css';

export default function InventorySettings() {
  const ctx = useInventory();
  const { currentSystem, requests, producerCapacities } = ctx;

  const [systemName, setSystemName] = useState(currentSystem?.name || '');
  const [dirty, setDirty] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assignResult, setAssignResult] = useState(null);

  const settings = currentSystem?.settings || {};

  const updateSetting = useCallback((key, value) => {
    if (!ctx.yInventorySystems) return;
    const current = ctx.yInventorySystems.get(ctx.inventorySystemId);
    if (!current) return;

    const updated = {
      ...current,
      settings: { ...current.settings, [key]: value },
      updatedAt: Date.now(),
    };
    ctx.yInventorySystems.set(ctx.inventorySystemId, updated);

    ctx.yInventoryAuditLog?.push([{
      id: generateId(),
      inventorySystemId: ctx.inventorySystemId,
      timestamp: Date.now(),
      actorId: ctx.userIdentity?.publicKeyBase62 || 'unknown',
      actorRole: 'owner',
      action: 'settings_changed',
      targetType: 'settings',
      targetId: ctx.inventorySystemId,
      summary: `Setting "${key}" changed to ${JSON.stringify(value)}`,
    }]);
  }, [ctx]);

  const handleRename = useCallback(() => {
    if (!systemName.trim() || !ctx.yInventorySystems) return;
    const current = ctx.yInventorySystems.get(ctx.inventorySystemId);
    if (!current) return;
    ctx.yInventorySystems.set(ctx.inventorySystemId, {
      ...current,
      name: systemName.trim(),
      updatedAt: Date.now(),
    });
    setDirty(false);
  }, [systemName, ctx]);

  const handleRunAutoAssign = useCallback(async () => {
    setAssigning(true);
    setAssignResult(null);
    try {
      const result = runAutoAssign(ctx);
      setAssignResult(result);
    } catch (err) {
      console.error('[InventorySettings] Auto-assign error:', err);
      setAssignResult({ error: err.message });
    } finally {
      setAssigning(false);
    }
  }, [ctx]);

  return (
    <div className="inventory-settings">
      <h2>Inventory Settings</h2>

      {/* System name */}
      <section className="is-section">
        <h3>System Name</h3>
        <div className="is-name-row">
          <input
            type="text"
            className="is-input"
            value={systemName}
            onChange={e => { setSystemName(e.target.value); setDirty(true); }}
            placeholder="Inventory system name"
          />
          {dirty && (
            <button className="btn-sm btn-primary" onClick={handleRename}>Save</button>
          )}
        </div>
      </section>

      {/* Workflow toggles */}
      <section className="is-section">
        <h3>Workflow</h3>

        <label className="is-toggle">
          <div className="is-toggle-info">
            <span className="is-toggle-title">Require Approval</span>
            <span className="is-toggle-desc">
              Claims and auto-assignments must be approved before address is revealed to producer
            </span>
          </div>
          <input
            type="checkbox"
            checked={settings.requireApproval !== false}
            onChange={e => updateSetting('requireApproval', e.target.checked)}
          />
        </label>

        <label className="is-toggle">
          <div className="is-toggle-info">
            <span className="is-toggle-title">Auto-Assignment</span>
            <span className="is-toggle-desc">
              Automatically run the assignment algorithm when new requests are submitted
            </span>
          </div>
          <input
            type="checkbox"
            checked={settings.autoAssignEnabled !== false}
            onChange={e => updateSetting('autoAssignEnabled', e.target.checked)}
          />
        </label>

        <label className="is-toggle">
          <div className="is-toggle-info">
            <span className="is-toggle-title">Allow Producer Claims</span>
            <span className="is-toggle-desc">
              Producers can browse open requests and claim them directly
            </span>
          </div>
          <input
            type="checkbox"
            checked={settings.allowProducerClaims !== false}
            onChange={e => updateSetting('allowProducerClaims', e.target.checked)}
          />
        </label>

        <label className="is-toggle">
          <div className="is-toggle-info">
            <span className="is-toggle-title">Max Request Quantity Override</span>
            <span className="is-toggle-desc">
              Optional global maximum quantity per request (overrides catalog item max if lower)
            </span>
          </div>
          <input
            type="number"
            className="is-input is-input--sm"
            value={settings.maxRequestQuantity || ''}
            onChange={e => updateSetting('maxRequestQuantity', e.target.value ? Number(e.target.value) : null)}
            placeholder="No limit"
            min={1}
          />
        </label>

        <label className="is-toggle">
          <div className="is-toggle-info">
            <span className="is-toggle-title">Default Urgency</span>
            <span className="is-toggle-desc">
              New requests default to urgent (requestors can still change)
            </span>
          </div>
          <input
            type="checkbox"
            checked={settings.defaultUrgency === true}
            onChange={e => updateSetting('defaultUrgency', e.target.checked)}
          />
        </label>
      </section>

      {/* Manual auto-assign */}
      <section className="is-section">
        <h3>Assignment Algorithm</h3>
        <p className="is-section-desc">
          Runs locally on your device. Matches open requests to producers based on stock, capacity, and urgency.
        </p>
        <button
          className="btn-sm btn-primary"
          onClick={handleRunAutoAssign}
          disabled={assigning}
        >
          {assigning ? 'Running…' : '🔄 Run Auto-Assign Now'}
        </button>

        {assignResult && !assignResult.error && (
          <div className="is-result is-result--success">
            ✅ Assigned {assignResult.applied} of {assignResult.total} open requests
            {assignResult.blocked > 0 && (
              <span className="is-result-blocked">
                {' '}• {assignResult.blocked} blocked (no producer capacity)
              </span>
            )}
          </div>
        )}
        {assignResult?.error && (
          <div className="is-result is-result--error">
            ❌ {assignResult.error}
          </div>
        )}
      </section>

      {/* Shipping Providers */}
      <section className="is-section">
        <h3>Shipping Providers</h3>
        <p className="is-section-desc">
          Choose which shipping providers appear on the address reveal screen. Producers can one-click copy the address and open the provider's label page.
        </p>
        {SHIPPING_PROVIDERS.map(provider => {
          const enabledIds = settings.enabledShippingProviders || getAllProviderIds();
          const isEnabled = enabledIds.includes(provider.id);
          return (
            <label className="is-toggle" key={provider.id}>
              <div className="is-toggle-info">
                <span className="is-toggle-title">{provider.icon} {provider.name}</span>
                <span className="is-toggle-desc">{provider.description}</span>
              </div>
              <input
                type="checkbox"
                checked={isEnabled}
                onChange={e => {
                  const current = settings.enabledShippingProviders || getAllProviderIds();
                  const next = e.target.checked
                    ? [...current, provider.id]
                    : current.filter(id => id !== provider.id);
                  updateSetting('enabledShippingProviders', next);
                }}
              />
            </label>
          );
        })}
      </section>

      {/* Danger zone */}
      <section className="is-section is-section--danger">
        <h3>Danger Zone</h3>
        <p className="is-section-desc">
          These actions are destructive and cannot be undone.
        </p>
        <button className="btn-sm btn-danger" disabled>
          🗑️ Delete Inventory System
        </button>
        <span className="is-coming-soon">Coming soon</span>
      </section>
    </div>
  );
}
