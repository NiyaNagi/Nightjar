#!/usr/bin/env node
/**
 * Real DHT Document Sharing Integration Tests
 * 
 * These tests exercise the COMPLETE P2P document sharing stack:
 * - Real Hyperswarm DHT peer discovery
 * - Real Y.js document sync
 * - Real cryptographic identity verification
 * - Verification that document content is byte-for-byte identical
 * 
 * This is identical to real-world usage: multiple Nightjar instances
 * discovering each other via the public DHT and syncing documents.
 * 
 * Run with: npm run test:dht
 * Or: node tests/integration/dht-real-runner.js
 */

const crypto = require('crypto');
const nacl = require('tweetnacl');
const path = require('path');
const Y = require('yjs');
const { EventEmitter } = require('events');

// Import the real HyperswarmManager
const hyperswarmPath = path.join(__dirname, '../../sidecar/hyperswarm.js');

// Test configuration
const DHT_DISCOVERY_TIMEOUT = 60000; // 60 seconds for DHT discovery
const SYNC_TIMEOUT = 15000; // 15 seconds for document sync
const MESSAGE_TIMEOUT = 10000; // 10 seconds for message delivery
const CLEANUP_TIMEOUT = 5000; // 5 seconds for cleanup

// Test tracking
let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;
const clients = [];

/**
 * Create a test identity with Ed25519 keypair
 */
function createTestIdentity(name) {
  const keyPair = nacl.sign.keyPair();
  return {
    displayName: name,
    publicKey: Buffer.from(keyPair.publicKey).toString('hex'),
    secretKey: Buffer.from(keyPair.secretKey).toString('hex'),
    color: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'),
  };
}

/**
 * Generate a unique topic hash for testing
 */
function generateTestTopic() {
  const uniqueId = crypto.randomBytes(16).toString('hex');
  return crypto.createHash('sha256').update(`Nightjar-test:${uniqueId}:${Date.now()}`).digest('hex');
}

/**
 * Wait for a condition with timeout
 */
function waitFor(conditionFn, timeout, checkInterval = 500) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    const check = () => {
      if (conditionFn()) {
        resolve(true);
        return;
      }
      
      if (Date.now() - startTime > timeout) {
        reject(new Error(`Timeout waiting for condition after ${timeout}ms`));
        return;
      }
      
      setTimeout(check, checkInterval);
    };
    
    check();
  });
}

/**
 * P2P Document Client - wraps HyperswarmManager with Y.js document
 */
class P2PDocumentClient extends EventEmitter {
  constructor(name, identity) {
    super();
    this.name = name;
    this.identity = identity;
    this.swarm = null;
    this.ydoc = new Y.Doc();
    this.topic = null;
    this.connected = false;
    this.peerCount = 0;
    
    // Bind Y.js update handler
    this.ydoc.on('update', (update, origin) => {
      if (origin !== 'remote' && this.connected && this.topic) {
        // Broadcast local changes to peers
        const encoded = Buffer.from(update).toString('base64');
        this.swarm.broadcastSync(this.topic, encoded);
      }
    });
  }
  
