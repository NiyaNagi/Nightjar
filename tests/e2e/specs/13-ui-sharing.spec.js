/**
 * UI-Based Sharing Tests
 * 
 * Tests real cross-client sharing functionality through the actual UI.
 * Uses two browser contexts to simulate two different users sharing workspaces.
 */
const { test, expect } = require('../fixtures/test-fixtures.js');
const { env, PORTS } = require('../environment/orchestrator.js');
const {
  waitForAppReady,
  ensureIdentityExists,
  createWorkspaceViaUI,
  getShareLinkViaUI,
  openWorkspaceSettings,
} = require('../helpers/assertions.js');

// Helper to get share link from workspace settings (wrapper around consolidated helper)
async function getShareLink(page) {
  return await getShareLinkViaUI(page);
}

test.describe('UI Sharing - Cross-Client', () => {
  
  // These tests involve two users with full identity creation, so need more time
  test.setTimeout(120000); // 2 minutes
  
  test.beforeEach(async () => {
    // Ensure clean state
  });
  
  test('two browser windows can share and sync a workspace via UI', async ({ collaboratorPages }) => {
    console.log('[TEST] === Two browser windows share workspace test ===');
    
    // Use the collaboratorPages fixture which provides two pages on the same server
    const { page1, page2 } = collaboratorPages;
    
    try {
      // User 1: Wait for app to be ready
      console.log('[TEST] User 1: Loading app...');
      await waitForAppReady(page1);
      await page1.screenshot({ path: 'test-results/artifacts/ui-share-user1-loaded.png' });
      
      await ensureIdentityExists(page1, 'User1');
      console.log('[TEST] User 1: Identity ready');
      await page1.screenshot({ path: 'test-results/artifacts/ui-share-user1-identity.png' });
      
      // User 1: Create a workspace
      const workspaceName = `Shared Workspace ${Date.now()}`;
      await createWorkspaceViaUI(page1, workspaceName);
      console.log('[TEST] User 1: Created workspace:', workspaceName);
      await page1.screenshot({ path: 'test-results/artifacts/ui-share-user1-workspace.png' });
      
      // User 1: Open settings and get share link
      const shareLink = await getShareLink(page1);
      console.log('[TEST] User 1: Got share link:', shareLink.substring(0, 50) + '...');
      await page1.screenshot({ path: 'test-results/artifacts/ui-share-user1-sharelink.png' });
      
      // Close settings dialog
      await page1.keyboard.press('Escape');
      
      // User 2: Wait for app to be ready (already navigated by fixture)
      console.log('[TEST] User 2: Loading app...');
      await waitForAppReady(page2);
      await page2.screenshot({ path: 'test-results/artifacts/ui-share-user2-loaded.png' });
      
      await ensureIdentityExists(page2, 'User2');
      console.log('[TEST] User 2: Identity ready');
      await page2.screenshot({ path: 'test-results/artifacts/ui-share-user2-identity.png' });
      
      // User 2: Join workspace using the share link via Join dialog
      console.log('[TEST] User 2: Joining workspace with share link...');
      
      // Click "Join with a Code" button from the welcome screen
      const joinCodeBtn = page2.locator('button:has-text("Join with a Code"), [data-testid="join-workspace-btn"]');
      await joinCodeBtn.waitFor({ timeout: 10000 });
      await joinCodeBtn.click();
      console.log('[TEST] User 2: Clicked Join with a Code button');
      
      // Wait for join dialog/input to appear
      await page2.waitForSelector('[data-testid="share-link-input"], .join-with-link input, input[placeholder*="nightjar"]', { timeout: 10000 });
      await page2.screenshot({ path: 'test-results/artifacts/ui-share-user2-join-dialog.png' });
      
      // Paste the share link into the input
      await page2.fill('[data-testid="share-link-input"], .join-with-link input, input[placeholder*="nightjar"]', shareLink);
      console.log('[TEST] User 2: Pasted share link');
      await page2.waitForTimeout(1000);
      await page2.screenshot({ path: 'test-results/artifacts/ui-share-user2-link-pasted.png' });
      
      // Click join button - use the specific testid
      const joinBtn = page2.locator('[data-testid="join-btn"]');
      await joinBtn.waitFor({ timeout: 10000 });
      await joinBtn.click();
      console.log('[TEST] User 2: Clicked Join button');
      
      // Wait for workspace to load
      await page2.waitForTimeout(5000);
      await page2.screenshot({ path: 'test-results/artifacts/ui-share-user2-joined.png' });
      
      // Verify User 2 has the sidebar visible (workspace loaded)
      const sidebarVisible = await page2.locator('.workspace-switcher, [data-testid="workspace-sidebar"], .sidebar').isVisible({ timeout: 10000 }).catch(() => false);
      console.log('[TEST] User 2: Sidebar visible:', sidebarVisible);
      
      // Verify User 2 can see the workspace name somewhere
      const workspaceText = await page2.locator('.workspace-switcher').textContent().catch(() => 'N/A');
      console.log('[TEST] User 2: Workspace switcher text:', workspaceText);
      
      // Take a final screenshot showing both users
      await page1.screenshot({ path: 'test-results/artifacts/ui-share-user1-final.png' });
      await page2.screenshot({ path: 'test-results/artifacts/ui-share-user2-final.png' });
      
      console.log('[TEST] === Two browser windows share workspace test COMPLETE ===');
      
      // Test passes if the sidebar loaded for user 2
      expect(sidebarVisible).toBe(true);
      
    } catch (error) {
      console.error('[TEST] Test failed:', error.message);
      throw error;
    }
  });
  
  // TODO: These tests need more work - they run but sometimes timeout 
  // The identity creation flow is now fixed, but document creation/editing needs more robust selectors
  test.skip('share link with viewer permission restricts editing', async ({ browser, unifiedServer1 }) => {
    console.log('[TEST] === Viewer permission test ===');
    
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    
    const baseUrl = unifiedServer1.url;
    
    try {
      // User 1: Set up workspace
      await page1.goto(baseUrl);
      await waitForAppReady(page1);
      await ensureIdentityExists(page1, 'Owner');
      
      const workspaceName = `Viewer Test ${Date.now()}`;
      await createWorkspaceViaUI(page1, workspaceName);
      
      // Open settings and select viewer permission
      await openWorkspaceSettings(page1);
      
      // Click viewer permission option
      const viewerBtn = page1.locator('[data-testid="permission-viewer"], .permission-option:has-text("Viewer")');
      if (await viewerBtn.isVisible()) {
        await viewerBtn.click();
      }
      
      // Get share link
      const shareLink = await getShareLink(page1);
      console.log('[TEST] Got viewer share link');
      await page1.screenshot({ path: 'test-results/artifacts/ui-viewer-sharelink.png' });
      
      // User 2: Join with viewer permission
      await page2.goto(baseUrl);
      await waitForAppReady(page2);
      await ensureIdentityExists(page2, 'Viewer');
      
      // Navigate to join URL
      let joinUrl = shareLink.startsWith('nightjar://') 
        ? shareLink.replace('nightjar://', `${unifiedServer1.url}/#`)
        : `${unifiedServer1.url}/#${shareLink}`;
      
      await page2.goto(joinUrl);
      await page2.waitForTimeout(3000);
      
      // Join if dialog appears
      const joinBtn = page2.locator('[data-testid="join-btn"]');
      if (await joinBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await joinBtn.click();
      }
      
      await page2.waitForTimeout(3000);
      await page2.screenshot({ path: 'test-results/artifacts/ui-viewer-joined.png' });
      
      // Check that edit controls are disabled/hidden for viewer
      const addButton = page2.locator('[data-testid="new-document-btn"]');
      const addButtonVisible = await addButton.isVisible({ timeout: 3000 }).catch(() => false);
      const addButtonDisabled = await addButton.isDisabled().catch(() => true);
      
      console.log('[TEST] Add button visible:', addButtonVisible, 'disabled:', addButtonDisabled);
      await page2.screenshot({ path: 'test-results/artifacts/ui-viewer-permissions.png' });
      
      console.log('[TEST] === Viewer permission test COMPLETE ===');
      
    } finally {
      await context1.close();
      await context2.close();
    }
  });
  
  // TODO: This test needs more work - document creation selectors need updating
  test.skip('real-time document editing syncs between clients', async ({ browser, unifiedServer1 }) => {
    console.log('[TEST] === Real-time edit sync test ===');
    
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    
    const baseUrl = unifiedServer1.url;
    
    try {
      // User 1: Create workspace with document
      await page1.goto(baseUrl);
      await waitForAppReady(page1);
      await ensureIdentityExists(page1, 'Editor1');
      
      const workspaceName = `Collab Test ${Date.now()}`;
      await createWorkspaceViaUI(page1, workspaceName);
      
      // Create a document
      await page1.click('[data-testid="new-document-btn"], .add-dropdown__trigger');
      await page1.waitForTimeout(500);
      await page1.click('[data-testid="doc-type-text"], .add-dropdown__item:has-text("Text")');
      await page1.fill('[data-testid="document-name-input"]', 'Collab Doc');
      await page1.click('[data-testid="create-document-confirm"]');
      await page1.waitForTimeout(2000);
      
      // Get share link with editor permission
      await openWorkspaceSettings(page1);
      const editorBtn = page1.locator('[data-testid="permission-editor"]');
      if (await editorBtn.isVisible()) {
        await editorBtn.click();
      }
      const shareLink = await getShareLink(page1);
      await page1.keyboard.press('Escape');
      
      // Open the document for editing
      await page1.click('.document-item:has-text("Collab Doc"), .sidebar__doc:has-text("Collab Doc")');
      await page1.waitForTimeout(2000);
      await page1.screenshot({ path: 'test-results/artifacts/ui-collab-user1-editing.png' });
      
      // User 2: Join and open same document
      await page2.goto(baseUrl);
      await waitForAppReady(page2);
      await ensureIdentityExists(page2, 'Editor2');
      
      let joinUrl = shareLink.startsWith('nightjar://') 
        ? shareLink.replace('nightjar://', `${unifiedServer1.url}/#`)
        : `${unifiedServer1.url}/#${shareLink}`;
      
      await page2.goto(joinUrl);
      await page2.waitForTimeout(3000);
      
      const joinBtn = page2.locator('[data-testid="join-btn"]');
      if (await joinBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await joinBtn.click();
      }
      
      await page2.waitForTimeout(5000);
      
      // Open the same document
      await page2.click('.document-item:has-text("Collab Doc"), .sidebar__doc:has-text("Collab Doc")');
      await page2.waitForTimeout(2000);
      await page2.screenshot({ path: 'test-results/artifacts/ui-collab-user2-editing.png' });
      
      // User 1: Type some text
      console.log('[TEST] User 1: Typing in editor...');
      const editor1 = page1.locator('.ProseMirror, .editor-content, [contenteditable="true"]').first();
      if (await editor1.isVisible()) {
        await editor1.click();
        await editor1.type('Hello from User 1! ');
        await page1.screenshot({ path: 'test-results/artifacts/ui-collab-user1-typed.png' });
      }
      
      // Wait for sync
      await page2.waitForTimeout(3000);
      
      // Check if User 2 sees the text
      const editor2 = page2.locator('.ProseMirror, .editor-content, [contenteditable="true"]').first();
      const user2Content = await editor2.textContent().catch(() => '');
      console.log('[TEST] User 2 sees:', user2Content.substring(0, 50));
      await page2.screenshot({ path: 'test-results/artifacts/ui-collab-user2-synced.png' });
      
      const syncSuccessful = user2Content.includes('Hello from User 1');
      console.log('[TEST] Sync successful:', syncSuccessful);
      
      // User 2: Type response
      if (await editor2.isVisible()) {
        await editor2.click();
        await editor2.type('Hello from User 2! ');
        await page2.screenshot({ path: 'test-results/artifacts/ui-collab-user2-typed.png' });
      }
      
      // Check if User 1 sees both
      await page1.waitForTimeout(3000);
      const user1Content = await editor1.textContent().catch(() => '');
      console.log('[TEST] User 1 sees:', user1Content.substring(0, 100));
      await page1.screenshot({ path: 'test-results/artifacts/ui-collab-final.png' });
      
      console.log('[TEST] === Real-time edit sync test COMPLETE ===');
      
    } finally {
      await context1.close();
      await context2.close();
    }
  });
  
});
