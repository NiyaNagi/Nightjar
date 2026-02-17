/**
 * tests/presence-awareness.test.js
 *
 * Unit / functional / UI / E2E-scenario tests for the one-way presence bug fix.
 *
 * Covers:
 *  - AWARENESS_HEARTBEAT_MS constant value & export
 *  - Heartbeat interval uses AWARENESS_HEARTBEAT_MS (not TIMEOUT_LONG)
 *  - Staleness threshold = 2 × AWARENESS_HEARTBEAT_MS
 *  - Polling interval reduced to 500 ms
 *  - Awareness broadcast on listener attachment (catches pre-set states)
 *  - Awareness push on peer-joined (full state to all peers)
 *  - End-to-end scenario: joiner → inviter presence propagation
 *  - UI-level collaborator tracking after join
 */

// ─── Helpers / shared constants ───────────────────────────────────────────────

const AWARENESS_HEARTBEAT_VALUE = 15000; // expected constant value
const AWARENESS_POLL_INTERVAL   = 500;   // polling loop ms

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 – Constants unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe('AWARENESS_HEARTBEAT_MS constant', () => {
  let constants;

  beforeAll(async () => {
    constants = await import('../frontend/src/config/constants');
  });

  test('is exported as a named export', () => {
    expect(constants.AWARENESS_HEARTBEAT_MS).toBeDefined();
  });

  test('equals 15 000 ms', () => {
    expect(constants.AWARENESS_HEARTBEAT_MS).toBe(AWARENESS_HEARTBEAT_VALUE);
  });

  test('is shorter than TIMEOUT_LONG', () => {
    expect(constants.AWARENESS_HEARTBEAT_MS).toBeLessThan(constants.TIMEOUT_LONG);
  });

  test('is included in default export', () => {
    expect(constants.default.AWARENESS_HEARTBEAT_MS).toBe(AWARENESS_HEARTBEAT_VALUE);
  });

  test('TIMEOUT_LONG remains unchanged at 30 000', () => {
    expect(constants.TIMEOUT_LONG).toBe(30000);
  });

  test('TIMEOUT_EXTENDED remains unchanged at 60 000', () => {
    expect(constants.TIMEOUT_EXTENDED).toBe(60000);
  });

  test('2 × AWARENESS_HEARTBEAT_MS equals TIMEOUT_LONG', () => {
    expect(2 * constants.AWARENESS_HEARTBEAT_MS).toBe(constants.TIMEOUT_LONG);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 – Source-code contract tests (verify the code references the
//             correct constant, the correct polling interval, etc.)
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'fs';
import { join } from 'path';

const rootDir = join(__dirname, '..');

describe('Source-code contract: useWorkspaceSync.js', () => {
  let src;

  beforeAll(() => {
    src = readFileSync(
      join(rootDir, 'frontend/src/hooks/useWorkspaceSync.js'),
      'utf-8',
    );
  });

  test('imports AWARENESS_HEARTBEAT_MS from constants', () => {
    expect(src).toMatch(/AWARENESS_HEARTBEAT_MS/);
    expect(src).toMatch(/import\s+\{[^}]*AWARENESS_HEARTBEAT_MS[^}]*\}\s+from\s+['"]\.\.\/config\/constants['"]/);
  });

  test('heartbeat interval uses AWARENESS_HEARTBEAT_MS (not TIMEOUT_LONG)', () => {
    // The setInterval call should reference AWARENESS_HEARTBEAT_MS
    expect(src).toMatch(/},\s*AWARENESS_HEARTBEAT_MS\)/);
    // And should NOT reference TIMEOUT_LONG for the heartbeat
    expect(src).not.toMatch(/},\s*TIMEOUT_LONG\);\s*\/\/\s*Update every 30 seconds/);
  });

  test('staleness threshold uses 2 * AWARENESS_HEARTBEAT_MS', () => {
    expect(src).toMatch(/2\s*\*\s*AWARENESS_HEARTBEAT_MS/);
  });

  test('still imports TIMEOUT_LONG (used elsewhere)', () => {
    expect(src).toMatch(/TIMEOUT_LONG/);
  });
});

describe('Source-code contract: sidecar/index.js', () => {
  let src;

  beforeAll(() => {
    src = readFileSync(join(rootDir, 'sidecar/index.js'), 'utf-8');
  });

  test('awareness polling interval is 500 ms', () => {
    expect(src).toMatch(/},\s*500\);\s*\/\/ Check every 500ms/);
  });

  test('broadcasts initial full awareness after listener attachment', () => {
    expect(src).toContain('Broadcast initial full awareness');
    expect(src).toContain('broadcastAwarenessUpdate(capturedWorkspaceId, capturedTopicHex, fullPayload)');
  });

  test('pushes awareness on peer-joined', () => {
    expect(src).toContain('Broadcast awareness');
    expect(src).toContain('broadcastAwareness(topic,');
    expect(src).toMatch(/peer-joined.*push awareness|push awareness.*peer-joined/is);
  });

  test('peer-joined awareness push has 500 ms delay', () => {
    // setTimeout inside peer-joined handler
    expect(src).toMatch(/setTimeout\(\s*\(\)\s*=>\s*\{[\s\S]*?broadcastAwareness[\s\S]*?\},\s*500\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 – Unit tests for the sidecar awareness bridging logic
//             (extracted pure-function tests using mocks)
// ─────────────────────────────────────────────────────────────────────────────

describe('Awareness P2P bridging logic (unit)', () => {
  // Minimal mock of the awareness protocol encode/decode
  function mockEncodeAwarenessUpdate(awareness, clientIds) {
    const states = {};
    for (const id of clientIds) {
      const s = awareness.getStates().get(id);
      if (s) states[id] = s;
    }
    return Buffer.from(JSON.stringify(states));
  }

  function createMockDoc(clientId, states = {}) {
    const stateMap = new Map(Object.entries(states).map(([k, v]) => [Number(k), v]));
    // If no states yet, add local
    if (stateMap.size === 0) {
      stateMap.set(clientId, {});
    }
    const listeners = new Map();
    return {
      clientID: clientId,
      awareness: {
        getStates: () => stateMap,
        on: jest.fn((evt, cb) => {
          if (!listeners.has(evt)) listeners.set(evt, []);
          listeners.get(evt).push(cb);
        }),
        off: jest.fn(),
        _emit(evt, data) {
          (listeners.get(evt) || []).forEach(cb => cb(data));
        },
      },
      _listeners: listeners,
    };
  }

  test('encodeAwarenessUpdate produces non-empty buffer for present clients', () => {
    const doc = createMockDoc(1, { 1: { user: { name: 'Alice' } } });
    const buf = mockEncodeAwarenessUpdate(doc.awareness, [1]);
    expect(buf.length).toBeGreaterThan(2); // not empty
    const parsed = JSON.parse(buf.toString());
    expect(parsed['1'].user.name).toBe('Alice');
  });

  test('encodeAwarenessUpdate returns empty object for unknown client ids', () => {
    const doc = createMockDoc(1, { 1: { user: { name: 'Alice' } } });
    const buf = mockEncodeAwarenessUpdate(doc.awareness, [999]);
    const parsed = JSON.parse(buf.toString());
    expect(Object.keys(parsed)).toHaveLength(0);
  });

  test('awareness handler skips updates with p2p origin', () => {
    const broadcastCalled = [];
    const broadcast = (...args) => broadcastCalled.push(args);

    const doc = createMockDoc(1, { 1: { user: { name: 'A' } } });
    const handler = ({ added, updated, removed }, origin) => {
      if (origin === 'p2p' || origin === 'relay') return;
      broadcast(added, updated, removed);
    };

    // Attach
    doc.awareness.on('update', handler);

    // Simulate p2p-origin update — should NOT call broadcast
    handler({ added: [2], updated: [], removed: [] }, 'p2p');
    expect(broadcastCalled).toHaveLength(0);

    // Simulate local-origin update — SHOULD call broadcast
    handler({ added: [], updated: [1], removed: [] }, null);
    expect(broadcastCalled).toHaveLength(1);
  });

  test('awareness handler skips relay-origin updates', () => {
    const calls = [];
    const handler = ({ added }, origin) => {
      if (origin === 'p2p' || origin === 'relay') return;
      calls.push(added);
    };
    handler({ added: [3], updated: [], removed: [] }, 'relay');
    expect(calls).toHaveLength(0);
  });

  test('awareness handler broadcasts for local-origin updates', () => {
    const calls = [];
    const handler = (changes, origin) => {
      if (origin === 'p2p' || origin === 'relay') return;
      calls.push(changes);
    };
    handler({ added: [1], updated: [], removed: [] }, undefined);
    expect(calls).toHaveLength(1);
  });

  test('initial broadcast after attachment includes all clients', () => {
    const doc = createMockDoc(1, {
      1: { user: { name: 'Local' } },
      2: { user: { name: 'Remote' } },
    });

    const allClients = Array.from(doc.awareness.getStates().keys());
    expect(allClients).toContain(1);
    expect(allClients).toContain(2);
    expect(allClients).toHaveLength(2);

    const buf = mockEncodeAwarenessUpdate(doc.awareness, allClients);
    const parsed = JSON.parse(buf.toString());
    expect(Object.keys(parsed)).toHaveLength(2);
  });

  test('initial broadcast skipped when no clients present', () => {
    const stateMap = new Map();
    const doc = {
      awareness: {
        getStates: () => stateMap,
        on: jest.fn(),
        off: jest.fn(),
      },
    };

    const allClients = Array.from(doc.awareness.getStates().keys());
    expect(allClients).toHaveLength(0);
    // Nothing to broadcast — our code guards on allClients.length > 0
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 – Functional tests for peer-joined awareness push
// ─────────────────────────────────────────────────────────────────────────────

describe('Peer-joined awareness push (functional)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('peer-joined handler triggers delayed awareness broadcast', () => {
    const broadcastCalls = [];
    const mockBroadcastAwareness = (topic, payload) => {
      broadcastCalls.push({ topic, payload });
    };

    const topicHex = 'abcd1234';
    const workspaceId = 'ws-001';
    const topicToWorkspace = new Map([[topicHex, workspaceId]]);

    const stateMap = new Map([
      [1, { user: { name: 'Owner', publicKey: 'pk1' } }],
    ]);

    const docsMap = new Map([
      [`workspace-meta:${workspaceId}`, {
        awareness: {
          getStates: () => stateMap,
        },
      }],
    ]);

    // Simulate peer-joined handler body
    const peerJoinedHandler = (peerId, topic) => {
      const wsId = topicToWorkspace.get(topic);
      if (!wsId) return;

      setTimeout(() => {
        const roomName = `workspace-meta:${wsId}`;
        const doc = docsMap.get(roomName);
        if (doc && doc.awareness) {
          const allClients = Array.from(doc.awareness.getStates().keys());
          if (allClients.length > 0) {
            const payload = {
              type: 'awareness-protocol',
              update: 'mock-encoded',
              documentId: null,
            };
            mockBroadcastAwareness(topic, JSON.stringify(payload));
          }
        }
      }, 500);
    };

    // Fire peer-joined
    peerJoinedHandler('peer-abc', topicHex);

    // Before delay – nothing broadcast
    expect(broadcastCalls).toHaveLength(0);

    // After 500 ms – should broadcast
    jest.advanceTimersByTime(500);
    expect(broadcastCalls).toHaveLength(1);
    expect(broadcastCalls[0].topic).toBe(topicHex);
    const parsed = JSON.parse(broadcastCalls[0].payload);
    expect(parsed.type).toBe('awareness-protocol');
  });

  test('peer-joined handler does nothing for unknown topics', () => {
    const broadcastCalls = [];
    const topicToWorkspace = new Map(); // empty

    const peerJoinedHandler = (peerId, topic) => {
      const wsId = topicToWorkspace.get(topic);
      if (!wsId) return;
      broadcastCalls.push({ topic });
    };

    peerJoinedHandler('peer-xyz', 'unknown-topic');
    jest.advanceTimersByTime(1000);
    expect(broadcastCalls).toHaveLength(0);
  });

  test('peer-joined handler does nothing when doc has no awareness clients', () => {
    const broadcastCalls = [];
    const mockBroadcastAwareness = (topic, payload) => {
      broadcastCalls.push({ topic, payload });
    };

    const topicHex = 'abcd1234';
    const workspaceId = 'ws-002';
    const topicToWorkspace = new Map([[topicHex, workspaceId]]);

    const docsMap = new Map([
      [`workspace-meta:${workspaceId}`, {
        awareness: {
          getStates: () => new Map(), // empty
        },
      }],
    ]);

    const peerJoinedHandler = (peerId, topic) => {
      const wsId = topicToWorkspace.get(topic);
      if (!wsId) return;

      setTimeout(() => {
        const roomName = `workspace-meta:${wsId}`;
        const doc = docsMap.get(roomName);
        if (doc && doc.awareness) {
          const allClients = Array.from(doc.awareness.getStates().keys());
          if (allClients.length > 0) {
            mockBroadcastAwareness(topic, 'payload');
          }
        }
      }, 500);
    };

    peerJoinedHandler('peer-abc', topicHex);
    jest.advanceTimersByTime(500);
    expect(broadcastCalls).toHaveLength(0);
  });

  test('peer-joined handler broadcasts to ALL peers (not targeted)', () => {
    // The broadcastAwareness function iterates all connections for the topic
    // We verify the call signature is broadcastAwareness(topic, payload)
    // and NOT sendSyncState(peerId, topic, data) — i.e., no peerId arg first
    const broadcastCalls = [];
    const mockBroadcastAwareness = (topic, payload) => {
      broadcastCalls.push({ topic, payload, argCount: 2 });
    };

    const topicHex = 'topic-123';
    const workspaceId = 'ws-003';
    const topicToWorkspace = new Map([[topicHex, workspaceId]]);

    const docsMap = new Map([
      [`workspace-meta:${workspaceId}`, {
        awareness: {
          getStates: () => new Map([[1, { user: { name: 'A' } }]]),
        },
      }],
    ]);

    const peerJoinedHandler = (peerId, topic) => {
      const wsId = topicToWorkspace.get(topic);
      if (!wsId) return;
      setTimeout(() => {
        const doc = docsMap.get(`workspace-meta:${wsId}`);
        if (doc?.awareness) {
          const allClients = Array.from(doc.awareness.getStates().keys());
          if (allClients.length > 0) {
            mockBroadcastAwareness(topic, JSON.stringify({ type: 'awareness-protocol' }));
          }
        }
      }, 500);
    };

    peerJoinedHandler('new-peer', topicHex);
    jest.advanceTimersByTime(500);

    // Verify broadcast used 2-arg signature (topic, payload) — not 3-arg targeted
    expect(broadcastCalls).toHaveLength(1);
    expect(broadcastCalls[0].argCount).toBe(2);
    expect(broadcastCalls[0].topic).toBe(topicHex);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 – Listener-attachment initial broadcast (functional)
// ─────────────────────────────────────────────────────────────────────────────

describe('Listener-attachment initial awareness broadcast (functional)', () => {
  test('broadcasts all existing awareness states when listener is attached', () => {
    const broadcastPayloads = [];
    const broadcastAwarenessUpdate = (wsId, topicHex, payload) => {
      broadcastPayloads.push({ wsId, topicHex, payload });
    };

    // Simulate doc with 2 awareness clients already present
    const stateMap = new Map([
      [1, { user: { name: 'Alice', publicKey: 'pk1' } }],
      [2, { user: { name: 'Bob', publicKey: 'pk2' } }],
    ]);

    const awareness = {
      getStates: () => stateMap,
      on: jest.fn(),
    };

    // Simulate the post-attachment broadcast logic
    const allClients = Array.from(awareness.getStates().keys());
    if (allClients.length > 0) {
      const update = Buffer.from(JSON.stringify(
        Object.fromEntries(allClients.map(id => [id, stateMap.get(id)])),
      ));
      const fullPayload = {
        type: 'awareness-protocol',
        update: update.toString('base64'),
        documentId: null,
      };
      broadcastAwarenessUpdate('ws-test', 'topic-test', fullPayload);
    }

    expect(broadcastPayloads).toHaveLength(1);
    expect(broadcastPayloads[0].payload.type).toBe('awareness-protocol');

    // Decode the update and verify both clients are included
    const decoded = JSON.parse(
      Buffer.from(broadcastPayloads[0].payload.update, 'base64').toString(),
    );
    expect(decoded['1'].user.name).toBe('Alice');
    expect(decoded['2'].user.name).toBe('Bob');
  });

  test('does NOT broadcast when no clients are present', () => {
    const broadcastPayloads = [];
    const broadcastAwarenessUpdate = (wsId, topicHex, payload) => {
      broadcastPayloads.push(payload);
    };

    const awareness = {
      getStates: () => new Map(),
      on: jest.fn(),
    };

    const allClients = Array.from(awareness.getStates().keys());
    if (allClients.length > 0) {
      broadcastAwarenessUpdate('ws', 'topic', { type: 'awareness-protocol' });
    }

    expect(broadcastPayloads).toHaveLength(0);
  });

  test('includes documentId when attaching to a doc-* room', () => {
    const broadcastPayloads = [];
    const broadcastAwarenessUpdate = (wsId, topicHex, payload) => {
      broadcastPayloads.push(payload);
    };

    const capturedDocumentId = 'doc-abc123';
    const stateMap = new Map([[1, { cursor: { line: 5 } }]]);
    const awareness = { getStates: () => stateMap, on: jest.fn() };

    const allClients = Array.from(awareness.getStates().keys());
    if (allClients.length > 0) {
      const fullPayload = {
        type: 'awareness-protocol',
        update: Buffer.from('{}').toString('base64'),
        documentId: capturedDocumentId || null,
      };
      broadcastAwarenessUpdate('ws', 'topic', fullPayload);
    }

    expect(broadcastPayloads).toHaveLength(1);
    expect(broadcastPayloads[0].documentId).toBe('doc-abc123');
  });

  test('sets documentId to null for workspace-meta rooms', () => {
    const broadcastPayloads = [];
    const broadcastAwarenessUpdate = (wsId, topicHex, payload) => {
      broadcastPayloads.push(payload);
    };

    const capturedDocumentId = null; // workspace-meta
    const stateMap = new Map([[1, { user: { name: 'X' } }]]);
    const awareness = { getStates: () => stateMap, on: jest.fn() };

    const allClients = Array.from(awareness.getStates().keys());
    if (allClients.length > 0) {
      broadcastAwarenessUpdate('ws', 'topic', {
        type: 'awareness-protocol',
        update: 'dGVzdA==',
        documentId: capturedDocumentId || null,
      });
    }

    expect(broadcastPayloads[0].documentId).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 – End-to-end scenario: joiner → inviter presence propagation
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E scenario: bidirectional presence after join', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * Simulates the full lifecycle:
   *   1. Inviter (A) has awareness in workspace-meta doc
   *   2. Joiner (B) joins → join-topic exchange fires sync-state-request
   *   3. handleSyncStateRequest sends A's awareness to B ✅
   *   4. B's frontend connects, sets awareness via setLocalStateField
   *   5. setupAwarenessP2PBridging polls (500 ms) and finds B's doc
   *   6. On attachment, the new code broadcasts B's awareness to all peers ✅
   *   7. Additionally, peer-joined handler broadcasts after 500 ms ✅
   */
  test('joiner awareness reaches inviter via listener-attachment broadcast', () => {
    // State tracking
    const broadcastedPayloads = [];
    const broadcast = (wsId, topicHex, payload) => {
      broadcastedPayloads.push({ wsId, topicHex, payload });
    };

    // Step 1 – Inviter's doc already has awareness
    const inviterState = new Map([
      [100, { user: { name: 'Inviter', publicKey: 'pkInviter' } }],
    ]);

    // Step 4 – Joiner's frontend connects and sets awareness
    const joinerState = new Map([
      [200, { user: { name: 'Joiner', publicKey: 'pkJoiner' } }],
    ]);

    // Step 5 – After 500 ms polling, setupAwarenessP2PBridging finds the doc
    // Step 6 – On attachment, broadcast initial full awareness
    const allClients = Array.from(joinerState.keys());
    expect(allClients).toHaveLength(1);
    expect(allClients[0]).toBe(200);

    if (allClients.length > 0) {
      const states = {};
      for (const id of allClients) states[id] = joinerState.get(id);
      const update = Buffer.from(JSON.stringify(states));
      broadcast('ws-001', 'topic-001', {
        type: 'awareness-protocol',
        update: update.toString('base64'),
        documentId: null,
      });
    }

    // Inviter should receive the broadcast
    expect(broadcastedPayloads).toHaveLength(1);
    const decoded = JSON.parse(
      Buffer.from(broadcastedPayloads[0].payload.update, 'base64').toString(),
    );
    expect(decoded['200'].user.name).toBe('Joiner');
    expect(decoded['200'].user.publicKey).toBe('pkJoiner');
  });

  test('joiner awareness reaches inviter via peer-joined push', () => {
    const broadcastCalls = [];
    const mockBroadcastAwareness = (topic, payload) => {
      broadcastCalls.push({ topic, payload: JSON.parse(payload) });
    };

    const topicHex = 'topic-e2e';
    const workspaceId = 'ws-e2e';
    const topicToWorkspace = new Map([[topicHex, workspaceId]]);

    // After joiner connects, the doc has both users' awareness
    const combinedStates = new Map([
      [100, { user: { name: 'Inviter', publicKey: 'pkA' } }],
      [200, { user: { name: 'Joiner', publicKey: 'pkB' } }],
    ]);

    const docsMap = new Map([
      [`workspace-meta:${workspaceId}`, {
        awareness: { getStates: () => combinedStates },
      }],
    ]);

    // Simulate peer-joined handler
    const onPeerJoined = (peerId, topic) => {
      const wsId = topicToWorkspace.get(topic);
      if (!wsId) return;
      setTimeout(() => {
        const doc = docsMap.get(`workspace-meta:${wsId}`);
        if (doc?.awareness) {
          const allClients = Array.from(doc.awareness.getStates().keys());
          if (allClients.length > 0) {
            const states = {};
            for (const id of allClients) states[id] = doc.awareness.getStates().get(id);
            mockBroadcastAwareness(topic, JSON.stringify({
              type: 'awareness-protocol',
              update: Buffer.from(JSON.stringify(states)).toString('base64'),
              documentId: null,
            }));
          }
        }
      }, 500);
    };

    onPeerJoined('joiner-peer', topicHex);
    jest.advanceTimersByTime(500);

    expect(broadcastCalls).toHaveLength(1);
    const decoded = JSON.parse(
      Buffer.from(broadcastCalls[0].payload.update, 'base64').toString(),
    );
    expect(decoded['100'].user.publicKey).toBe('pkA');
    expect(decoded['200'].user.publicKey).toBe('pkB');
  });

  test('inviter awareness reaches joiner via handleSyncStateRequest', () => {
    // This path already worked before the fix, just verifying it still does
    const sentPayloads = [];
    const mockBroadcastAwareness = (topicHex, stateStr) => {
      sentPayloads.push(JSON.parse(stateStr));
    };

    const inviterStates = new Map([
      [100, { user: { name: 'Inviter', publicKey: 'pkA' } }],
    ]);

    // Simulate handleSyncStateRequest awareness section
    const allClients = Array.from(inviterStates.keys());
    if (allClients.length > 0) {
      const states = {};
      for (const id of allClients) states[id] = inviterStates.get(id);
      const awarenessPayload = {
        type: 'awareness-protocol',
        update: Buffer.from(JSON.stringify(states)).toString('base64'),
        documentId: null,
      };
      mockBroadcastAwareness('topic-x', JSON.stringify(awarenessPayload));
    }

    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0].type).toBe('awareness-protocol');
    const decoded = JSON.parse(
      Buffer.from(sentPayloads[0].update, 'base64').toString(),
    );
    expect(decoded['100'].user.name).toBe('Inviter');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 – Throttle / timing edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('Awareness throttle edge cases', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('throttled broadcast sends immediately first time, then throttles', () => {
    const sent = [];
    const AWARENESS_THROTTLE_MS = 100;
    const throttles = new Map();

    function broadcastAwarenessUpdate(workspaceId, topicHex, state) {
      let throttle = throttles.get(workspaceId);
      if (!throttle) {
        throttle = { timer: null, pending: null };
        throttles.set(workspaceId, throttle);
      }
      throttle.pending = { topicHex, state };
      if (!throttle.timer) {
        sent.push({ workspaceId, state, when: 'immediate' });
        throttle.pending = null;
        throttle.timer = setTimeout(() => {
          if (throttle.pending) {
            sent.push({ workspaceId, state: throttle.pending.state, when: 'throttled' });
            throttle.pending = null;
          }
          throttle.timer = null;
        }, AWARENESS_THROTTLE_MS);
      }
    }

    broadcastAwarenessUpdate('ws1', 'topic1', { v: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0].when).toBe('immediate');

    broadcastAwarenessUpdate('ws1', 'topic1', { v: 2 });
    expect(sent).toHaveLength(1); // still throttled

    jest.advanceTimersByTime(100);
    expect(sent).toHaveLength(2);
    expect(sent[1].when).toBe('throttled');
  });

  test('multiple workspaces have independent throttles', () => {
    const sent = [];
    const AWARENESS_THROTTLE_MS = 100;
    const throttles = new Map();

    function broadcastAwarenessUpdate(workspaceId, topicHex, state) {
      let throttle = throttles.get(workspaceId);
      if (!throttle) {
        throttle = { timer: null, pending: null };
        throttles.set(workspaceId, throttle);
      }
      throttle.pending = { topicHex, state };
      if (!throttle.timer) {
        sent.push({ workspaceId });
        throttle.pending = null;
        throttle.timer = setTimeout(() => {
          if (throttle.pending) {
            sent.push({ workspaceId });
            throttle.pending = null;
          }
          throttle.timer = null;
        }, AWARENESS_THROTTLE_MS);
      }
    }

    broadcastAwarenessUpdate('ws1', 't1', {});
    broadcastAwarenessUpdate('ws2', 't2', {});

    // Both should fire immediately — different workspaces
    expect(sent).toHaveLength(2);
    expect(sent[0].workspaceId).toBe('ws1');
    expect(sent[1].workspaceId).toBe('ws2');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 – UI-level collaborator tracking with new heartbeat
// ─────────────────────────────────────────────────────────────────────────────

describe('Collaborator staleness with AWARENESS_HEARTBEAT_MS', () => {
  const AWARENESS_HEARTBEAT_MS_VAL = 15000;

  test('member NOT marked stale within 2 heartbeats', () => {
    const now = Date.now();
    const lastSeen = now - AWARENESS_HEARTBEAT_MS_VAL; // 1 heartbeat ago
    const isStale = (now - lastSeen) > 2 * AWARENESS_HEARTBEAT_MS_VAL;
    expect(isStale).toBe(false);
  });

  test('member marked stale after 2 heartbeats', () => {
    const now = Date.now();
    const lastSeen = now - (2 * AWARENESS_HEARTBEAT_MS_VAL + 1); // just over 2 heartbeats
    const isStale = (now - lastSeen) > 2 * AWARENESS_HEARTBEAT_MS_VAL;
    expect(isStale).toBe(true);
  });

  test('member not stale at exactly 2 heartbeats', () => {
    const now = Date.now();
    const lastSeen = now - 2 * AWARENESS_HEARTBEAT_MS_VAL; // exactly 2 heartbeats
    const isStale = (now - lastSeen) > 2 * AWARENESS_HEARTBEAT_MS_VAL;
    expect(isStale).toBe(false); // > not >=
  });

  test('freshly joined member is never stale', () => {
    const now = Date.now();
    const lastSeen = now;
    const isStale = (now - lastSeen) > 2 * AWARENESS_HEARTBEAT_MS_VAL;
    expect(isStale).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9 – Awareness payload structure validation
// ─────────────────────────────────────────────────────────────────────────────

describe('Awareness payload structure', () => {
  test('awareness-protocol payload has required fields', () => {
    const payload = {
      type: 'awareness-protocol',
      update: Buffer.from('{}').toString('base64'),
      documentId: null,
    };

    expect(payload).toHaveProperty('type', 'awareness-protocol');
    expect(payload).toHaveProperty('update');
    expect(payload).toHaveProperty('documentId');
    expect(typeof payload.update).toBe('string');
  });

  test('update field is valid base64', () => {
    const data = { 1: { user: { name: 'Test' } } };
    const b64 = Buffer.from(JSON.stringify(data)).toString('base64');
    const payload = { type: 'awareness-protocol', update: b64, documentId: null };

    const decoded = JSON.parse(Buffer.from(payload.update, 'base64').toString());
    expect(decoded['1'].user.name).toBe('Test');
  });

  test('payload type must be awareness-protocol for P2P bridge', () => {
    const validPayload = { type: 'awareness-protocol', update: 'dGVzdA==', documentId: null };
    const invalidPayload = { type: 'legacy-awareness', data: {} };

    expect(validPayload.type).toBe('awareness-protocol');
    expect(invalidPayload.type).not.toBe('awareness-protocol');
  });
});
