/**
 * Electron App Launcher for E2E Testing
 * 
 * Spawns full Electron app instances with isolated storage, ports, and network modes.
 * Uses Playwright's _electron API for true cross-network testing.
 */
const { _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const net = require('net');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

// Port ranges for isolated Electron instances
// Base: 9100, each instance gets 10 ports
const ELECTRON_PORT_BASE = 9100;
const PORTS_PER_INSTANCE = 10;

// Track allocated instances for cleanup
const activeInstances = new Map();
let nextInstanceId = 0;

/**
 * Network modes for Electron instances
 */
const NETWORK_MODE = {
  // Use real Hyperswarm DHT - instances can discover each other on real network
  DHT: 'dht',
  // Force relay-only - all sync goes through specified relay server
  RELAY: 'relay',
  // Completely isolated - no network, for unit testing
  ISOLATED: 'isolated',
};

/**
 * Allocate ports for a new Electron instance
 */
function allocatePorts(instanceId) {
  const base = ELECTRON_PORT_BASE + (instanceId * PORTS_PER_INSTANCE);
  return {
    yjs: base,
    meta: base + 1,
    wss: base + 2,
    p2p: base + 3,
    tor: base + 4,
  };
}

/**
 * Check if a port is available
 */
async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Wait for a port to become available
 */
async function waitForPort(port, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1');
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('error', reject);
        socket.setTimeout(1000, () => { socket.destroy(); reject(new Error('timeout')); });
      });
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw new Error(`Timeout waiting for port ${port}`);
}

/**
 * Create isolated storage directory for an instance
 */
