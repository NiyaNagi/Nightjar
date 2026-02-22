# Release Notes — v1.8.7

**Release Date:** February 21, 2026

Fixes file storage downloads on the web client (Issue #17). Files previously failed to transfer between web peers because the FileTransferContext never supplied server connection parameters to the P2P layer, leaving every web client with zero connected peers for chunk exchange. This release wires the signaling server URL, HMAC auth token, and workspace encryption key through to the WebSocket relay transport so that the full web ↔ web, web ↔ native, native ↔ web, and native ↔ native transfer matrix works end-to-end.

---

## 🔗 Web P2P File Transfer Fix (Issue #17)

### Root Causes Identified

| # | Root Cause | Impact |
|---|-----------|--------|
| 1 | `FileTransferContext` called `joinWorkspace(workspaceId)` with **no connection parameters** | WebSocket relay never connected — zero peers for chunk exchange on web |
| 2 | No `getSignalingServerUrl()` utility existed | Web clients had no way to derive the signaling `/signal` WebSocket URL |
| 3 | Server relay message size limit was 64 KB | 1 MB chunks → ~1.37 MB base64 payloads were silently dropped |
| 4 | `WebSocketTransport.connected` flag was never set during `connectToServer()` | Transport appeared disconnected even after successful WebSocket open |

### Fixes Applied

| Fix | File | Description |
|-----|------|-------------|
| 1 | `frontend/src/utils/websocket.js` | Added `getSignalingServerUrl()` — derives `/signal` URL for web (from `window.location`), cross-platform (from `workspaceServerUrl`), or returns `null` for Electron local mode |
| 2 | `frontend/src/contexts/FileTransferContext.jsx` | Accepts `serverUrl` and `workspaceKey` props; computes HMAC auth token via `computeRoomAuthToken()`; passes `{serverUrl, authToken, workspaceKey}` to `peerManager.joinWorkspace()` |
| 3 | `frontend/src/AppNew.jsx` | Wires `serverUrl={getSignalingServerUrl(workspaceServerUrl)}` and `workspaceKey={sessionKey}` to `FileTransferProvider` |
| 4 | `server/unified/index.js` | Raised `MAX_RELAY_MESSAGE_SIZE` and `MAX_RELAY_BROADCAST_SIZE` from 64 KB → 2 MB; raised `wssSignaling.maxPayload` from 1 MB → 2 MB |
| 5 | `frontend/src/services/p2p/transports/WebSocketTransport.js` | Set `this.connected = true` in `connectToServer` on successful WebSocket open |

### Transport Matrix

| Scenario | Primary Path | Fallback |
|----------|-------------|----------|
| Web ↔ Web | WebSocket relay → WebRTC data channel | Relay-only |
| Web ↔ Native | WebSocket relay → WebRTC data channel | Relay-only |
| Native ↔ Web | WebSocket relay → WebRTC data channel | Relay-only |
| Native ↔ Native | Hyperswarm (DHT) | WebSocket relay → WebRTC |

### Reconnect Logic
- If the server URL becomes available after initial mount (e.g., async workspace load), `FileTransferContext` detects this and automatically re-joins the workspace with full connection parameters — no manual refresh needed.

---

## 🧪 Tests

### New Test Section: § 12 — Issue #17 Web P2P Connectivity Fix (22 tests)

| Test Category | Tests | Description |
|---------------|-------|-------------|
| ConnectionParams passing | 4 | Verifies `joinWorkspace` receives `serverUrl`, `authToken`, `workspaceKey` for web, null for Electron, null key handling |
| `getSignalingServerUrl` | 1 | Source-level verification of URL derivation logic (web, Electron, cross-platform) |
| AppNew wiring | 1 | Confirms `FileTransferProvider` receives `serverUrl` and `workspaceKey` props |
| FileTransferContext imports | 2 | Verifies `generateTopic` and `computeRoomAuthToken` imports and prop declarations |
| Server relay limits | 3 | Source-level verification of 2 MB limits for relay-message, relay-broadcast, and signaling maxPayload |
| WebSocketTransport flag | 1 | Verifies `connected = true` in `connectToServer` onopen handler |
| E2E chunk flow | 1 | Tests chunk request targeting with connected peers |
| Bootstrap flow | 2 | Verifies `BootstrapManager._seedConnections` and `PeerManager.joinWorkspace` forwarding |
| Server routing | 1 | Verifies `/signal` path routes to signaling WebSocket server |
| WebRTC signaling | 2 | Verifies PeerManager WebRTC signal forwarding and server relay |
| Transport cascade | 1 | Verifies PeerManager send priority: WebRTC → WebSocket → Hyperswarm |
| Encrypted relay | 2 | Verifies `encryptRelayPayload`/`decryptRelayPayload` in WebSocketTransport and opaque forwarding on server |
| **Total** | **22** | |

---

## 📖 Documentation

- Updated `frontend/public-site/content/networking.json` — added "File Transfer (All Platforms)" section describing chunk-based P2P transfer across the web/desktop matrix

---

## 🔧 Technical Details

### Modified Files
| File | Purpose | Changes |
|------|---------|---------|
| `frontend/src/utils/websocket.js` | WebSocket URL utilities | +39 lines — new `getSignalingServerUrl()` export |
| `frontend/src/contexts/FileTransferContext.jsx` | File transfer React context | +45/−6 lines — new props, auth token computation, reconnect logic |
| `frontend/src/AppNew.jsx` | Main app component | +4/−1 lines — import and prop wiring |
| `server/unified/index.js` | Unified WebSocket server | +10/−6 lines — 64 KB → 2 MB relay limits |
| `frontend/src/services/p2p/transports/WebSocketTransport.js` | WebSocket relay transport | +6/−1 lines — connected flag fix |
| `tests/file-transfer.test.js` | File transfer test suite | +402 lines — 22 new tests for Issue #17 |
| `frontend/public-site/content/networking.json` | Public site docs | +2 lines — file transfer section |

---

## 📊 Statistics
| Metric | Value |
|--------|-------|
| Files changed | 7 |
| Insertions | 494+ |
| Deletions | 12 |
| Test suites | 160 |
| Tests passing | 5,169 |

## 📋 Cumulative Feature Summary (v1.5 → v1.8.7)
| Version | Highlights |
|---------|------------|
| v1.5.0 | Kanban boards, spreadsheet import/export groundwork |
| v1.6.0 | Comments system, presence indicators |
| v1.7.0 | Inventory feature, workspace permissions |
| v1.8.0 | Mobile web app (PWA), hamburger menu, dvh units |
| v1.8.3 | Copy link fix, ARIA alertdialog roles |
| v1.8.4 | Critical spreadsheet sync fix (Issue #16 — data sync) |
| v1.8.5 | Presence overlay alignment + mobile keyboard fixes (Issue #16 — remaining items) |
| v1.8.6 | Mobile refinements: touch targets, iOS zoom, offline toasts, lazy images |
| **v1.8.7** | **Web P2P file transfer fix (Issue #17) — full transport matrix working** |

## 🚀 Upgrade Notes
- No breaking changes
- Backward compatible — existing workspaces and files unaffected
- Server relay limits increased from 64 KB to 2 MB — server must be redeployed for web file transfer to work
- Desktop-to-desktop transfers (Hyperswarm) are unchanged

## 📦 Build Targets
| Platform | Formats |
|----------|---------|
| Windows | `.exe` (NSIS installer) |
| macOS | `.dmg`, `.zip` (x64 + arm64) |
| Linux | `.AppImage`, `.deb` |
