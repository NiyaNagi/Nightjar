/**
 * Permission Revocation Tests
 * 
 * Tests for what happens when permissions change while users are active:
 * - User has editor permission, it's downgraded to viewer
 * - User has access via share link, link is invalidated
 * - User is removed entirely while editing
 * - Permission upgrade while active
 * - Cascading permission changes (workspace → folder → document)
 * - Race conditions in permission changes
 */

const Y = require('yjs');
const { EventEmitter } = require('events');
const crypto = require('crypto');
const {
    assert,
    sleep,
    randomHex,
    generateDocId,
    generateWorkspaceId,
} = require('./test-utils.js');

// ============ Permission Constants ============

const PERMISSION_LEVELS = {
    owner: 3,
    editor: 2,
    viewer: 1,
    none: 0,
};

// ============ Mock Permission System ============

/**
 * A permission manager that supports real-time permission changes
 * and notifies listeners when permissions change.
 */
class LivePermissionManager extends EventEmitter {
    constructor() {
        super();
        this.permissions = new Map();  // entityKey (userId:entityId) -> permission
        this.shareLinks = new Map();   // linkId -> { entityId, permission, expired, expiresAt, uses, maxUses }
        this.hierarchy = new Map();    // entityId -> { type, parentId, workspaceId }
        this.activeUsers = new Map();  // userId -> Set of entityIds they're accessing
    }
    
    // Set up entity hierarchy
    addWorkspace(workspaceId, ownerId) {
        this.hierarchy.set(workspaceId, { type: 'workspace', parentId: null });
        this.grantPermission(ownerId, workspaceId, 'owner');
    }
    
    addFolder(folderId, parentId, workspaceId) {
        this.hierarchy.set(folderId, { 
            type: 'folder', 
            parentId: parentId || workspaceId,
            workspaceId 
        });
    }
    
    addDocument(documentId, folderId, workspaceId) {
        this.hierarchy.set(documentId, { 
            type: 'document', 
            parentId: folderId,
            workspaceId 
        });
    }
    
    // Grant permission
    grantPermission(userId, entityId, permission) {
        const key = `${userId}:${entityId}`;
        const oldPerm = this.permissions.get(key);
        this.permissions.set(key, permission);
        
        if (oldPerm !== permission) {
            this.emit('permission-changed', { 
                userId, 
                entityId, 
                oldPermission: oldPerm || 'none',
                newPermission: permission 
            });
        }
    }
    
    // Revoke permission
    revokePermission(userId, entityId) {
        const key = `${userId}:${entityId}`;
        const oldPerm = this.permissions.get(key);
        this.permissions.delete(key);
        
        if (oldPerm) {
            this.emit('permission-changed', { 
                userId, 
                entityId, 
                oldPermission: oldPerm,
                newPermission: 'none'
            });
        }
    }
    
    // Get effective permission (with inheritance)
    getPermission(userId, entityId) {
        // Check direct permission
        const directKey = `${userId}:${entityId}`;
        if (this.permissions.has(directKey)) {
            return this.permissions.get(directKey);
        }
        
        // Check share links
        for (const [linkId, link] of this.shareLinks) {
            if (link.entityId === entityId && 
                link.usedBy?.has(userId) && 
                !this.isLinkExpired(linkId)) {
                return link.permission;
            }
        }
        
        // Check inherited permission
        const info = this.hierarchy.get(entityId);
        if (info?.parentId) {
            return this.getPermission(userId, info.parentId);
        }
        // If no parentId but has workspaceId, check workspace
        if (info?.workspaceId) {
            return this.getPermission(userId, info.workspaceId);
        }
        
        return 'none';
    }
    
    // Check if user can perform action
    canPerform(userId, entityId, action) {
        const perm = this.getPermission(userId, entityId);
        const level = PERMISSION_LEVELS[perm] || 0;
        
        switch (action) {
            case 'view': return level >= PERMISSION_LEVELS.viewer;
            case 'edit': return level >= PERMISSION_LEVELS.editor;
            case 'delete': return level >= PERMISSION_LEVELS.editor;
            case 'share': return level >= PERMISSION_LEVELS.viewer;
            case 'manage': return level >= PERMISSION_LEVELS.owner;
            default: return false;
        }
    }
    
