/**
 * Nahma UI Visual Testing - Complete UI Crawler
 * 
 * COMPREHENSIVE TEST SUITE - Tests EVERY UI control combination
 * 
 * This test crawls through ALL UI elements and captures:
 * - Screenshots at every state
 * - Console errors
 * - Network failures
 * - Accessibility issues
 * 
 * The output is designed to be analyzed by AI for bug detection and fixing.
 * 
 * AUDIT-BASED TEST COVERAGE:
 * 1. Onboarding Flow (Welcome, Create, Restore, Recovery)
 * 2. Workspace Management (Switcher, Create/Join modals)
 * 3. Sidebar/HierarchicalSidebar (Tree, folders, documents, context menus)
 * 4. Toolbar (25+ buttons in 7 groups)
 * 5. TabBar (tabs, comments, history, fullscreen, profile)
 * 6. StatusBar (Tor toggle, P2P status, collaborators)
 * 7. Document Types (Text/TipTap, Kanban, Sheet)
 * 8. Dialogs (Share, Identity Settings, Tor Settings, Comments, Changelog)
 * 9. UserProfile (name, emoji picker, color picker)
 * 10. Chat (messages, tabs, minimize, resize)
 */
import { test, expect, captureScreen, checkCommonIssues, getAccessibilityTree } from '../fixtures.js';

// Test identity data to inject into localStorage to skip onboarding
const TEST_IDENTITY = {
  privateKeyHex: 'a'.repeat(64), // Dummy 32-byte key
  publicKeyHex: 'b'.repeat(64),  // Dummy 32-byte key
  publicKeyBase62: 'testUser123ABC',
  mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  handle: 'TestUser',
  color: '#6366f1',
  icon: '🧪',
  createdAt: new Date().toISOString(),
  devices: []
};

// Test workspace with documents to inject
const TEST_WORKSPACE_ID = 'test-workspace-123';
const TEST_DOC_ID = 'test-doc-001';
const TEST_FOLDER_ID = 'test-folder-001';
const TEST_KANBAN_ID = 'test-kanban-001';
const TEST_SHEET_ID = 'test-sheet-001';

const TEST_WORKSPACES = [
  {
    id: TEST_WORKSPACE_ID,
    name: 'Test Workspace',
    createdAt: Date.now() - 86400000,
    createdBy: 'b'.repeat(64),
    owners: ['b'.repeat(64)],
    color: '#6366f1',
    icon: '📁',
    myPermission: 'owner',
    accessScope: 'workspace',
    accessScopeId: TEST_WORKSPACE_ID,
    password: null,
    encrypted: false,
    topic: 'test-topic-hash-123',
    // Folder structure with documents
    folders: [
      { id: TEST_FOLDER_ID, name: 'Test Folder', parentId: null, icon: '📂', color: '#22c55e' }
    ],
    documents: [
      { id: TEST_DOC_ID, name: 'Test Document', type: 'text', folderId: null, createdAt: Date.now() - 3600000 },
      { id: TEST_KANBAN_ID, name: 'Test Kanban', type: 'kanban', folderId: null, createdAt: Date.now() - 7200000 },
      { id: TEST_SHEET_ID, name: 'Test Sheet', type: 'sheet', folderId: null, createdAt: Date.now() - 10800000 }
    ]
  }
];

// User profile for chat/collaboration features
const TEST_USER_PROFILE = {
  name: 'TestUser',
  icon: '🧪',
  color: '#6366f1'
};

/**
 * Helper: Complete the onboarding flow by clicking through it
 */
async function completeOnboarding(page, testInfo) {
  // Click "Create New Identity"
  const createBtn = page.locator('button:has-text("Create New Identity"), button:has-text("Create Workspace")');
  if (await createBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await createBtn.first().click();
    await page.waitForTimeout(500);
    await captureScreen(page, 'onboarding-create-clicked', testInfo);
  }
  
  // Fill in any required fields (handle/name)
  const handleInput = page.locator('input[name="handle"], input[placeholder*="name"], input[placeholder*="handle"]');
  if (await handleInput.isVisible({ timeout: 1000 }).catch(() => false)) {
    await handleInput.fill('TestUser');
    await page.waitForTimeout(200);
  }
  
  // Click continue/next buttons
  const continueBtn = page.locator('button:has-text("Continue"), button:has-text("Create"), button:has-text("Next")');
  if (await continueBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await continueBtn.click();
    await page.waitForTimeout(500);
    await captureScreen(page, 'onboarding-continue-clicked', testInfo);
  }
  
  // Check the confirmation checkbox if present
  const checkbox = page.locator('input[type="checkbox"]');
  if (await checkbox.isVisible({ timeout: 1000 }).catch(() => false)) {
    await checkbox.check();
    await page.waitForTimeout(200);
  }
  
  // Click final continue
  const finalBtn = page.locator('button:has-text("Continue"):not([disabled])');
  if (await finalBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await finalBtn.click();
    await page.waitForTimeout(500);
  }
}

/**
 * Helper: Set up identity AND workspace in localStorage to skip onboarding + workspace creation
 * Navigate to the app first (to get same-origin), set localStorage, then reload
 * @param {object} options - Optional settings like viewport size, skipWorkspace, openDocId, openDocType
 */
async function injectTestIdentity(page, options = {}) {
  // Set viewport if specified (before navigation)
  if (options.viewport) {
    await page.setViewportSize(options.viewport);
  }
  
  // First, navigate to the app to establish the origin
  await page.goto('/');
  
  // Set localStorage for identity
  await page.evaluate((identity) => {
    localStorage.setItem('nahma-identity', JSON.stringify(identity));
    localStorage.setItem('nahma_identity', JSON.stringify(identity));
  }, TEST_IDENTITY);
  
  // Set localStorage for workspaces (unless explicitly skipped)
  if (!options.skipWorkspace) {
    await page.evaluate(({ workspaces, currentId, userProfile }) => {
      localStorage.setItem('nahma-workspaces', JSON.stringify(workspaces));
      localStorage.setItem('nahma-current-workspace', currentId);
      localStorage.setItem('nahma-user-profile', JSON.stringify(userProfile));
    }, { workspaces: TEST_WORKSPACES, currentId: TEST_WORKSPACE_ID, userProfile: TEST_USER_PROFILE });
  }
  
  // Set open document if specified
  if (options.openDocId) {
    await page.evaluate(({ docId, docType }) => {
      localStorage.setItem('nahma-open-document', JSON.stringify({ id: docId, type: docType || 'text' }));
    }, { docId: options.openDocId, docType: options.openDocType });
  }
  
  // Reload to apply the localStorage data
  await page.reload();
  await page.waitForLoadState('networkidle');
}

/**
 * Helper: Check if we're on the onboarding screen
 */
async function isOnOnboarding(page) {
  const welcomeText = page.locator('text=Welcome to Nahma');
  return await welcomeText.isVisible({ timeout: 1000 }).catch(() => false);
}

/**
 * Helper: Get past onboarding to the main app
 */
async function ensureInMainApp(page, testInfo) {
  // Wait for page to stabilize
  await page.waitForTimeout(500);
  
  // If on onboarding, complete it
  if (await isOnOnboarding(page)) {
    await completeOnboarding(page, testInfo);
    await page.waitForTimeout(1000);
  }
  
  // Check if we're now in the main app (has document picker or editor)
  const mainApp = page.locator('[class*="document-picker"], [class*="editor"], [class*="workspace"], [class*="sidebar"]');
  await mainApp.first().waitFor({ timeout: 5000 }).catch(() => {});
}

/**
 * Helper: Click and capture screenshot with safety
 */
async function clickAndCapture(page, locator, name, testInfo) {
  if (await locator.isVisible({ timeout: 1000 }).catch(() => false)) {
    await locator.click();
    await page.waitForTimeout(300);
    await captureScreen(page, name, testInfo);
    return true;
  }
  return false;
}

/**
 * Helper: Open the Add/New dropdown in sidebar
 */
