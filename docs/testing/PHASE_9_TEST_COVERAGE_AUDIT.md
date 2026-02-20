# Phase 9: Missing Test Cases Audit

## Executive Summary

This audit identifies gaps in test coverage for the Nightjar application. The codebase has **extensive test coverage** in many areas, but several critical components and edge cases lack adequate testing.

---

## 1. Test Directory Structure Analysis

### Unit Tests (`tests/*.test.js`)
| Test File | Coverage Area | Lines |
|-----------|---------------|-------|
| `accessibility.test.js` | ARIA, keyboard nav, focus management | 419 |
| `additional-components.test.js` | ConfirmDialog, AccessDenied, DocumentPicker, FolderTree, Comments, ShareDialog, PermissionGuard, Presence | 902 |
| `backup.test.js` | Backup creation and restoration | - |
| `breadcrumbs.test.js` | Breadcrumb navigation | - |
| `build.test.js` | Build configuration | - |
| `collaboratorSync.test.js` | Collaborator synchronization | - |
| `components.test.js` | StatusBar, TabBar, basic UI logic | 492 |
| `contexts.test.js` | WorkspaceContext, IdentityContext logic | 507 |
| `deletion.test.js` | Entity deletion workflows | - |
| `edge-cases.test.js` | Boundary conditions, extreme inputs | 345 |
| `entityTypes.test.js` | Document/folder/workspace types | - |
| `error-handling.test.js` | Graceful degradation, error recovery | 526 |
| `folderContext.test.js` | Folder state management, tree ops | 358 |
| `fuzz.test.js` | Randomized "Ralph Wiggum" testing | 387 |
| `hooks.test.js` | useWorkspaceSync, useDocumentManager | 722 |
| `identity.test.js` | BIP39, Ed25519, signing/verification | 218 |
| `invites.test.js` | Time-limited signed invites | 237 |
| `keyDerivation.test.js` | Argon2id hierarchical key derivation | 254 |
| `kick.test.js` | Member kick functionality | - |
| `linkHandler.test.js` | Deep link handling | - |
| `logger.test.js` | Logging utilities | - |
| `membership.test.js` | Workspace membership | - |
| `migration.test.js` | Data migration between versions | 281 |
| `p2p-services.test.js` | P2P service layer | - |
| `p2p-sync.test.js` | WebSocket sync, conflict resolution | 369 |
| `passwordGenerator.test.js` | Secure password generation | - |
| `security.test.js` | Crypto hardening, input validation | 252 |
| `sharing.test.js` | Share link generation/parsing | 241 |
| `sheet.test.js` | Spreadsheet component | 269 |
| `sidecar.test.js` | Sidecar crypto, identity storage | 473 |
| `ssl-cert.test.js` | SSL certificate handling | - |
| `ui-components.test.js` | IconColorPicker, AddDropdown, JoinWithLink, AppSettings, WorkspaceSwitcher | 449 |
| `upnp-mapper.test.js` | UPnP port mapping | - |
| `usePermission.test.js` | Permission checking hooks | 220 |
| `utilities.test.js` | cryptoUtils, platform, secureStorage, websocket | 430 |
| `workflows.test.js` | End-to-end user workflows | 310 |
| `workspaceContext.test.js` | Workspace state management | 298 |

### Integration Tests (`tests/integration/*.test.js`)
| Test File | Coverage Area |
|-----------|---------------|
| `awareness.test.js` | Awareness state sync |
| `chaos-e2e.test.js` | Chaos/stress testing |
| `collaboration-features-e2e.test.js` | Comments, chat features |
| `conflict-resolution.test.js` | CRDT conflict resolution |
| `cross-platform-sharing.test.js` | Cross-platform sharing |
| `cross-platform-sync.test.js` | Cross-platform sync |
| `crypto.test.js` | Encryption/decryption |
| `deletion-lifecycle.test.js` | Deletion workflows |
| `export-utils.test.js` | Export utilities |
| `folder-hierarchy.test.js` | Folder tree operations |
| `hyperswarm.test.js` | Hyperswarm P2P |
| `identity.test.js` | Identity management |
| `kanban-sync-e2e.test.js` | Kanban board sync |
| `large-documents.test.js` | Large document handling |
| `mobile-p2p.test.js` | Mobile P2P connectivity |
| `multi-client.test.js` | Multi-client scenarios |
| `network-boundary.test.js` | Network boundaries |
| `network-resilience.test.js` | Network failure recovery |
| `p2p-sync-e2e.test.js` | P2P synchronization |
| `permission-revocation.test.js` | Permission revocation |
| `permissions.test.js` | Permission system |
| `platform.test.js` | Platform detection |
| `qrcode.test.js` | QR code generation |
| `race-conditions.test.js` | Race condition handling |
| `relay-server.test.js` | Relay server functionality |
| `security.test.js` | Security features |
| `share-links.test.js` | Share link handling |
| `sheet-sync-e2e.test.js` | Spreadsheet sync |
| `sheet-sync.test.js` | Spreadsheet sync (unit) |
| `stress-e2e.test.js` | Stress testing |
| `text-sync-e2e.test.js` | Text document sync |
| `undo-redo.test.js` | Undo/redo functionality |
| `workspace-presence-e2e.test.js` | Workspace presence |

