# Bug Audit — Iteration 20b: Mobile & Web Compatibility

**Date:** 2026-02-19  
**Scope:** Platform detection, conditional features, web-mode fallbacks, touch events, PWA configuration

---

## 1. Platform Detection Review

### `frontend/src/utils/platform.js`
✅ **PASS** — Clean, correct detection for Electron (`window.electronAPI`), Capacitor (`window.Capacitor`), and web (neither). `isMobile()` correctly composes `isAndroid() || isIOS()`. `NativeBridge` provides proper fallbacks for all identity operations, clipboard, share, and haptics.

### `frontend/src/hooks/useEnvironment.js`
✅ **PASS** — Resilient multi-signal detection: primary `electronAPI`, fallback `userAgent`, fallback `file://` protocol. Capacitor check uses `isNativePlatform()`. `isFeatureAvailable()` gates Tor, Relay, Hyperswarm, and identity-secure features to Electron-only.

**Note:** Two separate platform detection modules exist (`platform.js` and `useEnvironment.js`). They use slightly different detection logic but reach the same conclusions. Not a bug, but a future refactor candidate.

---

## 2. Conditional Features (`isElectron` / `isMobile` checks)

### `WorkspaceContext.jsx`
✅ **PASS** — `isElectron` is properly invoked as `checkIsElectron()` and stored as a boolean. Web mode falls back to localStorage for workspace persistence. Sidecar connection is gated behind `isElectronMode`.

### `AppNew.jsx`
✅ **PASS** — `isElectronMode = isElectron()` called correctly. All conditionals use the boolean result, not the function reference.

### `FolderContext.jsx`
✅ **PASS** — `isElectronMode = isElectron()` called correctly. `useLocalMode` properly combines `isElectronMode && !isRemoteWorkspace && isWorkspaceOwner`.

### `StatusBar.jsx`
✅ **PASS** — Destructures `{ isElectron }` from `useEnvironment()` hook which returns booleans. Conditional P2P status display is correctly gated.

### `AppSettings.jsx`
✅ **PASS** — `isElectron` from `useEnvironment()` hook (boolean). Desktop settings load gated behind `isElectron && isFeatureAvailable('tor')`.

### `UserProfile.jsx`
✅ **PASS** — `isElectron` from `useEnvironment()`. Version display shows release link in Electron, "Web" otherwise. No dead buttons.

---

## 3. Web Mode Fallbacks

### Identity Creation Without Electron IPC
✅ **PASS** — `IdentityContext.jsx` creates identities in web mode via `secureStorage.set(IDENTITY_KEY, identityData)`. `CreateIdentity.jsx` calls `generateIdentity()` (pure JS crypto), then `onComplete(identity)` — no IPC dependency. Export/import uses proper WebCrypto AES-GCM encryption in non-Electron mode.

### Workspace Joining Without Sidecar
✅ **PASS** — `WorkspaceContext.jsx` line 356: `if (!isElectronMode)` → uses localStorage and Yjs WebSocket for web-mode sync. No sidecar dependency.

### Usage Without Hyperswarm/mDNS
✅ **PASS** — `NativeBridge.hyperswarm` methods silently return `false` / `[]` / `0` when not in Electron. Web users use WebSocket relay instead.

---

## 4. Issues Found & Fixed

### Issue 1: `diagnostics.js` — Incorrect isElectron check (HIGH)

| Field | Value |
|-------|-------|
| **Severity** | 🔴 HIGH |
| **File** | `frontend/src/utils/diagnostics.js` |
| **Line** | 71 |
| **Problem** | `const isElectron = window.electronAPI;` stores the object reference, not a boolean. Then calls `window.electronAPI.getDiagnosticData()` without checking if that method exists. On web or if `electronAPI` is partially initialized, this crashes with an unhandled exception. |
| **Fix** | Changed to `const isElectron = typeof window !== 'undefined' && !!window.electronAPI;` and added `typeof window.electronAPI.getDiagnosticData === 'function'` guard. |

### Issue 2: Kanban Edit Button Invisible on Touch Devices (MEDIUM)

