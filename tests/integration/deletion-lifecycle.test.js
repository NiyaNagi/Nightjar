/**
 * Deletion and Restore Lifecycle Tests
 * 
 * Tests for what happens when documents/folders are deleted:
 * - Active collaborators when document is deleted
 * - Restore while another user is viewing
 * - Cascade deletion of nested items
 * - Trash behavior across multiple users
 * - Permanent deletion
 * - Conflict between delete and edit
 * - Sync of deletion across network
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

// ============ Mock Document/Folder Manager ============

/**
 * Manages documents and folders with soft/hard delete
 */
class DocumentManager extends EventEmitter {
    constructor() {
        super();
        this.documents = new Map();   // docId -> document metadata
        this.folders = new Map();     // folderId -> folder metadata
        this.workspaces = new Map();  // wsId -> workspace metadata
        this.trash = new Map();       // entityId -> { entity, deletedAt, deletedBy }
        this.activeEditors = new Map(); // docId -> Set of userIds
        this.docs = new Map();        // docId -> Y.Doc
    }
    
    createWorkspace(wsId, ownerId, name) {
        this.workspaces.set(wsId, {
            id: wsId,
            name,
            ownerId,
            createdAt: Date.now(),
        });
        return this.workspaces.get(wsId);
    }
    
    createFolder(folderId, wsId, parentId, name) {
        const folder = {
            id: folderId,
            workspaceId: wsId,
            parentId,
            name,
            type: 'folder',
            createdAt: Date.now(),
            deletedAt: null,
        };
        this.folders.set(folderId, folder);
        return folder;
    }
    
    createDocument(docId, wsId, folderId, name) {
        const doc = {
            id: docId,
            workspaceId: wsId,
            folderId,
            name,
            type: 'document',
            createdAt: Date.now(),
            deletedAt: null,
        };
        this.documents.set(docId, doc);
        
        // Create Yjs doc
        const yDoc = new Y.Doc();
        this.docs.set(docId, yDoc);
        
        return doc;
    }
    
    getDocument(docId) {
        return this.documents.get(docId);
    }
    
    getFolder(folderId) {
        return this.folders.get(folderId);
    }
    
    // Open document for editing
    openDocument(docId, userId) {
        const doc = this.documents.get(docId);
        if (!doc || doc.deletedAt) {
            return { success: false, reason: 'Document not found or deleted' };
        }
        
        if (!this.activeEditors.has(docId)) {
            this.activeEditors.set(docId, new Set());
        }
        this.activeEditors.get(docId).add(userId);
        
        return { success: true, yDoc: this.docs.get(docId) };
    }
    
    closeDocument(docId, userId) {
        const editors = this.activeEditors.get(docId);
        if (editors) {
            editors.delete(userId);
        }
    }
    
    getActiveEditors(docId) {
        return Array.from(this.activeEditors.get(docId) || []);
    }
    
    // Soft delete - move to trash
    softDelete(entityId, entityType, userId) {
        let entity;
        if (entityType === 'document') {
            entity = this.documents.get(entityId);
        } else if (entityType === 'folder') {
            entity = this.folders.get(entityId);
        }
        
        if (!entity) {
            return { success: false, reason: 'Entity not found' };
        }
        
        // Check for active editors
        const activeEditors = this.getActiveEditors(entityId);
        const hasActiveEditors = activeEditors.length > 0;
        
        entity.deletedAt = Date.now();
        entity.deletedBy = userId;
        
        this.trash.set(entityId, {
            entity,
            entityType,
            deletedAt: entity.deletedAt,
            deletedBy: userId,
        });
        
        this.emit('entity-deleted', {
            entityId,
            entityType,
            deletedBy: userId,
            activeEditors,
        });
        
        return { 
            success: true, 
            hadActiveEditors: hasActiveEditors,
            activeEditors 
        };
    }
    
