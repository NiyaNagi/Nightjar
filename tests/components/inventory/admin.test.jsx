/**
 * tests/components/inventory/admin.test.jsx
 *
 * Tests for admin inventory components:
 *   AdminDashboard, AllRequests, ApprovalQueue, AuditLog,
 *   CatalogManager, InventorySettings, ProducerManagement
 */

import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import {
  createMockYMap,
  createMockYArray,
  createTestRequest,
  createTestCatalogItem,
  createTestCapacity,
  createTestAuditEntry,
  createMockInventoryContext,
} from '../../helpers/inventory-test-utils';

// --- Recharts mock ---
jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }) => <div data-testid="responsive-container">{typeof children === 'function' ? children(400, 200) : children}</div>,
  LineChart: ({ children }) => <div data-testid="line-chart">{children}</div>,
  ComposedChart: ({ children }) => <div data-testid="composed-chart">{children}</div>,
  Line: () => <div data-testid="line" />,
  Area: () => <div data-testid="area" />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
}));

// --- Shared mock state ---
let mockCtx;
let mockSyncResult;

jest.mock('../../../frontend/src/contexts/InventoryContext', () => ({
  useInventory: jest.fn(() => ({ ...mockCtx, ...mockSyncResult })),
}));

jest.mock('../../../frontend/src/contexts/ToastContext', () => ({
  useToast: jest.fn(() => ({ showToast: jest.fn(), dismissToast: jest.fn() })),
}));

jest.mock('../../../frontend/src/hooks/useInventorySync', () => {
  const fn = jest.fn(() => mockSyncResult);
  fn.default = fn;
  // Make it work both as default and named export
  return { __esModule: true, default: fn, useInventorySync: fn };
});

jest.mock('../../../frontend/src/utils/inventoryValidation', () => ({
  ...jest.requireActual('../../../frontend/src/utils/inventoryValidation'),
  generateId: jest.fn(() => 'mock-id-' + Math.random().toString(36).slice(2, 8)),
}));

jest.mock('../../../frontend/src/utils/inventoryExport', () => ({
  exportRequests: jest.fn(),
  exportAuditLog: jest.fn(),
}));

jest.mock('../../../frontend/src/utils/addressCrypto', () => ({
  getPublicKeyHex: jest.fn(() => 'admin-hex'),
  base62ToPublicKeyHex: jest.fn(() => 'producer-hex'),
  createAddressReveal: jest.fn(() => Promise.resolve({ encrypted: 'data' })),
  decryptPendingAddress: jest.fn(() => Promise.resolve({ fullName: 'Test', street1: '123 Main', city: 'NY', state: 'NY', zipCode: '10001', country: 'US' })),
}));

jest.mock('../../../frontend/src/utils/inventoryAddressStore', () => ({
  getAddress: jest.fn(() => Promise.resolve(null)),
  getWorkspaceKeyMaterial: jest.fn(() => 'mock-key-material'),
  storeAddress: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../../frontend/src/utils/inventoryAssignment', () => ({
  assignRequests: jest.fn(() => []),
  estimateFulfillment: jest.fn(() => null),
  validateClaim: jest.fn(() => ({ ok: true })),
}));

// ---- Setup defaults ----
beforeEach(() => {
  const yRequests = createMockYArray([]);
  const yAudit = createMockYArray([]);
  const ySystems = createMockYMap({});
  const yCatalog = createMockYArray([]);
  const yCapacities = createMockYMap({});
  const yReveals = createMockYMap({});
  const yPending = createMockYMap({});
  const yNotifications = createMockYArray([]);

  mockCtx = {
    yInventoryRequests: yRequests,
    yInventoryAuditLog: yAudit,
    yInventorySystems: ySystems,
    yCatalogItems: yCatalog,
    yProducerCapacities: yCapacities,
    yAddressReveals: yReveals,
    yPendingAddresses: yPending,
    yInventoryNotifications: yNotifications,
    inventorySystemId: 'sys1',
    workspaceId: 'ws1',
    currentWorkspace: { password: 'test-pwd' },
    collaborators: [
      { publicKey: 'key1', publicKeyBase62: 'key1', name: 'Alice', displayName: 'Alice', permission: 'owner', isOnline: true },
      { publicKey: 'key2', publicKeyBase62: 'key2', name: 'Bob', displayName: 'Bob', permission: 'editor', isOnline: false },
    ],
    userIdentity: { publicKeyBase62: 'key1', displayName: 'Alice', curveSecretKey: new Uint8Array(32) },
  };

  mockSyncResult = {
    currentSystem: { name: 'Test System', id: 'sys1', settings: {} },
    inventorySystems: [{ name: 'Test System', id: 'sys1' }],
    catalogItems: [],
    requests: [],
    producerCapacities: [],
    addressReveals: {},
    pendingAddresses: {},
    auditLog: [],
    openRequestCount: 0,
    pendingApprovalCount: 0,
    activeRequestCount: 0,
    allRequests: [],
  };
});

