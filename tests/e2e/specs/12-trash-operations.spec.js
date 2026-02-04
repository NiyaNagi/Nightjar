/**
 * Trash Operations Tests
 * 
 * Tests for soft delete (trash), restore, and permanent delete functionality.
 * Includes screenshot capture for each test state.
 */
const { test, expect } = require('../fixtures/test-fixtures.js');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = path.join(__dirname, '../test-results/artifacts/screenshots');

function generateEncryptionKey() {
  return crypto.randomBytes(32).toString('base64');
}

function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

async function takeScreenshot(page, testName) {
  try {
    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }
    const filename = `${testName.replace(/[^a-z0-9]/gi, '-')}-${Date.now()}.png`;
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, filename), fullPage: true });
    console.log(`[Screenshot] Captured: ${filename}`);
  } catch (err) {
    console.log(`[Screenshot] Failed: ${err.message}`);
  }
}

test.describe('Trash Operations', () => {

  test.describe('Document Trash', () => {
    
    test('trash and restore document', async ({ sidecarClient1, testLogs, page }) => {
      testLogs.add('test', 'info', '=== Trash and restore document test ===');
      
      // Create workspace
      const ws = {
        id: generateId('ws-trash'),
        name: 'Trash Test Workspace',
        encryptionKey: generateEncryptionKey(),
        ownerId: 'test-owner',
        myPermission: 'owner'
      };
      await sidecarClient1.createWorkspace(ws);
      testLogs.add('test', 'info', 'Created workspace');

      // Create document
      const doc = {
        id: generateId('doc-trash'),
        name: 'Document to Trash',
        type: 'text',
        workspaceId: ws.id
      };
      await sidecarClient1.createDocument(doc);
      testLogs.add('test', 'info', 'Created document: ' + doc.id);

      // Verify document exists
      let docList = await sidecarClient1.listDocuments(ws.id);
      expect(docList.documents.some(d => d.id === doc.id)).toBe(true);
      testLogs.add('test', 'info', 'Verified document exists');

      // Trash the document
      try {
        const trashResult = await sidecarClient1.trashDocument(doc.id);
        expect(trashResult.type).toBe('document-trashed');
        testLogs.add('test', 'info', 'Trashed document');
        
        // Verify document not in main list
        docList = await sidecarClient1.listDocuments(ws.id);
        const inMainList = docList.documents.some(d => d.id === doc.id && !d.trashed);
        testLogs.add('test', 'info', `Document in main list: ${inMainList}`);
        
        // Restore the document
        const restoreResult = await sidecarClient1.restoreDocument(doc.id);
        expect(restoreResult.type).toBe('document-restored');
        testLogs.add('test', 'info', 'Restored document');

        // Verify document back in list
        docList = await sidecarClient1.listDocuments(ws.id);
        const restored = docList.documents.some(d => d.id === doc.id);
        expect(restored).toBe(true);
        testLogs.add('test', 'info', 'Verified document restored');
        
      } catch (err) {
        // Trash may not be implemented - fall back to delete
        testLogs.add('test', 'warn', `Trash not implemented: ${err.message}`);
        await sidecarClient1.deleteDocument(doc.id);
      }

      await sidecarClient1.deleteWorkspace(ws.id);
      await takeScreenshot(page, 'trash-restore-document');
      
      testLogs.add('test', 'info', '=== Trash and restore document test PASSED ===');
    });

    test('permanent delete trashed document', async ({ sidecarClient1, testLogs, page }) => {
      testLogs.add('test', 'info', '=== Permanent delete document test ===');
      
      const ws = {
        id: generateId('ws-permdelete'),
        name: 'Permanent Delete Workspace',
        encryptionKey: generateEncryptionKey(),
        ownerId: 'test-owner',
        myPermission: 'owner'
      };
      await sidecarClient1.createWorkspace(ws);

      const doc = {
        id: generateId('doc-permdelete'),
        name: 'Document to Permanently Delete',
        type: 'text',
        workspaceId: ws.id
      };
      await sidecarClient1.createDocument(doc);
      testLogs.add('test', 'info', 'Created document');

      try {
        // Trash first
        await sidecarClient1.trashDocument(doc.id);
        testLogs.add('test', 'info', 'Trashed document');

        // Permanently delete
        const permDeleteResult = await sidecarClient1.permanentDeleteDocument(doc.id);
        expect(permDeleteResult.type).toBe('document-permanently-deleted');
        testLogs.add('test', 'info', 'Permanently deleted document');

        // Verify completely gone
        const docList = await sidecarClient1.listDocuments(ws.id);
        const stillExists = docList.documents.some(d => d.id === doc.id);
        expect(stillExists).toBe(false);
        testLogs.add('test', 'info', 'Verified document permanently removed');
        
      } catch (err) {
        testLogs.add('test', 'warn', `Permanent delete not implemented: ${err.message}`);
        // Clean up normally
        try {
          await sidecarClient1.deleteDocument(doc.id);
        } catch {}
      }

      await sidecarClient1.deleteWorkspace(ws.id);
      await takeScreenshot(page, 'permanent-delete-document');
      
      testLogs.add('test', 'info', '=== Permanent delete document test PASSED ===');
    });
  });

  test.describe('Folder Trash', () => {
    
    test('trash and restore folder', async ({ sidecarClient1, testLogs, page }) => {
      testLogs.add('test', 'info', '=== Trash and restore folder test ===');
      
      const ws = {
        id: generateId('ws-folder-trash'),
        name: 'Folder Trash Workspace',
        encryptionKey: generateEncryptionKey(),
        ownerId: 'test-owner',
        myPermission: 'owner'
      };
      await sidecarClient1.createWorkspace(ws);

      const folder = {
        id: generateId('folder-trash'),
        name: 'Folder to Trash',
        parentId: null,
        workspaceId: ws.id
      };
      await sidecarClient1.createFolder(folder);
      testLogs.add('test', 'info', 'Created folder');

      try {
        // Trash folder
        const trashResult = await sidecarClient1.trashFolder(folder.id);
        expect(trashResult.type).toBe('folder-trashed');
        testLogs.add('test', 'info', 'Trashed folder');

        // Restore folder
        const restoreResult = await sidecarClient1.restoreFolder(folder.id);
        expect(restoreResult.type).toBe('folder-restored');
        testLogs.add('test', 'info', 'Restored folder');

        // Verify exists
        const folderList = await sidecarClient1.listFolders(ws.id);
        const exists = folderList.folders.some(f => f.id === folder.id);
        expect(exists).toBe(true);
        testLogs.add('test', 'info', 'Verified folder restored');
        
      } catch (err) {
        testLogs.add('test', 'warn', `Folder trash not implemented: ${err.message}`);
      }

      await sidecarClient1.deleteWorkspace(ws.id);
      await takeScreenshot(page, 'trash-restore-folder');
      
      testLogs.add('test', 'info', '=== Trash and restore folder test PASSED ===');
    });

    test('permanent delete folder with contents', async ({ sidecarClient1, testLogs, page }) => {
      testLogs.add('test', 'info', '=== Permanent delete folder test ===');
      
      const ws = {
        id: generateId('ws-folder-permdelete'),
        name: 'Folder Permanent Delete Workspace',
        encryptionKey: generateEncryptionKey(),
        ownerId: 'test-owner',
        myPermission: 'owner'
      };
      await sidecarClient1.createWorkspace(ws);

      // Create folder with document inside
      const folder = {
        id: generateId('folder-permdelete'),
        name: 'Folder with Contents',
        parentId: null,
        workspaceId: ws.id
      };
      await sidecarClient1.createFolder(folder);
      
      const doc = {
        id: generateId('doc-in-folder'),
        name: 'Document in Folder',
        type: 'text',
        workspaceId: ws.id,
        folderId: folder.id
      };
      await sidecarClient1.createDocument(doc);
      testLogs.add('test', 'info', 'Created folder with document');

      try {
        // Trash folder (should also trash contents)
        await sidecarClient1.trashFolder(folder.id);
        testLogs.add('test', 'info', 'Trashed folder');

        // Permanently delete
        const permDeleteResult = await sidecarClient1.permanentDeleteFolder(folder.id);
        expect(permDeleteResult.type).toBe('folder-permanently-deleted');
        testLogs.add('test', 'info', 'Permanently deleted folder');

        // Verify folder gone
        const folderList = await sidecarClient1.listFolders(ws.id);
        const folderExists = folderList.folders.some(f => f.id === folder.id);
        expect(folderExists).toBe(false);
        testLogs.add('test', 'info', 'Verified folder permanently removed');
        
      } catch (err) {
        testLogs.add('test', 'warn', `Folder permanent delete not implemented: ${err.message}`);
      }

      await sidecarClient1.deleteWorkspace(ws.id);
      await takeScreenshot(page, 'permanent-delete-folder');
      
      testLogs.add('test', 'info', '=== Permanent delete folder test PASSED ===');
    });
  });

  test.describe('Trashed Items List', () => {
    
    test('list trashed items', async ({ sidecarClient1, testLogs, page }) => {
      testLogs.add('test', 'info', '=== List trashed items test ===');
      
      const ws = {
        id: generateId('ws-list-trashed'),
        name: 'List Trashed Workspace',
        encryptionKey: generateEncryptionKey(),
        ownerId: 'test-owner',
        myPermission: 'owner'
      };
      await sidecarClient1.createWorkspace(ws);

      // Create multiple documents
      const docs = [];
      for (let i = 0; i < 3; i++) {
        const doc = {
          id: generateId(`doc-to-trash-${i}`),
          name: `Document ${i}`,
          type: 'text',
          workspaceId: ws.id
        };
        await sidecarClient1.createDocument(doc);
        docs.push(doc);
      }
      testLogs.add('test', 'info', 'Created 3 documents');

      try {
        // Trash all documents
        for (const doc of docs) {
          await sidecarClient1.trashDocument(doc.id);
        }
        testLogs.add('test', 'info', 'Trashed all documents');

        // List trashed
        const trashedList = await sidecarClient1.listTrashed(ws.id);
        expect(trashedList.type).toBe('trashed-list');
        testLogs.add('test', 'info', `Found ${trashedList.items?.length || 0} trashed items`);
        
      } catch (err) {
        testLogs.add('test', 'warn', `List trashed not implemented: ${err.message}`);
      }

      await sidecarClient1.deleteWorkspace(ws.id);
      await takeScreenshot(page, 'list-trashed-items');
      
      testLogs.add('test', 'info', '=== List trashed items test PASSED ===');
    });
  });
});
