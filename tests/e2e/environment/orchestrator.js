/**
 * E2E Test Environment Orchestrator
 * 
 * Manages Electron sidecars, unified servers, and log collection
 * for cross-platform E2E testing.
 */
const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { EventEmitter } = require('events');

const execAsync = promisify(exec);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');

// Port configuration - use 9xxx range to avoid conflicts with production app (8080)
const PORTS = {
  sidecar1: {
    yjs: 9080,
    meta: 9081,
    wss: 9443
  },
  sidecar2: {
    yjs: 9090,
    meta: 9091,
    wss: 9453
  },
  unified1: 3000,
  unified2: 3001
};

/**
 * Log collector that aggregates logs from all processes
 */
class LogCollector extends EventEmitter {
  constructor() {
    super();
    this.logs = [];
    this.maxLogs = 10000;
  }

  add(source, level, message, data = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      source,
      level,
      message: typeof message === 'string' ? message : String(message),
      data
    };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    this.emit('log', entry);
    
    const colors = {
      'sidecar-1': '\x1b[36m',
      'sidecar-2': '\x1b[35m',
      'unified-1': '\x1b[33m',
      'unified-2': '\x1b[32m',
      'test': '\x1b[37m',
      'orchestrator': '\x1b[34m'
    };
    const reset = '\x1b[0m';
    const color = colors[source] || '\x1b[37m';
    const levelIcon = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : '📋';
    console.log(`${color}[${source}]${reset} ${levelIcon} ${entry.message}`);
  }

  getErrors() {
    return this.logs.filter(l => l.level === 'error');
  }

  clear() {
    this.logs = [];
  }

  exportToFile(filepath) {
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filepath, JSON.stringify(this.logs, null, 2));
  }

  getFormattedReport() {
    const bySource = {};
    for (const log of this.logs) {
      if (!bySource[log.source]) bySource[log.source] = [];
      bySource[log.source].push(`[${log.timestamp}] [${log.level.toUpperCase()}] ${log.message}`);
    }
    
    let report = '=== E2E TEST LOG REPORT ===\n\n';
    report += `Generated: ${new Date().toISOString()}\n`;
    report += `Total logs: ${this.logs.length}\n\n`;
    
    for (const [source, logs] of Object.entries(bySource)) {
      report += `--- ${source.toUpperCase()} (${logs.length} entries) ---\n`;
      report += logs.slice(-100).join('\n');
      report += '\n\n';
    }
    
    const errors = this.getErrors();
    if (errors.length > 0) {
      report += '=== ERRORS SUMMARY ===\n';
      for (const err of errors) {
        report += `[${err.source}] ${err.message}\n`;
      }
    }
    
    return report;
  }
}

async function waitForPort(port, timeout = 60000) {
  const start = Date.now();
  console.log(`[waitForPort] Waiting for port ${port} (timeout: ${timeout}ms)`);
  let lastLog = start;
  while (Date.now() - start < timeout) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1');
        socket.once('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.once('error', reject);
        socket.setTimeout(1000, () => {
          socket.destroy();
          reject(new Error('timeout'));
        });
      });
      console.log(`[waitForPort] Port ${port} is now available after ${Date.now() - start}ms`);
      return true;
    } catch {
      // Log progress every 10 seconds
      if (Date.now() - lastLog > 10000) {
        console.log(`[waitForPort] Port ${port} not ready yet, elapsed: ${Date.now() - start}ms`);
        lastLog = Date.now();
      }
      await new Promise(r => setTimeout(r, 500));
    }
  }
  console.log(`[waitForPort] TIMEOUT waiting for port ${port} after ${timeout}ms`);
  throw new Error(`Timeout waiting for port ${port} after ${timeout}ms`);
}

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

class ManagedProcess {
  constructor(name, command, args, options, logCollector) {
    this.name = name;
    this.command = command;
    this.args = args;
    this.options = options;
    this.logCollector = logCollector;
    this.process = null;
    this.exitCode = null;
    this.exitPromise = null;
  }

