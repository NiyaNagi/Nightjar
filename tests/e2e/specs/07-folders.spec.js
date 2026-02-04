/**
 * Folder Management Tests
 * 
 * Tests for creating, organizing, and managing folders within workspaces.
 */
const { test, expect } = require('../fixtures/test-fixtures.js');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const SCREENSHOT_DIR = path.join(__dirname, '../test-results/artifacts/screenshots');

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

test.describe('Folder Management', () => {

  test.describe('Folder CRUD via Sidecar', () => {
    
    test('can create and list folders', async ({ sidecarClient1, testLogs }) => {
      testLogs.add('test', 'info', '=== Folder CRUD test ===');
      
      // Create workspace first
      const ws = {
        id: `ws-folder-${Date.now()}`,
        name: 'Folder Test Workspace',
        icon: '📂',
        encryptionKey: Buffer.from(crypto.randomBytes(32)).toString('base64'),
        ownerId: 'test-owner'
      };
      await sidecarClient1.createWorkspace(ws);
      testLogs.add('test', 'info', 'Created workspace');
      
      // Create folder
      const folder = {
        id: `folder-${Date.now()}`,
        name: 'Test Folder',
        icon: '📁',
        workspaceId: ws.id,
        parentId: null
      };
      
      const createResult = await sidecarClient1.createFolder(folder);
      expect(createResult.type).toBe('folder-created');
      testLogs.add('test', 'info', 'Created folder');
      
      // List folders
      const listResult = await sidecarClient1.listFolders(ws.id);
      expect(listResult.type).toBe('folder-list');
      expect(listResult.folders).toBeInstanceOf(Array);
      
      const found = listResult.folders.find(f => f.id === folder.id);
      expect(found).toBeTruthy();
      expect(found.name).toBe('Test Folder');
      testLogs.add('test', 'info', 'Folder found in list');
      
      // Update folder
      const updateResult = await sidecarClient1.updateFolder({
        ...folder,
        name: 'Renamed Folder'
      });
      expect(updateResult.type).toBe('folder-updated');
      testLogs.add('test', 'info', 'Folder updated');
      
      // Verify update
      const listResult2 = await sidecarClient1.listFolders(ws.id);
      const updated = listResult2.folders.find(f => f.id === folder.id);
      expect(updated.name).toBe('Renamed Folder');
      
      // Delete folder
      const deleteResult = await sidecarClient1.deleteFolder(folder.id);
      expect(deleteResult.type).toBe('folder-deleted');
      testLogs.add('test', 'info', 'Folder deleted');
      
      // Verify deletion
      const listResult3 = await sidecarClient1.listFolders(ws.id);
      const deleted = listResult3.folders.find(f => f.id === folder.id);
      expect(deleted).toBeFalsy();
      
      // Clean up
      await sidecarClient1.deleteWorkspace(ws.id);
      
      testLogs.add('test', 'info', '=== Folder CRUD test PASSED ===');
    });

    test('can create nested folders', async ({ sidecarClient1, testLogs }) => {
      testLogs.add('test', 'info', '=== Nested folders test ===');
      
      const ws = {
        id: `ws-nested-${Date.now()}`,
        name: 'Nested Folder Workspace',
        encryptionKey: Buffer.from(crypto.randomBytes(32)).toString('base64'),
        ownerId: 'test-owner'
      };
      await sidecarClient1.createWorkspace(ws);
      
      // Create parent folder
      const parentFolder = {
        id: `folder-parent-${Date.now()}`,
        name: 'Parent Folder',
        workspaceId: ws.id,
        parentId: null
      };
      await sidecarClient1.createFolder(parentFolder);
      testLogs.add('test', 'info', 'Created parent folder');
      
      // Create child folder
      const childFolder = {
        id: `folder-child-${Date.now()}`,
        name: 'Child Folder',
        workspaceId: ws.id,
        parentId: parentFolder.id
      };
      await sidecarClient1.createFolder(childFolder);
      testLogs.add('test', 'info', 'Created child folder');
      
      // Verify hierarchy
      const listResult = await sidecarClient1.listFolders(ws.id);
      const parent = listResult.folders.find(f => f.id === parentFolder.id);
      const child = listResult.folders.find(f => f.id === childFolder.id);
      
      expect(parent).toBeTruthy();
      expect(child).toBeTruthy();
      expect(child.parentId).toBe(parentFolder.id);
      testLogs.add('test', 'info', 'Verified folder hierarchy');
      
      // Clean up
      await sidecarClient1.deleteWorkspace(ws.id);
      
      testLogs.add('test', 'info', '=== Nested folders test PASSED ===');
    });
  });

  test.describe('Document-Folder Relationships', () => {
    
    test('can move document to folder', async ({ sidecarClient1, testLogs }) => {
      testLogs.add('test', 'info', '=== Move document to folder test ===');
      
      const ws = {
        id: `ws-move-${Date.now()}`,
        name: 'Move Document Workspace',
        encryptionKey: Buffer.from(crypto.randomBytes(32)).toString('base64'),
        ownerId: 'test-owner'
      };
      await sidecarClient1.createWorkspace(ws);
      
      // Create folder
      const folder = {
        id: `folder-dest-${Date.now()}`,
        name: 'Destination Folder',
        workspaceId: ws.id,
        parentId: null
      };
      await sidecarClient1.createFolder(folder);
      testLogs.add('test', 'info', 'Created destination folder');
      
      // Create document (not in folder)
      const doc = {
        id: `doc-move-${Date.now()}`,
        name: 'Document to Move',
        type: 'text',
        workspaceId: ws.id,
        folderId: null
      };
      await sidecarClient1.createDocument(doc);
      testLogs.add('test', 'info', 'Created document outside folder');
      
      // Move document to folder
      const moveResult = await sidecarClient1.moveDocumentToFolder(doc.id, folder.id);
      expect(moveResult.type).toBe('document-moved');
      testLogs.add('test', 'info', 'Moved document to folder');
      
      // Verify move
      const listResult = await sidecarClient1.listDocuments(ws.id);
      const movedDoc = listResult.documents.find(d => d.id === doc.id);
      expect(movedDoc.folderId).toBe(folder.id);
      testLogs.add('test', 'info', 'Verified document is in folder');
      
      // Clean up
      await sidecarClient1.deleteWorkspace(ws.id);
      
      testLogs.add('test', 'info', '=== Move document to folder test PASSED ===');
    });
  });
});
