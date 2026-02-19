# Release Notes — v1.7.8

**Release Date:** February 18, 2026

Nightjar v1.7.8 is a stability and UX release addressing **6 bugs found during production testing** of v1.7.7, plus **2 feature enhancements**. Key changes include a root-cause fix for files not syncing without Force Full Sync, a unified StatusBar SyncChip replacing 4 separate indicators, per-stage cumulative analytics lines, and relay/backoff hardening.

---

## 🐛 Bug Fixes

### 1. PAT Missing in Bug Reports
- **Symptom:** In-app bug report submissions failed silently — the GitHub API token was empty in production builds.
- **Root Cause:** `vite.config.js` used `process.env.VITE_GITHUB_PAT` which is only populated in Node.js, not by Vite's `.env` file loading.
- **Fix:** Converted `vite.config.js` to function-style `defineConfig(({ mode }) => {...})` with `loadEnv(mode, process.cwd(), '')`. The PAT is now correctly read from `.env` files at build time.
- **Files:** `vite.config.js`

### 2. Invisible Pie Chart Buttons on Analytics Dashboard
- **Symptom:** The "By Status" / "By Item" toggle buttons on the analytics pie chart were invisible (transparent text on transparent background).
- **Root Cause:** Bootstrap `.btn-sm`, `.btn-primary`, `.btn-secondary` classes were overridden by the dark theme but never re-styled in `AnalyticsDashboard.css`.
- **Fix:** Added explicit CSS rules for `.id-view-toggle .btn-sm`, `.btn-primary` (accent background, white text), and `.btn-secondary` (dark background, muted text with hover state).
- **Files:** `frontend/src/components/inventory/analytics/AnalyticsDashboard.css`

### 3. "Chart Library Not Available" on Mesh Bandwidth Monitor
- **Symptom:** The bandwidth monitor on the Mesh screen displayed "chart library not available" instead of the area chart.
- **Root Cause:** `MeshView.jsx` used `require('recharts')` inside a try/catch block, which fails in Vite's ESM build pipeline.
- **Fix:** Replaced the CommonJS `require()` with a standard ES `import { AreaChart, Area, ... } from 'recharts'` at the top of the file.
- **Files:** `frontend/src/components/files/MeshView.jsx`

### 4. Files Not Appearing Without Force Full Sync
- **Symptom:** After joining a workspace, documents and folders would not appear until the user manually clicked "Force Full Sync".
- **Root Cause:** When peers are discovered via the DHT (Hyperswarm), they go through a `peer-identity` authentication handshake. After authentication, the sidecar only drained `pendingSyncRequests` — but DHT-discovered peers were never added to that map, so they received zero sync-requests after auth. Only peers from `lastKnownPeers` (explicit connect) got sync-requests.
- **Fix:** After draining `pendingSyncRequests`, the `peer-identity` handler now iterates **all** `conn.topics` (every workspace topic the peer shares) and sends a `sendSyncRequest` for each one. This ensures DHT-discovered peers trigger a full bidirectional sync.
- **Files:** `sidecar/index.js` (peer-identity handler)

### 5. Relay Bridge Infinite Reconnect Loop
- **Symptom:** When the relay server was unreachable, the relay bridge would retry forever with backoff delays that never actually increased.
- **Root Cause (counter):** The retry counter was incremented **after** `_scheduleReconnect` was called, so the counter was always 0 when backoff delay was calculated.
- **Root Cause (no cap):** There was no maximum retry limit — the bridge would retry indefinitely.
- **Root Cause (guard):** Relay connection guards checked the `relayBridge` singleton object (always truthy after initialization) instead of the `relayBridgeEnabled` flag.
- **Fix:**
  - Moved `retryAttempts.set(roomName, currentAttempt + 1)` to **before** `_scheduleReconnect()` so backoff delay increases correctly.
  - Added `BACKOFF_MAX_RETRIES = 15` constant (~8.5 hours cumulative) — after 15 failed attempts, logs a warning and stops retrying.
  - Changed relay guards in `request-peer-sync` and `autoRejoinWorkspaces` from `relayBridge` → `relayBridgeEnabled`.
- **Files:** `sidecar/relay-bridge.js`, `sidecar/index.js`

