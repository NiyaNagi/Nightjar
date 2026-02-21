# Release Notes — v1.7.21

**Share Link Blank Screen & Relay Routing Fix (Issue #6)**

Released: 2026-02-21

## Summary

Fixed three interrelated bugs that prevented share links from working on the public relay at night-jar.co. Clicking a `/join/` share link showed a blank white screen, and even after manually navigating to the app, the shared workspace appeared empty with 0 documents.

## Bug Fixes

### 1. Blank Screen on Share Link Click (Critical)
- **Root Cause**: When nginx served the React SPA from the relay via `/join/`, the SPA's Vite-bundled JavaScript at `/assets/main-xxx.js` fell through to the catch-all location and returned the landing page HTML instead of JavaScript — browser couldn't execute HTML as JS
- **Fix**: Added `location /assets/` nginx block that proxies to the relay server, with aggressive caching (7-day, immutable) since Vite content-hashes all filenames

### 2. API Routes Not Proxied to Relay (Critical)
- **Root Cause**: API calls from the relay-served SPA (`/api/rooms/:room/key`, `/api/encrypted-persistence`, `/api/bug-report`) fell through to the catch-all and returned landing page HTML
- **Fix**: Added `location /api/` nginx block that proxies all API routes to the relay. The private instance at `/app/` is unaffected since its location block has higher precedence

### 3. Relay Upgraded to Full Encrypted Persistence (Medium)
- **Root Cause**: The relay ran in `NIGHTJAR_MODE=relay` which disabled all persistence. Web users joining via share link could only see workspace data while the desktop peer was online — if the desktop went offline, the workspace appeared empty
- **Fix**: Changed relay to `NIGHTJAR_MODE=host` with `ENCRYPTED_PERSISTENCE=true` and a persistent data volume. Workspace data is now encrypted at rest on the relay server, so share-link users can sync even when the original peer is offline
- **Safety net**: The `/api/encrypted-persistence` endpoint now returns `false` when persistence is disabled (`DISABLE_PERSISTENCE=true`), preventing unnecessary key delivery attempts in pure-relay deployments

## Files Changed
- `server/deploy/nginx.conf` — Added `/assets/` and `/api/` proxy blocks, removed redundant `/api/mesh/` block, updated routing documentation
- `server/deploy/docker-compose.prod.yml` — Relay upgraded to `NIGHTJAR_MODE=host` with `ENCRYPTED_PERSISTENCE=true` and persistent data volume
- `server/unified/index.js` — `/api/encrypted-persistence` now returns `ENCRYPTED_PERSISTENCE && !DISABLE_PERSISTENCE`
- `tests/share-link-routing-fix.test.js` — 21 new tests

## Deployment Notes

After the Docker image is rebuilt by CI:
```bash
# On the production server:
cd /opt/Nightjar
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d

# Update nginx config:
cp server/deploy/nginx.conf /etc/nginx/sites-available/night-jar
sudo nginx -t && sudo systemctl reload nginx
```

## Stats
- 4 files changed, 237 insertions, 11 deletions
- 21 new tests (all passing)
