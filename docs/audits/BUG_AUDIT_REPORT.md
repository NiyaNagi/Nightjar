# Nightjar Bug Audit Report

**Scope:** Sidecar (Node.js backend) + Electron main process (`sidecar/`, `src/`)  
**Date:** June 2025  
**Auditor:** Automated code review

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 4 |
| 🟠 High | 10 |
| 🟡 Medium | 15 |
| 🔵 Low | 10 |
| **Total** | **39** |

---

## 🔴 CRITICAL

### 1. `Object.assign(docs, EventEmitter.prototype)` overwrites Map methods
**File:** `sidecar/index.js` **Line:** 4859  
**Description:** `Object.assign(docs, EventEmitter.prototype)` copies EventEmitter prototype methods onto the `docs` Map instance. However, this happens **after** the `docs.set` method is already monkey-patched (line 4850). Because `EventEmitter.prototype` does not have a `set` property, the patched `set` is preserved — but `EventEmitter.prototype` has a number of own properties (e.g., `constructor`, `domain`, etc.) that overwrite the Map's existing properties. Most critically, if a future version of Node.js adds a `set`, `get`, `has`, or `delete` method to `EventEmitter.prototype`, this will silently break the Map.  
**Additionally:** `EventEmitter.prototype.constructor` overwrites the Map's constructor property, which may cause subtle issues with `instanceof` checks or `JSON.stringify` behavior in libraries that inspect the constructor.  
**Risk:** Map operations could silently break with Node.js upgrades; y-websocket internals that check `docs` type will misbehave.  
**Fix:** Use composition instead of mutation. Create a separate EventEmitter and proxy events:
```js
const docsEvents = new EventEmitter();
const originalSet = docs.set;
docs.set = function(key, value) {
    const had = this.has(key);
    const result = originalSet.apply(this, arguments);
    if (!had) docsEvents.emit('doc-added', value, key);
    return result;
};
```

---

### 2. `ipc-provider.js` calls non-existent `sendAwarenessUpdate` API
**File:** `src/frontend/ipc-provider.js` **Line:** 44  
**Description:** `IpcProvider._onAwarenessUpdate` calls `window.electronAPI.sendAwarenessUpdate(update)`, but `preload.js` never exposes `sendAwarenessUpdate` on `electronAPI`. Similarly, line 53 calls `window.electronAPI.onAwarenessUpdate()` which is also not exposed.  
**Impact:** Awareness updates (cursor positions, user presence) are **never sent** from the IPC provider to the backend. The awareness bridging feature is completely broken via this code path.  
**Fix:** Add `sendAwarenessUpdate` and `onAwarenessUpdate` to the `contextBridge.exposeInMainWorld` call in `src/preload.js`, and add corresponding IPC handlers in `src/main.js`.

---

### 3. `src/backend/p2p.js` creates Tor SOCKS agent unconditionally at module load
**File:** `src/backend/p2p.js` **Line:** 17  
**Description:** `const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');` is executed at module load time. This means every `require('src/backend/p2p')` immediately creates a SOCKS agent that tries to connect to `127.0.0.1:9050`. If Tor is not running, the module import still succeeds, but **all** TCP dials will route through the dead SOCKS proxy and fail silently or throw uncaught connection errors.  
**Contrast:** `sidecar/p2p.js` (the equivalent sidecar file) correctly uses lazy initialization with `getTorAgent()`.  
**Fix:** Make it lazy-loaded like the sidecar version, only creating the agent when connecting to `.onion` addresses.

---

### 4. `deleteWorkspaceMetadata` scans entire DB multiple times (O(n²) data loss risk)
**File:** `sidecar/index.js` **Lines:** 1290–1370  
**Description:** This function performs 4 separate full-table scans of `metadataDb` (lines 1299, 1306, 1386, 1396) plus an additional full scan of `db` for each document being deleted (line 1324). For a workspace with 100 documents, this results in ~104 full DB scans. Beyond performance, the real bug is that the inner `db.iterator()` scan at line 1324 iterates the **entire** main DB looking for keys starting with `docId:`, but there is no range query — so it reads every key in the database for every document.  
**Risk:** On large databases, this causes multi-second UI freezes and potential timeout-triggered restarts of the sidecar. The metadata WebSocket handler processes this synchronously, blocking all other metadata requests.  
**Fix:** Use LevelDB range queries (`gte`/`lte`) for the `db` scan (like `loadPersistedData` already does), and combine the metadataDb scans into a single pass.

