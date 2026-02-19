/**
 * tests/shipping-address-cleanup.test.jsx
 *
 * Tests for the shipping address pane cleanup:
 *   1. No duplicate address views for producers (address shown once, inline in RequestDetail)
 *   2. No duplicate "Shipping Address" header (embedded mode hides AddressReveal's own header)
 *   3. "Ship with X" buttons use electronAPI.openExternal instead of window.open
 *   4. ProducerDashboard & MyRequests no longer have standalone "📍 View Address" buttons
 *   5. openExternal IPC wiring + URL validation
 *
 * Test categories: Unit, Functional, UI, E2E scenario
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
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
    country: 'US',
    phone: '503-555-1234',
  })
);

jest.mock('../frontend/src/utils/addressCrypto', () => ({
  getPublicKeyHex: jest.fn(() => 'admin-pub-hex-1234'),
  base62ToPublicKeyHex: jest.fn(() => 'producer-pub-hex-5678'),
  createAddressReveal: jest.fn(() => Promise.resolve({
    ciphertext: 'enc-ciphertext',
    nonce: 'enc-nonce',
    encryptedBy: 'admin-pub-hex-1234',
    revealedAt: Date.now(),
  })),
  decryptPendingAddress: jest.fn(() => Promise.resolve({
    fullName: 'Jane Doe',
    street1: '456 Oak Ave',
    city: 'Portland',
    state: 'OR',
    zipCode: '97201',
    country: 'US',
  })),
  decryptAddressReveal: (...args) => mockDecryptAddressReveal(...args),
}));

const mockGetAddress = jest.fn(() => Promise.resolve(null));
jest.mock('../frontend/src/utils/inventoryAddressStore', () => ({
  getAddress: (...args) => mockGetAddress(...args),
  getWorkspaceKeyMaterial: jest.fn(() => 'mock-key-material'),
  storeAddress: jest.fn(() => Promise.resolve()),
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

const mockCopyToClipboard = jest.fn();
jest.mock('../frontend/src/hooks/useCopyFeedback', () => ({
  useCopyFeedback: () => ({
    copied: false,
    copyToClipboard: mockCopyToClipboard,
  }),
}));

// ============================================================
// Imports (after mocks)
// ============================================================
import AddressReveal from '../frontend/src/components/inventory/producer/AddressReveal';
import RequestDetail from '../frontend/src/components/inventory/common/RequestDetail';
import ProducerDashboard from '../frontend/src/components/inventory/producer/ProducerDashboard';
import ProducerMyRequests from '../frontend/src/components/inventory/producer/MyRequests';

// ============================================================
// Constants
// ============================================================
const MOCK_REVEAL = {
  ciphertext: 'enc-ciphertext',
  nonce: 'enc-nonce',
  encryptedBy: 'admin-pub-hex-1234',
  revealedAt: Date.now(),
  inventorySystemId: 'sys1',
};

const PRODUCER_IDENTITY = {
  publicKeyBase62: 'producerKey',
  displayName: 'Bob Producer',
  curveSecretKey: new Uint8Array(32),
  name: 'Bob Producer',
};

// ============================================================
// Setup
// ============================================================
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
  const yNotifications = createMockYArray([]);

  mockCtx = {
    yInventoryRequests: yRequests,
    yInventoryAuditLog: yAudit,
    yInventorySystems: ySystems,
    yCatalogItems: yCatalog,
    yProducerCapacities: yCapacities,
    yAddressReveals: yReveals,
    yInventoryNotifications: yNotifications,
    inventorySystemId: 'sys1',
    workspaceId: 'ws1',
    currentWorkspace: { password: 'test-password-123' },
    collaborators: [
      { publicKey: 'adminKey', publicKeyBase62: 'adminKey', name: 'Alice Admin', displayName: 'Alice Admin', permission: 'owner', isOnline: true },
      { publicKey: 'producerKey', publicKeyBase62: 'producerKey', name: 'Bob Producer', displayName: 'Bob Producer', permission: 'editor', isOnline: true },
    ],
    userIdentity: PRODUCER_IDENTITY,
    onStartChatWith: jest.fn(),
  };

  mockSyncResult = {
    requests: [],
    catalogItems: [createTestCatalogItem({ id: 'cat1', name: 'Widget', inventorySystemId: 'sys1' })],
    producerCapacities: {},
    addressReveals: {},
    pendingAddresses: {},
    notifications: [],
    auditLog: [],
  };

  // Reset electronAPI mock
  delete window.electronAPI;
});

// ============================================================
// §1 — AddressReveal embedded prop
// ============================================================
describe('AddressReveal — embedded prop', () => {
  it('shows header and request info when not embedded (default)', async () => {
    mockCtx.yInventoryRequests = createMockYArray([
      createTestRequest({ id: 'req-1', status: 'approved', catalogItemId: 'cat1', catalogItemName: 'Widget' }),
    ]);

    render(
      <AddressReveal
        requestId="req-1"
        reveal={MOCK_REVEAL}
        identity={PRODUCER_IDENTITY}
        onShipped={jest.fn()}
        onClose={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Shipping Address')).toBeInTheDocument();
    });
    // Header h3 should be present
    expect(screen.getByText('Shipping Address').tagName).toBe('H3');
    // Close button should be present
    expect(screen.getByText('✕')).toBeInTheDocument();
  });

  it('hides header and request info when embedded=true', async () => {
    mockCtx.yInventoryRequests = createMockYArray([
      createTestRequest({ id: 'req-2', status: 'approved', catalogItemId: 'cat1', catalogItemName: 'Widget' }),
    ]);

    render(
      <AddressReveal
        requestId="req-2"
        reveal={MOCK_REVEAL}
        identity={PRODUCER_IDENTITY}
        onShipped={jest.fn()}
        onClose={jest.fn()}
        embedded
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });
    // Header h3 should NOT be present
    expect(screen.queryByText('Shipping Address')).not.toBeInTheDocument();
    // Close button should NOT be present
    expect(screen.queryByText('✕')).not.toBeInTheDocument();
  });

  it('still shows address block when embedded=true', async () => {
    render(
      <AddressReveal
        requestId="req-3"
        reveal={MOCK_REVEAL}
        identity={PRODUCER_IDENTITY}
        onShipped={jest.fn()}
        onClose={jest.fn()}
        embedded
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      expect(screen.getByText(/456 Oak Ave/)).toBeInTheDocument();
      expect(screen.getByText(/Portland/)).toBeInTheDocument();
    });
  });

  it('still shows shipping providers and stage buttons when embedded with in_progress status', async () => {
    mockCtx.yInventoryRequests = createMockYArray([
      createTestRequest({ id: 'req-4', status: 'in_progress', catalogItemId: 'cat1', catalogItemName: 'Widget' }),
    ]);

    render(
      <AddressReveal
        requestId="req-4"
        reveal={MOCK_REVEAL}
        identity={PRODUCER_IDENTITY}
        request={{ id: 'req-4', status: 'in_progress' }}
        onShipped={jest.fn()}
        onMarkInProgress={jest.fn()}
        onRevertToApproved={jest.fn()}
        onRevertToInProgress={jest.fn()}
        onClose={jest.fn()}
        embedded
      />
    );

    await waitFor(() => {
      expect(screen.getByText('📋 Copy Address')).toBeInTheDocument();
      expect(screen.getByText('PirateShip')).toBeInTheDocument();
      expect(screen.getByText('📦 Mark Shipped')).toBeInTheDocument();
    });
  });

  it('hides header in error state when embedded', async () => {
    mockDecryptAddressReveal.mockRejectedValueOnce(new Error('Decrypt failed'));

    render(
      <AddressReveal
        requestId="req-err"
        reveal={MOCK_REVEAL}
        identity={PRODUCER_IDENTITY}
        onShipped={jest.fn()}
        onClose={jest.fn()}
        embedded
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Could not decrypt/)).toBeInTheDocument();
    });
    expect(screen.queryByText('Shipping Address')).not.toBeInTheDocument();
  });
});

// ============================================================
// §2 — Ship With buttons use electronAPI.openExternal
// ============================================================
describe('AddressReveal — Ship With uses openExternal', () => {
  it('calls electronAPI.openExternal when available', async () => {
    const mockOpenExternal = jest.fn();
    window.electronAPI = { openExternal: mockOpenExternal };

    mockCtx.yInventoryRequests = createMockYArray([
      createTestRequest({ id: 'req-ship1', status: 'approved', catalogItemId: 'cat1', catalogItemName: 'Widget' }),
    ]);

    render(
      <AddressReveal
        requestId="req-ship1"
        reveal={MOCK_REVEAL}
        identity={PRODUCER_IDENTITY}
        onShipped={jest.fn()}
        onClose={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('PirateShip')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('PirateShip'));

    expect(mockOpenExternal).toHaveBeenCalledWith('https://ship.pirateship.com/ship');
  });

  it('falls back to window.open when electronAPI is not available', async () => {
    const mockWindowOpen = jest.fn();
    const origOpen = window.open;
    window.open = mockWindowOpen;

    mockCtx.yInventoryRequests = createMockYArray([
      createTestRequest({ id: 'req-ship2', status: 'approved', catalogItemId: 'cat1', catalogItemName: 'Widget' }),
    ]);

    render(
      <AddressReveal
        requestId="req-ship2"
        reveal={MOCK_REVEAL}
        identity={PRODUCER_IDENTITY}
        onShipped={jest.fn()}
        onClose={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('PirateShip')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('PirateShip'));

    expect(mockWindowOpen).toHaveBeenCalledWith('https://ship.pirateship.com/ship', '_blank', 'noopener,noreferrer');
    window.open = origOpen;
  });

  it('copies address to clipboard when Ship With is clicked', async () => {
    window.electronAPI = { openExternal: jest.fn() };

    mockCtx.yInventoryRequests = createMockYArray([
      createTestRequest({ id: 'req-ship3', status: 'approved', catalogItemId: 'cat1', catalogItemName: 'Widget' }),
    ]);

    render(
      <AddressReveal
        requestId="req-ship3"
        reveal={MOCK_REVEAL}
        identity={PRODUCER_IDENTITY}
        onShipped={jest.fn()}
        onClose={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('PirateShip')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('PirateShip'));

    expect(mockCopyToClipboard).toHaveBeenCalled();
  });
});

// ============================================================
// §3 — No duplicate address in RequestDetail for producers
// ============================================================
describe('RequestDetail — no duplicate address for producers', () => {
  it('does not render renderAddressBlock for producers in Location section', async () => {
    const req = createTestRequest({
      id: 'req-rd1',
      status: 'approved',
      assignedTo: 'producerKey',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
      city: 'Portland',
      state: 'OR',
    });

    mockSyncResult.addressReveals = { 'req-rd1': MOCK_REVEAL };

    render(
      <RequestDetail
        request={req}
        isAdmin={false}
        isProducer={true}
        collaborators={mockCtx.collaborators}
        onClose={jest.fn()}
        onMarkShipped={jest.fn()}
        onMarkInProgress={jest.fn()}
        onRevertToApproved={jest.fn()}
        onRevertToInProgress={jest.fn()}
      />
    );

    // The Location section should show city/state but NOT the renderAddressBlock "📍 Shipping Address"
    expect(screen.getByText('Portland, OR')).toBeInTheDocument();

    // The producer address label from renderAddressBlock should be gone
    expect(screen.queryByText('📍 Shipping Address')).not.toBeInTheDocument();
  });

  it('still renders admin address block in Location section', async () => {
    const req = createTestRequest({
      id: 'req-rd2',
      status: 'approved',
      assignedTo: 'producerKey',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
      city: 'Portland',
      state: 'OR',
    });

    // Admin gets address from local store
    mockGetAddress.mockResolvedValueOnce({
      name: 'Jane Doe',
      line1: '456 Oak Ave',
      city: 'Portland',
      state: 'OR',
      zip: '97201',
    });

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
      expect(screen.getByText('🔒 Full Address')).toBeInTheDocument();
    });
  });

  it('renders inline AddressReveal with embedded prop in Actions section', async () => {
    const req = createTestRequest({
      id: 'req-rd3',
      status: 'approved',
      assignedTo: 'producerKey',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });

    mockSyncResult.addressReveals = { 'req-rd3': MOCK_REVEAL };
    mockCtx.yInventoryRequests = createMockYArray([req]);

    render(
      <RequestDetail
        request={req}
        isAdmin={false}
        isProducer={true}
        collaborators={mockCtx.collaborators}
        onClose={jest.fn()}
        onMarkShipped={jest.fn()}
        onMarkInProgress={jest.fn()}
        onRevertToApproved={jest.fn()}
        onRevertToInProgress={jest.fn()}
      />
    );

    // Wait for the address to be decrypted and rendered
    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });

    // The AddressReveal header should NOT appear because embedded=true
    expect(screen.queryByText('Shipping Address')).not.toBeInTheDocument();
  });
});

// ============================================================
// §4 — ProducerDashboard no standalone View Address button
// ============================================================
describe('ProducerDashboard — no standalone View Address', () => {
  beforeEach(() => {
    mockCtx.userIdentity = PRODUCER_IDENTITY;
  });

  it('does not render View Address button on kanban cards', () => {
    const req = createTestRequest({
      id: 'req-pd1',
      status: 'approved',
      assignedTo: 'producerKey',
      claimedBy: 'producerKey',
      inventorySystemId: 'sys1',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });

    mockSyncResult.requests = [req];
    mockSyncResult.addressReveals = { 'req-pd1': MOCK_REVEAL };

    render(<ProducerDashboard />);

    expect(screen.queryByText('📍 View Address')).not.toBeInTheDocument();
  });

  it('does not render standalone AddressReveal SlidePanel', () => {
    const req = createTestRequest({
      id: 'req-pd2',
      status: 'approved',
      assignedTo: 'producerKey',
      claimedBy: 'producerKey',
      inventorySystemId: 'sys1',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });

    mockSyncResult.requests = [req];
    mockSyncResult.addressReveals = { 'req-pd2': MOCK_REVEAL };

    render(<ProducerDashboard />);

    // No "Address & Shipping" title which was the standalone SlidePanel
    expect(screen.queryByText('Address & Shipping')).not.toBeInTheDocument();
  });

  it('opens RequestDetail SlidePanel when clicking a card', async () => {
    const req = createTestRequest({
      id: 'req-pd3',
      status: 'approved',
      assignedTo: 'producerKey',
      claimedBy: 'producerKey',
      inventorySystemId: 'sys1',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });

    mockSyncResult.requests = [req];
    mockSyncResult.addressReveals = { 'req-pd3': MOCK_REVEAL };
    mockCtx.yInventoryRequests = createMockYArray([req]);

    render(<ProducerDashboard />);

    const card = screen.getByText('#req-pd').closest('.pd-kanban-card');
    fireEvent.click(card);

    // Should open RequestDetail with inline AddressReveal
    await waitFor(() => {
      expect(screen.getByTestId('request-detail')).toBeInTheDocument();
    });
  });
});

// ============================================================
// §5 — MyRequests no standalone View Address button
// ============================================================
describe('MyRequests — no standalone View Address', () => {
  beforeEach(() => {
    mockCtx.userIdentity = PRODUCER_IDENTITY;
  });

  it('does not render View Address button on pipeline cards', () => {
    const req = createTestRequest({
      id: 'req-mr1',
      status: 'approved',
      assignedTo: 'producerKey',
      claimedBy: 'producerKey',
      inventorySystemId: 'sys1',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });

    mockSyncResult.requests = [req];
    mockSyncResult.addressReveals = { 'req-mr1': MOCK_REVEAL };

    render(<ProducerMyRequests />);

    expect(screen.queryByText('📍 View Address')).not.toBeInTheDocument();
  });

  it('does not render standalone AddressReveal SlidePanel', () => {
    const req = createTestRequest({
      id: 'req-mr2',
      status: 'in_progress',
      assignedTo: 'producerKey',
      claimedBy: 'producerKey',
      inventorySystemId: 'sys1',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });

    mockSyncResult.requests = [req];
    mockSyncResult.addressReveals = { 'req-mr2': MOCK_REVEAL };

    render(<ProducerMyRequests />);

    expect(screen.queryByText('Address & Shipping')).not.toBeInTheDocument();
  });

  it('opens RequestDetail with inline AddressReveal on card click', async () => {
    const req = createTestRequest({
      id: 'req-mr3',
      status: 'approved',
      assignedTo: 'producerKey',
      claimedBy: 'producerKey',
      inventorySystemId: 'sys1',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });

    mockSyncResult.requests = [req];
    mockSyncResult.addressReveals = { 'req-mr3': MOCK_REVEAL };
    mockCtx.yInventoryRequests = createMockYArray([req]);

    render(<ProducerMyRequests />);

    const card = screen.getByText('#req-mr').closest('.pmr-card');
    fireEvent.click(card);

    await waitFor(() => {
      expect(screen.getByTestId('request-detail')).toBeInTheDocument();
    });
  });
});

// ============================================================
// §6 — E2E: Producer views address inline after card click
// ============================================================
describe('E2E: Producer sees address exactly once via RequestDetail', () => {
  beforeEach(() => {
    mockCtx.userIdentity = PRODUCER_IDENTITY;
  });

  it('shows decrypted address once in RequestDetail, no duplicate headers', async () => {
    const req = createTestRequest({
      id: 'req-e2e1',
      status: 'approved',
      assignedTo: 'producerKey',
      claimedBy: 'producerKey',
      inventorySystemId: 'sys1',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
      quantity: 50,
      city: 'Portland',
      state: 'OR',
    });

    mockSyncResult.requests = [req];
    mockSyncResult.addressReveals = { 'req-e2e1': MOCK_REVEAL };
    mockCtx.yInventoryRequests = createMockYArray([req]);

    render(<ProducerMyRequests />);

    // Click the card
    const card = screen.getByText('#req-e2').closest('.pmr-card');
    fireEvent.click(card);

    // Wait for address decryption
    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });

    // Address should appear exactly once
    expect(screen.getAllByText('Jane Doe')).toHaveLength(1);
    expect(screen.getAllByText(/456 Oak Ave/)).toHaveLength(1);

    // No "Shipping Address" h3 header (embedded hides it)
    expect(screen.queryByText('Shipping Address')).not.toBeInTheDocument();

    // No "📍 Shipping Address" from renderAddressBlock (removed for producers)
    expect(screen.queryByText('📍 Shipping Address')).not.toBeInTheDocument();

    // Ship With providers should still be available
    expect(screen.getByText('PirateShip')).toBeInTheDocument();
    // Approved status → shows "Mark In Progress" button inside AddressReveal stage buttons
    expect(screen.getByTestId('ar-btn-in-progress')).toBeInTheDocument();
  });
});

// ============================================================
// §7 — AddressReveal mark-shipped flow still works
// ============================================================
describe('AddressReveal — mark shipped flow', () => {
  it('enables Mark Shipped button only after confirmation checkbox', async () => {
    mockCtx.yInventoryRequests = createMockYArray([
      createTestRequest({ id: 'req-ms1', status: 'in_progress', catalogItemId: 'cat1', catalogItemName: 'Widget' }),
    ]);

    render(
      <AddressReveal
        requestId="req-ms1"
        reveal={MOCK_REVEAL}
        identity={PRODUCER_IDENTITY}
        request={{ id: 'req-ms1', status: 'in_progress' }}
        onShipped={jest.fn()}
        onMarkInProgress={jest.fn()}
        onRevertToApproved={jest.fn()}
        onRevertToInProgress={jest.fn()}
        onClose={jest.fn()}
        embedded
      />
    );

    await waitFor(() => {
      expect(screen.getByText('📦 Mark Shipped')).toBeInTheDocument();
    });

    // Button should be disabled initially
    const shipBtn = screen.getByText('📦 Mark Shipped');
    expect(shipBtn).toBeDisabled();

    // Check the confirmation checkbox
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    expect(shipBtn).not.toBeDisabled();
  });

  it('calls onShipped callback after marking shipped', async () => {
    const onShipped = jest.fn();
    const yArr = createMockYArray([
      createTestRequest({ id: 'req-ms2', status: 'in_progress', catalogItemId: 'cat1', catalogItemName: 'Widget', requestedBy: 'requestorKey' }),
    ]);
    mockCtx.yInventoryRequests = yArr;
    mockCtx.yInventoryAuditLog = createMockYArray([]);
    mockCtx.yInventoryNotifications = createMockYArray([]);

    render(
      <AddressReveal
        requestId="req-ms2"
        reveal={MOCK_REVEAL}
        identity={PRODUCER_IDENTITY}
        request={{ id: 'req-ms2', status: 'in_progress' }}
        onShipped={onShipped}
        onMarkInProgress={jest.fn()}
        onRevertToApproved={jest.fn()}
        onRevertToInProgress={jest.fn()}
        onClose={jest.fn()}
        embedded
      />
    );

    await waitFor(() => {
      expect(screen.getByText('📦 Mark Shipped')).toBeInTheDocument();
    });

    // Check confirmation
    fireEvent.click(screen.getByRole('checkbox'));

    // Click Mark Shipped
    fireEvent.click(screen.getByText('📦 Mark Shipped'));

    await waitFor(() => {
      expect(onShipped).toHaveBeenCalledWith('req-ms2');
    });
  });

  it('allows entering tracking number before shipping', async () => {
    mockCtx.yInventoryRequests = createMockYArray([
      createTestRequest({ id: 'req-ms3', status: 'in_progress', catalogItemId: 'cat1', catalogItemName: 'Widget' }),
    ]);

    render(
      <AddressReveal
        requestId="req-ms3"
        reveal={MOCK_REVEAL}
        identity={PRODUCER_IDENTITY}
        request={{ id: 'req-ms3', status: 'in_progress' }}
        onShipped={jest.fn()}
        onMarkInProgress={jest.fn()}
        onRevertToApproved={jest.fn()}
        onRevertToInProgress={jest.fn()}
        onClose={jest.fn()}
        embedded
      />
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g., 1Z999AA10123456784')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('e.g., 1Z999AA10123456784'), {
      target: { value: '1Z999TEST123' },
    });

    expect(screen.getByPlaceholderText('e.g., 1Z999AA10123456784').value).toBe('1Z999TEST123');
  });
});

// ============================================================
// §8 — AddressReveal unclaim flow still works in embedded mode
// ============================================================
describe('AddressReveal — unclaim in embedded mode', () => {
  it('renders unclaim button when embedded', async () => {
    mockCtx.yInventoryRequests = createMockYArray([
      createTestRequest({ id: 'req-uc1', status: 'approved', catalogItemId: 'cat1', catalogItemName: 'Widget' }),
    ]);

    render(
      <AddressReveal
        requestId="req-uc1"
        reveal={MOCK_REVEAL}
        identity={PRODUCER_IDENTITY}
        onShipped={jest.fn()}
        onClose={jest.fn()}
        embedded
      />
    );

    await waitFor(() => {
      expect(screen.getByText('↩️ Unclaim this request')).toBeInTheDocument();
    });
  });
});

// ============================================================
// §9 — Unit tests for openExternal IPC
// ============================================================
describe('openExternal IPC handler — unit tests', () => {
  it('preload exposes openExternal in electronAPI', () => {
    // This is a structural test — verifying the preload script shape
    // We can't run the actual preload in JSDOM, but we verify the contract
    const fs = require('fs');
    const preloadSource = fs.readFileSync(
      require('path').join(__dirname, '..', 'src', 'preload.js'),
      'utf8'
    );
    expect(preloadSource).toContain("openExternal:");
    expect(preloadSource).toContain("ipcRenderer.invoke('open-external'");
  });

  it('main.js registers open-external IPC handler', () => {
    const fs = require('fs');
    const mainSource = fs.readFileSync(
      require('path').join(__dirname, '..', 'src', 'main.js'),
      'utf8'
    );
    expect(mainSource).toContain("ipcMain.handle('open-external'");
    // URL validation - only http(s) allowed
    expect(mainSource).toContain("url.startsWith('https://')");
    expect(mainSource).toContain("url.startsWith('http://')");
  });

  it('main.js has setWindowOpenHandler configured', () => {
    const fs = require('fs');
    const mainSource = fs.readFileSync(
      require('path').join(__dirname, '..', 'src', 'main.js'),
      'utf8'
    );
    expect(mainSource).toContain('setWindowOpenHandler');
    expect(mainSource).toContain("action: 'deny'");
  });
});

// ============================================================
// §10 — CSS rules exist for all AddressReveal classes
// ============================================================
describe('AddressReveal CSS — all classes have rules', () => {
  it('contains rules for all AddressReveal CSS classes', () => {
    const fs = require('fs');
    const cssSource = fs.readFileSync(
      require('path').join(__dirname, '..', 'frontend', 'src', 'components', 'inventory', 'producer', 'AddressReveal.css'),
      'utf8'
    );

    const requiredClasses = [
      '.address-reveal',
      '.ar-header',
      '.ar-close',
      '.ar-error',
      '.ar-loading',
      '.ar-address-block',
      '.ar-name',
      '.ar-phone',
      '.ar-copy-btn',
      '.ar-provider-group',
      '.ar-provider-label',
      '.ar-provider-buttons',
      '.ar-provider-btn',
      '.ar-provider-icon',
      '.ar-provider-name',
      '.ar-provider-copied',
      '.ar-provider-hint',
      '.ar-ship-section',
      '.ar-tracking-label',
      '.ar-tracking-input',
      '.ar-confirm-label',
      '.ar-ship-btn',
      '.ar-privacy-note',
      '.ar-request-info',
      '.ar-request-info__row',
      '.ar-request-info__label',
      '.ar-decrypt-label',
      '.ar-notes-input',
      '.ar-unclaim-btn',
      '.ar-stage-buttons',
      '.ar-stage-btn',
      '.ar-stage-btn--forward',
      '.ar-stage-btn--ship',
      '.ar-stage-btn--back',
    ];

    for (const cls of requiredClasses) {
      expect(cssSource).toContain(cls);
    }
  });
});

// ============================================================
// §11 — Round 2: RequestDetail header removed (SlidePanel provides title)
// ============================================================
describe('RequestDetail — Round 2: no duplicate header', () => {
  it('does not render its own h3 header (SlidePanel provides it)', () => {
    const req = createTestRequest({
      id: 'req-hdr1',
      status: 'approved',
      assignedTo: 'producerKey',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
      city: 'Portland',
      state: 'OR',
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
        onRevertToApproved={jest.fn()}
        onRevertToInProgress={jest.fn()}
      />
    );

    // The internal h3 "Request #..." header should be removed
    const h3s = document.querySelectorAll('h3');
    const requestH3 = Array.from(h3s).find(h => h.textContent.includes('Request #'));
    expect(requestH3).toBeUndefined();
  });

  it('does not render the close button (SlidePanel provides it)', () => {
    const req = createTestRequest({
      id: 'req-hdr2',
      status: 'approved',
      assignedTo: 'producerKey',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
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
        onRevertToApproved={jest.fn()}
        onRevertToInProgress={jest.fn()}
      />
    );

    expect(document.querySelector('.request-detail__close')).toBeNull();
  });
});

// ============================================================
// §12 — Round 2: Shipping section hidden when no tracking number
// ============================================================
describe('RequestDetail — Round 2: shipping section visibility', () => {
  it('hides Shipping section when no tracking number', () => {
    const req = createTestRequest({
      id: 'req-ship-vis1',
      status: 'approved',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });

    render(
      <RequestDetail
        request={req}
        isAdmin={true}
        collaborators={mockCtx.collaborators}
        onClose={jest.fn()}
      />
    );

    expect(screen.queryByText('Shipping')).not.toBeInTheDocument();
  });

  it('shows Shipping section when tracking number exists', () => {
    const req = createTestRequest({
      id: 'req-ship-vis2',
      status: 'shipped',
      trackingNumber: '1Z999TEST',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });

    render(
      <RequestDetail
        request={req}
        isAdmin={true}
        collaborators={mockCtx.collaborators}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByText('Shipping')).toBeInTheDocument();
    expect(screen.getByText(/1Z999TEST/)).toBeInTheDocument();
  });
});

// ============================================================
// §13 — Round 2: Stage bar hidden for producers
// ============================================================
describe('RequestDetail — Round 2: stage bar hidden for producers', () => {
  it('does not render the stage bar when isProducer=true', () => {
    const req = createTestRequest({
      id: 'req-stage1',
      status: 'approved',
      assignedTo: 'producerKey',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });

    mockSyncResult.addressReveals = { 'req-stage1': MOCK_REVEAL };

    render(
      <RequestDetail
        request={req}
        isAdmin={false}
        isProducer={true}
        collaborators={mockCtx.collaborators}
        onClose={jest.fn()}
        onMarkShipped={jest.fn()}
        onMarkInProgress={jest.fn()}
        onRevertToApproved={jest.fn()}
        onRevertToInProgress={jest.fn()}
      />
    );

    expect(screen.queryByTestId('stage-bar')).not.toBeInTheDocument();
  });

  it('still renders the stage bar for admins', () => {
    const req = createTestRequest({
      id: 'req-stage2',
      status: 'approved',
      assignedTo: 'producerKey',
      catalogItemId: 'cat1',
      catalogItemName: 'Widget',
    });

    render(
      <RequestDetail
        request={req}
        isAdmin={true}
        isProducer={false}
        collaborators={mockCtx.collaborators}
        onClose={jest.fn()}
        onMarkShipped={jest.fn()}
        onMarkInProgress={jest.fn()}
        onRevertToApproved={jest.fn()}
        onRevertToInProgress={jest.fn()}
      />
    );

    expect(screen.getByTestId('stage-bar')).toBeInTheDocument();
  });
});

// ============================================================
// §14 — Round 2: AddressReveal stage transition buttons
// ============================================================
describe('AddressReveal — Round 2: stage transition buttons', () => {
  it('shows "Mark In Progress" button when status=approved', async () => {
    mockCtx.yInventoryRequests = createMockYArray([
      createTestRequest({ id: 'req-stg1', status: 'approved', catalogItemId: 'cat1', catalogItemName: 'Widget' }),
    ]);

    render(
      <AddressReveal
        requestId="req-stg1"
        reveal={MOCK_REVEAL}
        identity={PRODUCER_IDENTITY}
        request={{ id: 'req-stg1', status: 'approved' }}
        onShipped={jest.fn()}
        onMarkInProgress={jest.fn()}
        onRevertToApproved={jest.fn()}
        onRevertToInProgress={jest.fn()}
        onClose={jest.fn()}
        embedded
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('ar-btn-in-progress')).toBeInTheDocument();
    });
    expect(screen.getByText('🔨 Mark In Progress')).toBeInTheDocument();
    // No "Mark Shipped" in approved state
    expect(screen.queryByTestId('ar-btn-ship')).not.toBeInTheDocument();
  });

  it('calls onMarkInProgress when clicking the button', async () => {
    const onMarkInProgress = jest.fn();
    mockCtx.yInventoryRequests = createMockYArray([
      createTestRequest({ id: 'req-stg2', status: 'approved', catalogItemId: 'cat1', catalogItemName: 'Widget' }),
    ]);

    render(
      <AddressReveal
        requestId="req-stg2"
        reveal={MOCK_REVEAL}
        identity={PRODUCER_IDENTITY}
        request={{ id: 'req-stg2', status: 'approved' }}
        onShipped={jest.fn()}
        onMarkInProgress={onMarkInProgress}
        onRevertToApproved={jest.fn()}
        onRevertToInProgress={jest.fn()}
        onClose={jest.fn()}
        embedded
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('ar-btn-in-progress')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('ar-btn-in-progress'));
    expect(onMarkInProgress).toHaveBeenCalled();
  });

  it('shows "Mark Shipped" and "Back to Approved" when status=in_progress', async () => {
    mockCtx.yInventoryRequests = createMockYArray([
      createTestRequest({ id: 'req-stg3', status: 'in_progress', catalogItemId: 'cat1', catalogItemName: 'Widget' }),
    ]);

    render(
      <AddressReveal
        requestId="req-stg3"
        reveal={MOCK_REVEAL}
        identity={PRODUCER_IDENTITY}
        request={{ id: 'req-stg3', status: 'in_progress' }}
        onShipped={jest.fn()}
        onMarkInProgress={jest.fn()}
        onRevertToApproved={jest.fn()}
        onRevertToInProgress={jest.fn()}
        onClose={jest.fn()}
        embedded
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('ar-btn-ship')).toBeInTheDocument();
    });
    expect(screen.getByText('📦 Mark Shipped')).toBeInTheDocument();
    expect(screen.getByTestId('ar-btn-back-approved')).toBeInTheDocument();
    expect(screen.getByText('← Back to Approved')).toBeInTheDocument();
    // No "Mark In Progress" in in_progress state
    expect(screen.queryByTestId('ar-btn-in-progress')).not.toBeInTheDocument();
  });

  it('shows "Back to In Progress" and "Back to Approved" when status=shipped', async () => {
    mockCtx.yInventoryRequests = createMockYArray([
      createTestRequest({ id: 'req-stg4', status: 'shipped', catalogItemId: 'cat1', catalogItemName: 'Widget' }),
    ]);

    render(
      <AddressReveal
        requestId="req-stg4"
        reveal={MOCK_REVEAL}
        identity={PRODUCER_IDENTITY}
        request={{ id: 'req-stg4', status: 'shipped' }}
        onShipped={jest.fn()}
        onMarkInProgress={jest.fn()}
        onRevertToApproved={jest.fn()}
        onRevertToInProgress={jest.fn()}
        onClose={jest.fn()}
        embedded
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('ar-btn-back-in-progress')).toBeInTheDocument();
    });
    expect(screen.getByText('← Back to In Progress')).toBeInTheDocument();
    expect(screen.getByTestId('ar-btn-back-approved')).toBeInTheDocument();
    expect(screen.getByText('← Back to Approved')).toBeInTheDocument();
    // No forward buttons in shipped state
    expect(screen.queryByTestId('ar-btn-in-progress')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ar-btn-ship')).not.toBeInTheDocument();
  });

  it('calls onRevertToApproved when clicking back button', async () => {
    const onRevertToApproved = jest.fn();
    mockCtx.yInventoryRequests = createMockYArray([
      createTestRequest({ id: 'req-stg5', status: 'in_progress', catalogItemId: 'cat1', catalogItemName: 'Widget' }),
    ]);

    render(
      <AddressReveal
        requestId="req-stg5"
        reveal={MOCK_REVEAL}
        identity={PRODUCER_IDENTITY}
        request={{ id: 'req-stg5', status: 'in_progress' }}
        onShipped={jest.fn()}
        onMarkInProgress={jest.fn()}
        onRevertToApproved={onRevertToApproved}
        onRevertToInProgress={jest.fn()}
        onClose={jest.fn()}
        embedded
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('ar-btn-back-approved')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('ar-btn-back-approved'));
    expect(onRevertToApproved).toHaveBeenCalled();
  });

  it('hides tracking/notes inputs when status=shipped', async () => {
    mockCtx.yInventoryRequests = createMockYArray([
      createTestRequest({ id: 'req-stg6', status: 'shipped', catalogItemId: 'cat1', catalogItemName: 'Widget' }),
    ]);

    render(
      <AddressReveal
        requestId="req-stg6"
        reveal={MOCK_REVEAL}
        identity={PRODUCER_IDENTITY}
        request={{ id: 'req-stg6', status: 'shipped' }}
        onShipped={jest.fn()}
        onMarkInProgress={jest.fn()}
        onRevertToApproved={jest.fn()}
        onRevertToInProgress={jest.fn()}
        onClose={jest.fn()}
        embedded
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });

    // Tracking and notes inputs should be hidden when shipped
    expect(screen.queryByPlaceholderText('e.g., 1Z999AA10123456784')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Any shipping notes...')).not.toBeInTheDocument();
  });
});

// ============================================================
// §15 — Round 2: Unclaim button has improved visibility
// ============================================================
describe('AddressReveal — Round 2: unclaim button styling', () => {
  it('has high-visibility styling in the CSS', () => {
    const fs = require('fs');
    const cssSource = fs.readFileSync(
      require('path').join(__dirname, '..', 'frontend', 'src', 'components', 'inventory', 'producer', 'AddressReveal.css'),
      'utf8'
    );

    // Should have error-color styling for visibility
    const unclaimSection = cssSource.substring(cssSource.indexOf('.ar-unclaim-btn'));
    expect(unclaimSection).toContain('rgba(239, 68, 68');
    expect(unclaimSection).toContain('font-weight: 600');
  });
});
