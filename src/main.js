const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { getTorManager } = require('./backend/tor-manager-enhanced');
const identity = require('../sidecar/identity');
const hyperswarm = require('../sidecar/hyperswarm');
const Y = require('yjs');
const awarenessProtocol = require('y-protocols/awareness');
const packageJson = require('../package.json');

// Make version available to preload script
global.APP_VERSION = packageJson.version;

// Get app icon path for windows
function getAppIconPath() {
    if (process.platform === 'win32') {
        const iconPath = app.isPackaged
            ? path.join(process.resourcesPath, 'app.asar.unpacked', 'build', 'icon.ico')
            : path.join(__dirname, '..', 'build', 'icon.ico');
        // Fallback to non-unpacked location
        if (!fs.existsSync(iconPath)) {
            const altPath = app.isPackaged
                ? path.join(path.dirname(app.getPath('exe')), 'resources', 'icon.ico')
                : path.join(__dirname, '..', 'build', 'icon.ico');
            if (fs.existsSync(altPath)) return altPath;
        }
        if (fs.existsSync(iconPath)) return iconPath;
    }
    return undefined;
}

const appIconPath = getAppIconPath();

// Set app user model ID for Windows taskbar icon (must match build.appId in package.json)
if (process.platform === 'win32') {
    app.setAppUserModelId('com.nightjarx.Nightjar');
}

// Cache the logo as base64 for the loading screen
let logoBase64 = '';
try {
    const logoPath = app.isPackaged 
        ? path.join(process.resourcesPath, 'app.asar', 'assets', 'nightjar-logo.png')
        : path.join(__dirname, '..', 'assets', 'nightjar-logo.png');
    if (fs.existsSync(logoPath)) {
        logoBase64 = fs.readFileSync(logoPath).toString('base64');
    }
} catch (e) {
    console.warn('[Main] Could not load logo for splash screen:', e.message);
}

// Register nightjar:// as the default protocol handler for this app
if (process.defaultApp) {
    // Development mode - need to pass app path
    if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient('nightjar', process.execPath, [path.resolve(process.argv[1])]);
    }
} else {
    // Production mode
    app.setAsDefaultProtocolClient('nightjar');
}

// Disable GPU acceleration BEFORE any app initialization
// This MUST be called before app.ready
app.disableHardwareAcceleration();

// Add comprehensive GPU and sandbox flags to prevent renderer crashes
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-gpu-rasterization');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.commandLine.appendSwitch('use-gl', 'swiftshader');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

// Dynamically import electron-is-dev to handle ES modules
let isDev = false; // Default to prod mode (safer)

// Native uint8array conversion using Node.js Buffer (always available)
// Replaces the ESM-only 'uint8arrays' package which fails in ASAR builds
function uint8ArrayFromString(str, encoding = 'utf8') {
    if (encoding === 'base64') {
        return new Uint8Array(Buffer.from(str, 'base64'));
    }
    return new Uint8Array(Buffer.from(str, encoding));
}

// --- Global State ---
let mainWindow;
let p2pNode = null;
let sessionKey = null;
const ydocs = new Map();
const userDataPath = app.getPath('userData');
// NOTE: LevelDB is ONLY opened by the sidecar process to avoid lock conflicts

// Initialize identity storage path to match userData for consistency
// This ensures identity.json is stored in the same location as other app data
// and enables migration from the legacy ~/.Nightjar path
identity.setBasePath(userDataPath);
identity.migrateIdentityIfNeeded();

// Add global error handlers to prevent unexpected exits
process.on('uncaughtException', (error) => {
    console.error('[Main] Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Main] Unhandled Rejection at:', promise, 'reason:', reason);
});

// Helper to safely check if mainWindow is usable
function isWindowUsable() {
    try {
        return mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents;
    } catch (e) {
        return false;
    }
}

// Helper to safely send IPC message to mainWindow
function safeSend(channel, ...args) {
    try {
        if (isWindowUsable()) {
            mainWindow.webContents.send(channel, ...args);
        }
    } catch (e) {
        console.error(`[Main] Failed to send ${channel}:`, e.message);
    }
}

// Helper to safely focus mainWindow
function safeFocusWindow() {
    try {
        if (isWindowUsable()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    } catch (e) {
        console.error('[Main] Failed to focus window:', e.message);
    }
}

// Helper to validate IPC sender is from mainWindow
function validateSender(event) {
    return event.sender === mainWindow?.webContents;
}

// Central awareness object for the backend
const awareness = new awarenessProtocol.Awareness(new Y.Doc());

// --- P2P and Yjs Bridge Logic ---
const DOC_PUBSUB_TOPIC = '/nightjarx/1.0.0/doc';
const AWARENESS_PUBSUB_TOPIC = '/nightjarx/1.0.0/awareness';

const bindP2PToYDoc = (doc) => {
    // NOTE: P2P sync is now handled by the sidecar process
    // This legacy handler is kept for compatibility but does nothing
    doc.on('update', async (update, origin) => {
        // Sidecar handles persistence and P2P publishing
    });
};

const getDoc = (roomName) => {
    let doc = ydocs.get(roomName);
    if (!doc) {
        doc = new Y.Doc();
        ydocs.set(roomName, doc);
        bindP2PToYDoc(doc);
    }
    return doc;
};

// --- Main Application Lifecycle ---
function createWindow() {
    // Prevent duplicate window creation
    if (mainWindow && !mainWindow.isDestroyed()) {
        console.log('[Main] Window already exists, focusing instead of creating');
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        return;
    }
    
    mainWindow = new BrowserWindow({
        width: 1600,
        height: 1000,
        backgroundColor: '#242424',
        show: false, // Don't show until ready
        icon: appIconPath, // Set window icon for taskbar/title bar
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webgl: false, // Disable WebGL to avoid GPU issues
            enableBlinkFeatures: '',
        },
    });

    // Show window when ready to prevent white flash
    mainWindow.once('ready-to-show', () => {
        console.log('[Main] Window ready-to-show event fired');
        mainWindow.show();
    });

    // In dev mode, load from Vite dev server
    // In production, load from the bundled frontend/dist folder
    const url = isDev ? 'http://127.0.0.1:5174' : `file://${path.join(__dirname, '../frontend/dist/index.html')}`;
    
    console.log(`[Main] Loading URL: ${url} (isDev: ${isDev})`);
    
    // Retry loading URL if it fails (race condition with Vite startup)
    const loadWithRetry = (retries = 10, delay = 1500) => {
        mainWindow.loadURL(url).then(() => {
            console.log('[Main] Successfully loaded:', url);
        }).catch(err => {
            console.error('[Main] Error loading URL:', err.message);
            if (retries > 0) {
                console.log(`[Main] Retrying in ${delay/1000}s... (${retries} attempts left)`);
                setTimeout(() => loadWithRetry(retries - 1, delay), delay);
            } else {
                console.error('[Main] Failed to load after all retries. Showing error page.');
                // Show a fallback page
                mainWindow.loadURL(`data:text/html,<html><body style="background:#242424;color:white;font-family:sans-serif;padding:2em;"><h1>Failed to load application</h1><p>The Vite dev server at ${url} is not responding.</p><p>Please ensure the dev server is running and restart the application.</p></body></html>`);
                mainWindow.show(); // Force show on error
            }
        });
    };
    
    loadWithRetry();

    if (isDev && !app.isPackaged) {
        mainWindow.webContents.openDevTools();
    }
}

