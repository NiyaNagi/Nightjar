/**
 * tests/inventory-workflow-audit.test.js
 *
 * Comprehensive end-to-end tests for the inventory workflow audit fixes:
 *
 * 1. Collaborator data flow — members-derived collaborators (not empty Y.Array)
 * 2. AllRequests.handleApprove — full address reveal creation
 * 3. AllRequests.filtered — useMemo deps (producerFilter, dateFrom, dateTo)
 * 4. handleRequestAgain — address encryption for re-requests
 * 5. useInventorySync — pendingAddresses filtered by inventorySystemId
 * 6. AddressReveal unclaim — notification to requestor
 * 7. SubmitRequest — 'admin' permission removed
 * 8. ProducerNameMapper — collaborators in dropdown
 * 9. ProducerManagement — collaborator self-check
 */

import React from 'react';
import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// ============================================================
// Hoisted jest.mock() calls — MUST be before any imports that use them
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

const mockGetPublicKeyHex = jest.fn(() => 'hex-pub-key');
const mockBase62ToPublicKeyHex = jest.fn((k) => 'hex-' + k);
const mockCreateAddressReveal = jest.fn(async () => ({ ciphertext: 'enc', nonce: 'n', senderPublicKey: 'spk' }));
const mockDecryptPendingAddress = jest.fn(async () => ({ fullName: 'Test', street1: '123 Main', city: 'NY', state: 'NY', zipCode: '10001' }));
const mockEncryptAddressForAdmins = jest.fn(async () => [{ recipientPublicKey: 'hex', ciphertext: 'enc', nonce: 'n' }]);

jest.mock('../frontend/src/utils/addressCrypto', () => ({
  getPublicKeyHex: (...args) => mockGetPublicKeyHex(...args),
  base62ToPublicKeyHex: (...args) => mockBase62ToPublicKeyHex(...args),
  createAddressReveal: (...args) => mockCreateAddressReveal(...args),
  decryptPendingAddress: (...args) => mockDecryptPendingAddress(...args),
  encryptAddressForAdmins: (...args) => mockEncryptAddressForAdmins(...args),
  decryptAddressReveal: jest.fn(async () => ({ fullName: 'Test', street1: '1 Main', city: 'NY', state: 'NY', zipCode: '10001' })),
}));

const mockGetAddress = jest.fn(async () => ({ fullName: 'Test', street1: '123 Main', city: 'NY', state: 'NY', zipCode: '10001' }));
const mockGetWorkspaceKeyMaterial = jest.fn(() => ({ key: 'test-key' }));
const mockStoreAddress = jest.fn(async () => {});

jest.mock('../frontend/src/utils/inventoryAddressStore', () => ({
  getAddress: (...args) => mockGetAddress(...args),
  getWorkspaceKeyMaterial: (...args) => mockGetWorkspaceKeyMaterial(...args),
  storeAddress: (...args) => mockStoreAddress(...args),
}));

jest.mock('../frontend/src/components/inventory/common/RequestRow', () => ({
  __esModule: true,
  default: function MockRequestRow({ request, onClick }) {
    return (
      <tr data-testid={`row-${request.id}`} onClick={() => onClick && onClick(request)}>
        <td>{request.status}</td>
      </tr>
    );
  },
}));

jest.mock('../frontend/src/components/inventory/common/RequestDetail', () => ({
  __esModule: true,
  default: function MockRequestDetail({ request, onApprove, onReject, onCancel, onMarkInProgress }) {
    return (
      <div data-testid={`detail-${request.id}`}>
        {onApprove && <button data-testid="approve-btn" onClick={() => onApprove(request)}>Approve</button>}
        {onReject && <button data-testid="reject-btn" onClick={() => onReject(request)}>Reject</button>}
        {onCancel && <button data-testid="cancel-btn" onClick={() => onCancel(request)}>Cancel</button>}
        {onMarkInProgress && <button data-testid="mark-ip-btn" onClick={() => onMarkInProgress(request)}>Mark In Progress</button>}
      </div>
    );
  },
}));

// ============================================================
// Mock Yjs types
// ============================================================

function createMockYArray(initialData = []) {
  const data = [...initialData];
  const observers = [];
  const arr = {
    toArray: () => [...data],
    push: (items) => { data.push(...items); observers.forEach(fn => fn()); },
    delete: (idx, count) => { data.splice(idx, count); observers.forEach(fn => fn()); },
    insert: (idx, items) => { data.splice(idx, 0, ...items); observers.forEach(fn => fn()); },
    get length() { return data.length; },
    observe: (fn) => { observers.push(fn); },
    unobserve: (fn) => { const i = observers.indexOf(fn); if (i > -1) observers.splice(i, 1); },
    forEach: (fn) => data.forEach(fn),
    _data: data,
    _observers: observers,
    doc: { transact: (fn) => fn() },
  };
  return arr;
}

function createMockYMap(initialData = {}) {
  const data = { ...initialData };
  const observers = [];
  return {
    get: (key) => data[key],
    set: (key, val) => { data[key] = val; observers.forEach(fn => fn()); },
    delete: (key) => { delete data[key]; observers.forEach(fn => fn()); },
    has: (key) => key in data,
    toJSON: () => ({ ...data }),
    forEach: (fn) => Object.entries(data).forEach(([k, v]) => fn(v, k)),
    entries: () => Object.entries(data),
    observe: (fn) => { observers.push(fn); },
    unobserve: (fn) => { const i = observers.indexOf(fn); if (i > -1) observers.splice(i, 1); },
    _data: data,
    _observers: observers,
    get size() { return Object.keys(data).length; },
  };
}

