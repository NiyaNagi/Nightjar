# Nightjar - Project Context for Claude

## What is Nightjar?
Nightjar is a secure, peer-to-peer collaborative text editor with end-to-end encryption. It allows multiple users to edit documents in real-time without a central server storing their data.

## Tech Stack
- **Frontend**: React 18 + Vite
- **Editor**: TipTap (ProseMirror-based)
- **Real-time Sync**: Yjs (CRDT) + y-webrtc
- **Encryption**: TweetNaCl (NaCl cryptography)
- **Desktop**: Electron + Capacitor
- **P2P**: Hyperswarm (for Electron), WebRTC (for web)
- **Persistence**: SQLite (server), IndexedDB (browser)
- **Styling**: CSS Modules

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Frontend (React)                    │
├─────────────────────────────────────────────────────────┤
│  TipTap Editor  │  Workspace Manager  │  Identity/Keys  │
├─────────────────────────────────────────────────────────┤
│                    Yjs Document Layer                   │
├─────────────────────────────────────────────────────────┤
│  y-webrtc Provider  │  Encryption Layer (NaCl)          │
├─────────────────────────────────────────────────────────┤
│         Signaling Server (WebSocket)                    │
├─────────────────────────────────────────────────────────┤
│         Persistence Node (SQLite + Yjs)                 │
└─────────────────────────────────────────────────────────┘
```

## Key Directories

| Directory | Purpose |
|-----------|---------|
| `frontend/` | React application source |
| `frontend/src/components/` | Reusable UI components |
| `frontend/src/contexts/` | React contexts (workspace, identity, theme) |
| `frontend/src/hooks/` | Custom React hooks |
| `frontend/src/utils/` | Crypto, sync, storage utilities |
| `server/signaling/` | WebRTC signaling server |
| `server/persistence/` | Document persistence node |
| `server/nginx/` | Nginx configuration |
| `server/docker/` | Docker build files |
| `server/deploy/` | Deployment guides |
| `sidecar/` | Electron sidecar (Hyperswarm P2P) |
| `tests/` | Jest test suites |

## Key Files

| File | Purpose |
|------|---------|
| `frontend/src/App.jsx` | Main application component |
| `frontend/src/utils/crypto.js` | Encryption/decryption with NaCl |
| `frontend/src/utils/sync.js` | Yjs document synchronization |
| `frontend/src/contexts/WorkspaceContext.jsx` | Workspace state management |
| `frontend/src/contexts/IdentityContext.jsx` | User identity and keys |
| `server/signaling/index.js` | WebSocket signaling server |
| `server/persistence/index.js` | Persistence node |

## Common Commands

```bash
# Development
npm run dev              # Start Vite dev server
npm run electron:dev     # Start Electron app

# Testing
npm test                 # Run Jest tests
npm run test:watch       # Watch mode

# Building
npm run build            # Build for production
npm run electron:build   # Build Electron app

# Docker
docker-compose -f server/docker/docker-compose.yml up
```

## Code Conventions

1. **React Components**: Functional components with hooks
2. **State Management**: React Context (no Redux)
3. **Async**: async/await, no callbacks
4. **Encryption**: All document content encrypted before leaving device
5. **Error Handling**: Try/catch with user-friendly error messages
6. **Testing**: Jest + React Testing Library

## Security Model

- User generates Ed25519 keypair on first use
- Workspace has its own symmetric key (XSalsa20-Poly1305)
- Only encrypted Yjs updates transmitted over network
- Signaling server never sees plaintext
- No user accounts or passwords (identity = keypair)

## Current Focus Areas

1. **P2P Sync**: WebRTC for browser, Hyperswarm for Electron
2. **Persistence**: Server nodes that store encrypted state
3. **Permissions**: Read/write/admin per workspace
4. **Offline**: Full offline support with sync on reconnect

## Testing

Tests are in `tests/` directory:
- Unit tests for crypto, hooks, utilities
- Integration tests for sync behavior
- E2E tests for UI flows

Run specific test: `npm test -- keyDerivation`

## Deployment

- Docker images built via GitHub Actions
- Auto-deploy to QNAP NAS with Watchtower
- Cloudflare Tunnel for public access
- See `server/deploy/QNAP_AUTO_DEPLOY.md`

## AI Assistant Commands

### Command: "start"

When the user says **"start"**, execute these steps:

1. **Kill existing processes** - Terminate any running Electron, Node sidecar, and unified server processes
   ```powershell
   Get-Process -Name "electron", "node" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
   ```

2. **Start the sidecar** (in a background terminal) - Required for P2P and crypto operations
   ```bash
   node sidecar/index.js
   ```

3. **Build and start the unified server** (in a background terminal)
   ```bash
   cd server/unified && npm start
   ```

4. **Build and start the Electron app** (in a background terminal)
   ```bash
   npm run dev
   ```

This provides a clean development environment by ensuring no stale processes are running.

### Command: "test all"

When the user says **"test all"**, execute this automated bug-fixing loop:

1. **Run all tests** using Ralph Wiggum mode (`npm run test:ralph`)
2. **Analyze all output** for any test failures
3. **Fix bugs one by one** - identify root causes and implement fixes
4. **Re-run failing tests** after each fix to verify they pass
5. **Run full test suite again** once individual fixes are verified
6. **Repeat until 0 failures** - the goal is to achieve a completely green test suite

### Command: "help"

When the user says **"help"**, display available AI assistant commands:
- `start` - Kill stale processes and start the full development environment
- `test all` - Run all tests and fix any failures in a loop until green
- `npm test` - Run unit tests once
- `npm run test:coverage` - Run tests with coverage report
