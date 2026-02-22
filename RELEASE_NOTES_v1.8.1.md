# Release Notes — v1.8.1

**Release Date:** July 2025

Nightjar v1.8.1 is a **mobile UX refinement** release that builds on the v1.8.0 overhaul with 14 targeted improvements to sidebar interaction, toolbar parity, touch gestures, modal ergonomics, and visual polish — backed by 24 new E2E tests (80 total mobile+desktop tests passing with zero regressions).

---

## 📱 Highlights

| Area | Before (v1.8.0) | After (v1.8.1) |
|------|-----------------|----------------|
| Sidebar dismiss | Backdrop click / swipe-left only | Auto-closes on doc select + edge-swipe from left to reopen |
| Sidebar DnD | HTML5 DnD (broken on touch) | @dnd-kit with TouchSensor, folder reordering + nesting |
| Formatting toolbar | Bold/Italic/Strike/Heading only | Full parity: + Underline, Highlight, Link, Comment, Keyboard dismiss |
| Touch targets | 36px buttons | 44px min-width/height (WCAG AAA) |
| Modals on mobile | CSS-only bottom-sheet look | Real drag-to-dismiss BottomSheet via ResponsiveModal (9 modals) |
| Long-press | Haptic on FileCard/FolderCard only | Haptic + scale-down animation on FileCard, FolderCard, and TreeItem |
| Sidebar backdrop | Instant show/hide | Fade-in animation (0.25s ease) |
| Toast | Overlapped by MobileToolbar | Bottom offset accounts for 52px toolbar height |
| Kanban cards | `touch-action: none` (blocks scroll) | `touch-action: pan-y` (vertical scroll preserved) |

---

## 🔧 Detailed Changes

### 1. Sidebar Auto-Close on Document Select
- On mobile (≤768px), selecting a document now automatically closes the sidebar
- Uses the reactive `useIsMobile()` hook (viewport-aware via `matchMedia` listener)
- Eliminates the need to manually dismiss the sidebar after navigation

### 2. Edge-Swipe to Open Sidebar
- 20px invisible touch zone along the left edge of the screen
- Rightward swipe (≥60px distance or >0.5 velocity) opens the collapsed sidebar
- Implemented via `@use-gesture/react` `useDrag` in `AppNew.jsx`
- Only active on mobile when sidebar is collapsed

### 3. Sidebar DnD → @dnd-kit with Folder Nesting
- Replaced HTML5 Drag & Drop with `@dnd-kit` (`DndContext`, `DragOverlay`, `PointerSensor`, `TouchSensor`)
- **Documents** can be dragged into folders or to the workspace root
- **Folders** can be reordered and nested inside other folders
- Circular reference detection prevents folders from being dragged into their own descendants
- `RootDropZone` at the bottom of the tree allows moving items to the workspace root
- Visual feedback: drag overlay follows pointer, drop targets highlight with dashed outlines

### 4. Reactive `useIsMobile` Hook
- Replaced one-shot `window.matchMedia('(max-width:768px)').matches` with a reactive hook
- Listens for viewport changes via `matchMedia.addEventListener('change', ...)`
- Sidebar behavior updates instantly when rotating device or resizing window

### 5. MobileToolbar Parity
- Added **Underline** (U̲), **Highlight** (🖍), **Link** (🔗), **Comment** (💬) buttons
- Link input appears inline within the toolbar bar (no popup modal)
- URL validation with automatic `https://` prefix for bare URLs
- Comment button reads the current text selection and delegates to `onAddComment`
- `SelectionToolbar` / BubbleMenu hidden on mobile via `display: none !important`

### 6. 44px Touch Targets + Keyboard Dismiss
- All `MobileToolbar` buttons now have `min-width: 44px; height: 44px` (WCAG AAA)
- Gap between buttons increased from 2px to 4px for easier tapping
- New **keyboard dismiss** button (⌨↓) at the end of the toolbar
- Calls `document.activeElement.blur()` to retract the virtual keyboard

### 7. Scroll Cursor into View on Keyboard Open
- `useVirtualKeyboard` hook now includes `scrollCursorIntoView` callback
- When virtual keyboard opens, the ProseMirror cursor (or active element) scrolls to center
- Works with both VirtualKeyboard API (Strategy 1) and visualViewport heuristic (Strategy 2)

### 8–9. Kanban Touch-Action + Drag Visual Feedback
- Changed `touch-action: none` → `touch-action: pan-y` on Kanban cards (vertical scroll preserved)
- Enhanced dragging state: `box-shadow: 0 8px 24px rgba(99, 102, 241, 0.3)` + dashed accent border