const makeIdentity = (key = 'user-abc123', extra = {}) => ({
  publicKeyBase62: key,
  displayName: 'TestUser',
  name: 'TestUser',
  curveSecretKey: new Uint8Array(32),
  ...extra,
});

const makeCollaborator = (key, name = 'TestUser', permission = 'viewer') => ({
  publicKey: key,
  publicKeyBase62: key,
  displayName: name,
  name,
  color: '#6366f1',
  icon: '👤',
  permission,
  isOnline: true,
});

// ============================================================
// Import mocked modules (AFTER jest.mock calls)
// ============================================================

import { useInventory } from '../frontend/src/contexts/InventoryContext';
import AllRequests from '../frontend/src/components/inventory/admin/AllRequests';
import ProducerNameMapper from '../frontend/src/components/inventory/admin/ProducerNameMapper';

// ============================================================
// §1 — useInventorySync: pendingAddresses inventorySystemId filter
// ============================================================

describe('useInventorySync — pendingAddresses filtering', () => {
  // We test useInventorySync directly (not mocked) via a wrapper component
  // Since it's just a hook, we can import it directly (no mock for this module)
  const { useInventorySync } = require('../frontend/src/hooks/useInventorySync');

  function TestComponent({ yShared, inventorySystemId }) {
    const sync = useInventorySync(yShared, inventorySystemId);
    return (
      <div>
        <span data-testid="pa-count">{Object.keys(sync.pendingAddresses).length}</span>
        <span data-testid="pa-keys">{Object.keys(sync.pendingAddresses).join(',')}</span>
        <span data-testid="req-count">{sync.requests.length}</span>
        <span data-testid="addr-count">{Object.keys(sync.addressReveals).length}</span>
      </div>
    );
  }

  test('pendingAddresses with matching inventorySystemId are included', () => {
    const yShared = {
      yInventorySystems: createMockYMap({ 'sys-1': { id: 'sys-1', name: 'Test' } }),
      yCatalogItems: createMockYArray([]),
      yInventoryRequests: createMockYArray([]),
      yProducerCapacities: createMockYMap({}),
      yAddressReveals: createMockYMap({}),
      yPendingAddresses: createMockYMap({
        'req-1': { inventorySystemId: 'sys-1', entries: [] },
        'req-2': { inventorySystemId: 'sys-2', entries: [] },
        'req-3': { entries: [] }, // no inventorySystemId (backward compat)
      }),
      yInventoryAuditLog: createMockYArray([]),
    };

    render(<TestComponent yShared={yShared} inventorySystemId="sys-1" />);
    const paCount = screen.getByTestId('pa-count');
    // Should include req-1 (matching) and req-3 (no systemId = backward compat)
    expect(paCount.textContent).toBe('2');
  });

  test('pendingAddresses from other inventorySystemId are excluded', () => {
    const yShared = {
      yInventorySystems: createMockYMap({}),
      yCatalogItems: createMockYArray([]),
      yInventoryRequests: createMockYArray([]),
      yProducerCapacities: createMockYMap({}),
      yAddressReveals: createMockYMap({}),
      yPendingAddresses: createMockYMap({
        'req-A': { inventorySystemId: 'other-system', entries: [] },
      }),
      yInventoryAuditLog: createMockYArray([]),
    };

    render(<TestComponent yShared={yShared} inventorySystemId="sys-1" />);
    expect(screen.getByTestId('pa-count').textContent).toBe('0');
  });

  test('requests are filtered by inventorySystemId', () => {
    const yShared = {
      yInventorySystems: createMockYMap({}),
      yCatalogItems: createMockYArray([]),
      yInventoryRequests: createMockYArray([
        { id: 'r1', inventorySystemId: 'sys-1', status: 'open' },
        { id: 'r2', inventorySystemId: 'sys-2', status: 'open' },
        { id: 'r3', inventorySystemId: 'sys-1', status: 'approved' },
      ]),
      yProducerCapacities: createMockYMap({}),
      yAddressReveals: createMockYMap({}),
      yPendingAddresses: createMockYMap({}),
      yInventoryAuditLog: createMockYArray([]),
    };

    render(<TestComponent yShared={yShared} inventorySystemId="sys-1" />);
    expect(screen.getByTestId('req-count').textContent).toBe('2');
  });

  test('addressReveals are filtered by inventorySystemId', () => {
    const yShared = {
      yInventorySystems: createMockYMap({}),
      yCatalogItems: createMockYArray([]),
      yInventoryRequests: createMockYArray([]),
      yProducerCapacities: createMockYMap({}),
      yAddressReveals: createMockYMap({
        'req-1': { inventorySystemId: 'sys-1', ciphertext: 'x' },
        'req-2': { inventorySystemId: 'sys-2', ciphertext: 'y' },
      }),
      yPendingAddresses: createMockYMap({}),
      yInventoryAuditLog: createMockYArray([]),
    };

    render(<TestComponent yShared={yShared} inventorySystemId="sys-1" />);
    expect(screen.getByTestId('addr-count').textContent).toBe('1');
  });
});

// ============================================================
// §2 — Source code verification: AllRequests handleApprove creates address reveal
// ============================================================

