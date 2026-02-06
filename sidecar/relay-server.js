/**
 * WebSocket Relay Server
 * Bridges mobile clients with Hyperswarm network
 * Users can self-host this relay for privacy
 */

const WebSocket = require('ws');
const { HyperswarmManager, generateTopic } = require('./hyperswarm');

class RelayServer {
  constructor(port = 8082) {
    this.port = port;
    this.wss = null;
    this.clients = new Map(); // clientId -> { ws, identity, topics }
    this.swarmManager = new HyperswarmManager();
    this.topics = new Map(); // topicHex -> Set<clientId>
    this.clientCounter = 0;
  }
  
  async start() {
    // Initialize Hyperswarm with relay identity using valid Ed25519 keypair
    const nacl = require('tweetnacl');
    const keyPair = nacl.sign.keyPair();
    await this.swarmManager.initialize({
      publicKey: Buffer.from(keyPair.publicKey).toString('hex'),
      secretKey: Buffer.from(keyPair.secretKey).toString('hex'),
      displayName: 'Relay',
      color: '#888888'
    });
    
    // Set up Hyperswarm event handlers
    this.swarmManager.on('peer-joined', (data) => this.broadcastToTopic(data.topic, data));
    this.swarmManager.on('peer-left', (data) => this.broadcastToTopic(data.topic, data));
    this.swarmManager.on('sync-message', (data) => this.handleSwarmSync(data));
    this.swarmManager.on('awareness-update', (data) => this.handleSwarmAwareness(data));
    
    // Start WebSocket server
    this.wss = new WebSocket.Server({ port: this.port });
    
    this.wss.on('connection', (ws) => {
      const clientId = `client-${++this.clientCounter}`;
      this.handleConnection(ws, clientId);
    });
    
    console.log(`[Relay] WebSocket relay server started on port ${this.port}`);
    return this;
  }
  
  handleConnection(ws, clientId) {
    console.log(`[Relay] Client connected: ${clientId}`);
    
    // Authentication timeout - close connection if no identity received within 30 seconds
    const authTimeout = setTimeout(() => {
      const client = this.clients.get(clientId);
      if (client && !client.identity) {
        console.warn(`[Relay] Client ${clientId} failed to authenticate within timeout, closing`);
        ws.close(4001, 'Authentication timeout');
      }
    }, 30000);
    
    this.clients.set(clientId, {
      ws,
      identity: null,
      topics: new Set(),
      authTimeout
    });
    
    ws.on('message', (data) => {
      this.handleMessage(clientId, data.toString());
    });
    
    ws.on('close', () => {
      console.log(`[Relay] Client disconnected: ${clientId}`);
      this.handleDisconnect(clientId);
    });
    
    ws.on('error', (err) => {
      console.error(`[Relay] Client error ${clientId}:`, err.message);
      // Ensure cleanup happens on error
      this.handleDisconnect(clientId);
    });
  }
  
  handleMessage(clientId, data) {
    try {
      const message = JSON.parse(data);
      const client = this.clients.get(clientId);
      
      if (!client) return;
      
      switch (message.type) {
        case 'identity':
          // Clear auth timeout on successful identity
          if (client.authTimeout) {
            clearTimeout(client.authTimeout);
            client.authTimeout = null;
          }
          client.identity = {
            publicKey: message.publicKey,
            displayName: message.displayName,
            color: message.color
          };
          console.log(`[Relay] Client ${clientId} identified as ${message.displayName}`);
          break;
          
        case 'join-topic':
          this.handleJoinTopic(clientId, message.topic);
          break;
          
        case 'leave-topic':
          this.handleLeaveTopic(clientId, message.topic);
          break;
          
        case 'sync':
          this.handleClientSync(clientId, message);
          break;
          
        case 'awareness':
          this.handleClientAwareness(clientId, message);
          break;
          
        default:
          console.log(`[Relay] Unknown message type from ${clientId}:`, message.type);
      }
    } catch (err) {
      console.error(`[Relay] Failed to parse message from ${clientId}:`, err.message);
    }
  }
  
