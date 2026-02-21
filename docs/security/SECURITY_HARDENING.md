# Security Hardening Summary

> Comprehensive documentation of all 7 security fixes applied to the Nightjar unified server and P2P client stack.

## Overview

The Nightjar security hardening effort addressed **7 categories of vulnerabilities** across the signaling server, y-websocket sync, P2P relay layer, and client-side secret storage. Fixes are grouped into two phases:

| Fix | Description | Phase | Status |
|-----|-------------|-------|--------|
| 1 | Remove workspace existence oracle | 1 | ✅ Complete |
| 2 | Security headers middleware | 1 | ✅ Complete |
| 3 | Ed25519 authenticated key delivery | 1 | ✅ Complete |
| 4 | HMAC room-join authentication | 2 | ✅ Complete |
| 5 | Encrypted localStorage secrets | 1 | ✅ Complete |
| 6 | E2E encrypted relay messages | 2 | ✅ Complete |
| 7 | Security documentation | 2 | ✅ Complete |
| 8 | Relay bridge preference persistence & auto-connect | 3 | ✅ Complete |
| 9 | SPA base path injection for nested routes | 3 | ✅ Complete |

---

## Fix 1: Remove Workspace Existence Oracle

**Threat**: The `/api/workspace/:id/persisted` endpoint allowed unauthenticated callers to probe whether a workspace ID exists on the server, leaking metadata.

**Fix**: Removed the endpoint entirely. Workspace existence is now opaque to external observers.

**Files changed**: `server/unified/index.js`

---

## Fix 2: Security Headers Middleware

**Threat**: Missing HTTP security headers allowed clickjacking, MIME sniffing, and other browser-side attacks.

**Fix**: Added middleware that sets:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

**Files changed**: `server/unified/index.js`

---

## Fix 3: Ed25519 Authenticated Key Delivery

**Threat**: The `POST /api/room/:name/key` endpoint accepted encryption keys from any caller without authentication, allowing an attacker to overwrite a room's encryption key and corrupt all subsequent persistence.

**Fix**: 
- Clients sign key delivery requests with their Ed25519 identity keypair
- Server verifies the signature before accepting the key
- Room ownership is tracked: the first signed delivery "owns" the room
- Subsequent deliveries must come from the same public key
- Replay protection: timestamps must be within a 5-minute window

**Protocol**: `message = "key-delivery:{roomName}:{keyBase64}:{timestamp}"`

**Files changed**: `server/unified/index.js`, `frontend/src/utils/websocket.js`

---

## Fix 4: HMAC Room-Join Authentication

