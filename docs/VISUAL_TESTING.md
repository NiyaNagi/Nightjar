# Visual UI Testing for Nightjar

This document explains the autonomous visual UI testing system that allows AI to inspect, reason over, and fix UI bugs.

## Overview

Inspired by the "Ralph Wiggum" testing approach, this system creates an autonomous loop where:

1. **Playwright runs E2E tests** against the actual UI
2. **Screenshots and errors are captured** at every interaction
3. **A structured report is generated** for AI analysis
4. **AI reviews the report**, identifies bugs, and fixes them
5. **Tests run again** until all issues are resolved

## Quick Start

### Install Dependencies

```bash
# Install Playwright
npm install -D @playwright/test

# Install Chromium browser for testing
npx playwright install chromium
```

### Run Tests

```bash
# Run visual tests once (recommended first run)
npm run test:visual

# Run tests in interactive UI mode (great for debugging)
npm run test:e2e:ui

# View the HTML report with screenshots
npm run test:e2e:report
```

## How It Works

### 1. UI Crawler (`specs/ui-crawler.spec.js`)

The UI crawler automatically:
- Navigates through all major UI elements
- Clicks buttons, opens modals, tests navigation
- Captures screenshots at every state
- Logs console errors, network failures, and JS exceptions
- Tests responsive layouts (mobile, tablet, desktop)
- Checks accessibility (ARIA labels, keyboard navigation)

### 2. Fixtures (`fixtures.js`)

Extended Playwright fixtures that:
- Capture all console messages (info, warn, error)
- Track network request failures
- Record JavaScript exceptions
- Save diagnostics to JSON files for analysis

### 3. Report Analyzer (`analyze-results.js`)

Processes test results and generates:
- `ai-analysis-report.json` - Machine-readable full report
- `ANALYSIS_SUMMARY.md` - Human-readable summary
- `AI_INSTRUCTIONS.md` - Specific instructions for AI to fix issues

### 4. Test Runner (`run-visual-test.js`)

Orchestrates the complete testing loop:
- Checks/installs Playwright
- Runs all E2E tests
- Generates analysis reports
- Outputs AI-readable prompts

## Output Files

After running tests, you'll find these files in `tests/e2e-report/`:

| File | Description |
|------|-------------|
| `index.html` | Interactive HTML report with screenshots |
| `results.json` | Raw Playwright results |
| `ai-analysis-report.json` | Structured report for AI |
| `ANALYSIS_SUMMARY.md` | Human-readable summary |
| `AI_INSTRUCTIONS.md` | Instructions for AI to fix issues |

Screenshots are saved in `tests/e2e/test-results/`.

## Using with AI (VS Code Copilot)

### Workflow

1. **Run tests**: `npm run test:visual`
2. **Review the report**: Open `tests/e2e-report/AI_INSTRUCTIONS.md`
3. **Ask Copilot to fix**: "Fix the UI bugs identified in the visual test report"
4. **Run tests again**: `npm run test:visual`
5. **Repeat** until all tests pass

### Example Prompt

```
I just ran npm run test:visual and got failures. 
Please read tests/e2e-report/AI_INSTRUCTIONS.md and fix all the identified issues.
After fixing, run the tests again to verify.
```

### What AI Can Analyze

- **Test failures**: Which tests failed and why
- **Console errors**: JavaScript errors appearing in the console
- **Network failures**: Failed API calls or resource loads
- **Screenshots**: Visual state at each test step
- **Accessibility issues**: Missing labels, keyboard navigation problems
- **Recommendations**: Prioritized suggestions for fixes

## Adding New Tests

### Test for a Specific Component

```javascript
// tests/e2e/specs/my-component.spec.js
import { test, expect, captureScreen } from '../fixtures.js';

test.describe('My Component', () => {
  test('should render correctly', async ({ page }, testInfo) => {
    await page.goto('/');
    
    const component = page.locator('[data-testid="my-component"]');
    await expect(component).toBeVisible();
    
    await captureScreen(page, 'my-component-visible', testInfo);
  });
});
```

### Adding data-testid Attributes

For reliable test selectors, add `data-testid` to your components:

```jsx
// In your React component
<button data-testid="submit-button">Submit</button>
```

Then in tests:
```javascript
const button = page.locator('[data-testid="submit-button"]');
```

## Configuration

Edit `tests/e2e/playwright.config.js` to customize:

```javascript
export default defineConfig({
  // Change the base URL
  use: {
    baseURL: 'http://localhost:5173',
  },
  
  // Adjust timeouts
  timeout: 30000,
  
  // Change screenshot behavior
  use: {
    screenshot: 'only-on-failure', // or 'on' for all
    video: 'on-first-retry',
  },
});
```

## Troubleshooting

### Tests Timeout on First Run

The dev server needs time to start. Increase the webServer timeout:

```javascript
webServer: {
  timeout: 180 * 1000, // 3 minutes
},
```

### Browser Not Found

Install the browser:
```bash
npx playwright install chromium
```

### Network Errors in Tests

The app may need the backend running. Start it separately:
```bash
# Terminal 1: Start backend
npm run relay

# Terminal 2: Run tests
npm run test:visual
```

### Screenshots Not Capturing

Ensure the `screenshot` option is enabled in the config and that tests are using `captureScreen()` helper.

## Integration with CI/CD

Add to your GitHub Actions workflow:

```yaml
- name: Install Playwright
  run: npx playwright install --with-deps chromium

- name: Run E2E Tests
  run: npm run test:e2e

- name: Upload Report
  uses: actions/upload-artifact@v4
  if: always()
  with:
    name: playwright-report
    path: tests/e2e-report/
```

## Files Structure

```
tests/e2e/
├── playwright.config.js    # Playwright configuration
├── fixtures.js             # Extended test fixtures
├── run-visual-test.js      # Main test runner script
├── analyze-results.js      # Report analyzer
├── specs/                  # Test specifications
│   └── ui-crawler.spec.js  # Main UI crawler test
└── test-results/           # Test artifacts (screenshots, logs)

tests/e2e-report/           # Generated reports
├── index.html              # Interactive HTML report
├── results.json            # Raw results
├── ai-analysis-report.json # AI-readable report
├── ANALYSIS_SUMMARY.md     # Human summary
└── AI_INSTRUCTIONS.md      # AI fix instructions
```

## Philosophy

This system implements the "Ralph Wiggum" testing pattern:

> "The technique is deterministically bad in an undeterministic world. It's better to fail predictably than succeed unpredictably."

Instead of manually reviewing each UI interaction, you:
1. Define success criteria (tests pass, no console errors)
2. Let the system iterate toward correctness
3. Use AI to analyze failures and propose fixes
4. Repeat until done

The goal is **code while you sleep** - run tests, get a report, fix issues, repeat until the UI works perfectly.
