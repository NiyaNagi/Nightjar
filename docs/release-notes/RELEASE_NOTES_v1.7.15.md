# Release Notes — v1.7.15

**Release Date:** February 20, 2026

This release fixes **GitHub Issue #4** — spreadsheet cell edits not syncing across clients. The root cause was a combination of three compounding bugs in the Sheet component's Yjs sync layer: ops stored via last-writer-wins `Y.Map.set()` silently lost concurrent edits, remote data arrived in sparse `celldata` format that Fortune Sheet couldn't render post-initialization, and the remote-update protection window queued stale snapshots instead of capturing live workbook state. All three are resolved with a targeted short-term fix.

---

## 🐛 Bug Fixes

### Spreadsheet Sync — Critical (Issue #4)

**Problem:** When two clients edited different cells in the same spreadsheet, edits from one client would not appear on the other. Text document sync (TipTap) worked fine, but spreadsheet sync was silently broken.

**Root Cause — Three Compounding Bugs:**

| Bug | Description | Impact |
|-----|-------------|--------|
| **Last-writer-wins ops** | `pendingOps` stored as a plain JSON value on `Y.Map` — concurrent `set()` calls from different clients would overwrite each other | Remote ops silently lost |
| **Missing celldata→data conversion** | Remote data arrived as sparse `celldata` format, but Fortune Sheet needs the 2D `data` array after initial mount | Remote cells appeared blank ("non-empty cells: 0") |
| **Stale protection-window queue** | 350ms protection window stored a snapshot of `newData` at queue time, not the live workbook state at replay time | Local edits during the window could be silently dropped |

**Fix:**

| Change | Description |
|--------|-------------|
| **Y.Array migration** | Replaced `ysheet.set('pendingOps', [...existing, newOp])` with `ydoc.getArray('sheet-ops').push([op])`. Y.Array uses CRDT-ordered append — concurrent pushes from different clients are all preserved. Clearing uses `yOps.delete(0, yOps.length)` which only removes items that existed at delete-time, not concurrent inserts. |
| **`convertCelldataToData` helper** | New function that builds a 2D data array from sparse `celldata` entries before passing to `setData()`. Detects sheets missing their `data` key and fills a `rows × cols` grid with cell values from `celldata`. |
| **Op-path short-circuit** | When `applyOp()` successfully processes remote ops via the Y.Array observer, the full-sheet `setData` path is skipped for that cycle, preventing double-application and flicker. |
| **Dirty-flag protection window** | Replaced `queuedLocalSaveRef` (stale snapshot) with a boolean `dirtyDuringProtection` flag. When the 350ms window closes, if dirty, the latest live state from `workbookRef.current.getAllSheets()` is saved — no stale data. |
| **Legacy cleanup** | On initialization, any existing `pendingOps` key on the `Y.Map` is deleted to prevent interference with the new `Y.Array` approach. |

---

## 🧪 Testing

### New Test File: `tests/sheet-sync-fix.test.js`

| Test Suite | Tests | Description |
|-----------|-------|-------------|
| celldata ↔ data conversion | 6 | Builds 2D array from sparse celldata, handles empty/OOB/default-size, round-trip preservation |
| Y.Array-based ops sync | 4 | Cross-doc propagation, concurrent append preservation, delete-vs-push race, no Y.Map usage |
| Full-sheet sync with celldata conversion | 3 | Remote celldata renders correctly, two-client edit propagation, three-way sync |
| Legacy pendingOps cleanup | 1 | Old Y.Map key detected and removed |
| Y.Array observer event structure | 2 | Event.changes.added structure, delete+push in same transaction |
| Rapid edits stress test | 2 | 40 concurrent ops from 2 clients, 100-cell full-sheet round-trip |

### Test Results

| Metric | Value |
|--------|-------|
| New tests added | 18 |
| Existing sheet tests | 15 |
| Total sheet tests | 33 |
| All passing | ✅ |

---

## 🔧 Technical Details

### Modified Files

| File | Changes |
|------|---------|
| `frontend/src/components/Sheet.jsx` | Migrated pendingOps to Y.Array, added `convertCelldataToData`, op-path short-circuit, dirty-flag protection window, legacy cleanup |
| `tests/sheet.test.js` | Updated onOp test to verify Y.Array usage |
| `tests/sheet-sync-fix.test.js` | **New** — 18 comprehensive sync tests |
| `package.json` | Version bump 1.7.14 → 1.7.15 |
| `README.md` | Changelog entry for v1.7.15 |
| `docs/release-notes/RELEASE_NOTES_v1.7.15.md` | This file |

### Architecture Note

This is a **short-term targeted fix**. The code still contains a TODO for the long-term architectural fix:

```
// TODO: Migrate to cell-level CRDT (Yjs Y.Map per cell) to eliminate
// the JSON-blob full-sheet replacement strategy.
```

The full cell-level CRDT migration would give true conflict-free merging at cell granularity and eliminate the need for the remote-update protection window entirely. That remains a future effort.

---

## 📊 Statistics

| Metric | Value |
|--------|-------|
| Files changed | 6 |
| New test file | 1 |
| Tests added | 18 |
| Tests passing | 33 (sheet) |
| GitHub Issue resolved | #4 |

---

## 📋 Cumulative Feature Summary (v1.5 → v1.7.15)

| Version | Highlights |
|---------|------------|
| v1.5.0 | Analytics, history sanitization, account migration |
| v1.6.1 | Performance, stability |
| v1.7.0 | Kanban boards, file storage, inventory system |
| v1.7.3 | Ownership transfer, relay infrastructure, Y.Map migration |
| v1.7.4 | Curve25519 scoped keys, address reveal fix |
| v1.7.5 | Analytics charts, history sanitization |
| v1.7.7 | README feature audit, documentation |
| v1.7.8 | Sync root cause fix, unified StatusBar |
| v1.7.9 | 30-iteration security audit (165+ fixes) |
| v1.7.10 | Regression fixes (bug report API, changelog slider) |
| v1.7.11 | Clickable share links, encrypted persistence, landing page |
| v1.7.12 | UI telemetry, bug report submission |
| v1.7.13 | Security hardening, UnifiedPicker, responsive breakpoints |
| v1.7.14 | Mobile UX optimizations, PWA, card view |
| **v1.7.15** | **Spreadsheet sync fix — Y.Array ops, celldata conversion, protection window hardening** |

---

## 🚀 Upgrade Notes

- **Breaking:** Existing Yjs documents with the old `pendingOps` key on `Y.Map('sheet-data')` will have that key automatically deleted on first load. This is a one-way migration — clients on v1.7.14 or earlier will not be able to process ops sent by v1.7.15 clients.
- **No UI changes:** This release is entirely a sync-layer fix. No visual changes to the spreadsheet interface.
- **Recommended:** All clients in a workspace should upgrade to v1.7.15 simultaneously to ensure consistent op handling.

---

## 📦 Build Targets

| Platform | Formats |
|----------|---------|
| Windows | `.exe` (NSIS installer) |
| macOS | `.dmg`, `.zip` (x64 + arm64) |
| Linux | `.AppImage`, `.deb` |