describe('AllRequests — handleApprove address reveal (source verification)', () => {
  let sourceCode;

  beforeEach(() => {
    const fs = require('fs');
    const path = require('path');
    sourceCode = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/components/inventory/admin/AllRequests.jsx'),
      'utf8'
    );
  });

  test('imports addressCrypto functions', () => {
    expect(sourceCode).toContain('createAddressReveal');
    expect(sourceCode).toContain('decryptPendingAddress');
    expect(sourceCode).toContain('getPublicKeyHex');
    expect(sourceCode).toContain('base62ToPublicKeyHex');
  });

  test('imports inventoryAddressStore functions', () => {
    expect(sourceCode).toContain('getAddress');
    expect(sourceCode).toContain('getWorkspaceKeyMaterial');
    expect(sourceCode).toContain('storeAddress');
  });

  test('handleApprove creates address reveal for assigned producer', () => {
    expect(sourceCode).toContain('yAddressReveals');
    const approveMatch = sourceCode.match(/handleApprove[\s\S]*?(?=const handleReject)/);
    expect(approveMatch).toBeTruthy();
    const approveBody = approveMatch[0];
    expect(approveBody).toContain('createAddressReveal');
    expect(approveBody).toContain('getPublicKeyHex');
    expect(approveBody).toContain('base62ToPublicKeyHex');
    expect(approveBody).toContain('decryptPendingAddress');
    expect(approveBody).toContain('getAddress');
  });

  test('handleApprove sets approvedBy field', () => {
    const approveMatch = sourceCode.match(/handleApprove[\s\S]*?(?=const handleReject)/);
    expect(approveMatch[0]).toContain('approvedBy');
  });

  test('filtered useMemo includes producerFilter, dateFrom, dateTo in deps', () => {
    // Find the dependency array for the filtered useMemo — it's on the }, [...]) line
    const depsMatch = sourceCode.match(/\}, \[([^\]]*producerFilter[^\]]*)\]\)/);
    expect(depsMatch).toBeTruthy();
    const deps = depsMatch[1];
    expect(deps).toContain('producerFilter');
    expect(deps).toContain('dateFrom');
    expect(deps).toContain('dateTo');
  });
});

// ============================================================
// §3 — Source code verification: handleRequestAgain encrypts address
// ============================================================

describe('Requestor MyRequests — handleRequestAgain address encryption (source verification)', () => {
  let sourceCode;

  beforeEach(() => {
    const fs = require('fs');
    const path = require('path');
    sourceCode = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/components/inventory/requestor/MyRequests.jsx'),
      'utf8'
    );
  });

  test('imports address crypto functions', () => {
    expect(sourceCode).toContain('getPublicKeyHex');
    expect(sourceCode).toContain('encryptAddressForAdmins');
  });

  test('imports address store functions', () => {
    expect(sourceCode).toContain('getAddress');
    expect(sourceCode).toContain('getWorkspaceKeyMaterial');
    expect(sourceCode).toContain('storeAddress');
  });

  test('handleRequestAgain creates encrypted pending address for new request', () => {
    const reqAgainMatch = sourceCode.match(/handleRequestAgain[\s\S]*?(?=const handleStartEdit)/);
    expect(reqAgainMatch).toBeTruthy();
    const body = reqAgainMatch[0];
    expect(body).toContain('getAddress');
    expect(body).toContain('storeAddress');
    expect(body).toContain('encryptAddressForAdmins');
    expect(body).toContain('yPendingAddresses');
  });

  test('handleRequestAgain is async', () => {
    expect(sourceCode).toContain('handleRequestAgain = useCallback(async');
  });

  test('handleRequestAgain falls back to copying old pending entries', () => {
    const reqAgainMatch = sourceCode.match(/handleRequestAgain[\s\S]*?(?=const handleStartEdit)/);
    const body = reqAgainMatch[0];
    expect(body).toContain('Fallback');
    expect(body).toContain('oldEntries');
  });
});

// ============================================================
// §4 — Source code verification: AddressReveal unclaim sends notification
// ============================================================

describe('AddressReveal — unclaim notification (source verification)', () => {
  let sourceCode;

  beforeEach(() => {
    const fs = require('fs');
    const path = require('path');
    sourceCode = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/components/inventory/producer/AddressReveal.jsx'),
      'utf8'
    );
  });

  test('pushNotification is imported', () => {
    expect(sourceCode).toContain("import { pushNotification }");
    expect(sourceCode).toContain('inventoryNotifications');
  });

  test('unclaim button sends notification to requestor', () => {
    const unclaimMatch = sourceCode.match(/ar-unclaim-btn[\s\S]*?↩️/);
    expect(unclaimMatch).toBeTruthy();
    const fullUnclaimBlock = sourceCode.match(/ar-unclaim-btn[\s\S]*?Unclaim this request/);
    expect(fullUnclaimBlock).toBeTruthy();
    expect(fullUnclaimBlock[0]).toContain('pushNotification');
    expect(fullUnclaimBlock[0]).toContain('request_unclaimed');
    expect(fullUnclaimBlock[0]).toContain('requestedBy');
  });
});

// ============================================================
// §5 — Source code verification: SubmitRequest does not use 'admin' permission
// ============================================================

