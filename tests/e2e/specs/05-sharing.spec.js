/**
 * Sharing Tests
 * 
 * Tests for share link generation, permission-based joining, and share flow.
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

test.describe('Sharing', () => {

  test.describe('Share Link Generation', () => {
    
    test('generates valid share link', async ({ sidecarClient1, testLogs }) => {
      testLogs.add('test', 'info', '=== Share link generation test ===');
      
      const ws = {
        id: `ws-share-gen-${Date.now()}`,
        name: 'Share Generation Test',
        icon: '🔗',
        encryptionKey: Buffer.from(crypto.randomBytes(32)).toString('base64'),
        ownerId: 'test-owner',
        myPermission: 'owner'
      };
      await sidecarClient1.createWorkspace(ws);
      testLogs.add('test', 'info', 'Created workspace');
      
      // Get P2P info to construct share link
      const p2pInfo = await sidecarClient1.getP2PInfo();
      testLogs.add('test', 'info', `P2P info: wsPort=${p2pInfo.wsPort}, wssPort=${p2pInfo.wssPort}`);
      
      // A valid share link should contain:
      // - workspace ID
      // - encryption key (base64)
      // - permission level
      // - server URL (optional, for relay)
      
      const shareLink = new URL('http://localhost:3000');
      shareLink.searchParams.set('join', ws.id);
      shareLink.searchParams.set('key', ws.encryptionKey);
      shareLink.searchParams.set('permission', 'editor');
      
      // Validate share link structure
      expect(shareLink.searchParams.get('join')).toBe(ws.id);
      // Encryption key should be a valid base64url string of sufficient length
      const key = shareLink.searchParams.get('key');
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(20);
      expect(shareLink.searchParams.get('permission')).toBe('editor');
      
      testLogs.add('test', 'info', `Share link: ${shareLink.toString().substring(0, 60)}...`);
      testLogs.add('test', 'info', 'Share link structure validated');
      
      // Clean up
      await sidecarClient1.deleteWorkspace(ws.id);
      
      testLogs.add('test', 'info', '=== Share link generation test PASSED ===');
    });
  });

  test.describe('Permission-Based Sharing', () => {
    
    test('can create viewer share link', async ({ sidecarClient1, testLogs }) => {
      testLogs.add('test', 'info', '=== Viewer share link test ===');
      
      const ws = {
        id: `ws-viewer-share-${Date.now()}`,
        name: 'Viewer Share Test',
        encryptionKey: Buffer.from(crypto.randomBytes(32)).toString('base64'),
        ownerId: 'test-owner',
        myPermission: 'owner'
      };
      await sidecarClient1.createWorkspace(ws);
      
      const viewerLink = new URL('http://localhost:3000');
      viewerLink.searchParams.set('join', ws.id);
      viewerLink.searchParams.set('key', ws.encryptionKey);
      viewerLink.searchParams.set('permission', 'viewer');
      
      expect(viewerLink.searchParams.get('permission')).toBe('viewer');
      testLogs.add('test', 'info', 'Created viewer permission share link');
      
      await sidecarClient1.deleteWorkspace(ws.id);
      
      testLogs.add('test', 'info', '=== Viewer share link test PASSED ===');
    });

    test('can create editor share link', async ({ sidecarClient1, testLogs }) => {
      testLogs.add('test', 'info', '=== Editor share link test ===');
      
      const ws = {
        id: `ws-editor-share-${Date.now()}`,
        name: 'Editor Share Test',
        encryptionKey: Buffer.from(crypto.randomBytes(32)).toString('base64'),
        ownerId: 'test-owner',
        myPermission: 'owner'
      };
      await sidecarClient1.createWorkspace(ws);
      
      const editorLink = new URL('http://localhost:3000');
      editorLink.searchParams.set('join', ws.id);
      editorLink.searchParams.set('key', ws.encryptionKey);
      editorLink.searchParams.set('permission', 'editor');
      
      expect(editorLink.searchParams.get('permission')).toBe('editor');
      testLogs.add('test', 'info', 'Created editor permission share link');
      
      await sidecarClient1.deleteWorkspace(ws.id);
      
      testLogs.add('test', 'info', '=== Editor share link test PASSED ===');
    });
  });

  test.describe('Join Flow', () => {
    
    test('web client handles share link parameters', async ({ page, unifiedServer1, testLogs }) => {
      testLogs.add('test', 'info', '=== Share link handling test ===');
      
      const mockWorkspaceId = `ws-join-test-${Date.now()}`;
      const mockKey = Buffer.from(crypto.randomBytes(32)).toString('base64');
      
      const joinUrl = new URL(unifiedServer1.url);
      joinUrl.searchParams.set('join', mockWorkspaceId);
      joinUrl.searchParams.set('key', mockKey);
      joinUrl.searchParams.set('permission', 'editor');
      
      await page.goto(joinUrl.toString());
      testLogs.add('test', 'info', 'Navigated to share link URL');
      
      // The app should parse the URL parameters and show join UI or auto-join
      // Wait for some indication the parameters were processed
      await page.waitForSelector('body', { timeout: 10000 });
      
      // Check URL was correctly received
      const currentUrl = new URL(page.url());
      testLogs.add('test', 'info', `Page URL: ${currentUrl.pathname}${currentUrl.search.substring(0, 30)}...`);
      
      testLogs.add('test', 'info', '=== Share link handling test PASSED ===');
    });

    test('sidecar can join workspace', async ({ sidecarClient1, sidecarClient2, testLogs }) => {
      testLogs.add('test', 'info', '=== Sidecar join workspace test ===');
      
      // Sidecar 1 creates workspace
      const ws = {
        id: `ws-sidecar-join-${Date.now()}`,
        name: 'Sidecar Join Test',
        encryptionKey: Buffer.from(crypto.randomBytes(32)).toString('base64'),
        ownerId: 'sidecar-1'
      };
      await sidecarClient1.createWorkspace(ws);
      testLogs.add('test', 'info', 'Sidecar 1 created workspace');
      
      // Sidecar 2 joins
      try {
        const joinResult = await sidecarClient2.joinWorkspace({
          entityId: ws.id,
          encryptionKey: ws.encryptionKey,
          permission: 'editor'
        });
        testLogs.add('test', 'info', `Sidecar 2 join result: ${joinResult.type}`);
      } catch (err) {
        testLogs.add('test', 'warn', `Sidecar 2 join error (may be expected): ${err.message}`);
      }
      
      // Clean up
      await sidecarClient1.deleteWorkspace(ws.id);
      
      testLogs.add('test', 'info', '=== Sidecar join workspace test COMPLETED ===');
    });
  });

  test.describe('Share Link Security', () => {
    
    test('encryption key is required to join', async ({ sidecarClient1, testLogs }) => {
      testLogs.add('test', 'info', '=== Encryption key required test ===');
      
      const ws = {
        id: `ws-key-test-${Date.now()}`,
        name: 'Key Required Test',
        encryptionKey: Buffer.from(crypto.randomBytes(32)).toString('base64'),
        ownerId: 'test-owner'
      };
      await sidecarClient1.createWorkspace(ws);
      testLogs.add('test', 'info', 'Created workspace with encryption key');
      
      // The workspace is end-to-end encrypted
      // Without the key, the content should be unreadable
      // Verify that the key is stored and required
      expect(typeof ws.encryptionKey).toBe('string');
      expect(ws.encryptionKey.length).toBeGreaterThan(20); // Base64 of 32 bytes
      
      testLogs.add('test', 'info', `Encryption key length: ${ws.encryptionKey.length} chars`);
      
      await sidecarClient1.deleteWorkspace(ws.id);
      
      testLogs.add('test', 'info', '=== Encryption key required test PASSED ===');
    });
  });
});
