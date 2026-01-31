/**
 * Test Runner Utilities
 * 
 * Provides utilities for running test suites with consistent output,
 * timing, and error handling.
 */

const { retryOnFlake, timedLog, measureTime } = require('./test-stability');
const { PortAllocator } = require('./port-allocator');

// Global port allocator for test isolation
let globalPortAllocator = null;

/**
 * Get or create the global port allocator
 */
function getPortAllocator() {
    if (!globalPortAllocator) {
        globalPortAllocator = new PortAllocator(18000, 19000);
    }
    return globalPortAllocator;
}

/**
 * Check if a flag is present in command line arguments
 */
function hasFlag(flag) {
    return process.argv.includes(flag);
}

/**
 * Parse command line arguments
 */
function parseArgs() {
    return {
        parallel: hasFlag('--parallel'),
        stress: hasFlag('--stress'),
        chaos: hasFlag('--chaos'),
        traceAll: hasFlag('--trace-all'),
        verbose: hasFlag('--verbose') || hasFlag('-v'),
        filter: getArgValue('--filter'),
        timeout: parseInt(getArgValue('--timeout') || '30000', 10),
        retries: parseInt(getArgValue('--retries') || '2', 10),
    };
}

/**
 * Get value of a command line argument
 */
function getArgValue(name) {
    const idx = process.argv.findIndex(arg => arg === name || arg.startsWith(`${name}=`));
    if (idx === -1) return null;
    
    const arg = process.argv[idx];
    if (arg.includes('=')) {
        return arg.split('=')[1];
    }
    return process.argv[idx + 1];
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    return `${(ms / 60000).toFixed(2)}m`;
}

/**
 * Format test result for console output
 */
function formatResult(name, passed, duration, error = null) {
    const icon = passed ? '✓' : '✗';
    const color = passed ? '\x1b[32m' : '\x1b[31m';
    const reset = '\x1b[0m';
    
    let output = `${color}${icon}${reset} ${name} (${formatDuration(duration)})`;
    
    if (error && !passed) {
        output += `\n    ${error.message}`;
        if (error.stack) {
            const stackLines = error.stack.split('\n').slice(1, 4);
            output += '\n    ' + stackLines.map(l => l.trim()).join('\n    ');
        }
    }
    
    return output;
}

/**
 * Run a single test with timing and error handling
 */
async function runTest(test, options = {}) {
    const { timeout = 30000, retries = 2, verbose = false } = options;
    
    const startTime = Date.now();
    let lastError = null;
    
    // Wrap with retry logic
    const runWithRetry = async (attemptNumber) => {
        try {
            await Promise.race([
                test.fn(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)
                ),
            ]);
            return true;
        } catch (error) {
            lastError = error;
            if (attemptNumber < retries && error.message.includes('flaky')) {
                if (verbose) {
                    console.log(`    Retrying (attempt ${attemptNumber + 1}/${retries})...`);
                }
                return runWithRetry(attemptNumber + 1);
            }
            return false;
        }
    };
    
    const passed = await runWithRetry(1);
    const duration = Date.now() - startTime;
    
    return {
        name: test.name,
        passed,
        duration,
        error: lastError,
    };
}

/**
 * Run a test suite
 */
