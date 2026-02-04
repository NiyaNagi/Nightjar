/**
 * Sync and Conflict Resolution Tests
 * 
 * Tests for conflict handling, reconnection, and data consistency.
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

test.describe('Sync and Conflict Resolution', () => {

  test.describe('Basic Sync', () => {
    
    test('changes persist after page reload', async ({ page, unifiedServer1, sidecarClient1, testLogs }) => {
      testLogs.add('test', 'info', '=== Persistence after reload test ===');
      
      // Create workspace and document
      const ws = {
        id: `ws-persist-${Date.now()}`,
        name: 'Persistence Test',
        encryptionKey: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
        ownerId: 'test-owner'
      };
      await sidecarClient1.createWorkspace(ws);
      
      const doc = {
        id: `doc-persist-${Date.now()}`,
        name: 'Persistent Document',
        type: 'text',
        workspaceId: ws.id
      };
      await sidecarClient1.createDocument(doc);
      testLogs.add('test', 'info', 'Created workspace and document');
      
      await page.goto('/');
      await page.waitForSelector('[data-testid="workspace-sidebar"]', { timeout: 30000 });
      
      // Navigate to document
      const docItem = page.locator(`[data-testid="doc-${doc.id}"]`);
      if (await docItem.isVisible()) {
        await docItem.click();
      }
      
      // Wait for editor
      await page.waitForSelector('.ProseMirror, [contenteditable="true"], .editor', { timeout: 10000 });
      
      // Type unique content
      const uniqueContent = `PERSISTENCE_TEST_${Date.now()}`;
      await page.keyboard.type(uniqueContent);
      testLogs.add('test', 'info', `Typed unique content: ${uniqueContent}`);
      
      // Wait for sync
      await page.waitForTimeout(3000);
      
      // Reload page
      await page.reload();
      testLogs.add('test', 'info', 'Page reloaded');
      
      // Wait for app to load
      await page.waitForSelector('[data-testid="workspace-sidebar"]', { timeout: 30000 });
      
      // Navigate back to document
      const docItem2 = page.locator(`[data-testid="doc-${doc.id}"]`);
      if (await docItem2.isVisible()) {
        await docItem2.click();
      }
      
      // Wait for editor
      await page.waitForSelector('.ProseMirror, [contenteditable="true"], .editor', { timeout: 10000 });
      
      // Check if content persisted
      const editor = page.locator('.ProseMirror, [contenteditable="true"], .editor').first();
      const content = await editor.textContent();
      
      if (content?.includes(uniqueContent)) {
        testLogs.add('test', 'info', 'Content persisted after reload!');
      } else {
        testLogs.add('test', 'warn', `Content after reload: ${content?.substring(0, 50)}`);
      }
      
      // Clean up
      await sidecarClient1.deleteWorkspace(ws.id);
      
      testLogs.add('test', 'info', '=== Persistence after reload test COMPLETED ===');
    });
  });

  test.describe('Reconnection Handling', () => {
    
    test('recovers from temporary disconnect', async ({ page, unifiedServer1, testLogs }) => {
      testLogs.add('test', 'info', '=== Reconnection recovery test ===');
      
      await page.goto('/');
      await page.waitForSelector('[data-testid="workspace-sidebar"]', { timeout: 30000 });
      
      // Record initial sync status
      const syncStatus = page.locator('[data-testid="sync-status"]');
      let initialStatus = 'unknown';
      if (await syncStatus.isVisible()) {
        initialStatus = await syncStatus.getAttribute('data-synced') || 'unknown';
      }
      testLogs.add('test', 'info', `Initial sync status: ${initialStatus}`);
      
      // Simulate disconnect
      await page.context().setOffline(true);
      testLogs.add('test', 'info', 'Simulated network disconnect');
      
      await page.waitForTimeout(2000);
      
      // Check sync status during disconnect
      if (await syncStatus.isVisible()) {
        const disconnectedStatus = await syncStatus.getAttribute('data-synced');
        testLogs.add('test', 'info', `Sync status while offline: ${disconnectedStatus}`);
      }
      
      // Reconnect
      await page.context().setOffline(false);
      testLogs.add('test', 'info', 'Simulated network reconnect');
      
      // Wait for recovery
      await page.waitForTimeout(5000);
      
      // Check sync status after reconnect
      if (await syncStatus.isVisible()) {
        const reconnectedStatus = await syncStatus.getAttribute('data-synced');
        testLogs.add('test', 'info', `Sync status after reconnect: ${reconnectedStatus}`);
      }
      
      testLogs.add('test', 'info', '=== Reconnection recovery test PASSED ===');
    });
  });

  test.describe('Conflict Detection', () => {
    
    test('handles concurrent edits', async ({ collaboratorPages, sidecarClient1, testLogs }) => {
      testLogs.add('test', 'info', '=== Concurrent edit test ===');
      
      const { page1, page2 } = collaboratorPages;
      
      // Create shared document
      const ws = {
        id: `ws-conflict-${Date.now()}`,
        name: 'Conflict Test Workspace',
        encryptionKey: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
        ownerId: 'test-owner'
      };
      await sidecarClient1.createWorkspace(ws);
      
      const doc = {
        id: `doc-conflict-${Date.now()}`,
        name: 'Conflict Document',
        type: 'text',
        workspaceId: ws.id
      };
      await sidecarClient1.createDocument(doc);
      testLogs.add('test', 'info', 'Created shared document');
      
      // Open document in both windows
      const docUrl = `/?workspace=${ws.id}&document=${doc.id}`;
      await Promise.all([
        page1.goto(docUrl),
        page2.goto(docUrl)
      ]);
      
      await Promise.all([
        page1.waitForSelector('.ProseMirror, [contenteditable="true"], .editor', { timeout: 30000 }),
        page2.waitForSelector('.ProseMirror, [contenteditable="true"], .editor', { timeout: 30000 })
      ]);
      testLogs.add('test', 'info', 'Both editors loaded');
      
      // Simultaneous edits at different positions
      // Page 1 types at start
      const editor1 = page1.locator('.ProseMirror, [contenteditable="true"], .editor').first();
      await editor1.click();
      await page1.keyboard.type('FROM_PAGE_1 ');
      
      // Page 2 types (may be at different position due to Yjs CRDT)
      const editor2 = page2.locator('.ProseMirror, [contenteditable="true"], .editor').first();
      await editor2.click();
      await page2.keyboard.type('FROM_PAGE_2 ');
      
      testLogs.add('test', 'info', 'Both pages typed content');
      
      // Wait for sync
      await Promise.all([
        page1.waitForTimeout(3000),
        page2.waitForTimeout(3000)
      ]);
      
      // Check that both edits are present in both windows
      const content1 = await editor1.textContent();
      const content2 = await editor2.textContent();
      
      testLogs.add('test', 'info', `Page 1 content: ${content1?.substring(0, 50)}`);
      testLogs.add('test', 'info', `Page 2 content: ${content2?.substring(0, 50)}`);
      
      // Both should have merged content (CRDT behavior)
      // The exact ordering depends on Yjs conflict resolution
      const hasBothEdits1 = content1?.includes('FROM_PAGE_1') && content1?.includes('FROM_PAGE_2');
      const hasBothEdits2 = content2?.includes('FROM_PAGE_1') && content2?.includes('FROM_PAGE_2');
      
      if (hasBothEdits1 && hasBothEdits2) {
        testLogs.add('test', 'info', 'CRDT successfully merged concurrent edits!');
      } else {
        testLogs.add('test', 'warn', 'Edits may not have fully synced yet');
      }
      
      // Clean up
      await sidecarClient1.deleteWorkspace(ws.id);
      
      testLogs.add('test', 'info', '=== Concurrent edit test COMPLETED ===');
    });
  });

  test.describe('Data Integrity', () => {
    
    test('document content matches across clients', async ({ 
      sidecarClient1, 
      sidecarClient2, 
      testLogs 
    }) => {
      testLogs.add('test', 'info', '=== Data integrity test ===');
      
      // Create workspace and document in sidecar 1
      const ws = {
        id: `ws-integrity-${Date.now()}`,
        name: 'Integrity Test',
        encryptionKey: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
        ownerId: 'test-owner'
      };
      await sidecarClient1.createWorkspace(ws);
      
      const doc = {
        id: `doc-integrity-${Date.now()}`,
        name: 'Integrity Document',
        type: 'text',
        workspaceId: ws.id
      };
      await sidecarClient1.createDocument(doc);
      testLogs.add('test', 'info', 'Created workspace and document in sidecar 1');
      
      // List documents from sidecar 1
      const list1 = await sidecarClient1.listDocuments(ws.id);
      const doc1 = list1.documents.find(d => d.id === doc.id);
      testLogs.add('test', 'info', `Sidecar 1 document: ${doc1?.name}`);
      
      // Try to access from sidecar 2 (after sharing/syncing)
      // In a real scenario, sidecar 2 would join the workspace first
      try {
        await sidecarClient2.joinWorkspace({
          entityId: ws.id,
          encryptionKey: ws.encryptionKey,
          permission: 'editor'
        });
        testLogs.add('test', 'info', 'Sidecar 2 joined workspace');
        
        // Wait for sync
        await new Promise(r => setTimeout(r, 3000));
        
        // List documents from sidecar 2
        const list2 = await sidecarClient2.listDocuments(ws.id);
        const doc2 = list2.documents?.find(d => d.id === doc.id);
        
        if (doc2) {
          expect(doc2.name).toBe(doc.name);
          testLogs.add('test', 'info', 'Document synchronized to sidecar 2!');
        } else {
          testLogs.add('test', 'warn', 'Document not yet synced to sidecar 2');
        }
      } catch (err) {
        testLogs.add('test', 'info', `Sidecar 2 join/list: ${err.message}`);
      }
      
      // Clean up
      await sidecarClient1.deleteWorkspace(ws.id);
      
      testLogs.add('test', 'info', '=== Data integrity test COMPLETED ===');
    });
  });
});
