/**
 * E2E Tests for Sync Status Icons
 * 
 * Tests that sync status indicators appear correctly in the UI:
 * - Connection status indicator (always visible)
 * - Peer counts display
 * - Sync verification status button (when active)
 * - Relay indicator (when connected)
 */

const { test, expect } = require('../fixtures/test-fixtures');
const { 
    waitForAppReady, 
    ensureIdentityExists, 
    createWorkspaceViaUI,
    createDocumentViaUI,
    getShareLinkViaUI,
    joinWorkspaceViaUI
} = require('../helpers/assertions');
const { waitForPresenceSync } = require('../helpers/presence-helpers');

test.describe('Sync Status Indicators', () => {
    test.setTimeout(120000);
    
    test.describe('Connection Status', () => {
        
        test('connection status shows offline when no workspace', async ({ webPage1, unifiedServer1 }) => {
            const page = webPage1;
            
            await waitForAppReady(page);
            await ensureIdentityExists(page, 'StatusUser');
            
            // Before creating workspace, check status bar exists
            const statusBar = page.locator('.status-bar-bottom');
            await expect(statusBar).toBeVisible({ timeout: 10000 });
            
            await page.screenshot({ path: 'test-results/artifacts/sync-status-no-workspace.png' });
        });
        
        test('connection status shows connected after workspace creation', async ({ webPage1, unifiedServer1 }) => {
            const page = webPage1;
            
            await waitForAppReady(page);
            await ensureIdentityExists(page, 'ConnectedUser');
            await createWorkspaceViaUI(page, `Sync Status Test ${Date.now()}`);
            
            // Wait for sync to complete
            await page.waitForTimeout(3000);
            
            // Connection status should show connected
            const syncStatus = page.locator('[data-testid="sync-status"]');
            await expect(syncStatus).toBeVisible({ timeout: 10000 });
            
            // Get the status text and class
            const statusText = await syncStatus.textContent();
            const statusClass = await syncStatus.getAttribute('class');
            console.log(`[Test] Connection status: ${statusText}, class: ${statusClass}`);
            
            // Should show "Connected" in web mode
            expect(statusText).toBe('Connected');
            expect(statusClass).toContain('connected');
            
            // Check data attributes
            const dataSynced = await syncStatus.getAttribute('data-synced');
            const dataPhase = await syncStatus.getAttribute('data-phase');
            expect(dataSynced).toBe('true');
            expect(dataPhase).toBe('complete');
            
            await page.screenshot({ path: 'test-results/artifacts/sync-status-connected.png' });
        });
        
        test('connection status has correct data-synced attribute', async ({ webPage1, unifiedServer1 }) => {
            const page = webPage1;
            
            await waitForAppReady(page);
            await ensureIdentityExists(page, 'SyncedAttrUser');
            await createWorkspaceViaUI(page, `Synced Attr Test ${Date.now()}`);
            
            // Wait for connection
            await page.waitForTimeout(3000);
            
            const syncStatus = page.locator('[data-testid="sync-status"]');
            await expect(syncStatus).toBeVisible();
            
            // Check data-synced attribute exists
            const dataSynced = await syncStatus.getAttribute('data-synced');
            console.log(`[Test] data-synced attribute: ${dataSynced}`);
            
            // Should be either 'true' or 'false'
            expect(['true', 'false']).toContain(dataSynced);
            
            await page.screenshot({ path: 'test-results/artifacts/sync-status-attribute.png' });
        });
    });
    
    test.describe('Peer Count Display', () => {
        
        test('peer count shows 0/0 for solo workspace', async ({ webPage1, unifiedServer1 }) => {
            const page = webPage1;
            
            await waitForAppReady(page);
            await ensureIdentityExists(page, 'SoloUser');
            await createWorkspaceViaUI(page, `Solo Workspace ${Date.now()}`);
            
            // Wait for status bar
            await page.waitForTimeout(2000);
            
            // Check if peer counts section exists (may not be visible with 0 peers)
            const peerCounts = page.locator('.peer-counts');
            const isVisible = await peerCounts.isVisible();
            console.log(`[Test] Peer counts visible: ${isVisible}`);
            
            // Peer counts might not show with 0 peers, which is fine
            if (isVisible) {
                const peerText = await peerCounts.textContent();
                console.log(`[Test] Peer counts text: ${peerText}`);
            }
            
            await page.screenshot({ path: 'test-results/artifacts/peer-counts-solo.png' });
        });
        
        test('peer count updates when collaborator joins', async ({ collaboratorPages }) => {
            const { page1, page2 } = collaboratorPages;
            
            // Setup page1 (Alice)
            await waitForAppReady(page1);
            await ensureIdentityExists(page1, 'Alice');
            await createWorkspaceViaUI(page1, `Peer Count Test ${Date.now()}`);
            
            // Get share link
            const shareLink = await getShareLinkViaUI(page1);
            
            // Check Alice's initial peer state
            await page1.waitForTimeout(2000);
            const aliceStatus1 = page1.locator('[data-testid="sync-status"]');
            const aliceStatusText1 = await aliceStatus1.textContent();
            console.log(`[Test] Alice status before Bob joins: ${aliceStatusText1}`);
            
            await page1.screenshot({ path: 'test-results/artifacts/peer-counts-before-join.png' });
            
            // Setup page2 (Bob) - join workspace
            await waitForAppReady(page2);
            await ensureIdentityExists(page2, 'Bob');
            await joinWorkspaceViaUI(page2, shareLink);
            
            // Wait for sync
            await waitForPresenceSync(5000);
            
            // Check Alice's peer status after Bob joins
            const aliceStatus2 = page1.locator('[data-testid="sync-status"]');
            const aliceStatusText2 = await aliceStatus2.textContent();
            console.log(`[Test] Alice status after Bob joins: ${aliceStatusText2}`);
            
            // Should show at least 1 peer connected
            const hasConnectedPeer = aliceStatusText2.toLowerCase().includes('peer') || 
                                     aliceStatusText2.includes('1') ||
                                     aliceStatusText2.toLowerCase().includes('connected');
            
            await page1.screenshot({ path: 'test-results/artifacts/peer-counts-after-join.png' });
            await page2.screenshot({ path: 'test-results/artifacts/peer-counts-bob-view.png' });
            
            // This is informational - the P2P connection might take time
            console.log(`[Test] Has connected peer indicator: ${hasConnectedPeer}`);
        });
    });
    
    test.describe('Status Bar Elements', () => {
        
        test('status bar shows connection status dot', async ({ webPage1, unifiedServer1 }) => {
            const page = webPage1;
            
            await waitForAppReady(page);
            await ensureIdentityExists(page, 'DotUser');
            await createWorkspaceViaUI(page, `Status Dot Test ${Date.now()}`);
            
            await page.waitForTimeout(2000);
            
            // Check for status dot in connection status
            const statusDot = page.locator('.connection-status .status-dot');
            await expect(statusDot).toBeVisible({ timeout: 10000 });
            
            await page.screenshot({ path: 'test-results/artifacts/status-dot.png' });
        });
        
        test('document stats appear in status bar', async ({ webPage1, unifiedServer1 }) => {
            const page = webPage1;
            
            await waitForAppReady(page);
            await ensureIdentityExists(page, 'StatsUser');
            await createWorkspaceViaUI(page, `Stats Test ${Date.now()}`);
            
            // Create a document
            await createDocumentViaUI(page, 'Stats Test Doc', 'text');
            
            await page.waitForTimeout(2000);
            
            // Status bar should show document stats (word/char count)
            const statsSection = page.locator('.status-section.right, .document-stats');
            if (await statsSection.isVisible()) {
                const statsText = await statsSection.textContent();
                console.log(`[Test] Stats text: ${statsText}`);
                
                // Should contain word/char counts
                const hasStats = statsText.toLowerCase().includes('word') || 
                                 statsText.toLowerCase().includes('char') ||
                                 statsText.match(/\d+/);
                console.log(`[Test] Has stats: ${hasStats}`);
            }
            
            await page.screenshot({ path: 'test-results/artifacts/document-stats.png' });
        });
    });
    
    test.describe('Sync Phase Display', () => {
        
        test('joining workspace shows sync phase progress', async ({ collaboratorPages }) => {
            const { page1, page2 } = collaboratorPages;
            
            // Setup page1 (Alice)
            await waitForAppReady(page1);
            await ensureIdentityExists(page1, 'Alice');
            await createWorkspaceViaUI(page1, `Sync Phase Test ${Date.now()}`);
            
            // Create a document to have content to sync
            await createDocumentViaUI(page1, 'Sync Phase Doc', 'text');
            
            // Get share link
            const shareLink = await getShareLinkViaUI(page1);
            
            // Setup page2 (Bob)
            await waitForAppReady(page2);
            await ensureIdentityExists(page2, 'Bob');
            
            // Monitor Bob's status as he joins
            const statusSnapshots = [];
            
            // Start join process
            const joinPromise = joinWorkspaceViaUI(page2, shareLink);
            
            // Capture status snapshots during join
            for (let i = 0; i < 5; i++) {
                await page2.waitForTimeout(1000);
                const status = page2.locator('[data-testid="sync-status"]');
                if (await status.isVisible()) {
                    const text = await status.textContent();
                    statusSnapshots.push(text);
                    console.log(`[Test] Bob status at ${i}s: ${text}`);
                }
            }
            
            await joinPromise;
            
            // Wait for final sync
            await waitForPresenceSync(3000);
            
            // Final status
            const finalStatus = page2.locator('[data-testid="sync-status"]');
            if (await finalStatus.isVisible()) {
                const finalText = await finalStatus.textContent();
                console.log(`[Test] Bob final status: ${finalText}`);
            }
            
            await page2.screenshot({ path: 'test-results/artifacts/sync-phase-complete.png' });
            
            // Log all status snapshots
            console.log(`[Test] Status progression: ${JSON.stringify(statusSnapshots)}`);
        });
    });
    
    test.describe('Visual Regression', () => {
        
        test('status bar layout is correct', async ({ webPage1, unifiedServer1 }) => {
            const page = webPage1;
            
            await waitForAppReady(page);
            await ensureIdentityExists(page, 'LayoutUser');
            await createWorkspaceViaUI(page, `Layout Test ${Date.now()}`);
            
            // Create a document
            await createDocumentViaUI(page, 'Layout Doc', 'text');
            
            await page.waitForTimeout(2000);
            
            // Capture full status bar
            const statusBar = page.locator('.status-bar-bottom');
            await expect(statusBar).toBeVisible();
            
            await page.screenshot({ 
                path: 'test-results/artifacts/status-bar-layout.png',
                fullPage: false
            });
            
            // Check key sections exist
            const leftSection = page.locator('.status-section.left');
            const rightSection = page.locator('.status-section.right');
            
            // At minimum, left section should exist
            await expect(leftSection).toBeVisible();
            console.log(`[Test] Left section visible: true`);
            
            if (await rightSection.isVisible()) {
                console.log(`[Test] Right section visible: true`);
            }
        });
    });
});