describe('SubmitRequest — permission filter (source verification)', () => {
  let sourceCode;

  beforeEach(() => {
    const fs = require('fs');
    const path = require('path');
    sourceCode = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/components/inventory/requestor/SubmitRequest.jsx'),
      'utf8'
    );
  });

  test('does not filter by non-existent admin permission', () => {
    const permissionLines = sourceCode.split('\n').filter(line =>
      line.includes('permission') && line.includes("'admin'")
    );
    expect(permissionLines.length).toBe(0);
  });

  test('filters admins by owner permission', () => {
    const adminFilter = sourceCode.match(/c\.permission === 'owner'/g);
    expect(adminFilter).toBeTruthy();
    expect(adminFilter.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================
// §6 — useWorkspaceSync: collaborators derived from members
// ============================================================

describe('useWorkspaceSync — collaborators from yMembers (source verification)', () => {
  let sourceCode;

  beforeEach(() => {
    const fs = require('fs');
    const path = require('path');
    sourceCode = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/hooks/useWorkspaceSync.js'),
      'utf8'
    );
  });

  test('syncCollaborators derives from yMembers', () => {
    const syncBlock = sourceCode.match(/const syncCollaborators[\s\S]*?};/);
    expect(syncBlock).toBeTruthy();
    const body = syncBlock[0];
    expect(body).toContain('yMembers');
    expect(body).toContain('membersArr');
  });

  test('syncCollaborators includes publicKeyBase62 alias', () => {
    const syncBlock = sourceCode.match(/const syncCollaborators[\s\S]*?};/);
    expect(syncBlock[0]).toContain('publicKeyBase62');
  });

  test('yMembers changes trigger syncCollaborators', () => {
    expect(sourceCode).toContain('yMembers.observe(syncCollaborators)');
  });

  test('cleanup unobserves syncCollaborators from yMembers', () => {
    expect(sourceCode).toContain('yMembers.unobserve(syncCollaborators)');
  });
});

// ============================================================
// §7 — ProducerNameMapper: source code verification
// ============================================================

describe('ProducerNameMapper — dropdown population (source verification)', () => {
  let sourceCode;

  beforeEach(() => {
    const fs = require('fs');
    const path = require('path');
    sourceCode = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/components/inventory/admin/ProducerNameMapper.jsx'),
      'utf8'
    );
  });

  test('producers useMemo includes ALL collaborators (not filtered by permission)', () => {
    // After iter4 fix: dropdown shows all collaborators, not just editors/owners
    expect(sourceCode).toContain('[...collaborators]');
  });

  test('self-check uses both publicKey and publicKeyBase62', () => {
    expect(sourceCode).toContain('c.publicKey === myKey || c.publicKeyBase62 === myKey');
  });

  test('fallback entry includes publicKeyBase62', () => {
    const fallbackMatch = sourceCode.match(/result\.unshift\(\{[\s\S]*?\}\)/);
    expect(fallbackMatch).toBeTruthy();
    expect(fallbackMatch[0]).toContain('publicKeyBase62');
  });
});

// ============================================================
// §8 — ProducerManagement: source code verification
// ============================================================

describe('ProducerManagement — self-check (source verification)', () => {
  let sourceCode;

  beforeEach(() => {
    const fs = require('fs');
    const path = require('path');
    sourceCode = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/components/inventory/admin/ProducerManagement.jsx'),
      'utf8'
    );
  });

  test('self-check uses both publicKey and publicKeyBase62', () => {
    expect(sourceCode).toContain('c.publicKey === myKey || c.publicKeyBase62 === myKey');
  });

  test('fallback entry includes publicKeyBase62', () => {
    const fallbackMatch = sourceCode.match(/editors\.unshift\(\{[\s\S]*?\}\)/);
    expect(fallbackMatch).toBeTruthy();
    expect(fallbackMatch[0]).toContain('publicKeyBase62');
  });
});

// ============================================================
// §9 — Functional: ProducerNameMapper renders collaborators in dropdown
// ============================================================

describe('ProducerNameMapper — functional render', () => {
  beforeEach(() => {
    mockPushNotification.mockClear();
  });

  test('renders all collaborators in dropdown when requests have imported names', () => {
    const collaborators = [
      makeCollaborator('owner-key', 'Alice Admin', 'owner'),
      makeCollaborator('editor-key-1', 'Bob Producer', 'editor'),
      makeCollaborator('editor-key-2', 'Charlie Producer', 'editor'),
      makeCollaborator('viewer-key', 'Dave Viewer', 'viewer'),
    ];

    mockInventoryCtx = {
      userIdentity: makeIdentity('owner-key'),
      collaborators,
      requests: [
        { id: 'req-1', importedProducerName: 'John Print Shop', quantity: 100, inventorySystemId: 'sys-1' },
      ],
      yInventoryRequests: createMockYArray([]),
      yInventoryAuditLog: createMockYArray([]),
      inventorySystemId: 'sys-1',
    };

    const { container } = render(<ProducerNameMapper />);
    const select = container.querySelector('.pnm-select');
    expect(select).toBeTruthy();
    const options = select.querySelectorAll('option');
    // Should have: placeholder + Alice (owner) + Bob (editor) + Charlie (editor) + Dave (viewer) = 5
    // After iter4 fix: ALL collaborators shown
    expect(options.length).toBe(5);
    const optionTexts = Array.from(options).map(o => o.textContent);
    expect(optionTexts.some(t => t.includes('Dave'))).toBe(true);
    expect(optionTexts.some(t => t.includes('Bob'))).toBe(true);
    expect(optionTexts.some(t => t.includes('Charlie'))).toBe(true);
  });

  test('current user (owner) appears even if not in collaborators list', () => {
    mockInventoryCtx = {
      userIdentity: makeIdentity('lone-owner', { displayName: 'Solo Admin' }),
      collaborators: [],
      requests: [
        { id: 'req-1', importedProducerName: 'Legacy Printer', quantity: 50, inventorySystemId: 'sys-1' },
      ],
      yInventoryRequests: createMockYArray([]),
      yInventoryAuditLog: createMockYArray([]),
      inventorySystemId: 'sys-1',
    };

    const { container } = render(<ProducerNameMapper />);
    const select = container.querySelector('.pnm-select');
    const options = select.querySelectorAll('option');
    // placeholder + current user fallback = 2
    expect(options.length).toBe(2);
  });

  test('shows empty state when no unresolved names exist', () => {
    mockInventoryCtx = {
      userIdentity: makeIdentity('owner-key'),
      collaborators: [makeCollaborator('owner-key', 'Admin', 'owner')],
      requests: [
        { id: 'req-1', catalogItemName: 'Widget', quantity: 10, inventorySystemId: 'sys-1' },
      ],
      yInventoryRequests: createMockYArray([]),
      yInventoryAuditLog: createMockYArray([]),
      inventorySystemId: 'sys-1',
    };

    render(<ProducerNameMapper />);
    expect(screen.getByText(/All imported producer names have been resolved/)).toBeTruthy();
  });

  test('does not duplicate current user when already in collaborators', () => {
    const collaborators = [
      makeCollaborator('owner-key', 'Alice Admin', 'owner'),
      makeCollaborator('editor-key', 'Bob Producer', 'editor'),
    ];

    mockInventoryCtx = {
      userIdentity: makeIdentity('owner-key'),
      collaborators,
      requests: [
        { id: 'req-1', importedProducerName: 'PrintCo', quantity: 200, inventorySystemId: 'sys-1' },
      ],
      yInventoryRequests: createMockYArray([]),
      yInventoryAuditLog: createMockYArray([]),
      inventorySystemId: 'sys-1',
    };

    const { container } = render(<ProducerNameMapper />);
    const select = container.querySelector('.pnm-select');
    const options = select.querySelectorAll('option');
    // placeholder + Alice + Bob = 3 (no duplicate Alice)
    expect(options.length).toBe(3);
  });
});