  async start() {
    this.logCollector.add(this.name, 'info', `Starting: ${this.command} ${this.args.join(' ')}`);
    this.logCollector.add(this.name, 'info', `Environment: YJS=${this.options.env?.YJS_WEBSOCKET_PORT}, META=${this.options.env?.METADATA_WEBSOCKET_PORT}`);
    
    // On Windows, use shell with properly quoted args to handle paths with spaces
    const isWindows = process.platform === 'win32';
    const quotedArgs = isWindows 
      ? this.args.map(arg => arg.includes(' ') ? `"${arg}"` : arg)
      : this.args;
    
    this.process = spawn(this.command, quotedArgs, {
      ...this.options,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: isWindows
    });

    this.logCollector.add(this.name, 'info', `Process spawned with PID: ${this.process.pid}`);

    this.exitPromise = new Promise(resolve => {
      this.process.on('exit', (code, signal) => {
        this.exitCode = code;
        this.logCollector.add(this.name, code === 0 ? 'info' : 'error', `Process exited: code=${code}, signal=${signal}`);
        resolve(code);
      });
    });

    this.process.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      for (const line of lines) {
        this.logCollector.add(this.name, 'info', line);
      }
    });

    this.process.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      for (const line of lines) {
        const isWarning = line.includes('Deprecation') || 
                          line.includes('ExperimentalWarning') ||
                          line.includes('punycode');
        const level = isWarning ? 'warn' : 'error';
        this.logCollector.add(this.name, level, line);
      }
    });

    this.process.on('error', (err) => {
      this.logCollector.add(this.name, 'error', `Process error: ${err.message}`);
    });

    return this.process;
  }

  async stop() {
    if (this.process && this.exitCode === null) {
      this.logCollector.add(this.name, 'info', 'Stopping process...');
      
      if (process.platform === 'win32') {
        try {
          await execAsync(`taskkill /pid ${this.process.pid} /T /F`);
        } catch (e) {
          this.logCollector.add(this.name, 'warn', `taskkill warning: ${e.message}`);
        }
      } else {
        this.process.kill('SIGTERM');
        await new Promise(r => setTimeout(r, 1000));
        if (this.exitCode === null) {
          this.process.kill('SIGKILL');
        }
      }
      
      await Promise.race([
        this.exitPromise,
        new Promise(r => setTimeout(r, 5000))
      ]);
      
      // On Windows, give LevelDB a moment to release file locks
      if (process.platform === 'win32') {
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  get pid() {
    return this.process?.pid;
  }

  get running() {
    return this.process && this.exitCode === null;
  }
}

class TestEnvironment {
  constructor() {
    this.logs = new LogCollector();
    this.processes = new Map();
    this.testDataDirs = [];
  }

  createTestStorage(name) {
    const dir = path.join(PROJECT_ROOT, 'tests', 'e2e', 'test-data', name);
    if (fs.existsSync(dir)) {
      // Retry deletion with delays to handle file locks
      let deleted = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
          deleted = true;
          break;
        } catch (e) {
          if (e.code === 'EBUSY' || e.code === 'ENOTEMPTY') {
            this.logs.add('orchestrator', 'warn', `Retry ${attempt + 1}/5: ${e.message}`);
            // Synchronous delay
            const start = Date.now();
            while (Date.now() - start < 500) { /* busy wait */ }
          } else {
            throw e;
          }
        }
      }
      if (!deleted) {
        // Last resort: rename the directory and continue
        const backupDir = `${dir}_old_${Date.now()}`;
        try {
          fs.renameSync(dir, backupDir);
          this.logs.add('orchestrator', 'warn', `Renamed locked dir to ${backupDir}`);
        } catch (e) {
          this.logs.add('orchestrator', 'error', `Cannot remove or rename ${dir}: ${e.message}`);
        }
      }
    }
    fs.mkdirSync(dir, { recursive: true });
    this.testDataDirs.push(dir);
    this.logs.add('orchestrator', 'info', `Created test storage: ${dir}`);
    return dir;
  }

  async startUnifiedServer(name, port, options = {}) {
    const available = await isPortAvailable(port);
    if (!available) {
      throw new Error(`Port ${port} is already in use`);
    }

    const storagePath = this.createTestStorage(`${name}-storage`);
    
    const proc = new ManagedProcess(
      name,
      'node',
      [path.join(PROJECT_ROOT, 'server', 'unified', 'index.js')],
      {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          PORT: String(port),
          STORAGE_PATH: storagePath,
          NODE_ENV: 'test',
          LOG_FORMAT: 'json',
          NIGHTJAR_MODE: 'private',
          ...options.env
        }
      },
      this.logs
    );

    await proc.start();
    this.processes.set(name, proc);
    
    try {
      await waitForPort(port, options.timeout || 60000);
      this.logs.add(name, 'info', `Server ready on port ${port}`);
    } catch (err) {
      this.logs.add(name, 'error', `Server failed to start: ${err.message}`);
      throw err;
    }

    return { 
      process: proc, 
      port, 
      storagePath, 
      url: `http://localhost:${port}`,
      wsUrl: `ws://localhost:${port}`
    };
  }

  async startSidecar(name, ports = PORTS.sidecar1, options = {}) {
    for (const [portName, port] of Object.entries(ports)) {
      const available = await isPortAvailable(port);
      if (!available) {
        throw new Error(`Sidecar ${portName} port ${port} is already in use`);
      }
    }

    const storagePath = this.createTestStorage(`${name}-storage`);
    
    const proc = new ManagedProcess(
      name,
      'node',
      [path.join(PROJECT_ROOT, 'sidecar', 'index.js'), storagePath],
      {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          NIGHTJAR_MESH: 'false',
          NIGHTJAR_UPNP: 'false',
          // Speed up tests by reducing P2P retry attempts
          P2P_INIT_MAX_ATTEMPTS: '2',
          P2P_INIT_RETRY_INTERVAL_MS: '1000',
          YJS_WEBSOCKET_PORT: String(ports.yjs),
          METADATA_WEBSOCKET_PORT: String(ports.meta),
          YJS_WEBSOCKET_SECURE_PORT: String(ports.wss),
          ...options.env
        }
      },
      this.logs
    );

    await proc.start();
    this.processes.set(name, proc);

    try {
      // Wait for the sidecar to complete startup by monitoring log output
      const startupComplete = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Sidecar startup timeout - never saw "========== Startup complete" message'));
        }, options.timeout || 90000);

        const logHandler = (entry) => {
          if (entry.source === name && entry.message.includes('========== Startup complete')) {
            clearTimeout(timeout);
            this.logs.removeListener('log', logHandler);
            resolve();
          }
        };

        this.logs.on('log', logHandler);
      });

      await startupComplete;
      this.logs.add(name, 'info', `Sidecar ready on ports YJS=${ports.yjs}, META=${ports.meta}`);
    } catch (err) {
      this.logs.add(name, 'error', `Sidecar failed to start: ${err.message}`);
      throw err;
    }

    return {
      process: proc,
      storagePath,
      ports,
      metaUrl: `ws://localhost:${ports.meta}`,
      yjsUrl: `ws://localhost:${ports.yjs}`,
      wssUrl: `wss://localhost:${ports.wss}`
    };
  }

  async cleanup() {
    this.logs.add('orchestrator', 'info', 'Cleaning up test environment...');
    
    const stopPromises = [];
    for (const [name, proc] of this.processes) {
      stopPromises.push(proc.stop().catch(e => {
        this.logs.add('orchestrator', 'warn', `Failed to stop ${name}: ${e.message}`);
      }));
    }
    await Promise.all(stopPromises);
    this.processes.clear();

    // Wait for file handles to be released
    await new Promise(r => setTimeout(r, 1000));

    for (const dir of this.testDataDirs) {
      // Retry deletion with delays for file locks
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
          }
          break;
        } catch (e) {
          if (e.code === 'EBUSY' || e.code === 'ENOTEMPTY') {
            this.logs.add('orchestrator', 'warn', `Cleanup retry ${attempt + 1}/5 for ${dir}: ${e.message}`);
            await new Promise(r => setTimeout(r, 500));
          } else {
            this.logs.add('orchestrator', 'warn', `Failed to remove ${dir}: ${e.message}`);
            break;
          }
        }
      }
    }
    this.testDataDirs = [];

    this.logs.add('orchestrator', 'info', 'Cleanup complete');
  }

  saveLogs(filepath) {
    this.logs.exportToFile(filepath);
    return this.logs.getFormattedReport();
  }
}

const env = new TestEnvironment();

module.exports = {
  TestEnvironment,
  env,
  LogCollector,
  ManagedProcess,
  waitForPort,
  isPortAvailable,
  PORTS
};