  async initialize() {
    // Clear require cache to get fresh instance
    delete require.cache[require.resolve(hyperswarmPath)];
    const { HyperswarmManager } = require(hyperswarmPath);
    
    this.swarm = new HyperswarmManager();
    await this.swarm.initialize(this.identity);
    
    // Handle incoming sync messages
    this.swarm.on('sync-message', ({ peerId, topic, data }) => {
      console.log(`  [${this.name}] Received sync from ${peerId?.slice(0, 8)}...`);
      try {
        const update = Buffer.from(data, 'base64');
        Y.applyUpdate(this.ydoc, update, 'remote');
      } catch (err) {
        console.error(`  [${this.name}] Failed to apply update:`, err.message);
      }
    });
    
    // Handle sync state requests (send full state to new peer)
    this.swarm.on('sync-state-request', ({ peerId, topic }) => {
      console.log(`  [${this.name}] Peer ${peerId?.slice(0, 8)}... requested full state`);
      const stateVector = Y.encodeStateAsUpdate(this.ydoc);
      const encoded = Buffer.from(stateVector).toString('base64');
      this.swarm.sendSyncState(peerId, topic, encoded);
    });
    
    // Handle full state from peer (initial sync)
    this.swarm.on('sync-state-received', ({ peerId, topic, data }) => {
      console.log(`  [${this.name}] Received full state from ${peerId?.slice(0, 8)}...`);
      try {
        const update = Buffer.from(data, 'base64');
        Y.applyUpdate(this.ydoc, update, 'remote');
        this.emit('synced');
      } catch (err) {
        console.error(`  [${this.name}] Failed to apply state:`, err.message);
      }
    });
    
    // Track peer connections
    this.swarm.on('peer-joined', ({ peerId, identity }) => {
      console.log(`  [${this.name}] Peer joined: ${identity?.displayName || peerId?.slice(0, 16)}`);
      this.peerCount++;
      this.emit('peer-joined', { peerId, identity });
      
      // Request full state from new peer
      if (this.topic) {
        this.swarm.sendSyncRequest(peerId, this.topic);
      }
    });
    
    this.swarm.on('peer-left', ({ peerId }) => {
      console.log(`  [${this.name}] Peer left: ${peerId?.slice(0, 16)}`);
      this.peerCount--;
      this.emit('peer-left', { peerId });
    });
    
    // Wait a bit for DHT connection
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log(`  [${this.name}] Initialized`);
  }
  
  async joinTopic(topic) {
    this.topic = topic;
    await this.swarm.joinTopic(topic);
    this.connected = true;
    console.log(`  [${this.name}] Joined topic: ${topic.slice(0, 16)}...`);
  }
  
  getText(field = 'content') {
    return this.ydoc.getText(field).toString();
  }
  
  insertText(text, index = 0, field = 'content') {
    const ytext = this.ydoc.getText(field);
    ytext.insert(index, text);
  }
  
  appendText(text, field = 'content') {
    const ytext = this.ydoc.getText(field);
    ytext.insert(ytext.length, text);
  }
  
  deleteText(index, length, field = 'content') {
    const ytext = this.ydoc.getText(field);
    ytext.delete(index, length);
  }
  
  setMapValue(key, value, mapName = 'metadata') {
    const ymap = this.ydoc.getMap(mapName);
    ymap.set(key, value);
  }
  
  getMapValue(key, mapName = 'metadata') {
    const ymap = this.ydoc.getMap(mapName);
    return ymap.get(key);
  }
  
