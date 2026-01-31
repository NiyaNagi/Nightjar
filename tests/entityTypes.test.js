/**
 * Test Suite: Entity Types and Validation
 * Tests for workspace, folder, and document type validation
 */

import { describe, test, expect } from '@jest/globals';

// Entity types and validation logic
const EntityTypes = {
  WORKSPACE: 'workspace',
  FOLDER: 'folder',
  DOCUMENT: 'document',
};

const PermissionLevels = {
  OWNER: 'owner',
  EDITOR: 'editor',
  VIEWER: 'viewer',
  NONE: 'none',
};

// Validation functions
const isValidEntityType = (type) => {
  return Object.values(EntityTypes).includes(type);
};

const isValidPermissionLevel = (level) => {
  return Object.values(PermissionLevels).includes(level);
};

const isValidId = (id) => {
  if (!id || typeof id !== 'string') return false;
  // IDs should be alphanumeric with dashes, reasonable length
  return /^[a-zA-Z0-9-]{8,64}$/.test(id);
};

const isValidWorkspace = (workspace) => {
  if (!workspace || typeof workspace !== 'object') return false;
  if (!isValidId(workspace.id)) return false;
  if (!workspace.name || typeof workspace.name !== 'string') return false;
  if (workspace.name.length < 1 || workspace.name.length > 200) return false;
  return true;
};

const isValidFolder = (folder) => {
  if (!folder || typeof folder !== 'object') return false;
  if (!isValidId(folder.id)) return false;
  if (!folder.name || typeof folder.name !== 'string') return false;
  if (!isValidId(folder.workspaceId)) return false;
  return true;
};

const isValidDocument = (doc) => {
  if (!doc || typeof doc !== 'object') return false;
  if (!isValidId(doc.id)) return false;
  if (doc.folderId && !isValidId(doc.folderId)) return false;
  if (!isValidId(doc.workspaceId)) return false;
  return true;
};

const isValidCollaborator = (collab) => {
  if (!collab || typeof collab !== 'object') return false;
  if (!collab.publicKeyHex || typeof collab.publicKeyHex !== 'string') return false;
  if (!isValidPermissionLevel(collab.permission)) return false;
  return true;
};

describe('Entity Types', () => {
  describe('EntityTypes constants', () => {
    test('has workspace type', () => {
      expect(EntityTypes.WORKSPACE).toBe('workspace');
    });

    test('has folder type', () => {
      expect(EntityTypes.FOLDER).toBe('folder');
    });

    test('has document type', () => {
      expect(EntityTypes.DOCUMENT).toBe('document');
    });
  });

  describe('isValidEntityType', () => {
    test('accepts valid entity types', () => {
      expect(isValidEntityType('workspace')).toBe(true);
      expect(isValidEntityType('folder')).toBe(true);
      expect(isValidEntityType('document')).toBe(true);
    });

    test('rejects invalid entity types', () => {
      expect(isValidEntityType('invalid')).toBe(false);
      expect(isValidEntityType('')).toBe(false);
      expect(isValidEntityType(null)).toBe(false);
      expect(isValidEntityType(undefined)).toBe(false);
      expect(isValidEntityType(123)).toBe(false);
    });
  });
});

describe('Permission Levels', () => {
  describe('PermissionLevels constants', () => {
    test('has owner level', () => {
      expect(PermissionLevels.OWNER).toBe('owner');
    });

    test('has editor level', () => {
      expect(PermissionLevels.EDITOR).toBe('editor');
    });

    test('has viewer level', () => {
      expect(PermissionLevels.VIEWER).toBe('viewer');
    });

    test('has none level', () => {
      expect(PermissionLevels.NONE).toBe('none');
    });
  });

  describe('isValidPermissionLevel', () => {
    test('accepts valid permission levels', () => {
      expect(isValidPermissionLevel('owner')).toBe(true);
      expect(isValidPermissionLevel('editor')).toBe(true);
      expect(isValidPermissionLevel('viewer')).toBe(true);
      expect(isValidPermissionLevel('none')).toBe(true);
    });

    test('rejects invalid permission levels', () => {
      expect(isValidPermissionLevel('admin')).toBe(false);
      expect(isValidPermissionLevel('read')).toBe(false);
      expect(isValidPermissionLevel('write')).toBe(false);
      expect(isValidPermissionLevel('')).toBe(false);
      expect(isValidPermissionLevel(null)).toBe(false);
    });
  });
});

