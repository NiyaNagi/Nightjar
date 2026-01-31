/**
 * Test Suite: Workspace Context
 * Tests for workspace state management and operations
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';

// Mock workspace state management
describe('Workspace State', () => {
  let workspaces;
  let currentWorkspaceId;

  beforeEach(() => {
    workspaces = [];
    currentWorkspaceId = null;
  });

  describe('Workspace CRUD', () => {
    const createWorkspace = (name, ownerKeyHex) => {
      const id = `ws-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const workspace = {
        id,
        name,
        ownerKeyHex,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isOwned: true,
      };
      workspaces.push(workspace);
      return workspace;
    };

    const getWorkspace = (id) => {
      return workspaces.find(ws => ws.id === id);
    };

    const updateWorkspace = (id, updates) => {
      const index = workspaces.findIndex(ws => ws.id === id);
      if (index === -1) return null;
      
      workspaces[index] = {
        ...workspaces[index],
        ...updates,
        updatedAt: Date.now(),
      };
      return workspaces[index];
    };

    const deleteWorkspace = (id) => {
      const index = workspaces.findIndex(ws => ws.id === id);
      if (index === -1) return false;
      
      workspaces.splice(index, 1);
      return true;
    };

    test('creates workspace with required fields', () => {
      const ws = createWorkspace('Test Workspace', 'owner-key-123');
      
      expect(ws.id).toMatch(/^ws-/);
      expect(ws.name).toBe('Test Workspace');
      expect(ws.ownerKeyHex).toBe('owner-key-123');
      expect(ws.createdAt).toBeDefined();
      expect(ws.isOwned).toBe(true);
    });

    test('generates unique IDs', () => {
      const ws1 = createWorkspace('Workspace 1', 'key1');
      const ws2 = createWorkspace('Workspace 2', 'key2');
      
      expect(ws1.id).not.toBe(ws2.id);
    });

    test('retrieves workspace by ID', () => {
      const created = createWorkspace('Test', 'key');
      const retrieved = getWorkspace(created.id);
      
      expect(retrieved).toEqual(created);
    });

    test('returns undefined for non-existent workspace', () => {
      expect(getWorkspace('non-existent')).toBeUndefined();
    });

    test('updates workspace fields', () => {
      const ws = createWorkspace('Original', 'key');
      const updated = updateWorkspace(ws.id, { name: 'Updated' });
      
      expect(updated.name).toBe('Updated');
      expect(updated.updatedAt).toBeGreaterThanOrEqual(ws.createdAt);
    });

    test('preserves unmodified fields on update', () => {
      const ws = createWorkspace('Test', 'key');
      const updated = updateWorkspace(ws.id, { name: 'Updated' });
      
      expect(updated.ownerKeyHex).toBe('key');
      expect(updated.createdAt).toBe(ws.createdAt);
    });

    test('deletes workspace', () => {
      const ws = createWorkspace('Test', 'key');
      expect(workspaces.length).toBe(1);
      
      const result = deleteWorkspace(ws.id);
      
      expect(result).toBe(true);
      expect(workspaces.length).toBe(0);
    });

    test('returns false when deleting non-existent workspace', () => {
      expect(deleteWorkspace('non-existent')).toBe(false);
    });
  });

  describe('Workspace Selection', () => {
    const setCurrentWorkspace = (id) => {
      const ws = workspaces.find(w => w.id === id);
      if (!ws) return false;
      currentWorkspaceId = id;
      return true;
    };

    const getCurrentWorkspace = () => {
      if (!currentWorkspaceId) return null;
      return workspaces.find(w => w.id === currentWorkspaceId) || null;
    };

    test('selects existing workspace', () => {
      workspaces.push({ id: 'ws-1', name: 'Test' });
      
      const result = setCurrentWorkspace('ws-1');
      
      expect(result).toBe(true);
      expect(currentWorkspaceId).toBe('ws-1');
    });

    test('fails to select non-existent workspace', () => {
      const result = setCurrentWorkspace('non-existent');
      
      expect(result).toBe(false);
      expect(currentWorkspaceId).toBeNull();
    });

    test('gets current workspace', () => {
      workspaces.push({ id: 'ws-1', name: 'Test' });
      currentWorkspaceId = 'ws-1';
      
      const current = getCurrentWorkspace();
      
      expect(current.name).toBe('Test');
    });

    test('returns null when no workspace selected', () => {
      expect(getCurrentWorkspace()).toBeNull();
    });
  });

  describe('Workspace Listing', () => {
    test('lists all workspaces', () => {
      workspaces.push({ id: 'ws-1', name: 'Workspace 1' });
      workspaces.push({ id: 'ws-2', name: 'Workspace 2' });
      
      expect(workspaces.length).toBe(2);
    });

    test('filters owned workspaces', () => {
      workspaces.push({ id: 'ws-1', name: 'Owned', isOwned: true });
      workspaces.push({ id: 'ws-2', name: 'Shared', isOwned: false });
      
      const owned = workspaces.filter(ws => ws.isOwned);
      
      expect(owned.length).toBe(1);
      expect(owned[0].name).toBe('Owned');
    });

    test('filters shared workspaces', () => {
      workspaces.push({ id: 'ws-1', name: 'Owned', isOwned: true });
      workspaces.push({ id: 'ws-2', name: 'Shared', isOwned: false });
      
      const shared = workspaces.filter(ws => !ws.isOwned);
      
      expect(shared.length).toBe(1);
      expect(shared[0].name).toBe('Shared');
    });
  });

  describe('Workspace Sorting', () => {
    test('sorts by name alphabetically', () => {
      workspaces.push({ id: 'ws-1', name: 'Zebra' });
      workspaces.push({ id: 'ws-2', name: 'Alpha' });
      workspaces.push({ id: 'ws-3', name: 'Beta' });
      
      const sorted = [...workspaces].sort((a, b) => a.name.localeCompare(b.name));
      
      expect(sorted[0].name).toBe('Alpha');
      expect(sorted[1].name).toBe('Beta');
      expect(sorted[2].name).toBe('Zebra');
    });

    test('sorts by creation date', () => {
      workspaces.push({ id: 'ws-1', name: 'Oldest', createdAt: 1000 });
      workspaces.push({ id: 'ws-2', name: 'Newest', createdAt: 3000 });
      workspaces.push({ id: 'ws-3', name: 'Middle', createdAt: 2000 });
      
      const sorted = [...workspaces].sort((a, b) => b.createdAt - a.createdAt);
      
      expect(sorted[0].name).toBe('Newest');
      expect(sorted[1].name).toBe('Middle');
      expect(sorted[2].name).toBe('Oldest');
    });
  });
});

describe('Workspace Persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('Save and Load', () => {
    const saveWorkspaces = (workspaces) => {
      localStorage.setItem('Nightjar-workspaces', JSON.stringify(workspaces));
    };

    const loadWorkspaces = () => {
      const stored = localStorage.getItem('Nightjar-workspaces');
      if (!stored) return [];
      try {
        return JSON.parse(stored);
      } catch {
        return [];
      }
    };

    test('saves workspaces to localStorage', () => {
      const workspaces = [{ id: 'ws-1', name: 'Test' }];
      saveWorkspaces(workspaces);
      
      const stored = localStorage.getItem('Nightjar-workspaces');
      expect(stored).toBeDefined();
      expect(JSON.parse(stored)).toEqual(workspaces);
    });

    test('loads workspaces from localStorage', () => {
      localStorage.setItem('Nightjar-workspaces', JSON.stringify([
        { id: 'ws-1', name: 'Test' }
      ]));
      
      const loaded = loadWorkspaces();
      
      expect(loaded.length).toBe(1);
      expect(loaded[0].name).toBe('Test');
    });

    test('returns empty array for missing data', () => {
      const loaded = loadWorkspaces();
      expect(loaded).toEqual([]);
    });

    test('returns empty array for invalid JSON', () => {
      localStorage.setItem('Nightjar-workspaces', 'invalid json');
      
      const loaded = loadWorkspaces();
      expect(loaded).toEqual([]);
    });
  });

  describe('Current Workspace Persistence', () => {
    const saveCurrentWorkspaceId = (id) => {
      if (id) {
        localStorage.setItem('Nightjar-current-workspace', id);
      } else {
        localStorage.removeItem('Nightjar-current-workspace');
      }
    };

    const loadCurrentWorkspaceId = () => {
      return localStorage.getItem('Nightjar-current-workspace');
    };

    test('saves current workspace ID', () => {
      saveCurrentWorkspaceId('ws-123');
      expect(localStorage.getItem('Nightjar-current-workspace')).toBe('ws-123');
    });

    test('loads current workspace ID', () => {
      localStorage.setItem('Nightjar-current-workspace', 'ws-456');
      expect(loadCurrentWorkspaceId()).toBe('ws-456');
    });

    test('removes current workspace ID when null', () => {
      localStorage.setItem('Nightjar-current-workspace', 'ws-123');
      saveCurrentWorkspaceId(null);
      expect(localStorage.getItem('Nightjar-current-workspace')).toBeNull();
    });
  });
});
