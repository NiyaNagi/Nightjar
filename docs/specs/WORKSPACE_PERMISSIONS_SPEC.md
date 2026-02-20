# Workspace & Permissions System Specification

**Version:** 1.0  
**Created:** January 24, 2026  
**Status:** Implementation Ready

---

## 1. Overview

Nightjar supports hierarchical content organization with workspaces, folders, and documents. Users can share at any level of the hierarchy, with permissions that automatically apply to all content beneath the shared entity.

### Content Hierarchy

```
User
└── Workspaces (multiple)
    └── Folders (nested, required for documents)
        └── Documents
```

### Key Principles

1. **Hierarchical Key Derivation**: Keys derive from parent to child, enabling automatic access to new content
2. **Permission Inheritance**: Sharing a parent grants access to all children
3. **Highest Permission Wins**: Users retain their highest granted permission level
4. **Non-Revocable Links**: Anyone with a link retains access forever
5. **Full Transparency**: All collaborators can see the access list

---

## 2. Permission Levels

### 2.1 Three-Tier Model

| Level | Code | Description |
|-------|------|-------------|
| **Owner** | `o` | Full control, can delete workspace, promote others to owner |
| **Editor** | `e` | Read/write access, can create/delete content and share links |
| **Viewer** | `v` | Read-only access, can create viewer-only share links |

### 2.2 Capability Matrix

| Capability | Owner | Editor | Viewer |
|------------|:-----:|:------:|:------:|
| View all content | ✅ | ✅ | ✅ |
| Edit documents | ✅ | ✅ | ❌ |
| Create documents & folders | ✅ | ✅ | ❌ |
| Delete documents & folders | ✅ | ✅ | ❌ |
| Restore from trash | ✅ | ✅ | ❌ |
| Create Owner share links | ✅ | ❌ | ❌ |
| Create Editor share links | ✅ | ✅ | ❌ |
| Create Viewer share links | ✅ | ✅ | ✅ |
| Delete workspace | ✅ | ❌ | ❌ |
| Promote user to Owner | ✅ | ❌ | ❌ |
| See collaborator list | ✅ | ✅ | ✅ |
| Share items in trash | ❌ | ❌ | ❌ |

### 2.3 Permission Upgrade Rules

