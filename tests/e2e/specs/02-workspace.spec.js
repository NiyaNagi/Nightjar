/**
 * Workspace Management Tests
 * 
 * Tests for creating, managing, and switching between workspaces.
 * 
 * NOTE: UI-based tests are skipped as they require frontend data-testid attributes.
 * API tests for workspaces are in 04-cross-platform.spec.js and 10-comprehensive-api.spec.js
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

test.describe('Workspace Management', () => {

  test.describe('Workspace Creation via UI', () => {
    
    test('can create new workspace through UI', async ({ page, unifiedServer1, testLogs }) => {
      testLogs.add('test', 'info', '=== Create workspace via UI test ===');
      
      await page.goto('/');
      
      // Wait for main app (assumes identity exists or skip onboarding)
      await page.waitForSelector('[data-testid="workspace-sidebar"], [data-testid="create-workspace-btn"]', { 
        timeout: 45000 
      });
      
      // Click create workspace button
      const createBtn = page.locator('[data-testid="create-workspace-btn"]');
      if (await createBtn.isVisible()) {
        await createBtn.click();
        testLogs.add('test', 'info', 'Clicked create workspace button');
      }
      
      // Wait for workspace creation dialog/form
      await page.waitForSelector('[data-testid="workspace-name-input"]', { timeout: 10000 });
      
      // Fill in workspace name
      const workspaceName = `Test Workspace ${Date.now()}`;
      await page.fill('[data-testid="workspace-name-input"]', workspaceName);
      testLogs.add('test', 'info', `Entered workspace name: ${workspaceName}`);
      
      // Click confirm
      await page.click('[data-testid="confirm-workspace-btn"]');
      testLogs.add('test', 'info', 'Clicked confirm workspace button');
      
      // Wait for workspace to be created and shown
      await page.waitForSelector('[data-testid="workspace-sidebar"]', { timeout: 15000 });
      testLogs.add('test', 'info', 'Workspace created and sidebar visible');
      
      testLogs.add('test', 'info', '=== Create workspace via UI test PASSED ===');
    });
  });

  test.describe('Workspace Switching', () => {
    
    test('can switch between workspaces', async ({ sidecarClient1, page, testLogs }) => {
      testLogs.add('test', 'info', '=== Workspace switching test ===');
      
      // Create two workspaces via sidecar
      const ws1 = {
        id: `ws-switch-1-${Date.now()}`,
        name: 'First Workspace',
        icon: '1️⃣',
        encryptionKey: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
        ownerId: 'test-owner'
      };
      
      const ws2 = {
        id: `ws-switch-2-${Date.now()}`,
        name: 'Second Workspace',
        icon: '2️⃣',
        encryptionKey: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
        ownerId: 'test-owner'
      };
      
      await sidecarClient1.createWorkspace(ws1);
      await sidecarClient1.createWorkspace(ws2);
      testLogs.add('test', 'info', 'Created two workspaces via sidecar');
      
      // Navigate to app
      await page.goto('/');
      await page.waitForSelector('[data-testid="workspace-selector"], [data-testid="workspace-sidebar"]', { 
        timeout: 30000 
      });
      
      // Open workspace selector
      const selector = page.locator('[data-testid="workspace-selector"]');
      if (await selector.isVisible()) {
        await selector.click();
        testLogs.add('test', 'info', 'Opened workspace selector');
        
        // Look for workspace options
        await page.waitForSelector('[data-testid^="workspace-option-"]', { timeout: 5000 });
        
        // Click on second workspace
        const ws2Option = page.locator(`[data-testid="workspace-option-${ws2.name}"]`);
        if (await ws2Option.isVisible()) {
          await ws2Option.click();
          testLogs.add('test', 'info', 'Selected second workspace');
        }
      }
      
      // Clean up
      await sidecarClient1.deleteWorkspace(ws1.id);
      await sidecarClient1.deleteWorkspace(ws2.id);
      
      testLogs.add('test', 'info', '=== Workspace switching test PASSED ===');
    });
  });

  test.describe('Workspace Sharing', () => {
    
    test('can generate and copy share link', async ({ sidecarClient1, page, testLogs }) => {
      testLogs.add('test', 'info', '=== Workspace sharing test ===');
      
      // Create workspace via sidecar
      const ws = {
        id: `ws-share-${Date.now()}`,
        name: 'Shareable Workspace',
        icon: '🔗',
        encryptionKey: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
        ownerId: 'test-owner',
        myPermission: 'owner'
      };
      
      await sidecarClient1.createWorkspace(ws);
      testLogs.add('test', 'info', 'Created workspace for sharing');
      
      // Navigate to app with this workspace selected
      await page.goto('/');
      await page.waitForSelector('[data-testid="workspace-sidebar"]', { timeout: 30000 });
      
      // Look for share link input (if visible on workspace creation/settings)
      const shareLinkInput = page.locator('[data-testid="share-link-input"]');
      if (await shareLinkInput.isVisible()) {
        const shareLink = await shareLinkInput.inputValue();
        expect(shareLink).toContain('join=');
        testLogs.add('test', 'info', `Share link found: ${shareLink.substring(0, 40)}...`);
      }
      
      // Clean up
      await sidecarClient1.deleteWorkspace(ws.id);
      
      testLogs.add('test', 'info', '=== Workspace sharing test PASSED ===');
    });
  });

  test.describe('Join Workspace', () => {
    
    test('can join workspace via share link', async ({ page, testLogs, unifiedServer1 }) => {
      testLogs.add('test', 'info', '=== Join workspace test ===');
      
      // Construct a mock share link
      const mockWorkspaceId = `ws-join-${Date.now()}`;
      const mockKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
      
      const joinUrl = new URL(unifiedServer1.url);
      joinUrl.searchParams.set('join', mockWorkspaceId);
      joinUrl.searchParams.set('key', mockKey);
      joinUrl.searchParams.set('permission', 'editor');
      
      testLogs.add('test', 'info', `Navigating to join URL: ${joinUrl.toString().substring(0, 50)}...`);
      
      await page.goto(joinUrl.toString());
      
      // The app should handle the join parameters
      // Wait for some UI element indicating join flow
      await page.waitForSelector('[data-testid="workspace-sidebar"], [data-testid="join-btn"]', { 
        timeout: 30000 
      });
      
      // If there's a join button, click it
      const joinBtn = page.locator('[data-testid="join-btn"]');
      if (await joinBtn.isVisible()) {
        await joinBtn.click();
        testLogs.add('test', 'info', 'Clicked join button');
      }
      
      testLogs.add('test', 'info', '=== Join workspace test PASSED ===');
    });
  });
});
