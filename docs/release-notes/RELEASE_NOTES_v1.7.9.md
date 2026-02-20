# Release Notes — v1.7.9

**Release Date:** February 19, 2026

Nightjar v1.7.9 is a **massive security and reliability release** resulting from a
30-iteration deep codebase audit. Over **165 bugs** were identified and fixed across
**120+ source files**, spanning every layer of the application — Electron main process,
sidecar, P2P networking, React frontend, server infrastructure, and cryptographic
subsystems. Zero test regressions: **132 suites, 3,876 tests (0 failures)**.

---

## 🔴 Critical Fixes

### Electron & IPC Security
- **IPC sender validation** — 15+ IPC handlers in `main.js` now verify the sender
  origin, preventing malicious renderer frames from invoking privileged operations
- **Arbitrary file write blocked** — file dialog/save handlers now sanitize absolute
  paths, preventing path traversal attacks that could write to arbitrary locations
- **Preload script injection hardened** — string construction in `preload.js` now
  fully escapes backticks, `${}` template literals, and newlines (not just single quotes)
- **Windows sidecar graceful shutdown** — sidecar process now receives a WebSocket
  shutdown message before force-kill, with 10s grace period to flush LevelDB
  (previously used SIGTERM which Node.js ignores on Windows, risking DB corruption)

### Cryptographic Fixes
- **Machine key salt fixed** — identity key derivation referenced an undefined variable
  (`machineInfo` instead of the actual module-scope variable), causing the try/catch
  to swallow a TypeError and fall back to a hardcoded deterministic salt. The
  per-installation random salt now actually works.
- **Folder/document share link key derivation** — share links for folders and documents
  were calling `deriveWorkspaceKey()` instead of the correct `deriveFolderKey()` /
  `deriveDocumentKey()`, producing wrong decryption keys and silently failing to
  open shared content
- **Encryption without key now throws** — `encryptData()` and `decryptData()` in
  `serialization.js` now throw errors when called without a key, instead of silently
  returning plaintext over the network
- **Random salt for backup encryption** — `backup.js` now generates a random 16-byte
  salt instead of using a hardcoded string
- **Password generator entropy** — removed 4 duplicate nouns (`bloom`, `brook`,
  `canyon`, `cedar`) that reduced effective password entropy

### P2P Protocol & Sync
- **Workspace switch race condition** — added monotonic counter to prevent async
  `leaveWorkspace` from nulling state needed by a concurrent `joinWorkspace`
- **Pending verification data consistency** — TTL cleanup now normalizes legacy
  bare-string entries to the proper `{publicKey, timestamp, workspaceId}` format
- **Unbounded Yjs doc creation** — added MAX_DOCS=500 limit in sidecar to prevent
  malicious peers from exhausting memory via infinite topic requests
- **P2P message size validation** — added size limits on incoming sync updates to
  prevent memory exhaustion attacks

---

## 🟠 High-Severity Fixes

### Server Security Hardening
- **Room join ghost peers** — signaling server now checks the 50-topic-per-peer
  limit *before* adding the peer to the room (previously left phantom entries on
  early return)
- **Never-expiring invites** — `POST /api/invites` now validates `expiresIn` as a
  number before arithmetic (string concatenation made expiry check always false)
- **Server DoS protection** — added room count limits (10K), message size limits,
  per-peer topic limits, request body size limits across all server endpoints
- **Prototype pollution prevention** — `Object.assign` from untrusted peer data
  now uses key allowlists
- **Health endpoint info disclosure** — `/health` no longer returns room count,
  uptime, server mode, or persistence status to unauthenticated callers

### Frontend Reliability
- **Awareness throttle double-fire** — replaced boolean `inThrottle` with proper
  timestamp tracking; awareness updates no longer broadcast twice per window
- **Collaborator ID stability** — `syncCollaboratorsFromAwareness` now uses
  `publicKey` as peer identity (not ephemeral Yjs `clientId`), preventing
  duplicate collaborator entries after reconnection
