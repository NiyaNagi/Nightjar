# Release Notes — v1.8.10

**Fix File Sharing Auth & Mobile Reconnect Loop (Issues #18, #19)**

Three root causes were identified from diagnostic logs in Issues #18 and #19:

1. **File transfer used wrong encryption key** — `FileTransferProvider` received the per-browser `sessionKey` instead of the shared workspace key, causing HMAC auth tokens to mismatch across devices
2. **y-websocket infinite reconnect loop** — Server closes WebSocket with code 4403 on auth failure, but y-websocket resets its backoff on every TCP open, resulting in 100ms rapid reconnect cycling forever on mobile
3. **join-topic auth rejection silently ignored** — `WebSocketTransport.joinTopic()` was fire-and-forget, so server auth errors hit the default case handler and were swallowed

---

## 🔑 Fix 1: FileTransferProvider Wrong Key (Issue #18 Root Cause)

### Root Cause

`AppNew.jsx` line 2343 passed `workspaceKey={sessionKey}` to `FileTransferProvider`. The `sessionKey` is a per-browser random NaCl key — NOT shared across workspace members. Each device computed a different HMAC-SHA256 token → first device registers its token on the signaling server (first-write-wins) → second device sends a mismatched token → `auth_token_mismatch` → silently rejected → 0 peers discovered.

### Fix

Changed to `workspaceKey={getStoredKeyChain(currentWorkspaceId)?.workspaceKey || sessionKey}` — the same pattern already used for document-level auth at lines 1424 and 1561.

| File | Change |
|------|--------|
| `AppNew.jsx` | `workspaceKey={sessionKey}` → `workspaceKey={getStoredKeyChain(currentWorkspaceId)?.workspaceKey \|\| sessionKey}` |

---

## 🔄 Fix 2: Stop y-websocket Reconnect Loop on 4403 (Issue #19)

### Root Cause

The y-websocket library's built-in backoff resets `wsUnsuccessfulReconnects = 0` on every `onopen` event. But when the server rejects auth, it closes the connection with code 4403 **after** the TCP handshake succeeds (after `onopen`). This means the backoff is permanently `2^0 × 100 = 100ms`, creating an infinite rapid-reconnect loop that prevents any workspace data from loading.

### Fix

Added a `connection-close` event handler in `useWorkspaceSync.js` that checks for `event?.code === 4403`. When detected, calls `provider.disconnect()` to permanently stop reconnection, sets sync phase to `'failed'`, and shows an "Authentication rejected" error message.

| File | Change |
|------|--------|
| `useWorkspaceSync.js` | Added 4403 close-code handler → `provider.disconnect()` + error UI |

---

## ⚡ Fix 3: Rapid-Disconnect Circuit Breaker

### Root Cause

Even without code 4403, any server-side close after TCP handshake bypasses y-websocket's backoff. The existing `connectionFailures` counter reset on every `connected` status change, and the `isRemote` guard excluded local/PWA users (i.e., mobile) from retry limits entirely.

### Fix

- **Rapid-disconnect tracking**: Counts disconnections happening within 2 seconds of the last connection. After 5 rapid disconnects, kills the provider with a "Connection unstable" error.
- **Universal retry limits**: Removed `isRemote` condition from both the status-event failure check and the `connection-error` handler, so all workspaces (local, remote, PWA) now get retry protection.

| File | Change |
|------|--------|
| `useWorkspaceSync.js` | Added `rapidDisconnects` counter + `lastConnectedAt` timestamp tracking |
| `useWorkspaceSync.js` | Removed `isRemote` from `connectionFailures >= maxFailures` check |
| `useWorkspaceSync.js` | Removed `isRemote` from `connection-error` handler |

---

## 🚫 Fix 4: Handle join-topic Auth Rejection

### Root Cause

`WebSocketTransport.joinTopic()` sent a `join-topic` message to the server but never validated the response. The server sends `{ type: 'error', error: 'auth_token_mismatch' }` on auth failure, but this hit the `default` case in the `onmessage` handler and was silently ignored. Bootstrap thought it succeeded (TCP was connected) but reported 0 peers.

### Fix

- Added `case 'error'` handler in WebSocketTransport's onmessage switch that emits `server-error` events and rejects pending `joinTopic` promises
- Made `joinTopic()` a proper request-response Promise: resolves on peer-list receipt, rejects on error, times out after 5 seconds
- Forwarded `server-error` events through PeerManager for UI consumption
- BootstrapManager now distinguishes TCP failures from auth rejections and emits `auth-rejected` events
- Fixed `_tryBootstrapPeer()` to pass auth credentials (was missing authToken/workspaceKey)

| File | Change |
|------|--------|
| `WebSocketTransport.js` | Added `case 'error'` handler + Promise-based `joinTopic()` |
| `PeerManager.js` | Forward `server-error` events from WebSocket transport |
| `BootstrapManager.js` | Auth error diagnostics + `_tryBootstrapPeer()` now passes credentials |

---

## 📊 Test Results

```
Test Suites: 164 passed, 164 total
Tests:       5,264 passed, 5,270 total (6 skipped)
```

20 new tests in `file-sharing-auth-fixes.test.js`:
- 8 WebSocketTransport joinTopic error handling tests
- 4 BootstrapManager auth rejection tests
- 3 Workspace key flow verification tests
- 4 y-websocket reconnect protection tests
- 1 Server auth validation test

1 existing test updated in `file-transfer.test.js` (assertion changed from `sessionKey` to `getStoredKeyChain()?.workspaceKey || sessionKey`).

---

## 📋 Files Modified

| File | Lines Changed | Purpose |
|------|--------------|---------|
| `frontend/src/AppNew.jsx` | 1 | Fix 1: Use shared workspace key |
| `frontend/src/hooks/useWorkspaceSync.js` | ~40 | Fix 2 + 3: 4403 handler, circuit breaker, universal retry |
| `frontend/src/services/p2p/transports/WebSocketTransport.js` | ~60 | Fix 4: Error handling, Promise joinTopic |
| `frontend/src/services/p2p/PeerManager.js` | 5 | Fix 4: Forward server-error events |
| `frontend/src/services/p2p/BootstrapManager.js` | 15 | Fix 4: Auth diagnostics, bootstrap peer auth |
| `tests/file-sharing-auth-fixes.test.js` | 330 | New test suite |
| `tests/file-transfer.test.js` | 3 | Updated assertion for Fix 1 |
