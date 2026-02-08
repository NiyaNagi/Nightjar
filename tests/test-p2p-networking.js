/**
 * P2P Networking Test
 * Tests Hyperswarm connectivity, topic joining, and message broadcasting
 * Run with: node tests/test-p2p-networking.js
 */

const crypto = require('crypto');
const nacl = require('tweetnacl');

// Import the HyperswarmManager
const path = require('path');
const hyperswarmPath = path.join(__dirname, '../sidecar/hyperswarm.js');
delete require.cache[require.resolve(hyperswarmPath)]; // Clear cache

// Create mock identity
function createIdentity(name) {
    const keyPair = nacl.sign.keyPair();
    return {
        displayName: name,
        publicKey: Buffer.from(keyPair.publicKey).toString('hex'),
        secretKey: Buffer.from(keyPair.secretKey).toString('hex'),
        color: '#' + Math.floor(Math.random()*16777215).toString(16)
    };
}

// Generate topic hash - MUST match sidecar/mesh-constants.js formula
const WORKSPACE_TOPIC_PREFIX = 'nightjar-workspace:';
function generateTopicHash(workspaceId) {
    return crypto.createHash('sha256').update(WORKSPACE_TOPIC_PREFIX + workspaceId).digest('hex');
}

async function runTest() {
    console.log('========================================');
    console.log('  P2P NETWORKING TEST');
    console.log('========================================\n');

    // Create two identities
    console.log('📝 Creating test identities...');
    const alice = createIdentity('Alice');
    const bob = createIdentity('Bob');
    console.log(`✓ Alice: ${alice.publicKey.slice(0, 16)}...`);
    console.log(`✓ Bob: ${bob.publicKey.slice(0, 16)}...`);
    
    // Import HyperswarmManager
    console.log('\n📦 Loading Hyperswarm...');
    const { HyperswarmManager } = require(hyperswarmPath);
    
    // Create two swarm instances
    console.log('🌐 Initializing Hyperswarm instances...');
    const aliceSwarm = new HyperswarmManager();
    const bobSwarm = new HyperswarmManager();
    
    await aliceSwarm.initialize(alice);
    console.log('✓ Alice swarm initialized');
    
    await bobSwarm.initialize(bob);
    console.log('✓ Bob swarm initialized');
    
    // Wait a bit for swarms to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Create a test workspace topic
    const workspaceId = crypto.randomBytes(16).toString('hex');
    const topicHash = generateTopicHash(workspaceId);
    console.log(`\n📋 Test workspace ID: ${workspaceId.slice(0, 16)}...`);
    console.log(`📋 Topic hash: ${topicHash.slice(0, 16)}...`);
    
    // Track messages received
    const aliceMessages = [];
    const bobMessages = [];
    
    // Set up message listeners
    aliceSwarm.on('sync-message', ({ peerId, topic, data }) => {
        console.log(`📨 Alice received message from ${peerId.slice(0, 8)}...`);
        aliceMessages.push({ peerId, topic, data });
    });
    
    bobSwarm.on('sync-message', ({ peerId, topic, data }) => {
        console.log(`📨 Bob received message from ${peerId.slice(0, 8)}...`);
        bobMessages.push({ peerId, topic, data });
    });
    
    // Track peer connections
    aliceSwarm.on('peer-joined', ({ peerId, topic, identity }) => {
        console.log(`👋 Alice: Peer joined - ${identity?.displayName || peerId.slice(0, 8)} on topic ${topic.slice(0, 8)}...`);
    });
    
    bobSwarm.on('peer-joined', ({ peerId, topic, identity }) => {
        console.log(`👋 Bob: Peer joined - ${identity?.displayName || peerId.slice(0, 8)} on topic ${topic.slice(0, 8)}...`);
    });
    
    // Join the same topic
    console.log('\n🔗 Joining topic...');
    await aliceSwarm.joinTopic(topicHash);
    console.log('✓ Alice joined topic');
    
    await bobSwarm.joinTopic(topicHash);
    console.log('✓ Bob joined topic');
    
    // Wait for DHT discovery and connection
    console.log('\n⏳ Waiting for peer discovery (10 seconds)...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Check connected peers
    const alicePeerKeys = aliceSwarm.getConnectedPeerKeys();
    const bobPeerKeys = bobSwarm.getConnectedPeerKeys();
    
    console.log(`\n👥 Alice's connected peers: ${alicePeerKeys.length}`);
    alicePeerKeys.forEach(peerKey => {
        const conn = aliceSwarm.connections.get(peerKey);
        console.log(`   - ${conn?.identity?.displayName || peerKey.slice(0, 16)}`);
    });
    
    console.log(`👥 Bob's connected peers: ${bobPeerKeys.length}`);
    bobPeerKeys.forEach(peerKey => {
        const conn = bobSwarm.connections.get(peerKey);
        console.log(`   - ${conn?.identity?.displayName || peerKey.slice(0, 16)}`);
    });
    
    // Test message broadcasting
    if (alicePeerKeys.length > 0 || bobPeerKeys.length > 0) {
        console.log('\n📤 Testing message broadcast...');
        
        const testMessage = { type: 'test', content: 'Hello from Alice!', timestamp: Date.now() };
        aliceSwarm.broadcastSync(topicHash, JSON.stringify(testMessage));
        console.log('✓ Alice broadcast message');
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const testMessage2 = { type: 'test', content: 'Hello from Bob!', timestamp: Date.now() };
        bobSwarm.broadcastSync(topicHash, JSON.stringify(testMessage2));
        console.log('✓ Bob broadcast message');
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log(`\n📬 Alice received ${aliceMessages.length} message(s)`);
        console.log(`📬 Bob received ${bobMessages.length} message(s)`);
    } else {
        console.log('\n❌ No peers connected - DHT discovery may have failed');
        console.log('This could be due to:');
        console.log('  - Firewall blocking UDP traffic');
        console.log('  - Network configuration preventing DHT bootstrapping');
        console.log('  - Running behind strict NAT');
    }
    
    // Test direct connection
    console.log('\n🎯 Testing direct peer connection...');
    try {
        await aliceSwarm.connectToPeer(bob.publicKey);
        console.log('✓ Alice attempting direct connection to Bob...');
        
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const alicePeersAfter = aliceSwarm.getConnectedPeerKeys();
        const bobPeersAfter = bobSwarm.getConnectedPeerKeys();
        
        console.log(`👥 Alice now has ${alicePeersAfter.length} peer(s)`);
        console.log(`👥 Bob now has ${bobPeersAfter.length} peer(s)`);
        
        if (alicePeersAfter.length > 0 || bobPeersAfter.length > 0) {
            console.log('✓ Direct connection successful!');
        }
    } catch (err) {
        console.log('⚠ Direct connection failed:', err.message);
    }
    
    // Summary
    console.log('========================================');
    console.log('  TEST SUMMARY');
    console.log('========================================');
    console.log(`Swarm initialization: ✓`);
    console.log(`Topic joining: ✓`);
    console.log(`Peer discovery: ${alicePeerKeys.length > 0 || bobPeerKeys.length > 0 ? '✓' : '✗'}`);
    console.log(`Message broadcast: ${bobMessages.length > 0 || aliceMessages.length > 0 ? '✓' : '✗'}`);
    console.log('========================================\n');
    
    // Cleanup
    console.log('🧹 Cleaning up...');
    await aliceSwarm.destroy();
    await bobSwarm.destroy();
    console.log('✓ Test complete\n');
    
    process.exit(0);
}

// Run the test
runTest().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
