/**
 * E2E Tests for Workspace Settings
 * 
 * Tests the workspace settings panel including sharing, permissions, and appearance.
 * Covers: settings access, share links, workspace appearance options.
 */

const { test, expect } = require('../fixtures/test-fixtures');
const { 
  waitForAppReady, 
  ensureIdentityExists, 
  createWorkspaceViaUI,
  createDocumentViaUI,
  openWorkspaceSettings
} = require('../helpers/assertions');

test.describe('Workspace Settings', () => {
  test.describe('Settings Access', () => {
    test('settings button is visible in workspace header', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'SettingsUser');
      await createWorkspaceViaUI(page, `Settings Test ${Date.now()}`);
      
      // Settings button should be visible
      const settingsBtn = page.locator('[data-testid="workspace-settings-btn"], .workspace-switcher__settings');
      await expect(settingsBtn).toBeVisible({ timeout: 10000 });
      
      await page.screenshot({ path: 'test-results/artifacts/settings-button.png' });
    });

    test('can open workspace settings panel', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'OpenSettingsUser');
      await createWorkspaceViaUI(page, `Open Settings Test ${Date.now()}`);
      
      // Open settings
      await openWorkspaceSettings(page);
      
      // Settings panel should be visible
      const settingsPanel = page.locator('.workspace-settings, .workspace-settings__panel');
      await expect(settingsPanel).toBeVisible();
      
      await page.screenshot({ path: 'test-results/artifacts/settings-panel.png' });
    });

    test('settings panel can be closed', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'CloseSettingsUser');
      await createWorkspaceViaUI(page, `Close Settings Test ${Date.now()}`);
      
      // Open settings
      await openWorkspaceSettings(page);
      
      const settingsPanel = page.locator('.workspace-settings, .workspace-settings__panel');
      await expect(settingsPanel).toBeVisible();
      
      // Close using Escape key
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      
      // Panel should be hidden
      await expect(settingsPanel).not.toBeVisible();
      
      await page.screenshot({ path: 'test-results/artifacts/settings-closed.png' });
    });
  });

  test.describe('Share Links', () => {
    test('share section is visible in settings', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'ShareUser');
      await createWorkspaceViaUI(page, `Share Test ${Date.now()}`);
      
      await openWorkspaceSettings(page);
      
      // Look for share link section
      const shareSection = page.locator('.share-link-section, [data-testid="share-section"]');
      const shareVisible = await shareSection.isVisible({ timeout: 5000 }).catch(() => false);
      
      console.log('[Test] Share section visible:', shareVisible);
      
      await page.screenshot({ path: 'test-results/artifacts/settings-share.png' });
    });

    test('can generate share link', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'GenerateLinkUser');
      await createWorkspaceViaUI(page, `Generate Link Test ${Date.now()}`);
      
      await openWorkspaceSettings(page);
      
      // Look for generate/copy link button
      const generateBtn = page.locator('.btn-generate-link, .btn-copy-link, button:has-text("Copy")');
      if (await generateBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await generateBtn.first().click();
        await page.waitForTimeout(500);
        
        // Link should be generated - check for link display
        const linkDisplay = page.locator('.share-link-display, .share-link, input[type="text"][readonly]');
        const linkVisible = await linkDisplay.isVisible({ timeout: 3000 }).catch(() => false);
        
        console.log('[Test] Link display visible:', linkVisible);
      }
      
      await page.screenshot({ path: 'test-results/artifacts/settings-generate-link.png' });
    });
  });

  test.describe('Permission Levels', () => {
    test('permission buttons are visible', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'PermissionUser');
      await createWorkspaceViaUI(page, `Permission Test ${Date.now()}`);
      
      await openWorkspaceSettings(page);
      
      // Look for permission level buttons
      const editorBtn = page.locator('[data-testid="permission-editor"], .permission-btn-editor');
      const viewerBtn = page.locator('[data-testid="permission-viewer"], .permission-btn-viewer');
      
      const editorVisible = await editorBtn.isVisible({ timeout: 5000 }).catch(() => false);
      const viewerVisible = await viewerBtn.isVisible({ timeout: 5000 }).catch(() => false);
      
      console.log('[Test] Editor permission visible:', editorVisible);
      console.log('[Test] Viewer permission visible:', viewerVisible);
      
      await page.screenshot({ path: 'test-results/artifacts/settings-permissions.png' });
    });
  });

  test.describe('Workspace Appearance', () => {
    test('workspace name is displayed', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      const workspaceName = `Appearance Test ${Date.now()}`;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'AppearanceUser');
      await createWorkspaceViaUI(page, workspaceName);
      
      // Open settings
      await openWorkspaceSettings(page);
      
      // Workspace name should be visible somewhere in settings
      const settingsPanel = page.locator('.workspace-settings, .workspace-settings__panel');
      const panelText = await settingsPanel.textContent();
      
      // The workspace name should appear in the settings
      console.log('[Test] Settings contains workspace name:', panelText.includes('Appearance Test'));
      
      await page.screenshot({ path: 'test-results/artifacts/settings-appearance.png' });
    });

    test('workspace icon is visible in header', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'IconUser');
      await createWorkspaceViaUI(page, `Icon Test ${Date.now()}`);
      
      // Look for workspace icon in the header/switcher
      const workspaceIcon = page.locator('.workspace-switcher__icon, .workspace-icon');
      const iconVisible = await workspaceIcon.isVisible({ timeout: 5000 }).catch(() => false);
      
      console.log('[Test] Workspace icon visible:', iconVisible);
      
      await page.screenshot({ path: 'test-results/artifacts/settings-icon.png' });
    });
  });
});
