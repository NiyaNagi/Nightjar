/**
 * Share Link Navigation Handler
 * 
 * Handles incoming share links:
 * - Parses and validates links
 * - Derives keys for access
 * - Adds entities to local storage
 * - Navigates to shared content
 * - Updates permission cache
 * 
 * Reference: docs/WORKSPACE_PERMISSIONS_SPEC.md
 */

import { parseShareLink, isValidShareLink } from './sharing';
import { 
  deriveWorkspaceKey, 
  deriveFolderKey, 
  deriveDocumentKey,
  storeKeyChain,
  getStoredKeyChain 
} from './keyDerivation';

/**
 * Result of handling a share link
 * @typedef {Object} LinkHandleResult
 * @property {boolean} success - Whether handling succeeded
 * @property {string} [error] - Error message if failed
 * @property {string} entityType - 'workspace' | 'folder' | 'document'
 * @property {string} entityId - Entity ID
 * @property {string} permission - Permission level granted
 * @property {boolean} alreadyHadAccess - Whether user already had access
 * @property {boolean} permissionUpgraded - Whether permission was upgraded
 */

/**
 * Handle an incoming share link
 * 
 * @param {string} link - Share link to handle
 * @param {Object} options - Handler options
 * @param {Function} options.getWorkspace - Get workspace by ID
 * @param {Function} options.addWorkspace - Add workspace to store
 * @param {Function} options.getFolder - Get folder by ID
 * @param {Function} options.addFolder - Add folder to store
 * @param {Function} options.getDocument - Get document by ID
 * @param {Function} options.addDocument - Add document to store
 * @param {Function} options.updatePermission - Update permission cache
 * @param {Function} options.navigate - Navigation function
 * @param {Object} options.identity - Current user identity
 * @returns {Promise<LinkHandleResult>} Result of handling
 */
export async function handleShareLink(link, options) {
  const {
    getWorkspace,
    addWorkspace,
    getFolder,
    addFolder,
    getDocument,
    addDocument,
    updatePermission,
    navigate,
    identity,
  } = options;

  try {
    // 1. Parse the link
    const parsed = parseShareLink(link);
    
    if (!parsed) {
      return { 
        success: false, 
        error: 'Invalid share link format' 
      };
    }

    const { 
      entityType, 
      entityId, 
      permission, 
      embeddedPassword,
      encryptionKey 
    } = parsed;

    // 2. Check if we already have access
    let existingPermission = null;
    let alreadyHadAccess = false;

    if (entityType === 'workspace') {
      const existing = getWorkspace?.(entityId);
      if (existing) {
        alreadyHadAccess = true;
        existingPermission = existing.permission;
      }
    } else if (entityType === 'folder') {
      const existing = getFolder?.(entityId);
      if (existing) {
        alreadyHadAccess = true;
        existingPermission = existing.permission;
      }
    } else if (entityType === 'document') {
      const existing = getDocument?.(entityId);
      if (existing) {
        alreadyHadAccess = true;
        existingPermission = existing.permission;
      }
    }

    // 3. Check if this is a permission upgrade
    const permissionLevels = { owner: 3, editor: 2, viewer: 1 };
    const existingLevel = permissionLevels[existingPermission] || 0;
    const newLevel = permissionLevels[permission] || 0;
    const permissionUpgraded = alreadyHadAccess && newLevel > existingLevel;

    // 4. Derive keys and store
    let keyChain = getStoredKeyChain(entityId);
    
    if (!keyChain || permissionUpgraded) {
      // Need to derive or use provided keys
      const password = embeddedPassword;
      
      if (!password && !encryptionKey) {
        return {
          success: false,
          error: 'Password required to access this link',
          needsPassword: true,
          entityType,
          entityId,
          permission,
        };
      }

      if (entityType === 'workspace') {
        // Use embedded encryption key directly, or derive from password
        const workspaceKey = encryptionKey || await deriveWorkspaceKey(password, entityId);
        keyChain = {
          workspaceKey,
          workspaceId: entityId,
          password: password || null, // May be null when using embedded key
          folderKeys: {},
        };
      } else if (entityType === 'folder') {
        // For folder links, use embedded key or derive from password
        const folderKey = encryptionKey || await deriveWorkspaceKey(password, entityId);
        keyChain = {
          folderKey,
          folderId: entityId,
          password: password || null,
        };
      } else if (entityType === 'document') {
        // For document links, use embedded key or derive from password
        const documentKey = encryptionKey || await deriveWorkspaceKey(password, entityId);
        keyChain = {
          documentKey,
          documentId: entityId,
          password: password || null,
        };
      }

      storeKeyChain(entityId, keyChain);
    }

    // 5. Add entity to local store
    const now = Date.now();
    
    if (entityType === 'workspace' && !alreadyHadAccess) {
      await addWorkspace?.({
        id: entityId,
        name: 'Shared Workspace', // Will be updated on sync
        permission,
        joinedAt: now,
        joinedVia: 'share-link',
      });
    } else if (entityType === 'folder' && !alreadyHadAccess) {
      await addFolder?.({
        id: entityId,
        name: 'Shared Folder', // Will be updated on sync
        permission,
        joinedAt: now,
        joinedVia: 'share-link',
      });
    } else if (entityType === 'document' && !alreadyHadAccess) {
      await addDocument?.({
        id: entityId,
        name: 'Shared Document', // Will be updated on sync
        permission,
        joinedAt: now,
        joinedVia: 'share-link',
      });
    }

    // 6. Update permission cache
    if (permissionUpgraded || !alreadyHadAccess) {
      updatePermission?.(entityType, entityId, permission);
    }

    // 7. Navigate to the entity
    if (navigate) {
      navigate(entityType, entityId);
    }

    return {
      success: true,
      entityType,
      entityId,
      permission,
      alreadyHadAccess,
      permissionUpgraded,
    };

  } catch (error) {
    console.error('[LinkHandler] Failed to handle share link:', error);
    return {
      success: false,
      error: error.message || 'Failed to process share link',
    };
  }
}

