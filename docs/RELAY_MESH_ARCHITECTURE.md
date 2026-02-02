# Nightjar Relay Mesh Network Architecture

## Executive Summary

The Nightjar Relay Mesh is a distributed peer-to-peer network that enables high-availability workspace synchronization across all Nightjar clients. Every desktop client and server participates in the mesh by default, creating a globally redundant network where workspaces can be discovered and synced through any available node.

**Key Features:**
- **Zero-configuration**: Share links bootstrap new nodes into the mesh automatically
- **High availability**: Workspace discovery works as long as ANY peer is online
- **Privacy-preserving**: Workspace topics are hashed; contents are end-to-end encrypted
- **Opt-out friendly**: Users can disable mesh participation while still using the app
- **Private relay support**: Organizations can run isolated relays with authentication

---

## System Architecture

### Overview Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              NIGHTJAR RELAY MESH                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                        HYPERSWARM DHT LAYER                              │    │
│  │                                                                          │    │
│  │   Topic: SHA256("nightjar-mesh-v1")  ← All public nodes join this       │    │
│  │                                                                          │    │
│  │   Operations:                                                            │    │
│  │   • Node discovery (find other relay nodes)                              │    │
│  │   • Workspace routing (find nodes hosting a workspace topic)             │    │
│  │   • Health announcements (relay capabilities, capacity)                  │    │
│  │                                                                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │   ELECTRON   │  │   UNIFIED    │  │   UNIFIED    │  │     WEB      │         │
│  │   DESKTOP    │  │   SERVER     │  │   SERVER     │  │   BROWSER    │         │
│  │              │  │   (Public)   │  │   (Private)  │  │              │         │
│  ├──────────────┤  ├──────────────┤  ├──────────────┤  ├──────────────┤         │
│  │ Hyperswarm   │  │ Hyperswarm   │  │ Hyperswarm   │  │ WebSocket    │         │
│  │ (Native)     │  │ (Native)     │  │ (Isolated)   │  │ (Via Relay)  │         │
│  ├──────────────┤  ├──────────────┤  ├──────────────┤  ├──────────────┤         │
│  │ Mesh: ON*    │  │ Mesh: ON     │  │ Mesh: OFF    │  │ Mesh: Query  │         │
│  │ Relay: Opt   │  │ Relay: Yes   │  │ Relay: Auth  │  │ Relay: No    │         │
│  │ Persist: No  │  │ Persist: Yes │  │ Persist: Yes │  │ Persist: No  │         │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘         │
│                                                                                  │
│  * Default ON, user can opt-out in Settings                                     │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Node Types

| Node Type | Mesh Role | Relay Role | Storage | Use Case |
|-----------|-----------|------------|---------|----------|
| **Electron Desktop** | Full participant (default ON) | Optional relay mode | Local only | End users |
| **Public Server** | Full participant | Always relay | SQLite persistence | Community hosting |
| **Private Server** | Isolated (no mesh) | Auth-gated relay | SQLite persistence | Organizations |
| **Web Browser** | Query only (via relay) | None | IndexedDB | Casual users |
| **Mobile App** | Query only (via relay) | None | Local storage | Mobile users |

---

## Protocol Specification

### 1. Mesh Discovery Protocol

All public nodes join a shared Hyperswarm topic for mesh coordination:

```javascript
// Mesh coordination topic (constant)
const MESH_TOPIC = sha256("nightjar-mesh-v1");

// Each node also joins workspace-specific topics
const workspaceTopic = sha256("nightjar-workspace:" + workspaceId);
```

### 2. Message Types

#### 2.1 Node Announcement (on MESH_TOPIC)

Sent periodically by relay-capable nodes:

```typescript
interface RelayAnnouncement {
  type: "relay-announce";
  nodeId: string;           // 32-byte hex node ID
  version: string;          // Server version (e.g., "1.2.0")
  capabilities: {
    relay: boolean;         // Can relay for web clients
    persist: boolean;       // Has persistence enabled
    maxPeers: number;       // Connection capacity
  };
  endpoints: {
    wss?: string;           // WebSocket Secure URL (e.g., "wss://relay.example.com")
    ws?: string;            // WebSocket URL (localhost/dev only)
  };
  workspaceCount: number;   // Number of active workspaces (not IDs - privacy)
  uptime: number;           // Seconds since start
  timestamp: number;        // Unix timestamp
  signature: string;        // Ed25519 signature of above fields
}
```

#### 2.2 Workspace Peer Query

Query the mesh for nodes hosting a specific workspace:

```typescript
interface WorkspacePeerQuery {
  type: "workspace-query";
  topicHash: string;        // SHA256 of workspace ID (not raw ID)
  requesterId: string;      // Requester's node ID
}

interface WorkspacePeerResponse {
  type: "workspace-response";
  topicHash: string;
  peers: Array<{
    nodeId: string;
    endpoints: { wss?: string; ws?: string };
    lastSeen: number;
  }>;
}
```

