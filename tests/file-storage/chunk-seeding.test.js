/**
 * Tests for useChunkSeeding hook.
 * 
 * Tests proactive chunk seeding, under-replication detection,
 * and bandwidth tracking.
 * 
 * useChunkSeeding is now a thin wrapper around FileTransferContext.
 * These tests verify the wrapper delegates correctly and the context
 * provides the expected seeding behavior.
 * 
 * See docs/FILE_STORAGE_SPEC.md §8, §15.9
 */

import React from 'react';
import { renderHook, act } from '@testing-library/react';

// --- Mock PeerManager ---
const mockPeerManager = {
  registerHandler: jest.fn(),
  unregisterHandler: jest.fn(),
  send: jest.fn(async () => {}),
  broadcast: jest.fn(),
  getConnectedPeers: jest.fn(() => ['peer-A', 'peer-B']),
  isInitialized: true,
  on: jest.fn(),
  off: jest.fn(),
  emit: jest.fn(),
};

jest.mock('../../frontend/src/services/p2p/index.js', () => ({
  getPeerManager: jest.fn(() => mockPeerManager),
}));

// --- Mock IndexedDB ---
const mockChunkStore = {};

const mockObjectStore = {
  put: jest.fn((data, key) => { mockChunkStore[key] = data; }),
  get: jest.fn((key) => {
    const result = mockChunkStore[key] || null;
    const req = { result, onsuccess: null, onerror: null };
    setTimeout(() => { if (req.onsuccess) req.onsuccess(); }, 0);
    return req;
  }),
};

const mockDb = {
  transaction: jest.fn(() => ({
    objectStore: () => mockObjectStore,
    oncomplete: null,
    onerror: null,
  })),
  objectStoreNames: { contains: jest.fn(() => true) },
};