// Handle nightjar:// protocol links
function handleProtocolLink(url) {
    console.log('[Protocol] Received link:', url);
    // Parse the nightjar:// URL and send to renderer
    safeSend('protocol-link', url);
    safeFocusWindow();
}

// Windows: Handle protocol links when app is already running
app.on('second-instance', (event, commandLine) => {
    // Someone tried to run a second instance, focus our window
    safeFocusWindow();
    // Protocol link is in commandLine on Windows
    const protocolLink = commandLine.find(arg => arg.startsWith('nightjar://'));
    if (protocolLink) {
        handleProtocolLink(protocolLink);
    }
});

// macOS: Handle protocol links
app.on('open-url', (event, url) => {
    event.preventDefault();
    handleProtocolLink(url);
});

// Request single instance lock for Windows protocol handling
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
}

app.on('ready', async () => {
    console.log('[Main] App ready event fired');
    
    // Load required modules
    console.log('[Main] Loading modules...');
    try {
        console.log('[Main] Importing electron-is-dev...');
        const electronIsDev = await import('electron-is-dev');
        isDev = electronIsDev.default;
        console.log('[Main] electron-is-dev loaded, isDev:', isDev);
    } catch (e) {
        console.error('[Main] Failed to import electron-is-dev:', e.message);
        console.error('[Main] Full error:', e);
        isDev = !app.isPackaged;
        console.log('[Main] Using fallback isDev check:', isDev);
    }
    
    console.log('[Main] Modules loaded, starting backend...');
    
    // Add a timeout fallback to ensure a window is always created
    const fallbackTimer = setTimeout(() => {
        console.warn('[Main] Backend startup timeout, creating window anyway...');
        if (!mainWindow) {
            createWindow();
        }
    }, 15000); // 15 second fallback
    
    // Start sidecar first with loading screen, then create main window
    try {
        console.log('[Main] Calling startBackendWithLoadingScreen...');
        await startBackendWithLoadingScreen();
        console.log('[Main] Backend startup complete');
        clearTimeout(fallbackTimer);
    } catch (err) {
        console.error('[Main] Backend startup failed:', err);
        console.error('[Main] Full backend error:', err);
        clearTimeout(fallbackTimer);
        // Create window anyway to show error
        createWindow();
    }
    
    // Handle protocol link if app was opened with one (Windows)
    const protocolLink = process.argv.find(arg => arg.startsWith('nightjar://'));
    if (protocolLink && isWindowUsable()) {
        // Wait for window to be ready
        mainWindow.webContents.once('did-finish-load', () => {
            handleProtocolLink(protocolLink);
        });
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// --- Funny loading messages ---
const LOADING_MESSAGES = [
    { step: 'init', funny: "Waking up the hamsters...", real: "Initializing backend" },
    { step: 'storage', funny: "Dusting off the filing cabinets...", real: "Opening storage" },
    { step: 'metadata', funny: "Teaching neurons to remember things...", real: "Loading metadata" },
    { step: 'yjs', funny: "Syncing the quantum flux capacitors...", real: "Starting sync server" },
    { step: 'websocket', funny: "Untangling the web of sockets...", real: "Starting WebSocket server" },
    { step: 'documents', funny: "Herding digital cats...", real: "Loading documents" },
    { step: 'ready', funny: "Polishing the pixels...", real: "Almost ready" },
    { step: 'complete', funny: "Achievement unlocked: App loaded!", real: "Ready!" },
];

// --- Loading Screen HTML ---
function getLoadingScreenHtml(step = 0, message = '') {
    const progress = Math.min(100, Math.round((step / 7) * 100));
    const currentMsg = LOADING_MESSAGES[Math.min(step, LOADING_MESSAGES.length - 1)];
    const funny = currentMsg?.funny || message;
    const real = currentMsg?.real || message;
    
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Nightjar - Loading</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            color: white;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            overflow: hidden;
        }
        .container {
            text-align: center;
            padding: 2rem;
            max-width: 500px;
        }
        .logo {
            width: 120px;
            height: 120px;
            margin-bottom: 1rem;
            animation: pulse 2s ease-in-out infinite;
        }
        .logo img {
            width: 100%;
            height: 100%;
            object-fit: contain;
        }
        @keyframes pulse {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.05); opacity: 0.8; }
        }
        h1 {
            font-size: 2.5rem;
            font-weight: 300;
            margin-bottom: 2rem;
            background: linear-gradient(90deg, #fff, #a5b4fc);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .progress-container {
            width: 100%;
            height: 8px;
            background: rgba(255,255,255,0.1);
            border-radius: 4px;
            overflow: hidden;
            margin-bottom: 1.5rem;
        }
        .progress-bar {
            height: 100%;
            background: linear-gradient(90deg, #6366f1, #8b5cf6, #a855f7);
            border-radius: 4px;
            transition: width 0.3s ease;
            width: ${progress}%;
        }
        .message-funny {
            font-size: 1.2rem;
            color: #a5b4fc;
            margin-bottom: 0.5rem;
            min-height: 1.5rem;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .message-real {
            font-size: 0.9rem;
            color: rgba(255,255,255,0.5);
        }
        .dots {
            display: inline-block;
            width: 1.5em;
            text-align: left;
        }
        .dots::after {
            content: '';
            animation: dots 1.5s steps(4, end) infinite;
        }
        @keyframes dots {
            0%, 20% { content: ''; }
            40% { content: '.'; }
            60% { content: '..'; }
            80%, 100% { content: '...'; }
        }
        .version {
            position: fixed;
            bottom: 1rem;
            right: 1rem;
            font-size: 0.75rem;
            color: rgba(255,255,255,0.3);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">
            ${logoBase64 ? `<img src="data:image/png;base64,${logoBase64}" alt="Nightjar" />` : ''}
        </div>
        <h1>Nightjar</h1>
        <div class="progress-container">
            <div class="progress-bar" id="progress"></div>
        </div>
        <div class="message-funny" id="funny">${funny}<span class="dots"></span></div>
        <div class="message-real" id="real">${real}</div>
    </div>
    <div class="version">v${packageJson.version}</div>
</body>
</html>`;
}

// --- Backend Initialization with Loading Screen ---
let loadingWindow = null;
let sidecarProcess = null;
let sidecarRestartAttempts = 0;
const SIDECAR_MAX_RESTART_ATTEMPTS = 3;

// Sidecar log buffer for diagnostics
let sidecarLogBuffer = [];
const MAX_SIDECAR_LOGS = 1000;

function addSidecarLog(level, message) {
    sidecarLogBuffer.push({
        timestamp: new Date().toISOString(),
        level: level,
        message: message
    });
    if (sidecarLogBuffer.length > MAX_SIDECAR_LOGS) {
        sidecarLogBuffer.shift();
    }
}

/**
 * Restart sidecar after a crash
 * Limited to SIDECAR_MAX_RESTART_ATTEMPTS to prevent infinite loops
 */
function restartSidecar(nodeExecutable, nodeArgs, sidecarCwd, spawnEnv) {
    sidecarRestartAttempts++;
    
    if (sidecarRestartAttempts > SIDECAR_MAX_RESTART_ATTEMPTS) {
        console.error(`[Sidecar] Max restart attempts (${SIDECAR_MAX_RESTART_ATTEMPTS}) reached, giving up`);
        addSidecarLog('error', `Max restart attempts (${SIDECAR_MAX_RESTART_ATTEMPTS}) reached, giving up`);
        return;
    }
    
    console.log(`[Sidecar] Restart attempt ${sidecarRestartAttempts}/${SIDECAR_MAX_RESTART_ATTEMPTS}`);
    addSidecarLog('info', `Restart attempt ${sidecarRestartAttempts}/${SIDECAR_MAX_RESTART_ATTEMPTS}`);
    
    sidecarProcess = spawn(nodeExecutable, nodeArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: sidecarCwd,
        env: spawnEnv,
    });
    
    sidecarProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log(`[Sidecar] ${output}`);
        addSidecarLog('info', output);
        
        // Reset restart counter on successful startup
        if (output.includes('Metadata WebSocket server listening')) {
            console.log('[Sidecar] Successfully restarted');
            sidecarRestartAttempts = 0;
        }
    });
    
    sidecarProcess.stderr.on('data', (data) => {
        const output = data.toString();
        console.error(`[Sidecar Error] ${output}`);
        addSidecarLog('error', output);
    });
    
    sidecarProcess.on('error', (err) => {
        console.error('[Sidecar] Failed to restart:', err);
        addSidecarLog('error', `Failed to restart: ${err.message}`);
    });
    
    sidecarProcess.on('close', (code) => {
        console.log(`[Sidecar] Restarted process exited with code ${code}`);
        addSidecarLog('info', `Restarted process exited with code ${code}`);
        if (code !== 0) {
            console.log('[Sidecar] Crashed again, attempting restart...');
            setTimeout(() => {
                restartSidecar(nodeExecutable, nodeArgs, sidecarCwd, spawnEnv);
            }, 2000);
        }
    });
}

async function startBackendWithLoadingScreen() {
    console.log('[Main] startBackendWithLoadingScreen() called');
    return new Promise((resolve, reject) => {
        console.log('[Main] Creating loading window...');
        // Create loading window
        loadingWindow = new BrowserWindow({
            width: 500,
            height: 400,
            frame: false,
            transparent: false,
            backgroundColor: '#1a1a2e',
            resizable: false,
            show: false,
            icon: appIconPath, // Set window icon
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
            },
        });

        console.log('[Main] Loading window created, loading content...');
        loadingWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(getLoadingScreenHtml(0))}`);
        loadingWindow.once('ready-to-show', () => {
            console.log('[Main] Loading window ready-to-show');
            loadingWindow.show();
        });

        let currentStep = 0;
        const updateProgress = (step, customFunny = null, customReal = null) => {
            currentStep = step;
            if (loadingWindow && !loadingWindow.isDestroyed()) {
                const msg = LOADING_MESSAGES[Math.min(step, LOADING_MESSAGES.length - 1)];
                const progress = Math.min(100, Math.round((step / 7) * 100));
                // Use textContent instead of innerHTML to prevent XSS
                // Escape single quotes in messages to prevent JS injection
                const escapedFunny = (customFunny || msg.funny).replace(/'/g, "\\'");
                const escapedReal = (customReal || msg.real).replace(/'/g, "\\'");
                loadingWindow.webContents.executeJavaScript(`
                    document.getElementById('progress').style.width = '${progress}%';
                    document.getElementById('funny').textContent = '${escapedFunny}';
                    document.getElementById('real').textContent = '${escapedReal}';
                `).catch(() => {});
            }
        };

        // Get user data path for storage
        const userDataPath = app.getPath('userData');
        console.log(`[Backend] User data path: ${userDataPath}`);

        // Determine sidecar path and how to run it
        // In development: spawn 'node sidecar/index.js'
        // In packaged app: files are in app.asar.unpacked (due to asarUnpack config)
        
        // Platform-specific path resolution
        let sidecarPath;
        if (app.isPackaged) {
            if (process.platform === 'darwin') {
                // macOS: app.asar.unpacked is in Contents/Resources/
                sidecarPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'sidecar', 'index.js');
            } else {
                // Windows/Linux: standard path
                sidecarPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'sidecar', 'index.js');
            }
        } else {
            sidecarPath = path.join(process.cwd(), 'sidecar', 'index.js');
        }
        
        console.log(`[Backend] Sidecar path: ${sidecarPath}`);
        console.log(`[Backend] Sidecar exists: ${require('fs').existsSync(sidecarPath)}`);
        
        // Use Electron's bundled Node.js (same as the main process)
        // For packaged apps, we need to run the sidecar as a fork or use electron.exe
        // Since Electron includes Node.js, we can use process.execPath with --require
        const nodeExecutable = app.isPackaged ? process.execPath : 'node';
        const nodeArgs = app.isPackaged 
            ? [sidecarPath, userDataPath]
            : ['sidecar/index.js', userDataPath];
        
        // For packaged Electron apps, we need to tell Electron to run as Node.js
        // by setting ELECTRON_RUN_AS_NODE environment variable
        // We also need to set NODE_PATH so the sidecar can find dependencies in app.asar
        let appAsarPath = null;
        let spawnEnv;
        
        if (app.isPackaged) {
            if (process.platform === 'darwin') {
                // macOS: Contents/Resources/app.asar/node_modules
                appAsarPath = path.join(process.resourcesPath, 'app.asar', 'node_modules');
            } else {
                // Windows/Linux: app.asar/node_modules  
                appAsarPath = path.join(process.resourcesPath, 'app.asar', 'node_modules');
            }
            
            spawnEnv = { 
                ...process.env, 
                ELECTRON_RUN_AS_NODE: '1',
                NODE_PATH: appAsarPath
            };
            
            console.log(`[Backend] NODE_PATH: ${appAsarPath}`);
            console.log(`[Backend] NODE_PATH exists: ${require('fs').existsSync(appAsarPath)}`);
        } else {
            spawnEnv = process.env;
        }
        
        // Working directory for the sidecar - unpacked folder for packaged app
        let sidecarCwd;
        if (app.isPackaged) {
            if (process.platform === 'darwin') {
                // macOS: Contents/Resources/app.asar.unpacked
                sidecarCwd = path.join(process.resourcesPath, 'app.asar.unpacked');
            } else {
                // Windows/Linux: app.asar.unpacked
                sidecarCwd = path.join(process.resourcesPath, 'app.asar.unpacked');
            }
        } else {
            sidecarCwd = process.cwd();
        }
        
        console.log(`[Backend] Starting sidecar: ${nodeExecutable} ${nodeArgs.join(' ')}`);
        console.log(`[Backend] Sidecar cwd: ${sidecarCwd}`);
        console.log(`[Backend] Sidecar cwd exists: ${require('fs').existsSync(sidecarCwd)}`);
        console.log(`[Backend] Platform: ${process.platform}`);
        console.log(`[Backend] Packaged: ${app.isPackaged}`);
        console.log(`[Backend] Resources path: ${process.resourcesPath}`);
        console.log(`[Backend] Sidecar env ELECTRON_RUN_AS_NODE: ${spawnEnv.ELECTRON_RUN_AS_NODE}`);
        console.log(`[Backend] Node executable path: ${nodeExecutable}`);
        console.log(`[Backend] Node executable exists: ${require('fs').existsSync(nodeExecutable)}`);
        
        // On Windows packaged apps, add diagnostics
        if (process.platform === 'win32' && app.isPackaged) {
            const fs = require('fs');
            console.log(`[Backend] Win: app.asar.unpacked path: ${sidecarCwd}`);
            console.log(`[Backend] Win: sidecar path exists: ${fs.existsSync(sidecarPath)}`);
            
            const unpackedNodeModules = path.join(sidecarCwd, 'node_modules');
            console.log(`[Backend] Win: unpacked node_modules exists: ${fs.existsSync(unpackedNodeModules)}`);
            
            // List contents of resources folder
            try {
                const resourcesContents = fs.readdirSync(process.resourcesPath);
                console.log(`[Backend] Win: resources contents: ${resourcesContents.join(', ')}`);
                
                // Check if app.asar.unpacked exists
                const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked');
                if (fs.existsSync(unpackedPath)) {
                    const unpackedContents = fs.readdirSync(unpackedPath);
                    console.log(`[Backend] Win: app.asar.unpacked contents: ${unpackedContents.join(', ')}`);
                    
                    // Check if sidecar folder exists inside unpacked
                    const sidecarFolder = path.join(unpackedPath, 'sidecar');
                    if (fs.existsSync(sidecarFolder)) {
                        const sidecarFiles = fs.readdirSync(sidecarFolder).slice(0, 10);
                        console.log(`[Backend] Win: sidecar folder contents: ${sidecarFiles.join(', ')}`);
                    } else {
                        console.error(`[Backend] Win: sidecar folder NOT FOUND at ${sidecarFolder}`);
                        console.error(`[Backend] Win: This means asarUnpack config is missing or incorrect`);
                    }
                } else {
                    console.error(`[Backend] Win: app.asar.unpacked NOT FOUND at ${unpackedPath}`);
                    console.error(`[Backend] Win: Files are still inside ASAR - need to rebuild with asarUnpack config`);
                }
            } catch (e) {
                console.error(`[Backend] Win: Failed to list resources: ${e.message}`);
            }
        }
        
        // On macOS packaged apps, check for additional paths
        if (process.platform === 'darwin' && app.isPackaged) {
            const fs = require('fs');
            const unpackedNodeModules = path.join(sidecarCwd, 'node_modules');
            console.log(`[Backend] Mac: unpacked node_modules exists: ${fs.existsSync(unpackedNodeModules)}`);
            
            // List first few items in sidecar folder for debugging
            const sidecarFolder = path.join(sidecarCwd, 'sidecar');
            if (fs.existsSync(sidecarFolder)) {
                try {
                    const sidecarFiles = fs.readdirSync(sidecarFolder).slice(0, 10);
                    console.log(`[Backend] Mac: sidecar folder contents: ${sidecarFiles.join(', ')}`);
                } catch (e) {
                    console.error(`[Backend] Mac: Failed to list sidecar folder: ${e.message}`);
                }
            } else {
                console.error(`[Backend] Mac: sidecar folder NOT FOUND at ${sidecarFolder}`);
            }
            
            // Check for level native module (common issue on Mac)
            const levelPath = path.join(unpackedNodeModules, 'level');
            const classicLevelPath = path.join(unpackedNodeModules, 'classic-level');
            console.log(`[Backend] Mac: level module exists: ${fs.existsSync(levelPath)}`);
            console.log(`[Backend] Mac: classic-level module exists: ${fs.existsSync(classicLevelPath)}`);
        }
        
        sidecarProcess = spawn(nodeExecutable, nodeArgs, {
            stdio: ['ignore', 'pipe', 'pipe'],
            cwd: sidecarCwd,
            env: spawnEnv,
        });

        console.log('[Backend] Sidecar process spawned, PID:', sidecarProcess.pid);

        let wsReady = false;
        let metaWsReady = false;
        let resolved = false; // Track if we've already resolved

        const checkReady = () => {
            if (wsReady && metaWsReady && !resolved) {
                resolved = true; // Mark as resolved to prevent duplicate calls
                updateProgress(7); // Complete
                setTimeout(() => {
                    console.log('[Main] Backend ready, creating main window...');
                    
                    // Create main window FIRST, before closing loading window
                    createWindow();
                    
                    // Send connection info once window is ready and ENSURE main window is shown
                    if (mainWindow) {
                        mainWindow.webContents.once('did-finish-load', () => {
                            console.log('[Main] Main window loaded, sending connection info');
                            safeSend('connection-info', {
                                onionAddress: 'localhost',
                                peerId: 'local-peer-id',
                                multiaddr: '/ip4/127.0.0.1/tcp/8080'
                            });
                        });
                        
                        // Ensure main window is shown before closing loading window
                        mainWindow.once('ready-to-show', () => {
                            console.log('[Main] Main window shown, closing loading window');
                            // Close loading window AFTER main window is shown
                            if (loadingWindow && !loadingWindow.isDestroyed()) {
                                console.log('[Main] Closing loading window');
                                loadingWindow.close();
                                loadingWindow = null;
                            }
                        });
                        
                        // Fallback: force show after timeout to prevent app exit
                        setTimeout(() => {
                            if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
                                console.log('[Main] Forcing main window to show (fallback)');
                                mainWindow.show();
                            }
                        }, 2000);
                    }
                    
                    resolve();
                }, 300); // Brief delay to show "Ready!" message
            }
        };

        sidecarProcess.stdout.on('data', (data) => {
            const output = data.toString();
            console.log(`[Sidecar] ${output}`);
            addSidecarLog('info', output);

            // Parse sidecar output to update progress
            if (output.includes('Initialized LevelDB')) {
                updateProgress(1);
            } else if (output.includes('Initialized metadata DB')) {
                updateProgress(2);
            } else if (output.includes('Loading document list')) {
                updateProgress(3);
            } else if (output.includes('Loaded') && output.includes('documents')) {
                updateProgress(4);
            } else if (output.includes('Yjs WebSocket server listening')) {
                updateProgress(5);
                wsReady = true;
                checkReady();
            } else if (output.includes('Metadata WebSocket server listening')) {
                updateProgress(6);
                metaWsReady = true;
                checkReady();
            }
        });

        sidecarProcess.stderr.on('data', (data) => {
            const output = data.toString();
            console.error(`[Sidecar Error] ${output}`);
            addSidecarLog('error', output);
        });

        sidecarProcess.on('error', (err) => {
            console.error('[Backend] Failed to start sidecar:', err);
            addSidecarLog('error', `Failed to start: ${err.message}`);
            
            // Mac-specific fallback: try alternative startup method
            if (process.platform === 'darwin' && app.isPackaged) {
                console.log('[Backend] Trying Mac fallback: direct node execution');
                try {
                    // Try using direct node path with explicit module resolution
                    const nodePath = path.join(process.resourcesPath, '..', 'Frameworks', 'Electron Framework.framework', 'Resources', 'node');
                    if (require('fs').existsSync(nodePath)) {
                        console.log(`[Backend] Found Electron node at: ${nodePath}`);
                        const fallbackArgs = [
                            '--no-deprecation',
                            sidecarPath,
                            userDataPath
                        ];
                        const fallbackEnv = {
                            ...process.env,
                            NODE_PATH: path.join(sidecarCwd, 'node_modules')
                        };
                        
                        console.log('[Backend] Attempting Mac fallback startup...');
                        sidecarProcess = spawn(nodePath, fallbackArgs, {
                            stdio: ['ignore', 'pipe', 'pipe'],
                            cwd: sidecarCwd,
                            env: fallbackEnv,
                        });
                        
                        // Re-attach event listeners for fallback process
                        sidecarProcess.stdout.on('data', (data) => {
                            const output = data.toString();
                            console.log(`[Sidecar Fallback] ${output}`);
                            addSidecarLog('info', `[Fallback] ${output}`);
                        });
                        
                        sidecarProcess.stderr.on('data', (data) => {
                            const output = data.toString();
                            console.error(`[Sidecar Fallback Error] ${output}`);
                            addSidecarLog('error', `[Fallback] ${output}`);
                        });
                        
                        return; // Don't reject, let fallback attempt run
                    }
                } catch (fallbackErr) {
                    console.error('[Backend] Mac fallback also failed:', fallbackErr);
                    addSidecarLog('error', `Mac fallback failed: ${fallbackErr.message}`);
                }
            }
            
            if (loadingWindow && !loadingWindow.isDestroyed()) {
                loadingWindow.loadURL(`data:text/html,<html><body style="background:#242424;color:white;font-family:sans-serif;padding:2em;text-align:center;"><h1>⚠️ Startup Error</h1><p>${err.message}</p><p>Platform: ${process.platform}</p><p>Check console for details</p></body></html>`);
            }
            reject(err);
        });

        sidecarProcess.on('close', (code) => {
            console.log(`[Sidecar] Process exited with code ${code}`);
            addSidecarLog('info', `Process exited with code ${code}`);
            
            // On macOS, code 1 often means module loading failed
            if (code !== 0 && process.platform === 'darwin' && app.isPackaged) {
                console.error('[Sidecar] Mac: Process crashed on startup - this usually means native module issues');
                console.error('[Sidecar] Mac: Check that classic-level was rebuilt for the correct Electron version');
                addSidecarLog('error', 'Mac startup crash - likely native module issue');
            }
            
            if (code !== 0 && !wsReady) {
                reject(new Error(`Sidecar exited with code ${code}`));
            }
            
            // Auto-restart sidecar on crash (after initial startup succeeds)
            if (code !== 0 && wsReady && metaWsReady) {
                console.log('[Sidecar] Crashed after startup, attempting restart...');
                setTimeout(() => {
                    restartSidecar(nodeExecutable, nodeArgs, sidecarCwd, spawnEnv);
                }, 1000);
            }
        });

        // Timeout fallback - if sidecar takes too long, proceed anyway
        setTimeout(() => {
            if (!wsReady || !metaWsReady) {
                console.warn('[Backend] Sidecar startup timeout, proceeding anyway...');
                wsReady = true;
                metaWsReady = true;
                checkReady();
            }
        }, 10000); // 10 second timeout
    });
}

