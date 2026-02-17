/**
 * Tests for useFileTransfer hook.
 * 
 * Tests chunk serving, availability announcements, and local chunk counting.
 * Now tests Hyperswarm PeerManager-based transfer (not awareness).
 * 
 * See docs/FILE_STORAGE_SPEC.md §8, §15.9
 */

import { renderHook, act } from '@testing-library/react';
import React from 'react';

// --- Mock PeerManager ---
const mockRegisteredHandlers = {};
const mockPeerManager = {
  registerHandler: jest.fn((type, handler) => { mockRegisteredHandlers[type] = handler; }),
  unregisterHandler: jest.fn((type) => { delete mockRegisteredHandlers[type]; }),
  send: jest.fn(async () => {}),
  broadcast: jest.fn(),
  getConnectedPeers: jest.fn(() => []),
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

const mockTransaction = jest.fn(() => ({
  objectStore: () => mockObjectStore,
  get oncomplete() { return null; },
  set oncomplete(fn) { if (fn) setTimeout(fn, 0); },
  get onerror() { return null; },
  set onerror(fn) {},
}));

const mockDb = { transaction: mockTransaction };

global.indexedDB = {
  open: jest.fn(() => {
    const req = { onupgradeneeded: null, onsuccess: null, onerror: null, result: mockDb };
    setTimeout(() => { if (req.onsuccess) req.onsuccess(); }, 0);
    return req;
  }),
};

import useFileTransfer from '../../frontend/src/hooks/useFileTransfer';
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

// --- Provider wrapper for renderHook ---
const yChunkAvailability = new MockYMap();
const yStorageFiles = new MockYArray();

function ProviderWrapper({ children }) {
  return (
    <FileTransferProvider
      workspaceId="ws-test"
      userPublicKey="pk-user1"
      yChunkAvailability={yChunkAvailability}
      yStorageFiles={yStorageFiles}
    >
      {children}
    </FileTransferProvider>
  );
}

describe('useFileTransfer', () => {
  const defaultParams = {
    workspaceId: 'ws-test',
    userPublicKey: 'pk-user1',
    workspaceProvider: null,
    setChunkAvailability: jest.fn(),
  };

  beforeEach(() => {
    // Seed mock IDB with some chunks
    mockChunkStore['file-1:0'] = {
      encrypted: new Uint8Array([1, 2, 3]),
      nonce: new Uint8Array(24),
      fileId: 'file-1',
      chunkIndex: 0,
    };
    mockChunkStore['file-1:1'] = {
      encrypted: new Uint8Array([4, 5, 6]),
      nonce: new Uint8Array(24),
      fileId: 'file-1',
      chunkIndex: 1,
    };
    // Reset mock handlers
    Object.keys(mockRegisteredHandlers).forEach(k => delete mockRegisteredHandlers[k]);
    mockPeerManager.registerHandler.mockClear();
    mockPeerManager.unregisterHandler.mockClear();
    mockPeerManager.send.mockClear();
    mockPeerManager.getConnectedPeers.mockReturnValue([]);
  });

  afterEach(() => {
    jest.clearAllMocks();
    Object.keys(mockChunkStore).forEach(k => delete mockChunkStore[k]);
  });

  it('should start with zero transfer stats', () => {
    const { result } = renderHook(() => useFileTransfer(defaultParams), { wrapper: ProviderWrapper });
    expect(result.current.transferStats).toEqual({
      chunksServed: 0,
      chunksFetched: 0,
      bytesServed: 0,
      bytesFetched: 0,
    });
  });

  it('should expose handleChunkRequest, requestChunkFromPeer, announceAvailability, getLocalChunkCount', () => {
    const { result } = renderHook(() => useFileTransfer(defaultParams), { wrapper: ProviderWrapper });
    expect(typeof result.current.handleChunkRequest).toBe('function');
    expect(typeof result.current.requestChunkFromPeer).toBe('function');
    expect(typeof result.current.announceAvailability).toBe('function');
    expect(typeof result.current.getLocalChunkCount).toBe('function');
  });

  it('should serve local chunk on request', async () => {
    const { result } = renderHook(() => useFileTransfer(defaultParams), { wrapper: ProviderWrapper });

    let chunkResponse;
    await act(async () => {
      chunkResponse = await result.current.handleChunkRequest({
        fileId: 'file-1',
        chunkIndex: 0,
        requestId: 'req-1',
      });
    });

    expect(chunkResponse).toBeDefined();
    expect(chunkResponse.encrypted).toBeDefined();
    expect(chunkResponse.nonce).toBeDefined();
  });

  it('should return null for unavailable chunk', async () => {
    const { result } = renderHook(() => useFileTransfer(defaultParams), { wrapper: ProviderWrapper });

    let chunkResponse;
    await act(async () => {
      chunkResponse = await result.current.handleChunkRequest({
        fileId: 'file-nonexistent',
        chunkIndex: 0,
        requestId: 'req-2',
      });
    });

    expect(chunkResponse).toBeNull();
  });

  it('should update serve stats when serving chunk', async () => {
    const { result } = renderHook(() => useFileTransfer(defaultParams), { wrapper: ProviderWrapper });

    await act(async () => {
      await result.current.handleChunkRequest({
        fileId: 'file-1',
        chunkIndex: 0,
        requestId: 'req-3',
      });
    });

    expect(result.current.transferStats.chunksServed).toBe(1);
    expect(result.current.transferStats.bytesServed).toBeGreaterThan(0);
  });

  it('should request chunk from local store (fallback)', async () => {
    const { result } = renderHook(() => useFileTransfer(defaultParams), { wrapper: ProviderWrapper });

    let chunk;
    await act(async () => {
      chunk = await result.current.requestChunkFromPeer('file-1', 0, []);
    });

    expect(chunk).toBeDefined();
    expect(chunk.encrypted).toBeDefined();
  });

  it('should return null when chunk not available from peers', async () => {
    const { result } = renderHook(() => useFileTransfer(defaultParams), { wrapper: ProviderWrapper });

    let chunk;
    await act(async () => {
      chunk = await result.current.requestChunkFromPeer('file-missing', 0, []);
    });

    expect(chunk).toBeNull();
  });

  it('should announce availability by setting chunk availability', async () => {
    const { result } = renderHook(() => useFileTransfer(defaultParams), { wrapper: ProviderWrapper });

    await act(async () => {
      await result.current.announceAvailability('file-1', 2);
    });

    // setChunkAvailability now writes to the Yjs map inside the context
    // Verify the Yjs map was updated
    const chunk0 = yChunkAvailability.get('file-1:0');
    const chunk1 = yChunkAvailability.get('file-1:1');
    expect(chunk0).toBeDefined();
    expect(chunk0.holders).toContain('pk-user1');
    expect(chunk1).toBeDefined();
    expect(chunk1.holders).toContain('pk-user1');
  });

  it('should count local chunks correctly', async () => {
    const { result } = renderHook(() => useFileTransfer(defaultParams), { wrapper: ProviderWrapper });

    let count;
    await act(async () => {
      count = await result.current.getLocalChunkCount('file-1', 2);
    });

    expect(count).toBe(2);
  });

  it('should return 0 for file with no local chunks', async () => {
    const { result } = renderHook(() => useFileTransfer(defaultParams), { wrapper: ProviderWrapper });

    let count;
    await act(async () => {
      count = await result.current.getLocalChunkCount('file-nonexistent', 3);
    });

    expect(count).toBe(0);
  });

  it('should register PeerManager handlers on mount', () => {
    renderHook(() => useFileTransfer(defaultParams), { wrapper: ProviderWrapper });
    expect(mockPeerManager.registerHandler).toHaveBeenCalledWith('chunk-request', expect.any(Function));
    expect(mockPeerManager.registerHandler).toHaveBeenCalledWith('chunk-response', expect.any(Function));
    expect(mockPeerManager.registerHandler).toHaveBeenCalledWith('chunk-seed', expect.any(Function));
  });

  it('should unregister PeerManager handlers on unmount', () => {
    const { unmount } = renderHook(() => useFileTransfer(defaultParams), { wrapper: ProviderWrapper });
    unmount();
    expect(mockPeerManager.unregisterHandler).toHaveBeenCalledWith('chunk-request');
    expect(mockPeerManager.unregisterHandler).toHaveBeenCalledWith('chunk-response');
    expect(mockPeerManager.unregisterHandler).toHaveBeenCalledWith('chunk-seed');
  });

  it('should send chunk response via PeerManager when handling request', async () => {
    renderHook(() => useFileTransfer(defaultParams), { wrapper: ProviderWrapper });

    // Get the registered handler
    const requestHandler = mockRegisteredHandlers['chunk-request'];
    expect(requestHandler).toBeDefined();

    await act(async () => {
      await requestHandler('peer-1', {
        type: 'chunk-request',
        requestId: 'req-pm-1',
        fileId: 'file-1',
        chunkIndex: 0,
      });
    });

    // Should have sent a response to the requesting peer
    expect(mockPeerManager.send).toHaveBeenCalledWith('peer-1', expect.objectContaining({
      type: 'chunk-response',
      requestId: 'req-pm-1',
      fileId: 'file-1',
      chunkIndex: 0,
    }));
  });

  it('should request chunk via PeerManager send when local not available', async () => {
    mockPeerManager.getConnectedPeers.mockReturnValue(['peer-A']);

    // Set up mock to simulate a response being sent back
    mockPeerManager.send.mockImplementation(async (peerId, msg) => {
      if (msg.type === 'chunk-request') {
        // Simulate peer response arriving after a short delay
        setTimeout(() => {
          const responseHandler = mockRegisteredHandlers['chunk-response'];
          if (responseHandler) {
            responseHandler(peerId, {
              type: 'chunk-response',
              requestId: msg.requestId,
              fileId: msg.fileId,
              chunkIndex: msg.chunkIndex,
              encrypted: btoa(String.fromCharCode(7, 8, 9)),
              nonce: btoa(String.fromCharCode(...new Uint8Array(24))),
            });
          }
        }, 10);
      }
    });

    const { result } = renderHook(() => useFileTransfer(defaultParams), { wrapper: ProviderWrapper });

    let chunk;
    await act(async () => {
      chunk = await result.current.requestChunkFromPeer('file-missing', 0, ['peer-A']);
    });

    expect(chunk).toBeDefined();
    expect(chunk.encrypted).toBeDefined();
    expect(mockPeerManager.send).toHaveBeenCalled();
  });
});