**Threat**: Any client who knows (or guesses) a workspace ID can compute the topic hash (`SHA-256("nightjar-workspace:" + workspaceId)`) and join the signaling or y-websocket room, gaining access to:
- Online presence metadata
- Encrypted sync traffic (which they can't decrypt, but still a metadata leak)
- The ability to inject garbage messages

**Fix**: Clients derive an HMAC-SHA256 authentication token from the workspace encryption key:

```
authToken = HMAC-SHA256(workspaceKey, "room-auth:" + roomId)
```

The server enforces a **first-write-wins** policy:
1. First authenticated client to join registers the token for that room
2. Subsequent clients must present the same token
3. Once a room has a registered token, unauthenticated joins are blocked
4. Token comparison uses `crypto.timingSafeEqual` to prevent timing attacks

### Auth enforcement points

| Endpoint | How auth is checked |
|----------|-------------------|
| `join-topic` (signaling WS) | `authToken` field in message, validated with `validateRoomAuthToken("p2p:" + topic, ...)` |
| `join` (signaling WS) | `authToken` field in message, validated with `validateRoomAuthToken(roomId, ...)` |
| y-websocket upgrade | `?auth=` URL query parameter, validated with `validateRoomAuthToken("yws:" + roomName, ...)`, closes with code `4403` on rejection |

### Backward compatibility

Older clients that don't send `authToken` are allowed **until** an authenticated client registers a token for that room. After registration, unauthenticated joins are blocked.

### Files changed

- `server/unified/index.js` — `roomAuthTokens` Map, `validateRoomAuthToken()`, applied to `handleJoinTopic`, `handleJoin`, `wssYjs.on('connection')`
- `frontend/src/utils/roomAuth.js` — New module: `computeRoomAuthToken()` (HMAC-SHA256 via Web Crypto API with Node.js fallback)
- `frontend/src/utils/websocket.js` — `getYjsWebSocketUrl()` accepts optional `authToken`, appends as `?auth=` query parameter; re-exports `computeRoomAuthToken`
- `frontend/src/hooks/useWorkspaceSync.js` — Computes auth token from workspace keychain during sync init
- `frontend/src/services/p2p/transports/WebSocketTransport.js` — Sends `authToken` in `join-topic` message
- `frontend/src/services/p2p/PeerManager.js` — Passes `authToken`/`workspaceKey` through to BootstrapManager
- `frontend/src/services/p2p/BootstrapManager.js` — Stores and passes auth params to WebSocket transport
- `frontend/src/services/p2p/P2PWebSocketAdapter.js` — Accepts `authToken`/`workspaceKey` options, passes to PeerManager
- `frontend/src/contexts/P2PContext.jsx` — Passes `authToken`/`workspaceKey` through factory functions
- `frontend/src/utils/mobile-p2p.js` — `topicAuthTokens` Map, sends auth on join/reconnect

---

## Fix 5: Encrypted localStorage Secrets

**Threat**: Workspace encryption keys stored in plaintext `localStorage` can be read by any script running in the same origin (XSS, malicious browser extensions).

**Fix**: Workspace secrets are now encrypted before storage using a session-derived key. The encryption uses NaCl `secretbox` (XSalsa20-Poly1305) with random nonces. The session key is derived from the user's identity and is never stored in plaintext.

**Files changed**: `frontend/src/utils/keyDerivation.js`

---

## Fix 6: E2E Encrypted Relay Messages

**Threat**: P2P relay messages (`relay-message`, `relay-broadcast`) pass through the signaling server in plaintext. A compromised or malicious server operator can read message contents.

**Fix**: Relay message payloads are now encrypted client-side using NaCl `secretbox` (XSalsa20-Poly1305) with the workspace encryption key before being sent to the server. The server forwards encrypted envelopes opaquely.

### Encryption details

- **Algorithm**: XSalsa20-Poly1305 (NaCl secretbox)
- **Key**: 32-byte workspace encryption key (same key used for persistence)
- **Nonce**: Random 24 bytes per message (prepended to ciphertext)
- **Format**: `base64(nonce || ciphertext)` stored in `encryptedPayload` field

### Protocol change

**Before (plaintext relay)**:
```json
{
  "type": "relay-message",
  "targetPeerId": "peer-b",
  "payload": { "type": "sync-update", "data": "..." }
}
```

**After (encrypted relay)**:
```json
{
  "type": "relay-message",
  "targetPeerId": "peer-b",
  "encryptedPayload": "<base64 nonce+ciphertext>"
}
```

The server wraps the encrypted envelope with routing metadata:
```json
{
  "type": "relay-message",
  "encryptedPayload": "<base64 nonce+ciphertext>",
  "_fromPeerId": "peer-a",
  "_relayed": true
}
```

### Backward compatibility

- If a client sends `payload` (plaintext), the server uses legacy behavior (spread and forward)
- If a client sends `encryptedPayload`, the server forwards the opaque blob
- Recipients detect `encryptedPayload` and decrypt with their workspace key
- If decryption fails (wrong key, tampering), the message is silently dropped

### Files changed

- `server/unified/index.js` — `handleRelayMessage` and `handleRelayBroadcast` accept `encryptedPayload` alongside legacy `payload`
- `frontend/src/utils/roomAuth.js` — `encryptRelayPayload()`, `decryptRelayPayload()`
- `frontend/src/services/p2p/transports/WebSocketTransport.js` — `send()` and `broadcast()` encrypt payloads; message handler decrypts incoming encrypted messages

---

## Fix 7: Security Documentation

This document. Provides a comprehensive record of all security fixes, their threat models, implementation details, and test coverage.

---

## Security Model Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                     CLIENT (Browser/Electron)                   │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Workspace Key │  │ Ed25519 ID   │  │ Encrypted localStorage│  │
│  │ (never sent)  │  │ (signing)    │  │ (Fix 5)              │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────────┘  │
│         │                 │                                     │
│         ├── HMAC token ───┤── Signature ──┐                     │
│         │  (Fix 4)        │  (Fix 3)      │                     │
│         │                 │               │                     │
│  ┌──────▼─────────────────▼───────────────▼──────────────────┐  │
│  │  Encrypt relay payloads (Fix 6: NaCl secretbox)           │  │
│  └──────┬────────────────────────────────────────────────────┘  │
│         │                                                       │
└─────────┼───────────────────────────────────────────────────────┘
          │ WebSocket
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SERVER (unified/index.js)                   │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Security      │  │ Room Auth    │  │ Room Key Ownership   │  │
│  │ Headers (F2)  │  │ Tokens (F4)  │  │ (Fix 3)             │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│                                                                 │
│  • No workspace oracle (Fix 1)                                  │
│  • Forwards encrypted relay blobs opaquely (Fix 6)              │
│  • Never has decryption keys                                    │
│  • Constant-time token comparison (Fix 4)                       │
│  • Timestamp replay protection (Fix 3)                          │
└─────────────────────────────────────────────────────────────────┘
```

## Test Coverage

| Test File | Fixes Covered | Tests |
|-----------|---------------|-------|
| `tests/security-hardening.test.js` | Fix 1, 2, 3, 5 | Phase 1 |
| `tests/security-hardening-source-verify.test.js` | Fix 1, 2, 3, 5 | Source verification |
| `tests/security-hardening-phase2.test.js` | Fix 4, 6 | Phase 2 (66 tests) |
| `tests/relay-bridge-auto-connect.test.js` | Fix 8 | v1.7.22 (56 tests) |
| `tests/share-link-routing-fix.test.js` | Fix 8 (docker) | v1.7.21-22 (22 tests) |
| `tests/share-link-base-path.test.js` | Fix 9 | v1.7.23 (56 tests) |

### Phase 2 test breakdown

- **computeRoomAuthToken**: Determinism, different keys/rooms, base64/Uint8Array input, null handling, HMAC verification
- **validateRoomAuthToken**: First-write-wins, same/different token, unauthenticated join blocking, invalid input, constant-time comparison
- **Auth E2E flow**: Token derivation → validation → rejection with wrong key
- **encryptRelayPayload / decryptRelayPayload**: Round-trip, opacity, nonce randomness, wrong key, tampering, edge cases
- **Server relay forwarding**: Encrypted envelope forwarding, backward compatibility, server opacity
- **Combined auth + encryption**: Full flow with attacker scenario
- **Source code structure**: Verifies all expected code patterns are present in production files

## Future Work

- **E2E encrypted y-websocket sync**: Currently, Yjs sync updates pass through the server in plaintext (the server needs to process them for awareness/persistence). Full E2E encryption of the sync channel would require a custom relay-only server architecture. Encrypted at-rest persistence already protects stored data.
- **Room auth token expiry**: Room auth tokens currently persist for the lifetime of the server process. Adding time-based expiry or token rotation would improve security for long-running deployments.
- **Rate limiting on auth failures**: Currently, failed auth attempts are rejected but not rate-limited. Adding exponential backoff or temporary bans would mitigate brute-force attacks.

---

## Fix 8: Relay Bridge Preference Persistence & Auto-Connect (v1.7.22)

**Threat**: Relay bridge defaulting to OFF meant Electron users who shared documents via invite links would produce share links without a relay URL. Browser recipients would connect but see 0 documents because there was no relay bridge carrying the Yjs data to the public relay.

**Fix**:
- **Default ON**: Relay bridge now defaults to enabled (`!== 'false'` instead of `=== 'true'`)
- **LevelDB persistence**: User's relay bridge preference is saved to the sidecar metadata LevelDB store (`setting:relayBridgeEnabled`). The preference survives app restarts.
- **Startup restore**: On sidecar startup, the persisted preference is loaded from LevelDB before P2P initialization
- **Proactive doc creation**: `autoRejoinWorkspaces` uses `getOrCreateYDoc()` to ensure workspace-meta docs exist before relay bridge connects
- **Frontend startup sync**: `WorkspaceContext` sends `relay-bridge:enable` on WebSocket connect to ensure belt-and-suspenders activation
- **Electron share links**: Electron share links now include `srv:wss://night-jar.co` so browser recipients know which relay to connect to
- **Docker relay mode preserved**: The public relay server (`wss://night-jar.co`) runs in `NIGHTJAR_MODE=relay` with NO persistence or data storage — it is a pure relay/signaling server

### Security implications

- **No new data exposure**: The relay bridge preference is a single boolean stored in the local LevelDB metadata store on the user's device. It is not transmitted to any server.
- **Relay remains zero-knowledge**: The public relay (`wss://night-jar.co`) forwards encrypted Yjs sync messages and NaCl secretbox relay payloads. It does not store documents or hold encryption keys. `NIGHTJAR_MODE=relay` explicitly disables persistence.
- **Existing encryption layers unaffected**: All four defense layers (identity, data encryption, network auth, relay encryption) continue to apply. The relay bridge simply provides a WebSocket transport for already-encrypted data.

### Files changed

- `sidecar/index.js` — Default ON logic, `saveRelayBridgePreference()`, `loadRelayBridgePreference()`, `connectAllDocsToRelay()`, proactive `getOrCreateYDoc()` in `autoRejoinWorkspaces`, startup IIFE preference restore
- `frontend/src/contexts/WorkspaceContext.jsx` — Startup relay bridge sync on WebSocket connect
- `frontend/src/components/common/AppSettings.jsx` — Default ON in `useState` initializer
- `frontend/src/components/WorkspaceSettings.jsx` — Electron share links include `srv:wss://night-jar.co`
- `server/deploy/docker-compose.prod.yml` — Reverted relay to `NIGHTJAR_MODE=relay`, removed persistence and data volume

---

## Fix 9: SPA Base Path Injection for Nested Routes (v1.7.23)

**Threat**: Share links at `/join/w/XXXXX` served the SPA HTML, but Vite builds with `base:'./'` (relative paths). The browser resolved `./assets/main-xxx.js` relative to the current pathname → `/join/w/assets/main-xxx.js` → 404 → white screen. This affected all mobile/PWA users clicking share links.

**Fix**:
- **`<base href="/">` injection**: The Express server reads `index.html` at startup and injects `<base href="/">` right after `<head>`. This tells the browser to resolve all relative URLs from the root, regardless of the current pathname.
- **Asset extension safety net**: The `/join/*` route handler now checks if the request path ends with a static asset extension (`.js`, `.css`, `.png`, etc.) and calls `next()` instead of returning HTML.
- **Rewrite middleware**: A middleware at `/join/` catches `/join/.../assets/...` requests (from stale cached pages without `<base>`) and rewrites `req.url` to `/assets/...` before passing to `express.static`.
- **Asset 404 guard**: A middleware after `express.static` returns proper 404s for missing files under `/assets/`, preventing the SPA fallback from returning HTML with `text/html` MIME type for `.js` requests (which causes the browser to parse HTML as JavaScript → white screen).

### Security implications

- **No new data exposure**: The `<base>` tag only affects URL resolution in the browser. No server-side behavior or data handling is changed.
- **`BASE_PATH` honoured**: For the private instance at `/app`, the base href becomes `/app/`, correctly scoping asset resolution to the sub-path.
- **No bypass risk**: The asset extension safety net and rewrite middleware are defense-in-depth. The `<base>` tag is the primary fix. Even if `<base>` were stripped by a proxy, the fallback layers prevent HTML from being served as JavaScript.

### Files changed

- `server/unified/index.js` — `<base href>` injection, `/join/*` asset safety net, `/join/` rewrite middleware, asset 404 guard
