/**
 * Nightjar Integration Test Runner
 * 
 * This is the main entry point for the Ralph Wiggum autonomous testing loop.
 * It runs all integration tests and outputs machine-parseable results.
 * 
 * Usage:
 *   node tests/integration/test-runner.js [--suite <name>] [--verbose] [--no-sidecar]
 * 
 * Exit Codes:
 *   0 - All tests passed
 *   1 - Some tests failed
 *   2 - Test infrastructure error
 * 
 * Output Format:
 *   The runner outputs JSON results that can be parsed by the Ralph loop
 *   to determine if fixes are needed.
 * 
 * RALPH_STATUS Block:
 *   The final output includes a RALPH_STATUS block for Ralph Wiggum integration.
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const net = require('net');

// Import test suites
const MultiClientTests = require('./multi-client.test.js');
const ShareLinkTests = require('./share-links.test.js');
const ConflictResolutionTests = require('./conflict-resolution.test.js');
const SecurityTests = require('./security.test.js');
const NetworkResilienceTests = require('./network-resilience.test.js');

// Advanced integration test suites
const NetworkBoundaryTests = require('./network-boundary.test.js');
const PermissionRevocationTests = require('./permission-revocation.test.js');
const DeletionLifecycleTests = require('./deletion-lifecycle.test.js');
const RaceConditionTests = require('./race-conditions.test.js');

// Sheet (Spreadsheet) tests
const SheetSyncTests = require('./sheet-sync.test.js');

// New E2E Multi-Client Test Suites
const TextSyncE2ETests = require('./text-sync-e2e.test.js');
const WorkspacePresenceE2ETests = require('./workspace-presence-e2e.test.js');
const SheetSyncE2ETests = require('./sheet-sync-e2e.test.js');
const KanbanSyncE2ETests = require('./kanban-sync-e2e.test.js');
const CollaborationE2ETests = require('./collaboration-features-e2e.test.js');
const StressE2ETests = require('./stress-e2e.test.js');
const ChaosE2ETests = require('./chaos-e2e.test.js');

// Unit test suites
const CryptoTests = require('./crypto.test.js');
const IdentityTests = require('./identity.test.js');
const HyperswarmTests = require('./hyperswarm.test.js');
const RelayServerTests = require('./relay-server.test.js');
const ExportUtilsTests = require('./export-utils.test.js');
const PlatformTests = require('./platform.test.js');
const QRCodeTests = require('./qrcode.test.js');
const MobileP2PTests = require('./mobile-p2p.test.js');
const AwarenessTests = require('./awareness.test.js');
const FolderHierarchyTests = require('./folder-hierarchy.test.js');
const PermissionsTests = require('./permissions.test.js');
const UndoRedoTests = require('./undo-redo.test.js');
const LargeDocumentsTests = require('./large-documents.test.js');

// Cross-platform test suites
const CrossPlatformSharingTests = require('./cross-platform-sharing.test.js');
const CrossPlatformSyncTests = require('./cross-platform-sync.test.js');

// Parse CLI args
const args = process.argv.slice(2);
const verbose = args.includes('--verbose') || args.includes('-v');
const noSidecar = args.includes('--no-sidecar');
const suiteArg = args.indexOf('--suite');
const selectedSuite = suiteArg !== -1 ? args[suiteArg + 1] : null;

// Sidecar management
let sidecarProcess = null;
const SIDECAR_PATH = path.join(__dirname, '../../sidecar/index.js');
const YJS_PORT = 8080;
const META_PORT = 8081;

/**
 * Check if a port is in use
 */
async function isPortInUse(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(true));
        server.once('listening', () => {
            server.close();
            resolve(false);
        });
        server.listen(port);
    });
}

/**
 * Wait for a port to become available
 */
async function waitForPort(port, timeout = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (await isPortInUse(port)) {
            return true;
        }
        await new Promise(r => setTimeout(r, 200));
    }
    return false;
}

/**
 * Start the sidecar if not running
 */
