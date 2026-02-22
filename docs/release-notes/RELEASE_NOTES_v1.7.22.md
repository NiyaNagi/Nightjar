# Nightjar v1.7.22 Release Notes

**Release Date:** June 2025

This release fixes the second half of **Issue #6** — Native→Web document sharing. After v1.7.21 fixed the blank-screen bug (missing nginx proxies), users reported that browser recipients could connect but saw **0 documents**. The root cause: the relay bridge defaulted to OFF and Electron share links omitted the relay URL, so browser clients had no relay to sync from.

---

## 🔗 Relay Bridge Auto-Connect (Default ON)

- **Default changed to ON** — `NIGHTJAR_RELAY_BRIDGE` now uses `!== 'false'` semantics (previously `=== 'true'`). Users no longer need to manually enable the relay bridge in App Settings for cross-platform sharing to work.
- **LevelDB persistence** — The relay bridge preference is persisted to the sidecar metadata LevelDB store (key: `setting:relayBridgeEnabled`). The preference survives app restarts — no need to re-enable each session.
- **Startup restore** — On sidecar startup, the persisted preference is loaded from LevelDB before P2P initialization. If enabled (or no preference saved), the relay bridge connects all existing docs automatically.
- **`connectAllDocsToRelay()` helper** — A dedicated function iterates all Yjs docs in the sidecar's Map and connects `workspace-meta:` and `doc-` rooms to the relay bridge. Called on enable, startup restore, and new doc creation.

---

## 📄 Proactive Document Creation

- **`getOrCreateYDoc` in `autoRejoinWorkspaces`** — Previously used `docs.get(roomName)` which returned `undefined` for docs not yet in the Map. Now uses `getOrCreateYDoc(roomName)` which creates the Yjs doc if it doesn't exist, ensuring workspace-meta docs are ready before the relay bridge connects them.
- **`doc-added` event handler** — New docs created after the relay bridge is already active are automatically connected to the relay via the existing `doc-added` event.

---

## 🖥️ Electron Share Links Include Relay URL

- **`srv:wss://night-jar.co`** — Electron share links now include the public relay URL in the `srv:` parameter. Browser recipients parse this parameter and connect to the relay for document sync. Previously, Electron share links omitted `srv:` entirely, so browser clients had no relay URL and saw 0 documents.

---

## 🌐 Frontend Startup Sync

- **`WorkspaceContext` relay bridge sync** — On WebSocket connect (after `list-workspaces`), the frontend reads `localStorage.getItem('Nightjar_relay_bridge_enabled')` and sends `relay-bridge:enable` to the sidecar if the preference is not explicitly `'false'`. This provides belt-and-suspenders activation alongside the sidecar's own startup restore.
- **`AppSettings` default changed** — The relay bridge toggle `useState` initializer now uses `!== 'false'` (default ON) instead of `=== 'true'` (opt-in).

---

## 🐳 Docker Configuration Fix

- **Relay reverted to `NIGHTJAR_MODE=relay`** — The public relay service (`wss://night-jar.co`) was incorrectly changed to `NIGHTJAR_MODE=host` with `ENCRYPTED_PERSISTENCE=true` in v1.7.21. This has been reverted. The relay is a **pure relay/signaling server** with NO persistence and NO data storage.
- **Data volume removed** — The `nightjar-relay-data` volume was removed from both the relay service and top-level volumes section. Only `nightjar-private-data` remains (for the private instance).

---

## 🧪 Testing

### New Test File: `tests/relay-bridge-auto-connect.test.js` (56 tests)

| Describe Block | Tests | Coverage |
|---------------|-------|----------|
| sidecar: relay bridge default ON | 3 | Default semantics, Tor-disable path |
| sidecar: relay bridge LevelDB persistence | 7 | save/load functions, key name, handlers, startup restore, Tor path |
| sidecar: connectAllDocsToRelay helper | 4 | Function exists, workspace-meta rooms, doc rooms, enable handler |
| sidecar: proactive workspace-meta doc creation | 2 | getOrCreateYDoc usage, relay connection |
| frontend: startup relay bridge sync | 4 | enable message, localStorage check, ordering, custom URL |
| frontend: AppSettings relay bridge default ON | 2 | useState initializer |
| frontend: Electron share links include server URL | 4 | serverUrl assignment, isElectron branch, both link generators |
| docker-compose.prod: relay is pure relay | 7 | Mode, no host mode, no persistence, no volume, private preserved |
| nginx: relay SPA asset + API routing | 3 | v1.7.21 regression check |
| server: encrypted-persistence endpoint | 1 | Regression check |
| relay-bridge: module integrity | 5 | Exports, imports, bootstrap nodes, connect, disconnectAll |
| E2E: Native→Web sharing scenario | 7 | Full scenario requirements |
| E2E: Web→Web sharing scenario | 2 | Browser auto-detect, share link URL |
| sidecar: doc-added event auto-connects | 2 | Event handler, relay connect call |
| client: key delivery retry logic | 2 | v1.7.20 regression check |

### Updated: `tests/share-link-routing-fix.test.js` (22 tests)
- Docker test section updated: assertions now verify `NIGHTJAR_MODE=relay`, absence of `ENCRYPTED_PERSISTENCE`, and absence of `nightjar-relay-data` volume.

---

## 📚 Documentation Updates

- **`docs/architecture/RELAY_ARCHITECTURE.md`** — New "Relay Bridge (v1.7.22+)" section covering default behavior, LevelDB persistence, startup restore, proactive doc creation, `connectAllDocsToRelay`, and Electron share links.
- **`docs/architecture/SYNC_ARCHITECTURE.md`** — New "Relay Bridge Auto-Connect (v1.7.22+)" section describing the startup sequence, persistence, and cross-platform sync flow.
- **`docs/security/SECURITY_HARDENING.md`** — New "Fix 8: Relay Bridge Preference Persistence & Auto-Connect" with threat model, security implications, and files changed. Test coverage table updated.
- **`frontend/public-site/content/security-model.json`** — Updated "Threats You ARE Protected Against" to note relay bridge default-ON behavior.
- **`README.md`** — v1.7.22 changelog entry added; v1.7.21 entry corrected (removed incorrect "encrypted persistence upgrade" claim).

---

## Files Changed

| File | Change |
|------|--------|
| `sidecar/index.js` | Default ON, LevelDB persistence, connectAllDocsToRelay, proactive getOrCreateYDoc, startup IIFE, Tor-disable path |
| `frontend/src/contexts/WorkspaceContext.jsx` | Startup relay bridge sync on WS connect |
| `frontend/src/components/common/AppSettings.jsx` | Default ON in useState |
| `frontend/src/components/WorkspaceSettings.jsx` | Electron share links include srv: |
| `server/deploy/docker-compose.prod.yml` | Reverted to NIGHTJAR_MODE=relay, no persistence |
| `tests/relay-bridge-auto-connect.test.js` | 56 new tests |
| `tests/share-link-routing-fix.test.js` | Updated docker assertions |
| `docs/architecture/RELAY_ARCHITECTURE.md` | Relay bridge section |
| `docs/architecture/SYNC_ARCHITECTURE.md` | Relay bridge auto-connect section |
| `docs/security/SECURITY_HARDENING.md` | Fix 8 + test table |
| `frontend/public-site/content/security-model.json` | Relay bridge notes |
| `README.md` | v1.7.22 changelog, v1.7.21 correction |
| `package.json` | Version bump 1.7.21 → 1.7.22 |
