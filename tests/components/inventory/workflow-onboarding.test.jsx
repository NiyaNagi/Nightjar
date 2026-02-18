/**
 * tests/components/inventory/workflow-onboarding.test.jsx
 *
 * End-to-end workflow tests for:
 *   - Onboarding wizard (4-step flow)
 *   - Catalog management CRUD lifecycle
 *   - Settings & configuration
 *   - Navigation & role-gating
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import {
  createMockYMap,
  createMockYArray,
  createTestRequest,
  createTestCatalogItem,
  createTestCapacity,
  createTestIdentity,
  resetIdCounter,
} from '../../helpers/inventory-test-utils';

// ── Mocks ──────────────────────────────────────────────────────────────────

let mockCtx;
let mockSyncResult;
let mockShowToast;
let mockUsePermission;

jest.mock('../../../frontend/src/contexts/InventoryContext', () => ({
  InventoryProvider: ({ children }) => <div>{children}</div>,
  useInventory: jest.fn(() => ({ ...mockCtx, ...mockSyncResult })),
}));

jest.mock('../../../frontend/src/contexts/ToastContext', () => ({
  useToast: jest.fn(() => ({ showToast: mockShowToast })),
}));

jest.mock('../../../frontend/src/hooks/useInventorySync', () => {
  const fn = jest.fn(() => mockSyncResult);
  fn.default = fn;
  return { __esModule: true, default: fn, useInventorySync: fn };
});

jest.mock('../../../frontend/src/hooks/usePermission', () => ({
  usePermission: jest.fn(() => mockUsePermission),
}));

jest.mock('../../../frontend/src/utils/inventoryValidation', () => ({
  ...jest.requireActual('../../../frontend/src/utils/inventoryValidation'),
  generateId: jest.fn(() => 'mock-id-' + Math.random().toString(36).slice(2, 8)),
}));

jest.mock('../../../frontend/src/utils/inventoryAssignment', () => ({
  assignRequests: jest.fn(() => []),
  estimateFulfillment: jest.fn(() => null),
  validateClaim: jest.fn(() => ({ ok: true })),
}));

jest.mock('../../../frontend/src/utils/inventoryExport', () => ({
  exportRequests: jest.fn(),
  exportAuditLog: jest.fn(),
}));

jest.mock('../../../frontend/src/utils/addressCrypto', () => ({
  getPublicKeyHex: jest.fn(() => 'admin-hex'),
  base62ToPublicKeyHex: jest.fn(() => 'producer-hex'),
  createAddressReveal: jest.fn(() => Promise.resolve({ encrypted: 'data' })),
}));

jest.mock('../../../frontend/src/utils/inventoryAddressStore', () => ({
  getAddress: jest.fn(() => Promise.resolve(null)),
}));

// Recharts
jest.mock('recharts', () => {
  const make = (name) => (props) => <div data-testid={name}>{props.children}</div>;
  return {
    ResponsiveContainer: ({ children }) => <div>{typeof children === 'function' ? children(400, 200) : children}</div>,
    LineChart: make('line-chart'),
    ComposedChart: make('composed-chart'),
    BarChart: make('bar-chart'),
    Line: make('line'),
    Area: make('area'),
    Bar: make('bar'),
    XAxis: make('x-axis'),
    YAxis: make('y-axis'),
    CartesianGrid: make('cartesian-grid'),
    Tooltip: make('tooltip'),
    Legend: make('legend'),
    ReferenceLine: make('reference-line'),
  };
});

// CSS mocks
jest.mock('../../../frontend/src/components/inventory/OnboardingWizard.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/InventoryDashboard.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/InventoryNavRail.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/admin/CatalogManager.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/admin/InventorySettings.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/admin/AdminDashboard.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/admin/AllRequests.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/admin/ApprovalQueue.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/admin/AuditLog.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/admin/ProducerManagement.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/producer/ProducerDashboard.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/producer/OpenRequests.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/producer/ProducerMyRequests.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/producer/ProducerStats.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/producer/AddressReveal.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/requestor/MyRequests.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/requestor/SubmitRequest.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/requestor/RequestFAQ.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/requestor/SavedAddresses.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/common/StatusBadge.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/common/RequestCard.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/common/CapacityInput.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/common/RequestDetail.css', () => ({}));

// ── Component imports (after mocks) ───────────────────────────────────────

const OnboardingWizard = require('../../../frontend/src/components/inventory/OnboardingWizard').default;
const CatalogManager = require('../../../frontend/src/components/inventory/admin/CatalogManager').default;
const InventorySettings = require('../../../frontend/src/components/inventory/admin/InventorySettings').default;
const InventoryNavRail = require('../../../frontend/src/components/inventory/InventoryNavRail').default;

// ── Shared test data ──────────────────────────────────────────────────────

const ADMIN_IDENTITY = {
  publicKeyBase62: 'adminKey123',
  displayName: 'Admin Alice',
  name: 'Admin Alice',
  curveSecretKey: new Uint8Array(32),
};

// ── Shared Yjs mock instances ─────────────────────────────────────────────

let yRequests, yAudit, ySystems, yCatalog, yCapacities, yReveals, yPending;

function buildSharedYjs(systemOverride = {}) {
  ySystems = createMockYMap({
    'sys-1': { name: '', onboardingComplete: false, settings: {}, ...systemOverride },
  });
  yCatalog = createMockYArray([]);
  yRequests = createMockYArray([]);
  yCapacities = createMockYMap({});
  yReveals = createMockYMap({});
  yPending = createMockYMap({});
  yAudit = createMockYArray([]);
  yRequests.doc = { transact: jest.fn((fn) => fn()) };
}

function setContext(identity) {
  mockCtx = {
    yInventoryRequests: yRequests,
    yInventoryAuditLog: yAudit,
    yInventorySystems: ySystems,
    yCatalogItems: yCatalog,
    yProducerCapacities: yCapacities,
    yAddressReveals: yReveals,
    yPendingAddresses: yPending,
    inventorySystemId: 'sys-1',
    workspaceId: 'ws-1',
    userIdentity: identity,
    collaborators: [
      { publicKey: 'adminKey123', publicKeyBase62: 'adminKey123', name: 'Admin Alice', displayName: 'Admin Alice', permission: 'owner' },
    ],
  };
}

function refreshSync() {
  mockSyncResult = {
    currentSystem: ySystems.get('sys-1'),
    inventorySystems: [ySystems.get('sys-1')],
    catalogItems: yCatalog.toArray(),
    requests: yRequests.toArray(),
    producerCapacities: yCapacities.toJSON(),
    addressReveals: yReveals.toJSON(),
    pendingAddresses: yPending.toJSON(),
    auditLog: yAudit.toArray(),
    openRequestCount: yRequests.toArray().filter(r => r.status === 'open').length,
    pendingApprovalCount: 0,
    activeRequestCount: 0,
    allRequests: yRequests.toArray(),
  };
}

// ── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockShowToast = jest.fn();
  mockUsePermission = { isOwner: true, isEditor: false, isViewer: false };
  resetIdCounter();
  buildSharedYjs();
  setContext(ADMIN_IDENTITY);
  refreshSync();
});

// ═══════════════════════════════════════════════════════════════════════════
//  1. ONBOARDING WIZARD WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════

describe('Onboarding Wizard Workflow', () => {
  test('Step 1: configure system name and advance', () => {
    render(<OnboardingWizard onComplete={jest.fn()} />);

    // Step 1 visible
    expect(screen.getByRole('heading', { name: 'Name & Configure' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g., Toy Distribution')).toBeInTheDocument();

    // Enter name
    const nameInput = screen.getByPlaceholderText('e.g., Toy Distribution');
    fireEvent.change(nameInput, { target: { value: 'My Inventory' } });

    // Click Next
    fireEvent.click(screen.getByText(/Next/));

    // System should be updated in Yjs
    const updated = ySystems.get('sys-1');
    expect(updated.name).toBe('My Inventory');

    // Should advance to step 2
    expect(screen.getByText('Add Your First Catalog Item')).toBeInTheDocument();
  });

  test('Step 1: shows error when name is empty', () => {
    render(<OnboardingWizard onComplete={jest.fn()} />);

    fireEvent.click(screen.getByText(/Next/));

    expect(mockShowToast).toHaveBeenCalledWith(
      expect.stringContaining('name'),
      'error'
    );
  });

  test('Step 1: toggles requireApproval and autoAssign settings', () => {
    render(<OnboardingWizard onComplete={jest.fn()} />);

    // Find checkboxes
    const checkboxes = screen.getAllByRole('checkbox');
    // First checkbox is requireApproval (checked by default)
    // Second is autoAssign (unchecked by default)

    // Toggle autoAssign on
    fireEvent.click(checkboxes[1]);

    // Enter name and advance
    fireEvent.change(screen.getByPlaceholderText('e.g., Toy Distribution'), { target: { value: 'Test' } });
    fireEvent.click(screen.getByText(/Next/));

    const updated = ySystems.get('sys-1');
    expect(updated.settings.requireApproval).toBe(true);
    expect(updated.settings.autoAssignEnabled).toBe(true);
  });

  test('Step 2: add first catalog item and advance', () => {
    render(<OnboardingWizard onComplete={jest.fn()} />);

    // Complete step 1
    fireEvent.change(screen.getByPlaceholderText('e.g., Toy Distribution'), { target: { value: 'Test System' } });
    fireEvent.click(screen.getByText(/Next/));

    // Now on step 2
    expect(screen.getByText('Add Your First Catalog Item')).toBeInTheDocument();

    // Fill in item name
    const nameInput = screen.getByPlaceholderText('e.g., Rubber Duck');
    fireEvent.change(nameInput, { target: { value: 'Widgets' } });

    // Click add
    fireEvent.click(screen.getByText(/Add & Continue/));

    // Catalog item should be added
    expect(yCatalog.toArray().length).toBe(1);
    expect(yCatalog.toArray()[0].name).toBe('Widgets');

    // Should advance to step 3
    expect(screen.getByRole('heading', { name: 'Invite Participants' })).toBeInTheDocument();
  });

  test('Step 2: skip adds no catalog item', () => {
    render(<OnboardingWizard onComplete={jest.fn()} />);

    // Complete step 1
    fireEvent.change(screen.getByPlaceholderText('e.g., Toy Distribution'), { target: { value: 'Test' } });
    fireEvent.click(screen.getByText(/Next/));

    // Skip item
    fireEvent.click(screen.getByText(/Skip for now/));

    // No item added
    expect(yCatalog.toArray().length).toBe(0);

    // Should be on step 3
    expect(screen.getByRole('heading', { name: 'Invite Participants' })).toBeInTheDocument();
  });

  test('Step 3 → Step 4: invite info then finish', () => {
    const onComplete = jest.fn();
    render(<OnboardingWizard onComplete={onComplete} />);

    // Step 1
    fireEvent.change(screen.getByPlaceholderText('e.g., Toy Distribution'), { target: { value: 'Test' } });
    fireEvent.click(screen.getByText(/Next/));

    // Step 2 - skip
    fireEvent.click(screen.getByText(/Skip for now/));

    // Step 3 - invite info
    expect(screen.getByRole('heading', { name: 'Invite Participants' })).toBeInTheDocument();
    expect(screen.getByText(/Producers \(Editors\)/)).toBeInTheDocument();
    expect(screen.getByText(/Requestors \(Viewers\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Next/));

    // Step 4 - finish
    expect(screen.getByText(/Import Existing Data/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Open Dashboard/));

    // onboardingComplete should be true
    const updated = ySystems.get('sys-1');
    expect(updated.onboardingComplete).toBe(true);

    // Callback should be called
    expect(onComplete).toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith('Inventory system is ready!', 'success');
  });

  test('full wizard generates audit log entries', () => {
    render(<OnboardingWizard onComplete={jest.fn()} />);

    // Step 1
    fireEvent.change(screen.getByPlaceholderText('e.g., Toy Distribution'), { target: { value: 'Audited System' } });
    fireEvent.click(screen.getByText(/Next/));

    // Step 2 - add item
    fireEvent.change(screen.getByPlaceholderText('e.g., Rubber Duck'), { target: { value: 'Audit Item' } });
    fireEvent.click(screen.getByText(/Add & Continue/));

    // Should have 2 audit entries (system_configured + catalog_item_added)
    const entries = yAudit.toArray();
    expect(entries.length).toBe(2);
    expect(entries[0].action).toBe('system_configured');
    expect(entries[1].action).toBe('catalog_item_added');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  2. CATALOG MANAGEMENT WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════

describe('Catalog Management Workflow', () => {
  beforeEach(() => {
    buildSharedYjs({ name: 'Test System', onboardingComplete: true, settings: {} });
    setContext(ADMIN_IDENTITY);
    refreshSync();
  });

  test('add new catalog item via form', () => {
    render(<CatalogManager />);

    expect(screen.getByText('Item Catalog')).toBeInTheDocument();

    // Click add
    fireEvent.click(screen.getByText('+ Add Item'));

    // Fill form
    const nameInputs = screen.getAllByPlaceholderText('e.g., Rubber Duck');
    fireEvent.change(nameInputs[0], { target: { value: 'New Widget' } });

    // Submit
    fireEvent.click(screen.getByText('Add to Catalog'));

    // Should be added to Yjs
    expect(yCatalog.toArray().length).toBe(1);
    expect(yCatalog.toArray()[0].name).toBe('New Widget');
    expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('New Widget'), 'success');
  });

  test('edit existing catalog item', () => {
    yCatalog.push([createTestCatalogItem({ id: 'cat-edit-1', name: 'Old Name', unit: 'boxes' })]);
    refreshSync();

    render(<CatalogManager />);

    expect(screen.getByText('Old Name')).toBeInTheDocument();

    // Click edit
    fireEvent.click(screen.getByText(/Edit/));

    // Change name
    const nameInputs = screen.getAllByDisplayValue('Old Name');
    fireEvent.change(nameInputs[0], { target: { value: 'New Name' } });

    // Save
    fireEvent.click(screen.getByText('Save Changes'));

    const updated = yCatalog.toArray().find(i => i.id === 'cat-edit-1');
    expect(updated.name).toBe('New Name');
    expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('New Name'), 'success');
  });

  test('toggle catalog item active/inactive', () => {
    yCatalog.push([createTestCatalogItem({ id: 'cat-toggle-1', name: 'Toggle Item', active: true })]);
    refreshSync();

    render(<CatalogManager />);

    // Click deactivate
    fireEvent.click(screen.getByText(/Deactivate/));

    const updated = yCatalog.toArray().find(i => i.id === 'cat-toggle-1');
    expect(updated.active).toBe(false);

    const lastAudit = yAudit.toArray()[yAudit.toArray().length - 1];
    expect(lastAudit.action).toBe('catalog_item_deactivated');
  });

  test('catalog operations generate audit log entries', () => {
    render(<CatalogManager />);

    // Add item
    fireEvent.click(screen.getByText('+ Add Item'));
    const nameInputs = screen.getAllByPlaceholderText('e.g., Rubber Duck');
    fireEvent.change(nameInputs[0], { target: { value: 'Audit Test Item' } });
    fireEvent.click(screen.getByText('Add to Catalog'));

    expect(yAudit.toArray().length).toBe(1);
    expect(yAudit.toArray()[0].action).toBe('catalog_item_added');
  });

  test('empty catalog shows empty state message', () => {
    refreshSync();
    render(<CatalogManager />);

    expect(screen.getByText(/No catalog items yet/)).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  3. SETTINGS & CONFIGURATION WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════

describe('Settings & Configuration Workflow', () => {
  beforeEach(() => {
    buildSharedYjs({ name: 'Test System', onboardingComplete: true, settings: { requireApproval: true } });
    setContext(ADMIN_IDENTITY);
    refreshSync();
  });

  test('renders all settings sections', () => {
    render(<InventorySettings />);

    expect(screen.getByText('Inventory Settings')).toBeInTheDocument();
    expect(screen.getByText('System Name')).toBeInTheDocument();
    expect(screen.getByText('Workflow')).toBeInTheDocument();
    expect(screen.getByText('Assignment Algorithm')).toBeInTheDocument();
    expect(screen.getByText('Danger Zone')).toBeInTheDocument();
  });

  test('toggle requireApproval setting updates Yjs', () => {
    render(<InventorySettings />);

    // Find Require Approval checkbox
    const checkboxes = screen.getAllByRole('checkbox');
    // First checkbox is requireApproval
    const requireApprovalCheckbox = checkboxes[0];
    
    fireEvent.click(requireApprovalCheckbox);

    // Should update system settings in Yjs
    const updated = ySystems.get('sys-1');
    expect(updated.settings.requireApproval).toBe(false);

    // Should add audit log entry
    const lastAudit = yAudit.toArray()[yAudit.toArray().length - 1];
    expect(lastAudit.action).toBe('settings_changed');
  });

  test('rename system name', () => {
    render(<InventorySettings />);

    const nameInput = screen.getByPlaceholderText('Inventory system name');
    fireEvent.change(nameInput, { target: { value: 'Renamed System' } });

    // Save button should appear
    expect(screen.getByText('Save')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Save'));

    const updated = ySystems.get('sys-1');
    expect(updated.name).toBe('Renamed System');
  });

  test('run auto-assign shows result', async () => {
    // Add some open requests for the algorithm
    yRequests.push([
      createTestRequest({ id: 'req-aa-1', status: 'open', inventorySystemId: 'sys-1' }),
    ]);
    refreshSync();

    const { assignRequests } = require('../../../frontend/src/utils/inventoryAssignment');
    assignRequests.mockReturnValue([
      { requestId: 'req-aa-1', producerId: 'producerKey456', source: 'stock', estimatedDate: Date.now() + 86400000 },
    ]);

    render(<InventorySettings />);

    const runBtn = screen.getByText(/Run Auto-Assign Now/);
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(screen.getByText(/Assigned 1 of 1/)).toBeInTheDocument();
    });
  });

  test('setting changes generate audit log', () => {
    render(<InventorySettings />);

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]); // Toggle auto-assign

    const entries = yAudit.toArray();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[entries.length - 1].action).toBe('settings_changed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  4. NAVIGATION & ROLE-GATING
// ═══════════════════════════════════════════════════════════════════════════

describe('Navigation & Role-Gating', () => {
  test('admin nav shows all sections plus My Views', () => {
    render(
      <InventoryNavRail
        activeView="admin-dashboard"
        onNavigate={jest.fn()}
        isOwner={true}
        isEditor={false}
        isViewer={false}
        systemName="Test System"
        openRequestCount={5}
        pendingApprovalCount={3}
      />
    );

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('All Requests')).toBeInTheDocument();
    expect(screen.getByText('Approval Queue')).toBeInTheDocument();
    expect(screen.getByText('Producers')).toBeInTheDocument();
    expect(screen.getByText('Item Catalog')).toBeInTheDocument();
    expect(screen.getByText('Analytics')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Import/Export')).toBeInTheDocument();
    expect(screen.getByText('Audit Log')).toBeInTheDocument();

    // Admin role-switch "My Views"
    expect(screen.getByText('My Views')).toBeInTheDocument();
    expect(screen.getByText('Submit Request')).toBeInTheDocument();
    expect(screen.getByText('My Capacity')).toBeInTheDocument();
  });

  test('producer nav shows only producer views', () => {
    render(
      <InventoryNavRail
        activeView="producer-dashboard"
        onNavigate={jest.fn()}
        isOwner={false}
        isEditor={true}
        isViewer={false}
        systemName="Test System"
        openRequestCount={3}
        pendingApprovalCount={0}
      />
    );

    expect(screen.getByText('My Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Open Requests')).toBeInTheDocument();
    expect(screen.getByText('My Requests')).toBeInTheDocument();
    expect(screen.getByText('My Stats')).toBeInTheDocument();

    // Admin views should NOT be shown
    expect(screen.queryByText('Approval Queue')).toBeNull();
    expect(screen.queryByText('Settings')).toBeNull();
    expect(screen.queryByText('My Views')).toBeNull();
  });

  test('requestor nav shows only requestor views', () => {
    render(
      <InventoryNavRail
        activeView="submit-request"
        onNavigate={jest.fn()}
        isOwner={false}
        isEditor={false}
        isViewer={true}
        systemName="Test System"
        openRequestCount={0}
        pendingApprovalCount={0}
      />
    );

    expect(screen.getByText('Submit Request')).toBeInTheDocument();
    expect(screen.getByText('My Requests')).toBeInTheDocument();
    expect(screen.getByText('FAQ')).toBeInTheDocument();

    // Admin and producer views NOT shown
    expect(screen.queryByText('Approval Queue')).toBeNull();
    expect(screen.queryByText('Open Requests')).toBeNull();
    expect(screen.queryByText('Dashboard')).toBeNull();
    expect(screen.queryByText('My Views')).toBeNull();
  });

  test('nav badges show correct counts', () => {
    render(
      <InventoryNavRail
        activeView="admin-dashboard"
        onNavigate={jest.fn()}
        isOwner={true}
        isEditor={false}
        isViewer={false}
        systemName="Test System"
        openRequestCount={42}
        pendingApprovalCount={7}
      />
    );

    // Only pendingApprovalCount shows a badge in admin nav (on Approval Queue)
    expect(screen.getByText('7')).toBeInTheDocument();
    // openRequestCount badge only shows on producer nav, not admin nav
    expect(screen.queryByText('42')).toBeNull();
  });

  test('nav badges cap at 99+', () => {
    // Use producer nav which has openRequestCount badge
    render(
      <InventoryNavRail
        activeView="producer-dashboard"
        onNavigate={jest.fn()}
        isOwner={false}
        isEditor={true}
        isViewer={false}
        systemName="Test System"
        openRequestCount={150}
        pendingApprovalCount={200}
      />
    );

    const badges99 = screen.getAllByText('99+');
    expect(badges99.length).toBe(1); // Only openRequestCount badge on producer nav
  });

  test('clicking nav item calls onNavigate with correct view ID', () => {
    const onNavigate = jest.fn();
    render(
      <InventoryNavRail
        activeView="admin-dashboard"
        onNavigate={onNavigate}
        isOwner={true}
        isEditor={false}
        isViewer={false}
        systemName="Test System"
        openRequestCount={0}
        pendingApprovalCount={0}
      />
    );

    fireEvent.click(screen.getByText('All Requests'));
    expect(onNavigate).toHaveBeenCalledWith('all-requests');

    fireEvent.click(screen.getByText('Settings'));
    expect(onNavigate).toHaveBeenCalledWith('settings');

    fireEvent.click(screen.getByText('Import/Export'));
    expect(onNavigate).toHaveBeenCalledWith('import-export');
  });

  test('active view is highlighted', () => {
    render(
      <InventoryNavRail
        activeView="all-requests"
        onNavigate={jest.fn()}
        isOwner={true}
        isEditor={false}
        isViewer={false}
        systemName="Test System"
        openRequestCount={0}
        pendingApprovalCount={0}
      />
    );

    const activeBtn = screen.getByText('All Requests').closest('button');
    expect(activeBtn).toHaveClass('inventory-nav-item--active');
  });

  test('system name appears in nav header', () => {
    render(
      <InventoryNavRail
        activeView="admin-dashboard"
        onNavigate={jest.fn()}
        isOwner={true}
        isEditor={false}
        isViewer={false}
        systemName="My Distribution Network"
        openRequestCount={0}
        pendingApprovalCount={0}
      />
    );

    expect(screen.getByText('My Distribution Network')).toBeInTheDocument();
  });
});