### E2E Tests (`tests/e2e/specs/*.spec.js`)
| Spec File | Coverage Area |
|-----------|---------------|
| `01-identity.spec.js` | Identity creation/restoration |
| `02-workspace.spec.js` | Workspace CRUD |
| `03-document.spec.js` | Document management |
| `04-cross-platform.spec.js` | Cross-platform APIs |
| `05-sharing.spec.js` | Sharing workflows |
| `06-collaboration.spec.js` | Real-time collaboration |
| `07-folders.spec.js` | Folder operations |
| `08-permissions.spec.js` | Permission enforcement |
| `09-sync.spec.js` | Sync operations |
| `10-comprehensive-api.spec.js` | API coverage |
| `11-unified-server-api.spec.js` | Unified server API |
| `12-trash-operations.spec.js` | Trash/restore |
| `13-ui-sharing.spec.js` | UI sharing flows |
| `14-cross-platform-sharing.spec.js` | Cross-platform sharing UI |

---

## 2. Source File to Test File Mapping

### Frontend Components (`frontend/src/components/*.jsx`)

#### ✅ Good Coverage
| Component | Test Location |
|-----------|---------------|
| `IconColorPicker.jsx` | `ui-components.test.js` |
| `AddDropdown.jsx` | `ui-components.test.js` |
| `JoinWithLink.jsx` | `ui-components.test.js` |
| `AppSettings.jsx` | `ui-components.test.js` |
| `ConfirmDialog.jsx` | `additional-components.test.js` |
| `AccessDenied.jsx` | `additional-components.test.js` |
| `DocumentPicker.jsx` | `additional-components.test.js` |
| `FolderTree.jsx` | `additional-components.test.js` |
| `PermissionGuard.jsx` | `additional-components.test.js` |
| `Sheet.jsx` | `sheet.test.js` |
| `Breadcrumbs.jsx` | `breadcrumbs.test.js` |
| `StatusBar.jsx` | `components.test.js` (logic only) |
| `TabBar.jsx` | `components.test.js` (logic only) |
| `WorkspaceSwitcher.jsx` | `ui-components.test.js` |
| `WorkspaceSettings.jsx` | `ui-components.test.js` |

#### ⚠️ Partial Coverage (Logic tested, not rendering)
| Component | Missing Tests |
|-----------|---------------|
| `Chat.jsx` | Component rendering, message sending, real-time updates |
| `Comments.jsx` | Integration tests reference it but not unit tested |
| `Kanban.jsx` | Logic tested via sync, needs rendering tests |
| `KanbanCardEditor.jsx` | No direct tests |

#### ❌ No Tests
| Component | Priority | Needed Tests |
|-----------|----------|--------------|
| `Toolbar.jsx` | **HIGH** | Rendering, button actions, formatting commands |
| `MiniToolbar.jsx` | MEDIUM | Context menu appearance, action handling |
| `SelectionToolbar.jsx` | MEDIUM | Selection-based actions |
| `SheetSelectionToolbar.jsx` | MEDIUM | Sheet-specific selection actions |
| `SplitPane.jsx` | LOW | Resize handling, layout calculations |
| `Sidebar.jsx` | MEDIUM | Navigation, collapse/expand, item selection |
| `HierarchicalSidebar.jsx` | MEDIUM | Tree navigation, drag-drop |
| `Changelog.jsx` | LOW | Rendering changelog entries |
| `NightjarMascot.jsx` | LOW | Animation states |
| `UserFlyout.jsx` | MEDIUM | Dropdown behavior, profile display |
| `UserProfile.jsx` | MEDIUM | Profile editing |
| `RelaySettings.jsx` | **HIGH** | Relay configuration, connection testing |
| `LockScreen.jsx` | **HIGH** | PIN entry, unlock flow |
| `PinInput.jsx` | **HIGH** | PIN masking, validation |
| `KickedModal.jsx` | MEDIUM | Modal behavior, re-join flow |
| `RecoveryCodeModal.jsx` | **HIGH** | Recovery code display, copy functionality |
| `DocumentCollaborators.jsx` | MEDIUM | Collaborator list display |
| `CollaboratorList.jsx` | MEDIUM | Collaborator management |
| `CreateDocument.jsx` | MEDIUM | Document creation form |
| `CreateFolder.jsx` | MEDIUM | Folder creation form |
| `CreateWorkspace.jsx` | MEDIUM | Workspace creation wizard |
| `IdentitySelector.jsx` | MEDIUM | Identity switching UI |