async function ensureSidecar() {
    if (noSidecar) {
        console.log('\n⏭️  Skipping sidecar start (--no-sidecar flag)');
        return true;
    }

    // Check if sidecar is already running
    const yjsRunning = await isPortInUse(YJS_PORT);
    const metaRunning = await isPortInUse(META_PORT);

    if (yjsRunning && metaRunning) {
        console.log('\n✅ Sidecar already running');
        return true;
    }

    console.log('\n🚀 Starting sidecar...');

    return new Promise((resolve) => {
        sidecarProcess = spawn('node', [SIDECAR_PATH], {
            cwd: path.join(__dirname, '../..'),
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false,
        });

        let started = false;

        sidecarProcess.stdout.on('data', (data) => {
            const output = data.toString();
            if (verbose) {
                console.log(`  [sidecar] ${output.trim()}`);
            }
            if (output.includes('Metadata WebSocket server listening')) {
                started = true;
            }
        });

        sidecarProcess.stderr.on('data', (data) => {
            if (verbose) {
                console.error(`  [sidecar:err] ${data.toString().trim()}`);
            }
        });

        sidecarProcess.on('error', (err) => {
            console.error(`❌ Failed to start sidecar: ${err.message}`);
            resolve(false);
        });

        sidecarProcess.on('exit', (code) => {
            if (!started && code !== 0) {
                console.error(`❌ Sidecar exited with code ${code}`);
            }
        });

        // Wait for sidecar to be ready
        const checkReady = async () => {
            const timeout = 15000;
            const start = Date.now();
            
            while (Date.now() - start < timeout) {
                if (started || (await isPortInUse(YJS_PORT) && await isPortInUse(META_PORT))) {
                    console.log('✅ Sidecar started successfully');
                    // Give it a moment to fully initialize
                    await new Promise(r => setTimeout(r, 500));
                    resolve(true);
                    return;
                }
                await new Promise(r => setTimeout(r, 200));
            }
            
            console.error('❌ Sidecar failed to start within timeout');
            stopSidecar();
            resolve(false);
        };

        checkReady();
    });
}

/**
 * Stop the sidecar if we started it
 */
function stopSidecar() {
    if (sidecarProcess) {
        console.log('\n🛑 Stopping sidecar...');
        sidecarProcess.kill('SIGTERM');
        sidecarProcess = null;
    }
}

// Test registry
const TEST_SUITES = {
    'multi-client': MultiClientTests,
    'share-links': ShareLinkTests,
    'conflict-resolution': ConflictResolutionTests,
    'security': SecurityTests,
    'network-resilience': NetworkResilienceTests,
    // Advanced integration test suites
    'network-boundary': NetworkBoundaryTests,
    'permission-revocation': PermissionRevocationTests,
    'deletion-lifecycle': DeletionLifecycleTests,
    'race-conditions': RaceConditionTests,
    // Sheet (Spreadsheet) tests
    'sheet-sync': SheetSyncTests,
    // New E2E Multi-Client Test Suites
    'e2e-text-sync': TextSyncE2ETests,
    'e2e-workspace-presence': WorkspacePresenceE2ETests,
    'e2e-sheet-sync': SheetSyncE2ETests,
    'e2e-kanban-sync': KanbanSyncE2ETests,
    'e2e-collaboration': CollaborationE2ETests,
    'e2e-stress': StressE2ETests,        // Requires --stress flag
    'e2e-chaos': ChaosE2ETests,          // Requires --chaos flag
    // Unit test suites
    'crypto': CryptoTests,
    'identity': IdentityTests,
    'hyperswarm': HyperswarmTests,
    'relay-server': RelayServerTests,
    'export-utils': ExportUtilsTests,
    'platform': PlatformTests,
    'qrcode': QRCodeTests,
    'mobile-p2p': MobileP2PTests,
    'awareness': AwarenessTests,
    'folder-hierarchy': FolderHierarchyTests,
    'permissions': PermissionsTests,
    'undo-redo': UndoRedoTests,
    'large-documents': LargeDocumentsTests,
    // Cross-platform test suites
    'cross-platform-sharing': CrossPlatformSharingTests,
    'cross-platform-sync': CrossPlatformSyncTests,
};

// Results tracking
const results = {
    startTime: null,
    endTime: null,
    suites: [],
    summary: {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
    }
};

/**
 * Run a single test with timeout
 */
async function runTest(testFn, name, timeoutMs = 30000) {
    return new Promise(async (resolve) => {
        const startTime = Date.now();
        const timeout = setTimeout(() => {
            resolve({
                name,
                status: 'failed',
                error: `Timeout after ${timeoutMs}ms`,
                duration: timeoutMs,
            });
        }, timeoutMs);

        try {
            await testFn();
            clearTimeout(timeout);
            resolve({
                name,
                status: 'passed',
                duration: Date.now() - startTime,
            });
        } catch (error) {
            clearTimeout(timeout);
            resolve({
                name,
                status: 'failed',
                error: error.message,
                stack: verbose ? error.stack : undefined,
                duration: Date.now() - startTime,
            });
        }
    });
}

/**
 * Run a test suite
 */
