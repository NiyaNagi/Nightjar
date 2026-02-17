/**
 * Tests for sidecar folder Yjs functions after Y.Map migration.
 * 
 * Covers:
 * - addFolderToYjs: set-based add with duplicate check
 * - updateFolderInYjs: merge-based update
 * - removeFolderFromYjs: key-based delete
 * - persistMetadataFromYjs: Y.Map iteration
 * - buildSyncManifest: Y.Map folder counting
 */

const Y = require('yjs');

describe('Sidecar Folder Yjs Functions (Y.Map)', () => {
  let docs;
  
  beforeEach(() => {
    docs = new Map();
  });

  afterEach(() => {
    for (const doc of docs.values()) {
      doc.destroy();
    }
  });

  function getOrCreateDoc(roomName) {
    if (!docs.has(roomName)) {
      docs.set(roomName, new Y.Doc());
    }
    return docs.get(roomName);
  }

  // Simulated sidecar functions using Y.Map pattern
  function addFolderToYjs(workspaceId, folder) {
    const roomName = `workspace-meta:${workspaceId}`;
    const doc = docs.get(roomName);
    if (!doc) return false;

    const yFolders = doc.getMap('folders');
    if (yFolders.has(folder.id)) return true; // Already exists
    
    yFolders.set(folder.id, folder);
    return true;
  }

  function updateFolderInYjs(workspaceId, folder) {
    const roomName = `workspace-meta:${workspaceId}`;
    const doc = docs.get(roomName);
    if (!doc) return false;

    const yFolders = doc.getMap('folders');
    if (!yFolders.has(folder.id)) {
      yFolders.set(folder.id, folder);
      return true;
    }
    
    const existing = yFolders.get(folder.id);
    yFolders.set(folder.id, { ...existing, ...folder });
    return true;
  }

  function removeFolderFromYjs(workspaceId, folderId) {
    const roomName = `workspace-meta:${workspaceId}`;
    const doc = docs.get(roomName);
    if (!doc) return false;

    const yFolders = doc.getMap('folders');
    if (!yFolders.has(folderId)) return true;
    
    yFolders.delete(folderId);
    return true;
  }

  function buildSyncManifest(workspaceId) {
    const roomName = `workspace-meta:${workspaceId}`;
    const doc = docs.get(roomName);
    if (!doc) return { documentCount: 0, folderCount: 0, documentIds: [], folderIds: [] };

    const yDocuments = doc.getArray('documents');
    const yFolders = doc.getMap('folders');
    
    const documents = yDocuments.toArray();
    const folderIds = [];
    yFolders.forEach((folder, folderId) => {
      folderIds.push(folder.id || folderId);
    });

    return {
      documentCount: documents.length,
      folderCount: folderIds.length,
      documentIds: documents.map(d => d.id).filter(Boolean),
      folderIds: folderIds.filter(Boolean),
    };
  }

  describe('addFolderToYjs', () => {
    test('adds folder when doc exists', () => {
      getOrCreateDoc('workspace-meta:ws-1');
      const result = addFolderToYjs('ws-1', { id: 'f1', name: 'Test', color: '#ff0000' });
      
      expect(result).toBe(true);
      const yFolders = docs.get('workspace-meta:ws-1').getMap('folders');
      expect(yFolders.get('f1').name).toBe('Test');
      expect(yFolders.get('f1').color).toBe('#ff0000');
    });

    test('skips add when folder already exists', () => {
      const doc = getOrCreateDoc('workspace-meta:ws-1');
      doc.getMap('folders').set('f1', { id: 'f1', name: 'Original' });
      
      const result = addFolderToYjs('ws-1', { id: 'f1', name: 'Duplicate' });
      
      expect(result).toBe(true);
      expect(docs.get('workspace-meta:ws-1').getMap('folders').get('f1').name).toBe('Original');
    });

    test('returns false when doc not found', () => {
      const result = addFolderToYjs('nonexistent', { id: 'f1', name: 'Test' });
      expect(result).toBe(false);
    });
  });

  describe('updateFolderInYjs', () => {
    test('updates existing folder preserving unchanged fields', () => {
      const doc = getOrCreateDoc('workspace-meta:ws-1');
      doc.getMap('folders').set('f1', { id: 'f1', name: 'Docs', color: '#ff0000', parentId: null });
      
      updateFolderInYjs('ws-1', { id: 'f1', color: '#00ff00' });
      
      const folder = docs.get('workspace-meta:ws-1').getMap('folders').get('f1');
      expect(folder.name).toBe('Docs'); // Preserved
      expect(folder.color).toBe('#00ff00'); // Updated
      expect(folder.parentId).toBeNull(); // Preserved
    });

    test('adds folder if not found', () => {
      getOrCreateDoc('workspace-meta:ws-1');
      
      updateFolderInYjs('ws-1', { id: 'f1', name: 'New Folder' });
      
      expect(docs.get('workspace-meta:ws-1').getMap('folders').get('f1').name).toBe('New Folder');
    });
  });

  describe('removeFolderFromYjs', () => {
    test('removes existing folder', () => {
      const doc = getOrCreateDoc('workspace-meta:ws-1');
      doc.getMap('folders').set('f1', { id: 'f1', name: 'Test' });
      
      const result = removeFolderFromYjs('ws-1', 'f1');
      
      expect(result).toBe(true);
      expect(docs.get('workspace-meta:ws-1').getMap('folders').has('f1')).toBe(false);
    });

    test('returns true for already-removed folder', () => {
      getOrCreateDoc('workspace-meta:ws-1');
      
      const result = removeFolderFromYjs('ws-1', 'nonexistent');
      expect(result).toBe(true);
    });
  });

  describe('buildSyncManifest', () => {
    test('counts documents and folders correctly', () => {
      const doc = getOrCreateDoc('workspace-meta:ws-1');
      doc.getArray('documents').push([{ id: 'd1' }, { id: 'd2' }]);
      doc.getMap('folders').set('f1', { id: 'f1' });
      doc.getMap('folders').set('f2', { id: 'f2' });
      doc.getMap('folders').set('f3', { id: 'f3' });
      
      const manifest = buildSyncManifest('ws-1');
      
      expect(manifest.documentCount).toBe(2);
      expect(manifest.folderCount).toBe(3);
      expect(manifest.documentIds).toEqual(['d1', 'd2']);
      expect(manifest.folderIds.sort()).toEqual(['f1', 'f2', 'f3']);
    });

    test('returns empty manifest for missing doc', () => {
      const manifest = buildSyncManifest('nonexistent');
      
      expect(manifest.documentCount).toBe(0);
      expect(manifest.folderCount).toBe(0);
    });

    test('handles empty folders map', () => {
      getOrCreateDoc('workspace-meta:ws-1');
      
      const manifest = buildSyncManifest('ws-1');
      
      expect(manifest.folderCount).toBe(0);
      expect(manifest.folderIds).toEqual([]);
    });
  });
});

