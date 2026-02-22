# Nightjar v1.7.16 Release Notes

**Release Date:** February 20, 2026

This release fixes the **Progressive Web App (PWA)** so that "Add to Home Screen" opens the Nightjar application instead of the night-jar.co landing page.

---

## 🔧 PWA Start URL Fix

**Problem:** When a user installed the PWA (via "Add to Home Screen" on iOS/Android or the browser install prompt), the app opened to the root `night-jar.co` landing page instead of the actual Nightjar application at its deployed path (e.g., `/app`).

**Root Cause:** The PWA manifest had `"start_url": "/"` which always resolved to the domain root — the public marketing page — regardless of where the app was actually served. There was also no `scope` property to restrict PWA navigation to the app.

**Fix — Two-Layer Approach:**

### 1. Static Manifest Update (`frontend/public/manifest.json`)

| Property | Before | After | Why |
|----------|--------|-------|-----|
| `start_url` | `"/"` | `"./"` | Relative URL resolves from the manifest's own location, which is inside the app's static assets — not the domain root |
| `scope` | *(missing)* | `"./"` | Restricts PWA navigation to the app's path, preventing the PWA from navigating to the landing page |
| Icon `src` | `"/nightjar-192.png"` | `"./nightjar-192.png"` | Relative paths resolve correctly under any `BASE_PATH` deployment |

### 2. Dynamic Server Route (`server/unified/index.js`)

Added a `GET {BASE_PATH}/manifest.json` Express route that:

- **Intercepts** manifest requests before `express.static` (registered first)
- **Reads** the static `manifest.json` from disk
- **Injects** the server's `BASE_PATH` into `start_url`, `scope`, and all icon `src` paths at runtime
- **Serves** with `no-cache` headers (`Cache-Control: no-cache, no-store, must-revalidate`) to prevent stale PWA configs from being cached by the browser or CDN
- **Content-Type**: `application/manifest+json` for proper MIME handling

**Example with `BASE_PATH=/app`:**

```json
{
  "start_url": "/app/",
  "scope": "/app/",
  "icons": [
    { "src": "/app/nightjar-192.png", ... },
    { "src": "/app/nightjar-512.png", ... }
  ]
}
```

**Example with no `BASE_PATH` (root deployment):**

```json
{
  "start_url": "/",
  "scope": "/",
  "icons": [
    { "src": "/nightjar-192.png", ... },
    { "src": "/nightjar-512.png", ... }
  ]
}
```

### Why Two Layers?

| Layer | When It Applies |
|-------|----------------|
| **Static manifest** (relative `./` URLs) | Dev server, Electron builds, any deployment where the server route isn't active |
| **Dynamic server route** (absolute `BASE_PATH` URLs) | Production web deployment via the unified server |

The static manifest uses relative URLs as a safe default, while the server route provides belt-and-suspenders correctness by injecting absolute paths that are guaranteed to match the deployment configuration.

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/public/manifest.json` | `start_url` → `"./"`, added `scope: "./"`, icon paths → relative |
| `server/unified/index.js` | Added dynamic manifest route before `express.static` |
| `package.json` | Version bump `1.7.15` → `1.7.16` |

---

## Testing Notes

- **PWA Install Test**: After deploying, install the PWA via browser prompt or "Add to Home Screen". The app should open directly to the Nightjar workspace, not the landing page.
- **Existing Users**: Users who previously installed the PWA may need to uninstall and reinstall, or clear the browser's PWA cache, since the old manifest with `start_url: "/"` may be cached.
- **No-Cache Headers**: The dynamic route serves `Cache-Control: no-cache, no-store, must-revalidate` to prevent future caching issues.
