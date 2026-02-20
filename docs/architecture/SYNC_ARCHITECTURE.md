# Multi-Client Synchronization Architecture

## Overview

Nightjar uses a hybrid synchronization approach combining:
1. **Local-first editing** via Yjs CRDTs
2. **WebSocket sync** for same-machine/LAN collaboration
3. **P2P sync over Tor** for anonymous internet collaboration

## Current Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        Client (Electron)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  React UI   │──│  Y.Doc(s)   │──│  WebsocketProvider  │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│                           │                    │              │
└───────────────────────────┼────────────────────┼──────────────┘
                            │                    │
                            ▼                    ▼
                    ┌───────────────────────────────────────┐
                    │            Sidecar (Node.js)          │
                    │  ┌────────────────────────────────┐  │
                    │  │  y-websocket server (8080)     │  │
                    │  │  - Manages Y.Doc instances     │  │
                    │  │  - Syncs between local clients │  │
                    │  └────────────────────────────────┘  │
                    │  ┌────────────────────────────────┐  │
                    │  │  LevelDB Persistence           │  │
                    │  │  - Encrypted document updates  │  │
                    │  │  - Per-document namespacing    │  │
                    │  └────────────────────────────────┘  │
                    │  ┌────────────────────────────────┐  │
                    │  │  libp2p + Tor (when enabled)   │  │
                    │  │  - GossipSub for broadcast     │  │
                    │  │  - Onion service for hosting   │  │
                    │  └────────────────────────────────┘  │
                    └───────────────────────────────────────┘
```

## Sync Mechanisms

### 1. Same-Machine Multi-Window Testing

To test on the same machine with multiple windows:

```bash
# Terminal 1: Start the sidecar
cd Nightjar
node sidecar/index.js

# Terminal 2: Open first Electron window
npm run start

# Terminal 3: Open browser to the same URL
# Open http://localhost:5173 (Vite dev server)
# Or open another Electron instance
```

Both clients connect to the same `y-websocket` server (port 8080), so they automatically sync via the shared Yjs documents.

### 2. Cross-Machine Sync (via Tor)

When Tor is enabled:
1. The sidecar creates an ephemeral onion service
2. libp2p node listens on the onion address
3. GossipSub broadcasts document updates to peers
4. Peers subscribe to the `/nightjar/1.0.0` topic

**Current Limitations:**
- No peer discovery (manual invite links only)
- No per-document P2P channels (all docs share one topic)
- Updates are encrypted but can still be applied to wrong docs

## Proposed Improvements

### Short-term: Per-Document Topics

```javascript
// Instead of single topic:
const PUBSUB_TOPIC = '/nightjar/1.0.0';

// Use per-document topics:
const getDocTopic = (docId) => `/nightjar/1.0.0/doc/${docId}`;
```

### Medium-term: WebRTC Direct Connections

For better latency and reliability:
1. Use libp2p WebRTC transport
2. Establish direct connections between peers
3. Fall back to Tor relays when direct fails

### Long-term: Torrent-like Seeding

For large documents or media:
1. Chunk large updates into smaller pieces
2. Use content-addressed storage (like IPFS)
3. Seed chunks across multiple peers
4. Reconstruct documents from available chunks

## Conflict Resolution

Yjs handles conflicts automatically using CRDTs:

1. **Text CRDT**: Character insertions/deletions merge deterministically
2. **Map CRDT**: Last-write-wins with causal ordering
3. **Array CRDT**: Maintains relative positions of elements

**Example conflict resolution:**
```
User A types: "Hello"
User B types: "World"
Both started from empty doc

Result: "HelloWorld" or "WorldHello"
(deterministic based on client IDs and operation timestamps)
```

## Testing Checklist

See `tests/p2p-sync.test.js` for:
- [ ] Same-machine multi-window sync
- [ ] Document persistence across restarts
- [ ] Concurrent editing conflict resolution
- [ ] Tor toggle on/off stability
- [ ] Peer discovery and connection
- [ ] Large document sync
- [ ] Network partition recovery

## Manual Testing Steps

### Test 1: Local Multi-Window

1. Start the sidecar: `node sidecar/index.js`
2. Start dev server: `npm run dev:react`
3. Open `http://localhost:5173` in two browser tabs
4. Create a document in Tab 1
5. Observe document appears in Tab 2 sidebar
6. Edit in Tab 1, observe changes in Tab 2 (real-time)

### Test 2: Persistence

1. Create document and add content
2. Close the app
3. Restart the app
4. Verify document list loads
5. Open document, verify content restored

### Test 3: Tor Toggle

1. Start app in offline mode (default)
2. Click Tor toggle button
3. Observe status changes: Offline → Connecting → Connected
4. Click toggle again
5. Observe status returns to Offline

### Test 4: Cross-Machine (Requires Tor)

1. Machine A: Enable Tor, copy invite link
2. Machine B: Open app, paste invite link
3. Both machines should see same documents
4. Edit on A, observe sync to B
