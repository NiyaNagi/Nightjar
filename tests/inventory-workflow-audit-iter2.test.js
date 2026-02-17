/**
 * tests/inventory-workflow-audit-iter2.test.js
 *
 * Iteration 2 audit tests — verifies fixes for issues found in second pass:
 *
 * 1. MyRequests actorRole — 'requestor' → 'viewer' (4 occurrences)
 * 2. CatalogManager actorRole — 'admin' → 'owner' (3 occurrences)
 * 3. AdminDashboard — c.role → c.permission for Notify Producers
 * 4. AdminDashboard — approvedBy field in handleApprove
 * 5. AdminDashboard — claimedBy/claimedAt cleared in handleReject
 * 6. AdminDashboard — userIdentity in handleApprove/handleReject deps
 * 7. ApprovalQueue — notifications on approve/reject
 * 8. ApprovalQueue — logAudit uses specific deps (not full ctx)
 * 9. ProducerDashboard — kanban columns fixed (pending_approval ≠ Ready to Ship)
 * 10. ProducerDashboard — in_progress column added
 * 11. ProducerDashboard — inventorySystemId in capacity save
 * 12. ProducerDashboard — handleUnclaim sends notification
 */

import React from 'react';
import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';

// ============================================================
// Hoisted jest.mock() calls
// ============================================================

let mockInventoryCtx = {};

jest.mock('../frontend/src/contexts/InventoryContext', () => ({
  useInventory: jest.fn(() => mockInventoryCtx),
  InventoryProvider: ({ children }) => <div>{children}</div>,
}));

jest.mock('../frontend/src/contexts/ToastContext', () => ({
  useToast: jest.fn(() => ({ showToast: jest.fn() })),
}));

const mockPushNotification = jest.fn();
jest.mock('../frontend/src/utils/inventoryNotifications', () => ({
  pushNotification: (...args) => mockPushNotification(...args),
  getUnreadCount: jest.fn(() => 0),
}));

jest.mock('../frontend/src/utils/inventoryExport', () => ({
  exportRequests: jest.fn(),
  exportAuditLog: jest.fn(),
}));

jest.mock('../frontend/src/utils/inventoryValidation', () => ({
  ...jest.requireActual('../frontend/src/utils/inventoryValidation'),
  generateId: jest.fn(() => 'mock-id-' + Math.random().toString(36).slice(2, 8)),
}));

jest.mock('../frontend/src/utils/resolveUserName', () => ({
  resolveUserName: jest.fn((collabs, key, fallback) => {
    const c = (collabs || []).find(x => x.publicKey === key || x.publicKeyBase62 === key);
    return c?.displayName || c?.name || fallback || key?.slice(0, 8) + '…';
  }),
  resolveCollaborator: jest.fn((collabs, key) => {
    return (collabs || []).find(x => x.publicKey === key || x.publicKeyBase62 === key) || null;
  }),
}));

jest.mock('../frontend/src/utils/addressCrypto', () => ({
  getPublicKeyHex: jest.fn(id => id?.publicKey || 'hex-key'),
  base62ToPublicKeyHex: jest.fn(b62 => 'hex-' + b62),
  createAddressReveal: jest.fn(async () => ({ encrypted: true, nonce: 'n', ciphertext: 'ct' })),
  decryptPendingAddress: jest.fn(async () => ({ street: '123 Main', city: 'Test', state: 'TX', zip: '12345' })),
  encryptAddressForAdmins: jest.fn(async () => [{ adminKey: 'a1', encrypted: 'enc' }]),
}));

jest.mock('../frontend/src/utils/inventoryAddressStore', () => ({
  getAddress: jest.fn(async () => null),
  getWorkspaceKeyMaterial: jest.fn(() => ({ key: 'km' })),
  storeAddress: jest.fn(async () => {}),
}));

jest.mock('../frontend/src/components/inventory/common/StatusBadge', () => {
  return function MockStatusBadge({ status }) {
    return <span data-testid="status-badge">{status}</span>;
  };
});

jest.mock('../frontend/src/components/inventory/common/RequestDetail', () => {
  return function MockRequestDetail() {
    return <div data-testid="request-detail">Detail</div>;
  };
});