#### 2.3 Bootstrap Request

New nodes request routing table bootstrap:

```typescript
interface BootstrapRequest {
  type: "bootstrap-request";
  nodeId: string;
}

interface BootstrapResponse {
  type: "bootstrap-response";
  nodes: Array<{
    nodeId: string;
    endpoints: { wss?: string; ws?: string };
    capabilities: { relay: boolean; persist: boolean };
  }>;
}
```

### 3. Topic Hashing for Privacy

Workspace topics are hashed to prevent enumeration:

```javascript
// Raw workspace ID (private)
const workspaceId = "8c2b90c8dd0feb30c1c80a33fbb2854b";

// Public topic hash (safe to share on mesh)
const topicHash = sha256("nightjar-workspace:" + workspaceId);
// Result: "a3f2b1c4..." (64 hex chars)

// Nodes query/announce using topicHash only
// Cannot reverse hash to discover workspace IDs
```

### 4. Security: Token-Based Announcements

Prevent nodes from announcing workspaces they don't have:

```javascript
// 1. Node requests token from relay before announcing
const tokenRequest = { type: "token-request", topicHash, nodeId };

// 2. Relay generates IP-bound token
const token = sha256(requesterIP + secret + timestamp);
const tokenResponse = { type: "token", token, expiresAt: Date.now() + 600000 };

// 3. Node announces with token (relay verifies IP matches)
const announcement = { type: "workspace-announce", topicHash, token, nodeId };

// Token valid for 10 minutes, bound to IP
```

---

## Bootstrap Mechanism

### Share Link Bootstrap

Share links embed known relay nodes:

```
nightjar://w/ABC123#k:key&perm:e&nodes:relay1.nightjar.io,relay2.nightjar.io
```

**Bootstrap flow:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BOOTSTRAP SEQUENCE                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. USER RECEIVES SHARE LINK                                                 │
│     Link contains: workspace ID + encryption key + relay nodes              │
│                                                                              │
│  2. CLIENT PARSES LINK                                                       │
│     Extracts: nodes:relay1.nightjar.io,relay2.nightjar.io                   │
│                                                                              │
│  3. CLIENT CONNECTS TO EMBEDDED NODES                                        │
│     WebSocket → wss://relay1.nightjar.io                                    │
│     Sends: { type: "bootstrap-request", nodeId: "my-node-id" }              │
│                                                                              │
│  4. RELAY RESPONDS WITH ROUTING TABLE                                        │
│     { type: "bootstrap-response", nodes: [...50 known relays...] }          │
│                                                                              │
│  5. CLIENT JOINS MESH                                                        │
│     Connects to Hyperswarm DHT with received nodes as bootstrap             │
│     Announces presence on MESH_TOPIC                                         │
│                                                                              │
│  6. CLIENT QUERIES FOR WORKSPACE                                             │
│     { type: "workspace-query", topicHash: sha256(workspaceId) }             │
│                                                                              │
│  7. CLIENT RECEIVES PEER LIST                                                │
│     Connects directly to peers hosting the workspace                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Hardcoded Bootstrap Nodes

For users without a share link (creating first workspace):

```javascript
const BOOTSTRAP_NODES = [
  "wss://relay1.nightjar.io",
  "wss://relay2.nightjar.io",
  "wss://relay3.nightjar.io"
];
```

These are maintained by the Nightjar project and serve as initial entry points.

---

## Server Deployment

### Docker Image

Single image with mode selection:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm ci --production
EXPOSE 3000
CMD ["node", "server/unified/index.js"]
```

### Environment Variables

```bash
# Mode selection
NIGHTJAR_MODE=host          # "host" (default), "relay", or "private"

# Network
PORT=3000                   # HTTP/WebSocket port
PUBLIC_URL=https://my-relay.example.com  # Announced to mesh

# Mesh participation
MESH_ENABLED=true           # Join public mesh (false for private)
MESH_BOOTSTRAP=relay1.nightjar.io,relay2.nightjar.io

# Private mode authentication
AUTH_ENABLED=false          # Require auth tokens
AUTH_SECRET=                # Secret for JWT signing

# Persistence (host mode only)
PERSIST_ENABLED=true        # Store encrypted documents
DB_PATH=./data/nightjar.db  # SQLite database path

# Rate limiting
RATE_LIMIT_WINDOW=60000     # 1 minute
RATE_LIMIT_MAX=100          # Max requests per window
```

### Docker Compose (Complete Stack)

```yaml
version: '3.8'

