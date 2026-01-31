/**
 * Dynamic Port Allocator
 * 
 * Manages a pool of ports for parallel test execution.
 * Uses file-based locking to prevent port conflicts across processes.
 */

const net = require('net');
const fs = require('fs');
const path = require('path');

// Port range configuration
const PORT_RANGE_START = 18000;
const PORT_RANGE_END = 19000;
const PORTS_PER_TEST = 2; // metaPort + yjsPort

// Lock file for cross-process synchronization
const LOCK_FILE = path.join(__dirname, '.port-allocator.lock');
const STATE_FILE = path.join(__dirname, '.port-allocator.state');

/**
 * Check if a port is available (not in use)
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
 * Check multiple ports in parallel
 */
async function arePortsAvailable(ports) {
    const results = await Promise.all(ports.map(isPortAvailable));
    return results.every(r => r);
}

/**
 * Load allocation state from file
 */
function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = fs.readFileSync(STATE_FILE, 'utf8');
            const state = JSON.parse(data);
            // Clean up expired allocations (older than 5 minutes)
            const now = Date.now();
            const EXPIRY = 5 * 60 * 1000;
            state.allocations = state.allocations.filter(a => now - a.timestamp < EXPIRY);
            return state;
        }
    } catch (e) {
        // Ignore errors, start fresh
    }
    return { allocations: [] };
}

/**
 * Save allocation state to file
 */
function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Acquire file lock (simple spinlock with timeout)
 */
async function acquireLock(timeout = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        try {
            // Try to create lock file exclusively
            fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
            return true;
        } catch (e) {
            if (e.code === 'EEXIST') {
                // Lock exists, check if stale (older than 30 seconds)
                try {
                    const stat = fs.statSync(LOCK_FILE);
                    if (Date.now() - stat.mtimeMs > 30000) {
                        // Stale lock, remove it
                        fs.unlinkSync(LOCK_FILE);
                        continue;
                    }
                } catch (e2) {
                    // Lock was removed by another process
                    continue;
                }
                // Wait and retry
                await new Promise(r => setTimeout(r, 50));
            } else {
                throw e;
            }
        }
    }
    throw new Error('Failed to acquire port allocator lock');
}

/**
 * Release file lock
 */
function releaseLock() {
    try {
        fs.unlinkSync(LOCK_FILE);
    } catch (e) {
        // Ignore errors
    }
}

/**
 * PortAllocator class
 */
class PortAllocator {
    constructor() {
        this.allocatedPorts = [];
    }

    /**
     * Allocate a pair of ports (metaPort + yjsPort)
     * @returns {{ metaPort: number, yjsPort: number }}
     */
    async allocate() {
        await acquireLock();
        try {
            const state = loadState();
            const allocatedPortSet = new Set(
                state.allocations.flatMap(a => [a.metaPort, a.yjsPort])
            );

            // Find available port pair
            for (let port = PORT_RANGE_START; port < PORT_RANGE_END - 1; port += 2) {
                const metaPort = port;
                const yjsPort = port + 1;

                // Skip if already allocated
                if (allocatedPortSet.has(metaPort) || allocatedPortSet.has(yjsPort)) {
                    continue;
                }

                // Check if actually available on the system
                if (await arePortsAvailable([metaPort, yjsPort])) {
                    const allocation = {
                        metaPort,
                        yjsPort,
                        pid: process.pid,
                        timestamp: Date.now(),
                    };
                    state.allocations.push(allocation);
                    saveState(state);
                    this.allocatedPorts.push(allocation);
                    return { metaPort, yjsPort };
                }
            }

            throw new Error('No available ports in range');
        } finally {
            releaseLock();
        }
    }

    /**
     * Allocate multiple port pairs
     * @param {number} count
     * @returns {Array<{ metaPort: number, yjsPort: number }>}
     */
    async allocateMultiple(count) {
        const allocations = [];
        for (let i = 0; i < count; i++) {
            allocations.push(await this.allocate());
        }
        return allocations;
    }

    /**
     * Release allocated ports
     * @param {{ metaPort: number, yjsPort: number }} ports
     */
    async release(ports) {
        await acquireLock();
        try {
            const state = loadState();
            state.allocations = state.allocations.filter(
                a => a.metaPort !== ports.metaPort && a.yjsPort !== ports.yjsPort
            );
            saveState(state);
            this.allocatedPorts = this.allocatedPorts.filter(
                a => a.metaPort !== ports.metaPort && a.yjsPort !== ports.yjsPort
            );
        } finally {
            releaseLock();
        }
    }

    /**
     * Release all ports allocated by this instance
     */
    async releaseAll() {
        for (const ports of [...this.allocatedPorts]) {
            await this.release(ports);
        }
    }

    /**
     * Clean up all state (for test reset)
     */
    static cleanup() {
        try {
            if (fs.existsSync(STATE_FILE)) {
                fs.unlinkSync(STATE_FILE);
            }
            if (fs.existsSync(LOCK_FILE)) {
                fs.unlinkSync(LOCK_FILE);
            }
        } catch (e) {
            // Ignore errors
        }
    }
}

// Singleton instance for convenience
const defaultAllocator = new PortAllocator();

module.exports = {
    PortAllocator,
    allocatePorts: () => defaultAllocator.allocate(),
    allocateMultiplePorts: (count) => defaultAllocator.allocateMultiple(count),
    releasePorts: (ports) => defaultAllocator.release(ports),
    releaseAllPorts: () => defaultAllocator.releaseAll(),
    cleanupPortAllocator: () => PortAllocator.cleanup(),
    isPortAvailable,
    arePortsAvailable,
};
