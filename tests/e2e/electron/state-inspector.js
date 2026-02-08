/**
 * State Inspector for E2E Testing
 * 
 * Provides deep inspection of application state across multiple clients:
 * - Y.js document state capture
 * - Sync event tracking
 * - Peer discovery verification
 * - Console log analysis
 */
const crypto = require('crypto');

/**
 * Categorize a log message by component
 */
function categorizeLog(text) {
  if (!text) return 'unknown';
  
  const patterns = {
    p2p: /\[P2P|hyperswarm|DHT|peer-joined|peer-left|swarm/i,
    sync: /\[Sync|sync-message|sync-state|yjs|Y\.Doc|update/i,
    relay: /\[Relay|relay-bridge|websocket|ws\:/i,
    identity: /\[Identity|identity|keypair|signature/i,
    workspace: /\[Workspace|workspace|create-workspace|join-workspace/i,
    document: /\[Document|document|doc-|editor/i,
    chat: /\[Chat|chat-message|message/i,
    error: /error|exception|failed|crash/i,
    mesh: /\[Mesh|mesh-|mesh\:/i,
  };
  
  for (const [category, pattern] of Object.entries(patterns)) {
    if (pattern.test(text)) return category;
  }
  return 'other';
}

/**
 * State snapshot for a client
 */
class ClientStateSnapshot {
  constructor(clientName) {
    this.clientName = clientName;
    this.timestamp = Date.now();
    this.workspaces = [];
    this.documents = [];
    this.chatMessages = [];
    this.peers = [];
    this.syncStatus = null;
    this.logs = [];
  }
  
  toJSON() {
    return {
      clientName: this.clientName,
      timestamp: this.timestamp,
      workspaces: this.workspaces,
      documents: this.documents,
      chatMessages: this.chatMessages,
      peers: this.peers,
      syncStatus: this.syncStatus,
      logCounts: {
        total: this.logs.length,
        errors: this.logs.filter(l => l.type === 'error' || l.category === 'error').length,
        sync: this.logs.filter(l => l.category === 'sync').length,
        p2p: this.logs.filter(l => l.category === 'p2p').length,
      },
    };
  }
}

/**
 * State Inspector - captures and compares state across clients
 */
class StateInspector {
  constructor() {
    this.clients = new Map(); // clientName -> { instance, snapshots: [] }
    this.timeline = []; // All events across all clients, chronologically
  }
  
  /**
   * Register a client for state tracking
   */
  registerClient(name, instance) {
    this.clients.set(name, {
      instance,
      snapshots: [],
      baselineLogIndex: 0,
    });
    console.log(`[StateInspector] Registered client: ${name}`);
  }
  
  /**
   * Capture current state of all registered clients
   */
  async captureAll() {
    const snapshots = {};
    for (const [name, client] of this.clients) {
      snapshots[name] = await this.capture(name);
    }
    return snapshots;
  }
  
  /**
   * Capture state from a single client
   */
  async capture(clientName) {
    const client = this.clients.get(clientName);
    if (!client) throw new Error(`Client not registered: ${clientName}`);
    
    const snapshot = new ClientStateSnapshot(clientName);
    const { instance } = client;
    
    // Capture logs since last capture
    const logs = instance.getLogs ? instance.getLogs() : [];
    const newLogs = logs.slice(client.baselineLogIndex);
    client.baselineLogIndex = logs.length;
    
    snapshot.logs = newLogs.map(log => ({
      ...log,
      category: categorizeLog(log.text),
    }));
    
    // Add to timeline
    for (const log of snapshot.logs) {
      this.timeline.push({
        client: clientName,
        ...log,
      });
    }
    
    // Capture DOM state via page evaluation
    if (instance.window) {
      try {
        const state = await instance.window.evaluate(() => {
          // Try to access exposed test state
          if (window.__nightjarTestState) {
            return window.__nightjarTestState;
          }
          
          // Fallback: scrape from DOM
          const result = {
            workspaces: [],
            documents: [],
            chatMessages: [],
            syncStatus: null,
          };
          
          // Check sync status indicator
          const syncIndicator = document.querySelector('[data-testid="sync-status"]');
          if (syncIndicator) {
            result.syncStatus = syncIndicator.getAttribute('data-status') || syncIndicator.textContent;
          }
          
          // Get document list from sidebar
          const docItems = document.querySelectorAll('[data-testid="document-item"], .sidebar-item.document');
          result.documents = Array.from(docItems).map(el => ({
            id: el.getAttribute('data-doc-id') || el.id,
            name: el.textContent?.trim(),
          }));
          
          // Get workspace info
          const wsName = document.querySelector('.workspace-switcher__name, [data-testid="workspace-name"]');
          if (wsName) {
            result.workspaces.push({ name: wsName.textContent?.trim() });
          }
          
          return result;
        });
        
        snapshot.workspaces = state.workspaces || [];
        snapshot.documents = state.documents || [];
        snapshot.chatMessages = state.chatMessages || [];
        snapshot.syncStatus = state.syncStatus;
      } catch (e) {
        console.warn(`[StateInspector] Failed to capture DOM state for ${clientName}:`, e.message);
      }
    }
    
    // Store snapshot
    client.snapshots.push(snapshot);
    
    return snapshot;
  }
  
  /**
   * Compare state between two clients
   */
  compare(client1Name, client2Name) {
    const client1 = this.clients.get(client1Name);
    const client2 = this.clients.get(client2Name);
    
    if (!client1 || !client2) {
      throw new Error(`Client not found: ${!client1 ? client1Name : client2Name}`);
    }
    
    const snap1 = client1.snapshots[client1.snapshots.length - 1];
    const snap2 = client2.snapshots[client2.snapshots.length - 1];
    
    if (!snap1 || !snap2) {
      throw new Error('No snapshots captured for comparison');
    }
    
    const result = {
      match: true,
      differences: [],
      client1: snap1.toJSON(),
      client2: snap2.toJSON(),
    };
    
    // Compare document counts
    if (snap1.documents.length !== snap2.documents.length) {
      result.match = false;
      result.differences.push({
        field: 'documentCount',
        client1: snap1.documents.length,
        client2: snap2.documents.length,
      });
    }
    
    // Compare document IDs
    const ids1 = new Set(snap1.documents.map(d => d.id).filter(Boolean));
    const ids2 = new Set(snap2.documents.map(d => d.id).filter(Boolean));
    
    for (const id of ids1) {
      if (!ids2.has(id)) {
        result.match = false;
        result.differences.push({
          field: 'document',
          issue: `Document ${id} exists in ${client1Name} but not ${client2Name}`,
        });
      }
    }
    
    for (const id of ids2) {
      if (!ids1.has(id)) {
        result.match = false;
        result.differences.push({
          field: 'document',
          issue: `Document ${id} exists in ${client2Name} but not ${client1Name}`,
        });
      }
    }
    
    // Compare chat message counts
    if (snap1.chatMessages.length !== snap2.chatMessages.length) {
      result.match = false;
      result.differences.push({
        field: 'chatMessageCount',
        client1: snap1.chatMessages.length,
        client2: snap2.chatMessages.length,
      });
    }
    
    return result;
  }
  
  /**
   * Wait for state to converge between all clients
   */
  async waitForConvergence(options = {}) {
    const { timeout = 30000, checkInterval = 500, field = 'documents' } = options;
    const clientNames = Array.from(this.clients.keys());
    
    if (clientNames.length < 2) {
      throw new Error('Need at least 2 clients for convergence check');
    }
    
    console.log(`[StateInspector] Waiting for ${field} convergence across ${clientNames.length} clients...`);
    
    const start = Date.now();
    while (Date.now() - start < timeout) {
      await this.captureAll();
      
      // Check if all clients have same state
      const firstClient = this.clients.get(clientNames[0]);
      const firstSnap = firstClient.snapshots[firstClient.snapshots.length - 1];
      
      let allMatch = true;
      for (let i = 1; i < clientNames.length; i++) {
        const comparison = this.compare(clientNames[0], clientNames[i]);
        if (!comparison.match) {
          allMatch = false;
          break;
        }
      }
      
      if (allMatch && firstSnap[field]?.length > 0) {
        console.log(`[StateInspector] Convergence achieved in ${Date.now() - start}ms`);
        return true;
      }
      
      await new Promise(r => setTimeout(r, checkInterval));
    }
    
    // Generate detailed diff report on failure
    const report = this.generateDiffReport();
    throw new Error(`Convergence timeout after ${timeout}ms. Differences:\n${report}`);
  }
  
  /**
   * Generate a detailed diff report
   */
  generateDiffReport() {
    const lines = ['=== STATE DIFF REPORT ==='];
    
    for (const [name, client] of this.clients) {
      const snap = client.snapshots[client.snapshots.length - 1];
      if (!snap) continue;
      
      lines.push(`\n--- ${name} ---`);
      lines.push(`  Workspaces: ${snap.workspaces.length}`);
      lines.push(`  Documents: ${snap.documents.length}`);
      lines.push(`  Chat Messages: ${snap.chatMessages.length}`);
      lines.push(`  Sync Status: ${snap.syncStatus}`);
      lines.push(`  Log Errors: ${snap.logs.filter(l => l.category === 'error').length}`);
      
      if (snap.documents.length > 0) {
        lines.push(`  Document IDs: ${snap.documents.map(d => d.id || d.name).join(', ')}`);
      }
    }
    
    lines.push('\n=== RECENT ERRORS ===');
    const errors = this.timeline.filter(e => e.category === 'error').slice(-10);
    for (const err of errors) {
      lines.push(`  [${err.client}] ${err.text?.substring(0, 100)}`);
    }
    
    return lines.join('\n');
  }
  
  /**
   * Get timeline of sync events
   */
  getSyncTimeline() {
    return this.timeline.filter(e => 
      e.category === 'sync' || e.category === 'p2p' || e.category === 'mesh'
    );
  }
  
  /**
   * Verify expected events occurred
   */
  verifyEvents(expectations) {
    const results = [];
    
    for (const exp of expectations) {
      const found = this.timeline.some(e => {
        if (exp.client && e.client !== exp.client) return false;
        if (exp.category && e.category !== exp.category) return false;
        if (exp.pattern && !exp.pattern.test(e.text)) return false;
        if (exp.text && !e.text.includes(exp.text)) return false;
        return true;
      });
      
      results.push({
        expectation: exp,
        found,
      });
    }
    
    return results;
  }
  
  /**
   * Clear all captured state
   */
  clear() {
    for (const client of this.clients.values()) {
      client.snapshots = [];
      client.baselineLogIndex = 0;
    }
    this.timeline = [];
  }
  
  /**
   * Export full state for debugging
   */
  exportState() {
    const output = {
      timestamp: new Date().toISOString(),
      clients: {},
      timeline: this.timeline,
    };
    
    for (const [name, client] of this.clients) {
      output.clients[name] = {
        snapshotCount: client.snapshots.length,
        latestSnapshot: client.snapshots[client.snapshots.length - 1]?.toJSON(),
      };
    }
    
    return output;
  }
}

/**
 * Inject test state hooks into a page
 * Call this after page loads to expose internal state
 */
async function injectStateHooks(page) {
  await page.evaluate(() => {
    // Create test state container
    window.__nightjarTestState = {
      workspaces: [],
      documents: [],
      chatMessages: [],
      syncEvents: [],
      peers: [],
      lastSyncTime: null,
    };
    
    // Hook into any existing Yjs providers
    // This is a placeholder - actual implementation depends on how app exposes state
    console.log('[StateHooks] Test state hooks injected');
  });
}

module.exports = {
  StateInspector,
  ClientStateSnapshot,
  injectStateHooks,
  categorizeLog,
};
