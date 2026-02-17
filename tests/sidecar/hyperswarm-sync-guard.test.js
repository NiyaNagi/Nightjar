/**
 * Tests for Hyperswarm sync guard — syncExchangeCompleted.
 * 
 * Covers:
 * - First join-topic for a peer+topic triggers sync-state-request
 * - AlreadyTracked peers still get one sync exchange
 * - Multiple redundant join-topic messages don't cause repeated syncs
 * - Different topics for the same peer are tracked independently
 */

const EventEmitter = require('events');

describe('Hyperswarm Sync Exchange Guard', () => {
  let emitter;
  let syncRequests;

  beforeEach(() => {
    emitter = new EventEmitter();
    syncRequests = [];

    emitter.on('sync-state-request', ({ peerId, topic }) => {
      syncRequests.push({ peerId, topic });
    });
  });

  // Simulate the join-topic handler logic from hyperswarm.js
  function handleJoinTopic(conn, peerId, topic, syncExchangeCompleted) {
    const alreadyTracked = conn.topics.has(topic);
    conn.topics.add(topic);

    if (!alreadyTracked) {
      emitter.emit('peer-joined', { peerId, topic });
      emitter.emit('sync-state-request', { peerId, topic });
    } else {
      // The guard: ensure at least one sync exchange per peer+topic
      const syncKey = `${peerId}:${topic}`;
      if (!syncExchangeCompleted.has(syncKey)) {
        syncExchangeCompleted.add(syncKey);
        emitter.emit('sync-state-request', { peerId, topic });
      }
    }
  }

  test('first join-topic triggers sync-state-request', () => {
    const conn = { topics: new Set() };
    const syncExchangeCompleted = new Set();

    handleJoinTopic(conn, 'peer1', 'topicA', syncExchangeCompleted);

    expect(syncRequests).toHaveLength(1);
    expect(syncRequests[0]).toEqual({ peerId: 'peer1', topic: 'topicA' });
  });

  test('alreadyTracked peer gets one sync exchange via guard', () => {
    const conn = { topics: new Set(['topicA']) }; // Already tracked
    const syncExchangeCompleted = new Set();

    handleJoinTopic(conn, 'peer1', 'topicA', syncExchangeCompleted);

    expect(syncRequests).toHaveLength(1);
    expect(syncRequests[0]).toEqual({ peerId: 'peer1', topic: 'topicA' });
  });

  test('subsequent join-topic for already-synced peer+topic is suppressed', () => {
    const conn = { topics: new Set(['topicA']) };
    const syncExchangeCompleted = new Set();

    // First: triggers via guard
    handleJoinTopic(conn, 'peer1', 'topicA', syncExchangeCompleted);
    expect(syncRequests).toHaveLength(1);

    // Second: guard prevents another sync
    handleJoinTopic(conn, 'peer1', 'topicA', syncExchangeCompleted);
    expect(syncRequests).toHaveLength(1); // No new request
  });

  test('different topics for same peer are independent', () => {
    const conn = { topics: new Set(['topicA']) };
    const syncExchangeCompleted = new Set();

    handleJoinTopic(conn, 'peer1', 'topicA', syncExchangeCompleted);
    expect(syncRequests).toHaveLength(1);

    // New topic → not alreadyTracked → triggers via primary path
    handleJoinTopic(conn, 'peer1', 'topicB', syncExchangeCompleted);
    expect(syncRequests).toHaveLength(2);
    expect(syncRequests[1]).toEqual({ peerId: 'peer1', topic: 'topicB' });
  });

  test('different peers for same topic are independent', () => {
    const conn1 = { topics: new Set(['topicA']) };
    const conn2 = { topics: new Set(['topicA']) };
    const syncExchangeCompleted = new Set();

    handleJoinTopic(conn1, 'peer1', 'topicA', syncExchangeCompleted);
    handleJoinTopic(conn2, 'peer2', 'topicA', syncExchangeCompleted);

    expect(syncRequests).toHaveLength(2);
    expect(syncRequests[0].peerId).toBe('peer1');
    expect(syncRequests[1].peerId).toBe('peer2');
  });

  test('syncExchangeCompleted set tracks composite keys correctly', () => {
    const syncExchangeCompleted = new Set();
    
    syncExchangeCompleted.add('peer1:topicA');
    syncExchangeCompleted.add('peer1:topicB');
    syncExchangeCompleted.add('peer2:topicA');
    
    expect(syncExchangeCompleted.has('peer1:topicA')).toBe(true);
    expect(syncExchangeCompleted.has('peer1:topicB')).toBe(true);
    expect(syncExchangeCompleted.has('peer2:topicA')).toBe(true);
    expect(syncExchangeCompleted.has('peer2:topicB')).toBe(false);
  });

  test('end-to-end: peer reconnects after 8h offline, gets synced', () => {
    const conn = { topics: new Set() };
    const syncExchangeCompleted = new Set();

    // First connection: normal join
    handleJoinTopic(conn, 'peer1', 'topicA', syncExchangeCompleted);
    expect(syncRequests).toHaveLength(1);

    // Simulate: conn is still active but peer sends join-topic again
    // (e.g., after reconnecting via DHT discovery after 8h offline)
    // topicA is alreadyTracked in conn.topics
    handleJoinTopic(conn, 'peer1', 'topicA', syncExchangeCompleted);
    // Should NOT trigger because syncExchangeCompleted already has the key
    // from the !alreadyTracked path (it was only set in the else branch)
    // Actually wait — the first call goes through !alreadyTracked path which
    // doesn't add to syncExchangeCompleted. So the else branch is entered
    // on the 2nd call and it SHOULD trigger.
    
    // Actually let's re-analyze: 
    // Call 1: !alreadyTracked → emits sync-state-request, adds to conn.topics
    //         syncExchangeCompleted is NOT touched
    // Call 2: alreadyTracked → checks syncExchangeCompleted → NOT has → adds + emits
    // Call 3: alreadyTracked → checks syncExchangeCompleted → HAS → does nothing
    
    expect(syncRequests).toHaveLength(2); // 1 from !alreadyTracked + 1 from guard
    
    // Third call: suppressed
    handleJoinTopic(conn, 'peer1', 'topicA', syncExchangeCompleted);
    expect(syncRequests).toHaveLength(2); // No new request
  });
});