jest.mock('../frontend/src/components/inventory/common/CapacityInput', () => {
  return function MockCapacityInput({ onSave }) {
    return <button data-testid="capacity-save" onClick={() => onSave('item-1', { currentStock: 10, capacityPerDay: 5 })}>Save</button>;
  };
});

jest.mock('../frontend/src/components/inventory/producer/AddressReveal', () => {
  return function MockAddressReveal() {
    return <div data-testid="address-reveal">Address</div>;
  };
});

jest.mock('../frontend/src/components/inventory/common/SlidePanel', () => {
  return function MockSlidePanel({ children, isOpen }) {
    return isOpen ? <div data-testid="slide-panel">{children}</div> : null;
  };
});

jest.mock('../frontend/src/components/common/ChatButton', () => {
  return function MockChatButton() {
    return <button data-testid="chat-button">Chat</button>;
  };
});

// ============================================================
// Helpers
// ============================================================

function createMockYArray(initial = []) {
  const arr = [...initial];
  return {
    toArray: () => [...arr],
    push: jest.fn(items => arr.push(...items)),
    insert: jest.fn((idx, items) => arr.splice(idx, 0, ...items)),
    delete: jest.fn((idx, len) => arr.splice(idx, len)),
    get length() { return arr.length; },
    observe: jest.fn(),
    unobserve: jest.fn(),
    doc: { transact: (fn) => fn() },
  };
}

function createMockYMap(initial = {}) {
  const map = { ...initial };
  return {
    get: jest.fn(key => map[key]),
    set: jest.fn((key, val) => { map[key] = val; }),
    delete: jest.fn(key => { delete map[key]; }),
    has: jest.fn(key => key in map),
    forEach: jest.fn(fn => Object.entries(map).forEach(([k, v]) => fn(v, k))),
    entries: jest.fn(function* () { for (const [k, v] of Object.entries(map)) yield [k, v]; }),
    toJSON: () => ({ ...map }),
    observe: jest.fn(),
    unobserve: jest.fn(),
  };
}

// ============================================================
// §1 — MyRequests: actorRole must be 'viewer' not 'requestor'
// ============================================================

describe('MyRequests — actorRole source verification', () => {
  let sourceCode;

  beforeEach(() => {
    const fs = require('fs');
    const path = require('path');
    sourceCode = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/components/inventory/requestor/MyRequests.jsx'),
      'utf8'
    );
  });

  test('does NOT use actorRole "requestor"', () => {
    expect(sourceCode).not.toContain("actorRole: 'requestor'");
  });

  test('uses actorRole "viewer" in all audit entries', () => {
    // Find all actorRole assignments in audit logs
    const matches = sourceCode.match(/actorRole:\s*'([^']+)'/g);
    expect(matches).toBeTruthy();
    expect(matches.length).toBeGreaterThanOrEqual(4);
    for (const m of matches) {
      expect(m).toContain("'viewer'");
    }
  });

  test('handleCancel uses actorRole "viewer"', () => {
    const cancelMatch = sourceCode.match(/handleCancel[\s\S]*?(?=const handleConfirm)/);
    expect(cancelMatch).toBeTruthy();
    expect(cancelMatch[0]).toContain("actorRole: 'viewer'");
    expect(cancelMatch[0]).not.toContain("actorRole: 'requestor'");
  });

  test('handleConfirmDelivered uses actorRole "viewer"', () => {
    const deliverMatch = sourceCode.match(/handleConfirmDelivered[\s\S]*?(?=const handleRequestAgain)/);
    expect(deliverMatch).toBeTruthy();
    expect(deliverMatch[0]).toContain("actorRole: 'viewer'");
  });

  test('handleRequestAgain uses actorRole "viewer"', () => {
    const reqAgainMatch = sourceCode.match(/handleRequestAgain[\s\S]*?(?=const handleStartEdit)/);
    expect(reqAgainMatch).toBeTruthy();
    expect(reqAgainMatch[0]).toContain("actorRole: 'viewer'");
  });

  test('handleSaveEdit uses actorRole "viewer"', () => {
    const editMatch = sourceCode.match(/handleSaveEdit[\s\S]*?(?=const startEdit|return \()/);
    expect(editMatch).toBeTruthy();
    expect(editMatch[0]).toContain("actorRole: 'viewer'");
  });
});

