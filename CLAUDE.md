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
```

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
