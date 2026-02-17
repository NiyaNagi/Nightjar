/**
 * Tests for FileStorageDashboard component.
 * 
 * Tests the shell component rendering, view switching, and sub-component composition.
 * Uses mock Yjs structures and mocked hooks to avoid actual P2P connections.
 * 
 * See docs/FILE_STORAGE_SPEC.md §5, §15.9
 */

import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import FileStorageDashboard from '../../../frontend/src/components/files/FileStorageDashboard';

// --- Mock hooks ---
jest.mock('../../../frontend/src/hooks/useFileUpload', () => {
  return jest.fn(() => ({
    uploadFile: jest.fn(),
    uploadFiles: jest.fn(),
    uploads: [],
    clearUpload: jest.fn(),
    clearCompleted: jest.fn(),
    UPLOAD_STATUS: { IDLE: 'IDLE', READING: 'READING', CHUNKING: 'CHUNKING', ENCRYPTING: 'ENCRYPTING', STORING: 'STORING', COMPLETE: 'COMPLETE', ERROR: 'ERROR' },
  }));
});

jest.mock('../../../frontend/src/hooks/useFileDownload', () => {
  return jest.fn(() => ({
    downloadFile: jest.fn(),
    checkLocalAvailability: jest.fn(),
    downloads: [],
    clearDownload: jest.fn(),
    DOWNLOAD_STATUS: { IDLE: 'IDLE', FETCHING: 'FETCHING', DECRYPTING: 'DECRYPTING', ASSEMBLING: 'ASSEMBLING', COMPLETE: 'COMPLETE', ERROR: 'ERROR' },
  }));
});

jest.mock('../../../frontend/src/hooks/useFileTransfer', () => {
  return jest.fn(() => ({
    handleChunkRequest: jest.fn(),
    requestChunkFromPeer: jest.fn(),
    announceAvailability: jest.fn(),
    getLocalChunkCount: jest.fn(),
    transferStats: { chunksServed: 0, chunksFetched: 0, bytesServed: 0, bytesFetched: 0 },
  }));
});

jest.mock('../../../frontend/src/hooks/useChunkSeeding', () => {
  return jest.fn(() => ({
    seedingStats: { chunksSeeded: 0, bytesSeeded: 0, seedingActive: false, lastSeedRun: null, underReplicatedCount: 0 },
    bandwidthHistory: [],
    triggerSeedCycle: jest.fn(),
    trackReceivedBytes: jest.fn(),
    runSeedCycle: jest.fn(),
  }));
});

jest.mock('../../../frontend/src/contexts/FileTransferContext', () => ({
  useFileTransferContext: jest.fn(() => ({
    seedingStats: { chunksSeeded: 0, bytesSeeded: 0, seedingActive: false, lastSeedRun: null, underReplicatedCount: 0 },
    bandwidthHistory: [],
    triggerSeedCycle: jest.fn(),
    resetStats: jest.fn(),
    requestChunkFromPeer: jest.fn(),
    announceAvailability: jest.fn(),
    getLocalChunkCount: jest.fn(),
    handleChunkRequest: jest.fn(),
    transferStats: { chunksServed: 0, chunksFetched: 0, bytesServed: 0, bytesFetched: 0 },
    trackReceivedBytes: jest.fn(),
    runSeedCycle: jest.fn(),
  })),
  FileTransferProvider: ({ children }) => children,
}));

jest.mock('../../../frontend/src/services/p2p/index.js', () => ({
  getPeerManager: jest.fn(() => ({
    getConnectedPeers: jest.fn(() => []),
    registerHandler: jest.fn(),
    unregisterHandler: jest.fn(),
    send: jest.fn(),
    broadcast: jest.fn(),
  })),
}));

jest.mock('../../../frontend/src/utils/keyDerivation', () => ({
  getStoredKeyChain: jest.fn(() => ({ workspaceKey: new Uint8Array(32) })),
}));

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

function makeProps(overrides = {}) {
  const fsId = 'fs-test-dash';
  const yFileStorageSystems = new MockYMap();
  const yStorageFiles = new MockYArray();
  const yStorageFolders = new MockYArray();
  const yChunkAvailability = new MockYMap();
  const yFileAuditLog = new MockYArray();

  yFileStorageSystems.set(fsId, {
    id: fsId,
    name: 'Test Storage',
    workspaceId: 'ws-1',
    createdAt: Date.now(),
    createdBy: 'pk-user1',
    settings: {},
  });

  return {
    fileStorageId: fsId,
    workspaceId: 'ws-1',
    yFileStorageSystems,
    yStorageFiles,
    yStorageFolders,
    yChunkAvailability,
    yFileAuditLog,
    userIdentity: { publicKeyBase62: 'pk-user1', displayName: 'Alice', name: 'Alice' },
    collaborators: [],
    workspaceProvider: null,
    onClose: jest.fn(),
    ...overrides,
  };
}

