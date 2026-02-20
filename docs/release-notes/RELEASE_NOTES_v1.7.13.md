# Nightjar v1.7.13 Release Notes

**Release Date:** February 20, 2026

This release delivers a **major security hardening** across the entire P2P stack, a ground-up **UnifiedPicker** component replacing all icon/color pickers with a 500+ emoji catalog, **encrypted persistence enabled by default**, and **comprehensive mobile-first responsive breakpoints** across the full UI.

---

## 🔒 Security Hardening

### Phase 1 — Oracle Removal, Headers, Signed Key Delivery & Encrypted Secrets

- **Encryption oracle removal** — Stripped the server-side `/api/encrypt` and `/api/decrypt` endpoints that allowed arbitrary encryption/decryption with server-held keys. Clients now perform all crypto locally.
- **Security headers** — Added `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection`, `Strict-Transport-Security`, and `Content-Security-Policy` headers to all server responses.
- **Signed key delivery** — `POST /api/rooms/:room/key` now requires an Ed25519 signature from the workspace owner. The server verifies the signature before accepting the encryption key.
- **Encrypted workspace secrets** — New `workspaceSecrets.js` utility encrypts sensitive workspace metadata (passwords, keys) with the user's identity key before writing to localStorage.
- **Room-auth utility** — New `roomAuth.js` module provides HMAC-based room-join authentication tokens, preventing unauthorized peers from joining workspace topics.

### Phase 2 — HMAC Room-Join Auth, Encrypted Relay & Documentation

- **HMAC room-join authentication** — Peers must present a valid HMAC token (derived from workspace key + topic) when joining a room. The server and all peers verify tokens before accepting connections.
- **Encrypted relay transport** — WebSocket relay messages are now encrypted end-to-end between peers, even when transiting through relay servers. Relay servers see only opaque ciphertext.
- **Security hardening documentation** — New `docs/SECURITY_HARDENING.md` covering the full threat model, mitigations, and audit trail for both phases.

### HMAC Room-Auth Bug Fixes

- **Dead variable in useWorkspaceSync** — Removed unused `roomAuthToken` variable that was shadowing the actual auth token passed to the P2P layer.
- **Missing doc-room auth in AppNew** — Document-level room joins now pass HMAC auth tokens, not just workspace-level rooms.

### Encrypted Persistence Enabled by Default

- **`ENCRYPTED_PERSISTENCE=true` is now the default** — Server-side at-rest encryption is enabled out of the box. New deployments automatically encrypt all stored Yjs documents with NaCl secretbox. Existing deployments can opt out by setting `ENCRYPTED_PERSISTENCE=false`.

---

## ✨ New Features

### UnifiedPicker — 500+ Emoji Catalog with Bubble + Popover UI

A brand-new **UnifiedPicker** component replaces the old `IconColorPicker` across the entire application. The picker offers a rich, consistent experience for choosing icons and colors on workspaces, folders, documents, and Kanban cards.

- **500+ emojis across 10 categories** — Smileys, People, Animals & Nature, Food & Drink, Activities, Travel, Objects, Symbols, Flags, and Hands & Gestures. All emojis validated for cross-platform rendering (Windows, macOS, Linux).
- **Bubble trigger** — A compact clickable bubble shows the current icon + color. Click to open the floating picker.
- **Portal two-pane popover** — The picker renders in a React portal above all UI, with an emoji grid on top and a color palette on the bottom. Fully dark/light theme aware via CSS variables.
- **Category tabs with arrow navigation** — Pill-shaped category buttons with icon + text label. Left/right arrow buttons appear dynamically when categories overflow the container width.
- **Search filtering** — Type to filter emojis by name across all categories.
- **20-color palette** — Curated color presets matching the existing design system.
- **All consumers migrated** — `CreateFolder`, `CreateDocument`, `CreateWorkspace`, `Kanban`, `KanbanCardEditor`, `EditPropertiesModal`, `UserProfile`, `IdentitySettings`, `AddDropdown`, `JoinWithLink`, and onboarding flows all use UnifiedPicker.
- **Old `IconColorPicker` removed** — The legacy component and its CSS (285 lines) have been deleted.

### Comprehensive Mobile-First Responsive Breakpoints

- **40+ CSS files updated** with responsive `@media` breakpoints across the entire UI.
- **Four-tier breakpoint system** — `≤480px` (phone), `≤768px` (tablet portrait), `≤1024px` (tablet landscape), `≤1280px` (small desktop).
- **Component-level adaptation** — Every major UI component (sidebar, editor, toolbar, tab bar, status bar, kanban, chat, search palette, modals, settings, file storage, inventory, and more) responds to viewport width with appropriate layout, font size, padding, and visibility adjustments.
- **Touch-friendly targets** — Minimum 44px tap targets on mobile, expanded hit areas for buttons and controls.

---

## 🐛 Bug Fixes

### UnifiedPicker Polish & Emoji Fixes

- **Removed 43 broken emojis** — Unicode 13.0+, 14.0, 15.0, and ZWJ sequence emojis that render as blank boxes on Windows have been removed from the catalog.
- **Restored 13 corrupted emojis** — Adjacent removal edits had corrupted neighboring emoji entries (wiping their strings to empty). Restored: 🤐 zipper-mouth, 🤟 love-you gesture, 🦋 butterfly, 🦏 rhinoceros, 🐨 koala, 🥦 broccoli, 🥙 pita, 🥤 cup with straw, 🥁 drum, 🚚 delivery truck, 🧲 magnet, 💭 thought balloon, 🏴‍☠️ pirate flag.
- **Grid clipping fix** — Reduced emoji grid from 10 to 8 columns to prevent right-edge clipping in the popover.
- **Popover width tuned** — Reduced from 520px to 480px for better proportions.
- **Category tab paging** — Left/right arrow buttons appear dynamically based on scroll overflow. Smooth 200px scroll per click.