    // Soft delete folder and all contents
    softDeleteFolderRecursive(folderId, userId) {
        const folder = this.folders.get(folderId);
        if (!folder) {
            return { success: false, reason: 'Folder not found' };
        }
        
        const deletedItems = [];
        const affectedUsers = new Set();
        
        // Delete all documents in folder
        for (const [docId, doc] of this.documents) {
            if (doc.folderId === folderId && !doc.deletedAt) {
                const result = this.softDelete(docId, 'document', userId);
                deletedItems.push({ id: docId, type: 'document' });
                result.activeEditors.forEach(u => affectedUsers.add(u));
            }
        }
        
        // Delete all subfolders
        for (const [subfolderId, subfolder] of this.folders) {
            if (subfolder.parentId === folderId && !subfolder.deletedAt) {
                const result = this.softDeleteFolderRecursive(subfolderId, userId);
                deletedItems.push(...result.deletedItems);
                result.affectedUsers.forEach(u => affectedUsers.add(u));
            }
        }
        
        // Delete the folder itself
        this.softDelete(folderId, 'folder', userId);
        deletedItems.push({ id: folderId, type: 'folder' });
        
        return {
            success: true,
            deletedItems,
            affectedUsers: Array.from(affectedUsers),
        };
    }
    
    // Restore from trash
    restore(entityId) {
        const trashEntry = this.trash.get(entityId);
        if (!trashEntry) {
            return { success: false, reason: 'Not in trash' };
        }
        
        const entity = trashEntry.entity;
        entity.deletedAt = null;
        entity.deletedBy = null;
        
        this.trash.delete(entityId);
        
        this.emit('entity-restored', {
            entityId,
            entityType: trashEntry.entityType,
        });
        
        return { success: true, entity };
    }
    
    // Permanent delete - no recovery
    permanentDelete(entityId) {
        const trashEntry = this.trash.get(entityId);
        if (!trashEntry) {
            return { success: false, reason: 'Not in trash' };
        }
        
        this.trash.delete(entityId);
        
        if (trashEntry.entityType === 'document') {
            this.documents.delete(entityId);
            const yDoc = this.docs.get(entityId);
            if (yDoc) {
                yDoc.destroy();
                this.docs.delete(entityId);
            }
        } else if (trashEntry.entityType === 'folder') {
            this.folders.delete(entityId);
        }
        
        this.emit('entity-permanently-deleted', {
            entityId,
            entityType: trashEntry.entityType,
        });
        
        return { success: true };
    }
    
    // Get trash contents
    getTrash(workspaceId) {
        const items = [];
        for (const [entityId, entry] of this.trash) {
            if (entry.entity.workspaceId === workspaceId) {
                items.push(entry);
            }
        }
        return items;
    }
    
    // Check if entity is deleted
    isDeleted(entityId) {
        return this.trash.has(entityId);
    }
    
    destroy() {
        for (const yDoc of this.docs.values()) {
            yDoc.destroy();
        }
        this.docs.clear();
        this.documents.clear();
        this.folders.clear();
        this.workspaces.clear();
        this.trash.clear();
        this.activeEditors.clear();
    }
}

// ============ Mock Collaborative Client ============

class DocClient {
    constructor(userId, docManager) {
        this.userId = userId;
        this.docManager = docManager;
        this.openDocs = new Map();  // docId -> { yDoc, content }
        this.notifications = [];
        
        // Listen for deletions
        docManager.on('entity-deleted', (event) => {
            if (event.activeEditors.includes(userId)) {
                this.notifications.push({
                    type: 'document-deleted',
                    ...event,
                });
                
                // Mark our local doc as deleted
                if (this.openDocs.has(event.entityId)) {
                    this.openDocs.get(event.entityId).deleted = true;
                }
            }
        });
        
        docManager.on('entity-restored', (event) => {
            this.notifications.push({
                type: 'document-restored',
                ...event,
            });
        });
    }
    
