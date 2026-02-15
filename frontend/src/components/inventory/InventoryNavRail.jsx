/**
 * InventoryNavRail
 * 
 * Left navigation rail with role-based items.
 * Admins see all sections. Producers see producer views. Requestors see requestor views.
 * Admins also get a "I'm also a..." section for role-switching.
 * 
 * See docs/INVENTORY_SYSTEM_SPEC.md §6.3 (Navigation Rail)
 */

import React from 'react';
import './InventoryNavRail.css';

// View IDs matching InventoryDashboard VIEWS
const VIEWS = {
  // Admin
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
  // Producer
  PRODUCER_DASHBOARD: 'producer-dashboard',
  OPEN_REQUESTS: 'open-requests',
  PRODUCER_MY_REQUESTS: 'producer-my-requests',
  PRODUCER_STATS: 'producer-stats',
  // Requestor
  SUBMIT_REQUEST: 'submit-request',
  MY_REQUESTS: 'my-requests',
  FAQ: 'faq',
};

// Nav items by role — spec §6.3
const ADMIN_NAV = [
  { id: VIEWS.ADMIN_DASHBOARD, icon: '🏠', label: 'Dashboard' },
  { id: VIEWS.ALL_REQUESTS, icon: '📋', label: 'All Requests' },
  { id: VIEWS.APPROVAL_QUEUE, icon: '✅', label: 'Approval Queue', badgeKey: 'pendingApprovalCount' },
  { id: VIEWS.PRODUCERS, icon: '👥', label: 'Producers' },
  { id: VIEWS.CATALOG, icon: '📦', label: 'Item Catalog' },
  { id: VIEWS.ANALYTICS, icon: '📊', label: 'Analytics' },
  { id: VIEWS.HEATMAP, icon: '🗺️', label: 'Heatmap' },
  { id: VIEWS.AUDIT_LOG, icon: '📜', label: 'Audit Log' },
  { id: VIEWS.IMPORT_EXPORT, icon: '📥', label: 'Import/Export' },
  { id: VIEWS.SETTINGS, icon: '⚙️', label: 'Settings' },
];

const ADMIN_ROLE_SWITCH = [
  { id: VIEWS.SUBMIT_REQUEST, icon: '📝', label: 'Submit Request' },
  { id: VIEWS.MY_REQUESTS, icon: '📌', label: 'My Requests' },
  { id: VIEWS.PRODUCER_DASHBOARD, icon: '🏭', label: 'My Capacity' },
];

const PRODUCER_NAV = [
  { id: VIEWS.PRODUCER_DASHBOARD, icon: '🏭', label: 'My Dashboard' },
  { id: VIEWS.OPEN_REQUESTS, icon: '📋', label: 'Open Requests', badgeKey: 'openRequestCount' },
  { id: VIEWS.PRODUCER_MY_REQUESTS, icon: '📌', label: 'My Requests' },
  { id: VIEWS.PRODUCER_STATS, icon: '📊', label: 'My Stats' },
  { id: VIEWS.HEATMAP, icon: '🗺️', label: 'Heatmap' },
  { id: VIEWS.FAQ, icon: '❓', label: 'FAQ' },
];

const REQUESTOR_NAV = [
  { id: VIEWS.SUBMIT_REQUEST, icon: '📝', label: 'Submit Request' },
  { id: VIEWS.MY_REQUESTS, icon: '📜', label: 'My Requests' },
  { id: VIEWS.FAQ, icon: '❓', label: 'FAQ' },
];

/**
 * @param {Object} props
 * @param {string} props.activeView - Current active view ID
 * @param {Function} props.onNavigate - Called with view ID
 * @param {boolean} props.isOwner
 * @param {boolean} props.isEditor
 * @param {boolean} props.isViewer
 * @param {string} props.systemName - Inventory system name for header
 * @param {number} props.openRequestCount
 * @param {number} props.pendingApprovalCount
 */
export default function InventoryNavRail({
  activeView,
  onNavigate,
  isOwner,
  isEditor,
  isViewer,
  systemName,
  openRequestCount = 0,
  pendingApprovalCount = 0,
}) {
  const badges = {
    openRequestCount,
    pendingApprovalCount,
  };

  // Choose nav items based on role
  const navItems = isOwner ? ADMIN_NAV : isEditor ? PRODUCER_NAV : REQUESTOR_NAV;
  const showRoleSwitch = isOwner;

  return (
    <nav className="inventory-nav-rail" aria-label="Inventory navigation">
      {/* System name header */}
      <div className="inventory-nav-rail__header">
        <span className="inventory-nav-rail__icon">📦</span>
        <span className="inventory-nav-rail__title" title={systemName}>
          {systemName}
        </span>
      </div>

      {/* Divider */}
      <div className="inventory-nav-rail__divider" />

      {/* Main navigation */}
      <div className="inventory-nav-rail__items">
        {navItems.map(item => (
          <NavItem
            key={item.id}
            item={item}
            isActive={activeView === item.id}
            badge={item.badgeKey ? badges[item.badgeKey] : null}
            onClick={() => onNavigate(item.id)}
          />
        ))}
      </div>

      {/* Admin role-switch section */}
      {showRoleSwitch && (
        <>
          <div className="inventory-nav-rail__divider" />
          <div className="inventory-nav-rail__section-label">I'm also a...</div>
          <div className="inventory-nav-rail__items">
            {ADMIN_ROLE_SWITCH.map(item => (
              <NavItem
                key={item.id}
                item={item}
                isActive={activeView === item.id}
                badge={null}
                onClick={() => onNavigate(item.id)}
              />
            ))}
          </div>
        </>
      )}
    </nav>
  );
}

/**
 * Single nav item with optional badge
 */
function NavItem({ item, isActive, badge, onClick }) {
  return (
    <button
      className={`inventory-nav-item ${isActive ? 'inventory-nav-item--active' : ''}`}
      onClick={onClick}
      title={item.label}
      aria-current={isActive ? 'page' : undefined}
    >
      <span className="inventory-nav-item__icon">{item.icon}</span>
      <span className="inventory-nav-item__label">{item.label}</span>
      {badge != null && badge > 0 && (
        <span className="inventory-nav-item__badge">{badge > 99 ? '99+' : badge}</span>
      )}
    </button>
  );
}
