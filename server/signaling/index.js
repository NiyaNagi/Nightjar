/**
 * Nahma Signaling Server
 * 
 * Minimal WebSocket server for WebRTC peer discovery.
 * This server ONLY routes signaling messages - it never sees document content.
 * 
 * Security model:
 * - No authentication at signaling level (workspace auth is E2E)
 * - Rate limiting to prevent abuse
 * - Room isolation (peers only see others in same room)
 * - No message content inspection or logging
 */

import { WebSocketServer, WebSocket } from 'ws';
import { nanoid } from 'nanoid';

const PORT = process.env.PORT || 4444;
const MAX_PEERS_PER_ROOM = parseInt(process.env.MAX_PEERS_PER_ROOM || '50');
const RATE_LIMIT_WINDOW = 1000; // 1 second
const RATE_LIMIT_MAX = 50; // max messages per window

// Room management
const rooms = new Map(); // roomId -> Set<WebSocket>
const peerInfo = new WeakMap(); // WebSocket -> { peerId, roomId, rateLimit }

/**
 * Rate limiting tracker
 */
class RateLimiter {
  constructor(windowMs, maxRequests) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.requests = [];
  }

  check() {
    const now = Date.now();
    this.requests = this.requests.filter(t => now - t < this.windowMs);
    if (this.requests.length >= this.maxRequests) {
      return false;
    }
    this.requests.push(now);
    return true;
  }
}

/**
 * Send message to a specific peer
 */
function sendTo(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Broadcast to all peers in a room except sender
 */
function broadcastToRoom(roomId, message, excludeWs = null) {
  const room = rooms.get(roomId);
  if (!room) return;

  const data = JSON.stringify(message);
  for (const peer of room) {
    if (peer !== excludeWs && peer.readyState === WebSocket.OPEN) {
      peer.send(data);
    }
  }
}

/**
 * Get list of peers in a room
 */
function getRoomPeers(roomId, excludePeerId = null) {
  const room = rooms.get(roomId);
  if (!room) return [];

  const peers = [];
  for (const ws of room) {
    const info = peerInfo.get(ws);
    if (info && info.peerId !== excludePeerId) {
      peers.push({
        peerId: info.peerId,
        publicKey: info.publicKey,
        profile: info.profile
      });
    }
  }
  return peers;
}

/**
 * Join a room
 */
function joinRoom(ws, roomId) {
  const info = peerInfo.get(ws);
  if (!info) return;

  // Leave current room if in one
  if (info.roomId) {
    leaveRoom(ws);
  }

  // Create room if doesn't exist
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }

  const room = rooms.get(roomId);
  
  // Check room capacity
  if (room.size >= MAX_PEERS_PER_ROOM) {
    sendTo(ws, { type: 'error', error: 'room_full' });
    return;
  }

  room.add(ws);
  info.roomId = roomId;

  // Notify peer of successful join with current peers
  sendTo(ws, {
    type: 'joined',
    roomId,
    peers: getRoomPeers(roomId, info.peerId)
  });

  // Notify others of new peer
  broadcastToRoom(roomId, {
    type: 'peer_joined',
    peerId: info.peerId,
    publicKey: info.publicKey,
    profile: info.profile
  }, ws);

  console.log(`[${info.peerId.slice(0, 8)}] joined room ${roomId.slice(0, 8)}... (${room.size} peers)`);
}

/**
 * Leave current room
 */
function leaveRoom(ws) {
  const info = peerInfo.get(ws);
  if (!info || !info.roomId) return;

  const room = rooms.get(info.roomId);
  if (room) {
    room.delete(ws);
    
    // Notify others
    broadcastToRoom(info.roomId, {
      type: 'peer_left',
      peerId: info.peerId
    });

    // Clean up empty rooms
    if (room.size === 0) {
      rooms.delete(info.roomId);
    }

    console.log(`[${info.peerId.slice(0, 8)}] left room ${info.roomId.slice(0, 8)}...`);
  }

  info.roomId = null;
}

/**
 * Handle incoming message
 */
