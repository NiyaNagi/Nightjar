/**
 * CreateWorkspace Dialog
 * 
 * Modal dialog for creating a new workspace.
 * Also handles joining via share link.
 */

import React, { useState, useRef } from 'react';
import { useWorkspaces } from '../contexts/WorkspaceContext';
import { 
  parseShareLink, 
  parseShareLinkAsync,
  parseInviteLink, 
  isInviteLink,
  isCompressedLink 
} from '../utils/sharing';
import { useFocusTrap } from '../hooks/useFocusTrap';
import './CreateWorkspace.css';

const EMOJI_OPTIONS = [
  // Nightjar brand + General workspace & organization
  '🦅', '📁', '💼', '📚', '🗂️', '📦', '🏢', '🏠',
  '📋',
  // Creative & design
  '🎨', '🎬', '🎭', '🖼️', '✏️', '🖌️', '🎵', '📸',
  // Technical & development
  '💻', '⚙️', '🔧', '🛠️', '💡', '🔬', '🧪', '📡',
  // Team & collaboration
  '👥', '🤝', '💬', '📢', '🎯', '🎓', '📝', '📌',
  // Planning & productivity
  '📅', '⏰', '✅', '📈', '📊', '💰', '🚀', '🌟'
];

const COLOR_PRESETS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
  '#22c55e', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6',
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899'
];

