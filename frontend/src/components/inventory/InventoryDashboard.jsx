/**
 * InventoryDashboard
 * 
 * Shell component: wraps children in InventoryProvider, renders nav rail + content router.
 * Receives workspace-level Yjs shared types from AppNew.jsx and passes them into
 * InventoryProvider so all child components can call useInventory().
 * 
 * See docs/INVENTORY_SYSTEM_SPEC.md §11.2.5, §6.8
 */

import React, { useState, useCallback, useEffect } from 'react';
import { InventoryProvider, useInventory } from '../../contexts/InventoryContext';
import { useInventorySync } from '../../hooks/useInventorySync';
import { getUnreadCount } from '../../utils/inventoryNotifications';
import { usePermission } from '../../hooks/usePermission';
import InventoryNavRail from './InventoryNavRail';
import OnboardingWizard from './OnboardingWizard';
import AdminDashboard from './admin/AdminDashboard';
import AllRequests from './admin/AllRequests';
import CatalogManager from './admin/CatalogManager';
import SubmitRequest from './requestor/SubmitRequest';
import MyRequests from './requestor/MyRequests';
import SavedAddresses from './requestor/SavedAddresses';
import ApprovalQueue from './admin/ApprovalQueue';
import InventorySettings from './admin/InventorySettings';
import ProducerDashboard from './producer/ProducerDashboard';
import OpenRequests from './producer/OpenRequests';
import ProducerMyRequests from './producer/MyRequests';
import ProducerStats from './producer/ProducerStats';
import AnalyticsDashboard from './analytics/AnalyticsDashboard';
import USHeatmap from './analytics/USHeatmap';
import ImportWizard from './import/ImportWizard';
import AuditLog from './admin/AuditLog';
import ProducerManagement from './admin/ProducerManagement';
import ProducerNameMapper from './admin/ProducerNameMapper';
import RequestFAQ from './requestor/RequestFAQ';
import NotificationInbox from './common/NotificationInbox';
import './InventoryDashboard.css';

// Navigation view IDs — maps to component hierarchy in §6.8
const VIEWS = {
  // Admin views
  ADMIN_DASHBOARD: 'admin-dashboard',
  ALL_REQUESTS: 'all-requests',
  APPROVAL_QUEUE: 'approval-queue',
  PRODUCERS: 'producers',
  CATALOG: 'catalog',
  ANALYTICS: 'analytics',
  HEATMAP: 'heatmap',
  AUDIT_LOG: 'audit-log',
  IMPORT_EXPORT: 'import-export',
  SETTINGS: 'settings',
  NAME_MAPPER: 'name-mapper',
  // Producer views
  PRODUCER_DASHBOARD: 'producer-dashboard',
  OPEN_REQUESTS: 'open-requests',
  PRODUCER_MY_REQUESTS: 'producer-my-requests',
  PRODUCER_STATS: 'producer-stats',
  // Requestor views
  SUBMIT_REQUEST: 'submit-request',
  MY_REQUESTS: 'my-requests',
  SAVED_ADDRESSES: 'saved-addresses',
  NOTIFICATIONS: 'notifications',
  FAQ: 'faq',
};

/**
 * @param {Object} props
 * @param {string} props.inventorySystemId
 * @param {string} props.workspaceId
 * @param {Object} props.userIdentity - { publicKeyBase62, ... }
 * @param {Array} props.collaborators
 * @param {Y.Map} props.yInventorySystems
 * @param {Y.Array} props.yCatalogItems
 * @param {Y.Array} props.yInventoryRequests
 * @param {Y.Map} props.yProducerCapacities
 * @param {Y.Map} props.yAddressReveals
 * @param {Y.Map} props.yPendingAddresses
 * @param {Y.Array} props.yInventoryAuditLog
 * @param {Y.Array} props.yInventoryNotifications
 */
