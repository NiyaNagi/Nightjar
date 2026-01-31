// src/backend/tor-manager.js
const TorControl = require('tor-control');

// This is the implementation for Option A: Connecting to an external Tor daemon.
class ExternalTorManager {
    constructor(options = {}) {
        this.port = options.port || 9051;
        this.torControl = new TorControl({
            port: this.port,
            persistent: true // Keep connection alive
        });
    }

    /**
     * Establishes a connection and authenticates with the Tor Control Port.
     * @returns {Promise<TorControl>} A promise that resolves with the authenticated tor-control instance.
     */
    async getConnection() {
        console.log(`[TorManager] Attempting to connect to Tor daemon on port ${this.port}...`);
        try {
            await this.torControl.connect();
            await this.torControl.authenticate();
            console.log('[TorManager] Successfully connected and authenticated with Tor.');
            return this.torControl;
        } catch (err) {
            console.error('[TorManager] Failed to connect or authenticate with Tor.', err.message);
            throw new Error('TorConnectionFailed');
        }
    }
}

// In the future, for Option B (bundling Tor), we could create a BundledTorManager class:
/*
class BundledTorManager {
    constructor() {
        // ... logic to find and manage the bundled Tor executable
    }
    async getConnection() {
        // 1. Start the bundled Tor process if not running.
        // 2. Wait for it to be ready.
        // 3. Connect to it via TorControl on its specified port.
        // 4. Return the connection.
    }
}
*/

// The factory function decides which manager to use.
// For now, it's hardcoded to ExternalTorManager.
// Later, this could check for a bundled executable or a user preference.
function getTorManager() {
    return new ExternalTorManager();
}

module.exports = { getTorManager };
