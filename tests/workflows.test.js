/**
 * Integration Flow Tests
 * 
 * End-to-end workflow tests simulating real user scenarios.
 * Tests complete flows from identity creation through workspace collaboration.
 * 
 * Note: Invite security tests are in invites.test.js
 */

import * as Y from 'yjs';
import {
  generateIdentity,
  restoreIdentityFromMnemonic,
  signData,
  verifySignature,
  uint8ToBase62,
  base62ToUint8,
} from '../frontend/src/utils/identity';
import {
  createBackup,
  restoreBackup,
} from '../frontend/src/utils/backup';

describe('Integration: New User Onboarding Flow', () => {
  test('complete new user flow: generate → backup → restore', async () => {
    // Step 1: User generates a new identity
    const identity = generateIdentity();
    expect(identity.mnemonic).toBeDefined();
    expect(identity.publicKeyBase62).toBeDefined();
    expect(identity.privateKey).toBeInstanceOf(Uint8Array);
    
    // Step 2: User creates their first workspace
    const workspaces = [{
      id: 'workspace-1',
      name: 'My First Workspace',
      myPermission: 'owner',
      encryptionKey: uint8ToBase62(new Uint8Array(32).map((_, i) => i)),
    }];
    
    // Step 3: User backs up their data
    const backup = await createBackup(identity, workspaces);
    expect(backup.version).toBe(1);
    expect(backup.identity.publicKey).toBe(identity.publicKeyBase62);
    
    // Step 4: Simulate device loss - user restores on new device
    const restoredData = await restoreBackup(backup, identity.mnemonic);
    
    // Compare as base62 strings since restoreBackup returns Uint8Array
    const restoredPublicKey = restoredData.identity.publicKey instanceof Uint8Array 
      ? uint8ToBase62(restoredData.identity.publicKey)
      : restoredData.identity.publicKey;
    expect(restoredPublicKey).toBe(identity.publicKeyBase62);
    expect(restoredData.workspaces).toHaveLength(1);
    expect(restoredData.workspaces[0].name).toBe('My First Workspace');
    
    // Step 5: Restored identity should work for signing
    const restoredIdentity = restoreIdentityFromMnemonic(identity.mnemonic);
    const testMessage = 'test after restore';
    const signature = signData(testMessage, restoredIdentity.privateKey);
    
    expect(verifySignature(testMessage, signature, identity.publicKey)).toBe(true);
  });
});