// ============================================================
// §2 — CatalogManager: actorRole must be 'owner' not 'admin'
// ============================================================

describe('CatalogManager — actorRole source verification', () => {
  let sourceCode;

  beforeEach(() => {
    const fs = require('fs');
    const path = require('path');
    sourceCode = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/components/inventory/admin/CatalogManager.jsx'),
      'utf8'
    );
  });

  test('does NOT use actorRole "admin"', () => {
    expect(sourceCode).not.toContain("actorRole: 'admin'");
  });

  test('uses actorRole "owner" in all audit entries', () => {
    const matches = sourceCode.match(/actorRole:\s*'([^']+)'/g);
    expect(matches).toBeTruthy();
    expect(matches.length).toBeGreaterThanOrEqual(3);
    for (const m of matches) {
      expect(m).toContain("'owner'");
    }
  });

  test('catalog_item_added uses actorRole "owner"', () => {
    const addMatch = sourceCode.match(/catalog_item_added[\s\S]*?timestamp/);
    expect(addMatch).toBeTruthy();
    expect(addMatch[0]).toContain("actorRole: 'owner'");
  });

  test('catalog_item_updated uses actorRole "owner"', () => {
    const updateMatch = sourceCode.match(/catalog_item_updated[\s\S]*?timestamp/);
    expect(updateMatch).toBeTruthy();
    expect(updateMatch[0]).toContain("actorRole: 'owner'");
  });

  test('catalog_item_activated/deactivated uses actorRole "owner"', () => {
    const toggleMatch = sourceCode.match(/catalog_item_activated[\s\S]*?timestamp/);
    expect(toggleMatch).toBeTruthy();
    expect(toggleMatch[0]).toContain("actorRole: 'owner'");
  });
});

// ============================================================
// §3 — AdminDashboard: c.permission (not c.role) for Notify Producers
// ============================================================

describe('AdminDashboard — source verification', () => {
  let sourceCode;

  beforeEach(() => {
    const fs = require('fs');
    const path = require('path');
    sourceCode = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/components/inventory/admin/AdminDashboard.jsx'),
      'utf8'
    );
  });

  test('Notify Producers uses c.permission not c.role', () => {
    // Should use c.permission to filter editors
    expect(sourceCode).not.toMatch(/c\.role\s*===\s*'editor'/);
    expect(sourceCode).toMatch(/c\.permission\s*===\s*'editor'/);
  });

  test('handleApprove includes approvedBy field', () => {
    const approveMatch = sourceCode.match(/handleApprove[\s\S]*?(?=const handleReject)/);
    expect(approveMatch).toBeTruthy();
    expect(approveMatch[0]).toContain('approvedBy');
    expect(approveMatch[0]).toContain('publicKeyBase62');
  });

  test('handleReject clears claimedBy and claimedAt', () => {
    const rejectMatch = sourceCode.match(/handleReject[\s\S]*?(?=const getAssignedName|return \()/);
    expect(rejectMatch).toBeTruthy();
    expect(rejectMatch[0]).toContain('claimedBy: null');
    expect(rejectMatch[0]).toContain('claimedAt: null');
  });

  test('handleApprove deps include userIdentity', () => {
    // Find the deps array after handleApprove
    const approveSection = sourceCode.match(/handleApprove[\s\S]*?(?=const handleReject)/);
    expect(approveSection).toBeTruthy();
    const depsMatch = approveSection[0].match(/\}, \[([^\]]+)\]\)/);
    expect(depsMatch).toBeTruthy();
    expect(depsMatch[1]).toContain('userIdentity');
  });

  test('handleReject deps include userIdentity', () => {
    const rejectSection = sourceCode.match(/handleReject[\s\S]*?(?=const getAssignedName|return \()/);
    expect(rejectSection).toBeTruthy();
    const depsMatch = rejectSection[0].match(/\}, \[([^\]]+)\]\)/);
    expect(depsMatch).toBeTruthy();
    expect(depsMatch[1]).toContain('userIdentity');
  });
});

// ============================================================
// §4 — ApprovalQueue: notifications on approve/reject + logAudit deps
// ============================================================