  async destroy() {
    this.connected = false;
    if (this.swarm) {
      try {
        await this.swarm.destroy();
      } catch (err) {
        console.warn(`  [${this.name}] Error destroying swarm:`, err.message);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

/**
 * Create and initialize a P2P document client
 */
async function createClient(name) {
  const identity = createTestIdentity(name);
  const client = new P2PDocumentClient(name, identity);
  await client.initialize();
  clients.push(client);
  return client;
}

/**
 * Wait for all clients to have identical content
 */
async function waitForConvergence(testClients, field = 'content', timeout = SYNC_TIMEOUT) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const texts = testClients.map(c => c.getText(field));
    const allSame = texts.every(t => t === texts[0]);
    
    if (allSame && texts[0].length > 0) {
      return true;
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Final comparison with details
  const texts = testClients.map(c => ({ name: c.name, text: c.getText(field) }));
  throw new Error(
    `Convergence timeout after ${timeout}ms:\n` +
    texts.map(t => `    ${t.name}: "${t.text.slice(0, 100)}..." (${t.text.length} chars)`).join('\n')
  );
}

/**
 * Cleanup all clients
 */
async function cleanup() {
  console.log(`  [Cleanup] Destroying ${clients.length} client(s)...`);
  await Promise.all(clients.map(c => c.destroy()));
  clients.length = 0;
  await new Promise(resolve => setTimeout(resolve, CLEANUP_TIMEOUT));
}

/**
 * Run a single test
 */
async function runTest(name, testFn) {
  testsRun++;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: ${name}`);
  console.log('='.repeat(60));
  
  try {
    await testFn();
    testsPassed++;
    console.log(`\n✓ PASSED: ${name}\n`);
  } catch (err) {
    testsFailed++;
    console.error(`\n✗ FAILED: ${name}`);
    console.error(`  Error: ${err.message}`);
    if (err.stack) {
      console.error(`  Stack: ${err.stack.split('\n').slice(1, 4).join('\n')}`);
    }
    console.log();
  } finally {
    await cleanup();
  }
}

/**
 * Assert helper
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\n    Expected: ${JSON.stringify(expected)}\n    Actual: ${JSON.stringify(actual)}`);
  }
}

function assertContains(str, substr, message) {
  if (!str.includes(substr)) {
    throw new Error(`${message}\n    String: "${str.slice(0, 100)}..."\n    Expected to contain: "${substr}"`);
  }
}

// ============================================================
// TEST CASES
// ============================================================

async function testTwoPeersDiscovery() {
  const alice = await createClient('Alice');
  const bob = await createClient('Bob');
  
  const topic = generateTestTopic();
  console.log(`  Topic: ${topic.slice(0, 16)}...`);
  
  let peersConnected = false;
  alice.on('peer-joined', () => { peersConnected = true; });
  bob.on('peer-joined', () => { peersConnected = true; });
  
  await alice.joinTopic(topic);
  await bob.joinTopic(topic);
  
  console.log('  Waiting for DHT peer discovery...');
  const startTime = Date.now();
  await waitFor(() => peersConnected, DHT_DISCOVERY_TIMEOUT);
  const elapsed = Date.now() - startTime;
  
  console.log(`  ✓ Peers discovered in ${elapsed}ms`);
  assert(peersConnected, 'Peers should have discovered each other');
}

async function testTextDocumentSync() {
  const alice = await createClient('Alice');
  const bob = await createClient('Bob');
  
  const topic = generateTestTopic();
  
  let peersConnected = false;
  alice.on('peer-joined', () => { peersConnected = true; });
  bob.on('peer-joined', () => { peersConnected = true; });
  
  await alice.joinTopic(topic);
  await bob.joinTopic(topic);
  
  console.log('  Waiting for DHT peer discovery...');
  await waitFor(() => peersConnected, DHT_DISCOVERY_TIMEOUT);
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  const testContent = `Hello from Alice! Timestamp: ${Date.now()}`;
  console.log(`  Alice inserting: "${testContent}"`);
  alice.insertText(testContent);
  
  console.log('  Waiting for sync convergence...');
  await waitForConvergence([alice, bob], 'content', SYNC_TIMEOUT);
  
  const aliceText = alice.getText();
  const bobText = bob.getText();
  
  console.log(`  Alice: "${aliceText}"`);
  console.log(`  Bob: "${bobText}"`);
  
  assertEqual(aliceText, testContent, 'Alice should have correct content');
  assertEqual(bobText, testContent, 'Bob should have correct content');
  assertEqual(aliceText, bobText, 'Documents should be identical');
}

async function testBidirectionalEditing() {
  const alice = await createClient('Alice');
  const bob = await createClient('Bob');
  
  const topic = generateTestTopic();
  
  let peersConnected = false;
  alice.on('peer-joined', () => { peersConnected = true; });
  bob.on('peer-joined', () => { peersConnected = true; });
  
  await alice.joinTopic(topic);
  await bob.joinTopic(topic);
  
  await waitFor(() => peersConnected, DHT_DISCOVERY_TIMEOUT);
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  console.log('  Alice typing: "Hello "');
  alice.insertText('Hello ');
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('  Bob typing: "World!"');
  bob.appendText('World!');
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('  Alice typing: " - Greetings!"');
  alice.appendText(' - Greetings!');
  
  await waitForConvergence([alice, bob], 'content', SYNC_TIMEOUT);
  
  const aliceText = alice.getText();
  const bobText = bob.getText();
  
  console.log(`  Alice: "${aliceText}"`);
  console.log(`  Bob: "${bobText}"`);
  
  assertEqual(aliceText, bobText, 'Documents should be identical');
  assertContains(aliceText, 'Hello', 'Should contain Hello');
  assertContains(aliceText, 'World', 'Should contain World');
  assertContains(aliceText, 'Greetings', 'Should contain Greetings');
}

async function testThreeClientsMesh() {
  const alice = await createClient('Alice');
  const bob = await createClient('Bob');
  const charlie = await createClient('Charlie');
  
  const topic = generateTestTopic();
  
  const peerCounts = { alice: 0, bob: 0, charlie: 0 };
  alice.on('peer-joined', () => { peerCounts.alice++; });
  bob.on('peer-joined', () => { peerCounts.bob++; });
  charlie.on('peer-joined', () => { peerCounts.charlie++; });
  
  await Promise.all([
    alice.joinTopic(topic),
    bob.joinTopic(topic),
    charlie.joinTopic(topic),
  ]);
  
  console.log('  Waiting for mesh formation...');
  await waitFor(() => {
    return peerCounts.alice >= 1 && peerCounts.bob >= 1 && peerCounts.charlie >= 1;
  }, DHT_DISCOVERY_TIMEOUT);
  console.log(`  Mesh: Alice=${peerCounts.alice}, Bob=${peerCounts.bob}, Charlie=${peerCounts.charlie}`);
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  console.log('  Each client typing...');
  alice.insertText('Alice says hi! ');
  await new Promise(resolve => setTimeout(resolve, 1500));
  bob.appendText('Bob says hello! ');
  await new Promise(resolve => setTimeout(resolve, 1500));
  charlie.appendText('Charlie says hey!');
  
  await waitForConvergence([alice, bob, charlie], 'content', SYNC_TIMEOUT * 2);
  
  const aliceText = alice.getText();
  const bobText = bob.getText();
  const charlieText = charlie.getText();
  
  console.log(`  Alice: "${aliceText}"`);
  console.log(`  Bob: "${bobText}"`);
  console.log(`  Charlie: "${charlieText}"`);
  
  assertEqual(aliceText, bobText, 'Alice and Bob should match');
  assertEqual(bobText, charlieText, 'Bob and Charlie should match');
  assertContains(aliceText, 'Alice', 'Should contain Alice');
  assertContains(aliceText, 'Bob', 'Should contain Bob');
  assertContains(aliceText, 'Charlie', 'Should contain Charlie');
}

async function testLargeDocumentIntegrity() {
  const alice = await createClient('Alice');
  const bob = await createClient('Bob');
  
  const topic = generateTestTopic();
  
  let peersConnected = false;
  alice.on('peer-joined', () => { peersConnected = true; });
  bob.on('peer-joined', () => { peersConnected = true; });
  
  await alice.joinTopic(topic);
  await bob.joinTopic(topic);
  
  await waitFor(() => peersConnected, DHT_DISCOVERY_TIMEOUT);
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Create large document
  console.log('  Creating large document...');
  const paragraphs = [];
  for (let i = 0; i < 20; i++) {
    paragraphs.push(`Paragraph ${i}: ${crypto.randomBytes(50).toString('hex')}\n`);
  }
  const largeContent = paragraphs.join('');
  console.log(`  Document size: ${largeContent.length} characters`);
  
  alice.insertText(largeContent);
  
  await waitForConvergence([alice, bob], 'content', SYNC_TIMEOUT * 2);
  
  const aliceText = alice.getText();
  const bobText = bob.getText();
  
  console.log(`  Alice length: ${aliceText.length}`);
  console.log(`  Bob length: ${bobText.length}`);
  
  assertEqual(aliceText.length, largeContent.length, 'Alice should have full content');
  assertEqual(bobText.length, largeContent.length, 'Bob should have full content');
  
  // Character-by-character verification
  for (let i = 0; i < aliceText.length; i++) {
    if (aliceText[i] !== bobText[i]) {
      throw new Error(`Mismatch at position ${i}: Alice='${aliceText[i]}' Bob='${bobText[i]}'`);
    }
  }
  
  // Hash verification
  const aliceHash = crypto.createHash('sha256').update(aliceText).digest('hex');
  const bobHash = crypto.createHash('sha256').update(bobText).digest('hex');
  
  console.log(`  Alice hash: ${aliceHash.slice(0, 16)}...`);
  console.log(`  Bob hash: ${bobHash.slice(0, 16)}...`);
  
  assertEqual(aliceHash, bobHash, 'Document hashes should match');
}

async function testLateJoiner() {
  const alice = await createClient('Alice');
  
  const topic = generateTestTopic();
  await alice.joinTopic(topic);
  
  const originalContent = 'This content was created before Bob joined!';
  console.log(`  Alice creating content: "${originalContent}"`);
  alice.insertText(originalContent);
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  console.log('  Bob joining late...');
  const bob = await createClient('Bob');
  await bob.joinTopic(topic);
  
  console.log('  Waiting for late joiner to sync...');
  await waitFor(() => {
    const bobText = bob.getText();
    return bobText.length > 0;
  }, DHT_DISCOVERY_TIMEOUT + SYNC_TIMEOUT);
  
  const aliceText = alice.getText();
  const bobText = bob.getText();
  
  console.log(`  Alice: "${aliceText}"`);
  console.log(`  Bob: "${bobText}"`);
  
  assertEqual(bobText, originalContent, 'Bob should receive original content');
  assertEqual(aliceText, bobText, 'Documents should be identical');
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  REAL DHT DOCUMENT SHARING INTEGRATION TESTS');
  console.log('='.repeat(60));
  console.log('\nThese tests use the REAL Hyperswarm DHT network.');
  console.log('DHT discovery may take 10-30 seconds per test.\n');
  
  const selectedTest = process.argv[2];
  
  if (selectedTest) {
    // Run a specific test
    const tests = {
      'discovery': ['Two Peers Discovery', testTwoPeersDiscovery],
      'sync': ['Text Document Sync', testTextDocumentSync],
      'bidirectional': ['Bidirectional Editing', testBidirectionalEditing],
      'mesh': ['Three Clients Mesh', testThreeClientsMesh],
      'integrity': ['Large Document Integrity', testLargeDocumentIntegrity],
      'late': ['Late Joiner', testLateJoiner],
    };
    
    if (tests[selectedTest]) {
      await runTest(tests[selectedTest][0], tests[selectedTest][1]);
    } else {
      console.log('Available tests:', Object.keys(tests).join(', '));
      process.exit(1);
    }
  } else {
    // Run all tests
    await runTest('Two Peers Discovery', testTwoPeersDiscovery);
    await runTest('Text Document Sync', testTextDocumentSync);
    await runTest('Bidirectional Editing', testBidirectionalEditing);
    await runTest('Three Clients Mesh', testThreeClientsMesh);
    await runTest('Large Document Integrity', testLargeDocumentIntegrity);
    await runTest('Late Joiner', testLateJoiner);
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('  SUMMARY');
  console.log('='.repeat(60));
  console.log(`  Tests run: ${testsRun}`);
  console.log(`  Passed: ${testsPassed}`);
  console.log(`  Failed: ${testsFailed}`);
  console.log('='.repeat(60) + '\n');
  
  process.exit(testsFailed > 0 ? 1 : 0);
}

// Handle uncaught errors
process.on('unhandledRejection', async (err) => {
  console.error('\nUnhandled rejection:', err);
  await cleanup();
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('\nInterrupted, cleaning up...');
  await cleanup();
  process.exit(1);
});

main().catch(async (err) => {
  console.error('Fatal error:', err);
  await cleanup();
  process.exit(1);
});
