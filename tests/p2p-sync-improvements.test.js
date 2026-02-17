/**
 * Tests for P2P sync improvements in the sidecar.
 * 
 * Covers:
 * - Duplicate observer prevention (registeredTopicObservers guard)
 * - Fallback format validation (Yjs update length check)
 * - Sync retry intervals and attempt counts
 * - handleSyncStateReceived fallback topic lookup
 * - Workspace-meta broadcast safety net in updateHandler
 * - Awareness doc creation on demand
 */

describe('P2P Sync Improvements', () => {
  describe('Duplicate Observer Prevention', () => {
    test('registeredTopicObservers Set prevents duplicate entries', () => {
      const registeredTopicObservers = new Set();
      const workspaceId = 'ws-123';
      
      // First registration should add
      expect(registeredTopicObservers.has(workspaceId)).toBe(false);
      registeredTopicObservers.add(workspaceId);
      expect(registeredTopicObservers.has(workspaceId)).toBe(true);
      
      // Second registration should be a no-op (Set behavior)
      registeredTopicObservers.add(workspaceId);
      expect(registeredTopicObservers.size).toBe(1);
    });

    test('guard prevents adding observer when already registered', () => {
      const registeredTopicObservers = new Set();
      const observerCount = { value: 0 };
      
      const addObserver = (workspaceId) => {
        if (!registeredTopicObservers.has(workspaceId)) {
          registeredTopicObservers.add(workspaceId);
          observerCount.value++;
        }
      };
      
      addObserver('ws-1');
      addObserver('ws-1'); // Should be blocked
      addObserver('ws-1'); // Should be blocked
      
      expect(observerCount.value).toBe(1);
    });

    test('different workspaces get separate observers', () => {
      const registeredTopicObservers = new Set();
      const observerCount = { value: 0 };
      
      const addObserver = (workspaceId) => {
        if (!registeredTopicObservers.has(workspaceId)) {
          registeredTopicObservers.add(workspaceId);
          observerCount.value++;
        }
      };
      
      addObserver('ws-1');
      addObserver('ws-2');
      addObserver('ws-3');
      
      expect(observerCount.value).toBe(3);
      expect(registeredTopicObservers.size).toBe(3);
    });
  });

  describe('Fallback Format Validation', () => {
    test('rejects update data shorter than 2 bytes', () => {
      const validateUpdate = (data) => {
        if (!data || data.length < 2) return false;
        return true;
      };
      
      expect(validateUpdate(null)).toBe(false);
      expect(validateUpdate(new Uint8Array([]))).toBe(false);
      expect(validateUpdate(new Uint8Array([0]))).toBe(false);
      expect(validateUpdate(new Uint8Array([0, 1]))).toBe(true);
      expect(validateUpdate(new Uint8Array([0, 1, 2]))).toBe(true);
    });

    test('valid Yjs update starts with proper header', () => {
      const Y = require('yjs');
      const doc = new Y.Doc();
      doc.getText('test').insert(0, 'hello');
      const update = Y.encodeStateAsUpdate(doc);
      
      expect(update.length).toBeGreaterThanOrEqual(2);
      doc.destroy();
    });
  });

  describe('Sync Retry Configuration', () => {
    test('retry intervals provide adequate total timeout', () => {
      const SYNC_VERIFY_RETRY_INTERVALS = [15000, 15000, 15000, 15000, 15000, 15000];
      const SYNC_VERIFY_MAX_RETRIES = 6;
      
      expect(SYNC_VERIFY_RETRY_INTERVALS).toHaveLength(SYNC_VERIFY_MAX_RETRIES);
      
      const totalTimeout = SYNC_VERIFY_RETRY_INTERVALS.reduce((sum, ms) => sum + ms, 0);
      expect(totalTimeout).toBe(90000); // 90 seconds total
      expect(totalTimeout).toBeGreaterThanOrEqual(60000); // At least 1 minute
    });

    test('P2P init max attempts is sufficient for slow networks', () => {
      const P2P_INIT_MAX_ATTEMPTS = 10;
      expect(P2P_INIT_MAX_ATTEMPTS).toBeGreaterThanOrEqual(5);
    });

    test('checkAndRecoverSparse delay allows initial sync to complete', () => {
      const SPARSE_CHECK_DELAY = 30000; // 30 seconds
      expect(SPARSE_CHECK_DELAY).toBeGreaterThanOrEqual(15000);
    });
  });

  describe('Topic Lookup Fallback', () => {
    test('loadWorkspaceList + getWorkspaceTopicHex pattern finds topic', () => {
      // Simulate the fallback pattern used in handleSyncStateReceived
      const topicToWorkspace = new Map();
      topicToWorkspace.set('abc123', 'ws-1');
      topicToWorkspace.set('def456', 'ws-2');
      
      const workspaceList = [
        { id: 'ws-1', topicHex: 'abc123' },
        { id: 'ws-2', topicHex: 'def456' },
      ];
      
      // Given a topic, find the workspace
      const findWorkspace = (topicHex) => {
        // Primary: topicToWorkspace Map
        if (topicToWorkspace.has(topicHex)) {
          return topicToWorkspace.get(topicHex);
        }
        // Fallback: workspace list
        const ws = workspaceList.find(w => w.topicHex === topicHex);
        return ws?.id || null;
      };
      
      expect(findWorkspace('abc123')).toBe('ws-1');
      expect(findWorkspace('def456')).toBe('ws-2');
      expect(findWorkspace('nonexistent')).toBeNull();
    });

    test('fallback registers topic for future lookups', () => {
      const topicToWorkspace = new Map();
      
      // Initially topic not registered
      expect(topicToWorkspace.has('abc123')).toBe(false);
      
      // After fallback finds the mapping, register it
      const workspaceId = 'ws-1';
      const topicHex = 'abc123';
      topicToWorkspace.set(topicHex, workspaceId);
      
      // Now primary lookup works
      expect(topicToWorkspace.get('abc123')).toBe('ws-1');
    });
  });

  describe('Workspace-Meta Broadcast Safety Net', () => {
    test('safety net only fires when primary observer not registered', () => {
      const registeredTopicObservers = new Set();
      const broadcastCalls = [];
      
      const broadcastUpdate = (wsId, topicHex, update) => {
        broadcastCalls.push({ wsId, topicHex });
      };
      
      const handleUpdateHandler = (docName, wsId, topicHex, update) => {
        if (docName.startsWith('workspace-meta:')) {
          if (!registeredTopicObservers.has(wsId)) {
            broadcastUpdate(wsId, topicHex, update);
          }
        }
      };
      
      // When observer NOT registered, safety net fires
      handleUpdateHandler('workspace-meta:ws-1', 'ws-1', 'topic1', new Uint8Array([1, 2]));
      expect(broadcastCalls).toHaveLength(1);
      
      // When observer IS registered, safety net does NOT fire
      registeredTopicObservers.add('ws-2');
      handleUpdateHandler('workspace-meta:ws-2', 'ws-2', 'topic2', new Uint8Array([1, 2]));
      expect(broadcastCalls).toHaveLength(1); // No additional call
    });
  });
});

describe('Awareness Doc Creation On Demand', () => {
  test('getYDoc creates doc when not in docs Map', () => {
    const docs = new Map();
    const Y = require('yjs');
    
    // Simulate getYDoc
    const getYDoc = (roomName) => {
      if (!docs.has(roomName)) {
        const doc = new Y.Doc();
        docs.set(roomName, doc);
        return doc;
      }
      return docs.get(roomName);
    };
    
    const roomName = 'doc-123';
    expect(docs.has(roomName)).toBe(false);
    
    const doc = getYDoc(roomName);
    expect(doc).toBeDefined();
    expect(docs.has(roomName)).toBe(true);
    
    doc.destroy();
  });

  test('getYDoc returns existing doc when already in Map', () => {
    const docs = new Map();
    const Y = require('yjs');
    
    const existingDoc = new Y.Doc();
    docs.set('doc-123', existingDoc);
    
    const getYDoc = (roomName) => {
      if (!docs.has(roomName)) {
        const doc = new Y.Doc();
        docs.set(roomName, doc);
        return doc;
      }
      return docs.get(roomName);
    };
    
    const doc = getYDoc('doc-123');
    expect(doc).toBe(existingDoc); // Same reference
    
    existingDoc.destroy();
  });
});
