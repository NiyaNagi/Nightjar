/**
 * Workspace & Permissions Type Definitions
 * 
 * Reference: docs/WORKSPACE_PERMISSIONS_SPEC.md
 * 
 * Hierarchy: User → Workspaces → Folders → Documents
 * Key derivation: workspaceKey → folderKey → documentKey
 */

// ============================================================
// Permission Types
// ============================================================

/**
 * Permission levels for workspace access
 * - owner: Full control, can delete workspace, promote others
 * - editor: Read/write, can create/delete content and share
 * - viewer: Read-only, can create viewer-only share links
 */
export type Permission = 'owner' | 'editor' | 'viewer';

/**
 * Permission level codes used in share links
 */
export type PermissionCode = 'o' | 'e' | 'v';

/**
 * Map between full permission names and codes
 */
export const PERMISSION_CODES: Record<Permission, PermissionCode> = {
  owner: 'o',
  editor: 'e',
  viewer: 'v',
};

export const CODE_TO_PERMISSION: Record<PermissionCode, Permission> = {
  o: 'owner',
  e: 'editor',
  v: 'viewer',
};

/**
 * Permission hierarchy for comparison (higher = more access)
 */
export const PERMISSION_HIERARCHY: Record<Permission, number> = {
  owner: 3,
  editor: 2,
  viewer: 1,
};

/**
 * Get the higher of two permissions
 */
export function getHigherPermission(a: Permission, b: Permission): Permission {
  return PERMISSION_HIERARCHY[a] >= PERMISSION_HIERARCHY[b] ? a : b;
}

/**
 * Check if permission a is at least as high as permission b
 */
export function hasAtLeastPermission(userPerm: Permission, requiredPerm: Permission): boolean {
  return PERMISSION_HIERARCHY[userPerm] >= PERMISSION_HIERARCHY[requiredPerm];
}

// ============================================================
// Entity Types
// ============================================================

/**
 * Types of shareable entities
 */
export type EntityType = 'workspace' | 'folder' | 'document';

/**
 * Entity type codes used in share links
 */
export type EntityTypeCode = 'w' | 'f' | 'd';

export const ENTITY_TYPE_CODES: Record<EntityType, EntityTypeCode> = {
  workspace: 'w',
  folder: 'f',
  document: 'd',
};

export const CODE_TO_ENTITY_TYPE: Record<EntityTypeCode, EntityType> = {
  w: 'workspace',
  f: 'folder',
  d: 'document',
};

// ============================================================
// Workspace
// ============================================================

/**
 * Workspace - top-level container for folders and documents
 */
export interface Workspace {
  /** Unique identifier (UUID) */
  id: string;
  
  /** User-defined name */
  name: string;
  
  /** Creation timestamp */
  createdAt: number;
  
  /** Public key of creator */
  createdBy: string;
  
  /** Array of owner public keys (multiple owners supported) */
  owners: string[];
  
  /** Optional accent color (hex) */
  color?: string;
  
  /** Optional emoji icon */
  icon?: string;
}

/**
 * Workspace with local metadata (not synced)
 */
export interface LocalWorkspace extends Workspace {
  /** User's permission level for this workspace */
  myPermission: Permission;
  
  /** The scope at which user gained access */
  accessScope: EntityType;
  
  /** The entity ID where access was granted */
  accessScopeId: string;
  
  /** Password used to derive keys (stored locally only) */
  password?: string;
  
  /** Last accessed timestamp */
  lastAccessedAt?: number;
}

// ============================================================
// Folder
// ============================================================

/**
 * Folder - container for documents and sub-folders
 * All documents must be in a folder (no root-level documents)
 */
export interface Folder {
  /** Unique identifier (UUID) */
  id: string;
  
  /** User-defined name */
  name: string;
  
  /** Parent folder ID, null = workspace root */
  parentId: string | null;
  
  /** Parent workspace ID */
  workspaceId: string;
  
  /** Creation timestamp */
  createdAt: number;
  
  /** Public key of creator */
  createdBy: string;
  
  /** True if this is the trash folder */
  isTrash: boolean;
  
  /** Order index for sorting */
  order?: number;
}

/**
 * Folder with local accessibility info
 */
export interface AccessibleFolder extends Folder {
  /** Whether user has access to this folder */
  isAccessible: boolean;
  
  /** Permission level (if accessible) */
  permission?: Permission;
}

// ============================================================
// Document
// ============================================================

/**
 * Document types supported
 * - text: Rich text document
 * - markdown: Markdown document
 * - code: Code file
 * - sheet: Spreadsheet document
 * - kanban: Kanban board
 * - inventory: Inventory management system
 * - other: Unknown type
 */
export type DocumentType = 'text' | 'markdown' | 'code' | 'sheet' | 'kanban' | 'inventory' | 'other';

/**
 * Document - a collaborative editable file
 */
export interface Document {
  /** Unique identifier (UUID) */
  id: string;
  
  /** User-defined name */
  name: string;
  
  /** Parent folder ID (required - all docs must be in a folder) */
  folderId: string;
  
  /** Parent workspace ID */
  workspaceId: string;
  
  /** Document type */
  type: DocumentType;
  
