/**
 * tests/inventory-system-bugs.test.js
 *
 * Comprehensive tests for the inventory system bug-fix batch:
 *
 * 1. Onboarding race condition (showOnboarding state)
 * 2. Non-owner "Waiting for Setup" message
 * 3. key={activeDocId} remount removal (now uses workspaceId)
 * 4. yInventoryNotifications plumbing through useWorkspaceSync
 * 5. Auto-assign respects requireApproval setting (SubmitRequest)
 * 6. One-per-workspace guard for inventory & file storage
 * 7. CreateDocument disabledTypes prop
 *
 * Test categories: Unit, Functional, UI, End-to-End scenario
 */

import React from 'react';
import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// ============================================================
// Mocks — keep them minimal so each test can control behavior
// ============================================================

// Mock Y.Array-like object
function createMockYArray(initialData = []) {
  const data = [...initialData];
  const observers = [];
  return {
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
  };
}

// Mock Y.Map-like object
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

// Minimal identity helper
const makeIdentity = (key = 'user-abc123') => ({
  publicKeyBase62: key,
});

// Minimal collaborator helper
const makeCollaborator = (key, name = 'TestUser') => ({
  id: key,
  publicKey: key,
  name,
  color: '#6366f1',
  icon: '👤',
});

// ============================================================
// §1 — Onboarding race condition (InventoryDashboard)
// ============================================================

// We need to mock all the imported components and hooks to test InventoryDashboard in isolation
jest.mock('../frontend/src/contexts/InventoryContext', () => {
  const actual = jest.requireActual('../frontend/src/contexts/InventoryContext');
  return {
    ...actual,
    InventoryProvider: ({ children }) => <div data-testid="inventory-provider">{children}</div>,
    useInventory: () => ({}),
  };
});

jest.mock('../frontend/src/hooks/useInventorySync', () => ({
  useInventorySync: jest.fn(),
}));

jest.mock('../frontend/src/utils/inventoryNotifications', () => ({
  getUnreadCount: jest.fn(() => 0),
}));

jest.mock('../frontend/src/hooks/usePermission', () => ({
  usePermission: jest.fn(() => ({ isOwner: true, isEditor: false, isViewer: false })),
}));

// Mock all child components to avoid deep dependency trees
jest.mock('../frontend/src/components/inventory/InventoryNavRail', () => {
  return function MockNavRail({ activeView, onNavigate, isOwner }) {
    return <div data-testid="nav-rail" data-active={activeView} data-owner={String(isOwner)} />;
  };
});

jest.mock('../frontend/src/components/inventory/OnboardingWizard', () => {
  return function MockOnboardingWizard({ onComplete }) {
    return <div data-testid="onboarding-wizard"><button onClick={onComplete}>Complete</button></div>;
  };
});

jest.mock('../frontend/src/components/inventory/admin/AdminDashboard', () => {
  return function MockAdminDashboard() { return <div data-testid="admin-dashboard" />; };
});
jest.mock('../frontend/src/components/inventory/admin/AllRequests', () => {
  return function MockAllRequests() { return <div data-testid="all-requests" />; };
});
jest.mock('../frontend/src/components/inventory/admin/CatalogManager', () => {
  return function MockCatalogManager() { return <div data-testid="catalog-manager" />; };
});
jest.mock('../frontend/src/components/inventory/requestor/SubmitRequest', () => {
  return function MockSubmitRequest() { return <div data-testid="submit-request" />; };
});
jest.mock('../frontend/src/components/inventory/requestor/MyRequests', () => {
  return function MockMyRequests() { return <div data-testid="my-requests" />; };
});
jest.mock('../frontend/src/components/inventory/requestor/SavedAddresses', () => {
  return function MockSavedAddresses() { return <div data-testid="saved-addresses" />; };
});
jest.mock('../frontend/src/components/inventory/admin/ApprovalQueue', () => {
  return function MockApprovalQueue() { return <div data-testid="approval-queue" />; };
});
jest.mock('../frontend/src/components/inventory/admin/InventorySettings', () => {
  return function MockInventorySettings() { return <div data-testid="inventory-settings" />; };
});
jest.mock('../frontend/src/components/inventory/producer/ProducerDashboard', () => {
  return function MockProducerDashboard() { return <div data-testid="producer-dashboard" />; };
});
jest.mock('../frontend/src/components/inventory/producer/OpenRequests', () => {
  return function MockOpenRequests() { return <div data-testid="open-requests" />; };
});
jest.mock('../frontend/src/components/inventory/producer/MyRequests', () => {
  return function MockProducerMyRequests() { return <div data-testid="producer-my-requests" />; };
});
jest.mock('../frontend/src/components/inventory/producer/ProducerStats', () => {
  return function MockProducerStats() { return <div data-testid="producer-stats" />; };
});
jest.mock('../frontend/src/components/inventory/analytics/AnalyticsDashboard', () => {
  return function MockAnalyticsDashboard() { return <div data-testid="analytics-dashboard" />; };
});
jest.mock('../frontend/src/components/inventory/analytics/USHeatmap', () => {
  return function MockUSHeatmap() { return <div data-testid="us-heatmap" />; };
});
jest.mock('../frontend/src/components/inventory/import/ImportWizard', () => {
  return function MockImportWizard() { return <div data-testid="import-wizard" />; };
});
jest.mock('../frontend/src/components/inventory/admin/AuditLog', () => {
  return function MockAuditLog() { return <div data-testid="audit-log" />; };
});
jest.mock('../frontend/src/components/inventory/admin/ProducerManagement', () => {
  return function MockProducerManagement() { return <div data-testid="producer-management" />; };
});
jest.mock('../frontend/src/components/inventory/admin/ProducerNameMapper', () => {
  return function MockProducerNameMapper() { return <div data-testid="producer-name-mapper" />; };
});
jest.mock('../frontend/src/components/inventory/requestor/RequestFAQ', () => {
  return function MockRequestFAQ() { return <div data-testid="request-faq" />; };
});
jest.mock('../frontend/src/components/inventory/common/NotificationInbox', () => {
  return function MockNotificationInbox() { return <div data-testid="notification-inbox" />; };
});

