/**
 * Tests for FileStorageContext — mutation functions.
 * 
 * See docs/FILE_STORAGE_SPEC.md §15.2, §15.9
 */

import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { FileStorageProvider, useFileStorage } from '../../frontend/src/contexts/FileStorageContext';

// --- Minimal mock Yjs types ---
class MockYMap {
  constructor() { this._data = new Map(); this._obs = []; }
  get(key) { return this._data.get(key); }
  set(key, value) { this._data.set(key, value); this._notify(); }
  delete(key) { this._data.delete(key); this._notify(); }
  has(key) { return this._data.has(key); }
  forEach(fn) { this._data.forEach(fn); }
  toJSON() { const o = {}; this._data.forEach((v, k) => o[k] = v); return o; }
  observe(fn) { this._obs.push(fn); }
  unobserve(fn) { this._obs = this._obs.filter(f => f !== fn); }
  _notify() { this._obs.forEach(fn => fn()); }
}

class MockYArray {
  constructor() { this._data = []; this._obs = []; }
  toArray() { return [...this._data]; }
  push(items) { this._data.push(...items); this._notify(); }
  insert(index, items) { this._data.splice(index, 0, ...items); this._notify(); }
  delete(index, count) { this._data.splice(index, count); this._notify(); }
  get length() { return this._data.length; }
  toJSON() { return [...this._data]; }
  observe(fn) { this._obs.push(fn); }
  unobserve(fn) { this._obs = this._obs.filter(f => f !== fn); }
  _notify() { this._obs.forEach(fn => fn()); }
}

function makeRefs(fsId) {
  const yFileStorageSystems = new MockYMap();
  const yStorageFiles = new MockYArray();
  const yStorageFolders = new MockYArray();
  const yChunkAvailability = new MockYMap();
  const yFileAuditLog = new MockYArray();

  yFileStorageSystems.set(fsId, {
    id: fsId,
    name: 'Test FS',
    workspaceId: 'ws-1',
    createdAt: Date.now(),
    createdBy: 'pk-user1',
    settings: {},
  });

  return { yFileStorageSystems, yStorageFiles, yStorageFolders, yChunkAvailability, yFileAuditLog };
}

const IDENTITY = { publicKeyBase62: 'pk-user1', displayName: 'Alice', name: 'Alice' };

function makeWrapper(refs, fsId, identity = IDENTITY) {
  return function Wrapper({ children }) {
    return (
      <FileStorageProvider
        fileStorageId={fsId}
        workspaceId="ws-1"
        userIdentity={identity}
        collaborators={[]}
        {...refs}
      >
        {children}
      </FileStorageProvider>
    );
  };
}