// Keep the old function for backwards compatibility (not used anymore)
async function startBackend() {
    // Now handled by startBackendWithLoadingScreen
    console.log('[Backend] startBackend() called but using new loading screen flow');
}

// --- IPC Handlers ---
ipcMain.on('set-key', async (event, keyPayload) => {
    if (!validateSender(event)) {
        console.warn('[Security] Rejected IPC from unknown sender');
        return;
    }
    // NOTE: Database operations are now handled by the sidecar process
    // This legacy handler just acknowledges the key and returns current doc state
    console.log('[Backend] Received session key.');
    sessionKey = uint8ArrayFromString(keyPayload, 'base64');
    const doc = getDoc('p2p-editor-room');
    // Sidecar handles persistence - just return current in-memory state
    const fullUpdate = Y.encodeStateAsUpdate(doc);
    event.sender.send('yjs-update', fullUpdate);
});

ipcMain.on('yjs-update', (event, update) => {
    const doc = getDoc('p2p-editor-room');
    Y.applyUpdate(doc, new Uint8Array(update), 'ipc');
});

ipcMain.on('awareness-update', (event, update) => {
    awarenessProtocol.applyAwarenessUpdate(awareness, new Uint8Array(update), 'ipc');
});

// Relay awareness changes to the frontend and P2P network
awareness.on('update', (changes, origin) => {
    const changedClients = changes.added.concat(changes.updated).concat(changes.removed);
    const update = awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients);
    
    if (origin !== 'p2p') {
        if (p2pNode) p2pNode.services.pubsub.publish(AWARENESS_PUBSUB_TOPIC, update);
    }
    if (origin !== 'ipc') {
        safeSend('awareness-update', update);
    }
});

