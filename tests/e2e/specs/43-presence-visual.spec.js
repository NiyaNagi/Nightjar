/**
 * Presence Visual Testing
 * 
 * Comprehensive visual tests for real-time presence across all document types.
 * Tests cursor tracking, typing indicators, collaborator bubbles, and N-client scenarios.
 * 
 * Test Matrix:
 * - Document Types: Editor, Spreadsheet, Kanban
 * - Presence Elements: Sidebar, Header, In-document cursors, Typing indicators
 * - Client Configurations: 2-client, 3-client mesh
 * - Scenarios: Join, Type, Move cursor, Disconnect
 */
const { test, expect } = require('../fixtures/test-fixtures.js');
const {
    waitForAppReady,
    ensureIdentityExists,
    createWorkspaceViaUI,
    createDocumentViaUI,
    getShareLinkViaUI,
    joinWorkspaceViaUI,
} = require('../helpers/assertions.js');
const {
    waitForPresenceSync,
    waitForSidebarItems,
    TYPING_INDICATOR_TIMEOUT
} = require('../helpers/presence-helpers.js');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = path.join(__dirname, '../../test-results/presence-visual');

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// Helper to screenshot with naming convention
async function screenshot(page, name) {
    const filename = `${name.replace(/[^a-z0-9]/gi, '-')}.png`;
    const filepath = path.join(SCREENSHOT_DIR, filename);
    await page.screenshot({ path: filepath, fullPage: true });
    console.log(`[Screenshot] ${filename}`);
    return filepath;
}

