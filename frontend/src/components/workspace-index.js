/**
 * Components barrel export
 * 
 * Central export for workspace/folder/permission related components
 */

// Workspace components
export { default as WorkspaceSwitcher } from './WorkspaceSwitcher';
export { default as WorkspaceSettings } from './WorkspaceSettings';
export { default as CreateWorkspace } from './CreateWorkspace';

// Folder components
export { default as FolderTree } from './FolderTree';
export { default as CreateFolder } from './CreateFolder';

// Permission components
export { default as PermissionGuard } from './PermissionGuard';
export { 
    RequireEditor, 
    RequireOwner, 
    RequireViewer,
    IfPermitted,
    WithPermission,
    usePermissionCheck 
} from './PermissionGuard';

// Access denied
export { default as AccessDenied } from './AccessDenied';
export { AccessDeniedInline } from './AccessDenied';

// Collaborator components
export { default as CollaboratorList, OnlineCollaborators } from './CollaboratorList';

// Share dialog
export { default as EntityShareDialog } from './Share/EntityShareDialog';
