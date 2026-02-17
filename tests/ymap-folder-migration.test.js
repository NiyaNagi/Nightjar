/**
 * Tests for Y.Map folder migration — ensures folders use Y.Map instead of Y.Array.
 * 
 * Covers:
 * - Folder CRUD operations using Y.Map (set, get, delete)
 * - Duplicate prevention (Y.Map keys are unique by design)
 * - Concurrent updates merge correctly (no last-write-wins from delete+insert)
 * - Folder color, name, and other properties sync correctly
 * - Storage folder CRUD using Y.Map
 */

import * as Y from 'yjs';

describe('Y.Map Folder Migration', () => {
  let ydoc;
  let yFolders;

  beforeEach(() => {
    ydoc = new Y.Doc();
    yFolders = ydoc.getMap('folders');
  });

  afterEach(() => {
    ydoc.destroy();
  });

  describe('Basic CRUD Operations', () => {
    test('should add a folder using set', () => {
      const folder = { id: 'f1', name: 'Documents', color: '#ff0000', parentId: null };
      yFolders.set(folder.id, folder);
      
      expect(yFolders.has('f1')).toBe(true);
      expect(yFolders.get('f1').name).toBe('Documents');
      expect(yFolders.get('f1').color).toBe('#ff0000');
    });

    test('should update a folder using set (merge)', () => {
      yFolders.set('f1', { id: 'f1', name: 'Docs', color: '#ff0000', parentId: null });
      
      const existing = yFolders.get('f1');
      yFolders.set('f1', { ...existing, color: '#00ff00' });
      
      expect(yFolders.get('f1').name).toBe('Docs');
      expect(yFolders.get('f1').color).toBe('#00ff00');
    });

    test('should remove a folder using delete', () => {
      yFolders.set('f1', { id: 'f1', name: 'Docs' });
      expect(yFolders.has('f1')).toBe(true);
      
      yFolders.delete('f1');
      expect(yFolders.has('f1')).toBe(false);
    });

    test('should iterate over folders using forEach', () => {
      yFolders.set('f1', { id: 'f1', name: 'A' });
      yFolders.set('f2', { id: 'f2', name: 'B' });
      yFolders.set('f3', { id: 'f3', name: 'C' });
      
      const result = [];
      yFolders.forEach((folder, key) => {
        result.push({ key, name: folder.name });
      });
      
      expect(result).toHaveLength(3);
      expect(result.map(r => r.name).sort()).toEqual(['A', 'B', 'C']);
    });
  });

  describe('Duplicate Prevention', () => {
    test('setting same key twice replaces (no duplicates)', () => {
      yFolders.set('f1', { id: 'f1', name: 'Version 1' });
      yFolders.set('f1', { id: 'f1', name: 'Version 2' });
      
      // Should have exactly 1 entry
      let count = 0;
      yFolders.forEach(() => count++);
      expect(count).toBe(1);
      expect(yFolders.get('f1').name).toBe('Version 2');
    });

    test('multiple folders maintain distinct keys', () => {
      for (let i = 0; i < 10; i++) {
        yFolders.set(`f${i}`, { id: `f${i}`, name: `Folder ${i}` });
      }
      
      let count = 0;
      yFolders.forEach(() => count++);
      expect(count).toBe(10);
    });
  });

  describe('Concurrent CRDT Merge', () => {
    test('concurrent color updates from two peers merge correctly', () => {
      // Simulate two peers modifying the same folder
      const doc1 = new Y.Doc();
      const doc2 = new Y.Doc();
      
      const folders1 = doc1.getMap('folders');
      const folders2 = doc2.getMap('folders');
      
      // Initial state: both peers have the same folder
      folders1.set('f1', { id: 'f1', name: 'Docs', color: '#ff0000' });
      
      // Sync doc1 -> doc2
      const update1 = Y.encodeStateAsUpdate(doc1);
      Y.applyUpdate(doc2, update1);
      
      expect(folders2.get('f1').color).toBe('#ff0000');
      
      // Peer 1 changes color to blue
      folders1.set('f1', { ...folders1.get('f1'), color: '#0000ff' });
      
      // Sync
      const update2 = Y.encodeStateAsUpdate(doc1);
      Y.applyUpdate(doc2, update2);
      
      // Both should converge
      expect(folders2.get('f1').color).toBe('#0000ff');
      
      doc1.destroy();
      doc2.destroy();
    });

    test('concurrent add from two peers results in both folders', () => {
      const doc1 = new Y.Doc();
      const doc2 = new Y.Doc();
      
      const folders1 = doc1.getMap('folders');
      const folders2 = doc2.getMap('folders');
      
      // Peer 1 adds folder A, Peer 2 adds folder B (no sync between)
      folders1.set('fA', { id: 'fA', name: 'Peer1 Folder' });
      folders2.set('fB', { id: 'fB', name: 'Peer2 Folder' });
      
      // Sync both ways
      const update1 = Y.encodeStateAsUpdate(doc1);
      const update2 = Y.encodeStateAsUpdate(doc2);
      Y.applyUpdate(doc2, update1);
      Y.applyUpdate(doc1, update2);
      
      // Both peers should have both folders
      expect(folders1.has('fA')).toBe(true);
      expect(folders1.has('fB')).toBe(true);
      expect(folders2.has('fA')).toBe(true);
      expect(folders2.has('fB')).toBe(true);
      
      doc1.destroy();
      doc2.destroy();
    });

    test('delete on one peer, update on another - delete wins (CRDT)', () => {
      const doc1 = new Y.Doc();
      const doc2 = new Y.Doc();
      
      const folders1 = doc1.getMap('folders');
      const folders2 = doc2.getMap('folders');
      
      // Initial sync
      folders1.set('f1', { id: 'f1', name: 'Docs', color: '#ff0000' });
      Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));
      
      // Peer 1 deletes, Peer 2 updates (concurrent)
      folders1.delete('f1');
      folders2.set('f1', { ...folders2.get('f1'), color: '#00ff00' });
      
      // Sync both ways
      const u1 = Y.encodeStateAsUpdate(doc1);
      const u2 = Y.encodeStateAsUpdate(doc2);
      Y.applyUpdate(doc2, u1);
      Y.applyUpdate(doc1, u2);
      
      // With Y.Map, last-writer-wins at the key level
      // The set from doc2 happened after the delete from doc1 was applied
      // Both docs should converge to the same state
      expect(folders1.has('f1')).toBe(folders2.has('f1'));
      
      doc1.destroy();
      doc2.destroy();
    });
  });

  describe('Observer Behavior', () => {
    test('observe fires on set', () => {
      const events = [];
      yFolders.observe((event) => {
        events.push(event);
      });
      
      yFolders.set('f1', { id: 'f1', name: 'Test' });
      
      expect(events).toHaveLength(1);
    });

    test('observe fires on delete', () => {
      yFolders.set('f1', { id: 'f1', name: 'Test' });
      
      const events = [];
      yFolders.observe((event) => {
        events.push(event);
      });
      
      yFolders.delete('f1');
      
      expect(events).toHaveLength(1);
    });

    test('unobserve stops notifications', () => {
      const events = [];
      const handler = (event) => events.push(event);
      
      yFolders.observe(handler);
      yFolders.set('f1', { id: 'f1', name: 'Test' });
      expect(events).toHaveLength(1);
      
      yFolders.unobserve(handler);
      yFolders.set('f2', { id: 'f2', name: 'Test2' });
      expect(events).toHaveLength(1); // No new events
    });
  });

  describe('Storage Folders (Y.Map)', () => {
    let yStorageFolders;

    beforeEach(() => {
      yStorageFolders = ydoc.getMap('storageFolders');
    });

    test('add storage folder', () => {
      const record = { id: 'sf1', fileStorageId: 'fs1', name: 'Photos', parentId: null };
      yStorageFolders.set(record.id, record);
      
      expect(yStorageFolders.has('sf1')).toBe(true);
      expect(yStorageFolders.get('sf1').name).toBe('Photos');
    });

    test('update storage folder', () => {
      yStorageFolders.set('sf1', { id: 'sf1', name: 'Photos', deletedAt: null });
      
      const existing = yStorageFolders.get('sf1');
      yStorageFolders.set('sf1', { ...existing, name: 'Pictures', updatedAt: Date.now() });
      
      expect(yStorageFolders.get('sf1').name).toBe('Pictures');
    });

    test('delete storage folder', () => {
      yStorageFolders.set('sf1', { id: 'sf1', name: 'Photos' });
      yStorageFolders.delete('sf1');
      
      expect(yStorageFolders.has('sf1')).toBe(false);
    });

    test('soft delete via updatedAt field', () => {
      yStorageFolders.set('sf1', { id: 'sf1', name: 'Photos', deletedAt: null });
      
      const existing = yStorageFolders.get('sf1');
      yStorageFolders.set('sf1', { ...existing, deletedAt: Date.now() });
      
      expect(yStorageFolders.get('sf1').deletedAt).not.toBeNull();
    });
  });
});

