# Nahma P2P Mesh Architecture Specification

**Version:** 1.0  
**Last Updated:** January 2026  
**Status:** Implemented

## Executive Summary

Nahma is a secure, peer-to-peer collaborative text editor with end-to-end encryption. This document describes the full P2P mesh architecture where all clients (Electron, Browser, Mobile) participate as equal peers using transport abstraction. Peers recursively bootstrap to create a maximally connected mesh with graceful degradation when any peer disconnects.

---

## Table of Contents

1. [Design Goals](#1-design-goals)
2. [System Architecture Overview](#2-system-architecture-overview)
3. [Transport Layer](#3-transport-layer)
4. [Peer Discovery & Bootstrap Protocol](#4-peer-discovery--bootstrap-protocol)
5. [Message Protocol](#5-message-protocol)
6. [Awareness Sync](#6-awareness-sync)
7. [Security Model](#7-security-model)
8. [Integration with Application Layer](#8-integration-with-application-layer)
9. [Configuration & Limits](#9-configuration--limits)
10. [File Structure](#10-file-structure)
11. [Testing Strategy](#11-testing-strategy)

---

## 1. Design Goals

### Primary Goals

- **Peer Equality**: All peer types (Electron, Browser, Mobile) are equal participants
- **Recursive Discovery**: Recursive peer discovery until `maxConnections` reached
- **Graceful Degradation**: When any peer disconnects, the mesh self-heals
- **Unified Awareness**: Cursor/presence sync across all transports
- **Single Abstraction**: Application code uses a unified `PeerManager` API

### Design Philosophy

Nahma prioritizes **unlinkability** and **unobservability** over raw performance. The system uses a "Local-First" software model where:

- Primary data copy resides on user's encrypted local storage
- Network serves as a synchronization bus for encrypted CRDT updates
- All sync data is encrypted with workspace key before transmission
- Signaling servers never see plaintext

---

## 2. System Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Application Layer                        │
│  ┌─────────────┐  ┌──────────────────┐  ┌───────────────────┐  │
│  │  React UI   │  │  TipTap Editor   │  │  Workspace Manager │  │
│  └─────────────┘  └──────────────────┘  └───────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                          Yjs CRDT Layer                          │
│  ┌─────────────┐  ┌──────────────────┐  ┌───────────────────┐  │
│  │   Y.Doc     │  │  Y.XmlFragment   │  │   Awareness       │  │
│  └─────────────┘  └──────────────────┘  └───────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                        P2P Service Layer                         │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                      PeerManager                             ││
│  │  ┌─────────────────┐  ┌──────────────────────────────────┐ ││
│  │  │ BootstrapManager│  │       AwarenessManager           │ ││
│  │  └─────────────────┘  └──────────────────────────────────┘ ││
│  └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│                        Transport Layer                           │
│  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  ┌───────────┐ │
│  │ WebSocket   │  │  WebRTC     │  │ Hyperswarm│  │   mDNS    │ │
│  │ (relay)     │  │  (direct)   │  │   (DHT)   │  │  (LAN)    │ │
│  └─────────────┘  └─────────────┘  └───────────┘  └───────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │ Browser  │   │ Electron │   │  Mobile  │
        │  Peer    │   │   Peer   │   │   Peer   │
        └──────────┘   └──────────┘   └──────────┘
```

### Transport Availability Matrix

| Transport        | Electron | Web Server | Browser | Mobile |
|------------------|:--------:|:----------:|:-------:|:------:|
| WebSocket (relay)| ✅       | ✅ (server)| ✅      | ✅     |
| WebRTC (direct)  | ✅       | ✅         | ✅      | ✅     |
| Hyperswarm (DHT) | ✅       | ✅         | ❌      | ❌     |
| mDNS (LAN)       | ✅       | ❌         | ❌      | ❌     |

### Connection Limits

| Peer Type  | Default Max | Configurable    | Persistence |
|------------|:-----------:|-----------------|-------------|
| Electron   | 50          | Yes (settings)  | LevelDB     |
| Web Server | 10,000      | Yes (env var)   | SQLite      |
| Browser    | 50          | Yes (settings)  | IndexedDB   |
| Mobile     | 50          | Yes (settings)  | SQLite      |

---

## 3. Transport Layer

### 3.1 BaseTransport Abstract Class

All transports extend `BaseTransport`, providing a consistent interface:

```javascript
class BaseTransport extends EventEmitter {
  constructor(name) { ... }
  
  // Core interface
  async initialize(config) { }
  async connect(peerId, address) { }
  async disconnect(peerId) { }
  async send(peerId, message) { }
  async broadcast(message) { }
  
  // Topic-based discovery
  async joinTopic(topic) { }
  async leaveTopic(topic) { }
  
  // State
  getConnectedPeers(): string[]
  isConnected(peerId): boolean
  getPeerCount(): number
  
  // Lifecycle
  async destroy() { }
}
```

**Events emitted:**
- `message` - `{ peerId, message, transport }`
- `peer-connected` - `{ peerId, transport, info }`
- `peer-disconnected` - `{ peerId, transport }`
- `error` - `{ error, transport }`

### 3.2 WebSocket Transport

**Purpose:** Relay-based communication for all client types

**Features:**
- Server connection with automatic reconnect (exponential backoff)
- Topic-based room joining
- WebRTC signal forwarding
- Ping/pong keepalive (30s interval)
- Message routing to specific peers via server relay

**Implementation:** `frontend/src/services/p2p/transports/WebSocketTransport.js`

```javascript
class WebSocketTransport extends BaseTransport {
  // Connect to relay server
  async connectToServer(url) { ... }
  
  // Join workspace topic
  async joinTopic(topic) { ... }
  
  // Send to specific peer via relay
  async send(peerId, message) { ... }
  
  // Forward WebRTC signaling
  async forwardWebRTCSignal(targetPeerId, signalData) { ... }
}
```

### 3.3 WebRTC Transport

**Purpose:** Direct peer-to-peer connections for low latency

**Features:**
- RTCPeerConnection with data channels
- ICE candidate handling (STUN servers)
- Signaling relay through WebSocket
- Ordered, reliable data channels

**Implementation:** `frontend/src/services/p2p/transports/WebRTCTransport.js`

```javascript
class WebRTCTransport extends BaseTransport {
  // Initiate connection (creates offer)
  async connect(peerId, address) { ... }
  
  // Handle incoming signaling
  async handleSignal(fromPeerId, signalData) { ... }
  
  // Set callback for sending signals
  setSignalingCallback(callback) { ... }
}
```

**Signaling Flow:**

```
┌────────┐                    ┌────────┐                    ┌────────┐
│ Peer A │                    │ Server │                    │ Peer B │
└───┬────┘                    └───┬────┘                    └───┬────┘
    │                             │                             │
    │── 1. Create Offer ──────────────────────────────────────▶│
    │                             │                             │
    │◀────────────────────────────────────── 2. Answer ────────│
    │                             │                             │
    │── 3. ICE Candidate ─────────────────────────────────────▶│
    │◀────────────────────────────────────── 4. ICE Candidate ─│
    │                             │                             │
    │◀══════════════════ 5. Direct Connection ═════════════════▶│
```

### 3.4 Hyperswarm Transport

**Purpose:** Decentralized DHT-based peer discovery (Electron only)

**Availability:** Electron (via sidecar), Server

**Features:**
- DHT-based topic discovery
- No central server required
- Connects through sidecar WebSocket (port 8081)
- Automatic reconnection

**Implementation:** `frontend/src/services/p2p/transports/HyperswarmTransport.js`

```javascript
class HyperswarmTransport extends BaseTransport {
  static isAvailable() {
    return window.electronAPI !== undefined;
  }
  
  // Join Hyperswarm topic
  async joinTopic(topic) { ... }
  
  // Communicates with sidecar
  _sendToSidecar(message) { ... }
}
```

### 3.5 mDNS Transport

**Purpose:** Local network peer discovery (Electron only)

**Availability:** Electron only

**Features:**
- Bonjour/Avahi service advertisement
- Zero-config LAN discovery
- Service name: `nahma-p2p`

**Implementation:** `frontend/src/services/p2p/transports/mDNSTransport.js`

```javascript
class mDNSTransport extends BaseTransport {
  static isAvailable() {
    return window.electronAPI !== undefined;
  }
  
  async startAdvertising() { ... }
  async stopAdvertising() { ... }
}
```

---

## 4. Peer Discovery & Bootstrap Protocol

### 4.1 BootstrapManager

**Purpose:** Manages initial connection and recursive peer discovery

**Implementation:** `frontend/src/services/p2p/BootstrapManager.js`

```javascript
class BootstrapManager extends EventEmitter {
  constructor(config) {
    this.maxConnections = config.maxConnections || 50;
    this.bootstrapTimeout = config.bootstrapTimeout || 10000;
    this.discoveryInterval = config.discoveryInterval || 30000;
  }
  
  // Start bootstrap process
  async bootstrap(connectionParams) { ... }
  
  // Recursive discovery
  async _recursiveDiscover() { ... }
  
  // Handle peer announcements
  handlePeerAnnouncement(peer) { ... }
  
  // Handle peer requests
  handlePeerRequest(fromPeerId) { ... }
}
```

### 4.2 Bootstrap Sequence

```
┌─────────────────────────────────────────────────────────────────┐
│                       Bootstrap Sequence                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. SEED CONNECTIONS                                             │
│     ├── Try WebSocket server (if URL provided)                   │
│     ├── Try bootstrap peers (from invite link)                   │
│     ├── Try Hyperswarm topic (Electron only)                     │
│     └── Start mDNS discovery (Electron only)                     │
│                                                                  │
│  2. RECURSIVE DISCOVERY (while peers < maxConnections)           │
│     ├── For each connected peer:                                 │
│     │   ├── Send PEER_REQUEST message                            │
│     │   ├── Receive PEER_LIST response                           │
│     │   └── Connect to new peers                                 │
│     └── Repeat until no new peers found (max 10 rounds)          │
│                                                                  │
│  3. ANNOUNCE SELF                                                │
│     └── Broadcast PEER_ANNOUNCE to all connected peers           │
│                                                                  │
│  4. PERIODIC DISCOVERY                                           │
│     └── Every 30s, announce self and discover new peers          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 Peer Address Format

```javascript
{
  peerId: string,           // Unique 16-byte hex identifier
  transports: {
    websocket: string|null, // WebSocket URL or null
    webrtc: boolean,        // Supports WebRTC
    hyperswarm: string|null,// Hyperswarm topic or null
    mdns: string|null       // mDNS service name or null
  },
  displayName: string,      // User display name
  color: string,            // User color (hex)
  lastSeen: number          // Timestamp
}
```

---

## 5. Message Protocol

### 5.1 Message Types

**Implementation:** `frontend/src/services/p2p/protocol/messages.js`

| Type | Constant | Purpose |
|------|----------|---------|
| `sync` | `SYNC` | Y.js CRDT updates |
| `awareness` | `AWARENESS` | Cursor/presence sync |
| `peer-request` | `PEER_REQUEST` | Request peer list |
| `peer-list` | `PEER_LIST` | Response with peer list |
| `peer-announce` | `PEER_ANNOUNCE` | Announce self to network |
| `webrtc-signal` | `WEBRTC_SIGNAL` | WebRTC signaling relay |
| `identity` | `IDENTITY` | Signed identity message |
| `ping` | `PING` | Keepalive ping |
| `pong` | `PONG` | Keepalive response |
| `disconnect` | `DISCONNECT` | Graceful disconnect |

### 5.2 Message Factories

```javascript
// Sync message for Y.js updates
createSyncMessage(docId, data, origin) → {
  type: 'sync',
  docId: string,
  data: string,      // Base64-encoded encrypted Y.js update
  origin: string,    // Source peer ID (loop prevention)
  timestamp: number
}

// Awareness message for presence
createAwarenessMessage(docId, states) → {
  type: 'awareness',
  docId: string,
  states: { [clientId]: AwarenessState },
  timestamp: number
}

// Peer discovery
createPeerRequestMessage() → { type: 'peer-request', timestamp }
createPeerListMessage(peers) → { type: 'peer-list', peers, timestamp }
createPeerAnnounceMessage(peer) → { type: 'peer-announce', peer, timestamp }

// WebRTC signaling
createWebRTCSignalMessage(targetPeerId, fromPeerId, signalData) → {
  type: 'webrtc-signal',
  targetPeerId: string,
  fromPeerId: string,
  signalData: RTCSessionDescription | RTCIceCandidate,
  timestamp: number
}
```

### 5.3 Message Flow

```
┌──────────┐                                              ┌──────────┐
│  Peer A  │                                              │  Peer B  │
└────┬─────┘                                              └────┬─────┘
     │                                                         │
     │─── PEER_REQUEST ──────────────────────────────────────▶│
     │◀─────────────────────────────────────── PEER_LIST ─────│
     │                                                         │
     │─── PEER_ANNOUNCE ─────────────────────────────────────▶│
     │◀────────────────────────────────────── PEER_ANNOUNCE ──│
     │                                                         │
     │─── SYNC (encrypted Y.js update) ──────────────────────▶│
     │◀────────────────────── SYNC (encrypted Y.js update) ───│
     │                                                         │
     │─── AWARENESS (cursor position) ───────────────────────▶│
     │◀──────────────────────── AWARENESS (cursor position) ──│
     │                                                         │
     │─── PING ───────────────────────────────────────────────▶│
     │◀───────────────────────────────────────────────── PONG ─│
```

---

## 6. Awareness Sync

### 6.1 AwarenessManager

**Purpose:** Unified cursor/presence sync across all transports

**Implementation:** `frontend/src/services/p2p/AwarenessManager.js`

```javascript
class AwarenessManager extends EventEmitter {
  constructor(config) {
    this.throttleMs = config.throttleMs || 100; // Max 10 updates/sec
  }
  
  // Set local awareness state
  setLocalState(state) { ... }
  setLocalStateField(field, value) { ... }
  
  // Get awareness states
  getStates(): { [clientId]: state }
  getStatesArray(): [{ clientId, ...state, isLocal }]
  
  // Handle peer disconnect (removes their states)
  _handlePeerDisconnect(event) { ... }
  
  // Remove stale clients
  removeStale(maxAge = 60000) { ... }
}
```

### 6.2 Awareness State Structure

```javascript
{
  clientId: string,      // Unique client identifier
  user: {
    name: string,        // Display name
    color: string,       // Cursor color (hex)
    icon: string         // User icon/avatar
  },
  cursor: {
    anchor: number,      // Selection anchor position
    head: number         // Selection head position
  },
  timestamp: number      // Last update time
}
```

### 6.3 Awareness Sync Flow

```
┌───────────────────────────────────────────────────────────────────┐
│                     Awareness Sync Algorithm                       │
├───────────────────────────────────────────────────────────────────┤
│                                                                    │
│  1. LOCAL STATE CHANGE                                             │
│     ├── User moves cursor or makes selection                       │
│     ├── setLocalState() or setLocalStateField() called             │
│     └── State updated with new timestamp                           │
│                                                                    │
│  2. THROTTLED BROADCAST (max 10/sec)                               │
│     ├── If time since last broadcast >= throttleMs                 │
│     │   └── Broadcast immediately                                  │
│     └── Else schedule broadcast after remaining time               │
│                                                                    │
│  3. RECEIVE REMOTE STATE                                           │
│     ├── Compare timestamp with existing state                      │
│     ├── Only update if newer (deduplication)                       │
│     └── Track peer → clientId mapping for cleanup                  │
│                                                                    │
│  4. PEER DISCONNECT                                                │
│     └── Remove all awareness states from that peer                 │
│                                                                    │
│  5. STALE REMOVAL                                                  │
│     └── Periodically remove states older than 60 seconds           │
│                                                                    │
└───────────────────────────────────────────────────────────────────┘
```

---

## 7. Security Model

### 7.1 Encryption

| Layer | Algorithm | Purpose |
|-------|-----------|---------|
| Identity | Ed25519 | Keypair generation, message signing |
| Workspace | XSalsa20-Poly1305 | Symmetric encryption of all sync data |
| Transport | TLS (WebSocket) | Transport-layer encryption |

### 7.2 Key Hierarchy

```
User Identity (Ed25519 keypair)
    │
    ├── Generated on first use
    └── Stored in secure local storage

Workspace Key (256-bit symmetric)
    │
    ├── Derived from password/invite link
    ├── Used for all document encryption
    └── Shared via encrypted invite link
```

### 7.3 Security Considerations

| Concern | Mitigation |
|---------|------------|
| Topic discovery | Use SHA256(password + workspaceId) for topics |
| Peer impersonation | Ed25519 signed identity messages |
| Message tampering | All sync data encrypted with workspace key |
| DoS via connections | Max connections limit, rate limiting |
| WebRTC IP leak | Optional TURN relay for privacy-sensitive users |
| Replay attacks | Timestamps in signed messages |

---

## 8. Integration with Application Layer

### 8.1 PeerManager Singleton

**Implementation:** `frontend/src/services/p2p/PeerManager.js`

```javascript
// Get singleton instance
const peerManager = getPeerManager(config);

// Initialize with identity
await peerManager.initialize({
  peerId: generatePeerId(),
  displayName: 'User Name',
  color: '#3b82f6',
  icon: '👤'
});

// Join workspace
await peerManager.joinWorkspace(workspaceId, {
  serverUrl: 'wss://sync.nahma.app',
  topic: await generateTopic(workspaceId)
});

// Send message
await peerManager.send(peerId, message);

// Broadcast to all
await peerManager.broadcast(message);

// Get awareness manager
const awareness = peerManager.getAwarenessManager(docId);
awareness.setLocalState({ cursor: { anchor: 10, head: 15 } });

// Listen for events
peerManager.on('peer-connected', (event) => { ... });
peerManager.on('sync', (event) => { ... });
peerManager.on('awareness', (event) => { ... });
```

### 8.2 React Hook

**Implementation:** `frontend/src/hooks/usePeerManager.js`

```javascript
function usePeerManager(config) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [connectedPeers, setConnectedPeers] = useState(0);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  return {
    // State
    isInitialized,
    connectedPeers,
    stats,
    error,
    
    // Methods
    initialize: async (identity) => { ... },
    joinWorkspace: async (workspaceId, params) => { ... },
    leaveWorkspace: async () => { ... },
    send: async (peerId, message) => { ... },
    broadcast: async (message) => { ... },
    getAwarenessManager: (docId) => { ... }
  };
}
```

### 8.3 Stats Object

```javascript
peerManager.getStats() → {
  peerId: string,
  isInitialized: boolean,
  currentWorkspaceId: string | null,
  currentTopic: string | null,
  connectedPeers: number,
  knownPeers: number,
  pendingConnections: number,
  transports: {
    websocket: { connected: boolean, peers: number },
    webrtc: { connected: boolean, peers: number },
    hyperswarm: { available: boolean, connected: boolean, peers: number },
    mdns: { available: boolean, connected: boolean, discovered: number }
  }
}
```

---

## 9. Configuration & Limits

### 9.1 Default Configuration

```javascript
const DEFAULT_CONFIG = {
  maxConnections: 50,          // Max simultaneous peer connections
  bootstrapTimeout: 10000,     // Bootstrap timeout (ms)
  discoveryInterval: 30000,    // Periodic discovery interval (ms)
  awarenessThrottle: 100,      // Min ms between awareness broadcasts
  sidecarUrl: 'ws://localhost:8081',  // Electron sidecar URL
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};
```

### 9.2 Environment Variables (Server)

```bash
MAX_CONNECTIONS=10000       # Server peer limit
SYNC_PORT=443               # WebSocket port
ICE_SERVERS=stun:...        # Custom STUN/TURN servers
```

---

## 10. File Structure

```
frontend/src/services/p2p/
├── index.js                    # Main exports
├── PeerManager.js              # Main P2P orchestrator
├── BootstrapManager.js         # Peer discovery
├── AwarenessManager.js         # Presence sync
├── P2PWebSocketAdapter.js      # Y.js WebSocket adapter
├── protocol/
│   ├── messages.js             # Message types & factories
│   └── serialization.js        # Encoding/decoding
└── transports/
    ├── BaseTransport.js        # Abstract base class
    ├── WebSocketTransport.js   # WebSocket relay
    ├── WebRTCTransport.js      # Direct P2P
    ├── HyperswarmTransport.js  # DHT discovery
    └── mDNSTransport.js        # LAN discovery

frontend/src/hooks/
└── usePeerManager.js           # React hook

sidecar/
├── index.js                    # Sidecar entry point
├── hyperswarm.js               # Hyperswarm integration
└── p2p.js                      # P2P utilities
```

---

## 11. Testing Strategy

### 11.1 Unit Tests

| Component | Tests |
|-----------|-------|
| PeerManager | Event emission, connection tracking, message routing |
| BootstrapManager | Recursive discovery, max connections limit, loop prevention |
| WebRTCTransport | Offer/answer flow, ICE handling, data channel |
| AwarenessManager | Deduplication, timestamp ordering, state merging |

### 11.2 Integration Tests

| Scenario | Setup | Verification |
|----------|-------|--------------|
| Browser ↔ Server | 2 browsers, 1 server | Y.js sync, awareness visible |
| Mobile ↔ Mobile | 2 mobile emulators | Direct WebRTC connection |
| Electron ↔ Electron | 2 Electron instances | Hyperswarm discovery |
| Mixed mesh | 1 of each client type | All peers see all updates |

### 11.3 E2E Tests

| Test | Description |
|------|-------------|
| Server disconnect | Remove server, verify P2P continues |
| Peer churn | Add/remove peers rapidly, verify consistency |
| Partition heal | Split network, rejoin, verify CRDT merge |
| Bootstrap chain | A→B→C→D discovery, verify D connects to A |

### 11.4 Manual Testing

```bash
# Test 1: Local Multi-Window
# Start sidecar and open multiple browser tabs
node sidecar/index.js
npm run dev
# Open http://localhost:5173 in multiple tabs

# Test 2: Cross-Machine
# Machine A: Enable Tor, copy invite link
# Machine B: Paste invite link
# Both should sync in real-time
```

---

## Appendix A: Related Documents

- [CLAUDE.md](../CLAUDE.md) - Project context and conventions
- [SYNC_ARCHITECTURE.md](SYNC_ARCHITECTURE.md) - Legacy sync architecture
- [CROSS_MACHINE_TESTING.md](CROSS_MACHINE_TESTING.md) - Cross-machine testing guide
- [WORKSPACE_PERMISSIONS_SPEC.md](WORKSPACE_PERMISSIONS_SPEC.md) - Permission system
- [Secure P2P Collaborative Text Editing.md](../Secure%20P2P%20Collaborative%20Text%20Editing.md) - Theoretical protocol design

## Appendix B: Tech Stack Summary

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + Vite |
| Editor | TipTap (ProseMirror-based) |
| Real-time Sync | Yjs (CRDT) |
| Encryption | TweetNaCl (NaCl) |
| Desktop | Electron + Capacitor |
| P2P | Hyperswarm (Electron), WebRTC (all) |
| Persistence | LevelDB (Electron), IndexedDB (browser), SQLite (server) |

---

*This specification reflects the implemented P2P mesh architecture as of January 2026.*
