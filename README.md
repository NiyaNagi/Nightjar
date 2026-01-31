<p align="center">
  <img src="assets/icon.png" alt="Nightjar" width="128" height="128">
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

Nightjar uses an **Electron + Sidecar** architecture:

```
┌─────────────────────────────────────────────────────────┐
│                     NIGHTJAR APP                        │
├─────────────────────────────────────────────────────────┤
│  Electron Main     │        React Frontend             │
│  • Window mgmt     │  • TipTap Editor                  │
│  • IPC bridge      │  • Fortune Sheet                  │
│  • Protocol        │  • Workspace/Folder UI            │
├────────────────────┴────────────────────────────────────┤
│                  SIDECAR (Node.js)                      │
│  • Yjs sync server (port 8080)                          │
│  • Metadata server (port 8081)                          │
│  • P2P: Hyperswarm + libp2p + Tor                       │
│  • LevelDB encrypted storage                            │
└─────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology |
|-------|------------|
| **Desktop** | Electron |
| **Frontend** | React, TipTap, Fortune Sheet |
| **CRDT** | Yjs, y-websocket |
| **P2P** | Hyperswarm, libp2p |
| **Crypto** | TweetNaCl, Argon2 (hash-wasm) |
| **Storage** | LevelDB |
| **Anonymity** | Tor (optional) |

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
