# Nightjar v1.8.5 — Mobile PWA Overhaul

**Release Date:** $(date)  
**Focus:** Mobile-native experience, PWA service worker, touch-first UX

---

## 🎯 Overview

This release transforms Nightjar's mobile experience into a world-class, native-feeling PWA. Every touch interaction, navigation pattern, and visual feedback system has been refined to meet platform conventions on iOS and Android.

---

## ✨ New Features

### MobileTabBar (Step 8)
- **5-tab bottom navigation**: Documents, Search, Chat, Comments, More
- Connection status indicator dot on Documents tab (connected/disconnected/syncing)
- Unread message badge on Chat tab with live count
- "More" bottom sheet with History, Fullscreen, and Bug Report options
- Hides when virtual keyboard is open or in inventory view
- Safe-area padding for notched devices

### Kanban Pagination Dots (Step 11)
- Dot indicator row at ≤480px showing active column position
- Dots use each column's color for visual consistency
- Tapping a dot scrolls to that column with smooth animation
- Tracks scroll position via `onScroll` and `scrollIntoView`

### Service Worker / PWA (Step 12)
- `vite-plugin-pwa` with Workbox `generateSW` strategy
- Auto-updating service worker (`registerType: 'autoUpdate'`)
- Precaches all static assets (JS, CSS, HTML, images, fonts)
- Runtime caching for Google Fonts (CacheFirst, 365-day TTL)
- Hourly update checks in background
- Only registers in web context (skips Electron and Capacitor)
- Offline-ready notification via `onOfflineReady` callback

---

## 🔧 Improvements

### Toast CSS Selectors (Step 1)
- Fixed BEM naming: `.toast.success` → `.toast--success` (and error, info, warning)
- Eliminates selector specificity issues and aligns with codebase conventions

### Comments Panel (Step 2)
- Full-screen comments panel now activates at ≤768px (was 480px)
- Prevents editor crush on tablets and larger phones

### Viewport Pinch-Zoom (Step 3)
- `maximum-scale=5` (was `1`) — users can now pinch-zoom the interface
- Complies with WCAG 2.1 accessibility guidelines

### Settings Navigation (Step 4)
- AppSettings: vertical column navigation on mobile (was horizontal scroll)
- WorkspaceSettings: tabs wrap instead of requiring horizontal scroll
- All tabs discoverable without scrolling

### PWA Manifest (Step 5)
- Added `id`, `lang`, `dir`, `categories` fields
- Added app shortcuts: "New Document" and "New Workspace"
- Retained maskable icon for Android adaptive icons

### Haptic Web Fallback (Step 6)
- `navigator.vibrate()` as fallback when Capacitor Haptics unavailable
- Duration scales with intensity: light=10ms, medium=15ms, heavy=20ms

### Touch Targets + Tab Scroll Fades (Step 7)
- Tab close button: 44px touch target on coarse pointers (was 32px)
- Scroll fade gradients on tab bar edges indicating more content

### MobileToolbar (Step 10)
- Positioned above MobileTabBar: `bottom: calc(--keyboard-height + --bottom-nav-height)`
- Scroll fade gradient indicators on toolbar scroll edges
- ResizeObserver-based fade state tracking

### Sidebar Auto-Close (Step 9)
- Sidebar collapses automatically when selecting a document on mobile
- Edge swipe zone widened from 20px to 40px for easier re-opening

### StatusBar + Tab Bar Actions (Step 8)
- StatusBar hidden on mobile (info moved to MobileTabBar)
- Tab bar action buttons hidden on mobile (replaced by MobileTabBar)

### Chat Mobile Integration (Step 8)
- `mobileVisible` prop controls Chat visibility from MobileTabBar
- `onUnreadChange` callback streams unread count to tab bar badge
- Chat bubble hidden on mobile — tab bar is sole toggle
- Desktop behavior completely unchanged

---

## 📁 Files Changed

| File | Change |
|------|--------|
| `frontend/src/styles/global.css` | Toast BEM selectors, `--bottom-nav-height` var, wider swipe zone |
| `frontend/src/components/Comments.css` | 768px breakpoint |
| `frontend/index.html` | `maximum-scale=5` |
| `frontend/src/components/common/AppSettings.css` | Vertical nav |
| `frontend/src/components/WorkspaceSettings.css` | Flex-wrap tabs |
| `frontend/public/manifest.json` | id, lang, dir, categories, shortcuts |
| `frontend/src/utils/platform.js` | `navigator.vibrate()` fallback |
| `frontend/src/components/TabBar.jsx` | Scroll fade indicators |
| `frontend/src/components/TabBar.css` | 44px touch targets, fade gradients, actions hidden |
| `frontend/src/components/MobileTabBar.jsx` | **NEW** — 5-tab bottom nav |
| `frontend/src/components/MobileTabBar.css` | **NEW** — tab bar styles |
| `frontend/src/AppNew.jsx` | MobileTabBar integration, showChat state, sidebar auto-close |
| `frontend/src/components/Chat.jsx` | mobileVisible, onUnreadChange props |
| `frontend/src/components/Chat.css` | .chat-minimized hidden on mobile |
| `frontend/src/components/StatusBar.css` | Hidden on mobile |
| `frontend/src/components/MobileToolbar.jsx` | Scroll fade wrapper, ResizeObserver |
| `frontend/src/components/MobileToolbar.css` | Positioned above tab bar, fade gradients |
| `frontend/src/components/Kanban.jsx` | Pagination dots, scroll tracking |
| `frontend/src/components/Kanban.css` | Dot styles at ≤480px |
| `vite.config.js` | VitePWA plugin configuration |
| `frontend/src/main.jsx` | SW registration (web-only) |

---

## 🧪 Test Coverage

- **50 new tests** in `tests/mobile-pwa-overhaul-v1.8.1.test.jsx`
- All 12 steps verified with structural source analysis
- Full suite: **159 suites, 5113 passed, 0 failed**
- Build verified clean with SW generation (28s, 17 precache entries)

---

## 📦 Dependencies Added

- `vite-plugin-pwa` (devDependency) — Workbox integration for Vite
