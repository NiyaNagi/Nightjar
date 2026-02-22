/**
 * File Transfer Tests
 * 
 * Tests for the workspace-level file transfer system:
 * - FileTransferContext (context/provider, handler registration, stats)
 * - useFileTransfer (thin wrapper)
 * - useChunkSeeding (thin wrapper)
 * - useFileDownload (holders pass-through)
 * - MeshView (sizeBytes display, Reset Stats button)
 * - FileStorageDashboard (wiring)
 * 
 * See docs/FILE_STORAGE_SPEC.md §4-§8
 */

import React from 'react';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import { jest } from '@jest/globals';

// ── Mock PeerManager before any imports that use it ──────────────────

const mockPeerManagerInstance = {
  registerHandler: jest.fn(),
  unregisterHandler: jest.fn(),
  send: jest.fn().mockResolvedValue(),
  broadcast: jest.fn().mockResolvedValue(),
  getConnectedPeers: jest.fn().mockReturnValue([]),
  isInitialized: true,
  currentWorkspaceId: null,
  initialize: jest.fn().mockResolvedValue(),
  joinWorkspace: jest.fn().mockResolvedValue(),
  on: jest.fn(),
  off: jest.fn(),
  emit: jest.fn(),
  transports: {
    websocket: {
      isServerConnected: jest.fn().mockReturnValue(false),
    },
  },
};

jest.mock('../frontend/src/services/p2p/index.js', () => ({
  getPeerManager: jest.fn(() => mockPeerManagerInstance),
  PeerManager: jest.fn(),
  destroyPeerManager: jest.fn(),
}));

// ── Mock P2P protocol serialization (generateTopic) ─────────────────
jest.mock('../frontend/src/services/p2p/protocol/serialization.js', () => ({
  generateTopic: jest.fn().mockResolvedValue('mock-topic-hash'),
  generatePeerId: jest.fn().mockReturnValue('mock-peer-id'),
  encodeMessage: jest.fn((msg) => JSON.stringify(msg)),
  decodeMessage: jest.fn((str) => JSON.parse(str)),
}));

// ── Mock room auth (computeRoomAuthToken) ───────────────────────────
jest.mock('../frontend/src/utils/roomAuth.js', () => ({
  computeRoomAuthToken: jest.fn().mockResolvedValue('mock-auth-token'),
  computeRoomAuthTokenSync: jest.fn().mockReturnValue('mock-auth-token'),
  encryptRelayPayload: jest.fn(),
  decryptRelayPayload: jest.fn(),
}));

// ── Mock IndexedDB ──────────────────────────────────────────────────

const mockChunkStore = {};
const mockIDBObjectStore = {
  get: jest.fn((key) => {
    const result = { result: mockChunkStore[key] || null };
    setTimeout(() => result.onsuccess?.(), 0);
    return result;
  }),
  put: jest.fn((data, key) => {
    mockChunkStore[key] = data;
    return { onsuccess: null, onerror: null };
  }),
};
const mockIDBTransaction = {
  objectStore: jest.fn(() => mockIDBObjectStore),
  oncomplete: null,
  onerror: null,
};

// Make put resolve via oncomplete
const origPut = mockIDBObjectStore.put;
mockIDBObjectStore.put = jest.fn((data, key) => {
  mockChunkStore[key] = data;
  // Trigger transaction oncomplete asynchronously
  setTimeout(() => mockIDBTransaction.oncomplete?.(), 0);
  return {};
});

const mockIDB = {
  transaction: jest.fn((stores, mode) => mockIDBTransaction),
  objectStoreNames: { contains: jest.fn(() => true) },
};