// --- Identity IPC Handlers ---
ipcMain.handle('identity:load', async (event) => {
    if (!validateSender(event)) {
        console.warn('[Security] Rejected IPC from unknown sender');
        throw new Error('Unauthorized IPC sender');
    }
    try {
        const stored = identity.loadIdentity();
        if (stored) {
            // Convert Uint8Arrays to hex for transport
            return {
                privateKeyHex: Buffer.from(stored.privateKey).toString('hex'),
                publicKeyHex: Buffer.from(stored.publicKey).toString('hex'),
                publicKeyBase62: stored.publicKeyBase62,
                mnemonic: stored.mnemonic,
                handle: stored.handle,
                color: stored.color,
                icon: stored.icon,
                createdAt: stored.createdAt,
                devices: stored.devices
            };
        }
        return null;
    } catch (err) {
        console.error('[Identity] Load error:', err);
        return null;
    }
});

ipcMain.handle('identity:store', async (event, identityData) => {
    if (!validateSender(event)) {
        console.warn('[Security] Rejected IPC from unknown sender');
        throw new Error('Unauthorized IPC sender');
    }
    try {
        // Convert hex back to Uint8Arrays if needed
        const toStore = {
            privateKey: identityData.privateKeyHex 
                ? new Uint8Array(Buffer.from(identityData.privateKeyHex, 'hex'))
                : new Uint8Array(identityData.privateKey),
            publicKey: identityData.publicKeyHex
                ? new Uint8Array(Buffer.from(identityData.publicKeyHex, 'hex'))
                : new Uint8Array(identityData.publicKey),
            publicKeyBase62: identityData.publicKeyBase62,
            mnemonic: identityData.mnemonic,
            handle: identityData.handle,
            color: identityData.color,
            icon: identityData.icon,
            createdAt: identityData.createdAt,
            devices: identityData.devices
        };
        identity.storeIdentity(toStore);
        return true;
    } catch (err) {
        console.error('[Identity] Store error:', err);
        throw err;
    }
});

