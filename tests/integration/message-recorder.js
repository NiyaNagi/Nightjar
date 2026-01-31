/**
 * Message Trace Recorder
 * 
 * Records all WebSocket messages for debugging test failures.
 * Provides detailed traces that can be dumped to files.
 */

const fs = require('fs');
const path = require('path');
const Y = require('yjs');

// Trace output directory
const TRACES_DIR = path.join(__dirname, 'traces');

/**
 * Decode Yjs update for logging (extract operation counts)
 */
function summarizeYjsUpdate(data) {
    try {
        if (!(data instanceof Uint8Array) && !Buffer.isBuffer(data)) {
            return { type: 'non-binary', size: 0 };
        }
        
        const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
        
        // Try to decode as Yjs update to get operation summary
        try {
            const tempDoc = new Y.Doc();
            Y.applyUpdate(tempDoc, bytes);
            
            // Count structures in the update
            const content = {};
            tempDoc.share.forEach((type, name) => {
                if (type instanceof Y.Text) {
                    content[name] = { type: 'Y.Text', length: type.toString().length };
                } else if (type instanceof Y.Array) {
                    content[name] = { type: 'Y.Array', length: type.length };
                } else if (type instanceof Y.Map) {
                    content[name] = { type: 'Y.Map', keys: Array.from(type.keys()) };
                }
            });
            
            tempDoc.destroy();
            
            return {
                type: 'yjs-update',
                size: bytes.length,
                content,
            };
        } catch (e) {
            // Not a valid Yjs update, just report size
            return {
                type: 'binary',
                size: bytes.length,
            };
        }
    } catch (e) {
        return { type: 'unknown', error: e.message };
    }
}

/**
 * Message record structure
 */
class MessageRecord {
    constructor(clientName, direction, data, socketType = 'meta') {
        this.timestamp = Date.now();
        this.clientName = clientName;
        this.direction = direction; // 'in' | 'out'
        this.socketType = socketType; // 'meta' | 'yjs'
        
        if (socketType === 'yjs' && (Buffer.isBuffer(data) || data instanceof Uint8Array)) {
            this.messageType = 'yjs-update';
            this.payload = summarizeYjsUpdate(data);
        } else if (typeof data === 'string') {
            try {
                const parsed = JSON.parse(data);
                this.messageType = parsed.type || 'unknown';
                this.payload = parsed;
            } catch (e) {
                this.messageType = 'raw';
                this.payload = data;
            }
        } else if (typeof data === 'object') {
            this.messageType = data.type || 'object';
            this.payload = data;
        } else {
            this.messageType = 'unknown';
            this.payload = String(data);
        }
    }

    /**
     * Format for logging
     */
    toString() {
        const dir = this.direction === 'in' ? '←' : '→';
        const time = new Date(this.timestamp).toISOString().slice(11, 23);
        return `[${time}] ${this.clientName} ${dir} ${this.socketType}:${this.messageType}`;
    }

    /**
     * Export as JSON-safe object
     */
    toJSON() {
        return {
            timestamp: this.timestamp,
            clientName: this.clientName,
            direction: this.direction,
            socketType: this.socketType,
            messageType: this.messageType,
            payload: this.payload,
        };
    }
}

/**
 * MessageRecorder class
 * 
 * Wraps WebSocket connections to record all traffic.
 */
class MessageRecorder {
    constructor(options = {}) {
        this.testName = options.testName || 'unnamed-test';
        this.records = [];
        this.maxRecords = options.maxRecords || 10000;
        this.enabled = options.enabled !== false;
        this.wrappedClients = new Map();
    }

    /**
     * Record a message
     */
    record(clientName, direction, data, socketType = 'meta') {
        if (!this.enabled) return;
        
        const record = new MessageRecord(clientName, direction, data, socketType);
        this.records.push(record);
        
        // Trim if too many records
        if (this.records.length > this.maxRecords) {
            this.records = this.records.slice(-this.maxRecords);
        }
    }