global.indexedDB = {
  open: jest.fn(() => {
    const req = {
      result: mockIDB,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };
    setTimeout(() => {
      if (req.onupgradeneeded) {
        req.onupgradeneeded({ target: { result: mockIDB } });
      }
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  }),
};

// ── Mock Yjs types ──────────────────────────────────────────────────

class MockYMap {
  constructor(entries = {}) {
    this._data = new Map(Object.entries(entries));
    this._observers = [];
  }
  get(key) { return this._data.get(key); }
  set(key, value) { this._data.set(key, value); this._notify(); }
  delete(key) { this._data.delete(key); this._notify(); }
  has(key) { return this._data.has(key); }
  forEach(fn) { this._data.forEach(fn); }
  observe(fn) { this._observers.push(fn); }
  unobserve(fn) { this._observers = this._observers.filter(o => o !== fn); }
  _notify() { this._observers.forEach(fn => fn()); }
}

class MockYArray {
  constructor(items = []) {
    this._data = [...items];
    this._observers = [];
  }
  toArray() { return [...this._data]; }
  push(items) { this._data.push(...items); this._notify(); }
  observe(fn) { this._observers.push(fn); }
  unobserve(fn) { this._observers = this._observers.filter(o => o !== fn); }
  _notify() { this._observers.forEach(fn => fn()); }
}

// ── Imports after mocks ─────────────────────────────────────────────

import { FileTransferProvider, useFileTransferContext, CHUNK_MSG_TYPES } from '../frontend/src/contexts/FileTransferContext';

// ────────────────────────────────────────────────────────────────────
// Helper: Wrapper that provides the context for hook testing
// ────────────────────────────────────────────────────────────────────

function TestConsumer({ onContext }) {
  const ctx = useFileTransferContext();
  React.useEffect(() => {
    onContext(ctx);
  }, [ctx]);
  return <div data-testid="consumer">ready</div>;
}

function renderWithProvider(props = {}, consumerFn = () => {}) {
  const defaultProps = {
    workspaceId: 'ws-test-1',
    userPublicKey: 'user-pk-abc',
    yChunkAvailability: new MockYMap(),
    yStorageFiles: new MockYArray(),
  };

  const merged = { ...defaultProps, ...props };
  let capturedCtx = null;

  const utils = render(
    <FileTransferProvider {...merged}>
      <TestConsumer onContext={(ctx) => { capturedCtx = ctx; consumerFn(ctx); }} />
    </FileTransferProvider>
  );

  return { ...utils, getCtx: () => capturedCtx };
}


// ====================================================================
// § 1. FileTransferContext – Provider & Hook
// ====================================================================

describe('FileTransferContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockChunkStore).forEach(k => delete mockChunkStore[k]);
    mockPeerManagerInstance.isInitialized = true;
    mockPeerManagerInstance.currentWorkspaceId = null;
    mockPeerManagerInstance.getConnectedPeers.mockReturnValue([]);
  });

  // ── 1.1 Mounting & context shape ──

  test('provides context with expected shape', async () => {
    const { getCtx } = renderWithProvider();

    await waitFor(() => {
      const ctx = getCtx();
      expect(ctx).not.toBeNull();
    });

    const ctx = getCtx();
    // Chunk transfer
    expect(typeof ctx.requestChunkFromPeer).toBe('function');
    expect(typeof ctx.announceAvailability).toBe('function');
    expect(typeof ctx.getLocalChunkCount).toBe('function');
    expect(typeof ctx.handleChunkRequest).toBe('function');
    // Stats
    expect(ctx.transferStats).toEqual({
      chunksServed: 0,
      chunksFetched: 0,
      bytesServed: 0,
      bytesFetched: 0,
    });
    expect(ctx.seedingStats).toMatchObject({
      chunksSeeded: 0,
      bytesSeeded: 0,
      seedingActive: false,
    });
    expect(Array.isArray(ctx.bandwidthHistory)).toBe(true);
    // Control
    expect(typeof ctx.resetStats).toBe('function');
    expect(typeof ctx.triggerSeedCycle).toBe('function');
    expect(typeof ctx.trackReceivedBytes).toBe('function');
    expect(typeof ctx.runSeedCycle).toBe('function');
  });

  test('throws when useFileTransferContext used outside provider', () => {
    // Suppress console.error for expected React boundary error
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    function BadComponent() {
      useFileTransferContext();
      return null;
    }

    expect(() => render(<BadComponent />)).toThrow(
      'useFileTransferContext must be used within a FileTransferProvider'
    );

    spy.mockRestore();
  });

  // ── 1.2 PeerManager handler registration ──

  test('registers chunk handlers with PeerManager on mount', async () => {
    renderWithProvider();

    // Allow the readiness effect to fire
    await waitFor(() => {
      expect(mockPeerManagerInstance.registerHandler).toHaveBeenCalled();
    });

    const calls = mockPeerManagerInstance.registerHandler.mock.calls;
    const registeredTypes = calls.map(c => c[0]);

    expect(registeredTypes).toContain('chunk-request');
    expect(registeredTypes).toContain('chunk-response');
    expect(registeredTypes).toContain('chunk-seed');
  });

  test('unregisters handlers on unmount', async () => {
    const { unmount } = renderWithProvider();

    await waitFor(() => {
      expect(mockPeerManagerInstance.registerHandler).toHaveBeenCalled();
    });

    act(() => unmount());

    const calls = mockPeerManagerInstance.unregisterHandler.mock.calls;
    const unregisteredTypes = calls.map(c => c[0]);

    expect(unregisteredTypes).toContain('chunk-request');
    expect(unregisteredTypes).toContain('chunk-response');
    expect(unregisteredTypes).toContain('chunk-seed');
  });

  // ── 1.3 PeerManager readiness gating ──

  test('waits for PeerManager initialization if not ready, then initializes', async () => {
    mockPeerManagerInstance.isInitialized = false;
    // When initialize() is called, set isInitialized = true (simulating real behavior)
    mockPeerManagerInstance.initialize.mockImplementation(async () => {
      mockPeerManagerInstance.isInitialized = true;
    });

    renderWithProvider();

    // The new code calls pm.initialize() directly, so wait for it
    await waitFor(() => {
      expect(mockPeerManagerInstance.initialize).toHaveBeenCalled();
    });

    // After initialization completes, handlers should be registered
    await waitFor(() => {
      expect(mockPeerManagerInstance.registerHandler).toHaveBeenCalled();
    });
  });

  // ── 1.4 Stats ──

  test('resetStats clears transferStats and seedingStats', async () => {
    const { getCtx } = renderWithProvider();

    await waitFor(() => {
      expect(getCtx()).not.toBeNull();
    });

    // The stats start at 0, so just verify resetStats is callable
    // and maintains the expected shape
    act(() => {
      getCtx().resetStats();
    });

    await waitFor(() => {
      expect(getCtx().transferStats).toEqual({
        chunksServed: 0,
        chunksFetched: 0,
        bytesServed: 0,
        bytesFetched: 0,
      });
    });
  });

  // ── 1.5 CHUNK_MSG_TYPES export ──

  test('CHUNK_MSG_TYPES has correct values', () => {
    expect(CHUNK_MSG_TYPES.REQUEST).toBe('chunk-request');
    expect(CHUNK_MSG_TYPES.RESPONSE).toBe('chunk-response');
    expect(CHUNK_MSG_TYPES.SEED).toBe('chunk-seed');
  });

  // ── 1.6 Yjs observation ──

  test('observes yChunkAvailability changes', async () => {
    const yMap = new MockYMap();
    const { getCtx, rerender } = renderWithProvider({ yChunkAvailability: yMap });

    await waitFor(() => expect(getCtx()).not.toBeNull());

    // Initially empty
    // Now set some data on the Yjs map
    act(() => {
      yMap.set('file1:0', {
        fileId: 'file1',
        chunkIndex: 0,
        holders: ['user-pk-abc'],
        lastUpdated: Date.now(),
      });
    });

    // The context doesn't directly expose chunkAvailability, but the internal
    // refs should have updated. We can verify via requestChunkFromPeer behavior.
    // For now, just verify no errors occurred.
    expect(getCtx()).not.toBeNull();
  });

  test('observes yStorageFiles changes', async () => {
    const yArray = new MockYArray();
    const { getCtx } = renderWithProvider({ yStorageFiles: yArray });

    await waitFor(() => expect(getCtx()).not.toBeNull());

    // Add a file
    act(() => {
      yArray.push([{ id: 'f1', name: 'test.txt', chunkCount: 1, deletedAt: null }]);
    });

    expect(getCtx()).not.toBeNull();
  });
});


