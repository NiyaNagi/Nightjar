# Nightjar Codebase Audit — Iteration 20 of 30

**Focus areas**: `storage/`, `identity/`, `backend/crypto.js`, `backend/p2p.js`, `chunkStore.js`, P2P discovery/sync, crypto code  
**Files audited**: `sidecar/index.js` (5382 lines, complete), `sidecar/identity.js`, `sidecar/crypto.js`, `sidecar/hyperswarm.js`, `sidecar/mesh.js`, `sidecar/p2p-bridge.js`, `sidecar/relay-bridge.js`, `sidecar/ssl-cert.js`, `sidecar/upnp-mapper.js`, `sidecar/mesh-constants.js`, `sidecar/utils/yjsTextExtraction.js`, `backend/crypto.js`, `backend/p2p.js`, `frontend/src/utils/chunkStore.js`, `frontend/src/utils/cryptoUtils.js`, `frontend/src/utils/addressCrypto.js`, `frontend/src/utils/secureStorage.js`, `frontend/src/utils/fileChunking.js`, `frontend/src/utils/changelogStore.js`

---

## Bug 1 — `getMachineKey()` uses undefined `basePath`, silently falls back to weak deterministic salt

| Field | Value |
|-------|-------|
| **File** | `sidecar/identity.js` |
| **Lines** | 286 |
| **Category** | Security |
| **Severity** | **Critical** |

**Description**: `getMachineKey()` references `basePath` on line 286, but `basePath` is not defined at module scope or within the function — only `configuredBasePath` exists at module scope. `path.join(undefined, '.machine-salt')` throws a `TypeError`, which is silently caught by the try/catch block on line 298. The catch block uses a hardcoded fallback salt `'Nightjar-machine-key-salt'`, which means the per-installation random salt feature is **never used**. All installations derive the machine key from the same deterministic salt + easily-guessable machine info (`os.hostname()`, `os.platform()`, `os.homedir()`). Anyone who knows these values can reproduce the mnemonic encryption key and decrypt the user's secret mnemonic phrase.

**Old code** (`sidecar/identity.js` line 286):
```javascript
    const saltPath = path.join(basePath, '.machine-salt');
```

**New code**:
```javascript
    const saltPath = path.join(getIdentityDir(), '.machine-salt');
```

---

## Bug 2 — `pendingSyncRequests` uses inconsistent data structure: memory leak + broken sync

| Field | Value |
|-------|-------|
| **File** | `sidecar/index.js` |
| **Lines** | 1978–1986, 3457–3465, 4590, 4810 |
| **Category** | Memory Leak / Functional |
| **Severity** | **High** |

**Description**: When workspaces are joined via `join-workspace`, pending sync entries are stored as bare `Set` objects (line 1983). When workspaces auto-rejoin on startup, entries are stored as `{ topics: Set, addedAt: timestamp }` objects (line 4810). This inconsistency causes two problems:

1. **Memory leak**: The cleanup interval (line 3461) checks `data.addedAt` — for bare `Set` entries, `addedAt` is `undefined`, so these entries are **never cleaned up**.
2. **Broken sync**: The consumer in `setupPeerPersistence` (line 4590) accesses `pending?.topics` — for bare `Set` entries, `.topics` is `undefined`, so pending sync requests from `join-workspace` are **never sent to peers after identity verification**.

**Old code** (`sidecar/index.js` lines 1978–1986):
```javascript
                                    if (topicHash) {
                                        let pendingTopics = pendingSyncRequests.get(peerKey);
                                        if (!pendingTopics) {
                                            pendingTopics = new Set();
                                            pendingSyncRequests.set(peerKey, pendingTopics);
                                        }
                                        pendingTopics.add(topicHash);
                                        console.log(`[Sidecar] Queued sync-request for ${peerKey.slice(0, 16)}...`);
                                    }
```

**New code**:
```javascript
                                    if (topicHash) {
                                        let pending = pendingSyncRequests.get(peerKey);
                                        if (!pending) {
                                            pending = { topics: new Set(), addedAt: Date.now() };
                                            pendingSyncRequests.set(peerKey, pending);
                                        }
                                        pending.topics.add(topicHash);
                                        console.log(`[Sidecar] Queued sync-request for ${peerKey.slice(0, 16)}...`);
                                    }
```

---

## Bug 3 — `broadcastStatus()` crashes with TypeError before WebSocket server is initialized

