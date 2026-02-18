/**
 * PermissionWatcher
 * 
 * Watches for permission changes in the Yjs members map and syncs them
 * to the local workspace object. This is critical for ownership transfers:
 * when the old owner calls transferOwnership(), the promoted peer's Yjs
 * member entry updates to permission: 'owner', but the local workspace's
 * myPermission field never updates. This component bridges that gap.
 * 
 * Race condition guard: When a user re-joins with a higher permission link,
 * joinWorkspace sets permissionSetAt on the local workspace. PermissionWatcher
 * only applies Yjs→local permission changes when the Yjs member's
 * permissionUpdatedAt is >= the local permissionSetAt, preventing stale Yjs
 * state from overwriting a fresh local upgrade.
 * 
 * Founding owner protection: If a pending demotion is detected on the user's
 * own Yjs member entry (pendingDemotion field), a toast is shown asking them
 * to review the request in Settings.
 * 
 * Renders nothing — it's a pure side-effect component.
 * 
 * TODO: Replace toasts with a proper notifications pane / bell icon that
 * stores notification history for offline users. Toasts are ephemeral and
 * can be missed if the user is away when the permission change arrives.
 */

import { useEffect, useRef } from 'react';
import { useWorkspaceSyncContext } from '../contexts/WorkspaceSyncContext';
import { useWorkspaces } from '../contexts/WorkspaceContext';
import { useIdentity } from '../contexts/IdentityContext';
import { useToast } from '../contexts/ToastContext';

export default function PermissionWatcher() {
  const { members } = useWorkspaceSyncContext();
  const { currentWorkspace, currentWorkspaceId, updateWorkspace } = useWorkspaces();
  const { publicIdentity } = useIdentity();
  const { showToast } = useToast();
  
  // Track previous permission to detect changes (not just mount)
  const prevPermissionRef = useRef(null);
  // Track whether we've already shown a pending-demotion toast this session
  const pendingDemotionShownRef = useRef(null);

  useEffect(() => {
    if (!publicIdentity?.publicKeyBase62 || !currentWorkspaceId || !members) return;

    const myKey = publicIdentity.publicKeyBase62;
    const myMember = members[myKey];
    if (!myMember?.permission) return;

    const yjsPermission = myMember.permission;
    const localPermission = currentWorkspace?.myPermission;
    const prevPermission = prevPermissionRef.current;

    // --- Founding owner pending demotion notification ---
    if (myMember.pendingDemotion && pendingDemotionShownRef.current !== myMember.pendingDemotion.requestedAt) {
      pendingDemotionShownRef.current = myMember.pendingDemotion.requestedAt;
      const requesterName = myMember.pendingDemotion.requestedByName || 'An owner';
      const newRole = myMember.pendingDemotion.requestedPermission || 'editor';
      showToast(`⚠️ ${requesterName} wants to change your role to ${newRole}. Open Settings to respond.`, 'warning');
    }

    // Update the ref to track current Yjs permission
    prevPermissionRef.current = yjsPermission;

    // Only act if Yjs permission differs from local
    if (yjsPermission !== localPermission) {
      // --- Race condition guard ---
      // If the local workspace has a permissionSetAt timestamp (set by joinWorkspace
      // during re-join with higher permission), only apply Yjs→local sync when the
      // Yjs member's permissionUpdatedAt is >= permissionSetAt.
      // This prevents stale Yjs state from overwriting a fresh local upgrade.
      const localSetAt = currentWorkspace?.permissionSetAt || 0;
      const yjsUpdatedAt = myMember.permissionUpdatedAt || 0;

      if (localSetAt > 0 && yjsUpdatedAt < localSetAt) {
        // Stale Yjs data — skip this sync cycle. The self-registration write
        // in useWorkspaceSync will soon update Yjs with the correct permission,
        // at which point permissionUpdatedAt will be >= permissionSetAt.
        console.log(`[PermissionWatcher] Skipping stale Yjs sync: yjsUpdatedAt=${yjsUpdatedAt} < permissionSetAt=${localSetAt}`);
        return;
      }

      console.log(`[PermissionWatcher] Permission change detected: local="${localPermission}" → yjs="${yjsPermission}"`);
      
      updateWorkspace(currentWorkspaceId, { myPermission: yjsPermission });

      // Show toast only when permission actually changed (not on first load)
      if (prevPermission !== null && prevPermission !== yjsPermission) {
        if (yjsPermission === 'owner') {
          showToast('👑 You are now an owner of this workspace.', 'success');
        } else if (yjsPermission === 'editor') {
          showToast('Your permission has been changed to editor.', 'info');
        } else if (yjsPermission === 'viewer') {
          showToast('Your permission has been changed to viewer.', 'info');
        }
      }
    }
  }, [members, publicIdentity?.publicKeyBase62, currentWorkspaceId, currentWorkspace?.myPermission, currentWorkspace?.permissionSetAt, updateWorkspace, showToast]);

  return null;
}