function createStorage(instanceId) {
  const dir = path.join(PROJECT_ROOT, 'tests', 'e2e', 'test-data', `electron-${instanceId}`);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Build environment variables for an Electron instance
 */
function buildEnv(options) {
  const { ports, storagePath, networkMode, relayUrl, meshEnabled } = options;
  
  const env = {
    ...process.env,
    // Isolated storage
    ELECTRON_USER_DATA: storagePath,
    
    // Port configuration
    YJS_WEBSOCKET_PORT: String(ports.yjs),
    METADATA_WEBSOCKET_PORT: String(ports.meta),
    YJS_WEBSOCKET_SECURE_PORT: String(ports.wss),
    P2P_PORT: String(ports.p2p),
    TOR_CONTROL_PORT: String(ports.tor),
    
    // Speed up P2P initialization in tests
    P2P_INIT_MAX_ATTEMPTS: '3',
    P2P_INIT_RETRY_INTERVAL_MS: '2000',
    
    // Disable UPnP in tests (avoid router conflicts)
    NIGHTJAR_UPNP: 'false',
    
    // Test mode
    NODE_ENV: 'test',
    NIGHTJAR_TEST_MODE: 'true',
    
    // GPU workarounds for CI
    ELECTRON_DISABLE_GPU: '1',
  };
  
  // Configure network mode
  switch (networkMode) {
    case NETWORK_MODE.DHT:
      env.NIGHTJAR_MESH = meshEnabled !== false ? 'true' : 'false';
      env.NIGHTJAR_RELAY_BRIDGE = 'false';
      break;
      
    case NETWORK_MODE.RELAY:
      env.NIGHTJAR_MESH = 'false';
      env.NIGHTJAR_RELAY_BRIDGE = 'true';
      if (relayUrl) {
        env.RELAY_OVERRIDE = relayUrl;
      }
      break;
      
    case NETWORK_MODE.ISOLATED:
      env.NIGHTJAR_MESH = 'false';
      env.NIGHTJAR_RELAY_BRIDGE = 'false';
      env.NIGHTJAR_UPNP = 'false';
      break;
  }
  
  return env;
}

/**
 * Launch an Electron app instance
 * 
 * @param {Object} options - Launch options
 * @param {string} options.name - Instance name for logging
 * @param {string} options.networkMode - One of NETWORK_MODE values
 * @param {string} options.relayUrl - Relay server URL (for RELAY mode)
 * @param {boolean} options.meshEnabled - Enable mesh participation (for DHT mode)
 * @param {number} options.timeout - Startup timeout in ms
 * @returns {Promise<ElectronInstance>} The launched instance
 */
async function launchElectron(options = {}) {
  const instanceId = nextInstanceId++;
  const name = options.name || `electron-${instanceId}`;
  const networkMode = options.networkMode || NETWORK_MODE.RELAY;
  const timeout = options.timeout || 90000;
  
  console.log(`[ElectronLauncher] Launching ${name} in ${networkMode} mode...`);
  
  // Allocate resources
  const ports = allocatePorts(instanceId);
  const storagePath = createStorage(instanceId);
  
  // Check ports are available
  for (const [portName, port] of Object.entries(ports)) {
    const available = await isPortAvailable(port);
    if (!available) {
      throw new Error(`Port ${port} (${portName}) is already in use for ${name}`);
    }
  }
  
  // Build environment
  const env = buildEnv({
    ports,
    storagePath,
    networkMode,
    relayUrl: options.relayUrl,
    meshEnabled: options.meshEnabled,
  });
  
  // Launch Electron
  const mainPath = path.join(PROJECT_ROOT, 'src/main.js');
  console.log(`[ElectronLauncher] Main.js path: ${mainPath}`);
  console.log(`[ElectronLauncher] Working directory: ${PROJECT_ROOT}`);
  console.log(`[ElectronLauncher] Storage path: ${storagePath}`);
  
  const electronApp = await electron.launch({
    args: [
      mainPath,
      `--user-data-dir=${storagePath}`,
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
    cwd: PROJECT_ROOT,
    env,
    timeout,
  });
  
  // Listen for app close event
  electronApp.on('close', () => {
    console.log(`[ElectronLauncher] ${name} Electron app closed unexpectedly`);
  });
  
  // Get the first window (loading screen) with better error handling
  // Nightjar shows a loading screen first, then opens the main window
  let window;
  try {
    // The first window is the loading screen
    const loadingWindow = await electronApp.firstWindow();
    console.log(`[ElectronLauncher] ${name} got loading window: ${await loadingWindow.title()}`);
    
    // Wait for the main window to appear (when loading is complete)
    // The main window title doesn't include "Loading"
    console.log(`[ElectronLauncher] ${name} waiting for main window...`);
    
    // Poll for main window (not loading window)
    let attempts = 0;
    const maxAttempts = 60; // 60 seconds max
    while (attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 1000));
      attempts++;
      
      const windows = await electronApp.windows();
      // Find a window that's not the loading window
      for (const w of windows) {
        try {
          const title = await w.title();
          if (!title.includes('Loading') && title.includes('Nightjar')) {
            window = w;
            console.log(`[ElectronLauncher] ${name} found main window: ${title}`);
            break;
          }
        } catch {
          // Window might be closed
        }
      }
      
      if (window) break;
      
      // Also check if loading window is now main window (title changed)
      try {
        const title = await loadingWindow.title();
        if (!title.includes('Loading')) {
          // Loading window transformed into main window? 
          // Or check for sidebar
          try {
            await loadingWindow.waitForSelector('[data-testid="workspace-sidebar"], [data-testid="onboarding-welcome"]', { timeout: 1000 });
            window = loadingWindow;
            console.log(`[ElectronLauncher] ${name} loading window became main window`);
            break;
          } catch {
            // Not ready yet
          }
        }
      } catch {
        // Loading window closed - check for new main window
        const newWindows = await electronApp.windows();
        if (newWindows.length > 0) {
          window = newWindows[0];
          console.log(`[ElectronLauncher] ${name} got new window after loading closed`);
          break;
        }
      }
      
      if (attempts % 10 === 0) {
        console.log(`[ElectronLauncher] ${name} still waiting for main window... (${attempts}s)`);
      }
    }
    
    if (!window) {
      throw new Error(`Main window did not appear after ${maxAttempts} seconds`);
    }
  } catch (e) {
    console.error(`[ElectronLauncher] ${name} failed to get window: ${e.message}`);
    // Try to get crash reason
    try {
      const appProcess = electronApp.process();
      if (appProcess.killed || appProcess.exitCode !== null) {
        console.error(`[ElectronLauncher] ${name} process exited with code: ${appProcess.exitCode}`);
      }
    } catch (e2) {
      // ignore
    }
    await electronApp.close();
    throw e;
  }
  
  // Set up console log capture
  const logs = [];
  window.on('console', msg => {
    const entry = {
      type: msg.type(),
      text: msg.text(),
      timestamp: Date.now(),
    };
    logs.push(entry);
    
    // Color-coded logging
    const color = msg.type() === 'error' ? '\x1b[31m' : 
                  msg.type() === 'warning' ? '\x1b[33m' : '\x1b[36m';
    console.log(`${color}[${name}]:\x1b[0m ${msg.text().substring(0, 200)}`);
  });
  
  // Capture page errors
  window.on('pageerror', error => {
    logs.push({ type: 'pageerror', text: error.message, timestamp: Date.now() });
    console.error(`\x1b[31m[${name}] PAGE ERROR:\x1b[0m`, error.message);
  });
  
  // Wait for app to be ready (sidecar started, UI loaded)
  console.log(`[ElectronLauncher] Waiting for ${name} to initialize...`);
  await window.waitForSelector(
    '[data-testid="workspace-sidebar"], [data-testid="onboarding-welcome"], .workspace-switcher, .sidebar, .onboarding-welcome',
    { timeout }
  );
  
  // Wait for sidecar to be ready (check meta WebSocket)
  await waitForPort(ports.meta, 30000);
  
  console.log(`[ElectronLauncher] ${name} ready on ports YJS=${ports.yjs}, META=${ports.meta}`);
  
  const instance = {
    id: instanceId,
    name,
    app: electronApp,
    window,
    ports,
    storagePath,
    networkMode,
    logs,
    
    // URLs for external connections
    metaUrl: `ws://localhost:${ports.meta}`,
    yjsUrl: `ws://localhost:${ports.yjs}`,
    
    // Helper: Get console logs filtered by type
    getLogs(type = null) {
      return type ? logs.filter(l => l.type === type) : logs;
    },
    
    // Helper: Get logs containing specific text
    findLogs(pattern) {
      const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
      return logs.filter(l => regex.test(l.text));
    },
    
    // Helper: Clear logs
    clearLogs() {
      logs.length = 0;
    },
    
    // Helper: Wait for specific log message
    async waitForLog(pattern, timeout = 30000) {
      const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const found = logs.find(l => regex.test(l.text));
        if (found) return found;
        await new Promise(r => setTimeout(r, 100));
      }
      throw new Error(`Timeout waiting for log matching: ${pattern}`);
    },
    
    // Helper: Get sidecar client URL
    get metaUrl() {
      return `ws://localhost:${ports.meta}`;
    },
    
    get yjsUrl() {
      return `ws://localhost:${ports.yjs}`;
    },
    
    // Cleanup
    async close() {
      console.log(`[ElectronLauncher] Closing ${name}...`);
      try {
        await electronApp.close();
      } catch (e) {
        console.warn(`[ElectronLauncher] Error closing ${name}:`, e.message);
      }
      
      // Clean up storage
      await new Promise(r => setTimeout(r, 1000));
      try {
        if (fs.existsSync(storagePath)) {
          fs.rmSync(storagePath, { recursive: true, force: true });
        }
      } catch (e) {
        console.warn(`[ElectronLauncher] Error cleaning storage:`, e.message);
      }
      
      activeInstances.delete(instanceId);
    },
  };
  
  activeInstances.set(instanceId, instance);
  return instance;
}

