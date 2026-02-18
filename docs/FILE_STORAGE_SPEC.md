# File Storage System — Functional Specification & Engineering Design

> **Version:** 1.0.0  
> **Date:** February 15, 2026  
> **Status:** Draft  
> **Authors:** Copilot + SaoneYanpa  
> **Depends on:** Nightjar v1.6.0+ (Inventory System baseline)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Glossary & Roles](#2-glossary--roles)
3. [Data Model](#3-data-model)
4. [Chunk Distribution Protocol](#4-chunk-distribution-protocol)
5. [Workflows](#5-workflows)
6. [UI/UX Design](#6-uiux-design)
7. [File Browser Views](#7-file-browser-views)
8. [File Linking & Embedding](#8-file-linking--embedding)
9. [Downloads System](#9-downloads-system)
10. [Search System](#10-search-system)
11. [Security & Encryption](#11-security--encryption)
12. [Notifications](#12-notifications)
13. [Settings & Admin](#13-settings--admin)
14. [Technology Choices](#14-technology-choices)
15. [Engineering Implementation Plan](#15-engineering-implementation-plan)
16. [Future Considerations](#16-future-considerations)
17. [Appendix A: File Type Categories](#appendix-a-file-type-categories)
18. [Appendix B: File Inventory](#appendix-b-file-inventory)

---

## 1. Executive Summary

### 1.1 Problem

Nightjar users can collaborate on documents, spreadsheets, and kanban boards — but have no way to share files (images, PDFs, archives, etc.) within a workspace. Users must resort to external file-sharing services, breaking the encrypted, decentralized model.

### 1.2 Solution

A built-in **File Storage** system that provides:

- **Encrypted peer-to-peer file storage** with BitTorrent-style chunk distribution
- **Hierarchical folder browser** modeled after Google Drive
- **File linking** across documents, spreadsheets, and kanban boards
- **On-demand downloading** with proactive background seeding for maximum availability
- **One file storage per workspace**, created via the existing "New" document button

### 1.3 Data Profile

| Metric | Expected Range |
|--------|---------------|
| Files per workspace | 10 – 10,000 |
| Avg file size | 500 KB – 20 MB |
| Max file size | 100 MB (TODO: expand later) |
| Chunk size | 1 MB |
| Folders per workspace | 5 – 500 |
| Folder nesting depth | Up to 10 levels |
| Concurrent peers | 2 – 50 |

### 1.4 Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage entity | New document type `'files'` | Follows inventory pattern; one per workspace |
| Chunk size | 1 MB | Matches `MAX_MESSAGE_SIZE` in mesh.js; good balance of granularity and overhead |
| Max file size | 100 MB | Matches existing `MAX_FILE_SIZE`; TODO to expand |
| Sync strategy | Metadata via Yjs, content via chunked P2P | Binary files are not CRDTs; Yjs handles metadata only |
| Encryption | Workspace key (single) | Files use same workspace-level XSalsa20-Poly1305 encryption |
| Availability target | Any file recoverable with 10% of total peers online | Proactive redundancy distribution |
| Collision handling | Replace by default in same folder | Nested folders prevent cross-folder collisions |
| Deletion | Soft delete → hard delete after 30 days | Matches document trash pattern |
| Web mode | Upload/download to connected peers; chunk storage in IndexedDB | Limited vs. Electron; no filesystem sync |
| File browser model | Google Drive-style single-page experience | Familiar, proven UX |

---

## 2. Glossary & Roles

### 2.1 Terms

| Term | Definition |
|------|------------|
| **File Storage** | The workspace-level file management system (one per workspace) |
| **Chunk** | A 1 MB segment of an encrypted file, the unit of P2P transfer |
| **Chunk Map** | A Yjs-synced data structure tracking which peers hold which chunks |
| **Seeding** | Proactively distributing chunks to other peers for redundancy |
| **File Card** | A visual card in the file browser representing a single file |
| **File Link** | An inline reference to a file embedded in a doc, sheet, or kanban card |
| **Distribution Health** | Whether a file's chunks exist on peers beyond the uploader's device |
| **Local-Only** | A file whose chunks exist only on the current device (⚠️ icon) |

### 2.2 Role Mapping

File storage permissions mirror workspace permissions:

| Workspace Role | File Storage Role | Capabilities |
|----------------|-------------------|-------------|
| Owner | **Admin** | All features + settings + trash management + storage quota + seeding config |
| Editor | **Contributor** | Upload, download, create folders, rename, move, delete own files, tag |
| Viewer | **Reader** | Download only, browse, search |

### 2.3 Admin-Specific Capabilities

- Configure workspace storage quota
- Manage trash (force-empty, restore any file)
- Configure auto-delete period (default 30 days)
- View storage usage statistics
- Configure chunk seeding settings (min redundancy, etc.)
- Delete any file (not just their own)
- Rename/move any file

---

## 3. Data Model

### 3.1 FileStorageSystem

```typescript
interface FileStorageSystem {
  id: string;                    // Same as the document ID, e.g., "doc-x1y2z3"
  workspaceId: string;           // Parent workspace
  name: string;                  // Display name, e.g., "Files"
  icon: string;                  // Emoji icon, default "📁"

  // Settings (admin-configurable)
  settings: FileStorageSettings;

  // Lifecycle
  createdAt: number;             // Unix timestamp ms
  createdBy: string;             // Admin public key (base62)
}
```

**Storage:** `ydoc.getMap('fileStorageSystems')` — keyed by system ID.

### 3.2 FileStorageSettings

```typescript
interface FileStorageSettings {
  maxFileSize: number;           // Bytes, default 104857600 (100 MB); TODO: expand
  autoDeleteDays: number;        // Days before trashed files are permanently deleted, default 30
  chunkRedundancyTarget: number; // Min peers per chunk for seeding, default 3
  storageQuota: number;          // Bytes, 0 = unlimited, default 0; TODO: expose in settings
}
```

### 3.3 StorageFile

```typescript
interface StorageFile {
  id: string;                    // UUID, e.g., "file-x1y2z3"
  fileStorageId: string;         // Parent FileStorageSystem ID
  folderId: string | null;       // Parent folder ID, null = root

  // File identity
  name: string;                  // Original filename with extension, e.g., "report.pdf"
  extension: string;             // Lowercase extension, e.g., "pdf"
  mimeType: string;              // MIME type, e.g., "application/pdf"
  sizeBytes: number;             // Original file size in bytes

  // Chunk info
  chunkCount: number;            // Total number of 1 MB chunks
  chunkHashes: string[];         // SHA-256 hash of each chunk (for integrity verification)
  fileHash: string;              // SHA-256 hash of the entire original file

  // Metadata
  description: string;           // User-provided description, default ""
  tags: string[];                // User-provided tags, default []
  typeCategory: FileTypeCategory; // Derived from extension, see §Appendix A
  uploadedBy: string;            // Uploader's public key (base62)
  uploadedByName: string;        // Uploader's display name at upload time

  // Lifecycle
  createdAt: number;             // Upload timestamp
  updatedAt: number;             // Last metadata edit
  deletedAt: number | null;      // Soft delete timestamp, null = not deleted

  // Favorites
  favoritedBy: string[];         // Array of public keys who starred this file

  // Version tracking (simple replace tracking)
  version: number;               // Increments on replace, starts at 1
  replacedAt: number | null;     // Timestamp of last replace, null if original
  replacedBy: string | null;     // Public key of user who replaced, null if original
}
```

**Storage:** `ydoc.getArray('storageFiles')` — synced to all peers via workspace-meta room.

### 3.4 StorageFolder

```typescript
interface StorageFolder {
  id: string;                    // UUID, e.g., "sfolder-x1y2z3"
  fileStorageId: string;         // Parent FileStorageSystem ID
  parentId: string | null;       // Parent folder ID, null = root
  name: string;                  // Folder name, e.g., "Project Assets"
  color: string | null;          // Optional hex color
  icon: string | null;           // Optional emoji icon

  // Lifecycle
  createdAt: number;
  createdBy: string;             // Creator's public key
  updatedAt: number;
  deletedAt: number | null;      // Soft delete
}
```

**Storage:** `ydoc.getArray('storageFolders')` — synced via workspace-meta room.

### 3.5 ChunkAvailability

```typescript
interface ChunkAvailability {
  fileId: string;                // File this chunk belongs to
  chunkIndex: number;            // 0-based chunk index
  holders: string[];             // Public keys of peers that have this chunk
  lastUpdated: number;           // Timestamp of last availability update
}
```

**Storage:** `ydoc.getMap('chunkAvailability')` — keyed by `"${fileId}:${chunkIndex}"`.

> **Note:** The chunk availability map is a hybrid approach. Peers advertise what they hold via Yjs (for discovery), and actual chunk transfer happens via P2P messaging (for efficiency). This combines the discovery benefits of a shared map with the transfer efficiency of direct peer requests.

### 3.6 FileTypeCategory

```typescript
type FileTypeCategory =
  | 'document'    // PDF, DOC, DOCX, TXT, RTF, ODT, PAGES
  | 'spreadsheet' // XLS, XLSX, CSV, ODS, NUMBERS
  | 'image'       // PNG, JPG, JPEG, GIF, SVG, WEBP, BMP, ICO, TIFF
  | 'video'       // MP4, MOV, AVI, MKV, WEBM, FLV
  | 'audio'       // MP3, WAV, FLAC, AAC, OGG, M4A
  | 'archive'     // ZIP, TAR, GZ, 7Z, RAR, BZ2
  | 'code'        // JS, TS, PY, JAVA, C, CPP, H, RS, GO, RB, PHP, HTML, CSS
  | 'presentation'// PPT, PPTX, KEY, ODP
  | 'design'      // PSD, AI, SKETCH, FIG, XD
  | 'other';      // Everything else
```

### 3.7 DownloadRecord

```typescript
interface DownloadRecord {
  id: string;                    // UUID
  fileId: string;                // StorageFile ID
  fileName: string;              // Snapshot of filename at download time
  sizeBytes: number;             // File size
  localPath: string;             // Where it was saved on disk
  downloadedAt: number;          // Completion timestamp
  status: 'downloading' | 'complete' | 'failed' | 'cancelled';
  progress: number;              // 0-100 percentage
  chunksReceived: number;        // Chunks downloaded so far
  chunksTotal: number;           // Total chunks needed
  error: string | null;          // Error message if failed
}
```

**Storage:** Local only — `localStorage` key `nightjar-downloads-${workspaceId}`. NOT synced via Yjs.

### 3.8 FileAuditEntry

```typescript
interface FileAuditEntry {
  id: string;                    // UUID, e.g., "faudit-x1y2z3"
  fileStorageId: string;         // Parent FileStorageSystem ID
  timestamp: number;             // Unix timestamp ms
  actorId: string;               // Public key of actor
  actorName: string;             // Display name at action time
  action: FileAuditAction;       // Action type
  targetType: 'file' | 'folder' | 'settings';
  targetId: string;              // ID of affected file/folder
  targetName: string;            // Name at action time
  summary: string;               // Human-readable summary
  metadata?: Record<string, any>; // Optional extra data (e.g., old name for renames)
}

type FileAuditAction =
  | 'file_uploaded'
  | 'file_downloaded'
  | 'file_deleted'
  | 'file_restored'
  | 'file_permanently_deleted'
  | 'file_renamed'
  | 'file_moved'
  | 'file_replaced'
  | 'file_tagged'
  | 'folder_created'
  | 'folder_renamed'
  | 'folder_deleted'
  | 'folder_restored'
  | 'settings_changed';
```

**Storage:** `ydoc.getArray('fileAuditLog')` — synced via workspace-meta room.

---

## 4. Chunk Distribution Protocol

### 4.1 Overview

Files are NOT synced via Yjs. Yjs handles only metadata (file records, folder structure, chunk availability). File content is transferred as encrypted 1 MB chunks via the existing P2P messaging infrastructure.

```
┌─────────────────────────────────────────────────────────┐
│                    FILE UPLOAD FLOW                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. User selects file (≤100 MB)                        │
│  2. Frontend reads file → ArrayBuffer                  │
│  3. Compute SHA-256 hash of entire file                │
│  4. Split into 1 MB chunks                             │
│  5. Compute SHA-256 hash of each chunk                 │
│  6. Encrypt each chunk with workspace key              │
│  7. Store encrypted chunks locally (LevelDB/IndexedDB) │
│  8. Create StorageFile record in Yjs                   │
│  9. Update ChunkAvailability in Yjs (self as holder)   │
│ 10. Begin proactive seeding to online peers            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 4.2 Chunk Encryption

Each chunk is encrypted independently using the workspace encryption key:

```javascript
// Pseudocode for chunk encryption
function encryptChunk(chunkData, workspaceKey) {
  const nonce = nacl.randomBytes(24);
  const encrypted = nacl.secretbox(chunkData, nonce, workspaceKey);
  return Buffer.concat([nonce, encrypted]); // 24-byte nonce + ciphertext
  // Note: No 4KB padding for chunks — padding is for Yjs updates only.
  // Chunks are already fixed-size (1 MB) so padding leaks no information.
}
```

> **⚠️ Security:** Chunks do NOT use the 4KB padding scheme from `crypto.js` because chunks are already fixed-size (1 MB, except the last chunk). The fixed size itself prevents size-based information leakage. The existing `nacl.secretbox` (XSalsa20-Poly1305) is used directly.

### 4.3 Proactive Seeding Strategy

**Goal:** Ensure any file is recoverable if at least 10% of total-ever-seen peers are online.

**Algorithm:**

```
REDUNDANCY_TARGET = settings.chunkRedundancyTarget (default 3)

every SEED_INTERVAL (60 seconds):
  for each file in storageFiles where deletedAt == null:
    for each chunk 0..chunkCount-1:
      holders = chunkAvailability[fileId:chunkIndex].holders
      onlineHolders = holders.filter(isOnline)
      
      if onlineHolders.length < REDUNDANCY_TARGET:
        // Find peers who DON'T have this chunk
        candidates = onlinePeers.filter(p => !holders.includes(p))
        // Respect peer storage quotas
        candidates = candidates.filter(p => p.availableQuota > 0)
        // Sort by: fewest chunks held (balance load)
        candidates.sort(byChunksHeldAscending)
        
        // Send chunk to top candidate
        if candidates.length > 0:
          sendChunk(candidates[0], fileId, chunkIndex)
          // Candidate updates their chunkAvailability entry via Yjs
```

**Seeding only occurs when the app is open.** Peers do not need the file browser view open — being connected to the workspace is sufficient.

### 4.4 Chunk Storage

| Platform | Storage Backend | Location |
|----------|----------------|----------|
| Electron | LevelDB | `{userData}/storage/chunks/{workspaceId}/{fileId}/{chunkIndex}` |
| Web | IndexedDB | Database: `nightjar-chunks-{workspaceId}`, Store: `chunks`, Key: `{fileId}:{chunkIndex}` |

### 4.5 Storage Quota Enforcement

Each peer tracks their local chunk storage usage. The quota setting (§13) limits how much space they donate for seeding:

```javascript
// Quota check before accepting a seeded chunk
function canAcceptChunk(workspaceId, chunkSizeBytes) {
  const currentUsage = getLocalChunkUsage(workspaceId);
  const quota = getChunkStorageQuota(); // from settings, default = Infinity
  return (currentUsage + chunkSizeBytes) <= quota;
}
```

**Quota range:** 100 MB to unlimited (Infinity). Default: unlimited.

> **Note:** The quota applies to *seeded* chunks only (chunks for files the peer didn't upload or request). The peer's own uploads and explicit downloads are never quota-limited.

### 4.6 File Download Flow

```
┌─────────────────────────────────────────────────────────┐
│                   FILE DOWNLOAD FLOW                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. User clicks download on a file                     │
│  2. Read StorageFile record from Yjs (chunkHashes,     │
│     chunkCount, fileHash)                              │
│  3. Check local chunk storage — which chunks we have   │
│  4. For missing chunks:                                │
│     a. Read ChunkAvailability from Yjs                 │
│     b. Identify online peers holding each chunk        │
│     c. Request chunks via P2P message                  │
│     d. Verify SHA-256 hash of received chunk           │
│     e. Decrypt chunk                                   │
│     f. Store locally for future seeding                │
│  5. Reassemble file from decrypted chunks (in order)   │
│  6. Verify SHA-256 hash of reassembled file            │
│  7. Save to default downloads folder                   │
│  8. Show in Downloads pane                             │
│  9. Update ChunkAvailability (self now holds all)      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 4.7 P2P Message Types

New message types added to the mesh protocol:

```javascript
const FILE_MESSAGE_TYPES = {
  CHUNK_REQUEST:    'file:chunk:request',    // { fileId, chunkIndex }
  CHUNK_RESPONSE:   'file:chunk:response',   // { fileId, chunkIndex, data (base64) }
  CHUNK_UNAVAILABLE:'file:chunk:unavailable',// { fileId, chunkIndex }
  CHUNK_SEED:       'file:chunk:seed',       // { fileId, chunkIndex, data (base64) }
  CHUNK_SEED_ACK:   'file:chunk:seed:ack',   // { fileId, chunkIndex, accepted (bool) }
};
```

### 4.8 Distribution Health Indicator

Each file displays a distribution health icon:

| State | Icon | Tooltip Detail |
|-------|------|---------------|
| **Local only** | ⚠️ (amber) | "Only on this device — not yet distributed to other peers" |
| **Distributing** | 🔄 (blue spinner) | "Distributing: 4 of 12 chunks seeded" (progress hover) |
| **Distributed** | ✅ (green) | "Available from 3+ peers" |
| **Partially available** | 🟡 (yellow) | "Some chunks may be unavailable — 2 of 12 chunks on other peers" |

Hover on any icon shows a mini tooltip with: `X of Y chunks on Z peers`.

---

## 5. Workflows

### 5.1 File Upload

```
User                    Frontend              Sidecar/P2P           Peers
 │                         │                      │                   │
 │── Select file(s) ──────▶│                      │                   │
 │                         │── Validate size ────▶ │                   │
 │                         │◀─ OK ────────────────│                   │
 │                         │── Read as ArrayBuffer│                   │
 │                         │── SHA-256 full file  │                   │
 │                         │── Split into chunks  │                   │
 │                         │── SHA-256 each chunk │                   │
 │                         │── Encrypt each chunk─▶│                   │
 │                         │                      │── Store locally ──│
 │                         │── Create StorageFile  │                   │
 │                         │   record in Yjs ─────▶│── Sync metadata ─▶│
 │                         │── Update chunk       │                   │
 │                         │   availability ──────▶│── Sync avail ────▶│
 │◀─ Upload complete ─────│                      │                   │
 │   (progress: 100%)     │                      │── Begin seeding ─▶│
 │                         │                      │                   │
```

### 5.2 File Replace (Same Folder Collision)

```
1. User uploads file with same name in same folder
2. System detects collision
3. Dialog: "A file named 'X' already exists. Replace it?"
   [Replace] [Keep Both] [Cancel]
4. If Replace:
   a. Increment version on existing StorageFile
   b. Update chunkHashes, chunkCount, sizeBytes, fileHash
   c. Set replacedAt, replacedBy
   d. Old chunks are eventually garbage-collected
   e. Audit log: file_replaced
5. If Keep Both:
   a. Append " (1)" to filename
   b. Create new StorageFile record
```

### 5.3 File Deletion (Soft Delete)

```
1. User deletes a file (or admin deletes any file)
2. Set deletedAt = Date.now() on StorageFile
3. File moves to Trash view
4. Audit log: file_deleted
5. After 30 days (configurable): hard delete
   a. Remove StorageFile from Yjs
   b. Remove all ChunkAvailability entries
   c. Broadcast chunk cleanup message to peers
   d. Peers delete local chunks
   e. Audit log: file_permanently_deleted
```

### 5.4 File Restore

```
1. Admin or file owner opens Trash view
2. Clicks Restore on a deleted file
3. Set deletedAt = null
4. File reappears in original folder
5. Audit log: file_restored
```

### 5.5 Folder Operations

| Operation | Details |
|-----------|---------|
| Create | Name + optional color/icon. Nested up to 10 levels. |
| Rename | Updates folder name. File links are unaffected (reference by ID). |
| Move | Drag-and-drop or "Move to..." dialog. Updates `parentId`. |
| Delete | Soft-delete folder + all contents recursively. |
| Restore | Restores folder + all contents. |

### 5.6 Edge Cases

| Edge Case | Handling |
|-----------|---------|
| Upload while offline | Queue upload; persist chunks locally; sync metadata when reconnected |
| Download with no peers online | Show "File unavailable — no peers with this file are online" |
| Peer goes offline mid-download | Retry from remaining peers; resume from last received chunk |
| File replaced while another peer downloads | Complete download of current version; show "newer version available" |
| Storage quota exceeded (seeding) | Reject incoming seeded chunks; do not affect user's own uploads/downloads |
| Duplicate filename in different folders | Allowed — collisions only within same folder |
| Very large file (near 100 MB limit) | Show upload progress; chunk processing may take a few seconds |
| Browser/web upload | Same flow but chunks stored in IndexedDB; no filesystem sync |

---

## 6. UI/UX Design

### 6.1 Sidebar Integration

File Storage appears as a document type in the sidebar, created via the "New" button:

```
DOCUMENT_TYPES = [
  { type: 'text',      icon: '📄', label: 'Document',         ... },
  { type: 'sheet',     icon: '📊', label: 'Spreadsheet',      ... },
  { type: 'kanban',    icon: '📋', label: 'Kanban Board',     ... },
  { type: 'inventory', icon: '📦', label: 'Inventory System', ... },
  { type: 'files',     icon: '🗄️', label: 'File Storage',     description: 'Upload, share, and manage files across the workspace' },
]
```

**Constraint:** Only one `files` type document per workspace. If one already exists, the "File Storage" option in the "New" menu is greyed out with tooltip: "This workspace already has a File Storage."

### 6.2 App Layout (File Storage Open)

```
┌─────────────────────────────────────────────────────────────────────┐
│ HierarchicalSidebar │  File Storage                                │
│                     │ ┌───────────────────────────────────────────┐ │
│ [Workspace ▾]       │ │ TabBar: [Files] [Doc1] [Sheet1]          │ │
│ [Share][Join][+][📁] │ ├────────┬──────────────────────────────────┤ │
│                     │ │ NavRail│  Main Content Area               │ │
│ 📁 Files ◀━━━━━━━━━ │ │        │                                  │ │
│ 📁 Project          │ │ 📂 Browse│  Breadcrumbs: Root > Assets    │ │
│   📄 Notes          │ │ ⏱ Recent│  ┌─────┐ ┌─────┐ ┌─────┐      │ │
│ 📄 Design Doc       │ │ ⬇ Down- │  │ 📄  │ │ 🖼️  │ │ 📦  │      │ │
│ 📊 Budget           │ │   loads │  │logo │ │hero │ │arch │      │ │
│ 📦 Inventory        │ │ ⭐ Fav- │  │.pdf │ │.png │ │.zip │      │ │
│                     │ │  orites│  │2.1MB│ │4.7MB│ │12MB │      │ │
│                     │ │ 🗑️ Trash│  │✅   │ │⚠️   │ │🔄   │      │ │
│                     │ │ 📜 Audit│  └─────┘ └─────┘ └─────┘      │ │
│                     │ │ ⚙️ Set- │                                  │ │
│                     │ │  tings │ ┌──────────────────────────────┐ │ │
│ ⚙️ │ 🐦 │  ⟨       │ │        │ │ ▼ Downloads (1 active)      │ │ │
│                     │ │        │ │ report.pdf ████░░░░ 65%     │ │ │
│                     │ │        │ └──────────────────────────────┘ │ │
└─────────────────────┴─┴────────┴──────────────────────────────────┘ │
```

### 6.3 File Storage Dashboard Shell

Like the Inventory Dashboard, the File Storage uses a shell component that wraps the nav rail + content area:

```javascript
// Rendering in App.jsx — add to document type switch
activeDoc.type === 'files'
  ? <FileStorageDashboard
      fileStorageId={activeDoc.id}
      workspaceId={currentWorkspaceId}
      yStorageFiles={yStorageFiles}
      yStorageFolders={yStorageFolders}
      yChunkAvailability={yChunkAvailability}
      yFileAuditLog={yFileAuditLog}
      yFileStorageSystems={yFileStorageSystems}
      userIdentity={identity}
      collaborators={collaborators}
    />
  : // ... other types
```

### 6.4 Nav Rail

```
┌──────────┐
│ Files    │ ← System name (from FileStorageSystem.name)
├──────────┤
│ 📂 Browse │ ← Main file browser with integrated search
│ ⏱ Recent │ ← Recently uploaded/modified files
│ ⬇ Down-  │ ← Download history + active downloads
│   loads  │
│ ⭐ Favor- │ ← Starred/favorited files
│   ites   │
│ 🗑️ Trash  │ ← Soft-deleted files (30-day retention)
├──────────┤ ← Divider (admin-only section below)
│ 📜 Audit  │ ← File audit log (admin only)
│   Log    │
│ 📊 Storage│ ← Storage usage stats (admin only)
│ ⚙️ Set-   │ ← File storage settings (admin only)
│   tings  │
└──────────┘
```

**Role-based visibility:**

| Nav Item | Admin | Contributor | Reader |
|----------|-------|-------------|--------|
| Browse | ✅ | ✅ | ✅ |
| Recent | ✅ | ✅ | ✅ |
| Downloads | ✅ | ✅ | ✅ |
| Favorites | ✅ | ✅ | ✅ |
| Trash | ✅ | ✅ (own files only) | ❌ |
| Audit Log | ✅ | ❌ | ❌ |
| Storage | ✅ | ❌ | ❌ |
| Settings | ✅ | ❌ | ❌ |

### 6.5 File Card (Grid View)

```
┌────────────────────┐
│                    │
│    🔵 📄           │ ← Type-colored icon (blue = document)
│                    │
│  report-Q4.pdf     │ ← Filename (truncated with ellipsis if long)
│  2.1 MB · PDF      │ ← Size + extension
│  Alice · 2h ago    │ ← Uploader + relative date
│  ✅                 │ ← Distribution health icon
│  ⭐                 │ ← Favorite star (toggle)
└────────────────────┘
```

### 6.6 View Modes

The file browser supports multiple view modes, toggled via a control in the toolbar:

| Mode | Description | Layout |
|------|-------------|--------|
| **Grid** | Default. Cards in a responsive grid | `grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))` |
| **Table** | List with sortable columns: Name, Size, Type, Uploaded By, Date, Status | Standard table rows |
| **Compact** | Dense list, small icons, more files visible | Single-line rows with minimal metadata |

### 6.7 File Type Icons & Colors

Each `FileTypeCategory` has a designated color and representative icon set:

| Category | Color | Primary Icon | Hex |
|----------|-------|-------------|-----|
| document | 🔵 Blue | 📄 | `#4285F4` |
| spreadsheet | 🟢 Green | 📊 | `#34A853` |
| image | 🟣 Purple | 🖼️ | `#9C27B0` |
| video | 🔴 Red | 🎬 | `#EA4335` |
| audio | 🟠 Orange | 🎵 | `#FF9800` |
| archive | 🟡 Yellow | 📦 | `#FBBC05` |
| code | ⚫ Dark | 💻 | `#607D8B` |
| presentation | 🟤 Brown | 📽️ | `#795548` |
| design | 🩷 Pink | 🎨 | `#E91E63` |
| other | 🔘 Grey | 📎 | `#9E9E9E` |

Where possible, use format-specific icons (e.g., a PDF icon for `.pdf`, a Word icon for `.docx`). Fall back to the category icon for less common formats.

### 6.8 Responsive Breakpoints

| Viewport | Behavior |
|----------|----------|
| Desktop (>1200px) | Full two-panel layout: nav rail + content. Grid view default. |
| Tablet (768–1200px) | Collapsible nav rail. Grid adapts to fewer columns. |
| Mobile (<768px) | Bottom tab navigation. Compact view default. Downloads pane slides up from bottom. |

---

## 7. File Browser Views

### 7.1 Browse View (Main)

The primary view — a Google Drive-style single-page file browsing experience.

```
┌──────────────────────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────┐  [Grid][Table][Compact]│
│  │ 🔍 Search files and folders...       │  [+ Upload] [📁 New]  │
│  └──────────────────────────────────────┘                        │
│                                                                  │
│  Root > Project Assets > Logos                    3 items · 8 MB │
│                                                                  │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                         │
│  │ 📁      │  │ 🟣 🖼️   │  │ 🟣 🖼️   │                         │
│  │ Brand   │  │ logo    │  │ hero    │                         │
│  │         │  │ .svg    │  │ .png    │                         │
│  │ 5 items │  │ 12 KB   │  │ 4.7 MB  │                         │
│  └─────────┘  │ Alice   │  │ Bob     │                         │
│               │ ✅ ⭐    │  │ ⚠️      │                         │
│               └─────────┘  └─────────┘                         │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ ▼ Downloads (2)                                        ✕    ││
│  │ report.pdf     ████████████░░ 80%    4.2 MB              ││
│  │ archive.zip    Complete ✓  [Open] [📂 Show in folder]    ││
│  └──────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

**Toolbar features:**
- **Search bar** with autocomplete (see §10)
- **View mode toggle** (Grid / Table / Compact)
- **Upload button** (opens file picker; multi-select enabled)
- **New Folder button**
- Drag-and-drop zone (entire content area is a drop target)

**Breadcrumb navigation:**
- Clickable breadcrumb trail: `Root > Folder > Subfolder`
- Each segment is clickable to navigate up
- Current folder name is bold/non-linked

**Folder behavior:**
- Click folder card → drill in (navigate into folder)
- Right-click → context menu: Rename, Move, Delete, Properties

**File behavior:**
- Click file card → open detail panel (sidebar slide-out or modal)
- Right-click → context menu: Download, Rename, Move, Delete, Copy Link, Tags, Properties
- Drag file → move to folder (drop target highlights)

### 7.2 Recent View

Shows files sorted by `createdAt` or `updatedAt` descending. No folder hierarchy — flat list of recent files across all folders.

| Column | Content |
|--------|---------|
| File | Icon + name |
| Location | Folder path breadcrumb |
| Size | Human-readable |
| Modified | Relative date |
| Uploaded By | Display name |

### 7.3 Favorites View

Shows files where `favoritedBy` includes the current user's public key. Same layout as Recent — flat list, sortable.

### 7.4 Trash View

Shows files/folders where `deletedAt` is not null. Displays:
- File name + type icon (greyed out)
- Date deleted (relative)
- Days remaining before permanent deletion
- **Restore** button
- **Delete Forever** button (admin only)

Admin sees all trashed files. Contributors see only their own trashed files.

### 7.5 Audit Log View (Admin Only)

Table of `FileAuditEntry` records, similar to the inventory audit log:

| Column | Content |
|--------|---------|
| Timestamp | Relative + absolute |
| Actor | Display name |
| Action | Human-readable (e.g., "Uploaded report.pdf") |
| Target | File/folder name |
| Details | Metadata (size, old name, etc.) |

Supports date range filtering and action type filtering.

### 7.6 Storage View (Admin Only)

Dashboard showing workspace storage usage:

```
┌────────────────────────────────────────────────────────┐
│  Storage Usage                                         │
│                                                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │  247 MB  │  │  156     │  │  12      │            │
│  │  used    │  │  files   │  │  folders │            │
│  └──────────┘  └──────────┘  └──────────┘            │
│                                                        │
│  By Type:                                              │
│  ████████████████░░░░  Documents  120 MB (49%)        │
│  ████████░░░░░░░░░░░░  Images      65 MB (26%)        │
│  ████░░░░░░░░░░░░░░░░  Archives    35 MB (14%)        │
│  ██░░░░░░░░░░░░░░░░░░  Other       27 MB (11%)        │
│                                                        │
│  Peer Distribution:                                    │
│  5 of 8 peers seeding · Avg redundancy: 2.8 copies    │
│                                                        │
│  Trash: 3 files · 12 MB · Auto-delete in 18 days      │
└────────────────────────────────────────────────────────┘
```

---

## 8. File Linking & Embedding

### 8.1 Overview

Files can be referenced from documents (TipTap), spreadsheets (Fortune Sheet), and kanban cards. Links are stored by file ID so they auto-update when files are renamed.

### 8.2 File Picker Modal

A shared modal component used across all document types for inserting file links:

```
┌────────────────────────────────────────────────────────┐
│  Insert File Link                              ✕      │
│                                                        │
│  ┌─────────────────────────────────────────────────┐  │
│  │ 🔍 Search files...                              │  │
│  └─────────────────────────────────────────────────┘  │
│                                                        │
│  Recent Files                                          │
│  ┌──────────────────────────────────────────────────┐ │
│  │ 📄 report-Q4.pdf         2.1 MB    2h ago       │ │
│  │ 🖼️ hero-image.png        4.7 MB    yesterday    │ │
│  │ 📦 project-archive.zip   12 MB     3 days ago   │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  [📂 Browse All Files...]                              │
│                                                        │
│                                        [Cancel] [Insert]│
└────────────────────────────────────────────────────────┘
```

**Initial state:** Simplified view with search + recent files.  
**"Browse All Files" button:** Expands modal to full-size file browser with folder tree + file grid.

### 8.3 Document Links (TipTap)

**Insertion methods:**
1. **Slash command:** Type `/file` → shows file picker modal
2. **Toolbar button:** File attachment icon (📎) in the editor toolbar → opens file picker modal

**Rendered as:** Inline chip/pill:

```
┌─────────────────────────────────┐
│ 🔵 📄 report-Q4.pdf  2.1 MB  ⬇ │
└─────────────────────────────────┘
```

- Type-colored background tint
- File icon + name + size
- Download icon (⬇) on the right
- Click → downloads the file
- Hover → tooltip: "Click to download · Uploaded by Alice · Feb 14, 2026"

**TipTap extension:** Custom `FileLink` node extension:

```javascript
// FileLink node schema
{
  name: 'fileLink',
  group: 'inline',
  inline: true,
  atom: true,  // non-editable inline block
  attrs: {
    fileId: { default: null },    // StorageFile ID — the stable reference
    fileName: { default: '' },    // Denormalized for display (auto-updated)
    fileSize: { default: 0 },     // Denormalized for display
    fileExtension: { default: '' },
    typeCategory: { default: 'other' },
  },
}
```

**Auto-update behavior:** When a StorageFile is renamed in Yjs, a Yjs observer iterates open documents and updates `fileName` attributes in any `fileLink` nodes referencing that file ID.

**Broken link rendering:** When a file is deleted (soft or hard) but still referenced:

```
┌────────────────────────────────────────┐
│ 🔴 ̶r̶e̶p̶o̶r̶t̶-̶Q̶4̶.̶p̶d̶f̶  File not found  │
└────────────────────────────────────────┘
```

Red-tinted, strikethrough filename, "File not found" label. Click does nothing.

### 8.4 Spreadsheet Links (Fortune Sheet)

**Insertion:** Same file picker modal, triggered via:
- Toolbar button (📎)
- Slash command is not available in spreadsheet cells

**Rendered as:** Hyperlink in cell — blue underlined text showing filename. The cell value stores:

```javascript
// Cell value structure for file links
{
  v: fileName,              // Display value (auto-updated on rename)
  ct: { t: 'inlineStr' },   // Cell type
  fc: '#4285F4',             // Blue font color
  un: 1,                     // Underline
  // Custom metadata stored in Fortune Sheet cell comment/note
  ps: {
    fileId: 'file-x1y2z3',
    fileLink: true,
  }
}
```

Click on the cell → downloads the file (intercepted by click handler checking `ps.fileLink`).

### 8.5 Kanban Card Links

**Insertion methods:**
1. **Attachment button** on the card detail view → opens file picker modal
2. **Inline in description text** — same `/file` slash command as documents

**Rendered as:**
- **Card face:** Attachment list at bottom of card:
  ```
  ┌─────────────────────────────┐
  │  Fix login page             │
  │  Due: Feb 20                │
  │                             │
  │  📎 2 attachments           │
  │  📄 spec.pdf   🖼️ mock.png  │
  └─────────────────────────────┘
  ```
- **Card detail view:** Full file chips (like document chips) with download buttons
- **Description text:** Same inline chip rendering as TipTap documents

---

## 9. Downloads System

### 9.1 Downloads Bar

A collapsible panel pinned to the bottom of the File Storage content area (like Chrome's downloads bar):

```
┌──────────────────────────────────────────────────────────────────┐
│ ▼ Downloads (2 active, 1 complete)                         ✕   │
├──────────────────────────────────────────────────────────────────┤
│ 📄 report.pdf       ████████████░░░░░░ 75%  3.2/4.2 MB   [✕]  │
│ 📦 archive.zip      ██░░░░░░░░░░░░░░░░ 12%  1.4/12 MB    [✕]  │
│ 🖼️ logo.png         Complete ✓         12 KB              │
│                      [Open File] [📂 Show in Folder]        │
└──────────────────────────────────────────────────────────────────┘
```

**Behaviors:**
- Auto-shows when a download starts
- Collapsible (▼/▲ toggle)
- Dismissible (✕ button on the bar)
- Individual downloads can be cancelled (✕ per item)
- Completed downloads show:
  - **"Open File"** — opens the file with the system default application
  - **"Show in Folder"** — opens the OS file manager to the download location
- Failed downloads show error message + "Retry" button

### 9.2 Downloads Nav Rail View

Full history view accessible from the nav rail. Shows all past downloads for the workspace:

| Column | Content |
|--------|---------|
| File | Icon + name |
| Size | Human-readable |
| Downloaded | Relative date |
| Status | Complete / Failed / Cancelled |
| Actions | Open / Show in Folder / Re-download / Clear |

**Features:**
- Clear individual entries or clear all
- Re-download if file was deleted locally
- Sort by date, name, or size

### 9.3 Auto-Save Location

**Electron:** Files save to the OS default downloads folder: `{userHome}/Downloads/Nightjar/{workspaceName}/`  
**Web:** Browser-native download behavior (Save As dialog managed by browser).

---

## 10. Search System

### 10.1 Search Bar

Integrated into the Browse view toolbar. Provides autocomplete/autofill as the user types:

```
┌─────────────────────────────────────────────────────────┐
│ 🔍 report                                         ✕   │
├─────────────────────────────────────────────────────────┤
│ Files                                                   │
│   📄 report-Q4.pdf          /Project Assets    2.1 MB  │
│   📄 report-Q3-final.docx   /Archive           1.8 MB  │
│                                                         │
│ Tags                                                    │
│   🏷️ "quarterly-report" (3 files)                       │
│                                                         │
│ Folders                                                 │
│   📁 Reports                 /Project Assets            │
└─────────────────────────────────────────────────────────┘
```

### 10.2 Search Scope

Search queries match against ALL metadata fields:

| Field | Match Type |
|-------|-----------|
| File name | Substring, case-insensitive |
| Extension | Exact match (e.g., "pdf") |
| Tags | Substring on any tag |
| Description | Substring, case-insensitive |
| Uploader name | Substring, case-insensitive |
| Folder name | Substring, case-insensitive |
| File type category | Exact (e.g., "image", "document") |

### 10.3 Search Filters

Advanced filters available via filter chips or a filter dropdown:

| Filter | Options |
|--------|---------|
| Type | Document, Spreadsheet, Image, Video, Audio, Archive, Code, Other |
| Uploaded by | Dropdown of workspace members |
| Date range | Last 24h, Last 7 days, Last 30 days, Custom range |
| Size range | < 1MB, 1–10MB, 10–50MB, > 50MB |
| Distribution | Local only, Distributed, All |

### 10.4 Implementation

Search is performed client-side on the Yjs-synced `storageFiles` array. No server-side search needed. For large workspaces (10,000+ files), debounce search input (300ms) and limit autocomplete results to 10 items.

---

## 11. Security & Encryption

### 11.1 Encryption Scheme

Files use the **workspace encryption key** (not per-folder or per-file derived keys). This is simpler and sufficient because:

1. File content is already binary (not structured data where field-level encryption matters)
2. The workspace key is already shared with all workspace members
3. Per-chunk encryption with the workspace key provides adequate isolation

```javascript
// File chunk encryption
const encryptedChunk = nacl.secretbox(chunkData, randomNonce, workspaceKey);
// Stored as: [24-byte nonce][ciphertext]
```

### 11.2 Access Control

| Action | Owner (Admin) | Editor (Contributor) | Viewer (Reader) |
|--------|--------------|---------------------|-----------------|
| Upload file | ✅ | ✅ | ❌ |
| Download file | ✅ | ✅ | ✅ |
| Create folder | ✅ | ✅ | ❌ |
| Rename own files | ✅ | ✅ | ❌ |
| Rename any file | ✅ | ❌ | ❌ |
| Move own files | ✅ | ✅ | ❌ |
| Move any file | ✅ | ❌ | ❌ |
| Delete own files | ✅ | ✅ | ❌ |
| Delete any file | ✅ | ❌ | ❌ |
| Restore from trash | ✅ | ✅ (own only) | ❌ |
| Permanently delete | ✅ | ❌ | ❌ |
| Edit tags | ✅ | ✅ | ❌ |
| Edit description | ✅ | ✅ | ❌ |
| Favorite/star | ✅ | ✅ | ✅ |
| View audit log | ✅ | ❌ | ❌ |
| Change settings | ✅ | ❌ | ❌ |
| View storage stats | ✅ | ❌ | ❌ |

### 11.3 Integrity Verification

Every chunk and file has a SHA-256 hash stored in the Yjs metadata. On download:

1. Each received chunk is verified against its stored hash (`chunkHashes[i]`)
2. The reassembled file is verified against the stored `fileHash`
3. If verification fails → reject chunk/file, retry from another peer
4. Tampered chunks are logged and the peer is flagged

> **⚠️ Security:** Hash verification MUST happen after decryption. The hashes in Yjs are hashes of the **plaintext** chunks, not the ciphertext. This prevents an attacker from swapping encrypted chunks between files.

---

## 12. Notifications

File storage actions generate workspace notifications using the existing notification infrastructure:

| Event | Recipients | Message |
|-------|-----------|---------|
| File uploaded | All workspace members | "Alice uploaded report.pdf to /Project Assets" |
| Files bulk uploaded | All workspace members | "Alice uploaded 5 files to /Project Assets" |
| File deleted | Admins | "Bob deleted report.pdf" |
| File restored | File owner + admins | "Admin restored report.pdf from trash" |
| Trash auto-cleanup | Admins | "3 files permanently deleted (30-day retention)" |
| Storage quota warning | Admins | "Workspace storage at 90% capacity" |

---

## 13. Settings & Admin

### 13.1 File Storage Settings (Admin Only)

```
┌────────────────────────────────────────────────────────┐
│  File Storage Settings                                 │
├────────────────────────────────────────────────────────┤
│                                                        │
│  General                                               │
│  ┌────────────────────────────────────────────────┐   │
│  │ Storage Name    [Files                       ] │   │
│  │ Max File Size   [100 MB ▾]                     │   │
│  │                 TODO: Expand limit in future    │   │
│  └────────────────────────────────────────────────┘   │
│                                                        │
│  Trash                                                 │
│  ┌────────────────────────────────────────────────┐   │
│  │ Auto-delete period  [30 days ▾]                │   │
│  │ [Empty Trash Now]   3 items · 12 MB            │   │
│  └────────────────────────────────────────────────┘   │
│                                                        │
│  Distribution                                          │
│  ┌────────────────────────────────────────────────┐   │
│  │ Chunk redundancy target  [3 peers ▾]           │   │
│  │ Higher = more available, uses more bandwidth   │   │
│  └────────────────────────────────────────────────┘   │
│                                                        │
│  Danger Zone                                           │
│  ┌────────────────────────────────────────────────┐   │
│  │ [Delete All Files]  Permanently remove all     │   │
│  │                     files and folders           │   │
│  └────────────────────────────────────────────────┘   │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### 13.2 Per-Peer Chunk Storage Quota (App Settings)

Added to the existing App Settings modal (not the file storage settings):

```
Peer Storage
┌────────────────────────────────────────────────────────┐
│ Chunk storage quota   [Unlimited ▾]                    │
│                                                        │
│ Options: 100 MB, 250 MB, 500 MB, 1 GB, 5 GB, Unlimited│
│                                                        │
│ Controls how much disk space you donate for            │
│ distributing other people's files in workspaces        │
│ you belong to. Your own uploads and downloads          │
│ are never limited.                                     │
│                                                        │
│ Current usage: 342 MB across 3 workspaces              │
│ TODO: Per-workspace quota control                      │
└────────────────────────────────────────────────────────┘
```

**localStorage key:** `nightjar-settings` — add `chunkStorageQuota` field (bytes, default `Infinity`).

---

## 14. Technology Choices

### 14.1 Dependencies

| Dependency | Purpose | Notes |
|-----------|---------|-------|
| `tweetnacl` | XSalsa20-Poly1305 chunk encryption | Already in project |
| `hash-wasm` | SHA-256 for chunk/file hashing | Already in project (used for Argon2id) |
| None new | — | Feature uses existing P2P, Yjs, and crypto infrastructure |

### 14.2 Storage Technologies

| Platform | Metadata | Chunks | Downloads History |
|----------|----------|--------|-------------------|
| Electron | Yjs (workspace-meta) | LevelDB (local) | localStorage |
| Web | Yjs (workspace-meta) | IndexedDB | localStorage |

### 14.3 Offline Support

| Scenario | Behavior |
|----------|----------|
| Upload while offline | Chunks stored locally; metadata queued; syncs on reconnect |
| Download while offline | Only available if chunks are already cached locally |
| Browse while offline | Full folder/file list available (Yjs metadata synced) |
| Search while offline | Fully functional (client-side on Yjs data) |

---

## 15. Engineering Implementation Plan

### 15.1 Phase Overview

```
Phase 1: Foundation (Data Model + Entity Type + Nav Shell)
  │
Phase 2: Upload & Storage (Chunking + Encryption + Local Persistence)
  │
Phase 3: Download & P2P Transfer (Chunk Protocol + Reassembly + Downloads Pane)
  │
Phase 4: File Browser UI (Browse + Grid/Table/Compact + Search + Folders)
  │
Phase 5: Distribution & Seeding (Proactive Seeding + Availability + Quotas)
  │
Phase 6: File Linking (TipTap Extension + Spreadsheet + Kanban + File Picker Modal)
  │
Phase 7: Admin & Polish (Audit Log + Storage Stats + Settings + Trash + Notifications)
  │
Phase 8: Web Support & Testing (IndexedDB Chunks + E2E Tests + Edge Cases)
```

---

### 15.2 Phase 1: Foundation

**Goal:** Register `files` document type, create shell components, add Yjs shared types.

#### Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/components/files/FileStorageDashboard.jsx` | Shell component (nav rail + content router) |
| `frontend/src/components/files/FileStorageDashboard.css` | Dashboard styles |
| `frontend/src/components/files/FileStorageNavRail.jsx` | Nav rail with role-based items |
| `frontend/src/components/files/FileStorageNavRail.css` | Nav rail styles |
| `frontend/src/contexts/FileStorageContext.jsx` | Context provider for file storage data |
| `frontend/src/hooks/useFileStorageSync.js` | Yjs observation hook for file storage types |
| `frontend/src/utils/fileStorageValidation.js` | Validation utilities (file size, names, etc.) |

#### Files to Modify

| File | Change |
|------|--------|
| `frontend/src/components/HierarchicalSidebar.jsx` | Add `'files'` to `DOCUMENT_TYPES`; grey out if one exists |
| `frontend/src/components/CreateDocumentDialog.jsx` | Add `'files'` type with description |
| `frontend/src/components/App.jsx` | Add `files` case to document type rendering switch |
| `frontend/src/hooks/useWorkspaceSync.js` | Add Yjs type declarations for file storage |

#### Yjs Type Declarations

```javascript
// In useWorkspaceSync.js, add to existing workspace-level ydoc
const yFileStorageSystems = ydoc.getMap('fileStorageSystems');
const yStorageFiles = ydoc.getArray('storageFiles');
const yStorageFolders = ydoc.getArray('storageFolders');
const yChunkAvailability = ydoc.getMap('chunkAvailability');
const yFileAuditLog = ydoc.getArray('fileAuditLog');
```

> **Note:** Like inventory, file storage lives in the **workspace-meta** Y.Doc. File Storage documents do NOT get their own Y.Doc/WebSocket — they use workspace-level shared types.

#### Acceptance Criteria

- [ ] "File Storage" appears in the "New" document type picker with 🗄️ icon
- [ ] Creating a File Storage adds it to the sidebar
- [ ] Creating a second File Storage is prevented (option greyed out with tooltip)
- [ ] Clicking the File Storage in sidebar opens the dashboard shell with nav rail
- [ ] Nav rail shows role-appropriate items (admin sees all; viewer sees browse/recent/downloads/favorites only)
- [ ] File Storage data syncs via Yjs to other workspace members
- [ ] Yjs shared types are declared and accessible from the context

---

### 15.3 Phase 2: Upload & Storage

**Goal:** Implement file upload with chunking, encryption, and local storage.

#### Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/utils/fileChunker.js` | Split file into 1MB chunks, compute SHA-256 hashes |
| `frontend/src/utils/fileEncryption.js` | Encrypt/decrypt chunks with workspace key |
| `frontend/src/utils/fileTypeCategories.js` | Map extensions → FileTypeCategory + colors + icons |
| `frontend/src/components/files/upload/UploadZone.jsx` | Drag-and-drop + click-to-upload component |
| `frontend/src/components/files/upload/UploadZone.css` | Upload zone styles |
| `frontend/src/components/files/upload/UploadProgress.jsx` | Multi-file upload progress indicator |
| `frontend/src/components/files/upload/UploadProgress.css` | Upload progress styles |
| `sidecar/chunkStorage.js` | LevelDB chunk storage (Electron) |

#### Files to Modify

| File | Change |
|------|--------|
| `sidecar/index.js` | Register chunk storage IPC channels |
| `frontend/src/components/files/FileStorageDashboard.jsx` | Wire upload into browse view |

#### Key Implementation: File Chunker

```javascript
// fileChunker.js
const CHUNK_SIZE = 1024 * 1024; // 1 MB

export async function chunkFile(file) {
  const buffer = await file.arrayBuffer();
  const fileHash = await sha256(new Uint8Array(buffer));
  const chunks = [];
  const chunkHashes = [];
  
  for (let offset = 0; offset < buffer.byteLength; offset += CHUNK_SIZE) {
    const chunk = new Uint8Array(buffer.slice(offset, offset + CHUNK_SIZE));
    const hash = await sha256(chunk);
    chunks.push(chunk);
    chunkHashes.push(hash);
  }
  
  return { chunks, chunkHashes, fileHash, chunkCount: chunks.length };
}
```

#### Acceptance Criteria

- [ ] User can upload a file via drag-and-drop onto the browse area
- [ ] User can upload a file via the Upload button (file picker dialog)
- [ ] Multi-file upload is supported with individual progress bars
- [ ] Files are split into 1 MB chunks with SHA-256 verification
- [ ] Each chunk is encrypted with the workspace key
- [ ] Encrypted chunks are stored locally (LevelDB in Electron)
- [ ] A StorageFile record is created in Yjs with all metadata
- [ ] ChunkAvailability is updated to show self as holder
- [ ] Files > 100 MB are rejected with an error toast
- [ ] Upload collision in same folder triggers Replace/Keep Both/Cancel dialog
- [ ] Audit log entry is created for each upload

---

### 15.4 Phase 3: Download & P2P Transfer

**Goal:** Implement file download via P2P chunk requests, downloads pane, and auto-save.

#### Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/utils/fileDownloader.js` | Request chunks from peers, reassemble, verify |
| `frontend/src/utils/downloadManager.js` | Manage concurrent downloads, retry logic, state |
| `frontend/src/components/files/downloads/DownloadsBar.jsx` | Bottom downloads bar (Chrome-style) |
| `frontend/src/components/files/downloads/DownloadsBar.css` | Downloads bar styles |
| `frontend/src/components/files/downloads/DownloadsView.jsx` | Full downloads history (nav rail view) |
| `frontend/src/components/files/downloads/DownloadsView.css` | Downloads view styles |

#### Files to Modify

| File | Change |
|------|--------|
| `sidecar/mesh.js` | Add FILE_MESSAGE_TYPES handling |
| `sidecar/mesh-constants.js` | Add file-related message type constants |
| `sidecar/p2p.js` | Handle chunk request/response messages |

#### Key Implementation: P2P Chunk Transfer

```javascript
// New message types in mesh-constants.js
export const FILE_MSG = {
  CHUNK_REQUEST:     'file:chunk:request',
  CHUNK_RESPONSE:    'file:chunk:response',
  CHUNK_UNAVAILABLE: 'file:chunk:unavailable',
  CHUNK_SEED:        'file:chunk:seed',
  CHUNK_SEED_ACK:    'file:chunk:seed:ack',
};
```

#### Acceptance Criteria

- [ ] User can download a file by clicking the download button on a file card
- [ ] Download requests chunks from peers listed in ChunkAvailability
- [ ] Each received chunk is verified against its SHA-256 hash
- [ ] Reassembled file is verified against the full file hash
- [ ] File auto-saves to `{Downloads}/Nightjar/{workspaceName}/`
- [ ] Downloads bar appears at bottom showing progress
- [ ] Completed downloads show "Open File" and "Show in Folder" buttons
- [ ] Failed downloads show error + "Retry" button
- [ ] Downloads can be cancelled mid-transfer
- [ ] Downloads nav rail view shows full history
- [ ] Peer going offline mid-download retries from remaining peers
- [ ] "File unavailable" message when no peers have the chunks

---

### 15.5 Phase 4: File Browser UI

**Goal:** Build the full Google Drive-style file browser with views, folders, and search.

#### Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/components/files/browse/BrowseView.jsx` | Main browse view container |
| `frontend/src/components/files/browse/BrowseView.css` | Browse view styles |
| `frontend/src/components/files/browse/FileCard.jsx` | Grid view file card component |
| `frontend/src/components/files/browse/FileCard.css` | File card styles |
| `frontend/src/components/files/browse/FileTableRow.jsx` | Table view row component |
| `frontend/src/components/files/browse/FolderCard.jsx` | Folder card component |
| `frontend/src/components/files/browse/Breadcrumbs.jsx` | Breadcrumb navigation |
| `frontend/src/components/files/browse/Breadcrumbs.css` | Breadcrumb styles |
| `frontend/src/components/files/browse/ViewModeToggle.jsx` | Grid/Table/Compact toggle |
| `frontend/src/components/files/browse/FileContextMenu.jsx` | Right-click context menu |
| `frontend/src/components/files/browse/FolderCreateDialog.jsx` | New folder dialog |
| `frontend/src/components/files/browse/FileMoveDialog.jsx` | Move file/folder dialog |
| `frontend/src/components/files/browse/FileDetailPanel.jsx` | File detail sidebar/panel |
| `frontend/src/components/files/browse/FileDetailPanel.css` | File detail panel styles |
| `frontend/src/components/files/browse/SearchBar.jsx` | Search with autocomplete |
| `frontend/src/components/files/browse/SearchBar.css` | Search bar styles |
| `frontend/src/components/files/browse/SearchFilters.jsx` | Advanced filter chips |
| `frontend/src/components/files/common/DistributionBadge.jsx` | Distribution health icon |
| `frontend/src/components/files/common/FileTypeIcon.jsx` | Type-colored file icon |
| `frontend/src/components/files/recent/RecentView.jsx` | Recent files view |
| `frontend/src/components/files/favorites/FavoritesView.jsx` | Favorites view |
| `frontend/src/components/files/trash/TrashView.jsx` | Trash view |
| `frontend/src/components/files/trash/TrashView.css` | Trash view styles |

#### Acceptance Criteria

- [ ] Browse view shows files and folders in the current directory
- [ ] Grid view shows file cards with icon, name, size, uploader, date, distribution status
- [ ] Table view shows sortable columns (name, size, type, uploader, date)
- [ ] Compact view shows dense single-line rows
- [ ] View mode toggle persists per user
- [ ] Breadcrumb navigation shows current path and is clickable
- [ ] Clicking a folder drills in; clicking breadcrumb goes up
- [ ] Drag-and-drop files onto folders to move them
- [ ] Right-click context menu with Download, Rename, Move, Delete, Tags, Properties
- [ ] Search bar with autocomplete across all metadata fields
- [ ] Advanced filters (type, uploader, date, size, distribution)
- [ ] Favorites (star toggle on file cards)
- [ ] Recent view shows flat list sorted by date
- [ ] Favorites view shows starred files
- [ ] Trash view shows deleted files with restore and permanent delete
- [ ] Multi-select with checkbox for bulk actions (move, delete, download)
- [ ] File detail panel shows all metadata, tags, description, edit controls

---

### 15.6 Phase 5: Distribution & Seeding

**Goal:** Implement proactive chunk seeding, distribution health tracking, and quota enforcement.

#### Files to Create

| File | Purpose |
|------|---------|
| `sidecar/chunkSeeder.js` | Proactive seeding daemon (runs every 60s) |
| `frontend/src/utils/distributionHealth.js` | Compute distribution status per file |

#### Files to Modify

| File | Change |
|------|--------|
| `sidecar/index.js` | Start seeding daemon on workspace connect |
| `frontend/src/components/AppSettings.jsx` | Add chunk storage quota setting |
| `sidecar/chunkStorage.js` | Add quota tracking and enforcement |

#### Acceptance Criteria

- [ ] Chunks are proactively seeded to online peers in the background
- [ ] Seeding prioritizes files with fewer than REDUNDANCY_TARGET holders
- [ ] Seeding respects peer storage quotas
- [ ] Distribution health icon shows correct state (local only / distributing / distributed)
- [ ] Hover on distribution icon shows "X of Y chunks on Z peers"
- [ ] Chunk storage quota setting appears in App Settings
- [ ] Quota enforcement prevents accepting seeded chunks beyond limit
- [ ] Quota does not affect own uploads or downloads

---

### 15.7 Phase 6: File Linking

**Goal:** Add file link insertion across documents, spreadsheets, and kanban boards.

#### Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/components/files/picker/FilePickerModal.jsx` | Shared file picker modal |
| `frontend/src/components/files/picker/FilePickerModal.css` | Picker modal styles |
| `frontend/src/components/files/picker/FilePickerFull.jsx` | Expanded full browser in modal |
| `frontend/src/extensions/FileLink.js` | TipTap FileLink node extension |
| `frontend/src/extensions/FileLink.css` | FileLink chip styles |
| `frontend/src/utils/fileLinkResolver.js` | Resolve fileId → current file metadata |

#### Files to Modify

| File | Change |
|------|--------|
| `frontend/src/components/TipTapEditor.jsx` | Register FileLink extension, add toolbar button, add `/file` slash command |
| `frontend/src/components/SpreadsheetEditor.jsx` | Add file link toolbar button, handle click-to-download on file link cells |
| `frontend/src/components/KanbanBoard.jsx` | Add attachment button to card detail, render attachment list on cards |

#### Acceptance Criteria

- [ ] `/file` slash command in TipTap opens file picker modal
- [ ] Toolbar 📎 button in TipTap opens file picker modal
- [ ] File picker shows search + recent files (simplified view)
- [ ] "Browse All Files" button expands to full file browser modal
- [ ] Selecting a file inserts an inline chip in TipTap (colored, with icon + name + size)
- [ ] Clicking a file chip triggers download
- [ ] File chips auto-update filename when file is renamed in Yjs
- [ ] Deleted file links render as red strikethrough "File not found"
- [ ] Toolbar 📎 button in spreadsheet opens file picker
- [ ] Selecting a file inserts a blue hyperlink cell value
- [ ] Clicking the hyperlink cell triggers download
- [ ] Kanban card detail view has an "Attach File" button
- [ ] Attached files appear as chips at bottom of kanban card face
- [ ] `/file` works in kanban card description text

---

### 15.8 Phase 7: Admin & Polish

**Goal:** Build admin-only views, audit log, storage stats, notifications, and trash management.

#### Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/components/files/admin/AuditLogView.jsx` | File audit log table |
| `frontend/src/components/files/admin/AuditLogView.css` | Audit log styles |
| `frontend/src/components/files/admin/StorageView.jsx` | Storage usage dashboard |
| `frontend/src/components/files/admin/StorageView.css` | Storage view styles |
| `frontend/src/components/files/admin/FileStorageSettings.jsx` | Settings panel |
| `frontend/src/components/files/admin/FileStorageSettings.css` | Settings styles |
| `frontend/src/utils/fileNotifications.js` | File event notification helpers |
| `frontend/src/utils/fileAuditLog.js` | Audit log helpers (push entry, format, filter) |

#### Acceptance Criteria

- [ ] Admin sees Audit Log, Storage, and Settings in nav rail
- [ ] Audit log shows filterable history of all file actions
- [ ] Storage view shows usage breakdown by type, peer distribution stats
- [ ] Settings allows configuring storage name, max file size, auto-delete period, redundancy target
- [ ] Trash auto-deletes files after configured retention period (default 30 days)
- [ ] "Empty Trash" button permanently deletes all trashed files
- [ ] Notifications fire for upload, delete, restore, storage warnings
- [ ] Non-admins do not see admin nav items

---

### 15.9 Phase 8: Web Support & Testing

**Goal:** IndexedDB chunk storage for web mode, comprehensive testing, edge case handling.

#### Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/utils/chunkStorageWeb.js` | IndexedDB-based chunk storage for web |
| `tests/file-storage/file-chunker.test.js` | Chunking + hashing tests |
| `tests/file-storage/file-encryption.test.js` | Chunk encryption/decryption tests |
| `tests/file-storage/file-download.test.js` | Download + reassembly tests |
| `tests/file-storage/file-validation.test.js` | Validation utility tests |
| `tests/file-storage/distribution-health.test.js` | Distribution health computation tests |
| `tests/file-storage/file-type-categories.test.js` | Extension → category mapping tests |
| `tests/components/files/browse-view.test.jsx` | Browse view component tests |
| `tests/components/files/file-card.test.jsx` | File card rendering tests |
| `tests/components/files/upload-zone.test.jsx` | Upload zone component tests |
| `tests/components/files/downloads-bar.test.jsx` | Downloads bar component tests |
| `tests/components/files/file-picker-modal.test.jsx` | File picker modal tests |
| `tests/hooks/useFileStorageSync.test.js` | Yjs sync hook tests |

#### Acceptance Criteria

- [ ] Web mode: chunks stored in IndexedDB
- [ ] Web mode: upload works and chunks are sent to connected peers
- [ ] Web mode: download works by requesting chunks from peers
- [ ] Web mode: file browser, search, and metadata fully functional
- [ ] All unit tests pass
- [ ] Component tests cover all view modes, roles, and edge cases
- [ ] Offline browsing works (metadata available from Yjs cache)
- [ ] Peer disconnect during download is handled gracefully
- [ ] Files at the 100 MB boundary upload and download correctly
- [ ] 10,000-file workspace search remains responsive (<300ms)

---

## 16. Future Considerations

### 16.1 File Previews

**Status:** TODO  
Render previews for images, PDFs, text files, and code files directly in the file detail panel. Requires:
- Image: `<img>` tag with blob URL from decrypted chunk
- PDF: pdf.js or similar
- Text/Code: Syntax-highlighted text view
- Video/Audio: Native `<video>` / `<audio>` elements

### 16.2 File Size Expansion

**Status:** TODO  
Increase the 100 MB max to 500 MB or 1 GB. Requires:
- Streaming encryption (don't hold entire file in memory)
- Parallel chunk downloads from multiple peers
- Resume support for interrupted large downloads
- Progress estimation improvements

### 16.3 Per-Workspace Chunk Quota

**Status:** TODO  
Allow users to set different chunk storage quotas per workspace instead of a global setting. Requires:
- Per-workspace quota tracking in settings
- UI to configure per workspace in App Settings

### 16.4 Version History

**Status:** TODO  
Track full version history for replaced files. Requires:
- `versions` array on StorageFile with previous chunk hashes
- UI to browse and restore previous versions
- Storage implications (old chunks kept until version pruned)

### 16.5 File Comments / Annotations

**Status:** TODO  
Allow users to comment on files (like Google Drive comments). Requires:
- New Yjs shared type for file comments
- Comment thread UI in file detail panel

### 16.6 Image / Media Gallery View

**Status:** TODO  
Dedicated view for browsing images and media with thumbnails. Requires:
- Thumbnail generation (resize on upload)
- Gallery layout with lightbox viewer

### 16.7 Selective Folder Sync

**Status:** TODO  
Allow users to choose which folders sync locally (like Dropbox selective sync). Requires:
- Per-folder sync toggle
- Background sync daemon changes
- UI indicators for synced vs. cloud-only folders

### 16.8 External File Links

**Status:** TODO  
Allow linking to external URLs (not just workspace files) with a similar chip/card UI. Requires:
- URL validation
- Favicon/OG image fetching
- Separate link type in TipTap extension

### 16.9 Zip/Archive Preview

**Status:** TODO  
Show contents of ZIP/TAR archives without downloading the full file. Requires:
- Streaming archive header parsing
- Virtual file listing UI

---

## Appendix A: File Type Categories

### Extension → Category Mapping

| Category | Extensions |
|----------|-----------|
| `document` | pdf, doc, docx, txt, rtf, odt, pages, md, epub, mobi |
| `spreadsheet` | xls, xlsx, csv, ods, numbers, tsv |
| `image` | png, jpg, jpeg, gif, svg, webp, bmp, ico, tiff, tif, heic, heif, raw, cr2, nef |
| `video` | mp4, mov, avi, mkv, webm, flv, wmv, m4v, 3gp, ogv |
| `audio` | mp3, wav, flac, aac, ogg, m4a, wma, opus, aiff, mid, midi |
| `archive` | zip, tar, gz, 7z, rar, bz2, xz, tgz, dmg, iso |
| `code` | js, ts, jsx, tsx, py, java, c, cpp, h, hpp, rs, go, rb, php, html, css, scss, less, json, xml, yaml, yml, toml, sh, bash, ps1, bat, sql, r, swift, kt, dart, lua, pl, ex, exs, hs, elm, vue, svelte |
| `presentation` | ppt, pptx, key, odp |
| `design` | psd, ai, sketch, fig, xd, indd, afdesign, afphoto |
| `other` | Everything not listed above |

### Color Constants

```javascript
export const FILE_TYPE_COLORS = {
  document:     { bg: '#E8F0FE', fg: '#4285F4', icon: '📄' },
  spreadsheet:  { bg: '#E6F4EA', fg: '#34A853', icon: '📊' },
  image:        { bg: '#F3E8FD', fg: '#9C27B0', icon: '🖼️' },
  video:        { bg: '#FCE8E6', fg: '#EA4335', icon: '🎬' },
  audio:        { bg: '#FFF3E0', fg: '#FF9800', icon: '🎵' },
  archive:      { bg: '#FFF8E1', fg: '#FBBC05', icon: '📦' },
  code:         { bg: '#ECEFF1', fg: '#607D8B', icon: '💻' },
  presentation: { bg: '#EFEBE9', fg: '#795548', icon: '📽️' },
  design:       { bg: '#FCE4EC', fg: '#E91E63', icon: '🎨' },
  other:        { bg: '#F5F5F5', fg: '#9E9E9E', icon: '📎' },
};
```

---

## Appendix B: File Inventory

### New Files (by Phase)

```
frontend/src/
├── components/files/
│   ├── FileStorageDashboard.jsx          (Phase 1)
│   ├── FileStorageDashboard.css          (Phase 1)
│   ├── FileStorageNavRail.jsx            (Phase 1)
│   ├── FileStorageNavRail.css            (Phase 1)
│   ├── browse/
│   │   ├── BrowseView.jsx               (Phase 4)
│   │   ├── BrowseView.css               (Phase 4)
│   │   ├── FileCard.jsx                 (Phase 4)
│   │   ├── FileCard.css                 (Phase 4)
│   │   ├── FileTableRow.jsx             (Phase 4)
│   │   ├── FolderCard.jsx               (Phase 4)
│   │   ├── Breadcrumbs.jsx              (Phase 4)
│   │   ├── Breadcrumbs.css              (Phase 4)
│   │   ├── ViewModeToggle.jsx           (Phase 4)
│   │   ├── FileContextMenu.jsx          (Phase 4)
│   │   ├── FolderCreateDialog.jsx       (Phase 4)
│   │   ├── FileMoveDialog.jsx           (Phase 4)
│   │   ├── FileDetailPanel.jsx          (Phase 4)
│   │   ├── FileDetailPanel.css          (Phase 4)
│   │   ├── SearchBar.jsx                (Phase 4)
│   │   ├── SearchBar.css                (Phase 4)
│   │   └── SearchFilters.jsx            (Phase 4)
│   ├── upload/
│   │   ├── UploadZone.jsx               (Phase 2)
│   │   ├── UploadZone.css               (Phase 2)
│   │   ├── UploadProgress.jsx           (Phase 2)
│   │   └── UploadProgress.css           (Phase 2)
│   ├── downloads/
│   │   ├── DownloadsBar.jsx             (Phase 3)
│   │   ├── DownloadsBar.css             (Phase 3)
│   │   ├── DownloadsView.jsx            (Phase 3)
│   │   └── DownloadsView.css            (Phase 3)
│   ├── common/
│   │   ├── DistributionBadge.jsx        (Phase 4)
│   │   └── FileTypeIcon.jsx             (Phase 4)
│   ├── recent/
│   │   └── RecentView.jsx               (Phase 4)
│   ├── favorites/
│   │   └── FavoritesView.jsx            (Phase 4)
│   ├── trash/
│   │   ├── TrashView.jsx                (Phase 4)
│   │   └── TrashView.css                (Phase 4)
│   ├── admin/
│   │   ├── AuditLogView.jsx             (Phase 7)
│   │   ├── AuditLogView.css             (Phase 7)
│   │   ├── StorageView.jsx              (Phase 7)
│   │   ├── StorageView.css              (Phase 7)
│   │   ├── FileStorageSettings.jsx      (Phase 7)
│   │   └── FileStorageSettings.css      (Phase 7)
│   └── picker/
│       ├── FilePickerModal.jsx          (Phase 6)
│       ├── FilePickerModal.css          (Phase 6)
│       └── FilePickerFull.jsx           (Phase 6)
├── contexts/
│   └── FileStorageContext.jsx           (Phase 1)
├── hooks/
│   └── useFileStorageSync.js            (Phase 1)
├── extensions/
│   ├── FileLink.js                      (Phase 6)
│   └── FileLink.css                     (Phase 6)
└── utils/
    ├── fileStorageValidation.js          (Phase 1)
    ├── fileChunker.js                   (Phase 2)
    ├── fileEncryption.js                (Phase 2)
    ├── fileTypeCategories.js            (Phase 2)
    ├── fileDownloader.js                (Phase 3)
    ├── downloadManager.js               (Phase 3)
    ├── distributionHealth.js            (Phase 5)
    ├── fileLinkResolver.js              (Phase 6)
    ├── fileNotifications.js             (Phase 7)
    ├── fileAuditLog.js                  (Phase 7)
    └── chunkStorageWeb.js               (Phase 8)

sidecar/
├── chunkStorage.js                      (Phase 2)
└── chunkSeeder.js                       (Phase 5)

tests/
├── file-storage/
│   ├── file-chunker.test.js             (Phase 8)
│   ├── file-encryption.test.js          (Phase 8)
│   ├── file-download.test.js            (Phase 8)
│   ├── file-validation.test.js          (Phase 8)
│   ├── distribution-health.test.js      (Phase 8)
│   └── file-type-categories.test.js     (Phase 8)
├── components/files/
│   ├── browse-view.test.jsx             (Phase 8)
│   ├── file-card.test.jsx               (Phase 8)
│   ├── upload-zone.test.jsx             (Phase 8)
│   ├── downloads-bar.test.jsx           (Phase 8)
│   └── file-picker-modal.test.jsx       (Phase 8)
└── hooks/
    └── useFileStorageSync.test.js        (Phase 8)
```

**Total new files:** ~65

### Existing Files to Modify

| File | Phase | Change |
|------|-------|--------|
| `frontend/src/components/HierarchicalSidebar.jsx` | 1 | Add `files` document type; grey out if exists |
| `frontend/src/components/CreateDocumentDialog.jsx` | 1 | Add `files` type option |
| `frontend/src/components/App.jsx` | 1 | Add `files` rendering case |
| `frontend/src/hooks/useWorkspaceSync.js` | 1 | Declare 5 new Yjs shared types |
| `sidecar/index.js` | 2 | Register chunk storage + seeder IPC |
| `sidecar/mesh.js` | 3 | Handle file chunk message types |
| `sidecar/mesh-constants.js` | 3 | Add `FILE_MSG` constants |
| `sidecar/p2p.js` | 3 | Route chunk request/response messages |
| `frontend/src/components/AppSettings.jsx` | 5 | Add chunk storage quota setting |
| `frontend/src/components/TipTapEditor.jsx` | 6 | Register FileLink extension, toolbar + slash command |
| `frontend/src/components/SpreadsheetEditor.jsx` | 6 | Add file link toolbar button + click handler |
| `frontend/src/components/KanbanBoard.jsx` | 6 | Add attachment button + card attachment rendering |

---

*Last updated: February 15, 2026*