    openDocument(docId) {
        const result = this.docManager.openDocument(docId, this.userId);
        if (result.success) {
            this.openDocs.set(docId, {
                yDoc: result.yDoc,
                deleted: false,
            });
        }
        return result;
    }
    
    closeDocument(docId) {
        this.docManager.closeDocument(docId, this.userId);
        this.openDocs.delete(docId);
    }
    
    edit(docId, text) {
        const docInfo = this.openDocs.get(docId);
        if (!docInfo) {
            return { success: false, reason: 'Document not open' };
        }
        
        if (docInfo.deleted) {
            return { success: false, reason: 'Document has been deleted' };
        }
        
        // Check if document still exists
        if (this.docManager.isDeleted(docId)) {
            docInfo.deleted = true;
            return { success: false, reason: 'Document has been deleted' };
        }
        
        docInfo.yDoc.getText('content').insert(
            docInfo.yDoc.getText('content').length,
            text
        );
        
        return { success: true };
    }
    
    getContent(docId) {
        const docInfo = this.openDocs.get(docId);
        if (!docInfo) return null;
        return docInfo.yDoc.getText('content').toString();
    }
}

// ============ Test Suite ============

let docManager = null;
let clients = [];

async function setup() {
    console.log('  [Setup] Deletion lifecycle tests ready');
}

async function teardown() {
    if (docManager) {
        docManager.destroy();
        docManager = null;
    }
    clients = [];
}

// ============ Basic Deletion Tests ============

/**
 * Test: Soft delete moves document to trash
 */
async function testSoftDeleteMovesToTrash() {
    docManager = new DocumentManager();
    
    const wsId = randomHex(16);
    const docId = randomHex(16);
    
    docManager.createWorkspace(wsId, 'owner1', 'Test Workspace');
    docManager.createDocument(docId, wsId, null, 'Test Document');
    
    const result = docManager.softDelete(docId, 'document', 'owner1');
    
    assert.ok(result.success);
    assert.ok(docManager.isDeleted(docId), 'Document should be in trash');
    
    const trash = docManager.getTrash(wsId);
    assert.equal(trash.length, 1);
    assert.equal(trash[0].entity.id, docId);
}

/**
 * Test: Deleted document cannot be opened
 */
async function testDeletedDocumentCannotBeOpened() {
    docManager = new DocumentManager();
    
    const wsId = randomHex(16);
    const docId = randomHex(16);
    
    docManager.createWorkspace(wsId, 'owner1', 'Test Workspace');
    docManager.createDocument(docId, wsId, null, 'Test Document');
    docManager.softDelete(docId, 'document', 'owner1');
    
    const result = docManager.openDocument(docId, 'user2');
    
    assert.ok(!result.success);
    assert.equal(result.reason, 'Document not found or deleted');
}

/**
 * Test: Restore from trash
 */
async function testRestoreFromTrash() {
    docManager = new DocumentManager();
    
    const wsId = randomHex(16);
    const docId = randomHex(16);
    
    docManager.createWorkspace(wsId, 'owner1', 'Test Workspace');
    docManager.createDocument(docId, wsId, null, 'Test Document');
    docManager.softDelete(docId, 'document', 'owner1');
    
    const result = docManager.restore(docId);
    
    assert.ok(result.success);
    assert.ok(!docManager.isDeleted(docId), 'Document should not be in trash');
    
    // Should be openable again
    const openResult = docManager.openDocument(docId, 'user2');
    assert.ok(openResult.success);
}

/**
 * Test: Permanent delete removes completely
 */
async function testPermanentDelete() {
    docManager = new DocumentManager();
    
    const wsId = randomHex(16);
    const docId = randomHex(16);
    
    docManager.createWorkspace(wsId, 'owner1', 'Test Workspace');
    docManager.createDocument(docId, wsId, null, 'Test Document');
    docManager.softDelete(docId, 'document', 'owner1');
    
    const result = docManager.permanentDelete(docId);
    
    assert.ok(result.success);
    assert.ok(!docManager.isDeleted(docId)); // Not in trash
    assert.equal(docManager.getDocument(docId), undefined); // Completely gone
    assert.equal(docManager.docs.get(docId), undefined); // Yjs doc destroyed
}

