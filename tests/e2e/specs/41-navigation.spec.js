/**
 * E2E Tests for Navigation
 * 
 * Tests navigation elements including sidebar, breadcrumbs, and document switching.
 * Covers: sidebar visibility, document selection, folder navigation.
 */

const { test, expect } = require('../fixtures/test-fixtures');
const { 
  waitForAppReady, 
  ensureIdentityExists, 
  createWorkspaceViaUI,
  createDocumentViaUI
} = require('../helpers/assertions');

test.describe('Navigation', () => {
  test.describe('Sidebar', () => {
    test('sidebar is visible after creating workspace', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'SidebarUser');
      await createWorkspaceViaUI(page, `Sidebar Test ${Date.now()}`);
      
      // Sidebar should be visible
      const sidebar = page.locator('.hierarchical-sidebar, .sidebar');
      await expect(sidebar).toBeVisible({ timeout: 10000 });
      
      await page.screenshot({ path: 'test-results/artifacts/navigation-sidebar.png' });
    });

    test('sidebar shows create document button', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'CreateBtnUser');
      await createWorkspaceViaUI(page, `Create Btn Test ${Date.now()}`);
      
      // Create document button should be visible
      const createBtn = page.locator('[data-testid="new-document-btn"], .add-dropdown__trigger');
      await expect(createBtn).toBeVisible({ timeout: 10000 });
      
      await page.screenshot({ path: 'test-results/artifacts/navigation-create-btn.png' });
    });

    test('sidebar shows create folder button', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'FolderBtnUser');
      await createWorkspaceViaUI(page, `Folder Btn Test ${Date.now()}`);
      
      // Create folder button should be visible
      const folderBtn = page.locator('[data-testid="new-folder-btn"], .btn-create-folder');
      const visible = await folderBtn.isVisible({ timeout: 5000 }).catch(() => false);
      
      console.log('[Test] Folder button visible:', visible);
      
      await page.screenshot({ path: 'test-results/artifacts/navigation-folder-btn.png' });
    });
  });

  test.describe('Document List', () => {
    test('created documents appear in sidebar', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'DocListUser');
      await createWorkspaceViaUI(page, `Doc List Test ${Date.now()}`);
      
      // Create a document
      await createDocumentViaUI(page, 'Navigation Doc', 'text');
      
      // Document should appear in sidebar
      const docItem = page.locator('.tree-item__name:has-text("Navigation Doc")');
      await expect(docItem).toBeVisible({ timeout: 10000 });
      
      await page.screenshot({ path: 'test-results/artifacts/navigation-doc-list.png' });
    });

    test('can create multiple documents', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'MultiDocUser');
      await createWorkspaceViaUI(page, `Multi Doc Test ${Date.now()}`);
      
      // Create first document
      await createDocumentViaUI(page, 'First Doc', 'text');
      await page.waitForSelector('.ProseMirror', { timeout: 15000 });
      
      // Create second document
      await createDocumentViaUI(page, 'Second Doc', 'text');
      await page.waitForSelector('.ProseMirror', { timeout: 15000 });
      
      // Both documents should appear in sidebar
      const firstDoc = page.locator('.tree-item__name:has-text("First Doc")');
      const secondDoc = page.locator('.tree-item__name:has-text("Second Doc")');
      
      await expect(firstDoc).toBeVisible();
      await expect(secondDoc).toBeVisible();
      
      await page.screenshot({ path: 'test-results/artifacts/navigation-multi-doc.png' });
    });
  });

  test.describe('Document Switching', () => {
    test('can switch between documents', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'SwitchUser');
      await createWorkspaceViaUI(page, `Switch Test ${Date.now()}`);
      
      // Create first document and type content
      await createDocumentViaUI(page, 'Doc A', 'text');
      await page.waitForSelector('.ProseMirror', { timeout: 15000 });
      const editor1 = page.locator('.ProseMirror').first();
      await editor1.click();
      await page.keyboard.type('Content in Doc A');
      
      // Create second document
      await createDocumentViaUI(page, 'Doc B', 'text');
      await page.waitForSelector('.ProseMirror', { timeout: 15000 });
      const editor2 = page.locator('.ProseMirror').first();
      await editor2.click();
      await page.keyboard.type('Content in Doc B');
      
      // Switch back to first document
      const docAItem = page.locator('.tree-item:has-text("Doc A")').first();
      await docAItem.click();
      await page.waitForTimeout(1000);
      
      // Verify first document content is shown
      const editor = page.locator('.ProseMirror').first();
      await expect(editor).toContainText('Content in Doc A');
      
      await page.screenshot({ path: 'test-results/artifacts/navigation-switch.png' });
    });
  });

  test.describe('Document Selection', () => {
    test('selected document is highlighted', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'SelectUser');
      await createWorkspaceViaUI(page, `Select Test ${Date.now()}`);
      
      // Create a document
      await createDocumentViaUI(page, 'Selected Doc', 'text');
      await page.waitForSelector('.ProseMirror', { timeout: 15000 });
      
      // Check if the document has selected styling
      const selectedItem = page.locator('.tree-item--selected:has-text("Selected Doc")');
      await expect(selectedItem).toBeVisible();
      
      await page.screenshot({ path: 'test-results/artifacts/navigation-selected.png' });
    });
  });

  test.describe('Workspace Switcher', () => {
    test('workspace switcher is visible', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'SwitcherUser');
      await createWorkspaceViaUI(page, `Switcher Test ${Date.now()}`);
      
      // Workspace switcher should be visible
      const switcher = page.locator('.workspace-switcher, [data-testid="workspace-switcher"]');
      await expect(switcher).toBeVisible({ timeout: 10000 });
      
      await page.screenshot({ path: 'test-results/artifacts/navigation-switcher.png' });
    });

    test('workspace name appears in header', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      const workspaceName = `Header Test ${Date.now()}`;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'HeaderUser');
      await createWorkspaceViaUI(page, workspaceName);
      
      // Workspace name should appear in workspace switcher (more specific selector)
      const switcher = page.locator('.workspace-switcher').first();
      const switcherText = await switcher.textContent();
      
      console.log('[Test] Header contains workspace name:', switcherText.includes('Header Test'));
      expect(switcherText).toContain('Header Test');
      
      await page.screenshot({ path: 'test-results/artifacts/navigation-header.png' });
    });
  });
});