ipcMain.handle('identity:update', async (event, updates) => {
    if (!validateSender(event)) {
        console.warn('[Security] Rejected IPC from unknown sender');
        throw new Error('Unauthorized IPC sender');
    }
    try {
        identity.updateIdentity(updates);
        return true;
    } catch (err) {
        console.error('[Identity] Update error:', err);
        throw err;
    }
});

ipcMain.handle('identity:delete', async (event) => {
    if (!validateSender(event)) {
        console.warn('[Security] Rejected IPC from unknown sender');
        throw new Error('Unauthorized IPC sender');
    }
    try {
        identity.deleteIdentity();
        return true;
    } catch (err) {
        console.error('[Identity] Delete error:', err);
        throw err;
    }
});

ipcMain.handle('identity:has', async (event) => {
    if (!validateSender(event)) {
        console.warn('[Security] Rejected IPC from unknown sender');
        throw new Error('Unauthorized IPC sender');
    }
    return identity.hasIdentity();
});

ipcMain.handle('identity:validate', async (event, mnemonic) => {
    if (!validateSender(event)) {
        console.warn('[Security] Rejected IPC from unknown sender');
        throw new Error('Unauthorized IPC sender');
    }
    try {
        return identity.validateRecoveryPhrase(mnemonic);
    } catch (err) {
        console.error('[Identity] Validation error:', err);
        return false;
    }
});