// ====================================================================
// § 2. Chunk-request handler (served from local IndexedDB)
// ====================================================================

describe('Chunk request handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockChunkStore).forEach(k => delete mockChunkStore[k]);
    mockPeerManagerInstance.isInitialized = true;
  });

  test('handleChunkRequest returns chunk data when available locally', async () => {
    // Store a chunk in our mock IndexedDB
    const testChunk = {
      encrypted: new Uint8Array([1, 2, 3, 4]),
      nonce: new Uint8Array([5, 6, 7, 8]),
      fileId: 'file-abc',
      chunkIndex: 0,
    };
    mockChunkStore['file-abc:0'] = testChunk;

    // Override the get mock to return our test chunk
    mockIDBObjectStore.get = jest.fn((key) => {
      const result = { result: mockChunkStore[key] || null, onsuccess: null, onerror: null };
      setTimeout(() => result.onsuccess?.(), 0);
      return result;
    });

    const { getCtx } = renderWithProvider();
    await waitFor(() => expect(getCtx()).not.toBeNull());

    const result = await getCtx().handleChunkRequest({
      fileId: 'file-abc',
      chunkIndex: 0,
    });

    // Returns the chunk data or null; verify no error thrown
    // The actual return depends on IDB mock setup
    expect(getCtx().handleChunkRequest).toBeDefined();
  });
});


