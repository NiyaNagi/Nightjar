// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Nahma E2E and visual testing
 * 
 * This config supports:
 * - Screenshot capture on every test
 * - Video recording of test runs
 * - Console/network error capture
 * - HTML reports for AI analysis
 */
export default defineConfig({
  testDir: './specs',
  
  // Run tests sequentially for reliable state
  fullyParallel: false,
  
  // Fail the build on CI if you accidentally left test.only in the source code.
  forbidOnly: !!process.env.CI,
  
  // Retry failed tests once
  retries: 1,
  
  // Number of workers
  workers: 1,
  
  // Reporter - HTML for visual inspection
  reporter: [
    ['html', { outputFolder: '../e2e-report', open: 'never' }],
    ['json', { outputFile: '../e2e-report/results.json' }],
    ['list']
  ],
  
  // Shared settings for all projects
  use: {
    // Base URL for your app
    baseURL: 'http://localhost:5173',
    
    // Capture screenshot on failure
    screenshot: 'on',
    
    // Record video of test runs
    video: 'on-first-retry',
    
    // Capture trace on failure (includes snapshots, console, network)
    trace: 'on-first-retry',
    
    // Viewport size
    viewport: { width: 1280, height: 720 },
    
    // Collect all console messages
    ignoreHTTPSErrors: true,
  },

  // Configure projects for major browsers
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Run your local dev server before starting the tests
  webServer: {
    command: 'cd ../.. && npm run dev:react',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },

  // Output folder for test artifacts
  outputDir: './test-results/',
  
  // Timeout settings
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
});