### Onboarding Components (`frontend/src/components/Onboarding/`)
| Component | Status | Needed Tests |
|-----------|--------|--------------|
| `OnboardingFlow.jsx` | ⚠️ E2E only | Unit tests for step transitions |
| `CreateIdentity.jsx` | ⚠️ E2E only | Form validation, mnemonic display |
| `RestoreIdentity.jsx` | ⚠️ E2E only | Mnemonic input, validation feedback |
| `ScanIdentity.jsx` | ❌ | QR scanning flow |

### Presence Components (`frontend/src/components/Presence/`)
| Component | Status | Needed Tests |
|-----------|--------|--------------|
| `PeerCursors.jsx` | ⚠️ | Cursor rendering, position updates |
| `PeersList.jsx` | ⚠️ | Peer list display |
| `PresenceIndicator.jsx` | ❌ | Online/offline state display |

### Share Components (`frontend/src/components/Share/`)
| Component | Status | Needed Tests |
|-----------|--------|--------------|
| `ShareDialog.jsx` | ⚠️ | Full rendering tests, permission selection |
| `EntityShareDialog.jsx` | ❌ | Entity-specific sharing |

### Settings Components (`frontend/src/components/Settings/`)
| Component | Status | Needed Tests |
|-----------|--------|--------------|
| `Settings.jsx` | ❌ | Settings panel rendering |
| `IdentitySettings.jsx` | ❌ | Identity management UI |
| `TorSettings.jsx` | ❌ | Tor configuration UI |

---

### Frontend Contexts (`frontend/src/contexts/*.jsx`)

| Context | Test File | Status |
|---------|-----------|--------|
| `WorkspaceContext.jsx` | `workspaceContext.test.js`, `contexts.test.js` | ✅ Good |
| `FolderContext.jsx` | `folderContext.test.js` | ✅ Good |
| `IdentityContext.jsx` | `contexts.test.js`, `identity.test.js` | ✅ Good |
| `PermissionContext.jsx` | `usePermission.test.js` | ✅ Good |
| `P2PContext.jsx` | `p2p-services.test.js` | ⚠️ Partial |
| `PresenceContext.jsx` | ❌ None | Missing |

**Missing for PresenceContext:**
- State initialization
- Peer join/leave events
- Cursor position updates
- Awareness state management

---

### Frontend Hooks (`frontend/src/hooks/*.js`)

| Hook | Test File | Status |
|------|-----------|--------|
| `useWorkspaceSync.js` | `hooks.test.js` | ✅ Good |
| `useDocumentManager.js` | `hooks.test.js` | ⚠️ Partial |
| `usePermission.js` | `usePermission.test.js` | ✅ Good |
| `usePeerManager.js` | ❌ None | Missing |
| `useAutoSave.js` | ❌ None | Missing |
| `useAutoLock.js` | ❌ None | Missing |
| `useAuthorAttribution.js` | ❌ None | Missing |
| `useChangelogObserver.js` | ❌ None | Missing |
| `useCopyFeedback.js` | ❌ None | Missing |
| `useEnvironment.js` | ❌ None | Missing |
| `useFocusTrap.js` | ❌ None | Missing |

**Priority Missing Hook Tests:**

1. **`usePeerManager.js`** - HIGH
   - Connection state management
   - Peer events
   - Error handling

2. **`useAutoSave.js`** - HIGH
   - Debounce timing
   - Save triggering
   - Error recovery

3. **`useAutoLock.js`** - HIGH
   - Inactivity detection
   - Lock triggering
   - Resume handling

4. **`useFocusTrap.js`** - MEDIUM
   - Focus containment
   - Tab order
   - Escape handling

---

### Frontend Utilities (`frontend/src/utils/*.js`)

| Utility | Test File | Status |
|---------|-----------|--------|
| `identity.js` | `identity.test.js` | ✅ Good |
| `backup.js` | `backup.test.js` | ✅ Good |
| `sharing.js` | `sharing.test.js`, `invites.test.js` | ✅ Good |
| `keyDerivation.js` | `keyDerivation.test.js` | ✅ Good |
| `cryptoUtils.js` | `utilities.test.js` | ✅ Good |
| `migration.js` | `migration.test.js` | ✅ Good |
| `linkHandler.js` | `linkHandler.test.js` | ✅ Good |
| `passwordGenerator.js` | `passwordGenerator.test.js` | ✅ Good |
| `logger.js` | `logger.test.js` | ✅ Good |
| `collaboratorSync.js` | `collaboratorSync.test.js` | ✅ Good |
| `platform.js` | `utilities.test.js`, `integration/platform.test.js` | ✅ Good |
| `exportUtils.js` | `integration/export-utils.test.js` | ✅ Good |
| `qrcode.js` | `integration/qrcode.test.js` | ✅ Good |
| `websocket.js` | `utilities.test.js` | ⚠️ Partial |
| `secureStorage.js` | ❌ None | Missing |
| `secureLogger.js` | ❌ None | Missing |
| `diagnostics.js` | ❌ None | Missing |
| `colorUtils.js` | ❌ None | Missing |
| `collaboratorTracking.js` | ❌ None | Missing |
| `identityManager.js` | ❌ None | Missing |
| `mobile-p2p.js` | `integration/mobile-p2p.test.js` | ⚠️ Partial |

