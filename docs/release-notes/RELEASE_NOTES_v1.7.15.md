# Nightjar v1.7.15 Release Notes

**Release Date:** February 20, 2026

This release delivers three major improvements: a **critical spreadsheet sync fix** (GitHub Issue #4) that resolves cell edits not syncing across clients, a **comprehensive share link overhaul** that fixes share links not working when clicked from the web on new devices, and a **markdown editor for bug reports** with Write/Preview tabs.

---

## 📊 Spreadsheet Sync Fix — Critical (Issue #4)

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

**Architecture Note:** This is a short-term targeted fix. The long-term plan is to migrate to a cell-level CRDT (`Y.Map` per cell) to eliminate the JSON-blob full-sheet replacement strategy entirely.

---

## 📝 Markdown Editor for Bug Reports

The bug report modal's description field now includes a **Write/Preview** tab toggle with a lightweight markdown renderer:

- **`simpleMarkdown()` renderer** — Pure React implementation (no external dependencies) supporting headings (`#`–`###`), bold (`**`), italic (`*`), inline code (`` ` ``), fenced code blocks (` ``` `), unordered lists (`-`), and ordered lists (`1.`)
- **`MarkdownEditor` component** — Tabbed interface with Write (textarea) and Preview (rendered markdown) modes
- **Structured template** — Description field opens with a pre-populated template for consistent bug reports
- **Dark-themed preview** — 130+ lines of CSS for the markdown preview panel, matching the app's dark theme
- All 66 bug-report-modal tests passing

---

## 🔗 Share Link Fix — SPA-Serving `/join/*` Route

**Root Cause:** The server's `/join/*` Express route previously served a static deep-link shim HTML page (`JOIN_REDIRECT_HTML`) that attempted to redirect to `nightjar://` protocol links. On new devices without Nightjar installed (or in browsers that block custom protocol navigation), this shim silently failed — the user saw a blank page or a brief flash with no way to proceed.

**Fix:** The `/join/*` route now serves the full React SPA (`injectedIndexHtml`) with `no-cache` headers. The SPA handles the `/join/` path internally, parsing the share link and triggering the join flow — or showing the DeepLinkGate if the desktop app might handle it.

**Server Changes:**
- Removed `JOIN_REDIRECT_HTML` static template entirely
- `/join/*` route now serves the SPA with `Cache-Control: no-cache, no-store, must-revalidate` headers
- Route is registered **before** the SPA fallback to ensure correct matching

---

## 🚪 DeepLinkGate Component

A new overlay component that gracefully handles the transition between `https://` share links and the `nightjar://` desktop protocol:

- **Automatic detection** — Attempts to open the `nightjar://` deep link via hidden iframe + `window.location.href`
- **Timeout fallback** — After 1.5 seconds, if the app doesn't open (detected via blur/visibility API), shows a fallback card
- **Fallback options:**
  - "Continue in Browser" — proceeds with the web join flow
  - "Copy Link" — copies the `nightjar://` link to clipboard
  - "Try Again" — re-attempts the deep link
  - Download link — directs to the desktop app download
- **Electron skip** — Automatically skipped in Electron (detected via `isElectron()`)
- **Pending link persistence** — Share link and expiry are stored in `sessionStorage` so they survive onboarding and PIN lock flows

---

## ⏰ Mandatory Expiry Enforcement

Signed invite links now **require** an expiry timestamp. This prevents indefinite link reuse and closes the "forever link" attack vector.

**Changes:**
- `validateSignedInvite()` returns `{ valid: false, error: 'Signed link is missing mandatory expiry' }` for signed links without an `exp:` field
- Truly legacy links (no signature AND no expiry) are still accepted for backward compatibility
- `CreateWorkspace.jsx` enforces expiry at join time — rejects if `Date.now() > expiry`
- Join button is disabled for expired or invalid links with a clear error message
- Maximum expiry capped at 24 hours from generation time

---

## 🧹 Two-Tier Server Invite Cleanup

The server now automatically cleans up expired invites with two cleanup tiers:

| Tier | Interval | Action |
|------|----------|--------|
| **Expired cleanup** | Every hour | `DELETE FROM invites WHERE expires_at <= ?` — removes invites past their expiry |
| **Nuclear cleanup** | Every 6 hours | `DELETE FROM invites WHERE created_at <= ?` — removes ALL invites older than 24 hours regardless of expiry |

**Implementation:**
- Two new SQLite prepared statements: `deleteExpiredInvites` and `nuclearDeleteOldInvites`
- Two new `Storage` methods: `deleteExpiredInvites(now)` and `nuclearDeleteOldInvites(cutoff)`
- `MAX_INVITE_AGE_MS = 24 * 60 * 60 * 1000` (24 hours)
- Cleanup interval registered on server start and cleared on graceful shutdown
- Logged at `info` level for audit trail

---

## 🍞 Already-a-Member Toast

When a user clicks a share link for a workspace they already belong to, all three join paths (workspace, folder, document) now show a friendly toast: *"You're already a member of this workspace"* instead of silently duplicating the join.

**Bug Fix:** `joinWorkspace()` in `WorkspaceContext.jsx` now returns `alreadyMember: true` when the workspace already exists, which `CreateWorkspace.jsx` checks alongside `permissionChanged === null`.

---

## 🛡️ Security Properties

| Property | Status |
|----------|--------|
| URL fragment security (keys never sent to server) | ✅ Preserved |
| Ed25519 signature verification | ✅ Enforced |
| Mandatory expiry on signed links | ✅ **New** |
| Server-side invite cleanup (24h max) | ✅ **New** |
| Deep link gate (no blank page on failure) | ✅ **New** |
| Pending share link survives onboarding | ✅ **New** |
| Already-a-member detection | ✅ **New** |
| Legacy link backward compatibility | ✅ Preserved |

---

## 🧪 Testing

### Spreadsheet Sync Tests

**`tests/sheet-sync-fix.test.js`** — 18 new tests:

| Test Suite | Tests | Description |
|-----------|-------|-------------|
| celldata ↔ data conversion | 6 | Builds 2D array from sparse celldata, handles empty/OOB/default-size, round-trip preservation |
| Y.Array-based ops sync | 4 | Cross-doc propagation, concurrent append preservation, delete-vs-push race, no Y.Map usage |
| Full-sheet sync with celldata conversion | 3 | Remote celldata renders correctly, two-client edit propagation, three-way sync |
| Legacy pendingOps cleanup | 1 | Old Y.Map key detected and removed |
| Y.Array observer event structure | 2 | Event.changes.added structure, delete+push in same transaction |
| Rapid edits stress test | 2 | 40 concurrent ops from 2 clients, 100-cell full-sheet round-trip |

All 33 sheet tests passing (18 new + 15 existing).

### Share Link Security Tests

**`tests/share-link-security.test.js`** — 22 tests:
- `validateSignedInvite` expiry enforcement (expired links, valid links, 24h cap, missing expiry on signed links, legacy links, tampered signatures, expiry in result)
- Clickable share link ↔ `nightjar://` conversion round-trip
- `generateSignedInviteLink` security properties (required params, fragment fields, signature coverage, unique signatures per permission)
- Link fragment security (keys in fragment only, signature in fragment only)
- Edge cases (null input, empty string, undefined)

### Server Invite Cleanup Tests

**`tests/server-invite-cleanup.test.js`** — 24 tests:
- Server source SQL statements (`deleteExpiredInvites`, `nuclearDeleteOldInvites`)
- Storage class methods (existence, parameter binding, row counting)
- Invite cleanup intervals (hourly + 6-hour nuclear, `MAX_INVITE_AGE_MS`)
- `/join/*` route (SPA serving, no-cache headers, route ordering before SPA fallback)
- Invite table schema validation
- At-rest encryption TODO detection

### DeepLinkGate Component Tests

**`tests/deep-link-gate.test.jsx`** — 9 tests:
- Attempting phase render ("Opening Nightjar…")
- Fallback UI after timeout
- Skip / Continue in Browser / Cancel / Try Again button callbacks
- Download link presence
- Null link handling
- Copy link button

### Bug Report Modal Tests

**`tests/bug-report-modal.test.jsx`** — 66 tests:
- Updated for template-aware description field
- All existing tests passing with markdown editor changes

### Test Totals

| Suite | New | Existing | Total |
|-------|-----|----------|-------|
| Sheet sync | 18 | 15 | 33 |
| Share link security | 22 | — | 22 |
| Server invite cleanup | 24 | — | 24 |
| DeepLinkGate | 9 | — | 9 |
| Share link (existing) | — | 38 | 38 |
| Bug report modal | — | 66 | 66 |
| **Totals** | **73** | **119** | **192** |

---

## 📁 New Files

| File | Purpose |
|------|---------|
| `frontend/src/components/common/DeepLinkGate.jsx` | Deep link gate overlay (200 lines) |
| `frontend/src/components/common/DeepLinkGate.css` | Gate overlay styles (121 lines) |
| `tests/share-link-security.test.js` | Share link security test suite (22 tests) |
| `tests/server-invite-cleanup.test.js` | Server invite cleanup test suite (24 tests) |
| `tests/deep-link-gate.test.jsx` | DeepLinkGate component test suite (9 tests) |
| `tests/sheet-sync-fix.test.js` | Spreadsheet sync test suite (18 tests) |
| `docs/release-notes/RELEASE_NOTES_v1.7.15.md` | Spreadsheet sync fix release notes |

## 📁 Modified Files

| File | Changes |
|------|---------|
| `frontend/src/components/Sheet.jsx` | Migrated pendingOps to Y.Array, added `convertCelldataToData`, op-path short-circuit, dirty-flag protection window, legacy cleanup |
| `frontend/src/components/BugReportModal.jsx` | Added `simpleMarkdown()` renderer, `MarkdownEditor` component with Write/Preview tabs, structured template |
| `frontend/src/components/BugReportModal.css` | 130+ lines of dark-themed markdown preview styles |
| `server/unified/index.js` | Replaced JOIN_REDIRECT_HTML with SPA-serving `/join/*` route; added invite cleanup (SQL + Storage methods + interval + graceful shutdown) |
| `frontend/src/AppNew.jsx` | DeepLinkGate import/state, share link useEffect with deep link gate, `processPendingShareLink` helper, DeepLinkGate render |
| `frontend/src/components/CreateWorkspace.jsx` | Expiry enforcement at join time, signature validation blocking, already-a-member toast, disabled button for expired/invalid |
| `frontend/src/contexts/WorkspaceContext.jsx` | `alreadyMember: true` in `joinWorkspace` return for existing workspaces |
| `frontend/src/utils/sharing.js` | `validateSignedInvite` rejects signed links without expiry; TODO for per-workspace relay |
| `capacitor.config.json` | TODO for deep link configuration |
| `frontend/public-site/content/security-model.json` | Updated invite expiry enforcement, cleanup, and future work sections |
| `frontend/public-site/index.html` | Version bump 1.7.14 → 1.7.15 |
| `tests/sheet.test.js` | Updated onOp test to verify Y.Array usage |
| `tests/bug-report-modal.test.jsx` | Updated for template-aware description field |
| `package.json` | Version 1.7.14 → 1.7.15 |
| `README.md` | Changelog entry, sharing features, share link security section updates |

---

## 📊 Statistics

- **3 commits**, **24 files changed**
- **~2,540 insertions(+)**, **~160 deletions(−)**
- **73 new tests added** across 4 new test files
- **1 GitHub issue resolved** (#4 — Spreadsheet sync)

---

## 🚀 Upgrade Notes

### Spreadsheet Sync (Breaking for mixed-version workspaces)
- Existing Yjs documents with the old `pendingOps` key on `Y.Map('sheet-data')` will have that key automatically deleted on first load. This is a one-way migration.
- Clients on v1.7.14 or earlier will not be able to process ops sent by v1.7.15 clients.
- **Recommended:** All clients in a workspace should upgrade to v1.7.15 simultaneously to ensure consistent op handling.

### Share Links
- **Legacy links** (unsigned, no expiry) continue to work for backward compatibility
- **Signed links without expiry** are now rejected — regenerate any bookmarked signed links
- **Server cleanup** is automatic — no configuration needed. Invites older than 24 hours are permanently deleted
- The DeepLinkGate only appears on web — Electron users see no change

### Bug Reports
- The description field now opens with a structured markdown template. No action required — existing bug report workflows are unchanged.
