// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * Playwright configuration for Nightjar E2E and Cross-Platform testing
 * 
 * This config supports:
 * - Cross-platform testing (Electron sidecar + Web clients)
 * - Cross-network Electron E2E tests with real network boundaries
 * - Tiered testing (smoke, matrix, full, relay)
 * - Screenshot capture on every test
 * - Video recording of test runs
 * - Console/network error capture
 * - Rich HTML reports for debugging
 * - Global setup/teardown for process management
 * 
 * Test Tiers:
 * - Tier 1 (Smoke): 30-*.spec.js - Quick validation, every PR (~2 min)
 * - Tier 2 (Matrix): 31-*.spec.js - All client combinations (~10 min)
 * - Tier 3 (Full): 32-*.spec.js - Adversarial + DHT (~20 min)
 * - Relay: 33-*.spec.js - Relay bridge specific tests
 */
module.exports = defineConfig({
  testDir: './specs',
  
  // Run tests in parallel for speed (each test is isolated)
  // Set to false for debugging or if tests interfere
  fullyParallel: process.env.E2E_PARALLEL !== 'false',
  
  // Fail the build on CI if you accidentally left test.only in the source code.
  forbidOnly: !!process.env.CI,
  
  // Retry failed tests (more retries in CI)
  retries: process.env.CI ? 2 : 1,
  
  // Parallel workers - limited to avoid resource exhaustion with Electron
  // In CI, use 1 worker for reliability. Locally, can use more.
  workers: process.env.CI ? 1 : (process.env.E2E_WORKERS ? parseInt(process.env.E2E_WORKERS) : 2),
  
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
  
  // Timeout settings - longer for cross-platform sync and Electron startup
  timeout: 180000, // 3 minutes per test (Electron startup can be slow)
  expect: {
    timeout: 15000,
  },
});
