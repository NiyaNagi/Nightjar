/**
 * Test Hyperswarm connectivity between machines
 * 
 * Run on two different machines with the same topic to test P2P discovery:
 * 
 *   Machine A: node scripts/test-hyperswarm-connectivity.js
 *   Machine B: node scripts/test-hyperswarm-connectivity.js
 * 
 * Both should discover each other and exchange messages.
 */

const Hyperswarm = require('hyperswarm');
const crypto = require('crypto');
const readline = require('readline');

// Use a fixed topic for testing - both machines must use the same one
const TOPIC_NAME = process.argv[2] || 'nahma-test-topic';
const topic = crypto.createHash('sha256').update(TOPIC_NAME).digest();

console.log('='.repeat(60));
console.log('Hyperswarm Connectivity Test');
console.log('='.repeat(60));
console.log(`Topic: ${TOPIC_NAME}`);
console.log(`Topic Hash: ${topic.toString('hex').slice(0, 32)}...`);
console.log('');
console.log('Run this same command on another machine to test connectivity.');
console.log('');

const swarm = new Hyperswarm();
const connections = new Map();

swarm.on('connection', (socket, peerInfo) => {
  const peerId = peerInfo.publicKey.toString('hex').slice(0, 16);
  console.log(`✓ CONNECTED to peer: ${peerId}`);
  
  connections.set(peerId, socket);
  
  // Send hello message
  socket.write(JSON.stringify({
    type: 'hello',
    from: swarm.keyPair.publicKey.toString('hex').slice(0, 16),
    timestamp: new Date().toISOString()
  }));
  
  socket.on('data', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log(`📨 Message from ${peerId}:`, msg);
    } catch (e) {
      console.log(`📨 Raw data from ${peerId}:`, data.toString());
    }
  });
  
  socket.on('close', () => {
    console.log(`✗ Disconnected from peer: ${peerId}`);
    connections.delete(peerId);
  });
  
  socket.on('error', (err) => {
    console.error(`Error with peer ${peerId}:`, err.message);
  });
});

async function start() {
  // Join the topic
  const discovery = swarm.join(topic, { server: true, client: true });
  await discovery.flushed();
  
  console.log('🔍 Joined topic, looking for peers...');
  console.log(`📡 Your Peer ID: ${swarm.keyPair.publicKey.toString('hex').slice(0, 16)}...`);
  console.log('');
  console.log('Commands:');
  console.log('  /send <message>  - Send message to all peers');
  console.log('  /peers           - List connected peers');
  console.log('  /quit            - Exit');
  console.log('');
  
  // Interactive CLI
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  rl.on('line', (line) => {
    const trimmed = line.trim();
    
    if (trimmed.startsWith('/send ')) {
      const message = trimmed.slice(6);
      const payload = JSON.stringify({
        type: 'chat',
        message,
        from: swarm.keyPair.publicKey.toString('hex').slice(0, 16),
        timestamp: new Date().toISOString()
      });
      
      for (const [peerId, socket] of connections) {
        socket.write(payload);
      }
      console.log(`📤 Sent to ${connections.size} peer(s)`);
      
    } else if (trimmed === '/peers') {
      console.log(`Connected peers (${connections.size}):`);
      for (const peerId of connections.keys()) {
        console.log(`  - ${peerId}`);
      }
      
    } else if (trimmed === '/quit') {
      console.log('Shutting down...');
      swarm.destroy();
      process.exit(0);
      
    } else if (trimmed.startsWith('/')) {
      console.log('Unknown command. Try /send, /peers, or /quit');
    }
  });
  
  // Periodic status
  setInterval(() => {
    if (connections.size === 0) {
      console.log('⏳ Still looking for peers...');
    }
  }, 10000);
}

start().catch(console.error);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  swarm.destroy();
  process.exit(0);
});