---

### Frontend Services (`frontend/src/services/p2p/*.js`)

| Service | Test File | Status |
|---------|-----------|--------|
| `PeerManager.js` | `p2p-services.test.js` | ⚠️ Partial |
| `AwarenessManager.js` | `integration/awareness.test.js` | ⚠️ Partial |
| `BootstrapManager.js` | ❌ None | Missing |
| `P2PWebSocketAdapter.js` | ❌ None | Missing |

**Protocol Layer (`frontend/src/services/p2p/protocol/`):**
| File | Status |
|------|--------|
| `messages.js` | ⚠️ Partial (via integration tests) |
| `serialization.js` | ❌ None |

**Transports (`frontend/src/services/p2p/transports/`):**
| Transport | Status | Needed Tests |
|-----------|--------|--------------|
| `BaseTransport.js` | ❌ | Event emitter, connection lifecycle |
| `WebSocketTransport.js` | ⚠️ | Connection, reconnection, message handling |
| `WebRTCTransport.js` | ⚠️ | Offer/answer, ICE, data channels |
| `HyperswarmTransport.js` | ⚠️ | Topic joining, peer discovery |
| `mDNSTransport.js` | ❌ | Service discovery, announcement |

---

### Frontend Providers (`frontend/src/providers/*.js`)

| Provider | Test File | Status |
|----------|-----------|--------|
| `SyncProvider.js` | ❌ None | Missing |
| `WebRTCProvider.js` | `integration/*` | ⚠️ Partial |
| `PersistenceManager.js` | ❌ None | Missing |
| `WebIdentityStore.js` | ❌ None | Missing |

---

### Sidecar Modules (`sidecar/*.js`)

| Module | Test File | Status |
|--------|-----------|--------|
| `crypto.js` | `sidecar.test.js`, `security.test.js` | ✅ Good |
| `identity.js` | `sidecar.test.js` | ✅ Good |
| `hyperswarm.js` | `integration/hyperswarm.test.js` | ⚠️ Partial |
| `p2p.js` | `p2p-sync.test.js` | ⚠️ Partial |
| `relay-server.js` | `integration/relay-server.test.js` | ✅ Good |
| `ssl-cert.js` | `ssl-cert.test.js` | ✅ Good |
| `upnp-mapper.js` | `upnp-mapper.test.js` | ✅ Good |
| `mesh.js` | ❌ None | **Missing - HIGH PRIORITY** |
| `mesh-constants.js` | ❌ None | Missing |
| `p2p-bridge.js` | ❌ None | **Missing - HIGH PRIORITY** |
| `relay-bridge.js` | ❌ None | **Missing - HIGH PRIORITY** |
| `index.js` | ❌ None | Missing (main entry point) |

---

## 3. Test Quality Assessment

### ✅ Well-Tested Areas

**Happy Path Coverage:**
- Identity generation and restoration
- Workspace CRUD operations
- Document creation and editing
- Share link generation and parsing
- Cryptographic operations (encryption, signing)
- Key derivation hierarchy

**Error Conditions:**
- `error-handling.test.js` covers localStorage failures, crypto failures
- Input validation tested in security tests
- Invalid key handling in crypto tests

**Edge Cases:**
- `edge-cases.test.js` covers boundary conditions
- `fuzz.test.js` provides randomized testing
- Base62 encoding boundaries tested
- Mnemonic edge cases tested

### ⚠️ Areas Needing Improvement

**Error Handling Gaps:**
1. Network timeout handling
2. WebRTC connection failures
3. Hyperswarm connection drops
4. IndexedDB quota exceeded
5. Service worker failures

**Edge Cases Missing:**
1. Maximum document size handling
2. Maximum collaborator count
3. Concurrent edit conflicts (stress scenarios)
4. Memory pressure situations
5. Very long folder paths

**Boundary Conditions Untested:**
1. Empty workspace operations
2. Zero collaborator scenarios
3. Maximum permission inheritance depth
4. Unicode in all user inputs

---

## 4. Missing Test Categories

### Unit Tests Needed

#### ❌ React Components Missing Tests
| Priority | Component | Test Scenarios |
|----------|-----------|----------------|
| HIGH | `Toolbar.jsx` | Formatting buttons, command execution, disabled states |
| HIGH | `Editor.jsx` | Content rendering, cursor position, selection |
| HIGH | `EditorPane.jsx` | Pane splitting, document switching |
| HIGH | `LockScreen.jsx` | PIN entry, validation, unlock |
| HIGH | `RelaySettings.jsx` | Relay configuration, connection test |
| MEDIUM | `Sidebar.jsx` | Navigation, item selection, collapse |
| MEDIUM | `Chat.jsx` | Message display, sending, real-time updates |
| MEDIUM | `CreateDocument.jsx` | Form validation, type selection |
| MEDIUM | `CreateWorkspace.jsx` | Multi-step wizard, validation |
| LOW | `SplitPane.jsx` | Resize behavior, min/max constraints |
| LOW | `Changelog.jsx` | Markdown rendering, version display |

