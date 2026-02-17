# Nightjar v1.7.3 Release Notes

**Release Date:** February 17, 2026

This release adds ownership transfer detection, a factory reset safety net, relay infrastructure hardening (Tor routing, graceful fallback, suspend/resume), the Y.Map folder and file-storage folder migration across all tests, and a comprehensive CSS color audit document.

---

## 🔑 Ownership & Permission Sync

### PermissionWatcher Component *(New)*
- **Auto-sync permission changes**: When a workspace owner transfers ownership to another member via Yjs, the promoted peer's local `myPermission` field now updates automatically — no app restart needed.
- **Toast notifications**: Promoted peers see "👑 You are now the owner of this workspace." Other permission changes (editor, viewer) also notify via toast.
- **Mounted in main.jsx** inside `<ToastProvider>` so it has access to all required contexts.

### Factory Reset Ownership Warning *(Enhanced)*
- **Sole-owner detection**: Before wiping, the factory reset dialog now checks whether you are the sole owner of any workspaces.
- **Live member check**: For the active workspace, Yjs members are inspected in real time to see if another owner exists.
- **Type-to-confirm bypass**: If sole-owner workspaces are found, an inline warning lists them by name and requires typing `DELETE WORKSPACES` to proceed — non-blocking, no extra modal.
- **Fallback**: Workspaces where you aren't the sole owner (or aren't an owner at all) use the existing double-confirmation flow unchanged.

---

## 🌐 Relay Infrastructure

### Tor SOCKS Proxy Support *(relay-bridge.js)*
- Lazy-loads `socks-proxy-agent` so relay WebSocket connections can be routed through Tor (`socks5h://127.0.0.1:9050`).
- `socksProxy` property on `RelayBridge` — set externally when Tor is enabled, cleared when disabled.
- Gracefully degrades if `socks-proxy-agent` is not installed.

### Graceful Relay Fallback *(relay-bridge.js)*
- Empty `RELAY_NODES` is now handled silently (direct P2P only) instead of throwing.
- When all relay nodes are unreachable, the client logs a warning and schedules a background reconnect instead of stopping.
- Clients continue syncing via Hyperswarm while awaiting relay availability.

### P2P Bridge Suspend/Resume *(p2p-bridge.js)*
- **`suspend()`**: Tears down Hyperswarm UDP and mDNS when Tor is active (relay-only mode) to prevent IP leakage, while saving identity and active topics.
- **`resume()`**: Re-initializes Hyperswarm with the saved identity and re-joins all previously active topics when Tor is disabled.
- Emits `suspended` / `resumed` events for UI status tracking.

### Bootstrap Nodes *(mesh-constants.js)*
- Default `BOOTSTRAP_NODES` now contains `wss://relay.night-jar.io` (was empty).
- Comment updated to reflect graceful fallback behavior.

---

## 🗂️ Y.Map Folder & File-Storage Migration — Test Alignment

### File Storage Tests
- `yStorageFolders` mock type changed from `MockYArray` → `MockYMap` across:
  - `file-storage-dashboard.test.jsx`
  - `file-storage-context.test.jsx`
  - `useFileStorageSync.test.js`
- All folder CRUD test assertions updated to use `.set()/.get()/.has()/.delete()` instead of `.push()/.toArray()` patterns.
- Tests for `permanentlyDeleteFolder`, `addFolder`, `updateFolder`, `deleteFolder` (recursive), and `restoreFolder` updated to Y.Map API.

---

## 🖥️ Server & Deployment

### Signaling Server Hardening *(server/unified/index.js)*
- `handleClose` now iterates `peerInfo.topics` and removes disconnected peers from all P2P topic rooms, broadcasting `peer-left` to remaining participants.
- Room ID length validation (max 256 chars) on `join-room`.
- `maxPayload` limits: 1 MB for signaling, 10 MB for y-websocket.
- CORS middleware added for REST API endpoints.
- Graceful shutdown handler for `SIGTERM` / `SIGINT`.

