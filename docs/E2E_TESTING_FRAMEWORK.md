# Multi-Client End-to-End Testing Framework

This document describes Nightjar's comprehensive multi-client E2E testing framework designed to test real-time collaborative editing scenarios with actual network connections.

## Overview

The E2E testing framework enables testing of:

- **Multi-client synchronization** with 2-10+ simultaneous clients
- **CRDT convergence** at the character level
- **Network resilience** under adverse conditions (latency, packet loss, partitions)
- **Presence/awareness** features (cursors, selections, typing indicators)
- **Collaborative features** across text documents, spreadsheets, kanban boards, comments, and chat

All tests use **actual WebSocket connections** to the sidecar, not mocks, ensuring the test environment closely matches production behavior.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Test Runner                                 │
│  (test-runner.js / test-runner-utils.js)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  Text Sync      │  │  Workspace      │  │  Sheet Sync     │  │
│  │  E2E Tests      │  │  Presence Tests │  │  E2E Tests      │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
│           │                    │                    │           │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  Kanban Sync    │  │  Collaboration  │  │  Stress Tests   │  │
│  │  E2E Tests      │  │  Features Tests │  │  (10+ clients)  │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
│           │                    │                    │           │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │               Concurrency Test Harness                      ││
│  │  (concurrency-harness.js)                                   ││
│  │  - Manages sidecar lifecycle                                ││
│  │  - Creates/destroys N test clients                          ││
│  │  - Orchestrates parallel/sequential/staggered execution     ││
│  │  - Auto-dumps traces on failure                             ││
│  └─────────────────────────────────────────────────────────────┘│
│           │                    │                    │           │
│  ┌────────┴────────┐  ┌────────┴────────┐  ┌────────┴────────┐  │
│  │  Port Allocator │  │  Message        │  │  Chaos Proxy    │  │
│  │  (dynamic ports)│  │  Recorder       │  │  (network sim)  │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│           │                    │                    │           │
│  ┌────────┴────────┐  ┌────────┴────────┐  ┌────────┴────────┐  │
│  │  Test Stability │  │  CRDT           │  │  Visual Sync    │  │
│  │  Utilities      │  │  Assertions     │  │  Helpers        │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                      Test Utilities                              │
│  (test-utils.js - TestClient, SidecarProcess, assertions)       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Sidecar                                  │
│  - Yjs WebSocket Server (port 8080 or dynamic)                  │
│  - Metadata WebSocket Server (port 8081 or dynamic)             │
│  - y-websocket protocol for CRDT sync                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Infrastructure

### Port Allocator (`port-allocator.js`)

Enables parallel test execution by dynamically allocating unique port pairs.

**Features:**
- Port range: 18000-19000
- File-based locking for cross-process safety
- Automatic stale lock detection (5-minute expiry)
- Allocates paired ports (metaPort, yjsPort)

**Usage:**
```javascript
const { PortAllocator } = require('./port-allocator');

const allocator = new PortAllocator(18000, 19000);
const { metaPort, yjsPort } = await allocator.allocatePorts();
// Use ports...
await allocator.releasePorts(metaPort);
```

---

### Message Recorder (`message-recorder.js`)

Captures all WebSocket messages for debugging test failures.

**Features:**
- Records message timestamp, direction (send/receive), type, and payload
- Summarizes Yjs binary updates (operation counts, text deltas)
- Dumps traces to JSON files in `tests/integration/traces/`
- Can wrap TestClient for automatic recording

**Usage:**
```javascript
const { MessageRecorder } = require('./message-recorder');

const recorder = new MessageRecorder('client-1');
recorder.recordSent({ type: 'create-document', ... });
recorder.recordReceived({ type: 'document-created', ... });

// On test failure:
recorder.dumpToFile('test-failure-trace');
```

