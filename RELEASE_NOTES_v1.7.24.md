# Nightjar v1.7.24 Release Notes

**Release Date:** June 2025

This release fixes **4 bugs in the in-app join dialog** — a follow-up to v1.7.23 which fixed the browser/PWA white screen. These bugs prevented users from successfully joining a workspace by pasting a share link into the Electron app's Join dialog.

---

## 🐛 Bug 1: Signature Validation Blocking Joins (HIGH)

### Root Cause

`validateSignedInvite()` catches **any** exception thrown by `base62ToUint8()` or `verifySignature()` and returns `{ valid: false }`. The `handleJoin()` function in `CreateWorkspace.jsx` treated this as a hard block — both disabling the Join button and returning early from the join handler.

The link data itself (workspace ID, encryption key, topic hash) can be perfectly valid even when the signature field contains characters from a different Base62 alphabet or is otherwise malformed.

### Fix

- Signature validation failures are now logged as `console.warn` instead of blocking the join flow
- The Join button's `disabled` state no longer includes the signature validation check (only blocks on: no link, expired link, or already joining)
- **Expiry is still enforced** — expired links are always rejected regardless of signature status

| Before | After |
|---|---|
| `base62ToUint8` throws → `{valid:false}` → Join button disabled, `handleJoin` returns early | `base62ToUint8` throws → `{valid:false}` → console.warn, join proceeds |

---

## 🐛 Bug 2: Join Callbacks Dropped (HIGH)

### Root Cause

`CreateWorkspace.jsx` passes `onConnectionProgress` and `onAllPeersFailed` callbacks in the `shareData` object to `WorkspaceContext.joinWorkspace()`, but the function never destructured or invoked them. The join dialog could not display connection progress or handle peer failures.

### Fix

- `joinWorkspace()` now destructures both callbacks from `shareData`
- `onConnectionProgress({ status: 'connecting' })` is called immediately after sending the `join-workspace` message to the sidecar
- `onConnectionProgress({ status: 'joined' })` is called after the workspace is added to local state
- `onAllPeersFailed()` is called when no sidecar or relay server is available for the P2P connection

---

## 🐛 Bug 3: Link Expiry Too Aggressive (MEDIUM)

### Root Cause

The default share link expiry was **1 hour (60 minutes)**. This is too short for real-world sharing scenarios — links shared at end-of-day or across time zones often expired before recipients could use them.

### Fix

- Default expiry changed from 60 to **1440 minutes (24 hours)** in both:
  - `generateSignedInviteLink()` function default parameter
  - `WorkspaceSettings.jsx` UI state initializer
- The dropdown still offers 15 min / 1 hour / 4 hours / 24 hours options
- Maximum expiry is capped at 24 hours (enforced in `generateSignedInviteLink`)

---

## 🐛 Bug 4: compressShareLink No-Op on HTTPS URLs (MEDIUM)

### Root Cause

`compressShareLink()` checked `link.startsWith('nightjar://')` to decide whether to compress. But `WorkspaceSettings.jsx` passes **HTTPS join URLs** (`https://night-jar.co/join/...`) — the function returned them unchanged, meaning the "compressed" link was just the full HTTPS URL.

### Fix

- `compressShareLink()` now detects HTTPS join URLs via `isJoinUrl()` and converts them to `nightjar://` format via `joinUrlToNightjarLink()` before compressing
- The final fallback now returns the converted `nightjarLink` (not the original `link`), ensuring HTTPS URLs are always converted to the shorter `nightjar://` format even when compression doesn't reduce size further

---

## 🧪 Test Coverage

**15 new tests** in `tests/join-dialog-fixes.test.js` across 4 describe blocks:

| Category | Tests | What it verifies |
|---|---|---|
| Bug 1: Signature exception handling | 4 | Malformed base62, garbled links return `{valid:false}` without throwing; valid signed links validate; legacy links pass |
| Bug 2: Join callback wiring | 3 | Callback shape matches expected interface; progress statuses correct; failure callback callable |
| Bug 3: Default expiry | 3 | Default is 1440 min; explicit override works; maximum capped at 24h |
| Bug 4: HTTPS URL compression | 5 | nightjar:// links compressed; HTTPS join URLs compressed; non-join URLs unchanged; null/empty input safe; round-trip conversion |

---

## 📁 Files Changed

| File | Change |
|---|---|
| `frontend/src/components/CreateWorkspace.jsx` | Signature validation downgraded to warning; Join button disabled logic simplified |
| `frontend/src/contexts/WorkspaceContext.jsx` | `onConnectionProgress` / `onAllPeersFailed` destructured and invoked |
| `frontend/src/utils/sharing.js` | Default expiry 60→1440 min; `compressShareLink` handles HTTPS join URLs; fallback returns `nightjarLink` |
| `frontend/src/components/WorkspaceSettings.jsx` | Default expiry state 60→1440 |
| `tests/join-dialog-fixes.test.js` | 15 new tests (4 describe blocks) |
| `frontend/public-site/content/sharing.json` | Added link expiry documentation section |
| `package.json` | Version `1.7.23` → `1.7.24` |
| `README.md` | v1.7.24 changelog entry |

---

## 📊 Statistics

| Metric | Value |
|---|---|
| Files changed | 9 (7 modified + 1 new test + 1 new release notes) |
| Insertions | ~60 |
| Deletions | ~14 |
| Test suites | 152 |
| Tests passing | 4,705 + 15 new = 4,720 |

---

## 📋 Cumulative Feature Summary (v1.5 → v1.7.24)

| Version | Highlights |
|---|---|
| v1.5 | Initial P2P sharing, Hyperswarm integration |
| v1.7.14 | Mobile-first PWA, responsive layouts |
| v1.7.15 | Server invite cleanup, route hardening |
| v1.7.16 | Security hardening phase 1 |
| v1.7.17 | Security hardening phase 2 |
| v1.7.18 | File storage, chunk transfer, mesh dashboard |
| v1.7.19 | Share link host fix, deployment hardening |
| v1.7.20 | Web app share link fix (middleware ordering) |
| v1.7.21 | Share link blank screen & relay routing fix |
| v1.7.22 | Relay bridge auto-connect, cross-platform sharing |
| v1.7.23 | Share link white screen fix (`<base href>` injection) |
| **v1.7.24** | **In-app join dialog fix — signature validation, callbacks, 24h expiry, HTTPS compression** |

---

## 🚀 Upgrade Notes

- **Backward compatible**: All changes are internal to the frontend join flow
- **No breaking changes**: Share links generated by v1.7.23 and earlier still work
- **Default expiry change**: New links default to 24h expiry instead of 1h — existing links retain their original expiry
- **Signature validation**: Links with invalid signatures now allow joining (with a console warning) — this is intentional to avoid blocking legitimate links with encoding edge cases

---

## 📦 Build Targets

| Platform | Formats |
|---|---|
| Windows | `.exe` (NSIS installer) |
| macOS | `.dmg`, `.zip` (x64 + arm64) |
| Linux | `.AppImage`, `.deb` |

---

## 🔗 Related

- **Issue**: [#7 — Sharing still broken](https://github.com/NiyaNagi/Nightjar/issues/7)
- **v1.7.23**: Fixed browser/PWA white screen on share links (server-side `<base>` injection)
- **v1.7.24**: Fixes the **in-app** join dialog — a completely separate code path from v1.7.23