/**
 * Handle share link with password prompt
 * Used when link doesn't contain embedded password
 * 
 * @param {string} link - Share link
 * @param {string} password - User-provided password
 * @param {Object} options - Same as handleShareLink options
 * @returns {Promise<LinkHandleResult>}
 */
export async function handleShareLinkWithPassword(link, password, options) {
  try {
    const parsed = parseShareLink(link);
    if (!parsed) {
      return { success: false, error: 'Invalid share link format' };
    }

    // Create new link with password injected
    const linkWithPassword = link.includes('#') 
      ? `${link}&p:${encodeURIComponent(password)}`
      : `${link}#p:${encodeURIComponent(password)}`;

    return handleShareLink(linkWithPassword, options);
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to process share link with password',
    };
  }
}

/**
 * Check if a link is a valid Nightjar share link
 * @param {string} link - Link to check
 * @returns {boolean}
 */
export function isNightjarShareLink(link) {
  if (!link || typeof link !== 'string') return false;
  return link.startsWith('nightjar://');
}

/**
 * Extract entity info from link without fully processing
 * @param {string} link - Share link
 * @returns {Object|null} Entity info
 */
export function peekShareLink(link) {
  try {
    const parsed = parseShareLink(link);
    if (!parsed) return null;

    return {
      entityType: parsed.entityType,
      entityId: parsed.entityId,
      permission: parsed.permission,
      hasPassword: parsed.hasPassword,
      hasEmbeddedPassword: !!parsed.embeddedPassword,
    };
  } catch {
    return null;
  }
}

/**
 * Register handler for incoming share links (deep linking)
 * @param {Function} handler - Function to call with parsed link data
 * @returns {Function} Cleanup function
 */
export function registerLinkHandler(handler) {
  // Handle links from URL on page load
  const handleCurrentUrl = () => {
    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(window.location.search);
    const shareLink = params.get('share');

    if (shareLink && isNightjarShareLink(shareLink)) {
      handler(shareLink);
    }
  };

  // Handle custom protocol from Electron
  if (window.electronAPI?.onShareLink) {
    const cleanup = window.electronAPI.onShareLink((link) => {
      if (isNightjarShareLink(link)) {
        handler(link);
      }
    });
    
    handleCurrentUrl();
    return cleanup;
  }

  // Web fallback: listen for URL changes
  const handlePopState = () => {
    handleCurrentUrl();
  };

  window.addEventListener('popstate', handlePopState);
  handleCurrentUrl();

  return () => {
    window.removeEventListener('popstate', handlePopState);
  };
}

/**
 * Copy share link to clipboard with user feedback
 * @param {string} link - Link to copy
 * @param {Object} options - Options
 * @param {Function} options.onSuccess - Success callback
 * @param {Function} options.onError - Error callback
 */
export async function copyShareLink(link, options = {}) {
  const { onSuccess, onError } = options;

  try {
    await navigator.clipboard.writeText(link);
    onSuccess?.('Link copied to clipboard!');
  } catch (error) {
    console.error('[LinkHandler] Failed to copy:', error);
    
    // Fallback to textarea method
    try {
      const textarea = document.createElement('textarea');
      textarea.value = link;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      onSuccess?.('Link copied to clipboard!');
    } catch (fallbackError) {
      onError?.('Failed to copy link');
    }
  }
}
