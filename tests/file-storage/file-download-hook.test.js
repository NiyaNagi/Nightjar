/**
 * Tests for useFileDownload hook.
 * 
 * Tests download flow, status transitions, P2P fallback, integrity checks.
 * 
 * See docs/FILE_STORAGE_SPEC.md §7, §15.9
 */

import { renderHook, act } from '@testing-library/react';

// --- Mock file chunking ---
jest.mock('../../frontend/src/utils/fileChunking', () => ({
  decryptChunk: jest.fn((encrypted, nonce, key) => {
    // Return the encrypted data as "decrypted" for testing
    return encrypted;
  }),
  reassembleFile: jest.fn(async (chunks, hashes, expectedSize) => {
    const data = new Uint8Array(
      chunks.sort((a, b) => a.index - b.index).reduce((acc, c) => [...acc, ...c.data], [])
    );
    return { data, valid: true, errors: [] };
  }),
  toBlob: jest.fn((data, mimeType) => new Blob([data], { type: mimeType })),
  downloadBlob: jest.fn(),
  sha256: jest.fn(async () => 'mockhash'),
}));

// --- Mock chunkStore's getChunk ---
const mockChunkStore = {};
jest.mock('../../frontend/src/utils/chunkStore', () => ({
  getChunk: jest.fn(async (db, fileId, chunkIndex) => {
    const key = `${fileId}:${chunkIndex}`;
    return mockChunkStore[key] || null;
  }),
  UPLOAD_STATUS: {
    IDLE: 'idle',
    READING: 'reading',
    CHUNKING: 'chunking',
    ENCRYPTING: 'encrypting',
    STORING: 'storing',
    COMPLETE: 'complete',
    ERROR: 'error',
  },
  openChunkStore: jest.fn(),
  storeChunk: jest.fn(),
  deleteFileChunks: jest.fn(),
}));

// --- Mock IndexedDB ---
const mockPutFn = jest.fn();
const mockObjectStore = {
  put: mockPutFn,
  get: jest.fn(() => ({ onsuccess: null, onerror: null, result: null })),
};
const mockDb = {
  transaction: jest.fn(() => ({
    objectStore: () => mockObjectStore,
  })),
};

global.indexedDB = {
  open: jest.fn(() => {
    const req = { onupgradeneeded: null, onsuccess: null, onerror: null, result: mockDb };
    setTimeout(() => { if (req.onsuccess) req.onsuccess(); }, 0);
    return req;
  }),
};

import useFileDownload, { DOWNLOAD_STATUS } from '../../frontend/src/hooks/useFileDownload';
import { downloadBlob } from '../../frontend/src/utils/fileChunking';