### Docker Compose *(server/unified/docker-compose.yml)*
- Removed deprecated `version:` key.
- `nightjar-relay` service uses `relay` profile; `nightjar-private` uses `private` profile.
- Host service starts by default with no profile.

### Nginx Configuration *(server/nginx/)*
- Updated upstream name to `nightjar` (was `signaling`).
- Added proxy for `/api/`, `/health`, and `/signal` endpoints with WebSocket upgrade headers.

### Relay Deployment Guide *(docs/RELAY_DEPLOYMENT_GUIDE.md — New)*
- Step-by-step VPS + Docker + Caddy deployment guide for `relay.night-jar.io`.
- Covers three modes: `host`, `relay`, `private`.
- Includes health check, DNS, environment variables, monitoring, security checklist, and troubleshooting.

---

## 🔄 P2P Sync Improvements *(sidecar/index.js, sidecar/hyperswarm.js)*

- **Duplicate observer guard**: `registeredTopicObservers` Set prevents registering Yjs update observers more than once per workspace.
- **Fallback format validation**: Rejects Yjs updates shorter than 2 bytes.
- **Sync retry tuning**: 6 retries × 15s = 90s total timeout (was unbounded).
- **Topic lookup fallback**: If `topicToWorkspace` map misses, falls back to `loadWorkspaceList` + `getWorkspaceTopicHex`.
- **Workspace-meta broadcast safety net**: If primary observer wasn't registered, the `updateHandler` broadcasts as a safety net.
- **Sync exchange guard** (`syncExchangeCompleted`): Prevents redundant sync-state-request messages when a peer sends duplicate `join-topic` messages.

---

## 🎨 CSS Color Audit *(docs/CSS_COLOR_AUDIT.md — New)*

- Comprehensive audit of all 109 CSS files in `frontend/src/`.
- Catalogues ~520+ hardcoded color violations (hex, white, rgba).
- Proposes 11 new CSS custom properties for missing semantic colors.
- Includes file-by-file violation tables with suggested `var(--…)` replacements.
- Color-to-variable mapping cheat sheet for future fixes.
- Ranked fix order by priority (Critical → Low).

---

## ✅ New Test Suites

| Suite | Tests | Covers |
|-------|-------|--------|
| `ymap-folder-migration.test.js` | 14 | Y.Map folder CRUD, duplicates, CRDT merge, observers, storage folders, sync manifest |
| `folder-ymap-crud.test.js` | 11 | Sidecar `addFolderToYjs`, `updateFolderInYjs`, `removeFolderFromYjs`, `buildSyncManifest` |
| `hyperswarm-sync-guard.test.js` | 7 | `syncExchangeCompleted` guard, peer+topic independence, reconnect scenario |
| `p2p-sync-improvements.test.js` | 12 | Duplicate observer prevention, fallback validation, retry config, topic lookup, broadcast safety net |
| `relay-server-infrastructure.test.js` | 38 | Bootstrap nodes, relay fallback, P2P suspend/resume, signaling validation, CORS, shutdown, Docker, Nginx, deployment guide |

**Totals:** 119 test suites, 3,267 tests (0 failures)

---

## Summary of Changed Files

| Area | Files |
|------|-------|
| **Frontend** | `AppNew.jsx`, `AppSettings.jsx`, `Chat.jsx`, `StatusBar.jsx`, `PermissionWatcher.jsx` *(new)*, `main.jsx`, `FolderContext.jsx`, `FileStorageContext.jsx`, `useWorkspaceSync.js`, `useFileStorageSync.js` |
| **Sidecar** | `index.js`, `hyperswarm.js`, `p2p-bridge.js`, `relay-bridge.js`, `mesh-constants.js` |
| **Server** | `unified/index.js`, `unified/docker-compose.yml`, `unified/README.md`, `nginx/nginx.conf`, `nginx/locations.conf` |
| **Scripts** | `debug-folder-sync.js`, `repair-folders.js` |
| **Tests** | 5 new suites + 3 updated suites |
| **Docs** | `CSS_COLOR_AUDIT.md` *(new)*, `RELAY_DEPLOYMENT_GUIDE.md` *(new)* |
