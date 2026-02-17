/**
 * Requestor Component Tests
 *
 * Tests for: MyRequests, RequestFAQ, SavedAddresses, SubmitRequest
 * See docs/INVENTORY_SYSTEM_SPEC.md §6.6
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  createMockYArray,
  createMockYMap,
  createTestRequest,
  createTestCatalogItem,
  createTestIdentity,
} from '../../helpers/inventory-test-utils';

// ── Mocks ──────────────────────────────────────────────────────────────────

let mockCtx;
let mockSyncResult;
let mockShowToast;
let mockSavedAddresses;
let mockStoreAddress;
let mockGetWorkspaceKeyMaterial;
let mockEncryptAddressForAdmins;

jest.mock('../../../frontend/src/contexts/InventoryContext', () => ({
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

jest.mock('../../../frontend/src/utils/inventorySavedAddresses', () => ({
  getSavedAddresses: jest.fn(() => mockSavedAddresses || []),
  storeSavedAddress: jest.fn(),
  deleteSavedAddress: jest.fn(),
}));

jest.mock('../../../frontend/src/utils/inventoryAddressStore', () => ({
  storeAddress: jest.fn(),
  getWorkspaceKeyMaterial: jest.fn(() => mockGetWorkspaceKeyMaterial || { key: 'mock' }),
}));

jest.mock('../../../frontend/src/utils/addressCrypto', () => ({
  encryptAddressForAdmins: jest.fn(() => mockEncryptAddressForAdmins || []),
  getPublicKeyHex: jest.fn(() => 'abcdef'),
}));

jest.mock('../../../frontend/src/components/inventory/common/StatusBadge', () => {
  return function MockStatusBadge({ status }) {
    return <span data-testid="status-badge">{status}</span>;
  };
});

// CSS
jest.mock('../../../frontend/src/components/inventory/requestor/MyRequests.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/requestor/RequestFAQ.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/requestor/SavedAddresses.css', () => ({}));
jest.mock('../../../frontend/src/components/inventory/requestor/SubmitRequest.css', () => ({}));

// ── Imports ────────────────────────────────────────────────────────────────

const MyRequests = require('../../../frontend/src/components/inventory/requestor/MyRequests').default;
const RequestFAQ = require('../../../frontend/src/components/inventory/requestor/RequestFAQ').default;
const SavedAddresses = require('../../../frontend/src/components/inventory/requestor/SavedAddresses').default;
const SubmitRequest = require('../../../frontend/src/components/inventory/requestor/SubmitRequest').default;

// ── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockShowToast = jest.fn();
  mockSavedAddresses = [];
  mockStoreAddress = jest.fn();
  mockGetWorkspaceKeyMaterial = { key: 'mock' };
  mockEncryptAddressForAdmins = [];

  const identity = createTestIdentity();

  const yInventoryRequests = createMockYArray();
  const yInventoryAuditLog = createMockYArray();
  const yInventorySystems = createMockYMap();
  const yCatalogItems = createMockYArray();
  const yProducerCapacities = createMockYMap();
  const yAddressReveals = createMockYMap();
  const yPendingAddresses = createMockYMap();

  mockCtx = {
    yInventoryRequests,
    yInventoryAuditLog,
    yInventorySystems,
    yCatalogItems,
    yProducerCapacities,
    yAddressReveals,
    yPendingAddresses,
    inventorySystemId: 'sys-1',
    workspaceId: 'ws-1',
    currentWorkspace: { password: 'test-pwd' },
    userIdentity: identity,
    collaborators: [
      { publicKey: 'collab-1', displayName: 'Alice', permission: 'owner' },
      { publicKey: 'collab-2', displayName: 'Bob', permission: 'editor' },
    ],
  };

  const catalogItem1 = createTestCatalogItem({ id: 'cat-1', name: 'Widget', active: true, quantityMin: 1, quantityMax: 100 });
  const catalogItem2 = createTestCatalogItem({ id: 'cat-2', name: 'Gadget', active: true, quantityMin: 5, quantityMax: 500 });

  const req1 = createTestRequest({
    id: 'req-0001',
    requestedBy: identity.publicKeyBase62,
    status: 'open',
    catalogItemName: 'Widget',
    catalogItemId: 'cat-1',
    quantity: 10,
    urgent: false,
    requestedAt: Date.now() - 86400000,
  });
  const req2 = createTestRequest({
    id: 'req-0002',
    requestedBy: identity.publicKeyBase62,
    status: 'shipped',
    catalogItemName: 'Gadget',
    catalogItemId: 'cat-2',
    quantity: 50,
    urgent: true,
    trackingNumber: 'TRK-123',
    requestedAt: Date.now() - 172800000,
    shippedAt: Date.now() - 43200000,
  });

  mockSyncResult = {
    requests: [req1, req2],
    catalogItems: [catalogItem1, catalogItem2],
    auditLog: [],
    producerCapacities: {},
    currentSystem: { name: 'Test System' },
    openRequestCount: 1,
    pendingApprovalCount: 0,
    activeRequestCount: 2,
    allRequests: [req1, req2],
  };
});

// ═══════════════════════════════════════════════════════════════════════════
//  MyRequests (Requestor)
// ═══════════════════════════════════════════════════════════════════════════

describe('MyRequests (Requestor)', () => {
  test('renders heading and total count', () => {
    render(<MyRequests />);
    expect(screen.getByText('My Requests')).toBeInTheDocument();
    expect(screen.getByText(/2 total/)).toBeInTheDocument();
  });

  test('renders request cards for current user', () => {
    render(<MyRequests />);
    // 'Widget'/'Gadget' appear in both filter dropdown and request cards
    expect(screen.getAllByText('Widget').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Gadget').length).toBeGreaterThanOrEqual(1);
  });

  test('shows ⚡ for urgent requests', () => {
    render(<MyRequests />);
    expect(screen.getByText('⚡')).toBeInTheDocument();
  });

  test('shows tracking number when present', () => {
    render(<MyRequests />);
    expect(screen.getByText(/TRK-123/)).toBeInTheDocument();
  });

  test('shows cancel button for open requests only', () => {
    render(<MyRequests />);
    const cancelButtons = screen.getAllByText('Cancel Request');
    // req1 is open (cancellable), req2 is shipped (not cancellable)
    expect(cancelButtons).toHaveLength(1);
  });

  test('cancel button updates request status', () => {
    // Populate the Yjs array with the request so the cancel handler finds it
    const req1 = mockSyncResult.requests[0];
    mockCtx.yInventoryRequests.push([req1]);
    render(<MyRequests />);
    fireEvent.click(screen.getByText('Cancel Request'));
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.stringContaining('cancel'),
      'success'
    );
  });

  test('status filter dropdown is present', () => {
    render(<MyRequests />);
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('All Statuses')).toBeInTheDocument();
  });

  test('item filter dropdown is present', () => {
    render(<MyRequests />);
    expect(screen.getByText('All Items')).toBeInTheDocument();
  });

  test('shows empty state when no requests', () => {
    mockSyncResult.requests = [];
    render(<MyRequests />);
    expect(screen.getByText("You haven't submitted any requests yet.")).toBeInTheDocument();
  });

  test('shows filter empty state when filters exclude all requests', () => {
    render(<MyRequests />);
    const statusSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(statusSelect, { target: { value: 'delivered' } });
    expect(screen.getByText('No requests match your filters.')).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  RequestFAQ
// ═══════════════════════════════════════════════════════════════════════════

describe('RequestFAQ', () => {
  test('renders heading', () => {
    render(<RequestFAQ />);
    expect(screen.getByText('Frequently Asked Questions')).toBeInTheDocument();
  });

  test('renders subtitle', () => {
    render(<RequestFAQ />);
    expect(screen.getByText(/Everything you need to know/)).toBeInTheDocument();
  });

  test('renders all 10 FAQ questions', () => {
    render(<RequestFAQ />);
    expect(screen.getByText('How do I submit a request?')).toBeInTheDocument();
    expect(screen.getByText('Can I cancel a request?')).toBeInTheDocument();
    expect(screen.getByText('How is my address protected?')).toBeInTheDocument();
  });

  test('answers are initially hidden', () => {
    render(<RequestFAQ />);
    // The answer for first question should not be visible
    expect(screen.queryByText(/Navigate to "Submit Request"/)).not.toBeInTheDocument();
  });

  test('clicking a question reveals the answer', () => {
    render(<RequestFAQ />);
    fireEvent.click(screen.getByText('How do I submit a request?'));
    expect(screen.getByText(/Navigate to "Submit Request"/)).toBeInTheDocument();
  });

  test('clicking again collapses the answer', () => {
    render(<RequestFAQ />);
    fireEvent.click(screen.getByText('How do I submit a request?'));
    expect(screen.getByText(/Navigate to "Submit Request"/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('How do I submit a request?'));
    expect(screen.queryByText(/Navigate to "Submit Request"/)).not.toBeInTheDocument();
  });

  test('opening a different question closes the previous one', () => {
    render(<RequestFAQ />);
    fireEvent.click(screen.getByText('How do I submit a request?'));
    expect(screen.getByText(/Navigate to "Submit Request"/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Can I cancel a request?'));
    expect(screen.queryByText(/Navigate to "Submit Request"/)).not.toBeInTheDocument();
    expect(screen.getByText(/You can cancel a request/)).toBeInTheDocument();
  });

  test('chevrons toggle between ▸ and ▾', () => {
    render(<RequestFAQ />);
    // All closed → ▸
    const chevrons = screen.getAllByText('▸');
    expect(chevrons.length).toBe(10);
    // Open first
    fireEvent.click(screen.getByText('How do I submit a request?'));
    expect(screen.getByText('▾')).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  SavedAddresses
// ═══════════════════════════════════════════════════════════════════════════

describe('SavedAddresses', () => {
  test('shows loading state initially', () => {
    render(<SavedAddresses currentWorkspace="test-ws" />);
    expect(screen.getByText('Loading addresses...')).toBeInTheDocument();
  });

  test('shows empty state when no addresses', async () => {
    render(<SavedAddresses currentWorkspace="test-ws" />);
    await waitFor(() => {
      expect(screen.getByText(/No saved addresses yet/)).toBeInTheDocument();
    });
  });

  test('shows add address button', async () => {
    render(<SavedAddresses currentWorkspace="test-ws" />);
    await waitFor(() => {
      expect(screen.getByText('+ Add Address')).toBeInTheDocument();
    });
  });

  test('toggling add shows form', async () => {
    render(<SavedAddresses currentWorkspace="test-ws" />);
    await waitFor(() => {
      expect(screen.getByText('+ Add Address')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('+ Add Address'));
    expect(screen.getByText('New Address')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g., Home')).toBeInTheDocument();
  });

  test('cancel button hides the form', async () => {
    render(<SavedAddresses currentWorkspace="test-ws" />);
    await waitFor(() => {
      expect(screen.getByText('+ Add Address')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('+ Add Address'));
    expect(screen.getByText('New Address')).toBeInTheDocument();
    fireEvent.click(screen.getByText('✕ Cancel'));
    expect(screen.queryByText('New Address')).not.toBeInTheDocument();
  });

  test('renders saved address cards when addresses exist', async () => {
    const { getSavedAddresses } = require('../../../frontend/src/utils/inventorySavedAddresses');
    getSavedAddresses.mockResolvedValue([
      {
        id: 'addr-1',
        label: 'Home',
        name: 'John Smith',
        line1: '123 Main St',
        city: 'Nashville',
        state: 'TN',
        zip: '37201',
        isDefault: true,
      },
    ]);
    render(<SavedAddresses currentWorkspace="test-ws" />);
    await waitFor(() => {
      expect(screen.getByText('Home')).toBeInTheDocument();
    });
    expect(screen.getByText('John Smith')).toBeInTheDocument();
    expect(screen.getByText('123 Main St')).toBeInTheDocument();
    expect(screen.getByText('Nashville, TN 37201')).toBeInTheDocument();
    expect(screen.getByText('⭐ Default')).toBeInTheDocument();
  });

  test('delete button calls deleteSavedAddress', async () => {
    const { getSavedAddresses, deleteSavedAddress } = require('../../../frontend/src/utils/inventorySavedAddresses');
    getSavedAddresses.mockResolvedValue([
      { id: 'addr-1', label: 'Home', name: 'John', line1: '123 Main', city: 'Nashville', state: 'TN', zip: '37201' },
    ]);
    render(<SavedAddresses currentWorkspace="test-ws" />);
    await waitFor(() => {
      expect(screen.getByText('🗑️ Delete')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('🗑️ Delete'));
    await waitFor(() => {
      expect(deleteSavedAddress).toHaveBeenCalledWith(expect.any(String), 'addr-1');
    });
  });

  test('edit button opens inline form', async () => {
    const { getSavedAddresses } = require('../../../frontend/src/utils/inventorySavedAddresses');
    getSavedAddresses.mockResolvedValue([
      { id: 'addr-1', label: 'Home', name: 'John', line1: '123 Main', city: 'Nashville', state: 'TN', zip: '37201' },
    ]);
    render(<SavedAddresses currentWorkspace="test-ws" />);
    await waitFor(() => {
      expect(screen.getByText('✏️ Edit')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('✏️ Edit'));
    // Should show Save and Cancel buttons for inline editing
    await waitFor(() => {
      expect(screen.getByText('Save')).toBeInTheDocument();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  SubmitRequest
// ═══════════════════════════════════════════════════════════════════════════

describe('SubmitRequest', () => {
  test('renders heading', () => {
    render(<SubmitRequest currentWorkspace="test-ws" isOwner={false} />);
    expect(screen.getByText('Submit a New Request')).toBeInTheDocument();
  });

  test('renders active catalog items as radio options', () => {
    render(<SubmitRequest currentWorkspace="test-ws" isOwner={false} />);
    expect(screen.getByText('Widget')).toBeInTheDocument();
    expect(screen.getByText('Gadget')).toBeInTheDocument();
  });

  test('shows "What do you need?" section', () => {
    render(<SubmitRequest currentWorkspace="test-ws" isOwner={false} />);
    expect(screen.getByText('What do you need?')).toBeInTheDocument();
  });

  test('shows quantity input when item selected', () => {
    render(<SubmitRequest currentWorkspace="test-ws" isOwner={false} />);
    expect(screen.getByText('Quantity')).toBeInTheDocument();
  });

  test('shows urgency radio buttons', () => {
    render(<SubmitRequest currentWorkspace="test-ws" isOwner={false} />);
    expect(screen.getByText('Normal')).toBeInTheDocument();
    expect(screen.getByText('⚡ Urgent')).toBeInTheDocument();
  });

  test('shows new address toggle', () => {
    render(<SubmitRequest currentWorkspace="test-ws" isOwner={false} />);
    expect(screen.getByText('+ Enter a new address')).toBeInTheDocument();
  });

  test('clicking new address toggle shows address form', () => {
    render(<SubmitRequest currentWorkspace="test-ws" isOwner={false} />);
    fireEvent.click(screen.getByText('+ Enter a new address'));
    expect(screen.getByPlaceholderText('John Smith')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('123 Main Street')).toBeInTheDocument();
    expect(screen.getByText('Select state')).toBeInTheDocument();
  });

  test('shows save address checkbox when entering new address', () => {
    render(<SubmitRequest currentWorkspace="test-ws" isOwner={false} />);
    fireEvent.click(screen.getByText('+ Enter a new address'));
    expect(screen.getByText('Save this address for future requests')).toBeInTheDocument();
  });

  test('shows privacy notice', () => {
    render(<SubmitRequest currentWorkspace="test-ws" isOwner={false} />);
    expect(screen.getByText(/Your full address is encrypted/)).toBeInTheDocument();
  });

  test('submit button is present', () => {
    render(<SubmitRequest currentWorkspace="test-ws" isOwner={false} />);
    expect(screen.getByText('Submit Request →')).toBeInTheDocument();
  });

  test('submit button is disabled until form is valid', () => {
    render(<SubmitRequest currentWorkspace="test-ws" isOwner={false} />);
    const submitBtn = screen.getByText('Submit Request →');
    expect(submitBtn).toBeDisabled();
  });

  test('shows notes textarea', () => {
    render(<SubmitRequest currentWorkspace="test-ws" isOwner={false} />);
    expect(screen.getByPlaceholderText('Any special instructions...')).toBeInTheDocument();
  });

  test('shows empty catalog message when no items', () => {
    mockSyncResult.catalogItems = [];
    render(<SubmitRequest currentWorkspace="test-ws" isOwner={false} />);
    expect(screen.getByText(/No items available yet/)).toBeInTheDocument();
  });
});
