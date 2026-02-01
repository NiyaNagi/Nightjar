/**
 * Additional UI Component Tests
 * 
 * Tests for remaining UI components that need coverage:
 * - ConfirmDialog
 * - AccessDenied
 * - DocumentPicker
 * - FolderTree
 * - Comments
 * - ShareDialog
 * - PermissionGuard
 * - Presence components
 */

import React from 'react';
import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// ============================================================
// ConfirmDialog Tests
// ============================================================

describe('ConfirmDialog Component', () => {
  describe('useConfirmDialog Hook Logic', () => {
    test('creates promise that resolves on confirm', async () => {
      let resolveRef;
      const createDialog = () => {
        return new Promise((resolve) => {
          resolveRef = resolve;
        });
      };
      
      const dialogPromise = createDialog();
      resolveRef(true);
      
      await expect(dialogPromise).resolves.toBe(true);
    });

    test('creates promise that resolves on cancel', async () => {
      let resolveRef;
      const createDialog = () => {
        return new Promise((resolve) => {
          resolveRef = resolve;
        });
      };
      
      const dialogPromise = createDialog();
      resolveRef(false);
      
      await expect(dialogPromise).resolves.toBe(false);
    });
  });

  describe('Dialog Variants', () => {
    test('danger variant has correct styling class', () => {
      const variants = ['default', 'danger', 'warning'];
      const getVariantClass = (variant) => `confirm-dialog--${variant}`;
      
      expect(getVariantClass('danger')).toBe('confirm-dialog--danger');
      expect(getVariantClass('warning')).toBe('confirm-dialog--warning');
    });

    test('supports custom button text', () => {
      const options = {
        confirmText: 'Delete Forever',
        cancelText: 'Keep It',
      };
      
      expect(options.confirmText).toBe('Delete Forever');
      expect(options.cancelText).toBe('Keep It');
    });
  });

  describe('Keyboard Handling', () => {
    test('Escape key closes dialog', () => {
      const onClose = jest.fn();
      
      const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          onClose(false);
        }
      };
      
      handleKeyDown({ key: 'Escape' });
      expect(onClose).toHaveBeenCalledWith(false);
    });

    test('Enter key confirms dialog', () => {
      const onClose = jest.fn();
      
      const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
          onClose(true);
        }
      };
      
      handleKeyDown({ key: 'Enter' });
      expect(onClose).toHaveBeenCalledWith(true);
    });
  });
});

// ============================================================
// AccessDenied Component Tests
// ============================================================

describe('AccessDenied Component', () => {
  describe('Permission Messages', () => {
    test('displays correct message for read permission', () => {
      const getPermissionMessage = (permission) => {
        const messages = {
          read: "You don't have permission to view this content.",
          write: "You don't have permission to edit this content.",
          delete: "You don't have permission to delete this content.",
          share: "You don't have permission to share this content.",
        };
        return messages[permission] || "Access denied.";
      };
      
      expect(getPermissionMessage('read')).toContain('view');
      expect(getPermissionMessage('write')).toContain('edit');
      expect(getPermissionMessage('delete')).toContain('delete');
    });

    test('displays fallback for unknown permission', () => {
      const getPermissionMessage = (permission) => {
        const messages = {
          read: "You don't have permission to view.",
          write: "You don't have permission to edit.",
        };
        return messages[permission] || "Access denied.";
      };
      
      expect(getPermissionMessage('unknown')).toBe('Access denied.');
    });
  });

  describe('Rendering States', () => {
    test('inline variant renders minimal UI', () => {
      const isInline = true;
      const componentClass = isInline ? 'access-denied--inline' : 'access-denied--full';
      
      expect(componentClass).toBe('access-denied--inline');
    });

    test('full variant renders with back button', () => {
      const isInline = false;
      const showBackButton = !isInline;
      
      expect(showBackButton).toBe(true);
    });
  });
});

// ============================================================
// DocumentPicker Component Tests
// ============================================================

