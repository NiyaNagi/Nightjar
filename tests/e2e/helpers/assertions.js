/**
 * Custom test assertions for E2E tests
 */
const { expect } = require('@playwright/test');

async function assertDocumentContent(page, expectedContent) {
  const editor = page.locator('.ProseMirror, [contenteditable="true"], .editor').first();
  await expect(editor).toContainText(expectedContent, { timeout: 10000 });
}

async function waitForSync(page, timeout = 10000) {
  await page.waitForFunction(() => {
    const syncStatus = document.querySelector('[data-testid="sync-status"]');
    return syncStatus?.dataset?.synced === 'true';
  }, { timeout });
}

async function waitForWorkspaceLoad(page, timeout = 30000) {
  await page.waitForSelector('[data-testid="workspace-sidebar"]', { timeout });
}

async function waitForEditorReady(page, timeout = 10000) {
  await page.waitForSelector('.ProseMirror, [contenteditable="true"], .editor', { timeout });
}

async function assertNoErrors(page) {
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  
  return () => {
    const critical = consoleErrors.filter(e => 
      !e.includes('favicon') && !e.includes('DevTools')
    );
    if (critical.length > 0) {
      throw new Error(`Console errors found: ${critical.join('\n')}`);
    }
  };
}

async function createIdentityViaUI(page, name) {
  await page.click('[data-testid="create-identity-btn"]');
  await page.fill('[data-testid="identity-name-input"]', name);
  await page.click('[data-testid="confirm-identity-btn"]');
  await page.waitForSelector('[data-testid="recovery-phrase"]');
  await page.check('[data-testid="understood-checkbox"]');
  await page.click('[data-testid="continue-btn"]');
}

async function createWorkspaceViaUI(page, name) {
  await page.click('[data-testid="create-workspace-btn"]');
  await page.fill('[data-testid="workspace-name-input"]', name);
  await page.click('[data-testid="confirm-workspace-btn"]');
}

async function createDocumentViaUI(page, name, type = 'text') {
  await page.click('[data-testid="new-document-btn"]');
  await page.waitForSelector('[data-testid="doc-type-grid"]');
  await page.click(`[data-testid="doc-type-${type}"]`);
  await page.fill('[data-testid="document-name-input"]', name);
  await page.click('[data-testid="create-document-confirm"]');
}

module.exports = {
  assertDocumentContent,
  waitForSync,
  waitForWorkspaceLoad,
  waitForEditorReady,
  assertNoErrors,
  createIdentityViaUI,
  createWorkspaceViaUI,
  createDocumentViaUI
};