ipcMain.handle('identity:export', async (event, password) => {
    if (!validateSender(event)) {
        console.warn('[Security] Rejected IPC from unknown sender');
        throw new Error('Unauthorized IPC sender');
    }
    try {
        return identity.exportIdentity(password);
    } catch (err) {
        console.error('[Identity] Export error:', err);
        throw err;
    }
});

ipcMain.handle('identity:import', async (event, data, password) => {
    if (!validateSender(event)) {
        console.warn('[Security] Rejected IPC from unknown sender');
        throw new Error('Unauthorized IPC sender');
    }
    try {
        const restored = identity.importIdentity(data, password);
        return {
            privateKeyHex: Buffer.from(restored.privateKey).toString('hex'),
            publicKeyHex: Buffer.from(restored.publicKey).toString('hex'),
            publicKeyBase62: restored.publicKeyBase62,
            mnemonic: restored.mnemonic,
            handle: restored.handle,
            color: restored.color,
            icon: restored.icon,
            createdAt: restored.createdAt,
            devices: restored.devices
        };
    } catch (err) {
        console.error('[Identity] Import error:', err);
        throw err;
    }
});

// --- Hyperswarm IPC Handlers ---
const swarmManager = hyperswarm.getInstance();

// Forward Hyperswarm events to the renderer
swarmManager.on('peer-joined', (data) => {
    safeSend('hyperswarm:peer-joined', data);
});

