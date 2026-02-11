# Nightjar v1.5.13 Release Notes

**Release Date:** February 11, 2026

This release includes significant improvements to collaboration features, chat functionality, spreadsheet presence visualization, and numerous bug fixes across the application.

---

## 🐛 Bug Fixes

### Chat & Messaging (v1.5.11 - v1.5.13)

- **Fixed @mention showing blank** - Mentions now properly convert from display format (`@Name`) to storage format (`@[Name](publicKey)`) when sending messages. Changed from `replace()` to `split().join()` to handle multiple mentions of the same user correctly.

- **Fixed group chat close button** - The close (×) button on chat tabs now works reliably. Added `onMouseDown` handler with `stopPropagation()` to prevent drag interference, increased button size and z-index for better clickability.

- **Fixed chat tab close events** - Added `preventDefault()` to close button clicks to ensure proper event handling.

- **Added chat debug logging** - Added console logging for mention conversion and tab close operations to aid in debugging.

### Presence & Collaboration (v1.5.11 - v1.5.13)

- **Fixed presence for ALL open documents** - Presence indicators now show for ALL documents a user has open, not just the active one. Changed from tracking single `openDocumentId` to array `openDocumentIds` in awareness state.

- **Fixed presence dot position in spreadsheets** - The presence dot is now correctly positioned at the upper-right corner of the selected cell. Fixed offset calculation to properly account for toolbar (40px), formula bar (28px), and column header (25px).

- **Added cell border for presence selection** - Added a colored border around cells selected by collaborators, making it easier to see where others are working.

- **Fixed sidebar focus indicator** - Added green ring indicator for focused users in the sidebar user list.

- **Fixed stale presence filtering** - Improved lastActive timestamp checking to properly filter out stale user sessions.

### Spreadsheet (v1.5.11 - v1.5.13)

- **Replaced unreliable Fortune Sheet presence API** - Implemented custom presence overlay system with dots and cell borders because Fortune Sheet's built-in presence API was unreliable.

- **Fixed format toolbar position** - The selection format toolbar now appears below the selected cell instead of covering it. Positioned at `(row + 1) * defaultRowHeight` for proper Y offset.

- **Fixed selection toolbar display** - Selection toolbar now shows proper cell coordinates and formatting options.

### Folder & Document Management (v1.5.12)

- **Fixed folder color not remembered** - EditPropertiesModal now properly syncs local state with item prop when the modal reopens. Added `useEffect` to update icon/color state when item changes.

- **Added folder sync debug logging** - Added debug logging to `handleSaveProperties`, `updateFolder`, `syncFolders`, and FolderContext to trace folder color persistence issues.

### Kanban Board (v1.5.2+)

- **Fixed Kanban card textbox drag issue** - Text selection in card descriptions and inputs no longer triggers card drag operations.

- **Improved Kanban cell selection** - Better handling of cell selection and focus states.

- **Added selection toolbar for Kanban** - Cards now show a selection toolbar with formatting options.

### Editor (v1.5.2+)

- **Fixed editor cell selection** - Improved cell selection behavior in the main editor.

- **Added selection toolbar positioning** - Selection toolbar now properly positions based on selection coordinates.

- **Fixed EditorPane integration** - Better integration between EditorPane and selection toolbar components.

### Identity & Security (v1.5.2+)

- **Fixed identity settings display** - IdentitySettings component now properly displays current identity information.

- **Improved identity context** - Better handling of identity state and transitions.

- **Fixed presence context cleanup** - Improved cleanup of awareness state on unmount to prevent stale presence.

---

## ✨ New Features

### Desktop Notifications (v1.5.11)

- **Browser notification support** - Added desktop notification system for chat messages and mentions.
- **Notification permission request** - App now requests browser notification permission on startup.
- **Per-message-type notifications** - Different notification handling for DMs, mentions, group messages, and general messages.
- **Default enabled** - Desktop notifications are now enabled by default.

### Selection Toolbar Improvements (v1.5.11)

- **Enhanced toolbar styling** - Improved CSS for selection toolbar with better contrast and visibility.
- **Toolbar for all document types** - Selection toolbar now available for Editor, Sheet, and Kanban.

