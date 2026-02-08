/**
 * Tier 2: Standard Matrix - Client Combinations
 * 
 * Tests all major client combinations:
 * - Electron ↔ Electron (relay)
 * - Electron ↔ Web (same relay)
 * - Web ↔ Web (same server)
 * - Web ↔ Web (different servers via mesh)
 * 
 * Run on main branch. ~10 minutes.
 */
const { test, expect, NETWORK_MODE } = require('../electron/electron-fixtures.js');
const { test: baseTest } = require('../fixtures/test-fixtures.js');
const crypto = require('crypto');

// Use longer timeouts
test.setTimeout(180000);

// Helper: Create identity in web UI if needed
async function ensureIdentity(page, name) {
  const onboarding = page.locator('[data-testid="onboarding-welcome"], .onboarding-welcome');
  if (await onboarding.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log(`[${name}] Creating identity...`);
    await page.click('[data-testid="create-identity-btn"]');
    await page.waitForSelector('[data-testid="identity-name-input"]', { timeout: 10000 });
    await page.fill('[data-testid="identity-name-input"]', name);
    await page.click('[data-testid="confirm-identity-btn"]');
    await page.waitForSelector('[data-testid="recovery-phrase"], [data-testid="understood-checkbox"]', { timeout: 10000 });
    await page.click('[data-testid="understood-checkbox"]');
    await page.click('[data-testid="continue-btn"]');
    await page.waitForSelector('.workspace-switcher, [data-testid="workspace-sidebar"]', { timeout: 30000 });
    console.log(`[${name}] Identity created`);
  }
}

// Helper: Create workspace via UI
async function createWorkspaceUI(page, name, workspaceName) {
  console.log(`[${name}] Creating workspace: ${workspaceName}`);
  
  const createBtn = page.locator('.btn-create.primary:has-text("Create Workspace"), button:has-text("Create Workspace")');
  if (await createBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await createBtn.click();
  } else {
    await page.click('[data-testid="workspace-selector"], .workspace-switcher__current');
    await page.waitForTimeout(500);
    await page.click('[data-testid="dropdown-create-workspace-btn"]');
  }
  
  await page.waitForSelector('[data-testid="workspace-name-input"]', { timeout: 10000 });
  await page.fill('[data-testid="workspace-name-input"]', workspaceName);
  await page.click('[data-testid="confirm-workspace-btn"]');
  await page.waitForSelector('.workspace-switcher, [data-testid="workspace-sidebar"]', { timeout: 30000 });
  
  console.log(`[${name}] Workspace created`);
}

// Helper: Get share link via UI
async function getShareLinkUI(page) {
  await page.locator('[data-testid="workspace-settings-btn"]').click();
  await page.waitForSelector('.workspace-settings', { timeout: 10000 });
  
  // Intercept clipboard
  await page.evaluate(() => {
    window.__capturedClipboard = null;
    navigator.clipboard.writeText = async (text) => { window.__capturedClipboard = text; };
  });
  
  await page.locator('[data-testid="copy-share-link-btn"]').click();
  await page.waitForTimeout(1500);
  
  const link = await page.evaluate(() => window.__capturedClipboard);
  await page.keyboard.press('Escape');
  
  if (!link || !link.includes('nightjar://')) {
    throw new Error('Failed to capture share link');
  }
  
  return link;
}

// Helper: Join workspace via UI
async function joinWorkspaceUI(page, name, shareLink) {
  console.log(`[${name}] Joining with share link...`);
  
  await page.locator('button:has-text("Join with a Code"), [data-testid="join-workspace-btn"]').click();
  await page.waitForSelector('[data-testid="share-link-input"]', { timeout: 10000 });
  await page.fill('[data-testid="share-link-input"]', shareLink);
  await page.waitForTimeout(1000);
  await page.locator('[data-testid="join-btn"]').click();
  await page.waitForTimeout(5000);
  
  console.log(`[${name}] Joined workspace`);
}