  async handleJoinTopic(clientId, topicHex) {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    // Add client to topic
    client.topics.add(topicHex);
    
    if (!this.topics.has(topicHex)) {
      this.topics.set(topicHex, new Set());
      // Join the Hyperswarm topic
      await this.swarmManager.joinTopic(topicHex);
    }
    
    this.topics.get(topicHex).add(clientId);
    
    console.log(`[Relay] Client ${clientId} joined topic ${topicHex.slice(0, 16)}...`);
    
    // Notify other clients in the topic
    this.broadcastToTopic(topicHex, {
      type: 'peer-joined',
      peerId: clientId,
      identity: client.identity
    }, clientId);
    
    // Send current peer list
    const peers = [];
    for (const otherId of this.topics.get(topicHex)) {
      if (otherId !== clientId) {
        const other = this.clients.get(otherId);
        if (other?.identity) {
          peers.push({
            peerId: otherId,
            ...other.identity
          });
        }
      }
    }
    
    // Also include Hyperswarm peers
    const swarmPeers = this.swarmManager.getPeers(topicHex);
    peers.push(...swarmPeers);
    
    this.sendToClient(clientId, {
      type: 'peers-list',
      topic: topicHex,
      peers
    });
  }
  
  handleLeaveTopic(clientId, topicHex) {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    client.topics.delete(topicHex);
    
    const topicClients = this.topics.get(topicHex);
    if (topicClients) {
      topicClients.delete(clientId);
      
      // Notify other clients
      this.broadcastToTopic(topicHex, {
        type: 'peer-left',
        peerId: clientId,
        identity: client.identity
      });
      
      // Leave Hyperswarm topic if no clients
      if (topicClients.size === 0) {
        this.swarmManager.leaveTopic(topicHex);
        this.topics.delete(topicHex);
      }
    }
    
    console.log(`[Relay] Client ${clientId} left topic ${topicHex.slice(0, 16)}...`);
  }
  
  handleClientSync(clientId, message) {
    const { topic, data } = message;
    
    // Broadcast to other WebSocket clients
    this.broadcastToTopic(topic, {
      type: 'sync',
      peerId: clientId,
      topic,
      data
    }, clientId);
    
    // Broadcast to Hyperswarm
    this.swarmManager.broadcastSync(topic, data);
  }
  
  handleClientAwareness(clientId, message) {
    const { topic, state } = message;
    
    // Broadcast to other WebSocket clients
    this.broadcastToTopic(topic, {
      type: 'awareness',
      peerId: clientId,
      topic,
      state
    }, clientId);
    
    // Broadcast to Hyperswarm
    this.swarmManager.broadcastAwareness(topic, state);
  }
  
  handleSwarmSync(data) {
    // Forward Hyperswarm sync to WebSocket clients
    this.broadcastToTopic(data.topic, {
      type: 'sync',
      peerId: data.peerId,
      topic: data.topic,
      data: data.data
    });
  }
  
  handleSwarmAwareness(data) {
    // Forward Hyperswarm awareness to WebSocket clients
    this.broadcastToTopic(data.topic, {
      type: 'awareness',
      peerId: data.peerId,
      topic: data.topic,
      state: data.state
    });
  }
  
  handleDisconnect(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    // Clear auth timeout if pending
    if (client.authTimeout) {
      clearTimeout(client.authTimeout);
      client.authTimeout = null;
    }
    
    // Leave all topics
    for (const topic of client.topics) {
      this.handleLeaveTopic(clientId, topic);
    }
    
    this.clients.delete(clientId);
  }
  
  sendToClient(clientId, message) {
    const client = this.clients.get(clientId);
    if (client?.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  }
  
  broadcastToTopic(topicHex, message, excludeClientId = null) {
    const topicClients = this.topics.get(topicHex);
    if (!topicClients) return;
    
    const messageStr = JSON.stringify(message);
    
    for (const clientId of topicClients) {
      if (clientId !== excludeClientId) {
        const client = this.clients.get(clientId);
        if (client?.ws.readyState === WebSocket.OPEN) {
          client.ws.send(messageStr);
        }
      }
    }
  }
  
  async stop() {
    await this.swarmManager.destroy();
    
    for (const client of this.clients.values()) {
      client.ws.close();
    }
    
    this.wss.close();
    console.log('[Relay] Server stopped');
  }
}

// Run if executed directly
if (require.main === module) {
  const port = process.env.RELAY_PORT || 8082;
  const relay = new RelayServer(port);
  relay.start();
  
  process.on('SIGINT', async () => {
    await relay.stop();
    process.exit(0);
  });
}

module.exports = { RelayServer };
