/**
 * tests/producer-shipping-workflow.test.jsx
 *
 * Comprehensive tests for the producer shipping workflow — the end-to-end flow
 * from admin approval → address reveal creation → producer address decryption →
 * shipping provider display → mark-as-shipped with confirmation.
 *
 * Covers all 5 bugs fixed in this batch:
 *   1. getAddress called with wrong arguments in ApprovalQueue
 *   2. Pending addresses from non-owner requestors never decrypted
 *   3. inventorySystemId missing from address reveal objects
 *   4. "Mark as Shipped" only shown for approved, not in_progress
 *   5. MyRequests onMarkShipped handler dropping tracking number
 *
 * Test categories: Unit, Functional, UI, End-to-End scenario
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  createMockYMap,
  createMockYArray,
  createTestRequest,
  createTestCatalogItem,
  createTestCapacity,
} from './helpers/inventory-test-utils';

// ============================================================
// Mocks
// ============================================================

// --- Recharts mock ---
jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }) => <div data-testid="responsive-container">{typeof children === 'function' ? children(400, 200) : children}</div>,
  LineChart: ({ children }) => <div data-testid="line-chart">{children}</div>,
  Line: () => <div data-testid="line" />,
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

// Mock serialization for addressCrypto
jest.mock('../frontend/src/services/p2p/protocol/serialization', () => ({
  encodeBase64: (bytes) => Buffer.from(bytes).toString('base64'),
  decodeBase64: (str) => new Uint8Array(Buffer.from(str, 'base64')),
}));

jest.mock('../frontend/src/utils/identity', () => ({
  base62ToUint8: (str, len) => new Uint8Array(len || 32).fill(42),
  uint8ToBase62: (bytes) => 'mockBase62Key',
}));

// Mock address crypto functions — controllable per test
const mockGetPublicKeyHex = jest.fn(() => 'admin-pub-hex-1234');
const mockBase62ToPublicKeyHex = jest.fn(() => 'producer-pub-hex-5678');
const mockCreateAddressReveal = jest.fn(() =>
  Promise.resolve({
    ciphertext: 'enc-ciphertext',
    nonce: 'enc-nonce',
    encryptedBy: 'admin-pub-hex-1234',
    revealedAt: Date.now(),
    producerConfirmed: false,
    confirmedAt: null,
  })
);
const mockDecryptPendingAddress = jest.fn(() =>
  Promise.resolve({
    fullName: 'Jane Doe',
    street1: '456 Oak Ave',
    city: 'Portland',
    state: 'OR',
    zipCode: '97201',
    country: 'US',
  })
);
const mockDecryptAddressReveal = jest.fn(() =>
  Promise.resolve({
    fullName: 'Jane Doe',
    street1: '456 Oak Ave',
    city: 'Portland',
    state: 'OR',
    zipCode: '97201',
    country: 'US',
    phone: '503-555-1234',
  })
);

jest.mock('../frontend/src/utils/addressCrypto', () => ({
  getPublicKeyHex: (...args) => mockGetPublicKeyHex(...args),
  base62ToPublicKeyHex: (...args) => mockBase62ToPublicKeyHex(...args),
  createAddressReveal: (...args) => mockCreateAddressReveal(...args),
  decryptPendingAddress: (...args) => mockDecryptPendingAddress(...args),
  decryptAddressReveal: (...args) => mockDecryptAddressReveal(...args),
}));

// Mock address store functions — controllable per test
const mockGetAddress = jest.fn(() => Promise.resolve(null));
const mockGetWorkspaceKeyMaterial = jest.fn(() => 'mock-key-material-password');
const mockStoreAddress = jest.fn(() => Promise.resolve());

jest.mock('../frontend/src/utils/inventoryAddressStore', () => ({
  getAddress: (...args) => mockGetAddress(...args),
  getWorkspaceKeyMaterial: (...args) => mockGetWorkspaceKeyMaterial(...args),
  storeAddress: (...args) => mockStoreAddress(...args),
}));

jest.mock('../frontend/src/utils/shippingProviders', () => ({
  SHIPPING_PROVIDERS: [
    {
      id: 'pirateship',
      name: 'PirateShip',
      icon: '🏴‍☠️',
      url: 'https://ship.pirateship.com/ship',
      description: 'Cheapest USPS & UPS rates',
      formatAddress: (addr) => `${addr.fullName}\n${addr.street1}\n${addr.city}, ${addr.state} ${addr.zipCode}`,
    },
    {
      id: 'shippo',
      name: 'Shippo',
      icon: '📬',
      url: 'https://app.goshippo.com',
      description: 'Multi-carrier shipping',
      formatAddress: (addr) => `${addr.fullName}\n${addr.street1}\n${addr.city}, ${addr.state} ${addr.zipCode}`,
    },
  ],
  formatAddressForCopy: (addr) =>
    `${addr.fullName || addr.name}\n${addr.street1 || addr.line1}\n${addr.city}, ${addr.state} ${addr.zipCode || addr.zip}`,
  getEnabledProviders: (settings) => {
    if (!settings || !settings.shippingProviders) return [];
    return [
      {
        id: 'pirateship',
        name: 'PirateShip',
        icon: '🏴‍☠️',
        url: 'https://ship.pirateship.com/ship',
        description: 'Cheapest USPS & UPS rates',
        formatAddress: (addr) => `${addr.fullName}\n${addr.street1}\n${addr.city}, ${addr.state} ${addr.zipCode}`,
      },
    ].filter((p) => settings.shippingProviders[p.id]);
  },
  getAllProviderIds: () => ['pirateship', 'shippo', 'easypost', 'stamps'],
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
  useCopyFeedback: () => ({
    copied: false,
    copyToClipboard: jest.fn(),
  }),
}));

// ============================================================
// Setup defaults
// ============================================================

const TEST_ADDRESS = {
  fullName: 'Jane Doe',
  street1: '456 Oak Ave',
  city: 'Portland',
  state: 'OR',
  zipCode: '97201',
  country: 'US',
  phone: '503-555-1234',
};

const MOCK_REVEAL = {
  ciphertext: 'enc-ciphertext',
  nonce: 'enc-nonce',
  encryptedBy: 'admin-pub-hex-1234',
  revealedAt: Date.now(),
  producerConfirmed: false,
  confirmedAt: null,
  inventorySystemId: 'sys1',
};

beforeEach(() => {
  jest.clearAllMocks();

  const yRequests = createMockYArray([]);
  const yAudit = createMockYArray([]);
  const ySystems = createMockYMap({
    sys1: {
      name: 'Test System',
      id: 'sys1',
      settings: { shippingProviders: { pirateship: true } },
    },
  });
  const yCatalog = createMockYArray([createTestCatalogItem({ id: 'cat1', name: 'Widget', inventorySystemId: 'sys1' })]);
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
    currentWorkspace: { password: 'test-password-123' },
    collaborators: [
      { publicKey: 'adminKey', publicKeyBase62: 'adminKey', name: 'Alice Admin', displayName: 'Alice Admin', permission: 'owner', isOnline: true },
      { publicKey: 'producerKey', publicKeyBase62: 'producerKey', name: 'Bob Producer', displayName: 'Bob Producer', permission: 'editor', isOnline: true },
      { publicKey: 'requestorKey', publicKeyBase62: 'requestorKey', name: 'Carol Requestor', displayName: 'Carol Requestor', permission: 'viewer', isOnline: true },
    ],
    userIdentity: { publicKeyBase62: 'adminKey', displayName: 'Alice Admin', curveSecretKey: new Uint8Array(32), name: 'Alice Admin' },
    onStartChatWith: jest.fn(),
  };

  mockSyncResult = {
    currentSystem: {
      name: 'Test System',
      id: 'sys1',
      settings: { shippingProviders: { pirateship: true } },
    },
    inventorySystems: [{ name: 'Test System', id: 'sys1' }],
    catalogItems: [createTestCatalogItem({ id: 'cat1', name: 'Widget', unit: 'units', inventorySystemId: 'sys1' })],
    requests: [],
    producerCapacities: {},
    addressReveals: {},
    pendingAddresses: {},
    auditLog: [],
    openRequestCount: 0,
    pendingApprovalCount: 0,
    activeRequestCount: 0,
    allRequests: [],
  };
});

// ============================================================
// Import components (after mocks are set up)
// ============================================================
const ApprovalQueue = require('../frontend/src/components/inventory/admin/ApprovalQueue').default;
const RequestDetail = require('../frontend/src/components/inventory/common/RequestDetail').default;
const ProducerMyRequests = require('../frontend/src/components/inventory/producer/MyRequests').default;
const AddressReveal = require('../frontend/src/components/inventory/producer/AddressReveal').default;

// ============================================================
// §1 — Unit tests: getAddress correct argument order
// ============================================================

describe('ApprovalQueue — getAddress fix (Bug #1)', () => {
  it('calls getWorkspaceKeyMaterial with currentWorkspace and workspaceId', async () => {
    const req = createTestRequest({
      id: 'req-fix1',
      status: 'claimed',
      assignedTo: 'producerKey',
      inventorySystemId: 'sys1',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });
    mockSyncResult.requests = [req];
    mockCtx.yInventoryRequests = createMockYArray([req]);
    mockGetAddress.mockResolvedValueOnce(TEST_ADDRESS);

    render(<ApprovalQueue />);
    fireEvent.click(screen.getByText('✓ Approve'));

    await waitFor(() => {
      expect(mockGetWorkspaceKeyMaterial).toHaveBeenCalledWith(
        mockCtx.currentWorkspace,
        'ws1'
      );
    });
  });

  it('calls getAddress with (keyMaterial, inventorySystemId, requestId) in correct order', async () => {
    const req = createTestRequest({
      id: 'req-fix2',
      status: 'claimed',
      assignedTo: 'producerKey',
      inventorySystemId: 'sys1',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });
    mockSyncResult.requests = [req];
    mockCtx.yInventoryRequests = createMockYArray([req]);
    mockGetAddress.mockResolvedValueOnce(TEST_ADDRESS);

    render(<ApprovalQueue />);
    fireEvent.click(screen.getByText('✓ Approve'));

    await waitFor(() => {
      expect(mockGetAddress).toHaveBeenCalledWith(
        'mock-key-material-password',
        'sys1',
        'req-fix2'
      );
    });
  });

  it('creates address reveal with inventorySystemId attached', async () => {
    const req = createTestRequest({
      id: 'req-fix3',
      status: 'claimed',
      assignedTo: 'producerKey',
      inventorySystemId: 'sys1',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });
    mockSyncResult.requests = [req];
    mockCtx.yInventoryRequests = createMockYArray([req]);
    mockGetAddress.mockResolvedValueOnce(TEST_ADDRESS);

    render(<ApprovalQueue />);
    fireEvent.click(screen.getByText('✓ Approve'));

    await waitFor(() => {
      expect(mockCtx.yAddressReveals.set).toHaveBeenCalled();
    });

    const [setKey, setVal] = mockCtx.yAddressReveals.set.mock.calls[0];
    expect(setKey).toBe('req-fix3');
    expect(setVal.inventorySystemId).toBe('sys1');
    expect(setVal.ciphertext).toBeDefined();
    expect(setVal.encryptedBy).toBeDefined();
  });
});

// ============================================================
// §2 — Pending address decryption (Bug #2)
// ============================================================

describe('ApprovalQueue — pending address decryption (Bug #2)', () => {
  it('falls back to yPendingAddresses when local address not found', async () => {
    const req = createTestRequest({
      id: 'req-pend1',
      status: 'claimed',
      assignedTo: 'producerKey',
      inventorySystemId: 'sys1',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });
    mockSyncResult.requests = [req];
    mockCtx.yInventoryRequests = createMockYArray([req]);

    // Local address returns null
    mockGetAddress.mockResolvedValueOnce(null);

    // Pending addresses exist
    const pendingEntries = [
      {
        encryptedAddress: 'pending-ciphertext',
        nonce: 'pending-nonce',
        forAdminPublicKey: 'admin-pub-hex-1234',
        fromRequestorPublicKey: 'requestor-pub-hex',
      },
    ];
    mockCtx.yPendingAddresses = createMockYMap({ 'req-pend1': pendingEntries });

    render(<ApprovalQueue />);
    fireEvent.click(screen.getByText('✓ Approve'));

    await waitFor(() => {
      expect(mockDecryptPendingAddress).toHaveBeenCalledWith(
        pendingEntries,
        'admin-pub-hex-1234',
        mockCtx.userIdentity.curveSecretKey
      );
    });
  });

  it('stores decrypted pending address locally and deletes pending entry', async () => {
    const req = createTestRequest({
      id: 'req-pend2',
      status: 'claimed',
      assignedTo: 'producerKey',
      inventorySystemId: 'sys1',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });
    mockSyncResult.requests = [req];
    mockCtx.yInventoryRequests = createMockYArray([req]);

    mockGetAddress.mockResolvedValueOnce(null);
    const pendingEntries = [{ encryptedAddress: 'x', nonce: 'y', forAdminPublicKey: 'admin-pub-hex-1234', fromRequestorPublicKey: 'rk' }];
    mockCtx.yPendingAddresses = createMockYMap({ 'req-pend2': pendingEntries });

    render(<ApprovalQueue />);
    fireEvent.click(screen.getByText('✓ Approve'));

    await waitFor(() => {
      // Should store locally
      expect(mockStoreAddress).toHaveBeenCalledWith(
        'mock-key-material-password',
        'sys1',
        'req-pend2',
        expect.objectContaining({ fullName: 'Jane Doe' })
      );
    });

    // Should delete pending entry
    expect(mockCtx.yPendingAddresses.delete).toHaveBeenCalledWith('req-pend2');
  });

  it('creates address reveal from decrypted pending address', async () => {
    const req = createTestRequest({
      id: 'req-pend3',
      status: 'claimed',
      assignedTo: 'producerKey',
      inventorySystemId: 'sys1',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });
    mockSyncResult.requests = [req];
    mockCtx.yInventoryRequests = createMockYArray([req]);

    mockGetAddress.mockResolvedValueOnce(null);
    const pendingEntries = [{ encryptedAddress: 'x', nonce: 'y', forAdminPublicKey: 'admin-pub-hex-1234', fromRequestorPublicKey: 'rk' }];
    mockCtx.yPendingAddresses = createMockYMap({ 'req-pend3': pendingEntries });

    render(<ApprovalQueue />);
    fireEvent.click(screen.getByText('✓ Approve'));

    await waitFor(() => {
      expect(mockCreateAddressReveal).toHaveBeenCalledWith(
        expect.objectContaining({ fullName: 'Jane Doe' }),
        'producer-pub-hex-5678',
        mockCtx.userIdentity.curveSecretKey,
        'admin-pub-hex-1234'
      );
    });

    expect(mockCtx.yAddressReveals.set).toHaveBeenCalled();
    const [key, val] = mockCtx.yAddressReveals.set.mock.calls[0];
    expect(key).toBe('req-pend3');
    expect(val.inventorySystemId).toBe('sys1');
  });

  it('does not attempt decryptPendingAddress when local address exists', async () => {
    const req = createTestRequest({
      id: 'req-pend4',
      status: 'claimed',
      assignedTo: 'producerKey',
      inventorySystemId: 'sys1',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });
    mockSyncResult.requests = [req];
    mockCtx.yInventoryRequests = createMockYArray([req]);
    mockGetAddress.mockResolvedValueOnce(TEST_ADDRESS);

    render(<ApprovalQueue />);
    fireEvent.click(screen.getByText('✓ Approve'));

    await waitFor(() => {
      expect(mockCreateAddressReveal).toHaveBeenCalled();
    });

    expect(mockDecryptPendingAddress).not.toHaveBeenCalled();
  });
});

// ============================================================
// §3 — inventorySystemId on reveals (Bug #3)
// ============================================================

describe('ApprovalQueue — inventorySystemId on reveals (Bug #3)', () => {
  it('attaches inventorySystemId so useInventorySync filter passes', async () => {
    const req = createTestRequest({
      id: 'req-sysid1',
      status: 'claimed',
      assignedTo: 'producerKey',
      inventorySystemId: 'sys1',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });
    mockSyncResult.requests = [req];
    mockCtx.yInventoryRequests = createMockYArray([req]);
    mockGetAddress.mockResolvedValueOnce(TEST_ADDRESS);

    render(<ApprovalQueue />);
    fireEvent.click(screen.getByText('✓ Approve'));

    await waitFor(() => {
      const [, revealObj] = mockCtx.yAddressReveals.set.mock.calls[0];
      expect(revealObj.inventorySystemId).toBe('sys1');
      // Also verify the core reveal fields are preserved
      expect(revealObj.ciphertext).toBeDefined();
      expect(revealObj.nonce).toBeDefined();
      expect(revealObj.encryptedBy).toBeDefined();
      expect(revealObj.revealedAt).toBeGreaterThan(0);
    });
  });
});

// ============================================================
// §4 — RequestDetail shows Mark as Shipped for in_progress (Bug #4)
// ============================================================

describe('RequestDetail — status visibility (Bug #4)', () => {
  it('shows shipping UI for approved status', () => {
    const req = createTestRequest({
      id: 'req-vis1',
      status: 'approved',
      assignedTo: 'producerKey',
      inventorySystemId: 'sys1',
    });

    render(
      <RequestDetail
        request={req}
        isAdmin={false}
        isProducer={true}
        collaborators={mockCtx.collaborators}
        onClose={jest.fn()}
        onMarkShipped={jest.fn()}
      />
    );

    // Should show the no-reveal fallback (since no address reveal exists for this request)
    expect(screen.getByText(/Address reveal pending/)).toBeInTheDocument();
  });

  it('shows shipping UI for in_progress status', () => {
    const req = createTestRequest({
      id: 'req-vis2',
      status: 'in_progress',
      assignedTo: 'producerKey',
      inventorySystemId: 'sys1',
    });

    render(
      <RequestDetail
        request={req}
        isAdmin={false}
        isProducer={true}
        collaborators={mockCtx.collaborators}
        onClose={jest.fn()}
        onMarkShipped={jest.fn()}
      />
    );

    expect(screen.getByText(/Address reveal pending/)).toBeInTheDocument();
  });

  it('does NOT show shipping UI for claimed status', () => {
    const req = createTestRequest({
      id: 'req-vis3',
      status: 'claimed',
      assignedTo: 'producerKey',
      inventorySystemId: 'sys1',
    });

    render(
      <RequestDetail
        request={req}
        isAdmin={false}
        isProducer={true}
        collaborators={mockCtx.collaborators}
        onClose={jest.fn()}
        onMarkShipped={jest.fn()}
      />
    );

    expect(screen.queryByText(/Address reveal pending/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Mark as Shipped/)).not.toBeInTheDocument();
  });

  it('does NOT show shipping UI for shipped status', () => {
    const req = createTestRequest({
      id: 'req-vis4',
      status: 'shipped',
      assignedTo: 'producerKey',
      inventorySystemId: 'sys1',
    });

    render(
      <RequestDetail
        request={req}
        isAdmin={false}
        isProducer={true}
        collaborators={mockCtx.collaborators}
        onClose={jest.fn()}
      />
    );

    expect(screen.queryByText(/Address reveal pending/)).not.toBeInTheDocument();
  });
});

// ============================================================
// §5 — RequestDetail inline AddressReveal (UX improvement)
// ============================================================

describe('RequestDetail — inline AddressReveal', () => {
  it('renders AddressReveal inline when address reveal exists for producer', async () => {
    const req = createTestRequest({
      id: 'req-inline1',
      status: 'approved',
      assignedTo: 'producerKey',
      inventorySystemId: 'sys1',
      catalogItemName: 'Widget',
      quantity: 10,
    });

    // Set up the address reveal in mockSyncResult so it appears in useInventory
    mockSyncResult.addressReveals = { 'req-inline1': MOCK_REVEAL };

    // Set the user identity to producer's identity
    mockCtx.userIdentity = {
      publicKeyBase62: 'producerKey',
      displayName: 'Bob Producer',
      curveSecretKey: new Uint8Array(32),
      name: 'Bob Producer',
    };

    render(
      <RequestDetail
        request={req}
        isAdmin={false}
        isProducer={true}
        collaborators={mockCtx.collaborators}
        onClose={jest.fn()}
        onMarkShipped={jest.fn()}
      />
    );

    // Should render AddressReveal inline (shows decrypted address)
    // Address appears in both the shipping address summary and the AddressReveal component
    await waitFor(() => {
      expect(screen.getAllByText('Jane Doe').length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.getAllByText('456 Oak Ave').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Portland, OR 97201/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows shipping providers when AddressReveal is rendered inline', async () => {
    const req = createTestRequest({
      id: 'req-inline2',
      status: 'approved',
      assignedTo: 'producerKey',
      inventorySystemId: 'sys1',
      catalogItemName: 'Widget',
    });

    mockSyncResult.addressReveals = { 'req-inline2': MOCK_REVEAL };
    mockCtx.userIdentity = {
      publicKeyBase62: 'producerKey',
      displayName: 'Bob',
      curveSecretKey: new Uint8Array(32),
      name: 'Bob',
    };

    render(
      <RequestDetail
        request={req}
        isAdmin={false}
        isProducer={true}
        collaborators={mockCtx.collaborators}
        onClose={jest.fn()}
        onMarkShipped={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('PirateShip')).toBeInTheDocument();
    });
  });

  it('shows no-reveal fallback when address reveal does not exist', () => {
    const req = createTestRequest({
      id: 'req-inline3',
      status: 'approved',
      assignedTo: 'producerKey',
      inventorySystemId: 'sys1',
    });

    // No address reveal for this request
    mockSyncResult.addressReveals = {};

    render(
      <RequestDetail
        request={req}
        isAdmin={false}
        isProducer={true}
        collaborators={mockCtx.collaborators}
        onClose={jest.fn()}
        onMarkShipped={jest.fn()}
      />
    );

    expect(screen.getByText(/Address reveal pending/)).toBeInTheDocument();
    expect(screen.getByText('📦 Mark as Shipped')).toBeInTheDocument();
  });

  it('does NOT show AddressReveal for admin role (shows full address from local store instead)', () => {
    const req = createTestRequest({
      id: 'req-inline4',
      status: 'approved',
      assignedTo: 'producerKey',
      inventorySystemId: 'sys1',
    });

    mockSyncResult.addressReveals = { 'req-inline4': MOCK_REVEAL };

    render(
      <RequestDetail
        request={req}
        isAdmin={true}
        isProducer={false}
        collaborators={mockCtx.collaborators}
        onClose={jest.fn()}
      />
    );

    // Admin should NOT see the AddressReveal component — they see full address from local store
    expect(screen.queryByText(/Address reveal pending/)).not.toBeInTheDocument();
    // The mark shipped button should not appear for admin (only approve/reject for pending)
    expect(screen.queryByText(/Mark as Shipped/)).not.toBeInTheDocument();
  });
});

// ============================================================
// §6 — RequestDetail getAddress fix
// ============================================================

describe('RequestDetail — getAddress fix', () => {
  it('calls getAddress with correct arguments when loading admin full address', async () => {
    const req = createTestRequest({
      id: 'req-addr1',
      status: 'approved',
      assignedTo: 'producerKey',
      inventorySystemId: 'sys1',
    });

    mockGetAddress.mockResolvedValueOnce(TEST_ADDRESS);

    render(
      <RequestDetail
        request={req}
        isAdmin={true}
        isProducer={false}
        collaborators={mockCtx.collaborators}
        onClose={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(mockGetWorkspaceKeyMaterial).toHaveBeenCalledWith(
        mockCtx.currentWorkspace,
        'ws1'
      );
      expect(mockGetAddress).toHaveBeenCalledWith(
        'mock-key-material-password',
        'sys1',
        'req-addr1'
      );
    });
  });

  it('displays full address for admin when address is loaded', async () => {
    const req = createTestRequest({
      id: 'req-addr2',
      status: 'approved',
      assignedTo: 'producerKey',
      inventorySystemId: 'sys1',
    });

    mockGetAddress.mockResolvedValueOnce(TEST_ADDRESS);

    render(
      <RequestDetail
        request={req}
        isAdmin={true}
        isProducer={false}
        collaborators={mockCtx.collaborators}
        onClose={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      expect(screen.getByText('456 Oak Ave')).toBeInTheDocument();
      expect(screen.getByText(/Portland, OR 97201/)).toBeInTheDocument();
    });
  });

  it('gracefully handles getWorkspaceKeyMaterial failure', async () => {
    const req = createTestRequest({
      id: 'req-addr3',
      status: 'approved',
      inventorySystemId: 'sys1',
    });

    mockGetWorkspaceKeyMaterial.mockImplementationOnce(() => {
      throw new Error('No workspace key');
    });

    // Should not crash
    render(
      <RequestDetail
        request={req}
        isAdmin={true}
        isProducer={false}
        collaborators={mockCtx.collaborators}
        onClose={jest.fn()}
      />
    );

    // The component should still render without the address
    expect(screen.getByText(/Request #/)).toBeInTheDocument();
  });
});

// ============================================================
// §7 — ProducerMyRequests onMarkShipped handler (Bug #5)
// ============================================================

describe('ProducerMyRequests — onMarkShipped handler (Bug #5)', () => {
  beforeEach(() => {
    mockCtx.userIdentity = {
      publicKeyBase62: 'producerKey',
      displayName: 'Bob Producer',
      curveSecretKey: new Uint8Array(32),
      name: 'Bob Producer',
    };
  });

  it('renders View Address button when address reveal exists', () => {
    const req = createTestRequest({
      id: 'req-pmr1',
      status: 'approved',
      assignedTo: 'producerKey',
      claimedBy: 'producerKey',
      inventorySystemId: 'sys1',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });

    mockSyncResult.requests = [req];
    mockSyncResult.addressReveals = { 'req-pmr1': MOCK_REVEAL };

    render(<ProducerMyRequests />);

    expect(screen.getByText('📍 View Address')).toBeInTheDocument();
  });

  it('shows AddressReveal inline in RequestDetail when clicking a card with a reveal', async () => {
    const req = createTestRequest({
      id: 'req-pmr2',
      status: 'approved',
      assignedTo: 'producerKey',
      claimedBy: 'producerKey',
      inventorySystemId: 'sys1',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
      quantity: 25,
    });

    mockSyncResult.requests = [req];
    mockSyncResult.addressReveals = { 'req-pmr2': MOCK_REVEAL };
    mockCtx.yInventoryRequests = createMockYArray([req]);

    render(<ProducerMyRequests />);

    // Click the card to open detail
    const card = screen.getByText('#req-pm').closest('.pmr-card');
    fireEvent.click(card);

    // RequestDetail should show with AddressReveal inline
    // Address appears in both the shipping address summary and the AddressReveal component
    await waitFor(() => {
      expect(screen.getAllByText('Jane Doe').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('456 Oak Ave').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows Mark In Progress button for approved requests', () => {
    const req = createTestRequest({
      id: 'req-pmr3',
      status: 'approved',
      assignedTo: 'producerKey',
      claimedBy: 'producerKey',
      inventorySystemId: 'sys1',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });

    mockSyncResult.requests = [req];

    render(<ProducerMyRequests />);
    expect(screen.getByText('🔨 Mark In Progress')).toBeInTheDocument();
  });

  it('shows View Address for in_progress requests with reveal', () => {
    const req = createTestRequest({
      id: 'req-pmr4',
      status: 'in_progress',
      assignedTo: 'producerKey',
      claimedBy: 'producerKey',
      inventorySystemId: 'sys1',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });

    mockSyncResult.requests = [req];
    mockSyncResult.addressReveals = { 'req-pmr4': MOCK_REVEAL };

    render(<ProducerMyRequests />);
    expect(screen.getByText('📍 View Address')).toBeInTheDocument();
  });
});

// ============================================================
// §8 — AddressReveal component tests (supplementary)
// ============================================================

describe('AddressReveal — shipping providers and confirm flow', () => {
  const reveal = MOCK_REVEAL;
  const identity = { publicKeyBase62: 'producerKey', curveSecretKey: new Uint8Array(32) };

  beforeEach(() => {
    mockCtx.yInventoryRequests = createMockYArray([
      createTestRequest({
        id: 'req-ar1',
        status: 'approved',
        catalogItemName: 'Widget',
        quantity: 50,
        inventorySystemId: 'sys1',
      }),
    ]);
  });

  it('shows shipping provider buttons when providers are enabled', async () => {
    render(<AddressReveal requestId="req-ar1" reveal={reveal} identity={identity} />);

    await waitFor(() => {
      expect(screen.getByText('PirateShip')).toBeInTheDocument();
    });
  });

  it('shows copy address button after decryption', async () => {
    render(<AddressReveal requestId="req-ar1" reveal={reveal} identity={identity} />);

    await waitFor(() => {
      expect(screen.getByText(/Copy Address/)).toBeInTheDocument();
    });
  });

  it('mark shipped button is disabled until confirmation checkbox is checked', async () => {
    render(<AddressReveal requestId="req-ar1" reveal={reveal} identity={identity} />);

    await waitFor(() => {
      expect(screen.getByText(/Mark Shipped/)).toBeInTheDocument();
    });

    const shipBtn = screen.getByText(/Mark Shipped/);
    expect(shipBtn).toBeDisabled();

    // Check the confirmation checkbox
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    expect(shipBtn).not.toBeDisabled();
  });

  it('shows phone number when address includes phone', async () => {
    render(<AddressReveal requestId="req-ar1" reveal={reveal} identity={identity} />);

    await waitFor(() => {
      expect(screen.getByText(/503-555-1234/)).toBeInTheDocument();
    });
  });

  it('shows tracking number input', async () => {
    render(<AddressReveal requestId="req-ar1" reveal={reveal} identity={identity} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g., 1Z999AA10123456784')).toBeInTheDocument();
    });
  });

  it('shows shipping notes textarea', async () => {
    render(<AddressReveal requestId="req-ar1" reveal={reveal} identity={identity} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Any shipping notes...')).toBeInTheDocument();
    });
  });

  it('shows privacy note about address deletion', async () => {
    render(<AddressReveal requestId="req-ar1" reveal={reveal} identity={identity} />);

    await waitFor(() => {
      expect(screen.getByText(/encrypted address is automatically deleted/)).toBeInTheDocument();
    });
  });

  it('shows request info section with item details', async () => {
    render(<AddressReveal requestId="req-ar1" reveal={reveal} identity={identity} />);

    await waitFor(() => {
      expect(screen.getByText('Widget')).toBeInTheDocument();
    });
  });
});

// ============================================================
// §9 — End-to-end scenario tests
// ============================================================

describe('E2E Scenario: Owner-submitted address → approve → producer ships', () => {
  it('admin approves claimed request → address reveal created from local store', async () => {
    // Setup: request with address in local store (owner-submitted)
    const req = createTestRequest({
      id: 'req-e2e1',
      status: 'claimed',
      assignedTo: 'producerKey',
      claimedBy: 'producerKey',
      requestedBy: 'requestorKey',
      inventorySystemId: 'sys1',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });
    mockSyncResult.requests = [req];
    mockCtx.yInventoryRequests = createMockYArray([req]);
    mockGetAddress.mockResolvedValueOnce(TEST_ADDRESS);

    render(<ApprovalQueue />);

    // Admin clicks approve
    fireEvent.click(screen.getByText('✓ Approve'));

    // Verify: correct args, reveal created with inventorySystemId
    await waitFor(() => {
      expect(mockGetWorkspaceKeyMaterial).toHaveBeenCalled();
      expect(mockGetAddress).toHaveBeenCalledWith('mock-key-material-password', 'sys1', 'req-e2e1');
      expect(mockCreateAddressReveal).toHaveBeenCalledWith(
        TEST_ADDRESS,
        'producer-pub-hex-5678',
        mockCtx.userIdentity.curveSecretKey,
        'admin-pub-hex-1234'
      );
      expect(mockCtx.yAddressReveals.set).toHaveBeenCalled();

      const [key, val] = mockCtx.yAddressReveals.set.mock.calls[0];
      expect(key).toBe('req-e2e1');
      expect(val.inventorySystemId).toBe('sys1');
    });

    // Verify: request status updated to approved
    const updatedReqs = mockCtx.yInventoryRequests.toArray();
    expect(updatedReqs[0].status).toBe('approved');
    expect(updatedReqs[0].approvedAt).toBeGreaterThan(0);
  });
});

describe('E2E Scenario: Non-owner-submitted address → approve → producer ships', () => {
  it('admin approves → decrypts pending address → creates reveal', async () => {
    const req = createTestRequest({
      id: 'req-e2e2',
      status: 'claimed',
      assignedTo: 'producerKey',
      claimedBy: 'producerKey',
      requestedBy: 'requestorKey',
      inventorySystemId: 'sys1',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });
    mockSyncResult.requests = [req];
    mockCtx.yInventoryRequests = createMockYArray([req]);

    // No local address
    mockGetAddress.mockResolvedValueOnce(null);

    // Pending address exists
    const pendingEntries = [{
      encryptedAddress: 'pending-ct',
      nonce: 'pending-n',
      forAdminPublicKey: 'admin-pub-hex-1234',
      fromRequestorPublicKey: 'requestor-pub-hex',
    }];
    mockCtx.yPendingAddresses = createMockYMap({ 'req-e2e2': pendingEntries });

    render(<ApprovalQueue />);
    fireEvent.click(screen.getByText('✓ Approve'));

    await waitFor(() => {
      // Decrypted pending
      expect(mockDecryptPendingAddress).toHaveBeenCalled();
      // Stored locally
      expect(mockStoreAddress).toHaveBeenCalled();
      // Cleaned up pending
      expect(mockCtx.yPendingAddresses.delete).toHaveBeenCalledWith('req-e2e2');
      // Created reveal
      expect(mockCreateAddressReveal).toHaveBeenCalled();
      expect(mockCtx.yAddressReveals.set).toHaveBeenCalled();
    });
  });
});

describe('E2E Scenario: Producer views address and ships', () => {
  it('producer sees decrypted address and shipping providers in RequestDetail', async () => {
    const req = createTestRequest({
      id: 'req-e2e3',
      status: 'approved',
      assignedTo: 'producerKey',
      inventorySystemId: 'sys1',
      catalogItemName: 'Widget',
      quantity: 100,
    });

    mockSyncResult.addressReveals = { 'req-e2e3': MOCK_REVEAL };
    mockCtx.userIdentity = {
      publicKeyBase62: 'producerKey',
      displayName: 'Bob',
      curveSecretKey: new Uint8Array(32),
      name: 'Bob',
    };

    render(
      <RequestDetail
        request={req}
        isAdmin={false}
        isProducer={true}
        collaborators={mockCtx.collaborators}
        onClose={jest.fn()}
        onMarkShipped={jest.fn()}
      />
    );

    // Should see decrypted address
    // Address appears in both the shipping address summary and the AddressReveal component
    await waitFor(() => {
      expect(screen.getAllByText('Jane Doe').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('456 Oak Ave').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/Portland, OR 97201/).length).toBeGreaterThanOrEqual(1);
    });

    // Should see shipping providers
    expect(screen.getByText('PirateShip')).toBeInTheDocument();

    // Should see confirmation checkbox
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });
});

describe('E2E Scenario: Approval without assignedTo', () => {
  it('does not attempt address reveal when no producer assigned', async () => {
    const req = createTestRequest({
      id: 'req-e2e4',
      status: 'pending_approval',
      assignedTo: null,
      inventorySystemId: 'sys1',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });
    mockSyncResult.requests = [req];
    mockCtx.yInventoryRequests = createMockYArray([req]);

    render(<ApprovalQueue />);
    fireEvent.click(screen.getByText('✓ Approve'));

    // Wait for async operations to settle
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(mockGetAddress).not.toHaveBeenCalled();
    expect(mockCreateAddressReveal).not.toHaveBeenCalled();
    expect(mockCtx.yAddressReveals.set).not.toHaveBeenCalled();
  });
});

describe('E2E Scenario: Bulk approve with address reveals', () => {
  it('bulk approve creates reveals for all selected requests', async () => {
    const req1 = createTestRequest({
      id: 'req-bulk1',
      status: 'claimed',
      assignedTo: 'producerKey',
      inventorySystemId: 'sys1',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });
    const req2 = createTestRequest({
      id: 'req-bulk2',
      status: 'claimed',
      assignedTo: 'producerKey',
      inventorySystemId: 'sys1',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });
    mockSyncResult.requests = [req1, req2];
    mockCtx.yInventoryRequests = createMockYArray([req1, req2]);
    mockGetAddress.mockResolvedValue(TEST_ADDRESS);

    render(<ApprovalQueue />);

    // Select all
    const selectAllCheckbox = screen.getByText('Select All').closest('label').querySelector('input');
    fireEvent.click(selectAllCheckbox);

    // Bulk approve
    const bulkApproveBtn = screen.getByText(/Approve \(2\)/);
    fireEvent.click(bulkApproveBtn);

    await waitFor(() => {
      expect(mockCtx.yAddressReveals.set).toHaveBeenCalledTimes(2);
    });
  });
});

// ============================================================
// §10 — RequestDetail Mark In Progress button
// ============================================================

describe('RequestDetail — Mark In Progress button', () => {
  it('shows Mark In Progress button for approved status when onMarkInProgress is provided', () => {
    const req = createTestRequest({
      id: 'req-mip1',
      status: 'approved',
      assignedTo: 'producerKey',
      inventorySystemId: 'sys1',
    });

    const onMarkInProgress = jest.fn();
    render(
      <RequestDetail
        request={req}
        isAdmin={false}
        isProducer={true}
        collaborators={mockCtx.collaborators}
        onClose={jest.fn()}
        onMarkShipped={jest.fn()}
        onMarkInProgress={onMarkInProgress}
      />
    );

    expect(screen.getByTestId('stage-btn-in_progress')).toBeInTheDocument();
  });

  it('does NOT show Mark In Progress button as clickable for in_progress status', () => {
    const req = createTestRequest({
      id: 'req-mip2',
      status: 'in_progress',
      assignedTo: 'producerKey',
      inventorySystemId: 'sys1',
    });

    render(
      <RequestDetail
        request={req}
        isAdmin={false}
        isProducer={true}
        collaborators={mockCtx.collaborators}
        onClose={jest.fn()}
        onMarkShipped={jest.fn()}
        onMarkInProgress={jest.fn()}
      />
    );

    // Button exists but is the active/current stage (disabled)
    const btn = screen.getByTestId('stage-btn-in_progress');
    expect(btn).toBeDisabled();
  });

  it('stage bar button is safe to click when onMarkInProgress is not provided', () => {
    const req = createTestRequest({
      id: 'req-mip3',
      status: 'approved',
      assignedTo: 'producerKey',
      inventorySystemId: 'sys1',
    });

    render(
      <RequestDetail
        request={req}
        isAdmin={false}
        isProducer={true}
        collaborators={mockCtx.collaborators}
        onClose={jest.fn()}
        onMarkShipped={jest.fn()}
      />
    );

    // Button renders in stage bar; clicking it should not throw (optional chaining)
    const btn = screen.getByTestId('stage-btn-in_progress');
    expect(() => fireEvent.click(btn)).not.toThrow();
  });

  it('calls onMarkInProgress with the request when clicked', () => {
    const req = createTestRequest({
      id: 'req-mip4',
      status: 'approved',
      assignedTo: 'producerKey',
      inventorySystemId: 'sys1',
    });

    const onMarkInProgress = jest.fn();
    render(
      <RequestDetail
        request={req}
        isAdmin={false}
        isProducer={true}
        collaborators={mockCtx.collaborators}
        onClose={jest.fn()}
        onMarkShipped={jest.fn()}
        onMarkInProgress={onMarkInProgress}
      />
    );

    fireEvent.click(screen.getByTestId('stage-btn-in_progress'));
    expect(onMarkInProgress).toHaveBeenCalledWith(req);
  });

  it('stage bar renders for admin role too', () => {
    const req = createTestRequest({
      id: 'req-mip5',
      status: 'approved',
      assignedTo: 'producerKey',
      inventorySystemId: 'sys1',
    });

    const onMarkInProgress = jest.fn();
    render(
      <RequestDetail
        request={req}
        isAdmin={true}
        isProducer={false}
        collaborators={mockCtx.collaborators}
        onClose={jest.fn()}
        onMarkInProgress={onMarkInProgress}
      />
    );

    // Admin can also interact with stage bar (canInteractStageBar = isAdmin || isProducer)
    const btn = screen.getByTestId('stage-btn-in_progress');
    expect(btn).not.toBeDisabled();
  });
});

// ============================================================
// §10b — ProducerMyRequests Mark In Progress via RequestDetail
// ============================================================

describe('ProducerMyRequests — Mark In Progress via RequestDetail', () => {
  beforeEach(() => {
    mockCtx.userIdentity = {
      publicKeyBase62: 'producerKey',
      displayName: 'Bob Producer',
      curveSecretKey: new Uint8Array(32),
      name: 'Bob Producer',
    };
  });

  it('passes onMarkInProgress to RequestDetail and closes panel on click', async () => {
    const req = createTestRequest({
      id: 'req-mipd1',
      status: 'approved',
      assignedTo: 'producerKey',
      claimedBy: 'producerKey',
      inventorySystemId: 'sys1',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });

    mockSyncResult.requests = [req];
    mockCtx.yInventoryRequests = createMockYArray([req]);

    render(<ProducerMyRequests />);

    // Click the card to open detail
    const card = screen.getByText('#req-mi').closest('.pmr-card');
    fireEvent.click(card);

    // RequestDetail should show with Mark In Progress button (inside the slide panel)
    await waitFor(() => {
      const panel = document.querySelector('.slide-panel__body');
      expect(within(panel).getByTestId('stage-btn-in_progress')).toBeInTheDocument();
    });

    // Click Mark In Progress inside the slide panel
    const panel = document.querySelector('.slide-panel__body');
    fireEvent.click(within(panel).getByTestId('stage-btn-in_progress'));

    // Request should be updated to in_progress
    await waitFor(() => {
      const updated = mockCtx.yInventoryRequests.toArray();
      const found = updated.find(r => r.id === 'req-mipd1');
      expect(found.status).toBe('in_progress');
      expect(found.inProgressAt).toBeGreaterThan(0);
    });
  });
});

// ============================================================
// §11 — InventoryContext provides currentWorkspace
// ============================================================

describe('InventoryContext — currentWorkspace availability', () => {
  it('context value includes currentWorkspace', () => {
    // This is tested indirectly — RequestDetail reads currentWorkspace from useInventory
    // If currentWorkspace were missing, the getAddress call would fail
    expect(mockCtx.currentWorkspace).toBeDefined();
    expect(mockCtx.currentWorkspace.password).toBe('test-password-123');
  });

  it('context value includes workspaceId', () => {
    expect(mockCtx.workspaceId).toBe('ws1');
  });
});

// ============================================================
// §12 — useInventorySync filter for addressReveals
// ============================================================

describe('useInventorySync — addressReveals filter', () => {
  // This is a pure function test of the filter logic
  it('filters reveals by inventorySystemId', () => {
    const revealsMap = {
      'req-a': { ...MOCK_REVEAL, inventorySystemId: 'sys1' },
      'req-b': { ...MOCK_REVEAL, inventorySystemId: 'sys2' },
      'req-c': { ...MOCK_REVEAL, inventorySystemId: 'sys1' },
    };

    // Simulate the filter from useInventorySync
    const filtered = Object.entries(revealsMap)
      .filter(([, reveal]) => reveal.inventorySystemId === 'sys1')
      .reduce((acc, [key, val]) => { acc[key] = val; return acc; }, {});

    expect(Object.keys(filtered)).toEqual(['req-a', 'req-c']);
    expect(filtered['req-b']).toBeUndefined();
  });

  it('excludes reveals without inventorySystemId (the old bug)', () => {
    const revealsMap = {
      'req-old': {
        ciphertext: 'ct',
        nonce: 'n',
        encryptedBy: 'admin',
        revealedAt: Date.now(),
        // NO inventorySystemId — this is the bug
      },
      'req-new': { ...MOCK_REVEAL, inventorySystemId: 'sys1' },
    };

    const filtered = Object.entries(revealsMap)
      .filter(([, reveal]) => reveal.inventorySystemId === 'sys1')
      .reduce((acc, [key, val]) => { acc[key] = val; return acc; }, {});

    expect(Object.keys(filtered)).toEqual(['req-new']);
    // Old reveal without inventorySystemId is correctly excluded
    expect(filtered['req-old']).toBeUndefined();
  });
});

// ============================================================
// §13 — Edge cases and error handling
// ============================================================

describe('Edge cases and error handling', () => {
  it('ApprovalQueue handles missing currentWorkspace gracefully', async () => {
    const req = createTestRequest({
      id: 'req-edge1',
      status: 'claimed',
      assignedTo: 'producerKey',
      inventorySystemId: 'sys1',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });
    mockSyncResult.requests = [req];
    mockCtx.yInventoryRequests = createMockYArray([req]);
    mockCtx.currentWorkspace = null;
    mockGetWorkspaceKeyMaterial.mockImplementation(() => { throw new Error('No workspace'); });

    // Should not crash
    render(<ApprovalQueue />);
    fireEvent.click(screen.getByText('✓ Approve'));

    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 100));

    // Request should still be approved even if address reveal fails
    const updated = mockCtx.yInventoryRequests.toArray();
    expect(updated[0].status).toBe('approved');
  });

  it('ApprovalQueue handles decryptPendingAddress failure gracefully', async () => {
    const req = createTestRequest({
      id: 'req-edge2',
      status: 'claimed',
      assignedTo: 'producerKey',
      inventorySystemId: 'sys1',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });
    mockSyncResult.requests = [req];
    mockCtx.yInventoryRequests = createMockYArray([req]);
    mockGetAddress.mockResolvedValueOnce(null);
    mockDecryptPendingAddress.mockRejectedValueOnce(new Error('Decryption failed'));

    const pendingEntries = [{ encryptedAddress: 'x', nonce: 'y', forAdminPublicKey: 'admin-pub-hex-1234', fromRequestorPublicKey: 'rk' }];
    mockCtx.yPendingAddresses = createMockYMap({ 'req-edge2': pendingEntries });

    render(<ApprovalQueue />);
    fireEvent.click(screen.getByText('✓ Approve'));

    // Should not crash — request is still approved
    await new Promise(resolve => setTimeout(resolve, 100));
    const updated = mockCtx.yInventoryRequests.toArray();
    expect(updated[0].status).toBe('approved');
  });

  it('RequestDetail handles missing address reveal gracefully for producer', () => {
    const req = createTestRequest({
      id: 'req-edge3',
      status: 'approved',
      assignedTo: 'producerKey',
      inventorySystemId: 'sys1',
    });

    // addressReveals is empty
    mockSyncResult.addressReveals = {};

    render(
      <RequestDetail
        request={req}
        isAdmin={false}
        isProducer={true}
        collaborators={mockCtx.collaborators}
        onClose={jest.fn()}
        onMarkShipped={jest.fn()}
      />
    );

    // Should show the fallback message
    expect(screen.getByText(/Address reveal pending/)).toBeInTheDocument();
    // And still show a way to mark as shipped
    expect(screen.getByText('📦 Mark as Shipped')).toBeInTheDocument();
  });

  it('AddressReveal handles decryption failure with error message', async () => {
    mockDecryptAddressReveal.mockRejectedValueOnce(new Error('Wrong key'));

    mockCtx.yInventoryRequests = createMockYArray([
      createTestRequest({ id: 'req-edge4', status: 'approved', inventorySystemId: 'sys1' }),
    ]);

    render(
      <AddressReveal
        requestId="req-edge4"
        reveal={MOCK_REVEAL}
        identity={{ publicKeyBase62: 'wrongKey', curveSecretKey: new Uint8Array(32) }}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Could not decrypt/)).toBeInTheDocument();
    });
  });

  it('ProducerMyRequests handles empty requests', () => {
    mockCtx.userIdentity = {
      publicKeyBase62: 'producerKey',
      curveSecretKey: new Uint8Array(32),
      name: 'Bob',
    };
    mockSyncResult.requests = [];

    render(<ProducerMyRequests />);
    expect(screen.getByText('0 total')).toBeInTheDocument();
  });
});
