#!/usr/bin/env node

/**
 * Ralph Wiggum Test Automation
 * 
 * "I'm helping! And when I help, I find bugs!"
 * 
 * This script runs all tests in a loop, identifies failures,
 * logs detailed diagnostics, and continues until all tests pass
 * or a maximum number of iterations is reached.
 * 
 * Default behavior (without flags): runs UNIT + INTEGRATION + CROSS-PLATFORM tests.
 * With --all flag: runs EVERYTHING including E2E tests.
 * 
 * IMPORTANT: npm run test:ralph uses --all flag by default to run ALL tests.
 *            Use npm run test:ralph:quick to skip E2E for faster iteration.
 * 
 * Test Suites:
 *   - Unit tests: Jest tests in tests/ folder
 *   - Integration tests: P2P, sync, and multi-client tests
 *   - Cross-platform tests: Web ↔ Electron ↔ iOS ↔ Android compatibility
 *   - E2E tests: Playwright browser tests (included with --all)
 * 
 * Usage:
 *   npm run test:ralph                      # Run ALL tests (--all flag)
 *   npm run test:ralph:quick                # Run unit + integration (faster)
 *   node scripts/ralph-wiggum.js            # Run unit + integration + cross-platform
 *   node scripts/ralph-wiggum.js --all      # Run ALL tests including E2E
 *   node scripts/ralph-wiggum.js --unit-only        # Run only unit tests
 *   node scripts/ralph-wiggum.js --include-e2e      # Include E2E tests
 *   node scripts/ralph-wiggum.js --no-integration   # Skip integration tests
 *   node scripts/ralph-wiggum.js --cross-platform   # Run only cross-platform tests
 *   node scripts/ralph-wiggum.js --seed=12345       # Run with specific fuzz seed
 *   node scripts/ralph-wiggum.js --max-iterations=5 # Limit iterations
 *   node scripts/ralph-wiggum.js --fix              # Auto-fix (lint, format)
 *   node scripts/ralph-wiggum.js --verbose          # Verbose output
 * 
 * Environment Variables:
 *   FUZZ_SEED        - Seed for fuzz testing reproducibility
 *   FUZZ_ITERATIONS  - Number of fuzz iterations per test
 *   MAX_ITERATIONS   - Maximum Ralph Wiggum loop iterations (default: 10)
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  maxIterations: parseInt(process.env.MAX_ITERATIONS || '10', 10),
  fuzzSeed: process.env.FUZZ_SEED || null,
  fuzzIterations: parseInt(process.env.FUZZ_ITERATIONS || '50', 10),
  verbose: process.argv.includes('--verbose'),
  autoFix: process.argv.includes('--fix'),
  testPattern: null, // Run all tests
  outputDir: path.join(process.cwd(), 'test-results'),
  // Test suite flags - by default run ALL tests
  includeUnit: true,
  includeIntegration: true,
  includeE2E: false, // E2E requires Playwright, opt-in only
  includeCrossPlatform: true, // Cross-platform tests included by default
  crossPlatformOnly: false, // Run only cross-platform tests
};

// Parse command line arguments
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--seed=')) {
    CONFIG.fuzzSeed = arg.split('=')[1];
  } else if (arg.startsWith('--max-iterations=')) {
    CONFIG.maxIterations = parseInt(arg.split('=')[1], 10);
  } else if (arg.startsWith('--pattern=')) {
    CONFIG.testPattern = arg.split('=')[1];
  } else if (arg === '--all') {
    // Run absolutely everything including E2E
    CONFIG.includeUnit = true;
    CONFIG.includeIntegration = true;
    CONFIG.includeE2E = true;
    CONFIG.includeCrossPlatform = true;
  } else if (arg === '--unit-only') {
    CONFIG.includeUnit = true;
    CONFIG.includeIntegration = false;
    CONFIG.includeE2E = false;
    CONFIG.includeCrossPlatform = false;
  } else if (arg === '--include-e2e') {
    CONFIG.includeE2E = true;
  } else if (arg === '--no-integration') {
    CONFIG.includeIntegration = false;
  } else if (arg === '--cross-platform') {
    // Run only cross-platform tests
    CONFIG.crossPlatformOnly = true;
    CONFIG.includeUnit = false;
    CONFIG.includeIntegration = false;
    CONFIG.includeCrossPlatform = true;
  } else if (arg === '--no-cross-platform') {
    CONFIG.includeCrossPlatform = false;
  }
}

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logHeader(message) {
  const line = '═'.repeat(60);
  console.log('');
  log(line, colors.cyan);
  log(`  ${message}`, colors.bright + colors.cyan);
  log(line, colors.cyan);
}

function logRalphQuote() {
  const quotes = [
    "I'm helping!",
    "That's where I saw the leprechaun!",
    "I'm a unittest!",
    "The doctor said I wouldn't have so many bugs if I didn't write them!",
    "My cat's breath smells like cat food... and test failures!",
    "I found a bug! It tastes like burning!",
    "When I grow up, I wanna be a principal or a caterpillar... or pass all tests!",
    "Me fail tests? That's unpossible!",
    "I bent my assertions!",
    "Tests are fun! And sometimes they break things!",
  ];
  
  const quote = quotes[Math.floor(Math.random() * quotes.length)];
  log(`\n  🧒 Ralph says: "${quote}"\n`, colors.magenta);
}

// Ensure output directory exists
function ensureOutputDir() {
  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  }
}

// Run Jest and capture results
function runTests() {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      FORCE_COLOR: '1',
      CI: 'true',
    };
    
    if (CONFIG.fuzzSeed) {
      env.FUZZ_SEED = CONFIG.fuzzSeed;
    }
    env.FUZZ_ITERATIONS = String(CONFIG.fuzzIterations);
    
    const args = [
      'test',
      '--',
      '--json',
      '--outputFile=' + path.join(CONFIG.outputDir, 'jest-results.json'),
      '--testLocationInResults',
    ];
    
    if (CONFIG.testPattern) {
      args.push(CONFIG.testPattern);
    }
    
    if (CONFIG.verbose) {
      args.push('--verbose');
    }
    
    log('\n📋 Running unit tests...', colors.blue);
    
    const proc = spawn('npm', args, {
      env,
      stdio: 'inherit',
      shell: true,
      cwd: process.cwd(),
    });
    
    proc.on('close', (code) => {
      resolve({
        exitCode: code,
        success: code === 0,
      });
    });
    
    proc.on('error', (err) => {
      log(`Error spawning tests: ${err.message}`, colors.red);
      resolve({
        exitCode: 1,
        success: false,
        error: err.message,
      });
    });
  });
}

// Run integration tests
function runIntegrationTests() {
  return new Promise((resolve) => {
    log('\n📋 Running integration tests...', colors.blue);
    
    const env = {
      ...process.env,
      FORCE_COLOR: '1',
    };
    
    if (CONFIG.verbose) {
      env.VERBOSE = '1';
    }
    
    const args = ['run', 'test:integration'];
    if (CONFIG.verbose) {
      args.push('--', '--verbose');
    }
    
    const proc = spawn('npm', args, {
      env,
      stdio: 'inherit',
      shell: true,
      cwd: process.cwd(),
    });
    
    proc.on('close', (code) => {
      resolve({
        exitCode: code,
        success: code === 0,
        type: 'integration',
      });
    });
    
    proc.on('error', (err) => {
      log(`Error spawning integration tests: ${err.message}`, colors.red);
      resolve({
        exitCode: 1,
        success: false,
        error: err.message,
        type: 'integration',
      });
    });
  });
}

// Run E2E tests (Playwright)
function runE2ETests() {
  return new Promise((resolve) => {
    log('\n📋 Running E2E tests (Playwright)...', colors.blue);
    
    const env = {
      ...process.env,
      FORCE_COLOR: '1',
    };
    
    const args = ['run', 'test:e2e'];
    
    const proc = spawn('npm', args, {
      env,
      stdio: 'inherit',
      shell: true,
      cwd: process.cwd(),
    });
    
    proc.on('close', (code) => {
      resolve({
        exitCode: code,
        success: code === 0,
        type: 'e2e',
      });
    });
    
    proc.on('error', (err) => {
      log(`Error spawning E2E tests: ${err.message}`, colors.red);
      resolve({
        exitCode: 1,
        success: false,
        error: err.message,
        type: 'e2e',
      });
    });
  });
}

// Run cross-platform tests
function runCrossPlatformTests() {
  return new Promise((resolve) => {
    log('\n📋 Running cross-platform tests...', colors.blue);
    
    const env = {
      ...process.env,
      FORCE_COLOR: '1',
    };
    
    // Run cross-platform tests via the integration test runner
    const args = [
      'tests/integration/test-runner.js',
      '--suite', 'cross-platform-sharing',
      '--no-sidecar',
    ];
    
    if (CONFIG.verbose) {
      args.push('--verbose');
    }
    
    const proc = spawn('node', args, {
      env,
      stdio: 'inherit',
      shell: true,
      cwd: process.cwd(),
    });
    
    proc.on('close', (code) => {
      resolve({
        exitCode: code,
        success: code === 0,
        type: 'cross-platform',
      });
    });
    
    proc.on('error', (err) => {
      log(`Error spawning cross-platform tests: ${err.message}`, colors.red);
      resolve({
        exitCode: 1,
        success: false,
        error: err.message,
        type: 'cross-platform',
      });
    });
  });
}

// Run all configured test suites
async function runAllTestSuites() {
  const results = {
    unit: null,
    integration: null,
    crossPlatform: null,
    e2e: null,
    allPassed: true,
  };
  
  // Cross-platform only mode
  if (CONFIG.crossPlatformOnly) {
    results.crossPlatform = await runCrossPlatformTests();
    results.allPassed = results.crossPlatform.success;
    return results;
  }
  
  // Unit tests
  if (CONFIG.includeUnit) {
    results.unit = await runTests();
    if (!results.unit.success) {
      results.allPassed = false;
    }
  }
  
  // Integration tests
  if (CONFIG.includeIntegration) {
    results.integration = await runIntegrationTests();
    if (!results.integration.success) {
      results.allPassed = false;
    }
  }
  
  // Cross-platform tests
  if (CONFIG.includeCrossPlatform) {
    results.crossPlatform = await runCrossPlatformTests();
    if (!results.crossPlatform.success) {
      results.allPassed = false;
    }
  }
  
  // E2E tests (optional)
  if (CONFIG.includeE2E) {
    results.e2e = await runE2ETests();
    if (!results.e2e.success) {
      results.allPassed = false;
    }
  }
  
  return results;
}

// Parse test results from JSON file
function parseResults() {
  const resultsPath = path.join(CONFIG.outputDir, 'jest-results.json');
  
  if (!fs.existsSync(resultsPath)) {
    return null;
  }
  
  try {
    const raw = fs.readFileSync(resultsPath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    log(`Failed to parse results: ${e.message}`, colors.red);
    return null;
  }
}

// Extract failure details from results
function extractFailures(results) {
  if (!results || !results.testResults) {
    return [];
  }
  
  const failures = [];
  
  for (const suite of results.testResults) {
    for (const test of suite.assertionResults) {
      if (test.status === 'failed') {
        failures.push({
          file: path.relative(process.cwd(), suite.name),
          test: test.fullName,
          title: test.title,
          duration: test.duration,
          failureMessages: test.failureMessages,
          location: test.location,
        });
      }
    }
  }
  
  return failures;
}

// Generate failure report
function generateFailureReport(failures, iteration) {
  const reportPath = path.join(CONFIG.outputDir, `failures-iteration-${iteration}.md`);
  
  let report = `# Test Failures - Iteration ${iteration}\n\n`;
  report += `Generated: ${new Date().toISOString()}\n\n`;
  
  if (failures.length === 0) {
    report += '✅ No failures!\n';
  } else {
    report += `❌ ${failures.length} failure(s) found:\n\n`;
    
    for (const failure of failures) {
      report += `## ${failure.test}\n\n`;
      report += `- **File:** ${failure.file}\n`;
      if (failure.location) {
        report += `- **Line:** ${failure.location.line}\n`;
      }
      report += `- **Duration:** ${failure.duration}ms\n\n`;
      report += '### Error:\n\n```\n';
      report += failure.failureMessages.join('\n\n');
      report += '\n```\n\n---\n\n';
    }
  }
  
  fs.writeFileSync(reportPath, report);
  return reportPath;
}

// Run auto-fix commands
function runAutoFix() {
  log('\n🔧 Running auto-fix...', colors.yellow);
  
  const fixCommands = [
    { name: 'ESLint Fix', cmd: 'npm run lint -- --fix', optional: true },
    { name: 'Prettier', cmd: 'npx prettier --write "frontend/src/**/*.{js,jsx}"', optional: true },
  ];
  
  for (const { name, cmd, optional } of fixCommands) {
    try {
      log(`  Running ${name}...`, colors.blue);
      execSync(cmd, { stdio: CONFIG.verbose ? 'inherit' : 'pipe', cwd: process.cwd() });
      log(`  ✅ ${name} complete`, colors.green);
    } catch (e) {
      if (!optional) {
        log(`  ❌ ${name} failed: ${e.message}`, colors.red);
      } else {
        log(`  ⚠️ ${name} skipped (not configured)`, colors.yellow);
      }
    }
  }
}

