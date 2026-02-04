/**
 * E2E Test Runner with log collection
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { env, PORTS } = require('./environment/orchestrator.js');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

async function main() {
  const args = process.argv.slice(2);
  
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║        NIGHTJAR E2E CROSS-PLATFORM TEST SUITE                ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  
  console.log('📋 Test Configuration:');
  console.log(`   - Sidecar 1: ports ${PORTS.sidecar1.yjs}/${PORTS.sidecar1.meta}/${PORTS.sidecar1.wss}`);
  console.log(`   - Sidecar 2: ports ${PORTS.sidecar2.yjs}/${PORTS.sidecar2.meta}/${PORTS.sidecar2.wss}`);
  console.log(`   - Unified Server 1: port ${PORTS.unified1}`);
  console.log(`   - Unified Server 2: port ${PORTS.unified2}`);
  console.log('');

  // Build playwright command
  const playwrightArgs = ['playwright', 'test', '--config=playwright.config.js'];
  
  // Pass through any additional args (like --headed or specific test files)
  let passthroughMode = false;
  for (const arg of args) {
    if (arg === '--') {
      passthroughMode = true;
      continue;
    }
    if (passthroughMode) {
      playwrightArgs.push(arg);
    } else if (arg === '--headed') {
      playwrightArgs.push('--headed');
    } else if (arg === '--debug') {
      playwrightArgs.push('--debug');
    } else {
      playwrightArgs.push(arg);
    }
  }

  console.log(`🚀 Starting Playwright: npx ${playwrightArgs.join(' ')}\n`);
  console.log('══════════════════════════════════════════════════════════════════\n');

  const startTime = Date.now();
  
  const playwright = spawn('npx', playwrightArgs, {
    cwd: __dirname,
    stdio: 'inherit',
    shell: true
  });

  let exitCode = 0;
  
  playwright.on('close', async (code) => {
    exitCode = code;
    
    console.log('\n══════════════════════════════════════════════════════════════════\n');
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    // Save logs
    const logsDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    const logFile = path.join(logsDir, `logs-${timestamp}.json`);
    const reportFile = path.join(logsDir, `report-${timestamp}.txt`);
    
    env.logs.exportToFile(logFile);
    fs.writeFileSync(reportFile, env.logs.getFormattedReport());
    
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                    TEST RESULTS SUMMARY                       ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Duration:    ${duration}s`.padEnd(65) + '║');
    console.log(`║  Exit Code:   ${code === 0 ? '✅ PASSED' : `❌ FAILED (${code})`}`.padEnd(64) + '║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Logs:        ${path.basename(logFile)}`.padEnd(64) + '║');
    console.log(`║  Report:      ${path.basename(reportFile)}`.padEnd(64) + '║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
    
    const errors = env.logs.getErrors();
    if (errors.length > 0) {
      console.log('⚠️ Errors found in process logs:');
      for (const err of errors.slice(0, 10)) {
        console.log(`   [${err.source}] ${err.message.substring(0, 60)}`);
      }
      if (errors.length > 10) {
        console.log(`   ... and ${errors.length - 10} more`);
      }
    } else {
      console.log('✅ No critical errors in process logs');
    }
    
    await env.cleanup();
    process.exit(exitCode);
  });

  // Handle SIGINT (Ctrl+C)
  process.on('SIGINT', async () => {
    console.log('\n🛑 Interrupted, cleaning up...');
    playwright.kill('SIGTERM');
    await env.cleanup();
    process.exit(130);
  });
}

main().catch(async (err) => {
  console.error('Fatal error:', err);
  await env.cleanup();
  process.exit(1);
});