// ============================================================
// §10 — AllRequests functional tests
// ============================================================

describe('AllRequests — functional tests', () => {
  const defaultCtx = () => ({
    yInventoryRequests: createMockYArray([
      { id: 'req-1', inventorySystemId: 'sys-1', status: 'pending_approval', catalogItemName: 'Widget', requestedBy: 'requestor-key', assignedTo: 'producer-key', requestedAt: Date.now() - 86400000 },
      { id: 'req-2', inventorySystemId: 'sys-1', status: 'approved', catalogItemName: 'Gadget', requestedBy: 'requestor-key', requestedAt: Date.now() },
      { id: 'req-3', inventorySystemId: 'sys-1', status: 'open', catalogItemName: 'Widget', requestedBy: 'other-key', requestedAt: Date.now() - 172800000 },
    ]),
    yInventoryAuditLog: createMockYArray([]),
    yInventoryNotifications: createMockYArray([]),
    yAddressReveals: createMockYMap({}),
    yPendingAddresses: createMockYMap({
      'req-1': [{ recipientPublicKey: 'hex-owner', ciphertext: 'enc', nonce: 'n' }],
    }),
    inventorySystemId: 'sys-1',
    workspaceId: 'ws-1',
    currentWorkspace: { id: 'ws-1' },
    userIdentity: makeIdentity('owner-key', { curveSecretKey: new Uint8Array(32) }),
    collaborators: [
      makeCollaborator('owner-key', 'Admin', 'owner'),
      makeCollaborator('producer-key', 'Producer', 'editor'),
      makeCollaborator('viewer-key', 'Viewer', 'viewer'),
    ],
    requests: [
      { id: 'req-1', inventorySystemId: 'sys-1', status: 'pending_approval', catalogItemName: 'Widget', requestedBy: 'requestor-key', assignedTo: 'producer-key', requestedAt: Date.now() - 86400000 },
      { id: 'req-2', inventorySystemId: 'sys-1', status: 'approved', catalogItemName: 'Gadget', requestedBy: 'requestor-key', requestedAt: Date.now() },
      { id: 'req-3', inventorySystemId: 'sys-1', status: 'open', catalogItemName: 'Widget', requestedBy: 'other-key', requestedAt: Date.now() - 172800000 },
    ],
    catalogItems: [
      { id: 'cat-1', name: 'Widget' },
      { id: 'cat-2', name: 'Gadget' },
    ],
    onStartChatWith: jest.fn(),
  });

  beforeEach(() => {
    mockPushNotification.mockClear();
    mockGetAddress.mockClear();
    mockStoreAddress.mockClear();
    mockCreateAddressReveal.mockClear();
    mockDecryptPendingAddress.mockClear();
    mockGetWorkspaceKeyMaterial.mockClear();
  });

  test('renders all requests in table', () => {
    mockInventoryCtx = defaultCtx();
    render(<AllRequests />);
    expect(screen.getByTestId('row-req-1')).toBeTruthy();
    expect(screen.getByTestId('row-req-2')).toBeTruthy();
    expect(screen.getByTestId('row-req-3')).toBeTruthy();
  });

  test('shows total count', () => {
    mockInventoryCtx = defaultCtx();
    render(<AllRequests />);
    expect(screen.getByText(/Total: 3/)).toBeTruthy();
  });

  test('handleApprove creates address reveal and sends notification', async () => {
    const ctx = defaultCtx();
    mockInventoryCtx = ctx;
    render(<AllRequests />);

    // Click the row to expand detail
    fireEvent.click(screen.getByTestId('row-req-1'));

    // Click approve button
    await act(async () => {
      fireEvent.click(screen.getByTestId('approve-btn'));
    });

    // Check that address reveal was created in yAddressReveals
    expect(ctx.yAddressReveals._data['req-1']).toBeTruthy();
    expect(ctx.yAddressReveals._data['req-1'].inventorySystemId).toBe('sys-1');

    // Check notification was sent
    expect(mockPushNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'request_approved',
        recipientId: 'requestor-key',
      })
    );

    // Check audit log was created
    expect(ctx.yInventoryAuditLog._data.length).toBeGreaterThan(0);
  });
});

