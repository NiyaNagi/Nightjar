# Bug Audit — Iterations 26–28 (Final Round)

**Focus areas:** Cross-cutting concerns, security review, untested error paths, configuration bugs  
**Files audited:** `vite.config.js`, `forge.config.js`, `jest.config.js`, `server/unified/index.js`, `server/signaling/index.js`, `Chat.jsx`, `WorkspaceSettings.jsx`, `DocumentPicker.jsx`, `BugReportModal.jsx`, `PermissionGuard.jsx`, `SearchPalette.jsx`, `FolderTree.jsx`, `LockScreen.jsx`, `Kanban.jsx`, `UploadZone.jsx`, `ShareDialog.jsx`, `EntityShareDialog.jsx`, `Changelog.jsx`, `IdentitySettings.jsx`, `PeersList.jsx`, `Toolbar.jsx`, `SelectionToolbar.jsx`, `SimpleMarkdown.jsx`, `FileStorageDashboard.jsx`, `exportUtils.js`, `useFileDownload.js`, `identityManager.js`, `useNotificationSounds.js`, `AppSettings.jsx`  
**Previous bug count:** ~160 found and fixed

---

## Bug #161 — `handleJoinTopic` adds peer to room before topic-limit check (ghost peer leak)

| Field | Value |
|---|---|
| **File** | `server/unified/index.js` |
| **Lines** | 636–643 |
| **Category** | Resource Leak / Logic Error |
| **Severity** | Medium |

**Description:**  
In `handleJoinTopic`, the WebSocket is added to the room (`room.add(ws)`) on line 636 *before* the per-peer topic limit is checked on line 640. When a peer already has 50 topics, the function returns early on line 642 **without removing the WebSocket from the room it was just added to**. This creates a "ghost peer": the peer is counted in the room (inflating `room.size`, blocking room cleanup, appearing in broadcasts) but the topic is not tracked in `info.topics`. When the connection later closes, `handleClose` iterates `info.topics` and will never find this room to clean it up — the ghost entry persists until the room empties organically.

**Old Code:**
```javascript
    room.add(ws);
    
    // Track the topic in peer info - limit max topics per peer to prevent resource exhaustion
    if (!info.topics) info.topics = new Set();
    if (info.topics.size >= 50) {
      this.send(ws, { type: 'error', error: 'too_many_topics' });
      return;
    }
    info.topics.add(topic);
```

**New Code:**
```javascript
    // Track the topic in peer info - limit max topics per peer to prevent resource exhaustion
    if (!info.topics) info.topics = new Set();
    if (info.topics.size >= 50) {
      this.send(ws, { type: 'error', error: 'too_many_topics' });
      return;
    }

    room.add(ws);
    info.topics.add(topic);
```

---

## Bug #162 — Invite API accepts non-numeric `expiresIn`, creating never-expiring invites

| Field | Value |
|---|---|
| **File** | `server/unified/index.js` |
| **Lines** | 1280–1297 |
| **Category** | Input Validation / Security |
| **Severity** | Medium |

**Description:**  
The `POST /api/invites` endpoint destructures `expiresIn` and `maxUses` from `req.body` and passes them directly to `storage.createInvite()` without validating that they are numbers. If an attacker sends `expiresIn: "malicious"`, the computation `now + expiresIn` produces a string (e.g. `"1721234567890malicious"`) via string concatenation. This string is stored in SQLite as `expires_at`. When `getInvite()` later checks `Date.now() > invite.expires_at`, the comparison with a non-numeric string yields `false` — so the invite **never expires**. Similarly, a non-numeric `maxUses` bypasses the use-count limit check.

**Old Code:**
```javascript
    const { token, entityType, entityId, permission, requiresPassword, expiresIn, maxUses } = req.body;
    
    if (!token || !entityType || !entityId || !permission) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Validate field lengths to prevent DoS via huge tokens/IDs
    if (typeof token !== 'string' || token.length > 512 ||
        typeof entityType !== 'string' || entityType.length > 64 ||
        typeof entityId !== 'string' || entityId.length > 256 ||
        typeof permission !== 'string' || permission.length > 64) {
      return res.status(400).json({ error: 'Invalid field format or length' });
    }
    
    storage.createInvite(token, entityType, entityId, permission, {
      requiresPassword,
      expiresIn,
      maxUses
    });
```

