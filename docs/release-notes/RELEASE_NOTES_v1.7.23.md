# Nightjar v1.7.23 Release Notes

**Release Date:** June 2025

This release fixes **Issue #7** — share links (`/join/w/XXXXX`) showing a white screen instead of loading the workspace. The root cause was Vite's relative `base: './'` setting, which made the browser resolve asset URLs relative to the nested route path. The fix injects a `<base href="/">` tag server-side, with three defense-in-depth fallback layers.

---

## 🐛 Root Cause

Vite builds the frontend with `base: './'`, which produces relative asset references in `index.html`:

```html
<script type="module" src="./assets/main-abc123.js"></script>
<link rel="stylesheet" href="./assets/main-def456.css">
```

When the browser loads the SPA at `/join/w/E49Plyec...`, it resolves these relative paths against the current URL:

| What the browser sees | What it resolves to |
|---|---|
| `./assets/main-abc123.js` | `/join/w/assets/main-abc123.js` ❌ |
| `./assets/main-def456.css` | `/join/w/assets/main-def456.css` ❌ |

Both requests 404, producing a blank white screen. On some configurations, the SPA catch-all returns HTML for the `.js` request, causing the browser to reject it with a MIME type error.

---

## ✅ Fix: `<base href="/">` Injection

The Express server in `server/unified/index.js` now reads `index.html` at startup and injects a `<base href="/">` tag immediately after `<head>`:

```html
<head>
    <base href="/">          <!-- injected by server -->
    <meta charset="UTF-8">
    ...
```

With `<base href="/">`, the browser resolves relative paths from the root:

| What the browser sees | What it resolves to |
|---|---|
| `./assets/main-abc123.js` | `/assets/main-abc123.js` ✅ |
| `./assets/main-def456.css` | `/assets/main-def456.css` ✅ |

For the private instance at `/app`, the base href becomes `/app/`, correctly scoping asset resolution to the sub-path.

---

## 🛡️ Defense-in-Depth (3 Fallback Layers)

### Layer 1: `/join/*` Asset Extension Safety Net

The `/join/*` catch-all route now detects static asset extensions (`.js`, `.css`, `.png`, `.woff2`, etc.) and calls `next()` instead of serving HTML. This prevents the SPA from returning HTML with `text/html` MIME type for JavaScript requests.

### Layer 2: `/join/` Rewrite Middleware

A middleware intercepts requests matching `/join/.../assets/...` (from stale cached pages that don't have `<base>`) and rewrites `req.url` to `/assets/...`, forwarding to `express.static`.

### Layer 3: Asset 404 Guard

A middleware after `express.static` catches any `/assets/...` request that wasn't served by the static handler and returns a proper `404` instead of falling through to the SPA catch-all. This prevents the browser from receiving HTML when it expected JavaScript.

---

## 🧪 Test Coverage

**56 new tests** in `tests/share-link-base-path.test.js` across 14 describe blocks:

| Category | Tests | What it verifies |
|---|---|---|
| `<base href>` injection | 6 | Tag present, correct href, BASE_PATH support |
| `/join/*` asset safety net | 4 | Static extensions bypass HTML, non-assets get HTML |
| `/join/` rewrite middleware | 4 | Nested asset paths rewritten to `/assets/...` |
| Asset 404 guard | 3 | Missing assets return 404, not SPA HTML |
| Vite relative base | 3 | `vite.config.js` uses `base: './'`, build output has relative refs |
| Frontend `index.html` source | 3 | Source HTML has no `<base>` (server injects it) |
| nginx proxying | 5 | `/assets/`, `/join/`, `/api/` routes configured |
| Express route ordering | 4 | Static before API before SPA catch-all |
| E2E share link resolution | 6 | Full flow: browser loads `/join/w/X` → assets resolve to `/assets/...` |
| E2E private instance | 4 | BASE_PATH `/app` → `<base href="/app/">` |
| Dockerfile build | 4 | Multi-stage build, `--base="./"` flag, node:20-slim |
| Dockerfile setup | 4 | Copies dist + node_modules, exposes port, healthcheck |
| PWA manifest rewrite | 3 | Manifest URLs absolute, start_url matches BASE_PATH |
| Config consistency | 3 | Port, CORS origins, NIGHTJAR_MODE alignment |

---

## 📁 Files Changed

| File | Change |
|---|---|
| `server/unified/index.js` | `<base href>` injection, `/join/*` safety net, `/join/` rewrite, asset 404 guard |
| `tests/share-link-base-path.test.js` | 56 new tests (14 describe blocks) |
| `package.json` | Version `1.7.22` → `1.7.23` |
| `README.md` | v1.7.23 changelog entry |
| `docs/security/SECURITY_HARDENING.md` | Fix 9 section added |

---

## 🔗 Related

- **Issue**: [#7 — Sharing still broken](https://github.com/NiyaNagi/Nightjar/issues/7)
- **Previous fix**: v1.7.22 fixed relay bridge defaults and Electron share link format (Issue #6)
- **Vite `base` docs**: The `base: './'` setting is intentional for Electron `file://` compatibility — the server-side `<base>` tag corrects it for web deployments only
