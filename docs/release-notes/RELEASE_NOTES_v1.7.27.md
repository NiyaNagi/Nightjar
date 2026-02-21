# Nightjar v1.7.27 Release Notes

**Release Date:** June 2025

This release fixes **cross-platform sharing (Issue #12)** — the continuation of the relay auth work from v1.7.26. Despite auth tokens being correctly computed, sharing still failed because: (1) room names with colons were silently rejected, (2) the sidecar never HTTP-POSTed encryption keys to the relay server, and (3) workspace keys weren't persisted for restart recovery.

---

## 🐛 Root Cause Analysis

### Root Cause #1: `sanitizeId()` rejects colons

Workspace room names use the format `workspace-meta:abc123` and `workspace-folders:abc123`. The `sanitizeId()` function's regex `/^[a-zA-Z0-9_\-]+$/` does not allow colons. When the `set-key` handler called `sanitizeId(docName)`, it got `null` back. The key then fell through to the global `sessionKey` — which meant relay auth-reconnect was bypassed because the code only reconnects when a room-specific key is registered.

### Root Cause #2: Sidecar never delivers encryption keys to relay server

The relay server has encrypted persistence enabled by default. It needs the encryption key via HTTP POST to decrypt and persist Yjs state. The web frontend already delivered keys via `deliverKeyToServer()` in `websocket.js`, but the desktop sidecar had no equivalent — so when a native client created/joined a workspace, the relay server couldn't persist anything, and web joiners saw empty rooms.

### Root Cause #3: Workspace keys not persisted in LevelDB

When a user enters a workspace password, the derived key is held in the in-memory `documentKeys` Map but never saved to LevelDB metadata. On restart, `autoRejoinWorkspaces()` couldn't find the key, so it couldn't compute auth tokens or deliver keys to the relay.

---

## ✅ Fix 1: `sanitizeRoomName()` — colon-safe room validation

- New function `sanitizeRoomName(name)` in `sidecar/index.js`
- Regex: `/^[a-zA-Z0-9_\-:]+$/` — allows colons for room prefixes
- Retains all other safety checks: path traversal, null bytes, length limits
- `set-key` handler now uses `sanitizeRoomName(docName) || sanitizeId(docName)` fallback chain
- `sanitizeId()` is unchanged — still used for non-room-name IDs (workspace IDs, folder IDs, etc.)

---

## ✅ Fix 2: `deliverKeyToRelayServer()` / `deliverKeyToAllRelays()`

Two new functions in `sidecar/index.js` that HTTP POST encryption keys to relay servers:

- **`deliverKeyToRelayServer(relayUrl, roomName, keyBytes)`** — converts `wss://` → `https://` (or `ws://` → `http://`), posts to `/api/rooms/${encodeURIComponent(roomName)}/key` with Ed25519 signature
- **`deliverKeyToAllRelays(roomName, keyBytes)`** — fires parallel delivery to all configured relay nodes via `Promise.allSettled`
- Signature format: `nacl.sign.detached()` over `key-delivery:${roomName}:${keyBase64}:${timestamp}` — identical to the web frontend's `deliverKeyToServer()`
- Graceful handling: 404 = persistence disabled (not an error), timeout = 10s, all errors logged but non-fatal

---

## ✅ Fix 3: Key delivery wired into all code paths

| Code Path | What was added |
|---|---|
| `set-key` handler | `deliverKeyToAllRelays()` after key registration |
| `create-workspace` | `deliverKeyToAllRelays()` for both `-meta:` and `-folders:` rooms |
| `join-workspace` | `deliverKeyToAllRelays()` for both rooms |
| `connectAllDocsToRelay()` | Skip rooms with no key (`continue`); deliver key for connected rooms |
| `autoRejoinWorkspaces()` | Skip relay without key; deliver key + folders key when available |
| `doc-added` handler | Skip relay connect without key; deliver key when available |

---

## ✅ Fix 4: Workspace key persistence in LevelDB

- `set-key` handler now persists the encryption key in workspace metadata when the room starts with `workspace-meta:` or `workspace-folders:`
- Key stored as base64url (matching frontend format)
- Idempotent: only writes when `!wsMeta.encryptionKey` (doesn't overwrite existing)
- Handles `LEVEL_NOT_FOUND` gracefully (workspace not yet in metadata DB)
- On restart, `loadWorkspaceList()` preloads keys from metadata → `autoRejoinWorkspaces()` can auth + deliver

---

## ✅ Fix 5: Race condition — `set-key` before Yjs doc exists

**Bug found during verification:** If `set-key` fires before the frontend opens the Yjs WebSocket (so the doc doesn't exist in the `docs` Map yet), the relay connect was skipped.

**Fix:** Two-phase approach:
1. `set-key` delivers the key to the relay via HTTP even without a local doc
2. `doc-added` handler checks for existing keys and auto-connects + delivers when found

This ensures correct behavior regardless of event ordering.

---

## ✅ Fix 6: Server accepts same-key from different identities

**Bug found during verification:** When a workspace creator registers a key with identity A, a joiner delivering the same key with identity B got a 403 rejection ("Room key already registered by a different identity").

**Fix:** The server now compares the incoming key bytes with the stored key using `Buffer.equals()`. If the keys match, the delivery is accepted regardless of identity. Truly different keys from different identities still get 403.

---

## 🔬 Cross-Platform Matrix Verification

All 4 sharing scenarios were verified end-to-end:

| Scenario | Creator → Joiner | Status |
|---|---|---|
| Native → Web | Sidecar creates workspace, browser joins via share link | ✅ |
| Web → Native | Browser creates workspace, sidecar joins via share link | ✅ |
| Native → Native | Sidecar A creates, Sidecar B joins | ✅ |
| Web → Web | Browser A creates, Browser B joins | ✅ |

---

## 🧪 Testing

- **65 new tests** added to `tests/relay-auth-sync.test.js`
- Test suites cover: `sanitizeRoomName`, `deliverKeyToRelayServer`, key delivery wiring, key persistence, server same-key acceptance, cross-platform matrix, Ed25519 signature compatibility
- **Full suite: 154 suites, 4915 tests, 0 failures**

---

## 📁 Files Changed

| File | Changes |
|---|---|
| `sidecar/index.js` | Added `http`/`nacl` imports, `sanitizeRoomName()`, `deliverKeyToRelayServer()`, `deliverKeyToAllRelays()`, fixed `set-key`/`create-workspace`/`join-workspace`/`connectAllDocsToRelay`/`autoRejoinWorkspaces`/`doc-added` handlers |
| `server/unified/index.js` | Accept same-key delivery from different identities (Buffer.equals check) |
| `tests/relay-auth-sync.test.js` | 65 new tests for v1.7.27 functionality |
| `package.json` | Version bump to 1.7.27 |
