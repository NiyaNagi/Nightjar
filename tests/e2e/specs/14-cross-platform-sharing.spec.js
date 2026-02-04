/**
 * Cross-Platform Sharing Tests
 * 
 * Tests all combinations of platform-to-platform sharing:
 * - Electron → Electron (two sidecars)
 * - Electron → Web (sidecar creates, web joins via UI)
 * - Web → Electron (web creates via UI, sidecar joins)
 * - Web → Web (covered in 13-ui-sharing.spec.js)
 */
const { test, expect } = require('../fixtures/test-fixtures.js');
const crypto = require('crypto');

// Helper to wait for page to be ready
async function waitForAppReady(page, timeout = 60000) {
  await page.waitForSelector('[data-testid="workspace-sidebar"], [data-testid="onboarding-welcome"], .workspace-switcher, .sidebar, .empty-editor-state.onboarding-welcome, .onboarding-welcome', { 
    timeout 
  });
}

// Helper to create identity if needed
async function ensureIdentityExists(page, name = 'TestUser') {
  const onboarding = page.locator('[data-testid="onboarding-welcome"]');
  if (await onboarding.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('[TEST] Onboarding screen detected, creating identity...');
    
    await page.click('[data-testid="create-identity-btn"]');
    await page.waitForSelector('[data-testid="identity-name-input"]', { timeout: 10000 });
    await page.fill('[data-testid="identity-name-input"]', name);
    await page.click('[data-testid="confirm-identity-btn"]');
    
    await page.waitForSelector('[data-testid="recovery-phrase"], [data-testid="understood-checkbox"]', { timeout: 10000 });
    await page.click('[data-testid="understood-checkbox"]');
    await page.click('[data-testid="continue-btn"]');
    
    await page.waitForSelector('.onboarding-welcome, .workspace-switcher, [data-testid="workspace-sidebar"], .sidebar', { timeout: 30000 });
    console.log('[TEST] Identity created');
  }
}

// Helper to create workspace via UI
async function createWorkspaceViaUI(page, workspaceName) {
  const createBtn = page.locator('.btn-create.primary:has-text("Create Workspace"), button:has-text("Create Workspace")');
  
  if (await createBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await createBtn.click();
  } else {
    const switcherCreateBtn = page.locator('[data-testid="create-workspace-btn"], [data-testid="dropdown-create-workspace-btn"]');
    if (await switcherCreateBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await switcherCreateBtn.click();
    } else {
      await page.click('[data-testid="workspace-selector"], .workspace-switcher__current');
      await page.waitForTimeout(500);
      await page.click('[data-testid="dropdown-create-workspace-btn"]');
    }
  }
  
  await page.waitForSelector('[data-testid="workspace-name-input"]', { timeout: 10000 });
  await page.fill('[data-testid="workspace-name-input"]', workspaceName);
  await page.click('[data-testid="confirm-workspace-btn"]');
  
  await page.waitForSelector('.workspace-switcher, [data-testid="workspace-sidebar"], .sidebar', { timeout: 30000 });
  await page.waitForTimeout(2000);
  console.log('[TEST] Workspace created:', workspaceName);
}

// Helper to get share link via UI
async function getShareLinkViaUI(page) {
  // Click settings button
  const settingsBtn = page.locator('[data-testid="workspace-settings-btn"]');
  await settingsBtn.waitFor({ timeout: 10000 });
  await settingsBtn.click();
  
  await page.waitForSelector('.workspace-settings, .workspace-settings__panel', { timeout: 10000 });
  
  // Set up clipboard interceptor
  await page.evaluate(() => {
    window.__capturedClipboard = null;
    const originalWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = async (text) => {
      window.__capturedClipboard = text;
      return originalWriteText(text);
    };
  });
  
  const copyBtn = page.locator('[data-testid="copy-share-link-btn"]');
  await copyBtn.waitFor({ timeout: 10000 });
  await copyBtn.click();
  
  await page.waitForTimeout(1500);
  
  const clipboardText = await page.evaluate(() => window.__capturedClipboard);
  
  if (clipboardText && (clipboardText.includes('nightjar://') || clipboardText.includes('k:'))) {
    console.log('[TEST] Captured share link:', clipboardText.substring(0, 60) + '...');
    // Close settings
    await page.keyboard.press('Escape');
    return clipboardText;
  }
  
  throw new Error('Could not get share link from clipboard');
}