// ============ Active Collaborator Tests ============

/**
 * Test: Active editor is notified when document is deleted
 */
async function testActiveEditorNotifiedOnDelete() {
    docManager = new DocumentManager();
    
    const wsId = randomHex(16);
    const docId = randomHex(16);
    
    docManager.createWorkspace(wsId, 'owner1', 'Test Workspace');
    docManager.createDocument(docId, wsId, null, 'Test Document');
    
    const client = new DocClient('user2', docManager);
    clients.push(client);
    
    client.openDocument(docId);
    client.edit(docId, 'Working on this...');
    
    // Owner deletes while user2 is editing
    docManager.softDelete(docId, 'document', 'owner1');
    
    // User2 should be notified
    const deleteNotifs = client.notifications.filter(n => n.type === 'document-deleted');
    assert.equal(deleteNotifs.length, 1);
    assert.equal(deleteNotifs[0].entityId, docId);
}

/**
 * Test: Edit fails after document is deleted
 */
async function testEditFailsAfterDelete() {
    docManager = new DocumentManager();
    
    const wsId = randomHex(16);
    const docId = randomHex(16);
    
    docManager.createWorkspace(wsId, 'owner1', 'Test Workspace');
    docManager.createDocument(docId, wsId, null, 'Test Document');
    
    const client = new DocClient('user2', docManager);
    clients.push(client);
    
    client.openDocument(docId);
    
    // First edit succeeds
    const result1 = client.edit(docId, 'First edit');
    assert.ok(result1.success);
    
    // Owner deletes
    docManager.softDelete(docId, 'document', 'owner1');
    
    // Second edit fails
    const result2 = client.edit(docId, 'Second edit');
    assert.ok(!result2.success);
    assert.equal(result2.reason, 'Document has been deleted');
}

/**
 * Test: Content is preserved in trash
 */
async function testContentPreservedInTrash() {
    docManager = new DocumentManager();
    
    const wsId = randomHex(16);
    const docId = randomHex(16);
    
    docManager.createWorkspace(wsId, 'owner1', 'Test Workspace');
    docManager.createDocument(docId, wsId, null, 'Test Document');
    
    // Add content
    const yDoc = docManager.docs.get(docId);
    yDoc.getText('content').insert(0, 'Important content');
    
    // Delete
    docManager.softDelete(docId, 'document', 'owner1');
    
    // Content should still be in the Yjs doc
    const content = yDoc.getText('content').toString();
    assert.equal(content, 'Important content', 'Content should be preserved');
    
    // Restore and verify
    docManager.restore(docId);
    
    const openResult = docManager.openDocument(docId, 'user2');
    const restoredContent = openResult.yDoc.getText('content').toString();
    assert.equal(restoredContent, 'Important content', 'Content should be accessible after restore');
}

/**
 * Test: Delete reports active editors
 */
async function testDeleteReportsActiveEditors() {
    docManager = new DocumentManager();
    
    const wsId = randomHex(16);
    const docId = randomHex(16);
    
    docManager.createWorkspace(wsId, 'owner1', 'Test Workspace');
    docManager.createDocument(docId, wsId, null, 'Test Document');
    
    const client1 = new DocClient('user1', docManager);
    const client2 = new DocClient('user2', docManager);
    clients.push(client1, client2);
    
    client1.openDocument(docId);
    client2.openDocument(docId);
    
    const result = docManager.softDelete(docId, 'document', 'owner1');
    
    assert.ok(result.hadActiveEditors);
    assert.equal(result.activeEditors.length, 2);
    assert.ok(result.activeEditors.includes('user1'));
    assert.ok(result.activeEditors.includes('user2'));
}

// ============ Cascading Deletion Tests ============