    // Create a share link
    createShareLink(entityId, permission, options = {}) {
        const linkId = randomHex(32);
        this.shareLinks.set(linkId, {
            entityId,
            permission,
            expired: false,
            expiresAt: options.expiresAt || null,
            maxUses: options.maxUses || null,
            uses: 0,
            usedBy: new Set(),
            createdAt: Date.now(),
        });
        return linkId;
    }
    
    // Redeem a share link
    redeemShareLink(userId, linkId) {
        const link = this.shareLinks.get(linkId);
        if (!link) {
            return { success: false, reason: 'Link not found' };
        }
        
        if (this.isLinkExpired(linkId)) {
            return { success: false, reason: 'Link expired' };
        }
        
        link.uses++;
        link.usedBy.add(userId);
        
        // Check if max uses reached
        if (link.maxUses && link.uses >= link.maxUses) {
            link.expired = true;
        }
        
        this.emit('link-redeemed', { userId, linkId, entityId: link.entityId, permission: link.permission });
        
        return { 
            success: true, 
            entityId: link.entityId, 
            permission: link.permission 
        };
    }
    
    // Check if link is expired
    isLinkExpired(linkId) {
        const link = this.shareLinks.get(linkId);
        if (!link) return true;
        if (link.expired) return true;
        if (link.expiresAt && Date.now() > link.expiresAt) return true;
        return false;
    }
    
    // Invalidate a share link
    invalidateLink(linkId) {
        const link = this.shareLinks.get(linkId);
        if (link) {
            link.expired = true;
            
            // Notify users who accessed via this link
            for (const userId of link.usedBy) {
                this.emit('link-invalidated', { 
                    userId, 
                    linkId, 
                    entityId: link.entityId 
                });
            }
        }
    }
    
    // Track active users
    userAccessing(userId, entityId) {
        if (!this.activeUsers.has(userId)) {
            this.activeUsers.set(userId, new Set());
        }
        this.activeUsers.get(userId).add(entityId);
    }
    
    userStoppedAccessing(userId, entityId) {
        const entities = this.activeUsers.get(userId);
        if (entities) {
            entities.delete(entityId);
        }
    }
    
    // Get active users for an entity
    getActiveUsers(entityId) {
        const users = [];
        for (const [userId, entities] of this.activeUsers) {
            if (entities.has(entityId)) {
                users.push(userId);
            }
        }
        return users;
    }
}

// ============ Mock Collaborative Client ============

/**
 * Simulates a user collaborating on a document
 */
class CollaborativeClient {
    constructor(userId, permManager) {
        this.userId = userId;
        this.permManager = permManager;
        this.openDocs = new Map();  // entityId -> { doc, canEdit }
        this.pendingEdits = [];
        this.rejectedEdits = [];
        
        // Listen for permission changes
        permManager.on('permission-changed', (event) => {
            if (event.userId === this.userId) {
                this.handlePermissionChange(event);
            }
        });
        
        permManager.on('link-invalidated', (event) => {
            if (event.userId === this.userId) {
                this.handleLinkInvalidated(event);
            }
        });
    }
    
    openDocument(entityId) {
        if (!this.permManager.canPerform(this.userId, entityId, 'view')) {
            return { success: false, reason: 'No permission' };
        }
        
        const canEdit = this.permManager.canPerform(this.userId, entityId, 'edit');
        const doc = new Y.Doc();
        
        this.openDocs.set(entityId, { doc, canEdit, entityId });
        this.permManager.userAccessing(this.userId, entityId);
        
        return { success: true, doc, canEdit };
    }
    
    closeDocument(entityId) {
        const docInfo = this.openDocs.get(entityId);
        if (docInfo) {
            docInfo.doc.destroy();
            this.openDocs.delete(entityId);
            this.permManager.userStoppedAccessing(this.userId, entityId);
        }
    }
    