async function runSuite(name, suite) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`▶ Running Suite: ${name.toUpperCase()}`);
    console.log(`${'═'.repeat(60)}`);

    const suiteResult = {
        name,
        tests: [],
        passed: 0,
        failed: 0,
        skipped: 0,
    };

    // Run setup once at suite start if exists
    if (suite.setup) {
        try {
            await suite.setup();
        } catch (err) {
            console.error(`❌ Suite setup failed: ${err.message}`);
            suiteResult.setupError = err.message;
            return suiteResult;
        }
    }

    // Run each test with teardown/setup between them for isolation
    for (const [testName, testFn] of Object.entries(suite.tests || {})) {
        if (typeof testFn !== 'function') continue;

        console.log(`\n  ▸ ${testName}...`);
        const result = await runTest(testFn, testName);
        suiteResult.tests.push(result);

        if (result.status === 'passed') {
            console.log(`    ✅ PASSED (${result.duration}ms)`);
            suiteResult.passed++;
        } else if (result.status === 'skipped') {
            console.log(`    ⏭️  SKIPPED: ${result.reason}`);
            suiteResult.skipped++;
        } else {
            console.log(`    ❌ FAILED: ${result.error}`);
            if (verbose && result.stack) {
                console.log(`    ${result.stack.split('\n').join('\n    ')}`);
            }
            suiteResult.failed++;
        }

        results.summary.total++;
        results.summary[result.status === 'passed' ? 'passed' : result.status === 'skipped' ? 'skipped' : 'failed']++;
        
        // Run teardown after each test for isolation
        if (suite.teardown) {
            try {
                await suite.teardown();
            } catch (err) {
                if (verbose) {
                    console.error(`⚠️  Test teardown error: ${err.message}`);
                }
            }
        }
    }

    return suiteResult;
}

/**
 * Print final summary with RALPH_STATUS
 */
function printSummary() {
    console.log(`\n${'═'.repeat(60)}`);
    console.log('📊 TEST SUMMARY');
    console.log(`${'═'.repeat(60)}`);

    const duration = ((results.endTime - results.startTime) / 1000).toFixed(2);

    console.log(`\n  Total Tests:  ${results.summary.total}`);
    console.log(`  Passed:       ${results.summary.passed} ✅`);
    console.log(`  Failed:       ${results.summary.failed} ❌`);
    console.log(`  Skipped:      ${results.summary.skipped} ⏭️`);
    console.log(`  Duration:     ${duration}s`);

    // List failed tests
    if (results.summary.failed > 0) {
        console.log(`\n  Failed Tests:`);
        for (const suite of results.suites) {
            for (const test of suite.tests) {
                if (test.status === 'failed') {
                    console.log(`    • ${suite.name}/${test.name}: ${test.error}`);
                }
            }
        }
    }

    // Output RALPH_STATUS for autonomous loop integration
    const allPassed = results.summary.failed === 0 && results.summary.total > 0;
    console.log(`\n${'─'.repeat(60)}`);
    console.log('RALPH_STATUS:');
    console.log(`  completion_indicators: ${allPassed ? 4 : 1}`);
    console.log(`  EXIT_SIGNAL: ${allPassed}`);
    console.log(`  status: ${allPassed ? 'ALL_TESTS_PASSED' : 'TESTS_FAILED'}`);
    console.log(`  failed_count: ${results.summary.failed}`);
    console.log(`  action_needed: ${allPassed ? 'none' : 'fix_failing_tests'}`);
    console.log(`${'─'.repeat(60)}`);

    // Write JSON results for programmatic access
    const resultsPath = path.join(__dirname, 'test-results.json');
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    console.log(`\n📄 Results written to: ${resultsPath}`);
}

/**
 * Main entry point
 */
async function main() {
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║       Nightjar INTEGRATION TEST SUITE                       ║');
    console.log('║       For Ralph Wiggum Autonomous Testing Loop           ║');
    console.log('╚══════════════════════════════════════════════════════════╝');

    // Start sidecar if needed
    const sidecarOk = await ensureSidecar();
    if (!sidecarOk) {
        console.error('\n❌ Cannot run tests without sidecar');
        process.exit(2);
    }

    results.startTime = Date.now();

    // Determine which suites to run
    const suitesToRun = selectedSuite 
        ? { [selectedSuite]: TEST_SUITES[selectedSuite] }
        : TEST_SUITES;

    if (selectedSuite && !TEST_SUITES[selectedSuite]) {
        console.error(`\n❌ Unknown suite: ${selectedSuite}`);
        console.log(`   Available suites: ${Object.keys(TEST_SUITES).join(', ')}`);
        process.exit(2);
    }

    // Run selected suites
    for (const [name, suite] of Object.entries(suitesToRun)) {
        if (!suite) continue;
        const suiteResult = await runSuite(name, suite);
        results.suites.push(suiteResult);
    }

    results.endTime = Date.now();

    // Print summary
    printSummary();

    // Stop sidecar if we started it
    stopSidecar();

    // Exit with appropriate code
    process.exit(results.summary.failed > 0 ? 1 : 0);
}

// Handle uncaught errors
process.on('uncaughtException', (err) => {
    console.error('\n💥 Uncaught Exception:', err.message);
    console.error(err.stack);
    process.exit(2);
});

process.on('unhandledRejection', (err) => {
    console.error('\n💥 Unhandled Rejection:', err);
    process.exit(2);
});

// Run
main().catch((err) => {
    console.error('\n💥 Test Runner Error:', err.message);
    process.exit(2);
});
