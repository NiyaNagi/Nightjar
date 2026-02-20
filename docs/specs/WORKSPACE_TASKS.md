# Workspace & Permissions Implementation Tasks

**Reference:** [WORKSPACE_PERMISSIONS_SPEC.md](./WORKSPACE_PERMISSIONS_SPEC.md)  
**Total Tasks:** 24  
**Estimated Complexity:** High

---

## Phase 1: Data Model & Core Infrastructure

### Task 1.1: Define TypeScript Interfaces
**File:** `frontend/src/types/workspace.ts`
- [ ] Create `Workspace` interface
- [ ] Create `Folder` interface (update existing)
- [ ] Create `Document` interface (update existing)
- [ ] Create `CollaboratorEntry` interface
- [ ] Create `Permission` type and enum
- [ ] Create `ShareScope` type

### Task 1.2: Update Key Derivation for Hierarchy
**File:** `frontend/src/utils/keyDerivation.js`
- [ ] Add `deriveWorkspaceKey(password, workspaceId)`
- [ ] Add `deriveFolderKey(parentKey, folderId)` 
- [ ] Add `deriveDocumentKey(folderKey, documentId)`
- [ ] Add `deriveKeyChain(password, path)` for full hierarchy derivation
- [ ] Add key caching for derived hierarchy

### Task 1.3: Update Share Link Format
**File:** `frontend/src/utils/sharing.js`
- [ ] Update `generateShareLink()` to support workspace/folder/document types
- [ ] Add permission level to link format
- [ ] Update `parseShareLink()` to extract entity type and permission
- [ ] Add validation for permission levels

---

## Phase 2: Workspace Management

### Task 2.1: Create WorkspaceContext
**File:** `frontend/src/contexts/WorkspaceContext.jsx`
- [ ] Create `WorkspaceProvider` component
- [ ] Implement workspace CRUD operations
- [ ] Store current workspace ID
- [ ] Store list of all accessible workspaces
- [ ] Handle workspace switching
- [ ] Sync workspace metadata via WebSocket

### Task 2.2: Create Workspace Switcher UI
**File:** `frontend/src/components/WorkspaceSwitcher/WorkspaceSwitcher.jsx`
- [ ] Dropdown component at top of sidebar
- [ ] List all accessible workspaces with icons
- [ ] "Create Workspace" button
- [ ] Highlight current workspace
- [ ] Handle workspace selection

### Task 2.3: Create Workspace Dialog
**File:** `frontend/src/components/WorkspaceSwitcher/CreateWorkspaceDialog.jsx`
- [ ] Name input field
- [ ] Icon picker (emoji)
- [ ] Color picker
- [ ] Create button with validation
- [ ] Handle workspace creation flow

### Task 2.4: Empty State for New Users
**File:** `frontend/src/components/EmptyState/EmptyState.jsx`
- [ ] Welcome message for new users
- [ ] Prompt to create first workspace
- [ ] Option to join via share link
- [ ] Onboarding guidance

---

## Phase 3: Permission System

### Task 3.1: Create PermissionContext
**File:** `frontend/src/contexts/PermissionContext.jsx`
- [ ] Store local permission cache per workspace
- [ ] Implement permission resolution (check hierarchy)
- [ ] Handle permission upgrades (highest wins)
- [ ] Provide `hasPermission(entityId, action)` helper
- [ ] Provide `getMyPermission(workspaceId)` helper

### Task 3.2: Create Collaborator Sync System
**File:** `frontend/src/utils/collaboratorSync.js`
- [ ] Use Yjs Y.Map for collaborator list per workspace
- [ ] Add collaborator when they first access
- [ ] Track permission level, scope, and grant info
- [ ] Sync across all connected peers
- [ ] Handle permission upgrades

### Task 3.3: Create Collaborator List UI
**File:** `frontend/src/components/Collaborators/CollaboratorList.jsx`
- [ ] Show all collaborators with avatars
- [ ] Display permission level badges
- [ ] Show scope (workspace/folder/document)
- [ ] Owner can promote editors to owners
- [ ] Filter/search collaborators

