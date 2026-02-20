# Release Notes — v1.7.7

**Release Date:** February 18, 2026

Nightjar v1.7.7 is a documentation and quality release. A comprehensive audit compared
every frontend component, hook, utility, and subsystem against the README and discovered
**30+ features that were never documented**. This release adds them all, along with
expanded descriptions for 14 under-documented features, and records the cumulative
feature set built across v1.5 → v1.7.

---

## 📖 Documentation Overhaul

### New README Sections

| Section | What it covers |
|---------|----------------|
| **🔑 Identity & Security** | Multiple identities, QR identity transfer, encrypted backup/restore, user profile customization, memorable password generator, encrypted localStorage, auto-lock timeout |
| **⚙️ App Settings** | Theme (light/dark/system), editor typography, notification sounds & DND, privacy & auto-lock, network & relay configuration |
| **📖 Built-in Help** | In-app wiki-style documentation overlay with deep-linkable sections |
| **🐛 Bug Reporting** | One-click GitHub issue creation, auto-populated context, screenshot capture, privacy-aware logging |
| **🛡️ Error Handling** | Global error boundary, automatic data migration, toast notifications, keyboard accessibility |
| **🐦 Nightjar Mascot** | Animated bird companion with speech bubbles and two display modes |
| **📊 Status Bar** | P2P status, Tor mode, word/cell counts, collaborator avatars, sync controls |

### Expanded Existing Sections

| Section | What was added |
|---------|----------------|
| **Rich Text Editor** | Floating selection toolbar (bubble menu), version history with rollback & diff viewer, auto-save with debounce |
| **Inventory** | 4-step onboarding wizard, shipping provider integration (6 carriers), carrier auto-detection with tracking links |
| **File Storage** | Lasso / rubber-band drag-select for file cards |
| **Collaboration** | Author attribution with per-character tracking, deterministic identity colors, collaborator flyout card, inline markdown in chat |
| **Organization** | Workspace switcher with permission badges, hierarchical sidebar with color gradients & context menus, icon & color picker (8 emoji categories + 20 colors), breadcrumb navigation, fuzzy search palette (7 categories, instant + async phases) |
| **Sharing** | Join-with-link modal with real-time validation, entity-level sharing (workspace/folder/document) |

---

## 🔍 Features Documented for the First Time

These features already existed in the codebase but were never mentioned in any
README or release notes:

### Identity & Crypto
1. **Multiple identity management** — hold multiple Ed25519 identities on one device with per-identity PIN unlock
2. **Identity QR transfer** — encrypted QR code + 4-digit PIN for device-to-device identity migration (5-minute expiry)
3. **Encrypted backup & restore** — XSalsa20-Poly1305 encrypted identity + workspace backup files
4. **Memorable password generator** — human-friendly adjective-noun workspace keys (8+ bits entropy/word)
5. **Encrypted local storage** — NaCl secretbox defense-in-depth for browser localStorage with session-scoped keys
6. **Deterministic identity colors** — consistent avatar colors across devices via djb2 hash → HSL from publicKey

### Editor & Content
7. **Floating selection toolbar** — bubble menu on text selection: formatting, links, inline comments
8. **Version history with rollback** — timeline slider, diff viewer, author attribution, rollback to any state
9. **Auto-save** — debounced (1s default) with duplicate-save prevention and retry on concurrent writes
10. **Author attribution** — color-coded per-character contributor tracking via Yjs awareness

### UI & Navigation
11. **Search palette** — fuzzy search across 7 categories (people, docs, folders, inventory, files, chat, content) with two-phase instant + async full-text search
12. **Hierarchical sidebar** — workspace → folder → document tree with color gradients, context menus, inline renaming
13. **Icon & color picker** — 60+ emoji icons (8 categories) + 20 accessible color presets for workspaces/folders/documents
14. **Breadcrumb navigation** — visual path with permission-aware access levels
15. **Workspace switcher** — dropdown with permission badges (Owner/Editor/Viewer) and quick-create
16. **Collaborator flyout** — click avatar to view profile, start direct chat, or follow cursor
17. **Status bar** — P2P status, Tor indicator, word counts, collaborator avatars, sync phase, force-sync controls
18. **Lasso selection** — rubber-band drag-select for file/folder cards (Ctrl+drag additive)

