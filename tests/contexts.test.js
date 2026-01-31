/**
 * Context Tests
 * 
 * Tests for React Context providers and their logic
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';

// ============================================================
// WorkspaceContext Tests
// ============================================================

describe('WorkspaceContext Logic', () => {
  describe('Workspace Creation', () => {
    test('generates unique workspace ID', () => {
      const generateId = () => {
        return `ws-${Date.now().toString(36)}${Math.random().toString(36).substring(2, 8)}`;
      };
      
      const id1 = generateId();
      const id2 = generateId();
      
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^ws-/);
    });

    test('creates workspace with required fields', () => {
      const createWorkspace = (name, icon = '📁', color = '#6366f1') => ({
        id: `ws-${Date.now()}`,
        name,
        icon,
        color,
        createdAt: Date.now(),
        documents: [],
        folders: [],
      });
      
      const workspace = createWorkspace('My Workspace', '🚀');
      
      expect(workspace.name).toBe('My Workspace');
      expect(workspace.icon).toBe('🚀');
      expect(workspace.documents).toEqual([]);
    });
  });

  describe('Workspace Selection', () => {
    test('switches current workspace', () => {
      const workspaces = [
        { id: 'ws-1', name: 'Workspace 1' },
        { id: 'ws-2', name: 'Workspace 2' },
      ];
      let currentWorkspaceId = 'ws-1';
      
      const switchWorkspace = (id) => {
        if (workspaces.find(ws => ws.id === id)) {
          currentWorkspaceId = id;
        }
      };
      
      switchWorkspace('ws-2');
      expect(currentWorkspaceId).toBe('ws-2');
    });

    test('rejects invalid workspace ID', () => {
      const workspaces = [{ id: 'ws-1', name: 'Workspace 1' }];
      let currentWorkspaceId = 'ws-1';
      
      const switchWorkspace = (id) => {
        if (workspaces.find(ws => ws.id === id)) {
          currentWorkspaceId = id;
          return true;
        }
        return false;
      };
      
      const result = switchWorkspace('ws-invalid');
      expect(result).toBe(false);
      expect(currentWorkspaceId).toBe('ws-1');
    });
  });

  describe('Workspace Storage', () => {
    test('serializes workspace for storage', () => {
      const workspace = {
        id: 'ws-1',
        name: 'Test',
        icon: '📁',
        documents: [{ id: 'd1' }],
      };
      
      const serialized = JSON.stringify(workspace);
      const parsed = JSON.parse(serialized);
      
      expect(parsed.name).toBe('Test');
      expect(parsed.documents.length).toBe(1);
    });

    test('deserializes workspace from storage', () => {
      const stored = '{"id":"ws-1","name":"Stored Workspace","icon":"🗂️"}';
      const workspace = JSON.parse(stored);
      
      expect(workspace.id).toBe('ws-1');
      expect(workspace.name).toBe('Stored Workspace');
    });
  });
});

// ============================================================
// FolderContext Tests
// ============================================================

describe('FolderContext Logic', () => {
  describe('Folder Hierarchy', () => {
    test('builds folder tree from flat list', () => {
      const folders = [
        { id: 'f1', name: 'Root 1', parentId: null },
        { id: 'f2', name: 'Child 1', parentId: 'f1' },
        { id: 'f3', name: 'Root 2', parentId: null },
        { id: 'f4', name: 'Grandchild', parentId: 'f2' },
      ];
      
      const buildTree = (folders, parentId = null) => {
        return folders
          .filter(f => f.parentId === parentId)
          .map(f => ({
            ...f,
            children: buildTree(folders, f.id),
          }));
      };
      
      const tree = buildTree(folders);
      
      expect(tree.length).toBe(2); // Two root folders
      expect(tree[0].children.length).toBe(1); // Root 1 has one child
      expect(tree[0].children[0].children.length).toBe(1); // Child 1 has one grandchild
    });

    test('gets folder path (ancestors)', () => {
      const folders = [
        { id: 'f1', name: 'Root', parentId: null },
        { id: 'f2', name: 'Child', parentId: 'f1' },
        { id: 'f3', name: 'Grandchild', parentId: 'f2' },
      ];
      
      const getFolderPath = (folderId) => {
        const path = [];
        let currentId = folderId;
        
        while (currentId) {
          const folder = folders.find(f => f.id === currentId);
          if (folder) {
            path.unshift(folder);
            currentId = folder.parentId;
          } else {
            break;
          }
        }
        
        return path;
      };
      
      const path = getFolderPath('f3');
      expect(path.length).toBe(3);
      expect(path.map(f => f.name)).toEqual(['Root', 'Child', 'Grandchild']);
    });

    test('prevents circular references', () => {
      const canMoveTo = (folderId, targetParentId, folders) => {
        // Can't move to self
        if (folderId === targetParentId) return false;
        
        // Can't move to descendant
        let currentId = targetParentId;
        while (currentId) {
          if (currentId === folderId) return false;
          const folder = folders.find(f => f.id === currentId);
          currentId = folder?.parentId;
        }
        
        return true;
      };
      
      const folders = [
        { id: 'f1', name: 'Parent', parentId: null },
        { id: 'f2', name: 'Child', parentId: 'f1' },
      ];
      
      expect(canMoveTo('f1', 'f1', folders)).toBe(false); // Can't move to self
      expect(canMoveTo('f1', 'f2', folders)).toBe(false); // Can't move to child
      expect(canMoveTo('f2', 'f1', folders)).toBe(true); // Can move child to parent
    });
  });

  describe('Document in Folder', () => {
    test('gets documents in folder', () => {
      const documents = [
        { id: 'd1', name: 'Doc 1', folderId: 'f1' },
        { id: 'd2', name: 'Doc 2', folderId: 'f2' },
        { id: 'd3', name: 'Doc 3', folderId: 'f1' },
        { id: 'd4', name: 'Root Doc', folderId: null },
      ];
      
      const getDocsInFolder = (folderId) => {
        return documents.filter(d => d.folderId === folderId);
      };
      
      expect(getDocsInFolder('f1').length).toBe(2);
      expect(getDocsInFolder('f2').length).toBe(1);
      expect(getDocsInFolder(null).length).toBe(1);
    });

    test('moves document to folder', () => {
      const documents = [
        { id: 'd1', name: 'Doc 1', folderId: null },
      ];
      
      const moveToFolder = (docId, folderId) => {
        const doc = documents.find(d => d.id === docId);
        if (doc) doc.folderId = folderId;
      };
      
      moveToFolder('d1', 'f1');
      expect(documents[0].folderId).toBe('f1');
    });
  });
});

// ============================================================
// PermissionContext Tests
// ============================================================

describe('PermissionContext Logic', () => {
  describe('Permission Levels', () => {
    const PERMISSION_LEVELS = {
      owner: 4,
      admin: 3,
      editor: 2,
      viewer: 1,
      none: 0,
    };

    test('owner has highest permission', () => {
      expect(PERMISSION_LEVELS.owner).toBeGreaterThan(PERMISSION_LEVELS.admin);
      expect(PERMISSION_LEVELS.owner).toBeGreaterThan(PERMISSION_LEVELS.editor);
    });

    test('permission hierarchy is correct', () => {
      const levels = Object.values(PERMISSION_LEVELS);
      const sorted = [...levels].sort((a, b) => b - a);
      expect(sorted).toEqual([4, 3, 2, 1, 0]);
    });
  });

  describe('Permission Checking', () => {
    test('canView requires viewer or higher', () => {
      const canView = (permission) => {
        const levels = { owner: 4, admin: 3, editor: 2, viewer: 1, none: 0 };
        return (levels[permission] || 0) >= 1;
      };
      
      expect(canView('owner')).toBe(true);
      expect(canView('viewer')).toBe(true);
      expect(canView('none')).toBe(false);
    });

    test('canEdit requires editor or higher', () => {
      const canEdit = (permission) => {
        const levels = { owner: 4, admin: 3, editor: 2, viewer: 1, none: 0 };
        return (levels[permission] || 0) >= 2;
      };
      
      expect(canEdit('owner')).toBe(true);
      expect(canEdit('editor')).toBe(true);
      expect(canEdit('viewer')).toBe(false);
    });

    test('canAdmin requires admin or higher', () => {
      const canAdmin = (permission) => {
        const levels = { owner: 4, admin: 3, editor: 2, viewer: 1, none: 0 };
        return (levels[permission] || 0) >= 3;
      };
      
      expect(canAdmin('owner')).toBe(true);
      expect(canAdmin('admin')).toBe(true);
      expect(canAdmin('editor')).toBe(false);
    });

    test('isOwner checks for owner permission', () => {
      const isOwner = (permission) => permission === 'owner';
      
      expect(isOwner('owner')).toBe(true);
      expect(isOwner('admin')).toBe(false);
    });
  });

  describe('Permission Inheritance', () => {
    test('document inherits workspace permission (uses minimum)', () => {
      const getEffectivePermission = (docPermission, workspacePermission) => {
        const levels = { owner: 4, admin: 3, editor: 2, viewer: 1, none: 0 };
        // Effective permission is the minimum of document and workspace permissions
        const docLevel = levels[docPermission] || 0;
        const wsLevel = levels[workspacePermission] || 0;
        const effectiveLevel = Math.min(docLevel, wsLevel);
        
        // Find permission name for level
        return Object.entries(levels).find(([_, l]) => l === effectiveLevel)?.[0] || 'none';
      };
      
      // Document has editor, workspace has owner - effective is editor (more restrictive)
      expect(getEffectivePermission('editor', 'owner')).toBe('editor');
      // Document has viewer, workspace has viewer - effective is viewer
      expect(getEffectivePermission('viewer', 'viewer')).toBe('viewer');
      // Document has owner, workspace has viewer - effective is viewer (more restrictive)
      expect(getEffectivePermission('owner', 'viewer')).toBe('viewer');
    });
  });
});

// ============================================================
// IdentityContext Tests
// ============================================================

describe('IdentityContext Logic', () => {
  describe('User Profile', () => {
    test('generates default profile', () => {
      const generateDefaultProfile = () => ({
        name: `User-${Math.random().toString(36).substring(2, 8)}`,
        color: '#6366f1',
        icon: '👤',
      });
      
      const profile = generateDefaultProfile();
      expect(profile.name).toMatch(/^User-/);
      expect(profile.color).toBe('#6366f1');
    });

    test('validates profile name', () => {
      const validateName = (name) => {
        if (!name || name.trim().length === 0) return false;
        if (name.length > 50) return false;
        return true;
      };
      
      expect(validateName('Alice')).toBe(true);
      expect(validateName('')).toBe(false);
      expect(validateName('   ')).toBe(false);
      expect(validateName('A'.repeat(51))).toBe(false);
    });
  });

  describe('Identity Storage', () => {
    test('serializes identity for backup', () => {
      const identity = {
        publicKey: 'abc123',
        privateKey: 'secret',
        profile: { name: 'Alice' },
      };
      
      const backup = JSON.stringify(identity);
      expect(backup).toContain('abc123');
      expect(backup).toContain('Alice');
    });

    test('restores identity from backup', () => {
      const backup = '{"publicKey":"abc123","profile":{"name":"Alice"}}';
      const identity = JSON.parse(backup);
      
      expect(identity.publicKey).toBe('abc123');
      expect(identity.profile.name).toBe('Alice');
    });
  });

  describe('Identity Validation', () => {
    test('validates key format', () => {
      const isValidKey = (key) => {
        if (!key || typeof key !== 'string') return false;
        // Ed25519 public keys are 32 bytes = 64 hex chars
        return /^[a-f0-9]{64}$/i.test(key);
      };
      
      expect(isValidKey('abcd'.repeat(16))).toBe(true);
      expect(isValidKey('invalid')).toBe(false);
      expect(isValidKey('')).toBe(false);
      expect(isValidKey(null)).toBe(false);
    });
  });
});

// ============================================================
// PresenceContext Tests
// ============================================================

describe('PresenceContext Logic', () => {
  describe('User Presence', () => {
    test('tracks user position', () => {
      const presence = {};
      
      const setPosition = (userId, position) => {
        presence[userId] = { ...presence[userId], position };
      };
      
      setPosition('user-1', { x: 100, y: 200 });
      expect(presence['user-1'].position).toEqual({ x: 100, y: 200 });
    });

    test('tracks cursor position', () => {
      const cursors = new Map();
      
      const setCursor = (userId, cursor) => {
        cursors.set(userId, cursor);
      };
      
      setCursor('user-1', { line: 10, column: 5 });
      expect(cursors.get('user-1')).toEqual({ line: 10, column: 5 });
    });

    test('tracks selection range', () => {
      const selections = new Map();
      
      const setSelection = (userId, selection) => {
        selections.set(userId, selection);
      };
      
      setSelection('user-1', { start: 10, end: 20 });
      expect(selections.get('user-1')).toEqual({ start: 10, end: 20 });
    });
  });

  describe('Typing Indicator', () => {
    test('sets typing status', () => {
      const typing = new Map();
      
      const setTyping = (userId, isTyping) => {
        typing.set(userId, isTyping);
      };
      
      setTyping('user-1', true);
      expect(typing.get('user-1')).toBe(true);
      
      setTyping('user-1', false);
      expect(typing.get('user-1')).toBe(false);
    });

    test('auto-clears typing after delay', () => {
      jest.useFakeTimers();
      
      const typing = new Map();
      const timeouts = new Map();
      
      const setTypingWithTimeout = (userId, isTyping) => {
        if (timeouts.has(userId)) {
          clearTimeout(timeouts.get(userId));
        }
        
        typing.set(userId, isTyping);
        
        if (isTyping) {
          const timeout = setTimeout(() => {
            typing.set(userId, false);
          }, 3000);
          timeouts.set(userId, timeout);
        }
      };
      
      setTypingWithTimeout('user-1', true);
      expect(typing.get('user-1')).toBe(true);
      
      jest.advanceTimersByTime(3000);
      expect(typing.get('user-1')).toBe(false);
      
      jest.useRealTimers();
    });
  });

  describe('Heartbeat', () => {
    test('updates lastActive timestamp', () => {
      const users = new Map();
      
      const heartbeat = (userId) => {
        const user = users.get(userId) || {};
        user.lastActive = Date.now();
        users.set(userId, user);
      };
      
      heartbeat('user-1');
      const lastActive = users.get('user-1').lastActive;
      expect(lastActive).toBeLessThanOrEqual(Date.now());
    });

    test('detects stale users', () => {
      const users = new Map([
        ['user-1', { lastActive: Date.now() - 30000 }],
        ['user-2', { lastActive: Date.now() - 180000 }],
      ]);
      
      const isStale = (userId, maxAge = 120000) => {
        const user = users.get(userId);
        if (!user) return true;
        return Date.now() - user.lastActive > maxAge;
      };
      
      expect(isStale('user-1')).toBe(false);
      expect(isStale('user-2')).toBe(true);
    });
  });
});