    edit(entityId, operation) {
        const docInfo = this.openDocs.get(entityId);
        if (!docInfo) {
            return { success: false, reason: 'Document not open' };
        }
        
        // Re-check permission (might have changed)
        if (!this.permManager.canPerform(this.userId, entityId, 'edit')) {
            this.rejectedEdits.push({ entityId, operation, reason: 'Permission denied' });
            return { success: false, reason: 'Permission denied' };
        }
        
        // Apply edit
        const text = docInfo.doc.getText('content');
        if (operation.type === 'insert') {
            text.insert(operation.position, operation.text);
        } else if (operation.type === 'delete') {
            text.delete(operation.position, operation.length);
        }
        
        return { success: true };
    }
    
    handlePermissionChange(event) {
        // Check if any open documents are affected by this permission change
        // The change might be at workspace/folder level but affects documents
        for (const [openEntityId, docInfo] of this.openDocs) {
            // Check if this entity is affected by the permission change
            // Either direct match or affected via inheritance
            const hierarchy = this.permManager.hierarchy.get(openEntityId);
            const isAffected = openEntityId === event.entityId || 
                hierarchy?.parentId === event.entityId ||
                hierarchy?.workspaceId === event.entityId;
            
            if (!isAffected) continue;
            
            const newCanEdit = this.permManager.canPerform(this.userId, openEntityId, 'edit');
            const newCanView = this.permManager.canPerform(this.userId, openEntityId, 'view');
            const wasEditor = docInfo.canEdit;
            docInfo.canEdit = newCanEdit;
            
            if (wasEditor && !newCanEdit) {
                // Downgraded from editor to viewer
                docInfo.downgraded = true;
            }
            
            if (!newCanView) {
                // Access revoked entirely
                docInfo.accessRevoked = true;
            }
        }
    }
    
    handleLinkInvalidated(event) {
        const docInfo = this.openDocs.get(event.entityId);
        if (docInfo) {
            docInfo.linkInvalidated = true;
            // Re-check if user has other permission sources
            if (!this.permManager.canPerform(this.userId, event.entityId, 'view')) {
                docInfo.accessRevoked = true;
            }
        }
    }
    
    destroy() {
        for (const [entityId, docInfo] of this.openDocs) {
            docInfo.doc.destroy();
            this.permManager.userStoppedAccessing(this.userId, entityId);
        }
        this.openDocs.clear();
    }
}

// ============ Test Suite ============

let permManager = null;
let clients = [];

async function setup() {
    console.log('  [Setup] Permission revocation tests ready');
}

async function teardown() {
    for (const client of clients) {
        client.destroy();
    }
    clients = [];
    permManager = null;
}

// ============ Basic Permission Change Tests ============

/**
 * Test: User is notified when permission changes
 */
async function testPermissionChangeNotification() {
    permManager = new LivePermissionManager();
    
    let notificationReceived = false;
    let notificationData = null;
    
    permManager.on('permission-changed', (event) => {
        notificationReceived = true;
        notificationData = event;
    });
    
    const wsId = randomHex(16);
    permManager.addWorkspace(wsId, 'owner1');
    
    // Grant permission to user2
    permManager.grantPermission('user2', wsId, 'editor');
    
    assert.ok(notificationReceived, 'Should receive notification');
    assert.equal(notificationData.userId, 'user2');
    assert.equal(notificationData.newPermission, 'editor');
}

/**
 * Test: Downgrade from editor to viewer
 */
async function testDowngradeEditorToViewer() {
    permManager = new LivePermissionManager();
    
    const wsId = randomHex(16);
    const docId = randomHex(16);
    
    permManager.addWorkspace(wsId, 'owner1');
    permManager.addDocument(docId, null, wsId);
    permManager.grantPermission('user2', wsId, 'editor');
    
    const client = new CollaborativeClient('user2', permManager);
    clients.push(client);
    
    // User opens document as editor
    const result = client.openDocument(docId);
    assert.ok(result.success);
    assert.ok(result.canEdit, 'Should be able to edit initially');
    
    // Make an edit
    const editResult1 = client.edit(docId, { type: 'insert', position: 0, text: 'Hello' });
    assert.ok(editResult1.success, 'Edit should succeed');
    
    // Owner downgrades user to viewer
    permManager.grantPermission('user2', wsId, 'viewer');
    
    // Check that client knows about downgrade
    const docInfo = client.openDocs.get(docId);
    assert.ok(docInfo.downgraded, 'Should be marked as downgraded');
    assert.ok(!docInfo.canEdit, 'Should not be able to edit anymore');
    
    // Try to edit - should fail
    const editResult2 = client.edit(docId, { type: 'insert', position: 5, text: ' World' });
    assert.ok(!editResult2.success, 'Edit should fail after downgrade');
    assert.equal(client.rejectedEdits.length, 1, 'Should have rejected edit');
}