describe('ID Validation', () => {
  describe('isValidId', () => {
    test('accepts valid UUIDs', () => {
      expect(isValidId('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(true);
    });

    test('accepts valid short IDs', () => {
      expect(isValidId('abc12345')).toBe(true);
    });

    test('accepts alphanumeric with dashes', () => {
      expect(isValidId('workspace-123-abc')).toBe(true);
    });

    test('rejects too short IDs', () => {
      expect(isValidId('abc')).toBe(false);
      expect(isValidId('1234567')).toBe(false);
    });

    test('rejects too long IDs', () => {
      expect(isValidId('a'.repeat(65))).toBe(false);
    });

    test('rejects IDs with special characters', () => {
      expect(isValidId('abc!@#$5678')).toBe(false);
      expect(isValidId('abc_12345')).toBe(false);
      expect(isValidId('abc.12345')).toBe(false);
    });

    test('rejects empty and null', () => {
      expect(isValidId('')).toBe(false);
      expect(isValidId(null)).toBe(false);
      expect(isValidId(undefined)).toBe(false);
    });

    test('rejects non-strings', () => {
      expect(isValidId(12345678)).toBe(false);
      expect(isValidId({})).toBe(false);
      expect(isValidId([])).toBe(false);
    });
  });
});

describe('Workspace Validation', () => {
  describe('isValidWorkspace', () => {
    test('accepts valid workspace', () => {
      const workspace = {
        id: 'ws-12345678',
        name: 'My Workspace',
        createdAt: Date.now(),
      };
      expect(isValidWorkspace(workspace)).toBe(true);
    });

    test('rejects workspace without id', () => {
      expect(isValidWorkspace({ name: 'Test' })).toBe(false);
    });

    test('rejects workspace without name', () => {
      expect(isValidWorkspace({ id: 'ws-12345678' })).toBe(false);
    });

    test('rejects workspace with empty name', () => {
      expect(isValidWorkspace({ id: 'ws-12345678', name: '' })).toBe(false);
    });

    test('rejects workspace with too long name', () => {
      expect(isValidWorkspace({ 
        id: 'ws-12345678', 
        name: 'a'.repeat(201) 
      })).toBe(false);
    });

    test('rejects null/undefined', () => {
      expect(isValidWorkspace(null)).toBe(false);
      expect(isValidWorkspace(undefined)).toBe(false);
    });

    test('rejects non-objects', () => {
      expect(isValidWorkspace('workspace')).toBe(false);
      expect(isValidWorkspace(123)).toBe(false);
    });
  });
});

describe('Folder Validation', () => {
  describe('isValidFolder', () => {
    test('accepts valid folder', () => {
      const folder = {
        id: 'folder-12345678',
        name: 'My Folder',
        workspaceId: 'ws-12345678',
      };
      expect(isValidFolder(folder)).toBe(true);
    });

    test('rejects folder without workspaceId', () => {
      expect(isValidFolder({ 
        id: 'folder-12345678', 
        name: 'Test' 
      })).toBe(false);
    });

    test('rejects folder with invalid workspaceId', () => {
      expect(isValidFolder({ 
        id: 'folder-12345678', 
        name: 'Test',
        workspaceId: 'bad'
      })).toBe(false);
    });

    test('rejects folder without name', () => {
      expect(isValidFolder({ 
        id: 'folder-12345678',
        workspaceId: 'ws-12345678'
      })).toBe(false);
    });
  });
});

describe('Document Validation', () => {
  describe('isValidDocument', () => {
    test('accepts valid document with folder', () => {
      const doc = {
        id: 'doc-12345678',
        folderId: 'folder-12345678',
        workspaceId: 'ws-12345678',
      };
      expect(isValidDocument(doc)).toBe(true);
    });

    test('accepts valid document without folder (root level)', () => {
      const doc = {
        id: 'doc-12345678',
        workspaceId: 'ws-12345678',
      };
      expect(isValidDocument(doc)).toBe(true);
    });

    test('rejects document without workspaceId', () => {
      expect(isValidDocument({ 
        id: 'doc-12345678' 
      })).toBe(false);
    });

    test('rejects document with invalid folderId', () => {
      expect(isValidDocument({ 
        id: 'doc-12345678',
        workspaceId: 'ws-12345678',
        folderId: 'bad'
      })).toBe(false);
    });
  });
});

describe('Collaborator Validation', () => {
  describe('isValidCollaborator', () => {
    test('accepts valid collaborator', () => {
      const collab = {
        publicKeyHex: 'a1b2c3d4e5f6',
        permission: 'editor',
        addedAt: Date.now(),
      };
      expect(isValidCollaborator(collab)).toBe(true);
    });

    test('rejects collaborator without publicKeyHex', () => {
      expect(isValidCollaborator({ 
        permission: 'editor' 
      })).toBe(false);
    });

    test('rejects collaborator without permission', () => {
      expect(isValidCollaborator({ 
        publicKeyHex: 'abc123' 
      })).toBe(false);
    });

    test('rejects collaborator with invalid permission', () => {
      expect(isValidCollaborator({ 
        publicKeyHex: 'abc123',
        permission: 'admin'
      })).toBe(false);
    });
  });
});
