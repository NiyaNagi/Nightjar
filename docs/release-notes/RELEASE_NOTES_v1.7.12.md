# Nightjar v1.7.12 Release Notes

**Release Date:** February 19, 2026

This release delivers comprehensive UI action telemetry for debugging, automatic bug report submission to GitHub, clickable share links, landing page improvements, and a deployment path rename from `/toot` to `/app`.

---

## 🚀 New Features

### Comprehensive UI Action Telemetry

- **Full UI action logging across 21+ components** — Every significant user interaction is now recorded via `logBehavior()` for inclusion in bug reports and diagnostic data. Over 230 instrumented actions across the entire app.
- **Chat telemetry** — Logs for sending/editing/deleting messages, creating groups, archiving/leaving/deleting channels, switching tabs, inserting mentions, expanding/minimizing chat, and marking all as read.
- **Kanban telemetry** — Logs for adding/editing/deleting/moving cards and columns, drag-and-drop operations, column reordering, retry sync, and working offline.
- **Editor telemetry** — Logs for all toolbar formatting actions (bold, italic, strikethrough, code, headings, blockquote, code blocks, lists, tables, undo/redo) in both the main toolbar and floating toolbar.
- **File explorer telemetry** — Logs for file upload, download, rename, delete, move, favorite, restore, permanently delete, folder operations, trash management, settings updates, and view changes.
- **Identity telemetry** — Logs for identity creation, editing, deletion, switching, export/import, onboarding steps, lock screen unlock, and recovery code actions.
- **Navigation telemetry** — Logs for tab switches, workspace switching, search palette open/close/select, comment actions (add/reply/resolve/delete), and modal interactions.
- **Settings telemetry** — Logs for every setting change, save, reset, factory reset, Tor/relay controls, notification preferences, and lock timeout adjustments.
- **Diagnostic report integration** — The full action telemetry (last 500 entries with timestamps, categories, and contextual data) is now included in the collapsible Diagnostic Report section of every bug report.
- **Expanded Recent Actions** — Bug report body now shows the last 50 actions (up from 20) with a 3 KB character budget (up from 2 KB).

### Automatic Bug Report Submission

- **Server-side proxy endpoint** — Added `POST /api/bug-report` to the unified server with rate limiting, which creates GitHub issues using a server-held PAT. No user credentials needed.
- **Three-tier fallback chain** — Bug reports try: (1) server proxy, (2) direct GitHub API with build-time PAT, (3) clipboard copy / file download. Users never have to manually create issues.
- **CI/CD PAT integration** — The `ISSUE_GITHUB_PAT` secret is deployed to the server `.env` file and inlined into Electron builds via Vite at compile time.

### Clickable Share Links

- **HTTPS join URLs** — WorkspaceSettings now generates clickable `https://night-jar.co/app/join/...` links instead of opaque `nightjar://` protocol links, making sharing work in browsers and across platforms.

### Landing Page Enhancements

- **Mascot chat bubble** — Added Ralph Wiggum–inspired mascot chat bubble to the landing page with slideshow preloading fixes.
- **Real app screenshots** — Replaced placeholder screenshots with actual captures of the running application.
- **Logo fix** — Added logo files to `frontend/public/` so they're correctly bundled into dist builds and served on both localhost and production.

---

## 🐛 Bug Fixes

### Accessibility & UI

- **GitHub nav button contrast** — Changed the GitHub button from accent background (#6c63ff) to card background, improving contrast ratio from ~3.9:1 to 11:1+ for WCAG AA compliance.
- **Download button styling** — Reverted experimental brand-colored download buttons back to the original primary/secondary autodetect behavior with a strengthened pulse-glow animation (40% brighter, larger shadow) on the detected platform's button. Respects `prefers-reduced-motion`.

### Documentation

- **Docs wiki encoding** — Fixed character encoding issues in the documentation wiki pages.

---

## 🔧 Infrastructure & DevOps

### App Path Rename: `/toot` → `/app`

- **Deployment path updated everywhere** — The web app is now served at `night-jar.co/app` instead of `night-jar.co/toot`. Updated across all 9 affected files:
  - `docker-compose.prod.yml` — `BASE_PATH=/app`, healthcheck URL
  - `nginx.conf` — `location /app/`, exact-match redirect
  - `Dockerfile` — ENV comment and example paths
  - `server/unified/index.js` — JSDoc comments
  - `frontend/src/utils/websocket.js` — JSDoc comment
  - Landing page `index.html` — hero link, FAQ text, footer link
  - `AppSettings.jsx` — "Web App" link in About section
  - `sharing.test.js` — test fixture URL
  - `docs/CLICKABLE_SHARE_LINKS_SPEC.md` — all example URLs

### CI/CD Improvements

- **Build workflow PAT** — All three platform builds (Windows, macOS, Linux) now use `secrets.ISSUE_GITHUB_PAT` as a Vite build-time variable for direct bug report submission from the desktop app.
- **Deploy workflow PAT** — The deploy script writes `ISSUE_GITHUB_PAT` to the server `.env` file, which Docker Compose passes to both relay and private containers.
- **Docker Compose updates** — Both `docker-compose.prod.yml` and `server/unified/docker-compose.yml` pass `GITHUB_PAT` to all service configurations.

---

## 📊 Test Coverage

- 66/66 bug report modal tests passing
- 23/23 bug report proxy tests passing
- 38/38 sharing tests passing (updated for `/app` path)
- Full Vite build verified clean

---

## 📋 Files Changed (since v1.7.11)

15 commits, spanning:
- 22 component/context files (telemetry instrumentation)
- 9 infrastructure files (path rename)
- 6 CI/CD and deployment files
- 4 landing page and static asset files
- 1 documentation spec file
- 1 test file
