/**
 * EntityShareDialog Component
 * 
 * Extended share dialog that supports workspace/folder/document sharing
 * with permission levels (owner/editor/viewer).
 * 
 * This wraps/replaces ShareDialog for the new workspace system.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { generateShareLink } from '../../utils/sharing';
import { usePermissions } from '../../contexts/PermissionContext';
import { useCopyFeedback } from '../../hooks/useCopyFeedback';
import { isElectron } from '../../hooks/useEnvironment';
import QRCode from 'qrcode';
import './Share.css';

// Permission level info
const PERMISSION_OPTIONS = [
  { 
    value: 'viewer', 
    label: 'Viewer', 
    description: 'Can view but not edit',
    icon: '👁️',
    color: '#6b7280'
  },
  { 
    value: 'editor', 
    label: 'Editor', 
    description: 'Can view and edit content',
    icon: '✏️',
    color: '#3b82f6'
  },
  { 
    value: 'owner', 
    label: 'Owner', 
    description: 'Full access including delete',
    icon: '👑',
    color: '#10b981'
  },
];

// Entity type labels
const ENTITY_LABELS = {
  workspace: { label: 'Workspace', icon: '📁', description: 'Includes all folders and documents' },
  folder: { label: 'Folder', icon: '📂', description: 'Includes all documents inside' },
  document: { label: 'Document', icon: '📄', description: 'Single document access' },
};

/**
 * Entity Share Dialog
 */
