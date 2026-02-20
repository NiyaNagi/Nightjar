# Nightjar v1.7.15 Release Notes

**Release Date:** February 21, 2026

This release delivers a **comprehensive share link overhaul** that fixes share links not working when clicked from the web on new devices. The old deep-link shim HTML page has been replaced with SPA-serving routes, a new **DeepLinkGate** component handles protocol detection gracefully, **mandatory expiry enforcement** prevents indefinite link reuse, and a **two-tier server cleanup** permanently removes expired invites.

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

### New Files
| File | Purpose |
|------|---------|
| `frontend/src/components/common/DeepLinkGate.jsx` | Deep link gate overlay component (200 lines) |
| `frontend/src/components/common/DeepLinkGate.css` | Styles for the gate overlay card (121 lines) |

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

### Unit Tests (Jest)

**`tests/share-link-security.test.js`** — 22 tests:
- `validateSignedInvite` expiry enforcement (expired links, valid links, 24h cap, missing expiry on signed links, legacy links, tampered signatures, expiry in result)
- Clickable share link ↔ `nightjar://` conversion round-trip
- `generateSignedInviteLink` security properties (required params, fragment fields, signature coverage, unique signatures per permission)
- Link fragment security (keys in fragment only, signature in fragment only)
- Edge cases (null input, empty string, undefined)

**`tests/server-invite-cleanup.test.js`** — 24 tests:
- Server source SQL statements (`deleteExpiredInvites`, `nuclearDeleteOldInvites`)
- Storage class methods (existence, parameter binding, row counting)
- Invite cleanup intervals (hourly + 6-hour nuclear, `MAX_INVITE_AGE_MS`)
- `/join/*` route (SPA serving, no-cache headers, route ordering before SPA fallback)
- Invite table schema validation
- At-rest encryption TODO detection

**`tests/deep-link-gate.test.jsx`** — 9 tests:
- Attempting phase render ("Opening Nightjar…")
- Fallback UI after timeout
- Skip / Continue in Browser / Cancel / Try Again button callbacks
- Download link presence
- Null link handling
- Copy link button

**Total: 55 new tests across 3 suites. Combined run: 93 tests passing (including existing `sharing.test.js`).**

---

## 📁 New Files

| File | Purpose |
|------|---------|
| `frontend/src/components/common/DeepLinkGate.jsx` | Deep link gate overlay (200 lines) |
| `frontend/src/components/common/DeepLinkGate.css` | Gate overlay styles (121 lines) |
| `tests/share-link-security.test.js` | Share link security test suite (22 tests) |
| `tests/server-invite-cleanup.test.js` | Server invite cleanup test suite (24 tests) |
| `tests/deep-link-gate.test.jsx` | DeepLinkGate component test suite (9 tests) |

## 📁 Modified Files

| File | Changes |
|------|---------|
| `server/unified/index.js` | Replaced JOIN_REDIRECT_HTML with SPA-serving `/join/*` route; added invite cleanup (SQL + Storage methods + interval + graceful shutdown) |
| `frontend/src/AppNew.jsx` | DeepLinkGate import/state, share link useEffect with deep link gate, `processPendingShareLink` helper, DeepLinkGate render |
| `frontend/src/components/CreateWorkspace.jsx` | Expiry enforcement at join time, signature validation blocking, already-a-member toast, disabled button for expired/invalid |
| `frontend/src/contexts/WorkspaceContext.jsx` | `alreadyMember: true` in `joinWorkspace` return for existing workspaces |
| `frontend/src/utils/sharing.js` | `validateSignedInvite` rejects signed links without expiry; TODO for per-workspace relay |
| `capacitor.config.json` | TODO for deep link configuration |
| `package.json` | Version 1.7.14 → 1.7.15 |

---

## 📊 Statistics

- **12 files changed** (6 modified, 5 new, 1 version bump)
- **55 new tests added**
- **93 total tests passing** across share link test suites

---

## 🚀 Upgrade Notes

This release is fully backward compatible with v1.7.14. No migration steps required.

- **Legacy links** (unsigned, no expiry) continue to work for backward compatibility
- **Signed links without expiry** are now rejected — regenerate any bookmarked signed links
- **Server cleanup** is automatic — no configuration needed. Invites older than 24 hours are permanently deleted
- The DeepLinkGate only appears on web — Electron users see no change