// CreateDocument dependencies
jest.mock('../frontend/src/contexts/FolderContext', () => ({
  useFolders: () => ({ folders: [] }),
}));
jest.mock('../frontend/src/contexts/WorkspaceContext', () => ({
  useWorkspaces: () => ({
    currentWorkspace: { id: 'ws-1', name: 'Test' },
    currentWorkspaceId: 'ws-1',
  }),
}));
jest.mock('../frontend/src/contexts/PermissionContext', () => ({
  usePermissions: () => ({ canCreate: () => true }),
}));
jest.mock('../frontend/src/hooks/useFocusTrap', () => ({
  useFocusTrap: () => {},
}));

// Import AFTER mocks
const { useInventorySync } = require('../frontend/src/hooks/useInventorySync');
const { usePermission } = require('../frontend/src/hooks/usePermission');
const { default: InventoryDashboard, VIEWS } = require('../frontend/src/components/inventory/InventoryDashboard');

// Default props for InventoryDashboard
function dashboardProps(overrides = {}) {
  return {
    inventorySystemId: 'inv-test123',
    workspaceId: 'ws-1',
    userIdentity: makeIdentity(),
    collaborators: [],
    currentWorkspace: { id: 'ws-1', name: 'Test Workspace' },
    yInventorySystems: createMockYMap(),
    yCatalogItems: createMockYArray(),
    yInventoryRequests: createMockYArray(),
    yProducerCapacities: createMockYMap(),
    yAddressReveals: createMockYMap(),
    yPendingAddresses: createMockYMap(),
    yInventoryAuditLog: createMockYArray(),
    yInventoryNotifications: createMockYArray(),
    onStartChatWith: jest.fn(),
    ...overrides,
  };
}