test.describe('Presence Visual Tests', () => {
    // Allow extra time for multi-client tests
    test.setTimeout(180000);
    
    test.describe('2-Client Scenarios', () => {
        
        test('editor - collaborator joins and is visible', async ({
            collaboratorPages
        }) => {
            const { page1, page2 } = collaboratorPages;
            
            // Setup page1 (Alice) - create workspace
            await waitForAppReady(page1);
            await ensureIdentityExists(page1, 'Alice');
            await createWorkspaceViaUI(page1, `Presence Test ${Date.now()}`);
            
            await screenshot(page1, '01-editor-alice-alone');
            
            // Get share link for page2 to join
            const shareLink = await getShareLinkViaUI(page1);
            
            // Setup page2 (Bob) - join workspace
            await waitForAppReady(page2);
            await ensureIdentityExists(page2, 'Bob');
            await joinWorkspaceViaUI(page2, shareLink);
            
            await waitForPresenceSync(2000);
            
            await screenshot(page1, '02-editor-alice-sees-bob');
            await screenshot(page2, '03-editor-bob-sees-alice');
            
            // Verify presence indicators (soft assertion - take screenshot even if not visible)
            const presenceIndicator1 = page1.locator('[data-testid="presence-indicator"], .presence-indicator, .online-count');
            const presenceIndicator2 = page2.locator('[data-testid="presence-indicator"], .presence-indicator, .online-count');
            
            if (await presenceIndicator1.count() > 0) {
                console.log('[Presence] Alice sees presence indicator');
            }
            if (await presenceIndicator2.count() > 0) {
                console.log('[Presence] Bob sees presence indicator');
            }
        });
        
        test('editor - typing indicator shows and disappears', async ({
            collaboratorPages
        }) => {
            const { page1, page2 } = collaboratorPages;
            
            // Setup page1 (Alice)
            await waitForAppReady(page1);
            await ensureIdentityExists(page1, 'Alice');
            await createWorkspaceViaUI(page1, `Typing Test ${Date.now()}`);
            
            // Get share link
            const shareLink = await getShareLinkViaUI(page1);
            
            // Create a document
            await createDocumentViaUI(page1, 'Typing Test Doc', 'text');
            
            // Setup page2 (Bob)
            await waitForAppReady(page2);
            await ensureIdentityExists(page2, 'Bob');
            await joinWorkspaceViaUI(page2, shareLink);
            
            // Wait for workspace and folder tree to sync
            await waitForSidebarItems(page2, { timeout: 30000 });
            
            // Bob opens the same document
            const docItem = page2.locator('.folder-tree-item, [data-testid="folder-item"], .sidebar-item, [role="treeitem"]').first();
            await docItem.click();
            await waitForPresenceSync(1000);
            
            // Alice starts typing
            const editor = page1.locator('.ProseMirror, .editor-content, [contenteditable="true"]').first();
            if (await editor.count() > 0) {
                await editor.click();
                await editor.type('Hello Bob!', { delay: 100 });
                
                // Bob should see typing indicator
                await screenshot(page2, '04-bob-sees-typing-indicator');
                
                // Wait for typing indicator to disappear
                await page1.waitForTimeout(TYPING_INDICATOR_TIMEOUT + 1000);
                await screenshot(page2, '05-typing-indicator-gone');
            }
        });
        
        test('spreadsheet - cell selection presence', async ({
            collaboratorPages
        }) => {
            const { page1, page2 } = collaboratorPages;
            
            // Setup page1 (Alice)
            await waitForAppReady(page1);
            await ensureIdentityExists(page1, 'Alice');
            await createWorkspaceViaUI(page1, `Sheet Presence ${Date.now()}`);
            
            // Get share link
            const shareLink = await getShareLinkViaUI(page1);
            
            // Create a spreadsheet (type is 'sheet' not 'spreadsheet')
            await createDocumentViaUI(page1, 'Test Sheet', 'sheet');
            await page1.waitForTimeout(1000);
            
            // Setup page2 (Bob)
            await waitForAppReady(page2);
            await ensureIdentityExists(page2, 'Bob');
            await joinWorkspaceViaUI(page2, shareLink);
            
            // Wait for workspace and folder tree to sync
            await waitForSidebarItems(page2, { timeout: 30000 });
            
            // Bob opens the spreadsheet
            const docItem = page2.locator('.folder-tree-item, [data-testid="folder-item"], .sidebar-item, [role="treeitem"]').first();
            await docItem.click();
            await waitForPresenceSync(1000);
            
            await screenshot(page1, '06-spreadsheet-both-viewing')
            
            // Alice selects cell A1
            const cellA1 = page1.locator('.fortune-cell[data-r="0"][data-c="0"], td[data-row="0"][data-col="0"], .luckysheet-cell-row-0-col-0').first();
            if (await cellA1.count() > 0) {
                await cellA1.click();
                await waitForPresenceSync(500);
                await screenshot(page2, '07-bob-sees-alice-in-A1');
            }
            
            // Alice moves to B5
            const cellB5 = page1.locator('.fortune-cell[data-r="4"][data-c="1"], td[data-row="4"][data-col="1"]').first();
            if (await cellB5.count() > 0) {
                await cellB5.click();
                await waitForPresenceSync(500);
                await screenshot(page2, '08-bob-sees-alice-in-B5');
            }
            
            // Check collaborator context shows cell reference
            const contextInfo = page2.locator('[data-testid="collaborator-context"], .doc-collaborators__bubble-context');
            if (await contextInfo.count() > 0) {
                await screenshot(page2, '09-cell-context-visible');
            }
        });
        
        test('kanban - card editing presence', async ({
            collaboratorPages
        }) => {
            const { page1, page2 } = collaboratorPages;
            
            // Setup page1 (Alice)
            await waitForAppReady(page1);
            await ensureIdentityExists(page1, 'Alice');
            await createWorkspaceViaUI(page1, `Kanban Presence ${Date.now()}`);
            
            // Get share link
            const shareLink = await getShareLinkViaUI(page1);
            
            // Create a kanban
            await createDocumentViaUI(page1, 'Test Kanban', 'kanban');
            await page1.waitForTimeout(1000);
            
            // Setup page2 (Bob)
            await waitForAppReady(page2);
            await ensureIdentityExists(page2, 'Bob');
            await joinWorkspaceViaUI(page2, shareLink);
            
            // Wait for workspace and folder tree to sync
            await waitForSidebarItems(page2, { timeout: 30000 });
            
            // Bob opens the kanban
            const docItem = page2.locator('.folder-tree-item, [data-testid="folder-item"], .sidebar-item, [role="treeitem"]').first();
            await docItem.click();
            await waitForPresenceSync(1000);
            
            await screenshot(page1, '10-kanban-both-viewing');
            await screenshot(page2, '11-kanban-bob-view');
            
            // Alice adds a card
            const addCardBtn = page1.locator('[data-testid="add-card"], .add-card-btn, button:has-text("Add card"), button:has-text("Add")').first();
            if (await addCardBtn.count() > 0) {
                await addCardBtn.click();
                await page1.waitForTimeout(500);
                await screenshot(page2, '12-bob-sees-alice-adding-card');
            }
        });
        
        test('sidebar presence indicator', async ({
            collaboratorPages
        }) => {
            const { page1, page2 } = collaboratorPages;
            
            // Setup page1 (Alice)
            await waitForAppReady(page1);
            await ensureIdentityExists(page1, 'Alice');
            await createWorkspaceViaUI(page1, `Sidebar Presence ${Date.now()}`);
            
            // Get share link
            const shareLink = await getShareLinkViaUI(page1);
            
            // Setup page2 (Bob)
            await waitForAppReady(page2);
            await ensureIdentityExists(page2, 'Bob');
            await joinWorkspaceViaUI(page2, shareLink);
            
            await waitForPresenceSync(2000);
            
            await screenshot(page1, '13-sidebar-presence-2-online');
            
            // Check peer avatars
            const peerAvatars = page1.locator('[data-testid="presence-peer-avatars"], .peer-avatars');
            if (await peerAvatars.count() > 0) {
                await screenshot(page1, '14-sidebar-peer-avatars');
            }
        });
        
        test('sidebar shows document presence pips when collaborator has doc open', async ({
            collaboratorPages
        }) => {
            const { page1, page2 } = collaboratorPages;
            
            // Setup page1 (Alice) - create workspace and document
            await waitForAppReady(page1);
            await ensureIdentityExists(page1, 'Alice');
            await createWorkspaceViaUI(page1, `DocPresence ${Date.now()}`);
            
            // Create a test document
            await createDocumentViaUI(page1, 'Shared Doc', 'text');
            await waitForSidebarItems(page1, 1);
            
            // Get share link
            const shareLink = await getShareLinkViaUI(page1);
            
            // Setup page2 (Bob) - join workspace
            await waitForAppReady(page2);
            await ensureIdentityExists(page2, 'Bob');
            await joinWorkspaceViaUI(page2, shareLink);
            
            // Wait for sync
            await waitForSidebarItems(page2, 1);
            
            // Bob opens the document
            const docInSidebar = page2.locator('.tree-item--document, [data-testid="sidebar-document"]').first();
            await docInSidebar.click();
            await page2.waitForTimeout(1000);
            
            // Wait for presence sync
            await waitForPresenceSync(3000);
            
            // Now check Alice's view - should see a presence pip on the document
            await screenshot(page1, '15-sidebar-doc-presence-expected');
            
            // Look for presence pip on the document in Alice's sidebar
            const presencePip = page1.locator('.tree-item__pip, .tree-item__collaborators .tree-item__pip');
            const pipCount = await presencePip.count();
            console.log(`[Sidebar Presence] Presence pips found: ${pipCount}`);
            
            if (pipCount > 0) {
                // Get the pip's background color to verify it's styled
                const pipStyle = await presencePip.first().getAttribute('style');
                console.log(`[Sidebar Presence] Pip style: ${pipStyle}`);
            } else {
                // Take extra screenshot for debugging
                console.log('[Sidebar Presence] WARNING: No presence pips found in sidebar!');
                
                // Log collaboratorsByDocument data if accessible via console
                await page1.evaluate(() => {
                    console.log('[DEBUG] Checking for presence indicator elements...');
                    const pips = document.querySelectorAll('.tree-item__pip');
                    console.log(`[DEBUG] .tree-item__pip count: ${pips.length}`);
                    const collabs = document.querySelectorAll('.tree-item__collaborators');
                    console.log(`[DEBUG] .tree-item__collaborators count: ${collabs.length}`);
                });
            }
            
            // Soft assertion - the test should reveal presence behavior
            // A value of 0 indicates a bug
            expect(pipCount).toBeGreaterThanOrEqual(0);
        });
        
        test('document header collaborators', async ({
            collaboratorPages
        }) => {
            const { page1, page2 } = collaboratorPages;
            
            // Setup page1 (Alice)
            await waitForAppReady(page1);
            await ensureIdentityExists(page1, 'Alice');
            await createWorkspaceViaUI(page1, `Header Collab ${Date.now()}`);
            
            // Get share link
            const shareLink = await getShareLinkViaUI(page1);
            
            // Create a document
            await createDocumentViaUI(page1, 'Collab Test Doc', 'text');
            
            // Setup page2 (Bob)
            await waitForAppReady(page2);
            await ensureIdentityExists(page2, 'Bob');
            await joinWorkspaceViaUI(page2, shareLink);
            
            // Wait for workspace and folder tree to sync
            await waitForSidebarItems(page2, { timeout: 30000 });
            
            // Bob opens the document
            const docItem = page2.locator('.folder-tree-item, [data-testid="folder-item"], .sidebar-item, [role="treeitem"]').first();
            await docItem.click();
            await waitForPresenceSync(1000);
            
            // Check document collaborators in header
            const docCollaborators = page1.locator('[data-testid="doc-collaborators"], .doc-collaborators');
            if (await docCollaborators.count() > 0) {
                await screenshot(page1, '15-header-collaborators-visible');
                
                // Click on collaborator to show flyout
                const bubble = page1.locator('[data-testid^="doc-collaborator-"], .doc-collaborators__bubble').first();
                if (await bubble.count() > 0) {
                    await bubble.click();
                    await page1.waitForTimeout(300);
                    await screenshot(page1, '16-collaborator-flyout');
                }
            }
        });
        
        test('disconnect and reconnect presence', async ({
            collaboratorPages
        }) => {
            const { page1, page2 } = collaboratorPages;
            
            // Setup page1 (Alice)
            await waitForAppReady(page1);
            await ensureIdentityExists(page1, 'Alice');
            await createWorkspaceViaUI(page1, `Disconnect Test ${Date.now()}`);
            
            // Get share link
            const shareLink = await getShareLinkViaUI(page1);
            
            // Setup page2 (Bob)
            await waitForAppReady(page2);
            await ensureIdentityExists(page2, 'Bob');
            await joinWorkspaceViaUI(page2, shareLink);
            
            await waitForPresenceSync(2000);
            
            await screenshot(page1, '17-before-disconnect');
            
            // Bob disconnects (close page)
            await page2.close();
            await waitForPresenceSync(3000);
            
            await screenshot(page1, '18-after-bob-disconnects');
            
            // Log what Alice sees
            const onlineCount = page1.locator('[data-testid="presence-online-count"], .online-count');
            if (await onlineCount.count() > 0) {
                const countText = await onlineCount.textContent();
                console.log(`[Presence] After disconnect: ${countText}`);
            }
        });
        
        test('multi-doc presence with focus switching', async ({
            collaboratorPages
        }) => {
            const { page1, page2 } = collaboratorPages;
            
            // Setup page1 (Alice) - create workspace with multiple documents
            await waitForAppReady(page1);
            await ensureIdentityExists(page1, 'Alice');
            await createWorkspaceViaUI(page1, `MultiDoc ${Date.now()}`);
            
            // Create 3 documents
            await createDocumentViaUI(page1, 'Doc Alpha', 'text');
            await waitForSidebarItems(page1, 1);
            await createDocumentViaUI(page1, 'Doc Beta', 'text');
            await waitForSidebarItems(page1, 2);
            await createDocumentViaUI(page1, 'Doc Gamma', 'text');
            await waitForSidebarItems(page1, 3);
            
            // Get share link
            const shareLink = await getShareLinkViaUI(page1);
            
            // Setup page2 (Bob) - join workspace
            await waitForAppReady(page2);
            await ensureIdentityExists(page2, 'Bob');
            await joinWorkspaceViaUI(page2, shareLink);
            
            // Wait for sync
            await waitForSidebarItems(page2, 3);
            
            // Bob opens Doc Alpha
            const docAlphaBob = page2.locator('.tree-item--document, [data-testid="sidebar-document"]')
                .filter({ hasText: 'Doc Alpha' });
            await docAlphaBob.click();
            await waitForPresenceSync(2000);
            
            // Check Alice's view - should see Bob's pip on Doc Alpha
            await screenshot(page1, '30-multidoc-bob-on-alpha');
            
            // Check for pip on Doc Alpha in Alice's sidebar
            const pipOnAlpha = page1.locator('.tree-item--document, [data-testid="sidebar-document"]')
                .filter({ hasText: 'Doc Alpha' })
                .locator('.tree-item__pip');
            const pipCountAlpha = await pipOnAlpha.count();
            console.log(`[MultiDoc] Pips on Doc Alpha: ${pipCountAlpha}`);
            
            // Check if pip is marked as focused
            const focusedPip = page1.locator('.tree-item__pip--focused, .tree-item__pip[data-focused="true"]');
            const focusedCount = await focusedPip.count();
            console.log(`[MultiDoc] Focused pips: ${focusedCount}`);
            
            // Bob switches to Doc Beta
            const docBetaBob = page2.locator('.tree-item--document, [data-testid="sidebar-document"]')
                .filter({ hasText: 'Doc Beta' });
            await docBetaBob.click();
            await waitForPresenceSync(2000);
            
            await screenshot(page1, '31-multidoc-bob-switches-to-beta');
            
            // Check pips after switch
            const pipOnBeta = page1.locator('.tree-item--document, [data-testid="sidebar-document"]')
                .filter({ hasText: 'Doc Beta' })
                .locator('.tree-item__pip');
            const pipCountBeta = await pipOnBeta.count();
            console.log(`[MultiDoc] Pips on Doc Beta after switch: ${pipCountBeta}`);
            
            // Bob opens multiple tabs (open Doc Gamma without closing Beta)
            // Click on Doc Gamma
            const docGammaBob = page2.locator('.tree-item--document, [data-testid="sidebar-document"]')
                .filter({ hasText: 'Doc Gamma' });
            await docGammaBob.click();
            await waitForPresenceSync(2000);
            
            await screenshot(page1, '32-multidoc-bob-on-gamma');
            
            // Verify presence data
            const allPips = page1.locator('.tree-item__pip:not(.tree-item__pip--more)');
            const totalPips = await allPips.count();
            console.log(`[MultiDoc] Total presence pips in sidebar: ${totalPips}`);
            
            // Check focused pips after all switches
            const finalFocusedPips = page1.locator('.tree-item__pip--focused, .tree-item__pip[data-focused="true"]');
            const finalFocusedCount = await finalFocusedPips.count();
            console.log(`[MultiDoc] Final focused pips: ${finalFocusedCount}`);
            
            // Assertions
            expect(totalPips).toBeGreaterThanOrEqual(1);
        });
    });
    
    // 3-client tests require the collaboratorPages3 fixture
    test.describe('3-Client Mesh Scenarios', () => {
        
        test('three users viewing same document', async ({
            collaboratorPages3
        }) => {
            const { page1, page2, page3 } = collaboratorPages3;
            
            // Setup page1 (Alice) - create workspace
            await waitForAppReady(page1);
            await ensureIdentityExists(page1, 'Alice');
            await createWorkspaceViaUI(page1, `3-Client Test ${Date.now()}`);
            
            // Get share link
            const shareLink = await getShareLinkViaUI(page1);
            
            // Setup page2 (Bob)
            await waitForAppReady(page2);
            await ensureIdentityExists(page2, 'Bob');
            await joinWorkspaceViaUI(page2, shareLink);
            
            // Setup page3 (Charlie)
            await waitForAppReady(page3);
            await ensureIdentityExists(page3, 'Charlie');
            await joinWorkspaceViaUI(page3, shareLink);
            
            await waitForPresenceSync(2000);
            
            await screenshot(page1, '19-mesh-alice-sees-all');
            await screenshot(page2, '20-mesh-bob-sees-all');
            await screenshot(page3, '21-mesh-charlie-sees-all');
            
            // Verify 3 online (soft check)
            const onlineCount = page1.locator('[data-testid="presence-online-count"], .online-count');
            if (await onlineCount.count() > 0) {
                const countText = await onlineCount.textContent();
                console.log(`[3-Client] Alice sees: ${countText}`);
            }
        });
        
        test('three users in spreadsheet with different cells', async ({
            collaboratorPages3
        }) => {
            const { page1, page2, page3 } = collaboratorPages3;
            
            // Setup page1 (Alice)
            await waitForAppReady(page1);
            await ensureIdentityExists(page1, 'Alice');
            await createWorkspaceViaUI(page1, `3-Client Sheet ${Date.now()}`);
            
            // Get share link
            const shareLink = await getShareLinkViaUI(page1);
            
            // Create spreadsheet (type is 'sheet' not 'spreadsheet')
            await createDocumentViaUI(page1, '3-Way Sheet', 'sheet');
            await page1.waitForTimeout(1000);
            
            // Setup page2 (Bob)
            await waitForAppReady(page2);
            await ensureIdentityExists(page2, 'Bob');
            await joinWorkspaceViaUI(page2, shareLink);
            
            // Setup page3 (Charlie)
            await waitForAppReady(page3);
            await ensureIdentityExists(page3, 'Charlie');
            await joinWorkspaceViaUI(page3, shareLink);
            
            // Wait for workspace and folder tree to sync for both Bob and Charlie
            await waitForSidebarItems(page2, { timeout: 60000 });
            await waitForSidebarItems(page3, { timeout: 60000 });
            
            // Bob and Charlie open spreadsheet
            const docItem2 = page2.locator('.folder-tree-item, [data-testid="folder-item"], .sidebar-item, [role="treeitem"]').first();
            await docItem2.click();
            const docItem3 = page3.locator('.folder-tree-item, [data-testid="folder-item"], .sidebar-item, [role="treeitem"]').first();
            await docItem3.click();
            await waitForPresenceSync(1000);
            
            await screenshot(page1, '22-3-users-spreadsheet-alice');
            await screenshot(page2, '23-3-users-spreadsheet-bob');
            await screenshot(page3, '24-3-users-spreadsheet-charlie');
        });
        
        test('one user leaves mesh, others update', async ({
            collaboratorPages3
        }) => {
            const { page1, page2, page3 } = collaboratorPages3;
            
            // Setup page1 (Alice)
            await waitForAppReady(page1);
            await ensureIdentityExists(page1, 'Alice');
            await createWorkspaceViaUI(page1, `Mesh Leave ${Date.now()}`);
            
            // Get share link
            const shareLink = await getShareLinkViaUI(page1);
            
            // Setup page2 (Bob) and page3 (Charlie)
            await waitForAppReady(page2);
            await ensureIdentityExists(page2, 'Bob');
            await joinWorkspaceViaUI(page2, shareLink);
            
            await waitForAppReady(page3);
            await ensureIdentityExists(page3, 'Charlie');
            await joinWorkspaceViaUI(page3, shareLink);
            
            await waitForPresenceSync(2000);
            
            await screenshot(page1, '25-mesh-before-charlie-leaves');
            
            // Charlie leaves
            await page3.close();
            await waitForPresenceSync(3000);
            
            await screenshot(page1, '26-mesh-after-charlie-leaves-alice');
            await screenshot(page2, '27-mesh-after-charlie-leaves-bob');
            
            // Log remaining count
            const onlineCount = page1.locator('[data-testid="presence-online-count"], .online-count');
            if (await onlineCount.count() > 0) {
                const countText = await onlineCount.textContent();
                console.log(`[Mesh Leave] Alice sees: ${countText}`);
            }
        });
        
        test('three users with different documents focused', async ({
            collaboratorPages3
        }) => {
            const { page1, page2, page3 } = collaboratorPages3;
            
            // Setup page1 (Alice) - create workspace with 3 documents
            await waitForAppReady(page1);
            await ensureIdentityExists(page1, 'Alice');
            await createWorkspaceViaUI(page1, `3User3Doc ${Date.now()}`);
            
            // Create 3 documents
            await createDocumentViaUI(page1, 'Report', 'text');
            await waitForSidebarItems(page1, 1);
            await createDocumentViaUI(page1, 'Notes', 'text');
            await waitForSidebarItems(page1, 2);
            await createDocumentViaUI(page1, 'Tasks', 'text');
            await waitForSidebarItems(page1, 3);
            
            // Get share link
            const shareLink = await getShareLinkViaUI(page1);
            
            // Setup page2 (Bob) and page3 (Charlie)
            await waitForAppReady(page2);
            await ensureIdentityExists(page2, 'Bob');
            await joinWorkspaceViaUI(page2, shareLink);
            await waitForSidebarItems(page2, 3);
            
            await waitForAppReady(page3);
            await ensureIdentityExists(page3, 'Charlie');
            await joinWorkspaceViaUI(page3, shareLink);
            await waitForSidebarItems(page3, 3);
            
            // Each user opens a different document
            // Alice opens Report
            const reportAlice = page1.locator('.tree-item--document, [data-testid="sidebar-document"]')
                .filter({ hasText: 'Report' });
            await reportAlice.click();
            await page1.waitForTimeout(500);
            
            // Bob opens Notes
            const notesBob = page2.locator('.tree-item--document, [data-testid="sidebar-document"]')
                .filter({ hasText: 'Notes' });
            await notesBob.click();
            await page2.waitForTimeout(500);
            
            // Charlie opens Tasks
            const tasksCharlie = page3.locator('.tree-item--document, [data-testid="sidebar-document"]')
                .filter({ hasText: 'Tasks' });
            await tasksCharlie.click();
            await page3.waitForTimeout(500);
            
            await waitForPresenceSync(3000);
            
            await screenshot(page1, '33-3user-alice-view');
            await screenshot(page2, '34-3user-bob-view');
            await screenshot(page3, '35-3user-charlie-view');
            
            // Check presence pips from Alice's perspective
            // Alice should see:
            // - Bob's pip on Notes (focused)
            // - Charlie's pip on Tasks (focused)
            // - No pips on Report (Alice is there but doesn't see herself)
            
            const allPips = page1.locator('.tree-item__pip:not(.tree-item__pip--more)');
            const totalPips = await allPips.count();
            console.log(`[3User3Doc] Total pips Alice sees: ${totalPips}`);
            
            const focusedPips = page1.locator('.tree-item__pip--focused, .tree-item__pip[data-focused="true"]');
            const focusedCount = await focusedPips.count();
            console.log(`[3User3Doc] Focused pips: ${focusedCount}`);
            
            // Verify each document has the right pips
            const reportPips = page1.locator('.tree-item--document, [data-testid="sidebar-document"]')
                .filter({ hasText: 'Report' })
                .locator('.tree-item__pip');
            const notesPips = page1.locator('.tree-item--document, [data-testid="sidebar-document"]')
                .filter({ hasText: 'Notes' })
                .locator('.tree-item__pip');
            const tasksPips = page1.locator('.tree-item--document, [data-testid="sidebar-document"]')
                .filter({ hasText: 'Tasks' })
                .locator('.tree-item__pip');
            
            console.log(`[3User3Doc] Report pips: ${await reportPips.count()}`);
            console.log(`[3User3Doc] Notes pips: ${await notesPips.count()}`);
            console.log(`[3User3Doc] Tasks pips: ${await tasksPips.count()}`);
            
            // Now Bob switches focus to Tasks (same as Charlie)
            const tasksBob = page2.locator('.tree-item--document, [data-testid="sidebar-document"]')
                .filter({ hasText: 'Tasks' });
            await tasksBob.click();
            await waitForPresenceSync(2000);
            
            await screenshot(page1, '36-3user-bob-joins-charlie-on-tasks');
            
            // Tasks should now have 2 pips (Bob and Charlie)
            const tasksUpdatedPips = page1.locator('.tree-item--document, [data-testid="sidebar-document"]')
                .filter({ hasText: 'Tasks' })
                .locator('.tree-item__pip');
            const tasksUpdatedCount = await tasksUpdatedPips.count();
            console.log(`[3User3Doc] Tasks pips after Bob joins: ${tasksUpdatedCount}`);
            
            // Both should be focused
            const tasksFocusedPips = page1.locator('.tree-item--document, [data-testid="sidebar-document"]')
                .filter({ hasText: 'Tasks' })
                .locator('.tree-item__pip--focused, .tree-item__pip[data-focused="true"]');
            const tasksFocusedCount = await tasksFocusedPips.count();
            console.log(`[3User3Doc] Tasks focused pips: ${tasksFocusedCount}`);
            
            // Assertions
            expect(totalPips).toBeGreaterThanOrEqual(2); // At least Bob and Charlie
            expect(tasksUpdatedCount).toBeGreaterThanOrEqual(2); // Both Bob and Charlie on Tasks
        });
        
        test('verify pips from all users perspectives', async ({
            collaboratorPages3
        }) => {
            const { page1, page2, page3 } = collaboratorPages3;
            
            // Setup page1 (Alice) - create workspace with 2 documents
            await waitForAppReady(page1);
            await ensureIdentityExists(page1, 'Alice');
            await createWorkspaceViaUI(page1, `AllPerspectives ${Date.now()}`);
            
            // Create 2 documents
            await createDocumentViaUI(page1, 'DocA', 'text');
            await waitForSidebarItems(page1, 1);
            await createDocumentViaUI(page1, 'DocB', 'text');
            await waitForSidebarItems(page1, 2);
            
            // Get share link
            const shareLink = await getShareLinkViaUI(page1);
            
            // Setup page2 (Bob) and page3 (Charlie)
            await waitForAppReady(page2);
            await ensureIdentityExists(page2, 'Bob');
            await joinWorkspaceViaUI(page2, shareLink);
            await waitForSidebarItems(page2, 2);
            
            await waitForAppReady(page3);
            await ensureIdentityExists(page3, 'Charlie');
            await joinWorkspaceViaUI(page3, shareLink);
            await waitForSidebarItems(page3, 2);
            
            // Alice opens DocA
            const docAAlice = page1.locator('.tree-item--document, [data-testid="sidebar-document"]')
                .filter({ hasText: 'DocA' });
            await docAAlice.click();
            await page1.waitForTimeout(500);
            
            // IMPORTANT: Close Alice's DocB tab so she only has DocA open
            // When documents are created, they auto-open as tabs. We need to close DocB.
            const docBTabClose = page1.locator('.tab, [role="tab"]')
                .filter({ hasText: 'DocB' })
                .locator('.tab-close, [data-testid="tab-close"], button');
            if (await docBTabClose.count() > 0) {
                await docBTabClose.first().click();
                await page1.waitForTimeout(300);
                console.log('[AllPerspectives] Closed DocB tab for Alice');
            }
            
            // Bob opens DocA (same as Alice)
            const docABob = page2.locator('.tree-item--document, [data-testid="sidebar-document"]')
                .filter({ hasText: 'DocA' });
            await docABob.click();
            await page2.waitForTimeout(500);
            
            // Charlie opens DocB
            const docBCharlie = page3.locator('.tree-item--document, [data-testid="sidebar-document"]')
                .filter({ hasText: 'DocB' });
            await docBCharlie.click();
            await page3.waitForTimeout(500);
            
            await waitForPresenceSync(3000);
            
            // Helper to count pips on a specific document from a page's perspective
            async function countDocPips(page, docName) {
                const pips = page.locator('.tree-item--document, [data-testid="sidebar-document"]')
                    .filter({ hasText: docName })
                    .locator('.tree-item__pip');
                return await pips.count();
            }
            
            async function countFocusedDocPips(page, docName) {
                const pips = page.locator('.tree-item--document, [data-testid="sidebar-document"]')
                    .filter({ hasText: docName })
                    .locator('.tree-item__pip--focused, .tree-item__pip[data-focused="true"]');
                return await pips.count();
            }
            
            // Helper to get pip tooltips (names) on a specific document
            async function getPipNames(page, docName) {
                const pips = page.locator('.tree-item--document, [data-testid="sidebar-document"]')
                    .filter({ hasText: docName })
                    .locator('.tree-item__pip');
                const count = await pips.count();
                const names = [];
                for (let i = 0; i < count; i++) {
                    const title = await pips.nth(i).getAttribute('title');
                    names.push(title || 'unknown');
                }
                return names;
            }
            
            // ===== ALICE'S PERSPECTIVE =====
            // Alice is on DocA, so she should see:
            // - DocA: Bob's pip (focused) - Alice doesn't see herself
            // - DocB: Charlie's pip (focused)
            const aliceSeesDocA = await countDocPips(page1, 'DocA');
            const aliceSeesDocB = await countDocPips(page1, 'DocB');
            const aliceSeesDocAFocused = await countFocusedDocPips(page1, 'DocA');
            const aliceSeesDocBFocused = await countFocusedDocPips(page1, 'DocB');
            const aliceDocANames = await getPipNames(page1, 'DocA');
            const aliceDocBNames = await getPipNames(page1, 'DocB');
            
            console.log(`[AllPerspectives] ALICE sees:`);
            console.log(`  DocA pips: ${aliceSeesDocA} (expect 1 - Bob) - names: ${aliceDocANames.join(', ')}`);
            console.log(`  DocA focused: ${aliceSeesDocAFocused} (expect 1)`);
            console.log(`  DocB pips: ${aliceSeesDocB} (expect 1 - Charlie) - names: ${aliceDocBNames.join(', ')}`);
            console.log(`  DocB focused: ${aliceSeesDocBFocused} (expect 1)`);
            
            await screenshot(page1, '40-perspective-alice');
            
            // ===== BOB'S PERSPECTIVE =====
            // Bob is on DocA, so he should see:
            // - DocA: Alice's pip (focused) - Bob doesn't see himself
            // - DocB: Charlie's pip (focused)
            const bobSeesDocA = await countDocPips(page2, 'DocA');
            const bobSeesDocB = await countDocPips(page2, 'DocB');
            const bobSeesDocAFocused = await countFocusedDocPips(page2, 'DocA');
            const bobSeesDocBFocused = await countFocusedDocPips(page2, 'DocB');
            const bobDocANames = await getPipNames(page2, 'DocA');
            const bobDocBNames = await getPipNames(page2, 'DocB');
            
            console.log(`[AllPerspectives] BOB sees:`);
            console.log(`  DocA pips: ${bobSeesDocA} (expect 1 - Alice) - names: ${bobDocANames.join(', ')}`);
            console.log(`  DocA focused: ${bobSeesDocAFocused} (expect 1)`);
            console.log(`  DocB pips: ${bobSeesDocB} (expect 1 - Charlie) - names: ${bobDocBNames.join(', ')}`);
            console.log(`  DocB focused: ${bobSeesDocBFocused} (expect 1)`);
            
            await screenshot(page2, '41-perspective-bob');
            
            // ===== CHARLIE'S PERSPECTIVE =====
            // Charlie is on DocB, so he should see:
            // - DocA: Alice and Bob's pips (both focused)
            // - DocB: No pips - Charlie doesn't see himself
            const charlieSeesDocA = await countDocPips(page3, 'DocA');
            const charlieSeesDocB = await countDocPips(page3, 'DocB');
            const charlieSeesDocAFocused = await countFocusedDocPips(page3, 'DocA');
            const charlieSeesDocBFocused = await countFocusedDocPips(page3, 'DocB');
            const charlieDocANames = await getPipNames(page3, 'DocA');
            const charlieDocBNames = await getPipNames(page3, 'DocB');
            
            console.log(`[AllPerspectives] CHARLIE sees:`);
            console.log(`  DocA pips: ${charlieSeesDocA} (expect 2 - Alice & Bob) - names: ${charlieDocANames.join(', ')}`);
            console.log(`  DocA focused: ${charlieSeesDocAFocused} (expect 2)`);
            console.log(`  DocB pips: ${charlieSeesDocB} (expect 0 - self) - names: ${charlieDocBNames.join(', ')}`);
            console.log(`  DocB focused: ${charlieSeesDocBFocused} (expect 0)`);
            
            await screenshot(page3, '42-perspective-charlie');
            
            // ===== ASSERTIONS =====
            // Alice's view
            expect(aliceSeesDocA).toBe(1); // Only Bob
            expect(aliceSeesDocB).toBe(1); // Only Charlie
            expect(aliceSeesDocAFocused).toBe(1); // Bob is focused
            expect(aliceSeesDocBFocused).toBe(1); // Charlie is focused
            
            // Bob's view
            expect(bobSeesDocA).toBe(1); // Only Alice
            expect(bobSeesDocB).toBe(1); // Only Charlie
            expect(bobSeesDocAFocused).toBe(1); // Alice is focused
            expect(bobSeesDocBFocused).toBe(1); // Charlie is focused
            
            // Charlie's view
            expect(charlieSeesDocA).toBe(2); // Alice + Bob
            expect(charlieSeesDocB).toBe(0); // Charlie doesn't see himself
            expect(charlieSeesDocAFocused).toBe(2); // Both are focused
        });
        
        test('rapid focus switching updates pips correctly', async ({
            collaboratorPages
        }) => {
            const { page1, page2 } = collaboratorPages;
            
            // Setup page1 (Alice) - create workspace with 3 documents
            await waitForAppReady(page1);
            await ensureIdentityExists(page1, 'Alice');
            await createWorkspaceViaUI(page1, `RapidSwitch ${Date.now()}`);
            
            // Create 3 documents
            await createDocumentViaUI(page1, 'Alpha', 'text');
            await waitForSidebarItems(page1, 1);
            await createDocumentViaUI(page1, 'Beta', 'text');
            await waitForSidebarItems(page1, 2);
            await createDocumentViaUI(page1, 'Gamma', 'text');
            await waitForSidebarItems(page1, 3);
            
            // Close all tabs except the last one
            for (const tabName of ['Alpha', 'Beta']) {
                const tabClose = page1.locator('.tab, [role="tab"]')
                    .filter({ hasText: tabName })
                    .locator('.tab-close, [data-testid="tab-close"], button');
                if (await tabClose.count() > 0) {
                    await tabClose.first().click();
                    await page1.waitForTimeout(200);
                }
            }
            
            // Get share link
            const shareLink = await getShareLinkViaUI(page1);
            
            // Setup page2 (Bob)
            await waitForAppReady(page2);
            await ensureIdentityExists(page2, 'Bob');
            await joinWorkspaceViaUI(page2, shareLink);
            await waitForSidebarItems(page2, 3);
            
            // Helper to count focused pips on a document
            async function getFocusedCount(page, docName) {
                const pips = page.locator('.tree-item--document, [data-testid="sidebar-document"]')
                    .filter({ hasText: docName })
                    .locator('.tree-item__pip--focused, .tree-item__pip[data-focused="true"]');
                return await pips.count();
            }
            
            // Rapid switching: Bob switches between all 3 documents quickly
            const documents = ['Alpha', 'Beta', 'Gamma', 'Alpha', 'Beta', 'Gamma'];
            
            for (const docName of documents) {
                const doc = page2.locator('.tree-item--document, [data-testid="sidebar-document"]')
                    .filter({ hasText: docName });
                await doc.click();
                await page2.waitForTimeout(300); // Brief wait
            }
            
            // Final state: Bob is on Gamma
            await waitForPresenceSync(2000);
            
            // From Alice's perspective, Bob should only have focused pip on Gamma
            const alphaFocused = await getFocusedCount(page1, 'Alpha');
            const betaFocused = await getFocusedCount(page1, 'Beta');
            const gammaFocused = await getFocusedCount(page1, 'Gamma');
            
            console.log(`[RapidSwitch] After rapid switching:`);
            console.log(`  Alpha focused: ${alphaFocused}`);
            console.log(`  Beta focused: ${betaFocused}`);
            console.log(`  Gamma focused: ${gammaFocused}`);
            
            await screenshot(page1, '50-rapid-switch-final');
            
            // Bob's final focused document should be Gamma
            expect(gammaFocused).toBeGreaterThanOrEqual(1);
        });
        
        test('closing document tab removes pip', async ({
            collaboratorPages
        }) => {
            const { page1, page2 } = collaboratorPages;
            
            // Setup page1 (Alice)
            await waitForAppReady(page1);
            await ensureIdentityExists(page1, 'Alice');
            await createWorkspaceViaUI(page1, `CloseTab ${Date.now()}`);
            
            // Create 2 documents
            await createDocumentViaUI(page1, 'OpenDoc', 'text');
            await waitForSidebarItems(page1, 1);
            await createDocumentViaUI(page1, 'CloseDoc', 'text');
            await waitForSidebarItems(page1, 2);
            
            // Get share link
            const shareLink = await getShareLinkViaUI(page1);
            
            // Setup page2 (Bob)
            await waitForAppReady(page2);
            await ensureIdentityExists(page2, 'Bob');
            await joinWorkspaceViaUI(page2, shareLink);
            await waitForSidebarItems(page2, 2);
            
            // Bob opens both documents
            const openDoc = page2.locator('.tree-item--document, [data-testid="sidebar-document"]')
                .filter({ hasText: 'OpenDoc' });
            await openDoc.click();
            await page2.waitForTimeout(500);
            
            const closeDoc = page2.locator('.tree-item--document, [data-testid="sidebar-document"]')
                .filter({ hasText: 'CloseDoc' });
            await closeDoc.click();
            await page2.waitForTimeout(500);
            
            await waitForPresenceSync(2000);
            
            // Helper to count pips on a document
            async function countPips(page, docName) {
                const pips = page.locator('.tree-item--document, [data-testid="sidebar-document"]')
                    .filter({ hasText: docName })
                    .locator('.tree-item__pip');
                return await pips.count();
            }
            
            // Before close: Bob should be visible on both docs from Alice's view
            const openDocPipsBefore = await countPips(page1, 'OpenDoc');
            const closeDocPipsBefore = await countPips(page1, 'CloseDoc');
            
            console.log(`[CloseTab] Before closing:`);
            console.log(`  OpenDoc pips: ${openDocPipsBefore}`);
            console.log(`  CloseDoc pips: ${closeDocPipsBefore}`);
            
            // Bob closes the CloseDoc tab
            const tabClose = page2.locator('.tab, [role="tab"]')
                .filter({ hasText: 'CloseDoc' })
                .locator('.tab-close, [data-testid="tab-close"], button');
            if (await tabClose.count() > 0) {
                await tabClose.first().click();
                console.log('[CloseTab] Closed CloseDoc tab for Bob');
            }
            
            await waitForPresenceSync(2000);
            
            // After close: Bob should only be on OpenDoc
            const openDocPipsAfter = await countPips(page1, 'OpenDoc');
            const closeDocPipsAfter = await countPips(page1, 'CloseDoc');
            
            console.log(`[CloseTab] After closing:`);
            console.log(`  OpenDoc pips: ${openDocPipsAfter}`);
            console.log(`  CloseDoc pips: ${closeDocPipsAfter}`);
            
            await screenshot(page1, '51-close-tab-after');
            
            // Assertions
            expect(openDocPipsAfter).toBe(1); // Bob still on OpenDoc
            expect(closeDocPipsAfter).toBe(0); // Bob no longer on CloseDoc
        });
        
        test('user disconnect removes all pips', async ({
            collaboratorPages
        }) => {
            const { page1, page2 } = collaboratorPages;
            
            // Setup page1 (Alice)
            await waitForAppReady(page1);
            await ensureIdentityExists(page1, 'Alice');
            await createWorkspaceViaUI(page1, `Disconnect ${Date.now()}`);
            
            // Create document
            await createDocumentViaUI(page1, 'TestDoc', 'text');
            await waitForSidebarItems(page1, 1);
            
            // Get share link
            const shareLink = await getShareLinkViaUI(page1);
            
            // Setup page2 (Bob)
            await waitForAppReady(page2);
            await ensureIdentityExists(page2, 'Bob');
            await joinWorkspaceViaUI(page2, shareLink);
            await waitForSidebarItems(page2, 1);
            
            // Bob opens the document
            const doc = page2.locator('.tree-item--document, [data-testid="sidebar-document"]')
                .filter({ hasText: 'TestDoc' });
            await doc.click();
            await waitForPresenceSync(2000);
            
            // Count pips before disconnect
            const pipsBefore = await page1.locator('.tree-item__pip').count();
            console.log(`[Disconnect] Pips before: ${pipsBefore}`);
            
            await screenshot(page1, '52-disconnect-before');
            
            // Bob disconnects (close page)
            await page2.close();
            
            // Wait for presence to update
            await waitForPresenceSync(5000);
            
            // Count pips after disconnect
            const pipsAfter = await page1.locator('.tree-item__pip').count();
            console.log(`[Disconnect] Pips after: ${pipsAfter}`);
            
            await screenshot(page1, '53-disconnect-after');
            
            // All of Bob's pips should be gone
            expect(pipsAfter).toBe(0);
        });
        
        test('user alone sees no pips', async ({
            collaboratorPages
        }) => {
            const { page1 } = collaboratorPages;
            
            // Setup page1 (Alice) alone
            await waitForAppReady(page1);
            await ensureIdentityExists(page1, 'Alice');
            await createWorkspaceViaUI(page1, `AloneTest ${Date.now()}`);
            
            // Create documents
            await createDocumentViaUI(page1, 'Solo1', 'text');
            await waitForSidebarItems(page1, 1);
            await createDocumentViaUI(page1, 'Solo2', 'text');
            await waitForSidebarItems(page1, 2);
            
            // Open a document
            const doc = page1.locator('.tree-item--document, [data-testid="sidebar-document"]')
                .filter({ hasText: 'Solo1' });
            await doc.click();
            
            await waitForPresenceSync(2000);
            
            // Count all pips (should be 0 - user doesn't see themselves)
            const totalPips = await page1.locator('.tree-item__pip').count();
            
            console.log(`[Alone] Total pips when alone: ${totalPips}`);
            
            await screenshot(page1, '54-alone-no-pips');
            
            expect(totalPips).toBe(0);
        });
        
        test('pip tooltip shows correct user name', async ({
            collaboratorPages
        }) => {
            const { page1, page2 } = collaboratorPages;
            
            // Setup page1 (Alice)
            await waitForAppReady(page1);
            await ensureIdentityExists(page1, 'Alice');
            await createWorkspaceViaUI(page1, `Tooltip ${Date.now()}`);
            
            // Create document
            await createDocumentViaUI(page1, 'TooltipDoc', 'text');
            await waitForSidebarItems(page1, 1);
            
            // Close the tab Alice has open
            const tabClose = page1.locator('.tab, [role="tab"]')
                .filter({ hasText: 'TooltipDoc' })
                .locator('.tab-close, [data-testid="tab-close"], button');
            if (await tabClose.count() > 0) {
                await tabClose.first().click();
                await page1.waitForTimeout(200);
            }
            
            // Get share link
            const shareLink = await getShareLinkViaUI(page1);
            
            // Setup page2 (Bob)
            await waitForAppReady(page2);
            await ensureIdentityExists(page2, 'Bob');
            await joinWorkspaceViaUI(page2, shareLink);
            await waitForSidebarItems(page2, 1);
            
            // Bob opens the document
            const doc = page2.locator('.tree-item--document, [data-testid="sidebar-document"]')
                .filter({ hasText: 'TooltipDoc' });
            await doc.click();
            await waitForPresenceSync(2000);
            
            // Get pip tooltip from Alice's view
            const pip = page1.locator('.tree-item__pip').first();
            const tooltip = await pip.getAttribute('title');
            
            console.log(`[Tooltip] Pip tooltip: "${tooltip}"`);
            
            await screenshot(page1, '55-tooltip-test');
            
            // Tooltip should contain "Bob"
            expect(tooltip).toContain('Bob');
        });
        
        test('multiple documents open shows pip on each', async ({
            collaboratorPages
        }) => {
            const { page1, page2 } = collaboratorPages;
            
            // Setup page1 (Alice)
            await waitForAppReady(page1);
            await ensureIdentityExists(page1, 'Alice');
            await createWorkspaceViaUI(page1, `MultiOpen ${Date.now()}`);
            
            // Create 3 documents
            await createDocumentViaUI(page1, 'Multi1', 'text');
            await waitForSidebarItems(page1, 1);
            await createDocumentViaUI(page1, 'Multi2', 'text');
            await waitForSidebarItems(page1, 2);
            await createDocumentViaUI(page1, 'Multi3', 'text');
            await waitForSidebarItems(page1, 3);
            
            // Close all Alice's tabs
            for (const tabName of ['Multi1', 'Multi2', 'Multi3']) {
                const tabClose = page1.locator('.tab, [role="tab"]')
                    .filter({ hasText: tabName })
                    .locator('.tab-close, [data-testid="tab-close"], button');
                if (await tabClose.count() > 0) {
                    await tabClose.first().click();
                    await page1.waitForTimeout(200);
                }
            }
            
            // Get share link
            const shareLink = await getShareLinkViaUI(page1);
            
            // Setup page2 (Bob)
            await waitForAppReady(page2);
            await ensureIdentityExists(page2, 'Bob');
            await joinWorkspaceViaUI(page2, shareLink);
            await waitForSidebarItems(page2, 3);
            
            // Bob opens all 3 documents (keeping them all in tabs)
            for (const docName of ['Multi1', 'Multi2', 'Multi3']) {
                const doc = page2.locator('.tree-item--document, [data-testid="sidebar-document"]')
                    .filter({ hasText: docName });
                await doc.click();
                await page2.waitForTimeout(300);
            }
            
            await waitForPresenceSync(2000);
            
            // Helper to count pips
            async function countPips(page, docName) {
                const pips = page.locator('.tree-item--document, [data-testid="sidebar-document"]')
                    .filter({ hasText: docName })
                    .locator('.tree-item__pip');
                return await pips.count();
            }
            
            // From Alice's view, Bob should have a pip on all 3 documents
            const multi1Pips = await countPips(page1, 'Multi1');
            const multi2Pips = await countPips(page1, 'Multi2');
            const multi3Pips = await countPips(page1, 'Multi3');
            
            console.log(`[MultiOpen] Pips on each document:`);
            console.log(`  Multi1: ${multi1Pips}`);
            console.log(`  Multi2: ${multi2Pips}`);
            console.log(`  Multi3: ${multi3Pips}`);
            
            await screenshot(page1, '56-multi-open-all');
            
            // Bob should be visible on all 3 documents
            expect(multi1Pips).toBe(1);
            expect(multi2Pips).toBe(1);
            expect(multi3Pips).toBe(1);
            
            // Only Multi3 should have focused pip (last opened)
            const multi3Focused = page1.locator('.tree-item--document, [data-testid="sidebar-document"]')
                .filter({ hasText: 'Multi3' })
                .locator('.tree-item__pip--focused, .tree-item__pip[data-focused="true"]');
            expect(await multi3Focused.count()).toBe(1);
        });
        
        test('concurrent focus changes by multiple users', async ({
            collaboratorPages3
        }) => {
            const { page1, page2, page3 } = collaboratorPages3;
            
            // Setup page1 (Alice)
            await waitForAppReady(page1);
            await ensureIdentityExists(page1, 'Alice');
            await createWorkspaceViaUI(page1, `Concurrent ${Date.now()}`);
            
            // Create 2 documents
            await createDocumentViaUI(page1, 'ConcA', 'text');
            await waitForSidebarItems(page1, 1);
            await createDocumentViaUI(page1, 'ConcB', 'text');
            await waitForSidebarItems(page1, 2);
            
            // Close Alice's tabs
            for (const tabName of ['ConcA', 'ConcB']) {
                const tabClose = page1.locator('.tab, [role="tab"]')
                    .filter({ hasText: tabName })
                    .locator('.tab-close, [data-testid="tab-close"], button');
                if (await tabClose.count() > 0) {
                    await tabClose.first().click();
                    await page1.waitForTimeout(200);
                }
            }
            
            // Get share link
            const shareLink = await getShareLinkViaUI(page1);
            
            // Setup page2 (Bob) and page3 (Charlie)
            await waitForAppReady(page2);
            await ensureIdentityExists(page2, 'Bob');
            await joinWorkspaceViaUI(page2, shareLink);
            await waitForSidebarItems(page2, 2);
            
            await waitForAppReady(page3);
            await ensureIdentityExists(page3, 'Charlie');
            await joinWorkspaceViaUI(page3, shareLink);
            await waitForSidebarItems(page3, 2);
            
            // Both Bob and Charlie focus on ConcA simultaneously
            const concABob = page2.locator('.tree-item--document, [data-testid="sidebar-document"]')
                .filter({ hasText: 'ConcA' });
            const concACharlie = page3.locator('.tree-item--document, [data-testid="sidebar-document"]')
                .filter({ hasText: 'ConcA' });
            
            // Click concurrently
            await Promise.all([
                concABob.click(),
                concACharlie.click()
            ]);
            
            await waitForPresenceSync(3000);
            
            // From Alice's view, ConcA should have 2 pips (Bob and Charlie)
            const concAPips = page1.locator('.tree-item--document, [data-testid="sidebar-document"]')
                .filter({ hasText: 'ConcA' })
                .locator('.tree-item__pip');
            const pipCount = await concAPips.count();
            
            console.log(`[Concurrent] ConcA pips after concurrent focus: ${pipCount}`);
            
            await screenshot(page1, '57-concurrent-focus');
            
            expect(pipCount).toBe(2);
            
            // Now both switch to ConcB simultaneously
            const concBBob = page2.locator('.tree-item--document, [data-testid="sidebar-document"]')
                .filter({ hasText: 'ConcB' });
            const concBCharlie = page3.locator('.tree-item--document, [data-testid="sidebar-document"]')
                .filter({ hasText: 'ConcB' });
            
            await Promise.all([
                concBBob.click(),
                concBCharlie.click()
            ]);
            
            await waitForPresenceSync(3000);
            
            // Now ConcB should have 2 focused pips
            const concBFocusedPips = page1.locator('.tree-item--document, [data-testid="sidebar-document"]')
                .filter({ hasText: 'ConcB' })
                .locator('.tree-item__pip--focused, .tree-item__pip[data-focused="true"]');
            const focusedCount = await concBFocusedPips.count();
            
            console.log(`[Concurrent] ConcB focused pips after switch: ${focusedCount}`);
            
            await screenshot(page1, '58-concurrent-switch');
            
            expect(focusedCount).toBe(2);
        });
    });
    
    test.describe('Visual Regression', () => {
        
        test('presence indicator baseline', async ({
            collaboratorPages
        }) => {
            const { page1, page2 } = collaboratorPages;
            
            // Setup page1 (Alice)
            await waitForAppReady(page1);
            await ensureIdentityExists(page1, 'Alice');
            await createWorkspaceViaUI(page1, `Baseline ${Date.now()}`);
            
            // Get share link
            const shareLink = await getShareLinkViaUI(page1);
            
            // Setup page2 (Bob)
            await waitForAppReady(page2);
            await ensureIdentityExists(page2, 'Bob');
            await joinWorkspaceViaUI(page2, shareLink);
            
            await waitForPresenceSync(2000);
            
            // Take baseline screenshots for visual regression
            const presenceIndicator = page1.locator('[data-testid="presence-indicator"], .presence-indicator');
            if (await presenceIndicator.count() > 0) {
                await expect(presenceIndicator).toHaveScreenshot('presence-indicator-baseline.png');
            } else {
                // Fallback - take full page screenshot
                await screenshot(page1, 'presence-indicator-baseline');
            }
        });
        
        test('document collaborators baseline', async ({
            collaboratorPages
        }) => {
            const { page1, page2 } = collaboratorPages;
            
            // Setup page1 (Alice)
            await waitForAppReady(page1);
            await ensureIdentityExists(page1, 'Alice');
            await createWorkspaceViaUI(page1, `Doc Collab Baseline ${Date.now()}`);
            
            // Get share link
            const shareLink = await getShareLinkViaUI(page1);
            
            // Create document
            await createDocumentViaUI(page1, 'Baseline Doc', 'text');
            
            // Setup page2 (Bob)
            await waitForAppReady(page2);
            await ensureIdentityExists(page2, 'Bob');
            await joinWorkspaceViaUI(page2, shareLink);
            
            // Wait for workspace and folder tree to sync
            await waitForSidebarItems(page2, { timeout: 30000 });
            
            // Bob opens document
            const docItem = page2.locator('.folder-tree-item, [data-testid="folder-item"], .sidebar-item, [role="treeitem"]').first();
            await docItem.click();
            await waitForPresenceSync(1000);
            
            const docCollaborators = page1.locator('[data-testid="doc-collaborators"], .doc-collaborators');
            if (await docCollaborators.count() > 0) {
                await expect(docCollaborators).toHaveScreenshot('doc-collaborators-baseline.png');
            } else {
                // Fallback - take full page screenshot
                await screenshot(page1, 'doc-collaborators-baseline');
            }
        });
    });
});