describe('ApprovalQueue — source verification', () => {
  let sourceCode;

  beforeEach(() => {
    const fs = require('fs');
    const path = require('path');
    sourceCode = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/components/inventory/admin/ApprovalQueue.jsx'),
      'utf8'
    );
  });

  test('imports pushNotification', () => {
    expect(sourceCode).toContain("import { pushNotification }");
    expect(sourceCode).toContain("inventoryNotifications");
  });

  test('handleApprove sends notification to requestor', () => {
    const approveMatch = sourceCode.match(/handleApprove[\s\S]*?(?=const handleReject)/);
    expect(approveMatch).toBeTruthy();
    const body = approveMatch[0];
    expect(body).toContain('pushNotification');
    expect(body).toContain("type: 'request_approved'");
    expect(body).toContain('requestedBy');
  });

  test('handleApprove sends notification to assigned producer', () => {
    const approveMatch = sourceCode.match(/handleApprove[\s\S]*?(?=const handleReject)/);
    const body = approveMatch[0];
    expect(body).toContain('assignedTo');
    // Should have 2 pushNotification calls (requestor + producer)
    const notifCalls = (body.match(/pushNotification/g) || []).length;
    expect(notifCalls).toBeGreaterThanOrEqual(2);
  });

  test('handleReject sends notification to requestor', () => {
    const rejectMatch = sourceCode.match(/handleReject[\s\S]*?(?=const handleBulk)/);
    expect(rejectMatch).toBeTruthy();
    const body = rejectMatch[0];
    expect(body).toContain('pushNotification');
    expect(body).toContain("type: 'request_rejected'");
    expect(body).toContain('requestedBy');
  });

  test('handleReject captures original request before modifying', () => {
    const rejectMatch = sourceCode.match(/handleReject[\s\S]*?(?=const handleBulk)/);
    const body = rejectMatch[0];
    // Should read original data BEFORE findAndUpdateRequest clears assignedTo
    const originalReqIdx = body.indexOf('originalReq');
    const findUpdateIdx = body.indexOf('findAndUpdateRequest');
    expect(originalReqIdx).toBeLessThan(findUpdateIdx);
  });

  test('handleReject sends notification to assigned producer', () => {
    const rejectMatch = sourceCode.match(/handleReject[\s\S]*?(?=const handleBulk)/);
    const body = rejectMatch[0];
    expect(body).toContain('assignedTo');
    const notifCalls = (body.match(/pushNotification/g) || []).length;
    expect(notifCalls).toBeGreaterThanOrEqual(2);
  });

  test('logAudit uses specific ctx properties not full ctx', () => {
    const logMatch = sourceCode.match(/const logAudit[\s\S]*?(?=const handleApprove)/);
    expect(logMatch).toBeTruthy();
    const depsMatch = logMatch[0].match(/\}, \[([^\]]+)\]\)/);
    expect(depsMatch).toBeTruthy();
    const deps = depsMatch[1];
    // Should reference specific ctx properties, not just 'ctx'
    expect(deps).toContain('ctx.yInventoryAuditLog');
    expect(deps).toContain('ctx.inventorySystemId');
    expect(deps).toContain('ctx.userIdentity');
    // Should NOT just be [ctx]
    expect(deps).not.toMatch(/^\s*ctx\s*$/);
  });

  test('handleApprove deps include adminNotes', () => {
    const approveSection = sourceCode.match(/handleApprove[\s\S]*?(?=const handleReject)/);
    expect(approveSection).toBeTruthy();
    const depsMatch = approveSection[0].match(/\}, \[([^\]]+)\]\)/);
    expect(depsMatch).toBeTruthy();
    expect(depsMatch[1]).toContain('adminNotes');
  });

  test('handleReject deps include adminNotes', () => {
    const rejectSection = sourceCode.match(/handleReject[\s\S]*?(?=const handleBulk)/);
    expect(rejectSection).toBeTruthy();
    const depsMatch = rejectSection[0].match(/\}, \[([^\]]+)\]\)/);
    expect(depsMatch).toBeTruthy();
    expect(depsMatch[1]).toContain('adminNotes');
  });
});