| Field | Value |
|-------|-------|
| **File** | `sidecar/index.js` |
| **Lines** | 520 |
| **Category** | Functional |
| **Severity** | **High** |

**Description**: `broadcastStatus()` accesses `metaWss.clients.forEach(...)` unconditionally (line 520), but `metaWss` is declared as `let metaWss;` (line 148, initialized to `undefined`) and only assigned inside `startServers()`. The P2P initialization fires after a 1-second `setTimeout` and calls `broadcastStatus()` from `initializeP2P()` (line 3353). If the database takes longer than 1 second to open (which can happen with large LevelDB stores or slow disks), `metaWss` is still `undefined` when `broadcastStatus()` runs, causing `TypeError: Cannot read properties of undefined (reading 'clients')`.

**Old code** (`sidecar/index.js` line 520):
```javascript
    metaWss.clients.forEach(ws => {
```

**New code**:
```javascript
    if (!metaWss) return;
    metaWss.clients.forEach(ws => {
```

---

## Bug 4 — SSL private key file written without restrictive permissions

| Field | Value |
|-------|-------|
| **File** | `sidecar/ssl-cert.js` |
| **Lines** | 92 |
| **Category** | Security |
| **Severity** | **High** |

**Description**: The self-signed SSL private key is written via `fs.writeFileSync(keyPath, pemKey, 'utf8')` without specifying file permissions. On Unix/macOS systems, the default umask (typically 022) results in the private key being world-readable (`-rw-r--r--`). Any process or user on the system can read the private key and impersonate the WSS server for man-in-the-middle attacks. The certificate file itself is fine to be world-readable, but the private key must be owner-only.

**Old code** (`sidecar/ssl-cert.js` line 92):
```javascript
    fs.writeFileSync(keyPath, pemKey, 'utf8');
```

**New code**:
```javascript
    fs.writeFileSync(keyPath, pemKey, { encoding: 'utf8', mode: 0o600 });
```

---

## Bug 5 — `deleteDocumentData()` performs full DB scan instead of range query

| Field | Value |
|-------|-------|
| **File** | `sidecar/index.js` |
| **Lines** | 793–800 |
| **Category** | Performance |
| **Severity** | **Medium** |

**Description**: `deleteDocumentData()` iterates every key in the main LevelDB to find keys starting with the document prefix (line 796). This is O(N) where N is the total number of keys in the database. The function right next to it, `loadPersistedData()`, already uses efficient LevelDB range queries (`gte`/`lte`). A workspace with 50 documents and 10,000 updates would require 500,000 key comparisons just for cascade deletion. On slow disk or large databases, this causes noticeable UI hangs during document/workspace deletion.

**Old code** (`sidecar/index.js` lines 793–800):
```javascript
        const keysToDelete = [];
        
        // Collect all keys for this document
        for await (const [dbKey] of db.iterator({ keys: true, values: false })) {
            if (dbKey.startsWith(prefix)) {
                keysToDelete.push(dbKey);
            }
        }
```

**New code**:
```javascript
        const keysToDelete = [];
        
        // Collect all keys for this document using efficient range query
        for await (const [dbKey] of db.iterator({ keys: true, values: false, gte: prefix, lte: `${docId}:\uffff` })) {
            keysToDelete.push(dbKey);
        }
```

---

## Bug 6 — `deleteWorkspaceMetadata()` deletes from LevelDB during async iteration

| Field | Value |
|-------|-------|
| **File** | `sidecar/index.js` |
| **Lines** | 1339–1347 |
| **Category** | Reliability |
| **Severity** | **Medium** |

**Description**: In step 3 of `deleteWorkspaceMetadata()`, the code iterates over `db.iterator()` and calls `db.del(key)` inside the same async for-of loop (line 1344). Modifying a LevelDB store during iteration can cause entries to be skipped or duplicated depending on the underlying iterator implementation. This may leave orphaned Yjs update blobs in the database after workspace deletion.

**Old code** (`sidecar/index.js` lines 1339–1347):
```javascript
            try {
                // Delete all updates for this document
                for await (const [key] of db.iterator()) {
                    if (key.startsWith(`${docId}:`)) {
                        await db.del(key);
                    }
                }
                console.log(`[Sidecar] Deleted Yjs data for document: ${docId}`);
```

**New code**:
```javascript
            try {
                // Collect keys first, then delete (avoid mutating during iteration)
                const docKeysToDelete = [];
                for await (const [key] of db.iterator({ keys: true, values: false, gte: `${docId}:`, lte: `${docId}:\uffff` })) {
                    docKeysToDelete.push(key);
                }
                for (const key of docKeysToDelete) {
                    await db.del(key);
                }
                console.log(`[Sidecar] Deleted ${docKeysToDelete.length} Yjs updates for document: ${docId}`);
```

