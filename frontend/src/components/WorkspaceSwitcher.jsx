/**
 * WorkspaceSwitcher Component
 * 
 * Dropdown at top of sidebar for switching between workspaces.
 * Shows current workspace name + settings gear.
 * Lists all available workspaces.
 * Options to create new or join via link.
 */

import React, { useState, useRef, useEffect } from 'react';
import { useWorkspaces } from '../contexts/WorkspaceContext';
import { usePermissions } from '../contexts/PermissionContext';
import { ensureContrastWithWhite } from '../utils/colorUtils';
import './WorkspaceSwitcher.css';

// Permission badges
const PERMISSION_BADGES = {
  owner: { label: 'Owner', color: '#059669' },
  editor: { label: 'Editor', color: '#2563eb' },
  viewer: { label: 'Viewer', color: '#4b5563' },
};

export default function WorkspaceSwitcher({ onOpenSettings, onCreateWorkspace, onJoinWorkspace }) {
  const { workspaces, currentWorkspace, switchWorkspace, hasWorkspaces, deleteWorkspace } = useWorkspaces();
  const [isOpen, setIsOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const dropdownRef = useRef(null);
  
  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  // Handle keyboard navigation
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };
  
  if (!hasWorkspaces) {
    // Empty state - show create/join buttons
    return (
      <div className="workspace-switcher workspace-switcher--empty">
        <div className="workspace-switcher__empty-state">
          <span className="workspace-switcher__empty-icon">📁</span>
          <span className="workspace-switcher__empty-text">No workspaces yet</span>
        </div>
        <div className="workspace-switcher__empty-actions">
          <button 
            className="workspace-switcher__action-btn workspace-switcher__action-btn--primary"
            onClick={onCreateWorkspace}
            data-testid="create-workspace-btn"
          >
            <span className="workspace-switcher__action-icon">+</span>
            Create Workspace
          </button>
          <button 
            className="workspace-switcher__action-btn"
            onClick={onJoinWorkspace}
            data-testid="join-workspace-btn"
          >
            <span className="workspace-switcher__action-icon">🔗</span>
            Join via Link
          </button>
        </div>
      </div>
    );
  }
  
  return (
    <div className="workspace-switcher" ref={dropdownRef} onKeyDown={handleKeyDown}>
      {/* Current workspace button */}
      <button 
        className="workspace-switcher__trigger"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        data-testid="workspace-selector"
        style={{
          background: currentWorkspace?.color 
            ? ensureContrastWithWhite(currentWorkspace.color, 0.3)
            : undefined,
          ...(currentWorkspace?.color ? { color: '#ffffff' } : {})
        }}
      >
        <div className="workspace-switcher__current">
          <span className="workspace-switcher__icon">
            {currentWorkspace?.icon || '📁'}
          </span>
          <span className="workspace-switcher__name">
            {currentWorkspace?.name || 'Select Workspace'}
          </span>
          {currentWorkspace?.myPermission && (
            <span 
              className="workspace-switcher__badge"
              style={{ backgroundColor: PERMISSION_BADGES[currentWorkspace.myPermission]?.color }}
            >
              {PERMISSION_BADGES[currentWorkspace.myPermission]?.label}
            </span>
          )}
        </div>
        <span className={`workspace-switcher__chevron ${isOpen ? 'workspace-switcher__chevron--open' : ''}`}>
          ▼
        </span>
      </button>
      
      {/* Settings gear button - ALWAYS visible in header when workspace selected */}
      {currentWorkspace && (
        <button 
          className="workspace-switcher__settings"
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(false);
            onOpenSettings?.(currentWorkspace);
          }}
          title="Workspace Settings"
          aria-label="Open workspace settings"
          data-testid="workspace-settings-btn"
        >
          ⚙️
        </button>
      )}
      
      {/* Dropdown menu */}
      {isOpen && (
        <div className="workspace-switcher__dropdown" role="listbox">
          <div className="workspace-switcher__section">
            <div className="workspace-switcher__section-title">Your Workspaces</div>
            {workspaces.map(workspace => (
              <button
                key={workspace.id}
                className={`workspace-switcher__item ${
                  workspace.id === currentWorkspace?.id ? 'workspace-switcher__item--active' : ''
                }`}
                onClick={() => {
                  switchWorkspace(workspace.id);
                  setIsOpen(false);
                }}
                role="option"
                aria-selected={workspace.id === currentWorkspace?.id}
                data-testid={`workspace-option-${workspace.name.replace(/\s+/g, '-')}`}
                style={{
                  background: workspace.color 
                    ? ensureContrastWithWhite(workspace.color, 0.2)
                    : undefined,
                  ...(workspace.color ? { color: '#ffffff' } : {})
                }}
              >
                <span className="workspace-switcher__item-icon">
                  {workspace.icon || '📁'}
                </span>
                <span className="workspace-switcher__item-name">
                  {workspace.name}
                </span>
                <span 
                  className="workspace-switcher__item-badge"
                  style={{ backgroundColor: PERMISSION_BADGES[workspace.myPermission]?.color }}
                >
                  {PERMISSION_BADGES[workspace.myPermission]?.label}
                </span>
                {workspace.id === currentWorkspace?.id && (
                  <span className="workspace-switcher__item-check">✓</span>
                )}
              </button>
            ))}
          </div>
          
          <div className="workspace-switcher__divider" />
          
          <div className="workspace-switcher__actions">
            <button 
              className="workspace-switcher__action"
              onClick={() => {
                setIsOpen(false);
                onCreateWorkspace?.();
              }}
              data-testid="dropdown-create-workspace-btn"
            >
              <span className="workspace-switcher__action-icon">+</span>
              Create New Workspace
            </button>
            <button 
              className="workspace-switcher__action"
              onClick={() => {
                setIsOpen(false);
                onJoinWorkspace?.();
              }}
              data-testid="dropdown-join-workspace-btn"
            >
              <span className="workspace-switcher__action-icon">🔗</span>
              Join via Link
            </button>
            
            {/* Delete current workspace - only for owners */}
            {currentWorkspace?.myPermission === 'owner' && (
              <>
                <div className="workspace-switcher__divider" />
                <button 
                  className="workspace-switcher__action workspace-switcher__action--danger"
                  onClick={() => setShowDeleteConfirm(currentWorkspace.id)}
                >
                  <span className="workspace-switcher__action-icon">🗑️</span>
                  Delete Workspace
                </button>
              </>
            )}
          </div>
        </div>
      )}
      
      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div className="workspace-switcher__confirm-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="workspace-switcher__confirm-dialog" onClick={e => e.stopPropagation()}>
            <h3>Delete Workspace?</h3>
            <p>
              This will permanently delete <strong>{workspaces.find(w => w.id === showDeleteConfirm)?.name}</strong> and all its documents.
              This action cannot be undone.
            </p>
            <div className="workspace-switcher__confirm-actions">
              <button 
                className="workspace-switcher__confirm-btn workspace-switcher__confirm-btn--cancel"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </button>
              <button 
                className="workspace-switcher__confirm-btn workspace-switcher__confirm-btn--delete"
                onClick={async () => {
                  if (showDeleteConfirm) {
                    await deleteWorkspace(showDeleteConfirm);
                    setShowDeleteConfirm(false);
                    setIsOpen(false);
                  }
                }}
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