// ============================================================
// §5 — ProducerDashboard: kanban columns
// ============================================================

describe('ProducerDashboard — kanban columns source verification', () => {
  let sourceCode;

  beforeEach(() => {
    const fs = require('fs');
    const path = require('path');
    sourceCode = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/components/inventory/producer/ProducerDashboard.jsx'),
      'utf8'
    );
  });

  test('pending_approval column is labeled "Pending Approval" not "Ready to Ship"', () => {
    expect(sourceCode).not.toContain("label: 'Ready to Ship'");
    expect(sourceCode).toContain("label: 'Pending Approval'");
    // Verify pending_approval is in the right column
    const pendingMatch = sourceCode.match(/pending_approval/);
    expect(pendingMatch).toBeTruthy();
    // Should be associated with "Pending Approval" label
    const kanbanSection = sourceCode.match(/KANBAN_COLUMNS[\s\S]*?\];/);
    expect(kanbanSection).toBeTruthy();
    expect(kanbanSection[0]).toContain("'Pending Approval'");
    expect(kanbanSection[0]).toContain("'pending_approval'");
  });

  test('in_progress column exists', () => {
    const kanbanSection = sourceCode.match(/KANBAN_COLUMNS[\s\S]*?\];/);
    expect(kanbanSection).toBeTruthy();
    expect(kanbanSection[0]).toContain("'in_progress'");
    expect(kanbanSection[0]).toContain("'In Progress'");
  });

  test('kanban has correct column order: claimed → pending → approved → in_progress → shipped', () => {
    const kanbanSection = sourceCode.match(/KANBAN_COLUMNS[\s\S]*?\];/);
    expect(kanbanSection).toBeTruthy();
    const body = kanbanSection[0];
    const claimedIdx = body.indexOf("'claimed'");
    const pendingIdx = body.indexOf("'Pending Approval'");
    const approvedIdx = body.indexOf("'Approved'");
    const inProgressIdx = body.indexOf("'In Progress'");
    const shippedIdx = body.indexOf("'Shipped'");
    expect(claimedIdx).toBeLessThan(pendingIdx);
    expect(pendingIdx).toBeLessThan(approvedIdx);
    expect(approvedIdx).toBeLessThan(inProgressIdx);
    expect(inProgressIdx).toBeLessThan(shippedIdx);
  });
});

// ============================================================
// §6 — ProducerDashboard: inventorySystemId in capacity save
// ============================================================

describe('ProducerDashboard — capacity inventorySystemId source verification', () => {
  let sourceCode;

  beforeEach(() => {
    const fs = require('fs');
    const path = require('path');
    sourceCode = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/components/inventory/producer/ProducerDashboard.jsx'),
      'utf8'
    );
  });

  test('handleSaveCapacity includes inventorySystemId', () => {
    const capMatch = sourceCode.match(/handleSaveCapacity[\s\S]*?(?=const handleUnclaim)/);
    expect(capMatch).toBeTruthy();
    expect(capMatch[0]).toContain('inventorySystemId');
  });
});

// ============================================================
// §7 — ProducerDashboard: handleUnclaim sends notification
// ============================================================

describe('ProducerDashboard — handleUnclaim notification source verification', () => {
  let sourceCode;

  beforeEach(() => {
    const fs = require('fs');
    const path = require('path');
    sourceCode = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/components/inventory/producer/ProducerDashboard.jsx'),
      'utf8'
    );
  });

  test('imports pushNotification', () => {
    expect(sourceCode).toContain("import { pushNotification }");
    expect(sourceCode).toContain("inventoryNotifications");
  });

  test('handleUnclaim sends notification to requestor', () => {
    const unclaimMatch = sourceCode.match(/handleUnclaim[\s\S]*?(?=\/\/ My stats|const stats)/);
    expect(unclaimMatch).toBeTruthy();
    const body = unclaimMatch[0];
    expect(body).toContain('pushNotification');
    expect(body).toContain('requestedBy');
    expect(body).toContain("type: 'request_unclaimed'");
  });
});

// ============================================================
// §8 — Functional test: ApprovalQueue approve triggers notifications
// ============================================================

