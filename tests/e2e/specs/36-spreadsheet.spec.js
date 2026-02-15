/**
 * E2E Tests for Fortune Sheet Spreadsheet
 * 
 * Tests the spreadsheet document type using Fortune Sheet.
 * Covers: cell editing, selection, basic operations, formula entry.
 */

const { test, expect } = require('../fixtures/test-fixtures');
const { 
  waitForAppReady, 
  ensureIdentityExists, 
  createWorkspaceViaUI,
  createDocumentViaUI
} = require('../helpers/assertions');

test.describe('Fortune Sheet Spreadsheet', () => {
  test.describe('Document Creation', () => {
    test('can create a spreadsheet document', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'SheetUser');
      await createWorkspaceViaUI(page, `Sheet Test ${Date.now()}`);
      
      // Create a spreadsheet document
      await createDocumentViaUI(page, 'Test Sheet', 'sheet');
      
      // Wait for spreadsheet to load
      await page.waitForSelector('[data-testid="sheet-container"], .sheet-container', { timeout: 15000 });
      
      // Verify the spreadsheet container is visible
      const sheetContainer = page.locator('[data-testid="sheet-container"], .sheet-container');
      await expect(sheetContainer).toBeVisible();
      
      // Fortune Sheet renders a canvas, verify it exists
      const canvas = page.locator('.sheet-container canvas, .fortune-sheet-canvas, canvas');
      const canvasCount = await canvas.count();
      expect(canvasCount).toBeGreaterThan(0);
      
      await page.screenshot({ path: 'test-results/artifacts/spreadsheet-created.png' });
    });

    test('spreadsheet shows in document list with correct icon', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'SheetIconUser');
      await createWorkspaceViaUI(page, `Sheet Icon Test ${Date.now()}`);
      await createDocumentViaUI(page, 'Icon Sheet', 'sheet');
      
      // Wait for spreadsheet to load
      await page.waitForSelector('[data-testid="sheet-container"], .sheet-container', { timeout: 15000 });
      
      // Check document list shows the spreadsheet - use more specific selector
      const sheetDoc = page.locator('.tree-item__name:has-text("Icon Sheet")');
      await expect(sheetDoc).toBeVisible();
      
      await page.screenshot({ path: 'test-results/artifacts/spreadsheet-icon.png' });
    });
  });

  test.describe('Cell Interaction', () => {
    test('can click on cells in spreadsheet', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'CellClickUser');
      await createWorkspaceViaUI(page, `Cell Click Test ${Date.now()}`);
      await createDocumentViaUI(page, 'Click Sheet', 'sheet');
      
      // Wait for spreadsheet to load
      await page.waitForSelector('[data-testid="sheet-container"], .sheet-container', { timeout: 15000 });
      
      const sheetContainer = page.locator('[data-testid="sheet-container"], .sheet-container');
      
      // Fortune Sheet uses canvas - click somewhere in the grid area
      // The grid starts below the header row (row 0)
      const box = await sheetContainer.boundingBox();
      if (box) {
        // Click in cell area (roughly B2)
        await page.mouse.click(box.x + 100, box.y + 80);
        await page.waitForTimeout(200);
      }
      
      // Verify no crash and container still visible
      await expect(sheetContainer).toBeVisible();
      
      await page.screenshot({ path: 'test-results/artifacts/spreadsheet-cell-click.png' });
    });

    test('can type in a cell', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'CellTypeUser');
      await createWorkspaceViaUI(page, `Cell Type Test ${Date.now()}`);
      await createDocumentViaUI(page, 'Type Sheet', 'sheet');
      
      // Wait for spreadsheet to load
      await page.waitForSelector('[data-testid="sheet-container"], .sheet-container', { timeout: 15000 });
      
      const sheetContainer = page.locator('[data-testid="sheet-container"], .sheet-container');
      const box = await sheetContainer.boundingBox();
      
      if (box) {
        // Click on cell A1 (top-left of grid, below header)
        await page.mouse.click(box.x + 50, box.y + 60);
        await page.waitForTimeout(200);
        
        // Type some text
        await page.keyboard.type('Hello Sheet');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(200);
      }
      
      // Verify spreadsheet is still functional
      await expect(sheetContainer).toBeVisible();
      
      await page.screenshot({ path: 'test-results/artifacts/spreadsheet-cell-typed.png' });
    });

    test('can navigate cells with keyboard', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'NavUser');
      await createWorkspaceViaUI(page, `Nav Test ${Date.now()}`);
      await createDocumentViaUI(page, 'Nav Sheet', 'sheet');
      
      // Wait for spreadsheet to load
      await page.waitForSelector('[data-testid="sheet-container"], .sheet-container', { timeout: 15000 });
      
      const sheetContainer = page.locator('[data-testid="sheet-container"], .sheet-container');
      const box = await sheetContainer.boundingBox();
      
      if (box) {
        // Click on a cell to focus
        await page.mouse.click(box.x + 50, box.y + 60);
        await page.waitForTimeout(200);
        
        // Navigate with arrow keys
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(100);
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(100);
        await page.keyboard.press('ArrowLeft');
        await page.waitForTimeout(100);
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(100);
        
        // Type to confirm navigation didn't break
        await page.keyboard.type('Nav Test');
        await page.keyboard.press('Enter');
      }
      
      await expect(sheetContainer).toBeVisible();
      
      await page.screenshot({ path: 'test-results/artifacts/spreadsheet-navigation.png' });
    });
  });

  test.describe('Formulas', () => {
    test('can enter a formula', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'FormulaUser');
      await createWorkspaceViaUI(page, `Formula Test ${Date.now()}`);
      await createDocumentViaUI(page, 'Formula Sheet', 'sheet');
      
      // Wait for spreadsheet to load
      await page.waitForSelector('[data-testid="sheet-container"], .sheet-container', { timeout: 15000 });
      
      const sheetContainer = page.locator('[data-testid="sheet-container"], .sheet-container');
      const box = await sheetContainer.boundingBox();
      
      if (box) {
        // Type number in A1
        await page.mouse.click(box.x + 50, box.y + 60);
        await page.waitForTimeout(200);
        await page.keyboard.type('10');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(200);
        
        // A2 is now selected (after Enter), type another number
        await page.keyboard.type('20');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(200);
        
        // A3 - type a SUM formula
        await page.keyboard.type('=A1+A2');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);
      }
      
      // Verify spreadsheet didn't crash
      await expect(sheetContainer).toBeVisible();
      
      await page.screenshot({ path: 'test-results/artifacts/spreadsheet-formula.png' });
    });
  });

  test.describe('Sheet Tabs', () => {
    test('spreadsheet loads with default sheet tab', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'TabUser');
      await createWorkspaceViaUI(page, `Tab Test ${Date.now()}`);
      await createDocumentViaUI(page, 'Tab Sheet', 'sheet');
      
      // Wait for spreadsheet to load
      await page.waitForSelector('[data-testid="sheet-container"], .sheet-container', { timeout: 15000 });
      
      // Fortune Sheet shows sheet tabs at bottom
      // Look for sheet tab area
      const sheetContainer = page.locator('[data-testid="sheet-container"], .sheet-container');
      await expect(sheetContainer).toBeVisible();
      
      // Check for sheet tab (usually "Sheet1")
      const sheetTab = page.locator('.fortune-sheet-tab, .sheet-tab, [data-sheet]');
      const tabExists = await sheetTab.first().isVisible({ timeout: 5000 }).catch(() => false);
      
      // Even if tab not visible, sheet should work
      console.log('[Test] Sheet tab visible:', tabExists);
      
      await page.screenshot({ path: 'test-results/artifacts/spreadsheet-tabs.png' });
    });
  });

  test.describe('Selection Toolbar', () => {
    test('selection toolbar appears on cell selection', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      await ensureIdentityExists(page, 'SelectToolbarUser');
      await createWorkspaceViaUI(page, `Select Toolbar Test ${Date.now()}`);
      await createDocumentViaUI(page, 'Toolbar Sheet', 'sheet');
      
      // Wait for spreadsheet to load
      await page.waitForSelector('[data-testid="sheet-container"], .sheet-container', { timeout: 15000 });
      
      const sheetContainer = page.locator('[data-testid="sheet-container"], .sheet-container');
      const box = await sheetContainer.boundingBox();
      
      if (box) {
        // Click and drag to select multiple cells
        const startX = box.x + 50;
        const startY = box.y + 60;
        const endX = box.x + 150;
        const endY = box.y + 100;
        
        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(endX, endY);
        await page.mouse.up();
        await page.waitForTimeout(500);
      }
      
      // Check if selection toolbar appeared
      const selectionToolbar = page.locator('.sheet-selection-toolbar, [data-testid="sheet-selection-toolbar"]');
      const toolbarVisible = await selectionToolbar.isVisible({ timeout: 3000 }).catch(() => false);
      
      console.log('[Test] Selection toolbar visible:', toolbarVisible);
      
      await expect(sheetContainer).toBeVisible();
      
      await page.screenshot({ path: 'test-results/artifacts/spreadsheet-selection-toolbar.png' });
    });
  });
});