### 10. Haptic Feedback on Long-Press
- `FileCard.jsx` and `FolderCard.jsx` trigger `Platform.haptics.impact('light')` on 500ms long-press
- `TreeItem` in `HierarchicalSidebar` also now triggers haptic on long-press (was missing in v1.8.0)

### 11. Modal → ResponsiveModal Migration (9 Modals)
Migrated 9 modals from custom overlay+modal markup to `ResponsiveModal`, which auto-renders as a drag-to-dismiss `BottomSheet` on mobile:

| Modal | Size | Notes |
|-------|------|-------|
| `ConfirmDialog` | small | Removed manual Escape/scroll-lock handlers |
| `EditPropertiesModal` | small | Clean migration |
| `AppSettings` | large | Wrapped in fragment for portal compatibility |
| `WorkspaceSettings` | large | Extracted `handleClose` for unsaved-changes guard |
| `RelaySettings` | medium | Both return paths migrated |
| `TorSettings` | medium | Clean migration |
| `BugReportModal` | large | Updated screenshot overlay class references |
| `ShareDialog` | medium | Clean migration |
| `CreateWorkspace` | medium | Clean migration |

**Not migrated** (by design): `RecoveryCodeModal`, `KickedModal`, `SyncProgressModal` — these are non-dismissable and should remain as-is.

### 12. Toast / Toolbar Overlap Fix
- Toast `bottom` calc now includes 52px for MobileToolbar height:
  `bottom: calc(var(--bottom-nav-height, 0px) + var(--keyboard-height, 0px) + 52px + 12px + env(safe-area-inset-bottom, 0px))`

### 13. Sidebar Safe-Area + Backdrop Fade
- Sidebar backdrop now fades in via `@keyframes backdrop-fade-in` (0.25s ease)
- Sidebar receives `padding-left: env(safe-area-inset-left)` and `padding-bottom: env(safe-area-inset-bottom)` for notched devices

### 14. Long-Press Visual Feedback
- New `long-pressing` CSS class added during 500ms hold on touch
- `@keyframes long-press-squeeze` animation: scale 1→0.96, opacity 1→0.88
- Applied to `TreeItem`, `FileCard`, and `FolderCard` (all view modes)
- Class toggled via direct DOM manipulation (`classList.add/remove`) — no React re-renders

---

## 🧪 Testing

- **24 new E2E tests** in `48-mobile-ux-refinements.spec.js`
- **80 total tests passing** (specs 45–48 combined)
- **Zero regressions** in existing mobile (45, 46) and desktop (47) test suites
- Tests cover: sidebar transitions, edge-swipe zone, DnD styles, toolbar touch targets, SelectionToolbar hide, Kanban touch-action, bottom-sheet z-index/positioning, toast offset, backdrop animation, safe-area, long-press animations, desktop regression checks

---

## 📁 Files Modified

### Components
- `HierarchicalSidebar.jsx` — @dnd-kit integration, auto-close, haptic, long-press visual
- `HierarchicalSidebar.css` — drag-overlay, drop-target, grab cursor, long-press, backdrop fade, safe-area
- `AppNew.jsx` — edge-swipe gesture zone
- `MobileToolbar.jsx` — 5 new tools, keyboard dismiss, link inline input
- `MobileToolbar.css` — 44px targets, link input styles, SelectionToolbar hide, dismiss button
- `EditorPane.jsx` — passes `onAddComment` to MobileToolbar
- `FileCard.jsx` — long-press visual feedback
- `FolderCard.jsx` — long-press visual feedback
- `FileCard.css` — long-press-squeeze animation
- `FolderCard.css` — long-press-squeeze animation
- `Kanban.css` — touch-action pan-y, enhanced drag visual

### Hooks
- `useVirtualKeyboard.js` — scroll-cursor-into-view on keyboard open

### Modals (9 migrated)
- `ConfirmDialog.jsx`, `EditPropertiesModal.jsx`, `AppSettings.jsx`, `WorkspaceSettings.jsx`
- `RelaySettings.jsx`, `TorSettings.jsx`, `BugReportModal.jsx`, `ShareDialog.jsx`, `CreateWorkspace.jsx`

### Styles
- `global.css` — edge-swipe zone, toast bottom offset

### Tests
- `tests/e2e/specs/48-mobile-ux-refinements.spec.js` — 24 new tests

---

## 🔄 Upgrade Notes

- No breaking changes — all improvements are additive
- Desktop behavior is completely unchanged
- New dependency: none (all deps already present from v1.8.0)
