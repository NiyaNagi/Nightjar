const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const { Level } = require('level');
const { getTorManager } = require('./backend/tor-manager-enhanced');
const { encryptUpdate, decryptUpdate } = require('./backend/crypto');
const identity = require('../sidecar/identity');
const hyperswarm = require('../sidecar/hyperswarm');
const Y = require('yjs');
const awarenessProtocol = require('y-protocols/awareness');

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

// Dynamically import electron-is-dev and uint8arrays to handle ES modules
let isDev = false; // Default to prod mode (safer)
let uint8ArrayFromString;
let initPromise = (async () => {
    try {
        const electronIsDev = await import('electron-is-dev');
        isDev = electronIsDev.default;
    } catch (e) {
        // If electron-is-dev fails, check manually
        isDev = !app.isPackaged;
    }
    
    const uint8arrays = await import('uint8arrays');
    uint8ArrayFromString = uint8arrays.fromString;
})();

// --- Global State ---
let mainWindow;
let p2pNode = null;
let sessionKey = null;
const ydocs = new Map();
const userDataPath = app.getPath('userData');
const db = new Level(path.join(userDataPath, 'storage'), { valueEncoding: 'binary' });

// Initialize identity storage path to match userData for consistency
// This ensures identity.json is stored in the same location as other app data
// and enables migration from the legacy ~/.Nightjar path
identity.setBasePath(userDataPath);
identity.migrateIdentityIfNeeded();

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

// Central awareness object for the backend
const awareness = new awarenessProtocol.Awareness(new Y.Doc());

// --- P2P and Yjs Bridge Logic ---
const DOC_PUBSUB_TOPIC = '/nightjarx/1.0.0/doc';
const AWARENESS_PUBSUB_TOPIC = '/nightjarx/1.0.0/awareness';

