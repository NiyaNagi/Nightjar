/**
 * Nightjar Autonomous UI Testing Loop
 * 
 * This script implements a "Ralph Wiggum"-style autonomous testing loop:
 * 1. Run Playwright E2E tests
 * 2. Capture screenshots and errors
 * 3. Analyze results and generate a report
 * 4. Output structured data for AI to review and fix
 * 
 * Usage:
 *   node tests/e2e/run-visual-test.js [--loop] [--max-iterations N]
 * 
 * The script outputs a structured report that can be fed to AI for analysis.
 * When used with --loop, it will continue running until all tests pass.
 */

import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..', '..');

// Configuration
const CONFIG = {
  maxIterations: 10,
  loop: false,
  timeout: 120000, // 2 minutes per test run
  reportDir: path.join(PROJECT_ROOT, 'tests', 'e2e-report'),
  verbose: true
};

// Parse command line args
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--loop') {
    CONFIG.loop = true;
  } else if (process.argv[i] === '--max-iterations') {
    CONFIG.maxIterations = parseInt(process.argv[++i], 10);
  } else if (process.argv[i] === '--quiet') {
    CONFIG.verbose = false;
  }
}

function log(message) {
  if (CONFIG.verbose) {
    console.log(`[Visual Test] ${message}`);
  }
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  console.log(`  ${title}`);
  console.log('='.repeat(60) + '\n');
}

/**
 * Check if Playwright is installed
 */
function checkPlaywright() {
  try {
    execSync('npx playwright --version', { cwd: PROJECT_ROOT, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install Playwright if needed
 */
function installPlaywright() {
  log('Installing Playwright...');
  execSync('npm install -D @playwright/test', { cwd: PROJECT_ROOT, stdio: 'inherit' });
  execSync('npx playwright install chromium', { cwd: PROJECT_ROOT, stdio: 'inherit' });
}

/**
 * Run Playwright tests
 */
async function runTests() {
  return new Promise((resolve, reject) => {
    const playwrightConfig = path.join(__dirname, 'playwright.config.js');
    
    const args = [
      'playwright',
      'test',
      '--config', playwrightConfig,
      '--reporter=list,html,json'
    ];
    
    log(`Running: npx ${args.join(' ')}`);
    
    const proc = spawn('npx', args, {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      shell: true
    });
    
    let timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('Test run timed out'));
    }, CONFIG.timeout);
    
    proc.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ exitCode: code });
    });
    
    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Run the analysis script
 */
async function analyzeResults() {
  const analyzeScript = path.join(__dirname, 'analyze-results.js');
  
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [analyzeScript], {
      cwd: PROJECT_ROOT,
      stdio: 'inherit'
    });
    
    proc.on('close', (code) => {
      resolve({ exitCode: code });
    });
    
    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Read the analysis report
 */
function readAnalysisReport() {
  const reportPath = path.join(CONFIG.reportDir, 'ai-analysis-report.json');
  
  if (fs.existsSync(reportPath)) {
    return JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  }
  
  return null;
}

/**
 * Generate AI prompt from the analysis
 */
function generateAIPrompt(report, iteration) {
  const prompt = {
    role: 'You are analyzing UI test results for Nightjar, a P2P collaborative text editor.',
    context: {
      iteration,
      maxIterations: CONFIG.maxIterations,
      timestamp: new Date().toISOString()
    },
    summary: report.summary,
    issues: []
  };
  
  // Add failures
  for (const failure of report.failures || []) {
    prompt.issues.push({
      type: 'test-failure',
      severity: 'high',
      title: failure.title,
      file: failure.file,
      line: failure.line,
      error: failure.error,
      screenshots: failure.attachments?.filter(a => a.contentType?.includes('image')).map(a => a.path)
    });
  }
  
  // Add console errors
  const uniqueErrors = [...new Set((report.consoleErrors || []).map(e => e.text))];
  for (const error of uniqueErrors.slice(0, 10)) {
    prompt.issues.push({
      type: 'console-error',
      severity: 'medium',
      message: error
    });
  }
  
  // Add network errors
  if (report.networkErrors?.length > 0) {
    prompt.issues.push({
      type: 'network-errors',
      severity: 'high',
      count: report.networkErrors.length,
      urls: [...new Set(report.networkErrors.map(e => e.url))].slice(0, 5)
    });
  }
  
  // Add recommendations
  prompt.recommendations = report.recommendations || [];
  
  // Instructions for AI
  prompt.instructions = `
Based on the test results above:

1. **Identify the root cause** of each failure
2. **Locate the relevant source files** that need to be modified
3. **Propose specific fixes** for each issue
4. **After fixing**, re-run tests with: npm run test:visual

Key files to investigate:
- Frontend components: frontend/src/components/
- App entry: frontend/src/App.jsx
- Styles: frontend/src/styles/ and individual .css files
- Utils: frontend/src/utils/

Screenshots are available in: tests/e2e/test-results/
HTML report: tests/e2e-report/index.html

If all tests pass (failures = 0), respond with:
EXIT_SIGNAL: true
`;

  return prompt;
}

/**
 * Save the AI prompt for review
 */