---

## Bug 7 — `addressCrypto.js` uses weak single-pass `secureWipe()` for cryptographic key material

| Field | Value |
|-------|-------|
| **File** | `frontend/src/utils/addressCrypto.js` |
| **Lines** | ~295 (bottom of file) |
| **Category** | Security |
| **Severity** | **Medium** |

**Description**: `addressCrypto.js` defines its own local `secureWipe(data)` that only performs `data.fill(0)` — a single-pass zero fill. The project's canonical `secureWipe()` in `cryptoUtils.js` performs a 4-pass wipe (random → complement → random → zero). `addressCrypto.js` handles sensitive Curve25519 private keys and NaCl box keypairs for address encryption. The weaker wipe leaves key material potentially recoverable in memory via garbage collection timing attacks or memory dumps. The file should import and use the hardened wipe from `cryptoUtils.js` instead of defining its own.

**Old code** (`frontend/src/utils/addressCrypto.js` bottom of file):
```javascript
function secureWipe(data) {
    if (data instanceof Uint8Array) {
        data.fill(0);
    }
}
```

**New code**:
```javascript
function secureWipe(data) {
    if (!(data instanceof Uint8Array)) return;
    try {
        // Multi-pass wipe matching cryptoUtils.js pattern
        const random1 = nacl.randomBytes(data.length);
        for (let i = 0; i < data.length; i++) data[i] = random1[i];
        for (let i = 0; i < data.length; i++) data[i] = data[i] ^ 0xFF;
        const random2 = nacl.randomBytes(data.length);
        for (let i = 0; i < data.length; i++) data[i] = random2[i];
        data.fill(0);
    } catch {
        data.fill(0);
    }
}
```

---

## Bug 8 — `chunkStore.js` missing `onblocked` handler causes silent hang on IndexedDB upgrade

| Field | Value |
|-------|-------|
| **File** | `frontend/src/utils/chunkStore.js` |
| **Lines** | ~14–30 (openChunkStore function) |
| **Category** | Reliability |
| **Severity** | **Medium** |

**Description**: The `openChunkStore()` function opens an IndexedDB database with a version upgrade but does not handle the `onblocked` event. If another browser tab or window has the same database open with an older version, the `versionchange` event fires in the other tab. If that tab doesn't close its connection (which Nightjar doesn't implement), the `onblocked` event fires on the opening request and the upgrade transaction never starts. The `onsuccess` and `onerror` callbacks never fire, causing the returned Promise to hang indefinitely. Any subsequent file operations (upload, download, delete) that depend on `openChunkStore()` will also hang.

**Old code** (`frontend/src/utils/chunkStore.js` openChunkStore):
```javascript
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
```

**New code**:
```javascript
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
        console.warn('[ChunkStore] IndexedDB upgrade blocked by another tab');
        reject(new Error('IndexedDB upgrade blocked - close other Nightjar tabs and retry'));
    };
    request.onsuccess = () => resolve(request.result);
```

---

## Bug 9 — `loadPersistedData()` legacy scan iterates entire database for every document load

| Field | Value |
|-------|-------|
| **File** | `sidecar/index.js` |
| **Lines** | 613–632 |
| **Category** | Performance |
| **Severity** | **Medium** |

**Description**: After the efficient range query for document-specific keys (lines 585–610), `loadPersistedData()` performs a second pass that iterates **every key in the entire database** to find legacy keys (no colon prefix) and P2P-prefixed keys. This legacy scan is O(N) where N is the total number of keys across all documents. Since `loadPersistedData()` is called once per document during startup and during search/index operations, with M documents and N total keys the startup cost is O(M×N). For a workspace with 50 documents and 50,000 accumulated updates, this is 2.5 million iterations. The legacy P2P key format (`p2p:<timestamp>`) is from an obsolete code path and the `p2pDocName` check on line 624 doesn't work correctly for that format anyway.

**Old code** (`sidecar/index.js` lines 613–632):
```javascript
    // Also load legacy data (no colon prefix) and p2p data for backwards compatibility
    // These are less common, so a separate pass is acceptable
    for await (const [dbKey, value] of db.iterator()) {
        const isLegacy = !dbKey.includes(':');
        const isP2P = dbKey.startsWith('p2p:');
        
        // Skip if not legacy or p2p data (already handled above)
        if (!isLegacy && !isP2P) continue;
```