### Task 3.4: Update Share Dialog for Permissions
**File:** `frontend/src/components/Share/ShareDialog.jsx`
- [ ] Add permission level dropdown (Owner/Editor/Viewer)
- [ ] Filter available levels based on user's permission
- [ ] Update share message to include permission info
- [ ] Disable sharing for items in trash

---

## Phase 4: Folder & Document Updates

### Task 4.1: Update FolderContext for Workspaces
**File:** `frontend/src/contexts/FolderContext.jsx`
- [ ] Add `workspaceId` to folder creation
- [ ] Filter folders by current workspace
- [ ] Auto-create trash folder per workspace
- [ ] Add `isTrash` flag support
- [ ] Implement folder nesting validation

### Task 4.2: Enforce Folder Requirement for Documents
**File:** `frontend/src/components/DocumentPicker.jsx`
- [ ] Remove ability to create root-level documents
- [ ] Auto-prompt folder selection when creating document
- [ ] Show "Documents must be in a folder" message
- [ ] Update document creation flow

### Task 4.3: Implement Trash Folder
**File:** `frontend/src/components/Trash/TrashFolder.jsx`
- [ ] Special UI for trash folder
- [ ] Show trashed items with delete date
- [ ] Restore button for each item
- [ ] "Empty Trash" button (owner/editor only)
- [ ] 30-day countdown indicator
- [ ] Disable share button for trashed items

### Task 4.4: Soft Delete System
**File:** `frontend/src/utils/trash.js`
- [ ] Implement `moveToTrash(entityId, entityType)`
- [ ] Store original location for restoration
- [ ] Implement `restoreFromTrash(entityId)`
- [ ] Implement `permanentlyDelete(entityId)`
- [ ] Implement 30-day auto-purge check
- [ ] CRDT-based delete/restore conflict resolution

---

## Phase 5: Navigation & Access Control

### Task 5.1: Update DocumentPicker for Scoped Access
**File:** `frontend/src/components/DocumentPicker.jsx`
- [ ] Show grayed-out inaccessible parent folders
- [ ] Only show accessible folders/documents
- [ ] Add "scope indicator" showing access level
- [ ] Update folder tree rendering for partial access

### Task 5.2: Share Link Navigation Handler
**File:** `frontend/src/utils/linkHandler.js`
- [ ] Parse incoming share links
- [ ] Derive keys and validate access
- [ ] Add workspace/folder/document to local storage
- [ ] Navigate directly to shared entity
- [ ] Update permission cache
- [ ] Handle already-have-access scenarios

### Task 5.3: Breadcrumb Navigation for Context
**File:** `frontend/src/components/Breadcrumbs/Breadcrumbs.jsx`
- [ ] Show full path: Workspace > Folder > ... > Document
- [ ] Gray out inaccessible ancestors
- [ ] Click to navigate (if accessible)
- [ ] Indicate current access scope

### Task 5.4: Permission-Gated UI Elements
**File:** `frontend/src/hooks/usePermission.js`
- [ ] Create `usePermission(entityId)` hook
- [ ] Create `useCanEdit()`, `useCanShare()`, `useIsOwner()` hooks
- [ ] Apply permission checks to all action buttons
- [ ] Show/hide UI based on permissions
- [ ] Disable editing for viewers

---

## Phase 6: Sidecar & Sync Updates

### Task 6.1: Update Sidecar for Workspaces
**File:** `sidecar/index.js`
- [ ] Add workspace CRUD message handlers
- [ ] Update metadata storage schema
- [ ] Implement workspace-scoped topics
- [ ] Handle workspace sync separately from document sync

### Task 6.2: Update Sidecar for Permissions
**File:** `sidecar/index.js`
- [ ] Store permission cache locally
- [ ] Handle permission sync messages
- [ ] Implement collaborator list storage
- [ ] Add permission-related message types

