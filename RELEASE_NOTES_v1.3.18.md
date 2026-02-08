# Release Notes - v1.3.18

## Critical Bug Fix: P2P Topic Hash Mismatch (Complete Fix)

This release fixes the remaining P2P sharing issues discovered after v1.3.17.

### Issues Fixed

#### 1. Wrong Topic Hash Formula in PeerManager (Critical)

**Location:** `frontend/src/services/p2p/protocol/serialization.js`

**The Bug:**
The `generateTopic()` function was computing:
```javascript
SHA256(workspaceId)  // WRONG!
```

Instead of the correct formula:
```javascript
SHA256('nightjar-workspace:' + workspaceId)  // CORRECT
```

This meant that when `PeerManager.joinWorkspace()` or `BootstrapManager.bootstrap()` were called without an explicit topic, they would compute a DIFFERENT topic hash than what was in the share link and what the sidecar expected.

**Impact:**
- P2P connections would fail to find peers
- Workspace sync would not work in certain code paths
- This was a separate bug from the v1.3.17 fix (which fixed `createNewEntity`)

**The Fix:**
Added the `WORKSPACE_TOPIC_PREFIX` constant and updated `generateTopic()` to use the same formula as `sidecar/mesh-constants.js`:
```javascript
const WORKSPACE_TOPIC_PREFIX = 'nightjar-workspace:';

export async function generateTopic(workspaceId) {
  const data = encoder.encode(WORKSPACE_TOPIC_PREFIX + workspaceId);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  // ...
}
```

#### 2. Removed Buggy Synchronous SHA256 Fallback

**Location:** `frontend/src/utils/sharing.js`

**The Bug:**
The `sha256Async()` function had a fallback to a buggy synchronous `sha256()` implementation that had an incorrect padding calculation:

```javascript
// BUG: Used (bytes.length + 8) instead of (bytes.length + 1)
const padLen = ((bytes.length + 8) % 64 < 56) ? ...
```

This produced incorrect hashes that didn't match standard SHA-256.

**The Fix:**
- Removed the buggy synchronous `sha256()` function entirely
- Added a Node.js `crypto` module fallback for test environments
- If no crypto is available, throw an error instead of producing wrong hashes

### Files Modified

- `frontend/src/services/p2p/protocol/serialization.js`
  - Added `WORKSPACE_TOPIC_PREFIX` constant
  - Fixed `generateTopic()` to use the correct prefix

- `frontend/src/utils/sharing.js`
  - Removed buggy `sha256()` synchronous implementation
  - Updated `sha256Async()` to use Node.js crypto as fallback for tests
  - Added error throw if no crypto available (instead of wrong hash)

- `package.json`
  - Version bumped to 1.3.18

### Topic Hash Formula Reference

All components MUST use the same formula for workspace topic hashes:

| Component | Location | Formula |
|-----------|----------|---------|
| Sidecar | `sidecar/mesh-constants.js` | `crypto.createHash('sha256').update('nightjar-workspace:' + workspaceId)` |
| Frontend (sharing) | `frontend/src/utils/sharing.js` | `SHA256('nightjar-workspace:' + workspaceId)` |
| Frontend (P2P) | `frontend/src/services/p2p/protocol/serialization.js` | `SHA256('nightjar-workspace:' + workspaceId)` |

### Testing

All 1346 tests pass.

### Upgrade Notes

- Users with workspaces created in v1.3.16 or earlier will have their topic hashes automatically migrated by the sidecar on startup
- Share links generated with v1.3.17+ contain the correct topic hash
- This fix ensures all code paths use consistent topic generation