#### ❌ Hooks Missing Tests
| Priority | Hook | Test Scenarios |
|----------|------|----------------|
| HIGH | `usePeerManager.js` | Connection state, events, cleanup |
| HIGH | `useAutoSave.js` | Debounce timing, error recovery |
| HIGH | `useAutoLock.js` | Inactivity detection, resume |
| MEDIUM | `useAuthorAttribution.js` | Author tracking, merge handling |
| MEDIUM | `useFocusTrap.js` | Focus containment, escape |
| LOW | `useEnvironment.js` | Platform detection |
| LOW | `useCopyFeedback.js` | Clipboard operations |

#### ❌ Utilities Missing Tests
| Priority | Utility | Test Scenarios |
|----------|---------|----------------|
| HIGH | `secureStorage.js` | Encryption/decryption, key rotation, quota |
| HIGH | `identityManager.js` | Multi-identity management |
| MEDIUM | `secureLogger.js` | Log sanitization, sensitive data filtering |
| MEDIUM | `diagnostics.js` | Report generation, data collection |
| LOW | `colorUtils.js` | Color conversions, contrast calculations |
| LOW | `collaboratorTracking.js` | Tracking state, cleanup |

#### ❌ Sidecar Missing Tests
| Priority | Module | Test Scenarios |
|----------|--------|----------------|
| **CRITICAL** | `mesh.js` | Mesh joining, relay discovery, workspace routing |
| **CRITICAL** | `p2p-bridge.js` | IPC communication, message routing |
| **CRITICAL** | `relay-bridge.js` | WebSocket relay, client forwarding |
| HIGH | `mesh-constants.js` | Topic generation, ID generation |
| MEDIUM | `index.js` | Sidecar initialization, cleanup |

### Integration Tests Needed

#### ⚠️ Component Interactions
| Priority | Scenario | Missing Tests |
|----------|----------|---------------|
| HIGH | Editor + Toolbar | Formatting commands affect editor |
| HIGH | Sidebar + Document | Document selection updates editor |
| HIGH | Share + Permission | Share link respects permissions |
| MEDIUM | Kanban + Comments | Comments on kanban cards |
| MEDIUM | Sheet + Presence | Multi-user cell editing |

#### ⚠️ Context Provider Chains
| Priority | Chain | Missing Tests |
|----------|-------|---------------|
| HIGH | Identity → Workspace → Document | Full context propagation |
| HIGH | P2P → Presence → Awareness | Real-time state sync |
| MEDIUM | Permission → PermissionGuard | Access control enforcement |

#### ⚠️ WebSocket Message Handling
| Priority | Scenario | Missing Tests |
|----------|----------|---------------|
| HIGH | Message ordering under load | Out-of-order messages |
| HIGH | Reconnection state sync | State recovery after disconnect |
| MEDIUM | Large message handling | Chunking, reassembly |

#### ⚠️ Yjs CRDT Operations
| Priority | Scenario | Missing Tests |
|----------|----------|---------------|
| HIGH | Concurrent text inserts | Interleaving resolution |
| HIGH | Delete + Insert conflicts | Tombstone handling |
| MEDIUM | Undo across peers | Distributed undo |
| MEDIUM | Very large document sync | Performance bounds |

### E2E Tests Needed

#### ❌ Complete User Flows
| Priority | Flow | Missing Tests |
|----------|------|---------------|
| HIGH | Onboarding → Workspace → Share | Full new user journey |
| HIGH | Recovery phrase → Restore | Account recovery flow |
| MEDIUM | Create → Collaborate → Leave | Workspace lifecycle |
| MEDIUM | Kick member → Re-invite | Member management cycle |

#### ❌ Multi-User Collaboration
| Priority | Scenario | Missing Tests |
|----------|----------|---------------|
| HIGH | 3+ simultaneous editors | Convergence under load |
| HIGH | Editor + Viewer presence | Mixed permission presence |
| MEDIUM | Offline → Online sync | Offline edit merging |
| MEDIUM | Mobile + Desktop sync | Cross-platform editing |

#### ❌ Offline/Online Transitions
| Priority | Scenario | Missing Tests |
|----------|----------|---------------|
| HIGH | Edit offline → Reconnect | Pending changes sync |
| HIGH | Conflict detection UI | User-facing conflict resolution |
| MEDIUM | Partial connectivity | Intermittent connection handling |

