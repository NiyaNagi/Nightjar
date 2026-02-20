# Nightjar v1.3.17 Release Notes

## Critical Bug Fix: P2P Topic Hash Mismatch

### The Problem
Workspace sharing was completely broken because the creator and joiner were connecting to **different P2P topics** for the same workspace. This prevented peers from discovering each other on the DHT network.

**Root Cause Analysis:**
- When creating a workspace, the code used a **synchronous SHA256 function** (`sha256()`) that had a padding bug
- This produced an incorrect topic hash (e.g., `0eb0febfa4169496...`)
- The sidecar used Node.js `crypto.createHash('sha256')` which produces the **correct** hash (e.g., `ed4a2198aa98e724...`)
- Result: Creator joins one DHT topic, joiner joins a different one → they never find each other

**Evidence from logs:**
```
Machine 1 (Creator - Star):
[Hyperswarm] Joined topic: ed4a2198aa98e724...  (correct - from sidecar)

Machine 2 (Joiner - Snow):
[Hyperswarm] Joined topic: 0eb0febfa4169496...  (wrong - from buggy sha256)
```

### The Fix
1. **Made `generateTopicFromEntityId()` async** - now uses the correct `sha256Async()` (Web Crypto API)
2. **Updated `createNewEntity()`** - now awaits the async topic generation
3. **Updated all callers** - `WorkspaceContext.jsx` and `migration.js` now properly await the result

### Technical Details
The code comment explicitly warned about this:
```javascript
// Must use sha256Async for correct output (the sync sha256 has a padding bug)
```

But `generateTopicFromEntityId()` was still using the buggy sync version. This fix ensures all topic hash generation uses the correct Web Crypto API implementation that matches the sidecar's Node.js crypto.

### Files Changed
- `frontend/src/utils/sharing.js` - Fixed `generateTopicFromEntityId()` to use async SHA256
- `frontend/src/utils/sharing.js` - Made `createNewEntity()` async
- `frontend/src/contexts/WorkspaceContext.jsx` - Await `createNewEntity()` call
- `frontend/src/utils/migration.js` - Await `createNewEntity()` call
- `tests/sharing.test.js` - Updated tests to await async function

### Impact
- ✅ **P2P workspace sharing now works correctly**
- ✅ Creator and joiner connect to the same DHT topic
- ✅ All 1346 tests pass
- ✅ Backward compatible (no migration needed)

### Testing
After this fix:
1. Create a workspace on Machine 1
2. Copy the share link
3. Join on Machine 2
4. Both machines should now see each other and sync documents

---
**Version:** 1.3.17  
**Date:** 2025-02-08
