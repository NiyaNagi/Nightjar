/**
 * CollaboratorList Component
 * 
 * Displays list of collaborators for a workspace/folder/document.
 * Shows permission levels and online status.
 * Full transparency - everyone can see all collaborators.
 */

import React, { useState } from 'react';
import { usePermissions } from '../contexts/PermissionContext';
import ChatButton from './common/ChatButton';
import './CollaboratorList.css';

// Permission level config
const PERMISSION_CONFIG = {
  owner: {
    label: 'Owner',
    color: '#10b981',
    icon: '👑',
  },
  editor: {
    label: 'Editor',
    color: '#3b82f6',
    icon: '✏️',
  },
  viewer: {
    label: 'Viewer',
    color: '#6b7280',
    icon: '👁️',
  },
};

export default function CollaboratorList({ 
  collaborators = [], 
  entityType = 'workspace',
  entityId,
  compact = false,
  showOnlineOnly = false,
  maxDisplay = 0, // 0 = show all
  onStartChatWith,
  currentUserKey,
}) {
  const { isOwner, canShare } = usePermissions();
  const [expanded, setExpanded] = useState(false);
  
  // Filter collaborators
  let displayCollabs = [...collaborators];
  
  if (showOnlineOnly) {
    displayCollabs = displayCollabs.filter(c => c.isOnline);
  }
  
  // Sort: online first, then by permission level, then by name
  displayCollabs.sort((a, b) => {
    // Online first
    if (a.isOnline && !b.isOnline) return -1;
    if (!a.isOnline && b.isOnline) return 1;
    
    // Then by permission
    const permOrder = { owner: 0, editor: 1, viewer: 2 };
    const permDiff = (permOrder[a.permission] || 2) - (permOrder[b.permission] || 2);
    if (permDiff !== 0) return permDiff;
    
    // Then by name
    return (a.displayName || '').localeCompare(b.displayName || '');
  });
  
  // Limit display if needed
  const hasMore = maxDisplay > 0 && displayCollabs.length > maxDisplay && !expanded;
  const visibleCollabs = hasMore ? displayCollabs.slice(0, maxDisplay) : displayCollabs;
  const hiddenCount = displayCollabs.length - maxDisplay;
  
  if (displayCollabs.length === 0) {
    return (
      <div className="collaborator-list collaborator-list--empty">
        <span className="collaborator-list__empty-text">
          {showOnlineOnly ? 'No one else online' : 'No collaborators yet'}
        </span>
      </div>
    );
  }
  
  // Compact mode - just avatars
  if (compact) {
    return (
      <div className="collaborator-list collaborator-list--compact">
        <div className="collaborator-list__avatars">
          {visibleCollabs.map((collab, index) => (
            <div 
              key={collab.identityId || index}
              className={`collaborator-list__avatar ${collab.isOnline ? 'collaborator-list__avatar--online' : ''}`}
              style={{ 
                backgroundColor: collab.color || '#6b7280',
                zIndex: visibleCollabs.length - index
              }}
              title={`${collab.displayName || 'Anonymous'} (${PERMISSION_CONFIG[collab.permission]?.label || 'Viewer'})`}
            >
              {getInitials(collab.displayName)}
            </div>
          ))}
          {hasMore && (
            <button 
              type="button"
              className="collaborator-list__avatar collaborator-list__avatar--more"
              onClick={() => setExpanded(true)}
            >
              +{hiddenCount}
            </button>
          )}
        </div>
      </div>
    );
  }
  
  // Full list mode
  return (
    <div className="collaborator-list">
      <ul className="collaborator-list__items">
        {visibleCollabs.map((collab, index) => (
          <li 
            key={collab.identityId || index}
            className="collaborator-list__item"
          >
            <div 
              className={`collaborator-list__item-avatar ${collab.isOnline ? 'collaborator-list__item-avatar--online' : ''}`}
              style={{ backgroundColor: collab.color || '#6b7280' }}
            >
              {getInitials(collab.displayName)}
            </div>
            
            <div className="collaborator-list__item-info">
              <span className="collaborator-list__item-name">
                {collab.displayName || `User ${(collab.identityId || '').slice(0, 6)}`}
                {collab.isMe && <span className="collaborator-list__item-you">(you)</span>}
              </span>
              <ChatButton
                publicKey={collab.publicKey || collab.publicKeyBase62}
                currentUserKey={currentUserKey}
                collaborators={collaborators}
                onStartChatWith={onStartChatWith}
                size="small"
              />
              {collab.isOnline && (
                <span className="collaborator-list__item-status">Online</span>
              )}
            </div>
            
            <div 
              className="collaborator-list__item-badge"
              style={{ backgroundColor: PERMISSION_CONFIG[collab.permission]?.color }}
            >
              <span className="collaborator-list__item-badge-icon">
                {PERMISSION_CONFIG[collab.permission]?.icon}
              </span>
              <span className="collaborator-list__item-badge-label">
                {PERMISSION_CONFIG[collab.permission]?.label}
              </span>
            </div>
          </li>
        ))}
      </ul>
      
      {hasMore && (
        <button 
          type="button"
          className="collaborator-list__show-more"
          onClick={() => setExpanded(true)}
        >
          Show {hiddenCount} more
        </button>
      )}
      
      {expanded && maxDisplay > 0 && (
        <button 
          type="button"
          className="collaborator-list__show-less"
          onClick={() => setExpanded(false)}
        >
          Show less
        </button>
      )}
    </div>
  );
}

// Helper to get initials from display name
function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Online indicator component for the editor
export function OnlineCollaborators({ collaborators = [], currentUserId }) {
  const onlineOthers = collaborators.filter(c => 
    c.isOnline && c.identityId !== currentUserId
  );
  
  if (onlineOthers.length === 0) return null;
  
  return (
    <div className="online-collaborators">
      <span className="online-collaborators__label">
        {onlineOthers.length} other{onlineOthers.length > 1 ? 's' : ''} editing
      </span>
      <CollaboratorList 
        collaborators={onlineOthers}
        compact
        maxDisplay={5}
      />
    </div>
  );
}
