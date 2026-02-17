/**
 * resolveUserName
 *
 * Shared utility for resolving a public key (hex or base62) to a human-readable
 * display name from the collaborators list.  Used everywhere a user's identity
 * is displayed so that name changes propagate immediately.
 *
 * See docs/INVENTORY_SYSTEM_SPEC.md §11.2.4b
 */

/**
 * Find a collaborator object by public key (hex) OR publicKeyBase62.
 *
 * @param {Array}  collaborators – workspace collaborators list
 * @param {string} key           – publicKey (hex) or publicKeyBase62 to look up
 * @returns {Object|null} the matching collaborator, or null
 */
export function resolveCollaborator(collaborators, key) {
  if (!key || !Array.isArray(collaborators)) return null;
  return collaborators.find(
    c => c.publicKey === key || c.publicKeyBase62 === key
  ) || null;
}

/**
 * Resolve a public key to a display name string.
 *
 * Priority: displayName → name → fallbackName → truncated key + '…'
 *
 * @param {Array}  collaborators – workspace collaborators list
 * @param {string} key           – publicKey (hex) or publicKeyBase62
 * @param {string} [fallbackName] – optional stored snapshot name (e.g. actorName)
 * @returns {string} human-readable name
 */
export function resolveUserName(collaborators, key, fallbackName) {
  if (!key) return fallbackName || 'Unknown';

  const collab = resolveCollaborator(collaborators, key);
  if (collab) {
    return collab.displayName || collab.name || fallbackName || key.slice(0, 8) + '…';
  }

  return fallbackName || key.slice(0, 8) + '…';
}
