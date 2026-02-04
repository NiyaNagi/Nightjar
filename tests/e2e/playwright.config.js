// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * Playwright configuration for Nahma E2E and Cross-Platform testing
 * 
 * This config supports:
 * - Cross-platform testing (Electron sidecar + Web clients)
 * - Screenshot capture on every test
 * - Video recording of test runs
 * - Console/network error capture
 * - Rich HTML reports for debugging
 * - Global setup/teardown for process management
 */
module.exports = defineConfig({
  testDir: './specs',
  
  // Run tests sequentially for reliable state and process management
  fullyParallel: false,
  
  // Fail the build on CI if you accidentally left test.only in the source code.
  forbidOnly: !!process.env.CI,
  
  // Retry failed tests (more retries in CI)
  retries: process.env.CI ? 2 : 1,
  
  // Single worker for consistent state across cross-platform tests
  workers: 1,
  
  // Rich reporting
  reporter: [
    ['html', { outputFolder: './test-results/html-report', open: 'never' }],
    ['json', { outputFile: './test-results/results.json' }],
    ['list']
  ],
  
  // Global setup/teardown for process orchestration
  globalSetup: require.resolve('./fixtures/global-setup.js'),
  globalTeardown: require.resolve('./fixtures/global-teardown.js'),
  
  // Shared settings for all projects
  use: {
    // Base URL - unified server on port 3000
    baseURL: 'http://localhost:3000',
    
    // Always capture screenshots (helps with debugging)
    screenshot: 'on',
    
    // Record video on failure
    video: 'retain-on-failure',
    
    // Capture trace on failure (includes snapshots, console, network)
    trace: 'retain-on-failure',
    
    // Viewport size
    viewport: { width: 1280, height: 720 },
    
    // Accept self-signed certs for WSS testing
    ignoreHTTPSErrors: true,
    
    // Action timeout
    actionTimeout: 10000,
  },

  // Configure projects - chromium only for faster testing
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // No webServer - we manage processes via orchestrator
  // Tests will start unified servers and sidecars as needed
  
  // Output folder for test artifacts
  outputDir: './test-results/artifacts',
  
  // Timeout settings - longer for cross-platform sync
  timeout: 120000,
  expect: {
    timeout: 15000,
  },
});
