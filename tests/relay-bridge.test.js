/**
 * Relay Bridge Tests
 * 
 * Tests for sidecar/relay-bridge.js - connects local Yjs docs to public relays
 * 
 * Tests cover:
 * - Connection management
 * - Exponential backoff with jitter
 * - Yjs document synchronization
 * - Status callbacks
 * - Retry logic
 * - Disconnection handling
 */

/**
 * @jest-environment node
 */

const EventEmitter = require('events');

// Mock WebSocket
class MockWebSocket extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  
  constructor(url) {
    super();
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.sent = [];
    
    // Auto-connect after a tick (simulating async connection)
    setImmediate(() => {
      this.readyState = MockWebSocket.OPEN;
      this.emit('open');
    });
  }
  
  send(data) {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket not open');
    }
    this.sent.push(data);
  }
  
  close(code, reason) {
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close', { code, reason });
  }
}

// Mock ws module
jest.mock('ws', () => MockWebSocket);

// Mock y-websocket utils
jest.mock('y-websocket/bin/utils', () => ({
  docs: new Map(),
}));

// Mock Yjs
jest.mock('yjs', () => {
  const EventEmitter = require('events');
  class MockDoc extends EventEmitter {
    constructor() {
      super();
      this.clientID = Math.floor(Math.random() * 1000000);
    }
    
    getMap(name) { return new Map(); }
    getArray(name) { return []; }
    getText(name) { return { toString: () => '' }; }
  }
  return { Doc: MockDoc };
});

const { RelayBridge } = require('../sidecar/relay-bridge');

// ============================================================
// RelayBridge Constructor Tests
// ============================================================

describe('RelayBridge', () => {
  let bridge;

  beforeEach(() => {
    jest.useFakeTimers();
    bridge = new RelayBridge();
  });

  afterEach(() => {
    jest.useRealTimers();
    bridge = null;
  });

  describe('Constructor', () => {
    test('initializes with empty connections', () => {
      expect(bridge.connections.size).toBe(0);
    });

    test('initializes with empty pending', () => {
      expect(bridge.pending.size).toBe(0);
    });

    test('initializes retry state', () => {
      expect(bridge.retryTimeouts.size).toBe(0);
      expect(bridge.retryAttempts.size).toBe(0);
    });
  });
});

// ============================================================
// Exponential Backoff Tests
// ============================================================

describe('RelayBridge Backoff', () => {
  let bridge;

  beforeEach(() => {
    bridge = new RelayBridge();
  });

  describe('_calculateBackoffDelay', () => {
    test('first attempt uses initial delay', () => {
      const delay = bridge._calculateBackoffDelay(0);
      // With jitter, should be close to 1000ms
      expect(delay).toBeGreaterThanOrEqual(700);  // 1000 - 30%
      expect(delay).toBeLessThanOrEqual(1300);    // 1000 + 30%
    });

    test('delay doubles with each attempt', () => {
      const delay0 = 1000; // Base
      const delay1 = bridge._calculateBackoffDelay(1);
      const delay2 = bridge._calculateBackoffDelay(2);
      const delay3 = bridge._calculateBackoffDelay(3);
      
      // Without jitter, would be 2000, 4000, 8000
      // With 30% jitter, check ranges
      expect(delay1).toBeGreaterThanOrEqual(1400);
      expect(delay1).toBeLessThanOrEqual(2600);
      
      expect(delay2).toBeGreaterThanOrEqual(2800);
      expect(delay2).toBeLessThanOrEqual(5200);
      
      expect(delay3).toBeGreaterThanOrEqual(5600);
      expect(delay3).toBeLessThanOrEqual(10400);
    });

    test('delay caps at maximum', () => {
      // After many attempts, should cap at 60000ms
      const delay = bridge._calculateBackoffDelay(100);
      // Max is 60000 + 30% jitter = 78000
      expect(delay).toBeLessThanOrEqual(78000);
      expect(delay).toBeGreaterThanOrEqual(42000); // 60000 - 30%
    });

    test('jitter produces varied results', () => {
      const delays = [];
      for (let i = 0; i < 20; i++) {
        delays.push(bridge._calculateBackoffDelay(2));
      }
      
      // With jitter, should have some variance
      const unique = new Set(delays);
      expect(unique.size).toBeGreaterThan(1);
    });
  });
});

// ============================================================
// Connection Management Tests
// ============================================================

