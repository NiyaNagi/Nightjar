# Instructions

* Always read entire files. Otherwise, you don’t know what you don’t know, and will end up making mistakes, duplicating code that already exists, or misunderstanding the architecture.  
* Commit early and often. When working on large tasks, your task could be broken down into multiple logical milestones. After a certain milestone is completed and confirmed to be ok by the user, you should commit it. If you do not, if something goes wrong in further steps, we would need to end up throwing away all the code, which is expensive and time consuming.  
* Your internal knowledgebase of libraries might not be up to date. When working with any external library, unless you are 100% sure that the library has a super stable interface, you will look up the latest syntax and usage via either Perplexity (first preference) or web search (less preferred, only use if Perplexity is not available)  
* Do not say things like: “x library isn’t working so I will skip it”. Generally, it isn’t working because you are using the incorrect syntax or patterns. This applies doubly when the user has explicitly asked you to use a specific library, if the user wanted to use another library they wouldn’t have asked you to use a specific one in the first place.  
* Always run linting after making major changes. Otherwise, you won’t know if you’ve corrupted a file or made syntax errors, or are using the wrong methods, or using methods in the wrong way.   
* Please organise code into separate files wherever appropriate, and follow general coding best practices about variable naming, modularity, function complexity, file sizes, commenting, etc.  
* Code is read more often than it is written, make sure your code is always optimised for readability  
* Unless explicitly asked otherwise, the user never wants you to do a “dummy” implementation of any given task. Never do an implementation where you tell the user: “This is how it *would* look like”. Just implement the thing.  
* Whenever you are starting a new task, it is of utmost importance that you have clarity about the task. You should ask the user follow up questions if you do not, rather than making incorrect assumptions.  
* Do not carry out large refactors unless explicitly instructed to do so.  
* When starting on a new task, you should first understand the current architecture, identify the files you will need to modify, and come up with a Plan. In the Plan, you will think through architectural aspects related to the changes you will be making, consider edge cases, and identify the best approach for the given task. Get your Plan approved by the user before writing a single line of code.   
* If you are running into repeated issues with a given task, figure out the root cause instead of throwing random things at the wall and seeing what sticks, or throwing in the towel by saying “I’ll just use another library / do a dummy implementation”.   
* You are an incredibly talented and experienced polyglot with decades of experience in diverse areas such as software architecture, system design, development, UI & UX, copywriting, and more.  
* When doing UI & UX work, make sure your designs are both aesthetically pleasing, easy to use, and follow UI / UX best practices. You pay attention to interaction patterns, micro-interactions, and are proactive about creating smooth, engaging user interfaces that delight users.   
* When you receive a task that is very large in scope or too vague, you will first try to break it down into smaller subtasks. If that feels difficult or still leaves you with too many open questions, push back to the user and ask them to consider breaking down the task for you, or guide them through that process. This is important because the larger the task, the more likely it is that things go wrong, wasting time and energy for everyone involved.



# Nightjar - Project Context for Claude

## What is Nightjar?
Nightjar is a secure, peer-to-peer collaborative editor with end-to-end encryption. It allows multiple users to edit documents, spreadsheets, and kanban boards in real-time without a central server storing their data.

## Tech Stack
- **Frontend**: React 18 + Vite
- **Editor**: TipTap (ProseMirror-based)
- **Spreadsheet**: Fortune Sheet
- **Real-time Sync**: Yjs (CRDT) + y-websocket
- **Encryption**: TweetNaCl (XSalsa20-Poly1305), Argon2id (hash-wasm)
- **Desktop**: Electron
- **P2P**: Hyperswarm (DHT) + libp2p + WebRTC
- **Persistence**: LevelDB (local), IndexedDB (browser)
- **Anonymity**: Tor hidden services (optional)

## Architecture

Nightjar uses an **Electron + Sidecar** pattern:

