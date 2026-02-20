# Clickable Share Links — Design Specification

## Problem

Share links today use the `nightjar://` custom protocol, which is not clickable in most contexts (email, chat, social media). Users must manually copy-paste them. Server-invite tokens (`https://host/invite/{token}`) exist but only store non-sensitive metadata — the encryption key and password still live in the `#fragment` of a `nightjar://` link that the user must separately provide.

**Goal:** Make share links clickable HTTPS URLs that:
1. Open the web-deployed version of Nightjar in a browser
2. OR deep-link into the installed desktop app (if present)
3. Without storing any sensitive data (encryption keys, passwords) on the server

## Current Architecture Summary

| Format | Example | Sensitive data in URL? | Clickable? |
|--------|---------|----------------------|------------|
| `nightjar://` | `nightjar://w/{payload}#k:{key}&perm:e` | Yes — in `#fragment` (never sent to server) | ❌ No |
| Server invite | `https://night-jar.co/app/invite/{token}` | No — token is opaque lookup key | ✅ Yes |
| Compressed | `nightjar://c/{deflate+base62}` | Yes — in compressed payload | ❌ No |

**Key insight:** The `#fragment` portion of a URL is **never sent to the server** per RFC 3986. This means we can build clickable `https://` URLs that carry secrets in their fragment — the web app (running client-side in the browser) reads the fragment, but the server never sees it.

## Design: Unified Clickable Share Link

### New Link Format

```
https://{webHost}/{basePath}/join/{base62_payload}#{fragment_params}
```

**Example:**
```
https://night-jar.co/app/join/3mZKxvBc7DqNwRtYp2jH9a#k:abc123...&perm:editor&topic:deadbeef...&hpeer:cafebabe...&nodes:wss%3A%2F%2Frelay.night-jar.co&sig:xyz...&by:owner123&exp:1740000000000
```

**What's in the URL path (visible to server):**
- `/join/{base62_payload}` — same 20-byte binary payload as current `nightjar://` links (entity ID + version + flags + CRC16)
- Server only uses this to serve the SPA — it does NOT parse or store the payload

**What's in the `#fragment` (invisible to server, read only by client-side JS):**
- `k:{base64url}` — encryption key (Option A)
- `p:{password}` — embedded password (Option B)
- `perm:{level}` — permission level
- `topic:{hash}` — Hyperswarm DHT topic
- `hpeer:{keys}` — Hyperswarm peer keys
- `nodes:{urls}` — relay WebSocket URLs
- `srv:{url}` — sync server URL
- `sig:{signature}` — Ed25519 signature
- `by:{pubkey}` — signer's public key
- `exp:{timestamp}` — expiry

**Security:** Identical to the current `nightjar://` scheme — all secrets stay in the fragment. The HTTPS server simply serves the SPA for any `/join/*` path.

### App-Installed Deep Link (Universal Links / App Links)

When the desktop app is installed, the OS can intercept `https://night-jar.co/app/join/...` and open the app instead of the browser.

**How:**
1. **Windows:** Register as handler for `https://night-jar.co` domain via `windows.protocol.handlers` or via a custom URI association
2. **macOS/Linux:** Universal Links / `x-scheme-handler`
3. **Fallback:** The web app itself detects if the desktop app is installed (attempted `nightjar://` launch + timeout) and offers "Open in App" vs "Continue in Browser"

**Simpler first approach:** The web page served at `/join/...` contains:
1. Attempt to redirect to `nightjar://w/{payload}#{fragment}` (deep link into app)
2. After a short timeout (~1.5s), if still on the page → assume app not installed → proceed with web join flow

### Web Version as a Workspace Peer

Each workspace needs to know about its web deployment URL so that:
- Share links can be generated pointing to the correct web host
- The web-deployed instance participates in P2P sync via WebSocket relay

#### Workspace Metadata Addition

Add an optional `webUrl` field to workspace metadata:

