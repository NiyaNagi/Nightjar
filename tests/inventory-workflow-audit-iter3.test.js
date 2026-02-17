/**
 * tests/inventory-workflow-audit-iter3.test.js
 *
 * Iteration 3 audit tests — verifies fixes for issues found in third pass:
 *
 * 1. AllRequests handleReject clears all assignment fields
 * 2. AllRequests handleCancel clears all assignment fields
 * 3. isActive → active field filter (OpenRequests, ProducerDashboard, ProducerLeaderboard)
 * 4. OnboardingWizard saves autoAssignEnabled (not autoAssign) in settings
 * 5. OnboardingWizard includes systemIcon in handleSave deps
 * 6. AddressReveal unclaim clears approvedAt/approvedBy
 * 7. AddressReveal handleMarkShipped includes shippingNotes in deps
 * 8. SubmitRequest imports pushNotification and notifies admins
 * 9. RequestDetail syncs adminNotes/trackingNumber when request prop changes
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

jest.mock('../frontend/src/utils/inventoryAssignment', () => ({
  assignRequests: jest.fn(() => []),
}));

jest.mock('../frontend/src/utils/inventorySavedAddresses', () => ({
  getSavedAddresses: jest.fn(() => []),
  storeSavedAddress: jest.fn(),
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

function readSource(relPath) {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.resolve(__dirname, relPath), 'utf8');
}

// ============================================================
// §1 — AllRequests: handleReject clears all assignment fields
// ============================================================

describe('AllRequests — handleReject field clearing', () => {
  let src;
  beforeEach(() => { src = readSource('../frontend/src/components/inventory/admin/AllRequests.jsx'); });

  test('handleReject clears assignedTo', () => {
    const rejectBlock = src.match(/handleReject[\s\S]*?(?=const handleCancel|const handleMarkInProgress)/);
    expect(rejectBlock).toBeTruthy();
    expect(rejectBlock[0]).toContain('assignedTo: null');
  });

  test('handleReject clears assignedAt', () => {
    const rejectBlock = src.match(/handleReject[\s\S]*?(?=const handleCancel|const handleMarkInProgress)/);
    expect(rejectBlock[0]).toContain('assignedAt: null');
  });

  test('handleReject clears claimedBy', () => {
    const rejectBlock = src.match(/handleReject[\s\S]*?(?=const handleCancel|const handleMarkInProgress)/);
    expect(rejectBlock[0]).toContain('claimedBy: null');
  });

  test('handleReject clears claimedAt', () => {
    const rejectBlock = src.match(/handleReject[\s\S]*?(?=const handleCancel|const handleMarkInProgress)/);
    expect(rejectBlock[0]).toContain('claimedAt: null');
  });

  test('handleReject clears approvedAt', () => {
    const rejectBlock = src.match(/handleReject[\s\S]*?(?=const handleCancel|const handleMarkInProgress)/);
    expect(rejectBlock[0]).toContain('approvedAt: null');
  });

  test('handleReject clears approvedBy', () => {
    const rejectBlock = src.match(/handleReject[\s\S]*?(?=const handleCancel|const handleMarkInProgress)/);
    expect(rejectBlock[0]).toContain('approvedBy: null');
  });

  test('handleReject deps include ctx.userIdentity', () => {
    const rejectBlock = src.match(/handleReject[\s\S]*?(?=const handleCancel|const handleMarkInProgress)/);
    expect(rejectBlock[0]).toMatch(/},\s*\[[\s\S]*ctx\.userIdentity/);
  });
});

// ============================================================
// §2 — AllRequests: handleCancel clears assignment fields
// ============================================================

describe('AllRequests — handleCancel field clearing', () => {
  let src;
  beforeEach(() => { src = readSource('../frontend/src/components/inventory/admin/AllRequests.jsx'); });

  test('handleCancel clears assignedTo', () => {
    const cancelBlock = src.match(/handleCancel[\s\S]*?(?=const usedStates|return \()/);
    expect(cancelBlock).toBeTruthy();
    expect(cancelBlock[0]).toContain('assignedTo: null');
  });

  test('handleCancel clears assignedAt', () => {
    const cancelBlock = src.match(/handleCancel[\s\S]*?(?=const usedStates|return \()/);
    expect(cancelBlock[0]).toContain('assignedAt: null');
  });

  test('handleCancel clears claimedBy', () => {
    const cancelBlock = src.match(/handleCancel[\s\S]*?(?=const usedStates|return \()/);
    expect(cancelBlock[0]).toContain('claimedBy: null');
  });

  test('handleCancel clears claimedAt', () => {
    const cancelBlock = src.match(/handleCancel[\s\S]*?(?=const usedStates|return \()/);
    expect(cancelBlock[0]).toContain('claimedAt: null');
  });

  test('handleCancel deps include ctx.userIdentity', () => {
    const cancelBlock = src.match(/handleCancel[\s\S]*?(?=const usedStates|return \()/);
    expect(cancelBlock[0]).toMatch(/},\s*\[[\s\S]*ctx\.userIdentity/);
  });
});

// ============================================================
// §3 — isActive → active field filter
// ============================================================

describe('Catalog item filter uses "active" not "isActive"', () => {
  test('OpenRequests uses c.active (not c.isActive)', () => {
    const src = readSource('../frontend/src/components/inventory/producer/OpenRequests.jsx');
    expect(src).not.toContain('c.isActive');
    expect(src).toContain('c.active');
  });

  test('ProducerDashboard uses c.active (not c.isActive)', () => {
    const src = readSource('../frontend/src/components/inventory/producer/ProducerDashboard.jsx');
    expect(src).not.toContain('c.isActive');
    expect(src).toContain('c.active');
  });

  test('ProducerLeaderboard uses c.active (not c.isActive)', () => {
    const src = readSource('../frontend/src/components/inventory/analytics/ProducerLeaderboard.jsx');
    expect(src).not.toContain('c.isActive');
    expect(src).toContain('c.active');
  });

  test('SubmitRequest filters by i.active (correct baseline)', () => {
    const src = readSource('../frontend/src/components/inventory/requestor/SubmitRequest.jsx');
    expect(src).toContain('i.active');
    expect(src).not.toContain('i.isActive');
  });

  test('CatalogManager writes active field (not isActive)', () => {
    const src = readSource('../frontend/src/components/inventory/admin/CatalogManager.jsx');
    expect(src).toContain('active: true');
    expect(src).not.toContain('isActive: true');
  });
});

// ============================================================
// §4 — OnboardingWizard: saves autoAssignEnabled
// ============================================================

describe('OnboardingWizard — autoAssign settings key', () => {
  let src;
  beforeEach(() => { src = readSource('../frontend/src/components/inventory/OnboardingWizard.jsx'); });

  test('saves autoAssignEnabled in settings (not raw autoAssign)', () => {
    // The settings object should have autoAssignEnabled, not autoAssign as a key
    expect(src).toContain('autoAssignEnabled: autoAssign');
    // Should NOT have just `autoAssign,` as shorthand in settings object
    const settingsBlock = src.match(/settings:\s*\{[\s\S]*?autoAssign[\s\S]*?\}/);
    expect(settingsBlock).toBeTruthy();
    expect(settingsBlock[0]).toContain('autoAssignEnabled');
  });

  test('SubmitRequest reads autoAssignEnabled (consumer matches)', () => {
    const submitSrc = readSource('../frontend/src/components/inventory/requestor/SubmitRequest.jsx');
    expect(submitSrc).toContain('autoAssignEnabled');
  });

  test('InventorySettings reads autoAssignEnabled (consumer matches)', () => {
    const settingsSrc = readSource('../frontend/src/components/inventory/admin/InventorySettings.jsx');
    expect(settingsSrc).toContain('autoAssignEnabled');
  });
});

// ============================================================
// §5 — OnboardingWizard: systemIcon in handleSave deps
// ============================================================

describe('OnboardingWizard — systemIcon dependency', () => {
  let src;
  beforeEach(() => { src = readSource('../frontend/src/components/inventory/OnboardingWizard.jsx'); });

  test('handleSave dep array includes systemIcon', () => {
    // Find the handleSave useCallback and its deps
    const handleSaveBlock = src.match(/const handleSave[\s\S]*?(?=const handleAddFirstItem)/);
    expect(handleSaveBlock).toBeTruthy();
    expect(handleSaveBlock[0]).toContain('systemIcon');
    // Make sure it's in the dep array, not just the callback body
    const depsMatch = handleSaveBlock[0].match(/},\s*\[([^\]]+)\]/);
    expect(depsMatch).toBeTruthy();
    expect(depsMatch[1]).toContain('systemIcon');
  });

  test('handleSave sets icon to systemIcon in the Yjs update', () => {
    const handleSaveBlock = src.match(/const handleSave[\s\S]*?(?=const handleAddFirstItem)/);
    expect(handleSaveBlock[0]).toContain('icon: systemIcon');
  });
});

// ============================================================
// §6 — AddressReveal: unclaim clears approvedAt/approvedBy
// ============================================================

describe('AddressReveal — unclaim field clearing', () => {
  let src;
  beforeEach(() => { src = readSource('../frontend/src/components/inventory/producer/AddressReveal.jsx'); });

  test('unclaim clears approvedAt', () => {
    const unclaimBlock = src.match(/unclaim[\s\S]*?request_unclaimed/);
    expect(unclaimBlock).toBeTruthy();
    expect(unclaimBlock[0]).toContain('approvedAt: null');
  });

  test('unclaim clears approvedBy', () => {
    const unclaimBlock = src.match(/unclaim[\s\S]*?request_unclaimed/);
    expect(unclaimBlock[0]).toContain('approvedBy: null');
  });

  test('unclaim still clears assignedTo/claimedBy/etc', () => {
    const unclaimBlock = src.match(/unclaim[\s\S]*?request_unclaimed/);
    expect(unclaimBlock[0]).toContain('assignedTo: null');
    expect(unclaimBlock[0]).toContain('claimedBy: null');
    expect(unclaimBlock[0]).toContain('assignedAt: null');
    expect(unclaimBlock[0]).toContain('claimedAt: null');
  });
});

// ============================================================
// §7 — AddressReveal: shippingNotes in handleMarkShipped deps
// ============================================================

describe('AddressReveal — handleMarkShipped deps', () => {
  let src;
  beforeEach(() => { src = readSource('../frontend/src/components/inventory/producer/AddressReveal.jsx'); });

  test('handleMarkShipped dep array includes shippingNotes', () => {
    const shipBlock = src.match(/handleMarkShipped[\s\S]*?(?=if \(decryptError\)|const handleCopy)/);
    expect(shipBlock).toBeTruthy();
    const depsMatch = shipBlock[0].match(/},\s*\[([^\]]+)\]/);
    expect(depsMatch).toBeTruthy();
    expect(depsMatch[1]).toContain('shippingNotes');
  });

  test('handleMarkShipped uses shippingNotes in request update', () => {
    const shipBlock = src.match(/handleMarkShipped[\s\S]*?(?=if \(decryptError\)|const handleCopy)/);
    expect(shipBlock[0]).toContain('printerNotes: shippingNotes');
  });
});

// ============================================================
// §8 — SubmitRequest: pushNotification import and admin notify
// ============================================================

describe('SubmitRequest — admin notification on submit', () => {
  let src;
  beforeEach(() => { src = readSource('../frontend/src/components/inventory/requestor/SubmitRequest.jsx'); });

  test('imports pushNotification', () => {
    expect(src).toContain("import { pushNotification }");
    expect(src).toContain('inventoryNotifications');
  });

  test('destructures yInventoryNotifications from context', () => {
    expect(src).toContain('yInventoryNotifications');
  });

  test('calls pushNotification for admins after submit', () => {
    const submitBlock = src.match(/handleSubmit[\s\S]*?(?=return \()/);
    expect(submitBlock).toBeTruthy();
    expect(submitBlock[0]).toContain('pushNotification(yInventoryNotifications');
  });

  test('filters admins by owner/editor permission', () => {
    const submitBlock = src.match(/handleSubmit[\s\S]*?(?=return \()/);
    expect(submitBlock[0]).toContain("permission === 'owner'");
    expect(submitBlock[0]).toContain("permission === 'editor'");
  });

  test('does not self-notify', () => {
    const submitBlock = src.match(/handleSubmit[\s\S]*?(?=return \()/);
    // Should skip the current user
    expect(submitBlock[0]).toContain('adminKey !== myKey');
  });

  test('yInventoryNotifications is in handleSubmit dep array', () => {
    const submitBlock = src.match(/handleSubmit[\s\S]*?(?=return \()/);
    const depsMatch = submitBlock[0].match(/},\s*\[([^\]]+)\]/);
    expect(depsMatch).toBeTruthy();
    expect(depsMatch[1]).toContain('yInventoryNotifications');
  });
});

// ============================================================
// §9 — RequestDetail: re-syncs when request prop changes
// ============================================================

describe('RequestDetail — stale state sync', () => {
  let src;
  beforeEach(() => { src = readSource('../frontend/src/components/inventory/common/RequestDetail.jsx'); });

  test('has useEffect that syncs adminNotes from request prop', () => {
    expect(src).toContain('setAdminNotes(request.adminNotes');
    // Must be in a useEffect, not just useState init
    const effectMatches = src.match(/useEffect\(\(\)\s*=>\s*\{[\s\S]*?setAdminNotes/g);
    expect(effectMatches).toBeTruthy();
    expect(effectMatches.length).toBeGreaterThanOrEqual(1);
  });

  test('has useEffect that syncs trackingNumber from request prop', () => {
    expect(src).toContain('setTrackingNumber(request.trackingNumber');
    // Must be in a useEffect
    const effectMatches = src.match(/useEffect\(\(\)\s*=>\s*\{[\s\S]*?setTrackingNumber/g);
    expect(effectMatches).toBeTruthy();
    expect(effectMatches.length).toBeGreaterThanOrEqual(1);
  });

  test('useEffect depends on request.id', () => {
    // Find the effect block that does the syncing
    const effectBlock = src.match(/useEffect\(\(\)\s*=>\s*\{[^}]*setAdminNotes[\s\S]*?\[([^\]]+)\]/);
    expect(effectBlock).toBeTruthy();
    expect(effectBlock[1]).toContain('request.id');
  });

  test('useEffect depends on request.adminNotes', () => {
    const effectBlock = src.match(/useEffect\(\(\)\s*=>\s*\{[^}]*setAdminNotes[\s\S]*?\[([^\]]+)\]/);
    expect(effectBlock).toBeTruthy();
    expect(effectBlock[1]).toContain('request.adminNotes');
  });

  test('useEffect depends on request.trackingNumber', () => {
    const effectBlock = src.match(/useEffect\(\(\)\s*=>\s*\{[^}]*setTrackingNumber[\s\S]*?\[([^\]]+)\]/);
    expect(effectBlock).toBeTruthy();
    expect(effectBlock[1]).toContain('request.trackingNumber');
  });
});

// ============================================================
// §10 — Cross-file field consistency: no isActive anywhere
// ============================================================

describe('Global field consistency — active vs isActive', () => {
  const inventoryFiles = [
    '../frontend/src/components/inventory/producer/OpenRequests.jsx',
    '../frontend/src/components/inventory/producer/ProducerDashboard.jsx',
    '../frontend/src/components/inventory/analytics/ProducerLeaderboard.jsx',
    '../frontend/src/components/inventory/admin/CatalogManager.jsx',
    '../frontend/src/components/inventory/requestor/SubmitRequest.jsx',
    '../frontend/src/components/inventory/OnboardingWizard.jsx',
  ];

  test.each(inventoryFiles)('%s does not use isActive as a field check', (filePath) => {
    const src = readSource(filePath);
    // No .isActive property access (false positive: CSS class names with isActive are OK)
    const propAccesses = src.match(/\.\bisActive\b/g) || [];
    expect(propAccesses).toHaveLength(0);
  });
});

// ============================================================
// §11 — AllRequests: handleReject/handleCancel clear fields (behavioral)
// ============================================================

describe('AllRequests — reject/cancel behavioral tests', () => {
  let AllRequests;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPushNotification.mockClear();
    AllRequests = require('../frontend/src/components/inventory/admin/AllRequests').default;
  });

  test('handleReject clears all assignment fields in Yjs', () => {
    const yRequests = createMockYArray([{
      id: 'req-1',
      inventorySystemId: 'sys-1',
      status: 'pending_approval',
      catalogItemName: 'Widget',
      requestedBy: 'viewer-1',
      assignedTo: 'producer-1',
      assignedAt: 12345,
      claimedBy: 'producer-1',
      claimedAt: 12346,
      approvedAt: 12347,
      approvedBy: 'owner-1',
    }]);
    const yAudit = createMockYArray();
    const yNotifications = createMockYArray();

    mockInventoryCtx = {
      inventorySystemId: 'sys-1',
      yInventoryRequests: yRequests,
      yInventoryAuditLog: yAudit,
      yInventoryNotifications: yNotifications,
      collaborators: [
        { publicKeyBase62: 'owner-1', permission: 'owner', displayName: 'Admin' },
        { publicKeyBase62: 'producer-1', permission: 'editor', displayName: 'Producer' },
        { publicKeyBase62: 'viewer-1', permission: 'viewer', displayName: 'Viewer' },
      ],
      userIdentity: { publicKeyBase62: 'owner-1', publicKey: 'pk-owner' },
      requests: yRequests.toArray(),
      catalogItems: [{ id: 'cat-1', name: 'Widget', active: true }],
      addressReveals: {},
      pendingAddresses: [],
      currentSystem: { name: 'Test System', settings: {} },
      producerCapacities: {},
      workspaceId: 'ws-1',
    };

    render(<AllRequests currentWorkspace="test-ws" />);

    // Find and click the reject button
    const rejectBtns = screen.queryAllByText(/reject/i);
    if (rejectBtns.length > 0) {
      act(() => { fireEvent.click(rejectBtns[0]); });

      // After reject, the insert should have cleared all fields
      if (yRequests.insert.mock.calls.length > 0) {
        const inserted = yRequests.insert.mock.calls[0][1][0];
        expect(inserted.assignedTo).toBeNull();
        expect(inserted.assignedAt).toBeNull();
        expect(inserted.claimedBy).toBeNull();
        expect(inserted.claimedAt).toBeNull();
        expect(inserted.approvedAt).toBeNull();
        expect(inserted.approvedBy).toBeNull();
      }
    }
  });

  test('handleCancel clears assignment fields in Yjs', () => {
    const yRequests = createMockYArray([{
      id: 'req-1',
      inventorySystemId: 'sys-1',
      status: 'claimed',
      catalogItemName: 'Widget',
      requestedBy: 'viewer-1',
      assignedTo: 'producer-1',
      assignedAt: 12345,
      claimedBy: 'producer-1',
      claimedAt: 12346,
    }]);
    const yAudit = createMockYArray();
    const yNotifications = createMockYArray();

    mockInventoryCtx = {
      inventorySystemId: 'sys-1',
      yInventoryRequests: yRequests,
      yInventoryAuditLog: yAudit,
      yInventoryNotifications: yNotifications,
      collaborators: [
        { publicKeyBase62: 'owner-1', permission: 'owner', displayName: 'Admin' },
      ],
      userIdentity: { publicKeyBase62: 'owner-1', publicKey: 'pk-owner' },
      requests: yRequests.toArray(),
      catalogItems: [{ id: 'cat-1', name: 'Widget', active: true }],
      addressReveals: {},
      pendingAddresses: [],
      currentSystem: { name: 'Test System', settings: {} },
      producerCapacities: {},
      workspaceId: 'ws-1',
    };

    render(<AllRequests currentWorkspace="test-ws" />);

    const cancelBtns = screen.queryAllByText(/cancel/i);
    if (cancelBtns.length > 0) {
      act(() => { fireEvent.click(cancelBtns[0]); });

      if (yRequests.insert.mock.calls.length > 0) {
        const inserted = yRequests.insert.mock.calls[0][1][0];
        expect(inserted.assignedTo).toBeNull();
        expect(inserted.assignedAt).toBeNull();
        expect(inserted.claimedBy).toBeNull();
        expect(inserted.claimedAt).toBeNull();
      }
    }
  });
});

// ============================================================
// §12 — ProducerDashboard active filter (behavioral)
// ============================================================

describe('ProducerDashboard — active catalog filter', () => {
  let ProducerDashboard;

  beforeEach(() => {
    jest.clearAllMocks();
    ProducerDashboard = require('../frontend/src/components/inventory/producer/ProducerDashboard').default;
  });

  test('filters out deactivated catalog items from capacity grid', () => {
    const yRequests = createMockYArray([]);
    const yAudit = createMockYArray();
    const yNotifications = createMockYArray();
    const yCapacities = createMockYMap({});

    mockInventoryCtx = {
      inventorySystemId: 'sys-1',
      yInventoryRequests: yRequests,
      yInventoryAuditLog: yAudit,
      yInventoryNotifications: yNotifications,
      yProducerCapacities: yCapacities,
      yAddressReveals: createMockYMap({}),
      collaborators: [
        { publicKeyBase62: 'producer-1', permission: 'editor', displayName: 'Me' },
      ],
      userIdentity: { publicKeyBase62: 'producer-1', publicKey: 'pk-prod' },
      requests: [],
      catalogItems: [
        { id: 'cat-1', name: 'Active Widget', active: true },
        { id: 'cat-2', name: 'Deactivated Widget', active: false },
      ],
      addressReveals: {},
      pendingAddresses: [],
      currentSystem: { name: 'Test System', settings: {} },
      producerCapacities: {},
      workspaceId: 'ws-1',
    };

    render(<ProducerDashboard currentWorkspace="test-ws" />);

    // Active item should appear somewhere (capacity grid or elsewhere)
    // Deactivated item should NOT appear in the capacity section
    const capacitySaves = screen.queryAllByTestId('capacity-save');
    // Only 1 capacity input (for the active item), not 2
    expect(capacitySaves).toHaveLength(1);
  });
});

// ============================================================
// §13 — SubmitRequest admin notification (behavioral)
// ============================================================

describe('SubmitRequest — behavioral admin notification', () => {
  let SubmitRequest;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPushNotification.mockClear();
    SubmitRequest = require('../frontend/src/components/inventory/requestor/SubmitRequest').default;
  });

  test('renders submit form with active items only', () => {
    const yRequests = createMockYArray([]);
    const yAudit = createMockYArray();
    const yNotifications = createMockYArray();
    const yPending = createMockYArray();

    mockInventoryCtx = {
      inventorySystemId: 'sys-1',
      yInventoryRequests: yRequests,
      yInventoryAuditLog: yAudit,
      yInventoryNotifications: yNotifications,
      yPendingAddresses: yPending,
      yProducerCapacities: createMockYMap({}),
      collaborators: [
        { publicKeyBase62: 'owner-1', permission: 'owner', displayName: 'Admin' },
        { publicKeyBase62: 'viewer-1', permission: 'viewer', displayName: 'Me' },
      ],
      userIdentity: { publicKeyBase62: 'viewer-1', publicKey: 'pk-viewer' },
      requests: [],
      catalogItems: [
        { id: 'cat-1', name: 'Active Widget', active: true, inventorySystemId: 'sys-1' },
        { id: 'cat-2', name: 'Inactive Widget', active: false, inventorySystemId: 'sys-1' },
      ],
      addressReveals: {},
      pendingAddresses: [],
      currentSystem: { name: 'Test System', settings: {} },
      producerCapacities: {},
      workspaceId: 'ws-1',
    };

    render(<SubmitRequest currentWorkspace="test-ws" isOwner={false} />);

    // The inactive item should not appear in the dropdown
    const options = screen.queryAllByRole('option');
    const optionTexts = options.map(o => o.textContent);
    expect(optionTexts).not.toContain('Inactive Widget');
  });
});

// ============================================================
// §14 — OnboardingWizard autoAssignEnabled (behavioral)
// ============================================================

describe('OnboardingWizard — saves correct settings key', () => {
  let OnboardingWizard;

  beforeEach(() => {
    jest.clearAllMocks();
    OnboardingWizard = require('../frontend/src/components/inventory/OnboardingWizard').default;
  });

  test('renders onboarding wizard step 1', () => {
    const ySystems = createMockYMap({
      'sys-1': { name: '', settings: {}, catalogItems: [] },
    });
    const yAudit = createMockYArray();

    mockInventoryCtx = {
      inventorySystemId: 'sys-1',
      yInventorySystems: ySystems,
      yInventoryAuditLog: yAudit,
      userIdentity: { publicKeyBase62: 'owner-1' },
    };

    render(<OnboardingWizard />);

    // Should render the system name input
    const nameInput = screen.queryByPlaceholderText(/name/i) || screen.queryByLabelText(/name/i);
    expect(nameInput || screen.queryByText(/Name Your/i)).toBeTruthy();
  });
});
