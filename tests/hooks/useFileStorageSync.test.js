/**
 * Tests for useFileStorageSync hook.
 * 
 * Tests the Yjs observation and derived state computation.
 * Uses mock Yjs structures to avoid actual P2P connections.
 * 
 * See docs/FILE_STORAGE_SPEC.md §15.9
 */

import { renderHook, act } from '@testing-library/react';
import { useFileStorageSync } from '../../frontend/src/hooks/useFileStorageSync';

// --- Minimal mock Yjs types ---
class MockYMap {
  constructor() {
    this._data = new Map();
    this._observers = [];
  }
  get(key) { return this._data.get(key); }
  set(key, value) {
    this._data.set(key, value);
    this._notify();
  }
  delete(key) {
    this._data.delete(key);
    this._notify();
  }
  has(key) { return this._data.has(key); }
  forEach(fn) { this._data.forEach(fn); }
  toJSON() {
    const obj = {};
    this._data.forEach((v, k) => { obj[k] = v; });
    return obj;
  }
  observe(fn) { this._observers.push(fn); }
  unobserve(fn) { this._observers = this._observers.filter(f => f !== fn); }
  _notify() { this._observers.forEach(fn => fn()); }
}

class MockYArray {
  constructor() {
    this._data = [];
    this._observers = [];
  }
  toArray() { return [...this._data]; }
  push(items) {
    this._data.push(...items);
    this._notify();
  }
  insert(index, items) {
    this._data.splice(index, 0, ...items);
    this._notify();
  }
  delete(index, count) {
    this._data.splice(index, count);
    this._notify();
  }
  get length() { return this._data.length; }
  toJSON() { return [...this._data]; }
  observe(fn) { this._observers.push(fn); }
  unobserve(fn) { this._observers = this._observers.filter(f => f !== fn); }
  _notify() { this._observers.forEach(fn => fn()); }
}

function createMockRefs(fileStorageId) {
  const yFileStorageSystems = new MockYMap();
  const yStorageFiles = new MockYArray();
  const yStorageFolders = new MockYArray();
  const yChunkAvailability = new MockYMap();
  const yFileAuditLog = new MockYArray();

  // Seed a file storage system
  yFileStorageSystems.set(fileStorageId, {
    id: fileStorageId,
    name: 'Test Storage',
    workspaceId: 'ws-1',
    createdAt: Date.now(),
    createdBy: 'user1',
    settings: {},
  });

  return {
    yFileStorageSystems,
    yStorageFiles,
    yStorageFolders,
    yChunkAvailability,
    yFileAuditLog,
  };
}

