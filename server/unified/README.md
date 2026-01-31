# Nightjar Unified Server

A single server that provides everything needed for browser-based P2P collaboration.

## What It Does

| Feature | Description |
|---------|-------------|
| **Static Hosting** | Serves the Nightjar React app |
| **Signaling** | WebSocket server for WebRTC peer discovery |
| **Optional Persistence** | Stores encrypted workspace data (user choice) |

## Security Model

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Workspace Key = PBKDF2(userSecret, workspaceId)        │   │
│  │                                                          │   │
│  │  Data ──► Encrypt ──► Send to server                    │   │
│  │                                                          │   │
│  │  Server NEVER sees:                                      │   │
│  │  • User secret                                           │   │
│  │  • Workspace key                                         │   │
│  │  • Unencrypted content                                   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Server                                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Receives: Opaque encrypted blobs                       │   │
│  │  Stores: Opaque encrypted blobs                         │   │
│  │  Returns: Opaque encrypted blobs                        │   │
│  │                                                          │   │
│  │  Cannot decrypt. Cannot read. Zero knowledge.           │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Two Modes

### Pure P2P Mode (Default)
- Server only helps browsers find each other
- All data stays in browser IndexedDB
- When everyone leaves, data is only in their browsers
- No server storage whatsoever

### Persisted Mode (Opt-in)
- User clicks "Enable server backup" in workspace settings
- Browser encrypts data locally, sends encrypted blob to server
- Server stores blob it cannot read
- New users can get data even if original users offline
- Server is just an "always-on encrypted backup"

## Quick Start

```bash
# Install dependencies
cd server/unified
npm install

# Build frontend first
cd ../../frontend
npm run build

# Start server
cd ../server/unified
npm start
```

Server runs at http://localhost:3000

## Docker

```bash
# Build and run
cd server/unified
docker compose up -d

# Check logs
docker logs Nightjar

# Check health
curl http://localhost:3000/health
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `STATIC_PATH` | `../../frontend/dist` | Path to built React app |
| `DB_PATH` | `./data/Nightjar.db` | SQLite database path |
| `MAX_PEERS_PER_ROOM` | 100 | Max concurrent users per workspace |

## API

### WebSocket (`/signal`)

| Message | Direction | Description |
|---------|-----------|-------------|
| `join` | → Server | Join a workspace room |
| `joined` | ← Server | Confirmation with peer list |
| `signal` | ↔ | WebRTC signaling data |
| `enable_persistence` | → Server | Enable server storage |
| `store` | → Server | Send encrypted data |
| `sync_request` | → Server | Request stored data |
| `sync_response` | ← Server | Encrypted data from storage |

### HTTP

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `GET /api/workspace/:id/persisted` | Check if workspace has storage enabled |
| `GET /*` | Static files / SPA |

## For QNAP Deployment

See [../deploy/QNAP_GUIDE.md](../deploy/QNAP_GUIDE.md) for full instructions.

Quick version:
1. Build the Docker image
2. Run on port 3000
3. Set up reverse proxy with SSL
4. Forward port 443 on your router