#### ❌ Error Recovery Flows
| Priority | Scenario | Missing Tests |
|----------|----------|---------------|
| HIGH | Network failure mid-edit | Edit preservation |
| HIGH | Server restart recovery | Session resumption |
| MEDIUM | Browser crash recovery | Storage persistence |
| MEDIUM | Sidecar crash recovery | IPC reconnection |

### Security Tests Needed

#### ❌ Authentication Bypass Attempts
| Priority | Test | Description |
|----------|------|-------------|
| **CRITICAL** | Invalid signature acceptance | Reject forged signatures |
| **CRITICAL** | Expired invite acceptance | Reject expired invites |
| HIGH | Key impersonation | Prevent identity spoofing |
| HIGH | Replay attacks | Reject replayed messages |

#### ❌ Authorization Checks
| Priority | Test | Description |
|----------|------|-------------|
| **CRITICAL** | Viewer → Edit attempt | Block edit operations |
| **CRITICAL** | Non-owner → Kick attempt | Block owner-only operations |
| HIGH | Permission elevation | Prevent self-promotion |
| HIGH | Cross-workspace access | Enforce isolation |

#### ❌ Input Validation
| Priority | Test | Description |
|----------|------|-------------|
| HIGH | Malformed share links | Graceful rejection |
| HIGH | XSS in document content | Sanitization |
| HIGH | Script injection in chat | Input escaping |
| MEDIUM | Unicode normalization | Consistent handling |

#### ❌ XSS Prevention
| Priority | Test | Description |
|----------|------|-------------|
| HIGH | HTML in document names | Escape rendering |
| HIGH | Scripts in user profile | Profile sanitization |
| HIGH | Markdown XSS | Safe markdown rendering |
| MEDIUM | SVG script injection | SVG sanitization |

#### ❌ Data Isolation Between Identities
| Priority | Test | Description |
|----------|------|-------------|
| **CRITICAL** | Identity A can't access B's data | Storage isolation |
| **CRITICAL** | Key separation | No key cross-contamination |
| HIGH | Cache isolation | Per-identity caching |
| MEDIUM | IndexedDB isolation | Database separation |

---

## 5. Priority Ranking for Missing Tests

### 🔴 CRITICAL (Security/Data Integrity)
1. **`mesh.js` unit tests** - Core P2P infrastructure
2. **`p2p-bridge.js` unit tests** - IPC security boundary
3. **`relay-bridge.js` unit tests** - WebSocket relay security
4. **Authorization bypass tests** - Permission enforcement
5. **Authentication tests** - Signature verification
6. **Data isolation tests** - Identity separation
7. **XSS prevention tests** - Input sanitization

### 🟠 HIGH (Core Functionality)
1. **`Toolbar.jsx` tests** - Primary editing interface
2. **`Editor.jsx`/`EditorPane.jsx` tests** - Core document editing
3. **`LockScreen.jsx`/`PinInput.jsx` tests** - Security UI
4. **`usePeerManager.js` tests** - Connection management
5. **`useAutoSave.js` tests** - Data persistence
6. **`useAutoLock.js` tests** - Security timeout
7. **`secureStorage.js` tests** - Encrypted storage
8. **`SyncProvider.js` tests** - Provider factory
9. **`PersistenceManager.js` tests** - Data persistence
10. **WebRTC connection failure tests** - Fallback handling
11. **Offline edit sync tests** - Data recovery
12. **Multi-user E2E tests (3+ users)** - Scale testing

### 🟡 MEDIUM (User Experience)
1. **`Sidebar.jsx` tests** - Navigation
2. **`Chat.jsx` tests** - Real-time messaging
3. **`CreateWorkspace.jsx` tests** - Onboarding
4. **`RelaySettings.jsx` tests** - Configuration
5. **`PresenceContext.jsx` tests** - Presence state
6. **Transport layer tests** - WebSocket, WebRTC
7. **Component interaction tests** - UI integration
8. **Context chain tests** - State propagation

### 🟢 LOW (Polish)
1. **`Changelog.jsx` tests** - Version display
2. **`NightjarMascot.jsx` tests** - Animation
3. **`SplitPane.jsx` tests** - Layout
4. **`useEnvironment.js` tests** - Platform detection
5. **`colorUtils.js` tests** - Color utilities
6. **`useCopyFeedback.js` tests** - UX feedback

---

## 6. Summary Statistics

| Category | Total Files | With Tests | Without Tests | Coverage |
|----------|-------------|------------|---------------|----------|
| Components (main) | 48 | 22 | 26 | 46% |
| Components (common) | 7 | 5 | 2 | 71% |
| Components (Onboarding) | 4 | 2 (E2E) | 2 | 50% |
| Components (Presence) | 4 | 1 | 3 | 25% |
| Components (Share) | 3 | 1 | 2 | 33% |
| Components (Settings) | 3 | 0 | 3 | 0% |
| Contexts | 6 | 5 | 1 | 83% |
| Hooks | 11 | 3 | 8 | 27% |
| Utilities | 21 | 14 | 7 | 67% |
| Services/P2P | 9 | 3 | 6 | 33% |
| Providers | 5 | 1 | 4 | 20% |
| Sidecar | 11 | 6 | 5 | 55% |

