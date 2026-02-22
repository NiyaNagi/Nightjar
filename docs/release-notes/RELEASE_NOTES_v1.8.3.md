# Release Notes — v1.8.3

**Release Date:** February 21, 2026

v1.8.3 is a focused patch release that corrects three categories of bugs introduced or exposed by the v1.8.1–v1.8.2 mobile overhaul: a broken copy-link/share action in the workspace sharing screen, missing ARIA role and label attributes on modal dialogs, and stale CSS selector references in tests that were orphaned when modals migrated to `ResponsiveModal`. All 157 test suites now pass cleanly with 5,042 of 5,048 tests green.

---

## 🐛 Bug Fixes

### Copy Link / Share Button Non-Functional (WorkspaceSettings)

The **Copy Link** and **Share** buttons on the workspace sharing screen were silently doing nothing. The root cause: `WorkspaceSettings.jsx` called `Platform.copyToClipboard()` and `Platform.share()`, but the `Platform` object is a detection-only helper — it exposes `isElectron()`, `isCapacitor()`, `isAndroid()`, etc., not action methods. Action methods (`copyToClipboard`, `share`, `haptic`) live on `NativeBridge`.

| Before | After |
|--------|-------|
| `Platform.copyToClipboard(textToCopy)` | `NativeBridge.copyToClipboard(textToCopy)` |
| `Platform.share({ title, text, url })` | `NativeBridge.share({ title, text, url })` |
| Missing `NativeBridge` import | `import { Platform, NativeBridge } from '../utils/platform'` |

`Platform.isCapacitor()` in the same file was left unchanged — it is a detection call and was always correct.

### Missing ARIA Roles on Modal Dialogs (ResponsiveModal)

`ResponsiveModal` hardcoded `role="dialog"` on all modal instances. This meant:

- **Confirm/delete dialogs** using `ConfirmDialog` should be `role="alertdialog"` (requires immediate attention) but were rendered as plain dialogs — screen readers would not alert the user appropriately.
- **BugReportModal** had `<h2 id="bug-report-title">` but `ResponsiveModal` only supported `aria-label` (an inline string), not `aria-labelledby` (a reference to an element ID). The modal's accessible name was disconnected from its visible heading.

**Fixes:**

- `ResponsiveModal` now accepts two new optional props:
  - `role` (default `'dialog'`) — passed directly to the dialog `div`
  - `ariaLabelledBy` — when provided, sets `aria-labelledby` instead of `aria-label`, linking the modal to its heading element
- `ConfirmDialog` passes `role="alertdialog"` to `ResponsiveModal`
- `BugReportModal` passes `ariaLabelledBy="bug-report-title"` to `ResponsiveModal`, connecting it to `<h2 id="bug-report-title">🐛 Report a Bug</h2>`

### Stale Overlay Selectors in Tests

Three test files still referenced old CSS class names from before the `ResponsiveModal` migration:

| Test File | Old Selector | New Selector |
|-----------|-------------|-------------|
| `bug-report-modal.test.jsx` | `.bug-report-overlay` | `.responsive-modal__overlay` |
| `TorSettings.test.js` | `.settings-overlay` | `.responsive-modal__overlay` |
| `mobile-optimizations-v1.7.14.test.js` | `bottom: calc(80px` (hardcoded) | `bottom: calc(var(--bottom-nav-height` (CSS custom property) |
| `mobile-optimizations-v1.7.14.test.js` | `'TODO: [Mobile Step 3]'` comment | `.chat-minimized` class + `'bottom nav'` implementation |

The toast `80px` assertion was stale because the mobile overhaul switched to a CSS custom property (`--bottom-nav-height`) for dynamic spacing. The Chat.css Step 3 comment was removed when that feature was implemented; the test now checks for the actual implementation instead.

---

## 🔧 Technical Details

### Modified Files

| File | Change |
|------|--------|
| `frontend/src/components/WorkspaceSettings.jsx` | Add `NativeBridge` to import; fix 2 call sites |
| `frontend/src/components/common/ResponsiveModal.jsx` | Add `role` and `ariaLabelledBy` props |
| `frontend/src/components/common/ConfirmDialog.jsx` | Pass `role="alertdialog"` |
| `frontend/src/components/BugReportModal.jsx` | Pass `ariaLabelledBy="bug-report-title"` |
| `tests/bug-report-modal.test.jsx` | Update overlay selector |
| `tests/components/Settings/TorSettings.test.js` | Update overlay selector |
| `tests/mobile-optimizations-v1.7.14.test.js` | Update 2 stale assertions |

---

## 📊 Statistics

| Metric | Value |
|--------|-------|
| Commits since v1.8.2 | 1 |
| Files changed | 7 |
| Insertions | 22 |
| Deletions | 14 |
| Test suites | 157 |
| Tests passing | 5,042 / 5,048 |
| Skipped (intentional) | 6 |

---

## 📋 Cumulative Feature Summary (v1.5 → v1.8.3)

| Version | Highlights |
|---------|------------|
| v1.5.0 | Kanban boards, encrypted file attachments, folder permissions |
| v1.6.1 | Relay server, self-hosting, NAT traversal improvements |
| v1.7.x | Tor integration, presence indicators, breadcrumbs, search palette, file move/copy, recovery codes, 30+ bug fixes |
| v1.8.0 | World-class mobile UX — 15-step overhaul, bottom-sheet modals, @dnd-kit, virtual keyboard, native share, 48 E2E tests |
| v1.8.1 | Mobile refinements — sidebar auto-close, edge-swipe, 44px touch targets, ResponsiveModal migration for 9 modals |
| v1.8.2 | Critical launch crash fix (TDZ), NativeBridge import corrections for 4 components, warning block type for Help page |
| **v1.8.3** | **Copy link/share fix, ARIA alertdialog roles, ariaLabelledBy on modals, stale test selector cleanup** |

---

## 🚀 Upgrade Notes

This is a **patch release**. No breaking changes. No migration steps required.

- Drop-in upgrade from v1.8.2
- `ResponsiveModal` has two new optional props (`role`, `ariaLabelledBy`) — existing usages are unaffected (both default gracefully)
- Accessibility-sensitive deployments: `ConfirmDialog` now correctly announces as `alertdialog` to screen readers

---

## 📦 Build Targets

| Platform | Formats |
|----------|---------|
| Windows | `.exe` (NSIS installer) |
| macOS | `.dmg`, `.zip` (x64 + arm64) |
| Linux | `.AppImage`, `.deb` |
| Web (PWA) | Supported |
| iOS / Android (Capacitor) | Supported |