**New code**:
```javascript
    // Load legacy data (no colon prefix) using range query
    // Legacy keys are plain timestamps with no prefix, so they sort before any prefixed keys
    for await (const [dbKey, value] of db.iterator({ lt: '0' })) {
        // Legacy keys are numeric timestamps or similar with no colon
        if (dbKey.includes(':')) continue;
        
        const decrypted = decryptUpdate(value, key);
        if (decrypted) {
            try {
                Y.applyUpdate(doc, decrypted, 'persistence');
                count++;
            } catch (e) {
                console.error(`[Sidecar] Failed to apply legacy update ${dbKey}:`, e.message);
                errors++;
            }
        }
    }
    
    // Load P2P data for this specific document using range query
    const p2pPrefix = `p2p:${docName}:`;
    for await (const [dbKey, value] of db.iterator({ gte: p2pPrefix, lte: `p2p:${docName}:\uffff` })) {
```

**Note**: This is an approximation — the exact fix depends on what actual legacy key formats exist in production databases. The key insight is to avoid full-table scans when range queries can be used.

---

## Bug 10 — `update-workspace` allows overwriting `ownerPublicKey` via partial updates

| Field | Value |
|-------|-------|
| **File** | `sidecar/index.js` |
| **Lines** | 1845–1848 |
| **Category** | Security |
| **Severity** | **Medium** |

**Description**: The `update-workspace` WebSocket handler accepts a `partialUpdates` object and merges it into the existing workspace metadata using a bare object spread (`{ ...existing, ...partialUpdates }`). This allows any WebSocket client to overwrite sensitive fields including `ownerPublicKey`, `encryptionKey`, `topicHash`, and `joinedBy`. While the WebSocket server is local (only accessible from the same machine), this violates defense-in-depth: a compromised or malicious renderer process could hijack workspace ownership by sending `{ type: "update-workspace", workspaceId: "...", updates: { ownerPublicKey: "attacker-key" } }`. After this, workspace filtering by identity would exclude the real owner's workspaces.

**Old code** (`sidecar/index.js` lines 1845–1848):
```javascript
                    const merged = { ...existing, ...partialUpdates };
                    await saveWorkspaceMetadata(updateWsId, merged);
```

**New code**:
```javascript
                    // Filter out immutable fields that must not be overwritten
                    const IMMUTABLE_WORKSPACE_FIELDS = ['ownerPublicKey', 'encryptionKey', 'topicHash', 'id', 'createdAt'];
                    const safeUpdates = { ...partialUpdates };
                    for (const field of IMMUTABLE_WORKSPACE_FIELDS) {
                        delete safeUpdates[field];
                    }
                    const merged = { ...existing, ...safeUpdates };
                    await saveWorkspaceMetadata(updateWsId, merged);
```

---

## Summary

| # | File | Bug | Category | Severity |
|---|------|-----|----------|----------|
| 1 | `sidecar/identity.js:286` | `getMachineKey()` undefined `basePath` → deterministic salt fallback | Security | **Critical** |
| 2 | `sidecar/index.js:1978` | `pendingSyncRequests` inconsistent structure → leak + broken sync | Memory Leak / Functional | **High** |
| 3 | `sidecar/index.js:520` | `broadcastStatus()` crashes before `metaWss` initialized | Functional | **High** |
| 4 | `sidecar/ssl-cert.js:92` | Private key written world-readable (no `mode: 0o600`) | Security | **High** |
| 5 | `sidecar/index.js:793` | `deleteDocumentData()` full DB scan instead of range query | Performance | **Medium** |
| 6 | `sidecar/index.js:1339` | `deleteWorkspaceMetadata()` mutates LevelDB during iteration | Reliability | **Medium** |
| 7 | `frontend/src/utils/addressCrypto.js:~295` | Weak single-pass `secureWipe()` for key material | Security | **Medium** |
| 8 | `frontend/src/utils/chunkStore.js:~20` | Missing `onblocked` handler → silent IndexedDB hang | Reliability | **Medium** |
| 9 | `sidecar/index.js:613` | Legacy scan in `loadPersistedData()` is O(N) per document | Performance | **Medium** |
| 10 | `sidecar/index.js:1845` | `update-workspace` allows overwriting `ownerPublicKey` | Security | **Medium** |

**Total new bugs found: 10** (2 Critical/High security, 2 High functional, 6 Medium)