**Overall Estimated Test Coverage: ~52%**

---

## 7. Recommendations

### Immediate Actions (Next Sprint)
1. Add CRITICAL security tests for mesh/bridge modules
2. Add authorization bypass tests
3. Add `Toolbar.jsx` and `Editor.jsx` component tests
4. Add `usePeerManager.js` and `useAutoSave.js` hook tests

### Short-term (1-2 Sprints)
1. Complete HIGH priority component tests
2. Add provider tests (SyncProvider, PersistenceManager)
3. Add transport layer unit tests
4. Add offline/online E2E tests

### Long-term (3+ Sprints)
1. Achieve 80%+ code coverage
2. Add performance regression tests
3. Add visual regression tests
4. Add accessibility automated tests (axe-core)
5. Add continuous security scanning

---

*Report generated: Phase 9 Test Coverage Audit*
*Date: February 6, 2026*
---

## 8. Cycle 4 Coverage Gap Analysis (February 6, 2026)

### Coverage Summary

**Before Cycle 4:**
| Metric | Coverage |
|--------|----------|
| Statements | 11.19% (1349/12047) |
| Branches | 9.08% (711/7827) |
| Functions | 8.39% (221/2632) |
| Lines | 11.37% (1281/11265) |

**After Cycle 4:**
| Metric | Coverage |
|--------|----------|
| Statements | 11.85% (1428/12048) |
| Branches | 9.86% (772/7827) |
| Functions | 9.04% (238/2632) |
| Lines | 12.04% (1357/11266) |

**Test Count:** 1150 → 1215 (+65 new tests)

### Top 3 Critical Coverage Gaps Identified

#### 1. `frontend/src/utils/cryptoUtils.js` - **FIXED** ✅
- **Before:** 28.2% statement coverage
- **After:** 100% statement coverage
- **Issue:** Missing tests for security-critical functions
- **Functions now tested:**
  - `safeJsonParse()` - Prototype pollution protection
  - `sanitizeObject()` - Object sanitization
  - `sanitizeId()` - Path traversal protection
  - `isValidUrl()` - SSRF protection
  - `constantTimeSelect()` - Timing-safe conditional
  - `ClientRateLimiter` class - Rate limiting
  - `isValidKey()` / `isValidNonce()` - Key validation
  - `generateSecureKey()` / `generateSecureNonce()` - Key generation
  - `secureWipeString()` - Memory wiping

#### 2. `frontend/src/contexts/IdentityContext.jsx` - 0% coverage
- **Root cause:** React context providers require mock rendering
- **Impact:** Identity loading, storage, and creation logic untested
- **Recommendation:** Add integration tests with `@testing-library/react`
- **Key untested functions:**
  - `checkIdentityExists()` - Identity detection
  - `loadIdentity()` - Identity loading from storage
  - `createIdentity()` - New identity creation
  - `restoreIdentity()` - Recovery from mnemonic
  - `clearIdentity()` - Identity deletion

#### 3. `frontend/src/contexts/PermissionContext.jsx` - 0% coverage  
- **Root cause:** React context providers require mock rendering
- **Impact:** Permission checking, hierarchy resolution untested
- **Recommendation:** Add integration tests with workspace mocks
- **Key untested functions:**
  - `resolveFolderPermission()` - Permission inheritance
  - `getEffectivePermission()` - Entity permission resolution
  - `canPerform()` - Action authorization
  - `updatePermissionCache()` - Cache management

### Bug Fixed During Audit

**IPv6 Loopback SSRF Vulnerability** in `isValidUrl()`:
- **Issue:** IPv6 URLs like `https://[::1]` were not blocked because the hostname included brackets
- **Fix:** Added bracket stripping before pattern matching
- **Location:** `frontend/src/utils/cryptoUtils.js:303`

### New Tests Added

**File:** `tests/cryptoUtils-extended.test.js` (65 new tests)

| Test Suite | Tests | Purpose |
|------------|-------|---------|
| safeJsonParse | 9 | Prototype pollution protection |
| sanitizeObject | 8 | Object sanitization |
| sanitizeId | 8 | Path traversal protection |
| isValidUrl | 13 | SSRF/URL validation |
| constantTimeSelect | 4 | Timing-safe operations |
| ClientRateLimiter | 6 | Rate limiting |
| Key Validation | 5 | Key format validation |
| Nonce Validation | 3 | Nonce format validation |
| Key Generation | 5 | Secure key generation |
| secureWipeString | 4 | Memory wiping |

### Coverage Recommendations for Next Cycle

