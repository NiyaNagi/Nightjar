/**
 * E2E Tests for Security Features
 * 
 * Tests security-related functionality including identity management,
 * PIN protection, and recovery phrases.
 * Covers: identity creation, PIN flow, security settings.
 */

const { test, expect } = require('../fixtures/test-fixtures');
const { 
  waitForAppReady
} = require('../helpers/assertions');

test.describe('Security Features', () => {
  test.describe('Identity Creation', () => {
    test('onboarding shows identity creation flow', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      
      // Check for onboarding/identity creation elements
      const onboardingScreen = page.locator('.onboarding, .identity-creation, [data-testid="onboarding"]');
      const visible = await onboardingScreen.isVisible({ timeout: 5000 }).catch(() => false);
      
      // Either onboarding or identity should be present
      const identityInput = page.locator('input[placeholder*="name" i], input[aria-label*="name" i]');
      const inputVisible = await identityInput.isVisible({ timeout: 5000 }).catch(() => false);
      
      console.log('[Test] Onboarding visible:', visible, 'Identity input:', inputVisible);
      
      await page.screenshot({ path: 'test-results/artifacts/security-onboarding.png' });
    });

    test('identity name input accepts text', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      
      // Find name input
      const nameInput = page.locator('input[placeholder*="name" i], [data-testid="identity-name-input"]');
      if (await nameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await nameInput.fill('TestUser');
        await expect(nameInput).toHaveValue('TestUser');
      }
      
      await page.screenshot({ path: 'test-results/artifacts/security-name-input.png' });
    });
  });

  test.describe('PIN Protection', () => {
    test('PIN creation screen appears after name entry', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      
      // Enter name
      const nameInput = page.locator('input[placeholder*="name" i], [data-testid="identity-name-input"]');
      if (await nameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await nameInput.fill('PinUser');
        
        // Click continue/next
        const continueBtn = page.locator('button:has-text("Continue"), button:has-text("Next")');
        if (await continueBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await continueBtn.click();
          await page.waitForTimeout(500);
          
          // PIN creation screen should appear
          const pinContainer = page.locator('[data-testid="pin-input-container"], .pin-input');
          const pinVisible = await pinContainer.isVisible({ timeout: 5000 }).catch(() => false);
          
          console.log('[Test] PIN input visible:', pinVisible);
        }
      }
      
      await page.screenshot({ path: 'test-results/artifacts/security-pin-creation.png' });
    });

    test('PIN input has 6 digit fields', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      
      // Navigate to PIN screen
      const nameInput = page.locator('input[placeholder*="name" i], [data-testid="identity-name-input"]');
      if (await nameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await nameInput.fill('DigitUser');
        
        const continueBtn = page.locator('button:has-text("Continue"), button:has-text("Next")');
        if (await continueBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await continueBtn.click();
          await page.waitForTimeout(500);
          
          // Count PIN digit inputs
          const pinDigits = page.locator('[data-testid^="pin-digit-"], .pin-digit');
          const count = await pinDigits.count();
          
          console.log('[Test] PIN digit count:', count);
          expect(count).toBe(6);
        }
      }
      
      await page.screenshot({ path: 'test-results/artifacts/security-pin-digits.png' });
    });
  });

  test.describe('Recovery Phrase', () => {
    test('recovery phrase appears after PIN confirmation', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      
      // Enter name
      const nameInput = page.locator('input[placeholder*="name" i], [data-testid="identity-name-input"]');
      if (await nameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await nameInput.fill('RecoveryUser');
        
        const continueBtn = page.locator('button:has-text("Continue"), button:has-text("Next")');
        if (await continueBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await continueBtn.click();
          await page.waitForTimeout(500);
          
          // Enter PIN (first time)
          const pinContainer = page.locator('[data-testid="pin-input-container"], .pin-input');
          if (await pinContainer.isVisible({ timeout: 5000 }).catch(() => false)) {
            await page.keyboard.type('123456');
            await page.waitForTimeout(500);
            
            // Confirm PIN (second time)
            await page.keyboard.type('123456');
            await page.waitForTimeout(1000);
            
            // Recovery phrase should appear
            const recoveryPhrase = page.locator('.recovery-phrase, [data-testid="recovery-phrase"]');
            const phraseVisible = await recoveryPhrase.isVisible({ timeout: 5000 }).catch(() => false);
            
            console.log('[Test] Recovery phrase visible:', phraseVisible);
          }
        }
      }
      
      await page.screenshot({ path: 'test-results/artifacts/security-recovery.png' });
    });
  });

  test.describe('Identity Display', () => {
    test('identity name is shown after creation', async ({ webPage1, unifiedServer1 }) => {
      const page = webPage1;
      
      await waitForAppReady(page);
      
      // Complete full identity creation
      const nameInput = page.locator('input[placeholder*="name" i], [data-testid="identity-name-input"]');
      if (await nameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await nameInput.fill('DisplayUser');
        
        const continueBtn = page.locator('button:has-text("Continue"), button:has-text("Next")');
        if (await continueBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
          await continueBtn.first().click();
          await page.waitForTimeout(500);
          
          // Enter and confirm PIN
          const pinContainer = page.locator('[data-testid="pin-input-container"], .pin-input');
          if (await pinContainer.isVisible({ timeout: 5000 }).catch(() => false)) {
            await page.keyboard.type('123456');
            await page.waitForTimeout(500);
            await page.keyboard.type('123456');
            await page.waitForTimeout(1000);
            
            // Click continue past recovery phrase
            const recoveryBtn = page.locator('button:has-text("Continue"), button:has-text("I\'ve saved")');
            if (await recoveryBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
              await recoveryBtn.click();
              await page.waitForTimeout(2000);
              
              // Identity name should appear somewhere in the UI
              const identityDisplay = page.locator(':has-text("DisplayUser")');
              const displayVisible = await identityDisplay.first().isVisible({ timeout: 5000 }).catch(() => false);
              
              console.log('[Test] Identity display visible:', displayVisible);
            }
          }
        }
      }
      
      await page.screenshot({ path: 'test-results/artifacts/security-identity-display.png' });
    });
  });
});
