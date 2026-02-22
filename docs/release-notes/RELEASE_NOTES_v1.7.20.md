# Nightjar v1.7.20 — Web App Share Link Fix (Issue #5)

**Release Date**: February 20, 2026

---

## 🎯 Summary

Fixes a critical bug where joining a workspace via share link on a **phone browser** (web app) showed an empty workspace with 0 documents, even though the data existed on the server. Desktop-to-desktop sharing was unaffected. The root cause was an Express middleware ordering bug that prevented the server from receiving encryption keys from web clients.

---

## 🐛 Bug Fixes

### Web App Key Delivery — Critical (Issue #5)
- **Problem**: Redeeming a share link on a phone browser loaded the workspace but showed no documents. The diagnostic logs showed `[ERROR] [KeyDelivery] Failed to deliver key for workspace-meta:...: Missing key` followed by `Received from peers: { documentsCount: 0 }`
- **Root Cause**: The `express.json()` body-parsing middleware in `server/unified/index.js` was registered at line 1932 — **195 lines after** the key delivery route at line 1737. In Express, middleware is order-dependent: because JSON parsing came after the route, `req.body` was always `undefined`, so the server returned `400: "Missing key"` on every web app key delivery. Without the encryption key, the server couldn't decrypt the persisted workspace data.
- **Why desktop worked**: Electron clients deliver keys through the sidecar WebSocket, bypassing the broken HTTP POST endpoint entirely.
- **Fix (server)**: Moved global `app.use(express.json())` before all POST routes. Added inline `express.json({ limit: '64kb' })` directly on the key delivery route as belt-and-suspenders. Removed the duplicate late-registered middleware. Added `Authorization` to CORS allowed headers.
- **Fix (client)**: `deliverKeyToServer()` now retries up to 3 times with exponential backoff (1s → 2s → 4s). Extracted `_deliverKeyToServerOnce()` as the single-attempt internal function.
- **Files Changed**: `server/unified/index.js`, `frontend/src/utils/websocket.js`

---

## 🧪 Tests

- **21 new tests** in `tests/key-delivery-fix.test.js`:
  - Server middleware ordering (4 tests): verifies `express.json()` is registered before the key delivery route, inline middleware present, no duplicate registration
  - Key delivery route structure (3 tests): validates `req.body` field extraction, success response
  - CORS headers (2 tests): `Authorization` and `Content-Type` allowed
  - Client retry resilience (8 tests): `maxRetries` parameter, exponential backoff, `_deliverKeyToServerOnce` exists, JSON body sent, Electron skip, retry logging
  - Sync integration (4 tests): workspace-meta and workspace-folders key delivery, web mode detection, keychain retrieval

---

## 📊 Stats

- **3 files changed**: `server/unified/index.js`, `frontend/src/utils/websocket.js`, `tests/key-delivery-fix.test.js`
- **215 insertions, 5 deletions**
- **21 new tests**, all passing
