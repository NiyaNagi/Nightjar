<p align="center">
  <img src="assets/nightjar-logo.png" alt="Nightjar" width="500" height="500">
</p>

<h1 align="center">Nightjar</h1>

<p align="center">
  <strong>Private, Peer-to-Peer Collaborative Editing</strong>
</p>

<p align="center">
  <a href="#why-nightjar">Why Nightjar</a> •
  <a href="#features">Features</a> •
  <a href="#download">Download</a> •
  <a href="#security">Security</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#global-relay-mesh-network">Relay Mesh</a> •
  <a href="#development">Development</a>
</p>

---

## Why Nightjar?

**Your documents belong to you, not the cloud.**

Traditional collaboration tools require trusting a third party with your most sensitive information. Every document you create, every edit you make, every comment you leave—all stored on servers you don't control, accessible to companies, hackers, and governments.

Nightjar takes a different approach:

- 🔐 **End-to-End Encrypted** — Your content is encrypted before it leaves your device. Not even relay servers can read your documents.
- 🌐 **Peer-to-Peer** — Connect directly with collaborators. No central server stores your data.
- 🧅 **Tor-Ready** — Optional Tor integration for anonymous collaboration when privacy is critical.
- 💾 **Local-First** — Your documents live on your device. Work offline, sync when connected.
- 🔑 **Self-Sovereign Identity** — Your cryptographic identity is yours. Back it up with a 12-word recovery phrase.

Whether you're a journalist protecting sources, an activist organizing securely, a business handling sensitive contracts, or simply someone who believes privacy is a fundamental right—Nightjar gives you collaboration without compromise.

---

## Features

### 📝 Rich Text Editor
- Full formatting: bold, italic, underline, strikethrough, highlight
- Headings, lists, blockquotes, code blocks
- Tables with resizable columns
- Import/export: Markdown, HTML, JSON, plain text

### 📊 Spreadsheets
- Multi-sheet workbooks with formula support
- Cell formatting and number formats
- Real-time collaborative editing
- Formula bar with live cell reference tracking

### 📋 Kanban Boards
- Visual project management with drag-and-drop cards
- Customizable columns and card details
- Real-time collaborative updates

### 📦 Inventory Management System *(New in v1.6)*
- **Multi-role workflow**: Administrators, Producers, and Requesters with role-specific dashboards
- **Request lifecycle**: Submit → Approve → Claim → Ship → Deliver with full status tracking
- **Smart assignment algorithm**: Priority queue with urgent + FIFO ordering
- **Capacity planning**: Track producer stock levels and production rates
- **Geographic visualization**: US state heatmap showing request distribution
- **CSV/XLSX import**: Smart column auto-mapping with validation preview
- **Encrypted addresses**: End-to-end encrypted shipping address handling (AES-GCM)
- **Catalog management**: Define item catalog with categories
- **Analytics dashboard**: 15-component suite — fulfillment histograms, pipeline funnel, pivot table, US state heatmap, producer leaderboard, response time charts, status transitions, demand trends, inflow/outflow analysis, blocked request aging, units shipped by type, and summary metrics with date range and export controls
- **Audit logging**: Complete history of all inventory operations

### � File Storage & P2P Transfer *(New in v1.7)*
- **Full dashboard**: Browse, search, mesh view, recent files, favorites, trash, downloads, and audit log
- **P2P file transfer**: End-to-end encrypted chunk-based transfer with seeding, bandwidth sampling, and progress tracking
- **Bulk operations**: Multi-select, tag, move, and delete across files and folders
- **Upload & download**: Drag-and-drop upload zones, download bars, file detail panels
- **Organization**: Folder creation, breadcrumb navigation, grid/list view toggle
- **Storage metrics**: Per-workspace storage usage with visual breakdown

### �👥 Real-Time Collaboration
- **Live cursor tracking** with collaborator names and colors
- **Document-level presence pips** showing who has each document open *(Enhanced in v1.5+)*
- **Focused state indicators** with glowing effect for active documents
- **Presence indicators** showing who's online with last-seen timestamps
- **Real-time commenting** on text selections, spreadsheet cells, and document sections
- **Built-in secure chat** with direct messaging and workspace channels
- **Conflict-free editing** using Yjs CRDT for automatic merge resolution
- **Permission-based access**: Owner, Editor, Viewer with granular controls
- **Member management**: Real-time member list, activity tracking, instant kick/ban
- **Workspace-wide notifications** for joins, edits, and system events

### 🔔 Notifications *(New in v1.5)*
- **Sound notifications** for messages, mentions, and workspace events
- **Do Not Disturb mode** to silence notifications when focused
- **Per-channel settings** for granular control
- **Visual indicators** with unread counts and badges

### 📁 Organization
- Workspaces to separate projects
- Nested folder hierarchy
- Drag-and-drop document management