describe('ApprovalQueue — functional notification tests', () => {
  const ApprovalQueue = require('../frontend/src/components/inventory/admin/ApprovalQueue').default;

  const baseCtx = () => ({
    requests: [
      {
        id: 'req-1',
        catalogItemId: 'cat-1',
        catalogItemName: 'Widget',
        status: 'pending_approval',
        requestedBy: 'requestor-key',
        assignedTo: 'producer-key',
        quantity: 5,
        city: 'Austin',
        state: 'TX',
        requestedAt: Date.now() - 86400000,
        urgent: false,
      },
    ],
    catalogItems: [{ id: 'cat-1', name: 'Widget', unit: 'pcs', active: true }],
    producerCapacities: {},
    addressReveals: {},
    collaborators: [
      { publicKeyBase62: 'requestor-key', permission: 'viewer', displayName: 'Requestor' },
      { publicKeyBase62: 'producer-key', permission: 'editor', displayName: 'Producer' },
      { publicKeyBase62: 'admin-key', permission: 'owner', displayName: 'Admin' },
    ],
    userIdentity: { publicKeyBase62: 'admin-key', publicKey: 'admin-pk' },
    inventorySystemId: 'sys-1',
    yInventoryRequests: createMockYArray([
      {
        id: 'req-1',
        catalogItemId: 'cat-1',
        catalogItemName: 'Widget',
        status: 'pending_approval',
        requestedBy: 'requestor-key',
        assignedTo: 'producer-key',
        quantity: 5,
        city: 'Austin',
        state: 'TX',
        requestedAt: Date.now() - 86400000,
      },
    ]),
    yInventoryAuditLog: createMockYArray([]),
    yInventoryNotifications: createMockYArray([]),
    yPendingAddresses: createMockYMap({}),
    yAddressReveals: createMockYMap({}),
    currentWorkspace: 'test-ws',
    workspaceId: 'ws-1',
    onStartChatWith: jest.fn(),
  });

  beforeEach(() => {
    mockPushNotification.mockClear();
    mockInventoryCtx = baseCtx();
  });

  test('renders pending requests', () => {
    render(<ApprovalQueue />);
    expect(screen.getByText(/1 pending/)).toBeInTheDocument();
    expect(screen.getByText('Widget')).toBeInTheDocument();
  });

  test('approve sends notification to requestor and producer', async () => {
    render(<ApprovalQueue />);
    const approveBtn = screen.getByText('✓ Approve');
    await act(async () => {
      fireEvent.click(approveBtn);
    });

    // Should send 2 notifications: requestor + producer
    expect(mockPushNotification).toHaveBeenCalledTimes(2);

    // First call: requestor notification
    const firstCall = mockPushNotification.mock.calls[0];
    expect(firstCall[1]).toMatchObject({
      recipientId: 'requestor-key',
      type: 'request_approved',
    });

    // Second call: producer notification
    const secondCall = mockPushNotification.mock.calls[1];
    expect(secondCall[1]).toMatchObject({
      recipientId: 'producer-key',
      type: 'request_approved',
    });
  });

  test('reject sends notifications to requestor and producer', () => {
    render(<ApprovalQueue />);
    const rejectBtn = screen.getByText('✗ Reject');
    fireEvent.click(rejectBtn);

    // Should send 2 notifications
    expect(mockPushNotification).toHaveBeenCalledTimes(2);

    const firstCall = mockPushNotification.mock.calls[0];
    expect(firstCall[1]).toMatchObject({
      recipientId: 'requestor-key',
      type: 'request_rejected',
    });

    const secondCall = mockPushNotification.mock.calls[1];
    expect(secondCall[1]).toMatchObject({
      recipientId: 'producer-key',
      type: 'request_rejected',
    });
  });

  test('empty queue shows correct message', () => {
    mockInventoryCtx = {
      ...baseCtx(),
      requests: [],
    };
    render(<ApprovalQueue />);
    expect(screen.getByText('No requests pending approval')).toBeInTheDocument();
  });
});

// ============================================================
// §9 — Functional test: ProducerDashboard renders correct kanban columns
// ============================================================

