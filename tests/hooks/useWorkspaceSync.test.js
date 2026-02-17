/**
 * useWorkspaceSync Hook Tests
 * 
 * Tests for frontend/src/hooks/useWorkspaceSync.js
 * 
 * Tests cover:
 * - Hook initialization
 * - State management (documents, folders, collaborators)
 * - Connection state
 * - Sync phases
 * - Cleanup on unmount
 */

import { renderHook, act, waitFor } from '@testing-library/react';

// Mock Y.js dependencies
const mockYMap = () => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  has: jest.fn().mockReturnValue(false),
  delete: jest.fn(),
  keys: jest.fn().mockReturnValue([]),
  entries: jest.fn().mockReturnValue([]),
  forEach: jest.fn(),
  toJSON: jest.fn().mockReturnValue({}),
});

const mockYArray = () => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  toArray: jest.fn().mockReturnValue([]),
  forEach: jest.fn(),
  length: 0,
  push: jest.fn(),
  delete: jest.fn(),
  insert: jest.fn(),
  get: jest.fn(),
  toJSON: jest.fn().mockReturnValue([]),
});

jest.mock('yjs', () => ({
  Doc: jest.fn().mockImplementation(() => ({
    getArray: jest.fn().mockImplementation(() => mockYArray()),
    getMap: jest.fn().mockImplementation(() => mockYMap()),
    on: jest.fn(),
    off: jest.fn(),
    destroy: jest.fn(),
  })),
}));

// Mock y-websocket
jest.mock('y-websocket', () => ({
  WebsocketProvider: jest.fn().mockImplementation((url, room, doc, options) => ({
    awareness: {
      setLocalState: jest.fn(),
      setLocalStateField: jest.fn(),
      getLocalState: jest.fn().mockReturnValue({}),
      getStates: jest.fn().mockReturnValue(new Map()),
      on: jest.fn(),
      off: jest.fn(),
      destroy: jest.fn(),
    },
    on: jest.fn((event, callback) => {
      // Immediately fire 'sync' event to simulate connected state
      if (event === 'sync') {
        setTimeout(() => callback(true), 100);
      }
      if (event === 'status') {
        setTimeout(() => callback({ status: 'connected' }), 100);
      }
    }),
    off: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
    destroy: jest.fn(),
    connected: true,
    synced: false,
    wsconnected: true,
    awareness: {
      setLocalState: jest.fn(),
      setLocalStateField: jest.fn(),
      getLocalState: jest.fn().mockReturnValue({}),
      getStates: jest.fn().mockReturnValue(new Map()),
      on: jest.fn(),
      off: jest.fn(),
      destroy: jest.fn(),
    },
  })),
}));

// Mock useEnvironment
jest.mock('../../frontend/src/hooks/useEnvironment', () => ({
  isElectron: jest.fn().mockReturnValue(false),
}));

// Mock websocket utilities
jest.mock('../../frontend/src/utils/websocket', () => ({
  getYjsWebSocketUrl: jest.fn().mockReturnValue('ws://localhost:4000'),
}));

// Mock keyDerivation
jest.mock('../../frontend/src/utils/keyDerivation', () => ({
  getStoredKeyChain: jest.fn().mockResolvedValue(null),
}));

// Mock uint8arrays
jest.mock('uint8arrays', () => ({
  toString: jest.fn().mockReturnValue('mock-base64'),
}));

// Mock constants
jest.mock('../../frontend/src/config/constants', () => ({
  META_WS_PORT: 4000,
  WS_RECONNECT_MAX_DELAY: 30000,
  TIMEOUT_LONG: 60000,
  AWARENESS_HEARTBEAT_MS: 15000,
}));

// Import after mocks
const { useWorkspaceSync } = require('../../frontend/src/hooks/useWorkspaceSync');

