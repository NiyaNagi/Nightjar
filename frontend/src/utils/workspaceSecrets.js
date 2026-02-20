/**
 * Workspace Secrets Encryption
 * 
 * Encrypts sensitive fields (password, encryptionKey) before they are
 * persisted to localStorage, and decrypts them when loaded back.
 * 
 * Uses the secureStorage module (NaCl secretbox with session-derived key)
 * for defense-in-depth. If the session key is lost (tab close), secrets
 * become unrecoverable from localStorage alone — the user must re-enter
 * the workspace password or re-join via share link.
 * 
 * Migration: Legacy workspaces that have plaintext secrets are automatically
 * migrated to encrypted storage on first load.
 */

import { secureSet, secureGet, secureRemove } from './secureStorage';

// Key prefix for per-workspace secret blobs in secureStorage
const SECRETS_PREFIX = 'ws_secrets_';

/**
 * Sensitive fields that must be encrypted before localStorage persistence.
 * These fields are stripped from the workspace object written to localStorage
 * and stored separately in secureStorage.
 */
const SENSITIVE_FIELDS = ['password', 'encryptionKey'];

/**
 * Strip sensitive fields from a workspace object for safe localStorage persistence.
 * The stripped secrets are stored in secureStorage under a workspace-scoped key.
 * 
 * @param {Object} workspace - Full workspace object (with secrets in memory)
 * @returns {Object} Sanitized workspace object (secrets replaced with marker)
 */
export function encryptWorkspaceSecrets(workspace) {
  if (!workspace?.id) return workspace;
  
  // Collect secrets to encrypt
  const secrets = {};
  let hasSecrets = false;
  
  for (const field of SENSITIVE_FIELDS) {
    if (workspace[field] != null) {
      secrets[field] = workspace[field];
      hasSecrets = true;
    }
  }
  
  // Store secrets in secureStorage
  if (hasSecrets) {
    secureSet(SECRETS_PREFIX + workspace.id, secrets);
  }
  
  // Return workspace with sensitive fields replaced by a marker
  const sanitized = { ...workspace };
  for (const field of SENSITIVE_FIELDS) {
    if (sanitized[field] != null) {
      sanitized[field] = '__encrypted__';
    }
  }
  
  return sanitized;
}

/**
 * Restore sensitive fields from secureStorage into a workspace object.
 * Handles legacy migration: if the workspace has plaintext secrets
 * (not '__encrypted__'), they are migrated to secureStorage automatically.
 * 
 * @param {Object} workspace - Workspace object loaded from localStorage
 * @returns {Object} Workspace object with decrypted secrets restored
 */
export function decryptWorkspaceSecrets(workspace) {
  if (!workspace?.id) return workspace;
  
  const restored = { ...workspace };
  
  // Check if this workspace has encrypted secrets (marker present)
  const hasMarker = SENSITIVE_FIELDS.some(f => restored[f] === '__encrypted__');
  
  if (hasMarker) {
    // Load secrets from secureStorage
    const secrets = secureGet(SECRETS_PREFIX + workspace.id);
    if (secrets) {
      for (const field of SENSITIVE_FIELDS) {
        if (secrets[field] != null) {
          restored[field] = secrets[field];
        } else if (restored[field] === '__encrypted__') {
          // Secret was not recovered (session key lost) — clear the marker
          restored[field] = null;
        }
      }
    } else {
      // secureGet returned null — session key changed (tab closed/reopened).
      // Clear markers so the workspace still loads (secrets will be re-derived
      // from password entry or share link).
      for (const field of SENSITIVE_FIELDS) {
        if (restored[field] === '__encrypted__') {
          restored[field] = null;
        }
      }
    }
  } else {
    // Legacy workspace with plaintext secrets — migrate to encrypted storage
    const secrets = {};
    let hasSecrets = false;
    
    for (const field of SENSITIVE_FIELDS) {
      if (restored[field] != null && restored[field] !== '') {
        secrets[field] = restored[field];
        hasSecrets = true;
      }
    }
    
    if (hasSecrets) {
      secureSet(SECRETS_PREFIX + workspace.id, secrets);
      // The next persist cycle will write the markers
    }
  }
  
  return restored;
}

/**
 * Encrypt secrets for an array of workspaces (for batch localStorage persist).
 * @param {Array} workspaces - Array of workspace objects
 * @returns {Array} Array of sanitized workspace objects
 */
export function encryptAllWorkspaceSecrets(workspaces) {
  return workspaces.map(encryptWorkspaceSecrets);
}

/**
 * Decrypt secrets for an array of workspaces (for batch localStorage load).
 * @param {Array} workspaces - Array of workspace objects from localStorage
 * @returns {Array} Array of workspace objects with secrets restored
 */
export function decryptAllWorkspaceSecrets(workspaces) {
  return workspaces.map(decryptWorkspaceSecrets);
}

/**
 * Remove encrypted secrets for a workspace (cleanup on workspace deletion).
 * @param {string} workspaceId - Workspace ID
 */
export function removeWorkspaceSecrets(workspaceId) {
  secureRemove(SECRETS_PREFIX + workspaceId);
}