describe('ProducerDashboard — kanban column rendering', () => {
  const ProducerDashboard = require('../frontend/src/components/inventory/producer/ProducerDashboard').default;

  const makeCtx = (requests = []) => ({
    requests,
    catalogItems: [{ id: 'cat-1', name: 'Widget', unit: 'pcs', active: true }],
    producerCapacities: {},
    addressReveals: {},
    collaborators: [
      { publicKeyBase62: 'my-key', permission: 'editor', displayName: 'Producer' },
    ],
    userIdentity: { publicKeyBase62: 'my-key', publicKey: 'my-pk' },
    inventorySystemId: 'sys-1',
    yInventoryRequests: createMockYArray(requests),
    yInventoryAuditLog: createMockYArray([]),
    yInventoryNotifications: createMockYArray([]),
    yPendingAddresses: createMockYMap({}),
    yAddressReveals: createMockYMap({}),
    yProducerCapacities: createMockYMap({}),
    currentWorkspace: 'test-ws',
    workspaceId: 'ws-1',
    onStartChatWith: jest.fn(),
    nameMap: {},
  });

  beforeEach(() => {
    mockPushNotification.mockClear();
  });

  test('renders "Pending Approval" column, not "Ready to Ship"', () => {
    mockInventoryCtx = makeCtx([]);
    render(<ProducerDashboard />);
    expect(screen.getByText('Pending Approval')).toBeInTheDocument();
    expect(screen.queryByText('Ready to Ship')).not.toBeInTheDocument();
  });

  test('renders "In Progress" column', () => {
    mockInventoryCtx = makeCtx([]);
    render(<ProducerDashboard />);
    expect(screen.getByText('In Progress')).toBeInTheDocument();
  });

  test('renders all 5 kanban columns', () => {
    mockInventoryCtx = makeCtx([]);
    render(<ProducerDashboard />);
    expect(screen.getByText('Claimed')).toBeInTheDocument();
    expect(screen.getByText('Pending Approval')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('Shipped')).toBeInTheDocument();
  });
});

// ============================================================
// §10 — Cross-file: no invalid actorRole values anywhere
// ============================================================

describe('Global actorRole validation', () => {
  const fs = require('fs');
  const path = require('path');

  const filesToCheck = [
    'frontend/src/components/inventory/requestor/MyRequests.jsx',
    'frontend/src/components/inventory/admin/CatalogManager.jsx',
    'frontend/src/components/inventory/admin/AdminDashboard.jsx',
    'frontend/src/components/inventory/admin/ApprovalQueue.jsx',
    'frontend/src/components/inventory/admin/AllRequests.jsx',
    'frontend/src/components/inventory/producer/ProducerDashboard.jsx',
    'frontend/src/components/inventory/producer/AddressReveal.jsx',
  ];

  test.each(filesToCheck)('%s uses only valid actorRole values (owner|editor|viewer)', (relPath) => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', relPath), 'utf8');
    const roleMatches = src.match(/actorRole:\s*'([^']+)'/g);
    if (!roleMatches) return; // File might not have audit logs

    const validRoles = ['owner', 'editor', 'viewer'];
    for (const m of roleMatches) {
      const role = m.match(/'([^']+)'/)[1];
      expect(validRoles).toContain(role);
    }
  });

  test('type definition declares actorRole as owner|editor|viewer', () => {
    const typeSrc = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/types/inventory.ts'),
      'utf8'
    );
    expect(typeSrc).toMatch(/actorRole:\s*'owner'\s*\|\s*'editor'\s*\|\s*'viewer'/);
  });
});

// ============================================================
// §11 — Cross-file: all admin components use c.permission not c.role
// ============================================================

describe('Admin components use c.permission not c.role', () => {
  const fs = require('fs');
  const path = require('path');

  const adminFiles = [
    'frontend/src/components/inventory/admin/AdminDashboard.jsx',
    'frontend/src/components/inventory/admin/ApprovalQueue.jsx',
    'frontend/src/components/inventory/admin/AllRequests.jsx',
    'frontend/src/components/inventory/admin/ProducerManagement.jsx',
  ];

  test.each(adminFiles)('%s does not reference c.role for permission checks', (relPath) => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', relPath), 'utf8');
    // c.role is an invalid property — the correct one is c.permission
    expect(src).not.toMatch(/c\.role\s*===\s*'/);
  });
});
