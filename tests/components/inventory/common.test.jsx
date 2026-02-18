/**
 * tests/components/inventory/common.test.jsx
 *
 * Tests for all common inventory components:
 *   StatusBadge, RequestCard, CapacityInput, RequestRow, RequestDetail
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createTestRequest, createTestCatalogItem } from '../../helpers/inventory-test-utils';

// --- Mocks ---
jest.mock('../../../frontend/src/contexts/InventoryContext', () => ({
  useInventory: jest.fn(() => ({
    yInventoryRequests: { toArray: () => [], delete: jest.fn(), insert: jest.fn() },
    yInventoryAuditLog: { push: jest.fn() },
    inventorySystemId: 'sys1',
    workspaceId: 'ws1',
    currentWorkspace: { password: 'test-pwd' },
    collaborators: [],
    addressReveals: {},
  })),
}));

jest.mock('../../../frontend/src/contexts/ToastContext', () => ({
  useToast: jest.fn(() => ({ showToast: jest.fn() })),
}));

jest.mock('../../../frontend/src/utils/inventoryAddressStore', () => ({
  getAddress: jest.fn(() => Promise.resolve(null)),
  getWorkspaceKeyMaterial: jest.fn(() => 'mock-key-material'),
  storeAddress: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../../frontend/src/utils/addressCrypto', () => ({
  decryptAddressReveal: jest.fn(() => Promise.resolve({ fullName: 'Test User', street1: '1 Main', city: 'NYC', state: 'NY', zipCode: '10001', country: 'US' })),
}));

jest.mock('../../../frontend/src/utils/shippingProviders', () => ({
  formatAddressForCopy: jest.fn(() => 'Test Address'),
  getEnabledProviders: jest.fn(() => []),
}));

jest.mock('../../../frontend/src/hooks/useCopyFeedback', () => ({
  useCopyFeedback: () => ({ copied: false, copyToClipboard: jest.fn() }),
}));

jest.mock('../../../frontend/src/utils/trackingLinks', () => ({
  parseTrackingNumber: jest.fn(() => null),
  genericTrackingUrl: jest.fn(() => ''),
}));

// ======================================================================
// StatusBadge
// ======================================================================
const StatusBadge = require('../../../frontend/src/components/inventory/common/StatusBadge').default;

describe('StatusBadge', () => {
  const statuses = [
    { status: 'open', label: 'Open', cls: 'status-badge--open' },
    { status: 'claimed', label: 'Claimed', cls: 'status-badge--claimed' },
    { status: 'pending_approval', label: 'Pending Approval', cls: 'status-badge--pending' },
    { status: 'approved', label: 'Approved', cls: 'status-badge--approved' },
    { status: 'shipped', label: 'Shipped', cls: 'status-badge--shipped' },
    { status: 'delivered', label: 'Delivered', cls: 'status-badge--delivered' },
    { status: 'blocked', label: 'Blocked', cls: 'status-badge--blocked' },
    { status: 'cancelled', label: 'Cancelled', cls: 'status-badge--cancelled' },
  ];

  it.each(statuses)('renders "$label" for status "$status"', ({ status, label, cls }) => {
    render(<StatusBadge status={status} />);
    const badge = screen.getByText(label);
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('status-badge', cls);
  });

  it('renders compact mode with title and aria-label', () => {
    const { container } = render(<StatusBadge status="open" compact />);
    const dot = container.querySelector('.status-badge--compact');
    expect(dot).toBeInTheDocument();
    expect(dot).toHaveAttribute('title', 'Open');
    expect(dot).toHaveAttribute('aria-label', 'Open');
  });

  it('falls back to raw status string for unknown statuses', () => {
    render(<StatusBadge status="mystery" />);
    expect(screen.getByText('mystery')).toBeInTheDocument();
  });

  it('falls back to "Unknown" when status is falsy', () => {
    render(<StatusBadge status={null} />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('applies additional className', () => {
    render(<StatusBadge status="open" className="extra" />);
    const badge = screen.getByText('Open');
    expect(badge.className).toContain('extra');
  });
});

// ======================================================================
// RequestCard
// ======================================================================
const RequestCard = require('../../../frontend/src/components/inventory/common/RequestCard').default;

describe('RequestCard', () => {
  const baseReq = createTestRequest({
    id: 'req-abc123',
    status: 'open',
    catalogItemName: 'Widget',
    quantity: 50,
    unit: 'units',
    city: 'Denver',
    state: 'CO',
    requestedAt: Date.now() - 86400000,
  });

  it('renders item name, quantity, and location', () => {
    render(<RequestCard request={baseReq} />);
    expect(screen.getByText('Widget')).toBeInTheDocument();
    expect(screen.getByText('50 units')).toBeInTheDocument();
    expect(screen.getByText(/Denver, CO/)).toBeInTheDocument();
  });

  it('shows truncated ID from request.id', () => {
    render(<RequestCard request={baseReq} />);
    expect(screen.getByText(/#abc123/)).toBeInTheDocument();
  });

  it('renders ⚡ for urgent requests', () => {
    const urgent = { ...baseReq, urgent: true };
    const { container } = render(<RequestCard request={urgent} />);
    expect(container.querySelector('.request-card--urgent')).toBeInTheDocument();
    expect(screen.getByText(/⚡/)).toBeInTheDocument();
  });

  it('shows Claim button when showClaim=true and status=open', () => {
    render(<RequestCard request={baseReq} showClaim onClaim={jest.fn()} />);
    expect(screen.getByText('Claim ▶')).toBeInTheDocument();
  });

  it('hides Claim button when status is not open', () => {
    const claimed = { ...baseReq, status: 'claimed' };
    render(<RequestCard request={claimed} showClaim onClaim={jest.fn()} />);
    expect(screen.queryByText('Claim ▶')).not.toBeInTheDocument();
  });

  it('calls onClaim with stopPropagation when claim button clicked', () => {
    const onClaim = jest.fn();
    const onClick = jest.fn();
    render(<RequestCard request={baseReq} showClaim onClaim={onClaim} onClick={onClick} />);
    fireEvent.click(screen.getByText('Claim ▶'));
    expect(onClaim).toHaveBeenCalledWith(baseReq);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('calls onClick when card is clicked', () => {
    const onClick = jest.fn();
    render(<RequestCard request={baseReq} onClick={onClick} />);
    fireEvent.click(screen.getByText('Widget'));
    expect(onClick).toHaveBeenCalledWith(baseReq);
  });

  it('renders claimEstimate when provided', () => {
    render(<RequestCard request={baseReq} claimEstimate="From stock" />);
    expect(screen.getByText('Can fill: From stock')).toBeInTheDocument();
  });

  it('applies compact class and hides date in compact mode', () => {
    const { container } = render(<RequestCard request={baseReq} compact />);
    expect(container.querySelector('.request-card--compact')).toBeInTheDocument();
  });

  it('has tabIndex and cursor pointer when onClick is provided', () => {
    const { container } = render(<RequestCard request={baseReq} onClick={jest.fn()} />);
    const card = container.querySelector('.request-card');
    expect(card).toHaveAttribute('tabindex', '0');
    expect(card.style.cursor).toBe('pointer');
  });
});

// ======================================================================
// CapacityInput
// ======================================================================
const CapacityInput = require('../../../frontend/src/components/inventory/common/CapacityInput').default;

describe('CapacityInput', () => {
  const item = createTestCatalogItem({ id: 'item1', name: 'Rubber Duck', sku: 'TOY-001', unitName: 'ducks' });

  it('renders item name and sku', () => {
    render(<CapacityInput item={item} capacity={null} onSave={jest.fn()} />);
    expect(screen.getByText('Rubber Duck')).toBeInTheDocument();
    expect(screen.getByText('TOY-001')).toBeInTheDocument();
  });

  it('displays existing capacity values', () => {
    render(<CapacityInput item={item} capacity={{ currentStock: 100, capacityPerDay: 25 }} onSave={jest.fn()} />);
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs[0]).toHaveValue(100);
    expect(inputs[1]).toHaveValue(25);
  });

  it('defaults to 0 when capacity is null', () => {
    render(<CapacityInput item={item} capacity={null} onSave={jest.fn()} />);
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs[0]).toHaveValue(0);
    expect(inputs[1]).toHaveValue(0);
  });

  it('shows Save button only when dirty', () => {
    render(<CapacityInput item={item} capacity={null} onSave={jest.fn()} />);
    expect(screen.queryByText('💾 Save Changes')).not.toBeInTheDocument();
    
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '50' } });
    expect(screen.getByText('💾 Save Changes')).toBeInTheDocument();
  });

  it('calls onSave with parsed values when Save is clicked', () => {
    const onSave = jest.fn();
    render(<CapacityInput item={item} capacity={null} onSave={onSave} />);
    
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '50' } });
    fireEvent.change(screen.getAllByRole('spinbutton')[1], { target: { value: '10' } });
    fireEvent.click(screen.getByText('💾 Save Changes'));
    
    expect(onSave).toHaveBeenCalledWith('item1', { currentStock: 50, capacityPerDay: 10 });
  });

  it('clamps negative values to 0', () => {
    const onSave = jest.fn();
    render(<CapacityInput item={item} capacity={null} onSave={onSave} />);
    
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '-5' } });
    fireEvent.click(screen.getByText('💾 Save Changes'));
    
    expect(onSave).toHaveBeenCalledWith('item1', expect.objectContaining({ currentStock: 0 }));
  });

  it('displays availability info based on stock and backlog', () => {
    render(<CapacityInput item={item} capacity={{ currentStock: 100, capacityPerDay: 0, backlog: 20 }} onSave={jest.fn()} />);
    expect(screen.getByText(/Available: Now/)).toBeInTheDocument();
    expect(screen.getByText(/Backlog: 20/)).toBeInTheDocument();
  });
});

// ======================================================================
// RequestRow
// ======================================================================
const RequestRow = require('../../../frontend/src/components/inventory/common/RequestRow').default;

describe('RequestRow', () => {
  const req = createTestRequest({
    id: 'req-123456',
    catalogItemName: 'Gadget',
    quantity: 25,
    city: 'Austin',
    state: 'TX',
    status: 'open',
    assignedTo: 'pubkey123',
    requestedAt: Date.now() - 3600000,
  });

  const collabs = [{ publicKeyBase62: 'pubkey123', name: 'Alice' }];

  const renderRow = (props = {}) => {
    return render(
      <table>
        <tbody>
          <RequestRow request={req} collaborators={collabs} {...props} />
        </tbody>
      </table>
    );
  };

  it('renders ID, item, quantity, location, and status', () => {
    renderRow();
    expect(screen.getByText('#123456')).toBeInTheDocument();
    expect(screen.getByText('Gadget')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('Austin, TX')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('resolves assigned producer name from collaborators', () => {
    renderRow();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('shows truncated key when collaborator not found', () => {
    renderRow({ collaborators: [] });
    expect(screen.getByText('pubkey12…')).toBeInTheDocument();
  });

  it('shows — when no assignedTo', () => {
    const noAssign = { ...req, assignedTo: null };
    render(
      <table><tbody><RequestRow request={noAssign} collaborators={collabs} /></tbody></table>
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('calls onClick when row is clicked', () => {
    const onClick = jest.fn();
    renderRow({ onClick });
    fireEvent.click(screen.getByText('Gadget'));
    expect(onClick).toHaveBeenCalledWith(req);
  });

  it('applies expanded class', () => {
    const { container } = renderRow({ isExpanded: true });
    expect(container.querySelector('.request-row--expanded')).toBeInTheDocument();
  });

  it('applies urgent class and shows ⚡ for urgent requests', () => {
    const urgentReq = { ...req, urgent: true };
    const { container } = render(
      <table><tbody><RequestRow request={urgentReq} collaborators={collabs} /></tbody></table>
    );
    expect(container.querySelector('.request-row--urgent')).toBeInTheDocument();
    expect(screen.getByText('⚡')).toBeInTheDocument();
  });
});

// ======================================================================
// RequestDetail
// ======================================================================
const RequestDetail = require('../../../frontend/src/components/inventory/common/RequestDetail').default;

describe('RequestDetail', () => {
  const req = createTestRequest({
    id: 'req-detail1',
    catalogItemName: 'Widget Pro',
    quantity: 100,
    unit: 'boxes',
    city: 'Portland',
    state: 'OR',
    status: 'claimed',
    requestedAt: Date.now() - 86400000,
    requestedBy: 'user1key',
    assignedTo: 'prod1key',
    notes: 'Please ship ASAP',
    urgent: true,
  });

  const collabs = [
    { publicKeyBase62: 'user1key', name: 'Bob' },
    { publicKeyBase62: 'prod1key', name: 'Alice Producer' },
  ];

  it('displays request details: item, quantity, location', () => {
    render(<RequestDetail request={req} collaborators={collabs} />);
    expect(screen.getByText('Widget Pro')).toBeInTheDocument();
    expect(screen.getByText(/100/)).toBeInTheDocument();
    expect(screen.getByText(/Portland, OR/)).toBeInTheDocument();
  });

  it('shows ⚡ for urgent requests', () => {
    render(<RequestDetail request={req} collaborators={collabs} />);
    expect(screen.getAllByText(/⚡/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows requestor notes', () => {
    render(<RequestDetail request={req} collaborators={collabs} />);
    expect(screen.getByText('Please ship ASAP')).toBeInTheDocument();
  });

  it('resolves collaborator names for requestedBy and assignedTo', () => {
    render(<RequestDetail request={req} collaborators={collabs} />);
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Alice Producer')).toBeInTheDocument();
  });

  it('shows admin actions (Approve/Reject/Reassign) for admin with claimed status', () => {
    render(<RequestDetail request={req} isAdmin collaborators={collabs} onApprove={jest.fn()} onReject={jest.fn()} onReassign={jest.fn()} />);
    expect(screen.getByText('✓ Approve')).toBeInTheDocument();
    expect(screen.getByText('✗ Reject')).toBeInTheDocument();
    expect(screen.getByText('→ Reassign')).toBeInTheDocument();
  });

  it('shows admin notes textarea when isAdmin', () => {
    render(<RequestDetail request={req} isAdmin collaborators={collabs} />);
    expect(screen.getByPlaceholderText('Internal notes...')).toBeInTheDocument();
    expect(screen.getByText('💾 Save Notes')).toBeInTheDocument();
  });

  it('hides admin UI when not admin', () => {
    render(<RequestDetail request={req} collaborators={collabs} />);
    expect(screen.queryByPlaceholderText('Internal notes...')).not.toBeInTheDocument();
  });

  it('shows producer shipping form when isProducer and status is approved', () => {
    const approved = { ...req, status: 'approved' };
    render(
      <RequestDetail
        request={approved}
        isProducer
        collaborators={collabs}
        onMarkShipped={jest.fn()}
      />
    );
    expect(screen.getByPlaceholderText('1Z999AA10123456784')).toBeInTheDocument();
    expect(screen.getByText('📦 Mark as Shipped')).toBeInTheDocument();
  });

  it('shows cancel button for cancellable statuses', () => {
    const openReq = { ...req, status: 'open' };
    const onCancel = jest.fn();
    render(<RequestDetail request={openReq} collaborators={collabs} onCancel={onCancel} />);
    const cancelBtn = screen.getByText('Cancel Request');
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalledWith(openReq);
  });

  it('hides cancel button for non-cancellable statuses', () => {
    const shipped = { ...req, status: 'shipped' };
    render(<RequestDetail request={shipped} collaborators={collabs} />);
    expect(screen.queryByText('Cancel Request')).not.toBeInTheDocument();
  });

  it('calls onClose when close button clicked', () => {
    const onClose = jest.fn();
    render(<RequestDetail request={req} collaborators={collabs} onClose={onClose} />);
    fireEvent.click(screen.getByText('✕'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders timeline entries for dates present on request', () => {
    const withTimeline = {
      ...req,
      requestedAt: Date.now() - 86400000 * 3,
      assignedAt: Date.now() - 86400000 * 2,
    };
    render(<RequestDetail request={withTimeline} collaborators={collabs} />);
    expect(screen.getByText('Requested')).toBeInTheDocument();
    expect(screen.getByText('Assigned')).toBeInTheDocument();
  });
});