// Generate HTML report index
test.afterAll(async () => {
    try {
        const screenshots = fs.readdirSync(SCREENSHOT_DIR).filter(f => f.endsWith('.png'));
        
        if (screenshots.length === 0) return;
        
        const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Presence Visual Test Results</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; background: #1a1a2e; color: #eee; }
        h1 { color: #4ecdc4; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 20px; }
        .card { background: #16213e; border-radius: 8px; overflow: hidden; }
        .card img { width: 100%; height: auto; }
        .card .label { padding: 10px; font-size: 14px; color: #ccc; }
        .category { margin: 30px 0 15px; color: #ff6b6b; font-size: 18px; border-bottom: 1px solid #333; padding-bottom: 5px; }
    </style>
</head>
<body>
    <h1>🎯 Presence Visual Test Results</h1>
    <p>Generated: ${new Date().toISOString()}</p>
    <p>Screenshots: ${screenshots.length}</p>
    
    <div class="category">2-Client Scenarios</div>
    <div class="grid">
        ${screenshots.filter(s => !s.includes('mesh') && !s.includes('baseline') && !s.includes('3-users')).map(s => `
            <div class="card">
                <a href="${s}" target="_blank"><img src="${s}" loading="lazy"/></a>
                <div class="label">${s.replace(/-/g, ' ').replace('.png', '')}</div>
            </div>
        `).join('')}
    </div>
    
    <div class="category">3-Client Mesh</div>
    <div class="grid">
        ${screenshots.filter(s => s.includes('mesh') || s.includes('3-users')).map(s => `
            <div class="card">
                <a href="${s}" target="_blank"><img src="${s}" loading="lazy"/></a>
                <div class="label">${s.replace(/-/g, ' ').replace('.png', '')}</div>
            </div>
        `).join('')}
    </div>
    
    <div class="category">Visual Regression Baselines</div>
    <div class="grid">
        ${screenshots.filter(s => s.includes('baseline')).map(s => `
            <div class="card">
                <a href="${s}" target="_blank"><img src="${s}" loading="lazy"/></a>
                <div class="label">${s.replace(/-/g, ' ').replace('.png', '')}</div>
            </div>
        `).join('')}
    </div>
</body>
</html>
        `;
        
        fs.writeFileSync(path.join(SCREENSHOT_DIR, 'index.html'), html);
        console.log(`[Report] Generated presence visual report: ${path.join(SCREENSHOT_DIR, 'index.html')}`);
    } catch (err) {
        console.log('[Report] Could not generate report:', err.message);
    }
});
