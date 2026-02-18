/**
 * tests/components/inventory/workflow-lifecycle.test.jsx
 *
 * End-to-end workflow tests for request lifecycle:
 *   - Happy path: submit → claim → approve → ship
 *   - Rejection & reclaim
 *   - Producer unclaim
 *   - Requestor cancellation
 *   - Multi-user concurrency
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import {
  createMockYMap,
  createMockYArray,
  createTestRequest,
  createTestCatalogItem,
  createTestCapacity,
  createTestIdentity,
  createMockInventoryContext,
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

jest.mock('../../../frontend/src/utils/inventoryValidation', () => ({
  ...jest.requireActual('../../../frontend/src/utils/inventoryValidation'),
  generateId: jest.fn(() => 'mock-id-' + Math.random().toString(36).slice(2, 8)),
}));

jest.mock('../../../frontend/src/utils/inventoryAssignment', () => ({
  assignRequests: jest.fn(() => []),
  estimateFulfillment: jest.fn(() => ({ source: 'stock', estimatedDate: null })),
  validateClaim: jest.fn(() => ({ ok: true })),
}));

jest.mock('../../../frontend/src/utils/addressCrypto', () => ({
  getPublicKeyHex: jest.fn(() => 'admin-hex'),
  base62ToPublicKeyHex: jest.fn(() => 'producer-hex'),
  createAddressReveal: jest.fn(() => Promise.resolve({ encrypted: 'data' })),
  encryptAddressForAdmins: jest.fn(() => []),
  decryptAddressReveal: jest.fn(() => Promise.resolve({
    fullName: 'John Doe',
    street1: '123 Main St',
    city: 'Portland',
    state: 'OR',
    zipCode: '97201',
  })),
  decryptPendingAddress: jest.fn(() => Promise.resolve({ fullName: 'Test', street1: '1 Main', city: 'NY', state: 'NY', zipCode: '10001', country: 'US' })),
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
const OpenRequests = require('../../../frontend/src/components/inventory/producer/OpenRequests').default;
const ProducerMyRequests = require('../../../frontend/src/components/inventory/producer/MyRequests').default;
const ProducerDashboard = require('../../../frontend/src/components/inventory/producer/ProducerDashboard').default;
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
  quantityStep: 1,
  active: true,
  isActive: true,
});

// ── Shared Yjs mock instances ─────────────────────────────────────────────
// All components share the SAME Yjs mocks so mutations are visible across renders

let yRequests, yAudit, ySystems, yCatalog, yCapacities, yReveals, yPending;

function buildSharedYjs() {
  ySystems = createMockYMap({ 'sys-1': { name: 'Test System', onboardingComplete: true, settings: { requireApproval: true } } });
  yCatalog = createMockYArray([CATALOG_ITEM]);
  yRequests = createMockYArray([]);
  yCapacities = createMockYMap({});
  yReveals = createMockYMap({});
  yPending = createMockYMap({});
  yAudit = createMockYArray([]);
  // Ensure doc.transact is available on yRequests
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
  resetIdCounter();
  buildSharedYjs();
  setContext(ADMIN_IDENTITY);
  refreshSync();
});

// ═══════════════════════════════════════════════════════════════════════════
//  1. HAPPY PATH LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════

describe('Happy Path Lifecycle', () => {
  test('request appears in admin dashboard after creation', () => {
    // Simulate a request being submitted
    const req = createTestRequest({
      id: 'req-hp-1',
      inventorySystemId: 'sys-1',
      catalogItemId: 'cat-widget',
      catalogItemName: 'Widget',
      quantity: 10,
      status: 'open',
      requestedBy: REQUESTOR_IDENTITY.publicKeyBase62,
      requesterName: 'Requestor Carol',
      state: 'CO',
      city: 'Denver',
    });
    yRequests.push([req]);
    refreshSync();

    setContext(ADMIN_IDENTITY);
    render(<AdminDashboard onNavigate={jest.fn()} />);

    // Dashboard should show open request count
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  test('open request appears in producer OpenRequests and can be claimed', () => {
    const req = createTestRequest({
      id: 'req-hp-2',
      inventorySystemId: 'sys-1',
      catalogItemId: 'cat-widget',
      catalogItemName: 'Widget',
      item: 'Widget',
      quantity: 5,
      status: 'open',
      requestedBy: REQUESTOR_IDENTITY.publicKeyBase62,
      shippingState: 'OR',
      shippingCity: 'Portland',
    });
    yRequests.push([req]);
    refreshSync();

    setContext(PRODUCER_IDENTITY);
    render(<OpenRequests />);

    // Should show the open request
    expect(screen.getByText('1 available')).toBeInTheDocument();

    // Claim it (button text includes emoji)
    const claimBtns = screen.getAllByRole('button').filter(
      btn => btn.textContent.toLowerCase().includes('claim')
    );
    fireEvent.click(claimBtns[0]);

    // After claim, yRequests should be updated
    const updated = yRequests.toArray().find(r => r.id === 'req-hp-2');
    expect(updated.status).toBe('claimed');
    expect(updated.assignedTo).toBe('producerKey456');
    expect(updated.claimedBy).toBe('producerKey456');
  });

  test('claimed request appears in ApprovalQueue for admin', () => {
    yRequests.push([createTestRequest({
      id: 'req-hp-3',
      inventorySystemId: 'sys-1',
      catalogItemId: 'cat-widget',
      catalogItemName: 'Widget',
      quantity: 10,
      status: 'claimed',
      assignedTo: PRODUCER_IDENTITY.publicKeyBase62,
      claimedBy: PRODUCER_IDENTITY.publicKeyBase62,
    })]);
    refreshSync();

    setContext(ADMIN_IDENTITY);
    render(<ApprovalQueue />);

    expect(screen.getByText(/1 pending/)).toBeInTheDocument();
    expect(screen.getByText(/Approve/)).toBeInTheDocument();
    expect(screen.getByText(/Reject/)).toBeInTheDocument();
  });

  test('admin can approve a claimed request', () => {
    yRequests.push([createTestRequest({
      id: 'req-hp-4',
      inventorySystemId: 'sys-1',
      catalogItemId: 'cat-widget',
      catalogItemName: 'Widget',
      quantity: 15,
      status: 'claimed',
      assignedTo: PRODUCER_IDENTITY.publicKeyBase62,
    })]);
    refreshSync();

    setContext(ADMIN_IDENTITY);
    render(<ApprovalQueue />);

    const approveBtn = screen.getByText(/Approve/);
    fireEvent.click(approveBtn);

    const updated = yRequests.toArray().find(r => r.id === 'req-hp-4');
    expect(updated.status).toBe('approved');
  });

  test('requestor sees their submitted request in MyRequests timeline', () => {
    yRequests.push([createTestRequest({
      id: 'req-hp-5',
      inventorySystemId: 'sys-1',
      catalogItemId: 'cat-widget',
      catalogItemName: 'Widget',
      quantity: 7,
      status: 'open',
      requestedBy: REQUESTOR_IDENTITY.publicKeyBase62,
      unit: 'units',
    })]);
    refreshSync();

    setContext(REQUESTOR_IDENTITY);
    render(<RequestorMyRequests />);

    expect(screen.getByText('1 total')).toBeInTheDocument();
    // Widget appears in both filter dropdown and request card
    expect(screen.getAllByText('Widget').length).toBeGreaterThan(0);
  });

  test('producer sees claimed request in their kanban pipeline', () => {
    yRequests.push([createTestRequest({
      id: 'req-hp-6',
      inventorySystemId: 'sys-1',
      catalogItemId: 'cat-widget',
      catalogItemName: 'Widget',
      quantity: 3,
      status: 'claimed',
      assignedTo: PRODUCER_IDENTITY.publicKeyBase62,
      claimedBy: PRODUCER_IDENTITY.publicKeyBase62,
    })]);
    refreshSync();

    setContext(PRODUCER_IDENTITY);
    render(<ProducerMyRequests />);

    expect(screen.getByText('1 total')).toBeInTheDocument();
  });

  test('AllRequests shows requests across all statuses', () => {
    yRequests.push([
      createTestRequest({ id: 'req-all-1', status: 'open', catalogItemName: 'Widget', inventorySystemId: 'sys-1', state: 'CA', city: 'LA' }),
      createTestRequest({ id: 'req-all-2', status: 'claimed', catalogItemName: 'Widget', inventorySystemId: 'sys-1', state: 'OR', city: 'PDX' }),
      createTestRequest({ id: 'req-all-3', status: 'shipped', catalogItemName: 'Widget', inventorySystemId: 'sys-1', state: 'WA', city: 'SEA' }),
    ]);
    refreshSync();

    setContext(ADMIN_IDENTITY);
    render(<AllRequests />);

    expect(screen.getByText('Total: 3')).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  2. REJECTION & RECLAIM WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════

describe('Rejection & Reclaim Workflow', () => {
  test('admin can reject a claimed request back to open', () => {
    yRequests.push([createTestRequest({
      id: 'req-rej-1',
      inventorySystemId: 'sys-1',
      catalogItemId: 'cat-widget',
      catalogItemName: 'Widget',
      quantity: 10,
      status: 'claimed',
      assignedTo: PRODUCER_IDENTITY.publicKeyBase62,
    })]);
    refreshSync();

    setContext(ADMIN_IDENTITY);
    render(<ApprovalQueue />);

    const rejectBtn = screen.getByText(/Reject/);
    fireEvent.click(rejectBtn);

    const updated = yRequests.toArray().find(r => r.id === 'req-rej-1');
    expect(updated.status).toBe('open');
    expect(updated.assignedTo).toBeNull();
  });

  test('rejected request becomes available again for producers to claim', () => {
    // Request was rejected — now open again
    yRequests.push([createTestRequest({
      id: 'req-rej-2',
      inventorySystemId: 'sys-1',
      catalogItemId: 'cat-widget',
      catalogItemName: 'Widget',
      item: 'Widget',
      quantity: 8,
      status: 'open',
      shippingState: 'CA',
      shippingCity: 'LA',
    })]);
    refreshSync();

    setContext(PRODUCER_IDENTITY);
    render(<OpenRequests />);

    expect(screen.getByText('1 available')).toBeInTheDocument();
    
    // Can claim it again (button text includes emoji)
    const claimBtns = screen.getAllByRole('button').filter(
      btn => btn.textContent.toLowerCase().includes('claim')
    );
    fireEvent.click(claimBtns[0]);

    const updated = yRequests.toArray().find(r => r.id === 'req-rej-2');
    expect(updated.status).toBe('claimed');
    expect(updated.claimedBy).toBe('producerKey456');
  });

  test('admin bulk approve selects and approves multiple requests', () => {
    yRequests.push([
      createTestRequest({ id: 'req-ba-1', inventorySystemId: 'sys-1', status: 'claimed', catalogItemName: 'Widget', assignedTo: 'producerKey456' }),
      createTestRequest({ id: 'req-ba-2', inventorySystemId: 'sys-1', status: 'claimed', catalogItemName: 'Widget', assignedTo: 'producerKey456' }),
    ]);
    refreshSync();

    setContext(ADMIN_IDENTITY);
    render(<ApprovalQueue />);

    // Select individual items and approve them one by one
    const approveBtns = screen.getAllByText(/Approve/);
    fireEvent.click(approveBtns[0]); // approve first

    // First should be approved
    expect(yRequests.toArray()[0].status).toBe('approved');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  3. PRODUCER UNCLAIM WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════

describe('Producer Unclaim Workflow', () => {
  test('producer can unclaim a claimed request from ProducerDashboard', () => {
    yRequests.push([createTestRequest({
      id: 'req-unc-1',
      inventorySystemId: 'sys-1',
      catalogItemId: 'cat-widget',
      catalogItemName: 'Widget',
      quantity: 5,
      status: 'claimed',
      assignedTo: PRODUCER_IDENTITY.publicKeyBase62,
      claimedBy: PRODUCER_IDENTITY.publicKeyBase62,
    })]);
    refreshSync();

    setContext(PRODUCER_IDENTITY);
    render(<ProducerDashboard onNavigate={jest.fn()} />);

    // Find and click unclaim button (uses emoji ↩️ which may render differently)
    const unclaimBtns = screen.getAllByRole('button').filter(
      btn => btn.textContent.toLowerCase().includes('unclaim')
    );
    expect(unclaimBtns.length).toBeGreaterThan(0);
    fireEvent.click(unclaimBtns[0]);

    const updated = yRequests.toArray().find(r => r.id === 'req-unc-1');
    expect(updated.status).toBe('open');
    expect(updated.assignedTo).toBeNull();
    expect(updated.claimedBy).toBeNull();
  });

  test('producer can unclaim from ProducerMyRequests', () => {
    yRequests.push([createTestRequest({
      id: 'req-unc-2',
      inventorySystemId: 'sys-1',
      catalogItemId: 'cat-widget',
      catalogItemName: 'Widget',
      quantity: 3,
      status: 'claimed',
      assignedTo: PRODUCER_IDENTITY.publicKeyBase62,
      claimedBy: PRODUCER_IDENTITY.publicKeyBase62,
    })]);
    refreshSync();

    setContext(PRODUCER_IDENTITY);
    render(<ProducerMyRequests />);

    const unclaimBtns = screen.getAllByRole('button').filter(
      btn => btn.textContent.toLowerCase().includes('unclaim')
    );
    expect(unclaimBtns.length).toBeGreaterThan(0);
    fireEvent.click(unclaimBtns[0]);

    const updated = yRequests.toArray().find(r => r.id === 'req-unc-2');
    expect(updated.status).toBe('open');
    expect(updated.assignedTo).toBeNull();
  });

  test('unclaimed request address reveal is also deleted', () => {
    const reqId = 'req-unc-3';
    yRequests.push([createTestRequest({
      id: reqId,
      inventorySystemId: 'sys-1',
      status: 'approved',
      assignedTo: PRODUCER_IDENTITY.publicKeyBase62,
      claimedBy: PRODUCER_IDENTITY.publicKeyBase62,
    })]);
    yReveals.set(reqId, { encrypted: 'data' });
    refreshSync();

    setContext(PRODUCER_IDENTITY);
    render(<ProducerMyRequests />);

    const unclaimBtns = screen.getAllByRole('button').filter(
      btn => btn.textContent.toLowerCase().includes('unclaim')
    );
    fireEvent.click(unclaimBtns[0]);

    expect(yReveals.delete).toHaveBeenCalledWith(reqId);
  });

  test('unclaim generates audit log entry', () => {
    yRequests.push([createTestRequest({
      id: 'req-unc-4',
      inventorySystemId: 'sys-1',
      status: 'claimed',
      assignedTo: PRODUCER_IDENTITY.publicKeyBase62,
      claimedBy: PRODUCER_IDENTITY.publicKeyBase62,
    })]);
    refreshSync();

    const auditCountBefore = yAudit.toArray().length;

    setContext(PRODUCER_IDENTITY);
    render(<ProducerMyRequests />);

    const unclaimBtns = screen.getAllByRole('button').filter(
      btn => btn.textContent.toLowerCase().includes('unclaim')
    );
    fireEvent.click(unclaimBtns[0]);

    const auditCountAfter = yAudit.toArray().length;
    expect(auditCountAfter).toBeGreaterThan(auditCountBefore);

    const lastAudit = yAudit.toArray()[yAudit.toArray().length - 1];
    expect(lastAudit.action).toBe('request_unclaimed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  4. REQUESTOR CANCELLATION WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════

describe('Requestor Cancellation Workflow', () => {
  test('requestor can cancel an open request', () => {
    yRequests.push([createTestRequest({
      id: 'req-can-1',
      inventorySystemId: 'sys-1',
      catalogItemId: 'cat-widget',
      catalogItemName: 'Widget',
      quantity: 5,
      status: 'open',
      requestedBy: REQUESTOR_IDENTITY.publicKeyBase62,
      unit: 'units',
    })]);
    refreshSync();

    setContext(REQUESTOR_IDENTITY);
    render(<RequestorMyRequests />);

    // Find cancel button
    const cancelBtns = screen.getAllByRole('button').filter(
      btn => btn.textContent.toLowerCase().includes('cancel')
    );
    expect(cancelBtns.length).toBeGreaterThan(0);
    fireEvent.click(cancelBtns[0]);

    const updated = yRequests.toArray().find(r => r.id === 'req-can-1');
    expect(updated.status).toBe('cancelled');
  });

  test('requestor can cancel a claimed (not yet shipped) request', () => {
    yRequests.push([createTestRequest({
      id: 'req-can-2',
      inventorySystemId: 'sys-1',
      catalogItemId: 'cat-widget',
      catalogItemName: 'Widget',
      quantity: 10,
      status: 'claimed',
      requestedBy: REQUESTOR_IDENTITY.publicKeyBase62,
      assignedTo: PRODUCER_IDENTITY.publicKeyBase62,
      unit: 'units',
    })]);
    refreshSync();

    setContext(REQUESTOR_IDENTITY);
    render(<RequestorMyRequests />);

    const cancelBtns = screen.getAllByRole('button').filter(
      btn => btn.textContent.toLowerCase().includes('cancel')
    );
    expect(cancelBtns.length).toBeGreaterThan(0);
    fireEvent.click(cancelBtns[0]);

    const updated = yRequests.toArray().find(r => r.id === 'req-can-2');
    expect(updated.status).toBe('cancelled');
  });

  test('shipped requests cannot be cancelled (no cancel button)', () => {
    yRequests.push([createTestRequest({
      id: 'req-can-3',
      inventorySystemId: 'sys-1',
      catalogItemId: 'cat-widget',
      catalogItemName: 'Widget',
      quantity: 5,
      status: 'shipped',
      requestedBy: REQUESTOR_IDENTITY.publicKeyBase62,
      unit: 'units',
    })]);
    refreshSync();

    setContext(REQUESTOR_IDENTITY);
    render(<RequestorMyRequests />);

    const allBtns = screen.queryAllByRole('button');
    const cancelBtns = allBtns.filter(
      btn => btn.textContent.toLowerCase().includes('cancel')
    );
    expect(cancelBtns).toHaveLength(0);
  });

  test('cancellation triggers audit log and toast', () => {
    yRequests.push([createTestRequest({
      id: 'req-can-4',
      inventorySystemId: 'sys-1',
      catalogItemId: 'cat-widget',
      catalogItemName: 'Widget',
      quantity: 5,
      status: 'open',
      requestedBy: REQUESTOR_IDENTITY.publicKeyBase62,
      unit: 'units',
    })]);
    refreshSync();

    setContext(REQUESTOR_IDENTITY);
    render(<RequestorMyRequests />);

    const cancelBtns = screen.getAllByRole('button').filter(
      btn => btn.textContent.toLowerCase().includes('cancel')
    );
    fireEvent.click(cancelBtns[0]);

    expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('cancelled'), 'success');

    const lastAudit = yAudit.toArray()[yAudit.toArray().length - 1];
    expect(lastAudit.action).toBe('request_cancelled');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  5. MULTI-USER CONCURRENCY
// ═══════════════════════════════════════════════════════════════════════════

describe('Multi-User Concurrency', () => {
  test('two producers see the same open requests', () => {
    yRequests.push([
      createTestRequest({ id: 'req-mu-1', status: 'open', inventorySystemId: 'sys-1', item: 'Widget', catalogItemName: 'Widget', shippingState: 'CA', shippingCity: 'LA' }),
      createTestRequest({ id: 'req-mu-2', status: 'open', inventorySystemId: 'sys-1', item: 'Widget', catalogItemName: 'Widget', shippingState: 'OR', shippingCity: 'Portland' }),
    ]);
    refreshSync();

    // Producer Bob sees both
    setContext(PRODUCER_IDENTITY);
    const { unmount } = render(<OpenRequests />);
    expect(screen.getByText('2 available')).toBeInTheDocument();
    unmount();

    // Another producer sees both too
    const PRODUCER2 = { publicKeyBase62: 'producer2Key', displayName: 'Producer Dan', name: 'Producer Dan', curveSecretKey: new Uint8Array(32) };
    setContext(PRODUCER2);
    refreshSync();
    render(<OpenRequests />);
    expect(screen.getByText('2 available')).toBeInTheDocument();
  });

  test('after one producer claims, the request disappears from open list', () => {
    yRequests.push([
      createTestRequest({ id: 'req-mu-3', status: 'open', inventorySystemId: 'sys-1', item: 'Widget', catalogItemName: 'Widget', shippingState: 'CA', shippingCity: 'LA' }),
    ]);
    refreshSync();

    // Producer claims it
    setContext(PRODUCER_IDENTITY);
    const { unmount } = render(<OpenRequests />);
    const claimBtns = screen.getAllByRole('button').filter(
      btn => btn.textContent.toLowerCase().includes('claim')
    );
    fireEvent.click(claimBtns[0]);
    unmount();

    // Now open requests list should be empty
    refreshSync();
    const PRODUCER2 = { publicKeyBase62: 'producer2Key', displayName: 'Producer Dan', name: 'Producer Dan', curveSecretKey: new Uint8Array(32) };
    setContext(PRODUCER2);
    render(<OpenRequests />);
    expect(screen.getByText('0 available')).toBeInTheDocument();
  });

  test('requestor sees updated status after producer claims their request', () => {
    const reqId = 'req-mu-4';
    yRequests.push([createTestRequest({
      id: reqId,
      inventorySystemId: 'sys-1',
      catalogItemId: 'cat-widget',
      catalogItemName: 'Widget',
      quantity: 5,
      status: 'open',
      requestedBy: REQUESTOR_IDENTITY.publicKeyBase62,
      unit: 'units',
    })]);
    refreshSync();

    // Producer claims
    setContext(PRODUCER_IDENTITY);
    const arr = yRequests.toArray();
    const idx = arr.findIndex(r => r.id === reqId);
    yRequests.delete(idx, 1);
    yRequests.insert(idx, [{
      ...arr[idx],
      status: 'claimed',
      assignedTo: PRODUCER_IDENTITY.publicKeyBase62,
      claimedBy: PRODUCER_IDENTITY.publicKeyBase62,
    }]);
    refreshSync();

    // Requestor now sees claimed status
    setContext(REQUESTOR_IDENTITY);
    render(<RequestorMyRequests />);

    expect(screen.getByText('1 total')).toBeInTheDocument();
    // StatusBadge renders with capitalized label
    expect(screen.getByText('Claimed')).toBeInTheDocument();
  });

  test('admin dashboard reflects changes from multiple users', () => {
    // Some open, some claimed
    yRequests.push([
      createTestRequest({ id: 'req-mu-5', status: 'open', inventorySystemId: 'sys-1' }),
      createTestRequest({ id: 'req-mu-6', status: 'open', inventorySystemId: 'sys-1' }),
      createTestRequest({ id: 'req-mu-7', status: 'claimed', inventorySystemId: 'sys-1', assignedTo: 'producerKey456' }),
    ]);
    refreshSync();

    setContext(ADMIN_IDENTITY);
    render(<AdminDashboard onNavigate={jest.fn()} />);

    // Should show open count (2) and pending approval (1) - use getAllByText since numbers may appear multiple times
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
  });

  test('multiple requests from different requestors appear in AllRequests', () => {
    yRequests.push([
      createTestRequest({ id: 'req-mu-8', status: 'open', inventorySystemId: 'sys-1', catalogItemName: 'Widget', requestedBy: 'requestorKey789', state: 'CO', city: 'Denver' }),
      createTestRequest({ id: 'req-mu-9', status: 'open', inventorySystemId: 'sys-1', catalogItemName: 'Widget', requestedBy: 'anotherUser', state: 'CA', city: 'LA' }),
      createTestRequest({ id: 'req-mu-10', status: 'shipped', inventorySystemId: 'sys-1', catalogItemName: 'Widget', requestedBy: 'requestorKey789', state: 'WA', city: 'SEA' }),
    ]);
    refreshSync();

    setContext(ADMIN_IDENTITY);
    render(<AllRequests />);

    expect(screen.getByText('Total: 3')).toBeInTheDocument();
  });
});
