# Nightjar v1.8.14 — Fix File Download on Mobile (Issue #21)

## Summary

File downloads from desktop to mobile failed with "Connected peers: 0" despite the WebSocket signaling connection being established. The root cause was a **race condition** between the `identity` message and the `join-topic` flow on the signaling server.

## Root Cause

When `WebSocketTransport` connects to the signaling server (`wss://night-jar.co/signal`), it immediately sends `{ type: 'identity' }` to announce the peer's display name. The server's message switch had **no case for 'identity'**, so it hit the `default:` branch and returned `{ type: 'error', error: 'unknown_type' }`.

The client's error handler **blindly rejected** the pending `joinTopic` promise for **any** error, including this unrelated one. Since TCP guarantees ordering, the `identity` error always arrived before the `join-topic` response — so `joinTopic` rejected, `BootstrapManager` got 0 peers, and all file download retries failed.

```
Timeline (before fix):
  Client → Server:  { type: 'identity', peerId: '...', displayName: '...' }
  Server → Client:  { type: 'error', error: 'unknown_type' }     ← kills joinTopic!
  Client → Server:  { type: 'join-topic', topic: '...', authToken: '...' }
  Server → Client:  { type: 'peer-list', peers: [...] }          ← too late, promise already rejected
```

## Fixes (defense-in-depth, 3 layers)

### Fix A: Server — Handle 'identity' and 'pong' messages (`server/unified/index.js`)
- Added `case 'identity':` — stores `peerId` and `displayName` in the connection info object
- Added `case 'pong':` — no-op (application-level heartbeat reply)
- Both cases appear before the `default: unknown_type` fallthrough

### Fix B: Client — Smart joinTopic error filtering (`WebSocketTransport.js`)
- Created `TOPIC_FATAL_ERRORS` allowlist: `auth_token_mismatch`, `room_requires_auth`, `topic_full`, `server_room_limit`, `too_many_topics`
- Only these 5 errors reject the pending `joinTopic` promise
- All other errors (`unknown_type`, `relay_*`, `rate_limited`, etc.) are logged but do **not** kill joinTopic

### Fix C: Client — Deferred identity on reconnect (`WebSocketTransport.js`)
- On reconnect (when `currentTopic` exists): `joinTopic()` runs **first**, then `_sendIdentity()` in `.then()`/`.catch()`
- On initial connect (no `currentTopic`): `_sendIdentity()` runs immediately (safe — joinTopic hasn't started yet)
- Extracted `_sendIdentity()` helper method

## Cross-Platform Matrix

| Scenario | Before Fix | After Fix |
|---|---|---|
| Web ↔ Web | ❌ 0 peers, download fails | ✅ Fixed (WebSocket-only) |
| Web ↔ Native | ❌ 0 peers on web side | ✅ Fixed (signaling via WebSocket) |
| Native ↔ Web | ❌ 0 peers on web side | ✅ Fixed (signaling via WebSocket) |
| Native ↔ Native (LAN) | ✅ Worked (Hyperswarm/mDNS) | ✅ Still works |
| Native ↔ Native (WAN) | ⚠️ WebSocket path broken | ✅ WebSocket now works as fallback |

## Test Results
- **40 new tests** covering all 3 fixes + regression test for Issue #21 exact sequence
- Full suite: **165 suites, 5,310 tests passing**

## Files Changed
- `server/unified/index.js` — Added 'identity' and 'pong' cases to message switch
- `frontend/src/services/p2p/transports/WebSocketTransport.js` — TOPIC_FATAL_ERRORS allowlist, deferred identity on reconnect, `_sendIdentity()` helper
- `tests/file-download-mobile-fix.test.js` — 40 new tests
- `frontend/public-site/content/changelog.json` — v1.8.14 entry
- `RELEASE_NOTES_v1.8.14.md` — This file
