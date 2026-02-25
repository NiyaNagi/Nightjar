# Nightjar v1.8.15 Release Notes

**Release Date:** July 2025

This release fixes two bugs reported in **Issue #22**: spreadsheet cells not syncing between mobile web and Windows desktop, and the sidebar's bottom action buttons being hidden behind the mobile bottom nav bar. It also includes a P2P auth guard (Issue #23) that prevents a bogus auth token from permanently blocking the relay room when a workspace key loads asynchronously.

---

## 🐛 Bug 1: Spreadsheet cell updates did not sync cross-platform (Issue #22)

### Root cause

The previous sync mechanism stored the entire spreadsheet as a single JSON blob in `ydoc.getMap('sheet-data').set('sheets', blob)` — a last-writer-wins strategy. Echo detection relied on a composite version string (`clientID-timestamp`) compared against `lastSavedVersion.current` and `lastLoadedVersion.current`. The guard had a critical flaw:

```
isNewRemoteUpdate = lastLoadedVersion.current !== null && storedVersion !== lastLoadedVersion.current
```

After a provider sync the very first call to `updateFromYjs` that matched `lastSavedVersion` (our own echo) was correctly skipped — but it also left `lastLoadedVersion.current === null`. When the next genuine remote update arrived from a different peer, `lastLoadedVersion.current` was still `null`, so `isNewRemoteUpdate` evaluated to `false`, the protection window was never activated, and FortuneSheet's `onChange` fired and saved the old local data back to Yjs — overwriting the remote cells.

### Fix

Replaced the entire blob-based sync strategy with a **cell-level CRDT**:

| Before | After |
|--------|-------|
| `ydoc.getMap('sheet-data')` → one JSON blob per save | `ydoc.getMap('sheet-cells')` → one entry per cell (`sheetId:r:c`) |
| `ydoc.getMap('sheet-data').set('version', …)` | `ydoc.getMap('sheet-meta')` → one metadata entry per sheet |
| `observeDeep` + version-string comparison | `observe` + `event.transaction.origin === SHEET_SYNC_ORIGIN` |
| 350 ms protection window to suppress echo saves | **No protection window** — diff returns 0 changes on echo, exits immediately |

Key components:
- **`SHEET_SYNC_ORIGIN = 'nightjar-sheet-save'`** — Yjs transaction origin tag. All saves by this client are tagged; the observer skips any event whose `transaction.origin` matches the tag.
- **`buildSheetsFromYMap(ycells, ymeta)`** — reconstructs Fortune Sheet data array from the Y.Maps. Called on init, on provider sync, and on every remote change.
- **`saveToYjs` (diff-based)** — computes only cells that differ from the current Y.Map state; skips the transact call entirely when the diff is empty. This eliminates the echo-overwrite race: when FortuneSheet fires `onChange` after `setData()` applies remote data, the diff is zero → no write → no echo.
- **Legacy migration** — on first open, if `sheet-cells` is empty but `sheet-data` contains an old blob, the data is silently migrated to cell-level entries.

### 4-way sync matrix

All four scenarios now work correctly with Yjs's transport-agnostic CRDT:

| Direction | Mechanism |
|-----------|-----------|
| Web → Web | WebSocket relay → `ycells.observe` fires on peer, origin ≠ SHEET_SYNC_ORIGIN → `buildSheetsFromYMap` → `setData` |
| Web → Electron | Same relay path |
| Electron → Web | Sidecar writes Yjs doc → relay → web peer observes |
| Electron → Electron | Hyperswarm P2P or relay — Yjs handles transport-agnostically |

---

## 🐛 Bug 2: Sidebar action buttons hidden behind bottom nav bar on mobile (Issue #22)

The mobile sidebar (`position: fixed; height: 100dvh`) only added notch safe-area inset to its bottom padding — it did not account for the 56 px bottom navigation bar. The Share / Join / New / Folder buttons at the bottom were hidden behind the nav bar.

**Fix:** One-line CSS change in `HierarchicalSidebar.css`:

```css
/* Before */
padding-bottom: env(safe-area-inset-bottom, 0px);

/* After */
padding-bottom: calc(var(--bottom-nav-height, 0px) + env(safe-area-inset-bottom, 0px));
```

`--bottom-nav-height` is `56px` on mobile (`max-width: 768px`) and `0px` on desktop, so desktop layout is unchanged.

---

## 🐛 Bug 3: P2P auth token poisoning when workspace key loads async (Issue #23)

When a shared workspace is opened on page reload, `FileTransferContext` may render before the keychain is restored (async). The old code fell through to a `sessionKey` (a random per-browser key) and computed an HMAC room-auth token from it. The relay server's first-write-wins auth model permanently rejected the correct token that arrived once the keychain loaded.

**Fix:** `FileTransferContext` now guards the `joinWorkspace` call — if `workspaceKey` is null, it logs "Deferring P2P join" and exits. The effect re-runs when the `workspaceKey` prop changes to the real key. `AppNew.jsx` was updated to pass `|| null` instead of `|| sessionKey` as the fallback.

---

## Test changes

- `tests/sheet.test.js` — updated 4 Yjs integration assertions from `sheet-data` blob API to `sheet-meta` / `sheet-cells` cell-level API
- `tests/file-transfer.test.js` — updated 2 assertions to reflect Issue #23 deferred-join behavior and `|| null` fallback
- `tests/p2p-auth-race-condition.test.js` — new test suite covering the auth-token deferred-join guard

All 5310 tests pass.
