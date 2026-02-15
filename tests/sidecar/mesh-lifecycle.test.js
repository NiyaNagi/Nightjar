/**
 * Mesh Participant Lifecycle Tests
 * 
 * Extended tests for sidecar/mesh.js focusing on:
 * - start() / stop() lifecycle
 * - Event emissions
 * - joinWorkspace / leaveWorkspace
 * - Connection handling
 * - Error recovery
 */

/**
 * @jest-environment node
 */

const EventEmitter = require('events');

// Mock connection factory - named with 'mock' prefix for Jest
const mockCreateConnection = () => {
  const conn = new EventEmitter();
  conn.write = jest.fn();
  conn.destroy = jest.fn();
  return conn;
};

// Mock hyperswarm with more functionality
jest.mock('hyperswarm', () => {
  const EventEmitter = require('events');
  class MockHyperswarm extends EventEmitter {
    constructor() {
      super();
      this.connections = [];
      this.joinedTopics = new Map();
      this._destroyed = false;
    }
    
    join(topic, options) {
      const topicHex = topic.toString('hex');
      this.joinedTopics.set(topicHex, options);
      return {
        flushed: () => Promise.resolve(),
        destroy: () => Promise.resolve(),
      };
    }
    
    leave(topic) {
      const topicHex = topic.toString('hex');
      this.joinedTopics.delete(topicHex);
      return Promise.resolve();
    }
    
    async destroy() {
      this._destroyed = true;
      this.joinedTopics.clear();
      this.connections = [];
    }
    
    // Simulate a new connection (inline factory to avoid out-of-scope reference)
    simulateConnection(info = {}) {
      const conn = new EventEmitter();
      conn.write = jest.fn();
      conn.destroy = jest.fn();
      const defaultInfo = {
        publicKey: Buffer.from('test-public-key-32-bytes-long!!!'),
        ...info,
      };
      this.connections.push(conn);
      this.emit('connection', conn, defaultInfo);
      return conn;
    }
  }
  return MockHyperswarm;
});

const {
  getMeshTopic,
  getWorkspaceTopic,
  getWorkspaceTopicHex,
  MESSAGE_TYPES,
  generateNodeId,
} = require('../../sidecar/mesh-constants');

const { MeshParticipant } = require('../../sidecar/mesh');

