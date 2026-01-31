/**
 * Enhanced Tor Manager
 * Supports both external Tor daemon and bundled Tor
 */

const path = require('path');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const { EventEmitter } = require('events');

class TorManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      dataDir: options.dataDir || path.join(process.cwd(), 'tor', 'data'),
      torBinaryDir: options.torBinaryDir || path.join(process.cwd(), 'tor', 'tor'),
      socksPort: options.socksPort || 9050,
      controlPort: options.controlPort || 9051,
      hiddenServicePort: options.hiddenServicePort || 8888,
      ...options
    };
    
    this.torProcess = null;
    this.isRunning = false;
    this.isBootstrapped = false;
    this.onionAddress = null;
    this.controlPassword = null;
    this.controlPasswordHash = null;
  }
  
  /**
   * Get the Tor binary path based on platform
   */
  getTorBinaryPath() {
    const platform = process.platform;
    const arch = process.arch;
    
    let binaryName = 'tor';
    if (platform === 'win32') {
      binaryName = 'tor.exe';
    }
    
    const binaryPath = path.join(this.options.torBinaryDir, binaryName);
    
    if (fs.existsSync(binaryPath)) {
      return binaryPath;
    }
    
    // Fallback: try to use system Tor
    return 'tor';
  }
  
  /**
   * Generate control password hash
   */
  generateControlPassword() {
    this.controlPassword = crypto.randomBytes(16).toString('hex');
    // Tor uses a specific hash format: 16:HASH
    // For simplicity, we use cookie authentication instead
    return this.controlPassword;
  }
  
  /**
   * Create torrc configuration file
   */
  createTorrc() {
    const hiddenServiceDir = path.join(this.options.dataDir, 'hidden_service');
    
    // Ensure directories exist
    if (!fs.existsSync(this.options.dataDir)) {
      fs.mkdirSync(this.options.dataDir, { recursive: true });
    }
    
    if (!fs.existsSync(hiddenServiceDir)) {
      fs.mkdirSync(hiddenServiceDir, { recursive: true, mode: 0o700 });
    }
    
    const torrcContent = `
# Nightjar Tor Configuration
DataDirectory ${this.options.dataDir.replace(/\\/g, '/')}
SocksPort ${this.options.socksPort}
ControlPort ${this.options.controlPort}
CookieAuthentication 1
CookieAuthFile ${path.join(this.options.dataDir, 'control_auth_cookie').replace(/\\/g, '/')}

# Hidden Service
HiddenServiceDir ${hiddenServiceDir.replace(/\\/g, '/')}
HiddenServicePort ${this.options.hiddenServicePort} 127.0.0.1:${this.options.hiddenServicePort}

# Performance settings
CircuitBuildTimeout 10
LearnCircuitBuildTimeout 0
NumEntryGuards 3

# Reduce logging
Log notice file ${path.join(this.options.dataDir, 'tor.log').replace(/\\/g, '/')}
    `.trim();
    
    const torrcPath = path.join(this.options.dataDir, 'torrc');
    fs.writeFileSync(torrcPath, torrcContent);
    
    return torrcPath;
  }
  
  /**
   * Start the bundled Tor daemon
   */
  async start() {
    if (this.isRunning) {
      console.log('[Tor] Already running');
      return true;
    }
    
    const torBinary = this.getTorBinaryPath();
    const torrcPath = this.createTorrc();
    
    console.log('[Tor] Starting Tor daemon...');
    console.log('[Tor] Binary:', torBinary);
    console.log('[Tor] Config:', torrcPath);
    
    return new Promise((resolve, reject) => {
      try {
        this.torProcess = spawn(torBinary, ['-f', torrcPath], {
          stdio: ['ignore', 'pipe', 'pipe']
        });
        
        let bootstrapReady = false;
        
        this.torProcess.stdout.on('data', (data) => {
          const output = data.toString();
          console.log('[Tor]', output.trim());
          
          // Check for bootstrap completion
          if (output.includes('Bootstrapped 100%') && !bootstrapReady) {
            bootstrapReady = true;
            this.isBootstrapped = true;
            this.isRunning = true;
            this.emit('ready');
            
            // Read onion address
            this.readOnionAddress();
            
            resolve(true);
          }
          
          // Emit bootstrap progress
          const bootstrapMatch = output.match(/Bootstrapped (\d+)%/);
          if (bootstrapMatch) {
            this.emit('bootstrap', parseInt(bootstrapMatch[1], 10));
          }
        });
        
        this.torProcess.stderr.on('data', (data) => {
          console.error('[Tor Error]', data.toString().trim());
        });
        
        this.torProcess.on('close', (code) => {
          console.log('[Tor] Process exited with code', code);
          this.isRunning = false;
          this.isBootstrapped = false;
          this.emit('close', code);
        });
        
        this.torProcess.on('error', (err) => {
          console.error('[Tor] Failed to start:', err.message);
          this.emit('error', err);
          reject(err);
        });
        
        // Timeout if Tor doesn't bootstrap in time
        setTimeout(() => {
          if (!bootstrapReady) {
            reject(new Error('Tor bootstrap timeout'));
          }
        }, 120000); // 2 minute timeout
        
      } catch (err) {
        reject(err);
      }
    });
  }
  
  /**
   * Read the onion address from hidden service
   */
  readOnionAddress() {
    const hostnamePath = path.join(this.options.dataDir, 'hidden_service', 'hostname');
    
    try {
      if (fs.existsSync(hostnamePath)) {
        this.onionAddress = fs.readFileSync(hostnamePath, 'utf8').trim();
        console.log('[Tor] Onion address:', this.onionAddress);
        this.emit('onion-address', this.onionAddress);
        return this.onionAddress;
      }
    } catch (err) {
      console.error('[Tor] Failed to read onion address:', err.message);
    }
    
    return null;
  }
  
  /**
   * Get the SOCKS proxy address
   */
  getSocksProxy() {
    return `socks5://127.0.0.1:${this.options.socksPort}`;
  }
  
  /**
   * Connect to Tor control port
   */
  async connectControl() {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.options.controlPort, '127.0.0.1');
      
      socket.on('connect', () => {
        // Authenticate using cookie
        const cookiePath = path.join(this.options.dataDir, 'control_auth_cookie');
        
        try {
          const cookie = fs.readFileSync(cookiePath);
          const cookieHex = cookie.toString('hex');
          
          socket.write(`AUTHENTICATE ${cookieHex}\r\n`);
        } catch (err) {
          // Try null authentication
          socket.write('AUTHENTICATE\r\n');
        }
      });
      
      socket.on('data', (data) => {
        const response = data.toString();
        if (response.startsWith('250')) {
          resolve(socket);
        } else {
          reject(new Error(`Control authentication failed: ${response}`));
        }
      });
      
      socket.on('error', reject);
    });
  }
  
  /**
   * Send a command to Tor control port
   */
  async sendCommand(command) {
    const socket = await this.connectControl();
    
    return new Promise((resolve, reject) => {
      socket.write(`${command}\r\n`);
      
      socket.on('data', (data) => {
        const response = data.toString();
        socket.end();
        resolve(response);
      });
      
      socket.on('error', (err) => {
        socket.end();
        reject(err);
      });
    });
  }
  
  /**
   * Create a new circuit (renew identity)
   */
  async newIdentity() {
    try {
      const response = await this.sendCommand('SIGNAL NEWNYM');
      console.log('[Tor] New identity requested:', response.trim());
      return response.includes('250');
    } catch (err) {
      console.error('[Tor] Failed to request new identity:', err.message);
      return false;
    }
  }
  
  /**
   * Get Tor status
   */
  async getStatus() {
    try {
      const response = await this.sendCommand('GETINFO status/circuit-established');
      return {
        running: this.isRunning,
        bootstrapped: this.isBootstrapped,
        onionAddress: this.onionAddress,
        circuitEstablished: response.includes('=1')
      };
    } catch (err) {
      return {
        running: this.isRunning,
        bootstrapped: this.isBootstrapped,
        onionAddress: this.onionAddress,
        circuitEstablished: false
      };
    }
  }
  
  /**
   * Stop the Tor daemon
   */
  async stop() {
    if (!this.isRunning || !this.torProcess) {
      return true;
    }
    
    console.log('[Tor] Stopping Tor daemon...');
    
    return new Promise((resolve) => {
      this.torProcess.on('close', () => {
        this.isRunning = false;
        this.isBootstrapped = false;
        resolve(true);
      });
      
      // Try graceful shutdown first
      try {
        this.sendCommand('SIGNAL SHUTDOWN').catch(() => {});
      } catch (e) {
        // Ignore errors
      }
      
      // Force kill after timeout
      setTimeout(() => {
        if (this.torProcess) {
          this.torProcess.kill('SIGTERM');
        }
      }, 3000);
    });
  }
}