describe('FileStorageDashboard', () => {
  it('should render without crashing', () => {
    render(<FileStorageDashboard {...makeProps()} />);
    expect(screen.getByTestId('fs-dashboard')).toBeInTheDocument();
  });

  it('should render nav rail', () => {
    render(<FileStorageDashboard {...makeProps()} />);
    expect(screen.getByTestId('fs-nav-rail')).toBeInTheDocument();
  });

  it('should start on Browse view', () => {
    render(<FileStorageDashboard {...makeProps()} />);
    expect(screen.getByTestId('browse-view')).toBeInTheDocument();
  });

  it('should show empty state when no files', () => {
    render(<FileStorageDashboard {...makeProps()} />);
    // BrowseView shows empty state
    expect(screen.getByTestId('browse-empty')).toBeInTheDocument();
  });

  it('should switch to Recent view on nav click', () => {
    render(<FileStorageDashboard {...makeProps()} />);
    fireEvent.click(screen.getByTestId('fs-nav-recent'));
    expect(screen.getByTestId('recent-view')).toBeInTheDocument();
  });

  it('should switch to Downloads view', () => {
    render(<FileStorageDashboard {...makeProps()} />);
    fireEvent.click(screen.getByTestId('fs-nav-downloads'));
    expect(screen.getByTestId('downloads-view')).toBeInTheDocument();
  });

  it('should switch to Favorites view', () => {
    render(<FileStorageDashboard {...makeProps()} />);
    fireEvent.click(screen.getByTestId('fs-nav-favorites'));
    expect(screen.getByTestId('favorites-view')).toBeInTheDocument();
  });

  it('should switch to Trash view', () => {
    render(<FileStorageDashboard {...makeProps()} />);
    fireEvent.click(screen.getByTestId('fs-nav-trash'));
    expect(screen.getByTestId('trash-view')).toBeInTheDocument();
  });

  it('should switch to Audit Log view', () => {
    render(<FileStorageDashboard {...makeProps()} />);
    fireEvent.click(screen.getByTestId('fs-nav-audit_log'));
    expect(screen.getByTestId('audit-view')).toBeInTheDocument();
  });

  it('should switch to Storage view', () => {
    render(<FileStorageDashboard {...makeProps()} />);
    fireEvent.click(screen.getByTestId('fs-nav-storage'));
    expect(screen.getByTestId('storage-view')).toBeInTheDocument();
  });

  it('should switch to Settings view', () => {
    render(<FileStorageDashboard {...makeProps()} />);
    fireEvent.click(screen.getByTestId('fs-nav-settings'));
    expect(screen.getByTestId('settings-view')).toBeInTheDocument();
  });

  it('should switch to Mesh view', () => {
    render(<FileStorageDashboard {...makeProps()} />);
    fireEvent.click(screen.getByTestId('fs-nav-mesh'));
    expect(screen.getByTestId('mesh-view')).toBeInTheDocument();
  });

  // --- With data ---

  it('should display files in Browse view', () => {
    const props = makeProps();
    props.yStorageFiles.push([
      {
        id: 'f1',
        fileStorageId: 'fs-test-dash',
        name: 'document.pdf',
        sizeBytes: 1024,
        extension: 'pdf',
        typeCategory: 'document',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
        folderId: null,
        favoritedBy: [],
        tags: [],
      },
    ]);

    render(<FileStorageDashboard {...props} />);
    expect(screen.getByText('document.pdf')).toBeInTheDocument();
  });

  it('should display trashed files in Trash view', () => {
    const props = makeProps();
    props.yStorageFiles.push([
      {
        id: 'f1',
        fileStorageId: 'fs-test-dash',
        name: 'deleted.txt',
        sizeBytes: 512,
        extension: 'txt',
        typeCategory: 'document',
        createdAt: Date.now(),
        deletedAt: Date.now(),
        folderId: null,
        favoritedBy: [],
        tags: [],
      },
    ]);

    render(<FileStorageDashboard {...props} />);
    fireEvent.click(screen.getByTestId('fs-nav-trash'));
    expect(screen.getByText('deleted.txt')).toBeInTheDocument();
  });

  it('should display audit log entries', () => {
    const props = makeProps();
    props.yFileAuditLog.push([
      {
        id: 'a1',
        fileStorageId: 'fs-test-dash',
        action: 'upload',
        timestamp: Date.now(),
        actor: 'pk-user1',
        targetName: 'report.pdf',
        details: 'Uploaded report.pdf',
      },
    ]);

    render(<FileStorageDashboard {...props} />);
    fireEvent.click(screen.getByTestId('fs-nav-audit_log'));
    expect(screen.getByTestId('audit-view')).toBeInTheDocument();
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
  });

  it('should display storage stats', () => {
    const props = makeProps();
    props.yStorageFiles.push([
      {
        id: 'f1',
        fileStorageId: 'fs-test-dash',
        name: 'a.jpg',
        sizeBytes: 1024 * 1024,
        typeCategory: 'image',
        extension: 'jpg',
        createdAt: Date.now(),
        deletedAt: null,
        folderId: null,
        favoritedBy: [],
        tags: [],
      },
    ]);

    render(<FileStorageDashboard {...props} />);
    fireEvent.click(screen.getByTestId('fs-nav-storage'));
    expect(screen.getByTestId('storage-view')).toBeInTheDocument();
  });

  it('should not render Downloads bar when no downloads', () => {
    render(<FileStorageDashboard {...makeProps()} />);
    // DownloadsBar returns null when downloads array is empty
    expect(screen.queryByTestId('downloads-bar')).not.toBeInTheDocument();
  });

  it('should show nav badges for trash count', () => {
    const props = makeProps();
    props.yStorageFiles.push([
      {
        id: 'f1',
        fileStorageId: 'fs-test-dash',
        name: 'trashed.txt',
        sizeBytes: 100,
        createdAt: Date.now(),
        deletedAt: Date.now(),
        folderId: null,
        favoritedBy: [],
        tags: [],
      },
    ]);

    render(<FileStorageDashboard {...props} />);
    const trashNav = screen.getByTestId('fs-nav-trash');
    // Badge should show count
    expect(within(trashNav).getByText('1')).toBeInTheDocument();
  });
});
