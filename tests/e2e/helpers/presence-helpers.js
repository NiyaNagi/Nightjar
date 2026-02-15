/**
 * Presence Testing Helpers
 * 
 * Utilities for testing real-time presence sync between multiple clients.
 * Includes wait helpers, verification functions, and timing constants.
 */

// Timing constants (based on PresenceContext implementation)
const PRESENCE_SYNC_DELAY = 500;           // Time to wait for presence changes to sync
const TYPING_INDICATOR_TIMEOUT = 3000;     // Auto-clear timeout for typing indicator
const CURSOR_UPDATE_THROTTLE = 100;        // Cursor/selection update throttle
const HEARTBEAT_INTERVAL = 30000;          // Peer heartbeat interval
const DEFAULT_WAIT_TIMEOUT = 10000;        // Default timeout for wait operations

/**
 * Wait for presence sync between peers
 * Use after an action that triggers presence updates
 * @param {number} delay - Time to wait in ms (default: PRESENCE_SYNC_DELAY)
 */
async function waitForPresenceSync(delay = PRESENCE_SYNC_DELAY) {
    await new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Wait for a specific peer count to be visible
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {number} expectedCount - Expected number of online peers (including self)
 * @param {Object} options - Options object
 * @param {number} options.timeout - Timeout in ms (default: DEFAULT_WAIT_TIMEOUT)
 */
async function waitForPeerCount(page, expectedCount, options = {}) {
    const timeout = options.timeout || DEFAULT_WAIT_TIMEOUT;
    
    await page.waitForFunction(
        (count) => {
            const countEl = document.querySelector('[data-testid="presence-online-count"]');
            if (!countEl) return false;
            const text = countEl.textContent;
            if (count === 1 && text.includes('Only you')) return true;
            return text.includes(`${count} online`);
        },
        expectedCount,
        { timeout }
    );
}

/**
 * Get the current online peer count displayed
 * @param {import('@playwright/test').Page} page - Playwright page
 * @returns {Promise<number>} The displayed peer count
 */
async function getOnlinePeerCount(page) {
    const countText = await page.locator('[data-testid="presence-online-count"]').textContent();
    if (countText.includes('Only you')) return 1;
    const match = countText.match(/(\d+)\s*online/);
    return match ? parseInt(match[1], 10) : 0;
}

/**
 * Verify a specific collaborator is visible
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string} peerName - Name of the peer to look for
 * @param {Object} options - Options object
 * @param {number} options.timeout - Timeout in ms (default: DEFAULT_WAIT_TIMEOUT)
 */
async function verifyCollaboratorVisible(page, peerName, options = {}) {
    const timeout = options.timeout || DEFAULT_WAIT_TIMEOUT;
    
    // Check in both presence indicator and document collaborators
    const selectors = [
        `[data-peer-name="${peerName}"]`,
        `[data-collaborator-name="${peerName}"]`,
        `[title*="${peerName}"]`
    ];
    
    await page.waitForFunction(
        (name) => {
            return document.querySelector(`[data-peer-name="${name}"]`) ||
                   document.querySelector(`[data-collaborator-name="${name}"]`) ||
                   document.querySelector(`[title*="${name}"]`);
        },
        peerName,
        { timeout }
    );
}

/**
 * Verify typing indicator is showing for a peer
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string} peerName - Name of the peer (optional, checks any typing)
 * @param {Object} options - Options object
 * @param {number} options.timeout - Timeout in ms (default: DEFAULT_WAIT_TIMEOUT)
 */
async function verifyTypingIndicator(page, peerName = null, options = {}) {
    const timeout = options.timeout || DEFAULT_WAIT_TIMEOUT;
    
    if (peerName) {
        // Look for specific peer typing
        await page.waitForFunction(
            (name) => {
                const indicator = document.querySelector('[data-testid="presence-typing-indicator"]');
                return indicator && indicator.textContent.includes(name);
            },
            peerName,
            { timeout }
        );
    } else {
        // Just check typing indicator is visible
        await page.waitForSelector('[data-testid="presence-typing-indicator"]', { timeout });
    }
}

/**
 * Verify typing indicator disappears (after timeout)
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {Object} options - Options object
 * @param {number} options.timeout - Timeout in ms (should be > TYPING_INDICATOR_TIMEOUT)
 */
async function verifyTypingIndicatorGone(page, options = {}) {
    const timeout = options.timeout || TYPING_INDICATOR_TIMEOUT + 2000;
    
    await page.waitForFunction(
        () => !document.querySelector('[data-testid="presence-typing-indicator"]'),
        {},
        { timeout }
    );
}

/**
 * Get list of visible collaborator names
 * @param {import('@playwright/test').Page} page - Playwright page
 * @returns {Promise<string[]>} Array of collaborator names
 */
async function getVisibleCollaborators(page) {
    const collaborators = await page.locator('[data-collaborator-name]').all();
    const names = [];
    
    for (const collab of collaborators) {
        const name = await collab.getAttribute('data-collaborator-name');
        if (name) names.push(name);
    }
    
    return names;
}

/**
 * Get collaborator's current context (e.g., cell reference for spreadsheets)
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string} peerName - Name of the peer
 * @returns {Promise<string|null>} Context info or null
 */
async function getCollaboratorContext(page, peerName) {
    const collab = page.locator(`[data-collaborator-name="${peerName}"]`);
    if (await collab.count() === 0) return null;
    return await collab.getAttribute('data-collaborator-context');
}

/**
 * Verify peer cursor is visible at expected location
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string} peerName - Name of the peer
 * @param {Object} options - Options object
 * @param {number} options.timeout - Timeout in ms (default: DEFAULT_WAIT_TIMEOUT)
 */
async function verifyPeerCursor(page, peerName, options = {}) {
    const timeout = options.timeout || DEFAULT_WAIT_TIMEOUT;
    
    await page.waitForSelector(`[data-testid^="peer-cursor-"][data-peer-name="${peerName}"]`, { timeout });
}

/**
 * Simulate user activity (typing) to trigger presence update
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string} text - Text to type
 */
async function simulateTyping(page, text) {
    // Focus on active editor/input
    const editor = page.locator('.ProseMirror, .editor-content, [contenteditable="true"]').first();
    if (await editor.count() > 0) {
        await editor.click();
        await editor.type(text, { delay: 50 }); // Slow typing to trigger indicators
    }
}

/**
 * Capture presence screenshot with consistent naming
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string} name - Screenshot name
 * @param {string} outputDir - Output directory (default: test-results/presence-visual)
 */
async function capturePresenceScreenshot(page, name, outputDir = 'test-results/presence-visual') {
    const fs = require('fs');
    const path = require('path');
    
    const fullDir = path.resolve(process.cwd(), outputDir);
    if (!fs.existsSync(fullDir)) {
        fs.mkdirSync(fullDir, { recursive: true });
    }
    
    const filename = `${name.replace(/[^a-z0-9]/gi, '-')}-${Date.now()}.png`;
    await page.screenshot({ 
        path: path.join(fullDir, filename), 
        fullPage: true 
    });
    
    console.log(`[Presence Screenshot] ${filename}`);
    return path.join(fullDir, filename);
}

/**
 * Wait for sidebar items to appear after joining workspace
 * This is needed because workspace data needs to sync from peers
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {Object} options - Options object
 * @param {number} options.timeout - Timeout in ms (default: 60000 for network sync)
 * @param {number} options.pollInterval - Poll interval in ms (default: 2000)
 */
async function waitForSidebarItems(page, options = {}) {
    const timeout = options.timeout || 60000;
    const pollInterval = options.pollInterval || 2000;
    
    // Wait for folder tree items to appear in sidebar
    // Include treeitem role as that's what the actual tree uses
    const sidebarSelector = '.folder-tree-item, [data-testid="folder-item"], .sidebar-item, [data-testid="sidebar-document-item"], [role="treeitem"]';
    
    const startTime = Date.now();
    let lastError;
    
    while (Date.now() - startTime < timeout) {
        try {
            const count = await page.locator(sidebarSelector).count();
            if (count > 0) {
                // Found items, wait a bit for stability
                await waitForPresenceSync(500);
                return;
            }
        } catch (e) {
            lastError = e;
        }
        
        // Wait before next poll
        await page.waitForTimeout(pollInterval);
    }
    
    throw new Error(`waitForSidebarItems: Timeout ${timeout}ms exceeded waiting for sidebar items. Last error: ${lastError?.message || 'No items found'}`);
}

/**
 * Wait for document to be fully loaded and connected
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {Object} options - Options object
 * @param {number} options.timeout - Timeout in ms (default: DEFAULT_WAIT_TIMEOUT)
 */
async function waitForDocumentReady(page, options = {}) {
    const timeout = options.timeout || DEFAULT_WAIT_TIMEOUT;
    
    // Wait for presence indicator to appear (indicates connection is established)
    await page.waitForSelector('[data-testid="presence-indicator"]', { timeout });
    
    // Additional wait for sync
    await waitForPresenceSync();
}

/**
 * Navigate both pages to same document and wait for sync
 * @param {import('@playwright/test').Page} page1 - First page
 * @param {import('@playwright/test').Page} page2 - Second page
 * @param {string} docSelector - Selector for document to open
 */
async function navigateBothToDocument(page1, page2, docSelector) {
    // Click document on both pages
    await Promise.all([
        page1.click(docSelector),
        page2.click(docSelector)
    ]);
    
    // Wait for both to be ready
    await Promise.all([
        waitForDocumentReady(page1),
        waitForDocumentReady(page2)
    ]);
    
    // Extra sync time for peer discovery
    await waitForPresenceSync(1000);
}

module.exports = {
    // Constants
    PRESENCE_SYNC_DELAY,
    TYPING_INDICATOR_TIMEOUT,
    CURSOR_UPDATE_THROTTLE,
    HEARTBEAT_INTERVAL,
    DEFAULT_WAIT_TIMEOUT,
    
    // Wait helpers
    waitForPresenceSync,
    waitForPeerCount,
    waitForDocumentReady,
    waitForSidebarItems,
    
    // Verification helpers
    verifyCollaboratorVisible,
    verifyTypingIndicator,
    verifyTypingIndicatorGone,
    verifyPeerCursor,
    
    // Query helpers
    getOnlinePeerCount,
    getVisibleCollaborators,
    getCollaboratorContext,
    
    // Action helpers
    simulateTyping,
    navigateBothToDocument,
    
    // Screenshot helper
    capturePresenceScreenshot
};
