/**
 * Identity Management Tests
 * 
 * Tests for creating, restoring, and managing user identities.
 * 
 * NOTE: UI-based tests are skipped as they require frontend data-testid attributes.
 * API tests for identity are in 04-cross-platform.spec.js
 */
const { test, expect } = require('../fixtures/test-fixtures.js');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = path.join(__dirname, '../test-results/artifacts/screenshots');

async function takeScreenshot(page, testName) {
  try {
    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }
    const filename = `${testName.replace(/[^a-z0-9]/gi, '-')}-${Date.now()}.png`;
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, filename), fullPage: true });
    console.log(`[Screenshot] Captured: ${filename}`);
  } catch (err) {
    console.log(`[Screenshot] Failed: ${err.message}`);
  }
}

test.describe('Identity Management', () => {

  test.describe('Identity Creation via UI', () => {
    
    test('can create new identity through onboarding flow', async ({ page, unifiedServer1, testLogs }) => {
      testLogs.add('test', 'info', '=== Create identity via UI test ===');
      
      // Navigate to the app
      await page.goto('/');
      
      // Wait for onboarding welcome screen
      await page.waitForSelector('[data-testid="onboarding-welcome"]', { timeout: 30000 });
      testLogs.add('test', 'info', 'Onboarding welcome screen visible');
      
      // Click create identity button
      await page.click('[data-testid="create-identity-btn"]');
      testLogs.add('test', 'info', 'Clicked create identity button');
      
      // Wait for identity creation form
      await page.waitForSelector('[data-testid="identity-name-input"]', { timeout: 10000 });
      
      // Fill in identity name
      const testName = `TestUser_${Date.now()}`;
      await page.fill('[data-testid="identity-name-input"]', testName);
      testLogs.add('test', 'info', `Entered name: ${testName}`);
      
      // Optionally select an emoji (click the picker trigger)
      const emojiTrigger = page.locator('[data-testid="emoji-picker-trigger"]');
      if (await emojiTrigger.isVisible()) {
        await emojiTrigger.click();
        await page.waitForSelector('[data-testid="emoji-picker"]', { timeout: 5000 });
        
        // Select a specific emoji
        const testEmoji = page.locator('[data-testid="emoji-🎉"]');
        if (await testEmoji.isVisible()) {
          await testEmoji.click();
          testLogs.add('test', 'info', 'Selected emoji: 🎉');
        }
      }
      
      // Click confirm button
      await page.click('[data-testid="confirm-identity-btn"]');
      testLogs.add('test', 'info', 'Clicked confirm identity button');
      
      // Wait for recovery phrase to be shown
      await page.waitForSelector('[data-testid="recovery-phrase"]', { timeout: 10000 });
      testLogs.add('test', 'info', 'Recovery phrase screen displayed');
      
      // Get the recovery phrase for later verification
      const recoveryPhrase = await page.locator('[data-testid="recovery-phrase"]').textContent();
      expect(recoveryPhrase).toBeTruthy();
      expect(recoveryPhrase.split(' ').length).toBe(12); // Should be 12 words
      testLogs.add('test', 'info', `Recovery phrase: ${recoveryPhrase.substring(0, 20)}...`);
      
      // Check the understood checkbox
      await page.check('[data-testid="understood-checkbox"]');
      
      // Click continue
      await page.click('[data-testid="continue-btn"]');
      testLogs.add('test', 'info', 'Completed identity creation');
      
      // Should now see the main app (workspace selector or sidebar)
      await page.waitForSelector('[data-testid="workspace-sidebar"], [data-testid="workspace-selector"]', { 
        timeout: 15000 
      });
      testLogs.add('test', 'info', 'Main app loaded after identity creation');
      
      testLogs.add('test', 'info', '=== Create identity via UI test PASSED ===');
    });
  });

  test.describe('Identity Restoration', () => {
    
    test('can restore identity from recovery phrase', async ({ page, unifiedServer1, testLogs }) => {
      testLogs.add('test', 'info', '=== Restore identity test ===');
      
      // For this test, we need a known recovery phrase
      // In a real scenario, this would come from a previous identity creation
      const knownRecoveryPhrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      
      await page.goto('/');
      
      // Wait for onboarding
      await page.waitForSelector('[data-testid="onboarding-welcome"]', { timeout: 30000 });
      
      // Click restore identity button
      await page.click('[data-testid="restore-identity-btn"]');
      testLogs.add('test', 'info', 'Clicked restore identity button');
      
      // Wait for restore form
      await page.waitForSelector('[data-testid="restore-identity"]', { timeout: 10000 });
      
      // Fill in recovery phrase - check if single input or 12 word inputs
      const singleInput = page.locator('[data-testid="recovery-phrase-input"]');
      const firstWordInput = page.locator('[data-testid="recovery-word-1"]');
      
      if (await singleInput.isVisible()) {
        // Single textarea for the whole phrase
        await singleInput.fill(knownRecoveryPhrase);
        testLogs.add('test', 'info', 'Filled single recovery phrase input');
      } else if (await firstWordInput.isVisible()) {
        // 12 separate inputs for each word
        const words = knownRecoveryPhrase.split(' ');
        for (let i = 0; i < words.length; i++) {
          await page.fill(`[data-testid="recovery-word-${i + 1}"]`, words[i]);
        }
        testLogs.add('test', 'info', 'Filled 12 word inputs');
      }
      
      // Click restore button
      await page.click('[data-testid="restore-btn"]');
      testLogs.add('test', 'info', 'Clicked restore button');
      
      // Wait for main app to load (identity restored)
      await page.waitForSelector('[data-testid="workspace-sidebar"], [data-testid="workspace-selector"]', { 
        timeout: 15000 
      });
      testLogs.add('test', 'info', 'Identity restored, main app loaded');
      
      testLogs.add('test', 'info', '=== Restore identity test PASSED ===');
    });
  });

  test.describe('Identity via Sidecar API', () => {
    
    test('sidecar provides identity status', async ({ sidecarClient1, testLogs }) => {
      testLogs.add('test', 'info', '=== Sidecar identity status test ===');
      
      // Get status which includes identity info
      const status = await sidecarClient1.getStatus();
      
      testLogs.add('test', 'info', `Status received: ${status.type}`);
      
      // The status should indicate whether identity exists
      expect(status.type).toBe('status');
      
      testLogs.add('test', 'info', '=== Sidecar identity status test PASSED ===');
    });
  });
});