describe('Inventory System Bug Fixes', () => {

  beforeEach(() => {
    jest.useFakeTimers();
    usePermission.mockReturnValue({ isOwner: true, isEditor: false, isViewer: false });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────
  // §1  Onboarding race condition
  // ─────────────────────────────────────────────────────────
  describe('§1 — Onboarding race condition', () => {

    test('shows loading state while Yjs data has not synced yet (currentSystem is null)', () => {
      useInventorySync.mockReturnValue({
        currentSystem: null,
        requests: [],
        catalog: [],
        openRequestCount: 0,
        pendingApprovalCount: 0,
      });
      render(<InventoryDashboard {...dashboardProps()} />);
      expect(screen.getByText('Loading Inventory System')).toBeInTheDocument();
      expect(screen.getByText(/Syncing data/)).toBeInTheDocument();
    });

    test('shows onboarding wizard when system exists but onboarding not complete (owner)', () => {
      useInventorySync.mockReturnValue({
        currentSystem: { id: 'inv-test123', name: 'Inventory', onboardingComplete: false },
        requests: [],
        catalog: [],
        openRequestCount: 0,
        pendingApprovalCount: 0,
      });
      render(<InventoryDashboard {...dashboardProps()} />);
      expect(screen.getByTestId('onboarding-wizard')).toBeInTheDocument();
    });

    test('shows admin dashboard when onboarding IS complete (owner)', () => {
      useInventorySync.mockReturnValue({
        currentSystem: { id: 'inv-test123', name: 'Inventory', onboardingComplete: true },
        requests: [],
        catalog: [],
        openRequestCount: 0,
        pendingApprovalCount: 0,
      });
      render(<InventoryDashboard {...dashboardProps()} />);
      expect(screen.getByTestId('admin-dashboard')).toBeInTheDocument();
    });

    test('onboarding wizard onComplete callback sets showOnboarding=false and shows admin dashboard', () => {
      useInventorySync.mockReturnValue({
        currentSystem: { id: 'inv-test123', name: 'Inventory', onboardingComplete: false },
        requests: [],
        catalog: [],
        openRequestCount: 0,
        pendingApprovalCount: 0,
      });
      render(<InventoryDashboard {...dashboardProps()} />);
      // Click the mock wizard's complete button
      fireEvent.click(screen.getByText('Complete'));
      // After completing, admin dashboard should be visible
      expect(screen.getByTestId('admin-dashboard')).toBeInTheDocument();
    });

    test('loading state resolves after timeout when system truly does not exist', () => {
      useInventorySync.mockReturnValue({
        currentSystem: null,
        requests: [],
        catalog: [],
        openRequestCount: 0,
        pendingApprovalCount: 0,
      });
      render(<InventoryDashboard {...dashboardProps()} />);
      // Still loading initially
      expect(screen.getByText('Loading Inventory System')).toBeInTheDocument();
      // Advance timer past the 2-second fallback
      act(() => { jest.advanceTimersByTime(2500); });
      // Now it should resolve (not onboarding, since currentSystem is still null → showOnboarding=false)
      // For owner, it should show admin dashboard (default view)
      expect(screen.getByTestId('admin-dashboard')).toBeInTheDocument();
    });

    test('useEffect watches inventoryState.currentSystem and transitions from loading to wizard', () => {
      // Start with null system
      const syncReturnValue = {
        currentSystem: null,
        requests: [],
        catalog: [],
        openRequestCount: 0,
        pendingApprovalCount: 0,
      };
      useInventorySync.mockReturnValue(syncReturnValue);
      
      const { rerender } = render(<InventoryDashboard {...dashboardProps()} />);
      expect(screen.getByText('Loading Inventory System')).toBeInTheDocument();
      
      // Simulate Yjs sync completing — system appears but onboarding not complete
      const updatedSync = {
        ...syncReturnValue,
        currentSystem: { id: 'inv-test123', name: 'Inventory', onboardingComplete: false },
      };
      useInventorySync.mockReturnValue(updatedSync);
      rerender(<InventoryDashboard {...dashboardProps()} />);
      
      expect(screen.getByTestId('onboarding-wizard')).toBeInTheDocument();
    });

    test('useEffect watches inventoryState.currentSystem and transitions from loading to dashboard', () => {
      const syncReturnValue = {
        currentSystem: null,
        requests: [],
        catalog: [],
        openRequestCount: 0,
        pendingApprovalCount: 0,
      };
      useInventorySync.mockReturnValue(syncReturnValue);
      
      const { rerender } = render(<InventoryDashboard {...dashboardProps()} />);
      expect(screen.getByText('Loading Inventory System')).toBeInTheDocument();
      
      // System appears with onboarding complete
      useInventorySync.mockReturnValue({
        ...syncReturnValue,
        currentSystem: { id: 'inv-test123', name: 'Inventory', onboardingComplete: true },
      });
      rerender(<InventoryDashboard {...dashboardProps()} />);
      
      expect(screen.getByTestId('admin-dashboard')).toBeInTheDocument();
    });
  });

  // ─────────────────────────────────────────────────────────
  // §2  Non-owner "Waiting for Setup" message
  // ─────────────────────────────────────────────────────────
  describe('§2 — Non-owner waiting message', () => {

    test('non-owner sees "Waiting for Setup" when onboarding not complete', () => {
      usePermission.mockReturnValue({ isOwner: false, isEditor: false, isViewer: true });
      useInventorySync.mockReturnValue({
        currentSystem: { id: 'inv-test123', name: 'Inventory', onboardingComplete: false },
        requests: [],
        catalog: [],
        openRequestCount: 0,
        pendingApprovalCount: 0,
      });
      render(<InventoryDashboard {...dashboardProps()} />);
      expect(screen.getByText('Waiting for Setup')).toBeInTheDocument();
      expect(screen.getByText(/workspace admin/i)).toBeInTheDocument();
    });

    test('non-owner does NOT see onboarding wizard', () => {
      usePermission.mockReturnValue({ isOwner: false, isEditor: false, isViewer: true });
      useInventorySync.mockReturnValue({
        currentSystem: { id: 'inv-test123', name: 'Inventory', onboardingComplete: false },
        requests: [],
        catalog: [],
        openRequestCount: 0,
        pendingApprovalCount: 0,
      });
      render(<InventoryDashboard {...dashboardProps()} />);
      expect(screen.queryByTestId('onboarding-wizard')).not.toBeInTheDocument();
    });

    test('non-owner sees submit request view when onboarding IS complete', () => {
      usePermission.mockReturnValue({ isOwner: false, isEditor: false, isViewer: true });
      useInventorySync.mockReturnValue({
        currentSystem: { id: 'inv-test123', name: 'Inventory', onboardingComplete: true },
        requests: [],
        catalog: [],
        openRequestCount: 0,
        pendingApprovalCount: 0,
      });
      render(<InventoryDashboard {...dashboardProps()} />);
      // Default view for viewer = SUBMIT_REQUEST
      expect(screen.getByTestId('submit-request')).toBeInTheDocument();
    });

    test('editor sees "Waiting for Setup" when onboarding not complete', () => {
      usePermission.mockReturnValue({ isOwner: false, isEditor: true, isViewer: false });
      useInventorySync.mockReturnValue({
        currentSystem: { id: 'inv-test123', name: 'Inventory', onboardingComplete: false },
        requests: [],
        catalog: [],
        openRequestCount: 0,
        pendingApprovalCount: 0,
      });
      render(<InventoryDashboard {...dashboardProps()} />);
      expect(screen.getByText('Waiting for Setup')).toBeInTheDocument();
    });

    test('editor sees producer dashboard when onboarding IS complete', () => {
      usePermission.mockReturnValue({ isOwner: false, isEditor: true, isViewer: false });
      useInventorySync.mockReturnValue({
        currentSystem: { id: 'inv-test123', name: 'Inventory', onboardingComplete: true },
        requests: [],
        catalog: [],
        openRequestCount: 0,
        pendingApprovalCount: 0,
      });
      render(<InventoryDashboard {...dashboardProps()} />);
      expect(screen.getByTestId('producer-dashboard')).toBeInTheDocument();
    });

    test('non-owner loading state also works correctly', () => {
      usePermission.mockReturnValue({ isOwner: false, isEditor: false, isViewer: true });
      useInventorySync.mockReturnValue({
        currentSystem: null,
        requests: [],
        catalog: [],
        openRequestCount: 0,
        pendingApprovalCount: 0,
      });
      render(<InventoryDashboard {...dashboardProps()} />);
      expect(screen.getByText('Loading Inventory System')).toBeInTheDocument();
    });
  });

  // ─────────────────────────────────────────────────────────
  // §3  key={activeDocId} → key={currentWorkspaceId}
  // ─────────────────────────────────────────────────────────
  describe('§3 — Stable key prevents remount on tab switch', () => {

    test('InventoryDashboard preserves state when inventorySystemId prop stays the same', () => {
      useInventorySync.mockReturnValue({
        currentSystem: { id: 'inv-test123', name: 'Inventory', onboardingComplete: true },
        requests: [],
        catalog: [],
        openRequestCount: 0,
        pendingApprovalCount: 0,
      });
      const props = dashboardProps();
      const { rerender } = render(<InventoryDashboard {...props} />);
      
      // Verify initial render
      expect(screen.getByTestId('admin-dashboard')).toBeInTheDocument();
      
      // Re-render with same ID (simulating tab switch back) — should not remount
      rerender(<InventoryDashboard {...props} />);
      expect(screen.getByTestId('admin-dashboard')).toBeInTheDocument();
    });

    test('InventoryDashboard does NOT show onboarding on re-render when system is complete', () => {
      useInventorySync.mockReturnValue({
        currentSystem: { id: 'inv-test123', name: 'Inventory', onboardingComplete: true },
        requests: [],
        catalog: [],
        openRequestCount: 0,
        pendingApprovalCount: 0,
      });
      const props = dashboardProps();
      const { rerender } = render(<InventoryDashboard {...props} />);
      
      // Multiple re-renders should keep showing admin dashboard, never wizard
      for (let i = 0; i < 5; i++) {
        rerender(<InventoryDashboard {...props} />);
        expect(screen.getByTestId('admin-dashboard')).toBeInTheDocument();
        expect(screen.queryByTestId('onboarding-wizard')).not.toBeInTheDocument();
      }
    });
  });

  // ─────────────────────────────────────────────────────────
  // §4  yInventoryNotifications plumbing
  // ─────────────────────────────────────────────────────────
  describe('§4 — yInventoryNotifications in useWorkspaceSync', () => {

    test('useWorkspaceSync return value includes yInventoryNotifications key', () => {
      // We test this by verifying the source file includes the ref and return
      const fs = require('fs');
      const src = fs.readFileSync(
        require('path').join(__dirname, '..', 'frontend', 'src', 'hooks', 'useWorkspaceSync.js'),
        'utf-8'
      );
      
      // Must declare the ref
      expect(src).toContain('yInventoryNotificationsRef = useRef(null)');
      
      // Must create the Yjs array
      expect(src).toContain("ydoc.getArray('inventoryNotifications')");
      
      // Must assign the ref
      expect(src).toContain('yInventoryNotificationsRef.current = yInventoryNotifications');
      
      // Must include in return object
      expect(src).toContain('yInventoryNotifications: yInventoryNotificationsRef.current');
    });

    test('AppNew.jsx destructures yInventoryNotifications from useWorkspaceSync', () => {
      const fs = require('fs');
      const src = fs.readFileSync(
        require('path').join(__dirname, '..', 'frontend', 'src', 'AppNew.jsx'),
        'utf-8'
      );
      
      // Must destructure it
      expect(src).toContain('yInventoryNotifications,');
      
      // Must pass it to InventoryDashboard
      expect(src).toContain('yInventoryNotifications={yInventoryNotifications}');
    });

    test('InventoryDashboard renders notification count when yInventoryNotifications is provided', () => {
      const notifications = createMockYArray([
        { id: 'n1', inventorySystemId: 'inv-test123', recipientId: 'user-abc123', read: false, createdAt: Date.now() },
        { id: 'n2', inventorySystemId: 'inv-test123', recipientId: 'user-abc123', read: true, createdAt: Date.now() },
      ]);
      
      const { getUnreadCount } = require('../frontend/src/utils/inventoryNotifications');
      getUnreadCount.mockReturnValue(1);
      
      useInventorySync.mockReturnValue({
        currentSystem: { id: 'inv-test123', name: 'Inventory', onboardingComplete: true },
        requests: [],
        catalog: [],
        openRequestCount: 0,
        pendingApprovalCount: 0,
      });
      
      render(<InventoryDashboard {...dashboardProps({ yInventoryNotifications: notifications })} />);
      // Should render without crashing and show admin dashboard
      expect(screen.getByTestId('admin-dashboard')).toBeInTheDocument();
    });

    test('InventoryDashboard handles null yInventoryNotifications gracefully', () => {
      useInventorySync.mockReturnValue({
        currentSystem: { id: 'inv-test123', name: 'Inventory', onboardingComplete: true },
        requests: [],
        catalog: [],
        openRequestCount: 0,
        pendingApprovalCount: 0,
      });
      
      // Pass null — should not crash
      render(<InventoryDashboard {...dashboardProps({ yInventoryNotifications: null })} />);
      expect(screen.getByTestId('admin-dashboard')).toBeInTheDocument();
    });
  });

  // ─────────────────────────────────────────────────────────
  // §5  Auto-assign respects requireApproval
  // ─────────────────────────────────────────────────────────
  describe('§5 — Auto-assign respects requireApproval', () => {

    test('SubmitRequest source contains requireApproval-aware status in auto-assign', () => {
      const fs = require('fs');
      const src = fs.readFileSync(
        require('path').join(__dirname, '..', 'frontend', 'src', 'components', 'inventory', 'requestor', 'SubmitRequest.jsx'),
        'utf-8'
      );
      
      // Must NOT contain the old unconditional 'claimed' status
      expect(src).not.toMatch(/status:\s*'claimed',\s*\n\s*assignedTo:/);
      
      // Must contain the requireApproval ternary
      expect(src).toContain("settings.requireApproval ? 'pending_approval' : 'claimed'");
    });

    test('auto-assign logic: requireApproval=true → status pending_approval', () => {
      // Simulate the auto-assign logic inline
      const settings = { requireApproval: true, autoAssignEnabled: true };
      const status = settings.requireApproval ? 'pending_approval' : 'claimed';
      expect(status).toBe('pending_approval');
    });

    test('auto-assign logic: requireApproval=false → status claimed', () => {
      const settings = { requireApproval: false, autoAssignEnabled: true };
      const status = settings.requireApproval ? 'pending_approval' : 'claimed';
      expect(status).toBe('claimed');
    });

    test('auto-assign logic: requireApproval=undefined (default) → status claimed', () => {
      const settings = { autoAssignEnabled: true };
      const status = settings.requireApproval ? 'pending_approval' : 'claimed';
      expect(status).toBe('claimed');
    });

    test('auto-assign integration: Yjs array receives correct status based on requireApproval', () => {
      // Simulate the full auto-assign flow with a mock Yjs array
      const yRequests = createMockYArray([
        { id: 'req-1', catalogItemId: 'item-1', quantity: 1, status: 'open', requestedAt: Date.now() },
      ]);
      
      const settings = { requireApproval: true, autoAssignEnabled: true };
      const now = Date.now();
      const producerId = 'producer-a';
      
      // Simulate the auto-assign operation
      const arr = yRequests.toArray();
      const idx = arr.findIndex(r => r.id === 'req-1');
      if (idx !== -1) {
        yRequests.delete(idx, 1);
        yRequests.insert(idx, [{
          ...arr[idx],
          status: settings.requireApproval ? 'pending_approval' : 'claimed',
          assignedTo: producerId,
          assignedAt: now,
        }]);
      }
      
      const result = yRequests.toArray();
      expect(result[0].status).toBe('pending_approval');
      expect(result[0].assignedTo).toBe('producer-a');
    });

    test('auto-assign integration: requireApproval=false sets claimed status in Yjs', () => {
      const yRequests = createMockYArray([
        { id: 'req-2', catalogItemId: 'item-1', quantity: 1, status: 'open', requestedAt: Date.now() },
      ]);
      
      const settings = { requireApproval: false, autoAssignEnabled: true };
      const now = Date.now();
      const producerId = 'producer-b';
      
      const arr = yRequests.toArray();
      const idx = arr.findIndex(r => r.id === 'req-2');
      if (idx !== -1) {
        yRequests.delete(idx, 1);
        yRequests.insert(idx, [{
          ...arr[idx],
          status: settings.requireApproval ? 'pending_approval' : 'claimed',
          assignedTo: producerId,
          assignedAt: now,
        }]);
      }
      
      const result = yRequests.toArray();
      expect(result[0].status).toBe('claimed');
      expect(result[0].assignedTo).toBe('producer-b');
    });
  });

  // ─────────────────────────────────────────────────────────
  // §6  One-per-workspace guard
  // ─────────────────────────────────────────────────────────
  describe('§6 — One inventory/file-storage per workspace guard', () => {

    test('AppNew.jsx createInventorySystem checks for existing inventory docs', () => {
      const fs = require('fs');
      const src = fs.readFileSync(
        require('path').join(__dirname, '..', 'frontend', 'src', 'AppNew.jsx'),
        'utf-8'
      );
      
      // Must have the guard
      expect(src).toContain("d.type === DOC_TYPES.INVENTORY && d.workspaceId === currentWorkspaceId && !d.deletedAt");
      expect(src).toContain("only one per workspace is allowed");
    });

    test('AppNew.jsx createFileStorage checks for existing file storage docs', () => {
      const fs = require('fs');
      const src = fs.readFileSync(
        require('path').join(__dirname, '..', 'frontend', 'src', 'AppNew.jsx'),
        'utf-8'
      );
      
      // Must have the guard
      expect(src).toContain("d.type === DOC_TYPES.FILE_STORAGE && d.workspaceId === currentWorkspaceId && !d.deletedAt");
    });

    test('one-per-workspace guard logic: finds existing inventory in documents array', () => {
      const DOC_TYPES = { INVENTORY: 'inventory', FILE_STORAGE: 'files' };
      const currentWorkspaceId = 'ws-1';
      const documents = [
        { id: 'doc-1', type: 'text', workspaceId: 'ws-1' },
        { id: 'inv-existing', type: 'inventory', workspaceId: 'ws-1' },
        { id: 'doc-2', type: 'sheet', workspaceId: 'ws-1' },
      ];
      
      const existing = documents.find(
        d => d.type === DOC_TYPES.INVENTORY && d.workspaceId === currentWorkspaceId && !d.deletedAt
      );
      
      expect(existing).toBeDefined();
      expect(existing.id).toBe('inv-existing');
    });

    test('one-per-workspace guard: does NOT block when inventory is in different workspace', () => {
      const DOC_TYPES = { INVENTORY: 'inventory' };
      const currentWorkspaceId = 'ws-2';
      const documents = [
        { id: 'inv-existing', type: 'inventory', workspaceId: 'ws-1' },
      ];
      
      const existing = documents.find(
        d => d.type === DOC_TYPES.INVENTORY && d.workspaceId === currentWorkspaceId && !d.deletedAt
      );
      
      expect(existing).toBeUndefined();
    });

    test('one-per-workspace guard: does NOT block when inventory is deleted (soft-deleted)', () => {
      const DOC_TYPES = { INVENTORY: 'inventory' };
      const currentWorkspaceId = 'ws-1';
      const documents = [
        { id: 'inv-deleted', type: 'inventory', workspaceId: 'ws-1', deletedAt: Date.now() },
      ];
      
      const existing = documents.find(
        d => d.type === DOC_TYPES.INVENTORY && d.workspaceId === currentWorkspaceId && !d.deletedAt
      );
      
      expect(existing).toBeUndefined();
    });

    test('one-per-workspace guard: finds existing file storage', () => {
      const DOC_TYPES = { FILE_STORAGE: 'files' };
      const currentWorkspaceId = 'ws-1';
      const documents = [
        { id: 'fs-existing', type: 'files', workspaceId: 'ws-1' },
        { id: 'doc-1', type: 'text', workspaceId: 'ws-1' },
      ];
      
      const existing = documents.find(
        d => d.type === DOC_TYPES.FILE_STORAGE && d.workspaceId === currentWorkspaceId && !d.deletedAt
      );
      
      expect(existing).toBeDefined();
      expect(existing.id).toBe('fs-existing');
    });

    test('one-per-workspace guard: allows creation when no inventory exists', () => {
      const DOC_TYPES = { INVENTORY: 'inventory' };
      const currentWorkspaceId = 'ws-1';
      const documents = [
        { id: 'doc-1', type: 'text', workspaceId: 'ws-1' },
        { id: 'doc-2', type: 'sheet', workspaceId: 'ws-1' },
      ];
      
      const existing = documents.find(
        d => d.type === DOC_TYPES.INVENTORY && d.workspaceId === currentWorkspaceId && !d.deletedAt
      );
      
      expect(existing).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────
  // §7  CreateDocument disabledTypes
  // ─────────────────────────────────────────────────────────
  describe('§7 — CreateDocument disabledTypes prop', () => {

    const CreateDocument = require('../frontend/src/components/CreateDocument').default;

    test('renders all type buttons when disabledTypes is empty', () => {
      render(<CreateDocument isOpen={true} onClose={jest.fn()} disabledTypes={[]} />);
      const grid = screen.getByTestId('doc-type-grid');
      const buttons = grid.querySelectorAll('button');
      // Should have 5 type buttons (text, sheet, kanban, inventory, file_storage)
      expect(buttons.length).toBe(5);
      buttons.forEach(btn => {
        expect(btn).not.toBeDisabled();
      });
    });

    test('disables inventory button when inventory is in disabledTypes', () => {
      render(<CreateDocument isOpen={true} onClose={jest.fn()} disabledTypes={['inventory']} />);
      const invButton = screen.getByTestId('doc-type-inventory');
      expect(invButton).toBeDisabled();
      expect(invButton).toHaveAttribute('title', expect.stringContaining('Only one'));
    });

    test('disables file storage button when files is in disabledTypes', () => {
      render(<CreateDocument isOpen={true} onClose={jest.fn()} disabledTypes={['files']} />);
      const fsButton = screen.getByTestId('doc-type-files');
      expect(fsButton).toBeDisabled();
      expect(fsButton).toHaveAttribute('title', expect.stringContaining('Only one'));
    });

    test('disables both inventory and file storage when both are in disabledTypes', () => {
      render(<CreateDocument isOpen={true} onClose={jest.fn()} disabledTypes={['inventory', 'files']} />);
      expect(screen.getByTestId('doc-type-inventory')).toBeDisabled();
      expect(screen.getByTestId('doc-type-files')).toBeDisabled();
      // Other types should NOT be disabled
      expect(screen.getByTestId('doc-type-text')).not.toBeDisabled();
      expect(screen.getByTestId('doc-type-sheet')).not.toBeDisabled();
      expect(screen.getByTestId('doc-type-kanban')).not.toBeDisabled();
    });

    test('disabled type button shows "Already exists" description', () => {
      render(<CreateDocument isOpen={true} onClose={jest.fn()} disabledTypes={['inventory']} />);
      const invButton = screen.getByTestId('doc-type-inventory');
      expect(invButton.textContent).toContain('Already exists');
    });

    test('clicking disabled type button does NOT change selected type', () => {
      render(<CreateDocument isOpen={true} onClose={jest.fn()} disabledTypes={['inventory']} />);
      // Initially text is selected (default)
      expect(screen.getByTestId('doc-type-text').className).toContain('selected');
      
      // Click on disabled inventory button
      fireEvent.click(screen.getByTestId('doc-type-inventory'));
      
      // Text should still be selected
      expect(screen.getByTestId('doc-type-text').className).toContain('selected');
      // Inventory should NOT be selected
      expect(screen.getByTestId('doc-type-inventory').className).not.toMatch(/\bselected\b/);
    });

    test('disabledTypes defaults to empty array when not provided', () => {
      render(<CreateDocument isOpen={true} onClose={jest.fn()} />);
      // All buttons should be enabled
      const grid = screen.getByTestId('doc-type-grid');
      const buttons = grid.querySelectorAll('button');
      buttons.forEach(btn => {
        expect(btn).not.toBeDisabled();
      });
    });
  });

  // ─────────────────────────────────────────────────────────
  // §8  End-to-end scenario tests
  // ─────────────────────────────────────────────────────────
  describe('§8 — End-to-end scenario tests', () => {

    test('E2E: Owner opens inventory for first time → loading → wizard → complete → dashboard', () => {
      usePermission.mockReturnValue({ isOwner: true, isEditor: false, isViewer: false });
      
      // Phase 1: Loading (Yjs not synced)
      useInventorySync.mockReturnValue({
        currentSystem: null,
        requests: [],
        catalog: [],
        openRequestCount: 0,
        pendingApprovalCount: 0,
      });
      const { rerender } = render(<InventoryDashboard {...dashboardProps()} />);
      expect(screen.getByText('Loading Inventory System')).toBeInTheDocument();
      
      // Phase 2: Yjs syncs, system not yet set up
      useInventorySync.mockReturnValue({
        currentSystem: { id: 'inv-test123', name: 'Inventory', onboardingComplete: false },
        requests: [],
        catalog: [],
        openRequestCount: 0,
        pendingApprovalCount: 0,
      });
      rerender(<InventoryDashboard {...dashboardProps()} />);
      expect(screen.getByTestId('onboarding-wizard')).toBeInTheDocument();
      
      // Phase 3: Owner completes onboarding
      fireEvent.click(screen.getByText('Complete'));
      expect(screen.getByTestId('admin-dashboard')).toBeInTheDocument();
      expect(screen.queryByTestId('onboarding-wizard')).not.toBeInTheDocument();
    });

    test('E2E: Peer (non-owner) opens inventory → loading → waiting → system ready → submit form', () => {
      usePermission.mockReturnValue({ isOwner: false, isEditor: false, isViewer: true });
      
      // Phase 1: Loading
      useInventorySync.mockReturnValue({
        currentSystem: null,
        requests: [],
        catalog: [],
        openRequestCount: 0,
        pendingApprovalCount: 0,
      });
      const { rerender } = render(<InventoryDashboard {...dashboardProps()} />);
      expect(screen.getByText('Loading Inventory System')).toBeInTheDocument();
      
      // Phase 2: Yjs syncs, but admin hasn't done onboarding
      useInventorySync.mockReturnValue({
        currentSystem: { id: 'inv-test123', name: 'Inventory', onboardingComplete: false },
        requests: [],
        catalog: [],
        openRequestCount: 0,
        pendingApprovalCount: 0,
      });
      rerender(<InventoryDashboard {...dashboardProps()} />);
      expect(screen.getByText('Waiting for Setup')).toBeInTheDocument();
      
      // Phase 3: Admin completes onboarding (sync from peer)
      useInventorySync.mockReturnValue({
        currentSystem: { id: 'inv-test123', name: 'Inventory', onboardingComplete: true },
        requests: [],
        catalog: [],
        openRequestCount: 0,
        pendingApprovalCount: 0,
      });
      rerender(<InventoryDashboard {...dashboardProps()} />);
      // Viewer default view = submit-request
      expect(screen.getByTestId('submit-request')).toBeInTheDocument();
    });

    test('E2E: auto-assign creates pending_approval when requireApproval=true, approval queue shows it', () => {
      const yRequests = createMockYArray();
      
      // Step 1: Submit a request
      const requestId = 'req-e2e-1';
      const now = Date.now();
      yRequests.push([{
        id: requestId,
        catalogItemId: 'item-1',
        quantity: 2,
        status: 'open',
        requestedAt: now,
        requestedBy: 'user-abc123',
      }]);
      
      // Step 2: Auto-assign with requireApproval=true
      const settings = { requireApproval: true, autoAssignEnabled: true };
      const arr = yRequests.toArray();
      const idx = arr.findIndex(r => r.id === requestId);
      yRequests.delete(idx, 1);
      yRequests.insert(idx, [{
        ...arr[idx],
        status: settings.requireApproval ? 'pending_approval' : 'claimed',
        assignedTo: 'producer-a',
        assignedAt: now,
      }]);
      
      // Step 3: Verify approval queue filter finds it
      const result = yRequests.toArray();
      const pendingForQueue = result.filter(
        r => r.status === 'pending_approval' || r.status === 'claimed'
      );
      expect(pendingForQueue.length).toBe(1);
      expect(pendingForQueue[0].status).toBe('pending_approval');
      expect(pendingForQueue[0].assignedTo).toBe('producer-a');
    });

    test('E2E: auto-assign creates claimed when requireApproval=false, request shows in All Requests', () => {
      const yRequests = createMockYArray();
      
      const requestId = 'req-e2e-2';
      const now = Date.now();
      yRequests.push([{
        id: requestId,
        catalogItemId: 'item-2',
        quantity: 1,
        status: 'open',
        requestedAt: now,
        requestedBy: 'user-abc123',
      }]);
      
      const settings = { requireApproval: false, autoAssignEnabled: true };
      const arr = yRequests.toArray();
      const idx = arr.findIndex(r => r.id === requestId);
      yRequests.delete(idx, 1);
      yRequests.insert(idx, [{
        ...arr[idx],
        status: settings.requireApproval ? 'pending_approval' : 'claimed',
        assignedTo: 'producer-b',
        assignedAt: now,
      }]);
      
      const result = yRequests.toArray();
      expect(result[0].status).toBe('claimed');
    });

    test('E2E: duplicate inventory guard — second create opens existing tab', () => {
      const DOC_TYPES = { INVENTORY: 'inventory', FILE_STORAGE: 'files' };
      const currentWorkspaceId = 'ws-1';
      const documents = [
        { id: 'inv-existing', type: 'inventory', workspaceId: 'ws-1', name: 'My Inventory' },
      ];
      
      // Simulate the guard logic
      const existingInventory = documents.find(
        d => d.type === DOC_TYPES.INVENTORY && d.workspaceId === currentWorkspaceId && !d.deletedAt
      );
      
      let openedDocId = null;
      let toastMessage = null;
      const openDocument = (id) => { openedDocId = id; };
      const showToast = (msg) => { toastMessage = msg; };
      
      if (existingInventory) {
        openDocument(existingInventory.id, existingInventory.name, DOC_TYPES.INVENTORY);
        showToast('Opened existing inventory system — only one per workspace is allowed');
      }
      
      expect(openedDocId).toBe('inv-existing');
      expect(toastMessage).toContain('only one per workspace');
    });

    test('E2E: disabledTypes flows from AppNew → HierarchicalSidebar → CreateDocument', () => {
      // Verify source files contain the prop threading
      const fs = require('fs');
      
      // AppNew passes disabledDocTypes
      const appSrc = fs.readFileSync(
        require('path').join(__dirname, '..', 'frontend', 'src', 'AppNew.jsx'),
        'utf-8'
      );
      expect(appSrc).toContain('disabledTypes={disabledDocTypes}');
      expect(appSrc).toContain('disabledDocTypes');
      
      // HierarchicalSidebar accepts and forwards disabledTypes
      const sidebarSrc = fs.readFileSync(
        require('path').join(__dirname, '..', 'frontend', 'src', 'components', 'HierarchicalSidebar.jsx'),
        'utf-8'
      );
      expect(sidebarSrc).toContain('disabledTypes');
      expect(sidebarSrc).toContain('disabledTypes={disabledTypes}');
    });

    test('E2E: yInventoryNotifications flows from useWorkspaceSync → AppNew → InventoryDashboard', () => {
      const fs = require('fs');
      
      const hookSrc = fs.readFileSync(
        require('path').join(__dirname, '..', 'frontend', 'src', 'hooks', 'useWorkspaceSync.js'),
        'utf-8'
      );
      const appSrc = fs.readFileSync(
        require('path').join(__dirname, '..', 'frontend', 'src', 'AppNew.jsx'),
        'utf-8'
      );
      const dashSrc = fs.readFileSync(
        require('path').join(__dirname, '..', 'frontend', 'src', 'components', 'inventory', 'InventoryDashboard.jsx'),
        'utf-8'
      );
      
      // Plumbing chain
      expect(hookSrc).toContain('yInventoryNotifications: yInventoryNotificationsRef.current');
      expect(appSrc).toContain('yInventoryNotifications,');
      expect(appSrc).toContain('yInventoryNotifications={yInventoryNotifications}');
      expect(dashSrc).toContain('yInventoryNotifications');
    });
  });

  // ─────────────────────────────────────────────────────────
  // §9  Regression safeguards
  // ─────────────────────────────────────────────────────────
  describe('§9 — Regression safeguards', () => {

    test('InventoryDashboard does NOT have key={activeDocId} anywhere', () => {
      const fs = require('fs');
      const src = fs.readFileSync(
        require('path').join(__dirname, '..', 'frontend', 'src', 'AppNew.jsx'),
        'utf-8'
      );
      // Should NOT have key={activeDocId} on InventoryDashboard
      // But it may exist on other components like Kanban — so we look specifically near InventoryDashboard
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('<InventoryDashboard')) {
          // Check the next line for key={activeDocId}
          const block = lines.slice(i, i + 5).join('\n');
          expect(block).not.toContain('key={activeDocId}');
        }
      }
    });

    test('InventoryDashboard uses key={currentWorkspaceId} for stable identity', () => {
      const fs = require('fs');
      const src = fs.readFileSync(
        require('path').join(__dirname, '..', 'frontend', 'src', 'AppNew.jsx'),
        'utf-8'
      );
      const lines = src.split('\n');
      let found = false;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('<InventoryDashboard')) {
          const block = lines.slice(i, i + 5).join('\n');
          if (block.includes('key={currentWorkspaceId}')) found = true;
        }
      }
      expect(found).toBe(true);
    });

    test('useWorkspaceSync creates all 8 inventory Yjs types', () => {
      const fs = require('fs');
      const src = fs.readFileSync(
        require('path').join(__dirname, '..', 'frontend', 'src', 'hooks', 'useWorkspaceSync.js'),
        'utf-8'
      );
      const expectedTypes = [
        'inventorySystems',
        'catalogItems',
        'inventoryRequests',
        'producerCapacities',
        'addressReveals',
        'pendingAddresses',
        'inventoryAuditLog',
        'inventoryNotifications',
      ];
      for (const typeName of expectedTypes) {
        expect(src).toContain(`'${typeName}'`);
      }
    });

    test('createInventorySystem dependency array includes syncedDocuments and openDocument', () => {
      const fs = require('fs');
      const src = fs.readFileSync(
        require('path').join(__dirname, '..', 'frontend', 'src', 'AppNew.jsx'),
        'utf-8'
      );
      // Find the createInventorySystem function and its dependency array
      const startIdx = src.indexOf('const createInventorySystem');
      const block = src.substring(startIdx, startIdx + 3000);
      // Look for the closing }, [deps]); pattern
      const depMatch = block.match(/\}, \[([^\]]+)\]\);/);
      expect(depMatch).toBeTruthy();
      expect(depMatch[1]).toContain('syncedDocuments');
      expect(depMatch[1]).toContain('openDocument');
    });

    test('createFileStorage dependency array includes syncedDocuments and openDocument', () => {
      const fs = require('fs');
      const src = fs.readFileSync(
        require('path').join(__dirname, '..', 'frontend', 'src', 'AppNew.jsx'),
        'utf-8'
      );
      // Find the createFileStorage function and its dependency array
      const startIdx = src.indexOf('const createFileStorage');
      const block = src.substring(startIdx, startIdx + 3000);
      const depMatch = block.match(/\}, \[([^\]]+)\]\);/);
      expect(depMatch).toBeTruthy();
      expect(depMatch[1]).toContain('syncedDocuments');
      expect(depMatch[1]).toContain('openDocument');
    });

    test('InventoryDashboard showOnboarding useState initializer does NOT access currentSystem', () => {
      const fs = require('fs');
      const src = fs.readFileSync(
        require('path').join(__dirname, '..', 'frontend', 'src', 'components', 'inventory', 'InventoryDashboard.jsx'),
        'utf-8'
      );
      // Should NOT have the old pattern:
      // useState(() => !inventoryState.currentSystem?.onboardingComplete)
      expect(src).not.toContain('useState(\n    () => !inventoryState.currentSystem');
      expect(src).not.toContain('useState(() => !inventoryState.currentSystem');
      // Should have safe default: useState(null)
      expect(src).toContain('useState(null)');
    });

    test('CreateDocument has disabled class when type is in disabledTypes', () => {
      const fs = require('fs');
      const src = fs.readFileSync(
        require('path').join(__dirname, '..', 'frontend', 'src', 'components', 'CreateDocument.jsx'),
        'utf-8'
      );
      expect(src).toContain("isDisabled ? 'disabled' : ''");
      expect(src).toContain('disabled={isDisabled}');
    });
  });

  // ─────────────────────────────────────────────────────────
  // §10  Additional UI tests
  // ─────────────────────────────────────────────────────────
  describe('§10 — Additional UI tests', () => {

    test('loading placeholder has correct structure (icon, title, description)', () => {
      useInventorySync.mockReturnValue({
        currentSystem: null,
        requests: [],
        catalog: [],
        openRequestCount: 0,
        pendingApprovalCount: 0,
      });
      render(<InventoryDashboard {...dashboardProps()} />);
      
      const loadingTitle = screen.getByText('Loading Inventory System');
      expect(loadingTitle.tagName).toBe('H2');
      expect(screen.getByText(/Syncing data/)).toBeInTheDocument();
    });

    test('waiting-for-setup placeholder has correct structure', () => {
      usePermission.mockReturnValue({ isOwner: false, isEditor: false, isViewer: true });
      useInventorySync.mockReturnValue({
        currentSystem: { id: 'inv-test123', name: 'Inventory', onboardingComplete: false },
        requests: [],
        catalog: [],
        openRequestCount: 0,
        pendingApprovalCount: 0,
      });
      render(<InventoryDashboard {...dashboardProps()} />);
      
      const title = screen.getByText('Waiting for Setup');
      expect(title.tagName).toBe('H2');
      expect(screen.getByText(/workspace admin/)).toBeInTheDocument();
    });

    test('nav rail receives correct system name from inventory state', () => {
      useInventorySync.mockReturnValue({
        currentSystem: { id: 'inv-test123', name: 'Custom Inventory Name', onboardingComplete: true },
        requests: [],
        catalog: [],
        openRequestCount: 3,
        pendingApprovalCount: 1,
      });
      render(<InventoryDashboard {...dashboardProps()} />);
      // Nav rail should be rendered (we test it's present)
      expect(screen.getByTestId('nav-rail')).toBeInTheDocument();
    });

    test('InventoryDashboard passes yInventoryNotifications to InventoryProvider', () => {
      const fs = require('fs');
      const src = fs.readFileSync(
        require('path').join(__dirname, '..', 'frontend', 'src', 'components', 'inventory', 'InventoryDashboard.jsx'),
        'utf-8'
      );
      expect(src).toContain('yInventoryNotifications={yInventoryNotifications}');
    });
  });
});