**Trace Output Example:**
```json
{
  "clientName": "client-1",
  "recordedAt": "2026-01-28T10:30:00.000Z",
  "messageCount": 42,
  "messages": [
    {
      "timestamp": 1706434200000,
      "direction": "sent",
      "type": "create-document",
      "payload": { "id": "doc-abc123", "name": "Test" }
    },
    {
      "timestamp": 1706434200050,
      "direction": "received",
      "type": "yjs-update",
      "summary": { "updateSize": 128, "textDelta": "+15 chars" }
    }
  ]
}
```

---

### Chaos Proxy (`chaos-proxy.js`)

Simulates adverse network conditions for resilience testing.

**Capabilities:**
| Condition | Description |
|-----------|-------------|
| Latency | Fixed or variable delay (e.g., 100-500ms) |
| Jitter | Random additional delay on top of base latency |
| Packet Loss | Percentage of messages to drop (0-100%) |
| Disconnect | Temporarily sever connection |
| Partition | Isolate client groups from each other |

**Usage:**
```javascript
const { ChaosProxy, ChaosProxyPair } = require('./chaos-proxy');

// Create proxy pair for meta + yjs
const chaos = new ChaosProxyPair(realMetaPort, realYjsPort);
await chaos.start();

// Apply network conditions
chaos.setLatency([100, 300]); // 100-300ms random
chaos.setPacketLoss(0.10);    // 10% packet loss
chaos.setJitter(50);          // +0-50ms jitter

// Simulate partition
chaos.setPartitioned(true);
await sleep(5000);
chaos.setPartitioned(false); // Heal partition

// Clients connect through proxy ports
const client = new TestClient('test');
await client.connectMeta(chaos.metaProxyPort);
```

---

### CRDT Assertions (`crdt-assertions.js`)

Provides character-level verification of CRDT document convergence.

**Key Functions:**

| Function | Purpose |
|----------|---------|
| `assertTextIdentical(clients, field, timeout)` | Verify all clients have identical text content |
| `waitForConvergence(clients, field, timeout)` | Wait until all clients converge |
| `diffStrings(a, b)` | Detailed character-by-character diff |
| `assertSpreadsheetCellsMatch(clients, sheet)` | Verify spreadsheet cell data matches |
| `assertKanbanBoardMatch(clients, boardId)` | Verify kanban board structure matches |

**Usage:**
```javascript
const { assertTextIdentical, diffStrings } = require('./crdt-assertions');

// Wait for and verify convergence
await assertTextIdentical([clientA, clientB, clientC], 'content', 5000);

// On failure, get detailed diff
const diff = diffStrings(clientA.getText(), clientB.getText());
console.log(diff);
// Output: "Mismatch at position 42: A='Hello' B='Helo' (missing 'l')"
```

---

### Test Stability Utilities (`test-stability.js`)

Provides tools for making tests reliable and reproducible.

**Utilities:**

| Utility | Purpose |
|---------|---------|
| `retryOnFlake(fn, retries, delay)` | Retry a test function on transient failures |
| `SeededRandom(seed)` | Deterministic random number generator |
| `AsyncBarrier(count)` | Synchronize N async operations |
| `waitForQuiescence(fn, timeout)` | Wait until a condition stabilizes |
| `timedLog(message)` | Log with relative timestamp |
| `measureTime(fn)` | Measure execution time |

**Usage:**
```javascript
const { retryOnFlake, SeededRandom, AsyncBarrier } = require('./test-stability');

// Retry flaky network test
await retryOnFlake(async () => {
    await testConcurrentEditing();
}, 3, 1000);

// Reproducible randomness
const rng = new SeededRandom(12345);
const delay = rng.nextInt(100, 500);

// Coordinate test phases
const barrier = new AsyncBarrier(3);
await Promise.all([
    client1.doWork().then(() => barrier.wait()),
    client2.doWork().then(() => barrier.wait()),
    client3.doWork().then(() => barrier.wait()),
]);
// All clients reach here together
```

---

### Concurrency Test Harness (`concurrency-harness.js`)

Orchestrates multi-client test scenarios with automatic setup and teardown.