global.indexedDB = {
  open: jest.fn(() => {
    const req = { onupgradeneeded: null, onsuccess: null, onerror: null, result: mockDb };
    setTimeout(() => {
      if (req.onupgradeneeded) req.onupgradeneeded({ target: { result: mockDb } });
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  }),
};

import useChunkSeeding from '../../frontend/src/hooks/useChunkSeeding';
import { FileTransferProvider } from '../../frontend/src/contexts/FileTransferContext';

// --- Mock Yjs types ---
class MockYMap {
  constructor(entries = {}) { this._data = new Map(Object.entries(entries)); this._observers = []; }
  get(key) { return this._data.get(key); }
  set(key, value) { this._data.set(key, value); this._notify(); }
  forEach(fn) { this._data.forEach(fn); }
  observe(fn) { this._observers.push(fn); }
  unobserve(fn) { this._observers = this._observers.filter(o => o !== fn); }
  _notify() { this._observers.forEach(fn => fn()); }
}

class MockYArray {
  constructor(items = []) { this._data = [...items]; this._observers = []; }
  toArray() { return [...this._data]; }
  push(items) { this._data.push(...items); this._notify(); }
  observe(fn) { this._observers.push(fn); }
  unobserve(fn) { this._observers = this._observers.filter(o => o !== fn); }
  _notify() { this._observers.forEach(fn => fn()); }
}

describe('useChunkSeeding', () => {
  let yChunkAvailability;
  let yStorageFiles;

  function makeWrapper(overrides = {}) {
    return function Wrapper({ children }) {
      return (
        <FileTransferProvider
          workspaceId="ws-test"
          userPublicKey="pk-user1"
          yChunkAvailability={yChunkAvailability}
          yStorageFiles={yStorageFiles}
          {...overrides}
        >
          {children}
        </FileTransferProvider>
      );
    };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    Object.keys(mockChunkStore).forEach(k => delete mockChunkStore[k]);
    mockPeerManager.getConnectedPeers.mockReturnValue(['peer-A', 'peer-B']);
    yChunkAvailability = new MockYMap();
    yStorageFiles = new MockYArray();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should start with zero seeding stats', () => {
    const { result } = renderHook(() => useChunkSeeding(), { wrapper: makeWrapper() });
    expect(result.current.seedingStats).toEqual({
      chunksSeeded: 0,
      bytesSeeded: 0,
      seedingActive: false,
      lastSeedRun: null,
      underReplicatedCount: 0,
    });
  });

  it('should expose triggerSeedCycle and bandwidthHistory', () => {
    const { result } = renderHook(() => useChunkSeeding(), { wrapper: makeWrapper() });
    expect(typeof result.current.triggerSeedCycle).toBe('function');
    expect(Array.isArray(result.current.bandwidthHistory)).toBe(true);
  });

  it('should not seed when no peers connected', async () => {
    mockPeerManager.getConnectedPeers.mockReturnValue([]);

    yStorageFiles.push([{ id: 'file-1', name: 'test.txt', chunkCount: 1, deletedAt: null }]);
    yChunkAvailability.set('file-1:0', {
      fileId: 'file-1', chunkIndex: 0,
      holders: ['pk-user1'],
      lastUpdated: Date.now(),
    });

    const { result } = renderHook(() => useChunkSeeding(), { wrapper: makeWrapper() });

    await act(async () => {
      jest.advanceTimersByTime(6000);
    });

    // With 0 peers, effective target is min(5, 0+1) = 1
    // We already have 1 holder, so no seeding needed
    expect(mockPeerManager.send).not.toHaveBeenCalled();
  });

  it('should record bandwidth samples periodically', async () => {
    const { result } = renderHook(() => useChunkSeeding(), { wrapper: makeWrapper() });

    // Advance past a bandwidth sample interval (30s)
    await act(async () => {
      jest.advanceTimersByTime(31000);
    });

    expect(result.current.bandwidthHistory.length).toBeGreaterThanOrEqual(1);
    expect(result.current.bandwidthHistory[0]).toHaveProperty('timestamp');
    expect(result.current.bandwidthHistory[0]).toHaveProperty('bytesSent');
    expect(result.current.bandwidthHistory[0]).toHaveProperty('bytesReceived');
  });

  it('should expose trackReceivedBytes function', () => {
    const { result } = renderHook(() => useChunkSeeding(), { wrapper: makeWrapper() });
    expect(typeof result.current.trackReceivedBytes).toBe('function');
  });

  it('should provide runSeedCycle for manual triggering', () => {
    const { result } = renderHook(() => useChunkSeeding(), { wrapper: makeWrapper() });
    expect(typeof result.current.runSeedCycle).toBe('function');
  });

  it('should detect under-replicated chunks and trigger seeding', async () => {
    // File with 1 chunk, we hold it, only 1 holder, target is 5, 2 peers
    yStorageFiles.push([{ id: 'file-1', name: 'test.txt', chunkCount: 1, deletedAt: null }]);
    yChunkAvailability.set('file-1:0', {
      fileId: 'file-1', chunkIndex: 0,
      holders: ['pk-user1'],
      lastUpdated: Date.now(),
    });

    mockChunkStore['file-1:0'] = {
      encrypted: new Uint8Array([1, 2, 3]),
      nonce: new Uint8Array(24),
    };

    const { result } = renderHook(() => useChunkSeeding(), { wrapper: makeWrapper() });

    // Trigger the initial seed cycle (INITIAL_SEED_DELAY_MS = 5000)
    // We need multiple act() cycles to flush the async seed operations
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        jest.advanceTimersByTime(15000);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      if (result.current.seedingStats.lastSeedRun) break;
    }

    // The seeding loop should have attempted to seed
    // With effective target = min(5, 2+1) = 3, chunk 0 has 1 holder < 3
    expect(result.current.seedingStats.lastSeedRun).not.toBeNull();
  });

  it('should handle chunkAvailability in { holders } object format', async () => {
    yStorageFiles.push([{ id: 'file-1', name: 'test.txt', chunkCount: 2, deletedAt: null }]);
    yChunkAvailability.set('file-1:0', {
      fileId: 'file-1', chunkIndex: 0,
      holders: ['pk-user1'],
      lastUpdated: Date.now(),
    });
    yChunkAvailability.set('file-1:1', {
      fileId: 'file-1', chunkIndex: 1,
      holders: ['pk-user1', 'peer-A', 'peer-B'],
      lastUpdated: Date.now(),
    });

    mockChunkStore['file-1:0'] = {
      encrypted: new Uint8Array([1, 2, 3]),
      nonce: new Uint8Array(24),
    };

    // Should not throw "includes is not a function"
    const { result } = renderHook(() => useChunkSeeding(), { wrapper: makeWrapper() });

    for (let i = 0; i < 5; i++) {
      await act(async () => {
        jest.advanceTimersByTime(15000);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      if (result.current.seedingStats.lastSeedRun) break;
    }

    expect(result.current.seedingStats.lastSeedRun).not.toBeNull();
  });

  it('should not seed chunks we do not hold locally', async () => {
    yStorageFiles.push([{ id: 'file-1', name: 'test.txt', chunkCount: 1, deletedAt: null }]);
    yChunkAvailability.set('file-1:0', {
      fileId: 'file-1', chunkIndex: 0,
      holders: ['peer-A'], // peer-A has it, not us
      lastUpdated: Date.now(),
    });

    const { result } = renderHook(() => useChunkSeeding(), { wrapper: makeWrapper() });

    await act(async () => {
      jest.advanceTimersByTime(6000);
    });

    expect(mockPeerManager.send).not.toHaveBeenCalled();
  });
});