| Field | Value |
|-------|-------|
| **Severity** | 🟡 MEDIUM |
| **File** | `frontend/src/components/Kanban.css` |
| **Lines** | 406-415 |
| **Problem** | `.btn-edit-card` has `opacity: 0` and only becomes visible on `.kanban-card:hover`. Touch devices don't fire hover, so the edit button is permanently hidden — users can't edit cards on mobile. |
| **Fix** | Added `@media (pointer: coarse)` rule that sets `.btn-edit-card { opacity: 0.6; }` and changes card cursor to `default`. |

### Issue 3: Kanban Board Missing Touch Device Enhancements (MEDIUM)

| Field | Value |
|-------|-------|
| **Severity** | 🟡 MEDIUM |
| **File** | `frontend/src/components/Kanban.css` |
| **Problem** | No `touch-action` CSS, no minimum tap targets. HTML5 drag-and-drop has limited mobile support but the CSS was actively fighting it by not declaring `touch-action`. Buttons below 44px minimum tap target. |
| **Fix** | Added `@media (pointer: coarse)` block with `touch-action` directives, `-webkit-overflow-scrolling: touch`, and 44px minimum tap targets for interactive elements. |

### Issue 4: Context Menu Only Accessible via Right-Click (MEDIUM)

| Field | Value |
|-------|-------|
| **Severity** | 🟡 MEDIUM |
| **File** | `frontend/src/components/HierarchicalSidebar.jsx` |
| **Lines** | 211 |
| **Problem** | `TreeItem` only opens context menu via `onContextMenu` (right-click). Mobile/touch users have no way to access rename/delete/edit-properties actions. Help text says "Right-click a folder…" |
| **Fix** | Added `onTouchStart`/`onTouchEnd`/`onTouchMove` handlers implementing a 500ms long-press that synthesizes a context menu event at the touch position. Touch movement cancels the timer. |

### Issue 5: Context Menu & Tree Item Tap Targets Too Small (MEDIUM)

| Field | Value |
|-------|-------|
| **Severity** | 🟡 MEDIUM |
| **File** | `frontend/src/components/HierarchicalSidebar.css` |
| **Problem** | Context menu items and tree items below 44px WCAG minimum tap target for touch devices. |
| **Fix** | Added `@media (pointer: coarse)` rules setting `min-height: 44px` on `.context-menu__item` and `.tree-item`. |

---

## 5. Not Fixed (LOW / Informational)

| # | Severity | Finding | Notes |
|---|----------|---------|-------|
| 1 | ℹ️ INFO | No PWA manifest or service worker in `frontend/public/` | Web users can't "Add to Home Screen". Not a bug — Nightjar is primarily an Electron app. Would require `manifest.json`, service worker, and icons. Recommend as future enhancement. |
| 2 | ℹ️ INFO | `DocumentPicker.jsx` and `BrowseView.jsx` also use right-click-only context menus | Same pattern as HierarchicalSidebar but lower priority since these are less-used views. The FileContextMenu component already handles outside-click dismissal well. |
| 3 | ℹ️ INFO | Dual platform detection modules (`platform.js` vs `useEnvironment.js`) | Both work correctly but logic is duplicated. Future refactor opportunity. |
| 4 | ℹ️ INFO | HTML5 drag-and-drop fundamentally limited on mobile | CSS fixes help but full mobile Kanban drag would require a touch-DnD library (e.g., `dnd-kit` or `react-beautiful-dnd`). Current state: cards can be edited via button; reordering requires desktop. |

---

## 6. Test Results

All existing tests pass after changes:
- `tests/utilities.test.js` — **52/52 passed** ✅
- `tests/deletion.test.js` — **39/39 passed** ✅

---

## Files Modified

1. `frontend/src/utils/diagnostics.js` — Fixed isElectron truthiness + getDiagnosticData guard
2. `frontend/src/components/Kanban.css` — Touch device visibility + tap targets + touch-action
3. `frontend/src/components/HierarchicalSidebar.jsx` — Long-press context menu for touch
4. `frontend/src/components/HierarchicalSidebar.css` — Touch tap target minimums
