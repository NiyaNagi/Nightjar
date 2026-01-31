/**
 * Nahma E2E Test Report Analyzer
 * 
 * This script analyzes Playwright test results and generates a structured report
 * that can be fed to AI for bug analysis and fixing.
 * 
 * Output: A comprehensive JSON report with:
 * - Test results and failures
 * - Screenshots paths
 * - Console errors
 * - Network failures
 * - Accessibility issues
 * - Suggested fixes
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function analyzeTestResults() {
  const reportPath = path.join(__dirname, '..', 'e2e-report', 'results.json');
  const testResultsDir = path.join(__dirname, 'test-results');
  
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: 0
    },
    failures: [],
    screenshots: [],
    consoleErrors: [],
    networkErrors: [],
    accessibilityIssues: [],
    visualIssues: [],
    recommendations: []
  };

  // Parse main results file if exists
  if (fs.existsSync(reportPath)) {
    try {
      const results = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
      
      report.summary.total = results.stats?.expected || 0;
      report.summary.passed = results.stats?.expected - (results.stats?.unexpected || 0) - (results.stats?.skipped || 0);
      report.summary.failed = results.stats?.unexpected || 0;
      report.summary.skipped = results.stats?.skipped || 0;
      report.summary.duration = results.stats?.duration || 0;

      // Process each test suite
      if (results.suites) {
        processTestSuites(results.suites, report);
      }
    } catch (e) {
      console.error('Error parsing results.json:', e.message);
    }
  }

  // Scan test-results directory for artifacts
  if (fs.existsSync(testResultsDir)) {
    scanTestArtifacts(testResultsDir, report);
  }

  // Generate recommendations based on findings
  generateRecommendations(report);

  // Write the analysis report
  const outputPath = path.join(__dirname, '..', 'e2e-report', 'ai-analysis-report.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  // Also write a human-readable markdown summary
  const markdownPath = path.join(__dirname, '..', 'e2e-report', 'ANALYSIS_SUMMARY.md');
  fs.writeFileSync(markdownPath, generateMarkdownSummary(report));

  console.log('\n=== E2E Test Analysis Report ===\n');
  console.log(`Total Tests: ${report.summary.total}`);
  console.log(`Passed: ${report.summary.passed}`);
  console.log(`Failed: ${report.summary.failed}`);
  console.log(`Skipped: ${report.summary.skipped}`);
  console.log(`Duration: ${(report.summary.duration / 1000).toFixed(2)}s`);
  console.log(`\nFailures: ${report.failures.length}`);
  console.log(`Console Errors: ${report.consoleErrors.length}`);
  console.log(`Network Errors: ${report.networkErrors.length}`);
  console.log(`Screenshots Captured: ${report.screenshots.length}`);
  console.log(`\nRecommendations: ${report.recommendations.length}`);
  console.log(`\nFull report: ${outputPath}`);
  console.log(`Summary: ${markdownPath}`);

  return report;
}

function processTestSuites(suites, report) {
  for (const suite of suites) {
    if (suite.specs) {
      for (const spec of suite.specs) {
        for (const test of spec.tests || []) {
          for (const result of test.results || []) {
            if (result.status === 'failed' || result.status === 'timedOut') {
              report.failures.push({
                title: spec.title,
                file: spec.file,
                line: spec.line,
                error: result.error?.message,
                stack: result.error?.stack,
                duration: result.duration,
                attachments: result.attachments?.map(a => ({
                  name: a.name,
                  path: a.path,
                  contentType: a.contentType
                })) || []
              });
            }
          }
        }
      }
    }
    
    // Recurse into nested suites
    if (suite.suites) {
      processTestSuites(suite.suites, report);
    }
  }
}

function scanTestArtifacts(dir, report) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      scanTestArtifacts(fullPath, report);
    } else if (entry.isFile()) {
      const relativePath = path.relative(path.join(__dirname, '..'), fullPath);
      
      if (entry.name.endsWith('.png')) {
        report.screenshots.push({
          name: entry.name,
          path: relativePath,
          test: path.basename(path.dirname(fullPath))
        });
      } else if (entry.name === 'console-messages.json') {
        try {
          const messages = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
          const errors = messages.filter(m => m.type === 'error');
          report.consoleErrors.push(...errors.map(e => ({
            ...e,
            test: path.basename(path.dirname(fullPath))
          })));
        } catch (e) {}
      } else if (entry.name === 'network-errors.json') {
        try {
          const errors = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
          report.networkErrors.push(...errors.map(e => ({
            ...e,
            test: path.basename(path.dirname(fullPath))
          })));
        } catch (e) {}
      } else if (entry.name === 'js-errors.json') {
        try {
          const errors = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
          report.consoleErrors.push(...errors.map(e => ({
            type: 'js-error',
            text: e.message,
            stack: e.stack,
            test: path.basename(path.dirname(fullPath))
          })));
        } catch (e) {}
      } else if (entry.name === 'accessibility-tree.json') {
        try {
          const tree = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
          // Check for accessibility issues
          if (!tree || Object.keys(tree).length === 0) {
            report.accessibilityIssues.push({
              type: 'empty-tree',
              message: 'Accessibility tree is empty - page may not be properly structured'
            });
          }
        } catch (e) {}
      }
    }
  }
}

function generateRecommendations(report) {
  // Analyze failures and generate recommendations
  for (const failure of report.failures) {
    if (failure.error?.includes('timeout')) {
      report.recommendations.push({
        priority: 'high',
        type: 'performance',
        issue: `Test "${failure.title}" timed out`,
        suggestion: 'Check for slow-loading components or missing elements. Consider adding loading states or optimizing renders.',
        file: failure.file,
        line: failure.line
      });
    }
    
    if (failure.error?.includes('not visible') || failure.error?.includes('not attached')) {
      report.recommendations.push({
        priority: 'high',
        type: 'element-visibility',
        issue: `Element not found in test "${failure.title}"`,
        suggestion: 'Check that the expected element is rendered. May need to add data-testid attributes or fix conditional rendering.',
        file: failure.file,
        line: failure.line
      });
    }
  }

  // Analyze console errors
  const errorTypes = new Map();
  for (const error of report.consoleErrors) {
    const key = error.text?.slice(0, 100) || 'unknown';
    if (!errorTypes.has(key)) {
      errorTypes.set(key, { count: 0, tests: [] });
    }
    errorTypes.get(key).count++;
    errorTypes.get(key).tests.push(error.test);
  }

  for (const [error, data] of errorTypes) {
    if (data.count > 1) {
      report.recommendations.push({
        priority: 'medium',
        type: 'recurring-error',
        issue: `Console error appears ${data.count} times: "${error}"`,
        suggestion: 'This error appears across multiple tests. Fix the underlying cause.',
        affectedTests: [...new Set(data.tests)]
      });
    }
  }

  // Network error recommendations
  if (report.networkErrors.length > 0) {
    const uniqueUrls = [...new Set(report.networkErrors.map(e => e.url))];
    report.recommendations.push({
      priority: 'high',
      type: 'network-failures',
      issue: `${report.networkErrors.length} network requests failed`,
      suggestion: 'Check API endpoints and network connectivity. Failed URLs: ' + uniqueUrls.slice(0, 5).join(', ')
    });
  }

  // Accessibility recommendations
  if (report.accessibilityIssues.length > 0) {
    report.recommendations.push({
      priority: 'medium',
      type: 'accessibility',
      issue: 'Accessibility issues detected',
      suggestion: 'Review and fix accessibility violations for better screen reader support and WCAG compliance.'
    });
  }
}

function generateMarkdownSummary(report) {
  let md = `# E2E Test Analysis Report

**Generated:** ${report.timestamp}

## Summary

| Metric | Value |
|--------|-------|
| Total Tests | ${report.summary.total} |
| Passed | ${report.summary.passed} |
| Failed | ${report.summary.failed} |
| Skipped | ${report.summary.skipped} |
| Duration | ${(report.summary.duration / 1000).toFixed(2)}s |

`;

  if (report.failures.length > 0) {
    md += `## ❌ Failures (${report.failures.length})

`;
    for (const failure of report.failures) {
      md += `### ${failure.title}

- **File:** ${failure.file}:${failure.line}
- **Duration:** ${failure.duration}ms
- **Error:**
\`\`\`
${failure.error || 'No error message'}
\`\`\`

`;
    }
  }

  if (report.consoleErrors.length > 0) {
    md += `## ⚠️ Console Errors (${report.consoleErrors.length})

`;
    // Group by unique error messages
    const uniqueErrors = [...new Set(report.consoleErrors.map(e => e.text))];
    for (const error of uniqueErrors.slice(0, 10)) {
      md += `- \`${error?.slice(0, 200) || 'Unknown error'}\`
`;
    }
    if (uniqueErrors.length > 10) {
      md += `- ... and ${uniqueErrors.length - 10} more
`;
    }
    md += '\n';
  }

  if (report.networkErrors.length > 0) {
    md += `## 🌐 Network Errors (${report.networkErrors.length})

`;
    const uniqueUrls = [...new Set(report.networkErrors.map(e => `${e.method} ${e.url}`))];
    for (const url of uniqueUrls.slice(0, 10)) {
      md += `- \`${url}\`
`;
    }
    md += '\n';
  }

  if (report.recommendations.length > 0) {
    md += `## 💡 Recommendations

`;
    // Sort by priority
    const sorted = report.recommendations.sort((a, b) => {
      const priority = { high: 0, medium: 1, low: 2 };
      return priority[a.priority] - priority[b.priority];
    });

    for (const rec of sorted) {
      const emoji = rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🟢';
      md += `### ${emoji} ${rec.type}

**Issue:** ${rec.issue}

**Suggestion:** ${rec.suggestion}

`;
      if (rec.file) {
        md += `**Location:** ${rec.file}:${rec.line || '?'}

`;
      }
    }
  }

  if (report.screenshots.length > 0) {
    md += `## 📸 Screenshots Captured (${report.screenshots.length})

`;
    for (const ss of report.screenshots.slice(0, 20)) {
      md += `- [${ss.name}](${ss.path}) (Test: ${ss.test})
`;
    }
    if (report.screenshots.length > 20) {
      md += `- ... and ${report.screenshots.length - 20} more
`;
    }
  }

  md += `
---

*This report can be analyzed by AI to identify and fix UI bugs.*
`;

  return md;
}

// Run if called directly
analyzeTestResults();

export { analyzeTestResults };
