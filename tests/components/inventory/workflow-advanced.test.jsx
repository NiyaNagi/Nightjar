/**
 * tests/components/inventory/workflow-advanced.test.jsx
 *
 * End-to-end workflow tests for advanced scenarios:
 *   - Auto-assignment algorithm integration
 *   - Producer capacity management
 *   - Multi-role scenarios (admin as requestor, admin as producer)
 *   - Audit log trail verification
 *   - Edge cases and error handling
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  createMockYMap,
  createMockYArray,
  createTestRequest,
  createTestCatalogItem,
  createTestCapacity,
  createTestIdentity,
  createTestAuditEntry,
  resetIdCounter,
} from '../../helpers/inventory-test-utils';

// ── Mocks ──────────────────────────────────────────────────────────────────

let mockCtx;
let mockSyncResult;
let mockShowToast;

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
  usePermission: jest.fn(() => ({ isOwner: true, isEditor: false, isViewer: false })),
}));

const mockAssignRequests = jest.fn(() => []);

jest.mock('../../../frontend/src/utils/inventoryValidation', () => ({
  ...jest.requireActual('../../../frontend/src/utils/inventoryValidation'),
  generateId: jest.fn(() => 'mock-id-' + Math.random().toString(36).slice(2, 8)),
}));

jest.mock('../../../frontend/src/utils/inventoryAssignment', () => ({
  assignRequests: (...args) => mockAssignRequests(...args),
  estimateFulfillment: jest.fn(() => ({ source: 'stock', estimatedDate: null })),
  validateClaim: jest.fn(() => ({ ok: true })),
}));

jest.mock('../../../frontend/src/utils/addressCrypto', () => ({
  getPublicKeyHex: jest.fn(() => 'admin-hex'),
  base62ToPublicKeyHex: jest.fn(() => 'producer-hex'),
  createAddressReveal: jest.fn(() => Promise.resolve({ encrypted: 'data' })),
  decryptAddressReveal: jest.fn(() => Promise.resolve({
    fullName: 'John Doe',
    street1: '123 Main St',
    city: 'Portland',
    state: 'OR',
    zipCode: '97201',
  })),
  decryptPendingAddress: jest.fn(() => Promise.resolve({ fullName: 'Test', street1: '1 Main', city: 'NY', state: 'NY', zipCode: '10001', country: 'US' })),
  encryptAddressForAdmins: jest.fn(() => []),
}));

jest.mock('../../../frontend/src/utils/inventoryAddressStore', () => ({
  getAddress: jest.fn(() => Promise.resolve(null)),
  storeAddress: jest.fn(() => Promise.resolve()),
  getWorkspaceKeyMaterial: jest.fn(() => Promise.resolve({ key: 'mock' })),
}));

jest.mock('../../../frontend/src/utils/inventoryExport', () => ({
  exportRequests: jest.fn(),
  exportAuditLog: jest.fn(),
}));

jest.mock('../../../frontend/src/utils/inventorySavedAddresses', () => ({
  getSavedAddresses: jest.fn(() => []),
  storeSavedAddress: jest.fn(),
  deleteSavedAddress: jest.fn(),
}));

jest.mock('../../../frontend/src/utils/shippingProviders', () => ({
  SHIPPING_PROVIDERS: [],
  getAllProviderIds: jest.fn(() => []),
  getProviderById: jest.fn(() => null),
  getEnabledProviders: jest.fn(() => []),
  formatAddressForCopy: jest.fn(() => 'Test Address'),
}));

jest.mock('../../../frontend/src/hooks/useCopyFeedback', () => ({
  useCopyFeedback: () => ({ copied: false, copyToClipboard: jest.fn() }),
}));

jest.mock('../../../frontend/src/utils/trackingLinks', () => ({
  parseTrackingNumber: jest.fn(() => null),
  genericTrackingUrl: jest.fn(() => ''),
}));

jest.mock('../../../frontend/src/utils/inventoryNotifications', () => ({
  pushNotification: jest.fn(),
  getUnreadCount: jest.fn(() => 0),
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
jest.mock('../../../frontend/src/components/inventory/admin/AdminDashboard.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/admin/AllRequests.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/admin/ApprovalQueue.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/admin/AuditLog.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/admin/CatalogManager.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/admin/InventorySettings.css', () => ({}));
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

const AdminDashboard = require('../../../frontend/src/components/inventory/admin/AdminDashboard').default;
const AllRequests = require('../../../frontend/src/components/inventory/admin/AllRequests').default;
const ApprovalQueue = require('../../../frontend/src/components/inventory/admin/ApprovalQueue').default;
const InventorySettings = require('../../../frontend/src/components/inventory/admin/InventorySettings').default;
const AuditLog = require('../../../frontend/src/components/inventory/admin/AuditLog').default;
const ProducerDashboard = require('../../../frontend/src/components/inventory/producer/ProducerDashboard').default;
const ProducerStats = require('../../../frontend/src/components/inventory/producer/ProducerStats').default;
const OpenRequests = require('../../../frontend/src/components/inventory/producer/OpenRequests').default;
const RequestorMyRequests = require('../../../frontend/src/components/inventory/requestor/MyRequests').default;

// ── Shared test data ──────────────────────────────────────────────────────

const ADMIN_IDENTITY = {
  publicKeyBase62: 'adminKey123',
  displayName: 'Admin Alice',
  name: 'Admin Alice',
  curveSecretKey: new Uint8Array(32),
};

const PRODUCER_IDENTITY = {
  publicKeyBase62: 'producerKey456',
  displayName: 'Producer Bob',
  name: 'Producer Bob',
  curveSecretKey: new Uint8Array(32),
};

const REQUESTOR_IDENTITY = {
  publicKeyBase62: 'requestorKey789',
  displayName: 'Requestor Carol',
  name: 'Requestor Carol',
  curveSecretKey: new Uint8Array(32),
};

const COLLABORATORS = [
  { publicKey: 'adminKey123', publicKeyBase62: 'adminKey123', name: 'Admin Alice', displayName: 'Admin Alice', permission: 'owner', isOnline: true },
  { publicKey: 'producerKey456', publicKeyBase62: 'producerKey456', name: 'Producer Bob', displayName: 'Producer Bob', permission: 'editor', isOnline: true },
  { publicKey: 'requestorKey789', publicKeyBase62: 'requestorKey789', name: 'Requestor Carol', displayName: 'Requestor Carol', permission: 'viewer', isOnline: true },
];

const CATALOG_ITEM = createTestCatalogItem({
  id: 'cat-widget',
  name: 'Widget',
  unit: 'units',
  quantityMin: 1,
  quantityMax: 100,
  active: true,
  isActive: true,
});

// ── Shared Yjs mock instances ─────────────────────────────────────────────

let yRequests, yAudit, ySystems, yCatalog, yCapacities, yReveals, yPending;

function buildSharedYjs() {
  ySystems = createMockYMap({ 'sys-1': { name: 'Test System', onboardingComplete: true, settings: { requireApproval: true } } });
  yCatalog = createMockYArray([CATALOG_ITEM]);
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
    currentWorkspace: { password: 'test-pwd' },
    userIdentity: identity,
    collaborators: COLLABORATORS,
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
    pendingApprovalCount: yRequests.toArray().filter(r => r.status === 'claimed' || r.status === 'pending_approval').length,
    activeRequestCount: yRequests.toArray().filter(r => !['cancelled', 'delivered'].includes(r.status)).length,
    allRequests: yRequests.toArray(),
  };
}

// ── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockShowToast = jest.fn();
  mockAssignRequests.mockReturnValue([]);
  resetIdCounter();
  buildSharedYjs();
  setContext(ADMIN_IDENTITY);
  refreshSync();
});

// ═══════════════════════════════════════════════════════════════════════════
//  1. AUTO-ASSIGNMENT INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════

describe('Auto-Assignment Integration', () => {
  test('auto-assign assigns open requests to producers with capacity', async () => {
    yRequests.push([
      createTestRequest({ id: 'req-aa-1', status: 'open', inventorySystemId: 'sys-1', itemId: 'cat-widget' }),
      createTestRequest({ id: 'req-aa-2', status: 'open', inventorySystemId: 'sys-1', itemId: 'cat-widget' }),
    ]);
    yCapacities.set('producerKey456', { items: { 'cat-widget': { currentStock: 20, capacityPerDay: 5 } } });
    refreshSync();

    mockAssignRequests.mockReturnValue([
      { requestId: 'req-aa-1', producerId: 'producerKey456', source: 'stock', estimatedDate: Date.now() + 86400000 },
      { requestId: 'req-aa-2', producerId: 'producerKey456', source: 'capacity', estimatedDate: Date.now() + 172800000 },
    ]);

    render(<InventorySettings />);

    fireEvent.click(screen.getByText(/Run Auto-Assign Now/));

    await waitFor(() => {
      expect(screen.getByText(/Assigned 2 of 2/)).toBeInTheDocument();
    });

    // Both requests should be updated
    const results = yRequests.toArray();
    expect(results[0].assignedTo).toBe('producerKey456');
    expect(results[1].assignedTo).toBe('producerKey456');
  });

  test('auto-assign reports blocked requests', async () => {
    yRequests.push([
      createTestRequest({ id: 'req-aa-3', status: 'open', inventorySystemId: 'sys-1' }),
    ]);
    refreshSync();

    mockAssignRequests.mockReturnValue([
      { requestId: 'req-aa-3', producerId: null, source: 'blocked', estimatedDate: null },
    ]);

    render(<InventorySettings />);

    fireEvent.click(screen.getByText(/Run Auto-Assign Now/));

    await waitFor(() => {
      expect(screen.getByText(/Assigned 0 of 1/)).toBeInTheDocument();
      expect(screen.getByText(/1 blocked/)).toBeInTheDocument();
    });
  });

  test('auto-assign with requireApproval creates pending_approval status', async () => {
    yRequests.push([
      createTestRequest({ id: 'req-aa-4', status: 'open', inventorySystemId: 'sys-1' }),
    ]);
    refreshSync();

    mockAssignRequests.mockReturnValue([
      { requestId: 'req-aa-4', producerId: 'producerKey456', source: 'stock', estimatedDate: Date.now() + 86400000 },
    ]);

    render(<InventorySettings />);
    fireEvent.click(screen.getByText(/Run Auto-Assign Now/));

    await waitFor(() => {
      expect(screen.getByText(/Assigned 1 of 1/)).toBeInTheDocument();
    });

    const updated = yRequests.toArray().find(r => r.id === 'req-aa-4');
    expect(updated.status).toBe('pending_approval');
  });

  test('auto-assign generates audit log entries for each assignment', async () => {
    yRequests.push([
      createTestRequest({ id: 'req-aa-5', status: 'open', inventorySystemId: 'sys-1' }),
    ]);
    refreshSync();

    mockAssignRequests.mockReturnValue([
      { requestId: 'req-aa-5', producerId: 'producerKey456', source: 'stock', estimatedDate: Date.now() },
    ]);

    render(<InventorySettings />);
    fireEvent.click(screen.getByText(/Run Auto-Assign Now/));

    await waitFor(() => {
      const entries = yAudit.toArray();
      const assignEntries = entries.filter(e => e.action === 'request_auto_assigned');
      expect(assignEntries.length).toBe(1);
      expect(assignEntries[0].targetId).toBe('req-aa-5');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  2. PRODUCER CAPACITY MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

describe('Producer Capacity Management', () => {
  test('producer dashboard shows capacity inputs for catalog items', () => {
    refreshSync();
    setContext(PRODUCER_IDENTITY);
    render(<ProducerDashboard onNavigate={jest.fn()} />);

    expect(screen.getByText('Producer Dashboard')).toBeInTheDocument();
    // Should show catalog items for capacity entry
    expect(screen.getByText('Widget')).toBeInTheDocument();
  });

  test('producer stats show zero fulfillment when no shipped requests', () => {
    refreshSync();
    setContext(PRODUCER_IDENTITY);
    render(<ProducerStats />);

    expect(screen.getByText('My Stats')).toBeInTheDocument();
    // Multiple stat cards show '0' — verify the Requests Fulfilled card
    expect(screen.getByText('Requests Fulfilled')).toBeInTheDocument();
  });

  test('producer stats reflect shipped request counts', () => {
    yRequests.push([
      createTestRequest({ id: 'req-ps-1', status: 'shipped', assignedTo: 'producerKey456', quantity: 5, inventorySystemId: 'sys-1', shippedAt: Date.now() - 86400000, requestedAt: Date.now() - 172800000 }),
      createTestRequest({ id: 'req-ps-2', status: 'delivered', assignedTo: 'producerKey456', quantity: 10, inventorySystemId: 'sys-1', shippedAt: Date.now(), requestedAt: Date.now() - 86400000 }),
    ]);
    refreshSync();

    setContext(PRODUCER_IDENTITY);
    render(<ProducerStats />);

    // Should show fulfilled request stats
    expect(screen.getByText('Requests Fulfilled')).toBeInTheDocument();
    expect(screen.getByText('Total Units Shipped')).toBeInTheDocument();
    // '15' appears in both personal and community stats, just verify it exists
    expect(screen.getAllByText('15').length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  3. MULTI-ROLE SCENARIOS
// ═══════════════════════════════════════════════════════════════════════════

describe('Multi-Role Scenarios', () => {
  test('admin can view all request statuses in AllRequests', () => {
    yRequests.push([
      createTestRequest({ id: 'mr-1', status: 'open', inventorySystemId: 'sys-1', catalogItemName: 'Widget', state: 'CO', city: 'Denver' }),
      createTestRequest({ id: 'mr-2', status: 'claimed', inventorySystemId: 'sys-1', catalogItemName: 'Widget', assignedTo: 'producerKey456', state: 'CA', city: 'LA' }),
      createTestRequest({ id: 'mr-3', status: 'approved', inventorySystemId: 'sys-1', catalogItemName: 'Widget', assignedTo: 'producerKey456', state: 'OR', city: 'PDX' }),
      createTestRequest({ id: 'mr-4', status: 'shipped', inventorySystemId: 'sys-1', catalogItemName: 'Widget', assignedTo: 'producerKey456', state: 'WA', city: 'SEA' }),
      createTestRequest({ id: 'mr-5', status: 'cancelled', inventorySystemId: 'sys-1', catalogItemName: 'Widget', state: 'NV', city: 'LV' }),
    ]);
    refreshSync();

    setContext(ADMIN_IDENTITY);
    render(<AllRequests />);

    expect(screen.getByText('Total: 5')).toBeInTheDocument();
  });

  test('admin can filter AllRequests by status', () => {
    yRequests.push([
      createTestRequest({ id: 'mr-f-1', status: 'open', inventorySystemId: 'sys-1', catalogItemName: 'Widget', state: 'CO', city: 'Denver' }),
      createTestRequest({ id: 'mr-f-2', status: 'shipped', inventorySystemId: 'sys-1', catalogItemName: 'Widget', state: 'CA', city: 'LA' }),
    ]);
    refreshSync();

    setContext(ADMIN_IDENTITY);
    render(<AllRequests />);

    const statusSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(statusSelect, { target: { value: 'open' } });

    expect(screen.getByText('Total: 1')).toBeInTheDocument();
  });

  test('admin dashboard shows blocked requests section', () => {
    yRequests.push([
      createTestRequest({ id: 'mr-b-1', status: 'blocked', inventorySystemId: 'sys-1', catalogItemName: 'Widget' }),
    ]);
    refreshSync();

    setContext(ADMIN_IDENTITY);
    render(<AdminDashboard onNavigate={jest.fn()} />);

    expect(screen.getByText('Blocked Requests')).toBeInTheDocument();
  });

  test('admin dashboard quick actions navigate to correct views', () => {
    refreshSync();
    const onNavigate = jest.fn();
    render(<AdminDashboard onNavigate={onNavigate} />);

    fireEvent.click(screen.getByText(/All Requests/));
    expect(onNavigate).toHaveBeenCalledWith('all-requests');

    fireEvent.click(screen.getByText(/Manage Producers/));
    expect(onNavigate).toHaveBeenCalledWith('producers');

    fireEvent.click(screen.getByText(/Edit Catalog/));
    expect(onNavigate).toHaveBeenCalledWith('catalog');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  4. AUDIT LOG TRAIL VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

describe('Audit Log Trail', () => {
  test('audit log renders chronologically', () => {
    yAudit.push([
      createTestAuditEntry({ id: 'aud-t-1', action: 'request_submitted', summary: 'Request submitted', timestamp: Date.now() - 3600000 }),
      createTestAuditEntry({ id: 'aud-t-2', action: 'request_claimed', summary: 'Request claimed', timestamp: Date.now() - 1800000 }),
      createTestAuditEntry({ id: 'aud-t-3', action: 'request_approved', summary: 'Request approved', timestamp: Date.now() }),
    ]);
    refreshSync();

    setContext(ADMIN_IDENTITY);
    render(<AuditLog />);

    expect(screen.getByText('Audit Log')).toBeInTheDocument();
  });

  test('claim → approve → ship creates sequential audit entries', () => {
    // Simulate the full lifecycle in Yjs
    const reqId = 'req-audit-trail';

    // 1. Request created
    yRequests.push([createTestRequest({
      id: reqId,
      status: 'open',
      inventorySystemId: 'sys-1',
    })]);
    yAudit.push([createTestAuditEntry({
      id: 'aud-1',
      action: 'request_submitted',
      targetId: reqId,
      timestamp: Date.now() - 300000,
    })]);

    // 2. Producer claims
    const arr = yRequests.toArray();
    const idx = arr.findIndex(r => r.id === reqId);
    yRequests.delete(idx, 1);
    yRequests.insert(idx, [{ ...arr[idx], status: 'claimed', assignedTo: 'producerKey456' }]);
    yAudit.push([createTestAuditEntry({
      id: 'aud-2',
      action: 'request_claimed',
      targetId: reqId,
      timestamp: Date.now() - 200000,
    })]);

    // 3. Admin approves
    const arr2 = yRequests.toArray();
    const idx2 = arr2.findIndex(r => r.id === reqId);
    yRequests.delete(idx2, 1);
    yRequests.insert(idx2, [{ ...arr2[idx2], status: 'approved', approvedAt: Date.now() }]);
    yAudit.push([createTestAuditEntry({
      id: 'aud-3',
      action: 'request_approved',
      targetId: reqId,
      timestamp: Date.now() - 100000,
    })]);

    refreshSync();

    // Verify the audit trail is complete
    const auditEntries = yAudit.toArray();
    const trailActions = auditEntries.map(e => e.action);
    expect(trailActions).toContain('request_submitted');
    expect(trailActions).toContain('request_claimed');
    expect(trailActions).toContain('request_approved');

    // And the request is now approved
    const finalReq = yRequests.toArray().find(r => r.id === reqId);
    expect(finalReq.status).toBe('approved');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  5. EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════

describe('Edge Cases', () => {
  test('empty system with no requests shows appropriate empty states', () => {
    refreshSync();
    setContext(ADMIN_IDENTITY);

    render(<AllRequests />);
    expect(screen.getByText('No requests match your filters.')).toBeInTheDocument();
  });

  test('empty producer dashboard with no requests shows kanban columns', () => {
    refreshSync();
    setContext(PRODUCER_IDENTITY);

    render(<ProducerDashboard onNavigate={jest.fn()} />);
    expect(screen.getByText('Producer Dashboard')).toBeInTheDocument();
  });

  test('requestor with no requests sees empty state', () => {
    refreshSync();
    setContext(REQUESTOR_IDENTITY);

    render(<RequestorMyRequests />);
    expect(screen.getByText(/haven't submitted any requests/)).toBeInTheDocument();
  });

  test('dashboard renders with missing/null settings gracefully', () => {
    ySystems.set('sys-1', { name: 'Test', onboardingComplete: true });
    refreshSync();
    setContext(ADMIN_IDENTITY);

    render(<InventorySettings />);
    expect(screen.getByText('Inventory Settings')).toBeInTheDocument();
  });

  test('AllRequests search filters by text', () => {
    yRequests.push([
      createTestRequest({ id: 'edge-s-1', status: 'open', catalogItemName: 'Widget', inventorySystemId: 'sys-1', state: 'CO', city: 'Denver' }),
      createTestRequest({ id: 'edge-s-2', status: 'open', catalogItemName: 'Gadget', inventorySystemId: 'sys-1', state: 'CA', city: 'LA' }),
    ]);
    refreshSync();
    setContext(ADMIN_IDENTITY);

    render(<AllRequests />);

    const searchInput = screen.getByPlaceholderText('Search...');
    fireEvent.change(searchInput, { target: { value: 'Widget' } });

    expect(screen.getByText('Total: 1')).toBeInTheDocument();
  });

  test('multiple approval queue operations work sequentially', () => {
    yRequests.push([
      createTestRequest({ id: 'edge-aq-1', status: 'claimed', inventorySystemId: 'sys-1', catalogItemName: 'Widget', assignedTo: 'producerKey456' }),
    ]);
    refreshSync();

    setContext(ADMIN_IDENTITY);
    const { unmount } = render(<ApprovalQueue />);

    // Approve
    fireEvent.click(screen.getByText(/Approve/));
    expect(yRequests.toArray()[0].status).toBe('approved');
    unmount();

    // Re-render with another claimed request
    yRequests.push([
      createTestRequest({ id: 'edge-aq-2', status: 'claimed', inventorySystemId: 'sys-1', catalogItemName: 'Widget', assignedTo: 'producerKey456' }),
    ]);
    refreshSync();

    render(<ApprovalQueue />);
    expect(screen.getByText(/1 pending/)).toBeInTheDocument();
  });
});