services:
  nightjar:
    image: nightjar/unified-server:latest
    ports:
      - "443:3000"
    environment:
      - NIGHTJAR_MODE=host
      - PUBLIC_URL=https://my-relay.example.com
      - MESH_ENABLED=true
    volumes:
      - nightjar-data:/app/data
    restart: unless-stopped

volumes:
  nightjar-data:
```

---

## Private Relay Specification

### Isolation Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PRIVATE RELAY ISOLATION                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   PUBLIC MESH                              PRIVATE RELAY                     │
│   ┌─────────────────────┐                 ┌─────────────────────┐           │
│   │ Relay A ◄──► Relay B│                 │ Private Relay       │           │
│   │     ▲           ▲   │                 │                     │           │
│   │     │           │   │     ──────X──── │ Does NOT announce   │           │
│   │     ▼           ▼   │    (No mesh     │ workspaces to mesh  │           │
│   │ Relay C ◄──► Relay D│     traffic)    │                     │           │
│   └─────────────────────┘                 │ CAN query public    │           │
│            ▲                              │ mesh for discovery  │           │
│            │                              └──────────┬──────────┘           │
│            │ Query only                              │                      │
│            └─────────────────────────────────────────┘                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Authentication Flow

```typescript
// 1. Client requests access
POST /api/auth/token
{
  "invite_code": "ABCD-1234-EFGH"
}

// 2. Server returns JWT
{
  "token": "eyJhbG...",
  "expiresAt": 1735689600
}

// 3. Client connects WebSocket with token
WebSocket: wss://private-relay.company.com?token=eyJhbG...
```

---

## Desktop Client Integration

### Mesh Participation Settings

```
Settings → Network → Mesh Participation

┌────────────────────────────────────────────────────────────┐
│ Relay Mesh Network                                         │
├────────────────────────────────────────────────────────────┤
│                                                            │
│ ☑ Participate in relay mesh (recommended)                 │
│                                                            │
│   Help other Nightjar users find workspace peers.          │
│   Your workspace contents are never shared - only          │
│   encrypted sync signals pass through your client.         │
│                                                            │
│ Current status: Connected to 47 mesh nodes                 │
│ Helping discover: 3 workspaces                             │
│                                                            │
│ ☐ Also act as a relay server                               │
│   Allow web browsers to sync through your client.          │
│   Port: [4445] (requires port forwarding)                  │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Core Mesh Infrastructure
- [x] Create architecture document
- [ ] Implement mesh constants module
- [ ] Implement `MeshParticipant` class in sidecar
- [ ] Add workspace topic join/announce with hashing
- [ ] Create mesh settings storage

### Phase 2: Server Mesh Integration
- [ ] Add mesh participation to unified server
- [ ] Implement WebSocket-to-Hyperswarm bridge
- [ ] Add relay announcement broadcasting
- [ ] Implement workspace peer query handling
- [ ] Add rate limiting for mesh queries

### Phase 3: Share Link Bootstrap
- [ ] Update share link generation to embed relay nodes
- [ ] Implement bootstrap request/response protocol
- [ ] Add fallback to hardcoded bootstrap nodes
- [ ] Update share link parsing to extract nodes

### Phase 4: Docker Packaging
- [ ] Create unified Dockerfile with mode selection
- [ ] Write docker-compose templates
- [ ] Create setup scripts
- [ ] Add health check endpoints

### Phase 5: Private Relay Support
- [ ] Implement authentication middleware
- [ ] Add invite code system
- [ ] Implement mesh isolation for private mode

### Phase 6: Desktop Integration
- [ ] Add mesh participation toggle to settings
- [ ] Implement mesh status display
- [ ] Integrate mesh discovery into workspace sync

---

## Security Considerations

| Threat | Mitigation |
|--------|------------|
| Sybil attack | Token-based announcements, IP binding |
| Workspace enumeration | Topics are SHA256 hashed |
| Traffic analysis | Use private relays for sensitive work |
| Malicious relay | E2E encryption, workspace keys never leave client |
| Eclipse attack | Multiple bootstrap nodes, diverse routing |

---

## Constants

```javascript
// Mesh coordination
export const MESH_TOPIC_V1 = "nightjar-mesh-v1";
export const WORKSPACE_TOPIC_PREFIX = "nightjar-workspace:";

// Bootstrap
export const BOOTSTRAP_NODES = [
  "wss://relay1.nightjar.io",
  "wss://relay2.nightjar.io",
  "wss://relay3.nightjar.io"
];

// Timeouts
export const BOOTSTRAP_TIMEOUT_MS = 5000;
export const RELAY_ANNOUNCE_INTERVAL_MS = 60000;
export const PEER_QUERY_TIMEOUT_MS = 3000;

// Limits
export const MAX_EMBEDDED_NODES = 5;
export const MAX_ROUTING_TABLE_SIZE = 100;
```

---

*Document Version: 1.0*
*Last Updated: February 2, 2026*
