/**
 * Collaborator Tracking Utility
 * 
 * Tracks historical collaborators in a workspace using a Yjs Y.Array.
 * This enables showing "X online · Y total" peer counts.
 * 
 * Privacy:
 * - Only stores peer-chosen display names
 * - No IP addresses or identifying information
 * - Data is synced via the same E2E encrypted channel as documents
 */

import * as Y from 'yjs';

/**
 * Create or get the collaborators array from a Yjs document
 * @param {Y.Doc} ydoc - The workspace metadata document
 * @returns {Y.Array} The collaborators array
 */
export function getCollaboratorsArray(ydoc) {
  return ydoc.getArray('collaborators');
}

/**
 * Add or update a collaborator in the tracking array
 * @param {Y.Array} collaborators - The collaborators Y.Array
 * @param {Object} collaborator - Collaborator info
 * @param {string} collaborator.peerId - Unique peer ID
 * @param {string} collaborator.name - Display name
 * @param {string} [collaborator.color] - User color
 * @param {string} [collaborator.icon] - User icon/emoji
 */
export function updateCollaborator(collaborators, collaborator) {
  const { peerId, name, color, icon } = collaborator;
  if (!peerId || !name) return;

  const now = Date.now();
  
  // Wrap in Yjs transaction to prevent interleaved operations from other peers
  const doc = collaborators.doc;
  const doUpdate = () => {
    // Find existing entry — iterate snapshot in reverse to avoid index corruption
    let found = false;
    const arr = collaborators.toArray();
    for (let i = arr.length - 1; i >= 0; i--) {
      const item = arr[i];
      if (item && item.peerId === peerId) {
        if (!found) {
          collaborators.delete(i, 1);
          collaborators.insert(i, [{
            peerId,
            name,
            color: color || item.color,
            icon: icon || item.icon,
            lastSeen: now,
            firstSeen: item.firstSeen || now,
          }]);
          found = true;
        } else {
          // Remove duplicate peerId entries
          collaborators.delete(i, 1);
        }
      }
    }

    // Add new entry if not found
    if (!found) {
      collaborators.push([{
        peerId,
        name,
        color,
        icon,
        lastSeen: now,
        firstSeen: now,
      }]);
    }
  };

  if (doc) doc.transact(doUpdate);
  else doUpdate();
}

/**
 * Get all collaborators from the tracking array
 * @param {Y.Array} collaborators - The collaborators Y.Array
 * @returns {Array<Object>} Array of collaborator objects
 */
export function getAllCollaborators(collaborators) {
  const result = [];
  collaborators.forEach((item) => {
    if (item && item.peerId) {
      result.push({ ...item });
    }
  });
  return result;
}

/**
 * Get the total count of unique collaborators
 * @param {Y.Array} collaborators - The collaborators Y.Array
 * @returns {number} Total unique collaborators
 */
export function getCollaboratorCount(collaborators) {
  return getAllCollaborators(collaborators).length;
}

/**
 * Hook to sync awareness state with collaborator tracking
 * Call this whenever awareness state changes
 * 
 * @param {Y.Array} collaborators - The collaborators Y.Array
 * @param {Map} awarenessStates - Awareness states from provider
 * @param {number} myClientId - Own client ID to exclude
 */
export function syncCollaboratorsFromAwareness(collaborators, awarenessStates, myClientId) {
  awarenessStates.forEach((state, clientId) => {
    if (clientId === myClientId) return;
    if (!state?.user) return;

    updateCollaborator(collaborators, {
      peerId: String(clientId),
      name: state.user.name || 'Anonymous',
      color: state.user.color,
      icon: state.user.icon,
    });
  });
}

/**
 * Create a collaborator tracker that automatically syncs with awareness
 * @param {Y.Doc} ydoc - Workspace metadata document
 * @param {Object} awareness - Yjs awareness instance
 * @returns {Object} Tracker with methods and cleanup function
 */
export function createCollaboratorTracker(ydoc, awareness) {
  const collaborators = getCollaboratorsArray(ydoc);
  
  // Track when awareness changes
  const handleAwarenessChange = () => {
    syncCollaboratorsFromAwareness(
      collaborators,
      awareness.getStates(),
      awareness.clientID
    );
  };

  // Subscribe to awareness changes
  awareness.on('change', handleAwarenessChange);
  
  // Initial sync
  handleAwarenessChange();

  return {
    collaborators,
    
    getOnlineCount() {
      // Count peers with recent lastActive (within 2 minutes)
      const now = Date.now();
      const states = awareness.getStates();
      let count = 0;
      states.forEach((state, clientId) => {
        if (clientId === awareness.clientID) return;
        const lastActive = state?.user?.lastActive || state?.lastActive;
        if (lastActive && (now - lastActive) < 120000) {
          count++;
        }
      });
      return count;
    },
    
    getTotalCount() {
      return getCollaboratorCount(collaborators);
    },
    
    getAll() {
      return getAllCollaborators(collaborators);
    },
    
    destroy() {
      awareness.off('change', handleAwarenessChange);
    },
  };
}

export default {
  getCollaboratorsArray,
  updateCollaborator,
  getAllCollaborators,
  getCollaboratorCount,
  syncCollaboratorsFromAwareness,
  createCollaboratorTracker,
};