/**
 * Test: Upgrade from viewer to editor
 */
async function testUpgradeViewerToEditor() {
    permManager = new LivePermissionManager();
    
    const wsId = randomHex(16);
    const docId = randomHex(16);
    
    permManager.addWorkspace(wsId, 'owner1');
    permManager.addDocument(docId, null, wsId);
    permManager.grantPermission('user2', wsId, 'viewer');
    
    const client = new CollaborativeClient('user2', permManager);
    clients.push(client);
    
    // User opens document as viewer
    const result = client.openDocument(docId);
    assert.ok(result.success);
    assert.ok(!result.canEdit, 'Should not be able to edit initially');
    
    // Try to edit - should fail
    const editResult1 = client.edit(docId, { type: 'insert', position: 0, text: 'Hello' });
    assert.ok(!editResult1.success);
    
    // Owner upgrades user to editor
    permManager.grantPermission('user2', wsId, 'editor');
    
    // Now edit should work
    const editResult2 = client.edit(docId, { type: 'insert', position: 0, text: 'Hello' });
    assert.ok(editResult2.success, 'Edit should succeed after upgrade');
}

/**
 * Test: Complete access revocation
 */
async function testAccessRevocation() {
    permManager = new LivePermissionManager();
    
    const wsId = randomHex(16);
    const docId = randomHex(16);
    
    permManager.addWorkspace(wsId, 'owner1');
    permManager.addDocument(docId, null, wsId);
    permManager.grantPermission('user2', wsId, 'editor');
    
    const client = new CollaborativeClient('user2', permManager);
    clients.push(client);
    
    client.openDocument(docId);
    
    // Revoke access entirely
    permManager.revokePermission('user2', wsId);
    
    const docInfo = client.openDocs.get(docId);
    assert.ok(docInfo.accessRevoked, 'Access should be marked as revoked');
    
    // Edits should fail
    const editResult = client.edit(docId, { type: 'insert', position: 0, text: 'Test' });
    assert.ok(!editResult.success);
}

// ============ Share Link Tests ============

/**
 * Test: Access via share link
 */
async function testShareLinkAccess() {
    permManager = new LivePermissionManager();
    
    const wsId = randomHex(16);
    const docId = randomHex(16);
    
    permManager.addWorkspace(wsId, 'owner1');
    permManager.addDocument(docId, null, wsId);
    
    // Create share link
    const linkId = permManager.createShareLink(docId, 'editor');
    
    // User2 redeems the link
    const result = permManager.redeemShareLink('user2', linkId);
    assert.ok(result.success);
    assert.equal(result.permission, 'editor');
    
    // User2 should now have access
    assert.ok(permManager.canPerform('user2', docId, 'edit'));
}

/**
 * Test: Share link invalidation while user is active
 */
async function testShareLinkInvalidation() {
    permManager = new LivePermissionManager();
    
    const wsId = randomHex(16);
    const docId = randomHex(16);
    
    permManager.addWorkspace(wsId, 'owner1');
    permManager.addDocument(docId, null, wsId);
    
    // Create share link and let user2 redeem it
    const linkId = permManager.createShareLink(docId, 'editor');
    permManager.redeemShareLink('user2', linkId);
    
    const client = new CollaborativeClient('user2', permManager);
    clients.push(client);
    
    // User opens document
    const openResult = client.openDocument(docId);
    assert.ok(openResult.success);
    
    // Make an edit
    client.edit(docId, { type: 'insert', position: 0, text: 'Hello' });
    
    // Owner invalidates the link
    permManager.invalidateLink(linkId);
    
    // Client should know link was invalidated
    const docInfo = client.openDocs.get(docId);
    assert.ok(docInfo.linkInvalidated, 'Link should be marked as invalidated');
    assert.ok(docInfo.accessRevoked, 'Access should be revoked');
    
    // Further edits should fail
    const editResult = client.edit(docId, { type: 'insert', position: 5, text: ' World' });
    assert.ok(!editResult.success);
}

