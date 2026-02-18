/**
 * tests/components/inventory/producer.test.jsx
 *
 * Tests for producer inventory components:
 *   ProducerDashboard, OpenRequests, ProducerMyRequests, ProducerStats, AddressReveal
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  createMockYMap,
  createMockYArray,
  createTestRequest,
  createTestCatalogItem,
  createTestCapacity,
} from '../../helpers/inventory-test-utils';

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

// --- Shared mock state ---
let mockCtx;
let mockSyncResult;

jest.mock('../../../frontend/src/contexts/InventoryContext', () => ({
  useInventory: jest.fn(() => ({ ...mockCtx, ...mockSyncResult })),
}));

jest.mock('../../../frontend/src/contexts/ToastContext', () => ({
  useToast: jest.fn(() => ({ showToast: jest.fn() })),
}));

jest.mock('../../../frontend/src/hooks/useInventorySync', () => {
  const fn = jest.fn(() => mockSyncResult);
  fn.default = fn;
  return { __esModule: true, default: fn, useInventorySync: fn };
});

jest.mock('../../../frontend/src/utils/inventoryValidation', () => ({
  ...jest.requireActual('../../../frontend/src/utils/inventoryValidation'),
  generateId: jest.fn(() => 'mock-id-' + Math.random().toString(36).slice(2, 8)),
}));

jest.mock('../../../frontend/src/utils/inventoryAssignment', () => ({
  estimateFulfillment: jest.fn(() => ({ source: 'stock', estimatedDate: null })),
  validateClaim: jest.fn(() => ({ ok: true })),
}));

jest.mock('../../../frontend/src/utils/addressCrypto', () => ({
  decryptAddressReveal: jest.fn(() => Promise.resolve({
    fullName: 'John Doe',
    street1: '123 Main St',
    city: 'Portland',
    state: 'OR',
    zipCode: '97201',
    country: 'US',
  })),
}));

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
      { publicKey: 'myKey', publicKeyBase62: 'myKey', name: 'Me', displayName: 'Me', permission: 'editor', isOnline: true },
    ],
    userIdentity: { publicKeyBase62: 'myKey', displayName: 'Me', curveSecretKey: new Uint8Array(32), name: 'Me' },
  };

  mockSyncResult = {
    currentSystem: { name: 'Test System', id: 'sys1', settings: {} },
    inventorySystems: [{ name: 'Test System', id: 'sys1' }],
    catalogItems: [
      createTestCatalogItem({ id: 'cat1', name: 'Widget', unit: 'units' }),
    ],
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

// ======================================================================
// ProducerDashboard
// ======================================================================
const ProducerDashboard = require('../../../frontend/src/components/inventory/producer/ProducerDashboard').default;

describe('ProducerDashboard', () => {
  it('renders heading and welcome message', () => {
    render(<ProducerDashboard />);
    expect(screen.getByText('Producer Dashboard')).toBeInTheDocument();
    expect(screen.getByText(/Welcome, Me/)).toBeInTheDocument();
  });

  it('renders My Capacity section with CapacityInput for each active catalog item', () => {
    render(<ProducerDashboard />);
    expect(screen.getByText('My Capacity')).toBeInTheDocument();
    expect(screen.getByText('Widget')).toBeInTheDocument();
  });

  it('renders kanban columns', () => {
    render(<ProducerDashboard />);
    expect(screen.getByText('Claimed')).toBeInTheDocument();
    expect(screen.getByText('Pending Approval')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('Shipped')).toBeInTheDocument();
  });

  it('renders stats bar', () => {
    render(<ProducerDashboard />);
    expect(screen.getByText(/Fulfilled:/)).toBeInTheDocument();
    expect(screen.getByText(/Avg ship:/)).toBeInTheDocument();
  });

  it('shows request cards in kanban columns', () => {
    mockSyncResult.requests = [
      createTestRequest({ id: 'req-k1', status: 'claimed', assignedTo: 'myKey', itemId: 'cat1', inventorySystemId: 'sys1' }),
    ];
    render(<ProducerDashboard />);
    expect(screen.getByText(/req-k1/)).toBeInTheDocument();
  });

  it('shows unclaim button for claimed requests', () => {
    mockSyncResult.requests = [
      createTestRequest({ id: 'req-uc1', status: 'claimed', assignedTo: 'myKey', inventorySystemId: 'sys1' }),
    ];
    render(<ProducerDashboard />);
    expect(screen.getByText('↩️ Unclaim')).toBeInTheDocument();
  });
});

// ======================================================================
// OpenRequests
// ======================================================================
const OpenRequests = require('../../../frontend/src/components/inventory/producer/OpenRequests').default;

describe('OpenRequests', () => {
  it('renders heading', () => {
    render(<OpenRequests />);
    expect(screen.getByText('Open Requests')).toBeInTheDocument();
  });

  it('shows count of open requests', () => {
    render(<OpenRequests />);
    expect(screen.getByText('0 available')).toBeInTheDocument();
  });

  it('shows empty state', () => {
    render(<OpenRequests />);
    expect(screen.getByText('No open requests match your filters')).toBeInTheDocument();
  });

  it('renders filter controls', () => {
    render(<OpenRequests />);
    expect(screen.getByText('All Items')).toBeInTheDocument();
    expect(screen.getByText('All States')).toBeInTheDocument();
    expect(screen.getByText('Any Urgency')).toBeInTheDocument();
  });

  it('renders request cards for open requests', () => {
    mockSyncResult.requests = [
      createTestRequest({ id: 'req-open1', status: 'open', inventorySystemId: 'sys1', catalogItemName: 'Widget', quantity: 25 }),
    ];
    render(<OpenRequests />);
    expect(screen.getByText('1 available')).toBeInTheDocument();
    // 'Widget' appears in both filter dropdown and request card
    expect(screen.getAllByText('Widget').length).toBeGreaterThanOrEqual(1);
  });

  it('shows load more button when more than PAGE_SIZE results', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      createTestRequest({ id: `req-m${i}`, status: 'open', inventorySystemId: 'sys1' })
    );
    mockSyncResult.requests = many;
    render(<OpenRequests />);
    expect(screen.getByText(/Load More/)).toBeInTheDocument();
  });

  it('has sort options', () => {
    render(<OpenRequests />);
    expect(screen.getByText('Sort: Urgency')).toBeInTheDocument();
    expect(screen.getByText('Sort: Date')).toBeInTheDocument();
  });
});

// ======================================================================
// ProducerMyRequests
// ======================================================================
const ProducerMyRequests = require('../../../frontend/src/components/inventory/producer/MyRequests').default;

describe('ProducerMyRequests', () => {
  it('renders heading', () => {
    render(<ProducerMyRequests />);
    expect(screen.getByText('My Requests')).toBeInTheDocument();
  });

  it('shows total count', () => {
    render(<ProducerMyRequests />);
    expect(screen.getByText('0 total')).toBeInTheDocument();
  });

  it('renders pipeline columns', () => {
    render(<ProducerMyRequests />);
    // Stage labels also appear in filter dropdown options
    const stages = document.querySelectorAll('.pmr-stage-label');
    const stageTexts = Array.from(stages).map(s => s.textContent);
    expect(stageTexts).toContain('Claimed');
    expect(stageTexts).toContain('Approved');
    expect(stageTexts).toContain('In Progress');
    expect(stageTexts).toContain('Shipped');
  });

  it('shows request cards for my assigned requests', () => {
    mockSyncResult.requests = [
      createTestRequest({ id: 'req-mine1', status: 'claimed', assignedTo: 'myKey', inventorySystemId: 'sys1', itemId: 'cat1' }),
    ];
    render(<ProducerMyRequests />);
    expect(screen.getByText('1 total')).toBeInTheDocument();
  });

  it('shows unclaim button', () => {
    mockSyncResult.requests = [
      createTestRequest({ id: 'req-mine2', status: 'claimed', assignedTo: 'myKey', inventorySystemId: 'sys1', itemId: 'cat1' }),
    ];
    render(<ProducerMyRequests />);
    expect(screen.getByText('↩️ Unclaim')).toBeInTheDocument();
  });

  it('shows View Address button for approved requests with address reveal', () => {
    mockSyncResult.requests = [
      createTestRequest({ id: 'req-mine3', status: 'approved', assignedTo: 'myKey', inventorySystemId: 'sys1', itemId: 'cat1' }),
    ];
    mockSyncResult.addressReveals = { 'req-mine3': { encrypted: 'data' } };
    render(<ProducerMyRequests />);
    expect(screen.getByText('📍 View Address')).toBeInTheDocument();
  });
});

// ======================================================================
// ProducerStats
// ======================================================================
const ProducerStats = require('../../../frontend/src/components/inventory/producer/ProducerStats').default;

describe('ProducerStats', () => {
  it('renders heading', () => {
    render(<ProducerStats />);
    expect(screen.getByText('My Stats')).toBeInTheDocument();
  });

  it('renders stat cards', () => {
    render(<ProducerStats />);
    expect(screen.getByText('Requests Fulfilled')).toBeInTheDocument();
    expect(screen.getByText('Total Units Shipped')).toBeInTheDocument();
    expect(screen.getByText('Active Requests')).toBeInTheDocument();
    // 'Avg Days to Ship' appears in both personal and community stats
    expect(screen.getAllByText('Avg Days to Ship').length).toBe(2);
    expect(screen.getByText('This Month')).toBeInTheDocument();
    expect(screen.getByText('Rank')).toBeInTheDocument();
    expect(screen.getByText('On-Time Rate')).toBeInTheDocument();
  });

  it('renders By Item section', () => {
    render(<ProducerStats />);
    expect(screen.getByText('By Item')).toBeInTheDocument();
  });

  it('renders fulfillment trend chart', () => {
    render(<ProducerStats />);
    expect(screen.getByText('Fulfillment Trend (8 Weeks)')).toBeInTheDocument();
  });

  it('renders community stats section', () => {
    render(<ProducerStats />);
    expect(screen.getByText('Community Stats (Anonymized)')).toBeInTheDocument();
  });

  it('computes stats from requests', () => {
    mockSyncResult.requests = [
      createTestRequest({ id: 'r1', status: 'shipped', assignedTo: 'myKey', shippedAt: Date.now(), requestedAt: Date.now() - 86400000 * 2, quantity: 50 }),
      createTestRequest({ id: 'r2', status: 'delivered', assignedTo: 'myKey', shippedAt: Date.now() - 86400000, requestedAt: Date.now() - 86400000 * 3, quantity: 30 }),
      createTestRequest({ id: 'r3', status: 'claimed', assignedTo: 'myKey', quantity: 10 }),
    ];
    render(<ProducerStats />);
    
    // Should show 2 fulfilled, 1 active, 80 total units
    // Values appear multiple times across personal + community stats
    const allCards = document.querySelectorAll('.ps-cards');
    const firstCardSet = allCards[0]; // personal stats card set
    const cards = firstCardSet.querySelectorAll('.ps-card');
    const values = Array.from(cards).map(c => c.querySelector('.ps-card-value')?.textContent?.trim());
    expect(values[0]).toBe('2'); // fulfilled
    expect(values[1]).toBe('80'); // units
    expect(values[2]).toBe('1'); // active
  });
});

// ======================================================================
// AddressReveal
// ======================================================================
const AddressReveal = require('../../../frontend/src/components/inventory/producer/AddressReveal').default;

describe('AddressReveal', () => {
  const reveal = { encrypted: 'data', nonce: 'abc' };
  const identity = { publicKeyBase62: 'myKey', curveSecretKey: new Uint8Array(32) };

  beforeEach(() => {
    // Setup mock yInventoryRequests with a request
    mockCtx.yInventoryRequests = createMockYArray([
      createTestRequest({ id: 'req-reveal1', status: 'approved', catalogItemName: 'Widget', quantity: 50 }),
    ]);
  });

  it('shows loading state initially', () => {
    // Override to delay
    const { decryptAddressReveal } = require('../../../frontend/src/utils/addressCrypto');
    decryptAddressReveal.mockImplementationOnce(() => new Promise(() => {}));

    render(<AddressReveal requestId="req-reveal1" reveal={reveal} identity={identity} />);
    expect(screen.getByText('Decrypting address…')).toBeInTheDocument();
  });

  it('shows decrypted address after successful decryption', async () => {
    render(<AddressReveal requestId="req-reveal1" reveal={reveal} identity={identity} />);
    
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });
    expect(screen.getByText('123 Main St')).toBeInTheDocument();
    expect(screen.getByText(/Portland, OR 97201/)).toBeInTheDocument();
  });

  it('shows error when decryption fails', async () => {
    const { decryptAddressReveal } = require('../../../frontend/src/utils/addressCrypto');
    decryptAddressReveal.mockImplementationOnce(() => Promise.reject(new Error('bad key')));

    render(<AddressReveal requestId="req-reveal1" reveal={reveal} identity={identity} />);
    
    await waitFor(() => {
      expect(screen.getByText(/Could not decrypt/)).toBeInTheDocument();
    });
  });

  it('has copy address button', async () => {
    render(<AddressReveal requestId="req-reveal1" reveal={reveal} identity={identity} />);
    
    await waitFor(() => {
      expect(screen.getByText(/Copy Address/)).toBeInTheDocument();
    });
  });

  it('has mark shipped button (disabled until confirmed)', async () => {
    render(<AddressReveal requestId="req-reveal1" reveal={reveal} identity={identity} />);
    
    await waitFor(() => {
      expect(screen.getByText(/Mark Shipped/)).toBeInTheDocument();
    });

    const shipBtn = screen.getByText(/Mark Shipped/);
    expect(shipBtn).toBeDisabled();
  });

  it('enables mark shipped when confirmation checkbox is checked', async () => {
    render(<AddressReveal requestId="req-reveal1" reveal={reveal} identity={identity} />);
    
    await waitFor(() => {
      expect(screen.getByText(/Mark Shipped/)).toBeInTheDocument();
    });

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    
    expect(screen.getByText(/Mark Shipped/)).not.toBeDisabled();
  });

  it('has tracking number input', async () => {
    render(<AddressReveal requestId="req-reveal1" reveal={reveal} identity={identity} />);
    
    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g., 1Z999AA10123456784')).toBeInTheDocument();
    });
  });

  it('has unclaim button', async () => {
    render(<AddressReveal requestId="req-reveal1" reveal={reveal} identity={identity} />);
    
    await waitFor(() => {
      expect(screen.getByText(/Unclaim this request/)).toBeInTheDocument();
    });
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = jest.fn();
    render(<AddressReveal requestId="req-reveal1" reveal={reveal} identity={identity} onClose={onClose} />);
    
    await waitFor(() => {
      const closeBtn = document.querySelector('.ar-close');
      expect(closeBtn).toBeInTheDocument();
    });
    
    fireEvent.click(document.querySelector('.ar-close'));
    expect(onClose).toHaveBeenCalled();
  });
});