describe('MeshParticipant Lifecycle', () => {
  afterEach(async () => {
    jest.clearAllMocks();
  });

  describe('start()', () => {
    test('starts successfully', async () => {
      const participant = new MeshParticipant();
      await participant.start();
      
      expect(participant._running).toBe(true);
      expect(participant.swarm).not.toBeNull();
      
      await participant.stop();
    });

    test('emits "started" event', async () => {
      const participant = new MeshParticipant();
      const startedHandler = jest.fn();
      participant.on('started', startedHandler);
      
      await participant.start();
      
      expect(startedHandler).toHaveBeenCalledTimes(1);
      
      await participant.stop();
    });

    test('does nothing when disabled', async () => {
      const participant = new MeshParticipant({ enabled: false });
      await participant.start();
      
      expect(participant._running).toBe(false);
      expect(participant.swarm).toBeNull();
    });

    test('does not start twice', async () => {
      const participant = new MeshParticipant();
      await participant.start();
      await participant.start(); // Second start
      
      // Should still be running, no error
      expect(participant._running).toBe(true);
      
      await participant.stop();
    });

    test('joins mesh topic', async () => {
      const participant = new MeshParticipant();
      await participant.start();
      
      const meshTopicHex = getMeshTopic().toString('hex');
      expect(participant.swarm.joinedTopics.has(meshTopicHex)).toBe(true);
      
      await participant.stop();
    });

    test('starts announcements when relay mode with publicUrl', async () => {
      jest.useFakeTimers();
      
      const participant = new MeshParticipant({
        relayMode: true,
        publicUrl: 'wss://relay.example.com',
      });
      await participant.start();
      
      expect(participant._announceInterval).not.toBeNull();
      
      jest.useRealTimers();
      await participant.stop();
    });

    test('does not start announcements without publicUrl', async () => {
      const participant = new MeshParticipant({
        relayMode: true,
        // No publicUrl
      });
      await participant.start();
      
      expect(participant._announceInterval).toBeNull();
      
      await participant.stop();
    });
  });

  describe('stop()', () => {
    test('stops successfully', async () => {
      const participant = new MeshParticipant();
      await participant.start();
      await participant.stop();
      
      expect(participant._running).toBe(false);
      expect(participant.swarm).toBeNull();
    });

    test('emits "stopped" event', async () => {
      const participant = new MeshParticipant();
      const stoppedHandler = jest.fn();
      participant.on('stopped', stoppedHandler);
      
      await participant.start();
      await participant.stop();
      
      expect(stoppedHandler).toHaveBeenCalledTimes(1);
    });

    test('clears announcement interval', async () => {
      jest.useFakeTimers();
      
      const participant = new MeshParticipant({
        relayMode: true,
        publicUrl: 'wss://relay.example.com',
      });
      await participant.start();
      
      const intervalHandle = participant._announceInterval;
      expect(intervalHandle).not.toBeNull();
      
      await participant.stop();
      
      expect(participant._announceInterval).toBeNull();
      
      jest.useRealTimers();
    });

    test('clears mesh connections', async () => {
      const participant = new MeshParticipant();
      await participant.start();
      
      // Add some fake connections
      participant.meshConnections.set('key1', {});
      participant.meshConnections.set('key2', {});
      
      await participant.stop();
      
      expect(participant.meshConnections.size).toBe(0);
    });

    test('does nothing if not running', async () => {
      const participant = new MeshParticipant();
      await participant.stop(); // Stop without starting
      
      expect(participant._running).toBe(false);
    });
  });

  describe('joinWorkspace()', () => {
    test('joins workspace topic', async () => {
      const participant = new MeshParticipant();
      await participant.start();
      
      const workspaceId = 'test-workspace-123';
      await participant.joinWorkspace(workspaceId);
      
      // Implementation stores topicHex, not workspaceId
      const topicHex = getWorkspaceTopicHex(workspaceId);
      expect(participant.ourWorkspaces.has(topicHex)).toBe(true);
      
      await participant.stop();
    });

    test('tracks workspace topic hex', async () => {
      const participant = new MeshParticipant();
      await participant.start();
      
      const workspaceId = 'test-workspace-123';
      await participant.joinWorkspace(workspaceId);
      
      const topicHex = getWorkspaceTopicHex(workspaceId);
      expect(participant.swarm.joinedTopics.has(topicHex)).toBe(true);
      
      await participant.stop();
    });

    test('does not rejoin existing workspace', async () => {
      const participant = new MeshParticipant();
      await participant.start();
      
      const workspaceId = 'test-workspace';
      await participant.joinWorkspace(workspaceId);
      await participant.joinWorkspace(workspaceId); // Join again
      
      // Should still only be in ourWorkspaces once
      const topicHex = getWorkspaceTopicHex(workspaceId);
      expect([...participant.ourWorkspaces].filter(t => t === topicHex).length).toBe(1);
      
      await participant.stop();
    });
  });

  describe('leaveWorkspace()', () => {
    test('leaves workspace topic', async () => {
      const participant = new MeshParticipant();
      await participant.start();
      
      const workspaceId = 'test-workspace-123';
      await participant.joinWorkspace(workspaceId);
      await participant.leaveWorkspace(workspaceId);
      
      // Implementation stores topicHex
      const topicHex = getWorkspaceTopicHex(workspaceId);
      expect(participant.ourWorkspaces.has(topicHex)).toBe(false);
      
      await participant.stop();
    });

    test('does nothing for unknown workspace', async () => {
      const participant = new MeshParticipant();
      await participant.start();
      
      // Should not throw
      await participant.leaveWorkspace('unknown-workspace');
      
      await participant.stop();
    });
  });

  describe('Connection Handling', () => {
    test('handles new connections', async () => {
      const participant = new MeshParticipant();
      await participant.start();
      
      const conn = participant.swarm.simulateConnection();
      
      // Connection should be tracked
      const remoteKey = 'test-public-key-32-bytes-long!!!';
      const remoteKeyHex = Buffer.from(remoteKey).toString('hex');
      expect(participant.meshConnections.has(remoteKeyHex)).toBe(true);
      
      await participant.stop();
    });

    test('handles connection close', async () => {
      const participant = new MeshParticipant();
      await participant.start();
      
      const conn = participant.swarm.simulateConnection();
      const remoteKey = 'test-public-key-32-bytes-long!!!';
      const remoteKeyHex = Buffer.from(remoteKey).toString('hex');
      
      // Simulate close
      conn.emit('close');
      
      expect(participant.meshConnections.has(remoteKeyHex)).toBe(false);
      
      await participant.stop();
    });

    test('handles connection error gracefully', async () => {
      const participant = new MeshParticipant();
      await participant.start();
      
      const conn = participant.swarm.simulateConnection();
      
      // Should not throw
      conn.emit('error', new Error('Test error'));
      
      await participant.stop();
    });

    test('sends bootstrap request for new connections', async () => {
      const participant = new MeshParticipant();
      await participant.start();
      
      const conn = participant.swarm.simulateConnection();
      
      // Should have sent bootstrap request
      expect(conn.write).toHaveBeenCalled();
      const writtenData = conn.write.mock.calls[0][0];
      const message = JSON.parse(writtenData);
      expect(message.type).toBe(MESSAGE_TYPES.BOOTSTRAP_REQUEST);
      
      await participant.stop();
    });
  });

  describe('Message Handling', () => {
    test('responds to PING with PONG', async () => {
      const participant = new MeshParticipant();
      await participant.start();
      
      const conn = participant.swarm.simulateConnection();
      conn.write.mockClear();
      
      // Simulate receiving PING
      const pingMessage = JSON.stringify({ type: MESSAGE_TYPES.PING }) + '\n';
      conn.emit('data', Buffer.from(pingMessage));
      
      // Should respond with PONG
      expect(conn.write).toHaveBeenCalled();
      const responseData = conn.write.mock.calls[0][0];
      const response = JSON.parse(responseData);
      expect(response.type).toBe(MESSAGE_TYPES.PONG);
      expect(response.nodeId).toBe(participant.nodeId);
      
      await participant.stop();
    });

    test('handles fragmented messages', async () => {
      const participant = new MeshParticipant();
      await participant.start();
      
      const conn = participant.swarm.simulateConnection();
      conn.write.mockClear();
      
      // Send message in fragments
      const fullMessage = JSON.stringify({ type: MESSAGE_TYPES.PING }) + '\n';
      const part1 = fullMessage.slice(0, 5);
      const part2 = fullMessage.slice(5);
      
      conn.emit('data', Buffer.from(part1));
      expect(conn.write).not.toHaveBeenCalled();
      
      conn.emit('data', Buffer.from(part2));
      expect(conn.write).toHaveBeenCalled();
      
      await participant.stop();
    });

    test('handles multiple messages in one data event', async () => {
      const participant = new MeshParticipant();
      await participant.start();
      
      const conn = participant.swarm.simulateConnection();
      conn.write.mockClear();
      
      // Send multiple messages at once
      const msg1 = JSON.stringify({ type: MESSAGE_TYPES.PING }) + '\n';
      const msg2 = JSON.stringify({ type: MESSAGE_TYPES.PING }) + '\n';
      
      conn.emit('data', Buffer.from(msg1 + msg2));
      
      // Should have responded twice
      expect(conn.write).toHaveBeenCalledTimes(2);
      
      await participant.stop();
    });
  });

  describe('Relay Announcements', () => {
    test('stores relay announcements from others', async () => {
      const participant = new MeshParticipant();
      await participant.start();
      
      const conn = participant.swarm.simulateConnection();
      
      const otherNodeId = generateNodeId();
      const announceMessage = JSON.stringify({
        type: MESSAGE_TYPES.RELAY_ANNOUNCE,
        nodeId: otherNodeId,
        endpoints: ['wss://other-relay.example.com'],
        capabilities: { webrtc: true },
        version: '1.0.0',
      }) + '\n';
      
      conn.emit('data', Buffer.from(announceMessage));
      
      expect(participant.knownRelays.has(otherNodeId)).toBe(true);
      
      await participant.stop();
    });

    test('ignores own relay announcements', async () => {
      const participant = new MeshParticipant({
        relayMode: true,
        publicUrl: 'wss://relay.example.com',
      });
      await participant.start();
      
      const conn = participant.swarm.simulateConnection();
      
      // Simulate receiving our own announcement (reflected back)
      const announceMessage = JSON.stringify({
        type: MESSAGE_TYPES.RELAY_ANNOUNCE,
        nodeId: participant.nodeId,
        endpoints: ['wss://relay.example.com'],
      }) + '\n';
      
      conn.emit('data', Buffer.from(announceMessage));
      
      // Should not store own announcement
      expect(participant.knownRelays.has(participant.nodeId)).toBe(false);
      
      await participant.stop();
    });
  });

  describe('Known Relays', () => {
    test('stores and retrieves known relays', async () => {
      const participant = new MeshParticipant();
      
      // Manually add some relays
      participant.knownRelays.set('node1', {
        endpoints: ['wss://relay1.com'],
        capabilities: {},
        lastSeen: Date.now(),
      });
      participant.knownRelays.set('node2', {
        endpoints: ['wss://relay2.com'],
        capabilities: { webrtc: true },
        lastSeen: Date.now(),
      });
      
      expect(participant.knownRelays.size).toBe(2);
      expect(participant.knownRelays.has('node1')).toBe(true);
      expect(participant.knownRelays.has('node2')).toBe(true);
    });

    test('relay entries include expected fields', async () => {
      const participant = new MeshParticipant();
      
      participant.knownRelays.set('test-node-id', {
        endpoints: ['wss://relay.com'],
        lastSeen: Date.now(),
      });
      
      const relay = participant.knownRelays.get('test-node-id');
      expect(relay.endpoints).toEqual(['wss://relay.com']);
      expect(relay.lastSeen).toBeDefined();
    });
  });

  describe('Statistics', () => {
    test('ourWorkspaces tracks joined workspaces', async () => {
      const participant = new MeshParticipant();
      await participant.start();
      
      // Add some relays
      participant.knownRelays.set('node1', { endpoints: [], lastSeen: Date.now() });
      
      // Join some workspaces
      await participant.joinWorkspace('workspace1');
      await participant.joinWorkspace('workspace2');
      
      expect(participant.knownRelays.size).toBe(1);
      expect(participant.ourWorkspaces.size).toBe(2);
      expect(participant.meshConnections.size).toBe(0);
      
      await participant.stop();
    });
  });
});