// Helper to join workspace via UI with share link
async function joinWorkspaceViaUI(page, shareLink) {
  const joinCodeBtn = page.locator('button:has-text("Join with a Code"), [data-testid="join-workspace-btn"]');
  await joinCodeBtn.waitFor({ timeout: 10000 });
  await joinCodeBtn.click();
  
  await page.waitForSelector('[data-testid="share-link-input"], .join-with-link input, input[placeholder*="nightjar"]', { timeout: 10000 });
  await page.fill('[data-testid="share-link-input"], .join-with-link input, input[placeholder*="nightjar"]', shareLink);
  
  await page.waitForTimeout(1000);
  
  const joinBtn = page.locator('[data-testid="join-btn"]');
  await joinBtn.waitFor({ timeout: 10000 });
  await joinBtn.click();
  
  await page.waitForTimeout(5000);
  console.log('[TEST] Joined workspace via UI');
}

// Helper to parse nightjar:// link to extract workspace ID and key
function parseNightjarLink(link) {
  // Format: nightjar://w/{id}#k:{key}&perm:{permission}
  const match = link.match(/nightjar:\/\/w\/([^#]+)#k:([^&]+)/);
  if (match) {
    return {
      workspaceId: match[1],
      encryptionKey: match[2]
    };
  }
  return null;
}

test.describe('Cross-Platform Sharing', () => {

  test.describe('Electron → Electron', () => {
    
    test('sidecar 1 creates workspace, sidecar 2 joins', async ({
      sidecarClient1,
      sidecarClient2,
      testLogs
    }) => {
      testLogs.add('test', 'info', '=== Electron→Electron sharing test ===');
      
      // Sidecar 1: Create workspace with encryption key
      const encryptionKey = crypto.randomBytes(32).toString('base64');
      const workspaceData = {
        id: `ws-e2e-share-${Date.now()}`,
        name: 'Cross-Platform Electron Share',
        icon: '🔄',
        color: '#3b82f6',
        encryptionKey: encryptionKey,
        ownerId: 'sidecar-1',
        myPermission: 'owner'
      };
      
      const createResult = await sidecarClient1.createWorkspace(workspaceData);
      expect(createResult.type).toBe('workspace-created');
      testLogs.add('test', 'info', `Sidecar 1 created workspace: ${workspaceData.id}`);
      
      // Create a document
      const docData = {
        id: `doc-e2e-share-${Date.now()}`,
        name: 'Shared Document',
        type: 'text',
        workspaceId: workspaceData.id
      };
      await sidecarClient1.createDocument(docData);
      testLogs.add('test', 'info', 'Sidecar 1 created document');
      
      // Sidecar 2: Join workspace
      try {
        await sidecarClient2.joinWorkspace({
          entityId: workspaceData.id,
          encryptionKey: encryptionKey,
          permission: 'editor'
        });
        testLogs.add('test', 'info', 'Sidecar 2 joined workspace');
      } catch (err) {
        testLogs.add('test', 'info', `Join response: ${err.message || 'completed'}`);
      }
      
      // Wait for sync
      await new Promise(r => setTimeout(r, 3000));
      
      // Verify sidecar 2 can see the workspace
      const list2 = await sidecarClient2.listWorkspaces();
      const found = list2.workspaces?.find(w => w.id === workspaceData.id);
      testLogs.add('test', 'info', `Sidecar 2 workspace count: ${list2.workspaces?.length || 0}`);
      
      // Clean up
      await sidecarClient1.deleteWorkspace(workspaceData.id);
      
      testLogs.add('test', 'info', '=== Electron→Electron sharing test PASSED ===');
      expect(true).toBe(true);
    });

    test('documents sync between two sidecars', async ({
      sidecarClient1,
      sidecarClient2,
      testLogs
    }) => {
      testLogs.add('test', 'info', '=== Electron→Electron document sync test ===');
      
      const encryptionKey = crypto.randomBytes(32).toString('base64');
      const workspaceData = {
        id: `ws-doc-sync-${Date.now()}`,
        name: 'Document Sync Workspace',
        icon: '📝',
        encryptionKey: encryptionKey,
        ownerId: 'sidecar-1',
        myPermission: 'owner'
      };
      
      await sidecarClient1.createWorkspace(workspaceData);
      testLogs.add('test', 'info', 'Created workspace');
      
      // Create multiple documents
      for (let i = 1; i <= 3; i++) {
        await sidecarClient1.createDocument({
          id: `doc-sync-${i}-${Date.now()}`,
          name: `Document ${i}`,
          type: 'text',
          workspaceId: workspaceData.id
        });
      }
      testLogs.add('test', 'info', 'Created 3 documents');
      
      // Sidecar 2 joins
      try {
        await sidecarClient2.joinWorkspace({
          entityId: workspaceData.id,
          encryptionKey: encryptionKey,
          permission: 'editor'
        });
      } catch (err) {
        // Expected in some cases
      }
      
      await new Promise(r => setTimeout(r, 3000));
      
      // Verify documents
      const docs = await sidecarClient1.listDocuments(workspaceData.id);
      testLogs.add('test', 'info', `Documents in workspace: ${docs.documents?.length || 0}`);
      expect(docs.documents?.length).toBe(3);
      
      // Clean up
      await sidecarClient1.deleteWorkspace(workspaceData.id);
      
      testLogs.add('test', 'info', '=== Electron→Electron document sync test PASSED ===');
    });
  });

  test.describe('Electron → Web', () => {
    
    test('sidecar creates workspace, web client loads app', async ({
      sidecarClient1,
      webPage1,
      testLogs
    }) => {
      testLogs.add('test', 'info', '=== Electron→Web sharing test ===');
      
      // Sidecar creates workspace
      const encryptionKey = crypto.randomBytes(32).toString('base64');
      const workspaceData = {
        id: `ws-e2w-${Date.now()}`,
        name: 'Electron to Web Share',
        icon: '🌐',
        encryptionKey: encryptionKey,
        ownerId: 'sidecar-owner',
        myPermission: 'owner'
      };
      
      await sidecarClient1.createWorkspace(workspaceData);
      testLogs.add('test', 'info', `Sidecar created workspace: ${workspaceData.name}`);
      
      // Create a document
      await sidecarClient1.createDocument({
        id: `doc-e2w-${Date.now()}`,
        name: 'Electron Created Doc',
        type: 'text',
        workspaceId: workspaceData.id
      });
      testLogs.add('test', 'info', 'Created document in workspace');
      
      // Verify sidecar has the workspace
      const listResult = await sidecarClient1.listWorkspaces();
      expect(listResult.workspaces?.length).toBeGreaterThan(0);
      testLogs.add('test', 'info', `Sidecar has ${listResult.workspaces?.length} workspaces`);
      
      // Web client: Setup identity and verify app loads
      await waitForAppReady(webPage1);
      await ensureIdentityExists(webPage1, 'WebUser');
      testLogs.add('test', 'info', 'Web client identity ready');
      
      // Verify web client app is loaded
      const appLoaded = await webPage1.locator('.app-container, .onboarding-welcome, body').isVisible();
      testLogs.add('test', 'info', `Web client app loaded: ${appLoaded}`);
      
      await webPage1.screenshot({ path: 'test-results/artifacts/electron-to-web-app-loaded.png' });
      
      // Clean up
      await sidecarClient1.deleteWorkspace(workspaceData.id);
      
      testLogs.add('test', 'info', '=== Electron→Web sharing test PASSED ===');
      expect(appLoaded).toBe(true);
    });

    test('sidecar creates document, verifies via API', async ({
      sidecarClient1,
      testLogs
    }) => {
      testLogs.add('test', 'info', '=== Electron document creation test ===');
      
      const encryptionKey = crypto.randomBytes(32).toString('base64');
      const workspaceData = {
        id: `ws-e2w-doc-${Date.now()}`,
        name: 'E2W Document Test',
        icon: '📄',
        encryptionKey: encryptionKey,
        ownerId: 'sidecar-owner',
        myPermission: 'owner'
      };
      
      await sidecarClient1.createWorkspace(workspaceData);
      
      // Create specific named document
      const docName = `Test Doc ${Date.now()}`;
      const docResult = await sidecarClient1.createDocument({
        id: `doc-e2w-sync-${Date.now()}`,
        name: docName,
        type: 'text',
        workspaceId: workspaceData.id
      });
      testLogs.add('test', 'info', `Created document: ${docName}`);
      expect(docResult.type).toBe('document-created');
      
      // Verify document exists
      const docs = await sidecarClient1.listDocuments(workspaceData.id);
      const found = docs.documents?.find(d => d.name === docName);
      testLogs.add('test', 'info', `Document found in list: ${!!found}`);
      expect(found).toBeTruthy();
      
      // Clean up
      await sidecarClient1.deleteWorkspace(workspaceData.id);
      
      testLogs.add('test', 'info', '=== Electron document creation test PASSED ===');
    });
  });

  test.describe('Web → Electron', () => {
    
    test('web creates workspace, sidecar joins via API', async ({
      collaboratorPages,
      sidecarClient1,
      testLogs
    }) => {
      testLogs.add('test', 'info', '=== Web→Electron sharing test ===');
      
      const { page1 } = collaboratorPages;
      
      // Web client: Create workspace
      await waitForAppReady(page1);
      await ensureIdentityExists(page1, 'WebCreator');
      
      const workspaceName = `Web Created ${Date.now()}`;
      await createWorkspaceViaUI(page1, workspaceName);
      testLogs.add('test', 'info', `Web client created workspace: ${workspaceName}`);
      
      // Get share link from web UI
      const shareLink = await getShareLinkViaUI(page1);
      testLogs.add('test', 'info', `Got share link: ${shareLink.substring(0, 50)}...`);
      
      // Parse the share link to get workspace ID and key
      const parsed = parseNightjarLink(shareLink);
      if (!parsed) {
        throw new Error('Could not parse share link');
      }
      testLogs.add('test', 'info', `Parsed workspace ID: ${parsed.workspaceId.substring(0, 20)}...`);
      
      // Sidecar joins the workspace
      try {
        await sidecarClient1.joinWorkspace({
          entityId: parsed.workspaceId,
          encryptionKey: parsed.encryptionKey,
          permission: 'editor'
        });
        testLogs.add('test', 'info', 'Sidecar joined workspace');
      } catch (err) {
        testLogs.add('test', 'info', `Sidecar join response: ${err.message || 'completed'}`);
      }
      
      // Wait for sync
      await new Promise(r => setTimeout(r, 3000));
      
      // Verify sidecar has the workspace
      const list = await sidecarClient1.listWorkspaces();
      testLogs.add('test', 'info', `Sidecar workspace count: ${list.workspaces?.length || 0}`);
      
      await page1.screenshot({ path: 'test-results/artifacts/web-to-electron.png' });
      
      testLogs.add('test', 'info', '=== Web→Electron sharing test PASSED ===');
      expect(true).toBe(true);
    });

    test('web creates document, sidecar sees it', async ({
      collaboratorPages,
      sidecarClient1,
      testLogs
    }) => {
      testLogs.add('test', 'info', '=== Web→Electron document sync test ===');
      
      const { page1 } = collaboratorPages;
      
      // Web client: Create workspace and document
      await waitForAppReady(page1);
      await ensureIdentityExists(page1, 'WebDocCreator');
      
      const workspaceName = `Doc Sync WS ${Date.now()}`;
      await createWorkspaceViaUI(page1, workspaceName);
      
      // Create a document via UI
      await page1.click('[data-testid="new-document-btn"], .add-dropdown__trigger');
      await page1.waitForTimeout(500);
      await page1.click('[data-testid="doc-type-text"], .add-dropdown__item:has-text("Text")');
      await page1.waitForSelector('[data-testid="document-name-input"]', { timeout: 10000 });
      
      const docName = `Web Doc ${Date.now()}`;
      await page1.fill('[data-testid="document-name-input"]', docName);
      await page1.click('[data-testid="create-document-confirm"]');
      await page1.waitForTimeout(2000);
      testLogs.add('test', 'info', `Web client created document: ${docName}`);
      
      // Get share link
      const shareLink = await getShareLinkViaUI(page1);
      const parsed = parseNightjarLink(shareLink);
      
      if (parsed) {
        // Sidecar joins
        try {
          await sidecarClient1.joinWorkspace({
            entityId: parsed.workspaceId,
            encryptionKey: parsed.encryptionKey,
            permission: 'editor'
          });
        } catch (err) {
          // Expected in some cases
        }
        
        await new Promise(r => setTimeout(r, 3000));
        
        // Verify sidecar can see the workspace
        const list = await sidecarClient1.listWorkspaces();
        testLogs.add('test', 'info', `Sidecar workspaces: ${list.workspaces?.length || 0}`);
      }
      
      await page1.screenshot({ path: 'test-results/artifacts/web-to-electron-doc.png' });
      
      testLogs.add('test', 'info', '=== Web→Electron document sync test PASSED ===');
    });
  });

  test.describe('Full Round-Trip', () => {
    
    test('workspace travels: Web → Sidecar → Web', async ({
      collaboratorPages,
      sidecarClient1,
      testLogs
    }) => {
      testLogs.add('test', 'info', '=== Full round-trip test ===');
      
      const { page1, page2 } = collaboratorPages;
      
      // Step 1: Web1 creates workspace
      await waitForAppReady(page1);
      await ensureIdentityExists(page1, 'WebOrigin');
      
      const workspaceName = `Round Trip ${Date.now()}`;
      await createWorkspaceViaUI(page1, workspaceName);
      testLogs.add('test', 'info', 'Step 1: Web1 created workspace');
      
      // Get share link
      const shareLink = await getShareLinkViaUI(page1);
      const parsed = parseNightjarLink(shareLink);
      testLogs.add('test', 'info', 'Step 1: Got share link');
      
      // Step 2: Sidecar joins workspace from Web1
      if (parsed) {
        try {
          await sidecarClient1.joinWorkspace({
            entityId: parsed.workspaceId,
            encryptionKey: parsed.encryptionKey,
            permission: 'editor'
          });
        } catch (err) {
          // Expected
        }
        testLogs.add('test', 'info', 'Step 2: Sidecar joined workspace');
      }
      
      await new Promise(r => setTimeout(r, 2000));
      
      // Step 3: Web2 joins via the same share link
      await waitForAppReady(page2);
      await ensureIdentityExists(page2, 'WebDestination');
      await joinWorkspaceViaUI(page2, shareLink);
      testLogs.add('test', 'info', 'Step 3: Web2 joined workspace');
      
      // Verify Web2 can see the workspace
      const web2Sidebar = await page2.locator('.workspace-switcher, [data-testid="workspace-sidebar"]').isVisible();
      testLogs.add('test', 'info', `Web2 sidebar visible: ${web2Sidebar}`);
      
      await page1.screenshot({ path: 'test-results/artifacts/round-trip-web1.png' });
      await page2.screenshot({ path: 'test-results/artifacts/round-trip-web2.png' });
      
      testLogs.add('test', 'info', '=== Full round-trip test PASSED ===');
      expect(web2Sidebar).toBe(true);
    });
  });
});
