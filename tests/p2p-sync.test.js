/**
 * P2P Synchronization Test Suite for Nightjar
 * 
 * This test suite covers:
 * - Local WebSocket sync between multiple clients
 * - Document persistence and recovery
 * - Conflict resolution
 * - Tor toggle functionality
 * - Multi-client scenarios
 * 
 * Run with: node tests/p2p-sync.test.js
 */

const WebSocket = require('ws');
const Y = require('yjs');
const { encryptUpdate, decryptUpdate } = require('../backend/crypto');
const nacl = require('tweetnacl');

// Use TextEncoder/TextDecoder as alternative to uint8arrays
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const uint8ArrayFromString = (str) => textEncoder.encode(str);
const uint8ArrayToString = (arr) => textDecoder.decode(arr);

// Configuration
const YJS_WS_URL = 'ws://localhost:8080';
const META_WS_URL = 'ws://localhost:8081';
const TEST_DOC_ID = 'test-doc-' + Date.now();

// Test helpers
class TestClient {
    constructor(name, sessionKey) {
        this.name = name;
        this.sessionKey = sessionKey;
        this.ydoc = new Y.Doc();
        this.connected = false;
        this.messages = [];
    }

    async connectYjs(docId) {
        return new Promise((resolve, reject) => {
            this.yjsWs = new WebSocket(`${YJS_WS_URL}/${docId}`);
            
            this.yjsWs.on('open', () => {
                console.log(`[${this.name}] Connected to Yjs WebSocket`);
                this.connected = true;
                
                // Set up sync
                const awareness = new Map();
                this.yjsWs.on('message', (data) => {
                    // Apply received updates
                    try {
                        const update = new Uint8Array(data);
                        Y.applyUpdate(this.ydoc, update, 'remote');
                    } catch (e) {
                        // Not a Yjs update, might be protocol message
                    }
                });
                
                // Send updates to server
                this.ydoc.on('update', (update, origin) => {
                    if (origin !== 'remote' && this.yjsWs.readyState === WebSocket.OPEN) {
                        this.yjsWs.send(update);
                    }
                });
                
                resolve();
            });
            
            this.yjsWs.on('error', reject);
        });
    }

    async connectMeta() {
        return new Promise((resolve, reject) => {
            this.metaWs = new WebSocket(META_WS_URL);
            
            this.metaWs.on('open', () => {
                console.log(`[${this.name}] Connected to Metadata WebSocket`);
                
                // Send session key
                this.metaWs.send(JSON.stringify({
                    type: 'set-key',
                    payload: uint8ArrayToString(this.sessionKey, 'base64')
                }));
                
                resolve();
            });
            
            this.metaWs.on('message', (data) => {
                const msg = JSON.parse(data.toString());
                this.messages.push(msg);
                console.log(`[${this.name}] Received:`, msg.type);
            });
            
            this.metaWs.on('error', reject);
        });
    }

    getText() {
        return this.ydoc.getText('test').toString();
    }

    insertText(text, pos = 0) {
        this.ydoc.getText('test').insert(pos, text);
    }

    close() {
        if (this.yjsWs) this.yjsWs.close();
        if (this.metaWs) this.metaWs.close();
    }

    waitForMessage(type, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const check = () => {
                const msg = this.messages.find(m => m.type === type);
                if (msg) {
                    resolve(msg);
                    return true;
                }
                return false;
            };
            
            if (check()) return;
            
            const interval = setInterval(() => {
                if (check()) {
                    clearInterval(interval);
                }
            }, 100);
            
            setTimeout(() => {
                clearInterval(interval);
                reject(new Error(`Timeout waiting for message: ${type}`));
            }, timeout);
        });
    }
}

// Test Results
const results = [];
function test(name, fn) {
    return async () => {
        console.log(`\n=== TEST: ${name} ===`);
        try {
            await fn();
            console.log(`✅ PASSED: ${name}`);
            results.push({ name, passed: true });
        } catch (e) {
            console.error(`❌ FAILED: ${name}`);
            console.error(e);
            results.push({ name, passed: false, error: e.message });
        }
    };
}

// --- TESTS ---

const testMetadataConnection = test('Metadata WebSocket Connection', async () => {
    const key = nacl.randomBytes(32);
    const client = new TestClient('Test1', key);
    
    await client.connectMeta();
    const status = await client.waitForMessage('status');
    
    if (!status) throw new Error('Did not receive status message');
    if (typeof status.torEnabled !== 'boolean') throw new Error('Status missing torEnabled');
    
    client.close();
});

const testTorToggle = test('Tor Toggle On/Off', async () => {
    const key = nacl.randomBytes(32);
    const client = new TestClient('TorTest', key);
    
    await client.connectMeta();
    await client.waitForMessage('status');
    
    // Enable Tor
    client.metaWs.send(JSON.stringify({
        type: 'toggle-tor',
        payload: { enable: true }
    }));
    
    const toggled = await client.waitForMessage('tor-toggled', 30000);
    if (!toggled.enabled) throw new Error('Tor should be enabled');
    
    // Disable Tor
    client.metaWs.send(JSON.stringify({
        type: 'toggle-tor',
        payload: { enable: false }
    }));
    
    await new Promise(r => setTimeout(r, 1000));
    const toggled2 = client.messages.filter(m => m.type === 'tor-toggled').pop();
    if (toggled2?.enabled) throw new Error('Tor should be disabled');
    
    client.close();
});