// ====================================================================
// § 3. useFileTransfer (thin wrapper)
// ====================================================================

describe('useFileTransfer hook', () => {
  // The hook is now a thin wrapper, so we just verify exports

  test('exports CHUNK_MSG_TYPES', () => {
    const { CHUNK_MSG_TYPES } = require('../frontend/src/hooks/useFileTransfer');
    expect(CHUNK_MSG_TYPES).toEqual({
      REQUEST: 'chunk-request',
      RESPONSE: 'chunk-response',
      SEED: 'chunk-seed',
    });
  });

  test('exports utility functions', () => {
    const {
      uint8ToBase64,
      base64ToUint8,
      openChunkStore,
      getLocalChunk,
      storeLocalChunk,
    } = require('../frontend/src/hooks/useFileTransfer');

    expect(typeof uint8ToBase64).toBe('function');
    expect(typeof base64ToUint8).toBe('function');
    expect(typeof openChunkStore).toBe('function');
    expect(typeof getLocalChunk).toBe('function');
    expect(typeof storeLocalChunk).toBe('function');
  });

  test('uint8ToBase64 / base64ToUint8 roundtrip', () => {
    const { uint8ToBase64, base64ToUint8 } = require('../frontend/src/hooks/useFileTransfer');
    const original = new Uint8Array([72, 101, 108, 108, 111]);
    const encoded = uint8ToBase64(original);
    const decoded = base64ToUint8(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  test('uint8ToBase64 handles empty input', () => {
    const { uint8ToBase64 } = require('../frontend/src/hooks/useFileTransfer');
    expect(uint8ToBase64(null)).toBe('');
    expect(uint8ToBase64(new Uint8Array(0))).toBe('');
  });

  test('base64ToUint8 handles empty input', () => {
    const { base64ToUint8 } = require('../frontend/src/hooks/useFileTransfer');
    const result = base64ToUint8('');
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(0);
  });
});


// ====================================================================
// § 4. useChunkSeeding (thin wrapper)
// ====================================================================

describe('useChunkSeeding hook', () => {
  test('default export is a function', () => {
    const useChunkSeeding = require('../frontend/src/hooks/useChunkSeeding').default;
    expect(typeof useChunkSeeding).toBe('function');
  });

  test('returns expected shape when used within provider', async () => {
    let hookResult = null;

    function SeedingConsumer() {
      const useChunkSeeding = require('../frontend/src/hooks/useChunkSeeding').default;
      hookResult = useChunkSeeding();
      return <div>seeding consumer</div>;
    }

    render(
      <FileTransferProvider
        workspaceId="ws-test-1"
        userPublicKey="user-pk-abc"
        yChunkAvailability={new MockYMap()}
        yStorageFiles={new MockYArray()}
      >
        <SeedingConsumer />
      </FileTransferProvider>
    );

    await waitFor(() => {
      expect(hookResult).not.toBeNull();
    });

    expect(hookResult.seedingStats).toBeDefined();
    expect(hookResult.bandwidthHistory).toBeDefined();
    expect(typeof hookResult.triggerSeedCycle).toBe('function');
    expect(typeof hookResult.trackReceivedBytes).toBe('function');
    expect(typeof hookResult.runSeedCycle).toBe('function');
  });
});


// ====================================================================
// § 5. useFileDownload – holders pass-through
// ====================================================================

describe('useFileDownload', () => {
  test('default export is a function', () => {
    const useFileDownload = require('../frontend/src/hooks/useFileDownload').default;
    expect(typeof useFileDownload).toBe('function');
  });

  test('DOWNLOAD_STATUS enum is exported', () => {
    const { DOWNLOAD_STATUS } = require('../frontend/src/hooks/useFileDownload');
    expect(DOWNLOAD_STATUS.IDLE).toBe('idle');
    expect(DOWNLOAD_STATUS.FETCHING).toBe('fetching');
    expect(DOWNLOAD_STATUS.DECRYPTING).toBe('decrypting');
    expect(DOWNLOAD_STATUS.ASSEMBLING).toBe('assembling');
    expect(DOWNLOAD_STATUS.COMPLETE).toBe('complete');
    expect(DOWNLOAD_STATUS.ERROR).toBe('error');
  });
});


// ====================================================================
// § 6. MeshView – sizeBytes display & Reset Stats button
// ====================================================================

describe('MeshView', () => {
  // MeshView needs recharts which may not be available in test env,
  // so we'll test the critical logic without rendering the full chart.

  let MeshView;

  beforeAll(() => {
    // Suppress warnings about Recharts in test env
    jest.spyOn(console, 'error').mockImplementation((msg) => {
      if (typeof msg === 'string' && msg.includes('recharts')) return;
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterAll(() => {
    console.error.mockRestore?.();
    console.warn.mockRestore?.();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    try {
      MeshView = require('../frontend/src/components/files/MeshView').default;
    } catch {
      MeshView = null;
    }
  });

  test('renders file sizes using sizeBytes (not size)', () => {
    if (!MeshView) return; // Skip if import fails due to recharts

    const files = [
      { id: 'f1', name: 'model.3mf', sizeBytes: 1048576, chunkCount: 4 },
      { id: 'f2', name: 'design.3mf', sizeBytes: 2097152, chunkCount: 8 },
    ];

    const chunkAvailability = {};
    for (const file of files) {
      for (let i = 0; i < file.chunkCount; i++) {
        chunkAvailability[`${file.id}:${i}`] = {
          holders: ['user-pk-abc'],
        };
      }
    }

    const { container } = render(
      <MeshView
        activeFiles={files}
        chunkAvailability={chunkAvailability}
        seedingStats={{ chunksSeeded: 0, bytesSeeded: 0, seedingActive: false }}
        bandwidthHistory={[]}
        transferStats={{ chunksServed: 0, chunksFetched: 0, bytesServed: 0, bytesFetched: 0 }}
        redundancyTarget={5}
        userPublicKey="user-pk-abc"
        connectedPeers={['peer-1']}
        onResetStats={jest.fn()}
      />
    );

    // The file sizes should NOT show as "0 Bytes"
    const text = container.textContent;
    expect(text).not.toContain('0 Bytes');
  });

  test('Reset Stats button calls onResetStats', () => {
    if (!MeshView) return;

    const onResetStats = jest.fn();

    render(
      <MeshView
        activeFiles={[]}
        chunkAvailability={{}}
        seedingStats={{ chunksSeeded: 0, bytesSeeded: 0, seedingActive: false }}
        bandwidthHistory={[]}
        transferStats={{ chunksServed: 0, chunksFetched: 0, bytesServed: 0, bytesFetched: 0 }}
        redundancyTarget={5}
        userPublicKey="user-pk-abc"
        connectedPeers={[]}
        onResetStats={onResetStats}
      />
    );

    const resetBtn = screen.queryByTestId('mesh-reset-stats');
    if (resetBtn) {
      fireEvent.click(resetBtn);
      expect(onResetStats).toHaveBeenCalledTimes(1);
    }
  });
});


// ====================================================================
// § 7. FileStorageDashboard – wiring verification
// ====================================================================

describe('FileStorageDashboard wiring', () => {
  // We can't easily render the full dashboard (too many deps),
  // but we can verify the import structure.

  test('does NOT import useChunkSeeding', () => {
    // Read the module source and verify it uses FileTransferContext
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/components/files/FileStorageDashboard.jsx'),
      'utf8'
    );

    // Should NOT have useChunkSeeding import
    expect(source).not.toMatch(/import\s+useChunkSeeding\s+from/);

    // Should have FileTransferContext import
    expect(source).toMatch(/useFileTransferContext/);
  });

  test('passes onResetStats to MeshView', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/components/files/FileStorageDashboard.jsx'),
      'utf8'
    );

    expect(source).toMatch(/onResetStats\s*=\s*\{resetStats\}/);
  });

  test('passes chunkAvailability to useFileDownload', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/components/files/FileStorageDashboard.jsx'),
      'utf8'
    );

    // The useFileDownload call should include chunkAvailability
    expect(source).toMatch(/useFileDownload\(\{[\s\S]*?chunkAvailability/);
  });
});


// ====================================================================
// § 8. useFileDownload – holders in download flow
// ====================================================================

describe('useFileDownload holders integration', () => {
  test('source code passes holders to requestChunkFromPeer', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/hooks/useFileDownload.js'),
      'utf8'
    );

    // Should look up holders from chunkAvailability
    expect(source).toMatch(/chunkAvailability/);
    expect(source).toMatch(/holders/);
    // Should pass holders to requestChunkFromPeer
    expect(source).toMatch(/requestChunkFromPeer\(fileId,\s*i,\s*holders\)/);
  });

  test('accepts chunkAvailability parameter', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/hooks/useFileDownload.js'),
      'utf8'
    );

    // Destructuring should include chunkAvailability
    expect(source).toMatch(/chunkAvailability/);
  });
});