// Generate summary report
function generateSummary(history) {
  const summaryPath = path.join(CONFIG.outputDir, 'ralph-wiggum-summary.md');
  
  let summary = `# Ralph Wiggum Test Summary\n\n`;
  summary += `Generated: ${new Date().toISOString()}\n\n`;
  summary += `## Configuration\n\n`;
  summary += `- Fuzz Seed: ${CONFIG.fuzzSeed || 'random'}\n`;
  summary += `- Fuzz Iterations: ${CONFIG.fuzzIterations}\n`;
  summary += `- Max Loop Iterations: ${CONFIG.maxIterations}\n`;
  summary += `- Auto-fix: ${CONFIG.autoFix}\n`;
  summary += `- Unit Tests: ${CONFIG.includeUnit ? 'Enabled' : 'Disabled'}\n`;
  summary += `- Integration Tests: ${CONFIG.includeIntegration ? 'Enabled' : 'Disabled'}\n`;
  summary += `- Cross-Platform Tests: ${CONFIG.includeCrossPlatform ? 'Enabled' : 'Disabled'}\n`;
  summary += `- E2E Tests: ${CONFIG.includeE2E ? 'Enabled' : 'Disabled'}\n\n`;
  
  summary += `## Iterations\n\n`;
  summary += `| # | Unit Tests | Unit Passed | Unit Failed | Integration | Cross-Platform | E2E | Duration |\n`;
  summary += `|---|------------|-------------|-------------|-------------|----------------|-----|----------|\n`;
  
  for (const entry of history) {
    const intStatus = entry.integrationPassed ? '✅' : '❌';
    const crossStatus = entry.crossPlatformPassed ? '✅' : (CONFIG.includeCrossPlatform ? '❌' : '-');
    const e2eStatus = entry.e2ePassed ? '✅' : (CONFIG.includeE2E ? '❌' : '-');
    summary += `| ${entry.iteration} | ${entry.numTotalTests} | ${entry.numPassedTests} | ${entry.numFailedTests} | ${intStatus} | ${crossStatus} | ${e2eStatus} | ${entry.duration}s |\n`;
  }
  
  summary += `\n## Final Result\n\n`;
  const lastEntry = history[history.length - 1];
  if (lastEntry && lastEntry.allSuitesPassed) {
    summary += `✅ **ALL TESTS PASSING** after ${history.length} iteration(s)\n`;
  } else {
    const failedSuites = [];
    if (!lastEntry?.unitPassed) failedSuites.push('Unit');
    if (!lastEntry?.integrationPassed) failedSuites.push('Integration');
    if (!lastEntry?.crossPlatformPassed && CONFIG.includeCrossPlatform) failedSuites.push('Cross-Platform');
    if (!lastEntry?.e2ePassed && CONFIG.includeE2E) failedSuites.push('E2E');
    summary += `❌ **Tests still failing** after ${history.length} iteration(s)\n`;
    summary += `Failed suites: ${failedSuites.join(', ') || 'Unknown'}\n`;
  }
  
  fs.writeFileSync(summaryPath, summary);
  log(`\n📄 Summary saved to: ${summaryPath}`, colors.blue);
  
  return summaryPath;
}

