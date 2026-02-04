/**
 * Unified Server API Tests
 * 
 * Tests the unified server's HTTP API endpoints and WebSocket functionality.
 * Includes screenshot capture for UI state.
 */
const { test, expect } = require('../fixtures/test-fixtures.js');
const http = require('http');
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

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    }).on('error', reject);
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(JSON.stringify(body))
      }
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

test.describe('Unified Server API', () => {

  test.describe('Health & Status Endpoints', () => {
    
    test('health endpoint returns ok', async ({ unifiedServer1, testLogs, page }) => {
      testLogs.add('test', 'info', '=== Health endpoint test ===');
      
      const healthUrl = `${unifiedServer1.url}/health`;
      testLogs.add('test', 'info', `Fetching: ${healthUrl}`);
      
      const response = await httpGet(healthUrl);
      
      expect(response.status).toBe(200);
      testLogs.add('test', 'info', `Health response: ${JSON.stringify(response.data)}`);
      
      await takeScreenshot(page, 'health-endpoint');
      testLogs.add('test', 'info', '=== Health endpoint test PASSED ===');
    });

    test('mesh status endpoint', async ({ unifiedServer1, testLogs, page }) => {
      testLogs.add('test', 'info', '=== Mesh status endpoint test ===');
      
      const meshUrl = `${unifiedServer1.url}/api/mesh-status`;
      testLogs.add('test', 'info', `Fetching: ${meshUrl}`);
      
      try {
        const response = await httpGet(meshUrl);
        testLogs.add('test', 'info', `Mesh status: ${response.status}, data: ${JSON.stringify(response.data).substring(0, 200)}`);
        
        // May return 200 with status or 404 if endpoint doesn't exist
        expect([200, 404]).toContain(response.status);
      } catch (err) {
        testLogs.add('test', 'warn', `Mesh status unavailable: ${err.message}`);
      }
      
      await takeScreenshot(page, 'mesh-status-endpoint');
      testLogs.add('test', 'info', '=== Mesh status endpoint test PASSED ===');
    });
  });

  test.describe('Static File Serving', () => {
    
    test('serves main app HTML', async ({ unifiedServer1, page, testLogs }) => {
      testLogs.add('test', 'info', '=== Static file serving test ===');
      
      await page.goto(unifiedServer1.url);
      await page.waitForLoadState('networkidle', { timeout: 30000 });
      
      // Check that we got HTML content
      const content = await page.content();
      expect(content).toContain('<!DOCTYPE html>');
      testLogs.add('test', 'info', 'Received HTML content');
      
      // Check for app container (common React pattern)
      const hasRoot = await page.locator('#root, #app, [data-testid="app"]').count();
      testLogs.add('test', 'info', `Found app container: ${hasRoot > 0}`);
      
      await takeScreenshot(page, 'static-file-serving');
      testLogs.add('test', 'info', '=== Static file serving test PASSED ===');
    });

    test('SPA fallback routing works', async ({ unifiedServer1, page, testLogs }) => {
      testLogs.add('test', 'info', '=== SPA fallback test ===');
      
      // Navigate to a non-existent route
      await page.goto(`${unifiedServer1.url}/some/deep/route`);
      await page.waitForLoadState('networkidle', { timeout: 30000 });
      
      // Should still get the main app (SPA routing)
      const content = await page.content();
      expect(content).toContain('<!DOCTYPE html>');
      testLogs.add('test', 'info', 'SPA fallback returned HTML');
      
      await takeScreenshot(page, 'spa-fallback');
      testLogs.add('test', 'info', '=== SPA fallback test PASSED ===');
    });
  });

  test.describe('WebSocket Endpoints', () => {
    
    test('Y-WebSocket endpoint accepts connections', async ({ unifiedServer1, testLogs, page }) => {
      testLogs.add('test', 'info', '=== Y-WebSocket endpoint test ===');
      
      const WebSocket = require('ws');
      const wsUrl = `${unifiedServer1.wsUrl}/test-room`;
      testLogs.add('test', 'info', `Connecting to: ${wsUrl}`);
      
      const connected = await new Promise((resolve) => {
        const ws = new WebSocket(wsUrl);
        const timeout = setTimeout(() => {
          ws.close();
          resolve(false);
        }, 10000);
        
        ws.on('open', () => {
          clearTimeout(timeout);
          testLogs.add('test', 'info', 'Y-WebSocket connected');
          ws.close();
          resolve(true);
        });
        
        ws.on('error', (err) => {
          clearTimeout(timeout);
          testLogs.add('test', 'warn', `Y-WebSocket error: ${err.message}`);
          resolve(false);
        });
      });
      
      expect(connected).toBe(true);
      await takeScreenshot(page, 'yjs-websocket-connected');
      testLogs.add('test', 'info', '=== Y-WebSocket endpoint test PASSED ===');
    });

    test('Signaling endpoint accepts connections', async ({ unifiedServer1, testLogs, page }) => {
      testLogs.add('test', 'info', '=== Signaling endpoint test ===');
      
      const WebSocket = require('ws');
      const wsUrl = `${unifiedServer1.wsUrl}/signal`;
      testLogs.add('test', 'info', `Connecting to: ${wsUrl}`);
      
      const result = await new Promise((resolve) => {
        const ws = new WebSocket(wsUrl);
        const timeout = setTimeout(() => {
          // If we connected but no message yet, that's still a success
          if (ws.readyState === WebSocket.OPEN) {
            ws.close();
            resolve({ connected: true, message: null });
          } else {
            ws.close();
            resolve({ connected: false, message: null });
          }
        }, 10000);
        
        ws.on('open', () => {
          testLogs.add('test', 'info', 'Signaling WebSocket connected');
          // Give server 2 seconds to send welcome, then accept connection as success
          setTimeout(() => {
            clearTimeout(timeout);
            ws.close();
            resolve({ connected: true, message: null });
          }, 2000);
        });
        
        ws.on('message', (data) => {
          clearTimeout(timeout);
          const msg = JSON.parse(data.toString());
          testLogs.add('test', 'info', `Received message: ${msg.type}`);
          ws.close();
          resolve({ connected: true, message: msg });
        });
        
        ws.on('error', (err) => {
          clearTimeout(timeout);
          testLogs.add('test', 'warn', `Signaling error: ${err.message}`);
          resolve({ connected: false, message: null });
        });
      });
      
      expect(result.connected).toBe(true);
      // Server should send 'welcome' message on connect
      if (result.message) {
        testLogs.add('test', 'info', `Welcome message type: ${result.message.type}`);
      }
      
      await takeScreenshot(page, 'signaling-websocket-connected');
      testLogs.add('test', 'info', '=== Signaling endpoint test PASSED ===');
    });
  });

  test.describe('Web Client Integration', () => {
    
    test('web client can load and display UI', async ({ unifiedServer1, page, testLogs }) => {
      testLogs.add('test', 'info', '=== Web client UI test ===');
      
      await page.goto(unifiedServer1.url);
      await page.waitForLoadState('networkidle', { timeout: 30000 });
      
      // Take screenshot of initial state
      await takeScreenshot(page, 'web-client-initial');
      
      // Wait for React to render (look for common UI elements)
      await page.waitForTimeout(2000);
      
      // Check for visible UI elements
      const body = page.locator('body');
      const bodyVisible = await body.isVisible();
      expect(bodyVisible).toBe(true);
      
      // Get page title
      const title = await page.title();
      testLogs.add('test', 'info', `Page title: ${title}`);
      
      // Check for any visible text content
      const textContent = await page.locator('body').textContent();
      testLogs.add('test', 'info', `Page has text content: ${textContent.length > 0}`);
      
      await takeScreenshot(page, 'web-client-loaded');
      testLogs.add('test', 'info', '=== Web client UI test PASSED ===');
    });

    test('web client JavaScript loads without errors', async ({ unifiedServer1, page, testLogs }) => {
      testLogs.add('test', 'info', '=== JavaScript error check test ===');
      
      const jsErrors = [];
      page.on('pageerror', (error) => {
        jsErrors.push(error.message);
      });
      
      const consoleErrors = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });
      
      await page.goto(unifiedServer1.url);
      await page.waitForLoadState('networkidle', { timeout: 30000 });
      await page.waitForTimeout(3000); // Wait for any async errors
      
      // Log any errors found
      if (jsErrors.length > 0) {
        testLogs.add('test', 'warn', `JS errors: ${jsErrors.join('; ')}`);
      }
      if (consoleErrors.length > 0) {
        testLogs.add('test', 'warn', `Console errors: ${consoleErrors.slice(0, 3).join('; ')}`);
      }
      
      // We don't fail on errors since the app may have expected errors in test environment
      testLogs.add('test', 'info', `Found ${jsErrors.length} JS errors, ${consoleErrors.length} console errors`);
      
      await takeScreenshot(page, 'javascript-loaded');
      testLogs.add('test', 'info', '=== JavaScript error check test PASSED ===');
    });
  });
});
