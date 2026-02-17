/**
 * Tests for useFileUpload hook.
 * 
 * Tests upload flow, validation gating, status transitions, etc.
 * IndexedDB and processFileForUpload are mocked.
 * 
 * See docs/FILE_STORAGE_SPEC.md §6, §15.9
 */

import { renderHook, act } from '@testing-library/react';

// --- Mock processFileForUpload ---
const mockProcessResult = {
  chunks: [
    { index: 0, encrypted: new Uint8Array([1, 2, 3]), nonce: new Uint8Array(24) },
    { index: 1, encrypted: new Uint8Array([4, 5, 6]), nonce: new Uint8Array(24) },
  ],
  chunkHashes: ['hash0', 'hash1'],
  chunkCount: 2,
  fileHash: 'filehash',
  totalSize: 2048,
};

jest.mock('../../frontend/src/utils/fileChunking', () => ({
  processFileForUpload: jest.fn(async (_file, _key, onProgress) => {
    if (onProgress) {
      onProgress(0, 2);
      onProgress(1, 2);
    }
    return mockProcessResult;
  }),
  CHUNK_SIZE: 1024 * 1024,
  MAX_FILE_SIZE: 100 * 1024 * 1024,
}));

jest.mock('../../frontend/src/utils/fileStorageValidation', () => {
  const actual = jest.requireActual('../../frontend/src/utils/fileStorageValidation');
  return {
    ...actual,
    generateFileId: jest.fn(() => 'file-test-id-123'),
  };
});

// --- Mock IndexedDB ---
const mockPutFn = jest.fn();
const mockDeleteFn = jest.fn();
const mockGetFn = jest.fn();
const mockTxComplete = { oncomplete: null, onerror: null };
const mockObjectStore = {
  put: mockPutFn,
  delete: mockDeleteFn,
  get: (...args) => {
    mockGetFn(...args);
    return { onsuccess: null, onerror: null, result: null };
  },
};
const mockTransaction = jest.fn(() => ({
  objectStore: () => mockObjectStore,
  get oncomplete() { return mockTxComplete.oncomplete; },
  set oncomplete(fn) { mockTxComplete.oncomplete = fn; if (fn) setTimeout(fn, 0); },
  get onerror() { return mockTxComplete.onerror; },
  set onerror(fn) { mockTxComplete.onerror = fn; },
}));

const mockDb = { transaction: mockTransaction };

global.indexedDB = {
  open: jest.fn(() => {
    const req = { onupgradeneeded: null, onsuccess: null, onerror: null, result: mockDb };
    setTimeout(() => { if (req.onsuccess) req.onsuccess(); }, 0);
    return req;
  }),
};

import useFileUpload, { UPLOAD_STATUS } from '../../frontend/src/hooks/useFileUpload';

describe('useFileUpload', () => {
  const defaultParams = {
    workspaceId: 'ws-test',
    workspaceKey: new Uint8Array(32),
    userPublicKey: 'pk-user1',
    createFileRecord: jest.fn(() => ({ id: 'file-created-1', name: 'test.txt' })),
    setChunkAvailability: jest.fn(),
    addAuditEntry: jest.fn(),
  };

  afterEach(() => jest.clearAllMocks());

  it('should export UPLOAD_STATUS constants', () => {
    expect(UPLOAD_STATUS.IDLE).toBe('idle');
    expect(UPLOAD_STATUS.READING).toBe('reading');
    expect(UPLOAD_STATUS.CHUNKING).toBe('chunking');
    expect(UPLOAD_STATUS.ENCRYPTING).toBe('encrypting');
    expect(UPLOAD_STATUS.STORING).toBe('storing');
    expect(UPLOAD_STATUS.COMPLETE).toBe('complete');
    expect(UPLOAD_STATUS.ERROR).toBe('error');
  });

  it('should start with no uploads', () => {
    const { result } = renderHook(() => useFileUpload(defaultParams));
    expect(result.current.uploads).toEqual([]);
  });

  it('should expose uploadFile, uploadFiles, clearUpload, clearCompleted', () => {
    const { result } = renderHook(() => useFileUpload(defaultParams));
    expect(typeof result.current.uploadFile).toBe('function');
    expect(typeof result.current.uploadFiles).toBe('function');
    expect(typeof result.current.clearUpload).toBe('function');
    expect(typeof result.current.clearCompleted).toBe('function');
  });

  it('should reject files that fail validation', async () => {
    // Create a file that's too large
    const bigFile = new File(['x'.repeat(100)], 'big.dat', { type: 'application/octet-stream' });
    Object.defineProperty(bigFile, 'size', { value: 200 * 1024 * 1024 }); // 200MB > MAX_FILE_SIZE

    const { result } = renderHook(() => useFileUpload(defaultParams));
    
    let caughtError;
    await act(async () => {
      try {
        await result.current.uploadFile(bigFile);
      } catch (err) {
        caughtError = err;
      }
    });

    expect(caughtError).toBeDefined();
    // Upload should have error status
    expect(result.current.uploads.length).toBe(1);
    expect(result.current.uploads[0].status).toBe(UPLOAD_STATUS.ERROR);
  });

  it('should call createFileRecord after successful upload', async () => {
    const file = new File(['hello world'], 'test.txt', { type: 'text/plain' });

    const { result } = renderHook(() => useFileUpload(defaultParams));

    await act(async () => {
      await result.current.uploadFile(file);
    });

    expect(defaultParams.createFileRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'file-test-id-123',
        name: 'test.txt',
        chunkCount: 2,
      })
    );
  });

  it('should set chunk availability for each chunk', async () => {
    const file = new File(['hello world'], 'test.txt', { type: 'text/plain' });

    const { result } = renderHook(() => useFileUpload(defaultParams));

    await act(async () => {
      await result.current.uploadFile(file);
    });

    // 2 chunks → 2 calls
    expect(defaultParams.setChunkAvailability).toHaveBeenCalledTimes(2);
    expect(defaultParams.setChunkAvailability).toHaveBeenCalledWith(
      'file-test-id-123', 0, ['pk-user1']
    );
    expect(defaultParams.setChunkAvailability).toHaveBeenCalledWith(
      'file-test-id-123', 1, ['pk-user1']
    );
  });

  it('should clear a specific upload', async () => {
    const file = new File(['hello'], 'test.txt', { type: 'text/plain' });
    const { result } = renderHook(() => useFileUpload(defaultParams));

    await act(async () => {
      await result.current.uploadFile(file);
    });
    expect(result.current.uploads.length).toBe(1);
    const uploadId = result.current.uploads[0].uploadId;

    act(() => result.current.clearUpload(uploadId));
    expect(result.current.uploads.length).toBe(0);
  });

  it('should clear all completed uploads', async () => {
    const file1 = new File(['a'], 'a.txt', { type: 'text/plain' });
    const file2 = new File(['b'], 'b.txt', { type: 'text/plain' });
    const { result } = renderHook(() => useFileUpload(defaultParams));

    await act(async () => {
      await result.current.uploadFile(file1);
      await result.current.uploadFile(file2);
    });
    expect(result.current.uploads.length).toBe(2);

    act(() => result.current.clearCompleted());
    expect(result.current.uploads.length).toBe(0);
  });

  it('should upload to specified folder', async () => {
    const file = new File(['hello'], 'test.txt', { type: 'text/plain' });
    const { result } = renderHook(() => useFileUpload(defaultParams));

    await act(async () => {
      await result.current.uploadFile(file, 'folder-123');
    });

    expect(defaultParams.createFileRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        folderId: 'folder-123',
      })
    );
  });
});
