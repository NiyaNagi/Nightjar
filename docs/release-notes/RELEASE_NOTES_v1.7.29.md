# Nightjar v1.7.29 Release Notes

**Release Date:** July 2025

This release fixes the **document-level WebSocket authentication mismatch** (Issue #14) that caused all document content to fail syncing between clients. Workspace-level sync (presence, document list, sidebar) worked correctly, but individual document rooms (text, spreadsheets, kanban, conversations, inventory, files) were stuck in a rapid connect/disconnect loop.

---

## 🔥 Root Cause — Session Key vs Workspace Key Mismatch

Document-level WebSocket auth tokens were computed using `sessionKey` (a random per-browser/per-app key) instead of `workspaceKey` (the shared workspace encryption key derived from the share link or password).

### How Auth Works
The relay server uses **first-write-wins** token registration:
1. First client connects to room `doc-xxx` → registers `HMAC(key, "room-auth:doc-xxx")`
2. All subsequent clients must present the **same** HMAC token to join

### The Bug
```
Client A (creates doc):  HMAC(sessionKey_A, "room-auth:doc-xxx") → registered ✅
Client B (opens doc):    HMAC(sessionKey_B, "room-auth:doc-xxx") → mismatch ❌
```

Since `sessionKey_A ≠ sessionKey_B` (each browser/app generates its own random session key), Client B's auth token never matched Client A's registered token.

### The Cycle
1. Client B connects without auth (browser: `computeRoomAuthTokenSync()` returns null)
2. Server rejects: room already has registered auth → close(4403)
3. Async fallback computes token from `sessionKey_B` → still mismatches → close(4403)
4. y-websocket auto-reconnects at 100ms (backoff resets on each successful TCP open)
5. Repeat forever → the rapid `connected → disconnected` loop seen in diagnostic logs

### Why Workspace Sync Worked
`useWorkspaceSync.js` already used `getStoredKeyChain(workspaceId).workspaceKey` — the shared workspace key from the share link. All clients in the same workspace computed identical HMAC tokens for workspace-level rooms.

---

## 🔧 Fixes

### 1. Document Auth Uses Workspace Key (`frontend/src/AppNew.jsx`)
- `createDocument()` and `openDocument()` now derive `authKey` from `getStoredKeyChain(currentWorkspaceId).workspaceKey` instead of `sessionKey`
- Falls back to `sessionKey` if no key chain is stored yet (backward compatibility)
- Auth tokens are now `HMAC(workspaceKey, "room-auth:" + docId)` — identical across all workspace members

### 2. Browser Connect-Before-Auth Eliminated
- Document providers now use `{ connect: false }` when async auth computation is needed
- The async Web Crypto API computes the HMAC token, sets the URL with `?auth=`, then calls `provider.connect()`
- Eliminates the previous pattern of connecting without auth, getting rejected, then disconnecting and reconnecting
- Removes the unnecessary `provider.disconnect()` → `provider.connect()` cycle

### 3. Per-Document Key Delivery to Sidecar
- In Electron mode, `createDocument()` and `openDocument()` now send `set-key` with `docName: docId` to the sidecar
- This ensures the sidecar has the workspace key for each document room
- Previously, only the global session key was sent (without a `docName`), and document rooms fell back to the per-browser session key for relay auth

### 4. Key Delivery to Server Uses Workspace Key
- `deliverKeyToServer()` in web mode now sends the workspace key (not session key) for document rooms
- This ensures the server has the correct key for encrypted persistence when enabled

---

## 🧮 Sharing Matrix

All four sharing scenarios now work correctly:

| Scenario | Auth Key Source | Token Match |
|----------|----------------|-------------|
| **Web ↔ Web** | Both: `getStoredKeyChain(wsId).workspaceKey` | ✅ |
| **Web ↔ Native** | Web: workspace key; Sidecar: workspace key via `set-key` IPC | ✅ |
| **Native ↔ Web** | Sidecar: workspace key via `set-key` IPC; Web: workspace key | ✅ |
| **Native ↔ Native** | Both sidecars: workspace key via `set-key` IPC | ✅ |

---

## ✅ Tests

- **31 new tests** in `tests/document-auth-matrix.test.js`:
  - Source code verification: `authKey` derived from `getStoredKeyChain`, `connect: false` pattern, sidecar `set-key` delivery
  - HMAC cross-platform compatibility: same key + room = same token
  - Full sharing matrix: all 4 scenarios produce matching tokens
  - Regression: confirms different session keys would produce mismatched tokens (the old bug)
  - Server auth validation verified unchanged (first-write-wins, timing-safe comparison, 4403 rejection)
- **Updated 3 tests** in `tests/relay-auth-sync.test.js` to match new `authKey` variable name
- **Updated 1 test** in `tests/security-hardening-phase2.test.js` to match new `authKey` variable name
- **Full test suite: 4984 tests pass (156 suites, 0 failures)**

---

## 📁 Files Changed

| File | Change |
|------|--------|
| `frontend/src/AppNew.jsx` | Import `getStoredKeyChain`; use workspace key for doc auth tokens, key delivery, and sidecar `set-key`; `connect: false` pattern |
| `tests/document-auth-matrix.test.js` | New test file: 31 tests for auth token matrix |
| `tests/relay-auth-sync.test.js` | Updated 2 tests for `authKey` variable name |
| `tests/security-hardening-phase2.test.js` | Updated 1 test for `authKey` variable name |
| `docs/release-notes/RELEASE_NOTES_v1.7.29.md` | This file |

---

## 🔗 Issue Reference

Closes **Issue #14**: Document content, spreadsheet content, files, inventory, and conversation data did not sync between clients despite workspace-level presence and document list working correctly.