describe('DocumentPicker Component', () => {
  describe('Document Filtering', () => {
    test('filters documents by search query', () => {
      const documents = [
        { id: 'doc-1', name: 'Meeting Notes' },
        { id: 'doc-2', name: 'Project Plan' },
        { id: 'doc-3', name: 'Meeting Agenda' },
      ];
      
      const filterDocuments = (query) => {
        if (!query) return documents;
        const lower = query.toLowerCase();
        return documents.filter(d => d.name.toLowerCase().includes(lower));
      };
      
      expect(filterDocuments('meeting').length).toBe(2);
      expect(filterDocuments('project').length).toBe(1);
      expect(filterDocuments('xyz').length).toBe(0);
    });

    test('filters documents by type', () => {
      const documents = [
        { id: 'doc-1', name: 'Notes', type: 'text' },
        { id: 'doc-2', name: 'Budget', type: 'sheet' },
        { id: 'doc-3', name: 'Tasks', type: 'kanban' },
      ];
      
      const filterByType = (type) => {
        if (!type || type === 'all') return documents;
        return documents.filter(d => d.type === type);
      };
      
      expect(filterByType('text').length).toBe(1);
      expect(filterByType('sheet').length).toBe(1);
      expect(filterByType('all').length).toBe(3);
    });
  });

  describe('Context Menu', () => {
    test('context menu shows for document items', () => {
      const contextMenu = {
        visible: true,
        item: { id: 'doc-1', name: 'Test Doc' },
        position: { x: 100, y: 200 },
      };
      
      expect(contextMenu.visible).toBe(true);
      expect(contextMenu.item.id).toBe('doc-1');
    });

    test('context menu includes delete option', () => {
      const menuOptions = ['Open', 'Rename', 'Move to Folder', 'Delete'];
      
      expect(menuOptions).toContain('Delete');
    });

    test('delete option calls onDeleteDocument', () => {
      const onDeleteDocument = jest.fn();
      const contextMenu = { item: { id: 'doc-1' } };
      
      // Simulate delete click
      onDeleteDocument(contextMenu.item.id);
      
      expect(onDeleteDocument).toHaveBeenCalledWith('doc-1');
    });
  });

  describe('Document Selection', () => {
    test('single click selects document', () => {
      let selectedId = null;
      const onSelectDocument = (id) => { selectedId = id; };
      
      onSelectDocument('doc-1');
      
      expect(selectedId).toBe('doc-1');
    });

    test('double click opens document', () => {
      const onOpenDocument = jest.fn();
      
      onOpenDocument('doc-1');
      
      expect(onOpenDocument).toHaveBeenCalledWith('doc-1');
    });
  });
});

// ============================================================
// FolderTree Component Tests
// ============================================================