**Features:**
- Manages sidecar process lifecycle
- Creates and connects N TestClient instances
- Supports parallel, sequential, and staggered execution patterns
- Integrates chaos proxy when enabled
- Auto-dumps message traces on test failure
- Waits for CRDT convergence with configurable timeout

**Usage:**
```javascript
const { ConcurrencyTestHarness } = require('./concurrency-harness');

const harness = new ConcurrencyTestHarness({
    testName: 'concurrent-editing',
    clientCount: 3,
    chaosEnabled: false,
});

await harness.setup();

// Connect all clients
await harness.connectAllMeta();
await harness.connectAllYjs(docId);

// Execute operations in parallel
await harness.parallel(async (client, index) => {
    client.insertText(`From client ${index}`, client.getText().length);
});

// Wait for convergence
await harness.waitForConvergence('content', 5000);

// Verify all clients match
await harness.assertAllConverged('content');

await harness.teardown();
```

**Execution Patterns:**

```javascript
// All clients execute simultaneously
await harness.parallel(async (client, index) => { ... });

// Clients execute one after another
await harness.sequential(async (client, index) => { ... });

// Clients start with staggered delays
await harness.staggered(async (client, index) => { ... }, 100); // 100ms between starts
```

---

### Visual Sync Helpers (`visual-sync-helpers.js`)

Tests presence and awareness features.

**Capabilities:**
- Cursor position sync
- Text selection sync
- Typing indicator sync
- User presence (online/away/offline)
- Comment thread sync
- Chat message sync

**Usage:**
```javascript
const { setCursor, setSelection, waitForAwarenessSync } = require('./visual-sync-helpers');

// Client A moves cursor
setCursor(clientA, docId, 42);

// Wait for Client B to see it
await waitForAwarenessSync(clientB, (states) => {
    return Array.from(states.values()).some(s => s.cursor === 42);
});

// Verify typing indicators
setTyping(clientA, docId, true);
await sleep(300);
const states = clientB.getAwarenessStates();
// Assert clientA's typing state is visible
```

---

## Test Suites

### Text Sync E2E Tests (`text-sync-e2e.test.js`)

Tests basic text document CRDT synchronization.

| Test | Description |
|------|-------------|
| Two clients concurrent typing | Both type simultaneously, verify merge |
| Three clients concurrent typing | Triple concurrent edits |
| Interleaved typing | Alternating character-by-character |
| Concurrent delete and insert | One deletes while other inserts |
| Undo isolation | Client A's undo doesn't affect Client B |
| Large paste sync | 10KB content paste and sync |
| Cursor position sync | Cursor awareness across clients |
| Selection range sync | Selection awareness across clients |
| Typing indicator sync | Typing state propagation |

---

### Workspace Presence E2E Tests (`workspace-presence-e2e.test.js`)

Tests workspace operations and user presence.

| Test | Description |
|------|-------------|
| Create and list workspaces | Workspace CRUD operations |
| Document creation broadcasts | New doc visible to all |
| Document deletion broadcasts | Deleted doc removed from all |
| Join via share link | Join using encrypted share URL |
| Disconnect removes presence | User leaves, presence updates |
| Permission change broadcasts | Role changes sync to all |
| Folder structure sync | Folder hierarchy sync |
| Document move sync | Move doc between folders |

---

### Sheet Sync E2E Tests (`sheet-sync-e2e.test.js`)

Tests collaborative spreadsheet editing.

| Test | Description |
|------|-------------|
| Single cell edit syncs | Basic cell value sync |
| Multiple cells across clients | Different cells edited |
| Same cell concurrent edit | Last-write-wins resolution |
| Different cells same row | No interference |
| Formula cell sync | Formula and computed value sync |
| Add sheet tab syncs | New sheet visible to all |
| Concurrent sheet creation | Both add sheets simultaneously |
| Cell selection presence | See other's selected cell |
| Multiple users different cells | Multiple selections visible |
| Large data paste (100 cells) | Bulk paste and sync |
| Delete cell syncs | Cell deletion propagates |

---