export default function InventoryDashboard({
  inventorySystemId,
  workspaceId,
  userIdentity,
  collaborators,
  currentWorkspace,
  yInventorySystems,
  yCatalogItems,
  yInventoryRequests,
  yProducerCapacities,
  yAddressReveals,
  yPendingAddresses,
  yInventoryAuditLog,
  yInventoryNotifications,
  onStartChatWith,
}) {
  // Permission check — spec §11.2.5: use usePermission('workspace', workspaceId)
  const { isOwner, isEditor, isViewer } = usePermission('workspace', workspaceId);

  // Sync Yjs → React state
  const inventoryState = useInventorySync(
    {
      yInventorySystems,
      yCatalogItems,
      yInventoryRequests,
      yProducerCapacities,
      yAddressReveals,
      yPendingAddresses,
      yInventoryAuditLog,
    },
    inventorySystemId
  );

  // Notification unread count — observe Yjs array for live updates
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  useEffect(() => {
    if (!yInventoryNotifications) { setNotificationUnreadCount(0); return; }
    const computeCount = () => {
      const all = yInventoryNotifications.toArray();
      setNotificationUnreadCount(getUnreadCount(all, userIdentity?.publicKeyBase62, inventorySystemId));
    };
    computeCount();
    yInventoryNotifications.observe(computeCount);
    return () => yInventoryNotifications.unobserve(computeCount);
  }, [yInventoryNotifications, userIdentity, inventorySystemId]);

  // Determine default view based on role
  const getDefaultView = useCallback(() => {
    if (isOwner) return VIEWS.ADMIN_DASHBOARD;
    if (isEditor) return VIEWS.PRODUCER_DASHBOARD;
    return VIEWS.SUBMIT_REQUEST;
  }, [isOwner, isEditor]);

  const [activeView, setActiveView] = useState(getDefaultView);
  // showOnboarding: null = still loading (Yjs hasn't synced yet),
  //                 true = system exists but onboarding not complete,
  //                 false = onboarding finished or system not yet created
  const [showOnboarding, setShowOnboarding] = useState(null);

  // Watch Yjs sync — once currentSystem loads, decide whether to show onboarding.
  // This replaces the buggy useState initializer that always saw null on first render.
  useEffect(() => {
    const sys = inventoryState.currentSystem;
    if (sys === undefined || sys === null) {
      // Yjs hasn't synced this system yet — stay in loading state
      // But only if we haven't already resolved it (avoid flicker on remount)
      return;
    }
    setShowOnboarding(!sys.onboardingComplete);
  }, [inventoryState.currentSystem]);

  // After a brief delay, if we still haven't received system data, stop loading.
  // This handles the case where the system truly doesn't exist (non-owner view).
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowOnboarding(prev => prev === null ? false : prev);
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  // Content router — renders the active view component
  const renderContent = () => {
    // Loading state — Yjs data hasn't synced yet
    if (showOnboarding === null) {
      return (
        <div className="inventory-placeholder">
          <div className="inventory-placeholder__icon">⏳</div>
          <h2 className="inventory-placeholder__title">Loading Inventory System</h2>
          <p className="inventory-placeholder__description">Syncing data with peers…</p>
        </div>
      );
    }

    // System needs onboarding and user is the owner — show wizard
    if (showOnboarding && isOwner) {
      return <OnboardingWizard onComplete={() => setShowOnboarding(false)} />;
    }

    // System needs onboarding but user is NOT the owner — show waiting message
    if (showOnboarding && !isOwner) {
      return (
        <div className="inventory-placeholder">
          <div className="inventory-placeholder__icon">⏳</div>
          <h2 className="inventory-placeholder__title">Waiting for Setup</h2>
          <p className="inventory-placeholder__description">
            The workspace admin hasn't finished setting up the inventory system yet.
            Please check back shortly.
          </p>
        </div>
      );
    }

    switch (activeView) {
      // Admin views
      case VIEWS.ADMIN_DASHBOARD:
        return <AdminDashboard onNavigate={setActiveView} />;
      case VIEWS.ALL_REQUESTS:
        return <AllRequests />;
      case VIEWS.APPROVAL_QUEUE:
        return <ApprovalQueue />;
      case VIEWS.PRODUCERS:
        return <ProducerManagement />;
      case VIEWS.CATALOG:
        return <CatalogManager />;
      case VIEWS.ANALYTICS:
        return <AnalyticsDashboard />;
      case VIEWS.HEATMAP:
        return <USHeatmapView />;
      case VIEWS.AUDIT_LOG:
        return <AuditLog />;
      case VIEWS.IMPORT_EXPORT:
        return <ImportWizard />;
      case VIEWS.SETTINGS:
        return <InventorySettings />;
      case VIEWS.NAME_MAPPER:
        return <ProducerNameMapper />;

      // Producer views
      case VIEWS.PRODUCER_DASHBOARD:
        return <ProducerDashboard onNavigate={setActiveView} />;
      case VIEWS.OPEN_REQUESTS:
        return <OpenRequests />;
      case VIEWS.PRODUCER_MY_REQUESTS:
        return <ProducerMyRequests />;
      case VIEWS.PRODUCER_STATS:
        return <ProducerStats />;

      // Requestor views
      case VIEWS.SUBMIT_REQUEST:
        return <SubmitRequest currentWorkspace={currentWorkspace} isOwner={isOwner} />;
      case VIEWS.MY_REQUESTS:
        return <MyRequests />;
      case VIEWS.SAVED_ADDRESSES:
        return <SavedAddresses currentWorkspace={currentWorkspace} />;
      case VIEWS.NOTIFICATIONS:
        return <NotificationInbox />;
      case VIEWS.FAQ:
        return <RequestFAQ />;

      default:
        return <PlaceholderView icon="📦" title="Inventory" description="Select a view from the navigation" />;
    }
  };

  return (
    <InventoryProvider
      inventorySystemId={inventorySystemId}
      workspaceId={workspaceId}
      currentWorkspace={currentWorkspace}
      yInventorySystems={yInventorySystems}
      yCatalogItems={yCatalogItems}
      yInventoryRequests={yInventoryRequests}
      yProducerCapacities={yProducerCapacities}
      yAddressReveals={yAddressReveals}
      yPendingAddresses={yPendingAddresses}
      yInventoryAuditLog={yInventoryAuditLog}
      yInventoryNotifications={yInventoryNotifications}
      userIdentity={userIdentity}
      collaborators={collaborators}
      onStartChatWith={onStartChatWith}
    >
      <div className="inventory-dashboard">
        <InventoryNavRail
          activeView={activeView}
          onNavigate={setActiveView}
          isOwner={isOwner}
          isEditor={isEditor}
          isViewer={isViewer}
          systemName={inventoryState.currentSystem?.name || 'Inventory'}
          openRequestCount={inventoryState.openRequestCount}
          pendingApprovalCount={inventoryState.pendingApprovalCount}
          notificationUnreadCount={notificationUnreadCount}
        />
        <div className="inventory-content">
          {renderContent()}
        </div>
      </div>
    </InventoryProvider>
  );
}

/**
 * Standalone heatmap view — wraps USHeatmap with context data.
 */
function USHeatmapView() {
  const ctx = useInventory();
  const sync = useInventorySync(ctx, ctx.inventorySystemId);
  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <h2 style={{ color: 'var(--text-primary)', marginBottom: 16 }}>Geographic Heatmap</h2>
      <USHeatmap requests={sync.requests || []} dateRange={[0, Date.now()]} />
    </div>
  );
}

/**
 * Placeholder view — kept for any remaining unimplemented views.
 */
function PlaceholderView({ icon, title, description }) {
  return (
    <div className="inventory-placeholder">
      <div className="inventory-placeholder__icon">{icon}</div>
      <h2 className="inventory-placeholder__title">{title}</h2>
      <p className="inventory-placeholder__description">{description}</p>
      <p className="inventory-placeholder__coming-soon">Coming soon</p>
    </div>
  );
}

export { VIEWS };