### 6. "Verifying…" Stuck Forever in Status Bar
- **Symptom:** After clicking Verify Sync, the status bar showed "Verifying…" indefinitely if no peer responded.
- **Root Cause:** `requestManifestVerification` broadcasted a manifest request but had no timeout — if no peer responded, the UI stayed in `verifying` state forever.
- **Fix (Backend):** Added a 30-second safety timeout in `requestManifestVerification`. If `pendingManifestVerifications` still contains the workspace after 30s, it broadcasts `'failed'` with `{ reason: 'timeout' }`.
- **Fix (Frontend):** Added a `useEffect` in `useWorkspacePeerStatus` that watches `syncStatus`. When it enters `'verifying'`, a 30s `setTimeout` transitions to `'failed'` if no response arrives. Timer is cleaned up on status change or unmount.
- **Files:** `sidecar/index.js`, `frontend/src/hooks/useWorkspacePeerStatus.js`

---

## ✨ Feature Enhancements

### 7. Per-Stage Cumulative Inflow Chart with Item Quantities
- **Enhancement:** The In/Out Flow Chart on the Analytics dashboard now shows **per-stage cumulative lines** and **per-item quantity lines** alongside the existing gap/created/fulfilled areas.
- **Pipeline stages:** Open, Claimed, Approved, In Progress, Shipped, Delivered, Cancelled, Blocked, Returned — each with a dashed line matching the PipelineFunnel color scheme.
- **Per-item lines:** Each unique catalog item gets its own dashed line (up to 10 colors) showing cumulative quantity over time.
- **Interactive legend:** Click any legend entry to toggle its line on/off (strikethrough styling on hidden entries).
- **Chart upgraded:** From `LineChart` to `ComposedChart` with `Area` + `Line` components, height increased from 300 → 380px.
- **New prop:** `catalogItems` passed from `AnalyticsDashboard` to `InOutflowChart`.
- **Files:** `frontend/src/components/inventory/analytics/InOutflowChart.jsx`, `frontend/src/components/inventory/analytics/AnalyticsDashboard.jsx`

### 8. Unified StatusBar SyncChip with Network Popover
- **Enhancement:** Replaced **4 separate StatusBar indicators** (Tor toggle button, connection status div, sync verification button, and their individual popovers) with a **single unified SyncChip**.
- **SyncChip displays:** Status dot + label + sync badge (✓/⚠/⟳) + relay indicator (📡) + Tor indicator (🧅) + dropdown arrow.
- **Network Popover (on click):** Expandable panel with:
  - **Connection details:** Status, Public IP, Peers, Relay, Mesh
  - **Sync verification:** Status, Documents, Folders, Missing items, Last verified
  - **Tor toggle:** ON/OFF pill with "Connect/Disconnect from Tor" + "Tor Settings…" link (moved inside popover)
  - **Actions:** Relay Settings, Retry Connection, Verify Sync, Force Full Sync
- **Accessibility:** `data-testid="sync-status"`, `role="status"`, `aria-live="polite"`, `aria-label` with connection state.
- **CSS:** ~200 new lines for `.sync-chip`, `.network-popover`, `.tor-status-pill`, and all status-dependent color modifiers.
- **Files:** `frontend/src/components/StatusBar.jsx`, `frontend/src/components/StatusBar.css`

---

## 🔧 Performance & Quality Improvements

### syncMembers Debounce
- **Problem:** Yjs awareness heartbeat writes triggered 500+/sec React state updates via `yMembers.observe()`.
- **Fix:** Wrapped the `syncMembers` observer callback in a 100ms debounce (`setTimeout` with `clearTimeout`). Timer cleaned up in effect cleanup function.
- **Files:** `frontend/src/hooks/useWorkspaceSync.js`

### Crypto Log Level Downgrade
- **Problem:** Every successful decrypt logged `console.log`, filling the log buffer in high-throughput scenarios.
- **Fix:** Changed to `console.debug` so messages only appear when DevTools verbose logging is enabled.
- **Files:** `sidecar/crypto.js`

### Awareness Broadcast Deduplication
- **Problem:** The second `peer-joined` handler in `setupPeerPersistence` broadcast full awareness state on a 500ms timer, duplicating the awareness already sent by `handleSyncStateRequest`.
- **Fix:** Simplified the second handler to only call `updateWorkspacePeers`. Comment documents that awareness is handled by the sync-state-request flow.
- **Files:** `sidecar/index.js`