function handleMessage(ws, data) {
  const info = peerInfo.get(ws);
  if (!info) return;

  // Rate limiting
  if (!info.rateLimiter.check()) {
    sendTo(ws, { type: 'error', error: 'rate_limited' });
    return;
  }

  let message;
  try {
    message = JSON.parse(data);
  } catch (e) {
    sendTo(ws, { type: 'error', error: 'invalid_json' });
    return;
  }

  switch (message.type) {
    case 'join':
      // Join a room (workspace)
      if (!message.roomId || typeof message.roomId !== 'string') {
        sendTo(ws, { type: 'error', error: 'invalid_room_id' });
        return;
      }
      // Store identity info for peer discovery
      if (message.publicKey) info.publicKey = message.publicKey;
      if (message.profile) info.profile = message.profile;
      joinRoom(ws, message.roomId);
      break;

    case 'leave':
      leaveRoom(ws);
      break;

    case 'signal':
      // Forward WebRTC signaling data to specific peer
      if (!message.to || !message.signal) {
        sendTo(ws, { type: 'error', error: 'invalid_signal' });
        return;
      }
      
      // Find target peer in same room
      const room = rooms.get(info.roomId);
      if (!room) return;

      for (const peer of room) {
        const pInfo = peerInfo.get(peer);
        if (pInfo && pInfo.peerId === message.to) {
          sendTo(peer, {
            type: 'signal',
            from: info.peerId,
            signal: message.signal
          });
          break;
        }
      }
      break;

    case 'broadcast':
      // Broadcast to all peers in room (for awareness updates)
      if (!info.roomId) return;
      broadcastToRoom(info.roomId, {
        type: 'broadcast',
        from: info.peerId,
        data: message.data
      }, ws);
      break;

    case 'ping':
      sendTo(ws, { type: 'pong', timestamp: Date.now() });
      break;

    default:
      sendTo(ws, { type: 'error', error: 'unknown_message_type' });
  }
}

/**
 * Handle new connection
 */
function handleConnection(ws, req) {
  const peerId = nanoid(21);
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;

  // Initialize peer info
  peerInfo.set(ws, {
    peerId,
    roomId: null,
    publicKey: null,
    profile: null,
    rateLimiter: new RateLimiter(RATE_LIMIT_WINDOW, RATE_LIMIT_MAX),
    connectedAt: Date.now()
  });

  // Send welcome with assigned peer ID
  sendTo(ws, {
    type: 'welcome',
    peerId,
    serverTime: Date.now()
  });

  console.log(`[${peerId.slice(0, 8)}] connected from ${ip}`);

  // Handle messages
  ws.on('message', (data) => {
    try {
      handleMessage(ws, data.toString());
    } catch (e) {
      console.error(`[${peerId.slice(0, 8)}] message error:`, e.message);
    }
  });

  // Handle disconnect
  ws.on('close', () => {
    leaveRoom(ws);
    console.log(`[${peerId.slice(0, 8)}] disconnected`);
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error(`[${peerId.slice(0, 8)}] error:`, error.message);
  });

  // Heartbeat
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
}

// Create WebSocket server
const wss = new WebSocketServer({ 
  port: PORT,
  maxPayload: 64 * 1024, // 64KB max message size
});

wss.on('connection', handleConnection);

// Heartbeat interval - disconnect dead connections
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      const info = peerInfo.get(ws);
      if (info) {
        console.log(`[${info.peerId.slice(0, 8)}] heartbeat timeout`);
      }
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeat);
});

// Stats endpoint (for monitoring)
function getStats() {
  let totalPeers = 0;
  for (const room of rooms.values()) {
    totalPeers += room.size;
  }
  return {
    rooms: rooms.size,
    peers: totalPeers,
    uptime: process.uptime()
  };
}

// Log stats every minute
setInterval(() => {
  const stats = getStats();
  if (stats.peers > 0) {
    console.log(`[stats] ${stats.rooms} rooms, ${stats.peers} peers, uptime ${Math.floor(stats.uptime)}s`);
  }
}, 60000);

console.log(`
╔═══════════════════════════════════════════════════════════╗
║           Nahma Signaling Server                          ║
╠═══════════════════════════════════════════════════════════╣
║  Port: ${PORT.toString().padEnd(49)}║
║  Max peers per room: ${MAX_PEERS_PER_ROOM.toString().padEnd(36)}║
║  Rate limit: ${RATE_LIMIT_MAX}/sec${' '.repeat(40)}║
║                                                           ║
║  This server only routes signaling data.                  ║
║  All document content is E2E encrypted.                   ║
╚═══════════════════════════════════════════════════════════╝
`);