/**
 * Test: Deleting folder deletes all contents
 */
async function testCascadeFolderDeletion() {
    docManager = new DocumentManager();
    
    const wsId = randomHex(16);
    const folderId = randomHex(16);
    const doc1Id = randomHex(16);
    const doc2Id = randomHex(16);
    
    docManager.createWorkspace(wsId, 'owner1', 'Test Workspace');
    docManager.createFolder(folderId, wsId, null, 'Test Folder');
    docManager.createDocument(doc1Id, wsId, folderId, 'Doc 1');
    docManager.createDocument(doc2Id, wsId, folderId, 'Doc 2');
    
    const result = docManager.softDeleteFolderRecursive(folderId, 'owner1');
    
    assert.ok(result.success);
    assert.equal(result.deletedItems.length, 3); // 2 docs + 1 folder
    
    assert.ok(docManager.isDeleted(folderId));
    assert.ok(docManager.isDeleted(doc1Id));
    assert.ok(docManager.isDeleted(doc2Id));
}

/**
 * Test: Nested folder cascade deletion
 */
async function testNestedFolderCascade() {
    docManager = new DocumentManager();
    
    const wsId = randomHex(16);
    const folder1Id = randomHex(16);
    const folder2Id = randomHex(16);
    const docId = randomHex(16);
    
    docManager.createWorkspace(wsId, 'owner1', 'Test Workspace');
    docManager.createFolder(folder1Id, wsId, null, 'Level 1');
    docManager.createFolder(folder2Id, wsId, folder1Id, 'Level 2');
    docManager.createDocument(docId, wsId, folder2Id, 'Deep Doc');
    
    const result = docManager.softDeleteFolderRecursive(folder1Id, 'owner1');
    
    assert.ok(result.success);
    assert.ok(docManager.isDeleted(folder1Id));
    assert.ok(docManager.isDeleted(folder2Id));
    assert.ok(docManager.isDeleted(docId));
}

/**
 * Test: Cascade reports all affected users
 */
async function testCascadeReportsAffectedUsers() {
    docManager = new DocumentManager();
    
    const wsId = randomHex(16);
    const folderId = randomHex(16);
    const doc1Id = randomHex(16);
    const doc2Id = randomHex(16);
    
    docManager.createWorkspace(wsId, 'owner1', 'Test Workspace');
    docManager.createFolder(folderId, wsId, null, 'Test Folder');
    docManager.createDocument(doc1Id, wsId, folderId, 'Doc 1');
    docManager.createDocument(doc2Id, wsId, folderId, 'Doc 2');
    
    const client1 = new DocClient('user1', docManager);
    const client2 = new DocClient('user2', docManager);
    clients.push(client1, client2);
    
    client1.openDocument(doc1Id);
    client2.openDocument(doc2Id);
    
    const result = docManager.softDeleteFolderRecursive(folderId, 'owner1');
    
    assert.equal(result.affectedUsers.length, 2);
    assert.ok(result.affectedUsers.includes('user1'));
    assert.ok(result.affectedUsers.includes('user2'));
}

// ============ Restore Scenarios ============

/**
 * Test: Restore while another user is trying to access
 */
async function testRestoreWhileAccessing() {
    docManager = new DocumentManager();
    
    const wsId = randomHex(16);
    const docId = randomHex(16);
    
    docManager.createWorkspace(wsId, 'owner1', 'Test Workspace');
    docManager.createDocument(docId, wsId, null, 'Test Document');
    
    // Add content
    docManager.docs.get(docId).getText('content').insert(0, 'Original content');
    
    // Delete
    docManager.softDelete(docId, 'document', 'owner1');
    
    // User2 tries to open (fails)
    const client = new DocClient('user2', docManager);
    clients.push(client);
    
    const openResult1 = client.openDocument(docId);
    assert.ok(!openResult1.success);
    
    // Restore
    docManager.restore(docId);
    
    // User2 should get notification
    const restoreNotifs = client.notifications.filter(n => n.type === 'document-restored');
    assert.equal(restoreNotifs.length, 1);
    
    // Now user2 can open
    const openResult2 = client.openDocument(docId);
    assert.ok(openResult2.success);
    
    // Content should be intact
    const content = client.getContent(docId);
    assert.equal(content, 'Original content');
}

