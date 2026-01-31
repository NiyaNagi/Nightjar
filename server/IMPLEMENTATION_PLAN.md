# Nightjar Web Deployment - Implementation Plan

## Overview

Transform Nightjar from Electron-only to a hybrid web/desktop application with:
- Zero-trust server architecture
- E2E encrypted collaboration
- Cryptographic identity
- P2P WebRTC mesh with server fallback

---

## Phase 1: Server Infrastructure

### 1.1 Signaling Server
- WebSocket server for WebRTC peer discovery
- Handles room management (workspaces)
- Routes ICE candidates between peers
- Does NOT see document content

### 1.2 Static File Server
- Serves React app build
- Nginx with proper caching headers
- Gzip/Brotli compression

### 1.3 Persistence Node (Optional)
- Headless Yjs peer that stays connected
- Stores encrypted document state
- Provides "always-on" sync partner
- Cannot decrypt content (no workspace keys)

---

## Phase 2: Frontend Modifications

### 2.1 Web-Compatible Provider System
```
┌─────────────────────────────────────────┐
│            Provider Factory              │
├─────────────────────────────────────────┤
│ if (isElectron) → HyperswarmProvider    │
│ if (isBrowser)  → WebRTCProvider        │
│ fallback        → WebSocketProvider     │
└─────────────────────────────────────────┘
```

### 2.2 Identity for Web
- IndexedDB storage (encrypted)
- Web Crypto API for key operations
- Recovery phrase import/export
- Cross-device QR transfer

### 2.3 Remove Electron Dependencies
- Create abstraction layer for IPC
- Polyfill or remove Node.js APIs
- Environment-based feature flags

---

## Phase 3: Security Implementation

### 3.1 Identity Verification
- Ed25519 signatures on all messages
- Challenge-response on peer connect
- Public key as persistent identity

### 3.2 Workspace Encryption
- Per-workspace symmetric key
- Key wrapped for each member
- Server only sees encrypted blobs

### 3.3 Transport Security
- TLS 1.3 for all connections
- Certificate pinning (optional)
- DTLS for WebRTC data channels

---

## Phase 4: Deployment

### 4.1 Docker Containers
- `Nightjar-web`: Nginx + static files
- `Nightjar-signal`: Signaling server
- `Nightjar-persist`: Persistence node

### 4.2 QNAP Configuration
- Container Station setup
- Reverse proxy configuration
- SSL via Let's Encrypt
- Firewall rules

---

## File Structure

```
server/
├── signaling/
│   ├── index.js          # Main signaling server
│   ├── rooms.js          # Room/workspace management
│   └── package.json
├── persistence/
│   ├── index.js          # Headless Yjs peer
│   ├── storage.js        # Encrypted blob storage
│   └── package.json
├── docker/
│   ├── Dockerfile.web
│   ├── Dockerfile.signal
│   ├── Dockerfile.persist
│   └── docker-compose.yml
├── nginx/
│   ├── nginx.conf
│   └── ssl/
└── deploy/
    ├── qnap-setup.sh
    └── QNAP_GUIDE.md
```

---

## Implementation Order

1. ✅ Create signaling server
2. ✅ Create WebRTC provider for frontend  
3. ✅ Create web-compatible identity storage
4. ✅ Create provider abstraction layer
5. ✅ Create persistence node
6. ✅ Create Docker configuration
7. ✅ Create QNAP deployment guide
8. ✅ Test full deployment

---

## Security Checklist

- [ ] All private keys stay on-device
- [ ] Server cannot decrypt any content
- [ ] Identity verified cryptographically
- [ ] TLS on all connections
- [ ] No sensitive data in URLs
- [ ] Rate limiting on signaling
- [ ] Input validation everywhere
- [ ] Docker containers run as non-root