async function openAddDropdown(page, testInfo) {
  const addBtn = page.locator('[class*="add-dropdown"] button, button:has-text("+ New"), button:has-text("Add"), button[title*="Add"], button[title*="New"]');
  if (await addBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
    await addBtn.first().click();
    await page.waitForTimeout(300);
    await captureScreen(page, 'add-dropdown-opened', testInfo);
    return true;
  }
  return false;
}

test.describe('UI Crawler - Complete Visual Inspection', () => {
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1: ONBOARDING FLOW (Fresh user experience)
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('1. Onboarding Flow', () => {
    
    test('1.1 - Welcome Screen - All buttons visible', async ({ page }, testInfo) => {
      // First go to page to establish origin
      await page.goto('/');
      
      // Clear all storage to ensure fresh user state (no existing identity)
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      
      // Reload to apply clear state
      await page.reload();
      await page.waitForLoadState('networkidle');
      
      await captureScreen(page, '01-welcome-screen', testInfo);
      
      // The app may show either:
      // 1. Identity Onboarding ("Create New Identity" button) - when no identity exists
      // 2. Workspace Welcome ("Create Workspace" button) - when identity exists but no workspaces
      // Both are valid "Welcome to Nahma" states depending on app configuration
      
      const welcomeTitle = page.locator('text=Welcome to Nahma');
      await expect(welcomeTitle.first()).toBeVisible({ timeout: 5000 });
      
      // Check for either Create Identity or Create Workspace button
      const createIdentityBtn = page.locator('button:has-text("Create New Identity")');
      const createWorkspaceBtn = page.locator('button:has-text("Create Workspace")');
      
      const isIdentityOnboarding = await createIdentityBtn.isVisible({ timeout: 2000 }).catch(() => false);
      const isWorkspaceOnboarding = await createWorkspaceBtn.isVisible({ timeout: 2000 }).catch(() => false);
      
      // At least one of these should be visible
      expect(isIdentityOnboarding || isWorkspaceOnboarding).toBe(true);
      
      if (isIdentityOnboarding) {
        await captureScreen(page, '01-welcome-identity-onboarding', testInfo);
        
        // Check for Restore button (only in identity onboarding)
        const restoreBtn = page.locator('button:has-text("Restore")');
        if (await restoreBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await captureScreen(page, '01-welcome-restore-visible', testInfo);
        }
        
        // Check for Scan QR button
        const scanBtn = page.locator('button:has-text("Scan"), button:has-text("QR")');
        if (await scanBtn.first().isVisible({ timeout: 1000 }).catch(() => false)) {
          await captureScreen(page, '01-welcome-scan-visible', testInfo);
        }
      } else {
        await captureScreen(page, '01-welcome-workspace-onboarding', testInfo);
        
        // In workspace onboarding, also check for Join button
        const joinBtn = page.locator('button:has-text("Join")');
        if (await joinBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await captureScreen(page, '01-welcome-join-visible', testInfo);
        }
      }
    });
    
    test('1.2 - Create Identity or Workspace Flow', async ({ page }, testInfo) => {
      // First go to page and clear all storage
      await page.goto('/');
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      await page.reload();
      await page.waitForLoadState('networkidle');
      
      // Detect which onboarding flow we're in
      const createIdentityBtn = page.locator('button:has-text("Create New Identity")');
      const createWorkspaceBtn = page.locator('button:has-text("Create Workspace")');
      
      const isIdentityOnboarding = await createIdentityBtn.isVisible({ timeout: 2000 }).catch(() => false);
      
      if (isIdentityOnboarding) {
        // Identity onboarding flow
        await createIdentityBtn.click({ timeout: 5000 });
        await page.waitForTimeout(500);
        await captureScreen(page, '02-create-identity-screen', testInfo);
        
        // Fill in handle if visible
        const handleInput = page.locator('input[name="handle"], input[placeholder*="name" i], input[placeholder*="handle" i]');
        if (await handleInput.isVisible({ timeout: 1000 }).catch(() => false)) {
          await handleInput.fill('TestUser');
          await captureScreen(page, '02-create-identity-filled', testInfo);
        }
        
        // Click Create/Continue
        const continueBtn = page.locator('button:has-text("Create"), button:has-text("Continue")');
        if (await continueBtn.first().isVisible({ timeout: 1000 }).catch(() => false)) {
          await continueBtn.first().click();
          await page.waitForTimeout(500);
          await captureScreen(page, '02-create-identity-continued', testInfo);
        }
      } else {
        // Workspace onboarding flow - click Create Workspace
        await createWorkspaceBtn.click({ timeout: 5000 });
        await page.waitForTimeout(500);
        await captureScreen(page, '02-create-workspace-modal', testInfo);
        
        // The CreateWorkspace modal should now be visible
        const workspaceModal = page.locator('.create-workspace');
        await expect(workspaceModal).toBeVisible({ timeout: 3000 });
        
        // Fill in workspace name
        const nameInput = page.locator('.create-workspace input[type="text"], .create-workspace__input');
        if (await nameInput.first().isVisible({ timeout: 1000 }).catch(() => false)) {
          await nameInput.first().fill('Test Workspace');
          await captureScreen(page, '02-create-workspace-filled', testInfo);
        }
        
        // Click Create Workspace button inside the modal
        const createBtn = page.locator('.create-workspace button:has-text("Create Workspace"), .create-workspace__submit');
        if (await createBtn.first().isVisible({ timeout: 1000 }).catch(() => false)) {
          await createBtn.first().click();
          await page.waitForTimeout(500);
          await captureScreen(page, '02-create-workspace-done', testInfo);
        }
        
        // Close modal if it's still open (press Escape)
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    });
    
    test('1.3 - Recovery Phrase Screen', async ({ page }, testInfo) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      
      // Click Create New Identity and continue to recovery phrase
      const createBtn = page.locator('button:has-text("Create New Identity")');
      if (await createBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await createBtn.click();
        await page.waitForTimeout(500);
        
        // Fill name and continue
        const handleInput = page.locator('input[name="handle"], input[placeholder*="name" i]');
        if (await handleInput.isVisible({ timeout: 500 }).catch(() => false)) {
          await handleInput.fill('TestUser');
        }
        
        const continueBtn = page.locator('button:has-text("Create"), button:has-text("Continue")');
        if (await continueBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await continueBtn.first().click();
          await page.waitForTimeout(500);
        }
      }
      
      // Now should be on recovery phrase screen
      await captureScreen(page, '03-recovery-phrase-screen', testInfo);
      
      // Look for recovery phrase grid
      const recoveryGrid = page.locator('[class*="recovery-phrase"], [class*="mnemonic"], [class*="word-grid"]');
      if (await recoveryGrid.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await captureScreen(page, '03-recovery-phrase-words', testInfo);
      }
      
      // Look for copy button
      const copyBtn = page.locator('button:has-text("Copy")');
      if (await copyBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await copyBtn.click();
        await captureScreen(page, '03-recovery-phrase-copied', testInfo);
      }
      
      // Look for checkbox confirmation
      const checkbox = page.locator('input[type="checkbox"]');
      if (await checkbox.isVisible({ timeout: 1000 }).catch(() => false)) {
        await checkbox.check();
        await captureScreen(page, '03-recovery-phrase-confirmed', testInfo);
      }
    });
    
    test('1.4 - Restore Identity Flow', async ({ page }, testInfo) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      
      // Click Restore
      const restoreBtn = page.locator('button:has-text("Restore")');
      if (await restoreBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await restoreBtn.click();
        await page.waitForTimeout(500);
        await captureScreen(page, '04-restore-identity-screen', testInfo);
        
        // Look for word inputs or textarea
        const wordInput = page.locator('input[placeholder*="word" i], textarea[placeholder*="phrase" i], input[name*="word"]');
        if (await wordInput.first().isVisible({ timeout: 1000 }).catch(() => false)) {
          await captureScreen(page, '04-restore-word-inputs', testInfo);
        }
      }
    });
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2: WORKSPACE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('2. Workspace Management', () => {
    
    test.beforeEach(async ({ page }) => {
      await injectTestIdentity(page);
    });
    
    test('2.1 - Workspace Switcher', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      await captureScreen(page, '05-workspace-initial', testInfo);
      
      // Find and click workspace switcher
      const workspaceSwitcher = page.locator('[class*="workspace-switcher"], [class*="WorkspaceSwitcher"], button:has-text("Test Workspace")');
      if (await workspaceSwitcher.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await workspaceSwitcher.first().click();
        await page.waitForTimeout(300);
        await captureScreen(page, '05-workspace-switcher-open', testInfo);
        
        // Look for workspace list items
        const workspaceItems = page.locator('[class*="workspace-item"], [class*="workspace-list"] button');
        const count = await workspaceItems.count();
        console.log(`Found ${count} workspace items`);
        
        // Look for Create Workspace button
        const createWsBtn = page.locator('button:has-text("Create"), button:has-text("New Workspace")');
        if (await createWsBtn.first().isVisible({ timeout: 1000 }).catch(() => false)) {
          await captureScreen(page, '05-workspace-create-btn-visible', testInfo);
        }
        
        // Look for Join Workspace button
        const joinWsBtn = page.locator('button:has-text("Join")');
        if (await joinWsBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await captureScreen(page, '05-workspace-join-btn-visible', testInfo);
        }
      }
    });
    
    test('2.2 - Create Workspace Modal', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      // Open workspace switcher
      const workspaceSwitcher = page.locator('[class*="workspace-switcher"], [class*="WorkspaceSwitcher"], button:has-text("Test Workspace")');
      if (await workspaceSwitcher.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await workspaceSwitcher.first().click();
        await page.waitForTimeout(300);
        
        // Click Create Workspace
        const createBtn = page.locator('button:has-text("Create"), button:has-text("New Workspace")');
        if (await createBtn.first().isVisible({ timeout: 1000 }).catch(() => false)) {
          await createBtn.first().click();
          await page.waitForTimeout(500);
          await captureScreen(page, '06-create-workspace-modal', testInfo);
          
          // Check for tabs (create/join)
          const tabs = page.locator('[class*="tab"], [role="tab"]');
          const tabCount = await tabs.count();
          console.log(`Found ${tabCount} tabs in create workspace modal`);
          
          // Check for name input
          const nameInput = page.locator('input[placeholder*="name" i], input[name="name"]');
          if (await nameInput.isVisible({ timeout: 1000 }).catch(() => false)) {
            await nameInput.fill('New Test Workspace');
            await captureScreen(page, '06-create-workspace-name-filled', testInfo);
          }
          
          // Check for emoji picker inside the modal
          const modal = page.locator('[class*="create-workspace"], [class*="modal"]');
          const emojiBtn = modal.locator('[class*="icon-picker"], [class*="emoji-picker"], button[class*="icon"]');
          if (await emojiBtn.first().isVisible({ timeout: 1000 }).catch(() => false)) {
            await emojiBtn.first().click({ force: true });
            await page.waitForTimeout(300);
            await captureScreen(page, '06-create-workspace-emoji-picker', testInfo);
          }
        }
      }
    });
    
    test('2.3 - Join Workspace Tab', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      // First close any open modals by pressing Escape
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      
      // Open workspace switcher
      const workspaceSwitcher = page.locator('[class*="workspace-switcher"]');
      if (await workspaceSwitcher.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await workspaceSwitcher.first().click();
        await page.waitForTimeout(300);
        await captureScreen(page, '07-workspace-switcher-open', testInfo);
        
        // Try to open join modal
        const joinBtn = page.locator('[class*="workspace-switcher"] button:has-text("Join")');
        if (await joinBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await joinBtn.click();
          await page.waitForTimeout(500);
          await captureScreen(page, '07-join-workspace-modal', testInfo);
        }
        
        // Or click join tab in create modal within workspace switcher
        const createBtn = page.locator('[class*="workspace-switcher"] button:has-text("Create")');
        if (await createBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await createBtn.first().click({ force: true });
          await page.waitForTimeout(300);
          
          const joinTab = page.locator('[role="tab"]:has-text("Join"), button:has-text("Join")');
          if (await joinTab.first().isVisible({ timeout: 500 }).catch(() => false)) {
            await joinTab.first().click();
            await page.waitForTimeout(300);
            await captureScreen(page, '07-join-workspace-tab', testInfo);
            
            // Look for link input
            const linkInput = page.locator('input[placeholder*="link" i], input[placeholder*="invite" i], textarea');
            if (await linkInput.first().isVisible({ timeout: 500 }).catch(() => false)) {
              await captureScreen(page, '07-join-workspace-link-input', testInfo);
            }
          }
        }
      }
    });
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3: SIDEBAR & DOCUMENT NAVIGATION
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('3. Sidebar & Document Navigation', () => {
    
    test.beforeEach(async ({ page }) => {
      await injectTestIdentity(page);
    });
    
    test('3.1 - Sidebar Overview', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      await captureScreen(page, '08-sidebar-initial', testInfo);
      
      // Look for hierarchical sidebar
      const sidebar = page.locator('[class*="sidebar"], [class*="Sidebar"], aside');
      if (await sidebar.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await captureScreen(page, '08-sidebar-visible', testInfo);
        
        // Look for folder tree items
        const treeItems = sidebar.locator('[class*="tree-item"], [class*="TreeItem"], [role="treeitem"]');
        const itemCount = await treeItems.count();
        console.log(`Found ${itemCount} tree items in sidebar`);
      }
    });
    
    test('3.2 - Add Dropdown (New Document/Folder)', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      // Find + New button
      const addBtn = page.locator('button:has-text("+ New"), button:has-text("Add"), button[title*="Add"], button[title*="New"], [class*="add-dropdown"] button');
      if (await addBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await addBtn.first().click();
        await page.waitForTimeout(300);
        await captureScreen(page, '09-add-dropdown-open', testInfo);
        
        // Look for document type options
        const textOption = page.locator('button:has-text("Text"), [role="menuitem"]:has-text("Text"), [class*="menu-item"]:has-text("Text")');
        if (await textOption.isVisible({ timeout: 500 }).catch(() => false)) {
          await captureScreen(page, '09-add-dropdown-text-option', testInfo);
        }
        
        const kanbanOption = page.locator('button:has-text("Kanban"), [role="menuitem"]:has-text("Kanban")');
        if (await kanbanOption.isVisible({ timeout: 500 }).catch(() => false)) {
          await captureScreen(page, '09-add-dropdown-kanban-option', testInfo);
        }
        
        const sheetOption = page.locator('button:has-text("Sheet"), [role="menuitem"]:has-text("Sheet"), button:has-text("Spreadsheet")');
        if (await sheetOption.isVisible({ timeout: 500 }).catch(() => false)) {
          await captureScreen(page, '09-add-dropdown-sheet-option', testInfo);
        }
        
        const folderOption = page.locator('button:has-text("Folder"), [role="menuitem"]:has-text("Folder")');
        if (await folderOption.isVisible({ timeout: 500 }).catch(() => false)) {
          await captureScreen(page, '09-add-dropdown-folder-option', testInfo);
        }
      }
    });
    
    test('3.3 - Create Text Document', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      // Open add dropdown
      const addBtn = page.locator('button:has-text("+ New"), button:has-text("Add"), [class*="add-dropdown"] button');
      if (await addBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await addBtn.first().click();
        await page.waitForTimeout(300);
        
        // Click Text option
        const textOption = page.locator('button:has-text("Text"), [role="menuitem"]:has-text("Text")');
        if (await textOption.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await textOption.first().click();
          await page.waitForTimeout(500);
          await captureScreen(page, '10-text-document-created', testInfo);
        }
      }
    });
    
    test('3.4 - Create Kanban Board', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      const addBtn = page.locator('button:has-text("+ New"), button:has-text("Add"), [class*="add-dropdown"] button');
      if (await addBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await addBtn.first().click();
        await page.waitForTimeout(300);
        
        const kanbanOption = page.locator('button:has-text("Kanban"), [role="menuitem"]:has-text("Kanban")');
        if (await kanbanOption.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await kanbanOption.first().click();
          await page.waitForTimeout(500);
          await captureScreen(page, '11-kanban-created', testInfo);
        }
      }
    });
    
    test('3.5 - Create Spreadsheet', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      const addBtn = page.locator('button:has-text("+ New"), button:has-text("Add"), [class*="add-dropdown"] button');
      if (await addBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await addBtn.first().click();
        await page.waitForTimeout(300);
        
        const sheetOption = page.locator('button:has-text("Sheet"), button:has-text("Spreadsheet"), [role="menuitem"]:has-text("Sheet")');
        if (await sheetOption.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await sheetOption.first().click();
          await page.waitForTimeout(500);
          await captureScreen(page, '12-sheet-created', testInfo);
        }
      }
    });
    
    test('3.6 - Create Folder', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      const addBtn = page.locator('button:has-text("+ New"), button:has-text("Add"), [class*="add-dropdown"] button');
      if (await addBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await addBtn.first().click();
        await page.waitForTimeout(300);
        
        const folderOption = page.locator('button:has-text("Folder"), [role="menuitem"]:has-text("Folder")');
        if (await folderOption.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await folderOption.first().click();
          await page.waitForTimeout(500);
          await captureScreen(page, '13-folder-created', testInfo);
        }
      }
    });
    
    test('3.7 - Sidebar Context Menu (Right-Click)', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      // Find a sidebar item to right-click
      const sidebar = page.locator('[class*="sidebar"], aside');
      const sidebarItem = sidebar.locator('[class*="tree-item"], [class*="document"], [role="treeitem"]').first();
      
      if (await sidebarItem.isVisible({ timeout: 2000 }).catch(() => false)) {
        await sidebarItem.click({ button: 'right' });
        await page.waitForTimeout(300);
        await captureScreen(page, '14-sidebar-context-menu', testInfo);
        
        // Look for context menu items
        const contextMenu = page.locator('[class*="context-menu"], [role="menu"]');
        if (await contextMenu.isVisible({ timeout: 500 }).catch(() => false)) {
          await captureScreen(page, '14-context-menu-visible', testInfo);
          
          // Check for rename, delete, share options
          const renameOption = contextMenu.locator('button:has-text("Rename"), [role="menuitem"]:has-text("Rename")');
          const deleteOption = contextMenu.locator('button:has-text("Delete"), [role="menuitem"]:has-text("Delete")');
          const shareOption = contextMenu.locator('button:has-text("Share"), [role="menuitem"]:has-text("Share")');
          
          console.log(`Context menu options - Rename: ${await renameOption.isVisible()}, Delete: ${await deleteOption.isVisible()}, Share: ${await shareOption.isVisible()}`);
        }
      }
    });
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4: EDITOR TOOLBAR (ALL BUTTONS)
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('4. Editor Toolbar', () => {
    
    test.beforeEach(async ({ page }) => {
      await injectTestIdentity(page);
    });
    
    test('4.1 - Toolbar Overview', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      // Create or open a text document to get the editor
      const addBtn = page.locator('button:has-text("+ New"), button:has-text("Add")');
      if (await addBtn.first().isVisible({ timeout: 1000 }).catch(() => false)) {
        await addBtn.first().click();
        await page.waitForTimeout(200);
        const textOption = page.locator('button:has-text("Text"), [role="menuitem"]:has-text("Text")');
        if (await textOption.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await textOption.first().click();
          await page.waitForTimeout(500);
        }
      }
      
      await captureScreen(page, '15-toolbar-overview', testInfo);
      
      // Find toolbar
      const toolbar = page.locator('[class*="toolbar"], [class*="Toolbar"], [role="toolbar"]');
      if (await toolbar.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        const buttons = toolbar.locator('button');
        const count = await buttons.count();
        console.log(`Toolbar has ${count} buttons`);
        await captureScreen(page, '15-toolbar-buttons', testInfo);
      }
    });
    
    test('4.2 - History Group (Undo/Redo)', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      // First type something in editor
      const editor = page.locator('.ProseMirror, .tiptap, [contenteditable="true"]');
      if (await editor.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await editor.first().click();
        await page.keyboard.type('Test text for undo/redo');
        await captureScreen(page, '16-editor-with-text', testInfo);
        
        // Find and click Undo
        const undoBtn = page.locator('button:has-text("Undo"), button[title*="Undo"], button[aria-label*="Undo"]');
        if (await undoBtn.first().isVisible({ timeout: 1000 }).catch(() => false)) {
          await undoBtn.first().click();
          await page.waitForTimeout(200);
          await captureScreen(page, '16-after-undo', testInfo);
          
          // Find and click Redo
          const redoBtn = page.locator('button:has-text("Redo"), button[title*="Redo"], button[aria-label*="Redo"]');
          if (await redoBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
            await redoBtn.first().click();
            await page.waitForTimeout(200);
            await captureScreen(page, '16-after-redo', testInfo);
          }
        }
      }
    });
    
    test('4.3 - Formatting Group (Bold/Italic/Strike/Code)', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      const editor = page.locator('.ProseMirror, .tiptap, [contenteditable="true"]');
      if (await editor.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await editor.first().click();
        await page.keyboard.type('Format this text');
        
        // Select all text
        await page.keyboard.press('Control+a');
        await captureScreen(page, '17-text-selected', testInfo);
        
        // Bold
        const boldBtn = page.locator('button:has-text("Bold"), button[title*="Bold"], button[aria-label*="Bold"], button:has-text("B")').first();
        if (await boldBtn.isVisible({ timeout: 500 }).catch(() => false)) {
          await boldBtn.click();
          await page.waitForTimeout(200);
          await captureScreen(page, '17-bold-applied', testInfo);
          await boldBtn.click(); // Toggle off
        }
        
        // Italic
        const italicBtn = page.locator('button:has-text("Italic"), button[title*="Italic"], button[aria-label*="Italic"], button:has-text("I")').first();
        if (await italicBtn.isVisible({ timeout: 500 }).catch(() => false)) {
          await italicBtn.click();
          await page.waitForTimeout(200);
          await captureScreen(page, '17-italic-applied', testInfo);
          await italicBtn.click();
        }
        
        // Strike
        const strikeBtn = page.locator('button:has-text("Strike"), button[title*="Strike"], button[aria-label*="Strike"]');
        if (await strikeBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await strikeBtn.first().click();
          await page.waitForTimeout(200);
          await captureScreen(page, '17-strike-applied', testInfo);
          await strikeBtn.first().click();
        }
        
        // Inline Code
        const codeBtn = page.locator('button:has-text("Code"), button[title*="Code"], button[aria-label*="Code"]');
        if (await codeBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await codeBtn.first().click();
          await page.waitForTimeout(200);
          await captureScreen(page, '17-code-applied', testInfo);
        }
      }
    });
    
    test('4.4 - Headings Group (H1/H2/H3/Paragraph)', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      const editor = page.locator('.ProseMirror, .tiptap, [contenteditable="true"]');
      if (await editor.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await editor.first().click();
        await page.keyboard.type('Heading Test');
        
        // H1
        const h1Btn = page.locator('button:has-text("H1"), button[title*="Heading 1"]');
        if (await h1Btn.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await h1Btn.first().click();
          await page.waitForTimeout(200);
          await captureScreen(page, '18-h1-applied', testInfo);
        }
        
        // H2
        const h2Btn = page.locator('button:has-text("H2"), button[title*="Heading 2"]');
        if (await h2Btn.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await h2Btn.first().click();
          await page.waitForTimeout(200);
          await captureScreen(page, '18-h2-applied', testInfo);
        }
        
        // H3
        const h3Btn = page.locator('button:has-text("H3"), button[title*="Heading 3"]');
        if (await h3Btn.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await h3Btn.first().click();
          await page.waitForTimeout(200);
          await captureScreen(page, '18-h3-applied', testInfo);
        }
        
        // Back to Paragraph
        const paraBtn = page.locator('button:has-text("Paragraph"), button:has-text("P"), button[title*="Paragraph"]');
        if (await paraBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await paraBtn.first().click();
          await page.waitForTimeout(200);
          await captureScreen(page, '18-paragraph-applied', testInfo);
        }
      }
    });
    
    test('4.5 - Block Elements (Blockquote/CodeBlock/HR)', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      const editor = page.locator('.ProseMirror, .tiptap, [contenteditable="true"]');
      if (await editor.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await editor.first().click();
        await page.keyboard.type('Block element test');
        
        // Blockquote
        const quoteBtn = page.locator('button:has-text("Quote"), button:has-text("Blockquote"), button[title*="Blockquote"]');
        if (await quoteBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await quoteBtn.first().click();
          await page.waitForTimeout(200);
          await captureScreen(page, '19-blockquote-applied', testInfo);
          await quoteBtn.first().click(); // Toggle off
        }
        
        // Code Block
        const codeBlockBtn = page.locator('button:has-text("Code Block"), button[title*="Code Block"]');
        if (await codeBlockBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await codeBlockBtn.first().click();
          await page.waitForTimeout(200);
          await captureScreen(page, '19-codeblock-applied', testInfo);
        }
        
        // Horizontal Rule
        const hrBtn = page.locator('button:has-text("Horizontal"), button:has-text("HR"), button[title*="Horizontal"]');
        if (await hrBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await hrBtn.first().click();
          await page.waitForTimeout(200);
          await captureScreen(page, '19-hr-inserted', testInfo);
        }
      }
    });
    
    test('4.6 - Lists (Bullet/Ordered)', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      const editor = page.locator('.ProseMirror, .tiptap, [contenteditable="true"]');
      if (await editor.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await editor.first().click();
        await page.keyboard.type('List item 1');
        await page.keyboard.press('Enter');
        await page.keyboard.type('List item 2');
        await page.keyboard.press('Control+a');
        
        // Bullet List
        const bulletBtn = page.locator('button:has-text("Bullet"), button[title*="Bullet"], button[aria-label*="Bullet"]');
        if (await bulletBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await bulletBtn.first().click();
          await page.waitForTimeout(200);
          await captureScreen(page, '20-bullet-list', testInfo);
        }
        
        // Ordered List
        const orderedBtn = page.locator('button:has-text("Ordered"), button:has-text("Numbered"), button[title*="Ordered"]');
        if (await orderedBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await orderedBtn.first().click();
          await page.waitForTimeout(200);
          await captureScreen(page, '20-ordered-list', testInfo);
        }
      }
    });
    
    test('4.7 - Table Operations', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      const editor = page.locator('.ProseMirror, .tiptap, [contenteditable="true"]');
      if (await editor.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await editor.first().click();
        
        // Insert Table
        const tableBtn = page.locator('button:has-text("Insert Table"), button:has-text("Table"), button[title*="Table"]');
        if (await tableBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await tableBtn.first().click();
          await page.waitForTimeout(300);
          await captureScreen(page, '21-table-inserted', testInfo);
          
          // Add Column
          const addColBtn = page.locator('button:has-text("Add Column"), button[title*="Add Column"]');
          if (await addColBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
            await addColBtn.first().click();
            await page.waitForTimeout(200);
            await captureScreen(page, '21-column-added', testInfo);
          }
          
          // Add Row
          const addRowBtn = page.locator('button:has-text("Add Row"), button[title*="Add Row"]');
          if (await addRowBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
            await addRowBtn.first().click();
            await page.waitForTimeout(200);
            await captureScreen(page, '21-row-added', testInfo);
          }
          
          // Delete Table
          const deleteTableBtn = page.locator('button:has-text("Delete Table"), button[title*="Delete Table"]');
          if (await deleteTableBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
            await deleteTableBtn.first().click();
            await page.waitForTimeout(200);
            await captureScreen(page, '21-table-deleted', testInfo);
          }
        }
      }
    });
    
    test('4.8 - Export/Import', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      // Look for export dropdown/button
      const exportBtn = page.locator('button:has-text("Export"), button[title*="Export"]');
      if (await exportBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await exportBtn.first().click();
        await page.waitForTimeout(300);
        await captureScreen(page, '22-export-dropdown', testInfo);
      }
      
      // Look for import button
      const importBtn = page.locator('button:has-text("Import"), button[title*="Import"]');
      if (await importBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
        await captureScreen(page, '22-import-button', testInfo);
      }
    });
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5: TAB BAR & HEADER CONTROLS
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('5. TabBar & Header Controls', () => {
    
    test.beforeEach(async ({ page }) => {
      await injectTestIdentity(page);
    });
    
    test('5.1 - Document Tabs', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      // Look for tab bar
      const tabBar = page.locator('[class*="tab-bar"], [class*="TabBar"], [role="tablist"]');
      if (await tabBar.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await captureScreen(page, '23-tabbar-visible', testInfo);
        
        // Look for tabs
        const tabs = tabBar.locator('[role="tab"], [class*="tab"]');
        const tabCount = await tabs.count();
        console.log(`Found ${tabCount} tabs`);
        
        // Look for close buttons on tabs
        const closeBtn = tabBar.locator('button[class*="close"], button[aria-label*="Close"]');
        if (await closeBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await captureScreen(page, '23-tab-close-button', testInfo);
        }
      }
    });
    
    test('5.2 - Comments Panel Toggle', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      const commentsBtn = page.locator('button:has-text("Comments"), button[title*="Comments"], button[aria-label*="Comments"]');
      if (await commentsBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await commentsBtn.first().click();
        await page.waitForTimeout(500);
        await captureScreen(page, '24-comments-panel-open', testInfo);
        
        // Look for comment input
        const commentInput = page.locator('[class*="comment"] input, [class*="comment"] textarea');
        if (await commentInput.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await captureScreen(page, '24-comment-input', testInfo);
        }
        
        // Close comments
        await commentsBtn.first().click();
        await page.waitForTimeout(300);
        await captureScreen(page, '24-comments-closed', testInfo);
      }
    });
    
    test('5.3 - History/Changelog Panel', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      const historyBtn = page.locator('button:has-text("History"), button[title*="History"], button[aria-label*="History"], button:has-text("Changelog")');
      if (await historyBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await historyBtn.first().click();
        await page.waitForTimeout(500);
        await captureScreen(page, '25-history-panel-open', testInfo);
        
        // Look for version entries
        const versions = page.locator('[class*="version"], [class*="changelog"] [class*="entry"]');
        const versionCount = await versions.count();
        console.log(`Found ${versionCount} version entries`);
      }
    });
    
    test('5.4 - Fullscreen Toggle', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      const fullscreenBtn = page.locator('button:has-text("Fullscreen"), button[title*="Fullscreen"], button[aria-label*="Fullscreen"]');
      if (await fullscreenBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await fullscreenBtn.first().click();
        await page.waitForTimeout(500);
        await captureScreen(page, '26-fullscreen-mode', testInfo);
        
        // Toggle back
        const exitBtn = page.locator('button:has-text("Exit"), button[title*="Exit Fullscreen"]');
        if (await exitBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await exitBtn.first().click();
          await page.waitForTimeout(300);
          await captureScreen(page, '26-exit-fullscreen', testInfo);
        }
      }
    });
    
    test('5.5 - User Profile Dropdown', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      // Look for user profile button (usually has avatar/emoji)
      const profileBtn = page.locator('[class*="user-profile"], [class*="UserProfile"], button:has-text("🧪"), [class*="avatar"]');
      if (await profileBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await profileBtn.first().click();
        await page.waitForTimeout(500);
        await captureScreen(page, '27-user-profile-dropdown', testInfo);
        
        // Look for profile editing options
        const nameInput = page.locator('input[placeholder*="name" i], input[name="name"]');
        if (await nameInput.isVisible({ timeout: 500 }).catch(() => false)) {
          await captureScreen(page, '27-profile-name-input', testInfo);
        }
        
        // Look for color/icon pickers
        const colorPicker = page.locator('[class*="color-picker"], [class*="ColorPicker"]');
        if (await colorPicker.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await captureScreen(page, '27-profile-color-picker', testInfo);
        }
        
        const iconPicker = page.locator('[class*="icon-picker"], [class*="emoji"]');
        if (await iconPicker.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await captureScreen(page, '27-profile-icon-picker', testInfo);
        }
      }
    });
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 6: STATUS BAR CONTROLS
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('6. Status Bar Controls', () => {
    
    test.beforeEach(async ({ page }) => {
      await injectTestIdentity(page);
    });
    
    test('6.1 - Status Bar Overview', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      const statusBar = page.locator('[class*="status-bar"], [class*="StatusBar"]');
      if (await statusBar.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await captureScreen(page, '28-statusbar-visible', testInfo);
      }
    });
    
    test('6.2 - Tor Toggle', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      const torToggle = page.locator('[class*="tor-toggle"], input[type="checkbox"][class*="tor"], button:has-text("Tor"), [class*="switch"][class*="tor"]');
      if (await torToggle.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await captureScreen(page, '29-tor-toggle-visible', testInfo);
        
        // Click to toggle
        await torToggle.first().click();
        await page.waitForTimeout(500);
        await captureScreen(page, '29-tor-toggled', testInfo);
      }
    });
    
    test('6.3 - P2P Connection Status', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      const p2pStatus = page.locator('[class*="p2p-status"], [class*="connection-status"], [class*="status-indicator"]');
      if (await p2pStatus.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await captureScreen(page, '30-p2p-status', testInfo);
        
        // Click to see details
        await p2pStatus.first().click();
        await page.waitForTimeout(300);
        await captureScreen(page, '30-p2p-status-clicked', testInfo);
      }
    });
    
    test('6.4 - Collaborator Chips', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      const collaboratorChip = page.locator('[class*="collaborator"], [class*="peer"], [class*="avatar"]');
      if (await collaboratorChip.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await captureScreen(page, '31-collaborator-chips', testInfo);
        
        // Click to expand flyout
        await collaboratorChip.first().click();
        await page.waitForTimeout(300);
        await captureScreen(page, '31-collaborator-flyout', testInfo);
      }
    });
    
    test('6.5 - Word/Character Count', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      // First add some text to the editor
      const editor = page.locator('.ProseMirror, .tiptap, [contenteditable="true"]');
      if (await editor.first().isVisible({ timeout: 1000 }).catch(() => false)) {
        await editor.first().click();
        await page.keyboard.type('Testing the word count feature with some sample text.');
        await page.waitForTimeout(300);
      }
      
      const wordCount = page.locator('[class*="word-count"], [class*="WordCount"], text=/\\d+\\s*words?/i');
      if (await wordCount.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await captureScreen(page, '32-word-count', testInfo);
      }
    });
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 7: DOCUMENT TYPES
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('7. Document Types', () => {
    
    test.beforeEach(async ({ page }) => {
      await injectTestIdentity(page);
    });
    
    test('7.1 - Kanban Board Controls', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      // Create a Kanban document
      const addBtn = page.locator('button:has-text("+ New"), button:has-text("Add")');
      if (await addBtn.first().isVisible({ timeout: 1000 }).catch(() => false)) {
        await addBtn.first().click();
        await page.waitForTimeout(200);
        const kanbanOption = page.locator('button:has-text("Kanban"), [role="menuitem"]:has-text("Kanban")');
        if (await kanbanOption.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await kanbanOption.first().click();
          await page.waitForTimeout(500);
        }
      }
      
      await captureScreen(page, '33-kanban-board', testInfo);
      
      // Look for columns
      const columns = page.locator('[class*="kanban-column"], [class*="column"]');
      const colCount = await columns.count();
      console.log(`Found ${colCount} kanban columns`);
      
      // Add a new column
      const addColBtn = page.locator('button:has-text("Add Column"), button:has-text("+ Column")');
      if (await addColBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
        await addColBtn.first().click();
        await page.waitForTimeout(300);
        await captureScreen(page, '33-kanban-add-column', testInfo);
      }
      
      // Add a card
      const addCardBtn = page.locator('button:has-text("Add Card"), button:has-text("+ Card"), button:has-text("+")');
      if (await addCardBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
        await addCardBtn.first().click();
        await page.waitForTimeout(300);
        await captureScreen(page, '33-kanban-add-card', testInfo);
      }
    });
    
    test('7.2 - Spreadsheet Controls', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      // Create a Sheet document
      const addBtn = page.locator('button:has-text("+ New"), button:has-text("Add")');
      if (await addBtn.first().isVisible({ timeout: 1000 }).catch(() => false)) {
        await addBtn.first().click();
        await page.waitForTimeout(200);
        const sheetOption = page.locator('button:has-text("Sheet"), button:has-text("Spreadsheet")');
        if (await sheetOption.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await sheetOption.first().click();
          await page.waitForTimeout(1000);
        }
      }
      
      await captureScreen(page, '34-spreadsheet-view', testInfo);
      
      // Look for sheet cells
      const sheetContainer = page.locator('[class*="fortune-sheet"], [class*="sheet"], [class*="spreadsheet"]');
      if (await sheetContainer.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await captureScreen(page, '34-sheet-container', testInfo);
        
        // Try clicking a cell
        const cell = page.locator('[class*="cell"], td').first();
        if (await cell.isVisible({ timeout: 500 }).catch(() => false)) {
          await cell.click();
          await page.waitForTimeout(200);
          await captureScreen(page, '34-cell-selected', testInfo);
          
          // Type in cell
          await page.keyboard.type('=SUM(1,2,3)');
          await page.keyboard.press('Enter');
          await page.waitForTimeout(200);
          await captureScreen(page, '34-formula-entered', testInfo);
        }
      }
    });
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 8: DIALOGS & MODALS
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('8. Dialogs & Modals', () => {
    
    test.beforeEach(async ({ page }) => {
      await injectTestIdentity(page);
    });
    
    test('8.1 - Share Dialog', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      // First create a document to share
      const addBtn = page.locator('button:has-text("+ New"), button:has-text("Add")');
      if (await addBtn.first().isVisible({ timeout: 1000 }).catch(() => false)) {
        await addBtn.first().click();
        await page.waitForTimeout(200);
        const textOption = page.locator('button:has-text("Text"), [role="menuitem"]:has-text("Text")');
        if (await textOption.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await textOption.first().click();
          await page.waitForTimeout(500);
        }
      }
      
      // Open share dialog via context menu or button
      const shareBtn = page.locator('button:has-text("Share"), button[title*="Share"]');
      if (await shareBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await shareBtn.first().click();
        await page.waitForTimeout(500);
        await captureScreen(page, '35-share-dialog', testInfo);
        
        // Check for tabs
        const shareTab = page.locator('[role="tab"]:has-text("Share")');
        if (await shareTab.isVisible({ timeout: 500 }).catch(() => false)) {
          await captureScreen(page, '35-share-tab', testInfo);
        }
        
        const joinTab = page.locator('[role="tab"]:has-text("Join")');
        if (await joinTab.isVisible({ timeout: 500 }).catch(() => false)) {
          await joinTab.click();
          await page.waitForTimeout(300);
          await captureScreen(page, '35-join-tab', testInfo);
        }
        
        // Check for password toggle
        const passwordToggle = page.locator('[class*="password"] input[type="checkbox"], label:has-text("Password")');
        if (await passwordToggle.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await passwordToggle.first().click();
          await page.waitForTimeout(200);
          await captureScreen(page, '35-password-enabled', testInfo);
        }
        
        // Check for QR code
        const qrCode = page.locator('[class*="qr"], canvas, svg[class*="qr"]');
        if (await qrCode.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await captureScreen(page, '35-qr-code', testInfo);
        }
        
        // Check for copy format options
        const copyFormat = page.locator('select, [class*="copy-format"]');
        if (await copyFormat.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await captureScreen(page, '35-copy-format', testInfo);
        }
      }
    });
    
    test('8.2 - Identity Settings Dialog', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      // Look for settings/identity button
      const settingsBtn = page.locator('button:has-text("Settings"), button[title*="Settings"], [class*="settings-btn"]');
      if (await settingsBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await settingsBtn.first().click();
        await page.waitForTimeout(500);
        await captureScreen(page, '36-identity-settings', testInfo);
        
        // Check for Profile tab
        const profileTab = page.locator('[role="tab"]:has-text("Profile"), button:has-text("Profile")');
        if (await profileTab.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await profileTab.first().click();
          await page.waitForTimeout(300);
          await captureScreen(page, '36-profile-tab', testInfo);
        }
        
        // Check for Security tab
        const securityTab = page.locator('[role="tab"]:has-text("Security"), button:has-text("Security")');
        if (await securityTab.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await securityTab.first().click();
          await page.waitForTimeout(300);
          await captureScreen(page, '36-security-tab', testInfo);
          
          // Check for mnemonic reveal button
          const revealBtn = page.locator('button:has-text("Show"), button:has-text("Reveal")');
          if (await revealBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
            await revealBtn.first().click();
            await page.waitForTimeout(300);
            await captureScreen(page, '36-mnemonic-revealed', testInfo);
          }
        }
        
        // Check for Transfer tab (QR code for device transfer)
        const transferTab = page.locator('[role="tab"]:has-text("Transfer"), button:has-text("Transfer")');
        if (await transferTab.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await transferTab.first().click();
          await page.waitForTimeout(300);
          await captureScreen(page, '36-transfer-tab', testInfo);
        }
      }
    });
    
    test('8.3 - Tor Settings Dialog', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      // Look for Tor settings
      const torBtn = page.locator('button:has-text("Tor"), [class*="tor"] button, [class*="tor-settings"]');
      if (await torBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await torBtn.first().click();
        await page.waitForTimeout(500);
        await captureScreen(page, '37-tor-settings', testInfo);
        
        // Check for Tor mode options
        const torModes = page.locator('[class*="tor-mode"], input[type="radio"]');
        const modeCount = await torModes.count();
        console.log(`Found ${modeCount} Tor mode options`);
        
        for (let i = 0; i < Math.min(modeCount, 3); i++) {
          const mode = torModes.nth(i);
          if (await mode.isVisible()) {
            await mode.click();
            await page.waitForTimeout(200);
            await captureScreen(page, `37-tor-mode-${i}`, testInfo);
          }
        }
      }
    });
    
    test('8.4 - Confirm Dialog', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      // Try to trigger a confirm dialog by deleting something
      const sidebar = page.locator('[class*="sidebar"], aside');
      const sidebarItem = sidebar.locator('[class*="tree-item"], [class*="document"]').first();
      
      if (await sidebarItem.isVisible({ timeout: 2000 }).catch(() => false)) {
        // Right-click and select delete
        await sidebarItem.click({ button: 'right' });
        await page.waitForTimeout(300);
        
        const deleteOption = page.locator('[role="menuitem"]:has-text("Delete"), button:has-text("Delete")');
        if (await deleteOption.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await deleteOption.first().click();
          await page.waitForTimeout(500);
          await captureScreen(page, '38-confirm-dialog', testInfo);
          
          // Look for confirm/cancel buttons
          const confirmBtn = page.locator('[class*="confirm"] button:has-text("Confirm"), button:has-text("Delete")');
          const cancelBtn = page.locator('button:has-text("Cancel")');
          
          if (await cancelBtn.isVisible({ timeout: 500 }).catch(() => false)) {
            await captureScreen(page, '38-confirm-dialog-buttons', testInfo);
            await cancelBtn.click();
            await page.waitForTimeout(200);
            await captureScreen(page, '38-confirm-cancelled', testInfo);
          }
        }
      }
    });
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 9: CHAT PANEL
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('9. Chat Panel', () => {
    
    test.beforeEach(async ({ page }) => {
      await injectTestIdentity(page);
    });
    
    test('9.1 - Open Chat Panel', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      // Look for chat toggle button
      const chatBtn = page.locator('button:has-text("Chat"), button[title*="Chat"], [class*="chat-toggle"]');
      if (await chatBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await chatBtn.first().click();
        await page.waitForTimeout(500);
        await captureScreen(page, '39-chat-panel-open', testInfo);
        
        // Look for message input
        const messageInput = page.locator('[class*="chat"] input, [class*="chat"] textarea, input[placeholder*="message" i]');
        if (await messageInput.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await captureScreen(page, '39-chat-input', testInfo);
        }
        
        // Look for chat tabs
        const chatTabs = page.locator('[class*="chat"] [role="tab"], [class*="chat-tabs"] button');
        const tabCount = await chatTabs.count();
        console.log(`Found ${tabCount} chat tabs`);
      }
    });
    
    test('9.2 - Send Message', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      const chatBtn = page.locator('button:has-text("Chat"), [class*="chat-toggle"]');
      if (await chatBtn.first().isVisible({ timeout: 1000 }).catch(() => false)) {
        await chatBtn.first().click();
        await page.waitForTimeout(500);
        
        const messageInput = page.locator('[class*="chat"] input, [class*="chat"] textarea');
        if (await messageInput.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await messageInput.first().fill('Test message from UI crawler');
          await captureScreen(page, '40-chat-message-typed', testInfo);
          
          // Send via Enter or button
          await page.keyboard.press('Enter');
          await page.waitForTimeout(300);
          await captureScreen(page, '40-chat-message-sent', testInfo);
        }
      }
    });
    
    test('9.3 - Chat Minimize/Maximize', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      const chatBtn = page.locator('button:has-text("Chat"), [class*="chat-toggle"]');
      if (await chatBtn.first().isVisible({ timeout: 1000 }).catch(() => false)) {
        await chatBtn.first().click();
        await page.waitForTimeout(500);
        
        // Look for minimize button
        const minimizeBtn = page.locator('[class*="chat"] button:has-text("−"), [class*="minimize"], button[aria-label*="Minimize"]');
        if (await minimizeBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await minimizeBtn.first().click();
          await page.waitForTimeout(300);
          await captureScreen(page, '41-chat-minimized', testInfo);
          
          // Maximize
          await minimizeBtn.first().click();
          await page.waitForTimeout(300);
          await captureScreen(page, '41-chat-maximized', testInfo);
        }
      }
    });
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 10: RESPONSIVE LAYOUTS
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('10. Responsive Layouts', () => {
    
    test('10.1 - Mobile Layout (375px)', async ({ page }, testInfo) => {
      await injectTestIdentity(page, { viewport: { width: 375, height: 812 } });
      await ensureInMainApp(page, testInfo);
      
      await captureScreen(page, '42-mobile-layout', testInfo);
      
      // Check for mobile menu/hamburger
      const menuBtn = page.locator('button[aria-label*="menu"], [class*="hamburger"], [class*="menu-toggle"]');
      if (await menuBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await menuBtn.first().click();
        await page.waitForTimeout(300);
        await captureScreen(page, '42-mobile-menu-opened', testInfo);
      }
      
      // Check if sidebar is collapsed
      const sidebar = page.locator('[class*="sidebar"]');
      if (await sidebar.first().isVisible({ timeout: 500 }).catch(() => false)) {
        await captureScreen(page, '42-mobile-sidebar', testInfo);
      }
    });
    
    test('10.2 - Tablet Layout (768px)', async ({ page }, testInfo) => {
      await injectTestIdentity(page, { viewport: { width: 768, height: 1024 } });
      await ensureInMainApp(page, testInfo);
      
      await captureScreen(page, '43-tablet-layout', testInfo);
    });
    
    test('10.3 - Desktop Layout (1280px)', async ({ page }, testInfo) => {
      await injectTestIdentity(page, { viewport: { width: 1280, height: 800 } });
      await ensureInMainApp(page, testInfo);
      
      await captureScreen(page, '44-desktop-layout', testInfo);
    });
    
    test('10.4 - Large Desktop (1920px)', async ({ page }, testInfo) => {
      await injectTestIdentity(page, { viewport: { width: 1920, height: 1080 } });
      await ensureInMainApp(page, testInfo);
      
      await captureScreen(page, '45-large-desktop-layout', testInfo);
    });
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 11: INTERACTION STATES
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('11. Interaction States', () => {
    
    test.beforeEach(async ({ page }) => {
      await injectTestIdentity(page);
    });
    
    test('11.1 - Button Hover States', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      const buttons = page.locator('button:visible');
      const btnCount = await buttons.count();
      console.log(`Found ${btnCount} visible buttons`);
      
      for (let i = 0; i < Math.min(btnCount, 10); i++) {
        const btn = buttons.nth(i);
        if (await btn.isVisible()) {
          await btn.hover();
          await page.waitForTimeout(150);
          await captureScreen(page, `46-btn-hover-${i}`, testInfo);
        }
      }
    });
    
    test('11.2 - Focus States (Keyboard Navigation)', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      // Tab through interactive elements
      for (let i = 0; i < 15; i++) {
        await page.keyboard.press('Tab');
        await page.waitForTimeout(100);
        await captureScreen(page, `47-focus-state-${i}`, testInfo);
      }
    });
    
    test('11.3 - Input Field States', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      const inputs = page.locator('input:visible, textarea:visible');
      const inputCount = await inputs.count();
      console.log(`Found ${inputCount} visible inputs`);
      
      for (let i = 0; i < Math.min(inputCount, 5); i++) {
        const input = inputs.nth(i);
        if (await input.isVisible()) {
          // Focus
          await input.focus();
          await page.waitForTimeout(100);
          await captureScreen(page, `48-input-focus-${i}`, testInfo);
          
          // Type
          await input.fill('Test input');
          await page.waitForTimeout(100);
          await captureScreen(page, `48-input-filled-${i}`, testInfo);
        }
      }
    });
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 12: ERROR STATES & EDGE CASES
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('12. Error States & Edge Cases', () => {
    
    test('12.1 - Offline Mode', async ({ page, context }, testInfo) => {
      await injectTestIdentity(page);
      await ensureInMainApp(page, testInfo);
      
      await captureScreen(page, '49-before-offline', testInfo);
      
      // Go offline
      await context.setOffline(true);
      await page.waitForTimeout(1000);
      await captureScreen(page, '49-offline-state', testInfo);
      
      // Check for offline indicator
      const offlineIndicator = page.locator('[class*="offline"], [class*="disconnected"], text=/offline/i');
      if (await offlineIndicator.first().isVisible({ timeout: 1000 }).catch(() => false)) {
        await captureScreen(page, '49-offline-indicator', testInfo);
      }
      
      // Try an action while offline
      const anyBtn = page.locator('button:visible').first();
      if (await anyBtn.isVisible()) {
        await anyBtn.click().catch(() => {});
        await page.waitForTimeout(300);
        await captureScreen(page, '49-offline-action', testInfo);
      }
      
      // Go back online
      await context.setOffline(false);
      await page.waitForTimeout(1000);
      await captureScreen(page, '49-back-online', testInfo);
    });
    
    test('12.2 - Empty States', async ({ page }, testInfo) => {
      // Create new workspace with no documents
      await page.goto('/');
      await page.evaluate((identity) => {
        localStorage.setItem('nahma-identity', JSON.stringify(identity));
      }, TEST_IDENTITY);
      
      // Set empty workspace
      await page.evaluate(({ workspaces, currentId }) => {
        const emptyWs = [{
          ...workspaces[0],
          folders: [],
          documents: []
        }];
        localStorage.setItem('nahma-workspaces', JSON.stringify(emptyWs));
        localStorage.setItem('nahma-current-workspace', currentId);
      }, { workspaces: TEST_WORKSPACES, currentId: TEST_WORKSPACE_ID });
      
      await page.reload();
      await page.waitForLoadState('networkidle');
      await ensureInMainApp(page, testInfo);
      
      await captureScreen(page, '50-empty-workspace', testInfo);
      
      // Look for empty state messages
      const emptyState = page.locator('[class*="empty"], text=/no documents/i, text=/get started/i');
      if (await emptyState.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await captureScreen(page, '50-empty-state-message', testInfo);
      }
    });
    
    test('12.3 - Long Text Overflow', async ({ page }, testInfo) => {
      await injectTestIdentity(page);
      await ensureInMainApp(page, testInfo);
      
      // Create document with long name
      const addBtn = page.locator('button:has-text("+ New"), button:has-text("Add")');
      if (await addBtn.first().isVisible({ timeout: 1000 }).catch(() => false)) {
        await addBtn.first().click();
        await page.waitForTimeout(200);
        const textOption = page.locator('button:has-text("Text")');
        if (await textOption.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await textOption.first().click();
          await page.waitForTimeout(500);
        }
      }
      
      // Type very long text in editor
      const editor = page.locator('.ProseMirror, .tiptap, [contenteditable="true"]');
      if (await editor.first().isVisible({ timeout: 1000 }).catch(() => false)) {
        await editor.first().click();
        const longText = 'This is a very long paragraph that tests how the UI handles overflow. '.repeat(20);
        await page.keyboard.type(longText);
        await page.waitForTimeout(300);
        await captureScreen(page, '51-long-text-overflow', testInfo);
      }
    });
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 13: ACCESSIBILITY CHECKS
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('13. Accessibility', () => {
    
    test.beforeEach(async ({ page }) => {
      await injectTestIdentity(page);
    });
    
    test('13.1 - Color Contrast Check', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      // Capture in light mode (default)
      await captureScreen(page, '52-accessibility-light', testInfo);
      
      // Check for common issues
      const issues = await checkCommonIssues(page);
      console.log('Accessibility issues:', JSON.stringify(issues, null, 2));
    });
    
    test('13.2 - Keyboard Navigation Complete', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      // Start from first element
      await page.keyboard.press('Tab');
      
      let visitedElements = [];
      for (let i = 0; i < 25; i++) {
        const focused = await page.evaluate(() => {
          const el = document.activeElement;
          return {
            tag: el.tagName,
            text: el.textContent?.slice(0, 50),
            role: el.getAttribute('role'),
            ariaLabel: el.getAttribute('aria-label')
          };
        });
        visitedElements.push(focused);
        
        await page.keyboard.press('Tab');
        await page.waitForTimeout(50);
      }
      
      console.log('Keyboard navigation order:', visitedElements);
      await captureScreen(page, '53-keyboard-navigation', testInfo);
    });
    
    test('13.3 - Screen Reader Labels', async ({ page }, testInfo) => {
      await ensureInMainApp(page, testInfo);
      
      // Get accessibility tree
      const tree = await getAccessibilityTree(page);
      console.log('Accessibility tree (summary):', JSON.stringify(tree, null, 2).slice(0, 5000));
      
      await captureScreen(page, '54-accessibility-tree', testInfo);
    });
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 14: FULL PAGE GALLERY
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe('14. Full Page Gallery', () => {
    
    test('14.1 - Complete UI Gallery', async ({ page }, testInfo) => {
      await injectTestIdentity(page, { viewport: { width: 1280, height: 900 } });
      await ensureInMainApp(page, testInfo);
      
      // Take full page screenshot of main app
      await captureScreen(page, '55-gallery-main', testInfo);
      
      // Open each major panel and capture
      const panels = [
        { name: 'sidebar', locator: '[class*="sidebar"]' },
        { name: 'toolbar', locator: '[class*="toolbar"]' },
        { name: 'statusbar', locator: '[class*="status-bar"]' },
        { name: 'tabbar', locator: '[class*="tab-bar"]' }
      ];
      
      for (const panel of panels) {
        const el = page.locator(panel.locator);
        if (await el.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await captureScreen(page, `55-gallery-${panel.name}`, testInfo);
        }
      }
    });
  });
});
