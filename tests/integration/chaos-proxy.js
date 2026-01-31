/**
 * Network Chaos Proxy
 * 
 * Simulates network conditions like latency, packet loss, and partitions.
 * Acts as a transparent proxy between test clients and the sidecar.
 */

const net = require('net');
const WebSocket = require('ws');

/**
 * ChaosProxy class
 * 
 * Intercepts WebSocket connections and applies chaos conditions.
 */
class ChaosProxy {
    constructor(options = {}) {
        this.targetHost = options.targetHost || 'localhost';
        this.targetPort = options.targetPort;
        this.proxyPort = options.proxyPort;
        this.name = options.name || `proxy-${this.proxyPort}`;
        
        // Chaos settings
        this.latency = { min: 0, max: 0 };
        this.packetLoss = 0;
        this.jitter = 0;
        this.disconnected = false;
        this.partitioned = false;
        
        // Stats
        this.stats = {
            messagesForwarded: 0,
            messagesDropped: 0,
            totalLatencyAdded: 0,
        };
        
        // WebSocket server
        this.wss = null;
        this.connections = new Map();
    }

    /**
     * Start the proxy server
     */
    async start() {
        return new Promise((resolve, reject) => {
            this.wss = new WebSocket.Server({ port: this.proxyPort });
            
            this.wss.on('listening', () => {
                console.log(`[ChaosProxy:${this.name}] Listening on port ${this.proxyPort} -> ${this.targetPort}`);
                resolve();
            });
            
            this.wss.on('error', reject);
            
            this.wss.on('connection', (clientWs, req) => {
                this.handleConnection(clientWs, req);
            });
        });
    }

    /**
     * Handle a new client connection
     */
    handleConnection(clientWs, req) {
        // Extract the path from the request to forward it
        const path = req.url || '';
        const targetUrl = `ws://${this.targetHost}:${this.targetPort}${path}`;
        
        // Connect to target
        const targetWs = new WebSocket(targetUrl);
        
        const connectionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        this.connections.set(connectionId, { clientWs, targetWs });
        
        targetWs.on('open', () => {
            // Forward messages from target to client
            targetWs.on('message', async (data) => {
                await this.forwardMessage(data, clientWs, 'target->client');
            });
        });
        
        targetWs.on('error', (err) => {
            console.error(`[ChaosProxy:${this.name}] Target error:`, err.message);
            clientWs.close();
        });
        
        targetWs.on('close', () => {
            clientWs.close();
            this.connections.delete(connectionId);
        });
        
        // Forward messages from client to target
        clientWs.on('message', async (data) => {
            if (targetWs.readyState === WebSocket.OPEN) {
                await this.forwardMessage(data, targetWs, 'client->target');
            }
        });
        
        clientWs.on('close', () => {
            targetWs.close();
            this.connections.delete(connectionId);
        });
        
        clientWs.on('error', (err) => {
            console.error(`[ChaosProxy:${this.name}] Client error:`, err.message);
            targetWs.close();
        });
    }

    /**
     * Forward a message with chaos conditions applied
     */
    async forwardMessage(data, targetSocket, direction) {
        // Check if disconnected or partitioned
        if (this.disconnected || this.partitioned) {
            this.stats.messagesDropped++;
            return;
        }
        
        // Check packet loss
        if (this.packetLoss > 0 && Math.random() < this.packetLoss) {
            this.stats.messagesDropped++;
            return;
        }
        
        // Calculate delay
        let delay = 0;
        if (this.latency.min > 0 || this.latency.max > 0) {
            delay = this.latency.min + Math.random() * (this.latency.max - this.latency.min);
        }
        if (this.jitter > 0) {
            delay += Math.random() * this.jitter;
        }
        
        // Apply delay if needed
        if (delay > 0) {
            this.stats.totalLatencyAdded += delay;
            await new Promise(r => setTimeout(r, delay));
        }
        
        // Check again in case conditions changed during delay
        if (this.disconnected || this.partitioned) {
            this.stats.messagesDropped++;
            return;
        }
        
        // Forward message
        if (targetSocket.readyState === WebSocket.OPEN) {
            targetSocket.send(data);
            this.stats.messagesForwarded++;
        }
    }

    /**
     * Set latency range (in milliseconds)
     */
    setLatency(minMs, maxMs = minMs) {
        this.latency = { min: minMs, max: maxMs };
        return this;
    }

    /**
     * Set packet loss probability (0.0 to 1.0)
     */
    setPacketLoss(probability) {
        this.packetLoss = Math.max(0, Math.min(1, probability));
        return this;
    }