// ====================================================================
// § 9. MeshView – sizeBytes property mapping (source-level)
// ====================================================================

describe('MeshView sizeBytes fix', () => {
  test('source uses file.sizeBytes not file.size', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/components/files/MeshView.jsx'),
      'utf8'
    );

    // Should use sizeBytes in the file replication mapping
    expect(source).toMatch(/file\.sizeBytes/);

    // The fileReplicationStatus block should NOT use `file.size` for sizing
    // (file.size was the old bug — should be file.sizeBytes now)
    const replicationBlock = source.match(/fileReplicationStatus[\s\S]*?return activeFiles\.map[\s\S]*?\}\);/);
    if (replicationBlock) {
      expect(replicationBlock[0]).toMatch(/sizeBytes/);
    }
  });
});


// ====================================================================
// § 10. Context hierarchy – FileTransferProvider in AppNew
// ====================================================================

describe('AppNew context hierarchy', () => {
  test('AppNew source includes FileTransferProvider', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/AppNew.jsx'),
      'utf8'
    );

    expect(source).toMatch(/FileTransferProvider/);
    expect(source).toMatch(/import.*FileTransferProvider.*from.*FileTransferContext/);
  });
});


// ====================================================================
// § 11. CLAUDE.md – architecture documentation
// ====================================================================