### Presence Visualization (v1.5.13)

- **Multi-document presence** - See collaborators across all open documents, not just the focused one.
- **Cell border highlighting** - Colored borders show exactly which cells collaborators are working in.
- **Expandable presence dots** - Hover over presence dots to see collaborator names.

---

## 🔧 Technical Improvements

### Sidecar (v1.5.2+)

- **Improved document sync** - Better handling of document synchronization across peers.
- **Enhanced logging** - More detailed logging for P2P sync operations.
- **Memory optimization** - Improved memory handling for large workspaces.

### Hooks & Context (v1.5.11 - v1.5.13)

- **useNotificationSounds** - Added `desktopNotifications` setting (default: true), `requestNotificationPermission()`, and `notifyForMessageType()` functions.
- **useWorkspaceSync** - Extended `setOpenDocumentId` to accept `allOpenDocIds` array parameter for multi-document presence tracking.
- **PresenceContext** - Added throttled cursor and selection updates with 100ms interval.

### CSS Improvements (v1.5.11 - v1.5.13)

- **Sheet.css** - Added `.sheet-presence-border` and `.sheet-presence-dot` styles for custom presence overlays.
- **Chat.css** - Improved `.tab-close` button styling with higher z-index and pointer-events.
- **Sidebar.css** - Added `.user-pip.focused` style for green ring indicator.
- **SelectionToolbar.css** - Enhanced toolbar styling and positioning.
- **Kanban.css** - Added selection-related styles.

---

## 📁 Changed Files Summary

| File | Changes |
|------|---------|
| `package.json` | Version bump to 1.5.13 |
| `frontend/src/AppNew.jsx` | Multi-document presence tracking, send all open tab IDs to awareness |
| `frontend/src/Editor.jsx` | Selection toolbar integration |
| `frontend/src/Editor.css` | Selection toolbar styling |
| `frontend/src/EditorPane.jsx` | Selection toolbar positioning and display |
| `frontend/src/components/Chat.jsx` | Mention fix, tab close fix, notification support, debug logging |
| `frontend/src/components/Chat.css` | Tab close button styling improvements |
| `frontend/src/components/Sheet.jsx` | Custom presence overlays with dots and borders, fixed toolbar position |
| `frontend/src/components/Sheet.css` | Presence border and dot styles |
| `frontend/src/components/SheetSelectionToolbar.jsx` | Enhanced toolbar functionality |
| `frontend/src/components/SelectionToolbar.css` | Improved toolbar styling |
| `frontend/src/components/Sidebar.jsx` | Focus indicator class binding |
| `frontend/src/components/Sidebar.css` | Focused user green ring style |
| `frontend/src/components/Kanban.jsx` | Selection toolbar integration |
| `frontend/src/components/Kanban.css` | Selection-related styles |
| `frontend/src/components/HierarchicalSidebar.jsx` | Debug logging for folder saves |
| `frontend/src/components/common/EditPropertiesModal.jsx` | useEffect to sync icon/color with item prop |
| `frontend/src/components/UserProfile.jsx` | Minor fixes |
| `frontend/src/components/Settings/IdentitySettings.jsx` | Display fixes |
| `frontend/src/contexts/FolderContext.jsx` | Debug logging for folder sync |
| `frontend/src/contexts/IdentityContext.jsx` | State handling improvements |
| `frontend/src/contexts/PresenceContext.jsx` | Throttled updates, cleanup improvements |
| `frontend/src/contexts/WorkspaceContext.jsx` | Minor fixes |
| `frontend/src/hooks/useNotificationSounds.js` | Desktop notifications, permission request |
| `frontend/src/hooks/useWorkspaceSync.js` | Multi-document presence, openDocumentIds array support |
| `sidecar/index.js` | Enhanced sync and logging |

---

## 🚀 Upgrade Notes

This release is backward compatible with v1.5.x. No migration steps required.

The new multi-document presence tracking (`openDocumentIds`) is backward compatible - the system still reads the legacy `openDocumentId` field for clients that haven't upgraded.

---

## 📊 Statistics

- **26 files changed**
- **863 insertions(+)**
- **151 deletions(-)**
- **1,371 tests passing**
