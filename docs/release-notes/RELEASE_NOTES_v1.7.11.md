# Release Notes — v1.7.11

**Release Date:** July 2025

Nightjar v1.7.11 is a feature release introducing **clickable HTTPS share links**,
**encrypted at-rest persistence**, a complete **public landing page overhaul** with
a companion docs wiki, and broad CI/CD and testing improvements.

---

## 🔗 Clickable HTTPS Share Links

Share links are no longer limited to the `nightjar://` custom protocol. Nightjar now
generates standard HTTPS URLs that work in email, chat, social media, and any browser.

| Aspect | Detail |
|--------|--------|
| **Format** | `https://{host}/join/{typeCode}/{payload}#{fragment}` |
| **Security** | Secrets live in the URL fragment — never sent to the server (RFC 3986 §3.5) |
| **Deep link** | `/join/:type/:payload` serves a landing page that tries `nightjar://` first, then falls back to the download page after 2 seconds |
| **Legacy toggle** | EntityShareDialog includes a "Use legacy format" checkbox for `nightjar://` links |
| **Backward compat** | `linkHandler.js` and `parseAnyShareLink()` recognize all three formats (nightjar://, HTTPS join, compressed) |

### New utilities (`frontend/src/utils/sharing.js`)

- `generateClickableShareLink()` — produces HTTPS join URL from share parameters
- `nightjarLinkToJoinUrl()` / `joinUrlToNightjarLink()` — round-trip converters
- `isJoinUrl()` / `parseJoinUrl()` — detection and parsing
- `parseAnyShareLink()` / `isValidAnyShareLink()` — universal format handlers

---

## 🔐 Encrypted At-Rest Persistence

Documents are now encrypted before storage on both the server (SQLite) and the
client (IndexedDB) using NaCl secretbox (XSalsa20-Poly1305).

### Server-side

| Aspect | Detail |
|--------|--------|
| **Toggle** | `NIGHTJAR_ENCRYPTED_PERSISTENCE=1` environment variable (off by default) |
| **Module** | `server/unified/crypto.js` — encrypt, decrypt, generateKey, deriveKey, keyFromHex, padBlock, unpadBlock |
| **Storage** | `bindState` decrypts on load; `writeState` encrypts before SQLite insert |
| **Key delivery** | `POST /api/deliver-key` with IP-based rate limiting (30 requests/min) |
| **Status** | `GET /api/encrypted-persistence` returns current mode |
| **Deferred load** | If a key arrives after `bindState`, the server decrypts and applies retroactively |

### Client-side

| Aspect | Detail |
|--------|--------|
| **Module** | `EncryptedIndexeddbPersistence.js` — proxy Y.Doc wrapper around `y-indexeddb` |
| **Encryption** | NaCl secretbox with 4 KB block padding for traffic-analysis resistance |
| **Fallback** | Gracefully falls back to plain `y-indexeddb` when no key is available |
| **Key delivery** | `deliverKeyToServer()` in `websocket.js` sends keys via HTTP POST before WebSocket connection (web mode only) |

---

## 🌐 Public Landing Page Overhaul

The public site at `frontend/public-site/index.html` was rebuilt from scratch:

- **Sticky navigation** with smooth-scroll anchor links
- **Hero section** with animated typing effect and platform download buttons
- **Dynamic download resolution** — fetches GitHub Releases API at page load, rewires download buttons to direct asset URLs (`.exe`, `.dmg`, `.AppImage`), and updates the version badge
- **Animated slideshow** with screenshots and feature descriptions
- **12 feature cards** in a responsive grid
- **Competitor comparison table** (vs. Google Docs, Notion, Obsidian, Standard Notes)
- **Security section** explaining the zero-knowledge architecture
- **Tech stack pills** showing core dependencies

### Shared Content Architecture

All marketing copy is defined once in `frontend/public-site/content/index.json` (hub)
plus 15 section-specific JSON files. These are consumed by:

1. The public landing page (`index.html`)
2. The `/docs/` wiki (15 HTML pages + hub)
3. The in-app HelpPage (`HelpPage.jsx`, refactored from 549 → 203 lines)

### `/docs/` Wiki

- `docs.css` — shared styling for all wiki pages
- `index.html` — hub page linking to all sections
- `_template.html` — base template for section pages
- 15 section HTML files covering identity, editor, collaboration, inventory, file storage, sharing, chat, search, settings, and more

---

## 🛠️ Build & CI/CD Improvements

| Change | Detail |
|--------|--------|
| **VITE_GITHUB_PAT** | No longer gated to development mode — injected in all build modes so CI/CD Electron builds include the PAT for bug-report integration |
| **deploy.yml** | Updated to copy `docs/`, `content/`, and `screenshots/` directories to VPS |
| **build.yml** | Updated to include `frontend/public-site/content/` and `docs/` in build artifacts |
| **bootstrap.sh** | Normalized GitHub URLs to `NiyaNagi/Nightjar` |

---

## 🔗 GitHub URL Normalization

All references to the GitHub repository now use the correct casing:

| File | Change |
|------|--------|
| `BugReportModal.jsx` | `niyanagi/nightjar` → `NiyaNagi/Nightjar` |
| `UserProfile.jsx` | `niyanagi/nightjar` → `NiyaNagi/Nightjar` |
| `frontend/public-site/index.html` | `nicsteenwyk` → `NiyaNagi` (3 locations) |
| `server/deploy/bootstrap.sh` | `nicsteenwyk` → `NiyaNagi` (2 locations) |

---

## 🧪 Testing

| Metric | Value |
|--------|-------|
| **Test suites** | 136 passed |
| **Total tests** | 4,173 passed, 6 skipped, 0 failed |
| **Runtime** | ~57s |

### New Test Suites

| Suite | Lines | Coverage |
|-------|-------|----------|
| `tests/sharing.test.js` | 228 | All clickable link functions, round-trips, custom hosts, legacy toggle, edge cases |
| `tests/server-crypto.test.js` | 543 | Encrypt/decrypt, key validation, padding, large updates, cross-compatibility with sidecar format |
| `tests/encrypted-indexeddb.test.js` | 164 | Round-trip, wrong-key rejection, corrupted ciphertext, 4KB padding |
| `tests/encrypted-persistence.test.js` | 426 | Server storage cycles, key store, key delivery endpoint, deferred-load, cross-key isolation |
| `tests/public-site-content.test.js` | 207 | Validates all 15 shared content JSON files and docs wiki pages |

---

## 📋 Cumulative Feature Summary (v1.5 → v1.7.11)

| Version | Highlights |
|---------|------------|
| **v1.5.0** | Notification sound system, Do Not Disturb mode |
| **v1.5.13** | Multi-document presence, chat fixes, spreadsheet improvements |
| **v1.6.0–v1.6.1** | Complete inventory management system, CSV/XLSX import, US heatmap, encrypted addresses |
| **v1.7.0** | File storage dashboard (30+ components), P2P file transfer, presence fixes |
| **v1.7.3** | PermissionWatcher, factory reset safety, Tor SOCKS proxy, relay bridge fallback |
| **v1.7.4–v1.7.5** | Curve25519 scoped keys, analytics components, git history sanitization |
| **v1.7.7** | README feature audit (30+ features documented for the first time) |
| **v1.7.9** | 30-iteration codebase audit — 259 bugs found, 165 fixed |
| **v1.7.10** | 8 critical regression fixes, factory reset/chat/inventory IPC hardening |
| **v1.7.11** | Clickable HTTPS share links, encrypted at-rest persistence, landing page overhaul, /docs/ wiki, CI/CD updates, 4,173 tests |

---

## 📦 Build Targets

| Platform | Artifacts |
|----------|-----------|
| **Windows** | `.exe` (NSIS installer), `.msi` |
| **macOS** | `.dmg`, `.zip` (x64 + arm64) |
| **Linux** | `.AppImage`, `.deb` |