### 🔗 Sharing
- **Cryptographically signed** invite links with Ed25519 signatures
- **Time-limited invitations** (maximum 24 hours, configurable expiry)
- **Fragment-based encryption** - keys embedded in URL fragment, never sent to servers
- **QR codes** for easy mobile sharing
- **Granular permissions**: Owner, Editor, Viewer
- **Instant revocation** - kick members and invalidate their access immediately
- **Workspace deletion** with secure data wiping

### 🌐 Privacy & Networking
- Tor hidden service support (Electron)
- Act as a relay for other peers
- Local network discovery via mDNS
- Works offline with automatic sync
- **Peer status monitoring** with connection health indicators *(v1.4+)*

---

## Download

Download the latest version for your platform:

| Platform | Download |
|----------|----------|
| **Windows** | [Nightjar Setup.exe](https://github.com/SaoneYanpa/Nightjar/releases/latest) |
| **macOS** | [Nightjar.dmg](https://github.com/SaoneYanpa/Nightjar/releases/latest) |
| **Linux** | [Nightjar.AppImage](https://github.com/SaoneYanpa/Nightjar/releases/latest) |

**Requirements:** Windows 10+ / macOS 10.15+ / Ubuntu 20.04+, 4GB RAM, 200MB disk

---

## Quick Start

1. **Download and install** Nightjar for your platform
2. **Choose your path**:
   - **New User**: Create fresh identity with 12-word recovery phrase
   - **Existing User**: Enter your recovery phrase to unlock/restore identity
3. **Save your recovery phrase** — Required for every session, keep it secure
4. **Create a workspace** — Your private container for documents
5. **Invite collaborators** — Share cryptographically signed, time-limited links
6. **Start collaborating** — Edits sync in real-time, encrypted end-to-end

**⚠️ Important**: Nightjar requires your 12-word recovery phrase every time you start the application. This "hard security" model prevents unauthorized access to your identity files.

---

## 🌐 Relay & P2P Architecture

Nightjar uses a **zero-config hybrid P2P architecture** that combines multiple networking strategies:

- **Electron clients:** Direct P2P via Hyperswarm DHT (no relay needed)
- **Browser clients:** Auto-detect relay from hosting server origin
- **Cross-platform:** Electron users can host relays via UPnP for browser peers

**No central server required** — workspaces are fully peer-to-peer with optional relays for browser clients.

### How It Works

1. **Browser-to-Browser:** Uses WebSocket relay (auto-detected from `window.location.origin`)
2. **Electron-to-Electron:** Direct P2P via Hyperswarm DHT (truly decentralized)
3. **Browser-to-Electron:** Electron embeds relay server, bridges to Hyperswarm mesh

### Custom Relay Configuration

For cross-network scenarios or private deployments, you can specify a custom relay server in Workspace Settings. The built-in validator tests connectivity and latency before use.

📖 **Learn more:**
- [Relay Architecture](docs/RELAY_ARCHITECTURE.md) - How P2P discovery works
- [Deploy Custom Relay](docs/RELAY_DEPLOYMENT.md) - Host your own relay server (Fly.io, Railway, Render, or self-hosted)

---

## Security

Nightjar is built with security as the foundation, not an afterthought.

### Onboarding Security Model

Nightjar implements a **"hard cutover"** security model that prioritizes data protection over convenience:

**New User Onboarding:**
1. Generate cryptographically random 12-word BIP39 recovery phrase
2. Create Ed25519 identity keypair from phrase
3. Encrypt identity with machine-specific key
4. Display recovery phrase with secure storage instructions

**Existing User Security Flow:**
1. **Identity Detection**: System scans for existing identity files
2. **Recovery Phrase Required**: Never auto-loads — always requires 12-word validation
3. **Cryptographic Verification**: Phrase mathematically verified against stored identity
4. **Three Possible Outcomes**:
   - ✅ **Unlock**: Phrase matches → restore access to existing workspaces
   - 🔄 **Restore**: Phrase doesn't match → create new identity file (may need re-invites)
   - 🗑️ **Delete & Create**: Explicitly delete existing data → fresh start

**Why "Hard Security"?**
- Prevents malware from auto-accessing identity files
- Stops unauthorized users on shared computers
- Ensures only recovery phrase holders can access data
- Forces explicit choice when identity conflicts occur

**Data Protection Warnings:**
- **Deletion is permanent** — explicit confirmation required
- **Recovery phrases cannot be retrieved** — must be stored securely
- **Lost phrases mean lost access** — no account recovery system

### Cryptographic Primitives

| Component | Algorithm | Details |
|-----------|-----------|---------|
| **Identity Keys** | Ed25519 | Signing keypairs for authentication |
| **Encryption** | XSalsa20-Poly1305 | Authenticated encryption (NaCl) |
| **Key Derivation** | Argon2id | Memory-hard KDF (64MB, 4 iterations) |
| **Recovery Phrase** | BIP39 | 12-word mnemonic (128-bit entropy) |
| **Scoped Encryption** | Curve25519 | ed2curve-derived encryption-only keys (inventory subsystem isolation) |

### How Your Data is Protected

1. **Hierarchical Key Derivation** — Workspace password → Workspace key → Folder key → Document key
2. **Zero-Knowledge Sharing** — Share links contain the encryption key in the URL fragment (never sent to servers)
3. **Traffic Analysis Resistance** — All encrypted payloads padded to 4KB blocks
4. **Signed Invitations** — Invite links are Ed25519-signed with configurable expiry

### Privacy Features

- **No accounts** — Your identity is a keypair you control
- **No tracking** — No analytics, no telemetry, no phone home
- **No cloud storage** — Documents exist only on participants' devices
- **Tor support** — Route all traffic through Tor for anonymity
- **Hard identity security** — Recovery phrases required for every session
- **Fragment-based sharing** — Encryption keys never sent to servers
- **Time-limited access** — All invitations expire automatically
- **Secure deletion** — Cryptographic key destruction makes data unrecoverable
- **Local-first architecture** — Works completely offline

### Workspace Permission System

**Permission Levels:**

| Role | Create | Edit | Comment | Invite | Manage Members | Delete Workspace |
|------|--------|------|---------|--------|----------------|------------------|
| **Owner** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Editor** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Viewer** | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |

**Owner Capabilities:**
- **Full workspace control** - create, edit, delete everything
- **Member management** - invite, kick, change permissions
- **Workspace deletion** - permanent removal with secure data wiping
- **Permission changes** - promote/demote other members
- **Invite link generation** - create time-limited, signed invitations

**Editor Capabilities:**
- **Content creation/editing** - full access to documents and folders
- **Real-time collaboration** - cursors, comments, chat participation
- **Document management** - create, rename, move, delete documents
- **Cannot invite others** - prevents unauthorized workspace expansion

**Viewer Capabilities:**
- **Read-only access** - view all content without editing
- **Comment participation** - join discussions and leave feedback
- **Real-time presence** - see others and be seen
- **Export/download** - save copies for offline viewing

**Security Properties:**
- **Cryptographic enforcement** - permissions validated with Ed25519 signatures
- **Real-time updates** - permission changes apply instantly
- **Audit trail** - all permission changes logged with timestamps
- **Revocation resilience** - kicked members cannot rejoin without new invitation

### What Nightjar Does NOT Protect Against

**Device-Level Threats:**
- **Malware/keyloggers** on your device can steal recovery phrases as you type
- **Screen recording software** can capture document content
- **Physical device access** without proper screen locks or disk encryption
- **Malicious browser extensions** in browser-based deployments

**Social Engineering:**
- **Recovery phrase theft** through phishing or social manipulation
- **Malicious invitations** - users choosing to invite attackers
- **Insider threats** - authorized collaborators acting maliciously
- **Impersonation attacks** outside the Nightjar system

**Advanced Attacks:**
- **Nation-state attackers** with unlimited resources and zero-day exploits
- **Supply chain compromise** of Nightjar itself (mitigated by hard identity security)
- **Quantum computer attacks** against Ed25519/XSalsa20 (future threat)
- **Side-channel attacks** on specialized hardware (timing, power analysis)

**Technical Limitations:**
- **Copy/paste/screenshot** by authorized users
- **Network metadata analysis** without Tor (who connects when, from where)
- **Traffic correlation** with sufficient monitoring resources
- **Endpoint compromise** - if your device is fully compromised, all bets are off

**Nightjar's security model assumes:**
1. Your device is reasonably secure (updated OS, antivirus, etc.)
2. You keep your recovery phrase secret and secure
3. You only invite trustworthy collaborators
4. You're not targeted by nation-state adversaries with unlimited resources

For maximum security: Use Tor, secure your devices, store recovery phrases offline, and practice good operational security.

---

## Architecture

Nightjar uses an **Electron + Sidecar** architecture that separates the UI from heavy networking operations for security and stability.

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         NIGHTJAR CLIENT                              │
├─────────────────────────────────────────────────────────────────────┤
│                          Application Layer                           │
│  ┌─────────────┐  ┌──────────────────┐  ┌────────────────────────┐  │
│  │  React UI   │  │  TipTap Editor   │  │   Workspace Manager    │  │
│  │             │  │  Fortune Sheet   │  │   Folder/Doc Tree      │  │
│  └─────────────┘  └──────────────────┘  └────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────┤
│                          Yjs CRDT Layer                              │
│  ┌─────────────┐  ┌──────────────────┐  ┌────────────────────────┐  │
│  │   Y.Doc     │  │  Y.XmlFragment   │  │   Awareness            │  │
│  │  (document) │  │  (rich text)     │  │   (presence/cursors)   │  │
│  └─────────────┘  └──────────────────┘  └────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────┤
│                        P2P Service Layer                             │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                      PeerManager                              │   │
│  │  ┌─────────────────┐  ┌────────────────────────────────────┐ │   │
│  │  │ BootstrapManager│  │       AwarenessManager             │ │   │
│  │  │ (peer discovery)│  │       (cursor sync)                │ │   │
│  │  └─────────────────┘  └────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│                        Transport Layer                               │
│  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  ┌─────────────┐   │
│  │ WebSocket   │  │  WebRTC     │  │ Hyperswarm│  │   mDNS      │   │
│  │ (relay)     │  │  (direct)   │  │   (DHT)   │  │  (LAN)      │   │
│  └─────────────┘  └─────────────┘  └───────────┘  └─────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│                        Sidecar (Node.js)                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │ y-websocket     │  │  LevelDB        │  │  libp2p + Tor       │  │
│  │ server (:8080)  │  │  Persistence    │  │  GossipSub          │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### How Clients Connect

```
   Client A                    Client B                    Client C
      │                           │                           │
      │     1. Join workspace topic (SHA256 hash)             │
      ├───────────────────────────┼───────────────────────────┤
      │                           │                           │
      │  2. DHT Discovery (Hyperswarm)                        │
      │◄─────────────────────────►│◄─────────────────────────►│
      │                           │                           │
      │  3. Exchange Ed25519-signed identity                  │
      │◄─────────────────────────►│◄─────────────────────────►│
      │                           │                           │
      │  4. Encrypted Yjs sync (XSalsa20-Poly1305)            │
      │◄═════════════════════════►│◄═════════════════════════►│
      │                           │                           │
      │  5. Awareness updates (cursors, presence)             │
      │◄─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─►│◄─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─►│
```

### Transport Priority

Nightjar automatically selects the best available transport:

| Transport | Use Case | Platforms | Priority |
|-----------|----------|-----------|----------|
| **mDNS** | Same local network | Electron | 1 (fastest) |
| **Hyperswarm** | DHT-based discovery | Electron | 2 |
| **WebRTC** | Direct browser P2P | All | 3 |
| **WebSocket** | Relay fallback | All | 4 (always available) |
| **Tor** | Anonymous routing | Electron | Optional overlay |

### Data Flow

```
User types "Hello" in document
         │
         ▼
┌─────────────────────────────┐
│  TipTap Editor captures     │
│  keystrokes, updates DOM    │
└─────────────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  Yjs applies operation to   │
│  Y.XmlFragment (CRDT)       │
└─────────────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  Encryption Layer           │
│  • Derive document key      │
│  • Pad to 4KB block         │
│  • XSalsa20-Poly1305        │
└─────────────────────────────┘
         │
         ├──────────────────────────────┐
         ▼                              ▼
┌─────────────────────┐    ┌─────────────────────┐
│  LevelDB (local)    │    │  P2P Broadcast      │
│  Encrypted storage  │    │  To all peers       │
└─────────────────────┘    └─────────────────────┘
```

---

## Global Relay Mesh Network

Nightjar includes a **distributed relay mesh network** that enables high-availability peer discovery without centralized infrastructure. Anyone can run a relay server, and all relays automatically discover each other to form a resilient, globally distributed network—similar to how BitTorrent's DHT works.

### How It Works

```
┌─────────────────────────────────────────────────────────────────────┐
│                    NIGHTJAR RELAY MESH                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│    ┌─────────┐       Hyperswarm DHT        ┌─────────┐              │
│    │ Relay A │◄────────────────────────────►│ Relay B │              │
│    │ (host)  │                              │ (relay) │              │
│    └────┬────┘                              └────┬────┘              │
│         │      Mesh Coordination Topic           │                   │
│         │◄──────────────────────────────────────►│                   │
│         │                                        │                   │
│    ┌────┴────┐                              ┌────┴────┐              │
│    │ Desktop │ ─ ─ ─ Workspace Topic ─ ─ ─ ─│ Desktop │              │
│    │ Client  │       (hashed ID)            │ Client  │              │
│    └─────────┘                              └─────────┘              │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Privacy by Design: What Peers Share

**No personally identifiable information (PII) is ever transmitted through the mesh.** The only data shared between peers is:

| Data Shared | Purpose | Privacy |
|-------------|---------|---------|
| **Hashed Workspace Topic** | SHA256(`nightjar-workspace:` + workspaceId) | Cannot reverse to get workspace ID |
| **Connection Info** | IP:port or WebSocket URL for relay nodes | Required for network connectivity |
| **Node ID** | Random 32-byte identifier | Not linked to user identity |
| **Capabilities** | Whether node persists data, max peers | Helps clients choose relays |

**What is NOT shared:**
- ❌ Usernames or display names
- ❌ Email addresses or accounts
- ❌ Document content (always encrypted)
- ❌ Workspace names or metadata
- ❌ Recovery phrases or private keys
- ❌ Original workspace IDs (only hashed topics)

### Server Deployment Modes

Nightjar servers can run in three modes, configurable via the `NIGHTJAR_MODE` environment variable:

| Mode | Mesh Participation | Data Persistence | Use Case |
|------|-------------------|------------------|----------|
| **`host`** | ✅ Public mesh | ✅ Encrypted storage | Main server - stores encrypted workspace data |
| **`relay`** | ✅ Public mesh | ❌ None | Lightweight relay - routes connections only |
| **`private`** | ❌ Isolated | ✅ Encrypted storage | Private deployment - no public discovery |

#### Host Mode (Default)
```bash
# Full server with persistence and mesh participation
NIGHTJAR_MODE=host PUBLIC_URL=wss://your-server.com node index.js
```
- Participates in the global relay mesh
- Stores encrypted workspace data for offline sync
- Announces itself as a relay for other clients
- Best for: Primary workspace servers

#### Relay Mode
```bash
# Lightweight relay, no storage
NIGHTJAR_MODE=relay PUBLIC_URL=wss://relay.your-server.com node index.js
```
- Joins the mesh to help route connections
- Does not store any user data
- Low resource usage
- Best for: Community-contributed relay nodes

#### Private Mode
```bash
# Isolated server, no mesh
NIGHTJAR_MODE=private node index.js
```
- Full persistence and sync features
- Does **not** join the public mesh
- Not discoverable by other peers
- Best for: Enterprise/private deployments, air-gapped networks

### Desktop Client Mesh Participation

Desktop clients (Electron) participate in the mesh by default to improve peer discovery:

- **Automatic workspace announcement** — When you open a workspace, your client joins that workspace's DHT topic
- **Relay discovery** — Clients learn about available relays through the mesh
- **No relay traffic** — Desktop clients don't relay traffic for others (they're not servers)
- **Opt-out available** — Set `NIGHTJAR_MESH=false` to disable mesh participation

### Share Links with Embedded Relays

When you create a share link, Nightjar can embed known relay nodes to help recipients find peers:

```
nightjar://w/abc123#p:password&perm:e&nodes:wss%3A%2F%2Frelay1.nightjar.io,wss%3A%2F%2Frelay2.nightjar.io
```

This allows new users to bootstrap into the mesh even if they haven't discovered any relays yet.

### Running Your Own Relay

Deploy a relay server with Docker and Caddy (auto-TLS):

```bash
# Using Docker Compose (relay mode — lightweight, no persistence)
PUBLIC_URL=wss://relay.your-domain.com docker compose --profile relay up -d

# Or host mode (with encrypted persistence) — starts by default
PUBLIC_URL=wss://your-domain.com docker compose up -d
```

The default public relay is `wss://relay.night-jar.io`. Clients will automatically connect when available, and gracefully fall back to direct Hyperswarm P2P if the relay is unreachable.

**Full step-by-step deployment guide:** [docs/RELAY_DEPLOYMENT_GUIDE.md](docs/RELAY_DEPLOYMENT_GUIDE.md)

See [server/unified/docker-compose.yml](server/unified/docker-compose.yml) for all deployment modes and options.

### Security Properties

| Property | Mechanism |
|----------|-----------|
| **Topic Privacy** | Workspace IDs hashed with SHA256 before DHT announcement |
| **Anti-Spoofing** | BitTorrent-style IP-bound tokens prevent fake relay announcements |
| **No Enumeration** | Cannot list workspaces or users from the mesh |
| **Relay Isolation** | Private mode servers are completely isolated from public mesh |
| **End-to-End Encryption** | All document content encrypted before relay transit |

---

## Technology Stack

### Core Technologies

| Category | Technology | Purpose |
|----------|------------|---------|
| **Runtime** | Electron 30 | Cross-platform desktop app |
| **Frontend** | React 18 | UI framework |
| **Bundler** | Vite 5 | Fast development and builds |
| **Rich Text** | TipTap / ProseMirror | Collaborative text editor |
| **Spreadsheet** | Fortune Sheet | Excel-like spreadsheets |
| **CRDT** | Yjs | Conflict-free real-time sync |
| **Visualization** | Recharts / D3.js / TopoJSON | Analytics charts, geographic heatmaps |

### Networking

| Technology | Purpose |
|------------|---------|
| **Hyperswarm** | DHT-based peer discovery (Electron) |
| **libp2p** | Modular P2P networking with GossipSub |
| **y-websocket** | Yjs WebSocket sync protocol |
| **WebRTC** | Direct browser-to-browser connections |
| **Tor** | Anonymous hidden service routing |

### Cryptography

| Library | Algorithm | Use |
|---------|-----------|-----|
| **TweetNaCl** | Ed25519 | Identity signing keys |
| **TweetNaCl** | XSalsa20-Poly1305 | Authenticated encryption |
| **hash-wasm** | Argon2id | Password-based key derivation |
| **bip39** | BIP39 | Mnemonic recovery phrases |
| **Web Crypto API** | AES-GCM | Inventory address encryption |

### Storage

| Technology | Purpose |
|------------|---------|
| **LevelDB** | Local encrypted document storage |
| **IndexedDB** | Browser-based storage fallback |

### Testing

| Technology | Purpose |
|------------|---------|
| **Jest** | Unit and integration tests |
| **Playwright** | End-to-end browser tests |
| **React Testing Library** | Component tests |

---

## Security Deep Dive

### Identity System

Your identity is a cryptographic keypair that you fully control:

```
12-word mnemonic (BIP39)
         │
         ▼ PBKDF2-SHA512
    512-bit seed
         │
         ▼ First 32 bytes
  Ed25519 secret key ──────► Ed25519 public key
         │                          │
         ▼                          ▼
   Sign messages            Your "identity"
   Decrypt data             Share with others
```

**Identity Generation & Storage:**
- **Generation**: Cryptographically random 128-bit entropy → 12-word BIP39 mnemonic
- **Storage**: Mnemonic encrypted with machine-specific key (XSalsa20-Poly1305)
- **Backup**: Export encrypted with user password (Argon2id + XSalsa20-Poly1305)
- **Hard Security Model**: Identity files **never** auto-load - always requires recovery phrase

### Identity Recovery & Protection

Nightjar implements a **hard cutover security model** - when an existing identity is detected, the system requires explicit validation:

**Three Recovery Scenarios:**

1. **🔓 Unlock Existing Identity**
   - Existing identity file detected on system
   - Recovery phrase validates against stored identity
   - Unlocks access to existing workspaces and data
   - Preserves all workspace memberships and permissions

2. **🔄 Restore Identity from Backup**
   - Recovery phrase doesn't match local identity
   - Creates new identity file from recovery phrase
   - May need re-invitation to existing workspaces
   - Useful when moving between devices

3. **🗑️ Delete and Create New**
   - Explicit deletion of existing identity data
   - **PERMANENT DATA LOSS WARNING** displayed
   - All local workspaces and documents deleted
   - Creates fresh identity with new recovery phrase
   - Cannot be undone

**Security Properties:**
- **No Auto-Loading**: System never automatically loads identity.json
- **Recovery Phrase Required**: Every startup requires 12-word validation
- **Cryptographic Validation**: Recovery phrase mathematically verified against identity
- **Data Protection**: Prevents unauthorized access to existing identity files
- **Clear Warning System**: Explicit confirmation required for destructive actions

### Key Hierarchy

Each level in the hierarchy has its own derived key:

```
Workspace Password (user-chosen or generated)
         │
         ▼ Argon2id (64MB, 4 iterations)
   Workspace Key (256-bit)
         │
         ├────────────────────────────────────┐
         ▼                                    ▼
   Folder Key (derived)              Document Key (derived)
         │
         ▼
   Sub-document Keys
```

**Argon2id Parameters:**
- Memory: 64 MB (65,536 KB)
- Iterations: 4
- Parallelism: 4
- Output: 256 bits

This memory-hard KDF makes brute-force attacks extremely expensive.

### Encryption Details

All document content uses **XSalsa20-Poly1305** authenticated encryption:

| Property | Value |
|----------|-------|
| Cipher | XSalsa20 (stream cipher) |
| MAC | Poly1305 (authentication) |
| Key size | 256 bits |
| Nonce size | 192 bits (random per message) |
| Padding | 4KB blocks (traffic analysis resistance) |

### Share Link Security

Nightjar's invite system uses **fragment-based key transmission** with **cryptographic signatures** for enterprise-grade security:

```
nightjar://w/abc123#key=base64encryptionkey&perm=e&exp=1706745600&sig=ed25519sig
           │        │                      │      │            │
           │        │                      │      │            └─ Ed25519 signature
           │        │                      │      └─ Expiration (max 24hrs)
           │        │                      └─ Permission (e=editor,v=viewer,o=owner)
           │        └─ Workspace encryption key (never sent to servers)
           └─ Workspace ID
```

**Security Properties:**
- **URL Fragment Security**: Key never sent to servers (fragment only exists client-side)
- **Time Expiry**: Maximum 24-hour window, configurable down to minutes
- **Cryptographic Integrity**: Ed25519 signatures prevent tampering or replay
- **Zero-Knowledge Servers**: Relay servers never see encryption keys
- **Instant Revocation**: Active members can be kicked, invalidating their access
- **Secure Deletion**: Complete workspace deletion with cryptographic key destruction

**Link Generation Process:**
1. Generate time-limited invitation with workspace key
2. Sign invitation parameters with workspace owner's Ed25519 key
3. Embed key in URL fragment (invisible to servers)
4. Optionally encode as QR code for mobile sharing

**Validation Process:**
1. Extract parameters from URL fragment
2. Verify Ed25519 signature against workspace owner's public key
3. Check expiration timestamp
4. Grant access if signature valid and not expired

### Workspace Management & Member Control

**Membership Management:**
- **Real-time member list** with online status and last activity
- **Instant member removal** ("kick") with immediate access revocation
- **Permission management** - change member roles (Owner, Editor, Viewer)
- **Activity tracking** - see who made changes and when

**Workspace Deletion & Data Wiping:**
- **Complete workspace deletion** removes all local data
- **Cryptographic key destruction** makes encrypted data unrecoverable
- **Secure deletion process** overwrites storage locations
- **Member notification** when workspace is deleted by owner
- **Cannot be undone** - explicit confirmation required

**Access Revocation:**
- **Immediate effect** - kicked members lose access instantly
- **Background sync termination** - connections closed automatically
- **Re-invitation required** for kicked members to rejoin
- **Audit trail** - removal actions logged with timestamps

### Security Hardening

Built-in protections against common attacks:

| Attack | Mitigation |
|--------|------------|
| **Brute force** | Rate limiting (5 attempts/60s, 5min lockout) |
| **Identity theft** | Hard cutover model - never auto-load identity files |
| **Unauthorized access** | Recovery phrase required for every session |
| **Prototype pollution** | Safe JSON parsing with Object.create(null) |
| **Path traversal** | Path sanitization and validation |
| **SSRF** | URL validation blocking localhost/internal IPs |
| **Replay attacks** | Timestamps in signed messages |
| **Traffic analysis** | 4KB padding on all encrypted payloads |
| **Timing attacks** | Constant-time comparison for crypto operations |
| **Invite tampering** | Ed25519 signatures on all invitation links |
| **Link hijacking** | Time-limited expiry (max 24 hours) |
| **Workspace persistence** | Secure deletion with key destruction |

### Threat Model

**Nightjar protects against:**
- ✅ **Mass surveillance** - End-to-end encryption with fragment-based key distribution
- ✅ **Server compromise** - Zero-knowledge servers never see plaintext or keys
- ✅ **Network eavesdropping** - All traffic encrypted, padded to resist traffic analysis
- ✅ **Metadata correlation** - Optional Tor routing for anonymous collaboration
- ✅ **Credential theft** - No passwords; cryptographic identity with recovery phrases
- ✅ **Identity hijacking** - Hard cutover model requires recovery phrase validation
- ✅ **Unauthorized device access** - Identity files never auto-load
- ✅ **Invite link interception** - Time-limited, cryptographically signed invitations
- ✅ **Workspace persistence after removal** - Secure deletion with key destruction
- ✅ **Member privilege escalation** - Granular permissions with instant revocation
- ✅ **Replay attacks** - Timestamped, signed messages with expiry validation

**Nightjar does NOT protect against:**
- ❌ **Malware on your device** - Full system access can steal recovery phrases
- ❌ **Malicious collaborators** - Invited users can copy/screenshot content
- ❌ **Physical device access** - Screen locks and disk encryption recommended
- ❌ **Advanced persistent threats** - Nation-state actors with unlimited resources
- ❌ **Social engineering** - Users sharing recovery phrases or inviting attackers
- ❌ **Side-channel attacks** - Timing, power analysis, etc. on dedicated hardware
- ❌ **Quantum computer attacks** - Ed25519/XSalsa20 vulnerable to sufficiently large quantum computers

**Realistic Attack Scenarios:**

*🎯 Corporate Espionage*: Nightjar's zero-knowledge architecture means even if relay servers are compromised, documents remain encrypted. Time-limited invites prevent long-term unauthorized access.

*🎯 Government Surveillance*: Fragment-based key distribution means invite links can be shared through separate channels. Tor integration provides traffic anonymity.

*🎯 Insider Threats*: Granular permissions and instant member removal prevent privilege abuse. Secure workspace deletion ensures terminated employees lose access.

*🎯 Supply Chain Attack*: Hard identity security prevents automatic access even if Nightjar itself is compromised - recovery phrases still required.

---

## Development

### Setup

```bash
git clone https://github.com/SaoneYanpa/Nightjar.git
cd Nightjar
npm install
npm run dev
```

### Build

```bash
npm run package:win    # Windows
npm run package:mac    # macOS
npm run package:linux  # Linux
```

### Tests

```bash
npm test                    # Unit tests (Jest)
npm run test:integration    # Integration tests
npm run test:e2e            # End-to-end tests (Playwright)
npm run test:e2e:smoke      # Quick smoke tests
```

**Test Coverage:**
- Unit tests for hooks, utilities, and components
- E2E tests for all document types (editor, spreadsheet, kanban)
- Multi-user presence and collaboration scenarios
- P2P sync and share link validation
- Inventory system workflow tests

---

## Changelog

### v1.7.5 - Analytics, History Sanitization & Account Migration
- **New Feature**: ProducerResponseTime — per-producer average claim/start/ship time bar charts
- **New Feature**: StatusTransitions — request outcome summary with delivery rate and stage timing
- **New Feature**: UnitsShippedByType — stacked bar chart of units shipped by catalog item per time bucket
- **Security**: Full git history sanitization — all 147 commits rewritten to remove prior identity references
- **Account Migration**: All references migrated from InyanRock to SaoneYanpa across configs, URLs, and app IDs
- **Testing**: 125 suites, 3,630 tests (0 failures)

### v1.7.4 - Curve25519 Scoped Keys, Address Reveal Fix & GitHub Migration
- **Security**: Inventory subsystem now receives Curve25519 encryption-only key (pre-derived via ed2curve) instead of full Ed25519 signing key — prevents signing capability leakage
- **Critical Fix**: Address reveal pipeline — `publicIdentity` was missing crypto keys, causing all address encryption/decryption to silently no-op; fixed with `inventoryIdentity` extending `publicIdentity` with `curveSecretKey`
- **Account Migration**: Migrated all references from InyanRock/Tokahe to SaoneYanpa across package.json, capacitor.config.json, main.js, README, docs, and UI
- **Testing**: 125 suites, 3,630 tests — fixed 5 test regressions (stage bar queries, privacy note text, duplicate emoji element)

### v1.7.3 - Ownership Transfer, Relay Infrastructure & Y.Map Migration
- **New Feature**: PermissionWatcher component — auto-syncs ownership transfers from Yjs to local workspace with toast notifications
- **Enhancement**: Factory reset warns when you are the sole owner of workspaces and requires typing "DELETE WORKSPACES" to proceed
- **Enhancement**: Relay bridge graceful fallback — logs warning and schedules background retry instead of stopping sync
- **Enhancement**: Tor SOCKS proxy support for relay WebSocket connections (relay-bridge.js)
- **Enhancement**: P2P bridge suspend/resume — tears down Hyperswarm UDP when Tor is active (relay-only mode) to prevent IP leakage
- **Enhancement**: Default BOOTSTRAP_NODES now includes `wss://relay.night-jar.io`
- **Critical Fix**: `getMap('info')` → `getMap('workspaceInfo')` — fixes workspace metadata never persisting via Yjs
- **Bug Fix**: Duplicate Yjs observer guard prevents registering update observers more than once per workspace
- **Bug Fix**: Sync exchange guard prevents redundant sync-state-request messages on duplicate join-topic events
- **Infrastructure**: Signaling server hardening — peer cleanup on disconnect, room ID validation, maxPayload limits, CORS, graceful shutdown
- **Infrastructure**: Nginx + Docker Compose updates for unified server deployment
- **Docs**: Comprehensive CSS color audit (520+ hardcoded violations catalogued with fix recommendations)
- **Docs**: Relay deployment guide — VPS + Docker + Caddy step-by-step setup
- **Testing**: 5 new test suites (82 new tests), 3 updated suites — 119 suites, 3,267 tests total (0 failures)

### v1.7.0 - File Storage, P2P Transfer & Presence Fixes
- **New Feature**: Complete file storage dashboard UI overhaul (browse, search, folders, bulk ops, downloads)
- **New Feature**: Floating chat button with unread badge
- **New Feature**: Slide panel component for inventory request details
- **Critical Fix**: P2P file transfer end-to-end implementation (was a TODO stub)
- **Critical Fix**: Server relay-message/relay-broadcast handlers for cross-network delivery
- **Critical Fix**: Sidecar chunk message routing via direct-message event
- **Critical Fix**: Presence indicators one-way display (publicKey race condition)
- **Bug Fix**: Inventory shipping workflow — 5 bugs in approval/address/shipping flow
- **Bug Fix**: File size display and chunk availability holder merging
- **Testing**: 110 test suites, 2,921 tests (0 failures)

### v1.6.1 - Import & Analytics Fixes
- **Bug Fix**: CSV/XLSX date parsing — imported dates no longer show "just now" (SheetJS serial date conversion fix)
- **Bug Fix**: Analytics views now correctly display imported request data (field name normalization)
- **Bug Fix**: Fixed `formatRelativeDate` for future timestamps
- **Bug Fix**: Removed duplicate React key warning in InventoryNavRail
- **Enhancement**: Import parser preserves numeric types from SheetJS
- **Testing**: 10 new test suites, 2102 total tests across 75 suites (0 failures)

### v1.6.0 - Inventory Management System
- **New Feature**: Complete inventory management system with admin, producer, and requester roles
- **New Feature**: CSV/XLSX import with smart column mapping
- **New Feature**: Geographic visualization with US state heatmap
- **New Feature**: Encrypted address storage for secure shipping
- **Enhancement**: Document-level presence pips in sidebar
- **Enhancement**: Focused state indicators with glowing effect
- **Testing**: Comprehensive E2E test suite (40+ new tests)

### v1.5.x - Presence & Notifications
- **v1.5.13**: Multi-document presence, chat fixes, spreadsheet improvements
- **v1.5.1**: Comprehensive bug audit with 40+ fixes
- **v1.5.0**: Notification sound system with Do Not Disturb mode

### v1.4.0 - P2P Stability
- Fixed P2P sync for joined workspaces
- Added peer status monitoring with connection health indicators
- Improved cross-platform workspace sharing (Mac ↔ Windows)

### v1.3.x - Sharing & Reliability
- Dynamic sidecar port configuration
- Fixed signed invite link validation
- Improved document deduplication
- Cross-platform P2P fixes

### v1.2.0 - Relay Mesh
- Global relay mesh network
- Relay configuration UI
- Base64 encoding fixes

---

## License

ISC License

---

<p align="center">
  <strong>Privacy is not about having something to hide.<br>It's about having something to protect.</strong>
</p>