swarmManager.on('peer-left', (data) => {
    safeSend('hyperswarm:peer-left', data);
});

swarmManager.on('peer-identity', (data) => {
    safeSend('hyperswarm:peer-identity', data);
});

swarmManager.on('sync-message', (data) => {
    // Apply sync to local Yjs doc
    const doc = getDoc('p2p-editor-room');
    const updateBuffer = Buffer.from(data.data, 'base64');
    Y.applyUpdate(doc, updateBuffer, 'p2p');
    
    // Forward to renderer
    safeSend('hyperswarm:sync-message', data);
    safeSend('yjs-update', updateBuffer);
});

swarmManager.on('awareness-update', (data) => {
    safeSend('hyperswarm:awareness-update', data);
});

ipcMain.handle('hyperswarm:initialize', async (event, identityData) => {
    try {
        await swarmManager.initialize({
            publicKey: identityData.publicKeyHex || identityData.publicKey,
            secretKey: identityData.privateKeyHex || identityData.privateKey,
            displayName: identityData.handle || 'Anonymous',
            color: identityData.color || '#6366f1'
        });
        return true;
    } catch (err) {
        console.error('[Hyperswarm] Initialize error:', err);
        throw err;
    }
});

ipcMain.handle('hyperswarm:join', async (event, topicHex) => {
    try {
        await swarmManager.joinTopic(topicHex);
        return true;
    } catch (err) {
        console.error('[Hyperswarm] Join error:', err);
        throw err;
    }
});

ipcMain.handle('hyperswarm:leave', async (event, topicHex) => {
    try {
        await swarmManager.leaveTopic(topicHex);
        return true;
    } catch (err) {
        console.error('[Hyperswarm] Leave error:', err);
        throw err;
    }
});

ipcMain.on('hyperswarm:sync', (event, { topic, data }) => {
    swarmManager.broadcastSync(topic, data);
});

