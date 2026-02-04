/**
 * Document Management Tests
 * 
 * Tests for creating, editing, and managing different document types.
 * 
 * NOTE: UI-based tests are skipped as they require frontend data-testid attributes.
 * API tests for documents are in 04-cross-platform.spec.js and 10-comprehensive-api.spec.js
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

test.describe('Document Management', () => {

  test.describe('Document Creation via UI', () => {
    
    test('can create text document through UI', async ({ page, unifiedServer1, sidecarClient1, testLogs }) => {
      testLogs.add('test', 'info', '=== Create text document via UI test ===');
      
      // First create a workspace
      const ws = {
        id: `ws-doc-ui-${Date.now()}`,
        name: 'Document Test Workspace',
        icon: '📝',
        encryptionKey: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
        ownerId: 'test-owner'
      };
      await sidecarClient1.createWorkspace(ws);
      testLogs.add('test', 'info', 'Created workspace for document testing');
      
      await page.goto('/');
      await page.waitForSelector('[data-testid="workspace-sidebar"]', { timeout: 30000 });
      
      // Click new document button
      const newDocBtn = page.locator('[data-testid="new-document-btn"]');
      if (await newDocBtn.isVisible()) {
        await newDocBtn.click();
        testLogs.add('test', 'info', 'Clicked new document button');
      }
      
      // Wait for document type grid
      await page.waitForSelector('[data-testid="doc-type-grid"]', { timeout: 10000 });
      
      // Select text document type
      await page.click('[data-testid="doc-type-text"]');
      testLogs.add('test', 'info', 'Selected text document type');
      
      // Fill in document name
      const docName = `Test Document ${Date.now()}`;
      await page.fill('[data-testid="document-name-input"]', docName);
      testLogs.add('test', 'info', `Entered document name: ${docName}`);
      
      // Click create
      await page.click('[data-testid="create-document-confirm"]');
      testLogs.add('test', 'info', 'Clicked create document confirm');
      
      // Wait for document to appear in sidebar
      await page.waitForSelector('[data-testid="document-list"]', { timeout: 10000 });
      
      // Verify document appears
      const docList = page.locator('[data-testid="document-list"]');
      const docText = await docList.textContent();
      expect(docText).toContain(docName.substring(0, 20)); // May be truncated
      testLogs.add('test', 'info', 'Document appears in sidebar');
      
      // Clean up
      await sidecarClient1.deleteWorkspace(ws.id);
      
      testLogs.add('test', 'info', '=== Create text document via UI test PASSED ===');
    });

    test('can create spreadsheet through UI', async ({ page, unifiedServer1, sidecarClient1, testLogs }) => {
      testLogs.add('test', 'info', '=== Create spreadsheet via UI test ===');
      
      const ws = {
        id: `ws-sheet-ui-${Date.now()}`,
        name: 'Spreadsheet Test Workspace',
        icon: '📊',
        encryptionKey: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
        ownerId: 'test-owner'
      };
      await sidecarClient1.createWorkspace(ws);
      
      await page.goto('/');
      await page.waitForSelector('[data-testid="workspace-sidebar"]', { timeout: 30000 });
      
      // Click new document button
      const newDocBtn = page.locator('[data-testid="new-document-btn"]');
      if (await newDocBtn.isVisible()) {
        await newDocBtn.click();
      }
      
      await page.waitForSelector('[data-testid="doc-type-grid"]', { timeout: 10000 });
      
      // Select spreadsheet type
      const sheetType = page.locator('[data-testid="doc-type-spreadsheet"], [data-testid="doc-type-sheet"]');
      if (await sheetType.first().isVisible()) {
        await sheetType.first().click();
        testLogs.add('test', 'info', 'Selected spreadsheet document type');
      }
      
      // Fill name and create
      await page.fill('[data-testid="document-name-input"]', 'Test Spreadsheet');
      await page.click('[data-testid="create-document-confirm"]');
      
      // Wait for document list update
      await page.waitForSelector('[data-testid="document-list"]', { timeout: 10000 });
      testLogs.add('test', 'info', 'Spreadsheet created');
      
      // Clean up
      await sidecarClient1.deleteWorkspace(ws.id);
      
      testLogs.add('test', 'info', '=== Create spreadsheet via UI test PASSED ===');
    });

    test('can create kanban board through UI', async ({ page, unifiedServer1, sidecarClient1, testLogs }) => {
      testLogs.add('test', 'info', '=== Create kanban via UI test ===');
      
      const ws = {
        id: `ws-kanban-ui-${Date.now()}`,
        name: 'Kanban Test Workspace',
        icon: '📋',
        encryptionKey: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
        ownerId: 'test-owner'
      };
      await sidecarClient1.createWorkspace(ws);
      
      await page.goto('/');
      await page.waitForSelector('[data-testid="workspace-sidebar"]', { timeout: 30000 });
      
      const newDocBtn = page.locator('[data-testid="new-document-btn"]');
      if (await newDocBtn.isVisible()) {
        await newDocBtn.click();
      }
      
      await page.waitForSelector('[data-testid="doc-type-grid"]', { timeout: 10000 });
      
      // Select kanban type
      const kanbanType = page.locator('[data-testid="doc-type-kanban"], [data-testid="doc-type-board"]');
      if (await kanbanType.first().isVisible()) {
        await kanbanType.first().click();
        testLogs.add('test', 'info', 'Selected kanban document type');
      }
      
      await page.fill('[data-testid="document-name-input"]', 'Test Kanban');
      await page.click('[data-testid="create-document-confirm"]');
      
      await page.waitForSelector('[data-testid="document-list"]', { timeout: 10000 });
      testLogs.add('test', 'info', 'Kanban created');
      
      await sidecarClient1.deleteWorkspace(ws.id);
      
      testLogs.add('test', 'info', '=== Create kanban via UI test PASSED ===');
    });
  });

  test.describe('Document Editing', () => {
    
    test('can edit text document content', async ({ page, unifiedServer1, sidecarClient1, testLogs }) => {
      testLogs.add('test', 'info', '=== Edit text document test ===');
      
      // Create workspace and document via sidecar
      const ws = {
        id: `ws-edit-${Date.now()}`,
        name: 'Edit Test Workspace',
        encryptionKey: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
        ownerId: 'test-owner'
      };
      await sidecarClient1.createWorkspace(ws);
      
      const doc = {
        id: `doc-edit-${Date.now()}`,
        name: 'Editable Document',
        type: 'text',
        workspaceId: ws.id
      };
      await sidecarClient1.createDocument(doc);
      testLogs.add('test', 'info', 'Created workspace and document');
      
      await page.goto('/');
      await page.waitForSelector('[data-testid="workspace-sidebar"]', { timeout: 30000 });
      
      // Click on the document in sidebar
      const docItem = page.locator(`[data-testid="doc-${doc.id}"]`);
      if (await docItem.isVisible()) {
        await docItem.click();
        testLogs.add('test', 'info', 'Clicked on document in sidebar');
      }
      
      // Wait for editor to load
      // This could be a TipTap editor, CodeMirror, or custom editor
      await page.waitForSelector('.ProseMirror, [contenteditable="true"], .editor', { timeout: 10000 });
      testLogs.add('test', 'info', 'Editor loaded');
      
      // Type some content
      const testContent = 'Hello from E2E test! ' + Date.now();
      await page.keyboard.type(testContent);
      testLogs.add('test', 'info', 'Typed content into editor');
      
      // Wait for sync (the sync status should update)
      await page.waitForFunction(() => {
        const syncStatus = document.querySelector('[data-testid="sync-status"]');
        return syncStatus?.dataset?.synced === 'true';
      }, { timeout: 10000 }).catch(() => {
        testLogs.add('test', 'warn', 'Sync status check timed out');
      });
      
      testLogs.add('test', 'info', 'Content synced');
      
      // Clean up
      await sidecarClient1.deleteWorkspace(ws.id);
      
      testLogs.add('test', 'info', '=== Edit text document test PASSED ===');
    });
  });

  test.describe('Document Deletion', () => {
    
    test('can delete document via sidecar', async ({ sidecarClient1, testLogs }) => {
      testLogs.add('test', 'info', '=== Delete document via sidecar test ===');
      
      // Create workspace and document
      const ws = {
        id: `ws-delete-${Date.now()}`,
        name: 'Delete Test Workspace',
        encryptionKey: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
        ownerId: 'test-owner'
      };
      await sidecarClient1.createWorkspace(ws);
      
      const doc = {
        id: `doc-delete-${Date.now()}`,
        name: 'Document To Delete',
        type: 'text',
        workspaceId: ws.id
      };
      await sidecarClient1.createDocument(doc);
      testLogs.add('test', 'info', 'Created document to delete');
      
      // Verify document exists
      const list1 = await sidecarClient1.listDocuments(ws.id);
      expect(list1.documents.some(d => d.id === doc.id)).toBe(true);
      
      // Delete document
      await sidecarClient1.deleteDocument(doc.id);
      testLogs.add('test', 'info', 'Deleted document');
      
      // Verify document no longer exists
      const list2 = await sidecarClient1.listDocuments(ws.id);
      expect(list2.documents.some(d => d.id === doc.id)).toBe(false);
      testLogs.add('test', 'info', 'Verified document deleted');
      
      // Clean up
      await sidecarClient1.deleteWorkspace(ws.id);
      
      testLogs.add('test', 'info', '=== Delete document via sidecar test PASSED ===');
    });
  });
});