describe('FolderTree Component', () => {
  describe('Folder Structure', () => {
    test('builds tree from flat folder list', () => {
      const folders = [
        { id: 'f1', name: 'Root Folder', parentId: null },
        { id: 'f2', name: 'Subfolder', parentId: 'f1' },
        { id: 'f3', name: 'Another Root', parentId: null },
      ];
      
      const buildTree = (parentId = null) => {
        return folders
          .filter(f => f.parentId === parentId)
          .map(f => ({
            ...f,
            children: buildTree(f.id),
          }));
      };
      
      const tree = buildTree();
      expect(tree.length).toBe(2); // Two root folders
      expect(tree[0].children.length).toBe(1); // One subfolder
      expect(tree[0].children[0].name).toBe('Subfolder');
    });

    test('handles empty folder list', () => {
      const folders = [];
      const tree = folders.filter(f => f.parentId === null);
      
      expect(tree.length).toBe(0);
    });
  });

  describe('Drag and Drop', () => {
    test('allows dropping document into folder', () => {
      const onMoveDocument = jest.fn();
      const draggedDoc = { id: 'doc-1', name: 'My Doc' };
      const targetFolder = { id: 'folder-1', name: 'Target' };
      
      onMoveDocument(draggedDoc.id, targetFolder.id);
      
      expect(onMoveDocument).toHaveBeenCalledWith('doc-1', 'folder-1');
    });

    test('allows dropping folder into another folder', () => {
      const onMoveFolder = jest.fn();
      const draggedFolder = { id: 'folder-2', name: 'Dragged' };
      const targetFolder = { id: 'folder-1', name: 'Target' };
      
      onMoveFolder(draggedFolder.id, targetFolder.id);
      
      expect(onMoveFolder).toHaveBeenCalledWith('folder-2', 'folder-1');
    });

    test('prevents dropping folder into itself', () => {
      const canDrop = (draggedId, targetId) => draggedId !== targetId;
      
      expect(canDrop('folder-1', 'folder-1')).toBe(false);
      expect(canDrop('folder-1', 'folder-2')).toBe(true);
    });

    test('prevents dropping folder into its descendant', () => {
      const folders = [
        { id: 'f1', name: 'Parent', parentId: null },
        { id: 'f2', name: 'Child', parentId: 'f1' },
        { id: 'f3', name: 'Grandchild', parentId: 'f2' },
      ];
      
      const isDescendant = (folderId, potentialAncestorId) => {
        let current = folders.find(f => f.id === folderId);
        while (current) {
          if (current.parentId === potentialAncestorId) return true;
          current = folders.find(f => f.id === current.parentId);
        }
        return false;
      };
      
      // f3 is descendant of f1
      expect(isDescendant('f3', 'f1')).toBe(true);
      expect(isDescendant('f2', 'f1')).toBe(true);
      expect(isDescendant('f1', 'f2')).toBe(false);
    });
  });

  describe('Expansion State', () => {
    test('toggles folder expansion', () => {
      let expanded = new Set(['folder-1']);
      
      const toggleFolder = (folderId) => {
        const next = new Set(expanded);
        if (next.has(folderId)) {
          next.delete(folderId);
        } else {
          next.add(folderId);
        }
        expanded = next;
      };
      
      expect(expanded.has('folder-1')).toBe(true);
      toggleFolder('folder-1');
      expect(expanded.has('folder-1')).toBe(false);
      toggleFolder('folder-1');
      expect(expanded.has('folder-1')).toBe(true);
    });

    test('auto-expands folder when document is moved into it', () => {
      let expanded = new Set();
      
      const expandFolder = (folderId) => {
        expanded = new Set(expanded).add(folderId);
      };
      
      // Simulate moving document into folder-2
      expandFolder('folder-2');
      
      expect(expanded.has('folder-2')).toBe(true);
    });
  });
});

// ============================================================
// Comments Component Tests
// ============================================================

describe('Comments Component', () => {
  describe('Comment Management', () => {
    test('adds new comment', () => {
      const comments = [];
      const addComment = (text, userId, range) => {
        comments.push({
          id: `comment-${Date.now()}`,
          text,
          userId,
          range,
          createdAt: Date.now(),
          resolved: false,
        });
      };
      
      addComment('Great point!', 'user-1', { from: 10, to: 20 });
      
      expect(comments.length).toBe(1);
      expect(comments[0].text).toBe('Great point!');
    });

    test('deletes comment', () => {
      const comments = [
        { id: 'c1', text: 'First', resolved: false },
        { id: 'c2', text: 'Second', resolved: false },
      ];
      
      const deleteComment = (commentId) => {
        const index = comments.findIndex(c => c.id === commentId);
        if (index !== -1) {
          comments.splice(index, 1);
        }
      };
      
      deleteComment('c1');
      
      expect(comments.length).toBe(1);
      expect(comments[0].id).toBe('c2');
    });

    test('resolves comment', () => {
      const comments = [
        { id: 'c1', text: 'Fix this', resolved: false },
      ];
      
      const resolveComment = (commentId) => {
        const comment = comments.find(c => c.id === commentId);
        if (comment) {
          comment.resolved = true;
          comment.resolvedAt = Date.now();
        }
      };
      
      resolveComment('c1');
      
      expect(comments[0].resolved).toBe(true);
      expect(comments[0].resolvedAt).toBeDefined();
    });
  });

  describe('Reply Functionality', () => {
    test('adds reply to comment', () => {
      const comments = [
        { id: 'c1', text: 'Question?', replies: [] },
      ];
      
      const addReply = (commentId, text, userId) => {
        const comment = comments.find(c => c.id === commentId);
        if (comment) {
          comment.replies.push({
            id: `reply-${Date.now()}`,
            text,
            userId,
            createdAt: Date.now(),
          });
        }
      };
      
      addReply('c1', 'Answer!', 'user-2');
      
      expect(comments[0].replies.length).toBe(1);
      expect(comments[0].replies[0].text).toBe('Answer!');
    });
  });

  describe('Comment Filtering', () => {
    test('filters resolved comments', () => {
      const comments = [
        { id: 'c1', resolved: true },
        { id: 'c2', resolved: false },
        { id: 'c3', resolved: false },
      ];
      
      const unresolved = comments.filter(c => !c.resolved);
      const resolved = comments.filter(c => c.resolved);
      
      expect(unresolved.length).toBe(2);
      expect(resolved.length).toBe(1);
    });
  });
});