### App Infrastructure
19. **In-app documentation** — wiki-style help overlay with sidebar TOC and deep-linkable sections
20. **One-click bug reporting** — auto-populated GitHub issues with diagnostic data, action log, and screenshot
21. **Privacy-aware logging** — auto-strips PII (emails, IPs, display names) before capture
22. **Secure logger** — separate utility that redacts encryption keys, mnemonics, passwords, and tokens
23. **Global error boundary** — catches React rendering crashes with diagnostic copy, reload, and reset
24. **Toast notification system** — ephemeral success/error/info messages
25. **Automatic data migration** — schema migration from flat → workspace-based format with key re-derivation
26. **Keyboard accessibility** — focus trap across all modals (Tab/Shift+Tab cycling, Escape to close)
27. **Nightjar mascot** — animated bird with random sayings in speech bubbles (large + mini modes)

### Inventory Subsystem
28. **Onboarding wizard** — 4-step inventory setup: name/configure → define catalog → invite participants → import data
29. **Shipping provider integration** — PirateShip, Shippo, EasyPost, USPS, UPS, FedEx with URL launchers and address formatters
30. **Carrier auto-detection** — auto-detects carrier from tracking number patterns with clickable tracking links

### Sharing & Collaboration
31. **Join-with-link modal** — paste `nightjar://` links or short codes with real-time validation and password field
32. **Entity-level sharing** — share workspaces, folders, or individual documents with per-entity permission tiers
33. **Inline markdown in chat** — bold, italic, strikethrough, links, code, checkboxes in chat messages

---

## 🐛 Bug Report Modal — PAT Verification

Verified the in-app bug reporter is correctly wired to the new repository:
- **API URL**: `https://api.github.com/repos/niyanagi/nightjar/issues` ✅
- **PAT scope**: Fine-grained, `niyanagi/nightjar` Issues read/write only ✅
- **Headers**: Bearer token with `X-GitHub-Api-Version: 2022-11-28` ✅
- **Labels**: Auto-tagged `bug` on creation ✅

---

## 🧪 Testing

| Metric | Value |
|--------|-------|
| **Test suites** | 129 passed |
| **Total tests** | 3,790 (3,779 passed, 11 skipped, 0 failed) |
| **Runtime** | ~57s |

---

## 📋 Cumulative Feature Summary (v1.5 → v1.7.7)

For reference, here is the full feature set built across the last 12 releases:

| Version | Highlights |
|---------|------------|
| **v1.5.0** | Notification sound system, Do Not Disturb mode |
| **v1.5.13** | Multi-document presence, chat fixes, spreadsheet improvements |
| **v1.6.0** | Complete inventory management system (admin/producer/requester), CSV/XLSX import, US heatmap, encrypted addresses |
| **v1.6.1** | CSV date parsing fix, analytics field normalization |
| **v1.7.0** | File storage dashboard (30+ components), P2P file transfer, presence fixes, server relay handlers |
| **v1.7.3** | PermissionWatcher, factory reset safety, Tor SOCKS proxy, relay bridge fallback, Y.Map migration |
| **v1.7.4** | Curve25519 scoped keys, address reveal pipeline fix, GitHub migration |
| **v1.7.5** | 3 analytics components (ProducerResponseTime, StatusTransitions, UnitsShippedByType), git history sanitization |
| **v1.7.7** | README feature audit (30+ features documented), comprehensive release notes |

---

## 📦 Build Targets

| Platform | Artifacts |
|----------|-----------|
| **Windows** | `.exe` (NSIS installer), `.msi` |
| **macOS** | `.dmg`, `.zip` (x64 + arm64) |
| **Linux** | `.AppImage`, `.deb` |
