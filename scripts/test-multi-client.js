/**
 * Multi-Client Test Helper
 * 
 * Launches multiple Electron instances with isolated user data
 * for testing P2P collaboration on a single machine.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const NUM_CLIENTS = parseInt(process.argv[2], 10) || 2;
const projectRoot = path.join(__dirname, '..');

console.log(`🚀 Launching ${NUM_CLIENTS} client instances for testing...\n`);

const clients = [];

for (let i = 1; i <= NUM_CLIENTS; i++) {
  const userDataDir = path.join(projectRoot, `test-user-data-${i}`);
  const storageDir = path.join(projectRoot, `test-storage-${i}`);
  
  // Create directories if they don't exist
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }
  
  console.log(`📱 Client ${i}:`);
  console.log(`   User data: ${userDataDir}`);
  console.log(`   Storage: ${storageDir}`);
  
  // Set environment variables for this instance
  const env = {
    ...process.env,
    ELECTRON_USER_DATA: userDataDir,
    NAHMA_STORAGE_DIR: storageDir,
    NAHMA_CLIENT_ID: `test-client-${i}`,
    // Offset ports for each client to avoid conflicts
    SIDECAR_PORT: String(8081 + (i - 1)),
  };
  
  // Launch Electron with isolated environment
  const child = spawn('npx', ['electron', '.'], {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
    shell: true,
  });
  
  child.on('error', (err) => {
    console.error(`❌ Client ${i} error:`, err.message);
  });
  
  child.on('exit', (code) => {
    console.log(`👋 Client ${i} exited with code ${code}`);
  });
  
  clients.push(child);
}

console.log(`\n✅ All ${NUM_CLIENTS} clients launched!`);
console.log('Press Ctrl+C to stop all instances.\n');

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('\n🛑 Stopping all clients...');
  clients.forEach((child, i) => {
    child.kill();
    console.log(`   Stopped client ${i + 1}`);
  });
  process.exit(0);
});