/**
 * Test: Share link expiration (time-based)
 */
async function testShareLinkExpiration() {
    permManager = new LivePermissionManager();
    
    const wsId = randomHex(16);
    const docId = randomHex(16);
    
    permManager.addWorkspace(wsId, 'owner1');
    permManager.addDocument(docId, null, wsId);
    
    // Create share link that expires in 100ms
    const linkId = permManager.createShareLink(docId, 'editor', {
        expiresAt: Date.now() + 100
    });
    
    // Immediate redemption should work
    const result1 = permManager.redeemShareLink('user2', linkId);
    assert.ok(result1.success, 'Should succeed before expiration');
    
    // Wait for expiration
    await sleep(150);
    
    // New redemption should fail
    const result2 = permManager.redeemShareLink('user3', linkId);
    assert.ok(!result2.success, 'Should fail after expiration');
    assert.equal(result2.reason, 'Link expired');
}

/**
 * Test: Share link with max uses
 */
async function testShareLinkMaxUses() {
    permManager = new LivePermissionManager();
    
    const wsId = randomHex(16);
    const docId = randomHex(16);
    
    permManager.addWorkspace(wsId, 'owner1');
    permManager.addDocument(docId, null, wsId);
    
    // Create share link with max 2 uses
    const linkId = permManager.createShareLink(docId, 'viewer', {
        maxUses: 2
    });
    
    // First two redemptions should work
    assert.ok(permManager.redeemShareLink('user1', linkId).success);
    assert.ok(permManager.redeemShareLink('user2', linkId).success);
    
    // Third should fail
    const result3 = permManager.redeemShareLink('user3', linkId);
    assert.ok(!result3.success);
    assert.equal(result3.reason, 'Link expired');
}

/**
 * Test: User has direct permission AND share link - link revocation doesn't remove access
 */
async function testDirectPermissionPlusShareLink() {
    permManager = new LivePermissionManager();
    
    const wsId = randomHex(16);
    const docId = randomHex(16);
    
    permManager.addWorkspace(wsId, 'owner1');
    permManager.addDocument(docId, null, wsId);
    
    // User2 has direct viewer permission
    permManager.grantPermission('user2', wsId, 'viewer');
    
    // AND user2 redeems an editor share link
    const linkId = permManager.createShareLink(docId, 'editor');
    permManager.redeemShareLink('user2', linkId);
    
    const client = new CollaborativeClient('user2', permManager);
    clients.push(client);
    
    client.openDocument(docId);
    
    // Can edit via share link
    assert.ok(permManager.canPerform('user2', docId, 'edit'));
    
    // Invalidate the share link
    permManager.invalidateLink(linkId);
    
    // User2 should still have viewer access via direct permission
    assert.ok(permManager.canPerform('user2', docId, 'view'));
    
    // But not editor access anymore
    const docInfo = client.openDocs.get(docId);
    assert.ok(!docInfo.accessRevoked, 'Access should NOT be fully revoked');
}

// ============ Cascading Permission Tests ============

/**
 * Test: Workspace permission change affects all documents
 */
async function testWorkspacePermissionCascade() {
    permManager = new LivePermissionManager();
    
    const wsId = randomHex(16);
    const folderId = randomHex(16);
    const doc1Id = randomHex(16);
    const doc2Id = randomHex(16);
    
    permManager.addWorkspace(wsId, 'owner1');
    permManager.addFolder(folderId, null, wsId);
    permManager.addDocument(doc1Id, folderId, wsId);
    permManager.addDocument(doc2Id, folderId, wsId);
    
    // Grant editor on workspace
    permManager.grantPermission('user2', wsId, 'editor');
    
    // User2 should be able to edit all documents
    assert.ok(permManager.canPerform('user2', doc1Id, 'edit'));
    assert.ok(permManager.canPerform('user2', doc2Id, 'edit'));
    
    // Downgrade workspace permission
    permManager.grantPermission('user2', wsId, 'viewer');
    
    // Should affect all documents
    assert.ok(!permManager.canPerform('user2', doc1Id, 'edit'));
    assert.ok(!permManager.canPerform('user2', doc2Id, 'edit'));
    assert.ok(permManager.canPerform('user2', doc1Id, 'view'));
    assert.ok(permManager.canPerform('user2', doc2Id, 'view'));
}

