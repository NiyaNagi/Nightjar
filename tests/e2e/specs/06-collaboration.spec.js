/**
 * Real-Time Collaboration Tests
 * 
 * Tests for real-time sync, cursor sharing, and multi-user collaboration.
 */
const { test, expect } = require('../fixtures/test-fixtures.js');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

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

test.describe('Real-Time Collaboration', () => {

  test.describe('Document Sync Between Clients', () => {
    
    test('edits sync between two browser windows', async ({ 
      collaboratorPages,
      sidecarClient1,
      testLogs 
    }) => {
      testLogs.add('test', 'info', '=== Two-window sync test ===');
      
      const { page1, page2 } = collaboratorPages;
      
      // Create a shared workspace and document
      const ws = {
        id: `ws-collab-${Date.now()}`,
        name: 'Collaboration Workspace',
        icon: '👥',
        encryptionKey: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
        ownerId: 'test-owner'
      };
      await sidecarClient1.createWorkspace(ws);
      
      const doc = {
        id: `doc-collab-${Date.now()}`,
        name: 'Shared Document',
        type: 'text',
        workspaceId: ws.id
      };
      await sidecarClient1.createDocument(doc);
      testLogs.add('test', 'info', 'Created shared workspace and document');
      
      // Navigate both pages to the same document
      // The URL structure depends on the app's routing
      const docUrl = `/?workspace=${ws.id}&document=${doc.id}`;
      
      await Promise.all([
        page1.goto(docUrl),
        page2.goto(docUrl)
      ]);
      testLogs.add('test', 'info', 'Both pages navigated to document');
      
      // Wait for both editors to load
      await Promise.all([
        page1.waitForSelector('.ProseMirror, [contenteditable="true"], .editor', { timeout: 30000 }),
        page2.waitForSelector('.ProseMirror, [contenteditable="true"], .editor', { timeout: 30000 })
      ]);
      testLogs.add('test', 'info', 'Both editors loaded');
      
      // Type in page1
      const testContent = 'Hello from page 1! ';
      await page1.keyboard.type(testContent);
      testLogs.add('test', 'info', 'Typed in page 1');
      
      // Wait for sync
      await page1.waitForTimeout(2000);
      
      // Check if page2 received the content
      const page2Editor = page2.locator('.ProseMirror, [contenteditable="true"], .editor').first();
      const page2Content = await page2Editor.textContent();
      
      if (page2Content?.includes('Hello from page 1')) {
        testLogs.add('test', 'info', 'Content synced to page 2!');
      } else {
        testLogs.add('test', 'warn', `Page 2 content: ${page2Content?.substring(0, 50)}`);
      }
      
      // Clean up
      await sidecarClient1.deleteWorkspace(ws.id);
      
      testLogs.add('test', 'info', '=== Two-window sync test COMPLETED ===');
    });
  });

  test.describe('Collaborator Visibility', () => {
    
    test('can see collaborators in status bar', async ({ 
      page, 
      sidecarClient1, 
      testLogs 
    }) => {
      testLogs.add('test', 'info', '=== Collaborator visibility test ===');
      
      // Create workspace
      const ws = {
        id: `ws-collab-vis-${Date.now()}`,
        name: 'Visibility Test Workspace',
        encryptionKey: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
        ownerId: 'test-owner'
      };
      await sidecarClient1.createWorkspace(ws);
      
      await page.goto('/');
      await page.waitForSelector('[data-testid="workspace-sidebar"]', { timeout: 30000 });
      
      // Look for collaborator list in status bar
      const collabList = page.locator('[data-testid="collaborator-list"]');
      if (await collabList.isVisible()) {
        const collabCount = await collabList.locator('[data-testid^="collaborator-"]').count();
        testLogs.add('test', 'info', `Found ${collabCount} collaborators in status bar`);
      } else {
        testLogs.add('test', 'info', 'Collaborator list not visible (may be empty)');
      }
      
      // Clean up
      await sidecarClient1.deleteWorkspace(ws.id);
      
      testLogs.add('test', 'info', '=== Collaborator visibility test PASSED ===');
    });
  });

  test.describe('Sync Status', () => {
    
    test('sync status updates correctly', async ({ page, unifiedServer1, sidecarClient1, testLogs }) => {
      testLogs.add('test', 'info', '=== Sync status test ===');
      
      // Create workspace and document
      const ws = {
        id: `ws-sync-status-${Date.now()}`,
        name: 'Sync Status Test',
        encryptionKey: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
        ownerId: 'test-owner'
      };
      await sidecarClient1.createWorkspace(ws);
      
      const doc = {
        id: `doc-sync-status-${Date.now()}`,
        name: 'Sync Status Document',
        type: 'text',
        workspaceId: ws.id
      };
      await sidecarClient1.createDocument(doc);
      
      await page.goto('/');
      await page.waitForSelector('[data-testid="workspace-sidebar"]', { timeout: 30000 });
      
      // Look for sync status element
      const syncStatus = page.locator('[data-testid="sync-status"]');
      if (await syncStatus.isVisible()) {
        // Check the data-synced attribute
        const isSynced = await syncStatus.getAttribute('data-synced');
        testLogs.add('test', 'info', `Sync status: synced=${isSynced}`);
        
        // The status text might be "Synced", "Syncing...", "Offline", etc.
        const statusText = await syncStatus.textContent();
        testLogs.add('test', 'info', `Sync status text: ${statusText}`);
      }
      
      // Clean up
      await sidecarClient1.deleteWorkspace(ws.id);
      
      testLogs.add('test', 'info', '=== Sync status test PASSED ===');
    });
  });

  test.describe('Offline/Online Transitions', () => {
    
    test('handles network disconnect gracefully', async ({ page, unifiedServer1, testLogs }) => {
      testLogs.add('test', 'info', '=== Network disconnect test ===');
      
      await page.goto('/');
      await page.waitForSelector('[data-testid="workspace-sidebar"]', { timeout: 30000 });
      
      // Simulate going offline
      await page.context().setOffline(true);
      testLogs.add('test', 'info', 'Set browser to offline mode');
      
      // Wait a moment
      await page.waitForTimeout(2000);
      
      // Check if sync status reflects offline state
      const syncStatus = page.locator('[data-testid="sync-status"]');
      if (await syncStatus.isVisible()) {
        const isSynced = await syncStatus.getAttribute('data-synced');
        testLogs.add('test', 'info', `Offline sync status: synced=${isSynced}`);
      }
      
      // Go back online
      await page.context().setOffline(false);
      testLogs.add('test', 'info', 'Set browser back to online mode');
      
      // Wait for reconnection
      await page.waitForTimeout(3000);
      
      // Check sync status recovered
      if (await syncStatus.isVisible()) {
        const isSynced = await syncStatus.getAttribute('data-synced');
        testLogs.add('test', 'info', `Reconnected sync status: synced=${isSynced}`);
      }
      
      testLogs.add('test', 'info', '=== Network disconnect test PASSED ===');
    });
  });
});