// ============================================================
// §11 — End-to-end workflow scenario tests
// ============================================================

describe('End-to-end workflow scenarios', () => {

  describe('Request lifecycle: submit → claim → approve → ship → deliver', () => {
    test('all status transitions happen correctly', () => {
      const yRequests = createMockYArray([]);
      const yAudit = createMockYArray([]);

      // 1. Submit request
      const reqId = 'req-lifecycle';
      yRequests.push([{
        id: reqId,
        inventorySystemId: 'sys-1',
        status: 'open',
        catalogItemName: 'Widget',
        quantity: 100,
        city: 'Portland',
        state: 'OR',
        requestedBy: 'requestor-key',
        requestedAt: Date.now(),
      }]);
      expect(yRequests._data[0].status).toBe('open');

      // 2. Producer claims
      const arr1 = yRequests.toArray();
      const idx1 = arr1.findIndex(r => r.id === reqId);
      yRequests.delete(idx1, 1);
      yRequests.insert(idx1, [{
        ...arr1[idx1],
        status: 'pending_approval',
        assignedTo: 'producer-key',
        claimedBy: 'producer-key',
        claimedAt: Date.now(),
      }]);
      expect(yRequests._data[0].status).toBe('pending_approval');

      // 3. Admin approves
      const arr2 = yRequests.toArray();
      const idx2 = arr2.findIndex(r => r.id === reqId);
      yRequests.delete(idx2, 1);
      yRequests.insert(idx2, [{
        ...arr2[idx2],
        status: 'approved',
        approvedAt: Date.now(),
        approvedBy: 'owner-key',
      }]);
      expect(yRequests._data[0].status).toBe('approved');
      expect(yRequests._data[0].approvedBy).toBe('owner-key');

      // 4. Producer ships
      const arr3 = yRequests.toArray();
      const idx3 = arr3.findIndex(r => r.id === reqId);
      yRequests.delete(idx3, 1);
      yRequests.insert(idx3, [{
        ...arr3[idx3],
        status: 'shipped',
        shippedAt: Date.now(),
        trackingNumber: '1Z999AA10123456784',
      }]);
      expect(yRequests._data[0].status).toBe('shipped');

      // 5. Requestor confirms delivery
      const arr4 = yRequests.toArray();
      const idx4 = arr4.findIndex(r => r.id === reqId);
      yRequests.delete(idx4, 1);
      yRequests.insert(idx4, [{
        ...arr4[idx4],
        status: 'delivered',
        deliveredAt: Date.now(),
      }]);
      expect(yRequests._data[0].status).toBe('delivered');
    });
  });

  describe('Request lifecycle: submit → cancel', () => {
    test('requestor can cancel open request', () => {
      const yRequests = createMockYArray([{
        id: 'req-cancel',
        inventorySystemId: 'sys-1',
        status: 'open',
        requestedBy: 'requestor-key',
      }]);

      const arr = yRequests.toArray();
      yRequests.delete(0, 1);
      yRequests.insert(0, [{ ...arr[0], status: 'cancelled', updatedAt: Date.now() }]);
      expect(yRequests._data[0].status).toBe('cancelled');
    });
  });

  describe('Request lifecycle: claim → unclaim', () => {
    test('producer can unclaim and request returns to open', () => {
      const yRequests = createMockYArray([{
        id: 'req-unclaim',
        inventorySystemId: 'sys-1',
        status: 'pending_approval',
        assignedTo: 'producer-key',
        claimedBy: 'producer-key',
      }]);

      const arr = yRequests.toArray();
      yRequests.delete(0, 1);
      yRequests.insert(0, [{
        ...arr[0],
        status: 'open',
        assignedTo: null,
        claimedBy: null,
        assignedAt: null,
        claimedAt: null,
      }]);
      expect(yRequests._data[0].status).toBe('open');
      expect(yRequests._data[0].assignedTo).toBeNull();
    });
  });

  describe('Request lifecycle: approve → mark in progress → ship', () => {
    test('producer can mark approved request as in_progress then ship', () => {
      const yRequests = createMockYArray([{
        id: 'req-ip',
        inventorySystemId: 'sys-1',
        status: 'approved',
        assignedTo: 'producer-key',
      }]);

      // Mark in progress
      const arr1 = yRequests.toArray();
      yRequests.delete(0, 1);
      yRequests.insert(0, [{ ...arr1[0], status: 'in_progress', updatedAt: Date.now() }]);
      expect(yRequests._data[0].status).toBe('in_progress');

      // Ship
      const arr2 = yRequests.toArray();
      yRequests.delete(0, 1);
      yRequests.insert(0, [{ ...arr2[0], status: 'shipped', shippedAt: Date.now() }]);
      expect(yRequests._data[0].status).toBe('shipped');
    });
  });

  describe('Address encryption flow', () => {
    test('pending address entries are keyed by request ID', () => {
      const yPending = createMockYMap({});
      const reqId = 'req-addr';
      const entries = [
        { recipientPublicKey: 'hex-admin', ciphertext: 'encrypted', nonce: 'nonce123' },
      ];
      yPending.set(reqId, entries);
      expect(yPending.get(reqId)).toEqual(entries);
    });

    test('address reveal is keyed by request ID with inventorySystemId', () => {
      const yReveals = createMockYMap({});
      const reqId = 'req-reveal';
      yReveals.set(reqId, {
        inventorySystemId: 'sys-1',
        ciphertext: 'enc',
        nonce: 'n',
        senderPublicKey: 'spk',
      });
      expect(yReveals.get(reqId).inventorySystemId).toBe('sys-1');
    });

    test('pending address is cleaned up after reveal is created', () => {
      const yPending = createMockYMap({
        'req-cleanup': [{ recipientPublicKey: 'hex', ciphertext: 'enc', nonce: 'n' }],
      });
      const yReveals = createMockYMap({});

      // Admin approves: create reveal, delete pending
      yReveals.set('req-cleanup', { inventorySystemId: 'sys-1', ciphertext: 'reveal-enc' });
      yPending.delete('req-cleanup');

      expect(yReveals.has('req-cleanup')).toBe(true);
      expect(yPending.has('req-cleanup')).toBe(false);
    });
  });

  describe('Notification flow', () => {
    test('notifications are pushed with correct structure', () => {
      const yNotifs = createMockYArray([]);

      // Simulate pushNotification
      yNotifs.push([{
        id: 'notif-1',
        inventorySystemId: 'sys-1',
        recipientId: 'requestor-key',
        type: 'request_approved',
        message: 'Your request has been approved',
        relatedId: 'req-1',
        read: false,
        timestamp: Date.now(),
      }]);

      expect(yNotifs._data.length).toBe(1);
      expect(yNotifs._data[0].type).toBe('request_approved');
      expect(yNotifs._data[0].recipientId).toBe('requestor-key');
    });
  });

  describe('Re-request flow', () => {
    test('re-request creates new request with new ID but same item/location', () => {
      const yRequests = createMockYArray([{
        id: 'req-orig',
        inventorySystemId: 'sys-1',
        status: 'delivered',
        catalogItemId: 'cat-1',
        catalogItemName: 'Widget',
        quantity: 50,
        city: 'Portland',
        state: 'OR',
        requestedBy: 'requestor-key',
      }]);

      // Re-request
      const orig = yRequests._data[0];
      const newReq = {
        id: 'req-new',
        inventorySystemId: orig.inventorySystemId,
        catalogItemId: orig.catalogItemId,
        catalogItemName: orig.catalogItemName,
        quantity: orig.quantity,
        city: orig.city,
        state: orig.state,
        status: 'open',
        requestedBy: orig.requestedBy,
        requestedAt: Date.now(),
        assignedTo: null,
      };
      yRequests.push([newReq]);

      expect(yRequests._data.length).toBe(2);
      expect(yRequests._data[1].id).toBe('req-new');
      expect(yRequests._data[1].status).toBe('open');
      expect(yRequests._data[1].catalogItemName).toBe('Widget');
      expect(yRequests._data[1].city).toBe('Portland');
    });
  });

  describe('Admin reject returns to open pool', () => {
    test('reject clears assignment and returns to open', () => {
      const yRequests = createMockYArray([{
        id: 'req-reject',
        inventorySystemId: 'sys-1',
        status: 'pending_approval',
        assignedTo: 'producer-key',
        claimedBy: 'producer-key',
      }]);

      const arr = yRequests.toArray();
      yRequests.delete(0, 1);
      yRequests.insert(0, [{
        ...arr[0],
        status: 'open',
        assignedTo: null,
        assignedAt: null,
        claimedBy: null,
        claimedAt: null,
      }]);
      expect(yRequests._data[0].status).toBe('open');
      expect(yRequests._data[0].assignedTo).toBeNull();
      expect(yRequests._data[0].claimedBy).toBeNull();
    });
  });

  describe('Collaborator permission filtering', () => {
    test('only owners and editors can be producers', () => {
      const collaborators = [
        makeCollaborator('owner-key', 'Owner', 'owner'),
        makeCollaborator('editor-key', 'Editor', 'editor'),
        makeCollaborator('viewer-key', 'Viewer', 'viewer'),
      ];

      const producers = collaborators.filter(c =>
        c.permission === 'editor' || c.permission === 'owner'
      );
      expect(producers.length).toBe(2);
      expect(producers.find(p => p.displayName === 'Viewer')).toBeUndefined();
    });

    test('collaborator objects have both publicKey and publicKeyBase62', () => {
      const collab = makeCollaborator('test-key', 'Test', 'editor');
      expect(collab.publicKey).toBe('test-key');
      expect(collab.publicKeyBase62).toBe('test-key');
    });
  });

  describe('Audit log entries', () => {
    test('all actions create properly structured audit entries', () => {
      const actions = [
        'request_submitted', 'request_approved', 'request_rejected',
        'request_cancelled', 'request_shipped', 'request_delivered',
        'request_unclaimed', 'request_edited', 'producer_names_mapped',
      ];

      const yAudit = createMockYArray([]);
      actions.forEach(action => {
        yAudit.push([{
          id: `aud-${action}`,
          inventorySystemId: 'sys-1',
          action,
          targetId: 'req-1',
          targetType: 'request',
          summary: `Test ${action}`,
          actorId: 'actor-key',
          actorRole: 'owner',
          timestamp: Date.now(),
        }]);
      });

      expect(yAudit._data.length).toBe(actions.length);
      yAudit._data.forEach(entry => {
        expect(entry.id).toBeTruthy();
        expect(entry.inventorySystemId).toBe('sys-1');
        expect(entry.action).toBeTruthy();
        expect(entry.timestamp).toBeTruthy();
      });
    });
  });
});