// ======================================================================
// AdminDashboard
// ======================================================================
const AdminDashboard = require('../../../frontend/src/components/inventory/admin/AdminDashboard').default;

describe('AdminDashboard', () => {
  it('renders dashboard heading', () => {
    render(<AdminDashboard />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('renders summary cards with counts', () => {
    mockSyncResult.openRequestCount = 5;
    mockSyncResult.pendingApprovalCount = 3;
    render(<AdminDashboard />);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders quick action buttons', () => {
    render(<AdminDashboard />);
    expect(screen.getByText('➕ Submit Request')).toBeInTheDocument();
    expect(screen.getByText('📋 All Requests')).toBeInTheDocument();
    expect(screen.getByText('👥 Manage Producers')).toBeInTheDocument();
    expect(screen.getByText('📦 Edit Catalog')).toBeInTheDocument();
  });

  it('calls onNavigate when quick action clicked', () => {
    const onNavigate = jest.fn();
    render(<AdminDashboard onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('📋 All Requests'));
    expect(onNavigate).toHaveBeenCalledWith('all-requests');
  });

  it('shows pending approval cards when there are pending requests', () => {
    mockSyncResult.pendingApprovalCount = 1;
    mockSyncResult.requests = [
      createTestRequest({ id: 'req-pending1', status: 'claimed', inventorySystemId: 'sys1', catalogItemName: 'Widget', assignedTo: 'key2' }),
    ];
    render(<AdminDashboard />);
    expect(screen.getByText('Needs Your Attention')).toBeInTheDocument();
  });

  it('shows blocked requests section when blocked requests exist', () => {
    mockSyncResult.requests = [
      createTestRequest({ id: 'req-blocked1', status: 'blocked', inventorySystemId: 'sys1', catalogItemName: 'Gadget' }),
    ];
    render(<AdminDashboard />);
    expect(screen.getByText('Blocked Requests')).toBeInTheDocument();
  });

  it('renders inflow/outflow chart', () => {
    render(<AdminDashboard />);
    expect(screen.getByText('Inflow / Outflow (Last 30 Days)')).toBeInTheDocument();
  });

  it('shows aging section when requests are older than 7 days', () => {
    mockSyncResult.requests = [
      createTestRequest({ status: 'open', inventorySystemId: 'sys1', requestedAt: Date.now() - 8 * 86400000 }),
    ];
    render(<AdminDashboard />);
    expect(screen.getByText(/Aging Requests/)).toBeInTheDocument();
  });
});

// ======================================================================
// AllRequests
// ======================================================================
const AllRequests = require('../../../frontend/src/components/inventory/admin/AllRequests').default;

describe('AllRequests', () => {
  it('renders heading and total count', () => {
    render(<AllRequests />);
    expect(screen.getByText('All Requests')).toBeInTheDocument();
    expect(screen.getByText('Total: 0')).toBeInTheDocument();
  });

  it('renders filter controls', () => {
    render(<AllRequests />);
    expect(screen.getByText('All Statuses')).toBeInTheDocument();
    expect(screen.getByText('All Items')).toBeInTheDocument();
    expect(screen.getByText('All Urgencies')).toBeInTheDocument();
  });

  it('renders empty state when no requests', () => {
    render(<AllRequests />);
    expect(screen.getByText('No requests match your filters.')).toBeInTheDocument();
  });

  it('renders request rows when requests exist', () => {
    mockSyncResult.requests = [
      createTestRequest({ id: 'req-row1', status: 'open', catalogItemName: 'Widget', quantity: 10, state: 'CA', city: 'LA' }),
    ];
    render(<AllRequests />);
    // Should render the request in a table row (via RequestRow)
    expect(screen.getByText('Widget')).toBeInTheDocument();
  });

  it('filters by status', () => {
    mockSyncResult.requests = [
      createTestRequest({ id: 'req-1', status: 'open', catalogItemName: 'Open Item' }),
      createTestRequest({ id: 'req-2', status: 'shipped', catalogItemName: 'Shipped Item' }),
    ];
    render(<AllRequests />);
    
    const statusSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(statusSelect, { target: { value: 'shipped' } });
    
    expect(screen.getByText('Total: 1')).toBeInTheDocument();
  });

  it('shows export button', () => {
    render(<AllRequests />);
    expect(screen.getByText('📤 Export CSV')).toBeInTheDocument();
  });

  it('has search input', () => {
    render(<AllRequests />);
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
  });
});

// ======================================================================
// ApprovalQueue
// ======================================================================
const ApprovalQueue = require('../../../frontend/src/components/inventory/admin/ApprovalQueue').default;

describe('ApprovalQueue', () => {
  it('shows empty state when no pending requests', () => {
    render(<ApprovalQueue />);
    expect(screen.getByText('Approval Queue')).toBeInTheDocument();
    expect(screen.getByText('No requests pending approval')).toBeInTheDocument();
  });

  it('renders pending request cards', () => {
    mockSyncResult.requests = [
      createTestRequest({ id: 'req-aq1', status: 'claimed', inventorySystemId: 'sys1', catalogItemName: 'Widget' }),
    ];
    mockSyncResult.catalogItems = [createTestCatalogItem({ id: 'cat1', name: 'Widget' })];
    render(<ApprovalQueue />);
    expect(screen.getByText(/1 pending/)).toBeInTheDocument();
  });

  it('has select all checkbox', () => {
    mockSyncResult.requests = [
      createTestRequest({ id: 'req-aq2', status: 'pending_approval', inventorySystemId: 'sys1' }),
    ];
    render(<ApprovalQueue />);
    expect(screen.getByText('Select All')).toBeInTheDocument();
  });

  it('shows approve and reject buttons per card', () => {
    mockSyncResult.requests = [
      createTestRequest({ id: 'req-aq3', status: 'claimed', inventorySystemId: 'sys1' }),
    ];
    render(<ApprovalQueue />);
    expect(screen.getByText('✓ Approve')).toBeInTheDocument();
    expect(screen.getByText('✗ Reject')).toBeInTheDocument();
  });

  it('shows bulk actions when items are selected', () => {
    mockSyncResult.requests = [
      createTestRequest({ id: 'req-aq4', status: 'claimed', inventorySystemId: 'sys1' }),
    ];
    render(<ApprovalQueue />);
    
    // Click the checkbox
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]); // First is Select All, second is the item checkbox
    
    expect(screen.getByText(/Approve \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Reject \(1\)/)).toBeInTheDocument();
  });

  it('has reassign dropdown', () => {
    mockSyncResult.requests = [
      createTestRequest({ id: 'req-aq5', status: 'claimed', inventorySystemId: 'sys1' }),
    ];
    render(<ApprovalQueue />);
    expect(screen.getByText('→ Reassign to…')).toBeInTheDocument();
  });
});

// ======================================================================
// AuditLog
// ======================================================================
const AuditLog = require('../../../frontend/src/components/inventory/admin/AuditLog').default;

describe('AuditLog', () => {
  it('renders heading', () => {
    render(<AuditLog />);
    expect(screen.getByText('Audit Log')).toBeInTheDocument();
  });

  it('shows empty state', () => {
    render(<AuditLog />);
    expect(screen.getByText(/No audit log entries/)).toBeInTheDocument();
  });

  it('renders entries when audit log has data', () => {
    mockSyncResult.auditLog = [
      createTestAuditEntry({
        id: 'aud-1',
        action: 'request_approved',
        summary: 'Request approved',
        timestamp: Date.now(),
        actorName: 'Alice',
      }),
    ];
    render(<AuditLog />);
    expect(screen.getByText('Request approved')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('has search and filter controls', () => {
    render(<AuditLog />);
    expect(screen.getByPlaceholderText('Search entries...')).toBeInTheDocument();
    expect(screen.getByText('All Actions')).toBeInTheDocument();
    expect(screen.getByText('All Targets')).toBeInTheDocument();
  });

  it('has export CSV button', () => {
    render(<AuditLog />);
    expect(screen.getByText('Export CSV')).toBeInTheDocument();
  });

  it('shows entry count', () => {
    mockSyncResult.auditLog = [
      createTestAuditEntry({ id: 'a1' }),
      createTestAuditEntry({ id: 'a2' }),
    ];
    render(<AuditLog />);
    expect(screen.getByText('2 entries')).toBeInTheDocument();
  });

  it('filters by action', () => {
    mockSyncResult.auditLog = [
      createTestAuditEntry({ id: 'a1', action: 'request_approved', summary: 'Approved' }),
      createTestAuditEntry({ id: 'a2', action: 'request_cancelled', summary: 'Cancelled' }),
    ];
    render(<AuditLog />);

    const actionSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(actionSelect, { target: { value: 'request_approved' } });

    expect(screen.getByText('1 entries')).toBeInTheDocument();
  });
});

// ======================================================================
// CatalogManager
// ======================================================================
const CatalogManager = require('../../../frontend/src/components/inventory/admin/CatalogManager').default;

describe('CatalogManager', () => {
  it('renders heading', () => {
    render(<CatalogManager />);
    expect(screen.getByText('Item Catalog')).toBeInTheDocument();
  });

  it('shows empty state when no items', () => {
    render(<CatalogManager />);
    expect(screen.getByText(/No catalog items yet/)).toBeInTheDocument();
  });

  it('has Add Item button', () => {
    render(<CatalogManager />);
    expect(screen.getByText('+ Add Item')).toBeInTheDocument();
  });

  it('toggles add form visibility', () => {
    render(<CatalogManager />);
    expect(screen.queryByText('Add New Item')).not.toBeInTheDocument();
    
    fireEvent.click(screen.getByText('+ Add Item'));
    expect(screen.getByText('Add New Item')).toBeInTheDocument();
    
    fireEvent.click(screen.getByText('✕ Cancel'));
    expect(screen.queryByText('Add New Item')).not.toBeInTheDocument();
  });

  it('renders existing catalog items', () => {
    mockSyncResult.catalogItems = [
      createTestCatalogItem({ id: 'cat-1', name: 'Widget', sku: 'WDG-001', unit: 'pieces', active: true }),
    ];
    render(<CatalogManager />);
    expect(screen.getByText('Widget')).toBeInTheDocument();
    expect(screen.getByText('SKU: WDG-001')).toBeInTheDocument();
  });

  it('shows edit and deactivate buttons per item', () => {
    mockSyncResult.catalogItems = [
      createTestCatalogItem({ id: 'cat-2', name: 'Gadget', active: true }),
    ];
    render(<CatalogManager />);
    expect(screen.getByText('✏️ Edit')).toBeInTheDocument();
    expect(screen.getByText('⏸️ Deactivate')).toBeInTheDocument();
  });

  it('shows Activate button for inactive items', () => {
    mockSyncResult.catalogItems = [
      createTestCatalogItem({ id: 'cat-3', name: 'Old Item', active: false }),
    ];
    render(<CatalogManager />);
    expect(screen.getByText('▶️ Activate')).toBeInTheDocument();
  });
});

// ======================================================================
// InventorySettings
// ======================================================================
const InventorySettings = require('../../../frontend/src/components/inventory/admin/InventorySettings').default;

describe('InventorySettings', () => {
  it('renders heading', () => {
    render(<InventorySettings />);
    expect(screen.getByText('Inventory Settings')).toBeInTheDocument();
  });

  it('shows system name input', () => {
    render(<InventorySettings />);
    expect(screen.getByPlaceholderText('Inventory system name')).toBeInTheDocument();
  });

  it('shows workflow toggles', () => {
    render(<InventorySettings />);
    expect(screen.getByText('Require Approval')).toBeInTheDocument();
    expect(screen.getByText('Auto-Assignment')).toBeInTheDocument();
    expect(screen.getByText('Allow Producer Claims')).toBeInTheDocument();
    expect(screen.getByText('Default Urgency')).toBeInTheDocument();
  });

  it('shows run auto-assign button', () => {
    render(<InventorySettings />);
    expect(screen.getByText('🔄 Run Auto-Assign Now')).toBeInTheDocument();
  });

  it('shows save button when system name is changed', () => {
    render(<InventorySettings />);
    const input = screen.getByPlaceholderText('Inventory system name');
    fireEvent.change(input, { target: { value: 'New Name' } });
    expect(screen.getByText('Save')).toBeInTheDocument();
  });

  it('shows danger zone', () => {
    render(<InventorySettings />);
    expect(screen.getByText('Danger Zone')).toBeInTheDocument();
  });
});

// ======================================================================
// ProducerManagement
// ======================================================================
const ProducerManagement = require('../../../frontend/src/components/inventory/admin/ProducerManagement').default;

describe('ProducerManagement', () => {
  it('renders heading', () => {
    render(<ProducerManagement />);
    expect(screen.getByText('Producer Management')).toBeInTheDocument();
  });

  it('renders producers from collaborators with editor permission', () => {
    mockSyncResult.requests = [];
    mockSyncResult.producerCapacities = {};
    render(<ProducerManagement />);
    // Both owner and editor show as producers
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('shows active badge with count', () => {
    render(<ProducerManagement />);
    expect(screen.getByText(/active/)).toBeInTheDocument();
  });

  it('shows empty state when no collaborators have editor permission', () => {
    mockCtx.collaborators = [{ publicKey: 'k1', name: 'Viewer', permission: 'viewer' }];
    mockCtx.userIdentity = null;
    render(<ProducerManagement />);
    expect(screen.getByText(/No producers/)).toBeInTheDocument();
  });

  it('shows detail panel when producer row is clicked', () => {
    render(<ProducerManagement />);
    fireEvent.click(screen.getByText('Alice'));
    expect(screen.getByText(/Assigned Requests/)).toBeInTheDocument();
  });
});
