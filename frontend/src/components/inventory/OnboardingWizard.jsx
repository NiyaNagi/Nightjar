/**
 * OnboardingWizard
 * 
 * Multi-step wizard shown when an admin first creates an inventory system.
 * Steps: 1) Name & Config  2) Add first catalog item  3) Invite instructions  4) Done
 * 
 * See docs/INVENTORY_SYSTEM_SPEC.md §4.1 (Onboarding Wizard)
 */

import React, { useState, useCallback } from 'react';
import { useInventory } from '../../contexts/InventoryContext';
import { useToast } from '../../contexts/ToastContext';
import { validateCatalogItem, generateId } from '../../utils/inventoryValidation';
import './OnboardingWizard.css';

const STEPS = [
  { id: 1, label: 'Name & Configure' },
  { id: 2, label: 'Define Item Catalog' },
  { id: 3, label: 'Invite Participants' },
  { id: 4, label: 'Import Data (optional)' },
];

export default function OnboardingWizard({ onComplete }) {
  const { yInventorySystems, yCatalogItems, yInventoryAuditLog, inventorySystemId, userIdentity } = useInventory();
  const { showToast } = useToast();

  const [step, setStep] = useState(1);

  // Step 1: system config
  const [systemName, setSystemName] = useState('');
  const [systemIcon, setSystemIcon] = useState('📦');
  const [requireApproval, setRequireApproval] = useState(true);
  const [autoAssign, setAutoAssign] = useState(false);

  // Step 2: first catalog item
  const [firstItem, setFirstItem] = useState({
    name: '',
    unit: 'units',
    quantityMin: 1,
    quantityMax: '',
    quantityStep: 1,
    sku: '',
    category: '',
  });
  const [noMax, setNoMax] = useState(true);

  const handleSaveConfig = useCallback(() => {
    const name = systemName.trim();
    if (!name) {
      showToast('Please enter a name for your inventory system', 'error');
      return;
    }

    // Update system in Yjs
    const existing = yInventorySystems.get(inventorySystemId);
    if (existing) {
      yInventorySystems.set(inventorySystemId, {
        ...existing,
        name,
        icon: systemIcon,
        settings: {
          ...(existing.settings || {}),
          requireApproval,
          autoAssignEnabled: autoAssign,
        },
        updatedAt: Date.now(),
      });
    }

    yInventoryAuditLog.push([{
      id: generateId('aud-'),
      inventorySystemId,
      action: 'system_configured',
      targetId: inventorySystemId,
      targetType: 'system',
      summary: `System configured: "${name}" (approval=${requireApproval}, autoAssign=${autoAssign})`,
      actorId: userIdentity?.publicKeyBase62 || 'unknown',
      actorRole: 'owner',
      timestamp: Date.now(),
    }]);

    setStep(2);
  }, [systemName, requireApproval, autoAssign, yInventorySystems, yInventoryAuditLog, inventorySystemId, showToast, userIdentity, systemIcon]);

  const handleAddFirstItem = useCallback(() => {
    const validation = validateCatalogItem(firstItem);
    if (!validation.valid) {
      showToast(validation.errors[0], 'error');
      return;
    }

    const item = {
      id: generateId('cat-'),
      inventorySystemId,
      name: firstItem.name.trim(),
      unit: firstItem.unit.trim(),
      quantityMin: Number(firstItem.quantityMin),
      quantityMax: noMax ? null : Number(firstItem.quantityMax),
      quantityStep: Number(firstItem.quantityStep),
      sku: firstItem.sku?.trim() || '',
      category: firstItem.category?.trim() || '',
      active: true,
      createdAt: Date.now(),
    };

    yCatalogItems.push([item]);

    yInventoryAuditLog.push([{
      id: generateId('aud-'),
      inventorySystemId,
      action: 'catalog_item_added',
      targetId: item.id,
      targetType: 'catalog_item',
      summary: `Catalog item added: "${item.name}"`,
      actorId: userIdentity?.publicKeyBase62 || 'unknown',
      actorRole: 'owner',
      timestamp: Date.now(),
    }]);

    showToast(`Added "${item.name}" to catalog`, 'success');
    setStep(3);
  }, [firstItem, noMax, yCatalogItems, yInventoryAuditLog, inventorySystemId, showToast, userIdentity]);

  const handleSkipItem = () => setStep(3);

  const handleFinish = useCallback(() => {
    // Mark onboarding complete in system settings
    const existing = yInventorySystems.get(inventorySystemId);
    if (existing) {
      yInventorySystems.set(inventorySystemId, {
        ...existing,
        onboardingComplete: true,
        updatedAt: Date.now(),
      });
    }
    showToast('Inventory system is ready!', 'success');
    onComplete?.();
  }, [yInventorySystems, inventorySystemId, showToast, onComplete]);

  return (
    <div className="onboarding-wizard">
      <div className="onboarding-wizard__progress">
        {STEPS.map(s => (
          <div
            key={s.id}
            className={`onboarding-step-indicator ${step === s.id ? 'active' : ''} ${step > s.id ? 'completed' : ''}`}
          >
            <div className="onboarding-step-indicator__dot">
              {step > s.id ? '✓' : s.id}
            </div>
            <span className="onboarding-step-indicator__label">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="onboarding-wizard__content">
        {step === 1 && (
          <div className="onboarding-wizard__step">
            <h2>Name & Configure</h2>
            <p className="onboarding-wizard__hint">Give your inventory system a name and configure basic settings.</p>

            <label>
              System Name *
              <input
                type="text"
                value={systemName}
                onChange={e => setSystemName(e.target.value)}
                placeholder="e.g., Toy Distribution"
                autoFocus
              />
            </label>

            <div className="onboarding-wizard__icon-picker">
              <label>Choose Icon</label>
              <div className="onboarding-icon-grid">
                {['📦', '🏭', '🧸', '🔧', '📋', '🎁', '🛒', '⚙️'].map(icon => (
                  <button
                    key={icon}
                    type="button"
                    className={`onboarding-icon-btn ${systemIcon === icon ? 'active' : ''}`}
                    onClick={() => setSystemIcon(icon)}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>

            <div className="onboarding-wizard__toggle-group">
              <label className="onboarding-toggle">
                <input
                  type="checkbox"
                  checked={requireApproval}
                  onChange={e => setRequireApproval(e.target.checked)}
                />
                <div className="onboarding-toggle__info">
                  <strong>Require Admin Approval</strong>
                  <span>Assigned or claimed requests must be approved before the producer sees the shipping address.</span>
                </div>
              </label>

              <label className="onboarding-toggle">
                <input
                  type="checkbox"
                  checked={autoAssign}
                  onChange={e => setAutoAssign(e.target.checked)}
                />
                <div className="onboarding-toggle__info">
                  <strong>Enable Auto-Assignment</strong>
                  <span>Automatically assign requests to producers based on capacity and stock levels.</span>
                </div>
              </label>
            </div>

            <div className="onboarding-wizard__actions">
              <button className="btn-primary" onClick={handleSaveConfig}>Next →</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="onboarding-wizard__step">
            <h2>Add Your First Catalog Item</h2>
            <p className="onboarding-wizard__hint">
              Define at least one item that requestors can order. You can add more items later in the Item Catalog.
            </p>

            <div className="onboarding-wizard__item-form">
              <div className="catalog-form__row">
                <label>
                  Name *
                  <input
                    type="text"
                    value={firstItem.name}
                    onChange={e => setFirstItem({ ...firstItem, name: e.target.value })}
                    placeholder="e.g., Rubber Duck"
                  />
                </label>
                <label>
                  Unit *
                  <input
                    type="text"
                    value={firstItem.unit}
                    onChange={e => setFirstItem({ ...firstItem, unit: e.target.value })}
                    placeholder="e.g., units, boxes"
                  />
                </label>
              </div>
              <div className="catalog-form__row">
                <label>
                  Min qty
                  <input
                    type="number"
                    value={firstItem.quantityMin}
                    onChange={e => setFirstItem({ ...firstItem, quantityMin: e.target.value })}
                    min="1"
                  />
                </label>
                <label>
                  Max qty
                  <input
                    type="number"
                    value={noMax ? '' : firstItem.quantityMax}
                    onChange={e => setFirstItem({ ...firstItem, quantityMax: e.target.value })}
                    min="1"
                    disabled={noMax}
                    placeholder={noMax ? '∞' : ''}
                  />
                  <label className="catalog-form__no-max">
                    <input
                      type="checkbox"
                      checked={noMax}
                      onChange={e => setNoMax(e.target.checked)}
                    />
                    No max
                  </label>
                </label>
                <label>
                  Step
                  <input
                    type="number"
                    value={firstItem.quantityStep}
                    onChange={e => setFirstItem({ ...firstItem, quantityStep: e.target.value })}
                    min="1"
                  />
                </label>
              </div>
              <div className="catalog-form__row">
                <label>
                  SKU (optional)
                  <input
                    type="text"
                    value={firstItem.sku}
                    onChange={e => setFirstItem({ ...firstItem, sku: e.target.value })}
                    placeholder="e.g., TOY-001"
                  />
                </label>
                <label>
                  Category (optional)
                  <input
                    type="text"
                    value={firstItem.category}
                    onChange={e => setFirstItem({ ...firstItem, category: e.target.value })}
                    placeholder="e.g., Toys"
                  />
                </label>
              </div>
            </div>

            <div className="onboarding-wizard__actions">
              <button className="btn-secondary" onClick={handleSkipItem}>Skip for now</button>
              <button className="btn-primary" onClick={handleAddFirstItem}>Add & Continue →</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="onboarding-wizard__step">
            <h2>Invite Participants</h2>
            <p className="onboarding-wizard__hint">
              Share your workspace with others to start receiving and fulfilling requests.
            </p>

            <div className="onboarding-wizard__invite-info">
              <div className="onboarding-invite-card">
                <h3>👥 Producers (Editors)</h3>
                <p>Producers can browse open requests, claim them, and ship items. Invite them with <strong>Editor</strong> access to the workspace.</p>
              </div>
              <div className="onboarding-invite-card">
                <h3>📝 Requestors (Viewers)</h3>
                <p>Requestors can submit requests for catalog items and track their status. Invite them with <strong>Viewer</strong> access.</p>
              </div>
            </div>

            <p className="onboarding-wizard__note">
              💡 Use the workspace share link (in the sidebar) to invite people. Their role (Editor/Viewer) determines their inventory role.
            </p>

            <div className="onboarding-wizard__actions">
              <button className="btn-primary" onClick={() => setStep(4)}>Next →</button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="onboarding-wizard__step">
            <h2>Import Existing Data (Optional)</h2>
            <p className="onboarding-wizard__hint">
              If you have existing request or catalog data, you can import it later from the Import/Export view.
              Supported formats: CSV and XLSX.
            </p>

            <div className="onboarding-wizard__import-info">
              <p>💡 You can always import data later from the <strong>Import / Export</strong> section in the navigation.</p>
            </div>

            <div className="onboarding-wizard__done-icon">🎉</div>
            <p className="onboarding-wizard__hint">
              Your inventory system is ready! You can manage items in the Item Catalog,
              run auto-assignment, and review requests from the Admin Dashboard.
            </p>
            <div className="onboarding-wizard__actions">
              <button className="btn-primary" onClick={handleFinish}>Open Dashboard →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
