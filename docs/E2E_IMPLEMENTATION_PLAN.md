# E2E Cross-Platform Testing Implementation Plan

## Research Summary

### Port Configuration (from sidecar/index.js)
```javascript
const YJS_WEBSOCKET_PORT = 8080;       // Yjs sync WebSocket
const YJS_WEBSOCKET_SECURE_PORT = 8443; // WSS port
const METADATA_WEBSOCKET_PORT = 8081;   // Metadata WebSocket
const TOR_CONTROL_PORT = 9051;          // Tor control
const P2P_PORT = 4001;                  // P2P mesh

// Unified server (server/unified/index.js)
const PORT = process.env.PORT || 3000;
```

### Sidecar WebSocket Message Types (from sidecar/index.js)
```
Identity:
- list-identities, switch-identity

Workspace:
- list-workspaces, create-workspace, update-workspace, delete-workspace
- join-workspace, leave-workspace

Documents:
- list-documents, create-document, update-document, delete-document
- update-document-metadata, move-document, move-document-to-folder

Folders:
- list-folders, create-folder, update-folder, delete-folder

Trash:
- list-trash, trash-document, restore-document, purge-document
- restore-folder, purge-folder

P2P/Network:
- get-status, get-p2p-info, reinitialize-p2p, validate-relay-server
- toggle-tor, get-mesh-status, set-mesh-enabled, query-mesh-peers
- p2p-identity, p2p-join-topic, p2p-leave-topic, p2p-send, p2p-broadcast
- mdns-advertise, mdns-discover, mdns-stop

Other:
- set-key, clear-orphaned-data
```

### Components Requiring data-testid Attributes

**Onboarding Flow:**
- OnboardingFlow.jsx - welcome step, create/restore buttons
- CreateIdentity.jsx - name input, emoji picker, confirm button
- RestoreIdentity.jsx - recovery phrase input, restore button

**Workspace Management:**
- WorkspaceSwitcher.jsx - trigger, dropdown items, create/join buttons
- CreateWorkspace.jsx - tabs, name input, icon picker, color picker, confirm/join buttons
- WorkspaceSettings.jsx - share buttons, member list, settings controls

**Document Management:**
- CreateDocument.jsx - type selector, name input, folder selector, confirm button
- Sidebar.jsx - document list, folder tree, create button
- FolderTree.jsx - folder items, create folder button

**Editor:**
- Various editor components for text, sheet, kanban

**Status/Sync:**
- StatusBar.jsx - sync status, collaborator list, connection status

---

## Implementation Steps

### Step 1: Create Directory Structure
```
tests/e2e/
├── environment/
│   └── orchestrator.js
├── fixtures/
│   └── test-fixtures.js
├── helpers/
│   ├── sidecar-client.js
│   └── assertions.js
├── specs/
│   ├── 01-identity.spec.js
│   ├── 02-workspace.spec.js
│   ├── 03-document.spec.js
│   ├── 04-cross-platform.spec.js
│   └── ...
├── test-data/           (gitignored, created at runtime)
├── test-results/        (gitignored, created at runtime)
├── playwright.config.js (update existing)
└── run-e2e.js
```

### Step 2: Create orchestrator.js
- LogCollector class with color-coded output
- ManagedProcess class for spawn with log capture
- TestEnvironment class with:
  - startUnifiedServer(name, port, options)
  - startSidecar(name, ports, options)
  - cleanup()
  - saveLogs(filepath)
- waitForPort(port, timeout) utility
- Use ACTUAL ports: 8080/8081/8443 for sidecar, 3000 for unified

### Step 3: Create test-fixtures.js
- Playwright fixtures extending base test
- unifiedServer1/2 fixtures (ports 3000, 3001)
- electronSidecar1/2 fixtures (ports 8080-8081, 8090-8091)
- sidecarClient1/2 fixtures (WebSocket clients)
- webPage1/2 fixtures (browser contexts)
- testLogs fixture

### Step 4: Create sidecar-client.js
- WebSocket client matching ACTUAL protocol from sidecar/index.js
- Methods for all message types discovered:
  - Workspace: listWorkspaces, createWorkspace, deleteWorkspace, joinWorkspace
  - Documents: listDocuments, createDocument, deleteDocument
  - Folders: listFolders, createFolder, deleteFolder
  - Trash: listTrash, restoreDocument, purgeDocument
  - P2P: getP2PInfo, getStatus
