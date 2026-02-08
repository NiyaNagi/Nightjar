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
 * Requirements:
 * - Network access (DHT uses UDP)
 * - Patience (DHT discovery can take 5-30 seconds)
 * 
 * Run with: npm run test:dht
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

// Increase Jest timeout for slow DHT operations
jest.setTimeout(180000); // 3 minutes per test

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
      console.log(`[${this.name}] Received sync from ${peerId?.slice(0, 8)}...`);
      try {
        const update = Buffer.from(data, 'base64');
        Y.applyUpdate(this.ydoc, update, 'remote');
      } catch (err) {
        console.error(`[${this.name}] Failed to apply update:`, err.message);
      }
    });
    
    // Handle sync state requests (send full state to new peer)
    this.swarm.on('sync-state-request', ({ peerId, topic }) => {
      console.log(`[${this.name}] Peer ${peerId?.slice(0, 8)}... requested full state`);
      const stateVector = Y.encodeStateAsUpdate(this.ydoc);
      const encoded = Buffer.from(stateVector).toString('base64');
      this.swarm.sendSyncState(peerId, topic, encoded);
    });
    
    // Handle full state from peer (initial sync)
    this.swarm.on('sync-state-received', ({ peerId, topic, data }) => {
      console.log(`[${this.name}] Received full state from ${peerId?.slice(0, 8)}...`);
      try {
        const update = Buffer.from(data, 'base64');
        Y.applyUpdate(this.ydoc, update, 'remote');
        this.emit('synced');
      } catch (err) {
        console.error(`[${this.name}] Failed to apply state:`, err.message);
      }
    });
    
    // Track peer connections
    this.swarm.on('peer-joined', ({ peerId, identity }) => {
      console.log(`[${this.name}] Peer joined: ${identity?.displayName || peerId?.slice(0, 16)}`);
      this.peerCount++;
      this.emit('peer-joined', { peerId, identity });
      
      // Request full state from new peer
      if (this.topic) {
        this.swarm.sendSyncRequest(peerId, this.topic);
      }
    });
    
    this.swarm.on('peer-left', ({ peerId }) => {
      console.log(`[${this.name}] Peer left: ${peerId?.slice(0, 16)}`);
      this.peerCount--;
      this.emit('peer-left', { peerId });
    });
    
    // Wait a bit for DHT connection
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log(`[${this.name}] Initialized`);
  }
  
  async joinTopic(topic) {
    this.topic = topic;
    await this.swarm.joinTopic(topic);
    this.connected = true;
    console.log(`[${this.name}] Joined topic: ${topic.slice(0, 16)}...`);
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
  
  getStateVector() {
    return Y.encodeStateVector(this.ydoc);
  }
  
  async destroy() {
    this.connected = false;
    if (this.swarm) {
      try {
        await this.swarm.destroy();
      } catch (err) {
        console.warn(`[${this.name}] Error destroying swarm:`, err.message);
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
  return client;
}

/**
 * Wait for all clients to have identical content
 */
async function waitForConvergence(clients, field = 'content', timeout = SYNC_TIMEOUT) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const texts = clients.map(c => c.getText(field));
    const allSame = texts.every(t => t === texts[0]);
    
    if (allSame && texts[0].length > 0) {
      return true;
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Final comparison with details
  const texts = clients.map(c => ({ name: c.name, text: c.getText(field) }));
  throw new Error(
    `Convergence timeout after ${timeout}ms:\n` +
    texts.map(t => `  ${t.name}: "${t.text.slice(0, 100)}..." (${t.text.length} chars)`).join('\n')
  );
}

describe('Real DHT Document Sharing', () => {
  let clients = [];
  
  afterEach(async () => {
    console.log(`[Cleanup] Destroying ${clients.length} client(s)...`);
    await Promise.all(clients.map(c => c.destroy()));
    clients = [];
    await new Promise(resolve => setTimeout(resolve, CLEANUP_TIMEOUT));
  });
  
  describe('DHT Discovery', () => {
    test('two peers discover each other via DHT', async () => {
      console.log('\n=== TEST: Two Peers DHT Discovery ===\n');
      
      // Create identities
      const aliceIdentity = createTestIdentity('Alice');
      const bobIdentity = createTestIdentity('Bob');
      console.log(`[Setup] Alice: ${aliceIdentity.publicKey.slice(0, 16)}...`);
      console.log(`[Setup] Bob: ${bobIdentity.publicKey.slice(0, 16)}...`);
      
      // Create clients
      const alice = new P2PDocumentClient('Alice', aliceIdentity);
      const bob = new P2PDocumentClient('Bob', bobIdentity);
      await alice.initialize();
      await bob.initialize();
      clients.push(alice, bob);
      
      // Generate unique topic
      const topic = generateTestTopic();
      console.log(`[Setup] Topic: ${topic.slice(0, 16)}...`);
      
      // Track peer discoveries
      let aliceFoundBob = false;
      let bobFoundAlice = false;
      
      alice.on('peer-joined', ({ identity }) => {
        if (identity?.displayName === 'Bob') aliceFoundBob = true;
      });
      
      bob.on('peer-joined', ({ identity }) => {
        if (identity?.displayName === 'Alice') bobFoundAlice = true;
      });
      
      // Both join the same topic
      console.log('[DHT] Joining topic...');
      await alice.joinTopic(topic);
      await bob.joinTopic(topic);
      console.log('[DHT] Both peers joined topic, waiting for discovery...');
      
      // Wait for peers to discover each other
      const discoveryStart = Date.now();
      await waitFor(() => aliceFoundBob || bobFoundAlice, DHT_DISCOVERY_TIMEOUT);
      const discoveryTime = Date.now() - discoveryStart;
      console.log(`[DHT] ✓ Peers discovered each other in ${discoveryTime}ms`);
      
      console.log('[Test] ✓ DHT discovery successful');
    });
  });
  
  describe('Text Document Sync', () => {
    test('two clients sync text document via DHT', async () => {
      console.log('\n=== TEST: Two Clients Text Sync via DHT ===\n');
      
      // Create clients
      const alice = await createClient('Alice');
      const bob = await createClient('Bob');
      clients.push(alice, bob);
      
      // Generate unique topic
      const topic = generateTestTopic();
      console.log(`[Setup] Topic: ${topic.slice(0, 16)}...`);
      
      // Track when peers connect
      let peersConnected = false;
      alice.on('peer-joined', () => { peersConnected = true; });
      bob.on('peer-joined', () => { peersConnected = true; });
      
      // Join topic
      await alice.joinTopic(topic);
      await bob.joinTopic(topic);
      
      // Wait for peer discovery
      console.log('[DHT] Waiting for peer discovery...');
      await waitFor(() => peersConnected, DHT_DISCOVERY_TIMEOUT);
      console.log('[DHT] ✓ Peers connected');
      
      // Wait for connection to stabilize
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Alice creates document content
      const testContent = `Hello from Alice! Timestamp: ${Date.now()}`;
      console.log(`[Alice] Inserting: "${testContent}"`);
      alice.insertText(testContent);
      
      // Wait for sync
      console.log('[Sync] Waiting for convergence...');
      await waitForConvergence([alice, bob], 'content', SYNC_TIMEOUT);
      
      // Verify content is identical
      const aliceText = alice.getText();
      const bobText = bob.getText();
      
      console.log(`[Verify] Alice: "${aliceText}"`);
      console.log(`[Verify] Bob: "${bobText}"`);
      
      expect(aliceText).toBe(testContent);
      expect(bobText).toBe(testContent);
      expect(aliceText).toBe(bobText);
      
      console.log('[Test] ✓ Text sync successful - documents are identical');
    });
    
    test('bidirectional text editing syncs correctly', async () => {
      console.log('\n=== TEST: Bidirectional Text Editing ===\n');
      
      // Create clients
      const alice = await createClient('Alice');
      const bob = await createClient('Bob');
      clients.push(alice, bob);
      
      const topic = generateTestTopic();
      
      let peersConnected = false;
      alice.on('peer-joined', () => { peersConnected = true; });
      bob.on('peer-joined', () => { peersConnected = true; });
      
      await alice.joinTopic(topic);
      await bob.joinTopic(topic);
      
      await waitFor(() => peersConnected, DHT_DISCOVERY_TIMEOUT);
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Alice types first
      console.log('[Alice] Typing: "Hello "');
      alice.insertText('Hello ');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Bob adds to the end
      console.log('[Bob] Typing: "World!"');
      bob.appendText('World!');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Alice adds more
      console.log('[Alice] Typing: " - Greetings!"');
      alice.appendText(' - Greetings!');
      
      // Wait for convergence
      await waitForConvergence([alice, bob], 'content', SYNC_TIMEOUT);
      
      const aliceText = alice.getText();
      const bobText = bob.getText();
      
      console.log(`[Verify] Alice: "${aliceText}"`);
      console.log(`[Verify] Bob: "${bobText}"`);
      
      expect(aliceText).toBe(bobText);
      expect(aliceText).toContain('Hello');
      expect(aliceText).toContain('World');
      expect(aliceText).toContain('Greetings');
      
      console.log('[Test] ✓ Bidirectional editing synced correctly');
    });
    
    test('three clients sync via mesh', async () => {
      console.log('\n=== TEST: Three Clients Mesh Sync ===\n');
      
      // Create clients
      const alice = await createClient('Alice');
      const bob = await createClient('Bob');
      const charlie = await createClient('Charlie');
      clients.push(alice, bob, charlie);
      
      const topic = generateTestTopic();
      
      // Track peer counts
      const peerCounts = { alice: 0, bob: 0, charlie: 0 };
      alice.on('peer-joined', () => { peerCounts.alice++; });
      bob.on('peer-joined', () => { peerCounts.bob++; });
      charlie.on('peer-joined', () => { peerCounts.charlie++; });
      
      await Promise.all([
        alice.joinTopic(topic),
        bob.joinTopic(topic),
        charlie.joinTopic(topic),
      ]);
      
      // Wait for mesh formation (each should see at least 1 peer)
      console.log('[DHT] Waiting for mesh formation...');
      await waitFor(() => {
        return peerCounts.alice >= 1 && peerCounts.bob >= 1 && peerCounts.charlie >= 1;
      }, DHT_DISCOVERY_TIMEOUT);
      console.log(`[DHT] ✓ Mesh formed: Alice=${peerCounts.alice}, Bob=${peerCounts.bob}, Charlie=${peerCounts.charlie}`);
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Each client adds content
      console.log('[Alice] Typing...');
      alice.insertText('Alice says hi! ');
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      console.log('[Bob] Typing...');
      bob.appendText('Bob says hello! ');
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      console.log('[Charlie] Typing...');
      charlie.appendText('Charlie says hey!');
      
      // Wait for all to converge
      await waitForConvergence([alice, bob, charlie], 'content', SYNC_TIMEOUT * 2);
      
      const aliceText = alice.getText();
      const bobText = bob.getText();
      const charlieText = charlie.getText();
      
      console.log(`[Verify] Alice: "${aliceText}"`);
      console.log(`[Verify] Bob: "${bobText}"`);
      console.log(`[Verify] Charlie: "${charlieText}"`);
      
      expect(aliceText).toBe(bobText);
      expect(bobText).toBe(charlieText);
      expect(aliceText).toContain('Alice');
      expect(aliceText).toContain('Bob');
      expect(aliceText).toContain('Charlie');
      
      console.log('[Test] ✓ Three-client mesh sync successful');
    });
  });
  
  describe('Map Data Sync', () => {
    test('metadata map syncs between peers', async () => {
      console.log('\n=== TEST: Map Data Sync via DHT ===\n');
      
      const alice = await createClient('Alice');
      const bob = await createClient('Bob');
      clients.push(alice, bob);
      
      const topic = generateTestTopic();
      
      let peersConnected = false;
      alice.on('peer-joined', () => { peersConnected = true; });
      bob.on('peer-joined', () => { peersConnected = true; });
      
      await alice.joinTopic(topic);
      await bob.joinTopic(topic);
      
      await waitFor(() => peersConnected, DHT_DISCOVERY_TIMEOUT);
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Alice sets metadata
      console.log('[Alice] Setting metadata...');
      alice.setMapValue('title', 'Test Document');
      alice.setMapValue('author', 'Alice');
      alice.setMapValue('version', 1);
      
      // Wait for sync
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Verify Bob has the data
      const bobTitle = bob.getMapValue('title');
      const bobAuthor = bob.getMapValue('author');
      const bobVersion = bob.getMapValue('version');
      
      console.log(`[Verify] Bob sees: title="${bobTitle}", author="${bobAuthor}", version=${bobVersion}`);
      
      expect(bobTitle).toBe('Test Document');
      expect(bobAuthor).toBe('Alice');
      expect(bobVersion).toBe(1);
      
      // Bob updates
      console.log('[Bob] Updating version...');
      bob.setMapValue('version', 2);
      bob.setMapValue('lastEditor', 'Bob');
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Verify Alice sees updates
      const aliceVersion = alice.getMapValue('version');
      const aliceLastEditor = alice.getMapValue('lastEditor');
      
      console.log(`[Verify] Alice sees: version=${aliceVersion}, lastEditor="${aliceLastEditor}"`);
      
      expect(aliceVersion).toBe(2);
      expect(aliceLastEditor).toBe('Bob');
      
      console.log('[Test] ✓ Map data sync successful');
    });
  });
  
  describe('Late Joiner Sync', () => {
    test('late joiner receives existing document content', async () => {
      console.log('\n=== TEST: Late Joiner Receives Content ===\n');
      
      // Alice starts alone
      const alice = await createClient('Alice');
      clients.push(alice);
      
      const topic = generateTestTopic();
      await alice.joinTopic(topic);
      
      // Alice creates content before anyone else joins
      const originalContent = 'This content was created before Bob joined!';
      console.log(`[Alice] Creating content: "${originalContent}"`);
      alice.insertText(originalContent);
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Now Bob joins late
      console.log('[Bob] Joining late...');
      const bob = await createClient('Bob');
      clients.push(bob);
      
      let bobReceivedSync = false;
      bob.on('synced', () => { bobReceivedSync = true; });
      bob.on('peer-joined', () => {
        // Request sync when peer is found
        console.log('[Bob] Found peer, requesting state...');
      });
      
      await bob.joinTopic(topic);
      
      // Wait for Bob to discover Alice and sync
      console.log('[Sync] Waiting for late joiner to sync...');
      await waitFor(() => {
        const bobText = bob.getText();
        return bobText.length > 0;
      }, DHT_DISCOVERY_TIMEOUT + SYNC_TIMEOUT);
      
      const aliceText = alice.getText();
      const bobText = bob.getText();
      
      console.log(`[Verify] Alice: "${aliceText}"`);
      console.log(`[Verify] Bob: "${bobText}"`);
      
      expect(bobText).toBe(originalContent);
      expect(aliceText).toBe(bobText);
      
      console.log('[Test] ✓ Late joiner received existing content');
    });
  });
  
  describe('Concurrent Editing', () => {
    test('concurrent edits at same position resolve correctly', async () => {
      console.log('\n=== TEST: Concurrent Edits (CRDT Resolution) ===\n');
      
      const alice = await createClient('Alice');
      const bob = await createClient('Bob');
      clients.push(alice, bob);
      
      const topic = generateTestTopic();
      
      let peersConnected = false;
      alice.on('peer-joined', () => { peersConnected = true; });
      bob.on('peer-joined', () => { peersConnected = true; });
      
      await alice.joinTopic(topic);
      await bob.joinTopic(topic);
      
      await waitFor(() => peersConnected, DHT_DISCOVERY_TIMEOUT);
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Start with shared base content
      alice.insertText('Start ');
      await waitForConvergence([alice, bob], 'content', SYNC_TIMEOUT);
      
      // Both edit at the same time (race condition)
      console.log('[Concurrent] Both typing at the same time...');
      alice.appendText('AliceEdit');
      bob.appendText('BobEdit');
      
      // Wait for convergence
      await waitForConvergence([alice, bob], 'content', SYNC_TIMEOUT);
      
      const aliceText = alice.getText();
      const bobText = bob.getText();
      
      console.log(`[Verify] Alice: "${aliceText}"`);
      console.log(`[Verify] Bob: "${bobText}"`);
      
      // Both should have the same content (CRDT ensures this)
      expect(aliceText).toBe(bobText);
      // Both edits should be present
      expect(aliceText).toContain('Start');
      expect(aliceText).toContain('AliceEdit');
      expect(aliceText).toContain('BobEdit');
      
      console.log('[Test] ✓ Concurrent edits resolved correctly via CRDT');
    });
  });
  
  describe('Data Integrity', () => {
    test('large document syncs correctly with exact byte verification', async () => {
      console.log('\n=== TEST: Large Document Sync with Byte Verification ===\n');
      
      const alice = await createClient('Alice');
      const bob = await createClient('Bob');
      clients.push(alice, bob);
      
      const topic = generateTestTopic();
      
      let peersConnected = false;
      alice.on('peer-joined', () => { peersConnected = true; });
      bob.on('peer-joined', () => { peersConnected = true; });
      
      await alice.joinTopic(topic);
      await bob.joinTopic(topic);
      
      await waitFor(() => peersConnected, DHT_DISCOVERY_TIMEOUT);
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Create a large document with specific content
      console.log('[Alice] Creating large document...');
      const paragraphs = [];
      for (let i = 0; i < 20; i++) {
        paragraphs.push(`Paragraph ${i}: ${crypto.randomBytes(50).toString('hex')}\n`);
      }
      const largeContent = paragraphs.join('');
      console.log(`[Alice] Document size: ${largeContent.length} characters`);
      
      alice.insertText(largeContent);
      
      // Wait for sync with longer timeout for large doc
      await waitForConvergence([alice, bob], 'content', SYNC_TIMEOUT * 2);
      
      const aliceText = alice.getText();
      const bobText = bob.getText();
      
      // Byte-by-byte comparison
      console.log(`[Verify] Alice length: ${aliceText.length}`);
      console.log(`[Verify] Bob length: ${bobText.length}`);
      
      expect(aliceText.length).toBe(bobText.length);
      expect(aliceText.length).toBe(largeContent.length);
      
      // Character-by-character verification
      for (let i = 0; i < aliceText.length; i++) {
        if (aliceText[i] !== bobText[i]) {
          throw new Error(`Mismatch at position ${i}: Alice='${aliceText[i]}' Bob='${bobText[i]}'`);
        }
      }
      
      // Hash verification
      const aliceHash = crypto.createHash('sha256').update(aliceText).digest('hex');
      const bobHash = crypto.createHash('sha256').update(bobText).digest('hex');
      
      console.log(`[Verify] Alice hash: ${aliceHash.slice(0, 16)}...`);
      console.log(`[Verify] Bob hash: ${bobHash.slice(0, 16)}...`);
      
      expect(aliceHash).toBe(bobHash);
      
      console.log('[Test] ✓ Large document synced with byte-perfect accuracy');
    });
  });
  
  describe('Topic Isolation', () => {
    test('peers on different topics cannot communicate', async () => {
      console.log('\n=== TEST: Topic Isolation ===\n');
      
      const alice = await createClient('Alice');
      const bob = await createClient('Bob');
      const charlie = await createClient('Charlie');
      clients.push(alice, bob, charlie);
      
      // Two different topics
      const topic1 = generateTestTopic();
      const topic2 = generateTestTopic();
      
      console.log(`[Setup] Topic 1: ${topic1.slice(0, 16)}...`);
      console.log(`[Setup] Topic 2: ${topic2.slice(0, 16)}...`);
      
      // Track peer discoveries
      const alicePeers = new Set();
      const bobPeers = new Set();
      const charliePeers = new Set();
      
      alice.on('peer-joined', ({ identity }) => {
        if (identity?.displayName) alicePeers.add(identity.displayName);
      });
      bob.on('peer-joined', ({ identity }) => {
        if (identity?.displayName) bobPeers.add(identity.displayName);
      });
      charlie.on('peer-joined', ({ identity }) => {
        if (identity?.displayName) charliePeers.add(identity.displayName);
      });
      
      // Alice and Bob join topic1, Charlie joins topic2
      await alice.joinTopic(topic1);
      await bob.joinTopic(topic1);
      await charlie.joinTopic(topic2);
      
      // Wait for discovery on topic1
      console.log('[DHT] Waiting for topic1 discovery...');
      await waitFor(() => alicePeers.size > 0 || bobPeers.size > 0, DHT_DISCOVERY_TIMEOUT);
      
      // Give time for any cross-topic pollution
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Verify isolation
      console.log(`[Verify] Alice sees: ${Array.from(alicePeers).join(', ') || 'none'}`);
      console.log(`[Verify] Bob sees: ${Array.from(bobPeers).join(', ') || 'none'}`);
      console.log(`[Verify] Charlie sees: ${Array.from(charliePeers).join(', ') || 'none'}`);
      
      // Alice should see Bob (same topic)
      expect(alicePeers.has('Bob') || bobPeers.has('Alice')).toBe(true);
      // Charlie should NOT see Alice or Bob (different topic)
      expect(charliePeers.has('Alice')).toBe(false);
      expect(charliePeers.has('Bob')).toBe(false);
      
      console.log('[Test] ✓ Topic isolation verified');
    });
  });
});

// Export for direct execution
module.exports = { P2PDocumentClient, createClient, waitForConvergence, createTestIdentity, generateTestTopic };
