/**
 * PermissionWatcher
 * 
 * Watches for permission changes in the Yjs members map and syncs them
 * to the local workspace object. This is critical for ownership transfers:
 * when the old owner calls transferOwnership(), the promoted peer's Yjs
 * member entry updates to permission: 'owner', but the local workspace's
 * myPermission field never updates. This component bridges that gap.
 * 
 * Renders nothing — it's a pure side-effect component.
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

  useEffect(() => {
    if (!publicIdentity?.publicKeyBase62 || !currentWorkspaceId || !members) return;

    const myKey = publicIdentity.publicKeyBase62;
    const myMember = members[myKey];
    if (!myMember?.permission) return;

    const yjsPermission = myMember.permission;
    const localPermission = currentWorkspace?.myPermission;
    const prevPermission = prevPermissionRef.current;

    // Update the ref to track current Yjs permission
    prevPermissionRef.current = yjsPermission;

    // Only act if Yjs permission differs from local AND it actually changed
    // (prevPermission check prevents toast on initial mount)
    if (yjsPermission !== localPermission) {
      console.log(`[PermissionWatcher] Permission change detected: local="${localPermission}" → yjs="${yjsPermission}"`);
      
      updateWorkspace(currentWorkspaceId, { myPermission: yjsPermission });

      // Show toast only when permission actually changed (not on first load)
      if (prevPermission !== null && prevPermission !== yjsPermission) {
        if (yjsPermission === 'owner') {
          showToast('👑 You are now the owner of this workspace.', 'success');
        } else if (yjsPermission === 'editor') {
          showToast('Your permission has been changed to editor.', 'info');
        } else if (yjsPermission === 'viewer') {
          showToast('Your permission has been changed to viewer.', 'info');
        }
      }
    }
  }, [members, publicIdentity?.publicKeyBase62, currentWorkspaceId, currentWorkspace?.myPermission, updateWorkspace, showToast]);

  return null;
}