describe('Persist Metadata From Yjs (Y.Map)', () => {
  test('iterates Y.Map folders with forEach', () => {
    const doc = new Y.Doc();
    const yFolders = doc.getMap('folders');
    
    yFolders.set('f1', { id: 'f1', name: 'Folder 1', workspaceId: 'ws-1' });
    yFolders.set('f2', { id: 'f2', name: 'Folder 2', workspaceId: 'ws-1' });
    
    const persisted = [];
    yFolders.forEach((folder, folderId) => {
      if (folder && (folder.id || folderId)) {
        persisted.push({
          id: folder.id || folderId,
          name: folder.name || 'Untitled Folder',
          workspaceId: folder.workspaceId,
        });
      }
    });
    
    expect(persisted).toHaveLength(2);
    expect(persisted[0].name).toBe('Folder 1');
    expect(persisted[1].name).toBe('Folder 2');
    
    doc.destroy();
  });

  test('handles folder with missing id by using map key', () => {
    const doc = new Y.Doc();
    const yFolders = doc.getMap('folders');
    
    // Folder without explicit id field
    yFolders.set('f1', { name: 'No ID Folder' });
    
    const persisted = [];
    yFolders.forEach((folder, folderId) => {
      persisted.push({
        id: folder.id || folderId,
        name: folder.name,
      });
    });
    
    expect(persisted[0].id).toBe('f1'); // Falls back to map key
    
    doc.destroy();
  });
});