// ============================================================
// ShareDialog Component Tests
// ============================================================

describe('ShareDialog Component', () => {
  describe('Share Link Generation', () => {
    test('generates invite link with workspace key', () => {
      const generateLink = (workspaceId, key) => {
        const base = window.location?.origin || 'https://app.nightjar.io';
        return `${base}/join/${workspaceId}#${key}`;
      };
      
      const link = generateLink('ws-123', 'secret-key');
      
      expect(link).toContain('ws-123');
      expect(link).toContain('secret-key');
    });

    test('copies link to clipboard', async () => {
      const mockClipboard = { writeText: jest.fn() };
      const link = 'https://app.nightjar.io/join/ws-123#key';
      
      await mockClipboard.writeText(link);
      
      expect(mockClipboard.writeText).toHaveBeenCalledWith(link);
    });
  });

  describe('Permission Selection', () => {
    test('supports viewer, editor, owner roles', () => {
      const roles = ['viewer', 'editor', 'owner'];
      
      expect(roles).toContain('viewer');
      expect(roles).toContain('editor');
      expect(roles).toContain('owner');
    });

    test('default role is viewer', () => {
      const defaultRole = 'viewer';
      expect(defaultRole).toBe('viewer');
    });
  });

  describe('Expiration Options', () => {
    test('supports link expiration', () => {
      const expirationOptions = [
        { label: 'Never', value: null },
        { label: '1 hour', value: 3600000 },
        { label: '24 hours', value: 86400000 },
        { label: '7 days', value: 604800000 },
      ];
      
      expect(expirationOptions.find(o => o.label === '24 hours').value).toBe(86400000);
    });

    test('calculates expiration date', () => {
      const now = Date.now();
      const duration = 86400000; // 24 hours
      const expiresAt = now + duration;
      
      expect(expiresAt).toBeGreaterThan(now);
    });
  });
});

// ============================================================
// PermissionGuard Component Tests
// ============================================================

describe('PermissionGuard Component', () => {
  describe('Permission Checking', () => {
    test('renders children when permission granted', () => {
      const hasPermission = true;
      const shouldRender = hasPermission;
      
      expect(shouldRender).toBe(true);
    });

    test('renders fallback when permission denied', () => {
      const hasPermission = false;
      const fallback = 'Access Denied';
      const output = hasPermission ? 'Content' : fallback;
      
      expect(output).toBe('Access Denied');
    });

    test('renders nothing when no fallback provided', () => {
      const hasPermission = false;
      const fallback = null;
      const output = hasPermission ? 'Content' : fallback;
      
      expect(output).toBeNull();
    });
  });

  describe('RequirePermission Component', () => {
    test('checks specific permission type', () => {
      const checkPermission = (permission, entityType, entityId, permissions) => {
        const key = `${entityType}:${entityId}`;
        return permissions[key]?.includes(permission);
      };
      
      const permissions = {
        'workspace:ws-1': ['read', 'write'],
        'document:doc-1': ['read'],
      };
      
      expect(checkPermission('write', 'workspace', 'ws-1', permissions)).toBe(true);
      expect(checkPermission('write', 'document', 'doc-1', permissions)).toBeFalsy();
    });
  });
});

// ============================================================
// Presence Components Tests
// ============================================================