```js
{
  id: entityId,
  name: 'My Workspace',
  // ... existing fields ...
  webUrl: 'https://night-jar.co/app',  // NEW — web deployment URL for this workspace
}
```

**How it's set:**
- When creating a workspace via the web version → auto-detected from `window.location.origin + basePath`
- When creating via Electron → user optionally specifies, or it's discovered when the workspace first connects to a relay
- Synced to all peers via the existing workspace-meta CRDT

**How it's used:**
- `generateShareLink()` checks `workspace.webUrl` → if set, generates `https://` clickable link instead of `nightjar://`
- The web client at that URL participates as a peer (connects via WebSocket relay to the workspace's DHT topic)
- The relay server at that URL serves the SPA + provides WebSocket signaling + persistence

## Implementation Plan

### Phase 1: Server — Serve SPA for `/join/*` routes (trivial)

**File:** `server/unified/index.js`

The unified server already has SPA fallback (`GET /*` returns `index.html`). Routes like `/join/{anything}` will naturally serve the React SPA. **No server changes needed** — the existing catch-all already handles this.

### Phase 2: Client — Parse `/join/` URLs on load

**File:** `frontend/src/components/AppNew.jsx`

Update `isShareLinkFragment()` and the mount-time detection to also recognize:
- Current URL path matching `/join/{base62}` 
- Read the `#fragment` for share params (same parsing as today)
- Store in sessionStorage, clear fragment, open join dialog

**File:** `frontend/src/utils/shareLinks.js`

Add:
```js
/**
 * Generate a clickable HTTPS share link
 * Falls back to nightjar:// if no webUrl is available
 */
export function generateClickableShareLink(options) {
  const { webUrl, ...rest } = options;
  
  // Generate the base62 payload (same as nightjar:// links)
  const payload = encodeSharePayload(rest);
  
  // Generate fragment params (same as nightjar:// links)  
  const fragment = buildShareFragment(rest);
  
  if (webUrl) {
    // Clickable HTTPS link
    return `${webUrl}/join/${payload}#${fragment}`;
  }
  
  // Fallback to nightjar:// protocol
  return `nightjar://${typeCode}/${payload}#${fragment}`;
}

/**
 * Parse a /join/ URL path + fragment into share link data
 */
export function parseJoinUrl(url) {
  const joinMatch = url.match(/\/join\/([A-Za-z0-9]+)/);
  if (!joinMatch) return null;
  
  const payload = joinMatch[1];
  const fragment = url.split('#')[1] || '';
  
  // Decode binary payload (same as nightjar:// parsing)
  const decoded = decodeSharePayload(payload);
  
  // Parse fragment params (same as nightjar:// parsing)
  const params = parseShareFragment(fragment);
  
  return { ...decoded, ...params, isClickable: true };
}
```

### Phase 3: Deep Link Attempt → Web Fallback

**File:** `frontend/src/components/JoinLandingPage.jsx` (new component)

When the SPA loads at `/join/{payload}#...`:

```
┌─────────────────────────────────────────────┐
│  "Opening Nightjar..."                       │
│                                              │
│  [spinner]                                   │
│                                              │
│  Attempting to open in desktop app...        │
│                                              │
│  ─── after 1.5s timeout ───                  │
│                                              │
│  App not detected.                           │
│  [Continue in Browser]  [Download App]       │
└─────────────────────────────────────────────┘
```

1. Immediately try `window.location.href = 'nightjar://w/{payload}#{fragment}'`
2. Set 1.5s timeout
3. If page is still visible after timeout → show "Continue in Browser" button
4. "Continue in Browser" → routes to the existing join flow (CreateWorkspaceDialog)
5. "Download App" → links to night-jar.co download page

### Phase 4: Workspace `webUrl` Metadata

**Files:**
- `frontend/src/contexts/WorkspaceContext.jsx` — add `webUrl` to workspace schema
- `frontend/src/components/workspace/CreateWorkspaceDialog.jsx` — auto-set `webUrl` from current host when creating from web
- Workspace-meta CRDT sync — `webUrl` propagates to all peers