async function runTestSuite(suite, options = {}) {
    const args = parseArgs();
    const opts = { ...args, ...options };
    
    // Check if suite requires a flag
    if (suite.requiresFlag && !hasFlag(suite.requiresFlag)) {
        console.log(`\n⏭  Skipping ${suite.name} (requires ${suite.requiresFlag})`);
        return {
            name: suite.name,
            skipped: true,
            tests: [],
        };
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ${suite.name}`);
    console.log(`${'='.repeat(60)}`);
    
    const results = [];
    const startTime = Date.now();
    
    // Filter tests if specified
    let tests = suite.tests;
    if (opts.filter) {
        const pattern = new RegExp(opts.filter, 'i');
        tests = tests.filter(t => pattern.test(t.name));
        console.log(`  Filtered to ${tests.length} tests matching "${opts.filter}"\n`);
    }
    
    // Run tests
    for (const test of tests) {
        const testTimeout = test.timeout || opts.timeout;
        const result = await runTest(test, { 
            timeout: testTimeout, 
            retries: opts.retries,
            verbose: opts.verbose,
        });
        
        results.push(result);
        console.log(formatResult(result.name, result.passed, result.duration, result.error));
    }
    
    const totalDuration = Date.now() - startTime;
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    
    console.log(`\n${'-'.repeat(60)}`);
    console.log(`  Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
    console.log(`  Duration: ${formatDuration(totalDuration)}`);
    console.log(`${'-'.repeat(60)}\n`);
    
    return {
        name: suite.name,
        skipped: false,
        total: results.length,
        passed,
        failed,
        duration: totalDuration,
        tests: results,
    };
}

/**
 * Run multiple test suites
 */
async function runAllSuites(suites, options = {}) {
    const results = [];
    const startTime = Date.now();
    
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║            Multi-Client E2E Test Runner                    ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    
    for (const suite of suites) {
        const result = await runTestSuite(suite, options);
        results.push(result);
    }
    
    const totalDuration = Date.now() - startTime;
    
    // Summary
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                     SUMMARY                                ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    
    let totalPassed = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    
    for (const result of results) {
        if (result.skipped) {
            totalSkipped++;
            console.log(`║ ⏭  ${result.name.padEnd(50)} SKIPPED ║`);
        } else {
            totalPassed += result.passed;
            totalFailed += result.failed;
            const status = result.failed === 0 ? '✓' : '✗';
            const statusColor = result.failed === 0 ? '\x1b[32m' : '\x1b[31m';
            console.log(`║ ${statusColor}${status}\x1b[0m  ${result.name.padEnd(46)} ${result.passed}/${result.total} ║`);
        }
    }
    
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║  Tests:    ${totalPassed} passed, ${totalFailed} failed, ${totalSkipped} skipped`.padEnd(60) + '║');
    console.log(`║  Duration: ${formatDuration(totalDuration)}`.padEnd(60) + '║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    
    // Exit with error code if any tests failed
    if (totalFailed > 0) {
        process.exitCode = 1;
    }
    
    return {
        suites: results,
        totalPassed,
        totalFailed,
        totalSkipped,
        duration: totalDuration,
    };
}

/**
 * Create a test suite from a collection of tests
 */
function createSuite(name, tests, options = {}) {
    return {
        name,
        tests,
        requiresFlag: options.requiresFlag,
    };
}

/**
 * Wait for process cleanup
 */
async function cleanup() {
    // Allow time for all connections to close
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Clean up port allocator
    if (globalPortAllocator) {
        try {
            // Release any held ports
        } catch (e) {
            // Ignore cleanup errors
        }
    }
}

/**
 * Register cleanup handlers
 */
function registerCleanupHandlers() {
    process.on('exit', () => {
        cleanup();
    });
    
    process.on('SIGINT', () => {
        console.log('\nInterrupted, cleaning up...');
        cleanup().then(() => process.exit(130));
    });
    
    process.on('SIGTERM', () => {
        cleanup().then(() => process.exit(143));
    });
    
    process.on('uncaughtException', (error) => {
        console.error('Uncaught exception:', error);
        cleanup().then(() => process.exit(1));
    });
    
    process.on('unhandledRejection', (reason) => {
        console.error('Unhandled rejection:', reason);
        cleanup().then(() => process.exit(1));
    });
}

// Register handlers on module load
registerCleanupHandlers();

module.exports = {
    runTestSuite,
    runAllSuites,
    createSuite,
    parseArgs,
    hasFlag,
    getArgValue,
    formatDuration,
    formatResult,
    getPortAllocator,
    cleanup,
};