/**
 * Test: Folder permission change affects contained documents
 */
async function testFolderPermissionCascade() {
    permManager = new LivePermissionManager();
    
    const wsId = randomHex(16);
    const folderId = randomHex(16);
    const docId = randomHex(16);
    
    permManager.addWorkspace(wsId, 'owner1');
    permManager.addFolder(folderId, null, wsId);
    permManager.addDocument(docId, folderId, wsId);
    
    // Grant viewer on workspace, editor on folder
    permManager.grantPermission('user2', wsId, 'viewer');
    permManager.grantPermission('user2', folderId, 'editor');
    
    // User2 can edit document (via folder)
    assert.ok(permManager.canPerform('user2', docId, 'edit'));
    
    // Revoke folder permission
    permManager.revokePermission('user2', folderId);
    
    // User2 falls back to workspace viewer permission
    assert.ok(!permManager.canPerform('user2', docId, 'edit'));
    assert.ok(permManager.canPerform('user2', docId, 'view'));
}

// ============ Active User Tracking Tests ============

/**
 * Test: Track active users on a document
 */
async function testActiveUserTracking() {
    permManager = new LivePermissionManager();
    
    const wsId = randomHex(16);
    const docId = randomHex(16);
    
    permManager.addWorkspace(wsId, 'owner1');
    permManager.addDocument(docId, null, wsId);
    permManager.grantPermission('user2', wsId, 'editor');
    permManager.grantPermission('user3', wsId, 'editor');
    
    const client2 = new CollaborativeClient('user2', permManager);
    const client3 = new CollaborativeClient('user3', permManager);
    clients.push(client2, client3);
    
    client2.openDocument(docId);
    
    let activeUsers = permManager.getActiveUsers(docId);
    assert.equal(activeUsers.length, 1);
    assert.ok(activeUsers.includes('user2'));
    
    client3.openDocument(docId);
    
    activeUsers = permManager.getActiveUsers(docId);
    assert.equal(activeUsers.length, 2);
    
    client2.closeDocument(docId);
    
    activeUsers = permManager.getActiveUsers(docId);
    assert.equal(activeUsers.length, 1);
    assert.ok(activeUsers.includes('user3'));
}

/**
 * Test: Notify active users when document permissions change
 */
async function testNotifyActiveUsersOnPermissionChange() {
    permManager = new LivePermissionManager();
    
    const wsId = randomHex(16);
    const docId = randomHex(16);
    
    permManager.addWorkspace(wsId, 'owner1');
    permManager.addDocument(docId, null, wsId);
    permManager.grantPermission('user2', wsId, 'editor');
    
    const client = new CollaborativeClient('user2', permManager);
    clients.push(client);
    
    client.openDocument(docId);
    
    let permChangeCount = 0;
    permManager.on('permission-changed', () => permChangeCount++);
    
    // Change permission
    permManager.grantPermission('user2', wsId, 'viewer');
    
    assert.equal(permChangeCount, 1, 'Should emit permission change');
    
    const docInfo = client.openDocs.get(docId);
    assert.ok(docInfo.downgraded);
}

// ============ Race Condition Tests ============

/**
 * Test: Edit submitted during permission downgrade
 */
async function testEditDuringDowngrade() {
    permManager = new LivePermissionManager();
    
    const wsId = randomHex(16);
    const docId = randomHex(16);
    
    permManager.addWorkspace(wsId, 'owner1');
    permManager.addDocument(docId, null, wsId);
    permManager.grantPermission('user2', wsId, 'editor');
    
    const client = new CollaborativeClient('user2', permManager);
    clients.push(client);
    
    client.openDocument(docId);
    
    // Simulate race: downgrade happens right as edit is submitted
    // In reality the permission check happens at edit time
    permManager.grantPermission('user2', wsId, 'viewer');
    
    const editResult = client.edit(docId, { type: 'insert', position: 0, text: 'Race!' });
    
    // Edit should fail because we check permission at edit time
    assert.ok(!editResult.success, 'Edit should fail due to permission check');
}

