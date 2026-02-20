# Bug Audit — Iteration 21 of 30

## Scope
**Final sweep of unaudited components in `frontend/src/components/`**

Listed all 136 `.jsx` files across the components directory (root, `common/`, `files/`, `Share/`, `Presence/`, `Settings/`, `Onboarding/`, `inventory/`). Cross-referenced against previously audited files and read every unaudited component — ~55 files total, including:

- **Root-level**: WorkspaceSwitcher, WorkspaceSettings (1195 lines), UserProfile (609), SyncProgressModal, PermissionWatcher, PermissionGuard, SplitPane, Sidebar, Toolbar, SimpleMarkdown, RelaySettings (419), KickedModal, CreateWorkspace (704), CreateDocument (339), CreateFolder, DocumentPicker, DocumentCollaborators, CollaboratorList, AccessDenied, PeersList, PeerCursors, PinInput, NightjarMascot, MiniToolbar, SheetSelectionToolbar (474)
- **common/**: HelpPage (549), IconColorPicker, AddDropdown (293)
- **Share/**: EntityShareDialog (280)
- **Settings/**: IdentitySettings (313)
- **files/**: BrowseView (785), TrashView, SearchBar, UploadZone, FileContextMenu, FileDetailPanel, FileMoveDialog, ReplaceDialog, MeshView (330), FileStorageDashboard (604), AuditLogView, DownloadsView, FolderCreateDialog, FileStorageSettings, FileCard, StorageView, FolderCard, BulkActionBar, BulkTagDialog, RecentView, FavoritesView, SearchFilters, FileTypeIcon, DistributionBadge

---

## Bugs Found & Fixed

### Bug 1 — Owner can't leave workspace when only co-owners exist (MEDIUM)
**File**: `frontend/src/components/WorkspaceSettings.jsx`  
**Lines**: ~1100–1150

**Problem**: The `canOwnerLeave` guard is `isOwner && !isOnlyMember && (otherOwners.length > 0 || nonOwnerMembers.length > 0)`. When other owners exist but there are zero non-owner members, `canOwnerLeave` is `true` — so the "Leave Workspace" button renders. But the transfer confirmation UI only populates its dropdown from `nonOwnerMembers`, which is empty. The "Transfer & Leave" button is `disabled={!selectedNewOwner}`, so the owner is permanently stuck — they can see the leave button but can never complete the flow.

**Fix**: Added a branch that checks `otherOwners.length > 0`. When other owners exist, the owner sees a simple leave confirmation (no transfer needed) that calls `handleLeave` directly. The transfer-and-leave flow only shows when the owner is the sole owner with non-owner members to transfer to.

### Bug 2 — Multiple upload conflicts silently swallowed (MEDIUM)
**File**: `frontend/src/components/files/BrowseView.jsx`  
**Lines**: ~333–355

**Problem**: In `handleReplace` and `handleKeepBoth`, after calling `handleFilesSelected(pending.remaining)` — which may discover another filename conflict and set `pendingUploadRef.current` + `setReplaceInfo(...)` — the code immediately executes `pendingUploadRef.current = null` and `setReplaceInfo(null)`. This overwrites the newly-set conflict state, silently skipping the replace dialog for all subsequent conflicting files in a multi-file upload.

**Fix**: Moved `pendingUploadRef.current = null` and `setReplaceInfo(null)` to **before** the `onUploadFiles` call and `handleFilesSelected(pending.remaining)`. The pending data is captured in a local variable first. This way, `handleFilesSelected` can freely set new conflict state without it being immediately cleared.

---

## Components Reviewed — No MEDIUM+ Issues Found

The following components were reviewed and found to be clean:

| Component | Notes |
|-----------|-------|
| WorkspaceSwitcher | Clean keyboard nav, proper outside-click |
| UserProfile | Comprehensive tabs, proper localStorage persistence |
| SyncProgressModal | Clean timer lifecycle with cleanup |
| PermissionWatcher | Race condition guards in place |
| PermissionGuard | Clean HOC + hooks pattern |
| SplitPane | Correct event listener add/remove lifecycle |
| Sidebar | Clean composition with dialog management |
| Toolbar | Simple grouped buttons, no logic issues |
| SimpleMarkdown | XSS protection on links via `rel="noopener noreferrer"` |
| RelaySettings | Electron-only guard, proper toggle/save flow |
| KickedModal | Simple notification, clean |
| CreateWorkspace | Three join paths (P2P, new-style, legacy) — all correct |
| CreateDocument / CreateFolder | Proper validation, clean lifecycle |
| DocumentPicker / CollaboratorList | Correct sorting and rendering |
| EntityShareDialog | Proper permission-gated sharing with QR |
| IdentitySettings | Tab management with QR transfer flow |
| PinInput | Auto-focus and paste handling correct |
| SheetSelectionToolbar | Fortune Sheet integration clean |
| HelpPage | Static documentation content, focus trap |
| All files/* components | Clean CRUD patterns, proper drag-drop, valid filter logic |

---

## Test Results
```
Test Suites: 132 passed, 132 total
Tests:       6 skipped, 3873 passed, 3879 total
Time:        67.634s
```
