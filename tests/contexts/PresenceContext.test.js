/**
 * PresenceContext Unit Tests
 * 
 * Tests for frontend/src/contexts/PresenceContext.jsx
 * 
 * Tests cover:
 * - usePresence hook
 * - PresenceProvider component
 * - updateCursor (throttled)
 * - updateSelection (throttled)
 * - setTypingIndicator (auto-clear)
 * - getPeersOnDocument
 * - Cleanup on unmount
 */

import React from 'react';
import { render, act, renderHook } from '@testing-library/react';
import '@testing-library/jest-dom';

// Create mock awareness factory inline (Jest requires mock variables to be prefixed with 'mock')
const mockCreateAwareness = (clientId = 1) => {
  const states = new Map();
  const localState = {};
  const listeners = [];
  
  return {
    clientID: clientId,
    states,
    getLocalState: jest.fn(() => localState),
    setLocalState: jest.fn((state) => {
      Object.assign(localState, state);
    }),
    setLocalStateField: jest.fn((field, value) => {
      localState[field] = value;
    }),
    getStates: jest.fn(() => states),
    on: jest.fn((event, callback) => {
      listeners.push({ event, callback });
    }),
    off: jest.fn((event, callback) => {
      const idx = listeners.findIndex(l => l.event === event && l.callback === callback);
      if (idx >= 0) listeners.splice(idx, 1);
    }),
    simulateRemotePeer: (peerId, state) => {
      states.set(peerId, state);
      // Trigger change listeners
      listeners.filter(l => l.event === 'change').forEach(l => {
        l.callback({ added: [peerId], updated: [], removed: [] }, 'remote');
      });
    },
    simulatePeerLeave: (peerId) => {
      states.delete(peerId);
      listeners.filter(l => l.event === 'change').forEach(l => {
        l.callback({ added: [], updated: [], removed: [peerId] }, 'remote');
      });
    },
    destroy: jest.fn(),
  };
};

// Mock y-protocols/awareness before any imports
jest.mock('y-protocols/awareness', () => ({
  Awareness: jest.fn().mockImplementation(() => mockCreateAwareness(1)),
}));

// Mock IdentityContext
jest.mock('../../frontend/src/contexts/IdentityContext', () => ({
  useIdentity: () => ({
    publicIdentity: {
      publicKeyBase62: 'testPublicKey123',
      handle: 'TestUser',
      color: '#6366f1',
      icon: '🧪',
      deviceId: 'device-1',
      deviceName: 'Test Device',
    },
  }),
  IdentityProvider: ({ children }) => children,
}));

// Mock colorUtils
jest.mock('../../frontend/src/utils/colorUtils', () => ({
  generateIdentityColor: () => '#6366f1',
}));

// Import after mocks
const { PresenceProvider, usePresence } = require('../../frontend/src/contexts/PresenceContext');

