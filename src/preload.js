// src/preload.js
const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

// Read version directly from package.json since preload runs in separate context from main
function getAppVersion() {
    try {
        // Try multiple possible locations for package.json
        const possiblePaths = [
            path.join(__dirname, '..', 'package.json'),  // Development
            path.join(__dirname, '..', '..', 'package.json'),  // Packaged (inside app.asar)
            path.join(process.resourcesPath || '', 'app.asar', 'package.json'),  // Alternative packaged path
        ];
        
        for (const pkgPath of possiblePaths) {
            try {
                if (fs.existsSync(pkgPath)) {
                    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                    if (pkg.version) {
                        return pkg.version;
                    }
                }
            } catch (e) {
                // Try next path
            }
        }
    } catch (e) {
        console.warn('[Preload] Could not read version from package.json:', e.message);
    }
    return '1.0.0';
}

const appVersion = getAppVersion();

// We are exposing a controlled API to the frontend (renderer process)
// instead of giving it full access to Node.js APIs.
contextBridge.exposeInMainWorld('electronAPI', {
    // --- App Info ---
    appVersion: appVersion,
    
    // --- Frontend to Backend ---
    setKey: (key) => ipcRenderer.send('set-key', key),
    sendYjsUpdate: (update) => ipcRenderer.send('yjs-update', update),

    // --- Backend to Frontend ---
    onConnectionInfo: (callback) => ipcRenderer.on('connection-info', (_event, value) => callback(value)),
    onBackendError: (callback) => ipcRenderer.on('backend-error', (_event, value) => callback(value)),
    onYjsUpdate: (callback) => ipcRenderer.on('yjs-update', (_event, value) => callback(value)),

    // --- Identity Management ---
    identity: {
        load: () => ipcRenderer.invoke('identity:load'),
        store: (identity) => ipcRenderer.invoke('identity:store', identity),
        update: (updates) => ipcRenderer.invoke('identity:update', updates),
        delete: () => ipcRenderer.invoke('identity:delete'),
        export: (password) => ipcRenderer.invoke('identity:export', password),
        import: (data, password) => ipcRenderer.invoke('identity:import', data, password),
        hasIdentity: () => ipcRenderer.invoke('identity:has')
    },

    // --- Hyperswarm P2P ---
    hyperswarm: {
        initialize: (identity) => ipcRenderer.invoke('hyperswarm:initialize', identity),
        joinTopic: (topicHex) => ipcRenderer.invoke('hyperswarm:join', topicHex),
        leaveTopic: (topicHex) => ipcRenderer.invoke('hyperswarm:leave', topicHex),
        broadcastSync: (topicHex, data) => ipcRenderer.send('hyperswarm:sync', { topic: topicHex, data }),
        broadcastAwareness: (topicHex, state) => ipcRenderer.send('hyperswarm:awareness', { topic: topicHex, state }),
        getPeers: (topicHex) => ipcRenderer.invoke('hyperswarm:peers', topicHex),
        getConnectionCount: () => ipcRenderer.invoke('hyperswarm:connectionCount'),
        destroy: () => ipcRenderer.invoke('hyperswarm:destroy'),
        onPeerJoined: (callback) => ipcRenderer.on('hyperswarm:peer-joined', (_e, data) => callback(data)),
        onPeerLeft: (callback) => ipcRenderer.on('hyperswarm:peer-left', (_e, data) => callback(data)),
        onPeerIdentity: (callback) => ipcRenderer.on('hyperswarm:peer-identity', (_e, data) => callback(data)),
        onSyncMessage: (callback) => ipcRenderer.on('hyperswarm:sync-message', (_e, data) => callback(data)),
        onAwarenessUpdate: (callback) => ipcRenderer.on('hyperswarm:awareness-update', (_e, data) => callback(data))
    },

    // --- Tor Management ---
    tor: {
        start: (mode) => ipcRenderer.invoke('tor:start', mode),
        stop: () => ipcRenderer.invoke('tor:stop'),
        getStatus: () => ipcRenderer.invoke('tor:status'),
        newIdentity: () => ipcRenderer.invoke('tor:newIdentity'),
        getSocksProxy: () => ipcRenderer.invoke('tor:socksProxy'),
        getOnionAddress: () => ipcRenderer.invoke('tor:onionAddress'),
        onBootstrap: (callback) => ipcRenderer.on('tor:bootstrap', (_e, progress) => callback(progress)),
        onReady: (callback) => ipcRenderer.on('tor:ready', () => callback()),
        onError: (callback) => ipcRenderer.on('tor:error', (_e, err) => callback(err))
    },

    // --- Protocol Link Handling ---
    onProtocolLink: (callback) => ipcRenderer.on('protocol-link', (_e, url) => callback(url)),

    // --- Diagnostics ---
    getDiagnosticData: () => ipcRenderer.invoke('get-diagnostic-data'),

    // Function to remove all listeners, useful for component cleanup
    removeAllListeners: () => {
        ipcRenderer.removeAllListeners('connection-info');
        ipcRenderer.removeAllListeners('backend-error');
        ipcRenderer.removeAllListeners('yjs-update');
        ipcRenderer.removeAllListeners('hyperswarm:peer-joined');
        ipcRenderer.removeAllListeners('hyperswarm:peer-left');
        ipcRenderer.removeAllListeners('hyperswarm:peer-identity');
        ipcRenderer.removeAllListeners('hyperswarm:sync-message');
        ipcRenderer.removeAllListeners('hyperswarm:awareness-update');
        ipcRenderer.removeAllListeners('tor:bootstrap');
        ipcRenderer.removeAllListeners('tor:ready');
        ipcRenderer.removeAllListeners('tor:error');
        ipcRenderer.removeAllListeners('protocol-link');
    }
});