/**
 * Test: Restore folder but not its contents
 */
async function testPartialRestore() {
    docManager = new DocumentManager();
    
    const wsId = randomHex(16);
    const folderId = randomHex(16);
    const doc1Id = randomHex(16);
    const doc2Id = randomHex(16);
    
    docManager.createWorkspace(wsId, 'owner1', 'Test Workspace');
    docManager.createFolder(folderId, wsId, null, 'Test Folder');
    docManager.createDocument(doc1Id, wsId, folderId, 'Doc 1');
    docManager.createDocument(doc2Id, wsId, folderId, 'Doc 2');
    
    // Delete folder and contents
    docManager.softDeleteFolderRecursive(folderId, 'owner1');
    
    // Restore just the folder
    docManager.restore(folderId);
    
    // Folder should be restored
    assert.ok(!docManager.isDeleted(folderId));
    
    // Documents should still be in trash
    assert.ok(docManager.isDeleted(doc1Id));
    assert.ok(docManager.isDeleted(doc2Id));
}

// ============ Concurrent Operations Tests ============

/**
 * Test: Delete and edit race condition
 */
async function testDeleteEditRace() {
    docManager = new DocumentManager();
    
    const wsId = randomHex(16);
    const docId = randomHex(16);
    
    docManager.createWorkspace(wsId, 'owner1', 'Test Workspace');
    docManager.createDocument(docId, wsId, null, 'Test Document');
    
    const client = new DocClient('user2', docManager);
    clients.push(client);
    
    client.openDocument(docId);
    
    // Simulate race: both happen "simultaneously"
    // In practice, the edit check happens after deletion
    docManager.softDelete(docId, 'document', 'owner1');
    const editResult = client.edit(docId, 'Racing edit');
    
    assert.ok(!editResult.success, 'Edit should fail due to deletion');
}

/**
 * Test: Multiple deletes of same document
 */
async function testMultipleDeleteAttempts() {
    docManager = new DocumentManager();
    
    const wsId = randomHex(16);
    const docId = randomHex(16);
    
    docManager.createWorkspace(wsId, 'owner1', 'Test Workspace');
    docManager.createDocument(docId, wsId, null, 'Test Document');
    
    // First delete succeeds
    const result1 = docManager.softDelete(docId, 'document', 'owner1');
    assert.ok(result1.success);
    
    // Second delete also succeeds (idempotent) but doc already deleted
    const result2 = docManager.softDelete(docId, 'document', 'owner1');
    // Entity still exists but deletedAt is already set
    assert.ok(result2.success);
}

/**
 * Test: Delete then restore then delete again
 */
async function testDeleteRestoreDeleteCycle() {
    docManager = new DocumentManager();
    
    const wsId = randomHex(16);
    const docId = randomHex(16);
    
    docManager.createWorkspace(wsId, 'owner1', 'Test Workspace');
    docManager.createDocument(docId, wsId, null, 'Test Document');
    
    // Add content
    docManager.docs.get(docId).getText('content').insert(0, 'Persistent content');
    
    // Delete -> Restore -> Delete
    docManager.softDelete(docId, 'document', 'owner1');
    docManager.restore(docId);
    docManager.softDelete(docId, 'document', 'owner1');
    
    // Should be in trash
    assert.ok(docManager.isDeleted(docId));
    
    // Content should still be there
    const content = docManager.docs.get(docId).getText('content').toString();
    assert.equal(content, 'Persistent content');
}

// ============ Trash Management Tests ============

/**
 * Test: Trash only shows items from specific workspace
 */