### Fallback Yjs Update Validation
- **Problem:** Malformed P2P messages (< 2 bytes) caused `Y.applyUpdate` to throw "Integer out of Range" errors.
- **Fix:** Added `updateData.length < 2` guard before `Y.applyUpdate`. Changed `console.error` → `console.warn` for apply failures (graceful degradation).
- **Files:** `sidecar/index.js`

---

## 🏗️ Infrastructure

### Relay URL Migration
- All relay URLs migrated from `night-jar.io` → `night-jar.co` and `nightjar.io` → `nightjar.co` across sidecar, mesh-constants, server Dockerfile, unified server, and tests.
- **Files:** `sidecar/mesh-constants.js`, `sidecar/index.js`, `server/unified/index.js`, `server/unified/Dockerfile`

### Build Script Improvements
- Package scripts now include `clean:release` step that removes `release/win-unpacked` before builds, preventing stale files from causing build failures.
- **Files:** `package.json`

### Relay Bridge IPC Handlers
- Added 4 new IPC message handlers for relay bridge management: `relay-bridge:enable`, `relay-bridge:disable`, `relay-bridge:status`, `relay-bridge:getConfig`.
- Enable handler connects all active workspace docs through the relay; disable handler disconnects all relay connections.
- **Files:** `sidecar/index.js`

---

## 🧪 Testing

### New Test File
- **`tests/bugfix-v1.8.1.test.jsx`** — 56 tests across 16 describe blocks covering every change in this release:
  - Vite loadEnv PAT injection (2 tests)
  - MeshView ES import (2 tests)
  - Pie chart button CSS (2 tests)
  - InOutflowChart stages/items/legend (7 tests)
  - StatusBar SyncChip + popover (24 tests)
  - Peer-identity sync-request (1 test)
  - Relay guards (2 tests)
  - Relay backoff max retries (3 tests)
  - Fallback Yjs validation (1 test)
  - Verification timeout (2 tests)
  - Frontend verifying timeout (1 test)
  - syncMembers debounce (1 test)
  - Crypto debug log (1 test)
  - Awareness dedup (1 test)
  - StatusBar CSS classes (4 tests)
  - AnalyticsDashboard catalogItems prop (2 tests)

### Updated Test Files
- `tests/bugfix-v1.8.0.test.jsx` — Updated relay URL assertions (`.io` → `.co`)
- `tests/additional-components.test.js` — Updated share link URLs
- `tests/bug-report-modal.test.jsx` — Added PAT env var setup in `beforeEach`
- `tests/components/Settings/TorSettings.test.js` — Updated relay placeholder URL
- `tests/components/inventory/common.test.jsx` — Updated close button test (SlidePanel now provides it)
- `tests/components/inventory/producer.test.jsx` — Updated AddressReveal tests with `request` prop
- `tests/integration/cross-platform-sharing.test.js` — Updated server URLs
- `tests/presence-awareness.test.js` — Updated to test sync-state-request awareness flow
- `tests/producer-shipping-workflow.test.jsx` — Major update: stage bar hidden for producers, AddressReveal stage buttons, header removal
- `tests/relay-server-infrastructure.test.js` — Updated all relay URLs
- `tests/request-detail-stage-bar.test.jsx` — Updated: stage bar hidden for producers, AddressReveal handles transitions
- `tests/shipping-address-cleanup.test.jsx` — Updated: status requirements for mark shipped, round 2 additions

### Test Suite Results
- **132 suites** (up from 131)
- **3,876 tests passed** (up from 3,809 — 67 new tests)
- **0 failures**
- **6 skipped** (pre-existing)

---

## 📁 Files Changed

| Category | Files |
|----------|-------|
| **Build** | `vite.config.js`, `package.json` |
| **Frontend Components** | `StatusBar.jsx`, `StatusBar.css`, `MeshView.jsx`, `InOutflowChart.jsx`, `AnalyticsDashboard.jsx`, `AnalyticsDashboard.css` |
| **Frontend Hooks** | `useWorkspacePeerStatus.js`, `useWorkspaceSync.js` |
| **Sidecar** | `index.js`, `relay-bridge.js`, `crypto.js`, `mesh-constants.js` |
| **Server** | `unified/index.js`, `unified/Dockerfile` |
| **Tests (new)** | `bugfix-v1.8.1.test.jsx` |
| **Tests (updated)** | 12 existing test files |

**Total: 13 source files modified, 1 new test file, 12 test files updated**