### Kanban Sync E2E Tests (`kanban-sync-e2e.test.js`)

Tests collaborative kanban board editing.

| Test | Description |
|------|-------------|
| Add column syncs | New column visible |
| Concurrent column creation | Both add columns |
| Add card syncs | New card visible |
| Concurrent cards same column | Both add cards |
| Delete card syncs | Deleted card removed |
| Move card between columns | Drag-drop simulation |
| Concurrent card moves (different) | Parallel moves |
| Concurrent reorder same column | Column reorder conflict |
| Card drag presence visible | See other's drag state |
| Many cards (50 cards) | Stress test card sync |

---

### Collaboration Features E2E Tests (`collaboration-features-e2e.test.js`)

Tests comments, chat, and other collaborative features.

| Test | Description |
|------|-------------|
| Add comment syncs | Comment visible to all |
| Concurrent comments | Multiple users comment |
| Comment reply syncs | Threaded replies |
| Resolve comment syncs | Resolution state |
| Chat message syncs | Real-time chat |
| Chat message order | Message ordering |
| Typing indicator syncs | Chat typing state |
| Message reactions sync | Emoji reactions |
| Chat with mention | @-mention sync |
| Online presence in workspace | User status visibility |
| Disconnect removes presence | Status on disconnect |

---

### Stress E2E Tests (`stress-e2e.test.js`)

High-load tests for performance and stability. **Requires `--stress` flag.**

| Test | Description | Timeout |
|------|-------------|---------|
| 10 clients concurrent editing | Maximum concurrency | 120s |
| 100 rapid sequential operations | Throughput test | 60s |
| High message volume | 5 clients × 50 ops each | 90s |
| Large document with many clients | 50KB doc, 10 clients | 120s |
| Long running session | 60-second sustained activity | 120s |

---

### Chaos E2E Tests (`chaos-e2e.test.js`)

Network resilience tests. **Requires `--chaos` flag.**

| Test | Description |
|------|-------------|
| High latency convergence (500ms) | Sync with delayed messages |
| Variable latency (jitter) | Unpredictable delays |
| 10% packet loss recovery | Lost message handling |
| High packet loss (25%) stress | Severe network conditions |
| Temporary disconnect and resync | Partition and heal |
| 5 second disconnect and resync | Extended offline period |
| Latency + packet loss combined | Multiple chaos factors |
| Chaos during rapid operations | Enable chaos mid-test |

---

## Running Tests

### Basic Usage

```bash
# Run a specific E2E suite
node tests/integration/test-runner.js --suite e2e-text-sync

# Run all standard E2E suites
node tests/integration/test-runner.js --suite e2e-text-sync
node tests/integration/test-runner.js --suite e2e-workspace-presence
node tests/integration/test-runner.js --suite e2e-sheet-sync
node tests/integration/test-runner.js --suite e2e-kanban-sync
node tests/integration/test-runner.js --suite e2e-collaboration
```

### Stress and Chaos Tests

```bash
# Run stress tests (10+ concurrent clients)
node tests/integration/test-runner.js --suite e2e-stress

# Run network chaos tests
node tests/integration/test-runner.js --suite e2e-chaos
```

### Filtering and Debugging

```bash
# Filter tests by name pattern
node tests/integration/test-runner.js --filter="concurrent"

# Verbose output
node tests/integration/test-runner.js --suite e2e-text-sync -v

# Custom timeout (ms)
node tests/integration/test-runner.js --timeout=60000

# Enable trace dumping for all tests
node tests/integration/test-runner.js --trace-all
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All tests passed |
| 1 | One or more tests failed |
| 2 | Test infrastructure error |

---

## Writing New Tests

### Basic Test Structure

```javascript
const { ConcurrencyTestHarness } = require('./concurrency-harness');
const { generateDocId, sleep } = require('./test-utils');

const MyTests = {
    name: 'My Feature Tests',
    tests: [],
};

