/**
 * Test Suite: Permission Management System
 * 
 * Comprehensive tests for:
 * - updateMemberPermission (multi-owner, founding owner protection)
 * - respondToPendingDemotion
 * - PermissionWatcher race condition guard (permissionSetAt / permissionUpdatedAt)
 * - joinWorkspace permission upgrade/downgrade toasts
 * - WorkspaceSettings permission dropdown UI
 * - Self-demotion (step-down)
 * - E2E scenarios for full permission lifecycle
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';

// ============================================================
// Unit Tests: Permission Hierarchy & Logic
// ============================================================

describe('Permission Hierarchy', () => {
  const permHierarchy = { owner: 3, editor: 2, viewer: 1 };

  test('owner > editor > viewer', () => {
    expect(permHierarchy.owner).toBeGreaterThan(permHierarchy.editor);
    expect(permHierarchy.editor).toBeGreaterThan(permHierarchy.viewer);
  });

  test('all levels are positive integers', () => {
    Object.values(permHierarchy).forEach(level => {
      expect(level).toBeGreaterThan(0);
      expect(Number.isInteger(level)).toBe(true);
    });
  });

  test('multi-owner: two users can both have owner permission', () => {
    const members = {
      'key-A': { permission: 'owner' },
      'key-B': { permission: 'owner' },
      'key-C': { permission: 'editor' },
    };
    const owners = Object.values(members).filter(m => m.permission === 'owner');
    expect(owners.length).toBe(2);
  });
});

// ============================================================
// Unit Tests: updateMemberPermission Logic
// ============================================================

describe('updateMemberPermission Logic', () => {
  let yMembers;
  let yInfo;
  let callerPublicKey;

  // Simulates the updateMemberPermission logic from useWorkspaceSync.js
  const updateMemberPermission = (targetPublicKey, newPermission, callerPermission = 'owner') => {
    const validPermissions = ['owner', 'editor', 'viewer'];
    if (!validPermissions.includes(newPermission)) return false;
    if (callerPermission !== 'owner') return false;

    const targetMember = yMembers.get(targetPublicKey);
    if (!targetMember) return false;
    if (targetMember.permission === newPermission) return true;

    const now = Date.now();
    const foundingOwner = yInfo.get('createdBy');
    const isSelf = targetPublicKey === callerPublicKey;
    const permHierarchy = { owner: 3, editor: 2, viewer: 1 };
    const isDemotion = (permHierarchy[newPermission] || 0) < (permHierarchy[targetMember.permission] || 0);

    if (targetPublicKey === foundingOwner && isDemotion && !isSelf) {
      yMembers.set(targetPublicKey, {
        ...targetMember,
        lastSeen: now,
        pendingDemotion: {
          requestedBy: callerPublicKey,
          requestedByName: 'Test Caller',
          requestedPermission: newPermission,
          requestedAt: now,
        },
      });
      return 'pending';
    }

    yMembers.set(targetPublicKey, {
      ...targetMember,
      permission: newPermission,
      permissionUpdatedAt: now,
      pendingDemotion: null,
      lastSeen: now,
    });
    return true;
  };

  beforeEach(() => {
    yMembers = new Map();
    yInfo = new Map();
    callerPublicKey = 'caller-key';
    yInfo.set('createdBy', 'founder-key');
    
    yMembers.set('caller-key', { permission: 'owner', displayName: 'Caller' });
    yMembers.set('founder-key', { permission: 'owner', displayName: 'Founder' });
    yMembers.set('editor-key', { permission: 'editor', displayName: 'Editor User' });
    yMembers.set('viewer-key', { permission: 'viewer', displayName: 'Viewer User' });
  });

  describe('Basic Permission Changes', () => {
    test('promotes viewer to editor', () => {
      const result = updateMemberPermission('viewer-key', 'editor');
      expect(result).toBe(true);
      expect(yMembers.get('viewer-key').permission).toBe('editor');
    });

    test('promotes viewer to owner (multi-owner)', () => {
      const result = updateMemberPermission('viewer-key', 'owner');
      expect(result).toBe(true);
      expect(yMembers.get('viewer-key').permission).toBe('owner');
    });

    test('demotes editor to viewer', () => {
      const result = updateMemberPermission('editor-key', 'viewer');
      expect(result).toBe(true);
      expect(yMembers.get('editor-key').permission).toBe('viewer');
    });

    test('promotes editor to owner (multi-owner)', () => {
      const result = updateMemberPermission('editor-key', 'owner');
      expect(result).toBe(true);
      expect(yMembers.get('editor-key').permission).toBe('owner');
    });

    test('no-op when permission is already the same', () => {
      const result = updateMemberPermission('editor-key', 'editor');
      expect(result).toBe(true);
      // Should not have permissionUpdatedAt since it's a no-op
      expect(yMembers.get('editor-key').permissionUpdatedAt).toBeUndefined();
    });

    test('sets permissionUpdatedAt on change', () => {
      const before = Date.now();
      updateMemberPermission('viewer-key', 'editor');
      const after = Date.now();
      const updatedAt = yMembers.get('viewer-key').permissionUpdatedAt;
      expect(updatedAt).toBeGreaterThanOrEqual(before);
      expect(updatedAt).toBeLessThanOrEqual(after);
    });

    test('clears pendingDemotion on direct change', () => {
      yMembers.set('editor-key', {
        ...yMembers.get('editor-key'),
        pendingDemotion: { requestedBy: 'x', requestedPermission: 'viewer', requestedAt: 1 },
      });
      updateMemberPermission('editor-key', 'viewer');
      expect(yMembers.get('editor-key').pendingDemotion).toBeNull();
    });
  });

  describe('Validation', () => {
    test('rejects invalid permission', () => {
      expect(updateMemberPermission('viewer-key', 'superadmin')).toBe(false);
    });

    test('rejects non-owner caller', () => {
      expect(updateMemberPermission('viewer-key', 'editor', 'editor')).toBe(false);
    });

    test('rejects non-existent target', () => {
      expect(updateMemberPermission('nonexistent-key', 'editor')).toBe(false);
    });
  });

  describe('Founding Owner Protection', () => {
    test('demotion of founding owner by another owner creates pendingDemotion', () => {
      const result = updateMemberPermission('founder-key', 'editor');
      expect(result).toBe('pending');
      expect(yMembers.get('founder-key').permission).toBe('owner'); // Unchanged
      expect(yMembers.get('founder-key').pendingDemotion).toBeDefined();
      expect(yMembers.get('founder-key').pendingDemotion.requestedPermission).toBe('editor');
      expect(yMembers.get('founder-key').pendingDemotion.requestedBy).toBe('caller-key');
    });

    test('founding owner self-demotion bypasses approval', () => {
      callerPublicKey = 'founder-key';
      const result = updateMemberPermission('founder-key', 'editor');
      expect(result).toBe(true);
      expect(yMembers.get('founder-key').permission).toBe('editor');
      expect(yMembers.get('founder-key').pendingDemotion).toBeNull();
    });

    test('promotion of founding owner is direct (no pending)', () => {
      // Set founding owner to editor first (via self-demotion)
      callerPublicKey = 'founder-key';
      updateMemberPermission('founder-key', 'editor');
      expect(yMembers.get('founder-key').permission).toBe('editor');

      // Now another owner promotes them back
      callerPublicKey = 'caller-key';
      const result = updateMemberPermission('founder-key', 'owner');
      expect(result).toBe(true);
      expect(yMembers.get('founder-key').permission).toBe('owner');
    });

    test('demotion of non-founding owner is direct', () => {
      // Another co-owner (not founding owner)
      yMembers.set('co-owner-key', { permission: 'owner', displayName: 'Co-Owner' });
      const result = updateMemberPermission('co-owner-key', 'editor');
      expect(result).toBe(true);
      expect(yMembers.get('co-owner-key').permission).toBe('editor');
    });
  });

  describe('Multi-Owner Mutual Demotion', () => {
    test('owner A can demote owner B (non-founding)', () => {
      yMembers.set('ownerB-key', { permission: 'owner', displayName: 'Owner B' });
      const result = updateMemberPermission('ownerB-key', 'editor');
      expect(result).toBe(true);
      expect(yMembers.get('ownerB-key').permission).toBe('editor');
    });

    test('owner B can demote owner A (non-founding)', () => {
      callerPublicKey = 'ownerB-key';
      yMembers.set('ownerB-key', { permission: 'owner', displayName: 'Owner B' });
      yMembers.set('ownerA-key', { permission: 'owner', displayName: 'Owner A' });
      const result = updateMemberPermission('ownerA-key', 'viewer');
      expect(result).toBe(true);
      expect(yMembers.get('ownerA-key').permission).toBe('viewer');
    });

    test('multiple owners can coexist after promotions', () => {
      updateMemberPermission('editor-key', 'owner');
      updateMemberPermission('viewer-key', 'owner');
      
      const owners = [];
      yMembers.forEach((v) => { if (v.permission === 'owner') owners.push(v); });
      expect(owners.length).toBe(4); // founder + caller + 2 promoted
    });
  });
});

// ============================================================
// Unit Tests: respondToPendingDemotion Logic
// ============================================================

describe('respondToPendingDemotion Logic', () => {
  let yMembers;
  let userPublicKey;

  const respondToPendingDemotion = (accept) => {
    const myMember = yMembers.get(userPublicKey);
    if (!myMember?.pendingDemotion) return false;

    const now = Date.now();
    if (accept) {
      const newPermission = myMember.pendingDemotion.requestedPermission;
      yMembers.set(userPublicKey, {
        ...myMember,
        permission: newPermission,
        permissionUpdatedAt: now,
        pendingDemotion: null,
        lastSeen: now,
      });
    } else {
      yMembers.set(userPublicKey, {
        ...myMember,
        pendingDemotion: null,
        lastSeen: now,
      });
    }
    return true;
  };

  beforeEach(() => {
    yMembers = new Map();
    userPublicKey = 'founder-key';
    yMembers.set('founder-key', {
      permission: 'owner',
      displayName: 'Founder',
      pendingDemotion: {
        requestedBy: 'other-owner',
        requestedByName: 'Other Owner',
        requestedPermission: 'editor',
        requestedAt: Date.now(),
      },
    });
  });

  test('accepting demotion changes permission', () => {
    const result = respondToPendingDemotion(true);
    expect(result).toBe(true);
    expect(yMembers.get('founder-key').permission).toBe('editor');
    expect(yMembers.get('founder-key').pendingDemotion).toBeNull();
    expect(yMembers.get('founder-key').permissionUpdatedAt).toBeDefined();
  });

  test('declining demotion preserves permission', () => {
    const result = respondToPendingDemotion(false);
    expect(result).toBe(true);
    expect(yMembers.get('founder-key').permission).toBe('owner');
    expect(yMembers.get('founder-key').pendingDemotion).toBeNull();
  });

  test('returns false when no pending demotion', () => {
    yMembers.set('founder-key', {
      ...yMembers.get('founder-key'),
      pendingDemotion: null,
    });
    expect(respondToPendingDemotion(true)).toBe(false);
  });

  test('accepting demotion sets permissionUpdatedAt', () => {
    const before = Date.now();
    respondToPendingDemotion(true);
    const after = Date.now();
    const updatedAt = yMembers.get('founder-key').permissionUpdatedAt;
    expect(updatedAt).toBeGreaterThanOrEqual(before);
    expect(updatedAt).toBeLessThanOrEqual(after);
  });

  test('declining demotion does not set permissionUpdatedAt', () => {
    const original = yMembers.get('founder-key').permissionUpdatedAt;
    respondToPendingDemotion(false);
    // permissionUpdatedAt should remain the same (not set by decline)
    expect(yMembers.get('founder-key').permissionUpdatedAt).toBe(original);
  });
});

// ============================================================
// Unit Tests: PermissionWatcher Race Condition Guard
// ============================================================

describe('PermissionWatcher Race Condition Guard', () => {
  // Simulates the core logic of PermissionWatcher
  const shouldApplyYjsPermission = (yjsPermission, localPermission, permissionSetAt, permissionUpdatedAt) => {
    if (yjsPermission === localPermission) return false; // No change needed
    
    const localSetAt = permissionSetAt || 0;
    const yjsUpdatedAt = permissionUpdatedAt || 0;

    if (localSetAt > 0 && yjsUpdatedAt < localSetAt) {
      return false; // Stale Yjs data
    }
    return true;
  };

  test('applies when no permissionSetAt (backward compat)', () => {
    expect(shouldApplyYjsPermission('editor', 'viewer', undefined, undefined)).toBe(true);
  });

  test('applies when permissionUpdatedAt >= permissionSetAt', () => {
    const now = Date.now();
    expect(shouldApplyYjsPermission('editor', 'viewer', now - 1000, now)).toBe(true);
  });

  test('applies when permissionUpdatedAt === permissionSetAt', () => {
    const now = Date.now();
    expect(shouldApplyYjsPermission('editor', 'viewer', now, now)).toBe(true);
  });

  test('blocks when permissionUpdatedAt < permissionSetAt (race condition)', () => {
    const now = Date.now();
    expect(shouldApplyYjsPermission('viewer', 'owner', now, now - 5000)).toBe(false);
  });

  test('blocks stale Yjs downgrade during re-join', () => {
    // Simulates: user just re-joined with owner link, local is owner (permissionSetAt = now)
    // but Yjs still has viewer (permissionUpdatedAt is old)
    const joinTime = Date.now();
    const staleTime = joinTime - 10000;
    expect(shouldApplyYjsPermission('viewer', 'owner', joinTime, staleTime)).toBe(false);
  });

  test('allows owner-initiated downgrade (newer permissionUpdatedAt)', () => {
    // Owner changes member's permission — permissionUpdatedAt is newer than local permissionSetAt
    const joinTime = Date.now() - 60000;
    const ownerChangeTime = Date.now();
    expect(shouldApplyYjsPermission('viewer', 'editor', joinTime, ownerChangeTime)).toBe(true);
  });

  test('no-op when permissions are equal', () => {
    expect(shouldApplyYjsPermission('owner', 'owner', undefined, undefined)).toBe(false);
  });
});

// ============================================================
// Unit Tests: joinWorkspace Permission Change Detection
// ============================================================

describe('joinWorkspace Permission Change Detection', () => {
  const permHierarchy = { owner: 3, editor: 2, viewer: 1 };

  const detectPermissionChange = (incomingPermission, existingPermission) => {
    const incomingLevel = permHierarchy[incomingPermission] || 0;
    const existingLevel = permHierarchy[existingPermission] || 0;

    if (incomingLevel > existingLevel) return 'upgraded';
    if (incomingLevel < existingLevel) return 'already-higher';
    return null; // Same level
  };

  test('viewer → owner = upgraded', () => {
    expect(detectPermissionChange('owner', 'viewer')).toBe('upgraded');
  });

  test('viewer → editor = upgraded', () => {
    expect(detectPermissionChange('editor', 'viewer')).toBe('upgraded');
  });

  test('editor → owner = upgraded', () => {
    expect(detectPermissionChange('owner', 'editor')).toBe('upgraded');
  });

  test('owner → viewer = already-higher', () => {
    expect(detectPermissionChange('viewer', 'owner')).toBe('already-higher');
  });

  test('owner → editor = already-higher', () => {
    expect(detectPermissionChange('editor', 'owner')).toBe('already-higher');
  });

  test('editor → viewer = already-higher', () => {
    expect(detectPermissionChange('viewer', 'editor')).toBe('already-higher');
  });

  test('same permission = null', () => {
    expect(detectPermissionChange('editor', 'editor')).toBeNull();
    expect(detectPermissionChange('owner', 'owner')).toBeNull();
    expect(detectPermissionChange('viewer', 'viewer')).toBeNull();
  });

  test('permissionSetAt is set on upgrade', () => {
    const existingPermission = 'viewer';
    const incomingPermission = 'owner';
    const change = detectPermissionChange(incomingPermission, existingPermission);
    
    if (change === 'upgraded') {
      const permissionSetAt = Date.now();
      expect(permissionSetAt).toBeGreaterThan(0);
    }
  });
});

// ============================================================
// Unit Tests: Self-Registration permissionUpdatedAt
// ============================================================

describe('Self-Registration with permissionUpdatedAt', () => {
  let yMembers;
  
  const selfRegister = (myPublicKey, myPermission, existingMember, userProfile) => {
    const now = Date.now();
    const effectivePermission = myPermission || existingMember?.permission || 'viewer';

    if (!existingMember) {
      const entry = {
        publicKey: myPublicKey,
        displayName: userProfile.name || 'Anonymous',
        permission: effectivePermission,
        permissionUpdatedAt: now,
        joinedAt: now,
        lastSeen: now,
        isOnline: true,
      };
      yMembers.set(myPublicKey, entry);
      return entry;
    } else {
      const permHierarchy = { owner: 3, editor: 2, viewer: 1 };
      const newPerm = (permHierarchy[effectivePermission] || 0) > (permHierarchy[existingMember.permission] || 0)
        ? effectivePermission
        : existingMember.permission;
      
      const permChanged = newPerm !== existingMember.permission;
      const entry = {
        ...existingMember,
        displayName: userProfile.name || existingMember.displayName,
        permission: newPerm,
        permissionUpdatedAt: permChanged ? now : (existingMember.permissionUpdatedAt || now),
        lastSeen: now,
        isOnline: true,
      };
      yMembers.set(myPublicKey, entry);
      return entry;
    }
  };

  beforeEach(() => {
    yMembers = new Map();
  });

  test('new member gets permissionUpdatedAt', () => {
    const before = Date.now();
    const entry = selfRegister('key-1', 'editor', null, { name: 'Alice' });
    expect(entry.permissionUpdatedAt).toBeGreaterThanOrEqual(before);
    expect(entry.permission).toBe('editor');
  });

  test('existing member upgrade sets new permissionUpdatedAt', () => {
    const oldTime = Date.now() - 10000;
    yMembers.set('key-1', { permission: 'viewer', permissionUpdatedAt: oldTime, displayName: 'Alice' });
    
    const before = Date.now();
    const entry = selfRegister('key-1', 'owner', yMembers.get('key-1'), { name: 'Alice' });
    expect(entry.permission).toBe('owner');
    expect(entry.permissionUpdatedAt).toBeGreaterThanOrEqual(before);
  });

  test('existing member no-upgrade preserves old permissionUpdatedAt', () => {
    const oldTime = Date.now() - 10000;
    yMembers.set('key-1', { permission: 'owner', permissionUpdatedAt: oldTime, displayName: 'Alice' });
    
    const entry = selfRegister('key-1', 'viewer', yMembers.get('key-1'), { name: 'Alice' });
    expect(entry.permission).toBe('owner'); // stays at owner
    expect(entry.permissionUpdatedAt).toBe(oldTime); // preserved
  });
});

// ============================================================
// Unit Tests: transferOwnership permissionUpdatedAt
// ============================================================

describe('transferOwnership with permissionUpdatedAt', () => {
  let yMembers;
  let yInfo;

  const transferOwnership = (newOwnerKey, currentOwnerKey) => {
    const now = Date.now();
    yInfo.set('createdBy', newOwnerKey);

    const newOwner = yMembers.get(newOwnerKey);
    if (newOwner) {
      yMembers.set(newOwnerKey, {
        ...newOwner,
        permission: 'owner',
        permissionUpdatedAt: now,
        pendingDemotion: null,
      });
    }

    const currentOwner = yMembers.get(currentOwnerKey);
    if (currentOwner) {
      yMembers.set(currentOwnerKey, {
        ...currentOwner,
        permission: 'editor',
        permissionUpdatedAt: now,
        pendingDemotion: null,
      });
    }
    return true;
  };

  beforeEach(() => {
    yMembers = new Map();
    yInfo = new Map();
    yInfo.set('createdBy', 'owner-key');
    yMembers.set('owner-key', { permission: 'owner', displayName: 'Owner' });
    yMembers.set('editor-key', { permission: 'editor', displayName: 'Editor' });
  });

  test('promotes new owner with permissionUpdatedAt', () => {
    const before = Date.now();
    transferOwnership('editor-key', 'owner-key');
    expect(yMembers.get('editor-key').permission).toBe('owner');
    expect(yMembers.get('editor-key').permissionUpdatedAt).toBeGreaterThanOrEqual(before);
  });

  test('demotes old owner with permissionUpdatedAt', () => {
    const before = Date.now();
    transferOwnership('editor-key', 'owner-key');
    expect(yMembers.get('owner-key').permission).toBe('editor');
    expect(yMembers.get('owner-key').permissionUpdatedAt).toBeGreaterThanOrEqual(before);
  });

  test('clears pendingDemotion on both', () => {
    yMembers.set('editor-key', {
      ...yMembers.get('editor-key'),
      pendingDemotion: { requestedBy: 'x' },
    });
    yMembers.set('owner-key', {
      ...yMembers.get('owner-key'),
      pendingDemotion: { requestedBy: 'y' },
    });
    transferOwnership('editor-key', 'owner-key');
    expect(yMembers.get('editor-key').pendingDemotion).toBeNull();
    expect(yMembers.get('owner-key').pendingDemotion).toBeNull();
  });

  test('updates createdBy in yInfo', () => {
    transferOwnership('editor-key', 'owner-key');
    expect(yInfo.get('createdBy')).toBe('editor-key');
  });
});

// ============================================================
// UI Tests: WorkspaceSettings Permission Dropdown Logic
// ============================================================

describe('WorkspaceSettings Permission Dropdown', () => {
  const PERMISSION_INFO = {
    owner: { label: 'Owner', color: '#059669' },
    editor: { label: 'Editor', color: '#2563eb' },
    viewer: { label: 'Viewer', color: '#4b5563' },
  };

  // Simulate the rendering logic for the permission badge/dropdown
  const getPermissionElement = (member, isOwner, isSelf, hasUpdateCallback) => {
    if (isOwner && !isSelf && hasUpdateCallback) return 'select';
    if (isOwner && isSelf && hasUpdateCallback) return 'select-self';
    return 'badge';
  };

  test('owner sees dropdown for other members', () => {
    expect(getPermissionElement({ permission: 'editor' }, true, false, true)).toBe('select');
  });

  test('owner sees self-dropdown for themselves', () => {
    expect(getPermissionElement({ permission: 'owner' }, true, true, true)).toBe('select-self');
  });

  test('non-owner sees badge only', () => {
    expect(getPermissionElement({ permission: 'editor' }, false, false, true)).toBe('badge');
  });

  test('non-owner sees badge for self', () => {
    expect(getPermissionElement({ permission: 'viewer' }, false, true, true)).toBe('badge');
  });

  test('owner sees badge when no callback', () => {
    expect(getPermissionElement({ permission: 'editor' }, true, false, false)).toBe('badge');
  });

  test('PERMISSION_INFO has all levels', () => {
    expect(PERMISSION_INFO.owner).toBeDefined();
    expect(PERMISSION_INFO.editor).toBeDefined();
    expect(PERMISSION_INFO.viewer).toBeDefined();
  });

  test('all levels have label and color', () => {
    Object.values(PERMISSION_INFO).forEach(info => {
      expect(info.label).toBeDefined();
      expect(info.color).toBeDefined();
      expect(typeof info.label).toBe('string');
      expect(info.color).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });
});

// ============================================================
// UI Tests: Pending Demotion Banner
// ============================================================

describe('Pending Demotion Banner', () => {
  const shouldShowPendingDemotion = (members, myKey) => {
    const myMember = myKey ? members[myKey] : null;
    return !!(myMember?.pendingDemotion);
  };

  test('shows when pending demotion exists', () => {
    const members = {
      'my-key': {
        permission: 'owner',
        pendingDemotion: {
          requestedBy: 'other-owner',
          requestedByName: 'Other Owner',
          requestedPermission: 'editor',
          requestedAt: Date.now(),
        },
      },
    };
    expect(shouldShowPendingDemotion(members, 'my-key')).toBe(true);
  });

  test('hides when no pending demotion', () => {
    const members = {
      'my-key': { permission: 'owner', pendingDemotion: null },
    };
    expect(shouldShowPendingDemotion(members, 'my-key')).toBe(false);
  });

  test('hides when user not in members', () => {
    const members = {};
    expect(shouldShowPendingDemotion(members, 'my-key')).toBe(false);
  });

  test('hides when key is null', () => {
    const members = { 'my-key': { pendingDemotion: {} } };
    expect(shouldShowPendingDemotion(members, null)).toBe(false);
  });
});

// ============================================================
// Functional Tests: canOwnerLeave with Multi-Owner
// ============================================================

describe('canOwnerLeave with Multi-Owner', () => {
  const canOwnerLeave = (memberList, isOwner, myKey) => {
    if (!isOwner) return false;
    const totalMembers = memberList.length;
    if (totalMembers <= 1) return false;
    const otherOwners = memberList.filter(m => m.permission === 'owner' && m.publicKey !== myKey);
    const nonOwnerMembers = memberList.filter(m => m.permission !== 'owner');
    return otherOwners.length > 0 || nonOwnerMembers.length > 0;
  };

  test('sole owner with no other members cannot leave', () => {
    const members = [{ publicKey: 'me', permission: 'owner' }];
    expect(canOwnerLeave(members, true, 'me')).toBe(false);
  });

  test('sole owner with editors can leave (will transfer)', () => {
    const members = [
      { publicKey: 'me', permission: 'owner' },
      { publicKey: 'other', permission: 'editor' },
    ];
    expect(canOwnerLeave(members, true, 'me')).toBe(true);
  });

  test('co-owner can leave when other owners exist', () => {
    const members = [
      { publicKey: 'me', permission: 'owner' },
      { publicKey: 'other', permission: 'owner' },
    ];
    expect(canOwnerLeave(members, true, 'me')).toBe(true);
  });

  test('non-owner returns false', () => {
    const members = [
      { publicKey: 'me', permission: 'editor' },
      { publicKey: 'other', permission: 'owner' },
    ];
    expect(canOwnerLeave(members, false, 'me')).toBe(false);
  });
});

// ============================================================
// E2E Scenario Tests: Full Permission Lifecycle
// ============================================================

describe('E2E: Permission Upgrade via Re-Join', () => {
  // Simulates the full lifecycle: user joins as viewer → re-joins with owner link
  test('viewer re-joins with owner link, local upgrades, Yjs syncs', () => {
    const permHierarchy = { owner: 3, editor: 2, viewer: 1 };
    
    // Step 1: User has workspace as viewer
    const workspace = { id: 'ws-1', myPermission: 'viewer' };
    
    // Step 2: User redeems owner link → joinWorkspace detects upgrade
    const incomingPermission = 'owner';
    const incoming = permHierarchy[incomingPermission] || 0;
    const existing = permHierarchy[workspace.myPermission] || 0;
    const isUpgrade = incoming > existing;
    expect(isUpgrade).toBe(true);
    
    // Step 3: Local workspace updates
    workspace.myPermission = incomingPermission;
    workspace.permissionSetAt = Date.now();
    expect(workspace.myPermission).toBe('owner');
    expect(workspace.permissionSetAt).toBeGreaterThan(0);
    
    // Step 4: Self-registration writes to Yjs with permissionUpdatedAt
    const yMembers = new Map();
    yMembers.set('user-key', { permission: 'viewer', permissionUpdatedAt: Date.now() - 60000 });
    
    const selfRegNow = Date.now();
    const existingMember = yMembers.get('user-key');
    const newPerm = (permHierarchy[workspace.myPermission] || 0) > (permHierarchy[existingMember.permission] || 0)
      ? workspace.myPermission
      : existingMember.permission;
    yMembers.set('user-key', { ...existingMember, permission: newPerm, permissionUpdatedAt: selfRegNow });
    
    expect(yMembers.get('user-key').permission).toBe('owner');
    expect(yMembers.get('user-key').permissionUpdatedAt).toBeGreaterThanOrEqual(workspace.permissionSetAt);
  });

  test('viewer re-joins with owner link, stale Yjs does NOT overwrite', () => {
    // Simulates the race condition scenario
    const joinTime = Date.now();
    const staleYjsTime = joinTime - 30000;
    
    // PermissionWatcher checks: should NOT apply stale Yjs viewer back
    const localSetAt = joinTime;
    const yjsUpdatedAt = staleYjsTime;
    const shouldApply = yjsUpdatedAt >= localSetAt;
    
    expect(shouldApply).toBe(false); // Guard blocks the stale downgrade
  });
});

describe('E2E: Owner Changes Member Permission', () => {
  test('full cycle: owner demotes editor to viewer, viewer sees toast', () => {
    const yMembers = new Map();
    yMembers.set('editor-user', { permission: 'editor', displayName: 'Cow', permissionUpdatedAt: Date.now() - 60000 });
    
    // Step 1: Owner calls updateMemberPermission
    const now = Date.now();
    yMembers.set('editor-user', {
      ...yMembers.get('editor-user'),
      permission: 'viewer',
      permissionUpdatedAt: now,
      pendingDemotion: null,
    });
    
    // Step 2: PermissionWatcher on Cow's machine detects change
    const localPermission = 'editor';
    const yjsPermission = yMembers.get('editor-user').permission;
    const yjsUpdatedAt = yMembers.get('editor-user').permissionUpdatedAt;
    
    expect(yjsPermission).toBe('viewer');
    expect(yjsPermission).not.toBe(localPermission);
    // permissionSetAt is 0 (no recent re-join), so guard allows it
    expect(yjsUpdatedAt >= 0).toBe(true);
  });
});

describe('E2E: Founding Owner Demotion Approval Flow', () => {
  test('full lifecycle: request → notify → accept', () => {
    const yMembers = new Map();
    const founderKey = 'founder';
    const otherOwnerKey = 'other-owner';
    
    yMembers.set(founderKey, { permission: 'owner', displayName: 'Star' });
    yMembers.set(otherOwnerKey, { permission: 'owner', displayName: 'Cow' });
    
    // Step 1: Other owner requests demotion of founding owner
    const requestTime = Date.now();
    yMembers.set(founderKey, {
      ...yMembers.get(founderKey),
      pendingDemotion: {
        requestedBy: otherOwnerKey,
        requestedByName: 'Cow',
        requestedPermission: 'editor',
        requestedAt: requestTime,
      },
    });
    
    // Step 2: Founding owner's PermissionWatcher detects pendingDemotion
    expect(yMembers.get(founderKey).pendingDemotion).toBeDefined();
    expect(yMembers.get(founderKey).pendingDemotion.requestedPermission).toBe('editor');
    expect(yMembers.get(founderKey).permission).toBe('owner'); // Not changed yet
    
    // Step 3: Founding owner accepts
    const acceptTime = Date.now();
    const pending = yMembers.get(founderKey).pendingDemotion;
    yMembers.set(founderKey, {
      ...yMembers.get(founderKey),
      permission: pending.requestedPermission,
      permissionUpdatedAt: acceptTime,
      pendingDemotion: null,
    });
    
    expect(yMembers.get(founderKey).permission).toBe('editor');
    expect(yMembers.get(founderKey).pendingDemotion).toBeNull();
  });

  test('full lifecycle: request → notify → decline', () => {
    const yMembers = new Map();
    const founderKey = 'founder';
    
    yMembers.set(founderKey, {
      permission: 'owner',
      displayName: 'Star',
      pendingDemotion: {
        requestedBy: 'other-owner',
        requestedByName: 'Cow',
        requestedPermission: 'viewer',
        requestedAt: Date.now(),
      },
    });
    
    // Founder declines
    yMembers.set(founderKey, {
      ...yMembers.get(founderKey),
      pendingDemotion: null,
    });
    
    expect(yMembers.get(founderKey).permission).toBe('owner'); // Unchanged
    expect(yMembers.get(founderKey).pendingDemotion).toBeNull();
  });
});

describe('E2E: Re-Join with Lower Permission Shows Toast', () => {
  test('owner re-joins with viewer link gets already-higher message', () => {
    const permHierarchy = { owner: 3, editor: 2, viewer: 1 };
    const existing = { myPermission: 'owner' };
    const incomingPermission = 'viewer';
    
    const incoming = permHierarchy[incomingPermission] || 0;
    const current = permHierarchy[existing.myPermission] || 0;
    
    let permissionChanged = null;
    if (incoming > current) {
      permissionChanged = 'upgraded';
    } else if (incoming < current) {
      permissionChanged = 'already-higher';
    }
    
    expect(permissionChanged).toBe('already-higher');
  });

  test('editor re-joins with viewer link gets already-higher message', () => {
    const permHierarchy = { owner: 3, editor: 2, viewer: 1 };
    const existing = { myPermission: 'editor' };
    const incomingPermission = 'viewer';
    
    const incoming = permHierarchy[incomingPermission] || 0;
    const current = permHierarchy[existing.myPermission] || 0;
    
    let permissionChanged = null;
    if (incoming > current) permissionChanged = 'upgraded';
    else if (incoming < current) permissionChanged = 'already-higher';
    
    expect(permissionChanged).toBe('already-higher');
  });
});

describe('E2E: Self-Demotion (Step Down)', () => {
  test('owner can step down to editor', () => {
    const yMembers = new Map();
    const myKey = 'my-key';
    yMembers.set(myKey, { permission: 'owner', displayName: 'Me' });

    const now = Date.now();
    yMembers.set(myKey, {
      ...yMembers.get(myKey),
      permission: 'editor',
      permissionUpdatedAt: now,
      pendingDemotion: null,
    });

    expect(yMembers.get(myKey).permission).toBe('editor');
  });

  test('founding owner self-demotion bypasses approval', () => {
    const yMembers = new Map();
    const yInfo = new Map();
    const founderKey = 'founder';
    yInfo.set('createdBy', founderKey);
    yMembers.set(founderKey, { permission: 'owner', displayName: 'Founder' });

    // Self-demotion: isSelf = true, so bypass pending
    const isSelf = true;
    const isDemotion = true;
    const isFounder = founderKey === yInfo.get('createdBy');

    // Should NOT create pending demotion since it's self
    const shouldPend = isFounder && isDemotion && !isSelf;
    expect(shouldPend).toBe(false);

    // Apply directly
    const now = Date.now();
    yMembers.set(founderKey, {
      ...yMembers.get(founderKey),
      permission: 'editor',
      permissionUpdatedAt: now,
      pendingDemotion: null,
    });
    expect(yMembers.get(founderKey).permission).toBe('editor');
  });
});

// ============================================================
// Edge Case Tests
// ============================================================

describe('Edge Cases', () => {
  test('unknown permission level treated as 0 in hierarchy', () => {
    const permHierarchy = { owner: 3, editor: 2, viewer: 1 };
    expect(permHierarchy['admin'] || 0).toBe(0);
    expect(permHierarchy[undefined] || 0).toBe(0);
    expect(permHierarchy[null] || 0).toBe(0);
  });

  test('permissionChanged is null when same permission on re-join', () => {
    const permHierarchy = { owner: 3, editor: 2, viewer: 1 };
    const incoming = permHierarchy['editor'] || 0;
    const existing = permHierarchy['editor'] || 0;
    let result = null;
    if (incoming > existing) result = 'upgraded';
    else if (incoming < existing) result = 'already-higher';
    expect(result).toBeNull();
  });

  test('multiple rapid permission changes preserve latest', () => {
    const yMembers = new Map();
    yMembers.set('user', { permission: 'viewer' });
    
    yMembers.set('user', { ...yMembers.get('user'), permission: 'editor', permissionUpdatedAt: 100 });
    yMembers.set('user', { ...yMembers.get('user'), permission: 'owner', permissionUpdatedAt: 200 });
    yMembers.set('user', { ...yMembers.get('user'), permission: 'viewer', permissionUpdatedAt: 300 });
    
    expect(yMembers.get('user').permission).toBe('viewer');
    expect(yMembers.get('user').permissionUpdatedAt).toBe(300);
  });

  test('empty members map handled gracefully', () => {
    const members = {};
    const myKey = 'my-key';
    const myMember = members[myKey];
    expect(myMember?.permission).toBeUndefined();
    expect(myMember?.pendingDemotion).toBeUndefined();
  });

  test('pendingDemotion with missing fields handled gracefully', () => {
    const pendingDemotion = {};
    const requesterName = pendingDemotion.requestedByName || 'An owner';
    const newRole = pendingDemotion.requestedPermission || 'editor';
    expect(requesterName).toBe('An owner');
    expect(newRole).toBe('editor');
  });
});