// Main Ralph Wiggum loop
async function ralphWiggumLoop() {
  ensureOutputDir();
  
  logHeader('🧒 RALPH WIGGUM TEST AUTOMATION 🧒');
  logRalphQuote();
  
  log(`Configuration:`, colors.cyan);
  log(`  • Max iterations: ${CONFIG.maxIterations}`);
  log(`  • Fuzz seed: ${CONFIG.fuzzSeed || 'random'}`);
  log(`  • Auto-fix: ${CONFIG.autoFix}`);
  log(`  • Output dir: ${CONFIG.outputDir}`);
  log(`  • Unit tests: ${CONFIG.includeUnit ? '✅' : '❌'}`);
  log(`  • Integration tests: ${CONFIG.includeIntegration ? '✅' : '❌'}`);
  log(`  • Cross-platform tests: ${CONFIG.includeCrossPlatform ? '✅' : '❌'}`);
  log(`  • E2E tests: ${CONFIG.includeE2E ? '✅' : '❌'}`);
  
  const history = [];
  let allPassed = false;
  
  for (let iteration = 1; iteration <= CONFIG.maxIterations; iteration++) {
    logHeader(`ITERATION ${iteration} of ${CONFIG.maxIterations}`);
    
    // Run auto-fix if enabled
    if (CONFIG.autoFix && iteration > 1) {
      runAutoFix();
    }
    
    // Run all configured test suites
    const startTime = Date.now();
    const suiteResults = await runAllTestSuites();
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    // Parse unit test results (for detailed failure tracking)
    const results = CONFIG.includeUnit ? parseResults() : null;
    const failures = results ? extractFailures(results) : [];
    
    // Aggregate results
    const numTotalTests = results?.numTotalTests || 0;
    const numPassedTests = results?.numPassedTests || 0;
    const numFailedTests = results?.numFailedTests || 0;
    
    // Record history
    history.push({
      iteration,
      numTotalTests,
      numPassedTests,
      numFailedTests,
      duration,
      unitPassed: suiteResults.unit?.success ?? true,
      integrationPassed: suiteResults.integration?.success ?? true,
      crossPlatformPassed: suiteResults.crossPlatform?.success ?? true,
      e2ePassed: suiteResults.e2e?.success ?? true,
      allSuitesPassed: suiteResults.allPassed,
    });
    
    // Log iteration summary
    console.log('');
    log(`📊 Iteration ${iteration} Results:`, colors.bright);
    
    if (CONFIG.includeUnit) {
      log(`   Unit Tests: ${numTotalTests} total, ${numPassedTests} passed, ${numFailedTests} failed`, 
        suiteResults.unit?.success ? colors.green : colors.red);
    }
    if (CONFIG.includeIntegration) {
      log(`   Integration Tests: ${suiteResults.integration?.success ? '✅ PASSED' : '❌ FAILED'}`, 
        suiteResults.integration?.success ? colors.green : colors.red);
    }
    if (CONFIG.includeCrossPlatform) {
      log(`   Cross-Platform Tests: ${suiteResults.crossPlatform?.success ? '✅ PASSED' : '❌ FAILED'}`, 
        suiteResults.crossPlatform?.success ? colors.green : colors.red);
    }
    if (CONFIG.includeE2E) {
      log(`   E2E Tests: ${suiteResults.e2e?.success ? '✅ PASSED' : '❌ FAILED'}`, 
        suiteResults.e2e?.success ? colors.green : colors.red);
    }
    log(`   Duration: ${duration}s`, colors.blue);
    
    // Generate failure report for unit tests
    if (failures.length > 0) {
      const reportPath = generateFailureReport(failures, iteration);
      log(`\n📝 Unit test failure report: ${reportPath}`, colors.yellow);
      
      // Show first few failures
      log('\n❌ Failed unit tests:', colors.red);
      for (const failure of failures.slice(0, 5)) {
        log(`   • ${failure.test}`, colors.red);
        if (failure.location) {
          log(`     at ${failure.file}:${failure.location.line}`, colors.yellow);
        }
      }
      if (failures.length > 5) {
        log(`   ... and ${failures.length - 5} more`, colors.red);
      }
    }
    
    // Check if all suites passed
    if (suiteResults.allPassed) {
      allPassed = true;
      logHeader('🎉 ALL TESTS PASSED! 🎉');
      logRalphQuote();
      break;
    }
    
    if (iteration < CONFIG.maxIterations) {
      log(`\n⏳ Preparing for next iteration...`, colors.yellow);
      logRalphQuote();
    }
  }
  
  // Generate final summary
  const summaryPath = generateSummary(history);
  
  // Final status
  console.log('');
  if (allPassed) {
    log('═══════════════════════════════════════════════════════════', colors.green);
    log('  ✅ SUCCESS: All tests passed!', colors.bright + colors.green);
    log('═══════════════════════════════════════════════════════════', colors.green);
    process.exit(0);
  } else {
    log('═══════════════════════════════════════════════════════════', colors.red);
    log(`  ❌ FAILURE: Tests still failing after ${CONFIG.maxIterations} iterations`, colors.bright + colors.red);
    log('  Review the failure reports in test-results/', colors.red);
    log('═══════════════════════════════════════════════════════════', colors.red);
    process.exit(1);
  }
}

// Run the loop
ralphWiggumLoop().catch((err) => {
  log(`\n💥 Ralph Wiggum crashed: ${err.message}`, colors.red);
  console.error(err);
  process.exit(1);
});
