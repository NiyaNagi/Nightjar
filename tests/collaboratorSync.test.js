/**
 * Test Suite: Collaborator Sync
 * Tests for CRDT-based collaborator list management
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import * as Y from 'yjs';
import {
  getCollaboratorsMap,
  addCollaborator,
  updateOnlineStatus,
  getAllCollaborators,
  getCollaboratorsByPermission,
  getOnlineCollaborators,
  getCollaboratorPermission,
  promoteToOwner,
  onCollaboratorsChange,
  syncLocalCollaborator,
  cleanupStaleCollaborators,
} from '../frontend/src/utils/collaboratorSync';

describe('Collaborator Sync', () => {
  let ydoc;
  let collaboratorsMap;

  const testUser1 = {
    publicKey: 'user1-public-key-hex',
    handle: 'Alice',
    color: '#ff0000',
    icon: '🦊',
    permission: 'owner',
    scope: 'workspace',
    scopeId: 'workspace-123',
  };

  const testUser2 = {
    publicKey: 'user2-public-key-hex',
    handle: 'Bob',
    color: '#00ff00',
    icon: '🐸',
    permission: 'editor',
    scope: 'workspace',
    scopeId: 'workspace-123',
  };

  const testUser3 = {
    publicKey: 'user3-public-key-hex',
    handle: 'Charlie',
    color: '#0000ff',
    icon: '🦋',
    permission: 'viewer',
    scope: 'folder',
    scopeId: 'folder-456',
  };

  beforeEach(() => {
    ydoc = new Y.Doc();
    collaboratorsMap = getCollaboratorsMap(ydoc);
  });

  describe('getCollaboratorsMap', () => {
    test('returns Y.Map instance', () => {
      expect(collaboratorsMap).toBeInstanceOf(Y.Map);
    });

    test('returns same map for same ydoc', () => {
      const map2 = getCollaboratorsMap(ydoc);
      expect(collaboratorsMap).toBe(map2);
    });
  });

  describe('addCollaborator', () => {
    test('adds new collaborator to map', () => {
      addCollaborator(collaboratorsMap, testUser1);
      
      const stored = collaboratorsMap.get(testUser1.publicKey);
      expect(stored).toBeDefined();
      expect(stored.handle).toBe('Alice');
      expect(stored.permission).toBe('owner');
    });

    test('sets correct metadata on add', () => {
      addCollaborator(collaboratorsMap, testUser1);
      
      const stored = collaboratorsMap.get(testUser1.publicKey);
      expect(stored.grantedAt).toBeDefined();
      expect(stored.lastSeen).toBeDefined();
      expect(stored.online).toBe(true);
    });

    test('upgrades permission when new is higher', () => {
      // Add as viewer first
      addCollaborator(collaboratorsMap, { ...testUser1, permission: 'viewer' });
      expect(collaboratorsMap.get(testUser1.publicKey).permission).toBe('viewer');
      
      // Upgrade to editor
      addCollaborator(collaboratorsMap, { ...testUser1, permission: 'editor' });
      expect(collaboratorsMap.get(testUser1.publicKey).permission).toBe('editor');
      
      // Upgrade to owner
      addCollaborator(collaboratorsMap, { ...testUser1, permission: 'owner' });
      expect(collaboratorsMap.get(testUser1.publicKey).permission).toBe('owner');
    });

    test('does NOT downgrade permission', () => {
      // Add as owner
      addCollaborator(collaboratorsMap, { ...testUser1, permission: 'owner' });
      expect(collaboratorsMap.get(testUser1.publicKey).permission).toBe('owner');
      
      // Try to downgrade to viewer
      addCollaborator(collaboratorsMap, { ...testUser1, permission: 'viewer' });
      expect(collaboratorsMap.get(testUser1.publicKey).permission).toBe('owner');
    });

    test('throws on missing public key', () => {
      expect(() => addCollaborator(collaboratorsMap, { ...testUser1, publicKey: null }))
        .toThrow('Collaborator public key is required');
    });
  });

  describe('updateOnlineStatus', () => {
    test('updates online status to true', () => {
      addCollaborator(collaboratorsMap, testUser1);
      updateOnlineStatus(collaboratorsMap, testUser1.publicKey, false);
      
      expect(collaboratorsMap.get(testUser1.publicKey).online).toBe(false);
      
      updateOnlineStatus(collaboratorsMap, testUser1.publicKey, true);
      expect(collaboratorsMap.get(testUser1.publicKey).online).toBe(true);
    });

    test('updates lastSeen on status change', () => {
      addCollaborator(collaboratorsMap, testUser1);
      const before = collaboratorsMap.get(testUser1.publicKey).lastSeen;
      
      // Wait a bit to ensure time difference
      const startTime = Date.now();
      while (Date.now() - startTime < 10) {}
      
      updateOnlineStatus(collaboratorsMap, testUser1.publicKey, true);
      const after = collaboratorsMap.get(testUser1.publicKey).lastSeen;
      
      expect(after).toBeGreaterThanOrEqual(before);
    });
  });

  describe('getAllCollaborators', () => {
    test('returns empty array for empty map', () => {
      const all = getAllCollaborators(collaboratorsMap);
      expect(all).toEqual([]);
    });

    test('returns all collaborators as array', () => {
      addCollaborator(collaboratorsMap, testUser1);
      addCollaborator(collaboratorsMap, testUser2);
      addCollaborator(collaboratorsMap, testUser3);
      
      const all = getAllCollaborators(collaboratorsMap);
      expect(all.length).toBe(3);
    });

    test('includes publicKey in returned objects', () => {
      addCollaborator(collaboratorsMap, testUser1);
      
      const all = getAllCollaborators(collaboratorsMap);
      expect(all[0].publicKey).toBe(testUser1.publicKey);
    });
  });

  describe('getCollaboratorsByPermission', () => {
    beforeEach(() => {
      addCollaborator(collaboratorsMap, testUser1); // owner
      addCollaborator(collaboratorsMap, testUser2); // editor
      addCollaborator(collaboratorsMap, testUser3); // viewer
    });

    test('filters by minimum permission level', () => {
      const owners = getCollaboratorsByPermission(collaboratorsMap, 'owner');
      expect(owners.length).toBe(1);
      expect(owners[0].handle).toBe('Alice');
    });

    test('includes higher permissions', () => {
      const editorsAndUp = getCollaboratorsByPermission(collaboratorsMap, 'editor');
      expect(editorsAndUp.length).toBe(2); // Alice (owner) and Bob (editor)
    });

    test('viewer level returns all', () => {
      const all = getCollaboratorsByPermission(collaboratorsMap, 'viewer');
      expect(all.length).toBe(3);
    });
  });

  describe('getOnlineCollaborators', () => {
    test('returns only online collaborators', () => {
      addCollaborator(collaboratorsMap, testUser1);
      addCollaborator(collaboratorsMap, testUser2);
      updateOnlineStatus(collaboratorsMap, testUser2.publicKey, false);
      
      const online = getOnlineCollaborators(collaboratorsMap);
      expect(online.length).toBe(1);
      expect(online[0].handle).toBe('Alice');
    });

    test('returns empty when none online', () => {
      addCollaborator(collaboratorsMap, testUser1);
      updateOnlineStatus(collaboratorsMap, testUser1.publicKey, false);
      
      const online = getOnlineCollaborators(collaboratorsMap);
      expect(online.length).toBe(0);
    });
  });

  describe('getCollaboratorPermission', () => {
    test('returns permission for known user', () => {
      addCollaborator(collaboratorsMap, testUser1);
      
      const perm = getCollaboratorPermission(
        collaboratorsMap, 
        testUser1.publicKey, 
        'workspace', 
        testUser1.scopeId
      );
      expect(perm).toBe('owner');
    });

    test('returns null for unknown user', () => {
      const perm = getCollaboratorPermission(
        collaboratorsMap, 
        'unknown-key', 
        'workspace', 
        'any-id'
      );
      expect(perm).toBeNull();
    });

    test('checks inherited permission from workspace', () => {
      addCollaborator(collaboratorsMap, { ...testUser1, scope: 'workspace' });
      
      // User has workspace access, should work for folder within
      const perm = getCollaboratorPermission(
        collaboratorsMap,
        testUser1.publicKey,
        'folder',
        'some-folder-id'
      );
      expect(perm).toBe('owner');
    });
  });

  describe('promoteToOwner', () => {
    test('owner can promote editor to owner', () => {
      addCollaborator(collaboratorsMap, testUser1); // owner
      addCollaborator(collaboratorsMap, testUser2); // editor
      
      const result = promoteToOwner(
        collaboratorsMap, 
        testUser2.publicKey, 
        testUser1.publicKey
      );
      
      expect(result).toBe(true);
      expect(collaboratorsMap.get(testUser2.publicKey).permission).toBe('owner');
    });

    test('non-owner cannot promote', () => {
      addCollaborator(collaboratorsMap, testUser2); // editor
      addCollaborator(collaboratorsMap, testUser3); // viewer
      
      const result = promoteToOwner(
        collaboratorsMap, 
        testUser3.publicKey, 
        testUser2.publicKey // editor trying to promote
      );
      
      expect(result).toBe(false);
      expect(collaboratorsMap.get(testUser3.publicKey).permission).toBe('viewer');
    });

    test('cannot promote unknown user', () => {
      addCollaborator(collaboratorsMap, testUser1); // owner
      
      const result = promoteToOwner(
        collaboratorsMap, 
        'unknown-key', 
        testUser1.publicKey
      );
      
      expect(result).toBe(false);
    });
  });

  describe('onCollaboratorsChange', () => {
    test('calls callback with initial state', () => {
      addCollaborator(collaboratorsMap, testUser1);
      
      let callCount = 0;
      let lastCollaborators = [];
      
      const cleanup = onCollaboratorsChange(collaboratorsMap, (collaborators) => {
        callCount++;
        lastCollaborators = collaborators;
      });
      
      expect(callCount).toBe(1);
      expect(lastCollaborators.length).toBe(1);
      
      cleanup();
    });

    test('calls callback on changes', () => {
      let callCount = 0;
      
      const cleanup = onCollaboratorsChange(collaboratorsMap, () => {
        callCount++;
      });
      
      expect(callCount).toBe(1); // Initial call
      
      addCollaborator(collaboratorsMap, testUser1);
      expect(callCount).toBe(2); // Called after add
      
      cleanup();
    });

    test('cleanup stops future callbacks', () => {
      let callCount = 0;
      
      const cleanup = onCollaboratorsChange(collaboratorsMap, () => {
        callCount++;
      });
      
      cleanup();
      addCollaborator(collaboratorsMap, testUser1);
      
      expect(callCount).toBe(1); // Only initial call
    });
  });

  describe('syncLocalCollaborator', () => {
    test('adds local user to collaborators', () => {
      const identity = {
        publicKey: 'local-user-key',
        handle: 'LocalUser',
        color: '#purple',
        icon: '🦄',
      };
      
      syncLocalCollaborator(
        collaboratorsMap, 
        identity, 
        'editor', 
        'workspace', 
        'workspace-123'
      );
      
      const local = collaboratorsMap.get(identity.publicKey);
      expect(local).toBeDefined();
      expect(local.handle).toBe('LocalUser');
      expect(local.permission).toBe('editor');
    });
  });

  describe('cleanupStaleCollaborators', () => {
    test('marks stale collaborators as offline', () => {
      addCollaborator(collaboratorsMap, testUser1);
      
      // Manually set lastSeen to 8 days ago
      const stored = collaboratorsMap.get(testUser1.publicKey);
      collaboratorsMap.set(testUser1.publicKey, {
        ...stored,
        lastSeen: Date.now() - 8 * 24 * 60 * 60 * 1000,
        online: true,
      });
      
      cleanupStaleCollaborators(collaboratorsMap);
      
      expect(collaboratorsMap.get(testUser1.publicKey).online).toBe(false);
    });

    test('does not affect recent collaborators', () => {
      addCollaborator(collaboratorsMap, testUser1);
      
      cleanupStaleCollaborators(collaboratorsMap);
      
      expect(collaboratorsMap.get(testUser1.publicKey).online).toBe(true);
    });
  });
});
