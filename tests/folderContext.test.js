/**
 * Test Suite: Folder Context
 * Tests for folder state management and tree operations
 */

import { describe, test, expect, beforeEach } from '@jest/globals';

describe('Folder State', () => {
  let folders;

  beforeEach(() => {
    folders = [];
  });

  describe('Folder CRUD', () => {
    const createFolder = (name, workspaceId, parentId = null) => {
      const id = `folder-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const folder = {
        id,
        name,
        workspaceId,
        parentId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isTrashed: false,
      };
      folders.push(folder);
      return folder;
    };

    const getFolder = (id) => folders.find(f => f.id === id);

    const updateFolder = (id, updates) => {
      const index = folders.findIndex(f => f.id === id);
      if (index === -1) return null;
      
      folders[index] = {
        ...folders[index],
        ...updates,
        updatedAt: Date.now(),
      };
      return folders[index];
    };

    const deleteFolder = (id) => {
      const index = folders.findIndex(f => f.id === id);
      if (index === -1) return false;
      folders.splice(index, 1);
      return true;
    };

    test('creates folder with required fields', () => {
      const folder = createFolder('Documents', 'ws-123');
      
      expect(folder.id).toMatch(/^folder-/);
      expect(folder.name).toBe('Documents');
      expect(folder.workspaceId).toBe('ws-123');
      expect(folder.parentId).toBeNull();
      expect(folder.isTrashed).toBe(false);
    });

    test('creates nested folder', () => {
      const parent = createFolder('Parent', 'ws-123');
      const child = createFolder('Child', 'ws-123', parent.id);
      
      expect(child.parentId).toBe(parent.id);
    });

    test('updates folder name', () => {
      const folder = createFolder('Original', 'ws-123');
      const updated = updateFolder(folder.id, { name: 'Renamed' });
      
      expect(updated.name).toBe('Renamed');
    });

    test('moves folder to new parent', () => {
      const oldParent = createFolder('Old Parent', 'ws-123');
      const newParent = createFolder('New Parent', 'ws-123');
      const child = createFolder('Child', 'ws-123', oldParent.id);
      
      const updated = updateFolder(child.id, { parentId: newParent.id });
      
      expect(updated.parentId).toBe(newParent.id);
    });

    test('deletes folder', () => {
      const folder = createFolder('Test', 'ws-123');
      expect(folders.length).toBe(1);
      
      deleteFolder(folder.id);
      
      expect(folders.length).toBe(0);
    });
  });

  describe('Folder Tree Operations', () => {
    const buildTree = (workspaceId) => {
      const workspaceFolders = folders.filter(f => 
        f.workspaceId === workspaceId && !f.isTrashed
      );
      
      const rootFolders = workspaceFolders.filter(f => !f.parentId);
      
      const addChildren = (folder) => ({
        ...folder,
        children: workspaceFolders
          .filter(f => f.parentId === folder.id)
          .map(addChildren),
      });
      
      return rootFolders.map(addChildren);
    };

    const getAncestors = (folderId) => {
      const ancestors = [];
      let current = folders.find(f => f.id === folderId);
      
      while (current && current.parentId) {
        current = folders.find(f => f.id === current.parentId);
        if (current) ancestors.unshift(current);
      }
      
      return ancestors;
    };

    const getDescendants = (folderId) => {
      const descendants = [];
      const queue = [folderId];
      
      while (queue.length > 0) {
        const currentId = queue.shift();
        const children = folders.filter(f => f.parentId === currentId);
        
        for (const child of children) {
          descendants.push(child);
          queue.push(child.id);
        }
      }
      
      return descendants;
    };

    test('builds folder tree structure', () => {
      folders.push({ id: 'f1', name: 'Root 1', workspaceId: 'ws-1', parentId: null, isTrashed: false });
      folders.push({ id: 'f2', name: 'Child 1', workspaceId: 'ws-1', parentId: 'f1', isTrashed: false });
      folders.push({ id: 'f3', name: 'Root 2', workspaceId: 'ws-1', parentId: null, isTrashed: false });
      
      const tree = buildTree('ws-1');
      
      expect(tree.length).toBe(2); // Two root folders
      expect(tree[0].children.length).toBe(1); // f1 has one child
      expect(tree[1].children.length).toBe(0); // f3 has no children
    });

    test('excludes trashed folders from tree', () => {
      folders.push({ id: 'f1', name: 'Active', workspaceId: 'ws-1', parentId: null, isTrashed: false });
      folders.push({ id: 'f2', name: 'Trashed', workspaceId: 'ws-1', parentId: null, isTrashed: true });
      
      const tree = buildTree('ws-1');
      
      expect(tree.length).toBe(1);
      expect(tree[0].name).toBe('Active');
    });

    test('gets ancestor folders', () => {
      folders.push({ id: 'f1', name: 'Root', workspaceId: 'ws-1', parentId: null });
      folders.push({ id: 'f2', name: 'Child', workspaceId: 'ws-1', parentId: 'f1' });
      folders.push({ id: 'f3', name: 'Grandchild', workspaceId: 'ws-1', parentId: 'f2' });
      
      const ancestors = getAncestors('f3');
      
      expect(ancestors.length).toBe(2);
      expect(ancestors[0].id).toBe('f1'); // Root first
      expect(ancestors[1].id).toBe('f2'); // Then child
    });

    test('returns empty ancestors for root folder', () => {
      folders.push({ id: 'f1', name: 'Root', workspaceId: 'ws-1', parentId: null });
      
      const ancestors = getAncestors('f1');
      
      expect(ancestors.length).toBe(0);
    });

    test('gets descendant folders', () => {
      folders.push({ id: 'f1', name: 'Root', workspaceId: 'ws-1', parentId: null });
      folders.push({ id: 'f2', name: 'Child 1', workspaceId: 'ws-1', parentId: 'f1' });
      folders.push({ id: 'f3', name: 'Child 2', workspaceId: 'ws-1', parentId: 'f1' });
      folders.push({ id: 'f4', name: 'Grandchild', workspaceId: 'ws-1', parentId: 'f2' });
      
      const descendants = getDescendants('f1');
      
      expect(descendants.length).toBe(3);
    });

    test('returns empty descendants for leaf folder', () => {
      folders.push({ id: 'f1', name: 'Leaf', workspaceId: 'ws-1', parentId: null });
      
      const descendants = getDescendants('f1');
      
      expect(descendants.length).toBe(0);
    });
  });

  describe('Trash Operations', () => {
    const trashFolder = (id) => {
      const index = folders.findIndex(f => f.id === id);
      if (index === -1) return false;
      
      folders[index].isTrashed = true;
      folders[index].trashedAt = Date.now();
      return true;
    };

    const restoreFolder = (id) => {
      const index = folders.findIndex(f => f.id === id);
      if (index === -1) return false;
      
      folders[index].isTrashed = false;
      delete folders[index].trashedAt;
      return true;
    };

    const getTrashedFolders = (workspaceId) => {
      return folders.filter(f => 
        f.workspaceId === workspaceId && f.isTrashed
      );
    };

    const emptyTrash = (workspaceId) => {
      const before = folders.length;
      folders = folders.filter(f => 
        !(f.workspaceId === workspaceId && f.isTrashed)
      );
      return before - folders.length;
    };

    test('moves folder to trash', () => {
      folders.push({ id: 'f1', name: 'Test', workspaceId: 'ws-1', isTrashed: false });
      
      const result = trashFolder('f1');
      
      expect(result).toBe(true);
      expect(folders[0].isTrashed).toBe(true);
      expect(folders[0].trashedAt).toBeDefined();
    });

    test('restores folder from trash', () => {
      folders.push({ 
        id: 'f1', 
        name: 'Test', 
        workspaceId: 'ws-1', 
        isTrashed: true,
        trashedAt: Date.now()
      });
      
      const result = restoreFolder('f1');
      
      expect(result).toBe(true);
      expect(folders[0].isTrashed).toBe(false);
      expect(folders[0].trashedAt).toBeUndefined();
    });

    test('gets trashed folders for workspace', () => {
      folders.push({ id: 'f1', name: 'Active', workspaceId: 'ws-1', isTrashed: false });
      folders.push({ id: 'f2', name: 'Trashed', workspaceId: 'ws-1', isTrashed: true });
      folders.push({ id: 'f3', name: 'Other WS', workspaceId: 'ws-2', isTrashed: true });
      
      const trashed = getTrashedFolders('ws-1');
      
      expect(trashed.length).toBe(1);
      expect(trashed[0].id).toBe('f2');
    });

    test('empties trash for workspace', () => {
      folders.push({ id: 'f1', name: 'Active', workspaceId: 'ws-1', isTrashed: false });
      folders.push({ id: 'f2', name: 'Trashed 1', workspaceId: 'ws-1', isTrashed: true });
      folders.push({ id: 'f3', name: 'Trashed 2', workspaceId: 'ws-1', isTrashed: true });
      
      const deleted = emptyTrash('ws-1');
      
      expect(deleted).toBe(2);
      expect(folders.length).toBe(1);
      expect(folders[0].id).toBe('f1');
    });
  });

  describe('Folder Path', () => {
    const getFolderPath = (folderId) => {
      const path = [];
      let current = folders.find(f => f.id === folderId);
      
      while (current) {
        path.unshift(current.name);
        current = current.parentId 
          ? folders.find(f => f.id === current.parentId)
          : null;
      }
      
      return path.join('/');
    };

    test('returns single name for root folder', () => {
      folders.push({ id: 'f1', name: 'Documents', parentId: null });
      
      expect(getFolderPath('f1')).toBe('Documents');
    });

    test('returns full path for nested folder', () => {
      folders.push({ id: 'f1', name: 'Documents', parentId: null });
      folders.push({ id: 'f2', name: 'Projects', parentId: 'f1' });
      folders.push({ id: 'f3', name: 'Nightjar', parentId: 'f2' });
      
      expect(getFolderPath('f3')).toBe('Documents/Projects/Nightjar');
    });
  });
});

describe('Folder Filtering', () => {
  const folders = [
    { id: 'f1', name: 'Documents', workspaceId: 'ws-1', parentId: null },
    { id: 'f2', name: 'Downloads', workspaceId: 'ws-1', parentId: null },
    { id: 'f3', name: 'Desktop', workspaceId: 'ws-1', parentId: null },
    { id: 'f4', name: 'Doc Subfolder', workspaceId: 'ws-1', parentId: 'f1' },
  ];

  describe('Search Filter', () => {
    const filterFolders = (searchTerm) => {
      if (!searchTerm) return folders;
      const term = searchTerm.toLowerCase();
      return folders.filter(f => f.name.toLowerCase().includes(term));
    };

    test('returns all folders for empty search', () => {
      expect(filterFolders('')).toEqual(folders);
    });

    test('filters by name substring', () => {
      const result = filterFolders('doc');
      
      expect(result.length).toBe(2);
      expect(result[0].name).toBe('Documents');
      expect(result[1].name).toBe('Doc Subfolder');
    });

    test('is case insensitive', () => {
      const result = filterFolders('DESKTOP');
      
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('Desktop');
    });

    test('returns empty for no matches', () => {
      expect(filterFolders('xyz').length).toBe(0);
    });
  });
});
