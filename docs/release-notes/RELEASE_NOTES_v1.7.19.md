# Nightjar v1.7.19 — Share Link Host Fix & Deployment Hardening

**Release Date**: July 24, 2025

---

## 🎯 Summary

Four fixes spanning share links, CI/CD deployment, Cloudflare caching, and release process documentation. The headline change: clicking a share link no longer shows "This site can't be reached" — links pointed to `https://relay.night-jar.co`, a subdomain that never had a DNS record. All share links now use `https://night-jar.co/join/...` with nginx routing them to the relay server.

---

## 🐛 Bug Fixes

### Share Link Host — Critical
- **Problem**: Clicking a share link showed "This site can't be reached" because `DEFAULT_SHARE_HOST` pointed to `https://relay.night-jar.co` — a subdomain with no DNS record
- **Root Cause**: The relay server lives at `night-jar.co:3001` behind nginx, but share links were generated with a `relay.` subdomain that was never configured in DNS
- **Fix**: Changed `DEFAULT_SHARE_HOST` to `https://night-jar.co`, added new `getShareHost()` auto-detection function, added nginx `/join/` location block to proxy requests to the relay server (port 3001)
- **Files Changed**: `frontend/src/utils/sharing.js`, `frontend/src/components/Share/EntityShareDialog.jsx`, `frontend/src/components/WorkspaceSettings.jsx`, `server/deploy/nginx.conf`, `sidecar/mesh-constants.js`, plus UI placeholder updates and documentation

### Missing Screenshots in CI/CD Deploy
- **Problem**: Public site screenshots were not being served after deployment because the `screenshots/` directory was not copied during the CI/CD deploy step
- **Fix**: Added `screenshots/` directory copy command to `.github/workflows/build.yml` deploy step
- **Files Changed**: `.github/workflows/build.yml`

### Cloudflare Edge Cache Serving Stale Screenshots
- **Problem**: After updating screenshot images, Cloudflare's edge cache continued serving the old versions indefinitely
- **Fix**: Added `?v={hash}` cache-bust query parameters to all screenshot `<img>` URLs in the public site landing page
- **Files Changed**: `frontend/public-site/index.html`

---

## 📝 Documentation

### Release Process Instructions in CLAUDE.md
Added three new sections codifying the release note process:
- **"Release Notes — Where They Must Appear"**: README changelog, GitHub release tag, `changelog.json` (if manual), commit message, `RELEASE_NOTES_v*.md` file
- **"Release Notes — How to Gather Changes"**: Git log/diff commands — never write release notes from memory
- **"Release Notes — Review and Update Documentation Pages"**: Checklist for reviewing `public-site/content/*.json` files for affected content
- Updated existing format section to reference v1.7.18 as the canonical format example

---

## 🧪 Test Updates

- 5 new tests for `getShareHost()` behavior (browser origin detection, localhost fallback, Electron fallback)
- 21 assertions updated across 5 test files for the `relay.night-jar.co` → `night-jar.co` URL change
- **Test Results**: 4,540 passing across 143 suites
- Backward compatibility: `isJoinUrl()` and `joinUrlToNightjarLink()` still accept old `relay.night-jar.co` URLs

---

## 📁 Files Changed

| File | Change |
|---|---|
| `frontend/src/utils/sharing.js` | `DEFAULT_SHARE_HOST`, new `getShareHost()`, updated default params |
| `frontend/src/components/Share/EntityShareDialog.jsx` | Import + call site → `getShareHost()` |
| `frontend/src/components/WorkspaceSettings.jsx` | Import + two call sites → `getShareHost()` |
| `frontend/src/components/Settings/TorSettings.jsx` | Relay URL placeholder |
| `frontend/src/components/common/AppSettings.jsx` | Relay URL placeholder |
| `sidecar/mesh-constants.js` | `BOOTSTRAP_NODES` URL |
| `server/deploy/nginx.conf` | New `/join/` proxy location block |
| `server/unified/README.md` | `PUBLIC_URL` example |
| `capacitor.config.json` | Deep link comment |
| `docs/guides/RELAY_DEPLOYMENT_GUIDE.md` | All relay URL examples |
| `docs/specs/CLICKABLE_SHARE_LINKS_SPEC.md` | Example URL |
| `.github/workflows/build.yml` | Add screenshots copy in deploy step |
| `frontend/public-site/index.html` | Version → 1.7.19, cache-bust screenshot URLs |
| `frontend/public-site/content/architecture.json` | Mermaid diagram relay label |
| `CLAUDE.md` | Release notes process instructions |
| `tests/sharing.test.js` | 8 assertions updated, 3 new `getShareHost` tests |
| `tests/share-link-security.test.js` | 3 assertions updated, 1 new `getShareHost` test |
| `tests/relay-server-infrastructure.test.js` | 5 assertions updated |
| `tests/bugfix-v1.8.0.test.jsx` | 3 source-check assertions updated |
| `tests/components/Settings/TorSettings.test.js` | 2 placeholder assertions updated |

---

## 📊 Statistics

| Metric | Value |
|---|---|
| Commits | 4 |
| Files changed | 24 |
| Insertions | 319 |
| Deletions | 82 |

---

## ⬆️ Upgrade Notes

- **No breaking changes** — share links using the old `relay.night-jar.co` host never worked (no DNS record existed), so the URL change is purely a fix
- After deploying the updated `nginx.conf`, reload nginx: `sudo nginx -t && sudo systemctl reload nginx`
- Rebuild Docker image and restart containers to deploy
- No database migrations or client-side data changes required