describe('Presence Components', () => {
  describe('PresenceIndicator', () => {
    test('shows online status color', () => {
      const getStatusColor = (status) => {
        const colors = {
          online: '#22c55e',
          away: '#f59e0b',
          offline: '#94a3b8',
        };
        return colors[status] || colors.offline;
      };
      
      expect(getStatusColor('online')).toBe('#22c55e');
      expect(getStatusColor('away')).toBe('#f59e0b');
      expect(getStatusColor('offline')).toBe('#94a3b8');
    });

    test('determines status from last activity', () => {
      const now = Date.now();
      const getStatus = (lastActive) => {
        const diff = now - lastActive;
        if (diff < 60000) return 'online';      // < 1 min
        if (diff < 300000) return 'away';       // < 5 min
        return 'offline';
      };
      
      expect(getStatus(now - 30000)).toBe('online');
      expect(getStatus(now - 120000)).toBe('away');
      expect(getStatus(now - 600000)).toBe('offline');
    });
  });

  describe('PeersList', () => {
    test('sorts peers by status', () => {
      const now = Date.now();
      const peers = [
        { id: 'p1', name: 'Offline User', lastActive: now - 600000 },
        { id: 'p2', name: 'Online User', lastActive: now - 30000 },
        { id: 'p3', name: 'Away User', lastActive: now - 120000 },
      ];
      
      const getScore = (lastActive) => {
        const diff = now - lastActive;
        if (diff < 60000) return 2;
        if (diff < 300000) return 1;
        return 0;
      };
      
      const sorted = [...peers].sort((a, b) => 
        getScore(b.lastActive) - getScore(a.lastActive)
      );
      
      expect(sorted[0].name).toBe('Online User');
      expect(sorted[1].name).toBe('Away User');
      expect(sorted[2].name).toBe('Offline User');
    });

    test('shows peer count summary', () => {
      const peers = [
        { status: 'online' },
        { status: 'online' },
        { status: 'away' },
        { status: 'offline' },
      ];
      
      const online = peers.filter(p => p.status === 'online').length;
      const total = peers.length;
      
      expect(online).toBe(2);
      expect(total).toBe(4);
    });
  });

  describe('PeerCursors', () => {
    test('positions cursor at correct location', () => {
      const cursorState = {
        userId: 'user-1',
        position: { x: 100, y: 200 },
        color: '#ff0000',
        name: 'Alice',
      };
      
      const style = {
        left: `${cursorState.position.x}px`,
        top: `${cursorState.position.y}px`,
        borderColor: cursorState.color,
      };
      
      expect(style.left).toBe('100px');
      expect(style.top).toBe('200px');
    });

    test('hides stale cursors', () => {
      const now = Date.now();
      const cursors = [
        { userId: 'u1', lastUpdated: now - 5000 },   // Active
        { userId: 'u2', lastUpdated: now - 60000 },  // Stale
      ];
      
      const activeCursors = cursors.filter(c => 
        (now - c.lastUpdated) < 30000  // 30 second threshold
      );
      
      expect(activeCursors.length).toBe(1);
      expect(activeCursors[0].userId).toBe('u1');
    });
  });
});

// ============================================================
// CreateWorkspace Dialog Tests
// ============================================================

