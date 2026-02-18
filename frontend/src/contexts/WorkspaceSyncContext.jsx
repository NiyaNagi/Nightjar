/**
 * WorkspaceSyncContext
 * 
 * Provides synced workspace data (documents, folders, members, etc.) to the entire app.
 * This context wraps FolderProvider and App so both can access the synced data.
 * 
 * This solves the architecture issue where:
 * 1. useWorkspaceSync creates a Yjs connection to workspace-meta:{workspaceId}
 * 2. FolderContext was creating its own Yjs connection to workspace-folders:{workspaceId}
 * 3. P2P only syncs workspace-meta, so folders never reached FolderContext
 * 
 * Now all synced data comes from this single context.
 */

import React, { createContext, useContext } from 'react';
import { useWorkspaces } from './WorkspaceContext';
import { useIdentity } from './IdentityContext';
import { useWorkspaceSync } from '../hooks/useWorkspaceSync';
import { loadUserProfile } from '../components/UserProfile';

const WorkspaceSyncContext = createContext(null);

export function WorkspaceSyncProvider({ children }) {
  const { currentWorkspaceId, currentWorkspace } = useWorkspaces();
  const { publicIdentity } = useIdentity();
  
  // Load user profile for awareness
  const userProfile = loadUserProfile();
  
  // Remote server URL for cross-platform workspaces
  const workspaceServerUrl = currentWorkspace?.serverUrl || null;
  
  // Initial workspace info - only used when creating a new workspace (owner)
  const initialWorkspaceInfo = currentWorkspace ? {
    name: currentWorkspace.name,
    icon: currentWorkspace.icon,
    color: currentWorkspace.color,
    createdBy: currentWorkspace.createdBy,
  } : null;
  
  // User profile for workspace-level awareness
  const workspaceUserProfile = {
    name: userProfile.name,
    color: userProfile.color,
    icon: userProfile.icon,
  };
  
  // Get all synced data from useWorkspaceSync
  const syncData = useWorkspaceSync(
    currentWorkspaceId,
    initialWorkspaceInfo,
    workspaceUserProfile,
    workspaceServerUrl,
    publicIdentity,
    currentWorkspace?.myPermission
  );
  
  return (
    <WorkspaceSyncContext.Provider value={syncData}>
      {children}
    </WorkspaceSyncContext.Provider>
  );
}

export function useWorkspaceSyncContext() {
  const context = useContext(WorkspaceSyncContext);
  if (!context) {
    throw new Error('useWorkspaceSyncContext must be used within a WorkspaceSyncProvider');
  }
  return context;
}

export default WorkspaceSyncContext;
