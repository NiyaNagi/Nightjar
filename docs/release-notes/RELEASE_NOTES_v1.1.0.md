# Release Notes: Nightjar v1.1.0

**Release Date:** February 2, 2026

This is a major feature release introducing the **Global Relay Mesh Network**, significant **UI/UX improvements**, and important **security enhancements**.

---

## 🌐 Global Relay Mesh Network

Nightjar now includes a distributed relay mesh network that enables high-availability peer discovery without centralized infrastructure. This brings BitTorrent-style resilience to collaborative editing.

### Key Features

- **Distributed Peer Discovery** — Relays automatically discover each other via Hyperswarm DHT to form a global mesh
- **Three Server Modes**:
  - `host` — Full persistence + mesh participation (default)
  - `relay` — Lightweight mesh-only mode, no data storage
  - `private` — Full features but isolated from public mesh (enterprise deployments)
- **Privacy-First Design** — Only SHA256-hashed topic IDs are shared; no usernames, document content, or workspace names ever traverse the mesh
- **Desktop Mesh Participation** — Electron clients participate in workspace discovery (opt-out via `NIGHTJAR_MESH=false`)
- **Embedded Relay Bootstrap** — Share links can include relay nodes (`nodes:` parameter) for instant peer discovery

### Privacy Guarantees

| Data Shared | Purpose |
|-------------|---------|
| Hashed Workspace Topic | SHA256 hash - cannot reverse to get workspace ID |
| Connection Info | IP:port for relay nodes only |
| Node ID | Random 32-byte identifier, not linked to user identity |

**What is NOT shared:** Usernames, emails, document content, workspace names, recovery phrases, or original workspace IDs.

### Docker Deployment

```bash
# Deploy a relay server
PUBLIC_URL=wss://relay.example.com docker-compose --profile relay up -d

# Deploy a host server (persistence + mesh)
PUBLIC_URL=wss://host.example.com docker-compose --profile host up -d
```

---

## 🎨 UI/UX Improvements

### New Nightjar Mascot

- Friendly mascot character with rotating sayings
- Large mode for empty states with auto-rotating messages
- Mini mode next to settings with click-to-show bubbles
- Over 50 witty privacy-themed sayings

### Improved Document & Workspace Creation

- **New Create Document Dialog** — Dedicated modal with document type selection (Text, Spreadsheet, Kanban)
- **Icon & Color Selection** — Choose custom icons and colors for documents and workspaces
- **Folder Selection** — Create documents directly in target folders
- **Enhanced Edit Properties Modal** — Unified design for editing workspace/folder/document properties

### Sidebar Improvements

- **Collapsible Sections** — Click section headers to collapse/expand
- **Improved Visual Hierarchy** — Better distinction between workspaces, folders, and documents
- **Hover States** — Clearer interactive feedback
- **Online Indicators** — Visual pips showing collaborators online in each document

### Status Bar Enhancements

- **Mesh Status Indicator** — Shows mesh network connection status and known relays
- **Improved Connection Display** — Clearer peer count and status information

---

## 🔒 Security Enhancements

### Workspace Isolation Fix

**Fixed critical security issue** where users joining via URL fragments could be placed in shared workspaces without consent.

**Before:** Visiting a URL with workspace identifier in fragment automatically joined that workspace.

**After:** 
1. Application detects workspace identifier in URL
2. Shows confirmation dialog explaining the shared workspace
3. User explicitly chooses to join OR creates their own workspace
4. URL fragment cleared after processing

### Security Properties

- Workspace identifiers no longer mistaken for session keys
- User consent required before joining any shared workspace
- URL fragments cleared to prevent reuse
- Clear visual indication of shared vs. personal workspaces

---

## 📁 New Files

### Mesh Network Infrastructure
- `sidecar/mesh.js` — MeshParticipant class for Hyperswarm DHT coordination
- `sidecar/mesh-constants.js` — Shared constants for mesh protocol
- `server/unified/mesh.mjs` — ES module version for unified server
- `server/unified/mesh-constants.mjs` — ES module constants for server
- `docs/RELAY_MESH_ARCHITECTURE.md` — Complete architecture specification

### UI Components
- `frontend/src/components/CreateDocument.jsx` — New document creation dialog
- `frontend/src/components/CreateDocument.css` — Styles for document creation
- `frontend/src/components/NightjarMascot.jsx` — Mascot component with sayings
- `frontend/src/components/NightjarMascot.css` — Mascot styles
- `frontend/public/assets/nightjar-sayings.md` — Collection of mascot sayings

### Documentation
- `SECURITY_FIX_SUMMARY.md` — Detailed security fix documentation

---

## 📝 Modified Files

### Core Application
- `frontend/src/AppNew.jsx` — Security fixes, mesh status integration
- `frontend/src/utils/sharing.js` — Mesh relay embedding in share links
- `sidecar/index.js` — Mesh participant integration, new message handlers

### Server Infrastructure
- `server/unified/index.js` — Mesh participation, server mode configuration
- `server/unified/Dockerfile` — Updated for mesh support and mode selection
- `server/unified/docker-compose.yml` — Multi-profile deployment configuration
- `server/unified/package.json` — Added hyperswarm dependency

### UI Components
- `frontend/src/components/StatusBar.jsx` — Mesh status display
- `frontend/src/components/StatusBar.css` — Mesh indicator styles
- `frontend/src/components/HierarchicalSidebar.jsx` — Collapsible sections, improved hierarchy
- `frontend/src/components/HierarchicalSidebar.css` — Enhanced sidebar styles
- `frontend/src/components/CreateWorkspace.jsx` — Icon/color selection
- `frontend/src/components/CreateWorkspace.css` — Improved modal styles
- `frontend/src/components/common/EditPropertiesModal.jsx` — Unified property editing
- `frontend/src/components/common/EditPropertiesModal.css` — Enhanced styles
- `frontend/src/components/common/IconColorPicker.jsx` — Improved picker component
- `frontend/src/components/common/IconColorPicker.css` — Picker styles

### Documentation
- `README.md` — Added Global Relay Mesh Network section

---

## 🔄 Breaking Changes

None. All changes are backwards compatible.

---

## 🚀 Upgrade Guide

### Desktop Users
Simply download the new version. Mesh participation is enabled by default but can be disabled with `NIGHTJAR_MESH=false`.

### Server Operators

1. Update your Docker image
2. Choose your server mode via `NIGHTJAR_MODE` environment variable:
   - `host` (default) — Full features + mesh
   - `relay` — Signaling only, no storage
   - `private` — Full features, no mesh
3. Set `PUBLIC_URL` to enable mesh relay announcements

```bash
# Upgrade existing host server
PUBLIC_URL=wss://your-server.com docker-compose pull
docker-compose --profile host up -d
```

---

## 🙏 Contributors

Thank you to everyone who contributed to this release!

---

**Full Changelog:** v1.0.44...v1.1.0
