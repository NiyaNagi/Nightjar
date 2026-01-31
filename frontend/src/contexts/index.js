/**
 * Contexts barrel export
 * 
 * Central export for all context providers and hooks
 */

// Workspace management
export { 
    WorkspaceProvider, 
    useWorkspaces 
} from './WorkspaceContext';

// Folder management
export { 
    FolderProvider, 
    useFolders,
    SYSTEM_FOLDER_IDS,
    TRASH_PURGE_DAYS 
} from './FolderContext';

// Permission management
export { 
    PermissionProvider, 
    usePermissions,
    PERMISSION_LEVELS,
    ACTION_REQUIREMENTS 
} from './PermissionContext';

// Identity management
export { 
    IdentityProvider, 
    useIdentity 
} from './IdentityContext';

// Presence/collaboration
export { 
    PresenceProvider, 
    usePresence 
} from './PresenceContext';
