# Release Notes - v1.3.6

## 🐛 Critical Bug Fix: Cross-Platform P2P Sharing

### Problem Fixed
**Joining a workspace shared from a Mac did not work.** When redeeming a share link from a Mac user, the Windows client would:
- Create a "Shared Workspace" where the user appears as owner
- Show incorrect title
- Display no documents

### Root Cause
The `join-workspace` message handler in the sidecar was **incomplete**. The active handler only:
1. ✅ Saved workspace metadata
2. ✅ Joined the DHT topic for discovery

But it was **missing the critical step**:
3. ❌ Never called `p2pBridge.connectToPeer()` to connect to bootstrap peers from the share link

The complete implementation with bootstrap peer connection logic existed in **dead code** - approximately 1,070 lines of commented-out code that was never removed during a previous refactoring.

### Fix Applied
- Restored bootstrap peer connection logic to the active `join-workspace` handler
- Bootstrap peers from share links are now properly connected via Hyperswarm
- Direct P2P connections are established immediately upon joining

## 🧹 Dead Code Cleanup

Removed ~1,070 lines of dead code from `sidecar/index.js`:
- **Before**: 3,871 lines
- **After**: 2,802 lines  
- **Reduction**: 27%

### Duplicate Handlers Removed
The dead code block contained complete duplicates of these handlers:
- `set-key`
- `list-documents`
- `toggle-tor`
- `get-status`
- `list-workspaces`
- `create-workspace`
- `update-workspace`
- `delete-workspace`
- `join-workspace`
- And more...

### Missing Handlers Restored
These handlers only existed in dead code but were called by the frontend:
- `leave-workspace` - Leave a shared workspace (non-owner)
- `trash-document` - Soft-delete a document
- `restore-document` - Restore from trash
- `purge-document` - Permanently delete
- `restore-folder` - Restore folder from trash
- `purge-folder` - Permanently delete folder

### Duplicate `reinitialize-p2p` Fixed
Found two `reinitialize-p2p` handlers in the switch statement:
- First handler (removed): Missing `publicIP` in response
- Second handler (kept): Complete with `publicIP` field

## 📊 Spreadsheet Improvements

### Selection Toolbar Enhancements
- Improved toolbar positioning and styling
- Better visual feedback for cell selection
- Enhanced CSS organization

## ✅ Testing

All 47 test suites pass (1,346 tests):
- Build configuration tests ✅
- Crypto and identity tests ✅
- Error handling tests ✅
- Fuzz testing ✅
- Component tests ✅

## 📝 Technical Details

### Files Changed
- `sidecar/index.js` - Dead code removal, handler fixes (-1,069 lines net)
- `frontend/src/components/Sheet.jsx` - Minor improvements
- `frontend/src/components/SheetSelectionToolbar.jsx` - Toolbar enhancements
- `frontend/src/components/SelectionToolbar.css` - Style improvements

### Migration Notes
No migration needed. This is a bug fix and code cleanup release.

---

**Full Changelog**: v1.3.5...v1.3.6