---

## 🟠 HIGH

### 5. `loadPersistedData` full DB scan for legacy/P2P data on every document load
**File:** `sidecar/index.js` **Lines:** 597–619  
**Description:** After the efficient range query (lines 571–591), the function does a **second full DB scan** `for await (const [dbKey, value] of db.iterator())` to find legacy (no colon prefix) and P2P entries. This runs for **every** document load. With N documents loaded at startup and M total DB entries, this is O(N×M).  
**Impact:** Startup time degrades quadratically as the database grows. Users with large databases will experience very slow initial loads.  
**Fix:** Do a single full scan at startup to collect all legacy/P2P keys and cache them, or migrate legacy data to the range-queryable format during a one-time migration.

---

### 6. Duplicate Hyperswarm instance in main process vs sidecar
**File:** `src/main.js` **Line:** 1142; `sidecar/index.js` **Line:** 100  
**Description:** `src/main.js` creates a `swarmManager` via `hyperswarm.getInstance()` (a singleton `HyperswarmManager`). The sidecar process creates its own `P2PBridge` (which internally creates another `HyperswarmManager`). Since the sidecar runs as a **separate child process** (spawned at line ~575 of main.js), these are separate instances in separate processes. However, the main process `swarmManager` is **never destroyed** during shutdown, and its IPC handlers (lines 1172–1245) forward commands directly to it — meaning the frontend can accidentally initialize and join topics on the **main process** Hyperswarm instead of the sidecar's, causing duplicate connections and wasted resources.  
**Fix:** Either remove the Hyperswarm IPC handlers from main.js (route everything through the sidecar's WebSocket), or ensure they proxy to the sidecar instead of using a local instance.

---

### 7. `createP2PMessage` docId limited to 255 bytes (1-byte length field)
**File:** `sidecar/index.js` **Lines:** 443–458  
**Description:** `message[1] = docIdLength;` uses a single byte to store the docId length, limiting docIds to 255 bytes. While current docIds are typically short hex strings (32–64 chars), the code does not validate this limit. If a docId exceeds 255 bytes (e.g., via workspace-meta names with long workspace IDs), the length field silently wraps around (e.g., 256 → 0), causing `parseP2PMessage` to extract wrong data.  
**Fix:** Add a length check: `if (docIdLength > 255) throw new Error('docId too long for P2P framing')`, or switch to a 2-byte length field.

---

### 8. `RelayBridge._scheduleReconnect` double-increments retry counter
**File:** `sidecar/relay-bridge.js` **Lines:** 147–155, 445–460  
**Description:** When `connect()` fails, it increments `retryAttempts` (line 152) and then calls `_scheduleReconnect`. Inside `_scheduleReconnect`, when the scheduled reconnect fires and calls `connect()` again, and `connect()` fails again, it increments `retryAttempts` again (line 152) **before** `_scheduleReconnect` can use the proper attempt count for backoff. This causes the exponential backoff to escalate faster than intended (effectively doubling the exponent), reaching the max retry limit prematurely.  
**Fix:** Only increment `retryAttempts` in one place — either in `connect()` or in `_scheduleReconnect`, not both.

---

### 9. Relay server `handleDisconnect` can be called twice for same client
**File:** `sidecar/relay-server.js` **Lines:** 65, 70  
**Description:** Both `ws.on('close', ...)` and `ws.on('error', ...)` call `this.handleDisconnect(clientId)`. When a WebSocket errors, it typically also fires the `close` event, causing `handleDisconnect` to run twice. While the second call is mostly a no-op (since `this.clients.get(clientId)` returns undefined), `handleLeaveTopic` will be called for each topic twice, sending duplicate `peer-left` notifications.  
**Fix:** Add a `disconnected` flag per client, or check `this.clients.has(clientId)` at the top of `handleDisconnect`.

---

### 10. `PeerRelayManager._discoverRelays` adds duplicate connection handler
**File:** `src/backend/peer-relay-manager.js` **Lines:** 254–276  
**Description:** `_discoverRelays` calls `this.swarm.on('connection', ...)` to listen for data, but `_publishToSwarm` (line 235) already adds a `connection` handler. These handlers accumulate on every call and are never removed. Since Hyperswarm `connection` events fire for **all** connections (not just relay discovery), every regular peer connection will trigger the relay discovery handler, attempting to parse non-relay data as JSON.  
**Fix:** Use `once` for specific data expectations, or track and remove the handler after discovery completes.

---

### 11. `ssl-cert.js` writes private key with default file permissions (world-readable)
**File:** `sidecar/ssl-cert.js` **Lines:** 93–94  
**Description:** `fs.writeFileSync(keyPath, pemKey, 'utf8')` writes the SSL private key with the system default umask (typically 0o644 on Linux, full access on Windows). Any local user can read the private key.  
**Fix:** Set restrictive permissions: `fs.writeFileSync(keyPath, pemKey, { mode: 0o600 })`.

---

### 12. `identity.js` machine key derivation uses predictable inputs
**File:** `sidecar/identity.js` **Lines:** ~40–55  
**Description:** `getMachineKey()` derives the machine-level encryption key from `os.hostname()`, `os.platform()`, `os.homedir()`, and `os.cpus()[0]?.model`. All of these are easily discoverable by any process on the same machine. The PBKDF2 derivation uses only 10,000 iterations with a static salt (`'nightjar-identity-salt'`).  
**Impact:** Any application running on the same machine can reconstruct the machine key and decrypt identity data.  
**Fix:** Use OS-native secret storage (Keychain on macOS, Credential Manager on Windows, libsecret on Linux) or at minimum use `crypto.randomBytes` for the salt and store it alongside the encrypted identity.

---

### 13. `tor-manager-enhanced.js` Tor bootstrap promise never resolves on slow networks
**File:** `src/backend/tor-manager-enhanced.js` **Lines:** 150–178  
**Description:** The `start()` method creates a promise that only resolves when `Bootstrapped 100%` appears in stdout (line 159). If Tor stalls at, say, 90% and doesn't progress, the 120-second timeout rejects the promise. But the `torProcess` continues running — `this.torProcess` is set but `this.isRunning` remains false. On the next `start()` call, there's no check for an existing `this.torProcess`, so a second Tor process gets spawned, leading to port conflicts and zombie processes.  
**Fix:** Kill `this.torProcess` in the timeout handler before rejecting.

---

### 14. `tor-manager-enhanced.js` `sendCommand` leaks socket connections
**File:** `src/backend/tor-manager-enhanced.js` **Lines:** 260–280  
**Description:** `sendCommand` calls `connectControl()` which creates a new TCP socket. The returned promise resolves with the response, but if `socket.on('data')` fires multiple times (fragmented response), only the first fragment is captured and the socket is ended. Remaining data is lost. Also, if the socket errors between `connectControl` and `sendCommand`, the error is unhandled because `sendCommand` wraps a new promise without an error handler for the connection phase.  
**Fix:** Use a single persistent control connection, or properly handle multi-line responses and connection errors.

---

## 🟡 MEDIUM

### 15. `registeredTopicObservers` cleared on relay reconnect but listeners not removed
**File:** `sidecar/index.js` **Lines:** 2557, 2901  
**Description:** When the relay bridge reconnects, `registeredTopicObservers.clear()` is called, which resets the guard set. This allows new observers to be registered on reconnect, which is correct. However, the **old** observers (Yjs `observe` callbacks) on the workspace-meta doc are never removed. Each reconnection adds a new layer of duplicate listeners on the same `Y.Map`.  
**Impact:** After N relay reconnections, each workspace-meta change triggers N duplicate broadcasts.  
**Fix:** Track the actual observer callbacks and call `ymap.unobserve(callback)` before clearing the set.

---

### 16. `loadTrashList` does 2 full metadataDb scans
**File:** `sidecar/index.js` **Lines:** 1386–1415  
**Description:** `loadTrashList` iterates the entire metadataDb twice — once for folders (line 1393) and once for documents (line 1400). These could be combined into a single iteration.  
**Impact:** Performance degradation with large metadata databases.

---

### 17. `P2PBridge._handleClientDisconnect` calls async `leaveTopic` without await
**File:** `sidecar/p2p-bridge.js` **Lines:** 520–525  
**Description:** `this.hyperswarm.leaveTopic(topic).catch(() => {})` is called in a `try` block, but the `try` only catches synchronous errors from the `.leaveTopic()` call start. The `.catch(() => {})` swallows all errors from the async operation, including important ones like DHT corruption.  
**Impact:** Topic cleanup failures are silently swallowed, potentially leaving stale topic subscriptions.

---

### 18. `RelayServer` no message size limit
**File:** `sidecar/relay-server.js` **Lines:** 42, 86  
**Description:** The WebSocket server is created with `maxPayload: 1024 * 1024` (1MB), but `handleMessage` parses `data.toString()` without checking the string length first. While WebSocket-level limits exist, the JSON parse of a 1MB string creates significant memory pressure per client. With 100 clients sending 1MB messages simultaneously, this is 100MB of strings being parsed.  
**Impact:** Memory spikes and potential OOM under load.

---

### 19. `MeshParticipant._handleConnection` buffer has no per-connection message rate limit
**File:** `sidecar/mesh.js` **Lines:** 195–238  
**Description:** The mesh connection handler accumulates and parses messages without any rate limiting. A malicious peer can send thousands of small JSON messages per second, causing CPU exhaustion from JSON parsing and event handling.  
**Fix:** Add a per-connection message rate limiter.

---

### 20. `UPnP mapPort` never cleans up nat-api instance
**File:** `sidecar/upnp-mapper.js` **Lines:** 8–12  
**Description:** `ensureNatAPI()` creates a global singleton `natAPI` that is never destroyed. The nat-api library probes the network and maintains internal state. If UPnP mapping is used once and then abandoned, the nat-api instance remains in memory probing the network indefinitely.  
**Fix:** Add a `destroy()` or `cleanup()` function that calls `natAPI.destroy()`.

---

### 21. `hyperswarm.js` replay protection window too narrow for clock skew
**File:** `sidecar/hyperswarm.js` **Lines:** ~460–480  
**Description:** Messages are rejected if their timestamp differs from local time by more than 60 seconds. In a P2P network, participants' system clocks can easily differ by more than 60 seconds (especially on mobile), causing legitimate messages to be silently dropped.  
**Impact:** Users with slightly inaccurate system clocks will experience silent message loss.  
**Fix:** Increase the replay window to 300 seconds (5 minutes) or implement NTP-based clock correction.

---

### 22. `hyperswarm.js` STUN IP detection retries all servers on every call
**File:** `sidecar/hyperswarm.js`  
**Description:** `getPublicIP()` tries STUN servers (Google, Cloudflare) and then HTTP fallback services sequentially on every call. While there's a 1-minute cache, after the cache expires, the function retries all STUN servers even if they previously failed. In environments where STUN is blocked (corporate firewalls), this adds 10+ seconds of latency on every cache expiry.  
**Fix:** Remember which method succeeded and try that first on subsequent calls.

---

### 23. `main.js` sidecar restart counter never resets on running state
**File:** `src/main.js` **Lines:** ~580–610  
**Description:** The sidecar restart logic uses `sidecarRestartCount` with max 3 attempts. The counter resets when the sidecar successfully starts (emits a progress message). However, if the sidecar starts successfully but crashes after 1 hour, the counter has been reset — the next crash-restart cycle works. But if the sidecar crashes 3 times within the first few seconds (before emitting progress), restarts stop permanently until the app is fully restarted. There's no exponential backoff or recovery mechanism.  
**Fix:** Add exponential backoff between restart attempts and reset the counter after sustained runtime (e.g., 60 seconds).

---

### 24. `main.js` `safeSend` doesn't check if window is focused/visible
**File:** `src/main.js`  
**Description:** The `safeSend` helper sends IPC messages to the renderer even when the window is being destroyed or hidden. While it checks `mainWindow && !mainWindow.isDestroyed()`, rapid Hyperswarm events during app shutdown can still cause "Object has been destroyed" errors between the check and the `send` call (TOCTOU race).  
**Fix:** Wrap the `send` call in a try-catch.

---

### 25. `ipc-provider.js` uses wrong function for encoding awareness
**File:** `src/frontend/ipc-provider.js` **Line:** 43  
**Description:** `Y.encodeAwarenessUpdate` is called on the `Y` (yjs) import, but `encodeAwarenessUpdate` is exported from `y-protocols/awareness`, not from `yjs`. While the `Awareness` class is imported from `y-protocols/awareness` at line 2, the encoding function should also be imported from there.  
**Impact:** This would throw `Y.encodeAwarenessUpdate is not a function` at runtime, but since `sendAwarenessUpdate` (bug #2) doesn't exist either, this code path is never fully exercised.  
**Fix:** Import `encodeAwarenessUpdate` from `y-protocols/awareness`.

---

### 26. `relay-bridge.js` reconnect uses stale ydoc reference
**File:** `sidecar/relay-bridge.js` **Lines:** 446–458  
**Description:** `_scheduleReconnect` saves a reference to `ydoc` in the closure, but when the timeout fires, it correctly tries to get the fresh doc from `docs.get(roomName)`. However, the `ydoc` passed to `connect()` on the initial failure path (line 155) is the original reference, not the fresh one. If the y-websocket `docs` Map has replaced the doc (e.g., due to compaction), the relay bridge reconnects with the stale doc.  
**Fix:** Always fetch the fresh doc from `docs.get(roomName)` before calling `connect()` in the reconnect handler.

---

### 27. `relay-bridge.js` sync message handler doesn't handle messageType 1 correctly
**File:** `sidecar/relay-bridge.js` **Lines:** 255–275  
**Description:** The `case 0:` and `case 1:` fall through to the same handler block, which calls `syncProtocol.readSyncMessage()`. This function handles both sync step 1 and sync step 2 correctly. However, the `synced` flag is only set when `syncMessageType === 1` (sync step 2 response). If the relay sends a sync step 2 without a preceding step 1 response, the `synced` flag may never be set correctly. This is a minor protocol assumption issue.  
**Impact:** The `synced` variable is never actually used for anything after being set, so this is effectively dead code with no functional impact currently. But it indicates potential sync state tracking issues if the variable is used in the future.

---

### 28. `hyperswarm.js` message deduplication map grows without bound check
**File:** `sidecar/hyperswarm.js`  
**Description:** The message deduplication uses a Map with SHA-256 hashes and a 60-second TTL. The cleanup runs on each incoming message. However, if no messages arrive for a long time (e.g., network outage), stale entries remain in memory. More importantly, during a burst of messages, the map can grow rapidly before cleanup runs.  
**Fix:** Add a max size check and periodic cleanup interval independent of message arrival.

---

### 29. `sidecar/index.js` metadata WebSocket doesn't validate JSON parse
**File:** `sidecar/index.js` **Line:** ~1500  
**Description:** The metadata WebSocket handler parses incoming messages with `JSON.parse(message)` wrapped in a try-catch. However, successfully parsed messages are not validated for having the expected `type` field before entering the switch statement. A message like `{"type": null}` or `{"type": 123}` would fall through all cases silently with no error logged.  
**Impact:** Silent message loss for malformed messages.

---

## 🔵 LOW

### 30. `ssl-cert.js` serial number is always `'01'`
**File:** `sidecar/ssl-cert.js` **Line:** 51  
**Description:** The certificate serial number is hardcoded to `'01'`. If the certificate is regenerated (e.g., after deletion), the new certificate has the same serial number. Browsers that cached the old certificate may reject the new one due to serial number reuse.  
**Fix:** Use `crypto.randomBytes(16).toString('hex')` for the serial number.

---

### 31. `mesh-constants.js` `verifyAnnouncementToken` timing-safe compare can throw
**File:** `sidecar/mesh-constants.js` **Lines:** 213–223  
**Description:** `crypto.timingSafeEqual` requires both buffers to be the same length. The code wraps this in try-catch (line 222), falling back to `false`. However, `Buffer.from(token, 'hex')` on an invalid hex string returns a zero-length buffer, and the comparison correctly fails. This is handled, but the error path logs nothing, making token verification failures hard to debug.  
**Fix:** Add a debug log in the catch block.

---

### 32. `p2p-bridge.js` `broadcastPeerList` sends to all peers, not topic-specific
**File:** `sidecar/p2p-bridge.js` **Lines:** 729–745  
**Description:** `broadcastPeerList` gets **all** connected peer keys (not filtered by topic) and sends the full peer list to each. This means peers on unrelated topics receive peer lists for topics they haven't joined.  
**Impact:** Information leakage — peers discover the existence of other peers they shouldn't know about.  
**Fix:** Filter peers by the specific topic before broadcasting.

---

### 33. `inventoryStorage.js` `sanitizeForFilename` allows long filenames
**File:** `sidecar/inventoryStorage.js` **Lines:** 32–36  
**Description:** `sanitizeForFilename` strips dangerous characters but doesn't limit the length of the resulting filename. On Windows, the MAX_PATH limit is 260 characters. A very long `inventorySystemId` combined with a long `requestId` could create a path that exceeds the filesystem limit, causing a cryptic `ENAMETOOLONG` error.  
**Fix:** Truncate or hash the sanitized filename to a safe maximum length.

---

### 34. `tor-manager.js` `TorControl` persistent connection is never closed
**File:** `src/backend/tor-manager.js` **Lines:** 8–12  
**Description:** `ExternalTorManager` creates a `TorControl` with `persistent: true` but never provides a method to close the connection. The connection remains open until the process exits.  
**Impact:** Resource leak, though minor since there's only one instance.

---

### 35. `main.js` protocol link handler may lose links during startup
**File:** `src/main.js` **Lines:** ~270–300  
**Description:** Protocol links (`nightjar://...`) received during the loading screen phase are queued, but the queue is only processed when the renderer sends a ready signal. If the renderer crashes during loading and never sends ready, the queued links are lost.  
**Impact:** Users clicking invite links during startup may need to click them again.

---

### 36. `p2p-bridge.js` mDNS service name constructed from untrusted peerId
**File:** `sidecar/p2p-bridge.js` **Lines:** 435–442  
**Description:** `serviceName` and `peerId` from the WebSocket message are used directly in `this.bonjour.publish({ name: ... })`. While Bonjour likely sanitizes service names, exotic characters in `peerId.slice(0, 8)` could cause unexpected mDNS behavior.  
**Fix:** Sanitize or validate `peerId` format before using in service names.

---

### 37. `relay-bridge.js` `WebSocket.OPEN` constant reference
**File:** `sidecar/relay-bridge.js` **Line:** 340  
**Description:** `ws.readyState === WebSocket.OPEN` references the `WebSocket` class imported from the `ws` package. This works, but is fragile — if the import is changed or the `ws` package version changes the constant location, this would silently compare against `undefined` and never send.  
**Fix:** Use the numeric constant `1` (as done in `p2p-bridge.js` line 577) or ensure `WebSocket.OPEN` is validated.

---

### 38. Multiple `setInterval` timers with no tracking for cleanup
**File:** `sidecar/index.js` **Lines:** 371, 1459, 4918  
**Description:** Three `setInterval` calls at module scope create timers that are never stored in variables (except the awareness one). The shutdown handler (line 5160+) cleans up the awareness interval via `awarenessCleanupFn()` but does not clear the rate limiter cleanup (line 371), trash purge (line 1459), or pending updates cleanup (line 4918). While Node.js will terminate these on `process.exit()`, if shutdown is interrupted or delayed, these timers continue running against potentially closed databases.  
**Fix:** Store all interval IDs and clear them in the `shutdown()` function.

---

### 39. `sidecar/crypto.js` `secureWipe` may be optimized away by V8
**File:** `sidecar/crypto.js` **Lines:** ~150–165  
**Description:** The `secureWipe` function fills a buffer with zeros to clear sensitive data. However, V8's JIT compiler may optimize away this operation if it determines the buffer is not read after the wipe. Unlike C's `memset_s`, JavaScript has no guaranteed way to prevent dead-store elimination.  
**Impact:** Sensitive key material may remain in memory after "wiping".  
**Fix:** Use `crypto.randomFillSync(buffer)` (which V8 cannot optimize away due to the native call) or access the buffer after wiping to prevent dead-store elimination.

---

## Notes

- Several files in `src/backend/` use ES module syntax (`import`/`export`) while `sidecar/` uses CommonJS (`require`/`module.exports`). The `src/backend/` files (peer-relay-manager.js, relay-server.js, upnp-manager.js) appear to be dormant/unused modules since they use ES module imports but the main process uses CommonJS. These may be legacy code or planned features.
- The `sidecar/p2p.js` and `src/backend/p2p.js` files contain nearly identical libp2p code but with different Tor handling strategies — the sidecar version correctly lazy-loads the SOCKS agent while the src version does not.
- The codebase has good defensive patterns overall (input sanitization, rate limiting, message deduplication), making the critical bugs listed above more impactful by contrast.
