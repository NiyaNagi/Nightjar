/**
 * Consolidated E2E Test Helpers
 * 
 * This module provides a single source of truth for all UI interaction
 * helpers used across E2E tests. All test specs should import from here
 * rather than defining their own helper functions.
 */
const { expect } = require('@playwright/test');

// ============================================================================
// App Readiness Helpers
// ============================================================================

/**
 * Wait for the app to be ready (main app, onboarding, or post-identity welcome)
 */
async function waitForAppReady(page, timeout = 60000) {
  await page.waitForSelector(
    '[data-testid="workspace-sidebar"], [data-testid="onboarding-welcome"], .workspace-switcher, .sidebar, .create-step, .empty-editor-state.onboarding-welcome, .onboarding-welcome',
    { timeout }
  );
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

// ============================================================================
// Assertion Helpers
// ============================================================================

async function assertDocumentContent(page, expectedContent) {
  const editor = page.locator('.ProseMirror, [contenteditable="true"], .editor').first();
  await expect(editor).toContainText(expectedContent, { timeout: 10000 });
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

// ============================================================================
// Identity Helpers
// ============================================================================

/**
 * Check if identity exists and create one if needed
 * This is the primary helper to use - handles both onboarding and existing identity scenarios
 */
async function ensureIdentityExists(page, name = 'TestUser') {
  const onboarding = page.locator('[data-testid="onboarding-welcome"]');
  if (await onboarding.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log(`[TestHelper] Onboarding detected, creating identity: ${name}`);
    
    // Click create new identity
    await page.click('[data-testid="create-identity-btn"]');
    await page.waitForSelector('[data-testid="identity-name-input"]', { timeout: 10000 });
    
    // Fill in the name
    await page.fill('[data-testid="identity-name-input"]', name);
    
    // Click Next (goes to PIN creation)
    await page.click('[data-testid="confirm-identity-btn"]');
    
    // Wait for PIN input step
    await page.waitForSelector('[data-testid="pin-input-container"]', { timeout: 10000 });
    console.log(`[TestHelper] PIN creation step`);
    
    // Enter 6-digit PIN (using simple PIN for testing)
    const testPin = '123456';
    for (let i = 0; i < 6; i++) {
      await page.locator(`[data-testid="pin-digit-${i}"]`).fill(testPin[i]);
    }
    
    // Wait for PIN confirm step (auto-advances after 6 digits)
    await page.waitForTimeout(500);
    
    // Check if we're on confirm step (label changes)
    const confirmLabel = page.locator('.pin-input-label:has-text("Confirm")');
    if (await confirmLabel.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log(`[TestHelper] PIN confirmation step`);
      // Enter PIN again to confirm
      for (let i = 0; i < 6; i++) {
        await page.locator(`[data-testid="pin-digit-${i}"]`).fill(testPin[i]);
      }
      await page.waitForTimeout(500);
    }
    
    // Handle recovery phrase step
    await page.waitForSelector('[data-testid="recovery-phrase"], [data-testid="understood-checkbox"]', { timeout: 10000 });
    console.log(`[TestHelper] Recovery phrase step visible`);
    await page.click('[data-testid="understood-checkbox"]');
    await page.waitForTimeout(300);
    await page.click('[data-testid="continue-btn"]');
    console.log(`[TestHelper] Clicked continue, waiting for main app...`);
    
    // Take screenshot for debugging
    await page.screenshot({ path: 'test-results/artifacts/identity-after-continue.png' });
    
    // Give app time to process identity creation
    await page.waitForTimeout(2000);
    
    // Take another screenshot to see if anything changed
    await page.screenshot({ path: 'test-results/artifacts/identity-after-wait.png' });
    
    // Log what's visible
    const bodyContent = await page.evaluate(() => document.body.innerHTML.substring(0, 500));
    console.log(`[TestHelper] Page body preview:`, bodyContent.substring(0, 200));
    
    // Wait for main app to load - the app might show "no workspace" welcome or workspace selector
    // Look for multiple possible states after identity creation completes
    await page.waitForSelector('.workspace-switcher, [data-testid="workspace-sidebar"], .sidebar, .empty-editor-state, button:has-text("Create Workspace"), .btn-create', { timeout: 30000 });
    console.log(`[TestHelper] Identity created: ${name}`);
  } else {
    console.log('[TestHelper] Identity already exists or app ready');
  }
}

/**
 * Simple identity creation - assumes we're on the onboarding screen
 * Use ensureIdentityExists for most cases
 */
async function createIdentityViaUI(page, name) {
  await page.click('[data-testid="create-identity-btn"]');
  await page.fill('[data-testid="identity-name-input"]', name);
  await page.click('[data-testid="confirm-identity-btn"]');
  await page.waitForSelector('[data-testid="recovery-phrase"]');
  await page.check('[data-testid="understood-checkbox"]');
  await page.click('[data-testid="continue-btn"]');
}

// ============================================================================
// Workspace Helpers
// ============================================================================

/**
 * Create a workspace via the UI
 * Handles both "no workspace" welcome screen and workspace switcher scenarios
 */
async function createWorkspaceViaUI(page, workspaceName) {
  console.log('[TestHelper] createWorkspaceViaUI starting...');
  
  // Wait a bit for page to settle after identity creation
  await page.waitForTimeout(2000);
  
  // Take screenshot to see current state
  await page.screenshot({ path: 'test-results/artifacts/before-create-workspace.png' });
  
  // Log what we see on the page
  const pageText = await page.locator('body').innerText().catch(() => 'ERROR');
  console.log('[TestHelper] Page text preview:', pageText.substring(0, 300));
  
  // Check if we're on the "no workspace" welcome screen with multiple selector options
  const createBtn = page.locator('[data-testid="welcome-create-workspace-btn"], button:has-text("Create Workspace")').first();
  const createBtnVisible = await createBtn.isVisible({ timeout: 10000 }).catch(() => false);
  console.log('[TestHelper] Create Workspace button visible:', createBtnVisible);
  
  if (createBtnVisible) {
    console.log('[TestHelper] No workspace welcome screen detected');
    await createBtn.click();
  } else {
    // Try workspace switcher for existing workspace scenario
    const switcherCreateBtn = page.locator('[data-testid="create-workspace-btn"], [data-testid="dropdown-create-workspace-btn"]');
    if (await switcherCreateBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await switcherCreateBtn.click();
    } else {
      // Click workspace switcher to open menu
      await page.click('[data-testid="workspace-selector"], .workspace-switcher__current');
      await page.waitForTimeout(500);
      await page.click('[data-testid="dropdown-create-workspace-btn"]');
    }
  }
  
  // Wait for create workspace dialog
  await page.waitForSelector('[data-testid="workspace-name-input"]', { timeout: 10000 });
  await page.fill('[data-testid="workspace-name-input"]', workspaceName);
  
  await page.click('[data-testid="confirm-workspace-btn"]');
  
  // Wait for workspace to be created
  await page.waitForSelector('.workspace-switcher, [data-testid="workspace-sidebar"], .sidebar', { timeout: 30000 });
  console.log(`[TestHelper] Workspace created: ${workspaceName}`);
  
  await page.waitForTimeout(2000);
}

// ============================================================================
// Share Link Helpers
// ============================================================================

/**
 * Get share link from workspace settings
 * Uses clipboard interceptor to capture the link
 */
async function getShareLinkViaUI(page) {
  // Open settings
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
  
  // Click copy button
  const copyBtn = page.locator('[data-testid="copy-share-link-btn"]');
  await copyBtn.waitFor({ timeout: 10000 });
  await copyBtn.click();
  
  await page.waitForTimeout(1500);
  
  // Get captured clipboard content
  const clipboardText = await page.evaluate(() => window.__capturedClipboard);
  
  // Close settings
  await page.keyboard.press('Escape');
  
  if (clipboardText && (clipboardText.includes('nightjar://') || clipboardText.includes('k:'))) {
    console.log('[TestHelper] Captured share link:', clipboardText.substring(0, 60) + '...');
    return clipboardText;
  }
  
  throw new Error('Could not get share link from clipboard');
}

/**
 * Join workspace via UI with share link
 */
async function joinWorkspaceViaUI(page, shareLink) {
  console.log('[TestHelper] Joining workspace with share link...');
  
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
  console.log('[TestHelper] Joined workspace');
}

/**
 * Parse nightjar:// link to extract workspace ID and key
 */
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

// ============================================================================
// Document Helpers
// ============================================================================

async function createDocumentViaUI(page, name, type = 'text') {
  console.log('[TestHelper] createDocumentViaUI starting...');
  
  // Wait for sidebar to be ready with the Add button
  await page.waitForSelector('[data-testid="new-document-btn"], .add-dropdown__trigger', { timeout: 15000 });
  
  await page.click('[data-testid="new-document-btn"], .add-dropdown__trigger');
  await page.waitForSelector('[data-testid="doc-type-grid"], .document-type-grid', { timeout: 10000 });
  await page.click(`[data-testid="doc-type-${type}"], .document-type-option[data-type="${type}"]`);
  await page.fill('[data-testid="document-name-input"]', name);
  await page.click('[data-testid="create-document-confirm"]');
  
  // Wait for document to be created and editor to load
  await page.waitForTimeout(2000);
  console.log('[TestHelper] Document created:', name);
}

// ============================================================================
// Settings Helpers
// ============================================================================

async function openWorkspaceSettings(page) {
  const settingsBtn = page.locator('[data-testid="workspace-settings-btn"]');
  await settingsBtn.waitFor({ timeout: 10000 });
  await settingsBtn.click();
  await page.waitForSelector('.workspace-settings, .workspace-settings__panel', { timeout: 10000 });
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  // App readiness
  waitForAppReady,
  waitForSync,
  waitForWorkspaceLoad,
  waitForEditorReady,
  
  // Assertions
  assertDocumentContent,
  assertNoErrors,
  
  // Identity
  ensureIdentityExists,
  createIdentityViaUI,
  
  // Workspace
  createWorkspaceViaUI,
  
  // Share links
  getShareLinkViaUI,
  joinWorkspaceViaUI,
  parseNightjarLink,
  
  // Documents
  createDocumentViaUI,
  
  // Settings
  openWorkspaceSettings,
};