describe('FileStorageContext', () => {
  const FS_ID = 'fs-ctx-1';

  it('should throw when used outside provider', () => {
    // renderHook without wrapper
    expect(() => {
      const { result } = renderHook(() => useFileStorage());
      // Access result.current to trigger the throw
      void result.current;
    }).toThrow('useFileStorage must be used within a FileStorageProvider');
  });

  it('should provide context within provider', () => {
    const refs = makeRefs(FS_ID);
    const { result } = renderHook(() => useFileStorage(), {
      wrapper: makeWrapper(refs, FS_ID),
    });
    expect(result.current).toBeDefined();
    expect(result.current.fileStorageId).toBe(FS_ID);
  });

  // --- addFile ---
  it('should add file via addFile', () => {
    const refs = makeRefs(FS_ID);
    const { result } = renderHook(() => useFileStorage(), {
      wrapper: makeWrapper(refs, FS_ID),
    });

    act(() => {
      result.current.addFile({
        id: 'f1',
        fileStorageId: FS_ID,
        name: 'test.txt',
        sizeBytes: 100,
        deletedAt: null,
      });
    });

    expect(refs.yStorageFiles.toArray()).toHaveLength(1);
    expect(refs.yStorageFiles.toArray()[0].name).toBe('test.txt');
  });

  // --- updateFile ---
  it('should update file record', () => {
    const refs = makeRefs(FS_ID);
    refs.yStorageFiles.push([
      { id: 'f1', fileStorageId: FS_ID, name: 'old.txt', sizeBytes: 100, deletedAt: null },
    ]);

    const { result } = renderHook(() => useFileStorage(), {
      wrapper: makeWrapper(refs, FS_ID),
    });

    act(() => {
      result.current.updateFile('f1', { name: 'new.txt' });
    });

    const updated = refs.yStorageFiles.toArray().find(f => f.id === 'f1');
    expect(updated.name).toBe('new.txt');
    expect(updated.updatedAt).toBeDefined();
  });

  // --- deleteFile / restoreFile ---
  it('should soft-delete and restore file', () => {
    const refs = makeRefs(FS_ID);
    refs.yStorageFiles.push([
      { id: 'f1', fileStorageId: FS_ID, name: 'a.txt', sizeBytes: 100, deletedAt: null },
    ]);

    const { result } = renderHook(() => useFileStorage(), {
      wrapper: makeWrapper(refs, FS_ID),
    });

    act(() => result.current.deleteFile('f1'));
    let file = refs.yStorageFiles.toArray().find(f => f.id === 'f1');
    expect(file.deletedAt).not.toBeNull();

    act(() => result.current.restoreFile('f1'));
    file = refs.yStorageFiles.toArray().find(f => f.id === 'f1');
    expect(file.deletedAt).toBeNull();
  });

  // --- permanentlyDeleteFile ---
  it('should permanently delete file and chunk availability', () => {
    const refs = makeRefs(FS_ID);
    refs.yStorageFiles.push([
      { id: 'f1', fileStorageId: FS_ID, name: 'a.txt', sizeBytes: 100, deletedAt: Date.now() },
    ]);
    refs.yChunkAvailability.set('f1:0', { fileId: 'f1', chunkIndex: 0, holders: ['peer1'] });
    refs.yChunkAvailability.set('f1:1', { fileId: 'f1', chunkIndex: 1, holders: ['peer1'] });

    const { result } = renderHook(() => useFileStorage(), {
      wrapper: makeWrapper(refs, FS_ID),
    });

    act(() => result.current.permanentlyDeleteFile('f1'));
    expect(refs.yStorageFiles.toArray().find(f => f.id === 'f1')).toBeUndefined();
    expect(refs.yChunkAvailability.has('f1:0')).toBe(false);
    expect(refs.yChunkAvailability.has('f1:1')).toBe(false);
  });

  // --- permanentlyDeleteFolder ---
  it('should permanently delete folder from yStorageFolders', () => {
    const refs = makeRefs(FS_ID);
    refs.yStorageFolders.push([
      { id: 'd1', fileStorageId: FS_ID, name: 'Old Folder', parentId: null, deletedAt: Date.now() },
    ]);

    const { result } = renderHook(() => useFileStorage(), {
      wrapper: makeWrapper(refs, FS_ID),
    });

    act(() => result.current.permanentlyDeleteFolder('d1'));
    expect(refs.yStorageFolders.toArray().find(f => f.id === 'd1')).toBeUndefined();
  });

  it('should be a no-op for non-existent folder IDs', () => {
    const refs = makeRefs(FS_ID);
    refs.yStorageFolders.push([
      { id: 'd1', fileStorageId: FS_ID, name: 'Keeper', parentId: null, deletedAt: null },
    ]);

    const { result } = renderHook(() => useFileStorage(), {
      wrapper: makeWrapper(refs, FS_ID),
    });

    act(() => result.current.permanentlyDeleteFolder('nonexistent'));
    expect(refs.yStorageFolders.toArray()).toHaveLength(1);
    expect(refs.yStorageFolders.toArray()[0].id).toBe('d1');
  });

  // --- addFolder / updateFolder ---
  it('should add and update folders', () => {
    const refs = makeRefs(FS_ID);
    const { result } = renderHook(() => useFileStorage(), {
      wrapper: makeWrapper(refs, FS_ID),
    });

    act(() => {
      result.current.addFolder({
        id: 'd1',
        fileStorageId: FS_ID,
        name: 'Photos',
        parentId: null,
        deletedAt: null,
      });
    });
    expect(refs.yStorageFolders.toArray()).toHaveLength(1);

    act(() => result.current.updateFolder('d1', { name: 'Images' }));
    expect(refs.yStorageFolders.toArray()[0].name).toBe('Images');
  });

  // --- deleteFolder (recursive) ---
  it('should recursively delete folder and children', () => {
    const refs = makeRefs(FS_ID);
    refs.yStorageFolders.push([
      { id: 'd1', fileStorageId: FS_ID, name: 'Root', parentId: null, deletedAt: null },
      { id: 'd2', fileStorageId: FS_ID, name: 'Child', parentId: 'd1', deletedAt: null },
    ]);
    refs.yStorageFiles.push([
      { id: 'f1', fileStorageId: FS_ID, name: 'a.txt', folderId: 'd1', deletedAt: null },
    ]);

    const { result } = renderHook(() => useFileStorage(), {
      wrapper: makeWrapper(refs, FS_ID),
    });

    act(() => result.current.deleteFolder('d1'));
    const folders = refs.yStorageFolders.toArray();
    const files = refs.yStorageFiles.toArray();
    expect(folders.find(f => f.id === 'd1').deletedAt).not.toBeNull();
    expect(folders.find(f => f.id === 'd2').deletedAt).not.toBeNull();
    expect(files.find(f => f.id === 'f1').deletedAt).not.toBeNull();
  });

  // --- restoreFolder ---
  it('should restore folder and its files', () => {
    const refs = makeRefs(FS_ID);
    const now = Date.now();
    refs.yStorageFolders.push([
      { id: 'd1', fileStorageId: FS_ID, name: 'Root', parentId: null, deletedAt: now },
    ]);
    refs.yStorageFiles.push([
      { id: 'f1', fileStorageId: FS_ID, name: 'a.txt', folderId: 'd1', deletedAt: now },
    ]);

    const { result } = renderHook(() => useFileStorage(), {
      wrapper: makeWrapper(refs, FS_ID),
    });

    act(() => result.current.restoreFolder('d1'));
    expect(refs.yStorageFolders.toArray()[0].deletedAt).toBeNull();
    expect(refs.yStorageFiles.toArray()[0].deletedAt).toBeNull();
  });

  // --- toggleFavorite ---
  it('should toggle favorite on/off', () => {
    const refs = makeRefs(FS_ID);
    refs.yStorageFiles.push([
      { id: 'f1', fileStorageId: FS_ID, name: 'a.txt', favoritedBy: [], deletedAt: null },
    ]);

    const { result } = renderHook(() => useFileStorage(), {
      wrapper: makeWrapper(refs, FS_ID),
    });

    act(() => result.current.toggleFavorite('f1', 'pk-user1'));
    expect(refs.yStorageFiles.toArray()[0].favoritedBy).toContain('pk-user1');

    act(() => result.current.toggleFavorite('f1', 'pk-user1'));
    expect(refs.yStorageFiles.toArray()[0].favoritedBy).not.toContain('pk-user1');
  });

  // --- setChunkAvailability ---
  it('should set chunk availability', () => {
    const refs = makeRefs(FS_ID);
    const { result } = renderHook(() => useFileStorage(), {
      wrapper: makeWrapper(refs, FS_ID),
    });

    act(() => result.current.setChunkAvailability('f1', 0, ['peer1', 'peer2']));
    const entry = refs.yChunkAvailability.get('f1:0');
    expect(entry.holders).toEqual(['peer1', 'peer2']);
  });

  // --- addAuditEntry ---
  it('should add audit log entry', () => {
    const refs = makeRefs(FS_ID);
    const { result } = renderHook(() => useFileStorage(), {
      wrapper: makeWrapper(refs, FS_ID),
    });

    act(() => {
      result.current.addAuditEntry('file_uploaded', 'file', 'f1', 'test.txt', 'Uploaded test.txt');
    });

    const entries = refs.yFileAuditLog.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('file_uploaded');
    expect(entries[0].actorId).toBe('pk-user1');
    expect(entries[0].fileStorageId).toBe(FS_ID);
  });

  // --- updateSettings ---
  it('should update storage settings', () => {
    const refs = makeRefs(FS_ID);
    const { result } = renderHook(() => useFileStorage(), {
      wrapper: makeWrapper(refs, FS_ID),
    });

    act(() => result.current.updateSettings({ maxFileSize: 50 * 1024 * 1024 }));
    const sys = refs.yFileStorageSystems.get(FS_ID);
    expect(sys.settings.maxFileSize).toBe(50 * 1024 * 1024);
  });

  // --- createFileRecord ---
  it('should create file record with correct fields', () => {
    const refs = makeRefs(FS_ID);
    const { result } = renderHook(() => useFileStorage(), {
      wrapper: makeWrapper(refs, FS_ID),
    });

    let record;
    act(() => {
      record = result.current.createFileRecord({
        name: 'photo.jpg',
        sizeBytes: 2048,
        chunkCount: 1,
        chunkHashes: ['abc123'],
        fileHash: 'fullhash',
        folderId: null,
      });
    });

    expect(record).toBeDefined();
    expect(record.name).toBe('photo.jpg');
    expect(record.extension).toBe('jpg');
    expect(record.typeCategory).toBe('image');
    expect(record.uploadedBy).toBe('pk-user1');
    expect(record.fileStorageId).toBe(FS_ID);
    expect(record.favoritedBy).toEqual([]);
    expect(record.version).toBe(1);

    // Should also add audit entry
    const auditEntries = refs.yFileAuditLog.toArray();
    expect(auditEntries.length).toBeGreaterThanOrEqual(1);
    expect(auditEntries[0].action).toBe('file_uploaded');
  });

  // --- createFolderRecord ---
  it('should create folder record with correct fields', () => {
    const refs = makeRefs(FS_ID);
    const { result } = renderHook(() => useFileStorage(), {
      wrapper: makeWrapper(refs, FS_ID),
    });

    let record;
    act(() => {
      record = result.current.createFolderRecord({
        name: 'Documents',
        parentId: null,
        color: 'blue',
        icon: '📄',
      });
    });

    expect(record).toBeDefined();
    expect(record.name).toBe('Documents');
    expect(record.fileStorageId).toBe(FS_ID);
    expect(record.createdBy).toBe('pk-user1');
    expect(record.deletedAt).toBeNull();

    // Should also add audit entry
    const auditEntries = refs.yFileAuditLog.toArray();
    expect(auditEntries.length).toBeGreaterThanOrEqual(1);
    expect(auditEntries[0].action).toBe('folder_created');
  });
});