async function testTrashIsolatedByWorkspace() {
    docManager = new DocumentManager();
    
    const ws1Id = randomHex(16);
    const ws2Id = randomHex(16);
    const doc1Id = randomHex(16);
    const doc2Id = randomHex(16);
    
    docManager.createWorkspace(ws1Id, 'owner1', 'Workspace 1');
    docManager.createWorkspace(ws2Id, 'owner1', 'Workspace 2');
    docManager.createDocument(doc1Id, ws1Id, null, 'WS1 Doc');
    docManager.createDocument(doc2Id, ws2Id, null, 'WS2 Doc');
    
    docManager.softDelete(doc1Id, 'document', 'owner1');
    docManager.softDelete(doc2Id, 'document', 'owner1');
    
    const trash1 = docManager.getTrash(ws1Id);
    const trash2 = docManager.getTrash(ws2Id);
    
    assert.equal(trash1.length, 1);
    assert.equal(trash1[0].entity.id, doc1Id);
    
    assert.equal(trash2.length, 1);
    assert.equal(trash2[0].entity.id, doc2Id);
}

/**
 * Test: Empty trash (permanent delete all)
 */
async function testEmptyTrash() {
    docManager = new DocumentManager();
    
    const wsId = randomHex(16);
    const doc1Id = randomHex(16);
    const doc2Id = randomHex(16);
    
    docManager.createWorkspace(wsId, 'owner1', 'Test Workspace');
    docManager.createDocument(doc1Id, wsId, null, 'Doc 1');
    docManager.createDocument(doc2Id, wsId, null, 'Doc 2');
    
    docManager.softDelete(doc1Id, 'document', 'owner1');
    docManager.softDelete(doc2Id, 'document', 'owner1');
    
    // Empty trash
    const trash = docManager.getTrash(wsId);
    for (const item of trash) {
        docManager.permanentDelete(item.entity.id);
    }
    
    assert.equal(docManager.getTrash(wsId).length, 0);
    assert.equal(docManager.documents.size, 0);
}

/**
 * Test: Restore non-existent item fails
 */
async function testRestoreNonExistent() {
    docManager = new DocumentManager();
    
    const result = docManager.restore('nonexistent-id');
    
    assert.ok(!result.success);
    assert.equal(result.reason, 'Not in trash');
}

/**
 * Test: Permanent delete non-trashed item fails
 */
async function testPermanentDeleteNotInTrash() {
    docManager = new DocumentManager();
    
    const wsId = randomHex(16);
    const docId = randomHex(16);
    
    docManager.createWorkspace(wsId, 'owner1', 'Test Workspace');
    docManager.createDocument(docId, wsId, null, 'Test Document');
    
    // Try to permanently delete without soft delete first
    const result = docManager.permanentDelete(docId);
    
    assert.ok(!result.success);
    assert.equal(result.reason, 'Not in trash');
}

// Export test suite
module.exports = {
    name: 'Deletion Lifecycle',
    setup,
    teardown,
    tests: {
        // Basic deletion
        testSoftDeleteMovesToTrash,
        testDeletedDocumentCannotBeOpened,
        testRestoreFromTrash,
        testPermanentDelete,
        
        // Active collaborators
        testActiveEditorNotifiedOnDelete,
        testEditFailsAfterDelete,
        testContentPreservedInTrash,
        testDeleteReportsActiveEditors,
        
        // Cascading deletion
        testCascadeFolderDeletion,
        testNestedFolderCascade,
        testCascadeReportsAffectedUsers,
        
        // Restore scenarios
        testRestoreWhileAccessing,
        testPartialRestore,
        
        // Concurrent operations
        testDeleteEditRace,
        testMultipleDeleteAttempts,
        testDeleteRestoreDeleteCycle,
        
        // Trash management
        testTrashIsolatedByWorkspace,
        testEmptyTrash,
        testRestoreNonExistent,
        testPermanentDeleteNotInTrash,
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