describe('useFileDownload', () => {
  const defaultParams = {
    workspaceId: 'ws-test',
    workspaceKey: new Uint8Array(32),
    requestChunkFromPeer: null,
    addAuditEntry: jest.fn(),
  };

  const fileRecord = {
    id: 'file-1',
    name: 'test.txt',
    sizeBytes: 6,
    chunkCount: 2,
    chunkHashes: ['h0', 'h1'],
    mimeType: 'text/plain',
  };

  beforeEach(() => {
    // Set up mock chunk store with both chunks available locally
    mockChunkStore['file-1:0'] = { encrypted: new Uint8Array([1, 2, 3]), nonce: new Uint8Array(24) };
    mockChunkStore['file-1:1'] = { encrypted: new Uint8Array([4, 5, 6]), nonce: new Uint8Array(24) };
  });

  afterEach(() => {
    jest.clearAllMocks();
    Object.keys(mockChunkStore).forEach(k => delete mockChunkStore[k]);
  });

  it('should export DOWNLOAD_STATUS constants', () => {
    expect(DOWNLOAD_STATUS.IDLE).toBe('idle');
    expect(DOWNLOAD_STATUS.FETCHING).toBe('fetching');
    expect(DOWNLOAD_STATUS.DECRYPTING).toBe('decrypting');
    expect(DOWNLOAD_STATUS.ASSEMBLING).toBe('assembling');
    expect(DOWNLOAD_STATUS.COMPLETE).toBe('complete');
    expect(DOWNLOAD_STATUS.ERROR).toBe('error');
  });

  it('should start with no downloads', () => {
    const { result } = renderHook(() => useFileDownload(defaultParams));
    expect(result.current.downloads).toEqual([]);
  });

  it('should expose downloadFile, clearDownload, checkLocalAvailability', () => {
    const { result } = renderHook(() => useFileDownload(defaultParams));
    expect(typeof result.current.downloadFile).toBe('function');
    expect(typeof result.current.clearDownload).toBe('function');
    expect(typeof result.current.checkLocalAvailability).toBe('function');
  });

  it('should download file successfully from local chunks', async () => {
    const { result } = renderHook(() => useFileDownload(defaultParams));

    let downloadResult;
    await act(async () => {
      downloadResult = await result.current.downloadFile(fileRecord);
    });

    expect(downloadResult.data).toBeDefined();
    expect(result.current.downloads.length).toBe(1);
    expect(result.current.downloads[0].status).toBe(DOWNLOAD_STATUS.COMPLETE);
  });

  it('should trigger browser download', async () => {
    const { result } = renderHook(() => useFileDownload(defaultParams));

    await act(async () => {
      await result.current.downloadFile(fileRecord);
    });

    expect(downloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      'test.txt'
    );
  });

  it('should skip browser download when option set', async () => {
    const { result } = renderHook(() => useFileDownload(defaultParams));

    await act(async () => {
      await result.current.downloadFile(fileRecord, { skipBrowserDownload: true });
    });

    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it('should add audit entry on download', async () => {
    const { result } = renderHook(() => useFileDownload(defaultParams));

    await act(async () => {
      await result.current.downloadFile(fileRecord);
    });

    expect(defaultParams.addAuditEntry).toHaveBeenCalledWith(
      'file_downloaded',
      'file',
      'file-1',
      'test.txt',
      'Downloaded test.txt'
    );
  });

  it('should error when chunk not available', async () => {
    // Remove local chunks
    delete mockChunkStore['file-1:0'];
    delete mockChunkStore['file-1:1'];

    const { result } = renderHook(() => useFileDownload(defaultParams));

    let caughtError;
    await act(async () => {
      try {
        await result.current.downloadFile(fileRecord);
      } catch (err) {
        caughtError = err;
      }
    });

    expect(caughtError).toBeDefined();
    expect(caughtError.message).toContain('Chunk 0 not available');
    expect(result.current.downloads.length).toBe(1);
    expect(result.current.downloads[0].status).toBe(DOWNLOAD_STATUS.ERROR);
  });

  it('should fallback to P2P when local chunk missing', async () => {
    // Remove chunk 1 from local
    delete mockChunkStore['file-1:1'];
    
    const peerChunk = { encrypted: new Uint8Array([7, 8, 9]), nonce: new Uint8Array(24) };
    const requestChunkFromPeer = jest.fn(async (fileId, chunkIndex) => {
      if (chunkIndex === 1) return peerChunk;
      return null;
    });

    const { result } = renderHook(() => useFileDownload({
      ...defaultParams,
      requestChunkFromPeer,
    }));

    await act(async () => {
      await result.current.downloadFile(fileRecord);
    });

    // Called with fileId, chunkIndex, and holders array (may be empty if no chunkAvailability)
    expect(requestChunkFromPeer).toHaveBeenCalledWith('file-1', 1, expect.anything());
    expect(result.current.downloads[0].status).toBe(DOWNLOAD_STATUS.COMPLETE);
  });

  it('should clear a download', async () => {
    const { result } = renderHook(() => useFileDownload(defaultParams));

    await act(async () => {
      await result.current.downloadFile(fileRecord);
    });
    expect(result.current.downloads.length).toBe(1);
    const downloadId = result.current.downloads[0].downloadId;

    act(() => result.current.clearDownload(downloadId));
    expect(result.current.downloads.length).toBe(0);
  });
});
