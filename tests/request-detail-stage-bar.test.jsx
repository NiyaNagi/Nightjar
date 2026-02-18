/**
 * tests/request-detail-stage-bar.test.jsx
 *
 * Comprehensive tests for the redesigned RequestDetail component with
 * interactive stage bar, status banner, grouped sections, and free
 * backward/forward transitions between Approved ↔ In Progress ↔ Shipped.
 *
 * Test categories:
 *   §1 — UI: Status banner rendering
 *   §2 — UI: Grouped sections (Request Info, Location, People, Shipping)
 *   §3 — Stage bar rendering & interaction (admin)
 *   §4 — Stage bar rendering & interaction (producer)
 *   §5 — Stage bar read-only (requestor)
 *   §6 — Stage bar hidden for non-stage statuses
 *   §7 — Backward transitions (revert)
 *   §8 — Forward transitions
 *   §9 — Address reveal lifecycle (persists through ship, deleted on terminal)
 *   §10 — Notifications on all transitions (admin, producer)
 *   §11 — Timeline rendering for non-stage statuses
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  createMockYMap,
  createMockYArray,
  createTestRequest,
  createTestCatalogItem,
} from './helpers/inventory-test-utils';

// ============================================================
// Mocks
// ============================================================

jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }) => <div>{typeof children === 'function' ? children(400, 200) : children}</div>,
  LineChart: ({ children }) => <div>{children}</div>,
  Line: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
}));

let mockCtx;
let mockSyncResult;

jest.mock('../frontend/src/contexts/InventoryContext', () => ({
  useInventory: jest.fn(() => ({ ...mockCtx, ...mockSyncResult })),
}));

jest.mock('../frontend/src/contexts/ToastContext', () => ({
  useToast: jest.fn(() => ({ showToast: jest.fn(), dismissToast: jest.fn() })),
}));

jest.mock('../frontend/src/hooks/useInventorySync', () => {
  const fn = jest.fn(() => mockSyncResult);
  fn.default = fn;
  return { __esModule: true, default: fn, useInventorySync: fn };
});

jest.mock('../frontend/src/utils/inventoryValidation', () => ({
  ...jest.requireActual('../frontend/src/utils/inventoryValidation'),
  generateId: jest.fn(() => 'mock-id-' + Math.random().toString(36).slice(2, 8)),
}));

jest.mock('../frontend/src/utils/inventoryAssignment', () => ({
  estimateFulfillment: jest.fn(() => ({ source: 'stock', estimatedDate: null })),
  validateClaim: jest.fn(() => ({ ok: true })),
}));

jest.mock('../frontend/src/services/p2p/protocol/serialization', () => ({
  encodeBase64: (bytes) => Buffer.from(bytes).toString('base64'),
  decodeBase64: (str) => new Uint8Array(Buffer.from(str, 'base64')),
}));

jest.mock('../frontend/src/utils/identity', () => ({
  base62ToUint8: (str, len) => new Uint8Array(len || 32).fill(42),
  uint8ToBase62: (bytes) => 'mockBase62Key',
}));

const mockDecryptAddressReveal = jest.fn(() =>
  Promise.resolve({
    fullName: 'Jane Doe',
    street1: '456 Oak Ave',
    city: 'Portland',
    state: 'OR',
    zipCode: '97201',
  })
);

jest.mock('../frontend/src/utils/addressCrypto', () => ({
  getPublicKeyHex: jest.fn(() => 'admin-pub-hex'),
  base62ToPublicKeyHex: jest.fn(() => 'producer-pub-hex'),
  createAddressReveal: jest.fn(() => Promise.resolve({ ciphertext: 'enc', nonce: 'nonce', encryptedBy: 'admin-pub-hex', revealedAt: Date.now() })),
  decryptPendingAddress: jest.fn(() => Promise.resolve(null)),
  decryptAddressReveal: (...args) => mockDecryptAddressReveal(...args),
}));

jest.mock('../frontend/src/utils/inventoryAddressStore', () => ({
  getAddress: jest.fn(() => Promise.resolve(null)),
  getWorkspaceKeyMaterial: jest.fn(() => 'mock-key-material'),
  storeAddress: jest.fn(() => Promise.resolve()),
}));

jest.mock('../frontend/src/utils/inventoryNotifications', () => ({
  pushNotification: jest.fn(),
  getUnreadCount: jest.fn(() => 0),
}));

jest.mock('../frontend/src/utils/trackingLinks', () => ({
  parseTrackingNumber: jest.fn((num) => num ? { carrier: 'UPS', icon: '📦', url: `https://track.ups.com/${num}` } : null),
  genericTrackingUrl: jest.fn((num) => `https://track.example.com/${num}`),
}));

jest.mock('../frontend/src/hooks/useCopyFeedback', () => ({
  useCopyFeedback: () => ({ copied: false, copyToClipboard: jest.fn() }),
}));

jest.mock('../frontend/src/utils/shippingProviders', () => ({
  SHIPPING_PROVIDERS: [],
  formatAddressForCopy: jest.fn((addr) => `${addr.fullName}\n${addr.street1}\n${addr.city}, ${addr.state} ${addr.zipCode}`),
  getEnabledProviders: jest.fn(() => []),
  getAllProviderIds: jest.fn(() => []),
}));

// ============================================================
// Setup
// ============================================================

beforeEach(() => {
  jest.clearAllMocks();

  const yRequests = createMockYArray([]);
  const yAudit = createMockYArray([]);
  const yReveals = createMockYMap({});
  const yNotifications = createMockYArray([]);

  mockCtx = {
    yInventoryRequests: yRequests,
    yInventoryAuditLog: yAudit,
    yAddressReveals: yReveals,
    yInventoryNotifications: yNotifications,
    yPendingAddresses: createMockYMap({}),
    inventorySystemId: 'sys1',
    workspaceId: 'ws1',
    currentWorkspace: { password: 'test-pw' },
    collaborators: [
      { publicKey: 'adminKey', publicKeyBase62: 'adminKey', name: 'Alice Admin', displayName: 'Alice Admin', permission: 'owner', isOnline: true },
      { publicKey: 'producerKey', publicKeyBase62: 'producerKey', name: 'Bob Producer', displayName: 'Bob Producer', permission: 'editor', isOnline: true },
      { publicKey: 'requestorKey', publicKeyBase62: 'requestorKey', name: 'Carol Requestor', displayName: 'Carol Requestor', permission: 'viewer', isOnline: true },
    ],
    userIdentity: { publicKeyBase62: 'adminKey', displayName: 'Alice Admin', curveSecretKey: new Uint8Array(32), name: 'Alice Admin' },
    onStartChatWith: jest.fn(),
  };

  mockSyncResult = {
    currentSystem: { name: 'Test System', id: 'sys1', settings: {} },
    inventorySystems: [{ name: 'Test System', id: 'sys1' }],
    catalogItems: [createTestCatalogItem({ id: 'cat1', name: 'Widget', unit: 'units', inventorySystemId: 'sys1' })],
    requests: [],
    producerCapacities: {},
    addressReveals: {},
    pendingAddresses: {},
    auditLog: [],
  };
});

// ============================================================
// Import (after mocks)
// ============================================================
const RequestDetail = require('../frontend/src/components/inventory/common/RequestDetail').default;
const { pushNotification } = require('../frontend/src/utils/inventoryNotifications');

// ============================================================
// Helpers
// ============================================================

function makeRequest(overrides = {}) {
  return createTestRequest({
    id: 'req-stage-1',
    inventorySystemId: 'sys1',
    catalogItemId: 'cat1',
    catalogItemName: 'Widget',
    requestedBy: 'requestorKey',
    assignedTo: 'producerKey',
    requestedAt: Date.now() - 86400000 * 5,
    assignedAt: Date.now() - 86400000 * 4,
    approvedAt: Date.now() - 86400000 * 3,
    ...overrides,
  });
}

function renderDetail(props = {}) {
  const defaults = {
    request: makeRequest({ status: 'approved' }),
    isAdmin: false,
    isProducer: false,
    collaborators: mockCtx.collaborators,
    onClose: jest.fn(),
    onApprove: jest.fn(),
    onReject: jest.fn(),
    onReassign: jest.fn(),
    onCancel: jest.fn(),
    onMarkShipped: jest.fn(),
    onMarkInProgress: jest.fn(),
    onRevertToApproved: jest.fn(),
    onRevertToInProgress: jest.fn(),
  };
  return render(<RequestDetail {...defaults} {...props} />);
}

// ============================================================
// §1 — Status banner rendering
// ============================================================

describe('§1 — Status banner', () => {
  it('renders status banner with correct status class for approved', () => {
    renderDetail({ request: makeRequest({ status: 'approved' }) });
    const banner = document.querySelector('.request-detail__status-banner--approved');
    expect(banner).toBeInTheDocument();
  });

  it('renders status banner for in_progress', () => {
    renderDetail({ request: makeRequest({ status: 'in_progress', inProgressAt: Date.now() }) });
    const banner = document.querySelector('.request-detail__status-banner--in_progress');
    expect(banner).toBeInTheDocument();
  });

  it('renders status banner for shipped', () => {
    renderDetail({ request: makeRequest({ status: 'shipped', shippedAt: Date.now() }) });
    const banner = document.querySelector('.request-detail__status-banner--shipped');
    expect(banner).toBeInTheDocument();
  });

  it('renders urgent flag in banner when request is urgent', () => {
    renderDetail({ request: makeRequest({ status: 'approved', urgent: true }) });
    expect(screen.getByText('⚡ Urgent')).toBeInTheDocument();
  });

  it('does not render urgent flag for non-urgent requests', () => {
    renderDetail({ request: makeRequest({ status: 'approved', urgent: false }) });
    expect(screen.queryByText('⚡ Urgent')).not.toBeInTheDocument();
  });

  it('renders status banner for open status', () => {
    renderDetail({ request: makeRequest({ status: 'open', approvedAt: null, assignedTo: null, assignedAt: null }) });
    const banner = document.querySelector('.request-detail__status-banner--open');
    expect(banner).toBeInTheDocument();
  });

  it('renders status banner for cancelled status', () => {
    renderDetail({ request: makeRequest({ status: 'cancelled' }) });
    const banner = document.querySelector('.request-detail__status-banner--cancelled');
    expect(banner).toBeInTheDocument();
  });
});

// ============================================================
// §2 — Grouped sections
// ============================================================

describe('§2 — Grouped sections', () => {
  it('renders Request Info section with item and quantity', () => {
    renderDetail({ request: makeRequest({ status: 'approved', quantity: 42 }) });
    expect(screen.getByText('Request Info')).toBeInTheDocument();
    expect(screen.getByText('Widget')).toBeInTheDocument();
    expect(screen.getByText('42 units')).toBeInTheDocument();
  });

  it('renders Location section with city/state', () => {
    renderDetail({ request: makeRequest({ status: 'approved', city: 'Denver', state: 'CO' }) });
    expect(screen.getByText('Location')).toBeInTheDocument();
    expect(screen.getByText('Denver, CO')).toBeInTheDocument();
  });

  it('renders People section with requestor name', () => {
    renderDetail({ request: makeRequest({ status: 'approved' }) });
    expect(screen.getByText('People')).toBeInTheDocument();
    // requestedBy = 'requestorKey' → resolves to 'Carol Requestor'
    expect(screen.getByText(/Carol Requestor/)).toBeInTheDocument();
  });

  it('renders assigned producer name in People section', () => {
    renderDetail({ request: makeRequest({ status: 'approved', assignedTo: 'producerKey' }) });
    expect(screen.getByText(/Bob Producer/)).toBeInTheDocument();
  });

  it('renders notes in Request Info section when present', () => {
    renderDetail({ request: makeRequest({ status: 'approved', notes: 'Rush order please' }) });
    expect(screen.getByText('Rush order please')).toBeInTheDocument();
  });

  it('renders tracking number in Shipping section when present', () => {
    renderDetail({ request: makeRequest({ status: 'shipped', shippedAt: Date.now(), trackingNumber: '1Z999AA10123456784' }) });
    expect(screen.getByText('Shipping')).toBeInTheDocument();
    expect(screen.getByText(/1Z999AA10123456784/)).toBeInTheDocument();
  });
});

// ============================================================
// §3 — Stage bar rendering & interaction (admin)
// ============================================================

describe('§3 — Stage bar (admin)', () => {
  it('renders stage bar for approved status when isAdmin=true', () => {
    renderDetail({ request: makeRequest({ status: 'approved' }), isAdmin: true });
    expect(screen.getByTestId('stage-bar')).toBeInTheDocument();
    expect(screen.getByTestId('stage-btn-approved')).toBeInTheDocument();
    expect(screen.getByTestId('stage-btn-in_progress')).toBeInTheDocument();
    expect(screen.getByTestId('stage-btn-shipped')).toBeInTheDocument();
  });

  it('highlights the current stage as active', () => {
    renderDetail({ request: makeRequest({ status: 'in_progress', inProgressAt: Date.now() }), isAdmin: true });
    const activeBtn = screen.getByTestId('stage-btn-in_progress');
    expect(activeBtn).toHaveClass('stage-btn--active');
    expect(activeBtn).toHaveAttribute('aria-current', 'step');
  });

  it('marks past stages correctly', () => {
    renderDetail({ request: makeRequest({ status: 'in_progress', inProgressAt: Date.now() }), isAdmin: true });
    const pastBtn = screen.getByTestId('stage-btn-approved');
    expect(pastBtn).toHaveClass('stage-btn--past');
  });

  it('marks future stages correctly', () => {
    renderDetail({ request: makeRequest({ status: 'approved' }), isAdmin: true });
    const futureBtn = screen.getByTestId('stage-btn-shipped');
    expect(futureBtn).toHaveClass('stage-btn--future');
  });

  it('active stage button is disabled', () => {
    renderDetail({ request: makeRequest({ status: 'approved' }), isAdmin: true });
    expect(screen.getByTestId('stage-btn-approved')).toBeDisabled();
  });

  it('non-active stage buttons are enabled for admin', () => {
    renderDetail({ request: makeRequest({ status: 'approved' }), isAdmin: true });
    expect(screen.getByTestId('stage-btn-in_progress')).toBeEnabled();
    expect(screen.getByTestId('stage-btn-shipped')).toBeEnabled();
  });

  it('clicking "In Progress" calls onMarkInProgress for admin', () => {
    const onMarkInProgress = jest.fn();
    const req = makeRequest({ status: 'approved' });
    renderDetail({ request: req, isAdmin: true, onMarkInProgress });
    fireEvent.click(screen.getByTestId('stage-btn-in_progress'));
    expect(onMarkInProgress).toHaveBeenCalledWith(req);
  });

  it('clicking "Shipped" calls onMarkShipped for admin', () => {
    const onMarkShipped = jest.fn();
    const req = makeRequest({ status: 'approved' });
    renderDetail({ request: req, isAdmin: true, onMarkShipped });
    fireEvent.click(screen.getByTestId('stage-btn-shipped'));
    expect(onMarkShipped).toHaveBeenCalledWith(req, '');
  });
});

// ============================================================
// §4 — Stage bar (producer)
// ============================================================

describe('§4 — Stage bar (producer)', () => {
  it('renders interactive stage bar for producer', () => {
    mockCtx.userIdentity = { publicKeyBase62: 'producerKey', displayName: 'Bob Producer', curveSecretKey: new Uint8Array(32) };
    renderDetail({ request: makeRequest({ status: 'approved' }), isProducer: true });
    expect(screen.getByTestId('stage-bar')).toBeInTheDocument();
    expect(screen.getByTestId('stage-btn-in_progress')).toBeEnabled();
  });

  it('clicking "In Progress" calls onMarkInProgress for producer', () => {
    mockCtx.userIdentity = { publicKeyBase62: 'producerKey', displayName: 'Bob Producer', curveSecretKey: new Uint8Array(32) };
    const onMarkInProgress = jest.fn();
    const req = makeRequest({ status: 'approved' });
    renderDetail({ request: req, isProducer: true, onMarkInProgress });
    fireEvent.click(screen.getByTestId('stage-btn-in_progress'));
    expect(onMarkInProgress).toHaveBeenCalledWith(req);
  });

  it('clicking "Approved" from in_progress calls onRevertToApproved for producer', () => {
    mockCtx.userIdentity = { publicKeyBase62: 'producerKey', displayName: 'Bob Producer', curveSecretKey: new Uint8Array(32) };
    const onRevertToApproved = jest.fn();
    const req = makeRequest({ status: 'in_progress', inProgressAt: Date.now() });
    renderDetail({ request: req, isProducer: true, onRevertToApproved });
    fireEvent.click(screen.getByTestId('stage-btn-approved'));
    expect(onRevertToApproved).toHaveBeenCalledWith(req);
  });
});

// ============================================================
// §5 — Stage bar read-only (requestor)
// ============================================================

describe('§5 — Stage bar read-only (requestor)', () => {
  it('renders stage bar for requestor (isAdmin=false, isProducer=false)', () => {
    renderDetail({ request: makeRequest({ status: 'approved' }), isAdmin: false, isProducer: false });
    expect(screen.getByTestId('stage-bar')).toBeInTheDocument();
  });

  it('all stage buttons are disabled for requestor', () => {
    renderDetail({ request: makeRequest({ status: 'approved' }), isAdmin: false, isProducer: false });
    expect(screen.getByTestId('stage-btn-approved')).toBeDisabled();
    expect(screen.getByTestId('stage-btn-in_progress')).toBeDisabled();
    expect(screen.getByTestId('stage-btn-shipped')).toBeDisabled();
  });

  it('clicking disabled stage button does not call any handler', () => {
    const onMarkInProgress = jest.fn();
    const onRevertToApproved = jest.fn();
    renderDetail({ request: makeRequest({ status: 'approved' }), isAdmin: false, isProducer: false, onMarkInProgress, onRevertToApproved });
    fireEvent.click(screen.getByTestId('stage-btn-in_progress'));
    fireEvent.click(screen.getByTestId('stage-btn-shipped'));
    expect(onMarkInProgress).not.toHaveBeenCalled();
    expect(onRevertToApproved).not.toHaveBeenCalled();
  });
});

// ============================================================
// §6 — Stage bar hidden for non-stage statuses
// ============================================================

describe('§6 — Stage bar hidden', () => {
  const nonStageStatuses = ['open', 'claimed', 'pending_approval', 'delivered', 'cancelled', 'blocked'];

  nonStageStatuses.forEach(status => {
    it(`does not render stage bar for "${status}" status`, () => {
      const overrides = { status };
      if (status !== 'open') overrides.assignedTo = 'producerKey';
      renderDetail({ request: makeRequest(overrides), isAdmin: true });
      expect(screen.queryByTestId('stage-bar')).not.toBeInTheDocument();
    });
  });
});

// ============================================================
// §7 — Backward transitions (revert)
// ============================================================

describe('§7 — Backward transitions', () => {
  it('admin can revert from shipped to in_progress', () => {
    const onRevertToInProgress = jest.fn();
    const req = makeRequest({ status: 'shipped', shippedAt: Date.now(), inProgressAt: Date.now() - 86400000 });
    renderDetail({ request: req, isAdmin: true, onRevertToInProgress });
    fireEvent.click(screen.getByTestId('stage-btn-in_progress'));
    expect(onRevertToInProgress).toHaveBeenCalledWith(req);
  });

  it('admin can revert from shipped to approved', () => {
    const onRevertToApproved = jest.fn();
    const req = makeRequest({ status: 'shipped', shippedAt: Date.now() });
    renderDetail({ request: req, isAdmin: true, onRevertToApproved });
    fireEvent.click(screen.getByTestId('stage-btn-approved'));
    expect(onRevertToApproved).toHaveBeenCalledWith(req);
  });

  it('admin can revert from in_progress to approved', () => {
    const onRevertToApproved = jest.fn();
    const req = makeRequest({ status: 'in_progress', inProgressAt: Date.now() });
    renderDetail({ request: req, isAdmin: true, onRevertToApproved });
    fireEvent.click(screen.getByTestId('stage-btn-approved'));
    expect(onRevertToApproved).toHaveBeenCalledWith(req);
  });

  it('producer can revert from shipped to in_progress', () => {
    mockCtx.userIdentity = { publicKeyBase62: 'producerKey', displayName: 'Bob Producer', curveSecretKey: new Uint8Array(32) };
    const onRevertToInProgress = jest.fn();
    const req = makeRequest({ status: 'shipped', shippedAt: Date.now() });
    renderDetail({ request: req, isProducer: true, onRevertToInProgress });
    fireEvent.click(screen.getByTestId('stage-btn-in_progress'));
    expect(onRevertToInProgress).toHaveBeenCalledWith(req);
  });

  it('producer can revert from shipped to approved', () => {
    mockCtx.userIdentity = { publicKeyBase62: 'producerKey', displayName: 'Bob Producer', curveSecretKey: new Uint8Array(32) };
    const onRevertToApproved = jest.fn();
    const req = makeRequest({ status: 'shipped', shippedAt: Date.now() });
    renderDetail({ request: req, isProducer: true, onRevertToApproved });
    fireEvent.click(screen.getByTestId('stage-btn-approved'));
    expect(onRevertToApproved).toHaveBeenCalledWith(req);
  });
});

// ============================================================
// §8 — Forward transitions
// ============================================================

describe('§8 — Forward transitions', () => {
  it('admin can move from approved to shipped (skip in_progress)', () => {
    const onMarkShipped = jest.fn();
    const req = makeRequest({ status: 'approved' });
    renderDetail({ request: req, isAdmin: true, onMarkShipped });
    fireEvent.click(screen.getByTestId('stage-btn-shipped'));
    expect(onMarkShipped).toHaveBeenCalledWith(req, '');
  });

  it('admin can move from in_progress to shipped', () => {
    const onMarkShipped = jest.fn();
    const req = makeRequest({ status: 'in_progress', inProgressAt: Date.now() });
    renderDetail({ request: req, isAdmin: true, onMarkShipped });
    fireEvent.click(screen.getByTestId('stage-btn-shipped'));
    expect(onMarkShipped).toHaveBeenCalledWith(req, '');
  });

  it('producer can move from approved to in_progress', () => {
    mockCtx.userIdentity = { publicKeyBase62: 'producerKey', displayName: 'Bob Producer', curveSecretKey: new Uint8Array(32) };
    const onMarkInProgress = jest.fn();
    const req = makeRequest({ status: 'approved' });
    renderDetail({ request: req, isProducer: true, onMarkInProgress });
    fireEvent.click(screen.getByTestId('stage-btn-in_progress'));
    expect(onMarkInProgress).toHaveBeenCalledWith(req);
  });
});

// ============================================================
// §9 — Address reveal lifecycle
// ============================================================

describe('§9 — Address reveal lifecycle', () => {
  it('address reveal persists when request moves to shipped (no delete on ship)', () => {
    const yReveals = createMockYMap({ 'req-stage-1': { ciphertext: 'enc', nonce: 'n', inventorySystemId: 'sys1' } });
    mockCtx.yAddressReveals = yReveals;
    mockSyncResult.addressReveals = { 'req-stage-1': { ciphertext: 'enc', nonce: 'n', inventorySystemId: 'sys1' } };
    mockCtx.userIdentity = { publicKeyBase62: 'producerKey', displayName: 'Bob Producer', curveSecretKey: new Uint8Array(32) };

    const req = makeRequest({ status: 'shipped', shippedAt: Date.now() });
    renderDetail({ request: req, isProducer: true });

    // The reveal should NOT have been deleted
    expect(yReveals.delete).not.toHaveBeenCalledWith('req-stage-1');
  });

  it('producer can still decrypt address reveal when status is shipped', async () => {
    const reveal = { ciphertext: 'enc', nonce: 'n', encryptedBy: 'admin-pub-hex', inventorySystemId: 'sys1' };
    mockCtx.userIdentity = { publicKeyBase62: 'producerKey', displayName: 'Bob Producer', curveSecretKey: new Uint8Array(32) };
    mockSyncResult.addressReveals = { 'req-stage-1': reveal };

    const req = makeRequest({ status: 'shipped', shippedAt: Date.now() });
    renderDetail({ request: req, isProducer: true });

    // decryptAddressReveal should have been called for shipped status too
    await waitFor(() => {
      expect(mockDecryptAddressReveal).toHaveBeenCalled();
    });
  });
});

// ============================================================
// §10 — Notifications on transitions (functional tests using AllRequests)
// ============================================================

describe('§10 — Admin handler notifications (AllRequests)', () => {
  const AllRequests = require('../frontend/src/components/inventory/admin/AllRequests').default;

  it('handleMarkInProgress notifies requestor and producer', async () => {
    const req = makeRequest({ status: 'approved', assignedTo: 'producerKey', requestedBy: 'requestorKey' });
    mockSyncResult.requests = [req];
    mockCtx.yInventoryRequests = createMockYArray([req]);

    render(<AllRequests />);
    // Click to expand row — slice(4,10) of 'req-stage-1' = 'stage-'
    const row = screen.getByText(/#stage-/);
    fireEvent.click(row);

    await waitFor(() => {
      expect(screen.getByTestId('stage-bar')).toBeInTheDocument();
    });

    // Click "In Progress" in stage bar
    fireEvent.click(screen.getByTestId('stage-btn-in_progress'));

    await waitFor(() => {
      expect(pushNotification).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ recipientId: 'requestorKey', type: 'request_in_progress' })
      );
      expect(pushNotification).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ recipientId: 'producerKey', type: 'request_in_progress' })
      );
    });
  });

  it('handleRevertToApproved notifies both requestor and producer', async () => {
    const req = makeRequest({ status: 'in_progress', inProgressAt: Date.now(), assignedTo: 'producerKey', requestedBy: 'requestorKey' });
    mockSyncResult.requests = [req];
    mockCtx.yInventoryRequests = createMockYArray([req]);

    render(<AllRequests />);
    const row = screen.getByText(/#stage-/);
    fireEvent.click(row);

    await waitFor(() => {
      expect(screen.getByTestId('stage-bar')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('stage-btn-approved'));

    await waitFor(() => {
      expect(pushNotification).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ recipientId: 'requestorKey', type: 'status_change' })
      );
      expect(pushNotification).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ recipientId: 'producerKey', type: 'status_change' })
      );
    });
  });

  it('handleRevertToInProgress notifies both requestor and producer', async () => {
    const req = makeRequest({ status: 'shipped', shippedAt: Date.now(), assignedTo: 'producerKey', requestedBy: 'requestorKey' });
    mockSyncResult.requests = [req];
    mockCtx.yInventoryRequests = createMockYArray([req]);

    render(<AllRequests />);
    const row = screen.getByText(/#stage-/);
    fireEvent.click(row);

    await waitFor(() => {
      expect(screen.getByTestId('stage-bar')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('stage-btn-in_progress'));

    await waitFor(() => {
      expect(pushNotification).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ recipientId: 'requestorKey', type: 'status_change' })
      );
      expect(pushNotification).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ recipientId: 'producerKey', type: 'status_change' })
      );
    });
  });
});

// ============================================================
// §11 — Timeline rendering for non-stage statuses
// ============================================================

describe('§11 — Timeline for non-stage statuses', () => {
  it('renders read-only timeline for open status', () => {
    const req = makeRequest({ status: 'open', approvedAt: null, assignedTo: null, assignedAt: null });
    renderDetail({ request: req });
    // Should show Timeline heading (not stage bar)
    expect(screen.queryByTestId('stage-bar')).not.toBeInTheDocument();
    expect(screen.getByText('Timeline')).toBeInTheDocument();
  });

  it('renders read-only timeline for delivered status', () => {
    const req = makeRequest({
      status: 'delivered',
      shippedAt: Date.now() - 86400000,
      deliveredAt: Date.now(),
    });
    renderDetail({ request: req });
    expect(screen.queryByTestId('stage-bar')).not.toBeInTheDocument();
    expect(screen.getByText('Timeline')).toBeInTheDocument();
    // 'Delivered' appears in both StatusBadge and timeline step
    expect(screen.getAllByText(/delivered/i).length).toBeGreaterThanOrEqual(1);
  });

  it('renders read-only timeline for cancelled status', () => {
    const req = makeRequest({ status: 'cancelled' });
    renderDetail({ request: req });
    expect(screen.queryByTestId('stage-bar')).not.toBeInTheDocument();
  });
});

// ============================================================
// §12 — Admin notes and actions
// ============================================================

describe('§12 — Admin notes and action buttons', () => {
  it('renders admin notes textarea when isAdmin=true', () => {
    renderDetail({ request: makeRequest({ status: 'approved' }), isAdmin: true });
    expect(screen.getByText('Admin Notes')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Internal notes...')).toBeInTheDocument();
  });

  it('does not render admin notes when isAdmin=false', () => {
    renderDetail({ request: makeRequest({ status: 'approved' }), isAdmin: false });
    expect(screen.queryByText('Admin Notes')).not.toBeInTheDocument();
  });

  it('renders approve/reject buttons for pending_approval status as admin', () => {
    renderDetail({ request: makeRequest({ status: 'pending_approval' }), isAdmin: true });
    expect(screen.getByText('✓ Approve')).toBeInTheDocument();
    expect(screen.getByText('✗ Reject')).toBeInTheDocument();
  });

  it('renders cancel button for early statuses', () => {
    renderDetail({ request: makeRequest({ status: 'open', approvedAt: null, assignedTo: null, assignedAt: null }) });
    expect(screen.getByText('Cancel Request')).toBeInTheDocument();
  });

  it('does not render cancel button for shipped status', () => {
    renderDetail({ request: makeRequest({ status: 'shipped', shippedAt: Date.now() }) });
    expect(screen.queryByText('Cancel Request')).not.toBeInTheDocument();
  });
});

// ============================================================
// §13 — data-testid and a11y
// ============================================================

describe('§13 — Accessibility & test IDs', () => {
  it('request-detail has data-testid', () => {
    renderDetail({ request: makeRequest({ status: 'approved' }) });
    expect(screen.getByTestId('request-detail')).toBeInTheDocument();
  });

  it('stage bar has role="group" with aria-label', () => {
    renderDetail({ request: makeRequest({ status: 'approved' }), isAdmin: true });
    const bar = screen.getByTestId('stage-bar');
    expect(bar).toHaveAttribute('role', 'group');
    expect(bar).toHaveAttribute('aria-label', 'Fulfillment stage');
  });

  it('close button has aria-label', () => {
    renderDetail({ request: makeRequest({ status: 'approved' }) });
    expect(screen.getByLabelText('Close')).toBeInTheDocument();
  });
});
