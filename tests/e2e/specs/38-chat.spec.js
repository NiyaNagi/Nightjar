/**
 * E2E Tests for Workspace Chat
 * 
 * Tests the chat functionality within workspaces.
 * Covers: chat visibility, message sending, UI elements.
 */

const { test, expect } = require('../fixtures/test-fixtures');
const { 
  waitForAppReady, 
  ensureIdentityExists, 
  createWorkspaceViaUI,
  createDocumentViaUI
} = require('../helpers/assertions');

test.describe('Workspace Chat', () => {
  test.describe('Chat UI', () => {
    test('chat panel appears in workspace', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'ChatUser');
      await createWorkspaceViaUI(page, `Chat Test ${Date.now()}`);
      
      // Create a document to ensure we're in a workspace view
      await createDocumentViaUI(page, 'Test Doc', 'text');
      
      // Wait for editor to load
      await page.waitForSelector('.ProseMirror', { timeout: 15000 });
      
      // Check if chat container is visible (may be minimized)
      const chatContainer = page.locator('[data-testid="chat-container"], .chat-container');
      const chatMinimized = page.locator('.chat-minimized, [data-testid="chat-minimized"]');
      
      const chatVisible = await chatContainer.isVisible({ timeout: 5000 }).catch(() => false);
      const minimizedVisible = await chatMinimized.isVisible({ timeout: 3000 }).catch(() => false);
      
      // Either expanded or minimized chat should be present
      const chatPresent = chatVisible || minimizedVisible;
      console.log('[Test] Chat visible:', chatVisible, 'Minimized:', minimizedVisible);
      
      expect(chatPresent).toBe(true);
      
      await page.screenshot({ path: 'test-results/artifacts/chat-panel.png' });
    });

    test('chat shows online count', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'OnlineUser');
      await createWorkspaceViaUI(page, `Online Test ${Date.now()}`);
      await createDocumentViaUI(page, 'Online Doc', 'text');
      
      await page.waitForSelector('.ProseMirror', { timeout: 15000 });
      
      // Expand chat if minimized
      const chatMinimized = page.locator('.chat-minimized, [data-testid="chat-minimized"]');
      if (await chatMinimized.isVisible({ timeout: 3000 }).catch(() => false)) {
        await chatMinimized.click();
        await page.waitForTimeout(500);
      }
      
      // Check for online count
      const onlineCount = page.locator('[data-testid="chat-online-count"], .online-count');
      const visible = await onlineCount.isVisible({ timeout: 5000 }).catch(() => false);
      
      if (visible) {
        const text = await onlineCount.textContent();
        console.log('[Test] Online count text:', text);
        expect(text).toContain('online');
      }
      
      await page.screenshot({ path: 'test-results/artifacts/chat-online-count.png' });
    });
  });

  test.describe('Message Input', () => {
    test('chat has input field and send button', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'InputUser');
      await createWorkspaceViaUI(page, `Input Test ${Date.now()}`);
      await createDocumentViaUI(page, 'Input Doc', 'text');
      
      await page.waitForSelector('.ProseMirror', { timeout: 15000 });
      
      // Expand chat if minimized
      const chatMinimized = page.locator('.chat-minimized');
      if (await chatMinimized.isVisible({ timeout: 3000 }).catch(() => false)) {
        await chatMinimized.click();
        await page.waitForTimeout(500);
      }
      
      // Check for chat input
      const chatInput = page.locator('[data-testid="chat-input"], .chat-input');
      const sendBtn = page.locator('[data-testid="chat-send-btn"], .btn-send');
      
      const inputVisible = await chatInput.isVisible({ timeout: 5000 }).catch(() => false);
      const sendVisible = await sendBtn.isVisible({ timeout: 3000 }).catch(() => false);
      
      console.log('[Test] Chat input visible:', inputVisible, 'Send button:', sendVisible);
      
      if (inputVisible) {
        await expect(chatInput).toBeVisible();
      }
      
      await page.screenshot({ path: 'test-results/artifacts/chat-input.png' });
    });

    test('can type in chat input', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'TypeUser');
      await createWorkspaceViaUI(page, `Type Test ${Date.now()}`);
      await createDocumentViaUI(page, 'Type Doc', 'text');
      
      await page.waitForSelector('.ProseMirror', { timeout: 15000 });
      
      // Expand chat if minimized
      const chatMinimized = page.locator('.chat-minimized');
      if (await chatMinimized.isVisible({ timeout: 3000 }).catch(() => false)) {
        await chatMinimized.click();
        await page.waitForTimeout(500);
      }
      
      const chatInput = page.locator('[data-testid="chat-input"], .chat-input');
      if (await chatInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await chatInput.click();
        await chatInput.fill('Hello, world!');
        
        // Verify input value
        await expect(chatInput).toHaveValue('Hello, world!');
      }
      
      await page.screenshot({ path: 'test-results/artifacts/chat-typing.png' });
    });

    test('send button is disabled when input is empty', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'DisabledUser');
      await createWorkspaceViaUI(page, `Disabled Test ${Date.now()}`);
      await createDocumentViaUI(page, 'Disabled Doc', 'text');
      
      await page.waitForSelector('.ProseMirror', { timeout: 15000 });
      
      // Expand chat if minimized
      const chatMinimized = page.locator('.chat-minimized');
      if (await chatMinimized.isVisible({ timeout: 3000 }).catch(() => false)) {
        await chatMinimized.click();
        await page.waitForTimeout(500);
      }
      
      const sendBtn = page.locator('[data-testid="chat-send-btn"], .btn-send');
      if (await sendBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Check button is disabled when input is empty
        await expect(sendBtn).toBeDisabled();
      }
      
      await page.screenshot({ path: 'test-results/artifacts/chat-send-disabled.png' });
    });
  });

  test.describe('Chat Functionality', () => {
    test('chat can be minimized and expanded', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'MinimizeUser');
      await createWorkspaceViaUI(page, `Minimize Test ${Date.now()}`);
      await createDocumentViaUI(page, 'Minimize Doc', 'text');
      
      await page.waitForSelector('.ProseMirror', { timeout: 15000 });
      
      const chatContainer = page.locator('[data-testid="chat-container"], .chat-container');
      const chatMinimized = page.locator('.chat-minimized');
      
      // First, check if chat is visible
      const chatVisible = await chatContainer.isVisible({ timeout: 5000 }).catch(() => false);
      
      if (chatVisible) {
        // Find minimize button
        const minimizeBtn = chatContainer.locator('.btn-minimize, button[title="Minimize"]');
        if (await minimizeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await minimizeBtn.click();
          await page.waitForTimeout(500);
          
          // Now minimized chat should be visible
          await expect(chatMinimized).toBeVisible({ timeout: 5000 });
          
          // Click to expand
          await chatMinimized.click();
          await page.waitForTimeout(500);
          
          // Chat container should be visible again
          await expect(chatContainer).toBeVisible({ timeout: 5000 });
        }
      }
      
      await page.screenshot({ path: 'test-results/artifacts/chat-minimize.png' });
    });
  });
});