export default function CreateWorkspaceDialog({ mode = 'create', onClose, onSuccess }) {
  const { createWorkspace, joinWorkspace } = useWorkspaces();
  const modalRef = useRef(null);
  
  const [activeTab, setActiveTab] = useState(mode); // 'create' | 'join'
  
  // Focus trap for modal accessibility
  useFocusTrap(modalRef, true, { onEscape: onClose });
  
  // Create workspace state
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📁');
  const [color, setColor] = useState('#6366f1');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  
  // Join workspace state
  const [shareLink, setShareLink] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [parsedLink, setParsedLink] = useState(null);
  const [connectionProgress, setConnectionProgress] = useState(null); // { current, total, status }
  
  // Parse share link as user types
  const handleLinkChange = async (value) => {
    setShareLink(value);
    setJoinError('');
    setConnectionProgress(null);
    
    if (!value.trim()) {
      setParsedLink(null);
      return;
    }
    
    // Check if it's a compressed link (new P2P format)
    if (isCompressedLink(value)) {
      try {
        const parsed = await parseShareLinkAsync(value);
        setParsedLink({ 
          ...parsed, 
          isNewStyle: false, 
          isP2P: true,
          hasBootstrapPeers: parsed.bootstrapPeers?.length > 0 
        });
        // If link contains embedded password, pre-fill it
        if (parsed.embeddedPassword) {
          setJoinPassword(parsed.embeddedPassword);
        }
      } catch (err) {
        console.error('Failed to decompress link:', err);
        setJoinError('Invalid compressed share link');
        setParsedLink(null);
      }
      return;
    }
    
    // Check if it's a new-style invite link
    if (isInviteLink(value)) {
      const parsed = parseInviteLink(value);
      if (parsed?.token) {
        // Fetch invite data from server
        try {
          const response = await fetch(`/api/invites/${parsed.token}`);
          if (response.ok) {
            const inviteData = await response.json();
            setParsedLink({
              ...inviteData,
              isNewStyle: true,
              token: parsed.token,
            });
          } else {
            setJoinError('Invite link expired or invalid');
            setParsedLink(null);
          }
        } catch (err) {
          console.error('Failed to fetch invite:', err);
          setJoinError('Failed to verify invite link');
          setParsedLink(null);
        }
        return;
      }
    }
    
    // Try legacy nightjar:// format (may have bootstrap peers embedded)
    try {
      const parsed = parseShareLink(value);
      const hasHyperswarmPeers = parsed.hyperswarmPeers?.length > 0;
      const hasBootstrapPeers = parsed.bootstrapPeers?.length > 0;
      const hasDirectAddress = !!parsed.directAddress;
      const hasTopic = !!parsed.topic;
      setParsedLink({ 
        ...parsed, 
        isNewStyle: false,
        isP2P: hasHyperswarmPeers || hasBootstrapPeers || hasDirectAddress || hasTopic,
        hasBootstrapPeers,
        hasHyperswarmPeers,
        hasDirectAddress,
      });
      // If link contains embedded password, pre-fill it
      if (parsed.embeddedPassword) {
        setJoinPassword(parsed.embeddedPassword);
      }
    } catch (err) {
      setParsedLink(null);
    }
  };
  
  // Handle create workspace
  const handleCreate = async (e) => {
    e.preventDefault();
    setCreateError('');
    
    // Validation
    if (!name.trim()) {
      setCreateError('Please enter a workspace name');
      return;
    }
    
    // Password is optional - if provided, validate it
    if (password) {
      if (password.length < 8) {
        setCreateError('Password must be at least 8 characters');
        return;
      }
      
      if (password !== confirmPassword) {
        setCreateError('Passwords do not match');
        return;
      }
    }
    
    setIsCreating(true);
    
    try {
      const workspace = await createWorkspace({
        name: name.trim(),
        password: password || null, // null if no password
        icon,
        color
      });
      onSuccess?.(workspace);
      onClose?.();
    } catch (err) {
      setCreateError(err.message || 'Failed to create workspace');
    } finally {
      setIsCreating(false);
    }
  };
  
  // Handle join workspace
  const handleJoin = async (e) => {
    e.preventDefault();
    setJoinError('');
    setConnectionProgress(null);
    
    if (!shareLink.trim()) {
      setJoinError('Please enter a share link');
      return;
    }
    
    if (!parsedLink) {
      setJoinError('Invalid share link format');
      return;
    }
    
    // DEBUG: Log parsed link details
    console.log(`[CreateWorkspace] ========== JOIN ATTEMPT ==========`);
    console.log(`[CreateWorkspace] shareLink:`, shareLink);
    console.log(`[CreateWorkspace] parsedLink:`, parsedLink);
    console.log(`[CreateWorkspace] isP2P:`, parsedLink.isP2P);
    console.log(`[CreateWorkspace] hasBootstrapPeers:`, parsedLink.hasBootstrapPeers);
    console.log(`[CreateWorkspace] hasHyperswarmPeers:`, parsedLink.hasHyperswarmPeers);
    console.log(`[CreateWorkspace] hyperswarmPeers:`, parsedLink.hyperswarmPeers);
    console.log(`[CreateWorkspace] topicHash:`, parsedLink.topic);
    console.log(`[CreateWorkspace] isNewStyle:`, parsedLink.isNewStyle);
    console.log(`[CreateWorkspace] entityId:`, parsedLink.entityId);
    console.log(`[CreateWorkspace] hasPassword:`, !!parsedLink.embeddedPassword || !!joinPassword);
    console.log(`[CreateWorkspace] hasEncryptionKey:`, !!parsedLink.encryptionKey);
    console.log(`[CreateWorkspace] serverUrl:`, parsedLink.serverUrl || '(none - will use local)');
    console.log(`[CreateWorkspace] ===================================`);
    
    setIsJoining(true);
    
    try {
      // Handle P2P links (either Hyperswarm peers or legacy WebSocket peers)
      if (parsedLink.isP2P) {
        const password = parsedLink.embeddedPassword || joinPassword;
        // Allow join if we have password OR encryption key
        // Key-embedded links (Option A) have encryptionKey directly in URL
        if (!password && !parsedLink.encryptionKey) {
          // Only require password if link expects one and we don't have a key
          if (parsedLink.hasPassword) {
            setJoinError('Password is required');
            setIsJoining(false);
            return;
          }
          // No password and no key - this shouldn't happen for valid links
          // but allow proceeding for topic-only links
        }
        
        // Join with bootstrap peers for P2P connection
        const workspace = await joinWorkspace({
          entityId: parsedLink.entityId,
          password: password || null,
          encryptionKey: parsedLink.encryptionKey || null,
          permission: parsedLink.permission || 'editor',
          bootstrapPeers: parsedLink.hyperswarmPeers || parsedLink.bootstrapPeers || [], // Prefer hyperswarm peers
          topicHash: parsedLink.topic || null, // Include topic hash for DHT
          directAddress: parsedLink.directAddress || null, // Direct P2P address (ip:port)
          serverUrl: parsedLink.serverUrl || null, // For cross-platform workspace sync
          onConnectionProgress: (progress) => {
            setConnectionProgress(progress);
          },
          onAllPeersFailed: () => {
            setJoinError('Could not connect - all peers are offline. Please try again later or ask for a new link.');
            setIsJoining(false);
          },
        });
        
        if (workspace) {
          onSuccess?.(workspace);
          onClose?.();
        }
        return;
      }
      
      if (parsedLink.isNewStyle) {
        // New invite link system - use the invite token to join
        // Password is optional (only if requiresPassword is true)
        if (parsedLink.requiresPassword && !joinPassword && !parsedLink.encryptionKey) {
          setJoinError('Password is required for this invite');
          setIsJoining(false);
          return;
        }
        
        // Mark invite as used
        const useResponse = await fetch(`/api/invites/${parsedLink.token}/use`, {
          method: 'POST',
        });
        
        if (!useResponse.ok) {
          throw new Error('Invite link expired or invalid');
        }
        
        // Join the workspace
        const workspace = await joinWorkspace({
          entityId: parsedLink.entityId,
          password: joinPassword || null, // Password is optional now
          encryptionKey: parsedLink.encryptionKey || null,
          permission: parsedLink.permission || 'editor',
          serverUrl: parsedLink.serverUrl || null, // For cross-platform workspace sync
        });
        onSuccess?.(workspace);
        onClose?.();
      } else {
        // Legacy link format - password or encryption key required
        const password = parsedLink.embeddedPassword || joinPassword;
        console.log('[CreateWorkspace] Legacy link join attempt:', {
          entityId: parsedLink.entityId,
          hasPassword: !!password,
          hasEncryptionKey: !!parsedLink.encryptionKey,
          permission: parsedLink.permission,
        });
        
        // Only require password if link expects one and we don't have a key
        if (!password && !parsedLink.encryptionKey && parsedLink.hasPassword) {
          setJoinError('Password is required');
          setIsJoining(false);
          return;
        }
        
        // Validate we have a workspace ID
        if (!parsedLink.entityId) {
          setJoinError('Invalid share link: missing workspace ID');
          setIsJoining(false);
          return;
        }
        
        console.log('[CreateWorkspace] Calling joinWorkspace...');
        const workspace = await joinWorkspace({
          entityId: parsedLink.entityId,
          password: password || null,
          encryptionKey: parsedLink.encryptionKey || null,
          permission: parsedLink.permission || 'editor',
          serverUrl: parsedLink.serverUrl || null, // For cross-platform workspace sync
        });
        console.log('[CreateWorkspace] joinWorkspace returned:', workspace);
        onSuccess?.(workspace);
        onClose?.();
      }
    } catch (err) {
      console.error('[CreateWorkspace] Join failed with error:', err);
      setJoinError(err.message || 'Failed to join workspace');
    } finally {
      setIsJoining(false);
    }
  };
  
  return (
    <div className="create-workspace-overlay" onClick={onClose}>
      <div 
        ref={modalRef}
        className="create-workspace" 
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-workspace-title"
      >
        <div className="create-workspace__header">
          <h2 id="create-workspace-title" className="visually-hidden">
            {activeTab === 'create' ? 'Create Workspace' : 'Join Workspace'}
          </h2>
          <div className="create-workspace__tabs" role="tablist">
            <button
              className={`create-workspace__tab ${activeTab === 'create' ? 'create-workspace__tab--active' : ''}`}
              onClick={() => setActiveTab('create')}
              role="tab"
              aria-selected={activeTab === 'create'}
            >
              Create New
            </button>
            <button
              className={`create-workspace__tab ${activeTab === 'join' ? 'create-workspace__tab--active' : ''}`}
              onClick={() => setActiveTab('join')}
              role="tab"
              aria-selected={activeTab === 'join'}
            >
              Join via Link
            </button>
          </div>
          <button className="create-workspace__close" onClick={onClose} aria-label="Close dialog">×</button>
        </div>
        
        <div className="create-workspace__content">
          {activeTab === 'create' ? (
            <form onSubmit={handleCreate} className="create-workspace__form">
              <div className="create-workspace__icon-section">
                <label className="create-workspace__label">Choose an icon</label>
                <div className="create-workspace__icon-grid">
                  {EMOJI_OPTIONS.map(emoji => (
                    <button
                      key={emoji}
                      type="button"
                      className={`create-workspace__icon-option ${icon === emoji ? 'create-workspace__icon-option--selected' : ''}`}
                      onClick={() => setIcon(emoji)}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="create-workspace__color-section">
                <label className="create-workspace__label">Choose a color</label>
                <div className="create-workspace__color-grid">
                  {COLOR_PRESETS.map(c => (
                    <button
                      key={c}
                      type="button"
                      className={`create-workspace__color-option ${color === c ? 'create-workspace__color-option--selected' : ''}`}
                      style={{ backgroundColor: c }}
                      onClick={() => setColor(c)}
                      aria-label={`Select color ${c}`}
                    />
                  ))}
                </div>
              </div>
              
              <div className="create-workspace__field">
                <label className="create-workspace__label">Workspace Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="create-workspace__input"
                  placeholder="My Workspace"
                  autoFocus
                />
              </div>
              
              <div className="create-workspace__field">
                <label className="create-workspace__label">
                  Encryption Password
                  <span className="create-workspace__hint">Optional - adds extra encryption</span>
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="create-workspace__input"
                  placeholder="Optional password"
                />
              </div>
              
              {password && (
              <div className="create-workspace__field">
                <label className="create-workspace__label">Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="create-workspace__input"
                  placeholder="Confirm password"
                />
              </div>
              )}
              
              {createError && (
                <div className="create-workspace__error">{createError}</div>
              )}
              
              <button 
                type="submit" 
                className="create-workspace__submit"
                disabled={isCreating}
              >
                {isCreating ? 'Creating...' : 'Create Workspace'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleJoin} className="create-workspace__form">
              <div className="create-workspace__field">
                <label className="create-workspace__label">Share Link</label>
                <textarea
                  value={shareLink}
                  onChange={(e) => handleLinkChange(e.target.value)}
                  className="create-workspace__textarea"
                  placeholder="Paste the share link here..."
                  rows={3}
                  autoFocus
                />
                {parsedLink && (
                  <div className="create-workspace__link-info">
                    <span className="create-workspace__link-type">
                      {parsedLink.entityType === 'workspace' ? '📁 Workspace' : 
                       parsedLink.entityType === 'folder' ? '📂 Folder' : '📄 Document'}
                    </span>
                    {parsedLink.permission && (
                      <span className="create-workspace__link-perm">
                        {parsedLink.permission} access
                      </span>
                    )}
                    {parsedLink.embeddedPassword && (
                      <span className="create-workspace__link-pass">🔑 Password included</span>
                    )}
                    {parsedLink.encryptionKey && !parsedLink.embeddedPassword && (
                      <span className="create-workspace__link-pass">🔐 Key included</span>
                    )}
                    {parsedLink.isNewStyle && !parsedLink.requiresPassword && (
                      <span className="create-workspace__link-pass">✓ No password required</span>
                    )}
                    {parsedLink.isP2P && parsedLink.hasBootstrapPeers && (
                      <span className="create-workspace__link-p2p">
                        🌐 P2P ({parsedLink.bootstrapPeers.length} peer{parsedLink.bootstrapPeers.length !== 1 ? 's' : ''})
                      </span>
                    )}
                  </div>
                )}
              </div>
              
              {/* Connection progress for P2P links */}
              {connectionProgress && (
                <div className="create-workspace__connection-progress">
                  <div className="progress-header">
                    <span className="progress-status">
                      {connectionProgress.status === 'connecting' ? '🔄' : 
                       connectionProgress.status === 'connected' ? '✅' : '⏳'}
                    </span>
                    <span className="progress-text">
                      Connecting to peer {connectionProgress.current} of {connectionProgress.total}...
                    </span>
                  </div>
                  <div className="progress-bar">
                    <div 
                      className="progress-fill"
                      style={{ width: `${(connectionProgress.current / connectionProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}
              
              {/* Only show password field if: legacy link without embedded password/key, OR new link that requires password */}
              {parsedLink && !parsedLink.embeddedPassword && !parsedLink.encryptionKey && (!parsedLink.isNewStyle || parsedLink.requiresPassword) && (
                <div className="create-workspace__field">
                  <label className="create-workspace__label">
                    Password
                    <span className="create-workspace__hint">Required to decrypt content</span>
                  </label>
                  <input
                    type="password"
                    value={joinPassword}
                    onChange={(e) => setJoinPassword(e.target.value)}
                    className="create-workspace__input"
                    placeholder="Enter the workspace password"
                  />
                </div>
              )}
              
              {joinError && (
                <div className="create-workspace__error">{joinError}</div>
              )}
              
              <button 
                type="submit" 
                className="create-workspace__submit"
                disabled={isJoining || !parsedLink}
              >
                {isJoining ? 'Joining...' : 'Join Workspace'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