describe('Integration: Workspace Collaboration Flow', () => {
  let ownerIdentity;
  let memberIdentity;
  let ydoc;
  let yMembers;
  let yKicked;
  const workspaceId = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'; // 32 hex chars (16 bytes)
  
  beforeEach(() => {
    ownerIdentity = generateIdentity();
    memberIdentity = generateIdentity();
    ydoc = new Y.Doc();
    yMembers = ydoc.getMap('members');
    yKicked = ydoc.getMap('kicked');
  });
  
  afterEach(() => {
    ydoc.destroy();
  });

  test('complete collaboration flow: create → invite → join → collaborate → kick', () => {
    // Step 1: Owner creates workspace and adds self
    yMembers.set(ownerIdentity.publicKeyBase62, {
      publicKey: ownerIdentity.publicKeyBase62,
      displayName: 'Workspace Owner',
      permission: 'owner',
      joinedAt: Date.now(),
      lastSeen: Date.now(),
    });
    
    expect(yMembers.size).toBe(1);
    expect(yMembers.get(ownerIdentity.publicKeyBase62).permission).toBe('owner');
    
    // Step 2: Owner generates signed invite (tested in invites.test.js)
    const encryptionKey = new Uint8Array(32);
    crypto.getRandomValues(encryptionKey);
    
    // Step 3: Member joins workspace (simulating accepted invite)
    yMembers.set(memberIdentity.publicKeyBase62, {
      publicKey: memberIdentity.publicKeyBase62,
      displayName: 'New Editor',
      permission: 'editor',
      joinedAt: Date.now(),
      lastSeen: Date.now(),
    });
    
    expect(yMembers.size).toBe(2);
    
    // Step 4: Both users can edit (simulated via Y.js)
    const yContent = ydoc.getText('content');
    yContent.insert(0, 'Owner wrote this. ');
    yContent.insert(yContent.length, 'Member added this.');
    
    expect(yContent.toString()).toBe('Owner wrote this. Member added this.');
    
    // Step 5: Owner kicks member
    const kickTimestamp = Date.now();
    const kickMessage = `kick:${workspaceId}:${memberIdentity.publicKeyBase62}:${kickTimestamp}`;
    const kickSignature = signData(kickMessage, ownerIdentity.privateKey);
    
    // Verify kick signature
    expect(verifySignature(kickMessage, kickSignature, ownerIdentity.publicKey)).toBe(true);
    
    // Add to kicked map
    yKicked.set(memberIdentity.publicKeyBase62, {
      kickedAt: kickTimestamp,
      kickedBy: ownerIdentity.publicKeyBase62,
      signature: uint8ToBase62(kickSignature),
      reason: 'Violated community guidelines',
    });
    
    // Remove from members
    yMembers.delete(memberIdentity.publicKeyBase62);
    
    expect(yMembers.size).toBe(1);
    expect(yKicked.has(memberIdentity.publicKeyBase62)).toBe(true);
    
    // Step 6: Kicked member cannot re-verify kick signature (proves it was valid)
    const kickedEntry = yKicked.get(memberIdentity.publicKeyBase62);
    const decodedSig = base62ToUint8(kickedEntry.signature, 64);
    const reconstructedMessage = `kick:${workspaceId}:${memberIdentity.publicKeyBase62}:${kickedEntry.kickedAt}`;
    
    expect(verifySignature(reconstructedMessage, decodedSig, ownerIdentity.publicKey)).toBe(true);
  });
});

// Note: Invite security tests are covered in invites.test.js

describe('Integration: Multi-Workspace Flow', () => {
  test('user can manage multiple workspaces with different permissions', async () => {
    const user = generateIdentity();
    const otherOwner = generateIdentity();
    
    const workspaces = [
      {
        id: 'ws-owned',
        name: 'My Owned Workspace',
        myPermission: 'owner',
        encryptionKey: uint8ToBase62(new Uint8Array(32).fill(1)),
        createdBy: user.publicKeyBase62,
      },
      {
        id: 'ws-editor',
        name: 'Shared Workspace (Editor)',
        myPermission: 'editor',
        encryptionKey: uint8ToBase62(new Uint8Array(32).fill(2)),
        createdBy: otherOwner.publicKeyBase62,
      },
      {
        id: 'ws-viewer',
        name: 'Read-Only Workspace',
        myPermission: 'viewer',
        encryptionKey: uint8ToBase62(new Uint8Array(32).fill(3)),
        createdBy: otherOwner.publicKeyBase62,
      },
    ];
    
    // Create backup with all workspaces
    const backup = await createBackup(user, workspaces);
    
    expect(backup.workspaces).toHaveLength(3);
    expect(backup.workspaces.filter(w => w.isOwner)).toHaveLength(1);
    
    // Restore and verify permissions preserved
    const restored = await restoreBackup(backup, user.mnemonic);
    
    expect(restored.workspaces.find(w => w.id === 'ws-owned').isOwner).toBe(true);
    expect(restored.workspaces.find(w => w.id === 'ws-editor').isOwner).toBe(false);
    expect(restored.workspaces.find(w => w.id === 'ws-viewer').isOwner).toBe(false);
  });
});

