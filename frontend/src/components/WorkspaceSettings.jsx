/**
 * WorkspaceSettings Panel
 * 
 * Displays workspace settings and management options.
 * Shows collaborators list.
 * Allows owners to delete workspace.
 * Allows renaming workspace (editors+).
 * Shows share link generation.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useWorkspaces } from '../contexts/WorkspaceContext';
import { usePermissions } from '../contexts/PermissionContext';
import { useIdentity } from '../contexts/IdentityContext';
import { generateShareLink, generateShareMessage, compressShareLink, generateSignedInviteLink, generateTopicHash, BOOTSTRAP_RELAY_NODES } from '../utils/sharing';
import { getStoredKeyChain } from '../utils/keyDerivation';
import { signData, uint8ToBase62 } from '../utils/identity';
import { isElectron } from '../hooks/useEnvironment';
import { IconColorPicker } from './common';
import { useFocusTrap } from '../hooks/useFocusTrap';
import './WorkspaceSettings.css';

// Expiry options for signed invites
const EXPIRY_OPTIONS = [
  { value: 15, label: '15 minutes' },
  { value: 60, label: '1 hour' },
  { value: 240, label: '4 hours' },
  { value: 1440, label: '24 hours' },
];

// Permission level info
const PERMISSION_INFO = {
  owner: {
    label: 'Owner',
    description: 'Full access. Can delete workspace and promote others to owner.',
    color: '#10b981',
  },
  editor: {
    label: 'Editor',
    description: 'Can create, edit, and delete documents. Can share with editor or viewer access.',
    color: '#3b82f6',
  },
  viewer: {
    label: 'Viewer',
    description: 'Read-only access. Can view documents but cannot edit.',
    color: '#6b7280',
  },
};

export default function WorkspaceSettings({ 
  workspace, 
  collaborators = [], 
  members = {},
  onClose,
  onKickMember,
  onTransferOwnership,
}) {
  const { updateWorkspace, deleteWorkspace, leaveWorkspace, workspaces, getP2PInfo } = useWorkspaces();
  const { isOwner, canEditWorkspace, getAvailableShareLevels } = usePermissions();
  const { identity: userIdentity } = useIdentity();
  
  const [name, setName] = useState(workspace?.name || '');
  const [icon, setIcon] = useState(workspace?.icon || '📁');
  const [color, setColor] = useState(workspace?.color || '#6366f1');
  const [shareLevel, setShareLevel] = useState('viewer');
  const [expiryMinutes, setExpiryMinutes] = useState(60); // Default 1 hour
  const [customRelayUrl, setCustomRelayUrl] = useState('');
  const [relayValidation, setRelayValidation] = useState(null);
  const [isValidatingRelay, setIsValidatingRelay] = useState(false);
  const [validationDebounceTimer, setValidationDebounceTimer] = useState(null);
  const [customServerUrl, setCustomServerUrl] = useState(workspace?.serverUrl || ''); // Legacy - for compatibility
  const [p2pStatus, setP2pStatus] = useState({ initialized: false, ownPublicKey: null, publicIP: null }); // P2P status
  const [relayServerValid, setRelayServerValid] = useState(null); // null = not checked, true/false = validation result
  const [validatingRelay, setValidatingRelay] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showOwnerLeaveConfirm, setShowOwnerLeaveConfirm] = useState(false); // Owner leave with transfer
  const [selectedNewOwner, setSelectedNewOwner] = useState(null); // publicKey of new owner
  const [kickingMember, setKickingMember] = useState(null); // publicKey of member being kicked
  const [isSaving, setIsSaving] = useState(false);
  const [memberSearch, setMemberSearch] = useState(''); // Search filter for collaborators
  const shareMenuRef = useRef(null);
  const modalRef = useRef(null);
  
  // Auto-detect relay from current server
  const autoDetectedRelay = React.useMemo(() => {
    if (BOOTSTRAP_RELAY_NODES.length > 0) {
      return BOOTSTRAP_RELAY_NODES[0];
    }
    if (typeof window !== 'undefined' && window.location.origin) {
      const origin = window.location.origin;
      return origin.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
    }
    return '';
  }, []);
  
  const effectiveRelayUrl = customRelayUrl || autoDetectedRelay;
  
  // Focus trap for modal accessibility
  useFocusTrap(modalRef, true, { onEscape: onClose });
  
  // Close share menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (shareMenuRef.current && !shareMenuRef.current.contains(e.target)) {
        setShowShareMenu(false);
      }
    };
    if (showShareMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showShareMenu]);
  
  // Handle Escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
  
  // Load saved custom relay from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('nightjar_customRelayServer');
    if (saved) {
      setCustomRelayUrl(saved);
    }
  }, []);
  
  // Relay validation function
  const validateRelayUrl = useCallback(async (url) => {
    if (!url || (!url.startsWith('ws://') && !url.startsWith('wss://'))) {
      return { valid: false, error: 'URL must start with ws:// or wss://' };
    }
    
    setIsValidatingRelay(true);
    const startTime = Date.now();
    
    try {
      const ws = new WebSocket(url);
      
      return await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          ws.close();
          resolve({ valid: false, error: 'Connection timeout (5s)' });
        }, 5000);
        
        ws.onopen = () => {
          clearTimeout(timeout);
          const latency = Date.now() - startTime;
          ws.close();
          resolve({ valid: true, latency });
        };
        
        ws.onerror = () => {
          clearTimeout(timeout);
          resolve({ valid: false, error: 'Connection failed' });
        };
      });
    } catch (error) {
      return { valid: false, error: error.message };
    } finally {
      setIsValidatingRelay(false);
    }
  }, []);
  
  // Handle relay URL input changes with debouncing
  const handleRelayUrlChange = useCallback((value) => {
    setCustomRelayUrl(value);
    
    // Clear previous validation
    setRelayValidation(null);
    
    // Clear previous debounce timer
    if (validationDebounceTimer) {
      clearTimeout(validationDebounceTimer);
    }
    
    // If empty, clear custom relay and use auto-detected
    if (!value || value.trim() === '') {
      setCustomRelayUrl('');
      localStorage.removeItem('nightjar_customRelayServer');
      setRelayValidation(null);
      return;
    }
    
    // Debounce validation by 500ms
    const timer = setTimeout(async () => {
      const result = await validateRelayUrl(value);
      setRelayValidation(result);
      
      if (result.valid) {
        localStorage.setItem('nightjar_customRelayServer', value);
      }
    }, 500);
    
    setValidationDebounceTimer(timer);
  }, [validateRelayUrl, validationDebounceTimer]);
  
  // Fetch P2P status on mount (Electron only)
  useEffect(() => {
    if (isElectron()) {
      getP2PInfo().then(info => {
        setP2pStatus(info);
      }).catch(() => {
        setP2pStatus({ initialized: false, ownPublicKey: null, publicIP: null });
      });
    }
  }, [getP2PInfo]);
  
  // Use detected public IP for relay server
  const refreshDetectedIP = useCallback(() => {
    if (p2pStatus.publicIP) {
      const ipUrl = `http://${p2pStatus.publicIP}`;
      setCustomServerUrl(ipUrl);
      setRelayServerValid(null); // Reset validation
    }
  }, [p2pStatus.publicIP]);
  
  if (!workspace) return null;
  
  const myPermission = workspace.myPermission || 'viewer';
  const availableShareLevels = getAvailableShareLevels('workspace', workspace.id);
  const permissionInfo = PERMISSION_INFO[myPermission];
  
  // Save workspace name/icon/color changes
  const handleSave = async () => {
    if (!canEditWorkspace) return;
    
    setIsSaving(true);
    try {
      await updateWorkspace(workspace.id, { name, icon, color });
    } finally {
      setIsSaving(false);
    }
  };
  
  // Generate self-contained P2P share link (no server dependency)
  // Uses signed invites when owner identity is available
  const createShareLink = useCallback(async (options = {}) => {
    const { compress = false } = options;
    
    // Get the workspace encryption key from stored keychain
    const keyChain = getStoredKeyChain(workspace.id);
    const encryptionKey = keyChain?.workspaceKey || null;
    
    if (!encryptionKey) {
      console.warn('[WorkspaceSettings] No encryption key found for workspace');
    }
    
    // Determine server URL for relay
    let serverUrl = null;
    
    if (!isElectron()) {
      // Browser: Use custom relay if valid, otherwise fall back to auto-detected
      if (customRelayUrl && relayValidation?.valid) {
        serverUrl = customRelayUrl;
        console.log('[WorkspaceSettings] Using custom relay server:', serverUrl);
      } else if (autoDetectedRelay) {
        serverUrl = autoDetectedRelay;
        console.log('[WorkspaceSettings] Using auto-detected relay server:', serverUrl);
      }
    }
    
    // Get P2P info for true serverless sharing (Electron only)
    let hyperswarmPeers = [];
    let topicHash = null;
    let directAddress = null;
    
    if (isElectron()) {
      try {
        const p2pInfo = await getP2PInfo();
        
        // Include our public key if available
        if (p2pInfo.ownPublicKey) {
          hyperswarmPeers = [p2pInfo.ownPublicKey];
          if (p2pInfo.connectedPeers && p2pInfo.connectedPeers.length > 0) {
            hyperswarmPeers = [...hyperswarmPeers, ...p2pInfo.connectedPeers.slice(0, 2)];
          }
          if (p2pInfo.directAddress?.address) {
            directAddress = p2pInfo.directAddress.address;
          }
        }
      } catch (e) {
        console.warn('[WorkspaceSettings] Failed to get P2P info:', e);
      }
      
      // Generate topic hash for DHT discovery (now async)
      topicHash = await generateTopicHash(workspace.id, keyChain?.password || '');
    }
    
    // If we have owner identity, use signed invite with expiry
    if (isOwner && userIdentity?.privateKey && encryptionKey) {
      try {
        const signedInvite = generateSignedInviteLink({
          workspaceId: workspace.id,
          encryptionKey,
          permission: shareLevel,
          expiryMinutes,
          ownerPrivateKey: userIdentity.privateKey,
          ownerPublicKey: userIdentity.publicKeyBase62,
          // Include P2P info for direct peer connections
          hyperswarmPeers,
          topicHash,
          directAddress,
          // Include serverUrl for cross-platform sharing (web app can't use P2P)
          serverUrl,
        });
        
        return compress ? await compressShareLink(signedInvite.link) : signedInvite.link;
      } catch (err) {
        console.warn('Failed to generate signed invite, falling back to legacy:', err);
      }
    }
    
    // Fallback to legacy link format with P2P info
    const link = generateShareLink({
      entityType: 'workspace',
      entityId: workspace.id,
      permission: shareLevel,
      hasPassword: false,
      password: null,
      encryptionKey,
      bootstrapPeers: [],
      hyperswarmPeers, // Include Hyperswarm peer public keys
      topicHash, // Include topic hash for DHT discovery
      directAddress, // Include direct P2P address (public IP:port)
      serverUrl,
    });
    
    if (compress) {
      try {
        return await compressShareLink(link);
      } catch (err) {
        console.warn('Failed to compress link, using original:', err);
        return link;
      }
    }
    
    return link;
  }, [workspace.id, shareLevel, expiryMinutes, customRelayUrl, relayValidation, autoDetectedRelay, isOwner, userIdentity, getP2PInfo]);

  // Copy different share formats
  const handleCopyFormat = async (format) => {
    const link = await createShareLink();
    let textToCopy = link;
    
    switch (format) {
      case 'message':
        textToCopy = generateShareMessage({
          link,
          workspaceName: workspace.name,
          permission: shareLevel,
        });
        break;
      case 'link':
      default:
        textToCopy = link;
    }
    
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedLink(true);
      setShowShareMenu(false);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Legacy copy handler (for backwards compat)
  const handleCopyShareLink = () => handleCopyFormat('link');
  
  // Delete workspace (owners OR only member)
  const handleDelete = async () => {
    // Allow deletion if owner OR if you're the only member
    const totalMembers = Object.keys(members || {}).length || collaborators.length || 1;
    const isOnlyMemberLocal = totalMembers <= 1;
    
    if (!isOwner && !isOnlyMemberLocal) return;
    
    await deleteWorkspace(workspace.id);
    onClose?.();
  };
  
  // Leave workspace (editors/viewers only, or owners after transferring)
  const handleLeave = async () => {
    await leaveWorkspace(workspace.id);
    onClose?.();
  };
  
  // Owner leave with ownership transfer
  const handleOwnerLeave = async () => {
    if (!selectedNewOwner || !onTransferOwnership) return;
    
    // Transfer ownership first
    await onTransferOwnership(selectedNewOwner);
    
    // Then leave
    await leaveWorkspace(workspace.id);
    onClose?.();
  };
  
  // Kick a member from workspace (owners only)
  const handleKickMember = async (publicKey) => {
    if (!isOwner || !onKickMember) return;
    
    // Find member name for toast feedback
    const member = Object.values(members).find(m => m.publicKey === publicKey);
    const memberName = member?.displayName || member?.handle || publicKey?.slice(0, 8) || 'member';
    
    // Call the kick handler (which handles toast feedback in AppNew.jsx)
    onKickMember(publicKey, memberName);
    setKickingMember(null);
  };
  
  // Get deduplicated member list from members map
  const memberList = Object.values(members);
  
  // Filter members by search term
  const filteredMembers = memberSearch 
    ? memberList.filter(m => 
        (m.displayName || '').toLowerCase().includes(memberSearch.toLowerCase()) ||
        (m.handle || '').toLowerCase().includes(memberSearch.toLowerCase()) ||
        (m.publicKey || '').toLowerCase().includes(memberSearch.toLowerCase())
      )
    : memberList;
  
  // Determine leave eligibility
  // - Can't leave if you're the only member
  // - Owners must transfer ownership first
  const totalMembers = memberList.length || collaborators.length || 1; // At least 1 (self)
  const isOnlyMember = totalMembers <= 1;
  const nonOwnerMembers = memberList.filter(m => m.permission !== 'owner');
  const canOwnerLeave = isOwner && !isOnlyMember && nonOwnerMembers.length > 0;
  
  return (
    <div className="workspace-settings__overlay" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div 
        className="workspace-settings" 
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-settings-title"
      >
        <div className="workspace-settings__header">
          <h2 id="workspace-settings-title" className="workspace-settings__title">Workspace Settings</h2>
          <button className="workspace-settings__close" onClick={onClose} aria-label="Close workspace settings">×</button>
        </div>
        
        <div className="workspace-settings__content">
          {/* Workspace Info */}
          <section className="workspace-settings__section">
            <h3 className="workspace-settings__section-title">Workspace Info</h3>
            
            <div className="workspace-settings__field workspace-settings__field--row">
              <IconColorPicker
                icon={icon}
                color={color}
                onIconChange={setIcon}
                onColorChange={setColor}
                disabled={!canEditWorkspace}
                size="medium"
              />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="workspace-settings__input workspace-settings__input--name"
                disabled={!canEditWorkspace}
                placeholder="Workspace name"
              />
            </div>
            
            {canEditWorkspace && (
              <button 
                className="workspace-settings__save-btn"
                onClick={handleSave}
                disabled={isSaving || (name === workspace.name && icon === workspace.icon && color === workspace.color)}
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            )}
          </section>
        
        {/* Your Permission */}
        <section className="workspace-settings__section">
          <h3 className="workspace-settings__section-title">Your Permission</h3>
          <div 
            className="workspace-settings__permission-badge"
            style={{ backgroundColor: permissionInfo?.color }}
          >
            {permissionInfo?.label}
          </div>
          <p className="workspace-settings__permission-desc">
            {permissionInfo?.description}
          </p>
        </section>
        
        {/* Share Workspace */}
        {availableShareLevels.length > 0 && (
          <section className="workspace-settings__section">
            <h3 className="workspace-settings__section-title">Share Workspace</h3>
            <p className="workspace-settings__description">
              Anyone with this link will have access to all folders and documents in this workspace.
              {isOwner && userIdentity && ' Links are time-limited and signed for security.'}
            </p>
            
            <div className="workspace-settings__share-controls">
              <div className="workspace-settings__share-controls-row">
                <select
                  value={shareLevel}
                  onChange={(e) => setShareLevel(e.target.value)}
                  className="workspace-settings__select"
                >
                  {availableShareLevels.map(level => (
                    <option key={level} value={level}>
                      {PERMISSION_INFO[level]?.label} access
                    </option>
                  ))}
                </select>
                
                {/* Expiry picker - only shown for owners with identity */}
                {isOwner && userIdentity && (
                  <select
                    value={expiryMinutes}
                    onChange={(e) => setExpiryMinutes(parseInt(e.target.value, 10))}
                    className="workspace-settings__select workspace-settings__select--expiry"
                    title="Link expiry time"
                  >
                    {EXPIRY_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>
                        Expires in {opt.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              
              {/* Relay Server Configuration */}
              {!isElectron() && (
                <div className="workspace-settings__relay-config">
                  <label className="workspace-settings__label">
                    Relay Server
                    <span className="workspace-settings__help-text">
                      Auto-detected from current server. Override for cross-network sharing.
                    </span>
                  </label>
                  <div className="workspace-settings__relay-input-group">
                    <input
                      type="text"
                      className="workspace-settings__input"
                      value={customRelayUrl}
                      onChange={(e) => handleRelayUrlChange(e.target.value)}
                      placeholder={autoDetectedRelay || 'ws://your-server.com'}
                    />
                    {isValidatingRelay && (
                      <span className="workspace-settings__relay-status validating">
                        ⟳ Validating...
                      </span>
                    )}
                    {relayValidation?.valid && (
                      <span className="workspace-settings__relay-status valid">
                        ✓ Connected ({relayValidation.latency}ms)
                      </span>
                    )}
                    {relayValidation && !relayValidation.valid && (
                      <span className="workspace-settings__relay-status invalid">
                        ✗ {relayValidation.error}
                      </span>
                    )}
                  </div>
                  {!customRelayUrl && autoDetectedRelay && (
                    <div className="workspace-settings__relay-auto">
                      Using auto-detected: {autoDetectedRelay}
                    </div>
                  )}
                  {effectiveRelayUrl && (
                    <div className="workspace-settings__relay-preview">
                      <small>Share link will include relay: {effectiveRelayUrl}</small>
                    </div>
                  )}
                </div>
              )}
              
              {/* P2P Status - show direct address when available (Electron only) */}
              {isElectron() && (
                <div className="workspace-settings__server-url">
                  {p2pStatus.initialized && p2pStatus.ownPublicKey ? (
                    <>
                      <div className="workspace-settings__p2p-status workspace-settings__p2p-status--connected">
                        <span className="workspace-settings__p2p-icon">🟢</span>
                        <span>P2P Active</span>
                      </div>
                      {p2pStatus.publicIP ? (
                        <>
                          <div className="workspace-settings__p2p-info">
                            Public IP: {p2pStatus.publicIP}
                          </div>
                          {p2pStatus.upnpEnabled ? (
                            <div className="workspace-settings__p2p-info">
                              ✓ Auto port-forward active. Cross-platform sharing enabled.
                            </div>
                          ) : (
                            <div className="workspace-settings__p2p-info workspace-settings__p2p-info--warning">
                              ⚠️ Auto port-forward unavailable. Manually forward ports {p2pStatus.wsPort || 8080} (WS) and {p2pStatus.wssPort || 8443} (WSS) for sharing.
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="workspace-settings__p2p-info workspace-settings__p2p-info--warning">
                          DHT only (no public IP detected). Add relay server URL below for cross-platform sharing.
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="workspace-settings__p2p-status workspace-settings__p2p-status--offline">
                        <span className="workspace-settings__p2p-icon">🔴</span>
                        <span>P2P Offline - Relay server required</span>
                      </div>
                      <label className="workspace-settings__server-label">
                        <span className="workspace-settings__server-title">🌐 Relay Server URL</span>
                        <span className="workspace-settings__server-desc">
                          Enter your server URL for sharing
                        </span>
                      </label>
                      <div className="workspace-settings__server-input-group">
                        <input
                          type="text"
                          value={customServerUrl}
                          onChange={(e) => {
                            setCustomServerUrl(e.target.value);
                            setRelayServerValid(null); // Reset validation when URL changes
                          }}
                          placeholder="http://192.168.1.x"
                          className="workspace-settings__input workspace-settings__input--server"
                        />
                        <button
                          type="button"
                          onClick={() => handleRelayUrlChange(customServerUrl)}
                          disabled={validatingRelay || !customServerUrl?.trim()}
                          className="workspace-settings__validate-btn"
                        >
                          {validatingRelay ? '⏳' : '✓ Validate'}
                        </button>
                        {p2pStatus.publicIP && (
                          <button
                            type="button"
                            onClick={refreshDetectedIP}
                            className="workspace-settings__refresh-btn"
                            title="Use detected public IP"
                          >
                            🔄 Use My IP
                          </button>
                        )}
                      </div>
                      {relayServerValid === false && (
                        <div className="workspace-settings__server-warning">
                          ⚠️ Server unreachable. Share links may not work. <button type="button" onClick={refreshDetectedIP} className="workspace-settings__inline-btn">Use detected IP instead?</button>
                        </div>
                      )}
                      {relayServerValid === true && (
                        <div className="workspace-settings__server-success">
                          ✓ Server validated and ready
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
              
              <div className="workspace-settings__share-btn-group" ref={shareMenuRef}>
                  <button 
                    className={`workspace-settings__copy-btn ${copiedLink ? 'workspace-settings__copy-btn--copied' : ''}`}
                    onClick={() => handleCopyFormat('link')}
                    type="button"
                    data-testid="copy-share-link-btn"
                  >
                    {copiedLink ? '✓ Copied!' : '📋 Copy Link'}
                  </button>
                  <button 
                    className="workspace-settings__copy-btn workspace-settings__copy-btn--dropdown"
                    onClick={() => setShowShareMenu(!showShareMenu)}
                    aria-label="More share options"
                    aria-expanded={showShareMenu}
                    type="button"
                    data-testid="share-options-dropdown"
                  >
                    ▾
                  </button>
                  
                  {showShareMenu && (
                    <div className="workspace-settings__share-menu">
                      <button 
                        className="workspace-settings__share-menu-item"
                        onClick={() => handleCopyFormat('link')}
                      >
                        <span className="workspace-settings__share-menu-icon">🔗</span>
                        <span>Copy Link</span>
                        <span className="workspace-settings__share-menu-desc">Full nahma:// URL</span>
                      </button>
                      <button 
                        className="workspace-settings__share-menu-item"
                        onClick={() => handleCopyFormat('message')}
                      >
                        <span className="workspace-settings__share-menu-icon">💬</span>
                        <span>Copy Message</span>
                        <span className="workspace-settings__share-menu-desc">Invite text with link</span>
                      </button>
                      <button 
                        className="workspace-settings__share-menu-item"
                        onClick={() => handleCopyFormat('code')}
                      >
                        <span className="workspace-settings__share-menu-icon">🔑</span>
                        <span>Copy Code</span>
                        <span className="workspace-settings__share-menu-desc">Compact share code</span>
                      </button>
                    </div>
                  )}
                </div>
              
              {copiedLink && (
                <div className="workspace-settings__copied-feedback">
                  ✓ Link copied to clipboard
                </div>
              )}
            </div>
          </section>
        )}
        
        {/* Collaborators */}
        <section className="workspace-settings__section">
          <h3 className="workspace-settings__section-title">
            Collaborators
            {(memberList.length > 0 || collaborators.length > 0) && (
              <span className="workspace-settings__count">
                ({memberList.length || collaborators.length})
              </span>
            )}
          </h3>
          
          {/* Search filter - shown when there are many collaborators */}
          {(memberList.length > 5 || collaborators.length > 5) && (
            <div className="workspace-settings__search">
              <input
                type="text"
                placeholder="Search collaborators..."
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                className="workspace-settings__search-input"
              />
              {memberSearch && (
                <button 
                  className="workspace-settings__search-clear"
                  onClick={() => setMemberSearch('')}
                  title="Clear search"
                >
                  ×
                </button>
              )}
            </div>
          )}
          
          {/* Members list - scrollable container */}
          <div className="workspace-settings__collaborators-container">
            {/* Members list - uses new members map, keyed by publicKey */}
            {filteredMembers.length > 0 ? (
              <ul className="workspace-settings__collaborators">
                {filteredMembers.map((member) => (
                  <li key={member.publicKey} className="workspace-settings__collaborator">
                    <span 
                      className="workspace-settings__collaborator-avatar"
                      style={{ backgroundColor: member.color || '#888888' }}
                    >
                      {member.icon || member.displayName?.charAt(0)?.toUpperCase() || '?'}
                    </span>
                    <div className="workspace-settings__collaborator-info">
                      <span className="workspace-settings__collaborator-name">
                        {member.displayName || member.handle || member.publicKey?.slice(0, 8) || 'Anonymous'}
                        {member.publicKey === userIdentity?.publicKeyBase62 && (
                          <span className="workspace-settings__you-badge">(you)</span>
                        )}
                      </span>
                      <span className="workspace-settings__collaborator-id">
                        {member.publicKey?.slice(0, 10)}...
                      </span>
                    </div>
                    <span 
                      className="workspace-settings__collaborator-badge"
                      style={{ backgroundColor: PERMISSION_INFO[member.permission]?.color || '#6b7280' }}
                    >
                      {PERMISSION_INFO[member.permission]?.label || 'Viewer'}
                    </span>
                    
                    {/* Kick button - only for owners, not self */}
                    {isOwner && member.publicKey !== userIdentity?.publicKeyBase62 && onKickMember && (
                      kickingMember === member.publicKey ? (
                        <div className="workspace-settings__kick-confirm">
                          <button 
                            className="workspace-settings__kick-yes"
                            onClick={() => handleKickMember(member.publicKey)}
                            title="Confirm removal"
                          >
                            ✓
                          </button>
                          <button 
                            className="workspace-settings__kick-no"
                            onClick={() => setKickingMember(null)}
                            title="Cancel"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button 
                          className="workspace-settings__kick-btn"
                          onClick={() => setKickingMember(member.publicKey)}
                          title="Remove from workspace"
                        >
                          🚫
                        </button>
                      )
                    )}
                  </li>
                ))}
              </ul>
            ) : memberList.length > 0 && memberSearch ? (
              <p className="workspace-settings__empty">
                No collaborators match "{memberSearch}"
              </p>
            ) : collaborators.length > 0 ? (
            // Legacy collaborators list (backwards compatibility)
            <ul className="workspace-settings__collaborators">
              {collaborators.map((collab, index) => (
                <li key={collab.peerId || collab.identityId || index} className="workspace-settings__collaborator">
                  <span 
                    className="workspace-settings__collaborator-avatar"
                    style={{ backgroundColor: collab.color || '#888888' }}
                  >
                    {collab.icon || collab.displayName?.charAt(0)?.toUpperCase() || '?'}
                  </span>
                  <span className="workspace-settings__collaborator-name">
                    {collab.displayName || collab.handle || collab.identityId?.slice(0, 8) || 'Anonymous'}
                  </span>
                  <span 
                    className="workspace-settings__collaborator-badge"
                    style={{ backgroundColor: PERMISSION_INFO[collab.permission]?.color || '#6b7280' }}
                  >
                    {PERMISSION_INFO[collab.permission]?.label || 'Viewer'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="workspace-settings__empty">
              No collaborators yet. Share the workspace link to invite others.
            </p>
          )}
          </div>{/* End scrollable container */}
        </section>
        
        {/* Danger Zone - Delete/Leave for owners, Leave for others */}
        <section className="workspace-settings__section workspace-settings__section--danger">
          <h3 className="workspace-settings__section-title">Danger Zone</h3>
          
          <div className="workspace-settings__danger-buttons">
            {/* Delete Workspace - owners OR only member */}
            {(isOwner || isOnlyMember) && (
              !showDeleteConfirm ? (
                <button 
                  className="workspace-settings__delete-btn"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  Delete Workspace
                </button>
              ) : (
                <div className="workspace-settings__delete-confirm">
                  <p>Are you sure? This will remove the workspace from your device.</p>
                  <p className="workspace-settings__delete-note">
                    Note: Other collaborators will still have their copies.
                  </p>
                  <div className="workspace-settings__delete-actions">
                    <button 
                      className="workspace-settings__cancel-btn"
                      onClick={() => setShowDeleteConfirm(false)}
                    >
                      Cancel
                    </button>
                    <button 
                      className="workspace-settings__confirm-delete-btn"
                      onClick={handleDelete}
                    >
                      Yes, Delete
                    </button>
                  </div>
                </div>
              )
            )}
            
            {/* Leave Workspace - shown for non-owners, or owners with other members */}
            {isOwner ? (
              // Owner leave - requires transfer if there are other members
              canOwnerLeave && (
                !showOwnerLeaveConfirm ? (
                  <button 
                    className="workspace-settings__delete-btn workspace-settings__leave-btn"
                    onClick={() => setShowOwnerLeaveConfirm(true)}
                  >
                    Leave Workspace
                  </button>
                ) : (
                  <div className="workspace-settings__delete-confirm workspace-settings__transfer-confirm">
                    <p>Before leaving, you must transfer ownership to another member:</p>
                    <select
                      value={selectedNewOwner || ''}
                      onChange={(e) => setSelectedNewOwner(e.target.value)}
                      className="workspace-settings__select workspace-settings__owner-select"
                    >
                      <option value="">Select new owner...</option>
                      {nonOwnerMembers.map((member) => (
                        <option key={member.publicKey} value={member.publicKey}>
                          {member.displayName || member.handle || member.publicKey?.slice(0, 12)}
                        </option>
                      ))}
                    </select>
                    <div className="workspace-settings__delete-actions">
                      <button 
                        className="workspace-settings__cancel-btn"
                        onClick={() => {
                          setShowOwnerLeaveConfirm(false);
                          setSelectedNewOwner(null);
                        }}
                      >
                        Cancel
                      </button>
                      <button 
                        className="workspace-settings__confirm-delete-btn workspace-settings__confirm-leave-btn"
                        onClick={handleOwnerLeave}
                        disabled={!selectedNewOwner}
                      >
                        Transfer & Leave
                      </button>
                    </div>
                  </div>
                )
              )
            ) : (
              // Non-owner leave - disabled if only member
              !isOnlyMember && (
                !showLeaveConfirm ? (
                  <button 
                    className="workspace-settings__delete-btn workspace-settings__leave-btn"
                    onClick={() => setShowLeaveConfirm(true)}
                  >
                    Leave Workspace
                  </button>
                ) : (
                  <div className="workspace-settings__delete-confirm">
                    <p>Are you sure you want to leave this workspace?</p>
                    <p className="workspace-settings__delete-note">
                      You will lose access to all documents. You can rejoin with a new invite link.
                    </p>
                    <div className="workspace-settings__delete-actions">
                      <button 
                        className="workspace-settings__cancel-btn"
                        onClick={() => setShowLeaveConfirm(false)}
                      >
                        Cancel
                      </button>
                      <button 
                        className="workspace-settings__confirm-delete-btn workspace-settings__confirm-leave-btn"
                        onClick={handleLeave}
                      >
                        Yes, Leave
                      </button>
                    </div>
                  </div>
                )
              )
            )}
            
            {/* Show message when leave is disabled */}
            {isOnlyMember && (
              <p className="workspace-settings__disabled-note">
                You are the only member. Use "Delete Workspace" above to remove it.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  </div>
  );
}
