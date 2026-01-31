# Identity & Security Implementation Plan

## Overview

This document outlines the implementation of a cryptographic identity system for Nahma, enabling:
- **Device-bound identity** - Ed25519 keypair derived from BIP39 mnemonic
- **Time-limited signed invites** - Owner-signed invitations with configurable expiry
- **Cryptographic kick system** - Owner can remove collaborators with signed proof
- **Backup & recovery** - Encrypted export/import of identity and workspace data
- **Workspace cloning** - Transfer ownership via full copy

## Design Principles

1. **No central authority** - All verification is cryptographic, not server-based
2. **Eventual consistency** - P2P sync means some latency is acceptable
3. **Signed operations** - All sensitive actions carry owner signature
4. **Privacy-preserving** - Identity is local-only, never transmitted to servers

---

## Phase 1: Identity System (1 day)

### 1.1 Core Identity Module

**File:** `frontend/src/utils/identity.js`

```javascript
// Key functions:
generateMnemonic()        // Creates 12-word BIP39 mnemonic
mnemonicToKeypair()       // Derives Ed25519 keypair from mnemonic
signMessage(message)      // Signs with private key
verifySignature()         // Verifies with public key
getOrCreateIdentity()     // Loads or generates identity
restoreFromMnemonic()     // Restores from backup words
```

### 1.2 Identity Storage

- **Location:** `localStorage` key `nahma_identity`
- **Format:** `{ publicKey: hex, secretKey: hex, mnemonic: encrypted }`
- **Mnemonic encryption:** XSalsa20-Poly1305 with user passphrase (optional)

### 1.3 Dependencies

```json
{
  "bip39": "^3.1.0"
}
```

---

## Phase 2: Workspace Membership (1 day)

### 2.1 Members Y.Map

**Location:** Each workspace's Yjs document

```javascript
const members = ydoc.getMap('members');
// Structure:
{
  [publicKey]: {
    displayName: string,
    permission: 'owner' | 'editor' | 'viewer',
    joinedAt: timestamp,
    lastSeen: timestamp
  }
}
```

### 2.2 Owner Bootstrap

When creating a workspace:
1. Creator's publicKey becomes the only `owner`
2. Workspace key is signed with creator's identity
3. First member entry is created immediately

### 2.3 Peer Identity Announcement

On peer connection:
1. Send `ANNOUNCE` message with `{ publicKey, signature }`
2. Signature proves ownership of the identity
3. Receiving peer verifies signature before accepting sync

---

## Phase 3: Time-Limited Signed Invites (1 day)

### 3.1 Invite Link Format

```
nahma://workspace/{workspaceId}#key={encKey}&exp={timestamp}&perm={permission}&sig={signature}
```

- **exp:** Unix timestamp when invite expires (max 24 hours from creation)
- **perm:** Permission level granted (`editor` or `viewer`)
- **sig:** Owner's Ed25519 signature over `{workspaceId}|{exp}|{perm}`

### 3.2 Invite Creation Flow

1. Owner opens share dialog
2. Selects expiry time (15min, 1hr, 4hr, 24hr)
3. Selects permission level
4. System generates signed link
5. Link copied to clipboard

### 3.3 Invite Validation

On join attempt:
1. Parse link components
2. Check `exp > Date.now()` → reject if expired
3. Verify `sig` against workspace owner's publicKey
4. If valid, add joiner to members map

---

## Phase 4: Kick System (1.5 days)

### 4.1 Kicked Y.Map

```javascript
const kicked = ydoc.getMap('kicked');
// Structure:
{
  [publicKey]: {
    kickedAt: timestamp,
    kickedBy: ownerPublicKey,
    signature: ownerSignature,
    reason?: string
  }
}
```

### 4.2 Kick Message (Immediate)

For real-time notification:
```javascript
{
  type: 'KICK',
  targetPublicKey: string,
  kickedBy: ownerPublicKey,
  signature: string,
  timestamp: number
}
```

### 4.3 Kick Processing