describe('useFileStorageSync', () => {
  const FILE_STORAGE_ID = 'fs-test-123';

  it('should return current system from Yjs map', () => {
    const refs = createMockRefs(FILE_STORAGE_ID);
    const { result } = renderHook(() => useFileStorageSync(refs, FILE_STORAGE_ID));
    
    expect(result.current.currentSystem).toBeDefined();
    expect(result.current.currentSystem.id).toBe(FILE_STORAGE_ID);
    expect(result.current.currentSystem.name).toBe('Test Storage');
  });

  it('should return empty arrays when no files exist', () => {
    const refs = createMockRefs(FILE_STORAGE_ID);
    const { result } = renderHook(() => useFileStorageSync(refs, FILE_STORAGE_ID));
    
    expect(result.current.activeFiles).toEqual([]);
    expect(result.current.trashedFiles).toEqual([]);
    expect(result.current.activeFolders).toEqual([]);
    expect(result.current.trashedFolders).toEqual([]);
  });

  it('should separate active and trashed files', () => {
    const refs = createMockRefs(FILE_STORAGE_ID);
    refs.yStorageFiles.push([
      { id: 'f1', fileStorageId: FILE_STORAGE_ID, name: 'active.txt', sizeBytes: 100, deletedAt: null },
      { id: 'f2', fileStorageId: FILE_STORAGE_ID, name: 'deleted.txt', sizeBytes: 200, deletedAt: Date.now() },
      { id: 'f3', fileStorageId: 'other-fs', name: 'other.txt', sizeBytes: 300, deletedAt: null },
    ]);

    const { result } = renderHook(() => useFileStorageSync(refs, FILE_STORAGE_ID));
    
    expect(result.current.activeFiles).toHaveLength(1);
    expect(result.current.activeFiles[0].name).toBe('active.txt');
    expect(result.current.trashedFiles).toHaveLength(1);
    expect(result.current.trashedFiles[0].name).toBe('deleted.txt');
  });

  it('should compute total file count and size', () => {
    const refs = createMockRefs(FILE_STORAGE_ID);
    refs.yStorageFiles.push([
      { id: 'f1', fileStorageId: FILE_STORAGE_ID, name: 'a.txt', sizeBytes: 1000, deletedAt: null },
      { id: 'f2', fileStorageId: FILE_STORAGE_ID, name: 'b.jpg', sizeBytes: 2000, deletedAt: null },
    ]);

    const { result } = renderHook(() => useFileStorageSync(refs, FILE_STORAGE_ID));
    
    expect(result.current.totalFileCount).toBe(2);
    expect(result.current.totalSizeBytes).toBe(3000);
  });

  it('should separate active and trashed folders', () => {
    const refs = createMockRefs(FILE_STORAGE_ID);
    refs.yStorageFolders.push([
      { id: 'd1', fileStorageId: FILE_STORAGE_ID, name: 'Photos', deletedAt: null },
      { id: 'd2', fileStorageId: FILE_STORAGE_ID, name: 'Old', deletedAt: Date.now() },
    ]);

    const { result } = renderHook(() => useFileStorageSync(refs, FILE_STORAGE_ID));
    
    expect(result.current.activeFolders).toHaveLength(1);
    expect(result.current.activeFolders[0].name).toBe('Photos');
    expect(result.current.trashedFolders).toHaveLength(1);
    expect(result.current.trashedFolders[0].name).toBe('Old');
  });

  it('should compute size by category', () => {
    const refs = createMockRefs(FILE_STORAGE_ID);
    refs.yStorageFiles.push([
      { id: 'f1', fileStorageId: FILE_STORAGE_ID, name: 'a.jpg', sizeBytes: 1000, typeCategory: 'image', deletedAt: null },
      { id: 'f2', fileStorageId: FILE_STORAGE_ID, name: 'b.png', sizeBytes: 2000, typeCategory: 'image', deletedAt: null },
      { id: 'f3', fileStorageId: FILE_STORAGE_ID, name: 'c.pdf', sizeBytes: 500, typeCategory: 'document', deletedAt: null },
    ]);

    const { result } = renderHook(() => useFileStorageSync(refs, FILE_STORAGE_ID));
    
    expect(result.current.sizeByCategory.image).toBe(3000);
    expect(result.current.sizeByCategory.document).toBe(500);
  });

  it('should return all file storage systems', () => {
    const refs = createMockRefs(FILE_STORAGE_ID);
    refs.yFileStorageSystems.set('fs-other', {
      id: 'fs-other',
      name: 'Other Storage',
    });

    const { result } = renderHook(() => useFileStorageSync(refs, FILE_STORAGE_ID));
    
    expect(result.current.fileStorageSystems).toBeDefined();
    // fileStorageSystems is an array (Object.values)
    expect(result.current.fileStorageSystems.length).toBe(2);
  });

  it('should handle null refs gracefully', () => {
    const refs = {
      yFileStorageSystems: null,
      yStorageFiles: null,
      yStorageFolders: null,
      yChunkAvailability: null,
      yFileAuditLog: null,
    };

    const { result } = renderHook(() => useFileStorageSync(refs, FILE_STORAGE_ID));
    
    expect(result.current.currentSystem).toBeUndefined();
    expect(result.current.activeFiles).toEqual([]);
    expect(result.current.totalFileCount).toBe(0);
  });

  it('should react to Yjs changes', () => {
    const refs = createMockRefs(FILE_STORAGE_ID);
    const { result } = renderHook(() => useFileStorageSync(refs, FILE_STORAGE_ID));
    
    expect(result.current.activeFiles).toHaveLength(0);
    
    // Add a file
    act(() => {
      refs.yStorageFiles.push([
        { id: 'f1', fileStorageId: FILE_STORAGE_ID, name: 'new.txt', sizeBytes: 500, deletedAt: null },
      ]);
    });
    
    expect(result.current.activeFiles).toHaveLength(1);
    expect(result.current.activeFiles[0].name).toBe('new.txt');
  });

  it('should include audit log entries', () => {
    const refs = createMockRefs(FILE_STORAGE_ID);
    refs.yFileAuditLog.push([
      { id: 'a1', fileStorageId: FILE_STORAGE_ID, action: 'file_uploaded', timestamp: Date.now() },
      { id: 'a2', fileStorageId: 'other', action: 'file_uploaded', timestamp: Date.now() },
    ]);

    const { result } = renderHook(() => useFileStorageSync(refs, FILE_STORAGE_ID));
    
    expect(result.current.auditLog).toHaveLength(1);
    expect(result.current.auditLog[0].id).toBe('a1');
  });

  it('should return total folder count', () => {
    const refs = createMockRefs(FILE_STORAGE_ID);
    refs.yStorageFolders.push([
      { id: 'd1', fileStorageId: FILE_STORAGE_ID, name: 'A', deletedAt: null },
      { id: 'd2', fileStorageId: FILE_STORAGE_ID, name: 'B', deletedAt: null },
      { id: 'd3', fileStorageId: FILE_STORAGE_ID, name: 'C', deletedAt: Date.now() },
    ]);

    const { result } = renderHook(() => useFileStorageSync(refs, FILE_STORAGE_ID));
    
    expect(result.current.totalFolderCount).toBe(2); // only active
  });
});
