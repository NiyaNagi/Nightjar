# Nightjar v1.7.26 Release Notes

**Release Date:** June 2025

This release fixes **cross-platform sharing (Issue #11)** by adding HMAC authentication to the sidecar's relay bridge. Previously, the desktop sidecar connected to relay servers without auth tokens, so whichever side — web or native — connected first would lock out the other via the server's first-write-wins token model.

---

## 🐛 Root Cause: Sidecar Relay Bridge Missing HMAC Auth Tokens

### What Happened

When a workspace is shared, both the web client and the desktop sidecar connect to a public relay server to sync Yjs documents. The relay server uses HMAC-SHA256 room authentication: the first client to present a token registers it, and all subsequent clients must match it.

**The bug:** The sidecar's `relay-bridge.js` never sent an auth token. If a web client connected first and registered its token, the sidecar was permanently rejected (4403 close code). If the sidecar connected first (no token), the web client's token didn't match "no token," also causing rejection.

### Why It Wasn't Caught

The web-to-web path worked because both sides computed the same HMAC token via the browser's Web Crypto API. The native-to-native path sometimes worked because neither side sent a token (backward-compatible allow). But any mixed native↔web scenario failed silently.

---

## ✅ Fix 1: Auth Token Support in `relay-bridge.js`

- `connect()` now accepts a 4th `authToken` parameter
- `_connectToRelay()` appends `?auth=TOKEN` to the WebSocket URL
- Connection objects store `authToken` for use during reconnects
- `_scheduleReconnect()` passes `authToken` through to `connect()`

---

## ✅ Fix 2: HMAC Helper + Sidecar Call Sites

- Added `computeRelayAuthToken(keyBytes, roomName)` in `sidecar/index.js`
  - Uses `crypto.createHmac('sha256', key).update('room-auth:' + roomName).digest('base64')`
  - Identical message format to the web client's `computeRoomAuthTokenSync()`
- Updated **all 4** `relayBridge.connect()` call sites to compute and pass auth tokens:
  1. `connectAllDocsToRelay()` — bulk reconnect on relay enable
  2. Manual peer sync relay fallback
  3. `autoRejoinWorkspaces()` — startup reconnect
  4. `doc-added` handler — new document relay connection

---

## ✅ Fix 3: 4403 Auth Rejection Handling

- `ws.on('close')` now receives and checks the close code
- Code `4403` triggers `_handleDisconnect(roomName, { skipReconnect: true })`
- `_handleDisconnect()` accepts an `options` parameter; `skipReconnect: true` prevents futile retries
- Non-4403 closes still trigger normal exponential backoff reconnect

---

## ✅ Fix 4: Expanded Relay Room Filters

Previously only `workspace-meta:` rooms were connected to the relay. Now **all three room types** are relayed:

| Room Type | Example | Purpose |
|---|---|---|
| `workspace-meta:` | `workspace-meta:abc123` | Workspace metadata (document list, members) |
| `workspace-folders:` | `workspace-folders:abc123` | Folder structure |
| `doc-` | `doc-m3k7x9p...` | Individual document content |

---

## ✅ Fix 5: Late Key Arrival → Relay Auth Reconnect

When a key arrives via the `set-key` handler **after** the relay connection was already established (without auth), the sidecar now:

1. Detects the existing connection has no `authToken`
2. Disconnects from the relay
3. Computes the auth token using the newly-arrived key
4. Reconnects with the token

This handles the race condition where a document is created before the encryption key is delivered.

---

## ✅ Fix 6: Browser Async Auth Fallback

In pure browser mode (no Electron/Node.js), `computeRoomAuthTokenSync()` returns `null` because `require('crypto')` is unavailable. The fix adds an async fallback:

1. After creating the y-websocket provider, checks if `ywsAuthToken` is null
2. Computes the token asynchronously via `computeRoomAuthToken()` (Web Crypto API)
3. Reconstructs the full WebSocket URL: `serverBase/roomName?auth=TOKEN`
4. Disconnects and reconnects the provider with the authenticated URL

Applied in both:
- `useWorkspaceSync.js` — workspace-level rooms
- `AppNew.jsx` — document-level rooms (2 locations: create and open)

---

## 🔐 Security: How Relay Auth Works

```
Token = HMAC-SHA256(workspaceKey, "room-auth:" + roomName) → Base64

Web Client:  computeRoomAuthTokenSync(key, room) → token
Sidecar:     computeRelayAuthToken(key, room)    → token
             ↓ (identical token)
Server:      validateRoomAuthToken("yws:" + room, token)
             → First client registers token (first-write-wins)
             → Subsequent clients must match or get 4403
```

The `yws:` prefix is only used as a server-side map key — it is **not** part of the HMAC input.

---

## 🧪 Test Coverage

**69 new tests** in `tests/relay-auth-sync.test.js` across 14 describe blocks:

| Category | Tests | What it verifies |
|---|---|---|
| HMAC Token Compatibility | 5 | Sidecar/web token format match, null handling, error recovery |
| RelayBridge auth support | 7 | connect() signature, URL construction, token storage, reconnect passthrough |
| 4403 auth rejection | 5 | Close code handling, skipReconnect, non-4403 still reconnects |
| Sidecar call sites | 5 | All 4 connect() sites pass auth, no unauth calls |
| Expanded room filters | 3 | All 3 room types, TODO for per-workspace URL |
| Set-key reconnect | 3 | Late key detection, disconnect/reconnect, room type filtering |
| Browser fallback (useWorkspaceSync) | 6 | Async import, URL with room name, stale guard |
| Browser fallback (AppNew) | 5 | Both create/open sites, URL format, stale guard |
| Server validation | 4 | First-write-wins, timing-safe compare, 4403 close |
| E2E: Native↔Web | 3 | Token match, HMAC prefix, URL encoding |
| E2E: Web↔Web | 2 | Async fallback, backward compat |
| E2E: Native↔Native | 3 | Key access, token storage, determinism |
| Room name consistency | 4 | Separator formats, URL construction |
| Edge cases + regression | 13 | Null inputs, base64 encoding, key/room isolation, backward compat, backoff, Tor, Yjs sync |

**Full suite:** 154 test suites, 4850 tests pass (6 skipped).

---

## 📁 Files Changed

| File | Change |
|---|---|
| `sidecar/relay-bridge.js` | Auth token support throughout connection lifecycle |
| `sidecar/index.js` | HMAC helper, 4 call sites, room filters, set-key reconnect |
| `frontend/src/hooks/useWorkspaceSync.js` | Browser async auth fallback |
| `frontend/src/AppNew.jsx` | Browser async auth fallback (2 locations) |
| `frontend/public-site/content/networking.json` | Relay auth documentation |
| `tests/relay-auth-sync.test.js` | 69 new tests |

---

## 🔄 Upgrade Notes

- **No breaking changes** — null auth tokens are still accepted for backward compatibility
- Existing relay connections will automatically authenticate on reconnect
- Web clients in pure browser mode may see a brief reconnect as the async token computation completes