export function EntityShareDialog({ 
  isOpen, 
  onClose, 
  entityType = 'document', // 'workspace' | 'folder' | 'document'
  entityId,
  entityName = 'Untitled',
  password, // Required for encryption
}) {
  const { getAvailableShareLevels, getPermission } = usePermissions();
  const { copied, copyToClipboard } = useCopyFeedback();
  
  const [selectedPermission, setSelectedPermission] = useState('viewer');
  const [shareLink, setShareLink] = useState('');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [includePassword, setIncludePassword] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [linkError, setLinkError] = useState('');
  
  // Reset state when the entity changes so stale data isn't shown
  useEffect(() => {
    setShareLink('');
    setQrCodeDataUrl('');
    setSelectedPermission('viewer');
    setIncludePassword(true);
    setIsGenerating(false);
    setLinkError('');
  }, [entityId]);

  // Get available permission levels for current user
  const availableLevels = getAvailableShareLevels(entityType, entityId);
  const myPermission = getPermission(entityType, entityId);
  const entityInfo = ENTITY_LABELS[entityType];
  
  // Filter permission options based on what user can share
  const permissionOptions = PERMISSION_OPTIONS.filter(opt => 
    availableLevels.includes(opt.value)
  );
  
  // Set default permission to highest available
  useEffect(() => {
    if (permissionOptions.length > 0 && !permissionOptions.find(p => p.value === selectedPermission)) {
      setSelectedPermission(permissionOptions[0].value);
    }
  }, [permissionOptions, selectedPermission]);
  
  const generateLink = useCallback(async () => {
    if (!entityId || !password) {
      setLinkError(!entityId ? 'Cannot generate link: no entity selected.' : 'Cannot generate link: password is required.');
      setIsGenerating(false);
      return;
    }
    
    setLinkError('');
    setIsGenerating(true);
    try {
      // For web-hosted workspaces, include the server URL so Electron clients can connect
      const serverUrl = !isElectron() ? window.location.origin : undefined;
      
      const link = generateShareLink({
        entityType,
        entityId,
        password: includePassword ? password : undefined,
        permission: selectedPermission,
        serverUrl,
      });
      
      setShareLink(link);
      
      // Generate QR code
      const qrData = await QRCode.toDataURL(link, {
        width: 200,
        margin: 2,
        color: {
          dark: '#1a1a2e',
          light: '#ffffff'
        }
      });
      setQrCodeDataUrl(qrData);
    } catch (err) {
      console.error('Failed to generate share link:', err);
    } finally {
      setIsGenerating(false);
    }
  }, [entityType, entityId, selectedPermission, includePassword, password]);
  
  // Generate share link when options change
  useEffect(() => {
    if (isOpen && entityId && password) {
      generateLink();
    }
  }, [isOpen, entityId, selectedPermission, includePassword, password, generateLink]);
  
  const handleCopy = async () => {
    await copyToClipboard(shareLink);
  };
  
  const handleCopyWithMessage = async () => {
    const message = `I'm sharing "${entityName}" with you.\n\n` +
      `Access: ${PERMISSION_OPTIONS.find(p => p.value === selectedPermission)?.label}\n\n` +
      (includePassword ? '' : `Password: ${password}\n\n`) +
      `Link: ${shareLink}\n\n` +
      `Open this link with Nightjar to access.`;
    
    await copyToClipboard(message);
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="share-dialog-overlay" onClick={onClose} data-testid="share-dialog-overlay">
      <div className="share-dialog entity-share-dialog" onClick={e => e.stopPropagation()} data-testid="share-dialog">
        <div className="share-dialog__header">
          <div className="share-dialog__title">
            <span className="share-dialog__icon">{entityInfo?.icon}</span>
            Share {entityInfo?.label}
          </div>
          <button className="share-dialog__close" onClick={onClose} data-testid="share-dialog-close">×</button>
        </div>
        
        <div className="share-dialog__content">
          {/* Entity info */}
          <div className="entity-share__info">
            <div className="entity-share__name">{entityName}</div>
            <div className="entity-share__desc">{entityInfo?.description}</div>
          </div>
          
          {/* Permission selector */}
          <div className="entity-share__section">
            <label className="entity-share__label">Access Level</label>
            <div className="entity-share__permissions" data-testid="permission-selector">
              {permissionOptions.map(option => (
                <button
                  key={option.value}
                  className={`entity-share__perm-btn ${
                    selectedPermission === option.value ? 'entity-share__perm-btn--selected' : ''
                  }`}
                  onClick={() => setSelectedPermission(option.value)}
                  data-testid={`permission-${option.value}`}
                >
                  <span className="entity-share__perm-icon">{option.icon}</span>
                  <span className="entity-share__perm-label">{option.label}</span>
                  <span className="entity-share__perm-desc">{option.description}</span>
                </button>
              ))}
            </div>
          </div>
          
          {/* Password inclusion toggle */}
          <div className="entity-share__section">
            <label className="entity-share__toggle">
              <input
                type="checkbox"
                checked={includePassword}
                onChange={(e) => setIncludePassword(e.target.checked)}
              />
              <span className="entity-share__toggle-text">
                Include password in link
              </span>
            </label>
            {!includePassword && (
              <div className="entity-share__password-note">
                <span className="entity-share__password-icon">🔑</span>
                Password: <code>{password}</code>
                <button 
                  className="entity-share__copy-pwd"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(password);
                    } catch (err) {
                      console.error('Failed to copy password:', err);
                      // Fallback: select password text if available
                    }
                  }}
                >
                  Copy
                </button>
              </div>
            )}
          </div>
          
          {/* Share link display */}
          <div className="entity-share__section">
            <label className="entity-share__label">Share Link</label>
            <div className="entity-share__link-box">
              <code className="entity-share__link" data-testid="share-link-text">{shareLink || linkError || 'Generating...'}</code>
            </div>
          </div>
          
          {/* QR Code */}
          {qrCodeDataUrl && (
            <div className="entity-share__qr">
              <img src={qrCodeDataUrl} alt="QR Code" />
            </div>
          )}
          
          {/* Actions */}
          <div className="entity-share__actions">
            <button 
              className="entity-share__btn entity-share__btn--secondary"
              onClick={handleCopyWithMessage}
              disabled={!shareLink}
              data-testid="copy-with-message-btn"
            >
              📝 Copy with Message
            </button>
            <button 
              className="entity-share__btn entity-share__btn--primary"
              onClick={handleCopy}
              disabled={!shareLink}
              data-testid="copy-link-btn"
            >
              {copied ? '✓ Copied!' : '📋 Copy Link'}
            </button>
          </div>
          
          {/* Info note */}
          <div className="entity-share__note">
            <strong>Note:</strong> Links cannot be revoked. Anyone with this link can access 
            with {PERMISSION_OPTIONS.find(p => p.value === selectedPermission)?.label.toLowerCase()} permissions.
          </div>
        </div>
      </div>
    </div>
  );
}

export default EntityShareDialog;
