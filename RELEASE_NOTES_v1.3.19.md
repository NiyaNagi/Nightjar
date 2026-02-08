# Release Notes v1.3.19

## Critical P2P Bug Fix - Workspace Creator Cannot Sync to Joiners

### Problem
When a user created a new workspace and generated a share link, joiners who redeemed the link would:
1. Not receive the workspace name (showed "Shared Workspace" instead of the actual name)
2. Not receive documents or folders from the creator
3. The sidebar remained empty despite successful P2P connection

### Root Cause
In the `create-workspace` handler in the sidecar, after joining the Hyperswarm topic for P2P discovery, the critical `registerWorkspaceTopic()` function was **not being called**.

This function is essential because it:
1. Maps the topic hash to the workspace ID in `topicToWorkspace`
2. Sets up the Yjs document observer to broadcast updates to P2P peers
3. Registers the workspace on the mesh network

Without this registration, when joiners sent `sync-request` messages to the creator, the handler couldn't find the workspace for the topic and responded with "Unknown topic - not registered".

### Evidence from Logs
**Creator side (before fix):**
```
[Sidecar] Joining Hyperswarm topic for new workspace: 0f3aec8685f05450
[Hyperswarm] Joined topic: 0f3aec8685f05450...
[Sidecar] Successfully joined workspace topic
// MISSING: No P2P observer registration!
```

**When joiners tried to sync:**
```
[P2P-SYNC-STATE] Topic: 0f3aec8685f05450...
[P2P-SYNC-STATE] ✗ Unknown topic - not registered
```

### Fix
Added the missing `registerWorkspaceTopic()` call in the `create-workspace` handler:

```javascript
// Join the workspace topic for P2P discovery
if (p2pInitialized && wsData.topicHash) {
    await p2pBridge.joinTopic(wsData.topicHash);
    console.log('[Sidecar] Successfully joined workspace topic');
    
    // Register for Yjs P2P bridging - CRITICAL for responding to sync requests
    registerWorkspaceTopic(wsData.id, wsData.topicHash);
    console.log('[Sidecar] ✓ Registered workspace topic for P2P bridging');
}
```

### Files Modified
- `sidecar/index.js` - Added `registerWorkspaceTopic()` call in create-workspace handler

### Testing
- All 1346 unit tests pass
- P2P sharing should now properly sync workspace metadata (name, documents, folders) from creator to joiners

### Related Issues
- This was the third bug in the v1.3.17/v1.3.18 P2P fix series
- v1.3.17 fixed SHA256 topic hash mismatch between sidecar and frontend
- v1.3.18 fixed wrong topic formula in serialization.js (missing prefix)
- v1.3.19 fixes the missing P2P observer registration for new workspaces