**New Code:**
```javascript
    const { token, entityType, entityId, permission, requiresPassword, expiresIn, maxUses } = req.body;
    
    if (!token || !entityType || !entityId || !permission) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Validate field lengths to prevent DoS via huge tokens/IDs
    if (typeof token !== 'string' || token.length > 512 ||
        typeof entityType !== 'string' || entityType.length > 64 ||
        typeof entityId !== 'string' || entityId.length > 256 ||
        typeof permission !== 'string' || permission.length > 64) {
      return res.status(400).json({ error: 'Invalid field format or length' });
    }
    
    // Validate numeric optional fields to prevent type-coercion bypass
    const sanitizedExpiresIn = (typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0)
      ? expiresIn : null;
    const sanitizedMaxUses = (typeof maxUses === 'number' && Number.isInteger(maxUses) && maxUses > 0)
      ? maxUses : null;
    
    storage.createInvite(token, entityType, entityId, permission, {
      requiresPassword: !!requiresPassword,
      expiresIn: sanitizedExpiresIn,
      maxUses: sanitizedMaxUses
    });
```

---

## Bug #163 — `updateIdentityMetadata` uses `Object.assign` without prototype-pollution guard

| Field | Value |
|---|---|
| **File** | `frontend/src/utils/identityManager.js` |
| **Lines** | 927–935 |
| **Category** | Security (Prototype Pollution) |
| **Severity** | Low |

**Description:**  
`updateIdentityMetadata` uses `Object.assign(identities[idx], updates)` to merge arbitrary key/value pairs into an identity object. If `updates` ever contains keys like `__proto__`, `constructor`, or `toString`, this could pollute the object prototype. While this function is currently **exported but never called** externally (dead code), it is a latent vulnerability — any future caller passing partially-untrusted data would hit this. The safer pattern is to use a destructured allowlist or strip dangerous keys.

**Old Code:**
```javascript
export function updateIdentityMetadata(id, updates) {
    const identities = listIdentities();
    const idx = identities.findIndex(i => i.id === id);
    if (idx < 0) return false;

    Object.assign(identities[idx], updates);
    saveIdentities(identities);
    return true;
}
```

**New Code:**
```javascript
export function updateIdentityMetadata(id, updates) {
    const identities = listIdentities();
    const idx = identities.findIndex(i => i.id === id);
    if (idx < 0) return false;

    // Only allow known metadata fields to prevent prototype pollution
    const ALLOWED_KEYS = ['handle', 'icon', 'color', 'docCount', 'lastUsed', 'deviceName'];
    for (const key of ALLOWED_KEYS) {
        if (key in updates) {
            identities[idx][key] = updates[key];
        }
    }
    saveIdentities(identities);
    return true;
}
```

---

## Bug #164 — `vite.config.js` uses CJS `require()` in ESM-processed config

| Field | Value |
|---|---|
| **File** | `vite.config.js` |
| **Line** | 24 |
| **Category** | Configuration / Portability |
| **Severity** | Low |

**Description:**  
The Vite config uses `require('./package.json').version` despite being processed as ESM (uses `import` statements). Vite internally shims `require` via `createRequire` for config files today, but this is an undocumented implementation detail. If the project ever sets `"type": "module"` in the root `package.json`, migrates to Vitest with a different config loader, or Vite changes this behavior, the config will break with `ReferenceError: require is not defined`. The standard approach is to use `createRequire` explicitly or `readFileSync`.

**Old Code:**
```javascript
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load .env files so VITE_GITHUB_PAT (and any other env vars) are available
  // The empty prefix '' loads ALL env vars, not just VITE_-prefixed ones
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
  root: 'frontend',
  base: './',  // Use relative paths for Electron file:// protocol compatibility
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
  ],
  define: {
    // Polyfill Node.js globals for browser compatibility (needed by Fortune Sheet and bip39)
    global: 'globalThis',
    // Inject app version from package.json
    __APP_VERSION__: JSON.stringify(require('./package.json').version),
```

**New Code:**
```javascript
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import { createRequire } from 'module'

const require = createRequire(import.meta.url);

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load .env files so VITE_GITHUB_PAT (and any other env vars) are available
  // The empty prefix '' loads ALL env vars, not just VITE_-prefixed ones
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
  root: 'frontend',
  base: './',  // Use relative paths for Electron file:// protocol compatibility
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
  ],
  define: {
    // Polyfill Node.js globals for browser compatibility (needed by Fortune Sheet and bip39)
    global: 'globalThis',
    // Inject app version from package.json
    __APP_VERSION__: JSON.stringify(require('./package.json').version),
```

---

## Bug #165 — Server health endpoint exposes internal state without authentication

| Field | Value |
|---|---|
| **File** | `server/unified/index.js` |
| **Lines** | 1214–1223 |
| **Category** | Security / Information Disclosure |
| **Severity** | Low |