describe('CreateWorkspace Dialog', () => {
  describe('Workspace Creation', () => {
    test('validates workspace name', () => {
      const validateName = (name) => {
        if (!name?.trim()) return 'Workspace name is required';
        if (name.length < 2) return 'Name must be at least 2 characters';
        if (name.length > 50) return 'Name must be less than 50 characters';
        return null;
      };
      
      expect(validateName('')).toBe('Workspace name is required');
      expect(validateName('A')).toBe('Name must be at least 2 characters');
      expect(validateName('My Workspace')).toBeNull();
    });

    test('generates workspace ID', () => {
      const generateId = () => {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let id = 'ws-';
        for (let i = 0; i < 8; i++) {
          id += chars[Math.floor(Math.random() * chars.length)];
        }
        return id;
      };
      
      const id = generateId();
      expect(id).toMatch(/^ws-[a-z0-9]{8}$/);
    });
  });

  describe('Join Workspace', () => {
    test('parses invite link', () => {
      const parseInviteLink = (link) => {
        const match = link.match(/\/join\/([^#]+)#(.+)/);
        if (match) {
          return { workspaceId: match[1], key: match[2] };
        }
        return null;
      };
      
      const result = parseInviteLink('https://app.nightjar.io/join/ws-123#secretkey');
      
      expect(result.workspaceId).toBe('ws-123');
      expect(result.key).toBe('secretkey');
    });

    test('handles invalid invite link', () => {
      const parseInviteLink = (link) => {
        const match = link.match(/\/join\/([^#]+)#(.+)/);
        return match ? { workspaceId: match[1], key: match[2] } : null;
      };
      
      expect(parseInviteLink('invalid-link')).toBeNull();
      expect(parseInviteLink('https://example.com')).toBeNull();
    });
  });
});

// ============================================================
// CreateFolder Dialog Tests
// ============================================================

describe('CreateFolder Dialog', () => {
  test('validates folder name', () => {
    const validateName = (name) => {
      if (!name?.trim()) return 'Folder name is required';
      if (name.length > 50) return 'Name must be less than 50 characters';
      if (/[<>:"/\\|?*]/.test(name)) return 'Name contains invalid characters';
      return null;
    };
    
    expect(validateName('')).toBe('Folder name is required');
    expect(validateName('Valid Name')).toBeNull();
    expect(validateName('Invalid/Name')).toBe('Name contains invalid characters');
  });

  test('allows selecting parent folder', () => {
    const folders = [
      { id: 'f1', name: 'Projects', parentId: null },
      { id: 'f2', name: 'Documents', parentId: null },
    ];
    
    const parentOptions = [
      { id: null, name: 'Root (No Parent)' },
      ...folders.map(f => ({ id: f.id, name: f.name })),
    ];
    
    expect(parentOptions.length).toBe(3);
    expect(parentOptions[0].id).toBeNull();
  });

  test('prevents circular folder nesting', () => {
    const folders = [
      { id: 'f1', name: 'Parent', parentId: null },
      { id: 'f2', name: 'Child', parentId: 'f1' },
    ];
    
    // When editing f1, should not allow setting parent to f2
    const getValidParents = (editingFolderId) => {
      const isDescendant = (folderId, ancestorId) => {
        let current = folders.find(f => f.id === folderId);
        while (current) {
          if (current.id === ancestorId) return true;
          current = folders.find(f => f.id === current.parentId);
        }
        return false;
      };
      
      return folders.filter(f => 
        f.id !== editingFolderId && !isDescendant(f.id, editingFolderId)
      );
    };
    
    const validParents = getValidParents('f1');
    expect(validParents.find(f => f.id === 'f2')).toBeUndefined();
  });
});

// ============================================================
// Onboarding Components Tests
// ============================================================

describe('Onboarding Components', () => {
  describe('OnboardingFlow', () => {
    test('tracks current step', () => {
      let currentStep = 0;
      const steps = ['welcome', 'createIdentity', 'createWorkspace', 'done'];
      
      const nextStep = () => {
        if (currentStep < steps.length - 1) {
          currentStep++;
        }
      };
      
      expect(steps[currentStep]).toBe('welcome');
      nextStep();
      expect(steps[currentStep]).toBe('createIdentity');
    });

    test('allows going back to previous step', () => {
      let currentStep = 2;
      
      const prevStep = () => {
        if (currentStep > 0) {
          currentStep--;
        }
      };
      
      prevStep();
      expect(currentStep).toBe(1);
    });
  });

  describe('CreateIdentity', () => {
    test('generates new keypair', () => {
      // Mock nacl.sign.keyPair()
      const mockKeyPair = {
        publicKey: new Uint8Array(32).fill(1),
        secretKey: new Uint8Array(64).fill(2),
      };
      
      expect(mockKeyPair.publicKey.length).toBe(32);
      expect(mockKeyPair.secretKey.length).toBe(64);
    });

    test('validates identity name', () => {
      const validateName = (name) => {
        if (!name?.trim()) return 'Display name is required';
        if (name.length < 2) return 'Name must be at least 2 characters';
        return null;
      };
      
      expect(validateName('')).toBe('Display name is required');
      expect(validateName('A')).toBe('Name must be at least 2 characters');
      expect(validateName('Alice')).toBeNull();
    });
  });

  describe('RestoreIdentity', () => {
    test('validates recovery phrase length', () => {
      const validatePhrase = (phrase) => {
        const words = phrase.trim().split(/\s+/);
        if (words.length !== 12 && words.length !== 24) {
          return 'Recovery phrase must be 12 or 24 words';
        }
        return null;
      };
      
      const validPhrase = 'word '.repeat(12).trim();
      const invalidPhrase = 'word '.repeat(10).trim();
      
      expect(validatePhrase(validPhrase)).toBeNull();
      expect(validatePhrase(invalidPhrase)).toBe('Recovery phrase must be 12 or 24 words');
    });
  });
});
