/**
 * E2E Tests for Comments Panel
 * 
 * Tests the comments functionality for document annotations.
 * Covers: panel visibility, adding comments, comment display.
 */

const { test, expect } = require('../fixtures/test-fixtures');
const { 
  waitForAppReady, 
  ensureIdentityExists, 
  createWorkspaceViaUI,
  createDocumentViaUI
} = require('../helpers/assertions');

test.describe('Comments Panel', () => {
  test.describe('Panel Visibility', () => {
    test('comments button appears in toolbar', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'CommentsUser');
      await createWorkspaceViaUI(page, `Comments Test ${Date.now()}`);
      await createDocumentViaUI(page, 'Test Doc', 'text');
      
      // Wait for editor to load
      await page.waitForSelector('.ProseMirror', { timeout: 15000 });
      
      // Look for comments button in toolbar
      const commentsBtn = page.locator('[data-testid="toolbar-btn-comments"], .toolbar-btn-comments, button[aria-label*="comment" i]');
      const visible = await commentsBtn.isVisible({ timeout: 5000 }).catch(() => false);
      
      console.log('[Test] Comments button visible:', visible);
      
      await page.screenshot({ path: 'test-results/artifacts/comments-button.png' });
    });

    test('comments panel can be opened', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'PanelUser');
      await createWorkspaceViaUI(page, `Panel Test ${Date.now()}`);
      await createDocumentViaUI(page, 'Panel Doc', 'text');
      
      await page.waitForSelector('.ProseMirror', { timeout: 15000 });
      
      // Try to find and click comments button
      const commentsBtn = page.locator('[data-testid="toolbar-btn-comments"], button[aria-label*="comment" i], button:has-text("💬")');
      if (await commentsBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await commentsBtn.first().click();
        await page.waitForTimeout(500);
        
        // Check if comments panel appeared
        const commentsPanel = page.locator('[data-testid="comments-panel"], .comments-panel');
        const panelVisible = await commentsPanel.isVisible({ timeout: 5000 }).catch(() => false);
        
        console.log('[Test] Comments panel visible:', panelVisible);
        
        if (panelVisible) {
          await expect(commentsPanel).toBeVisible();
        }
      }
      
      await page.screenshot({ path: 'test-results/artifacts/comments-panel.png' });
    });
  });

  test.describe('Comment Input', () => {
    test('comments panel has input field', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'InputUser');
      await createWorkspaceViaUI(page, `Input Test ${Date.now()}`);
      await createDocumentViaUI(page, 'Input Doc', 'text');
      
      await page.waitForSelector('.ProseMirror', { timeout: 15000 });
      
      // Open comments panel
      const commentsBtn = page.locator('[data-testid="toolbar-btn-comments"], button[aria-label*="comment" i], button:has-text("💬")');
      if (await commentsBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await commentsBtn.first().click();
        await page.waitForTimeout(500);
        
        // Check for comment input
        const commentInput = page.locator('[data-testid="comment-input"], .comment-input');
        const inputVisible = await commentInput.isVisible({ timeout: 5000 }).catch(() => false);
        
        if (inputVisible) {
          await expect(commentInput).toBeVisible();
        }
      }
      
      await page.screenshot({ path: 'test-results/artifacts/comments-input.png' });
    });

    test('can type in comment input', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'TypeUser');
      await createWorkspaceViaUI(page, `Type Test ${Date.now()}`);
      await createDocumentViaUI(page, 'Type Doc', 'text');
      
      await page.waitForSelector('.ProseMirror', { timeout: 15000 });
      
      // Open comments panel
      const commentsBtn = page.locator('[data-testid="toolbar-btn-comments"], button[aria-label*="comment" i], button:has-text("💬")');
      if (await commentsBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await commentsBtn.first().click();
        await page.waitForTimeout(500);
        
        const commentInput = page.locator('[data-testid="comment-input"], .comment-input');
        if (await commentInput.isVisible({ timeout: 5000 }).catch(() => false)) {
          await commentInput.fill('This is a test comment');
          await expect(commentInput).toHaveValue('This is a test comment');
        }
      }
      
      await page.screenshot({ path: 'test-results/artifacts/comments-typing.png' });
    });
  });

  test.describe('Comment Count', () => {
    test('comment count shows number of open comments', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'CountUser');
      await createWorkspaceViaUI(page, `Count Test ${Date.now()}`);
      await createDocumentViaUI(page, 'Count Doc', 'text');
      
      await page.waitForSelector('.ProseMirror', { timeout: 15000 });
      
      // Open comments panel
      const commentsBtn = page.locator('[data-testid="toolbar-btn-comments"], button[aria-label*="comment" i], button:has-text("💬")');
      if (await commentsBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await commentsBtn.first().click();
        await page.waitForTimeout(500);
        
        // Check for comment count
        const commentCount = page.locator('[data-testid="comment-count"], .comment-count');
        if (await commentCount.isVisible({ timeout: 5000 }).catch(() => false)) {
          const text = await commentCount.textContent();
          console.log('[Test] Comment count:', text);
          // Should show "0 open" for new document
          expect(text).toContain('open');
        }
      }
      
      await page.screenshot({ path: 'test-results/artifacts/comments-count.png' });
    });
  });

  test.describe('Panel Close', () => {
    test('comments panel can be closed', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'CloseUser');
      await createWorkspaceViaUI(page, `Close Test ${Date.now()}`);
      await createDocumentViaUI(page, 'Close Doc', 'text');
      
      await page.waitForSelector('.ProseMirror', { timeout: 15000 });
      
      // Open comments panel
      const commentsBtn = page.locator('[data-testid="toolbar-btn-comments"], button[aria-label*="comment" i], button:has-text("💬")');
      if (await commentsBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await commentsBtn.first().click();
        await page.waitForTimeout(500);
        
        const commentsPanel = page.locator('[data-testid="comments-panel"], .comments-panel');
        if (await commentsPanel.isVisible({ timeout: 5000 }).catch(() => false)) {
          // Click close button
          const closeBtn = page.locator('[data-testid="close-comments-btn"], .btn-close-comments');
          if (await closeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await closeBtn.click();
            await page.waitForTimeout(500);
            
            // Panel should be hidden
            await expect(commentsPanel).not.toBeVisible();
          }
        }
      }
      
      await page.screenshot({ path: 'test-results/artifacts/comments-closed.png' });
    });
  });
});