    /**
     * Wrap a TestClient to record its messages
     */
    wrapClient(client) {
        if (this.wrappedClients.has(client)) {
            return; // Already wrapped
        }

        const clientName = client.name;
        const recorder = this;

        // Store original send method
        const originalSend = client.send.bind(client);
        
        // Override send to record outgoing messages
        client.send = function(message) {
            recorder.record(clientName, 'out', message, 'meta');
            return originalSend(message);
        };

        // Hook into message handler to record incoming
        const originalOnMessage = client.onMessage;
        client.onMessage = function(msg) {
            recorder.record(clientName, 'in', msg, 'meta');
            if (originalOnMessage) {
                originalOnMessage(msg);
            }
        };

        this.wrappedClients.set(client, { originalSend, originalOnMessage });
    }

    /**
     * Unwrap a client (restore original methods)
     */
    unwrapClient(client) {
        const wrapped = this.wrappedClients.get(client);
        if (wrapped) {
            client.send = wrapped.originalSend;
            client.onMessage = wrapped.originalOnMessage;
            this.wrappedClients.delete(client);
        }
    }

    /**
     * Get all records
     */
    getRecords() {
        return this.records;
    }

    /**
     * Get records for a specific client
     */
    getClientRecords(clientName) {
        return this.records.filter(r => r.clientName === clientName);
    }

    /**
     * Get records of a specific message type
     */
    getRecordsByType(messageType) {
        return this.records.filter(r => r.messageType === messageType);
    }

    /**
     * Get a summary of message counts by type
     */
    getSummary() {
        const summary = {
            total: this.records.length,
            byClient: {},
            byType: {},
            byDirection: { in: 0, out: 0 },
        };

        for (const record of this.records) {
            // By client
            if (!summary.byClient[record.clientName]) {
                summary.byClient[record.clientName] = { in: 0, out: 0 };
            }
            summary.byClient[record.clientName][record.direction]++;

            // By type
            if (!summary.byType[record.messageType]) {
                summary.byType[record.messageType] = 0;
            }
            summary.byType[record.messageType]++;

            // By direction
            summary.byDirection[record.direction]++;
        }

        return summary;
    }

    /**
     * Format trace as human-readable string
     */
    formatTrace() {
        const lines = [
            `=== Message Trace: ${this.testName} ===`,
            `Total messages: ${this.records.length}`,
            '',
            '--- Timeline ---',
        ];

        for (const record of this.records) {
            lines.push(record.toString());
        }

        lines.push('');
        lines.push('--- Summary ---');
        const summary = this.getSummary();
        lines.push(`By type: ${JSON.stringify(summary.byType, null, 2)}`);

        return lines.join('\n');
    }

    /**
     * Dump trace to file
     */
    dumpToFile(testName = this.testName) {
        // Ensure traces directory exists
        if (!fs.existsSync(TRACES_DIR)) {
            fs.mkdirSync(TRACES_DIR, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${testName}-${timestamp}.json`;
        const filepath = path.join(TRACES_DIR, filename);

        const data = {
            testName,
            timestamp: Date.now(),
            summary: this.getSummary(),
            records: this.records.map(r => r.toJSON()),
        };

        fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
        console.log(`[MessageRecorder] Trace dumped to: ${filepath}`);
        
        return filepath;
    }

    /**
     * Clear all records
     */
    clear() {
        this.records = [];
    }

    /**
     * Enable/disable recording
     */
    setEnabled(enabled) {
        this.enabled = enabled;
    }
}

/**
 * Load a trace from file
 */
function loadTrace(filepath) {
    const data = fs.readFileSync(filepath, 'utf8');
    return JSON.parse(data);
}

/**
 * List all trace files
 */
function listTraces() {
    if (!fs.existsSync(TRACES_DIR)) {
        return [];
    }
    return fs.readdirSync(TRACES_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => path.join(TRACES_DIR, f));
}

/**
 * Clean up old traces (older than maxAge ms)
 */
function cleanupTraces(maxAge = 24 * 60 * 60 * 1000) {
    const traces = listTraces();
    const now = Date.now();
    let deleted = 0;

    for (const filepath of traces) {
        try {
            const stat = fs.statSync(filepath);
            if (now - stat.mtimeMs > maxAge) {
                fs.unlinkSync(filepath);
                deleted++;
            }
        } catch (e) {
            // Ignore errors
        }
    }

    return deleted;
}

module.exports = {
    MessageRecorder,
    MessageRecord,
    summarizeYjsUpdate,
    loadTrace,
    listTraces,
    cleanupTraces,
    TRACES_DIR,
};