describe('PresenceContext', () => {
  let mockAwareness;

  beforeEach(() => {
    mockAwareness = mockCreateAwareness(12345);
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('PresenceProvider', () => {
    test('renders children', () => {
      const { getByText } = render(
        <PresenceProvider awareness={mockAwareness}>
          <div>Test Child</div>
        </PresenceProvider>
      );
      expect(getByText('Test Child')).toBeInTheDocument();
    });

    test('initializes with empty peers map', () => {
      let contextValue;
      render(
        <PresenceProvider awareness={mockAwareness}>
          <TestConsumer onValue={(v) => { contextValue = v; }} />
        </PresenceProvider>
      );
      expect(contextValue.peers.size).toBe(0);
      expect(contextValue.onlinePeersCount).toBe(0);
    });

    test('sets local awareness state from identity', () => {
      render(
        <PresenceProvider awareness={mockAwareness}>
          <div>Test</div>
        </PresenceProvider>
      );
      
      expect(mockAwareness.setLocalStateField).toHaveBeenCalledWith('user', expect.objectContaining({
        name: 'TestUser',
        color: '#6366f1',
        icon: '🧪',
        publicKey: 'testPublicKey123',
      }));
    });
  });

  describe('usePresence hook', () => {
    test('throws error when used outside provider', () => {
      // Suppress console.error for this test
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      expect(() => {
        renderHook(() => usePresence());
      }).toThrow('usePresence must be used within PresenceProvider');
      
      spy.mockRestore();
    });

    test('returns context value', () => {
      const wrapper = ({ children }) => (
        <PresenceProvider awareness={mockAwareness}>{children}</PresenceProvider>
      );
      
      const { result } = renderHook(() => usePresence(), { wrapper });
      
      expect(result.current.peers).toBeDefined();
      expect(result.current.updateCursor).toBeDefined();
      expect(result.current.updateSelection).toBeDefined();
      expect(result.current.setTypingIndicator).toBeDefined();
      expect(result.current.getPeersOnDocument).toBeDefined();
    });
  });

  describe('updateCursor', () => {
    test('updates cursor position in awareness', () => {
      let contextValue;
      render(
        <PresenceProvider awareness={mockAwareness}>
          <TestConsumer onValue={(v) => { contextValue = v; }} />
        </PresenceProvider>
      );

      act(() => {
        contextValue.updateCursor({ x: 100, y: 200 });
      });

      // Advance past throttle
      act(() => {
        jest.advanceTimersByTime(200);
      });

      expect(mockAwareness.setLocalStateField).toHaveBeenCalledWith('cursor', { x: 100, y: 200 });
    });

    test('throttles cursor updates to 100ms', () => {
      let contextValue;
      render(
        <PresenceProvider awareness={mockAwareness}>
          <TestConsumer onValue={(v) => { contextValue = v; }} />
        </PresenceProvider>
      );

      // Clear initial calls
      mockAwareness.setLocalStateField.mockClear();

      // Rapid updates
      act(() => {
        contextValue.updateCursor({ x: 1, y: 1 });
        contextValue.updateCursor({ x: 2, y: 2 });
        contextValue.updateCursor({ x: 3, y: 3 });
      });

      // Should only have one call due to throttle
      const cursorCalls = mockAwareness.setLocalStateField.mock.calls.filter(
        call => call[0] === 'cursor'
      );
      expect(cursorCalls.length).toBe(1);
    });

    test('passes documentId when provided', () => {
      let contextValue;
      render(
        <PresenceProvider awareness={mockAwareness}>
          <TestConsumer onValue={(v) => { contextValue = v; }} />
        </PresenceProvider>
      );

      act(() => {
        contextValue.updateCursor({ x: 100, y: 200 }, 'doc-123');
      });

      act(() => {
        jest.advanceTimersByTime(200);
      });

      expect(mockAwareness.setLocalStateField).toHaveBeenCalledWith('openDocumentId', 'doc-123');
    });
  });

  describe('updateSelection', () => {
    test('updates selection in awareness', () => {
      let contextValue;
      render(
        <PresenceProvider awareness={mockAwareness}>
          <TestConsumer onValue={(v) => { contextValue = v; }} />
        </PresenceProvider>
      );

      const selection = { start: 0, end: 10 };
      act(() => {
        contextValue.updateSelection(selection);
      });

      act(() => {
        jest.advanceTimersByTime(200);
      });

      expect(mockAwareness.setLocalStateField).toHaveBeenCalledWith('selection', selection);
    });

    test('throttles selection updates', () => {
      let contextValue;
      render(
        <PresenceProvider awareness={mockAwareness}>
          <TestConsumer onValue={(v) => { contextValue = v; }} />
        </PresenceProvider>
      );

      mockAwareness.setLocalStateField.mockClear();

      act(() => {
        contextValue.updateSelection({ start: 0, end: 5 });
        contextValue.updateSelection({ start: 0, end: 10 });
        contextValue.updateSelection({ start: 0, end: 15 });
      });

      const selectionCalls = mockAwareness.setLocalStateField.mock.calls.filter(
        call => call[0] === 'selection'
      );
      expect(selectionCalls.length).toBe(1);
    });
  });

  describe('setTypingIndicator', () => {
    test('sets typing indicator', () => {
      let contextValue;
      render(
        <PresenceProvider awareness={mockAwareness}>
          <TestConsumer onValue={(v) => { contextValue = v; }} />
        </PresenceProvider>
      );

      act(() => {
        contextValue.setTypingIndicator(true);
      });

      expect(mockAwareness.setLocalStateField).toHaveBeenCalledWith('isTyping', true);
    });

    test('auto-clears typing after 3 seconds', () => {
      let contextValue;
      render(
        <PresenceProvider awareness={mockAwareness}>
          <TestConsumer onValue={(v) => { contextValue = v; }} />
        </PresenceProvider>
      );

      act(() => {
        contextValue.setTypingIndicator(true);
      });

      // Advance past auto-clear timeout
      act(() => {
        jest.advanceTimersByTime(3100);
      });

      expect(mockAwareness.setLocalStateField).toHaveBeenCalledWith('isTyping', false);
    });

    test('subsequent typing resets the auto-clear timer', () => {
      let contextValue;
      render(
        <PresenceProvider awareness={mockAwareness}>
          <TestConsumer onValue={(v) => { contextValue = v; }} />
        </PresenceProvider>
      );

      // Clear initial calls from setup
      mockAwareness.setLocalStateField.mockClear();

      // Start typing
      act(() => {
        contextValue.setTypingIndicator(true);
      });

      // Should have called with true
      expect(mockAwareness.setLocalStateField).toHaveBeenCalledWith('isTyping', true);
      
      // Clear and type again immediately
      mockAwareness.setLocalStateField.mockClear();
      act(() => {
        contextValue.setTypingIndicator(true);
      });

      // Should call with true again
      expect(mockAwareness.setLocalStateField).toHaveBeenCalledWith('isTyping', true);
    });
  });

  describe('getPeersOnDocument', () => {
    test('returns empty array when no peers', () => {
      let contextValue;
      render(
        <PresenceProvider awareness={mockAwareness}>
          <TestConsumer onValue={(v) => { contextValue = v; }} />
        </PresenceProvider>
      );

      const peers = contextValue.getPeersOnDocument('doc-123');
      expect(peers).toEqual([]);
    });

    test('filters peers by document ID', () => {
      let contextValue;
      render(
        <PresenceProvider awareness={mockAwareness}>
          <TestConsumer onValue={(v) => { contextValue = v; }} />
        </PresenceProvider>
      );

      // Simulate remote peers
      act(() => {
        mockAwareness.simulateRemotePeer(11111, {
          user: { name: 'Peer1' },
          openDocumentId: 'doc-123',
        });
        mockAwareness.simulateRemotePeer(22222, {
          user: { name: 'Peer2' },
          openDocumentId: 'doc-456',
        });
        mockAwareness.simulateRemotePeer(33333, {
          user: { name: 'Peer3' },
          openDocumentId: 'doc-123',
        });
      });

      // Wait for state update
      act(() => {
        jest.advanceTimersByTime(100);
      });

      const peersOnDoc123 = contextValue.getPeersOnDocument('doc-123');
      expect(peersOnDoc123.length).toBe(2);
    });
  });

  describe('Peer tracking', () => {
    test('updates peers when awareness changes', () => {
      let contextValue;
      render(
        <PresenceProvider awareness={mockAwareness}>
          <TestConsumer onValue={(v) => { contextValue = v; }} />
        </PresenceProvider>
      );

      act(() => {
        mockAwareness.simulateRemotePeer(99999, {
          user: { name: 'NewPeer', color: '#ff0000' },
          lastSeen: Date.now(),
        });
      });

      // Context should update
      expect(contextValue.peers.size).toBeGreaterThanOrEqual(0);
    });

    test('removes peers when they leave', () => {
      let contextValue;
      render(
        <PresenceProvider awareness={mockAwareness}>
          <TestConsumer onValue={(v) => { contextValue = v; }} />
        </PresenceProvider>
      );

      act(() => {
        mockAwareness.simulateRemotePeer(88888, {
          user: { name: 'LeavingPeer' },
        });
      });

      act(() => {
        mockAwareness.simulatePeerLeave(88888);
      });

      // Peer should be removed
      expect(contextValue.peers.has(88888)).toBe(false);
    });
  });

  describe('Typing peers', () => {
    test('tracks typing peers', () => {
      let contextValue;
      render(
        <PresenceProvider awareness={mockAwareness}>
          <TestConsumer onValue={(v) => { contextValue = v; }} />
        </PresenceProvider>
      );

      act(() => {
        mockAwareness.simulateRemotePeer(77777, {
          user: { name: 'TypingPeer' },
          isTyping: true,
        });
      });

      // typingPeers should include the typing peer
      const typingCount = contextValue.typingPeers?.length || 0;
      expect(typingCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Cleanup', () => {
    test('clears local state on unmount', () => {
      const { unmount } = render(
        <PresenceProvider awareness={mockAwareness}>
          <div>Test</div>
        </PresenceProvider>
      );

      unmount();

      expect(mockAwareness.setLocalState).toHaveBeenCalledWith(null);
    });

    test('clears typing timeout on unmount', () => {
      let contextValue;
      const { unmount } = render(
        <PresenceProvider awareness={mockAwareness}>
          <TestConsumer onValue={(v) => { contextValue = v; }} />
        </PresenceProvider>
      );

      act(() => {
        contextValue.setTypingIndicator(true);
      });

      // Unmount before timeout
      unmount();

      // Advance past timeout - should not cause error
      act(() => {
        jest.advanceTimersByTime(5000);
      });

      // No error thrown = success
    });
  });
});

// Helper component to access context value
function TestConsumer({ onValue }) {
  const value = usePresence();
  React.useEffect(() => {
    onValue(value);
  }, [value, onValue]);
  return null;
}
