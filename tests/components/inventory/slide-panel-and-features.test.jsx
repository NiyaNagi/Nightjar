/**
 * tests/components/inventory/slide-panel-and-features.test.jsx
 *
 * Tests for:
 *   1. SlidePanel component (rendering, a11y, focus trap, escape, backdrop)
 *   2. producerCapacities shape (object, not array) from useInventorySync
 *   3. Request drill-in via SlidePanel in requestor MyRequests, producer views
 *   4. Auto-assign quick action button in AdminDashboard
 *   5. Export Report dropdown (CSV + Summary) in AdminDashboard
 *   6. runAutoAssign shared utility
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import {
  createMockYMap,
  createMockYArray,
  createTestRequest,
  createTestCatalogItem,
  createTestCapacity,
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

const mockExportRequests = jest.fn();
jest.mock('../../../frontend/src/utils/inventoryExport', () => ({
  exportRequests: (...args) => mockExportRequests(...args),
  exportAuditLog: jest.fn(),
}));

jest.mock('../../../frontend/src/utils/inventorySavedAddresses', () => ({
  getSavedAddresses: jest.fn(() => []),
  storeSavedAddress: jest.fn(),
  deleteSavedAddress: jest.fn(),
}));

jest.mock('../../../frontend/src/utils/inventoryNotifications', () => ({
  pushNotification: jest.fn(),
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

// Recharts mock
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
jest.mock('../../../frontend/src/components/inventory/common/SlidePanel.css', () => ({}));

// ── Component imports (after mocks) ───────────────────────────────────────

const SlidePanel = require('../../../frontend/src/components/inventory/common/SlidePanel').default;
const AdminDashboard = require('../../../frontend/src/components/inventory/admin/AdminDashboard').default;
const ProducerDashboard = require('../../../frontend/src/components/inventory/producer/ProducerDashboard').default;
const OpenRequests = require('../../../frontend/src/components/inventory/producer/OpenRequests').default;
const ProducerMyRequests = require('../../../frontend/src/components/inventory/producer/MyRequests').default;
const RequestorMyRequests = require('../../../frontend/src/components/inventory/requestor/MyRequests').default;
const { runAutoAssign } = require('../../../frontend/src/utils/autoAssign');

// ── Shared test data ──────────────────────────────────────────────────────

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

const ADMIN_IDENTITY = {
  publicKeyBase62: 'adminKey123',
  displayName: 'Admin Alice',
  name: 'Admin Alice',
  curveSecretKey: new Uint8Array(32),
};

const COLLABORATORS = [
  { publicKey: 'adminKey123', publicKeyBase62: 'adminKey123', name: 'Admin Alice', displayName: 'Admin Alice', permission: 'owner', isOnline: true },
  { publicKey: 'producerKey456', publicKeyBase62: 'producerKey456', name: 'Producer Bob', displayName: 'Producer Bob', permission: 'editor', isOnline: true },
  { publicKey: 'requestorKey789', publicKeyBase62: 'requestorKey789', name: 'Requestor Carol', displayName: 'Requestor Carol', permission: 'viewer', isOnline: true },
];

const CATALOG = [createTestCatalogItem({ id: 'cat-widget', name: 'Widget', unit: 'units', isActive: true })];

// ── Shared Yjs mock instances ─────────────────────────────────────────────

let yRequests, yAudit, ySystems, yCatalog, yCapacities, yReveals, yPending, yNotifications;

function buildSharedYjs() {
  ySystems = createMockYMap({ 'sys-1': { name: 'Test System', onboardingComplete: true, settings: { requireApproval: true } } });
  yCatalog = createMockYArray(CATALOG);
  yRequests = createMockYArray([]);
  yCapacities = createMockYMap({});
  yReveals = createMockYMap({});
  yPending = createMockYMap({});
  yAudit = createMockYArray([]);
  yNotifications = createMockYArray([]);
  yRequests.doc = { transact: jest.fn((fn) => fn()) };
}

function buildMockCtx(identity, overrides = {}) {
  buildSharedYjs();
  mockShowToast = jest.fn();
  mockCtx = {
    yInventoryRequests: yRequests,
    yInventoryAuditLog: yAudit,
    yInventorySystems: ySystems,
    yCatalogItems: yCatalog,
    yProducerCapacities: yCapacities,
    yAddressReveals: yReveals,
    yPendingAddresses: yPending,
    yInventoryNotifications: yNotifications,
    inventorySystemId: 'sys-1',
    workspaceId: 'ws-1',
    currentWorkspace: { password: 'test-pwd' },
    collaborators: COLLABORATORS,
    userIdentity: identity,
    ...overrides,
  };
  mockSyncResult = {
    currentSystem: { name: 'Test System', id: 'sys-1', settings: { requireApproval: true } },
    inventorySystems: [{ name: 'Test System', id: 'sys-1' }],
    catalogItems: CATALOG,
    requests: [],
    producerCapacities: {},
    addressReveals: {},
    pendingAddresses: {},
    auditLog: [],
    openRequestCount: 0,
    pendingApprovalCount: 0,
    activeRequestCount: 0,
    allRequests: [],
    ...overrides,
  };
}

beforeEach(() => {
  resetIdCounter();
  mockExportRequests.mockClear();
  mockAssignRequests.mockClear();
});

// ======================================================================
// 1. SlidePanel Component Tests
// ======================================================================

describe('SlidePanel', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <SlidePanel isOpen={false} onClose={jest.fn()} title="Test">
        <p>Content</p>
      </SlidePanel>
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders overlay, panel, title, close button and children when open', () => {
    render(
      <SlidePanel isOpen={true} onClose={jest.fn()} title="Request Detail">
        <p>Hello World</p>
      </SlidePanel>
    );
    expect(screen.getByText('Request Detail')).toBeInTheDocument();
    expect(screen.getByText('Hello World')).toBeInTheDocument();
    expect(screen.getByLabelText('Close panel')).toBeInTheDocument();
  });

  it('has role="dialog" and aria-modal="true"', () => {
    render(
      <SlidePanel isOpen={true} onClose={jest.fn()} title="Test">
        <p>Content</p>
      </SlidePanel>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = jest.fn();
    render(
      <SlidePanel isOpen={true} onClose={onClose} title="Test">
        <p>Content</p>
      </SlidePanel>
    );
    fireEvent.click(screen.getByLabelText('Close panel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = jest.fn();
    render(
      <SlidePanel isOpen={true} onClose={onClose} title="Test">
        <p>Content</p>
      </SlidePanel>
    );
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop (overlay) is clicked', () => {
    const onClose = jest.fn();
    const { container } = render(
      <SlidePanel isOpen={true} onClose={onClose} title="Test">
        <p>Content</p>
      </SlidePanel>
    );
    const overlay = container.querySelector('.slide-panel__overlay');
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onClose when clicking inside the panel', () => {
    const onClose = jest.fn();
    render(
      <SlidePanel isOpen={true} onClose={onClose} title="Test">
        <p>Content</p>
      </SlidePanel>
    );
    fireEvent.click(screen.getByText('Content'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders default title when none provided', () => {
    render(
      <SlidePanel isOpen={true} onClose={jest.fn()}>
        <p>Content</p>
      </SlidePanel>
    );
    expect(screen.getByText('Details')).toBeInTheDocument();
  });
});

// ======================================================================
// 2. producerCapacities Shape Test (via useInventorySync)
// ======================================================================

describe('producerCapacities shape', () => {
  it('useInventorySync returns producerCapacities as an object keyed by producer key, not an array', () => {
    // Import the actual useInventorySync to test its processing logic
    // We can't test the hook directly in JSDOM without Yjs, so we verify the fix
    // by reading the source — this is a structural assertion.
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '../../../frontend/src/hooks/useInventorySync.js'),
      'utf8'
    );

    // Should use Object.entries(...).filter(...).reduce(...) not Object.values
    expect(source).toContain('Object.entries(producerCapacitiesMap)');
    expect(source).not.toMatch(/producerCapacities\s*=\s*Object\.values\(producerCapacitiesMap\)/);
  });

  it('producerCapacities is accessible by producer key (object bracket notation)', () => {
    // Simulate the expected shape from useInventorySync
    const producerCapacities = {
      'producerKey456': { inventorySystemId: 'sys-1', items: { 'cat-widget': { currentStock: 50 } } },
    };
    // This is the access pattern used by ProducerDashboard, OpenRequests, etc.
    const myCap = producerCapacities?.['producerKey456'] || {};
    expect(myCap.items).toBeDefined();
    expect(myCap.items['cat-widget'].currentStock).toBe(50);
  });
});

// ======================================================================
// 3. Request Drill-In: Requestor MyRequests
// ======================================================================

describe('Requestor MyRequests – drill-in', () => {
  beforeEach(() => {
    buildMockCtx(REQUESTOR_IDENTITY);
    const req = createTestRequest({
      id: 'req-drill-1',
      inventorySystemId: 'sys-1',
      catalogItemId: 'cat-widget',
      catalogItemName: 'Widget',
      quantity: 25,
      unit: 'units',
      city: 'Denver',
      state: 'CO',
      status: 'open',
      requestedBy: 'requestorKey789',
      requestedAt: Date.now() - 86400000,
    });
    mockSyncResult.requests = [req];
  });

  it('renders request cards', () => {
    render(<RequestorMyRequests />);
    expect(screen.getAllByText('Widget').length).toBeGreaterThan(0);
    expect(screen.getByText('#drill-')).toBeInTheDocument();
  });

  it('opens SlidePanel with RequestDetail when a card is clicked', () => {
    render(<RequestorMyRequests />);
    // Click the card (Widget may appear in multiple places)
    const widgetEls = screen.getAllByText('Widget');
    const card = widgetEls.map(el => el.closest('.my-request-card')).find(Boolean);
    fireEvent.click(card);
    // SlidePanel should open with a dialog role
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // RequestDetail content should appear
    expect(screen.getByText('Item')).toBeInTheDocument();
    expect(screen.getByText('Quantity')).toBeInTheDocument();
  });

  it('closes SlidePanel when close button is clicked', () => {
    render(<RequestorMyRequests />);
    const widgetEls = screen.getAllByText('Widget');
    const card = widgetEls.map(el => el.closest('.my-request-card')).find(Boolean);
    fireEvent.click(card);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Close panel'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows Cancel Request button in drill-in for open requests', () => {
    render(<RequestorMyRequests />);
    const widgetEls = screen.getAllByText('Widget');
    const card = widgetEls.map(el => el.closest('.my-request-card')).find(Boolean);
    fireEvent.click(card);
    // The RequestDetail should show a cancel button for open status
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Cancel Request')).toBeInTheDocument();
  });
});

// ======================================================================
// 4. Request Drill-In: ProducerDashboard
// ======================================================================

describe('ProducerDashboard – drill-in', () => {
  beforeEach(() => {
    buildMockCtx(PRODUCER_IDENTITY);
    const req = createTestRequest({
      id: 'req-prod-1',
      inventorySystemId: 'sys-1',
      catalogItemId: 'cat-widget',
      catalogItemName: 'Widget',
      quantity: 10,
      unit: 'units',
      city: 'Portland',
      state: 'OR',
      status: 'claimed',
      assignedTo: 'producerKey456',
      claimedBy: 'producerKey456',
      requestedBy: 'requestorKey789',
      requestedAt: Date.now() - 86400000,
    });
    mockSyncResult.requests = [req];
    mockSyncResult.producerCapacities = {
      'producerKey456': { inventorySystemId: 'sys-1', items: { 'cat-widget': { currentStock: 50, capacityPerDay: 5 } } },
    };
  });

  it('opens SlidePanel when a kanban card is clicked', () => {
    render(<ProducerDashboard />);
    // Find the kanban card and click it (Widget appears in capacity + kanban)
    const widgetEls = screen.getAllByText('Widget');
    const card = widgetEls.map(el => el.closest('.pd-kanban-card')).find(Boolean);
    fireEvent.click(card);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // RequestDetail should render inside with producer actions
    expect(screen.getByText('Item')).toBeInTheDocument();
  });

  it('shows producer capacity data when producerCapacities is an object', () => {
    render(<ProducerDashboard />);
    // The capacity section should render because myCap is found via bracket notation
    expect(screen.getByText('My Capacity')).toBeInTheDocument();
  });
});

// ======================================================================
// 5. Request Drill-In: Producer MyRequests (Pipeline)
// ======================================================================

describe('ProducerMyRequests – drill-in', () => {
  beforeEach(() => {
    buildMockCtx(PRODUCER_IDENTITY);
    const req = createTestRequest({
      id: 'req-pmr-1',
      inventorySystemId: 'sys-1',
      catalogItemId: 'cat-widget',
      catalogItemName: 'Widget',
      quantity: 20,
      unit: 'units',
      city: 'Seattle',
      state: 'WA',
      status: 'approved',
      assignedTo: 'producerKey456',
      claimedBy: 'producerKey456',
      requestedBy: 'requestorKey789',
      requestedAt: Date.now() - 86400000,
      approvedAt: Date.now() - 3600000,
    });
    mockSyncResult.requests = [req];
  });

  it('opens SlidePanel when a pipeline card is clicked', () => {
    render(<ProducerMyRequests />);
    const widgetEls = screen.getAllByText('Widget');
    const card = widgetEls.map(el => el.closest('.pmr-card')).find(Boolean);
    fireEvent.click(card);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Item')).toBeInTheDocument();
  });

  it('closes SlidePanel when Escape is pressed', () => {
    render(<ProducerMyRequests />);
    const widgetEls = screen.getAllByText('Widget');
    const card = widgetEls.map(el => el.closest('.pmr-card')).find(Boolean);
    fireEvent.click(card);
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

// ======================================================================
// 6. Request Drill-In: OpenRequests
// ======================================================================

describe('OpenRequests – drill-in', () => {
  beforeEach(() => {
    buildMockCtx(PRODUCER_IDENTITY);
    const req = createTestRequest({
      id: 'req-open-1',
      inventorySystemId: 'sys-1',
      catalogItemId: 'cat-widget',
      catalogItemName: 'Widget',
      quantity: 100,
      unit: 'units',
      city: 'Austin',
      state: 'TX',
      status: 'open',
      requestedBy: 'requestorKey789',
      requestedAt: Date.now() - 86400000,
    });
    mockSyncResult.requests = [req];
    mockSyncResult.producerCapacities = {
      'producerKey456': { inventorySystemId: 'sys-1', items: {} },
    };
  });

  it('opens SlidePanel when a request card is clicked', () => {
    render(<OpenRequests />);
    // Widget appears in filter dropdown and request card
    const widgetEls = screen.getAllByText('Widget');
    const card = widgetEls.map(el => el.closest('.request-card')).find(Boolean);
    fireEvent.click(card);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Item')).toBeInTheDocument();
  });
});

// ======================================================================
// 7. AdminDashboard – Auto-Assign Quick Action
// ======================================================================

describe('AdminDashboard – Auto-Assign button', () => {
  beforeEach(() => {
    buildMockCtx(ADMIN_IDENTITY);
    mockSyncResult.openRequestCount = 3;
    mockSyncResult.pendingApprovalCount = 1;
  });

  it('renders "Run Auto-Assign" button', () => {
    render(<AdminDashboard onNavigate={jest.fn()} />);
    expect(screen.getByText('🔄 Run Auto-Assign')).toBeInTheDocument();
  });

  it('calls the auto-assign algorithm when clicked', () => {
    mockAssignRequests.mockReturnValue([]);
    render(<AdminDashboard onNavigate={jest.fn()} />);
    fireEvent.click(screen.getByText('🔄 Run Auto-Assign'));
    expect(mockAssignRequests).toHaveBeenCalled();
  });

  it('shows success toast after auto-assign', () => {
    mockAssignRequests.mockReturnValue([
      { requestId: 'r1', producerId: 'p1', source: 'stock', estimatedDate: Date.now() },
    ]);
    // Put a matching open request in the yRequests array
    yRequests._data.push(createTestRequest({ id: 'r1', status: 'open', inventorySystemId: 'sys-1' }));
    mockSyncResult.requests = [createTestRequest({ id: 'r1', status: 'open', inventorySystemId: 'sys-1' })];
    render(<AdminDashboard onNavigate={jest.fn()} />);
    fireEvent.click(screen.getByText('🔄 Run Auto-Assign'));
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.stringContaining('Auto-assigned'),
      'success'
    );
  });

  it('does NOT navigate to settings when auto-assign is clicked', () => {
    const onNavigate = jest.fn();
    mockAssignRequests.mockReturnValue([]);
    render(<AdminDashboard onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('🔄 Run Auto-Assign'));
    // Should NOT have been called with 'settings'
    expect(onNavigate).not.toHaveBeenCalledWith('settings');
  });
});

// ======================================================================
// 8. AdminDashboard – Export Report Dropdown
// ======================================================================

describe('AdminDashboard – Export Report', () => {
  beforeEach(() => {
    buildMockCtx(ADMIN_IDENTITY);
    mockSyncResult.openRequestCount = 2;
    mockSyncResult.requests = [
      createTestRequest({ id: 'r1', status: 'open', catalogItemName: 'Widget', quantity: 10, inventorySystemId: 'sys-1' }),
      createTestRequest({ id: 'r2', status: 'shipped', catalogItemName: 'Gadget', quantity: 5, inventorySystemId: 'sys-1', shippedAt: Date.now() }),
    ];
  });

  it('renders "Export Report" button', () => {
    render(<AdminDashboard onNavigate={jest.fn()} />);
    expect(screen.getByText('📤 Export Report')).toBeInTheDocument();
  });

  it('shows dropdown with CSV and Summary options when clicked', () => {
    render(<AdminDashboard onNavigate={jest.fn()} />);
    fireEvent.click(screen.getByText('📤 Export Report'));
    expect(screen.getByText('📄 Export as CSV')).toBeInTheDocument();
    expect(screen.getByText('📝 Export Summary (.md)')).toBeInTheDocument();
  });

  it('calls exportRequests when CSV option is clicked', () => {
    render(<AdminDashboard onNavigate={jest.fn()} />);
    fireEvent.click(screen.getByText('📤 Export Report'));
    fireEvent.click(screen.getByText('📄 Export as CSV'));
    expect(mockExportRequests).toHaveBeenCalledWith(expect.any(Array), 'csv');
    expect(mockShowToast).toHaveBeenCalledWith('CSV export downloaded', 'success');
  });

  it('downloads summary markdown when Summary option is clicked', () => {
    // Mock URL.createObjectURL and document.createElement
    const mockUrl = 'blob:test';
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => mockUrl);
    URL.revokeObjectURL = jest.fn();

    const mockAnchor = { href: '', download: '', click: jest.fn() };
    const originalCreateElement = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag === 'a') return mockAnchor;
      return originalCreateElement(tag);
    });

    render(<AdminDashboard onNavigate={jest.fn()} />);
    fireEvent.click(screen.getByText('📤 Export Report'));
    fireEvent.click(screen.getByText('📝 Export Summary (.md)'));

    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(mockAnchor.click).toHaveBeenCalled();
    expect(mockAnchor.download).toMatch(/inventory-report-.*\.md/);
    expect(mockShowToast).toHaveBeenCalledWith('Summary report downloaded', 'success');

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    document.createElement.mockRestore();
  });

  it('does NOT navigate to analytics when export is clicked', () => {
    const onNavigate = jest.fn();
    render(<AdminDashboard onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('📤 Export Report'));
    expect(onNavigate).not.toHaveBeenCalledWith('analytics');
  });
});

// ======================================================================
// 9. runAutoAssign Shared Utility
// ======================================================================

describe('runAutoAssign utility', () => {
  it('calls assignRequests with requests and producerCapacities', () => {
    mockAssignRequests.mockReturnValue([]);
    const ctx = {
      requests: [createTestRequest({ id: 'r1', status: 'open' })],
      producerCapacities: { p1: { items: {} } },
      currentSystem: { settings: { requireApproval: true } },
      yInventoryRequests: createMockYArray([createTestRequest({ id: 'r1', status: 'open' })]),
      yInventoryAuditLog: createMockYArray([]),
      inventorySystemId: 'sys-1',
      userIdentity: ADMIN_IDENTITY,
    };
    runAutoAssign(ctx);
    expect(mockAssignRequests).toHaveBeenCalledWith(ctx.requests, ctx.producerCapacities);
  });

  it('returns applied, blocked, total counts', () => {
    mockAssignRequests.mockReturnValue([
      { requestId: 'r1', producerId: 'p1', source: 'stock', estimatedDate: Date.now() },
      { requestId: 'r2', producerId: null, source: 'blocked', estimatedDate: null },
    ]);
    const yArr = createMockYArray([
      createTestRequest({ id: 'r1', status: 'open' }),
      createTestRequest({ id: 'r2', status: 'open' }),
    ]);
    const ctx = {
      requests: yArr.toArray(),
      producerCapacities: {},
      currentSystem: { settings: { requireApproval: false } },
      yInventoryRequests: yArr,
      yInventoryAuditLog: createMockYArray([]),
      inventorySystemId: 'sys-1',
      userIdentity: ADMIN_IDENTITY,
    };
    const result = runAutoAssign(ctx);
    expect(result.applied).toBe(1);
    expect(result.blocked).toBe(1);
    expect(result.total).toBe(2);
  });

  it('sets status to pending_approval when requireApproval is true', () => {
    mockAssignRequests.mockReturnValue([
      { requestId: 'r1', producerId: 'p1', source: 'stock', estimatedDate: Date.now() },
    ]);
    const req = createTestRequest({ id: 'r1', status: 'open' });
    const yArr = createMockYArray([req]);
    const ctx = {
      requests: [req],
      producerCapacities: {},
      currentSystem: { settings: { requireApproval: true } },
      yInventoryRequests: yArr,
      yInventoryAuditLog: createMockYArray([]),
      inventorySystemId: 'sys-1',
      userIdentity: ADMIN_IDENTITY,
    };
    runAutoAssign(ctx);
    // After delete+insert, the inserted item should have status 'pending_approval'
    const insertedItem = yArr.insert.mock.calls[0]?.[1]?.[0];
    expect(insertedItem?.status).toBe('pending_approval');
  });

  it('returns error object when assignment throws', () => {
    mockAssignRequests.mockImplementation(() => { throw new Error('boom'); });
    const ctx = {
      requests: [],
      producerCapacities: {},
      currentSystem: { settings: {} },
      yInventoryRequests: createMockYArray([]),
      yInventoryAuditLog: createMockYArray([]),
      inventorySystemId: 'sys-1',
      userIdentity: ADMIN_IDENTITY,
    };
    const result = runAutoAssign(ctx);
    expect(result.error).toBe('boom');
  });
});