**Auto-detection logic:**
```js
// When creating or joining a workspace from the web version
if (isWeb() && !workspace.webUrl) {
  workspace.webUrl = `${window.location.origin}${getBasePath()}`;
}
```

**When syncing from Electron:**
- If workspace has `webUrl` set by a web peer → Electron clients store it
- Share link generation checks `workspace.webUrl` → uses clickable format if available

### Phase 5: Share Link Generation Update

**File:** `frontend/src/utils/shareLinks.js`

Update `generateShareLink()` to accept optional `webUrl`:
- If `webUrl` provided → generate `https://{webUrl}/join/{payload}#{fragment}`
- If not → generate `nightjar://` as today (backward compatible)

**File:** `frontend/src/components/workspace/EntityShareDialog.jsx`

Pass `workspace.webUrl` to `generateShareLink()` when generating links.

### Phase 6: Web Client as Peer

The web version already connects via WebSocket relay (detected by `isWeb()` in platform utils). No additional work needed — when a user opens a `/join/` link in the browser, they:
1. Parse the share data from the fragment
2. Join the workspace (same as today)
3. Connect via WebSocket relay (same as any web client)
4. Appear as a peer to all other workspace members

## Security Analysis

| Concern | Mitigation |
|---------|-----------|
| Server sees encryption key | ❌ Keys are in `#fragment`, never sent to server per RFC 3986 |
| URL in browser history | Fragment is cleared immediately after parsing (existing behavior) |
| URL in Referrer header | Fragments are excluded from Referrer per spec |
| URL in server logs | Server only logs the path (`/join/{payload}`), not the fragment |
| Man-in-the-middle | HTTPS encrypts the full URL including fragment in transit |
| Link shared insecurely | Same risk as current `nightjar://` links — inherent to link-based sharing |
| Server invite tokens still work | ✅ Both systems coexist — tokens for password-required flows, clickable for direct-key flows |

## Migration & Backward Compatibility

- `nightjar://` links continue to work (Electron deep links)
- Server invite tokens continue to work  
- New `https://` clickable links are a **third option**, used when `webUrl` is known
- `parseShareLink()` already cascades through formats — just add `/join/` detection
- Old clients that don't understand `/join/` URLs will still see the SPA (graceful degradation)

## File Change Summary

| File | Change |
|------|--------|
| `frontend/src/utils/shareLinks.js` | Add `generateClickableShareLink()`, `parseJoinUrl()`, update `generateShareLink()` |
| `frontend/src/components/AppNew.jsx` | Detect `/join/` paths on mount, same flow as fragment detection |
| `frontend/src/components/JoinLandingPage.jsx` | **New** — deep link attempt + web fallback UI |
| `frontend/src/components/workspace/EntityShareDialog.jsx` | Pass `webUrl` to link generation |
| `frontend/src/contexts/WorkspaceContext.jsx` | Add `webUrl` to workspace schema, auto-detect for web clients |
| `server/unified/index.js` | None needed (SPA fallback already handles `/join/*`) |
| `server/nginx/nightjar-site` | None needed (already proxies all paths) |

## Open Questions

1. **Should `webUrl` be editable by the workspace owner?** Or always auto-detected? (Recommendation: auto-detected by web clients, displayed in workspace settings as read-only info)
2. **Multiple web deployments?** A workspace could have peers on different relay servers. Should `webUrl` be an array? (Recommendation: single primary URL, set by first web peer, overridable by owner)
3. **QR codes:** Should QR codes encode the clickable URL or the `nightjar://` URL? (Recommendation: clickable URL if available, for maximum compatibility with phone cameras)
4. **Link preview / Open Graph tags:** Should the server inject OG meta tags for `/join/` URLs? This would show a nice preview in chat apps ("Join workspace on Nightjar"). (Recommendation: yes, inject minimal OG tags server-side)
