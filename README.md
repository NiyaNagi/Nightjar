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

### 📋 Kanban Boards
- Visual project management with drag-and-drop cards

### 👥 Real-Time Collaboration
- See collaborators' cursors in real-time
- Presence indicators showing who's online
- Comments on text selections or cells
- Built-in chat with direct messaging

### 📁 Organization
- Workspaces to separate projects
- Nested folder hierarchy
- Drag-and-drop document management

### 🔗 Sharing
- Password-protected invite links
- QR codes for easy mobile sharing
- Granular permissions: Owner, Editor, Viewer
- Time-limited invitations

### 🌐 Privacy & Networking
- Tor hidden service support (Electron)
- Act as a relay for other peers
- Local network discovery via mDNS
- Works offline with automatic sync

---

## Download

Download the latest version for your platform:

| Platform | Download |
|----------|----------|
| **Windows** | [Nightjar Setup.exe](https://github.com/InyanRock/Nightjar/releases/latest) |
| **macOS** | [Nightjar.dmg](https://github.com/InyanRock/Nightjar/releases/latest) |
| **Linux** | [Nightjar.AppImage](https://github.com/InyanRock/Nightjar/releases/latest) |

**Requirements:** Windows 10+ / macOS 10.15+ / Ubuntu 20.04+, 4GB RAM, 200MB disk

---

## Quick Start

1. **Download and install** Nightjar for your platform
2. **Create your identity** — Choose a display name and avatar
3. **Save your recovery phrase** — 12 words that can restore your identity anywhere
4. **Create a workspace** — Your private container for documents
5. **Invite collaborators** — Share a password-protected link or QR code
6. **Start collaborating** — Edits sync in real-time, encrypted end-to-end

---

## Security

Nightjar is built with security as the foundation, not an afterthought.

### Cryptographic Primitives

| Component | Algorithm | Details |
|-----------|-----------|---------|
| **Identity Keys** | Ed25519 | Signing keypairs for authentication |
| **Encryption** | XSalsa20-Poly1305 | Authenticated encryption (NaCl) |
| **Key Derivation** | Argon2id | Memory-hard KDF (64MB, 4 iterations) |
| **Recovery Phrase** | BIP39 | 12-word mnemonic (128-bit entropy) |

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

### What Nightjar Does NOT Protect Against

- Malware on your device
- Collaborators you choose to share with
- Screenshots or copy/paste by authorized users
- Metadata visible to network observers (unless using Tor)

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

### Storage

| Technology | Purpose |
|------------|---------|
| **LevelDB** | Local encrypted document storage |
| **IndexedDB** | Browser-based storage fallback |

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

- **Generation**: Cryptographically random 128-bit entropy → 12-word BIP39 mnemonic
- **Storage**: Mnemonic encrypted with machine-specific key (XSalsa20-Poly1305)
- **Backup**: Export encrypted with user password (Argon2id + XSalsa20-Poly1305)
- **Recovery**: Re-derive full keypair from 12 words on any device

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

When you share a workspace, the encryption key is embedded in the URL fragment:

```
nightjar://w/abc123#p:azure-dolphin-7-bright&perm:e&exp:1706745600&sig:base64...
           │        │                        │       │            │
           │        │                        │       │            └─ Ed25519 signature
           │        │                        │       └─ Expiration timestamp
           │        │                        └─ Permission level (e=editor)
           │        └─ Password (never sent to servers)
           └─ Workspace ID
```

- **URL fragment (#)** is never sent to servers in HTTP requests
- **Ed25519 signature** prevents tampering
- **Expiration** limits window for compromise
- **Password format** uses memorable word combinations

### Security Hardening

Built-in protections against common attacks:

| Attack | Mitigation |
|--------|------------|
| **Brute force** | Rate limiting (5 attempts/60s, 5min lockout) |
| **Prototype pollution** | Safe JSON parsing with Object.create(null) |
| **Path traversal** | Path sanitization and validation |
| **SSRF** | URL validation blocking localhost/internal IPs |
| **Replay attacks** | Timestamps in signed messages |
| **Traffic analysis** | 4KB padding on all encrypted payloads |
| **Timing attacks** | Constant-time comparison for crypto operations |

### Threat Model

**Nightjar protects against:**
- ✅ Mass surveillance (E2E encryption)
- ✅ Server compromise (no plaintext on servers)
- ✅ Network eavesdropping (all traffic encrypted)
- ✅ Metadata correlation (with Tor enabled)
- ✅ Credential theft (no passwords to steal)

**Nightjar does NOT protect against:**
- ❌ Malware on your device
- ❌ Malicious collaborators you invited
- ❌ Screenshots or physical access
- ❌ Advanced nation-state attackers targeting you specifically

---

## Development

### Setup

```bash
git clone https://github.com/InyanRock/Nightjar.git
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
npm test                    # Unit tests
npm run test:integration    # Integration tests
```

---

## License

ISC License

---

<p align="center">
  <strong>Privacy is not about having something to hide.<br>It's about having something to protect.</strong>
</p>