- **CSS injection from peer colors** — added `sanitizeColor()` utility that
  validates hex/rgb/hsl format before interpolating peer colors into CSS
- **Ordered list double-wrapping** — `markdownToHtml` no longer wraps `<ol>` items
  inside `<ul>` tags (regex ordering fix in `exportUtils.js`)
- **Private key file permissions** — identity files now written with `0o600`
  permissions on Unix (previously world-readable)

---

## 🟡 Medium-Severity Fixes

### Race Conditions & Concurrency
- **Concurrent doc creation lock** — `getOrCreateYDoc` uses promise-chaining to
  prevent duplicate Y.Doc instances from parallel peer connections
- **WorkspaceContext side effect isolation** — extracted async operations from
  render path to prevent double-execution in React 18 Strict Mode
- **Async read-modify-write protection** — peer join/leave events for the same
  workspace now serialize via per-workspace promise chains
- **Sidecar timer cleanup** — all `setInterval` timers now tracked and cleared
  during shutdown (previously leaked references)
- **workspace-left event deferred** — now dispatched via `setImmediate()` to
  prevent y-websocket reconnecting during teardown

### Data Integrity
- **Sheet double-apply fix** — Fortune Sheet ops now tracked by `clientId` in
  `pendingOps`, filtering local ops in the Yjs observer to prevent duplication
- **KanbanBoard stale state** — CRUD operations now read from Yjs ref instead
  of stale React state; awareness properly merges existing user fields
- **Chunk availability merge** — `updateChunkAvailability` in FileStorageContext
  now merges existing holders instead of overwriting
- **Redundant Yjs writes eliminated** — `updateOnlineStatus` in collaboratorSync
  now skips writes when `online` status hasn't actually changed
- **Changelog slider bounds** — clamped index to `Math.min(index, changelog.length - 1)`
  to prevent out-of-bounds access when DB count exceeds in-memory array length

### UI/UX Fixes
- **Rename double-fire** — Enter key on rename inputs now calls `e.target.blur()`
  instead of `finishRename()` directly, preventing the operation from firing twice
  (once on Enter, once on blur)
- **Rollback button guard** — only shown when `selectedEntry?.stateSnapshot` exists,
  preventing confusing no-op clicks
- **CreateWorkspace tab state** — switching to Join tab now clears stale
  `joinError` and `connectionProgress` from previous attempts
- **Presence flicker** — awareness cleanup moved to unmount-only effect using ref,
  preventing cursor/presence blinking during re-renders
- **setLocalState → setLocalStateField** — PresenceContext cleanup now uses
  field-level clearing instead of `setLocalState(null)` to avoid wiping shared
  awareness data from other tabs

### Memory Leaks
- **AwarenessManager** — bound listener references now stored for proper cleanup
- **mDNS leaveTopic** — guarded with optional chaining to prevent crash when
  mDNS transport is unavailable
- **P2PWebSocketAdapter** — removed duplicate 'message' event subscription
- **WebRTCTransport** — prevented duplicate 'connected' events from firing
- **FolderContext** — removed ~170 lines of unreachable dead code (legacy Yjs effect)

---

## 🟢 Low-Severity Fixes

### Error Handling & Edge Cases
- **SimpleMarkdown infinite loop guard** — added recursion depth limit to prevent
  browser hang on deeply nested markdown
- **ShareDialog password regeneration** — password field now properly regenerates
  when share dialog is reopened
- **identityTransfer base62 byte length** — fixed calculation for base62→bytes
  conversion; PIN now hashed with SHA-256
- **chunkStore onblocked handler** — IndexedDB `open()` now handles the `onblocked`
  event when another tab holds an older version
- **LevelDB safe iteration** — workspace deletion now collects keys first, then
  deletes in a separate pass (previously mutated during iteration)
- **formatTimestamp NaN guard** — returns empty string for undefined/invalid
  timestamps instead of displaying "Invalid Date"
- **Stale closure fixes** — multiple `useCallback` hooks updated with missing
  dependency array entries across 5+ components