- When opening a link, user receives the permission level in the link
- If user already has a higher permission, they keep the higher one
- Permissions are stored per-workspace on the client
- Permission level is identity-based (tied to user's public key)

---

## 3. Encryption & Key Derivation

### 3.1 Hierarchical Key Derivation (Option B)

Keys are derived using Argon2id from parent key + entity ID:

```
workspaceKey = Argon2id(password, salt="Nightjar-v1-workspace-{workspaceId}")
folderKey    = Argon2id(workspaceKey, salt="Nightjar-v1-folder-{folderId}")
documentKey  = Argon2id(folderKey, salt="Nightjar-v1-document-{documentId}")
```

### 3.2 Key Derivation Parameters

- **Memory**: 64 MB (65536 KB)
- **Iterations**: 4
- **Parallelism**: 4
- **Hash Length**: 32 bytes

### 3.3 Access Path

When a user opens a share link:
1. Parse entity type, ID, permission, and password from URL
2. Derive the key for that entity from the password
3. If entity is a folder/document, derive parent keys upward for navigation context
4. Store the highest-level key available for deriving child keys

### 3.4 Scoped Access

When sharing a specific folder or document within a workspace:
- User can see the workspace and folder hierarchy for context
- User can only access/decrypt the specific shared entity and its children
- Parent folders/documents outside the share scope are visible but not accessible

---

## 4. Workspace Management

### 4.1 Initial State

- New users see an empty state prompting workspace creation
- No default workspace is auto-created

### 4.2 Workspace Properties

```typescript
interface Workspace {
  id: string;              // UUID
  name: string;            // User-defined name
  createdAt: number;       // Timestamp
  createdBy: string;       // Public key of creator
  owners: string[];        // Array of owner public keys
  color?: string;          // Optional accent color
  icon?: string;           // Optional emoji icon
}
```

### 4.3 Workspace UI

- Dropdown at top of sidebar for switching workspaces
- Shows workspace name + icon
- "Create Workspace" option at bottom of dropdown
- Current workspace contents displayed below

---

## 5. Folder Structure

### 5.1 Folder Requirements

- All documents must be inside a folder (no root-level documents)
- Folders can be nested to any depth
- Each folder belongs to exactly one parent (strictly hierarchical)

### 5.2 Folder Properties

```typescript
interface Folder {
  id: string;              // UUID
  name: string;            // User-defined name
  parentId: string | null; // Parent folder ID, null = workspace root
  workspaceId: string;     // Parent workspace
  createdAt: number;       // Timestamp
  createdBy: string;       // Public key of creator
  isTrash: boolean;        // True if this is the trash folder
}
```

### 5.3 Trash Folder

- One trash folder per workspace (auto-created, cannot be deleted)
- Trashed items retain their original location metadata for restoration
- Items in trash can be viewed and restored, but not shared
- Auto-purge after 30 days
- Anyone with edit access can restore items

---

## 6. Document Properties

```typescript
interface Document {
  id: string;              // UUID
  name: string;            // User-defined name
  folderId: string;        // Parent folder (required)
  workspaceId: string;     // Parent workspace
  type: 'text' | 'other';  // Document type
  createdAt: number;       // Timestamp
  createdBy: string;       // Public key of creator
  lastEditedAt: number;    // Last edit timestamp
  lastEditedBy: string;    // Public key of last editor
  trashedAt?: number;      // When moved to trash (if applicable)
  originalFolderId?: string; // Original location before trash
}
```

---

## 7. Share Links

### 7.1 Link Format

```
Nightjar://{type}/{id}#p:{password}&perm:{level}
```

- **type**: `w` (workspace), `f` (folder), `d` (document)
- **id**: Base62-encoded entity ID
- **password**: Auto-generated memorable password
- **level**: `o` (owner), `e` (editor), `v` (viewer)

### 7.2 Examples

```
Nightjar://w/abc123#p:azure-dolphin-7-bright-falcon&perm:o
Nightjar://f/def456#p:swift-tiger-3-calm-river&perm:e
Nightjar://d/ghi789#p:gentle-wave-9-bold-mountain&perm:v
```

### 7.3 Link Behavior

- Multiple links can exist for the same entity with different permissions
- Links cannot be revoked (P2P principle)
- Opening a link navigates directly to that entity
- For folder/document links, user sees parent hierarchy for context but can only access the shared scope

### 7.4 Share Dialog Options

Same as before:
- Message + QR (default)
- Message Only
- Link + QR
- Link Only
- Password Only

With additional dropdown:
- Share Level: Owner / Editor / Viewer (filtered by user's permission)

---

## 8. Collaborator Tracking

### 8.1 Permissions Sync

Permissions are synced via CRDT (Yjs) within each workspace:

```typescript
interface CollaboratorEntry {
  publicKey: string;       // User's public key
  handle: string;          // Display name
  color: string;           // User color
  icon: string;            // User emoji
  permission: 'owner' | 'editor' | 'viewer';
  grantedAt: number;       // When permission was granted
  grantedBy: string;       // Who granted (public key)
  scope: 'workspace' | 'folder' | 'document';
  scopeId: string;         // ID of the shared entity
}
```

### 8.2 Permission Resolution

When determining a user's permission for an entity:
1. Check if user has direct permission on the entity
2. Walk up the hierarchy checking for inherited permissions
3. Use the highest permission found

### 8.3 Transparency

- All users can view the full collaborator list
- Shows who has access, their permission level, and scope
- Owner can promote editors to owners

---

## 9. Conflict Resolution

### 9.1 CRDT Handling

- Document content: Yjs CRDT handles text conflicts automatically
- Metadata: Last-write-wins with timestamp

### 9.2 Delete/Restore Conflicts

- If someone deletes and another restores simultaneously, restore wins
- Rationale: Restoring is an intentional action to recover, deletion may be accidental
- Implementation: Trash flag is a CRDT counter; restore increments, delete decrements; positive = not trashed

---

## 10. Data Storage

### 10.1 Local Storage (Sidecar)

```
storage/
├── metadata/           # LevelDB for metadata
│   ├── workspaces/    # Workspace metadata
│   ├── folders/       # Folder metadata
│   ├── documents/     # Document metadata
│   └── permissions/   # Local permission cache
└── content/           # Encrypted document content
```

### 10.2 Sync Protocol

- Workspaces sync independently via Hyperswarm topics
- Topic = hash(workspaceId + workspaceKey)
- All metadata and content encrypted with derived keys

---

## 11. Navigation Behavior

### 11.1 Opening a Share Link

1. Parse link to get entity type, ID, permission, password
2. Derive key for the entity
3. If new workspace/folder/document, add to local storage
4. Navigate to the entity
5. Show parent hierarchy for context (grayed out if not accessible)

### 11.2 Scoped View

When user has access to a subset of a workspace:
- Workspace name visible in dropdown
- Only accessible folders shown in sidebar
- Inaccessible parent folders shown as breadcrumbs (grayed out)
- Clear indication of access scope

---

## 12. Implementation Tasks

See separate task breakdown document.

---

## Appendix A: Password Format

Memorable password format: `adjective-noun-digit-adjective-noun`

Examples:
- `azure-dolphin-7-bright-falcon`
- `swift-tiger-3-calm-river`
- `gentle-wave-9-bold-mountain`

Entropy: ~35 bits + Argon2id memory-hardness = 1000+ year brute-force resistance

---

## Appendix B: Share Link Creation Rules

| User Permission | Can Create |
|-----------------|------------|
| Owner | Owner, Editor, Viewer links |
| Editor | Editor, Viewer links |
| Viewer | Viewer links only |

Items in trash cannot be shared (button disabled).

---

## Appendix C: Migration from Current System

Current system has:
- Single workspace (implicit)
- Folders with documents
- Per-document passwords

Migration:
1. Create a default workspace for existing content
2. Migrate folders and documents into the workspace
3. Re-derive keys using new hierarchical system
4. Mark user as owner of migrated workspace