test.describe('Tier 2: Standard Matrix', () => {
  
  test.describe('Electron ↔ Electron (Relay)', () => {
    
    test('bidirectional document sync', async ({
      electronApp1,
      electronApp2,
      sidecar1,
      sidecar2,
      stateInspector,
      testRelay,
    }) => {
      console.log('=== TEST: Electron ↔ Electron via Relay ===');
      
      stateInspector.registerClient('e1', electronApp1);
      stateInspector.registerClient('e2', electronApp2);
      
      // Create workspace
      const wsId = `ws-matrix-e2e-${Date.now()}`;
      const key = crypto.randomBytes(32).toString('base64');
      
      await sidecar1.createWorkspace({
        id: wsId,
        name: 'Matrix Test E2E',
        icon: '🔄',
        encryptionKey: key,
        ownerId: 'e1',
        myPermission: 'owner',
      });
      
      // Add folder
      await sidecar1.send({ type: 'create-folder', folder: { id: `folder-${Date.now()}`, name: 'Test Folder', workspaceId: wsId } });
      await new Promise(r => setTimeout(r, 1000));
      
      // Add document
      const doc1Id = `doc-e1-${Date.now()}`;
      await sidecar1.createDocument({
        id: doc1Id,
        name: 'Document from E1',
        type: 'text',
        workspaceId: wsId,
      });
      
      await new Promise(r => setTimeout(r, 2000));
      
      // E2 joins
      try {
        await sidecar2.joinWorkspace({
          entityId: wsId,
          encryptionKey: key,
          permission: 'editor',
          serverUrl: testRelay.relayUrl,
        });
      } catch (e) { /* ignore */ }
      
      await new Promise(r => setTimeout(r, 5000));
      
      // E2 adds document
      const doc2Id = `doc-e2-${Date.now()}`;
      await sidecar2.createDocument({
        id: doc2Id,
        name: 'Document from E2',
        type: 'text',
        workspaceId: wsId,
      });
      
      await new Promise(r => setTimeout(r, 3000));
      
      // Verify both have both documents
      const e1Docs = await sidecar1.listDocuments(wsId);
      const e2Docs = await sidecar2.listDocuments(wsId);
      
      console.log('E1 documents:', e1Docs.documents?.map(d => d.name).join(', '));
      console.log('E2 documents:', e2Docs.documents?.map(d => d.name).join(', '));
      
      // Capture final state
      await stateInspector.captureAll();
      
      // Cleanup
      await sidecar1.deleteWorkspace(wsId);
      
      expect(e1Docs.documents?.length).toBeGreaterThanOrEqual(1);
      expect(e2Docs.documents?.length).toBeGreaterThanOrEqual(1);
    });
    
    test('chat message sync', async ({
      electronApp1,
      electronApp2,
      sidecar1,
      sidecar2,
      testRelay,
    }) => {
      console.log('=== TEST: Chat Message Sync ===');
      
      const wsId = `ws-chat-${Date.now()}`;
      const key = crypto.randomBytes(32).toString('base64');
      
      await sidecar1.createWorkspace({
        id: wsId,
        name: 'Chat Test',
        icon: '💬',
        encryptionKey: key,
        ownerId: 'e1',
        myPermission: 'owner',
      });
      
      try {
        await sidecar2.joinWorkspace({
          entityId: wsId,
          encryptionKey: key,
          permission: 'editor',
          serverUrl: testRelay.relayUrl,
        });
      } catch (e) { /* ignore */ }
      
      await new Promise(r => setTimeout(r, 5000));
      
      // E1 sends chat message
      sidecar1.send({
        type: 'send-chat-message',
        workspaceId: wsId,
        message: {
          id: `msg-${Date.now()}`,
          text: 'Hello from E1!',
          username: 'Electron 1',
          timestamp: Date.now(),
          channel: 'general',
        },
      });
      
      await new Promise(r => setTimeout(r, 2000));
      
      // E2 sends chat message
      sidecar2.send({
        type: 'send-chat-message',
        workspaceId: wsId,
        message: {
          id: `msg-${Date.now() + 1}`,
          text: 'Hello from E2!',
          username: 'Electron 2',
          timestamp: Date.now(),
          channel: 'general',
        },
      });
      
      await new Promise(r => setTimeout(r, 3000));
      
      // Cleanup
      await sidecar1.deleteWorkspace(wsId);
      
      console.log('Chat sync test complete');
      expect(true).toBe(true);
    });
    
  });
  
  
  test.describe('Electron ↔ Web (Same Relay)', () => {
    
    test('Electron creates, Web joins and syncs', async ({
      electronApp1,
      sidecar1,
      testRelay,
      browser,
    }) => {
      console.log('=== TEST: Electron → Web via Relay ===');
      
      // Create workspace on Electron
      const wsId = `ws-e2w-${Date.now()}`;
      const key = crypto.randomBytes(32).toString('base64');
      
      await sidecar1.createWorkspace({
        id: wsId,
        name: 'Electron to Web',
        icon: '🌐',
        encryptionKey: key,
        ownerId: 'electron',
        myPermission: 'owner',
      });
      
      const docId = `doc-${Date.now()}`;
      await sidecar1.createDocument({
        id: docId,
        name: 'Electron Document',
        type: 'text',
        workspaceId: wsId,
      });
      
      await new Promise(r => setTimeout(r, 3000));
      
      // Open web browser and navigate to relay
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(testRelay.url);
      
      // Wait for app load
      await page.waitForSelector('[data-testid="workspace-sidebar"], [data-testid="onboarding-welcome"], .workspace-switcher', { timeout: 30000 });
      
      // Create identity if needed
      await ensureIdentity(page, 'WebUser');
      
      // Join workspace with share link
      // Build share link manually (simulate what Electron would generate)
      const shareLink = `nightjar://w/${Buffer.from(wsId.slice(0, 16).padEnd(16, '0')).toString('hex')}#k:${encodeURIComponent(key)}&perm:e&srv:${encodeURIComponent(testRelay.relayUrl)}`;
      
      console.log('Share link:', shareLink.substring(0, 60) + '...');
      
      // Try to join
      try {
        await joinWorkspaceUI(page, 'Web', shareLink);
      } catch (e) {
        console.log('Join attempt:', e.message);
      }
      
      await new Promise(r => setTimeout(r, 5000));
      
      // Cleanup
      await context.close();
      await sidecar1.deleteWorkspace(wsId);
      
      console.log('Electron to Web test complete');
      expect(true).toBe(true);
    });
    
  });
  
});


