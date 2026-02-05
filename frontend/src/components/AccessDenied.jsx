/**
 * AccessDenied Component
 * 
 * Displayed when user tries to access content they don't have permission for.
 */

import React from 'react';
import './AccessDenied.css';

const PERMISSION_MESSAGES = {
  view: 'You do not have permission to view this content.',
  edit: 'You do not have permission to edit this content.',
  create: 'You do not have permission to create content here.',
  delete: 'You do not have permission to delete this content.',
  share: 'You do not have permission to share this content.',
};

export default function AccessDenied({ 
  action = 'view',
  entityType = 'content',
  entityName,
  onGoBack,
  onRequestAccess,
}) {
  const message = PERMISSION_MESSAGES[action] || PERMISSION_MESSAGES.view;
  
  return (
    <div className="access-denied">
      <div className="access-denied__content">
        <div className="access-denied__icon">🔒</div>
        <h2 className="access-denied__title">Access Denied</h2>
        <p className="access-denied__message">{message}</p>
        
        {entityName && (
          <p className="access-denied__entity">
            <span className="access-denied__entity-type">{entityType}:</span>
            <span className="access-denied__entity-name">{entityName}</span>
          </p>
        )}
        
        <div className="access-denied__actions">
          {onGoBack && (
            <button 
              type="button"
              className="access-denied__btn access-denied__btn--primary"
              onClick={onGoBack}
            >
              ← Go Back
            </button>
          )}
          {onRequestAccess && (
            <button 
              type="button"
              className="access-denied__btn access-denied__btn--secondary"
              onClick={onRequestAccess}
            >
              Request Access
            </button>
          )}
        </div>
        
        <p className="access-denied__help">
          If you believe you should have access, ask the owner to share a link with you.
        </p>
      </div>
    </div>
  );
}

/**
 * Inline access denied message (for use within components)
 */
export function AccessDeniedInline({ action = 'view', message }) {
  return (
    <div className="access-denied-inline">
      <span className="access-denied-inline__icon">🔒</span>
      <span className="access-denied-inline__text">
        {message || PERMISSION_MESSAGES[action] || 'Access denied'}
      </span>
    </div>
  );
}