describe('Integration: Identity Recovery Flow', () => {
  test('complete recovery flow with mnemonic phrase', async () => {
    // Step 1: Original user creates identity and workspaces
    const originalIdentity = generateIdentity();
    const mnemonic = originalIdentity.mnemonic;
    
    const workspaces = [
      {
        id: 'important-workspace',
        name: 'Important Documents',
        myPermission: 'owner',
        encryptionKey: 'secretkey123',
      },
    ];
    
    // Step 2: Create and "save" backup
    const backup = await createBackup(originalIdentity, workspaces);
    
    // Step 3: Simulate complete data loss - only mnemonic saved
    const savedMnemonic = mnemonic;
    // ... time passes, user loses device ...
    
    // Step 4: User recovers with just the mnemonic
    const recoveredIdentity = restoreIdentityFromMnemonic(savedMnemonic);
    
    // Step 5: Verify identity is the same
    expect(recoveredIdentity.publicKeyBase62).toBe(originalIdentity.publicKeyBase62);
    
    // Step 6: User can restore full backup
    const restoredData = await restoreBackup(backup, savedMnemonic);
    
    expect(restoredData.workspaces[0].name).toBe('Important Documents');
    
    // Step 7: Recovered identity can sign and be verified
    const proveOwnership = 'I am the original owner';
    const signature = signData(proveOwnership, recoveredIdentity.privateKey);
    
    // Third party can verify this is the same person
    expect(verifySignature(proveOwnership, signature, originalIdentity.publicKey)).toBe(true);
  });
});

describe('Integration: Concurrent Membership Changes', () => {
  test('simultaneous joins and kicks resolve correctly', () => {
    const ydoc1 = new Y.Doc();
    const ydoc2 = new Y.Doc();
    
    const owner = generateIdentity();
    const member1 = generateIdentity();
    const member2 = generateIdentity();
    const workspaceId = 'concurrent-test';
    
    // Initial state - owner only
    ydoc1.getMap('members').set(owner.publicKeyBase62, {
      publicKey: owner.publicKeyBase62,
      displayName: 'Owner',
      permission: 'owner',
      joinedAt: Date.now(),
    });
    
    // Sync doc1 to doc2
    const state1 = Y.encodeStateAsUpdate(ydoc1);
    Y.applyUpdate(ydoc2, state1);
    
    // Concurrent operations:
    // - On doc1: Owner kicks member1 and adds member2
    // - On doc2: Member1 tries to update their lastSeen
    
    // Doc1: Kick member1, add member2
    const kickTime = Date.now();
    const kickMsg = `kick:${workspaceId}:${member1.publicKeyBase62}:${kickTime}`;
    const kickSig = signData(kickMsg, owner.privateKey);
    
    ydoc1.getMap('kicked').set(member1.publicKeyBase62, {
      kickedAt: kickTime,
      kickedBy: owner.publicKeyBase62,
      signature: uint8ToBase62(kickSig),
    });
    ydoc1.getMap('members').delete(member1.publicKeyBase62);
    ydoc1.getMap('members').set(member2.publicKeyBase62, {
      publicKey: member2.publicKeyBase62,
      displayName: 'Member 2',
      permission: 'editor',
      joinedAt: Date.now(),
    });
    
    // Doc2: Member1 (unaware of kick) updates lastSeen
    ydoc2.getMap('members').set(member1.publicKeyBase62, {
      publicKey: member1.publicKeyBase62,
      displayName: 'Member 1',
      permission: 'editor',
      joinedAt: Date.now() - 1000,
      lastSeen: Date.now(),
    });
    
    // Sync both ways
    const state1After = Y.encodeStateAsUpdate(ydoc1);
    const state2After = Y.encodeStateAsUpdate(ydoc2);
    
    Y.applyUpdate(ydoc2, state1After);
    Y.applyUpdate(ydoc1, state2After);
    
    // Final state should be consistent
    expect(ydoc1.getMap('kicked').has(member1.publicKeyBase62)).toBe(true);
    expect(ydoc2.getMap('kicked').has(member1.publicKeyBase62)).toBe(true);
    expect(ydoc1.getMap('members').has(member2.publicKeyBase62)).toBe(true);
    expect(ydoc2.getMap('members').has(member2.publicKeyBase62)).toBe(true);
    
    // Cleanup
    ydoc1.destroy();
    ydoc2.destroy();
  });
});