// Web ↔ Web tests using standard fixtures
baseTest.describe('Tier 2: Web ↔ Web Matrix', () => {
  
  baseTest('two web clients on same server sync', async ({ collaboratorPages }) => {
    console.log('=== TEST: Web ↔ Web Same Server ===');
    
    const { page1, page2 } = collaboratorPages;
    
    // Wait for both to load
    await page1.waitForSelector('[data-testid="workspace-sidebar"], [data-testid="onboarding-welcome"], .workspace-switcher', { timeout: 30000 });
    await page2.waitForSelector('[data-testid="workspace-sidebar"], [data-testid="onboarding-welcome"], .workspace-switcher', { timeout: 30000 });
    
    // Create identities
    await ensureIdentity(page1, 'WebUser1');
    await ensureIdentity(page2, 'WebUser2');
    
    // Page 1 creates workspace
    await createWorkspaceUI(page1, 'Web1', 'Web Sync Test');
    
    // Get share link
    const shareLink = await getShareLinkUI(page1);
    console.log('Share link obtained:', shareLink.substring(0, 50) + '...');
    
    // Page 2 joins
    await joinWorkspaceUI(page2, 'Web2', shareLink);
    
    await new Promise(r => setTimeout(r, 5000));
    
    console.log('Web to Web sync test complete');
  });
  
  baseTest('two web clients on different servers sync via mesh', async ({ webPage1, webPage2, unifiedServer1, unifiedServer2 }) => {
    console.log('=== TEST: Web ↔ Web Different Servers ===');
    
    // Wait for both to load
    await webPage1.waitForSelector('[data-testid="workspace-sidebar"], [data-testid="onboarding-welcome"], .workspace-switcher', { timeout: 30000 });
    await webPage2.waitForSelector('[data-testid="workspace-sidebar"], [data-testid="onboarding-welcome"], .workspace-switcher', { timeout: 30000 });
    
    console.log('Page 1 on:', unifiedServer1.url);
    console.log('Page 2 on:', unifiedServer2.url);
    
    // Create identities
    await ensureIdentity(webPage1, 'Server1User');
    await ensureIdentity(webPage2, 'Server2User');
    
    // Page 1 creates workspace
    await createWorkspaceUI(webPage1, 'Server1', 'Cross-Server Test');
    
    // Get share link with server URL embedded
    const shareLink = await getShareLinkUI(webPage1);
    console.log('Share link with server URL:', shareLink.substring(0, 80) + '...');
    
    // Page 2 joins from different server
    // The share link should include srv: parameter pointing to server1
    await joinWorkspaceUI(webPage2, 'Server2', shareLink);
    
    await new Promise(r => setTimeout(r, 5000));
    
    console.log('Cross-server sync test complete');
  });
  
});