  /** Creation timestamp */
  createdAt: number;
  
  /** Public key of creator */
  createdBy: string;
  
  /** Last edit timestamp */
  lastEditedAt: number;
  
  /** Public key of last editor */
  lastEditedBy: string;
  
  /** Order index for sorting */
  order?: number;
}

/**
 * Document with trash metadata
 */
export interface TrashedDocument extends Document {
  /** When moved to trash */
  trashedAt: number;
  
  /** Public key of who trashed it */
  trashedBy: string;
  
  /** Original folder ID before trash */
  originalFolderId: string;
  
  /** Original folder name for display */
  originalFolderName?: string;
}

/**
 * Check if a document is trashed
 */
export function isDocumentTrashed(doc: Document | TrashedDocument): doc is TrashedDocument {
  return 'trashedAt' in doc && doc.trashedAt !== undefined;
}

// ============================================================
// Collaborator
// ============================================================

/**
 * Collaborator entry - tracks who has access to a workspace
 */
export interface CollaboratorEntry {
  /** User's public key (unique identifier) */
  publicKey: string;
  
  /** Display name (handle) */
  handle: string;
  
  /** User's color */
  color: string;
  
  /** User's emoji icon */
  icon: string;
  
  /** Permission level */
  permission: Permission;
  
  /** When permission was granted */
  grantedAt: number;
  
  /** Who granted the permission (public key) */
  grantedBy: string;
  
  /** Scope of access */
  scope: EntityType;
  
  /** ID of the shared entity */
  scopeId: string;
}

/**
 * Collaborator with online status (from presence)
 */
export interface OnlineCollaborator extends CollaboratorEntry {
  /** Whether currently online */
  isOnline: boolean;
  
  /** Current location (document ID) */
  currentDocumentId?: string;
  
  /** Cursor position info */
  cursor?: {
    line: number;
    column: number;
  };
}

// ============================================================
// Share Link Types
// ============================================================

/**
 * Parsed share link data
 */
export interface ParsedShareLink {
  /** Entity type being shared */
  entityType: EntityType;
  
  /** Entity ID */
  entityId: string;
  
  /** Permission level granted */
  permission: Permission;
  
  /** Password for key derivation (if using password mode) */
  password?: string;
  
  /** Direct encryption key (if using key mode) */
  encryptionKey?: Uint8Array;
  
  /** Read-only flag (legacy) */
  readOnly?: boolean;
}

/**
 * Options for generating a share link
 */
export interface ShareLinkOptions {
  /** Entity type to share */
  entityType: EntityType;
  
  /** Entity ID to share */
  entityId: string;
  
  /** Permission level to grant */
  permission: Permission;
  
  /** Password (for Option B - password mode) */
  password?: string;
  
  /** Direct key (for Option A - key in URL) */
  encryptionKey?: Uint8Array;
}

// ============================================================
// Access Resolution
// ============================================================

/**
 * Result of resolving access for an entity
 */
export interface AccessResolution {
  /** Whether user has access */
  hasAccess: boolean;
  
  /** Resolved permission level */
  permission?: Permission;
  
  /** Where access was granted */
  grantedAt?: EntityType;
  
  /** ID of entity where access was granted */
  grantedAtId?: string;
  
  /** Chain of keys from grant point to target */
  keyChain?: Uint8Array[];
}

// ============================================================
// Trash
// ============================================================

/**
 * Trash item (folder or document in trash)
 */
export interface TrashItem {
  /** Entity type */
  type: 'folder' | 'document';
  
  /** Entity ID */
  id: string;
  
  /** Entity name */
  name: string;
  
  /** When trashed */
  trashedAt: number;
  
  /** Who trashed it */
  trashedBy: string;
  
  /** Original parent folder ID */
  originalFolderId: string;
  
  /** Days remaining before auto-purge */
  daysRemaining: number;
}

/**
 * Calculate days remaining before auto-purge
 */
export function getDaysRemaining(trashedAt: number): number {
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const purgeAt = trashedAt + THIRTY_DAYS_MS;
  const remaining = purgeAt - Date.now();
  return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
}

// ============================================================
// Capability Checks
// ============================================================

/**
 * Actions that require permission checks
 */
export type PermissionAction = 
  | 'view'
  | 'edit'
  | 'create'
  | 'delete'
  | 'restore'
  | 'share-owner'
  | 'share-editor'
  | 'share-viewer'
  | 'delete-workspace'
  | 'promote-owner';

/**
 * Required permission for each action
 */
export const ACTION_REQUIREMENTS: Record<PermissionAction, Permission> = {
  'view': 'viewer',
  'edit': 'editor',
  'create': 'editor',
  'delete': 'editor',
  'restore': 'editor',
  'share-owner': 'owner',
  'share-editor': 'editor',
  'share-viewer': 'viewer',
  'delete-workspace': 'owner',
  'promote-owner': 'owner',
};

/**
 * Check if a permission level can perform an action
 */
export function canPerformAction(permission: Permission, action: PermissionAction): boolean {
  const required = ACTION_REQUIREMENTS[action];
  return hasAtLeastPermission(permission, required);
}