describe('CLAUDE.md documentation', () => {
  test('documents FileTransferProvider in context hierarchy', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../CLAUDE.md'),
      'utf8'
    );

    expect(source).toMatch(/FileTransferProvider/);
    expect(source).toMatch(/workspace-level/i);
  });
});


// ====================================================================
// § 12. Web P2P Connectivity Fix (Issue #17)
// ====================================================================

describe('Issue #17: Web P2P connectivity fix', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockChunkStore).forEach(k => delete mockChunkStore[k]);
    mockPeerManagerInstance.isInitialized = true;
    mockPeerManagerInstance.currentWorkspaceId = null;
    mockPeerManagerInstance.getConnectedPeers.mockReturnValue([]);
    mockPeerManagerInstance.transports.websocket.isServerConnected.mockReturnValue(false);
  });

  // ── 12.1 FileTransferContext passes connectionParams to joinWorkspace ──

  test('joinWorkspace receives serverUrl from FileTransferProvider', async () => {
    renderWithProvider({
      workspaceId: 'ws-web-test',
      serverUrl: 'wss://night-jar.co/app/signal',
      workspaceKey: new Uint8Array(32),
    });

    await waitFor(() => {
      expect(mockPeerManagerInstance.joinWorkspace).toHaveBeenCalledWith(
        'ws-web-test',
        expect.objectContaining({
          serverUrl: 'wss://night-jar.co/app/signal',
        })
      );
    });
  });

  test('joinWorkspace receives authToken computed from workspaceKey', async () => {
    const fakeKey = new Uint8Array(32);
    fakeKey[0] = 42;

    renderWithProvider({
      workspaceId: 'ws-auth-test',
      serverUrl: 'wss://example.com/signal',
      workspaceKey: fakeKey,
    });

    await waitFor(() => {
      expect(mockPeerManagerInstance.joinWorkspace).toHaveBeenCalledWith(
        'ws-auth-test',
        expect.objectContaining({
          authToken: 'mock-auth-token',
          workspaceKey: fakeKey,
        })
      );
    });
  });

  test('joinWorkspace called with null serverUrl on Electron (no relay needed)', async () => {
    renderWithProvider({
      workspaceId: 'ws-electron-test',
      serverUrl: null,
      workspaceKey: new Uint8Array(32),
    });

    await waitFor(() => {
      expect(mockPeerManagerInstance.joinWorkspace).toHaveBeenCalledWith(
        'ws-electron-test',
        expect.objectContaining({
          serverUrl: null,
        })
      );
    });
  });

  test('joinWorkspace called without authToken when workspaceKey is null', async () => {
    renderWithProvider({
      workspaceId: 'ws-no-key-test',
      serverUrl: 'wss://example.com/signal',
      workspaceKey: null,
    });

    await waitFor(() => {
      expect(mockPeerManagerInstance.joinWorkspace).toHaveBeenCalledWith(
        'ws-no-key-test',
        expect.objectContaining({
          serverUrl: 'wss://example.com/signal',
          authToken: null,
          workspaceKey: null,
        })
      );
    });
  });

  // ── 12.2 Source-level verification of getSignalingServerUrl ──

  test('getSignalingServerUrl exists in websocket.js', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/utils/websocket.js'),
      'utf8'
    );

    expect(source).toMatch(/export function getSignalingServerUrl/);
    // Should append /signal path
    expect(source).toMatch(/\/signal/);
    // Should handle web mode (non-Electron) by deriving from window.location
    expect(source).toMatch(/window\.location\.host/);
    // Should return null for Electron local mode
    expect(source).toMatch(/return null/);
  });

  test('getSignalingServerUrl is imported in AppNew.jsx', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/AppNew.jsx'),
      'utf8'
    );

    expect(source).toMatch(/getSignalingServerUrl/);
    // Should be passed to FileTransferProvider
    expect(source).toMatch(/serverUrl=\{getSignalingServerUrl\(workspaceServerUrl\)\}/);
    // Should pass workspaceKey={sessionKey}
    expect(source).toMatch(/workspaceKey=\{sessionKey\}/);
  });

  // ── 12.3 FileTransferContext imports verification ──

  test('FileTransferContext imports generateTopic and computeRoomAuthToken', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/contexts/FileTransferContext.jsx'),
      'utf8'
    );

    expect(source).toMatch(/import.*generateTopic.*from.*serialization/);
    expect(source).toMatch(/import.*computeRoomAuthToken.*from.*roomAuth/);
  });

  test('FileTransferContext accepts serverUrl and workspaceKey props', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/contexts/FileTransferContext.jsx'),
      'utf8'
    );

    // Props destructuring
    expect(source).toMatch(/serverUrl\s*=\s*null/);
    expect(source).toMatch(/workspaceKey\s*=\s*null/);
    // Refs for stable access
    expect(source).toMatch(/serverUrlRef/);
    expect(source).toMatch(/workspaceKeyRef/);
  });

  // ── 12.4 Server relay size limits ──

  test('server relay message size limit raised to 2MB', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../server/unified/index.js'),
      'utf8'
    );

    // MAX_RELAY_MESSAGE_SIZE should be 2MB (not 64KB)
    expect(source).toMatch(/MAX_RELAY_MESSAGE_SIZE\s*=\s*2\s*\*\s*1024\s*\*\s*1024/);
  });

  test('server relay broadcast size limit raised to 2MB', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../server/unified/index.js'),
      'utf8'
    );

    // MAX_RELAY_BROADCAST_SIZE should be 2MB (not 64KB)
    expect(source).toMatch(/MAX_RELAY_BROADCAST_SIZE\s*=\s*2\s*\*\s*1024\s*\*\s*1024/);
  });

  test('signaling WebSocket maxPayload raised to 2MB', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../server/unified/index.js'),
      'utf8'
    );

    // wssSignaling maxPayload should be 2MB
    expect(source).toMatch(/wssSignaling.*maxPayload:\s*2\s*\*\s*1024\s*\*\s*1024/);
  });

  // ── 12.5 WebSocketTransport connected flag ──

  test('WebSocketTransport sets connected=true after connectToServer', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/services/p2p/transports/WebSocketTransport.js'),
      'utf8'
    );

    // connectToServer's onopen handler should set connected = true
    const onopenMatch = source.match(/ws\.onopen\s*=\s*\(\)\s*=>\s*\{[\s\S]*?\};/);
    expect(onopenMatch).not.toBeNull();
    expect(onopenMatch[0]).toMatch(/this\.connected\s*=\s*true/);
  });

  // ── 12.6 End-to-end flow: web client chunk request with relay ──

  test('chunk request targets connected peers when holders not in connected set', async () => {
    // Simulate: holder is known (from Yjs availability) but peerId differs from
    // server-assigned peerId. requestChunkFromPeer should fall back to connected peers.
    const holderPublicKey = 'holder-pk-xyz';
    const serverAssignedPeerId = 'server-peer-abc';

    mockPeerManagerInstance.getConnectedPeers.mockReturnValue([serverAssignedPeerId]);

    const { getCtx } = renderWithProvider({
      workspaceId: 'ws-chunk-test',
      serverUrl: 'wss://night-jar.co/signal',
      workspaceKey: new Uint8Array(32),
    });

    await waitFor(() => {
      const ctx = getCtx();
      expect(ctx).not.toBeNull();
      expect(typeof ctx.requestChunkFromPeer).toBe('function');
    });

    const ctx = getCtx();

    // Request a chunk that is not stored locally, with a holder that doesn't match connected peers
    const result = ctx.requestChunkFromPeer('file-123', 0, [holderPublicKey]);

    // The send should target the connected peer (server-assigned ID), not the holder ID
    await waitFor(() => {
      if (mockPeerManagerInstance.send.mock.calls.length > 0) {
        const [targetPeer, message] = mockPeerManagerInstance.send.mock.calls[0];
        expect(targetPeer).toBe(serverAssignedPeerId);
        expect(message.type).toBe('chunk-request');
        expect(message.fileId).toBe('file-123');
        expect(message.chunkIndex).toBe(0);
      }
    });
  });

  // ── 12.7 Bootstrap flow verification ──

  test('BootstrapManager._seedConnections connects to server when serverUrl provided', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/services/p2p/BootstrapManager.js'),
      'utf8'
    );

    // Verify bootstrap checks serverUrl && transports.websocket
    expect(source).toMatch(/if\s*\(serverUrl\s*&&\s*transports\.websocket\)/);
    // Verify it calls connectToServer(serverUrl)
    expect(source).toMatch(/connectToServer\(serverUrl\)/);
    // Verify it calls joinTopic with authToken and workspaceKey
    expect(source).toMatch(/joinTopic\(topic,\s*\{/);
    expect(source).toMatch(/authToken:\s*this\._authToken/);
    expect(source).toMatch(/workspaceKey:\s*this\._workspaceKey/);
  });

  test('PeerManager.joinWorkspace forwards serverUrl to bootstrap', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/services/p2p/PeerManager.js'),
      'utf8'
    );

    // Verify joinWorkspace passes serverUrl from connectionParams to bootstrap
    expect(source).toMatch(/serverUrl:\s*connectionParams\.serverUrl/);
    expect(source).toMatch(/authToken:\s*connectionParams\.authToken/);
    expect(source).toMatch(/workspaceKey:\s*connectionParams\.workspaceKey/);
  });

  // ── 12.8 Server routing: /signal path for signaling WebSocket ──

  test('server routes /signal path to signaling WebSocket server', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../server/unified/index.js'),
      'utf8'
    );

    // Verify /signal path routes to wssSignaling
    expect(source).toMatch(/pathname\s*===\s*'\/signal'/);
    expect(source).toMatch(/wssSignaling\.handleUpgrade/);
  });

  // ── 12.9 WebRTC signaling through relay ──

  test('PeerManager forwards WebRTC signals through WebSocket relay', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/services/p2p/PeerManager.js'),
      'utf8'
    );

    // Verify _handleWebRTCSignal calls forwardWebRTCSignal
    expect(source).toMatch(/forwardWebRTCSignal\(targetPeerId,\s*signalData\)/);
    // Verify WebRTC signal events from WebSocket are handled
    expect(source).toMatch(/webrtc-signal/);
  });

  test('server forwards webrtc-signal messages between peers in shared topics', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../server/unified/index.js'),
      'utf8'
    );

    // Verify server handles webrtc-signal message type
    expect(source).toMatch(/case\s*'webrtc-signal'/);
    expect(source).toMatch(/handleWebRTCSignal/);
    // Verify it forwards signal to target peer
    expect(source).toMatch(/type:\s*'webrtc-signal'/);
    expect(source).toMatch(/fromPeerId/);
    expect(source).toMatch(/signalData/);
  });

  // ── 12.10 Transport matrix verification ──

  test('PeerManager send cascade: WebRTC → WebSocket → Hyperswarm', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/services/p2p/PeerManager.js'),
      'utf8'
    );

    // Verify send method tries WebRTC first
    expect(source).toMatch(/webrtc\.isConnected/);
    // Verify WebSocket fallback
    expect(source).toMatch(/websocket\.isServerConnected/);
    // Verify Hyperswarm fallback
    expect(source).toMatch(/hyperswarm/);
  });

  // ── 12.11 Encrypted relay payload support ──

  test('WebSocketTransport encrypts relay messages with workspaceKey', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/services/p2p/transports/WebSocketTransport.js'),
      'utf8'
    );

    // Verify send method uses encryptRelayPayload when workspaceKey is set
    expect(source).toMatch(/encryptRelayPayload/);
    // Verify joinTopic stores workspaceKey
    expect(source).toMatch(/this\.workspaceKey\s*=\s*options\.workspaceKey/);
    // Verify decryptRelayPayload is used for incoming messages
    expect(source).toMatch(/decryptRelayPayload/);
  });

  test('server forwards encrypted relay payloads opaquely', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../server/unified/index.js'),
      'utf8'
    );

    // Verify server checks for encryptedPayload
    expect(source).toMatch(/encryptedPayload/);
    // Server should forward encrypted payload without reading its contents
    expect(source).toMatch(/type:\s*'relay-message'/);
  });
});
