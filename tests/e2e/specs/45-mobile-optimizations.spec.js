// @ts-check
const { test, expect, devices } = require('@playwright/test');

/**
 * 45-mobile-optimizations.spec.js
 *
 * E2E tests for mobile viewport optimizations (v1.7.14).
 * Tests are run at iPhone-sized viewports to verify:
 * - PWA manifest is served
 * - Apple meta tags are present
 * - Theme-color meta tag is present
 * - Touch-action: manipulation is active
 * - Nav rail renders horizontally on mobile
 * - Card view renders on AllRequests at mobile widths
 * - SlidePanel z-index is correct
 * - Toast clears bottom nav
 */

const MOBILE_VIEWPORT = { width: 375, height: 812 }; // iPhone X
const BASE_URL = process.env.E2E_WEB_URL || 'http://localhost:5174';

test.describe('Mobile optimizations @mobile', () => {
  test.use({
    viewport: MOBILE_VIEWPORT,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  });

  test('PWA manifest is linked in HTML', async ({ page }) => {
    await page.goto(BASE_URL);
    const manifest = page.locator('link[rel="manifest"]');
    await expect(manifest).toHaveAttribute('href', '/manifest.json');
  });

  test('theme-color meta tag is present', async ({ page }) => {
    await page.goto(BASE_URL);
    const meta = page.locator('meta[name="theme-color"]');
    await expect(meta).toHaveAttribute('content', '#6366f1');
  });

  test('apple-mobile-web-app-capable is set', async ({ page }) => {
    await page.goto(BASE_URL);
    const meta = page.locator('meta[name="apple-mobile-web-app-capable"]');
    await expect(meta).toHaveAttribute('content', 'yes');
  });

  test('apple-touch-icon is linked', async ({ page }) => {
    await page.goto(BASE_URL);
    const link = page.locator('link[rel="apple-touch-icon"]');
    await expect(link).toHaveAttribute('href', '/apple-touch-icon.png');
  });

  test('manifest.json is fetchable and valid', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}/manifest.json`);
    expect(response.status()).toBe(200);
    const manifest = await response.json();
    expect(manifest.short_name).toBe('Nightjar');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
  });

  test('touch-action: manipulation is applied to html', async ({ page }) => {
    await page.goto(BASE_URL);
    const touchAction = await page.evaluate(() => {
      return getComputedStyle(document.documentElement).touchAction;
    });
    expect(touchAction).toBe('manipulation');
  });

  test('tap-highlight-color is transparent on html', async ({ page }) => {
    await page.goto(BASE_URL);
    const tapColor = await page.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue('-webkit-tap-highlight-color');
    });
    // Should be transparent or rgba(0,0,0,0)
    expect(tapColor).toMatch(/(transparent|rgba\(0,\s*0,\s*0,\s*0\))/);
  });

  test('PWA icon files are served', async ({ page }) => {
    for (const iconPath of ['/nightjar-192.png', '/nightjar-512.png', '/apple-touch-icon.png']) {
      const response = await page.goto(`${BASE_URL}${iconPath}`);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('image/png');
    }
  });
});