const bindP2PToYDoc = (doc) => {
    doc.on('update', async (update, origin) => {
        if (origin !== 'p2p' && p2pNode && sessionKey) {
            const encrypted = encryptUpdate(update, sessionKey);
            try {
                await db.put(Date.now(), encrypted);
                await p2pNode.services.pubsub.publish(DOC_PUBSUB_TOPIC, encrypted);
            } catch (err) { console.error('Failed to persist/publish doc update:', err); }
        }
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
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        backgroundColor: '#242424',
        show: false, // Don't show until ready
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
        mainWindow.show();
    });

    // In dev mode, load from Vite dev server
    // In production, load from the bundled frontend/dist folder
    const url = isDev ? 'http://127.0.0.1:5174' : `file://${path.join(__dirname, '../frontend/dist/index.html')}`;
    
    // Retry loading URL if it fails (race condition with Vite startup)
    const loadWithRetry = (retries = 10, delay = 1500) => {
        mainWindow.loadURL(url).then(() => {
            console.log('Successfully loaded:', url);
        }).catch(err => {
            console.error('Error loading URL:', err.message);
            if (retries > 0) {
                console.log(`Retrying in ${delay/1000}s... (${retries} attempts left)`);
                setTimeout(() => loadWithRetry(retries - 1, delay), delay);
            } else {
                console.error('Failed to load after all retries. Please restart the app.');
                // Show a fallback page
                mainWindow.loadURL(`data:text/html,<html><body style="background:#242424;color:white;font-family:sans-serif;padding:2em;"><h1>Failed to load application</h1><p>The Vite dev server at ${url} is not responding.</p><p>Please ensure the dev server is running and restart the application.</p></body></html>`);
                mainWindow.show();
            }
        });
    };
    
    loadWithRetry();

    if (isDev) {
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
    // Wait for imports to complete before creating window
    await initPromise;
    
    // Start sidecar first with loading screen, then create main window
    await startBackendWithLoadingScreen();
    
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
            font-size: 4rem;
            margin-bottom: 1rem;
            animation: pulse 2s ease-in-out infinite;
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
        }
        .message-real {
            font-size: 0.9rem;
            color: rgba(255,255,255,0.5);
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
        <div class="logo">📝</div>
        <h1>Nightjar</h1>
        <div class="progress-container">
            <div class="progress-bar" id="progress"></div>
        </div>
        <div class="message-funny" id="funny">${funny}<span class="dots"></span></div>
        <div class="message-real" id="real">${real}</div>
    </div>
    <div class="version">v1.0.0</div>
</body>
</html>`;
}

// --- Backend Initialization with Loading Screen ---
let loadingWindow = null;
let sidecarProcess = null;
let sidecarRestartAttempts = 0;
const SIDECAR_MAX_RESTART_ATTEMPTS = 3;

/**
 * Restart sidecar after a crash
 * Limited to SIDECAR_MAX_RESTART_ATTEMPTS to prevent infinite loops
 */
function restartSidecar(nodeExecutable, nodeArgs, sidecarCwd, spawnEnv) {
    sidecarRestartAttempts++;
    
    if (sidecarRestartAttempts > SIDECAR_MAX_RESTART_ATTEMPTS) {
        console.error(`[Sidecar] Max restart attempts (${SIDECAR_MAX_RESTART_ATTEMPTS}) reached, giving up`);
        return;
    }
    
    console.log(`[Sidecar] Restart attempt ${sidecarRestartAttempts}/${SIDECAR_MAX_RESTART_ATTEMPTS}`);
    
    sidecarProcess = spawn(nodeExecutable, nodeArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: sidecarCwd,
        env: spawnEnv,
    });
    
    sidecarProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log(`[Sidecar] ${output}`);
        
        // Reset restart counter on successful startup
        if (output.includes('Metadata WebSocket server listening')) {
            console.log('[Sidecar] Successfully restarted');
            sidecarRestartAttempts = 0;
        }
    });
    
    sidecarProcess.stderr.on('data', (data) => {
        console.error(`[Sidecar Error] ${data}`);
    });
    
    sidecarProcess.on('error', (err) => {
        console.error('[Sidecar] Failed to restart:', err);
    });
    
    sidecarProcess.on('close', (code) => {
        console.log(`[Sidecar] Restarted process exited with code ${code}`);
        if (code !== 0) {
            console.log('[Sidecar] Crashed again, attempting restart...');
            setTimeout(() => {
                restartSidecar(nodeExecutable, nodeArgs, sidecarCwd, spawnEnv);
            }, 2000);
        }
    });
}

async function startBackendWithLoadingScreen() {
    return new Promise((resolve, reject) => {
        // Create loading window
        loadingWindow = new BrowserWindow({
            width: 500,
            height: 400,
            frame: false,
            transparent: false,
            backgroundColor: '#1a1a2e',
            resizable: false,
            show: false,
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
            },
        });

        loadingWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(getLoadingScreenHtml(0))}`);
        loadingWindow.once('ready-to-show', () => loadingWindow.show());

        let currentStep = 0;
        const updateProgress = (step, customFunny = null, customReal = null) => {
            currentStep = step;
            if (loadingWindow && !loadingWindow.isDestroyed()) {
                const msg = LOADING_MESSAGES[Math.min(step, LOADING_MESSAGES.length - 1)];
                const progress = Math.min(100, Math.round((step / 7) * 100));
                loadingWindow.webContents.executeJavaScript(`
                    document.getElementById('progress').style.width = '${progress}%';
                    document.getElementById('funny').innerHTML = '${customFunny || msg.funny}<span class="dots"></span>';
                    document.getElementById('real').innerText = '${customReal || msg.real}';
                `).catch(() => {});
            }
        };

        // Get user data path for storage
        const userDataPath = app.getPath('userData');
        console.log(`[Backend] User data path: ${userDataPath}`);

        // Determine sidecar path and how to run it
        // In development: spawn 'node sidecar/index.js'
        // In packaged app: files are in app.asar.unpacked (due to asarUnpack config)
        const sidecarPath = app.isPackaged 
            ? path.join(process.resourcesPath, 'app.asar.unpacked', 'sidecar', 'index.js')
            : path.join(process.cwd(), 'sidecar', 'index.js');
        
        // Use Electron's bundled Node.js (same as the main process)
        // For packaged apps, we need to run the sidecar as a fork or use electron.exe
        // Since Electron includes Node.js, we can use process.execPath with --require
        const nodeExecutable = app.isPackaged ? process.execPath : 'node';
        const nodeArgs = app.isPackaged 
            ? [sidecarPath, userDataPath]
            : ['sidecar/index.js', userDataPath];
        
        // For packaged Electron apps, we need to tell Electron to run as Node.js
        // by setting ELECTRON_RUN_AS_NODE environment variable
        const spawnEnv = app.isPackaged 
            ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
            : process.env;
        
        // Working directory for the sidecar - unpacked folder for packaged app
        const sidecarCwd = app.isPackaged 
            ? path.join(process.resourcesPath, 'app.asar.unpacked')
            : process.cwd();
        
        console.log(`[Backend] Starting sidecar: ${nodeExecutable} ${nodeArgs.join(' ')}`);
        console.log(`[Backend] Sidecar cwd: ${sidecarCwd}`);
        
        sidecarProcess = spawn(nodeExecutable, nodeArgs, {
            stdio: ['ignore', 'pipe', 'pipe'],
            cwd: sidecarCwd,
            env: spawnEnv,
        });

        let wsReady = false;
        let metaWsReady = false;

        const checkReady = () => {
            if (wsReady && metaWsReady) {
                updateProgress(7); // Complete
                setTimeout(() => {
                    // Close loading window and open main window
                    if (loadingWindow && !loadingWindow.isDestroyed()) {
                        loadingWindow.close();
                        loadingWindow = null;
                    }
                    createWindow();
                    
                    // Send connection info once window is ready
                    if (mainWindow) {
                        mainWindow.webContents.once('did-finish-load', () => {
                            safeSend('connection-info', {
                                onionAddress: 'localhost',
                                peerId: 'local-peer-id',
                                multiaddr: '/ip4/127.0.0.1/tcp/8080'
                            });
                        });
                    }
                    
                    resolve();
                }, 300); // Brief delay to show "Ready!" message
            }
        };

        sidecarProcess.stdout.on('data', (data) => {
            const output = data.toString();
            console.log(`[Sidecar] ${output}`);

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
            console.error(`[Sidecar Error] ${data}`);
        });

        sidecarProcess.on('error', (err) => {
            console.error('[Backend] Failed to start sidecar:', err);
            if (loadingWindow && !loadingWindow.isDestroyed()) {
                loadingWindow.loadURL(`data:text/html,<html><body style="background:#242424;color:white;font-family:sans-serif;padding:2em;text-align:center;"><h1>⚠️ Startup Error</h1><p>${err.message}</p></body></html>`);
            }
            reject(err);
        });

        sidecarProcess.on('close', (code) => {
            console.log(`[Sidecar] Process exited with code ${code}`);
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
    console.log('[Backend] Received session key.');
    sessionKey = uint8ArrayFromString(keyPayload, 'base64');
    const doc = getDoc('p2p-editor-room');
    for await (const [key, value] of db.iterator()) {
        const decrypted = decryptUpdate(value, sessionKey);
        if (decrypted) {
            Y.applyUpdate(doc, decrypted, 'p2p');
        }
    }
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
ipcMain.handle('identity:load', async () => {
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
    try {
        identity.updateIdentity(updates);
        return true;
    } catch (err) {
        console.error('[Identity] Update error:', err);
        throw err;
    }
});

ipcMain.handle('identity:delete', async () => {
    try {
        identity.deleteIdentity();
        return true;
    } catch (err) {
        console.error('[Identity] Delete error:', err);
        throw err;
    }
});

ipcMain.handle('identity:has', async () => {
    return identity.hasIdentity();
});

ipcMain.handle('identity:export', async (event, password) => {
    try {
        return identity.exportIdentity(password);
    } catch (err) {
        console.error('[Identity] Export error:', err);
        throw err;
    }
});

ipcMain.handle('identity:import', async (event, data, password) => {
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

// Cleanup on app quit
app.on('before-quit', async () => {
    await swarmManager.destroy();
    if (torManager) {
        await torManager.stop();
    }
});