describe('useWorkspaceSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Initialization', () => {
    test('returns initial state when no workspaceId provided', () => {
      const { result } = renderHook(() => useWorkspaceSync(null));
      
      expect(result.current.documents).toEqual([]);
      expect(result.current.folders).toEqual([]);
      expect(result.current.workspaceInfo).toBeNull();
      expect(result.current.connected).toBe(false);
      expect(result.current.synced).toBe(false);
      expect(result.current.collaborators).toEqual([]);
      expect(result.current.onlineCount).toBe(0);
    });

    test('initializes with provided workspaceId', () => {
      const { result } = renderHook(() => 
        useWorkspaceSync('workspace-123', { name: 'Test Workspace' })
      );
      
      // Should start connecting phase
      expect(result.current.syncPhase).toBe('connecting');
    });

    test('initializes with empty documents array', () => {
      const { result } = renderHook(() => useWorkspaceSync('workspace-123'));
      
      expect(Array.isArray(result.current.documents)).toBe(true);
    });

    test('initializes with empty folders array', () => {
      const { result } = renderHook(() => useWorkspaceSync('workspace-123'));
      
      expect(Array.isArray(result.current.folders)).toBe(true);
    });
  });

  describe('Sync Phases', () => {
    test('starts with idle phase when no workspace', () => {
      const { result } = renderHook(() => useWorkspaceSync(null));
      
      expect(result.current.syncPhase).toBe('idle');
    });

    test('transitions to connecting phase with workspace', () => {
      const { result } = renderHook(() => useWorkspaceSync('workspace-123'));
      
      expect(result.current.syncPhase).toBe('connecting');
    });

    test('syncProgress has correct structure', () => {
      const { result } = renderHook(() => useWorkspaceSync('workspace-123'));
      
      expect(result.current.syncProgress).toHaveProperty('bytesReceived');
      expect(result.current.syncProgress).toHaveProperty('documentsReceived');
      expect(result.current.syncProgress).toHaveProperty('foldersReceived');
      expect(result.current.syncProgress).toHaveProperty('membersReceived');
    });
  });

  describe('Collaborator State', () => {
    test('initializes with empty collaborators', () => {
      const { result } = renderHook(() => useWorkspaceSync('workspace-123'));
      
      expect(result.current.collaborators).toEqual([]);
    });

    test('initializes with zero online count', () => {
      const { result } = renderHook(() => useWorkspaceSync('workspace-123'));
      
      expect(result.current.onlineCount).toBe(0);
    });

    test('initializes with zero total count', () => {
      const { result } = renderHook(() => useWorkspaceSync('workspace-123'));
      
      expect(result.current.totalCount).toBe(0);
    });

    test('collaboratorsByDocument is an object', () => {
      const { result } = renderHook(() => useWorkspaceSync('workspace-123'));
      
      expect(typeof result.current.collaboratorsByDocument).toBe('object');
    });
  });

  describe('Membership State', () => {
    test('initializes with empty members object', () => {
      const { result } = renderHook(() => useWorkspaceSync('workspace-123'));
      
      expect(result.current.members).toEqual({});
    });

    test('initializes with isKicked as false', () => {
      const { result } = renderHook(() => useWorkspaceSync('workspace-123'));
      
      expect(result.current.isKicked).toBe(false);
    });
  });

  describe('Document/Folder State', () => {
    test('documentFolders is an object', () => {
      const { result } = renderHook(() => useWorkspaceSync('workspace-123'));
      
      expect(typeof result.current.documentFolders).toBe('object');
    });

    test('trashedDocuments is an array', () => {
      const { result } = renderHook(() => useWorkspaceSync('workspace-123'));
      
      expect(Array.isArray(result.current.trashedDocuments)).toBe(true);
    });
  });

  describe('Workspace Changes', () => {
    test('resets state when workspace changes', async () => {
      const { result, rerender } = renderHook(
        ({ workspaceId }) => useWorkspaceSync(workspaceId),
        { initialProps: { workspaceId: 'workspace-1' } }
      );
      
      // Advance timers to let initial setup complete
      act(() => {
        jest.advanceTimersByTime(200);
      });
      
      // Change workspace
      rerender({ workspaceId: 'workspace-2' });
      
      // State should be reset
      expect(result.current.isKicked).toBe(false);
      expect(result.current.synced).toBe(false);
    });

    test('clears state when workspace becomes null', () => {
      const { result, rerender } = renderHook(
        ({ workspaceId }) => useWorkspaceSync(workspaceId),
        { initialProps: { workspaceId: 'workspace-1' } }
      );
      
      // Clear workspace
      rerender({ workspaceId: null });
      
      expect(result.current.documents).toEqual([]);
      expect(result.current.folders).toEqual([]);
      expect(result.current.connected).toBe(false);
      expect(result.current.syncPhase).toBe('idle');
    });
  });

  describe('Returned Functions', () => {
    test('addDocument function exists', () => {
      const { result } = renderHook(() => useWorkspaceSync('workspace-123'));
      
      expect(typeof result.current.addDocument).toBe('function');
    });

    test('updateDocument function exists', () => {
      const { result } = renderHook(() => useWorkspaceSync('workspace-123'));
      
      expect(typeof result.current.updateDocument).toBe('function');
    });

    test('removeDocument function exists', () => {
      const { result } = renderHook(() => useWorkspaceSync('workspace-123'));
      
      expect(typeof result.current.removeDocument).toBe('function');
    });

    test('addFolder function exists', () => {
      const { result } = renderHook(() => useWorkspaceSync('workspace-123'));
      
      expect(typeof result.current.addFolder).toBe('function');
    });

    test('updateFolder function exists', () => {
      const { result } = renderHook(() => useWorkspaceSync('workspace-123'));
      
      expect(typeof result.current.updateFolder).toBe('function');
    });

    test('removeFolder function exists', () => {
      const { result } = renderHook(() => useWorkspaceSync('workspace-123'));
      
      expect(typeof result.current.removeFolder).toBe('function');
    });

    test('updateWorkspaceInfo function exists', () => {
      const { result } = renderHook(() => useWorkspaceSync('workspace-123'));
      
      expect(typeof result.current.updateWorkspaceInfo).toBe('function');
    });
  });

  describe('Server URL Support', () => {
    test('accepts serverUrl parameter', () => {
      const { result } = renderHook(() => 
        useWorkspaceSync(
          'workspace-123', 
          { name: 'Test' }, 
          { name: 'User' }, 
          'wss://remote.server.com'
        )
      );
      
      // Should initialize without error
      expect(result.current.syncPhase).toBe('connecting');
    });
  });

  describe('User Profile Support', () => {
    test('accepts userProfile parameter', () => {
      const userProfile = {
        name: 'Test User',
        color: '#ff0000',
        icon: '👤',
      };
      
      const { result } = renderHook(() => 
        useWorkspaceSync('workspace-123', { name: 'Test' }, userProfile)
      );
      
      // Should initialize without error
      expect(result.current.syncPhase).toBe('connecting');
    });
  });

  describe('Permission Support', () => {
    test('accepts myPermission parameter', () => {
      const { result } = renderHook(() => 
        useWorkspaceSync(
          'workspace-123', 
          { name: 'Test' }, 
          { name: 'User' },
          null, // serverUrl
          { publicKeyBase62: 'abc123' }, // userIdentity
          'owner' // myPermission
        )
      );
      
      // Should initialize without error
      expect(result.current.syncPhase).toBe('connecting');
    });
  });
});
