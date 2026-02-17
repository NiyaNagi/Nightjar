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
| `NIGHTJAR_MODE` | `host` | Server mode: `host` (persistence + mesh), `relay` (mesh only), `private` (persistence, no mesh) |
| `PUBLIC_URL` | (none) | WebSocket URL for mesh relay announcements (e.g., `wss://relay.night-jar.io`). Required for relay mode. |
| `STATIC_PATH` | `../../frontend/dist` | Path to built React app |
| `DB_PATH` | `./data/Nightjar.db` | SQLite database path |
| `MAX_PEERS_PER_ROOM` | 100 | Max concurrent users per workspace |
| `NAHMA_DISABLE_PERSISTENCE` | `false` | Set to `true` to disable persistence (relay mode sets this automatically) |

## API

### WebSocket — Signaling (`/signal`)

| Message | Direction | Description |
|---------|-----------|-------------|
| `join` | → Server | Join a workspace room |
| `joined` | ← Server | Confirmation with peer list |
| `leave` | → Server | Leave room |
| `signal` | ↔ | WebRTC signaling data |
| `join-topic` | → Server | Join a P2P topic (Hyperswarm-style) |
| `leave-topic` | → Server | Leave a P2P topic |
| `peer-request` | → Server | Request peer list for topic |
| `peer-announce` | → Server | Announce self to topic peers |
| `webrtc-signal` | ↔ | Forward WebRTC signaling between specific peers |
| `relay-message` | → Server | Forward message to a specific peer in same topic |
| `relay-broadcast` | → Server | Broadcast message to all peers in same topics |
| `enable_persistence` | → Server | Enable server storage for this workspace |
| `store` | → Server | Send encrypted data for server storage |
| `sync_request` | → Server | Request stored data |
| `sync_response` | ← Server | Encrypted data from storage |
| `ping` / `pong` | ↔ | Keepalive |

### WebSocket — Document Sync (`/*` except `/signal`)

All other WebSocket paths use the **y-websocket** binary protocol for Yjs CRDT document synchronization. The URL path becomes the room/document name.

### HTTP REST API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check — returns JSON with rooms, uptime, mode |
| `/api/mesh/status` | GET | Mesh network status and peer info |
| `/api/mesh/relays` | GET | Top relay nodes (for share link embedding) |
| `/api/workspace/:id/persisted` | GET | Check if workspace has persistence enabled |
| `/api/invites` | POST | Create a share invite |
| `/api/invites/:token` | GET | Retrieve invite details |
| `/*` | GET | Static files / SPA fallback |

## Deployment

For step-by-step deployment instructions (VPS + Docker + Caddy), see: [../../docs/RELAY_DEPLOYMENT_GUIDE.md](../../docs/RELAY_DEPLOYMENT_GUIDE.md)

## For QNAP Deployment

See [../deploy/QNAP_GUIDE.md](../deploy/QNAP_GUIDE.md) for full instructions.

Quick version:
1. Build the Docker image
2. Run on port 3000
3. Set up reverse proxy with SSL
4. Forward port 443 on your router