### Task 6.3: Update Sidecar for Trash
**File:** `sidecar/index.js`
- [ ] Handle trash folder specially
- [ ] Implement 30-day purge job (on startup check)
- [ ] Store trash metadata (original location, deleted date)
- [ ] Handle restore messages

---

## Phase 7: Migration & Polish

### Task 7.1: Data Migration System
**File:** `frontend/src/utils/migration.js`
- [ ] Detect old data format
- [ ] Create default workspace for existing content
- [ ] Migrate folders and documents
- [ ] Re-derive keys for new hierarchy
- [ ] Mark user as owner of migrated content
- [ ] Clean up old format data

### Task 7.2: Update App.jsx Integration
**File:** `frontend/src/App.jsx`
- [ ] Add WorkspaceProvider and PermissionProvider
- [ ] Integrate workspace switcher
- [ ] Handle share link deep-linking on startup
- [ ] Show empty state for new users
- [ ] Update editor loading for permissions

### Task 7.3: Testing & Edge Cases
- [ ] Test multi-user permission scenarios
- [ ] Test key derivation chain
- [ ] Test trash restore conflicts
- [ ] Test permission upgrade flow
- [ ] Test scoped access navigation
- [ ] Test migration from old format

---

## Task Dependencies

```
Phase 1 (Foundation)
    │
    ├── 1.1 Types
    ├── 1.2 Key Derivation ──────────┐
    └── 1.3 Share Links              │
                                     │
Phase 2 (Workspaces) ◄───────────────┤
    │                                │
    ├── 2.1 WorkspaceContext         │
    ├── 2.2 Switcher UI              │
    ├── 2.3 Create Dialog            │
    └── 2.4 Empty State              │
                                     │
Phase 3 (Permissions) ◄──────────────┤
    │                                │
    ├── 3.1 PermissionContext        │
    ├── 3.2 Collaborator Sync        │
    ├── 3.3 Collaborator UI          │
    └── 3.4 Share Dialog Update      │
                                     │
Phase 4 (Folders/Docs) ◄─────────────┘
    │
    ├── 4.1 FolderContext Update
    ├── 4.2 Document Folder Req
    ├── 4.3 Trash UI
    └── 4.4 Soft Delete
                    
Phase 5 (Navigation) ◄─── Phase 3, 4
    │
    ├── 5.1 Scoped DocumentPicker
    ├── 5.2 Link Handler
    ├── 5.3 Breadcrumbs
    └── 5.4 Permission Gating
                    
Phase 6 (Sidecar) ◄────── Phase 2, 3, 4
    │
    ├── 6.1 Workspace Support
    ├── 6.2 Permission Support
    └── 6.3 Trash Support
                    
Phase 7 (Migration) ◄──── All Phases
    │
    ├── 7.1 Migration System
    ├── 7.2 App.jsx Integration
    └── 7.3 Testing
```

---

## Implementation Order (Recommended)

1. **Task 1.1** - Types (foundation for everything)
2. **Task 1.2** - Key derivation (core crypto)
3. **Task 1.3** - Share links (updated format)
4. **Task 2.1** - WorkspaceContext
5. **Task 3.1** - PermissionContext
6. **Task 4.1** - FolderContext update
7. **Task 6.1** - Sidecar workspace support
8. **Task 6.2** - Sidecar permission support
9. **Task 2.2, 2.3, 2.4** - Workspace UI
10. **Task 3.2, 3.3** - Collaborator system
11. **Task 4.2, 4.3, 4.4** - Folder/document updates
12. **Task 5.1, 5.2, 5.3, 5.4** - Navigation
13. **Task 3.4** - Share dialog update
14. **Task 6.3** - Sidecar trash
15. **Task 7.1** - Migration
16. **Task 7.2** - App integration
17. **Task 7.3** - Testing

---

## Notes

- Reference spec document for detailed requirements
- Each task should be testable in isolation
- Maintain backwards compatibility during development
- Use feature flags if needed for gradual rollout