function saveAIPrompt(prompt) {
  const outputPath = path.join(CONFIG.reportDir, 'ai-prompt.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(prompt, null, 2));
  
  // Also save as readable markdown
  const mdPath = path.join(CONFIG.reportDir, 'AI_INSTRUCTIONS.md');
  let md = `# AI Analysis Instructions

**Iteration:** ${prompt.context.iteration} of ${prompt.context.maxIterations}
**Timestamp:** ${prompt.context.timestamp}

## Test Summary

| Metric | Value |
|--------|-------|
| Total | ${prompt.summary.total} |
| Passed | ${prompt.summary.passed} |
| Failed | ${prompt.summary.failed} |
| Skipped | ${prompt.summary.skipped} |

`;

  if (prompt.issues.length === 0) {
    md += `## ✅ All Tests Passed!

No issues detected. The UI is working as expected.

EXIT_SIGNAL: true
`;
  } else {
    md += `## Issues Found (${prompt.issues.length})

`;
    for (const issue of prompt.issues) {
      md += `### ${issue.severity === 'high' ? '🔴' : '🟡'} ${issue.type}

`;
      if (issue.title) md += `**Test:** ${issue.title}\n`;
      if (issue.file) md += `**File:** ${issue.file}:${issue.line || '?'}\n`;
      if (issue.error) md += `**Error:** \`${issue.error?.slice(0, 200)}\`\n`;
      if (issue.message) md += `**Message:** \`${issue.message?.slice(0, 200)}\`\n`;
      if (issue.count) md += `**Count:** ${issue.count}\n`;
      if (issue.urls) md += `**URLs:** ${issue.urls.join(', ')}\n`;
      if (issue.screenshots?.length) {
        md += `**Screenshots:** ${issue.screenshots.join(', ')}\n`;
      }
      md += '\n';
    }

    md += `## Recommendations

`;
    for (const rec of prompt.recommendations || []) {
      md += `- **${rec.type}:** ${rec.suggestion}\n`;
    }
  }

  md += `
---

${prompt.instructions}
`;

  fs.writeFileSync(mdPath, md);
  
  return { jsonPath: outputPath, mdPath };
}

/**
 * Main function
 */
async function main() {
  logSection('Nightjar Visual UI Testing');
  
  // Check/install Playwright
  if (!checkPlaywright()) {
    log('Playwright not found. Installing...');
    installPlaywright();
  }
  
  let iteration = 0;
  let allPassed = false;
  
  do {
    iteration++;
    logSection(`Test Run #${iteration} of ${CONFIG.maxIterations}`);
    
    // Run tests
    log('Running Playwright tests...');
    const testResult = await runTests().catch(err => {
      console.error('Test execution error:', err.message);
      return { exitCode: 1 };
    });
    
    log(`Tests completed with exit code: ${testResult.exitCode}`);
    
    // Analyze results
    log('Analyzing results...');
    await analyzeResults().catch(err => {
      console.error('Analysis error:', err.message);
    });
    
    // Read the analysis
    const report = readAnalysisReport();
    
    if (report) {
      allPassed = report.summary.failed === 0 && report.failures.length === 0;
      
      // Generate AI prompt
      const prompt = generateAIPrompt(report, iteration);
      const { jsonPath, mdPath } = saveAIPrompt(prompt);
      
      logSection('Analysis Complete');
      console.log(`Passed: ${report.summary.passed}/${report.summary.total}`);
      console.log(`Failed: ${report.summary.failed}`);
      console.log(`Console Errors: ${report.consoleErrors?.length || 0}`);
      console.log(`Network Errors: ${report.networkErrors?.length || 0}`);
      console.log(`Recommendations: ${report.recommendations?.length || 0}`);
      console.log(`\nAI Prompt: ${mdPath}`);
      console.log(`Full Report: ${path.join(CONFIG.reportDir, 'ANALYSIS_SUMMARY.md')}`);
      console.log(`HTML Report: ${path.join(CONFIG.reportDir, 'index.html')}`);
      
      if (allPassed) {
        logSection('✅ All Tests Passed!');
        console.log('No issues found. UI is working correctly.');
        console.log('\nEXIT_SIGNAL: true');
        break;
      } else {
        logSection('❌ Issues Found');
        console.log(`${report.failures.length} test failures detected.`);
        console.log('\nReview the AI instructions and fix the issues.');
        console.log(`Instructions: ${mdPath}`);
        
        if (!CONFIG.loop) {
          console.log('\nTo run in autonomous loop mode: node run-visual-test.js --loop');
          break;
        } else {
          console.log(`\nWaiting for fixes... (Iteration ${iteration}/${CONFIG.maxIterations})`);
          console.log('Press Ctrl+C to stop, or let the loop continue after fixes.');
          
          // In a real autonomous loop, we would wait for file changes here
          // For now, we just output the prompt and exit
          break;
        }
      }
    } else {
      console.error('Could not read analysis report.');
      break;
    }
    
  } while (CONFIG.loop && !allPassed && iteration < CONFIG.maxIterations);
  
  if (CONFIG.loop && iteration >= CONFIG.maxIterations && !allPassed) {
    logSection('⚠️ Max Iterations Reached');
    console.log('Tests did not pass within the maximum number of iterations.');
    console.log('Manual intervention may be required.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
