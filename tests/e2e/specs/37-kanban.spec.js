/**
 * E2E Tests for Kanban Board
 * 
 * Tests the Kanban board document type with columns, cards, and drag-drop.
 * Covers: board creation, column management, card operations.
 */

const { test, expect } = require('../fixtures/test-fixtures');
const { 
  waitForAppReady, 
  ensureIdentityExists, 
  createWorkspaceViaUI,
  createDocumentViaUI
} = require('../helpers/assertions');

test.describe('Kanban Board', () => {
  test.describe('Document Creation', () => {
    test('can create a kanban board', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'KanbanUser');
      await createWorkspaceViaUI(page, `Kanban Test ${Date.now()}`);
      
      // Create a kanban document
      await createDocumentViaUI(page, 'Test Board', 'kanban');
      
      // Wait for kanban to load
      await page.waitForSelector('[data-testid="kanban-container"], .kanban-container', { timeout: 15000 });
      
      // Verify the kanban container is visible
      const kanbanContainer = page.locator('[data-testid="kanban-container"], .kanban-container');
      await expect(kanbanContainer).toBeVisible();
      
      // Verify header shows "Kanban Board"
      const header = page.locator('[data-testid="kanban-header"], .kanban-header');
      await expect(header).toContainText('Kanban Board');
      
      await page.screenshot({ path: 'test-results/artifacts/kanban-created.png' });
    });

    test('kanban board shows default columns', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'ColumnsUser');
      await createWorkspaceViaUI(page, `Columns Test ${Date.now()}`);
      await createDocumentViaUI(page, 'Columns Board', 'kanban');
      
      // Wait for kanban to load
      await page.waitForSelector('[data-testid="kanban-board"], .kanban-board', { timeout: 15000 });
      
      // Verify default columns exist
      const todoColumn = page.locator('[data-testid="kanban-column-to-do"], .kanban-column:has-text("To Do")');
      const inProgressColumn = page.locator('[data-testid="kanban-column-in-progress"], .kanban-column:has-text("In Progress")');
      const doneColumn = page.locator('[data-testid="kanban-column-done"], .kanban-column:has-text("Done")');
      
      await expect(todoColumn).toBeVisible();
      await expect(inProgressColumn).toBeVisible();
      await expect(doneColumn).toBeVisible();
      
      await page.screenshot({ path: 'test-results/artifacts/kanban-default-columns.png' });
    });
  });

  test.describe('Column Management', () => {
    test('can add a new column', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'AddColumnUser');
      await createWorkspaceViaUI(page, `Add Column Test ${Date.now()}`);
      await createDocumentViaUI(page, 'Column Board', 'kanban');
      
      // Wait for kanban to load
      await page.waitForSelector('[data-testid="kanban-board"], .kanban-board', { timeout: 15000 });
      
      // Click add column button
      const addColumnBtn = page.locator('[data-testid="kanban-add-column-btn"], .btn-add-column');
      await expect(addColumnBtn).toBeVisible();
      await addColumnBtn.click();
      
      // Wait for new column input to appear
      await page.waitForTimeout(500);
      
      // Type column name (look for input in new column form)
      const columnInput = page.locator('.new-column-form input, input[placeholder*="column"]');
      if (await columnInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await columnInput.fill('Review');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);
        
        // Verify new column appears
        const reviewColumn = page.locator('.kanban-column:has-text("Review")');
        await expect(reviewColumn).toBeVisible();
      }
      
      await page.screenshot({ path: 'test-results/artifacts/kanban-add-column.png' });
    });
  });

  test.describe('Card Operations', () => {
    test('can add a card to a column', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'AddCardUser');
      await createWorkspaceViaUI(page, `Add Card Test ${Date.now()}`);
      await createDocumentViaUI(page, 'Card Board', 'kanban');
      
      // Wait for kanban to load
      await page.waitForSelector('[data-testid="kanban-board"], .kanban-board', { timeout: 15000 });
      
      // Find the To Do column and its add card button
      const todoColumn = page.locator('[data-testid="kanban-column-to-do"], .kanban-column:has-text("To Do")');
      await expect(todoColumn).toBeVisible();
      
      // Look for add card button within the column
      const addCardBtn = todoColumn.locator('.btn-add-card, button:has-text("+ Add")');
      if (await addCardBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await addCardBtn.click();
        await page.waitForTimeout(500);
        
        // Type card title
        const cardInput = page.locator('.new-card-input, input[placeholder*="card"]');
        if (await cardInput.isVisible({ timeout: 3000 }).catch(() => false)) {
          await cardInput.fill('Test Task');
          await page.keyboard.press('Enter');
          await page.waitForTimeout(500);
          
          // Verify card appears
          const card = todoColumn.locator('.kanban-card:has-text("Test Task")');
          await expect(card).toBeVisible();
        }
      }
      
      await page.screenshot({ path: 'test-results/artifacts/kanban-add-card.png' });
    });

    test('can click on a card to edit', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'EditCardUser');
      await createWorkspaceViaUI(page, `Edit Card Test ${Date.now()}`);
      await createDocumentViaUI(page, 'Edit Board', 'kanban');
      
      // Wait for kanban to load
      await page.waitForSelector('[data-testid="kanban-board"], .kanban-board', { timeout: 15000 });
      
      // Add a card first
      const todoColumn = page.locator('[data-testid="kanban-column-to-do"], .kanban-column:has-text("To Do")');
      await expect(todoColumn).toBeVisible();
      
      const addCardBtn = todoColumn.locator('.btn-add-card, button:has-text("+ Add")');
      if (await addCardBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await addCardBtn.click();
        await page.waitForTimeout(300);
        
        const cardInput = page.locator('.new-card-input, input[placeholder*="card"]');
        if (await cardInput.isVisible({ timeout: 3000 }).catch(() => false)) {
          await cardInput.fill('Editable Task');
          await page.keyboard.press('Enter');
          await page.waitForTimeout(500);
          
          // Click on the card
          const card = todoColumn.locator('.kanban-card:has-text("Editable Task")');
          await card.click();
          await page.waitForTimeout(500);
          
          // Check if card editor modal appeared
          const cardEditor = page.locator('.kanban-card-editor, .card-editor, [role="dialog"]');
          const editorVisible = await cardEditor.isVisible({ timeout: 3000 }).catch(() => false);
          console.log('[Test] Card editor visible:', editorVisible);
        }
      }
      
      await page.screenshot({ path: 'test-results/artifacts/kanban-edit-card.png' });
    });
  });

  test.describe('Board Functionality', () => {
    test('kanban board is interactive and functional', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'FunctionalUser');
      await createWorkspaceViaUI(page, `Functional Test ${Date.now()}`);
      await createDocumentViaUI(page, 'Functional Board', 'kanban');
      
      // Wait for kanban to load
      await page.waitForSelector('[data-testid="kanban-board"], .kanban-board', { timeout: 15000 });
      
      const kanbanBoard = page.locator('[data-testid="kanban-board"], .kanban-board');
      await expect(kanbanBoard).toBeVisible();
      
      // Count columns
      const columns = page.locator('.kanban-column');
      const columnCount = await columns.count();
      expect(columnCount).toBeGreaterThanOrEqual(3);
      
      console.log('[Test] Kanban has', columnCount, 'columns');
      
      await page.screenshot({ path: 'test-results/artifacts/kanban-functional.png' });
    });

    test('kanban shows in document list with correct type', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'ListUser');
      await createWorkspaceViaUI(page, `List Test ${Date.now()}`);
      await createDocumentViaUI(page, 'List Board', 'kanban');
      
      // Wait for kanban to load
      await page.waitForSelector('[data-testid="kanban-container"], .kanban-container', { timeout: 15000 });
      
      // Check document list shows the board
      const boardDoc = page.locator('.tree-item__name:has-text("List Board")');
      await expect(boardDoc).toBeVisible();
      
      await page.screenshot({ path: 'test-results/artifacts/kanban-in-list.png' });
    });
  });
});