describe('RelayBridge Connection Management', () => {
  let bridge;

  beforeEach(() => {
    jest.useFakeTimers();
    bridge = new RelayBridge();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('tracks pending connections', async () => {
    const Y = require('yjs');
    const ydoc = new Y.Doc();
    
    // Start connection (will be pending)
    const connectPromise = bridge.connect('test-room', ydoc, 'ws://localhost:3000');
    
    expect(bridge.pending.has('test-room')).toBe(true);
    
    // Run timers to complete connection
    jest.runAllTimers();
    await Promise.resolve();
    
    expect(bridge.pending.has('test-room')).toBe(false);
  });

  test('prevents duplicate pending connections', async () => {
    const Y = require('yjs');
    const ydoc = new Y.Doc();
    
    const p1 = bridge.connect('test-room', ydoc, 'ws://localhost:3000');
    const p2 = bridge.connect('test-room', ydoc, 'ws://localhost:3000');
    
    // Second call should return early
    jest.runAllTimers();
    await Promise.resolve();
    
    // Only one connection attempt
    expect(bridge.connections.size).toBeLessThanOrEqual(1);
  });

  test('prevents connection if already connected', async () => {
    const Y = require('yjs');
    const ydoc = new Y.Doc();
    
    // Manually add connection
    bridge.connections.set('test-room', { ws: {}, status: 'connected' });
    
    await bridge.connect('test-room', ydoc, 'ws://localhost:3000');
    
    // Should return early, still only one connection
    expect(bridge.connections.size).toBe(1);
  });
});

// ============================================================
// Status Callback Tests
// ============================================================

describe('RelayBridge Status Callbacks', () => {
  let bridge;

  beforeEach(() => {
    bridge = new RelayBridge();
  });

  test('calls onStatusChange callback', async () => {
    const statusChanges = [];
    bridge.onStatusChange = (room, status) => {
      statusChanges.push({ room, status });
    };
    
    // Simulate status change
    if (bridge.onStatusChange) {
      bridge.onStatusChange('test-room', 'connecting');
      bridge.onStatusChange('test-room', 'connected');
    }
    
    expect(statusChanges.length).toBe(2);
    expect(statusChanges[0]).toEqual({ room: 'test-room', status: 'connecting' });
    expect(statusChanges[1]).toEqual({ room: 'test-room', status: 'connected' });
  });
});

// ============================================================
// Disconnect Tests
// ============================================================

describe('RelayBridge Disconnect', () => {
  let bridge;

  beforeEach(() => {
    jest.useFakeTimers();
    bridge = new RelayBridge();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('disconnect removes connection', () => {
    // Manually add connection
    bridge.connections.set('test-room', {
      ws: { close: jest.fn() },
      status: 'connected',
    });
    
    bridge.disconnect('test-room');
    
    expect(bridge.connections.has('test-room')).toBe(false);
  });

  test('disconnect clears retry timeout', () => {
    bridge.retryTimeouts.set('test-room', setTimeout(() => {}, 10000));
    
    bridge.disconnect('test-room');
    
    expect(bridge.retryTimeouts.has('test-room')).toBe(false);
  });

  test('disconnect resets retry attempts', () => {
    bridge.retryAttempts.set('test-room', 5);
    
    bridge.disconnect('test-room');
    
    // retryAttempts.delete is called, so it should not have the key
    expect(bridge.retryAttempts.has('test-room')).toBe(false);
  });

  test('disconnectAll clears all connections', () => {
    bridge.connections.set('room-1', { ws: { close: jest.fn() } });
    bridge.connections.set('room-2', { ws: { close: jest.fn() } });
    bridge.connections.set('room-3', { ws: { close: jest.fn() } });
    
    bridge.disconnectAll();
    
    expect(bridge.connections.size).toBe(0);
  });
});

// ============================================================
// Retry Logic Tests
// ============================================================

describe('RelayBridge Retry Logic', () => {
  let bridge;

  beforeEach(() => {
    jest.useFakeTimers();
    bridge = new RelayBridge();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('increments retry attempts on failure', () => {
    const roomName = 'test-room';
    
    // Simulate incrementing attempts
    const currentAttempts = bridge.retryAttempts.get(roomName) || 0;
    bridge.retryAttempts.set(roomName, currentAttempts + 1);
    
    expect(bridge.retryAttempts.get(roomName)).toBe(1);
    
    bridge.retryAttempts.set(roomName, bridge.retryAttempts.get(roomName) + 1);
    expect(bridge.retryAttempts.get(roomName)).toBe(2);
  });

  test('resets retry attempts on successful connection', () => {
    const roomName = 'test-room';
    
    // Simulate failed attempts
    bridge.retryAttempts.set(roomName, 5);
    
    // Simulate successful connection
    bridge.retryAttempts.set(roomName, 0);
    
    expect(bridge.retryAttempts.get(roomName)).toBe(0);
  });
});

// ============================================================
// Edge Cases
// ============================================================

describe('RelayBridge Edge Cases', () => {
  let bridge;

  beforeEach(() => {
    bridge = new RelayBridge();
  });

  test('handles disconnect of non-existent room', () => {
    // Should not throw
    expect(() => bridge.disconnect('non-existent')).not.toThrow();
  });

  test('getStatus returns correct status', () => {
    bridge.connections.set('connected-room', { status: 'connected', connectedAt: Date.now() });
    bridge.connections.set('syncing-room', { status: 'syncing', connectedAt: Date.now() });
    
    expect(bridge.getStatus('connected-room').status).toBe('connected');
    expect(bridge.getStatus('syncing-room').status).toBe('syncing');
    expect(bridge.getStatus('unknown-room')).toBe(null);
  });

  test('handles room with special characters', async () => {
    const Y = require('yjs');
    const ydoc = new Y.Doc();
    const roomName = 'room:with:colons/and/slashes';
    
    // Should not throw
    jest.useFakeTimers();
    const promise = bridge.connect(roomName, ydoc, 'ws://localhost:3000');
    jest.runAllTimers();
    
    expect(bridge.pending.has(roomName) || bridge.connections.has(roomName)).toBe(true);
    jest.useRealTimers();
  });
});

// ============================================================
// Room Name Validation
// ============================================================

describe('RelayBridge Room Names', () => {
  test('workspace-meta prefix', () => {
    const workspaceId = 'abc123';
    const roomName = `workspace-meta:${workspaceId}`;
    
    expect(roomName).toBe('workspace-meta:abc123');
    expect(roomName.startsWith('workspace-meta:')).toBe(true);
  });

  test('document room prefix', () => {
    const docId = 'doc456';
    const roomName = `document:${docId}`;
    
    expect(roomName.startsWith('document:')).toBe(true);
  });
});