1. **React Context Testing:** Use `@testing-library/react` with mocked providers
2. **P2P Service Testing:** Mock Hyperswarm/WebRTC for transport tests
3. **Sidecar Testing:** Test via IPC mocking for Electron APIs
4. **E2E Coverage:** Expand Playwright tests for permission flows

---

## Cycle 6: P2P/Mesh Core Testing (February 2026)

### Critical Files Identified Without Tests

| File | Lines | Priority | Status |
|------|-------|----------|--------|
| `sidecar/mesh.js` | 656 | 🔴 Critical | ✅ Now tested |
| `sidecar/p2p-bridge.js` | 602 | 🔴 Critical | ✅ Now tested |
| `sidecar/relay-bridge.js` | 426 | 🔴 Critical | ✅ Now tested |
| `sidecar/hyperswarm.js` | 1077 | 🔴 Critical | ⚠️ Partial (integration) |
| `frontend/src/services/p2p/PeerManager.js` | 486 | 🔴 Critical | ✅ Now tested |
| `frontend/src/services/p2p/BootstrapManager.js` | 451 | 🔴 Critical | ⚠️ Via PeerManager mock |
| `frontend/src/services/p2p/AwarenessManager.js` | 283 | 🔴 Critical | ⚠️ Via PeerManager mock |
| `frontend/src/contexts/P2PContext.jsx` | 183 | 🔴 Critical | ✅ Now tested |

### Important Files Still Missing Tests

| File | Lines | Priority | Reason |
|------|-------|----------|--------|
| `frontend/src/hooks/usePeerManager.js` | 258 | 🟡 Important | React hook, needs renderHook |
| `frontend/src/utils/websocket.js` | 130 | 🟡 Important | Covered by P2PContext tests |
| `frontend/src/utils/diagnostics.js` | 195 | 🟡 Important | Console capture utilities |
| `frontend/src/utils/mobile-p2p.js` | ~200 | 🟡 Important | Mobile-specific P2P |
| `frontend/src/components/Share/*.jsx` | Multiple | 🟡 Important | UI components |
| `frontend/src/components/Presence/*.jsx` | Multiple | 🟡 Important | Real-time presence |

### Nice-to-Have Files Without Tests

| File | Priority | Reason |
|------|----------|--------|
| `frontend/src/components/Onboarding/*.jsx` | 🟢 Nice | Setup flow UIs |
| `frontend/src/components/Settings/*.jsx` | 🟢 Nice | Settings panels |
| `frontend/src/utils/colorUtils.js` | 🟢 Nice | Color manipulation |
| `frontend/src/utils/qrcode.js` | 🟢 Nice | QR code generation |

### New Tests Written (Cycle 6)

| Test File | Tests | Coverage |
|-----------|-------|----------|
| `tests/mesh.test.js` | 42 | mesh-constants, MeshParticipant, message handling |
| `tests/p2p-bridge.test.js` | 31 | P2PBridge client handling, topics, broadcast |
| `tests/relay-bridge.test.js` | 24 | RelayBridge backoff, connections, retries |
| `tests/peer-manager.test.js` | 38 | PeerManager initialization, workspaces, transports |
| `tests/p2p-context.test.js` | 22 | P2PContext, useP2P hook, WebSocket factory |

**Total new tests: 157**

### Key Test Patterns Established

1. **Sidecar Testing (Node.js environment)**
   ```javascript
   /**
    * @jest-environment node
    */
   jest.mock('../sidecar/hyperswarm', () => { /* ... */ });
   ```

2. **Transport Mocking**
   ```javascript
   jest.mock('../frontend/src/services/p2p/transports/WebSocketTransport', () => ({
     WebSocketTransport: jest.fn().mockImplementation(() => ({
       initialize: jest.fn().mockResolvedValue(),
       // ... all methods
     })),
   }));
   ```

3. **Mock WebSocket for Node.js**
   ```javascript
   function createMockWebSocket() {
     const ws = new EventEmitter();
     ws.readyState = 1;
     ws.sent = [];
     ws.send = function(data) { this.sent.push(data); };
     return ws;
   }
   ```

### Test Quality Verification

Existing tests were audited for actual test quality:

| File | Quality | Notes |
|------|---------|-------|
| `hooks.test.js` | ✅ Good | Tests actual logic, not just coverage |
| `components.test.js` | ✅ Good | Tests UI logic patterns |
| `contexts.test.js` | ✅ Good | Tests state management |
| `sidecar.test.js` | ✅ Excellent | Tests crypto, validation, security |
| `p2p-services.test.js` | ✅ Excellent | Tests protocol serialization |

### Remaining Gaps for Cycle 7

1. **React Hooks with renderHook**: `usePeerManager`, `useAutoLock`, `useChangelogObserver`
2. **Complex Components**: `Toolbar.jsx`, `HierarchicalSidebar.jsx`
3. **Mobile P2P**: Full mobile-p2p.js test suite
4. **Sidecar Hyperswarm**: Full hyperswarm.js unit tests (currently integration only)