/**
 * External Tor Manager - connects to existing Tor daemon
 */
class ExternalTorManager extends TorManager {
  constructor(options = {}) {
    super({
      ...options,
      socksPort: options.socksPort || 9050,
      controlPort: options.controlPort || 9051
    });
  }
  
  async start() {
    // Just check if external Tor is available
    try {
      const socket = await this.connectControl();
      socket.end();
      this.isRunning = true;
      this.isBootstrapped = true;
      console.log('[Tor] Connected to external Tor daemon');
      this.emit('ready');
      return true;
    } catch (err) {
      console.error('[Tor] External Tor not available:', err.message);
      throw err;
    }
  }
  
  async stop() {
    // Don't stop external Tor, just disconnect
    this.isRunning = false;
    this.isBootstrapped = false;
    return true;
  }
}

// Store current mode and instance
let currentMode = 'disabled'; // 'disabled' | 'bundled' | 'external'
let torInstance = null;

/**
 * Get or create Tor manager instance
 */
function getTorManager(mode = 'bundled') {
  if (torInstance && currentMode === mode) {
    return torInstance;
  }
  
  currentMode = mode;
  
  if (mode === 'external') {
    torInstance = new ExternalTorManager();
  } else if (mode === 'bundled') {
    torInstance = new TorManager();
  } else {
    torInstance = null;
  }
  
  return torInstance;
}

/**
 * Check if Tor mode is enabled
 */
function isTorEnabled() {
  return currentMode !== 'disabled' && torInstance?.isRunning;
}

module.exports = {
  TorManager,
  ExternalTorManager,
  getTorManager,
  isTorEnabled
};