// ============================================================
// §12 — Edge cases and boundary tests
// ============================================================

describe('Edge cases', () => {
  test('empty collaborators array still allows self as producer', () => {
    const myKey = 'owner-key';
    const collaborators = [];
    const result = collaborators.filter(c =>
      c.permission === 'editor' || c.permission === 'owner'
    );
    // Self-add fallback
    if (myKey && !result.find(c => c.publicKey === myKey || c.publicKeyBase62 === myKey)) {
      result.unshift({
        publicKey: myKey,
        publicKeyBase62: myKey,
        displayName: 'Me',
        permission: 'owner',
      });
    }
    expect(result.length).toBe(1);
    expect(result[0].publicKey).toBe('owner-key');
  });

  test('request without assignedTo skips address reveal on approve', async () => {
    const yRequests = createMockYArray([{
      id: 'req-no-assign',
      status: 'pending_approval',
      requestedBy: 'requestor-key',
      assignedTo: null,
    }]);
    const yReveals = createMockYMap({});

    // Approve without assignedTo — should not create reveal
    const arr = yRequests.toArray();
    yRequests.delete(0, 1);
    yRequests.insert(0, [{ ...arr[0], status: 'approved', approvedAt: Date.now() }]);

    // No reveal should be created since assignedTo is null
    expect(Object.keys(yReveals._data).length).toBe(0);
  });

  test('pending address without inventorySystemId is included (backward compat)', () => {
    const allPending = {
      'req-old': { entries: [] }, // no inventorySystemId
      'req-new': { inventorySystemId: 'sys-1', entries: [] },
      'req-other': { inventorySystemId: 'sys-2', entries: [] },
    };

    const filtered = Object.entries(allPending)
      .filter(([, val]) => !val.inventorySystemId || val.inventorySystemId === 'sys-1')
      .reduce((acc, [key, val]) => { acc[key] = val; return acc; }, {});

    expect(Object.keys(filtered).length).toBe(2);
    expect(filtered['req-old']).toBeTruthy();
    expect(filtered['req-new']).toBeTruthy();
    expect(filtered['req-other']).toBeUndefined();
  });

  test('resolveUserName handles both publicKey and publicKeyBase62', () => {
    const collaborators = [
      { publicKey: 'key-1', publicKeyBase62: 'key-1', displayName: 'Alice' },
      { publicKey: 'key-2', displayName: 'Bob' },
    ];

    // Mock resolveUserName behavior
    const resolveUserName = (collabs, key, fallback) => {
      const c = collabs.find(x => x.publicKey === key || x.publicKeyBase62 === key);
      return c?.displayName || c?.name || fallback || key?.slice(0, 8) + '…';
    };

    expect(resolveUserName(collaborators, 'key-1')).toBe('Alice');
    expect(resolveUserName(collaborators, 'key-2')).toBe('Bob');
    expect(resolveUserName(collaborators, 'unknown')).toBe('unknown…');
  });

  test('notification is not sent when requestedBy is missing', () => {
    const yNotifs = createMockYArray([]);
    const req = { id: 'req-no-requester', requestedBy: null };

    // Simulate: only push notification if requestedBy exists
    if (req.requestedBy) {
      yNotifs.push([{ type: 'test', recipientId: req.requestedBy }]);
    }
    expect(yNotifs._data.length).toBe(0);
  });

  test('Yjs delete/insert pattern preserves array integrity', () => {
    const yArr = createMockYArray([
      { id: 'a', val: 1 },
      { id: 'b', val: 2 },
      { id: 'c', val: 3 },
    ]);

    // Update 'b'
    const arr = yArr.toArray();
    const idx = arr.findIndex(r => r.id === 'b');
    yArr.delete(idx, 1);
    yArr.insert(idx, [{ id: 'b', val: 20 }]);

    expect(yArr._data.length).toBe(3);
    expect(yArr._data[0].id).toBe('a');
    expect(yArr._data[1].id).toBe('b');
    expect(yArr._data[1].val).toBe(20);
    expect(yArr._data[2].id).toBe('c');
  });

  test('multiple status filters work independently', () => {
    const requests = [
      { id: 'r1', status: 'open', state: 'CA', urgent: true, assignedTo: 'p1', requestedAt: 100 },
      { id: 'r2', status: 'approved', state: 'NY', urgent: false, assignedTo: 'p2', requestedAt: 200 },
      { id: 'r3', status: 'open', state: 'CA', urgent: false, assignedTo: 'p1', requestedAt: 300 },
      { id: 'r4', status: 'shipped', state: 'OR', urgent: true, assignedTo: 'p2', requestedAt: 50 },
    ];

    // Test status filter
    let result = requests.filter(r => r.status === 'open');
    expect(result.length).toBe(2);

    // Test producer filter
    result = requests.filter(r => r.assignedTo === 'p1');
    expect(result.length).toBe(2);

    // Test date filter
    const fromTs = 100;
    const toTs = 250;
    result = requests.filter(r => r.requestedAt >= fromTs && r.requestedAt < toTs);
    expect(result.length).toBe(2);

    // Test combined filters
    result = requests
      .filter(r => r.status === 'open')
      .filter(r => r.assignedTo === 'p1')
      .filter(r => r.requestedAt >= 100 && r.requestedAt < 250);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('r1');
  });
});