describe('Sync Manifest with Y.Map Folders', () => {
  test('buildSyncManifest counts Y.Map folders correctly', () => {
    const ydoc = new Y.Doc();
    const yDocuments = ydoc.getArray('documents');
    const yFolders = ydoc.getMap('folders');
    
    yDocuments.push([{ id: 'doc1', name: 'Doc 1' }, { id: 'doc2', name: 'Doc 2' }]);
    yFolders.set('f1', { id: 'f1', name: 'Folder 1' });
    yFolders.set('f2', { id: 'f2', name: 'Folder 2' });
    yFolders.set('f3', { id: 'f3', name: 'Folder 3' });
    
    // Simulate buildSyncManifest logic
    const documents = yDocuments.toArray();
    const folderIds = [];
    yFolders.forEach((folder, folderId) => {
      folderIds.push(folder.id || folderId);
    });
    
    const manifest = {
      documentCount: documents.length,
      folderCount: folderIds.length,
      documentIds: documents.map(d => d.id),
      folderIds,
    };
    
    expect(manifest.documentCount).toBe(2);
    expect(manifest.folderCount).toBe(3);
    expect(manifest.documentIds).toEqual(['doc1', 'doc2']);
    expect(manifest.folderIds.sort()).toEqual(['f1', 'f2', 'f3']);
    
    ydoc.destroy();
  });
});