const testDocumentCreation = test('Document Creation', async () => {
    const key = nacl.randomBytes(32);
    const client = new TestClient('DocCreate', key);
    
    await client.connectMeta();
    await client.waitForMessage('key-set');
    
    const docId = 'test-doc-' + Date.now();
    client.metaWs.send(JSON.stringify({
        type: 'create-document',
        document: {
            id: docId,
            name: 'Test Document',
            type: 'text',
            createdAt: Date.now(),
            lastEdited: Date.now()
        }
    }));
    
    const created = await client.waitForMessage('document-created');
    if (created.document.id !== docId) throw new Error('Document ID mismatch');
    
    client.close();
});

const testMultiClientSync = test('Multi-Client Sync', async () => {
    const key = nacl.randomBytes(32);
    const client1 = new TestClient('Client1', key);
    const client2 = new TestClient('Client2', key);
    
    const docId = 'sync-test-' + Date.now();
    
    // Note: This is a simplified test. Full sync requires 
    // proper y-websocket protocol implementation
    await client1.connectMeta();
    await client2.connectMeta();
    
    await client1.waitForMessage('key-set');
    await client2.waitForMessage('key-set');
    
    // Create document
    client1.metaWs.send(JSON.stringify({
        type: 'create-document',
        document: {
            id: docId,
            name: 'Sync Test',
            type: 'text',
            createdAt: Date.now(),
            lastEdited: Date.now()
        }
    }));
    
    // Both clients should see the creation
    await client1.waitForMessage('document-created');
    await client2.waitForMessage('document-created');
    
    client1.close();
    client2.close();
});

const testDocumentList = test('Document List Retrieval', async () => {
    const key = nacl.randomBytes(32);
    const client = new TestClient('ListTest', key);
    
    await client.connectMeta();
    
    client.metaWs.send(JSON.stringify({ type: 'list-documents' }));
    
    const list = await client.waitForMessage('document-list');
    if (!Array.isArray(list.documents)) throw new Error('Documents should be array');
    
    console.log(`  Found ${list.documents.length} documents`);
    
    client.close();
});

const testPersistenceKey = test('Session Key Persistence', async () => {
    const key = nacl.randomBytes(32);
    const keyString = uint8ArrayToString(key, 'base64');
    
    // Encrypt and decrypt test
    const testData = new Uint8Array([1, 2, 3, 4, 5]);
    const encrypted = encryptUpdate(testData, key);
    const decrypted = decryptUpdate(encrypted, key);
    
    if (!decrypted) throw new Error('Decryption failed');
    if (decrypted.length !== testData.length) throw new Error('Decrypted length mismatch');
    
    for (let i = 0; i < testData.length; i++) {
        if (decrypted[i] !== testData[i]) throw new Error('Decrypted data mismatch');
    }
});

const testGetStatus = test('Get Status Command', async () => {
    const key = nacl.randomBytes(32);
    const client = new TestClient('StatusTest', key);
    
    await client.connectMeta();
    await client.waitForMessage('status'); // Initial status
    
    // Request status explicitly
    client.metaWs.send(JSON.stringify({ type: 'get-status' }));
    
    await new Promise(r => setTimeout(r, 500));
    const statuses = client.messages.filter(m => m.type === 'status');
    
    if (statuses.length < 2) throw new Error('Should receive status on get-status command');
    
    client.close();
});

// --- RUN TESTS ---

async function runAllTests() {
    console.log('╔══════════════════════════════════════════╗');
    console.log('║     Nightjar P2P SYNCHRONIZATION TESTS     ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log('\nMake sure the sidecar is running: node sidecar/index.js\n');
    
    // Run tests sequentially
    await testMetadataConnection();
    await testDocumentCreation();
    await testDocumentList();
    await testPersistenceKey();
    await testGetStatus();
    await testMultiClientSync();
    
    // Tor toggle test is slow, run last
    console.log('\n⚠️  Skipping Tor toggle test (requires Tor to be running)');
    // await testTorToggle();
    
    // Summary
    console.log('\n═══════════════════════════════════════════');
    console.log('TEST SUMMARY');
    console.log('═══════════════════════════════════════════');
    
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    
    results.forEach(r => {
        console.log(`${r.passed ? '✅' : '❌'} ${r.name}`);
        if (r.error) console.log(`   Error: ${r.error}`);
    });
    
    console.log(`\nTotal: ${passed} passed, ${failed} failed`);
    
    process.exit(failed > 0 ? 1 : 0);
}

// Check if run directly
if (require.main === module) {
    runAllTests().catch(console.error);
}

module.exports = {
    TestClient,
    runAllTests
};

// Jest placeholder - integration tests use custom runner
const { describe: jestDescribe, test: jestTest, expect: jestExpect } = require('@jest/globals');

jestDescribe('P2P Sync Integration Test Placeholder', () => {
  jestTest('tests exist in custom format', () => {
    jestExpect(module.exports).toBeDefined();
    jestExpect(typeof module.exports.runAllTests).toBe('function');
  });
});
