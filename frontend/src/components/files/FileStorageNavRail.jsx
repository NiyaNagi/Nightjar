/**
 * FileStorageNavRail
 * 
 * Vertical navigation sidebar for the file storage dashboard.
 * Role-based nav items, following InventoryNavRail pattern exactly.
 * 
 * See docs/FILE_STORAGE_SPEC.md §5
 */

import { useMemo } from 'react';
import './FileStorageNavRail.css';

// View IDs – must match FileStorageDashboard VIEWS keys
export const FILE_VIEWS = {
  BROWSE: 'browse',
  RECENT: 'recent',
  DOWNLOADS: 'downloads',
  FAVORITES: 'favorites',
  TRASH: 'trash',
  AUDIT_LOG: 'audit_log',
  STORAGE: 'storage',
  MESH: 'mesh',
  SETTINGS: 'settings',
};

// Nav structure for admin / owner
const ADMIN_NAV = [
  { id: FILE_VIEWS.BROWSE, label: 'Browse', icon: '📁' },
  { id: FILE_VIEWS.RECENT, label: 'Recent', icon: '🕑' },
  { id: FILE_VIEWS.DOWNLOADS, label: 'Downloads', icon: '⬇️' },
  { id: FILE_VIEWS.FAVORITES, label: 'Favorites', icon: '⭐' },
  { id: FILE_VIEWS.TRASH, label: 'Trash', icon: '🗑️' },
  { divider: true },
  { id: FILE_VIEWS.AUDIT_LOG, label: 'Audit Log', icon: '📜' },
  { id: FILE_VIEWS.STORAGE, label: 'Storage', icon: '📊' },  { id: FILE_VIEWS.MESH, label: 'Mesh', icon: '🌐' },  { id: FILE_VIEWS.SETTINGS, label: 'Settings', icon: '⚙️' },
];

// Non-admin (collaborator) – no settings, audit, or storage
const COLLABORATOR_NAV = [
  { id: FILE_VIEWS.BROWSE, label: 'Browse', icon: '📁' },
  { id: FILE_VIEWS.RECENT, label: 'Recent', icon: '🕑' },
  { id: FILE_VIEWS.DOWNLOADS, label: 'Downloads', icon: '⬇️' },
  { id: FILE_VIEWS.FAVORITES, label: 'Favorites', icon: '⭐' },
  { id: FILE_VIEWS.TRASH, label: 'Trash', icon: '🗑️' },
];

// Read-only nav (viewers)
const VIEWER_NAV = [
  { id: FILE_VIEWS.BROWSE, label: 'Browse', icon: '📁' },
  { id: FILE_VIEWS.RECENT, label: 'Recent', icon: '🕑' },
  { id: FILE_VIEWS.DOWNLOADS, label: 'Downloads', icon: '⬇️' },
  { id: FILE_VIEWS.FAVORITES, label: 'Favorites', icon: '⭐' },
];

function NavItem({ item, isActive, onClick, badge }) {
  if (item.divider) {
    return <div className="file-storage-nav-divider" />;
  }

  return (
    <button
      className={`file-storage-nav-item ${isActive ? 'active' : ''}`}
      onClick={() => onClick(item.id)}
      title={item.label}
      data-testid={`fs-nav-${item.id}`}
    >
      {isActive && <div className="file-storage-nav-active-bar" />}
      <span className="file-storage-nav-icon">{item.icon}</span>
      <span className="file-storage-nav-label">{item.label}</span>
      {badge != null && badge > 0 && (
        <span className="file-storage-nav-badge">{badge > 99 ? '99+' : badge}</span>
      )}
    </button>
  );
}

export default function FileStorageNavRail({
  activeView,
  onViewChange,
  role = 'admin',
  trashedCount = 0,
  downloadingCount = 0,
  favoriteCount = 0,
}) {
  const navItems = useMemo(() => {
    if (role === 'admin' || role === 'owner') return ADMIN_NAV;
    if (role === 'viewer') return VIEWER_NAV;
    return COLLABORATOR_NAV;
  }, [role]);

  const getBadge = (viewId) => {
    switch (viewId) {
      case FILE_VIEWS.TRASH: return trashedCount;
      case FILE_VIEWS.DOWNLOADS: return downloadingCount;
      case FILE_VIEWS.FAVORITES: return favoriteCount;
      default: return null;
    }
  };

  return (
    <nav className="file-storage-nav-rail" data-testid="fs-nav-rail">
      <div className="file-storage-nav-header">
        <span className="file-storage-nav-header-icon">📂</span>
        <span className="file-storage-nav-header-label">Files</span>
      </div>
      <div className="file-storage-nav-items">
        {navItems.map((item, index) => (
          <NavItem
            key={item.id || `divider-${index}`}
            item={item}
            isActive={activeView === item.id}
            onClick={onViewChange}
            badge={getBadge(item.id)}
          />
        ))}
      </div>
    </nav>
  );
}