ipcMain.on('hyperswarm:awareness', (event, { topic, state }) => {
    swarmManager.broadcastAwareness(topic, state);
});

ipcMain.handle('hyperswarm:peers', async (event, topicHex) => {
    return swarmManager.getPeers(topicHex);
});

ipcMain.handle('hyperswarm:connectionCount', async () => {
    return swarmManager.getConnectionCount();
});

ipcMain.handle('hyperswarm:destroy', async () => {
    try {
        await swarmManager.destroy();
        return true;
    } catch (err) {
        console.error('[Hyperswarm] Destroy error:', err);
        throw err;
    }
});

// --- Tor IPC Handlers ---
let torManager = null;

ipcMain.handle('tor:start', async (event, mode = 'bundled') => {
    try {
        torManager = getTorManager(mode);
        
        // Forward events to renderer
        torManager.on('bootstrap', (progress) => {
            safeSend('tor:bootstrap', progress);
        });
        
        torManager.on('ready', () => {
            safeSend('tor:ready');
        });
        
        torManager.on('error', (err) => {
            safeSend('tor:error', err.message);
        });
        
        await torManager.start();
        return true;
    } catch (err) {
        console.error('[Tor] Start error:', err);
        throw err;
    }
});

ipcMain.handle('tor:stop', async () => {
    try {
        if (torManager) {
            await torManager.stop();
        }
        return true;
    } catch (err) {
        console.error('[Tor] Stop error:', err);
        throw err;
    }
});

ipcMain.handle('tor:status', async () => {
    try {
        if (torManager) {
            return await torManager.getStatus();
        }
        return {
            running: false,
            bootstrapped: false,
            onionAddress: null,
            circuitEstablished: false
        };
    } catch (err) {
        console.error('[Tor] Status error:', err);
        return {
            running: false,
            bootstrapped: false,
            onionAddress: null,
            circuitEstablished: false
        };
    }
});

ipcMain.handle('tor:newIdentity', async () => {
    try {
        if (torManager) {
            return await torManager.newIdentity();
        }
        return false;
    } catch (err) {
        console.error('[Tor] New identity error:', err);
        throw err;
    }
});

ipcMain.handle('tor:socksProxy', async () => {
    if (torManager) {
        return torManager.getSocksProxy();
    }
    return null;
});

ipcMain.handle('tor:onionAddress', async () => {
    if (torManager) {
        return torManager.onionAddress;
    }
    return null;
});

// Diagnostic data collection for issue reporting
ipcMain.handle('get-diagnostic-data', async () => {
    const os = require('os');
    const fs = require('fs');
    
    const diagnostics = {
        timestamp: new Date().toISOString(),
        app: {
            version: app.getVersion(),
            name: app.getName(),
            isPackaged: app.isPackaged,
            path: app.getAppPath(),
            userDataPath: app.getPath('userData')
        },
        system: {
            platform: process.platform,
            arch: process.arch,
            nodeVersion: process.versions.node,
            electronVersion: process.versions.electron,
            chromeVersion: process.versions.chrome,
            v8Version: process.versions.v8,
            hostname: os.hostname(),
            cpus: os.cpus().length,
            totalMemory: os.totalmem(),
            freeMemory: os.freemem(),
            uptime: os.uptime(),
            networkInterfaces: Object.keys(os.networkInterfaces())
        },
        sidecar: {
            running: !!sidecarProcess,
            pid: sidecarProcess ? sidecarProcess.pid : null,
            restartCount: sidecarRestartAttempts,
            lastError: sidecarProcess ? null : 'Not running'
        },
        identity: {
            basePath: identity.getBasePath(),
            identityPath: identity.getIdentityPath(),
            legacyPath: identity.getLegacyIdentityPath(),
            hasIdentity: fs.existsSync(identity.getIdentityPath())
        },
        p2p: {
            initialized: false,
            publicIP: null,
            ownPublicKey: null
        },
        tor: {
            enabled: !!torManager,
            running: false,
            bootstrapped: false
        },
        sidecarLogs: sidecarLogBuffer || []
    };
    
    // Try to get P2P info from sidecar via WebSocket
    // This is the accurate source - main process doesn't manage P2P directly
    try {
        const WebSocket = require('ws');
        const p2pInfoPromise = new Promise((resolve, reject) => {
            const ws = new WebSocket('ws://localhost:8081');
            const timeout = setTimeout(() => {
                ws.close();
                reject(new Error('Timeout'));
            }, 2000);
            
            ws.on('open', () => {
                ws.send(JSON.stringify({ type: 'get-p2p-info' }));
            });
            
            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.type === 'p2p-info') {
                        clearTimeout(timeout);
                        ws.close();
                        resolve(msg);
                    }
                } catch (e) {
                    // Ignore parse errors
                }
            });
            
            ws.on('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });
        
        const p2pInfo = await p2pInfoPromise;
        diagnostics.p2p = {
            initialized: p2pInfo.initialized || false,
            ownPublicKey: p2pInfo.ownPublicKey || null,
            publicIP: p2pInfo.publicIP || null,
            connectedPeers: (p2pInfo.connectedPeers || []).length,
            directWsUrl: p2pInfo.directWsUrl || null,
            upnpStatus: p2pInfo.upnpStatus || null
        };
    } catch (err) {
        diagnostics.p2p.error = err.message;
    }
    
    // Try to get Tor status
    try {
        if (torManager) {
            const torStatus = await torManager.getStatus();
            diagnostics.tor = { ...diagnostics.tor, ...torStatus };
        }
    } catch (err) {
        diagnostics.tor.error = err.message;
    }
    
    return diagnostics;
});

// Cleanup on app quit
app.on('before-quit', async () => {
    await swarmManager.destroy();
    if (torManager) {
        await torManager.stop();
    }
});