    /**
     * Set jitter (variable additional delay in ms)
     */
    setJitter(ms) {
        this.jitter = ms;
        return this;
    }

    /**
     * Simulate network disconnect for a duration
     */
    async disconnect(durationMs) {
        this.disconnected = true;
        await new Promise(r => setTimeout(r, durationMs));
        this.disconnected = false;
    }

    /**
     * Set partition state (blocks all traffic)
     */
    setPartitioned(partitioned) {
        this.partitioned = partitioned;
        return this;
    }

    /**
     * Reset all chaos settings
     */
    reset() {
        this.latency = { min: 0, max: 0 };
        this.packetLoss = 0;
        this.jitter = 0;
        this.disconnected = false;
        this.partitioned = false;
        return this;
    }

    /**
     * Get statistics
     */
    getStats() {
        return { ...this.stats };
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            messagesForwarded: 0,
            messagesDropped: 0,
            totalLatencyAdded: 0,
        };
    }

    /**
     * Stop the proxy server
     */
    async stop() {
        return new Promise((resolve) => {
            // Close all connections
            for (const { clientWs, targetWs } of this.connections.values()) {
                try { clientWs.close(); } catch (e) {}
                try { targetWs.close(); } catch (e) {}
            }
            this.connections.clear();
            
            if (this.wss) {
                this.wss.close(() => {
                    this.wss = null;
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

/**
 * ChaosProxyPair
 * 
 * Creates a pair of proxies for both meta and yjs ports.
 */
class ChaosProxyPair {
    constructor(options = {}) {
        this.metaProxy = new ChaosProxy({
            name: 'meta',
            targetHost: options.targetHost || 'localhost',
            targetPort: options.metaPort,
            proxyPort: options.metaProxyPort,
        });
        
        this.yjsProxy = new ChaosProxy({
            name: 'yjs',
            targetHost: options.targetHost || 'localhost',
            targetPort: options.yjsPort,
            proxyPort: options.yjsProxyPort,
        });
    }

    async start() {
        await Promise.all([
            this.metaProxy.start(),
            this.yjsProxy.start(),
        ]);
    }

    async stop() {
        await Promise.all([
            this.metaProxy.stop(),
            this.yjsProxy.stop(),
        ]);
    }

    /**
     * Apply chaos settings to both proxies
     */
    setLatency(minMs, maxMs = minMs) {
        this.metaProxy.setLatency(minMs, maxMs);
        this.yjsProxy.setLatency(minMs, maxMs);
        return this;
    }

    setPacketLoss(probability) {
        this.metaProxy.setPacketLoss(probability);
        this.yjsProxy.setPacketLoss(probability);
        return this;
    }

    setJitter(ms) {
        this.metaProxy.setJitter(ms);
        this.yjsProxy.setJitter(ms);
        return this;
    }

    async disconnect(durationMs) {
        await Promise.all([
            this.metaProxy.disconnect(durationMs),
            this.yjsProxy.disconnect(durationMs),
        ]);
    }

    setPartitioned(partitioned) {
        this.metaProxy.setPartitioned(partitioned);
        this.yjsProxy.setPartitioned(partitioned);
        return this;
    }

    reset() {
        this.metaProxy.reset();
        this.yjsProxy.reset();
        return this;
    }

    getStats() {
        return {
            meta: this.metaProxy.getStats(),
            yjs: this.yjsProxy.getStats(),
        };
    }
}

/**
 * NetworkPartition
 * 
 * Manages partitions between groups of clients.
 */
class NetworkPartition {
    constructor() {
        this.partitions = new Map(); // groupId -> Set of ChaosProxy
    }

    /**
     * Create a partition between two groups
     * All clients in group A cannot communicate with clients in group B
     */
    partition(groupA, groupB) {
        for (const proxyA of groupA) {
            for (const proxyB of groupB) {
                // In a real implementation, this would filter by target
                // For now, we use simple partitioning
            }
        }
    }

    /**
     * Heal a partition
     */
    heal(groupA, groupB) {
        for (const proxy of [...groupA, ...groupB]) {
            proxy.setPartitioned(false);
        }
    }

    /**
     * Partition all groups from each other
     */
    isolateAll(groups) {
        for (const group of groups) {
            for (const proxy of group) {
                proxy.setPartitioned(true);
            }
        }
    }

    /**
     * Heal all partitions
     */
    healAll(groups) {
        for (const group of groups) {
            for (const proxy of group) {
                proxy.setPartitioned(false);
            }
        }
    }
}

module.exports = {
    ChaosProxy,
    ChaosProxyPair,
    NetworkPartition,
};