- **Render-time ref sync** — 5 files updated to use render-time ref assignment
  instead of `useEffect`-based sync, eliminating one-frame stale data windows

### Server & Infrastructure
- **Signaling server** — input validation on room IDs, peer cleanup on disconnect,
  maxPayload limits
- **Persistence server** — rate limiting, body size limits, field validation on
  invite creation
- **Unified server** — room count caps, per-peer topic limits, prototype pollution
  protection
- **Hyperswarm topic validation** — added `validateTopicHex()` requiring exactly
  64 hex characters on all message handlers
- **Sidecar workspace cleanup** — leave/delete now cleans up all P2P state maps,
  pending verifications, and per-workspace encryption keys

---

## 📊 Audit Statistics

| Metric | Value |
|--------|-------|
| **Total iterations** | 30 |
| **Total bugs found** | ~259 |
| **Total bugs fixed** | ~165 |
| **Files modified** | 120+ |
| **Test suites** | 132 (all passing) |
| **Total tests** | 3,876 (6 skipped, 0 failures) |
| **Categories** | Security (25), Race conditions (20), Memory leaks (15), Functional (50), UI (15), Performance (10), Reliability (30) |

### Bug Severity Distribution

| Severity | Count |
|----------|-------|
| 🔴 Critical | ~15 |
| 🟠 High | ~25 |
| 🟡 Medium | ~75 |
| 🟢 Low | ~50 |

---

## 📁 Files Modified (by area)

### Electron Main Process (3 files)
`src/main.js`, `src/preload.js`, `src/frontend/ipc-provider.js`

### Sidecar (6 files)
`sidecar/index.js`, `sidecar/hyperswarm.js`, `sidecar/identity.js`, `sidecar/crypto.js`, `sidecar/inventoryStorage.js`, `sidecar/relay-bridge.js`

### P2P Services (8 files)
`PeerManager.js`, `P2PWebSocketAdapter.js`, `WebRTCTransport.js`, `WebSocketTransport.js`, `HyperswarmTransport.js`, `mDNSTransport.js`, `serialization.js`, `messages.js`

### React Contexts (9 files)
`WorkspaceContext`, `FolderContext`, `PresenceContext`, `IdentityContext`, `FileStorageContext`, `FileTransferContext`, `PermissionContext`, `InventoryContext`, `P2PContext`

### Hooks (8 files)
`useFileDownload`, `useFileUpload`, `useFileStorageSync`, `useAutoSave`, `useChangelogObserver`, `useInventorySync`, `useNotificationSounds`, `useWorkspaceSync`

### Components (50+ files)
All major components including `AppNew`, `EditorPane`, `Sheet`, `KanbanBoard`, `Chat`, `Changelog`, `HierarchicalSidebar`, `CreateWorkspace`, `ShareDialog`, `StatusBar`, `SearchPalette`, `SimpleMarkdown`, all inventory components, all file storage components

### Utilities (18 files)
`sharing.js`, `keyDerivation.js`, `identityTransfer.js`, `backup.js`, `chunkStore.js`, `collaboratorSync.js`, `collaboratorTracking.js`, `passwordGenerator.js`, `exportUtils.js`, `diagnostics.js`, `colorUtils.js`, `cryptoUtils.js`, `addressCrypto.js`, `autoAssign.js`, `linkHandler.js`, `secureStorage.js`, `inventoryNotifications.js`, `platform.js`

### Server (5 files)
`server/signaling/index.js`, `server/persistence/index.js`, `server/unified/index.js`, `server/unified/mesh.mjs`, `server/unified/mesh-constants.mjs`

### Tests (12 files updated)
Updated test assertions to match new secure behavior (encryption throws, awareness contract, presence cleanup, download hook mocks)

---

## 🔄 Upgrade Notes

- **No breaking changes** — all fixes are backward-compatible
- **No migration required** — existing workspaces and identities work without changes
- **Server operators**: Update relay/signaling servers to get DoS protection and
  input validation improvements
- **Test suite**: Run `npx jest --no-coverage --maxWorkers=2` to verify (132 suites,
  3,876 tests expected)