/**
 * Close all active Electron instances
 */
async function closeAll() {
  console.log(`[ElectronLauncher] Closing ${activeInstances.size} instance(s)...`);
  const promises = [];
  for (const instance of activeInstances.values()) {
    promises.push(instance.close().catch(e => {
      console.warn(`[ElectronLauncher] Error closing ${instance.name}:`, e.message);
    }));
  }
  await Promise.all(promises);
}

/**
 * Launch a test relay server for controlled testing
 */
async function launchTestRelay(options = {}) {
  const { env, PORTS } = require('../environment/orchestrator.js');
  
  const port = options.port || 3100;
  const name = options.name || 'test-relay';
  
  console.log(`[ElectronLauncher] Starting test relay on port ${port}...`);
  
  const server = await env.startUnifiedServer(name, port, {
    env: {
      NIGHTJAR_MODE: options.mode || 'relay', // Relay mode - no persistence
      MESH_ENABLED: 'true', // Enable mesh for cross-relay testing
      ...options.env,
    }
  });
  
  return {
    ...server,
    relayUrl: `ws://localhost:${port}`,
    wssRelayUrl: `wss://localhost:${port}`,
  };
}

module.exports = {
  launchElectron,
  launchTestRelay,
  closeAll,
  NETWORK_MODE,
  allocatePorts,
  isPortAvailable,
  waitForPort,
  PROJECT_ROOT,
};
