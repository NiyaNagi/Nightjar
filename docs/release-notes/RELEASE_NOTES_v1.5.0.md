# Nightjar v1.5.0 Release Notes

**Release Date:** February 10, 2026

This is a major release with critical bug fixes for chat and presence synchronization, plus a comprehensive notification sounds system with Do Not Disturb mode.

---

## 🐛 Bug Fixes

### Chat & Messaging

- **Fixed @mention crash** - Resolved `TypeError: u.forEach is not a function` that occurred when typing @ followed by a character in the chat. The `workspaceMembers` object is now properly converted to an array before being passed to the Chat component.

- **Fixed DM message sync** - Direct messages now sync correctly between users. Previously, DM channels used ephemeral `clientId` values that changed on each session reconnect, causing sender and receiver to compute different channel IDs. Now uses stable `publicKey` for consistent channel identification across sessions.

- **Fixed DM tab auto-open for receivers** - When receiving a DM, the chat tab now automatically opens for the recipient. Previously only the sender would see the DM tab.

### Presence & Collaboration

- **Added 100ms throttle to presence updates** - Cursor and selection updates are now throttled to 100ms to match the sidecar's `AWARENESS_THROTTLE_MS`, preventing excessive network traffic during rapid cursor movements.

- **Fixed presence indicator reliability** - Improved awareness state handling to ensure presence indicators display correctly on tabs, sidebar, and document editors.

### Kanban

- **Fixed Kanban card textbox drag issue** - Text selection in card descriptions and inputs no longer triggers card drag operations.

- **Fixed Kanban persistence race condition** - Resolved timing issues that could cause column/card data to not persist correctly.

### UI/UX

- **Improved changelog display** - Fixed changelog panel rendering and observer registration.

- **Fixed sync progress modal styling** - Added proper styling for the sync progress modal.

- **Improved color contrast** - Enhanced contrast for better readability in various UI elements.

---

## ✨ New Features

### Notification Sounds System

A comprehensive notification sounds system with customizable settings:

- **10 Sound Options** - Choose from: Chime, Pop, Ding, Bell, Subtle, Ping, Drop, Blip, Tap, Sparkle
- **Sound Picker UI** - Visual dropdown in Settings → Notifications with "Test" button to preview sounds
- **Master Volume Control** - Single volume slider (0-100%) for all notification sounds
- **Per-Message-Type Settings** - Enable/disable sounds for:
  - 💬 Direct Messages
  - @️ Mentions (@username)
  - 👥 Group Chat Messages
  - 📢 General Channel Messages (disabled by default to reduce noise)

### Do Not Disturb Mode

- **DND Toggle in Header** - Quick-access bell icon (🔔/🔕) in the tab bar for instant DND toggle
- **DND in Settings** - Also configurable in Settings → Notifications
- **Smart Muting** - When enabled, silences all sounds and desktop notifications
- **Badge Preservation** - Unread badges still update so you don't miss messages

### Deterministic Identity Colors

- **Consistent Colors Across Sessions** - User colors are now generated deterministically from their publicKey using a hash function
- **Same Color Everywhere** - Your color will be identical across all devices, sessions, and for all collaborators viewing you

---

## 🔧 Technical Improvements

### Chat Component Refactoring

- Migrated DM channel IDs from ephemeral `clientId` to stable `publicKey`
- Updated `getDmChannelId()` to use sorted publicKey prefixes for consistent channel naming
- Updated `startDirectMessage()`, `sendMessage()`, and `filteredMessages` to use publicKey-based routing
- Added `senderPublicKey` to message objects for proper attribution

### Presence Context Enhancements

- Added `useMemo`-based throttling for `updateCursor()` and `updateSelection()`
- Imported `generateIdentityColor()` for deterministic color assignment
- Added `publicKey` to awareness user state for DM routing

### New Files

- `frontend/src/hooks/useNotificationSounds.js` - Notification sounds hook with settings management
- `frontend/public/sounds/` - Directory containing 10 notification sound MP3 files
- `frontend/src/components/SyncProgressModal.jsx` - Sync progress UI component
- `frontend/src/components/SyncProgressModal.css` - Sync progress styling
- `frontend/src/contexts/WorkspaceSyncContext.jsx` - Workspace sync context
- `frontend/src/utils/changelogStore.js` - Changelog persistence utilities
- `tests/accessibility-axe.test.js` - Accessibility testing with axe-core

### Modified Files

- `frontend/src/AppNew.jsx` - workspaceMembers array conversion, presence tracking
- `frontend/src/components/Chat.jsx` - DM sync fixes, notification sounds integration
- `frontend/src/components/Chat.css` - Chat styling improvements
- `frontend/src/components/TabBar.jsx` - DND toggle component
- `frontend/src/components/TabBar.css` - DND button styling
- `frontend/src/components/common/AppSettings.jsx` - Extended notification settings UI
- `frontend/src/components/common/AppSettings.css` - Sound picker styling
- `frontend/src/contexts/PresenceContext.jsx` - Throttled updates, identity colors
- `frontend/src/utils/colorUtils.js` - Added `generateIdentityColor()` function
- `frontend/src/components/Kanban.jsx` - Drag fix for text inputs
- `frontend/src/components/KanbanCardEditor.jsx` - Card editor improvements
- `frontend/src/components/HierarchicalSidebar.jsx` - Sidebar enhancements
- `frontend/src/hooks/useWorkspaceSync.js` - Sync improvements
- `frontend/src/hooks/useWorkspacePeerStatus.js` - Peer status monitoring
- `sidecar/hyperswarm.js` - P2P improvements
- `sidecar/p2p-bridge.js` - Bridge enhancements
- `sidecar/relay-bridge.js` - Relay improvements

---

## 📦 Installation

Download the installer for your platform:
- **Windows:** `Nightjar-1.5.0-win-x64.exe`
- **macOS:** `Nightjar-1.5.0-mac-arm64.dmg` / `Nightjar-1.5.0-mac-x64.dmg`
- **Linux:** `Nightjar-1.5.0-linux-x64.AppImage`

---

## 🔊 Sound Files Note

The notification sound files included are placeholder MP3s. For production use, replace with actual royalty-free sounds from:
- [Pixabay Sound Effects](https://pixabay.com/sound-effects/) (CC0)
- [Mixkit](https://mixkit.co/free-sound-effects/) (Free license)
- [Freesound](https://freesound.org/) (Check individual licenses)

---

## 🧪 Testing

- All 1,371 unit tests pass ✅
- E2E smoke tests pass ✅
- Accessibility tests added with axe-core

---

## ⬆️ Upgrade Notes

- **Breaking Change for Existing DMs:** Due to the switch from `clientId` to `publicKey` for DM channels, existing DM conversations may appear in new tabs. Message history is preserved in the Yjs document.
- **Settings Migration:** Notification settings will use new defaults; existing settings are preserved and extended.

---

## 🙏 Acknowledgments

Thanks to all contributors and testers who helped identify and fix these issues!