function test(name, fn, options = {}) {
    MyTests.tests.push({
        name,
        fn: async () => {
            const harness = new ConcurrencyTestHarness({
                testName: `my-feature-${name}`,
                clientCount: options.clientCount || 2,
            });
            
            try {
                await harness.setup();
                await fn(harness);
            } catch (error) {
                harness.markFailed(error);
                throw error;
            } finally {
                await harness.teardown();
            }
        },
        timeout: options.timeout || 30000,
    });
}

// Define tests
test('basic sync works', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    clientA.insertText('Hello', 0);
    await harness.waitForConvergence('content', 5000);
    
    if (clientB.getText() !== 'Hello') {
        throw new Error('Sync failed');
    }
});

module.exports = MyTests;
```

### Adding Chaos to Tests

```javascript
test('survives network issues', async (harness) => {
    const docId = generateDocId();
    
    // Enable chaos proxy
    harness.withChaos({ latency: [100, 300], packetLoss: 0.05 });
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    // Test operations...
    
    // Disable chaos before verification
    harness.resetChaos();
    await harness.waitForConvergence('content', 10000);
});
```

---

## Best Practices

### 1. Use the Harness
Always use `ConcurrencyTestHarness` for multi-client tests. It handles:
- Port allocation
- Sidecar lifecycle
- Client creation/destruction
- Trace dumping on failure

### 2. Wait for Convergence
CRDT sync is asynchronous. Always wait for convergence before asserting:

```javascript
// Wrong - may fail due to timing
clientA.insertText('test', 0);
expect(clientB.getText()).toBe('test'); // Race condition!

// Correct
clientA.insertText('test', 0);
await harness.waitForConvergence('content', 5000);
expect(clientB.getText()).toBe('test');
```

### 3. Use Deterministic Random
For reproducible tests, use `SeededRandom`:

```javascript
const rng = new SeededRandom(testSeed);
const randomDelay = rng.nextInt(0, 100);
```

### 4. Clean Up Resources
The harness handles cleanup, but if managing resources manually:

```javascript
try {
    // Test code
} finally {
    client.close();
    sidecar.stop();
}
```

### 5. Appropriate Timeouts
- Basic sync: 5000ms
- Multi-client concurrent: 10000ms
- With chaos/latency: 15000-30000ms
- Stress tests: 60000-120000ms

---

## Troubleshooting

### Test Hangs
1. Check if sidecar started (look for "WebSocket server listening")
2. Verify ports are available (no conflicts)
3. Check for unhandled promise rejections

### Flaky Tests
1. Increase timeout for convergence waits
2. Add retry logic with `retryOnFlake()`
3. Check for timing-dependent assertions
4. Use message recorder to inspect timing

### CRDT Conflicts
1. Use `diffStrings()` to see exact differences
2. Check operation ordering in message traces
3. Verify awareness state propagation

### Debug Output
Enable verbose logging:
```bash
node tests/integration/test-runner.js -v --trace-all
```

Check trace files in `tests/integration/traces/`.

---

## File Reference

| File | Purpose |
|------|---------|
| `port-allocator.js` | Dynamic port allocation |
| `message-recorder.js` | WebSocket message tracing |
| `chaos-proxy.js` | Network condition simulation |
| `crdt-assertions.js` | CRDT verification helpers |
| `test-stability.js` | Retry, timing, synchronization |
| `concurrency-harness.js` | Multi-client test orchestration |
| `visual-sync-helpers.js` | Presence/awareness testing |
| `test-utils.js` | TestClient, SidecarProcess, helpers |
| `test-runner.js` | Main test execution entry point |
| `test-runner-utils.js` | Suite running utilities |
| `text-sync-e2e.test.js` | Text document tests |
| `workspace-presence-e2e.test.js` | Workspace/presence tests |
| `sheet-sync-e2e.test.js` | Spreadsheet tests |
| `kanban-sync-e2e.test.js` | Kanban board tests |
| `collaboration-features-e2e.test.js` | Comments/chat tests |
| `stress-e2e.test.js` | High-load tests |
| `chaos-e2e.test.js` | Network resilience tests |