**Description:**  
The `/health` endpoint returns room count, uptime, persistence/mesh status, and server mode to any unauthenticated caller. While individually these seem benign, an attacker can use room count + uptime to fingerprint the server, estimate load, and determine the deployment type (`host`/`relay`/`private`). This assists in targeted attacks (e.g., knowing persistence is disabled means data won't survive restarts). The health check should either be restricted to internal networks or return only a minimal `{ status: 'ok' }`.

**Old Code:**
```javascript
// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    rooms: signaling.rooms.size,
    uptime: process.uptime(),
    persistenceEnabled: !DISABLE_PERSISTENCE,
    meshEnabled: MESH_ENABLED,
    serverMode: SERVER_MODE
  });
});
```

**New Code:**
```javascript
// Health check — minimal public response; detailed info behind optional auth header
app.get('/health', (req, res) => {
  const isAdmin = req.headers['x-admin-token'] === process.env.ADMIN_TOKEN;
  if (isAdmin && process.env.ADMIN_TOKEN) {
    return res.json({
      status: 'ok',
      rooms: signaling.rooms.size,
      uptime: process.uptime(),
      persistenceEnabled: !DISABLE_PERSISTENCE,
      meshEnabled: MESH_ENABLED,
      serverMode: SERVER_MODE
    });
  }
  res.json({ status: 'ok' });
});
```

---

## Bug #166 — Chat notification skips new messages when Yjs sync delivers a batch

| Field | Value |
|---|---|
| **File** | `frontend/src/components/Chat.jsx` |
| **Lines** | 708–725 |
| **Category** | Logic Error |
| **Severity** | Low |

**Description:**  
The notification effect uses `lastMessageCountRef.current` to detect new messages by slicing `messages.slice(lastMessageCountRef.current)`. However, when Yjs syncs a batch of messages (e.g., initial CRDT convergence from a peer), the deduplication in `updateFromYjs` may *remove* duplicate messages, causing `messages.length` to temporarily decrease or stay the same. If a dedup pass removes 2 old duplicates and adds 3 new messages, the length increases by 1 but `slice(lastCount)` would only capture the last 1 message, missing 2 real new messages. The fix is to track the last-seen message ID/timestamp rather than array length.

**Old Code:**
```javascript
    useEffect(() => {
        if (messages.length === 0) {
            lastMessageCountRef.current = 0;
            return;
        }
        
        // Only notify for new messages (not initial load)
        if (lastMessageCountRef.current === 0) {
            lastMessageCountRef.current = messages.length;
            return;
        }
        
        // Check for new messages since last count
        const newMessages = messages.slice(lastMessageCountRef.current);
        lastMessageCountRef.current = messages.length;
```

**New Code:**
```javascript
    useEffect(() => {
        if (messages.length === 0) {
            lastMessageCountRef.current = 0;
            lastSeenIdRef.current = null;
            return;
        }
        
        // Only notify for new messages (not initial load)
        if (lastMessageCountRef.current === 0) {
            lastMessageCountRef.current = messages.length;
            lastSeenIdRef.current = messages[messages.length - 1]?.id || null;
            return;
        }
        
        // Find new messages by comparing against the last seen message ID
        // This is robust against deduplication changing array indices
        const lastSeenIdx = lastSeenIdRef.current
            ? messages.findIndex(m => m.id === lastSeenIdRef.current)
            : -1;
        const newMessages = lastSeenIdx >= 0
            ? messages.slice(lastSeenIdx + 1)
            : messages.slice(lastMessageCountRef.current);
        lastMessageCountRef.current = messages.length;
        lastSeenIdRef.current = messages[messages.length - 1]?.id || null;
```

> **Note:** Add `const lastSeenIdRef = useRef(null);` next to the existing `lastMessageCountRef` declaration (around line 170).

---

## Summary

| # | File | Bug | Severity |
|---|---|---|---|
| 161 | `server/unified/index.js:636` | Ghost peer from topic-limit bypass in `handleJoinTopic` | **Medium** |
| 162 | `server/unified/index.js:1280` | Non-numeric `expiresIn`/`maxUses` creates invites that bypass limits | **Medium** |
| 163 | `frontend/src/utils/identityManager.js:932` | `Object.assign` without prototype-pollution guard (dead code) | Low |
| 164 | `vite.config.js:24` | CJS `require()` in ESM config without `createRequire` | Low |
| 165 | `server/unified/index.js:1214` | Health endpoint exposes server internals without auth | Low |
| 166 | `frontend/src/components/Chat.jsx:708` | Notification miscount on Yjs CRDT batch dedup | Low |

**Total new bugs: 6**  
**Cumulative total: ~166**
