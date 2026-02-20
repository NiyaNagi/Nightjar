# Release Notes — v1.7.5

**Nightjar v1.7.5** is a cumulative release covering one week of intensive development
(v1.7.0 → v1.7.5). Highlights include scoped Curve25519 encryption keys for the
inventory subsystem, a complete file storage dashboard with P2P file transfer,
three new analytics components, relay infrastructure hardening, and a full git
history sanitization.

---

## 🔐 Security

### Curve25519 Scoped Encryption Keys *(v1.7.4)*
- Inventory subsystem now receives a **Curve25519 encryption-only key** pre-derived
  from the Ed25519 identity via `ed2curve`, instead of the full signing key.
- The signing-capable private key **never leaves the identity layer** — inventory
  components can encrypt/decrypt shipping addresses but cannot sign messages or
  impersonate the user.
- All 7 inventory components and 8 test files updated from `privateKey` →
  `curveSecretKey`.

### Address Reveal Pipeline Fix *(v1.7.4)*
- Fixed a critical bug where `publicIdentity` was missing crypto keys, causing
  all address encryption/decryption to silently no-op. Producers can now see
  shipping addresses after admin approval.
- Root cause: `publicIdentity` was stripped to public fields only — the new
  `inventoryIdentity` object extends it with `curveSecretKey`.

### Git History Sanitization *(v1.7.5)*
- Rewrote all **147 commits** — author, committer, and commit messages scrubbed
  of previous identity references using `git-filter-repo` v2.47.0.
- Zero traces of prior identity remain in any commit metadata.

---

## ✨ Features

### Inventory Analytics — 3 New Components *(v1.7.5)*
- **ProducerResponseTime** — horizontal bar chart showing per-producer average
  claim, start, and shipping times (hours). Helps admins identify slow producers.
- **StatusTransitions** — request-outcome summary with delivery-rate percentage,
  in-flight / delivered / cancelled / blocked counts, and average time-per-stage
  breakdown. Pure HTML/CSS visualization (no chart library dependency).
- **UnitsShippedByType** — stacked bar chart of units shipped per time bucket
  (day/week/month), broken down by catalog item, with grand total summary.
- The analytics suite now totals **15 components**: AnalyticsDashboard,
  BlockedAging, FulfillmentHistogram, InOutflowChart, ItemDemand, PipelineFunnel,
  PivotTable, ProducerLeaderboard, ProducerResponseTime, StatusTransitions,
  SummaryMetrics, UnitsShippedByType, USHeatmap, plus date range and export controls.

### PermissionWatcher & Factory Reset Safety *(v1.7.3)*
- **PermissionWatcher** component auto-syncs ownership transfers from Yjs to
  local workspace state with toast notifications.
- Factory reset now warns when you are the **sole owner** of workspaces and
  requires typing "DELETE WORKSPACES" to confirm.

---

## 📂 File Storage & P2P Transfer *(v1.7.0)*

- Complete **file storage dashboard** with 30+ components: BrowseView, MeshView,
  RecentView, FavoritesView, StorageView, TrashView, DownloadsView, AuditLogView.
- **P2P file transfer** end-to-end implementation — was previously a TODO stub.
  Includes chunk seeding, bandwidth sampling, and progress tracking.
- Bulk operations: multi-select, tag, move, delete across files and folders.
- File context menus, detail panels, upload zones, download bars.
- Search with filters, view mode toggle (grid/list), breadcrumb navigation.

---

## 🏗️ Infrastructure

### Relay & Networking Hardening *(v1.7.3)*
- **Tor SOCKS proxy** support for relay WebSocket connections.
- **P2P bridge suspend/resume** — tears down Hyperswarm UDP when Tor is active
  (relay-only mode) to prevent IP leakage.
- **Relay bridge graceful fallback** — logs warning and schedules background retry
  instead of crashing sync on relay disconnect.
- Default `BOOTSTRAP_NODES` now includes `wss://relay.night-jar.io`.

### Server Hardening *(v1.7.3)*
- Signaling server: peer cleanup on disconnect, room ID validation, `maxPayload`
  limits, CORS headers, graceful shutdown.
- Nginx + Docker Compose updates for unified server deployment.

### Y.Map Migration *(v1.7.3)*
- Folder and file-storage tests migrated from `Y.Array` to `Y.Map` for
  consistent CRDT data modeling.

### Server Relay Handlers *(v1.7.0)*
- `relay-message` and `relay-broadcast` handlers for cross-network delivery.
- Sidecar chunk message routing via `direct-message` event.

---

## 🐛 Bug Fixes

- **Presence one-way display** *(v1.7.0)* — fixed `publicKey` race condition
  where presence indicators only showed in one direction.
- **Inventory shipping workflow** *(v1.7.0)* — 5 bugs fixed in
  approval/address/shipping flow.
- **Workspace metadata** *(v1.7.3)* — `getMap('info')` → `getMap('workspaceInfo')`
  fixes metadata never persisting via Yjs.
- **Duplicate observer guard** *(v1.7.3)* — prevents registering Yjs update
  observers more than once per workspace.
- **Sync exchange guard** *(v1.7.3)* — prevents redundant `sync-state-request`
  messages on duplicate `join-topic` events.
- **File size display** *(v1.7.0)* — chunk availability holder merging.

---

## 🧪 Testing

| Version | Suites | Tests |
|---------|--------|-------|
| v1.7.0  | 110    | 2,921 |
| v1.7.3  | 119    | 3,267 |
| v1.7.4  | 125    | 3,630 |

All suites passing with **0 failures**. Test coverage includes unit tests, component
tests, integration tests, E2E (Playwright), fuzz tests, accessibility tests, and
cross-platform P2P scenarios.

---

## 🔄 Account Migration *(v1.7.4 – v1.7.5 – v1.8.0)*

- All source references consolidated under `Niyanagi` / `niyanagi@proton.me`
  across package.json, capacitor.config.json, main.js, README, docs, and UI.
- App ID: `com.niyanagi.nightjar`.
- Full git history rewritten — all commits attributed to `Niyanagi`.

---

## 📦 Build Targets

| Platform | Artifacts |
|----------|-----------|
| **Windows** | `.exe` (NSIS installer), `.msi` |
| **macOS** | `.dmg`, `.zip` (x64 + arm64) |
| **Linux** | `.AppImage`, `.deb` |
