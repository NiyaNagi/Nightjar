/**
 * Nahma Visual UI Testing - Test Fixtures
 * 
 * Extended Playwright test fixtures that:
 * - Capture screenshots at key points
 * - Log console errors and warnings
 * - Capture network failures
 * - Generate structured reports for AI analysis
 */
import { test as base, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Extend the test fixtures
export const test = base.extend({
  // Capture console errors
  page: async ({ page }, use) => {
    const consoleMessages = [];
    const networkErrors = [];
    const jsErrors = [];
    
    // Capture console messages
    page.on('console', msg => {
      const entry = {
        type: msg.type(),
        text: msg.text(),
        location: msg.location(),
        timestamp: new Date().toISOString()
      };
      consoleMessages.push(entry);
      
      if (msg.type() === 'error') {
        console.log(`[Console Error] ${msg.text()}`);
      }
    });
    
    // Capture page errors (uncaught exceptions)
    page.on('pageerror', error => {
      jsErrors.push({
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
      console.log(`[JS Error] ${error.message}`);
    });
    
    // Capture failed network requests
    page.on('requestfailed', request => {
      networkErrors.push({
        url: request.url(),
        failure: request.failure()?.errorText,
        method: request.method(),
        timestamp: new Date().toISOString()
      });
      console.log(`[Network Error] ${request.method()} ${request.url()} - ${request.failure()?.errorText}`);
    });
    
    // Run the test
    await use(page);
    
    // After test: save diagnostics
    const testInfo = test.info();
    const outputDir = testInfo.outputDir;
    
    fs.mkdirSync(outputDir, { recursive: true });
    
    fs.writeFileSync(
      path.join(outputDir, 'console-messages.json'),
      JSON.stringify(consoleMessages, null, 2)
    );
    
    fs.writeFileSync(
      path.join(outputDir, 'network-errors.json'),
      JSON.stringify(networkErrors, null, 2)
    );
    
    fs.writeFileSync(
      path.join(outputDir, 'js-errors.json'),
      JSON.stringify(jsErrors, null, 2)
    );
    
    // Generate summary
    const summary = {
      test: testInfo.title,
      file: testInfo.file,
      status: testInfo.status,
      duration: testInfo.duration,
      errors: {
        console: consoleMessages.filter(m => m.type === 'error').length,
        network: networkErrors.length,
        js: jsErrors.length
      },
      warnings: consoleMessages.filter(m => m.type === 'warning').length
    };
    
    fs.writeFileSync(
      path.join(outputDir, 'test-summary.json'),
      JSON.stringify(summary, null, 2)
    );
  }
});

export { expect };

/**
 * Helper: Take a labeled screenshot
 */
export async function captureScreen(page, name, testInfo) {
  const screenshot = await page.screenshot({ fullPage: true });
  await testInfo.attach(name, { body: screenshot, contentType: 'image/png' });
}

/**
 * Helper: Get all visible text on page for analysis
 */
export async function getPageText(page) {
  return await page.evaluate(() => document.body.innerText);
}

/**
 * Helper: Get accessibility tree for analysis
 * Note: page.accessibility.snapshot() is deprecated in newer Playwright
 * Using aria-snapshot instead
 */
export async function getAccessibilityTree(page) {
  try {
    // Get accessible names and roles from key elements
    const accessibilityInfo = await page.evaluate(() => {
      const elements = document.querySelectorAll('button, input, a, [role], [aria-label]');
      return Array.from(elements).slice(0, 50).map(el => ({
        tag: el.tagName,
        role: el.getAttribute('role'),
        ariaLabel: el.getAttribute('aria-label'),
        text: el.textContent?.slice(0, 50)
      }));
    });
    return { elements: accessibilityInfo };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Helper: Check for common UI issues
 */
export async function checkCommonIssues(page) {
  const issues = [];
  
  // Check for broken images
  const brokenImages = await page.evaluate(() => {
    const images = Array.from(document.querySelectorAll('img'));
    return images
      .filter(img => !img.complete || img.naturalHeight === 0)
      .map(img => ({ src: img.src, alt: img.alt }));
  });
  
  if (brokenImages.length > 0) {
    issues.push({ type: 'broken-images', items: brokenImages });
  }
  
  // Check for empty links
  const emptyLinks = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a'));
    return links
      .filter(a => !a.textContent?.trim() && !a.querySelector('img, svg'))
      .map(a => ({ href: a.href, html: a.outerHTML.slice(0, 100) }));
  });
  
  if (emptyLinks.length > 0) {
    issues.push({ type: 'empty-links', items: emptyLinks });
  }
  
  // Check for buttons without accessible names
  const inaccessibleButtons = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons
      .filter(btn => !btn.textContent?.trim() && !btn.getAttribute('aria-label'))
      .map(btn => ({ html: btn.outerHTML.slice(0, 100) }));
  });
  
  if (inaccessibleButtons.length > 0) {
    issues.push({ type: 'inaccessible-buttons', items: inaccessibleButtons });
  }
  
  // Check for elements with error classes or red text
  const errorElements = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('[class*="error"], [class*="Error"]'));
    return elements.map(el => ({ 
      class: el.className, 
      text: el.textContent?.slice(0, 200) 
    }));
  });
  
  if (errorElements.length > 0) {
    issues.push({ type: 'error-elements', items: errorElements });
  }
  
  return issues;
}