**On receiving KICK message:**
1. Verify signature is from workspace owner
2. If `targetPublicKey === myPublicKey`:
   - Show `KickedModal`
   - Clear local workspace data
   - Disconnect from peers
3. If target is another peer:
   - Update UI to remove collaborator
   - Stop syncing with kicked peer

### 4.4 Rejoining Prevention

On sync initialization:
1. Check if own publicKey is in `kicked` map
2. If kicked, refuse to sync and clear local data
3. Signature verification prevents forged kicks

---

## Phase 5: Collaborator View (0.5 day)

### 5.1 Collaborator List Component

**Location:** `WorkspaceSettings.jsx`

- Display all members from `members` Y.Map
- Show display name, permission, last seen
- Deduplicated by publicKey (not peerId)
- Owner sees "Kick" button next to each member

### 5.2 Real-time Updates

- Listen to `members.observe()` for changes
- Update presence indicators based on peer connections
- Show "Owner" badge for workspace creator

---

## Phase 6: Clone Workspace (1 day)

### 6.1 Clone Flow

1. User clicks "Clone Workspace" in settings
2. System creates new workspace with new ID
3. All content (pages, entities, etc.) copied
4. Current user becomes owner of clone
5. Original workspace unchanged

### 6.2 Implementation

```javascript
async function cloneWorkspace(sourceWorkspaceId) {
  const newId = generateWorkspaceId();
  const newKey = generateEncryptionKey();
  
  // Copy all Y.Doc content
  const sourceDoc = getDoc(sourceWorkspaceId);
  const cloneDoc = new Y.Doc();
  Y.applyUpdate(cloneDoc, Y.encodeStateAsUpdate(sourceDoc));
  
  // Reset ownership
  const members = cloneDoc.getMap('members');
  members.clear();
  members.set(myPublicKey, { permission: 'owner', ... });
  
  // Clear kicked list
  cloneDoc.getMap('kicked').clear();
  
  return { id: newId, key: newKey };
}
```

---

## Phase 7: Backup & Recovery (1 day)

### 7.1 Backup File Format

```json
{
  "version": 1,
  "createdAt": "2026-01-29T...",
  "identity": {
    "publicKey": "hex...",
    "encryptedSecretKey": "base64..."
  },
  "workspaces": [
    {
      "id": "...",
      "name": "...",
      "encryptedKey": "base64...",
      "isOwner": true
    }
  ]
}
```

### 7.2 Encryption

- **Key derivation:** Bytes 32-63 of BIP39 seed (separate from identity keypair)
- **Algorithm:** XSalsa20-Poly1305 (same as tweetnacl secretbox)
- **Optional passphrase:** Additional PBKDF2 layer if user sets passphrase

### 7.3 Recovery Flows

**From mnemonic (12 words):**
1. User enters mnemonic
2. Derive keypair → same publicKey recovered
3. Workspaces recognize returning member
4. Content syncs from peers

**From backup file:**
1. User selects .nahma-backup file
2. Enter passphrase if required
3. Decrypt and restore identity + workspace keys
4. Rejoin all workspaces

---

## Phase 8: Content Authorship (0.5 day)

### 8.1 Tracking Creation

All content types get `createdBy` field:
- Pages
- Entities
- Fields
- Comments (future)

### 8.2 Implementation

```javascript
// In entity creation
const entity = {
  id: generateId(),
  type: entityType,
  name: name,
  createdBy: myPublicKey,  // NEW
  createdAt: Date.now(),
  ...
};
```

---

## Phase 9: Testing (1.5 days)

### 9.1 Unit Tests

**File:** `tests/identity.test.js`
```javascript
describe('Identity System', () => {
  test('generates valid 12-word mnemonic');
  test('derives deterministic keypair from mnemonic');
  test('same mnemonic produces same keypair');
  test('signs and verifies messages correctly');
  test('rejects tampered signatures');
  test('stores and retrieves identity from localStorage');
});
```

