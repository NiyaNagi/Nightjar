# Release Notes — Nightjar v1.7.0

**Release Date:** 2026-02-17

## Summary

Major release delivering a complete File Storage UI overhaul, P2P file transfer end-to-end implementation, presence/awareness reliability fixes, inventory shipping workflow bug fixes, and server relay infrastructure for cross-network message delivery.

---

## New Features

### 📁 File Storage Dashboard Overhaul
- **Complete UI rebuild** — New modular component architecture with BrowseView, MeshView, RecentView, FavoritesView, StorageView, TrashView, DownloadsView, and AuditLogView
- **Folder management** — Create, rename, move, and delete folders with drag-and-drop support
- **File cards & detail panel** — Rich file cards with thumbnails, metadata, and a slide-out detail panel
- **Search & filtering** — Full-text search bar with advanced filters (type, date, size, tags)
- **Bulk operations** — Multi-select with bulk tag, move, and delete actions via BulkActionBar
- **Upload zone** — Drag-and-drop upload area with progress tracking (UploadZone, UploadProgress)
- **Download management** — DownloadsBar and DownloadsView for tracking active/completed downloads
- **Context menus** — Right-click context menu for file operations (FileContextMenu)
- **View modes** — Toggle between grid and list views (ViewModeToggle)
- **Breadcrumb navigation** — Visual path breadcrumbs for folder hierarchy
- **File picker modal** — Reusable file selection dialog (FilePickerModal)
- **Distribution badges** — Visual indicators for file distribution status across peers
- **Settings panel** — File storage configuration (FileStorageSettings)

### 💬 Chat Button Component
- **Floating chat button** — New ChatButton component with unread badge for quick access to workspace chat

### 📦 Inventory Slide Panel
- **SlidePanel component** — New reusable slide-out panel for inventory request details

---

## Bug Fixes

### 🔴 Critical: P2P File Transfer — End-to-End Implementation
- **Root Cause:** P2P chunk transfer was never fully implemented — `requestChunkFromPeer` was a TODO stub that only checked local IndexedDB
- **Fix:** Complete FileTransferContext with real P2P chunk request/response flow, chunk seeding, and download reassembly

### 🔴 Critical: Server Relay — Messages Silently Dropped
- **Root Cause:** The unified server's message handler had no generic relay — the `default` case returned `{ type: 'error', error: 'unknown_type' }`, silently dropping chunk-request/response messages between peers on different networks
- **Fix:** Added `relay-message` and `relay-broadcast` handlers to the server, and updated WebSocketTransport to wrap outbound messages in relay envelopes

### 🔴 Critical: Sidecar Chunk Message Routing
- **Root Cause:** HyperswarmManager's `_handleData` switch/case only handled sync/awareness/peer-list messages. Chunk messages fell through the default case which emitted a `message` event, but P2PBridge never subscribed to it
- **Fix:** Default case now emits `direct-message` event, and P2PBridge subscribes to forward chunk messages to all frontend WebSocket clients

### 🔴 Critical: Presence Indicators — One-Way Display
- **Root Cause:** `syncOnlineFromAwareness` in useWorkspaceSync hard-skipped any peer without `publicKey` in their awareness state. When Client B joins, their identity loads asynchronously — initial awareness goes out with `publicKey: null`, so Client A skips them entirely
- **Fix:** Removed the hard-skip. Peers without `publicKey` now use `client-${clientId}` as a fallback deduplication key, still show presence pips, and still increment the online count. Member map updates are guarded to only run when `publicKey` is available

### 🟡 Inventory: Producer Shipping Workflow (5 Bugs)
1. **getAddress called with wrong arguments** — ApprovalQueue passed arguments in wrong order to address store
2. **Pending addresses from non-owner requestors never decrypted** — Fallback to `yPendingAddresses` when local address not found
3. **inventorySystemId missing from address reveal objects** — Reveals now include `inventorySystemId` so useInventorySync filter works
4. **"Mark as Shipped" only shown for approved, not in_progress** — Status visibility now includes both `approved` and `in_progress`
5. **MyRequests onMarkShipped handler dropping tracking number** — Handler now correctly passes tracking number through

### 🟡 File Storage: Size Display
- **Root Cause:** `file.size` vs `file.sizeBytes` field mismatch caused 0-byte display in Mesh view
- **Fix:** Normalized to use `sizeBytes` consistently

### 🟡 Chunk Availability: Holder Merging
- **Root Cause:** `setChunkAvailability` was overwriting the holders array instead of merging
- **Fix:** Now merges holders correctly, preserving existing entries

---

## Infrastructure

### Server (server/unified/index.js)
- Added `relay-message` handler for targeted peer-to-peer message relay
- Added `relay-broadcast` handler for workspace-wide message broadcast

### WebSocket Transport
- `send()` now wraps messages in `relay-message` envelope for server relay
- `broadcast()` now wraps messages in `relay-broadcast` envelope

### Sidecar
- HyperswarmManager default case emits `direct-message` (was `message`)
- P2PBridge subscribes to `direct-message` and forwards via `_broadcastToAllClients`
- Awareness polling interval reduced to 500ms for faster presence detection
- Initial awareness broadcast on listener attachment (catches pre-set states)
- Awareness push on `peer-joined` with 500ms delay

---

## Testing

- **110 test suites, 2,921 tests** (0 failures, 6 skipped)
- **New test files:**
  - `tests/presence-awareness.test.js` — Awareness bridging, heartbeat, E2E presence scenarios
  - `tests/producer-shipping-workflow.test.jsx` — Full producer shipping workflow coverage
  - `tests/file-transfer.test.js` — FileTransferContext unit and integration tests
  - `tests/file-storage/*.test.js` — File storage component tests
  - `tests/sidecar/chunk-message-roundtrip.test.js` — Full chunk message round-trip validation
  - `tests/sidecar/hyperswarm-message-routing.test.js` — Message routing through HyperswarmManager
  - `tests/sidecar/p2p-bridge-direct-message.test.js` — P2PBridge direct-message forwarding
  - `tests/chat-and-names.test.js` — Chat and display name tests
  - `tests/inventory-workflow-audit*.test.js` — Inventory workflow audit iterations

---

## Files Changed

- **80+ modified files** across frontend components, contexts, hooks, utilities, sidecar, server, and tests
- **60+ new files** including complete file storage UI component library, new test suites, and utility modules