```
┌─────────────────────────────────────────────────────────┐
│                     Electron App                        │
├─────────────────────────────────────────────────────────┤
│  Main Process      │        Renderer (React)           │
│  • Window mgmt     │  • TipTap Editor                  │
│  • IPC bridge      │  • Fortune Sheet                  │
│  • Loading screen  │  • Workspace/Folder UI            │
├────────────────────┴────────────────────────────────────┤
│                  SIDECAR (Node.js)                      │
│  • Yjs WebSocket server (port 8080)                     │
│  • Metadata WebSocket server (port 8081)                │
│  • P2P: Hyperswarm + libp2p + Tor                       │
│  • LevelDB encrypted storage                            │
└─────────────────────────────────────────────────────────┘
```

## Key Directories

| Directory | Purpose |
|-----------|---------|
| `frontend/src/components/` | UI components (editor, sidebar, modals) |
| `frontend/src/contexts/` | React contexts (Workspace, Identity, Folder, Permission, Presence) |
| `frontend/src/hooks/` | Custom hooks (useWorkspaceSync, usePeerManager, etc.) |
| `frontend/src/services/p2p/` | P2P transport layer (WebSocket, WebRTC, Hyperswarm) |
| `frontend/src/utils/` | Crypto, sharing, key derivation utilities |
| `sidecar/` | Node.js backend (P2P, storage, identity) |
| `src/` | Electron main process |
| `server/` | Optional relay/persistence servers |
| `tests/` | Jest unit tests and integration tests |

## Key Files

| File | Purpose |
|------|---------|
| `src/main.js` | Electron main process, spawns sidecar |
| `sidecar/index.js` | Sidecar entry, Yjs server, metadata server |
| `sidecar/identity.js` | Ed25519 keypair, BIP39 mnemonic |
| `sidecar/crypto.js` | Encryption (XSalsa20-Poly1305) |
| `frontend/src/contexts/WorkspaceContext.jsx` | Workspace state, WebSocket to sidecar |
| `frontend/src/contexts/IdentityContext.jsx` | User identity and keys |
| `frontend/src/utils/keyDerivation.js` | Argon2id key derivation |
| `frontend/src/services/p2p/PeerManager.js` | Unified P2P API |

## Common Commands

```bash
# Development
npm run dev              # Start Vite + Electron dev mode

# Testing
npm test                 # Run Jest tests
npm run test:integration # Integration tests

# Building
npm run build            # Build frontend
npm run package:win      # Package Windows installer
npm run package:mac      # Package macOS DMG
npm run package:linux    # Package Linux AppImage

# Version Management
npm run version:bump:patch   # 1.3.1 → 1.3.2
npm run version:bump:minor   # 1.3.1 → 1.4.0  
npm run version:bump:major   # 1.3.1 → 2.0.0
npm run version:sync -- --tag v1.3.2  # Sync from specific tag
```

## Version Management

**Single source of truth**: `package.json` version field

The version is automatically read by:
- `src/main.js` → `global.APP_VERSION`
- `src/preload.js` → `electronAPI.appVersion`
- `sidecar/mesh-constants.js` → `getAppVersion()`
- `electron-builder` → installer filename

**GitHub Actions**: When pushing a version tag (e.g., `v1.3.2`), the CI workflow automatically syncs the version to package.json before building.

## Security Model

1. **Identity**: Ed25519 keypair from BIP39 mnemonic (12 words)
2. **Key Hierarchy**: Password → Argon2id → Workspace key → Folder key → Document key
3. **Encryption**: XSalsa20-Poly1305 (authenticated) with 4KB padding
4. **Sharing**: Password-protected links with Ed25519 signatures
5. **No accounts**: Identity = keypair you control

## Context Hierarchy

```jsx
<IdentityProvider>      // 1. User identity (no deps)
  <WorkspaceProvider>   // 2. Workspaces (needs identity)
    <FolderProvider>    // 3. Folders (needs workspace)
      <PermissionProvider>  // 4. Permissions
        <PresenceProvider>  // 5. Collaboration presence
          <App />
        </PresenceProvider>
      </PermissionProvider>
    </FolderProvider>
  </WorkspaceProvider>
</IdentityProvider>
```

## AI Assistant Commands

### Command: "start"
Kill existing processes and start development environment:
```bash
npm run dev
```

### Command: "test all"
Run all tests and fix failures:
```bash
npm test
```

### Command: "package"
Build distributable:
```bash
npm run package:win  # or :mac or :linux
```