**File:** `tests/invites.test.js`
```javascript
describe('Signed Invites', () => {
  test('creates invite with valid signature');
  test('rejects expired invites');
  test('rejects invites with invalid signature');
  test('accepts valid non-expired invite');
  test('parses invite link correctly');
  test('enforces maximum 24-hour expiry');
});
```

**File:** `tests/kick.test.js`
```javascript
describe('Kick System', () => {
  test('owner can kick members');
  test('non-owner cannot kick');
  test('kick signature is verified');
  test('kicked user is added to kicked map');
  test('kicked user cannot rejoin');
  test('forged kick is rejected');
});
```

**File:** `tests/membership.test.js`
```javascript
describe('Workspace Membership', () => {
  test('creator becomes owner');
  test('invited user gets correct permission');
  test('members map is properly structured');
  test('duplicate publicKey not allowed');
  test('lastSeen updates on activity');
});
```

### 9.2 Integration Tests

**File:** `tests/integration/identity-flow.test.js`
```javascript
describe('Identity Integration', () => {
  test('full identity creation and workspace join flow');
  test('backup creation and restore flow');
  test('mnemonic recovery reconnects to workspaces');
  test('kick propagates across multiple peers');
  test('clone workspace creates independent copy');
});
```

### 9.3 E2E Tests

**File:** `tests/e2e/security-e2e.test.js`
```javascript
describe('Security E2E', () => {
  test('invited user can join and edit');
  test('expired invite shows error');
  test('kicked user sees modal and loses access');
  test('owner can see all collaborators');
  test('recovery code display and copy works');
  test('backup file download and restore works');
});
```

---

## File Summary

### New Files
| File | Purpose |
|------|---------|
| `frontend/src/utils/identity.js` | BIP39 + Ed25519 identity management |
| `frontend/src/utils/backup.js` | Encrypted backup creation/restoration |
| `frontend/src/components/RecoveryCodeModal.jsx` | Display 12-word mnemonic |
| `frontend/src/components/KickedModal.jsx` | "You've been removed" notification |
| `frontend/src/components/AccountRecovery.jsx` | Mnemonic/file restore UI |
| `tests/identity.test.js` | Identity unit tests |
| `tests/invites.test.js` | Invite unit tests |
| `tests/kick.test.js` | Kick unit tests |
| `tests/membership.test.js` | Membership unit tests |
| `tests/integration/identity-flow.test.js` | Integration tests |
| `tests/e2e/security-e2e.test.js` | E2E security tests |

### Modified Files
| File | Changes |
|------|---------|
| `package.json` | Add `bip39` dependency |
| `frontend/src/utils/sharing.js` | Signed invite generation |
| `frontend/src/hooks/useWorkspaceSync.js` | Members/kicked Y.Maps |
| `frontend/src/services/p2p/PeerManager.js` | Signature verification, kick handling |
| `frontend/src/services/p2p/messages.js` | KICK message type |
| `frontend/src/components/WorkspaceSettings.jsx` | Collaborator list, kick UI |
| `frontend/src/components/CreateWorkspace.jsx` | Owner bootstrap |
| `frontend/src/AppNew.jsx` | Identity initialization, kicked check |

---

## Timeline

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| 1. Identity System | 1 day | None |
| 2. Workspace Membership | 1 day | Phase 1 |
| 3. Signed Invites | 1 day | Phases 1, 2 |
| 4. Kick System | 1.5 days | Phases 1, 2, 3 |
| 5. Collaborator View | 0.5 day | Phase 2 |
| 6. Clone Workspace | 1 day | Phase 2 |
| 7. Backup & Recovery | 1 day | Phase 1 |
| 8. Content Authorship | 0.5 day | Phase 1 |
| 9. Testing | 1.5 days | All phases |

**Total: ~9 days**

---

## Security Considerations

1. **Mnemonic protection:** Never transmit mnemonic over network
2. **Signature freshness:** Include timestamps to prevent replay attacks
3. **Key rotation:** Future enhancement - allow identity rotation with owner signature
4. **Audit log:** Future enhancement - signed log of all membership changes