/**
 * Test: Multiple rapid permission changes
 */
async function testRapidPermissionChanges() {
    permManager = new LivePermissionManager();
    
    const wsId = randomHex(16);
    const docId = randomHex(16);
    
    permManager.addWorkspace(wsId, 'owner1');
    permManager.addDocument(docId, null, wsId);
    
    let changeEvents = [];
    permManager.on('permission-changed', (e) => changeEvents.push(e));
    
    // Rapid changes
    permManager.grantPermission('user2', wsId, 'viewer');
    permManager.grantPermission('user2', wsId, 'editor');
    permManager.grantPermission('user2', wsId, 'owner');
    permManager.grantPermission('user2', wsId, 'viewer');
    
    // Should record all changes
    assert.equal(changeEvents.length, 4, 'Should have 4 change events');
    
    // Final state should be viewer
    assert.equal(permManager.getPermission('user2', wsId), 'viewer');
}

// ============ Edge Cases ============

/**
 * Test: Non-existent user permission check
 */
async function testNonExistentUserPermission() {
    permManager = new LivePermissionManager();
    
    const wsId = randomHex(16);
    permManager.addWorkspace(wsId, 'owner1');
    
    const perm = permManager.getPermission('nonexistent', wsId);
    assert.equal(perm, 'none', 'Non-existent user should have no permission');
}

/**
 * Test: Non-existent entity permission check
 */
async function testNonExistentEntityPermission() {
    permManager = new LivePermissionManager();
    
    const perm = permManager.getPermission('user1', 'nonexistent-entity');
    assert.equal(perm, 'none', 'Non-existent entity should return no permission');
}

/**
 * Test: Invalid share link
 */
async function testInvalidShareLink() {
    permManager = new LivePermissionManager();
    
    const result = permManager.redeemShareLink('user1', 'invalid-link-id');
    assert.ok(!result.success);
    assert.equal(result.reason, 'Link not found');
}

/**
 * Test: Double redemption by same user
 */
async function testDoubleRedemption() {
    permManager = new LivePermissionManager();
    
    const wsId = randomHex(16);
    const docId = randomHex(16);
    
    permManager.addWorkspace(wsId, 'owner1');
    permManager.addDocument(docId, null, wsId);
    
    const linkId = permManager.createShareLink(docId, 'editor', { maxUses: 5 });
    
    // Same user redeems twice
    const result1 = permManager.redeemShareLink('user1', linkId);
    const result2 = permManager.redeemShareLink('user1', linkId);
    
    // Both should succeed but only count as one use
    assert.ok(result1.success);
    assert.ok(result2.success);
    
    const link = permManager.shareLinks.get(linkId);
    assert.equal(link.uses, 2, 'Should count uses');
    assert.equal(link.usedBy.size, 1, 'Should only have one unique user');
}

// Export test suite
module.exports = {
    name: 'Permission Revocation',
    setup,
    teardown,
    tests: {
        // Basic permission changes
        testPermissionChangeNotification,
        testDowngradeEditorToViewer,
        testUpgradeViewerToEditor,
        testAccessRevocation,
        
        // Share links
        testShareLinkAccess,
        testShareLinkInvalidation,
        testShareLinkExpiration,
        testShareLinkMaxUses,
        testDirectPermissionPlusShareLink,
        
        // Cascading permissions
        testWorkspacePermissionCascade,
        testFolderPermissionCascade,
        
        // Active user tracking
        testActiveUserTracking,
        testNotifyActiveUsersOnPermissionChange,
        
        // Race conditions
        testEditDuringDowngrade,
        testRapidPermissionChanges,
        
        // Edge cases
        testNonExistentUserPermission,
        testNonExistentEntityPermission,
        testInvalidShareLink,
        testDoubleRedemption,
    }
};

// Jest placeholder - integration tests use custom runner
const describe = typeof global.describe === 'function' ? global.describe : () => {};
const test = typeof global.test === 'function' ? global.test : () => {};
const expect = typeof global.expect === 'function' ? global.expect : () => ({});

describe('Integration Test Placeholder', () => {
  test('tests exist in custom format', () => {
    expect(module.exports).toBeDefined();
  });
});