### Inline Compact Picker Migration

- **Removed `compact={true}` from 4 consumers** — `CreateFolder`, `UserProfile`, `IdentitySettings`, and `EditPropertiesModal` were still using the inline compact layout. Switched to the bubble + popover pattern for a consistent UX across the app.

### UI Layout Fixes

- **Mascot chat bubble no longer shifts page content** — The speech bubble is now positioned with `position: absolute` instead of affecting document flow, preventing layout jumps when it appears/disappears.
- **GitHub star count moved into nav button** — Saves vertical space in the landing page header by combining the star count badge with the GitHub navigation button.

---

## 📖 Documentation & Screenshots

- **Updated screenshots** — Refreshed all documentation screenshots (text editor, kanban, chat, file storage, sharing, inventory, dark theme) across README and public site.
- **Security hardening docs** — New `docs/SECURITY_HARDENING.md` (242 lines) documenting the full Phase 1 + Phase 2 security audit, threat model, and mitigations.
- **Security model page** — New `frontend/public-site/docs/security-model.html` and `content/security-model.json` (347 lines) added to the docs wiki covering the zero-knowledge architecture in depth.

---

## 🔧 Technical Improvements

### New Files

| File | Purpose |
|------|---------|
| `frontend/src/utils/roomAuth.js` | HMAC-based room-join authentication tokens (200 lines) |
| `frontend/src/utils/workspaceSecrets.js` | Encrypted workspace secret storage (148 lines) |
| `frontend/src/components/common/UnifiedPicker.jsx` | Unified icon/color/emoji picker component (559 lines) |
| `frontend/src/components/common/UnifiedPicker.css` | Full picker styles with dark/light theme support (619 lines) |
| `frontend/src/components/common/UnifiedPickerData.js` | 500+ emoji catalog across 10 categories (811 lines) |
| `docs/SECURITY_HARDENING.md` | Phase 1 + Phase 2 security audit documentation (242 lines) |
| `frontend/public-site/docs/security-model.html` | Public docs wiki — security model page (194 lines) |
| `frontend/public-site/content/security-model.json` | Security model content data (347 lines) |
| `tests/components/common/UnifiedPicker.test.js` | UnifiedPicker test suite (580 lines) |
| `tests/security-hardening.test.js` | Phase 1 security hardening tests (808 lines) |
| `tests/security-hardening-phase2.test.js` | Phase 2 security hardening tests (991 lines) |
| `tests/security-hardening-source-verify.test.js` | Security source code verification tests (244 lines) |

### Removed Files

| File | Reason |
|------|--------|
| `frontend/src/components/common/IconColorPicker.jsx` | Replaced by UnifiedPicker (237 lines removed) |
| `frontend/src/components/common/IconColorPicker.css` | Replaced by UnifiedPicker.css (285 lines removed) |

### Key Modified Files

| File | Changes |
|------|---------|
| `server/unified/index.js` | Security headers, signed key delivery, HMAC auth, encrypted persistence default (+262 lines) |
| `frontend/src/components/CreateFolder.jsx` | Migrated to UnifiedPicker |
| `frontend/src/components/CreateDocument.jsx` | Migrated to UnifiedPicker |
| `frontend/src/components/Kanban.jsx` | Migrated to UnifiedPicker |
| `frontend/src/components/KanbanCardEditor.jsx` | Migrated to UnifiedPicker |
| `frontend/src/components/UserProfile.jsx` | Migrated to UnifiedPicker, removed compact mode |
| `frontend/src/components/Settings/IdentitySettings.jsx` | Migrated to UnifiedPicker, removed compact mode |
| `frontend/src/components/common/EditPropertiesModal.jsx` | Migrated to UnifiedPicker, removed compact mode |
| `frontend/src/components/CreateWorkspace.jsx` | Migrated to UnifiedPicker |
| `frontend/src/components/Onboarding/CreateIdentity.jsx` | Migrated to UnifiedPicker |
| `frontend/src/components/Onboarding/RestoreIdentity.jsx` | Migrated to UnifiedPicker |
| `frontend/src/components/common/AddDropdown.jsx` | Migrated to UnifiedPicker |
| `frontend/src/components/common/JoinWithLink.jsx` | Migrated to UnifiedPicker |
| `frontend/src/components/WorkspaceSettings.jsx` | Updated picker integration |
| `frontend/src/hooks/useWorkspaceSync.js` | HMAC auth token plumbing |
| `frontend/src/AppNew.jsx` | Document-room HMAC auth |
| `frontend/src/services/p2p/WebSocketTransport.js` | Encrypted relay messages (+72 lines) |
| `frontend/src/services/p2p/BootstrapManager.js` | Auth token support |
| `frontend/src/services/p2p/PeerManager.js` | Auth token forwarding |
| `frontend/src/components/NightjarMascot.css` | Absolute positioning fix |
| `40+ CSS files` | Mobile-first responsive breakpoints |

---

## 📊 Statistics

- **153 files changed**
- **11,005 insertions(+)**
- **1,662 deletions(−)**
- **15 commits**
- **141 test suites, 4,413 tests passing**

---

## 🚀 Upgrade Notes

This release is backward compatible with v1.7.12. No migration steps required.

**Breaking change for server operators:** `ENCRYPTED_PERSISTENCE` now defaults to `true`. If you previously ran without at-rest encryption and want to continue doing so, explicitly set `ENCRYPTED_PERSISTENCE=false` in your environment.

The new HMAC room-join authentication is backward compatible — peers without auth tokens can still connect but will be logged as unauthenticated. A future release will enforce authentication.