- Request/response correlation with timeouts
- Event queue for broadcasts

### Step 5: Create assertions.js
- assertDocumentContent, assertDocumentCount
- assertMemberCount, assertPermission
- waitForSync, assertNoErrors

### Step 6: Update playwright.config.js
- Update baseURL if needed
- Add proper timeouts for cross-platform tests
- Configure reporters (html, json, list)
- Configure video/screenshot capture

### Step 7: Create run-e2e.js
- Import and initialize orchestrator
- Spawn Playwright with proper config
- Collect and export logs on completion
- Print summary with errors

### Step 8: Add data-testid Attributes to Components
Priority components:
1. OnboardingFlow.jsx - onboarding-welcome, create-identity-btn, restore-identity-btn
2. CreateIdentity.jsx - identity-name-input, emoji-picker-trigger, confirm-identity-btn
3. RestoreIdentity.jsx - recovery-phrase-input, restore-btn
4. WorkspaceSwitcher.jsx - workspace-selector, workspace-option-*, create-workspace-btn
5. CreateWorkspace.jsx - workspace-name-input, confirm-workspace-btn, share-link-input
6. CreateDocument.jsx - document-name-input, doc-type-*, create-document-confirm
7. Sidebar.jsx - workspace-sidebar, doc-*, new-document-btn
8. StatusBar.jsx - sync-status, collaborator-*

### Step 9: Create Spec Files
1. 01-identity.spec.js - Create, restore, update profile
2. 02-workspace.spec.js - CRUD, switch workspaces
3. 03-document.spec.js - Create all types, edit, delete
4. 04-cross-platform.spec.js - THE CRITICAL TESTS
5. 05-sharing.spec.js - Share link generation and joining
6. 06-collaboration.spec.js - Real-time sync, cursors
7. 07-folders.spec.js - Folder operations
8. 08-permissions.spec.js - Viewer/editor/owner
9. 09-sync.spec.js - Reliability, conflicts, reconnection

### Step 10: Add npm scripts
```json
{
  "scripts": {
    "test:e2e": "node tests/e2e/run-e2e.js",
    "test:e2e:headed": "node tests/e2e/run-e2e.js --headed",
    "test:e2e:debug": "PWDEBUG=1 node tests/e2e/run-e2e.js"
  }
}
```

---

## File-by-File Implementation Details

### orchestrator.js Key Points
- Use child_process.spawn with shell: true on Windows
- Capture stdout/stderr with 'data' events
- Use taskkill on Windows for cleanup
- Create isolated storage per test in test-data/
- Wait for port availability before returning

### sidecar-client.js Key Points
- Connect to ws://localhost:8081 (METADATA_WEBSOCKET_PORT)
- Message format: { type: string, ...payload }
- No explicit requestId in sidecar protocol - use event queue
- Handle 'workspace-list', 'document-list' broadcasts
- Handle 'status' updates

### test-fixtures.js Key Points
- Use 'worker' scope for servers (shared across tests in file)
- Use 'test' scope for clients (fresh per test)
- Clean up in fixture teardown

### Component data-testid Additions
Each component needs testids for:
- Interactive elements (buttons, inputs)
- Key state indicators (loaded, synced)
- List items (with dynamic ids)

---

## Implementation Order

1. ✅ Research complete
2. 📝 Write this plan document
3. Create environment/orchestrator.js
4. Create fixtures/test-fixtures.js  
5. Create helpers/sidecar-client.js
6. Create helpers/assertions.js
7. Update playwright.config.js
8. Create run-e2e.js
9. Add data-testid to React components (batch by component)
10. Create spec files (one at a time, testing each)

---

## Port Configuration for Tests

For running multiple instances:
```
Sidecar 1: YJS=8080, META=8081, WSS=8443
Sidecar 2: YJS=8090, META=8091, WSS=8453
Unified 1: PORT=3000
Unified 2: PORT=3001
```

These match the codebase defaults and allow testing cross-platform communication.
