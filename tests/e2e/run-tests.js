/**
 * Automated test runner that outputs structured results for analysis
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const RESULTS_FILE = path.join(__dirname, 'test-results', 'automation-results.json');
const LOG_FILE = path.join(__dirname, 'test-results', 'automation-log.txt');

// Ensure directories exist
fs.mkdirSync(path.dirname(RESULTS_FILE), { recursive: true });

// Clear previous results
if (fs.existsSync(RESULTS_FILE)) fs.unlinkSync(RESULTS_FILE);
if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);

console.log('Starting Playwright tests...');
const startTime = Date.now();

const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

const proc = spawn('npx', ['playwright', 'test', '--reporter=json'], {
  cwd: __dirname,
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe']
});

let jsonOutput = '';

proc.stdout.on('data', (data) => {
  const str = data.toString();
  jsonOutput += str;
  logStream.write(str);
});

proc.stderr.on('data', (data) => {
  logStream.write('[STDERR] ' + data.toString());
});

proc.on('close', (code) => {
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  logStream.write(`\n\nTest run completed in ${duration}s with exit code ${code}\n`);
  logStream.end();
  
  // Parse JSON output and extract summary
  try {
    const results = JSON.parse(jsonOutput);
    const summary = {
      exitCode: code,
      duration: duration,
      stats: results.stats,
      passed: [],
      failed: [],
      skipped: []
    };
    
    // Extract test results from suites
    function extractTests(suites) {
      for (const suite of suites) {
        if (suite.specs) {
          for (const spec of suite.specs) {
            for (const test of spec.tests) {
              const testInfo = {
                title: spec.title,
                file: spec.file,
                line: spec.line,
                status: test.status,
                duration: test.results?.[0]?.duration || 0
              };
              
              if (test.status === 'passed' || test.status === 'expected') {
                summary.passed.push(testInfo);
              } else if (test.status === 'failed' || test.status === 'unexpected') {
                testInfo.error = test.results?.[0]?.error?.message || 'Unknown error';
                testInfo.errorSnippet = test.results?.[0]?.error?.snippet || '';
                testInfo.attachments = test.results?.[0]?.attachments?.map(a => ({
                  name: a.name,
                  path: a.path,
                  contentType: a.contentType
                })) || [];
                summary.failed.push(testInfo);
              } else if (test.status === 'skipped') {
                summary.skipped.push(testInfo);
              }
            }
          }
        }
        if (suite.suites) {
          extractTests(suite.suites);
        }
      }
    }
    
    if (results.suites) {
      extractTests(results.suites);
    }
    
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(summary, null, 2));
    
    console.log(`\n========== TEST RESULTS ==========`);
    console.log(`Duration: ${duration}s`);
    console.log(`Passed: ${summary.passed.length}`);
    console.log(`Failed: ${summary.failed.length}`);
    console.log(`Skipped: ${summary.skipped.length}`);
    
    if (summary.failed.length > 0) {
      console.log(`\n========== FAILURES ==========`);
      for (const fail of summary.failed.slice(0, 10)) {
        console.log(`\n❌ ${fail.file}:${fail.line} - ${fail.title}`);
        console.log(`   Error: ${fail.error.substring(0, 200)}`);
      }
    }
    
    console.log(`\nResults saved to: ${RESULTS_FILE}`);
    
  } catch (e) {
    // JSON parsing failed - save raw output
    fs.writeFileSync(RESULTS_FILE, JSON.stringify({
      exitCode: code,
      duration: duration,
      parseError: e.message,
      rawOutput: jsonOutput.substring(0, 5000)
    }, null, 2));
    console.log('Failed to parse JSON output:', e.message);
  }
  
  process.exit(code);
});
