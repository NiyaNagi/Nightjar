/**
 * Visual Audit Test - Captures screenshots of all major UI states
 * 
 * This test is designed to generate comprehensive screenshots for visual review.
 * Run with: npx playwright test tests/e2e/specs/99-visual-audit.spec.js --workers=1
 */

const { test, expect } = require('../fixtures/test-fixtures');
const { ensureIdentityExists, createWorkspaceViaUI } = require('../helpers/assertions');
const path = require('path');
const fs = require('fs');

// Create screenshots directory
const screenshotDir = path.join(__dirname, '..', '..', '..', 'test-results', 'visual-audit');

test.describe('Visual Audit - Comprehensive Screenshots', () => {
  test.beforeAll(() => {
    // Ensure screenshot directory exists
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });

  test('capture all major UI states', async ({ webPage1, unifiedServer1 }) => {
    const page = webPage1;
    test.setTimeout(180000); // 3 minute timeout
    
    // Helper to take numbered screenshots
    let screenshotIndex = 0;
    const screenshot = async (name) => {
      screenshotIndex++;
      const filename = `${String(screenshotIndex).padStart(2, '0')}-${name}.png`;
      await page.screenshot({ 
        path: path.join(screenshotDir, filename),
        fullPage: true 
      });
      console.log(`[Screenshot] ${filename}`);
    };

    // 1. Onboarding - Initial state
    await page.waitForSelector('.onboarding, .welcome-screen, .identity-input', { timeout: 10000 }).catch(() => {});
    await screenshot('onboarding-initial');

    // 2. Identity Creation
    await ensureIdentityExists(page, 'AuditUser');
    await screenshot('identity-created');

    // 3. Welcome Screen (no workspaces)
    await page.waitForTimeout(500);
    await screenshot('welcome-no-workspaces');

    // 4. Create Workspace
    await createWorkspaceViaUI(page, 'Visual Audit Workspace');
    await screenshot('workspace-created-empty');

    // 5. Click Doc button to open document type dialog
    const docBtn = page.locator('[data-testid="new-document-btn"]');
    await docBtn.click();
    await page.waitForTimeout(500);
    await screenshot('create-doc-dialog');
    
    // 6. Click first document type option (the Document type)
    const docTypes = page.locator('.document-type-option, .doc-type-btn, button:has-text("Document")').first();
    await docTypes.click({ timeout: 5000 }).catch(() => console.log('Could not find doc type, trying alternative'));
    await page.waitForTimeout(300);
    await screenshot('doc-type-selected');
    
    // 7. Fill name and create
    const nameInput = page.locator('input[placeholder*="name"], input[placeholder*="Enter"]').first();
    await nameInput.fill('Test Document');
    await screenshot('doc-name-entered');
    
    const createBtn = page.locator('button:has-text("Create")').first();
    await createBtn.click();
    await page.waitForTimeout(1500);
    await screenshot('document-created');

    // 8. Editor with toolbar - wait for it to appear
    const editorLoaded = await page.waitForSelector('.ProseMirror, .tiptap-editor, [contenteditable="true"]', { timeout: 10000 }).catch(() => null);
    await screenshot('editor-view');

    // 9. Type some text in editor
    if (editorLoaded) {
      const editor = page.locator('.ProseMirror, [contenteditable="true"]').first();
      await editor.click();
      await page.keyboard.type('Hello World - this is a test document for visual audit.');
      await screenshot('editor-with-text');
    }

    // 10. Create Spreadsheet
    await docBtn.click();
    await page.waitForTimeout(300);
    const spreadsheetBtn = page.locator('button:has-text("Spreadsheet")').first();
    await spreadsheetBtn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    await nameInput.fill('Test Spreadsheet');
    await createBtn.click();
    await page.waitForTimeout(2000); // Fortune Sheet takes longer
    await screenshot('spreadsheet-view');

    // 11. Create Kanban Board
    await docBtn.click();
    await page.waitForTimeout(300);
    const kanbanBtn = page.locator('button:has-text("Kanban")').first();
    await kanbanBtn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    await nameInput.fill('Test Kanban');
    await createBtn.click();
    await page.waitForTimeout(1500);
    await screenshot('kanban-view');

    // 12. Sidebar with multiple documents
    await screenshot('sidebar-multiple-docs');

    // 13. Open Settings panel
    const settingsBtn = page.locator('button[aria-label="Open workspace settings"], button:has-text("Open workspace settings")').first();
    if (await settingsBtn.isVisible().catch(() => false)) {
      await settingsBtn.click();
      await page.waitForTimeout(500);
      await screenshot('settings-panel-open');
      
      // Close it
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // 14. Final full page state
    await screenshot('final-full-page');

    console.log(`\n✅ Visual audit complete! ${screenshotIndex} screenshots saved to: ${screenshotDir}`);
  });
});
