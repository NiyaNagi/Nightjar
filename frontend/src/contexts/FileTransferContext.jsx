/**
 * FileTransferContext
 * 
 * Workspace-level React context that owns all P2P chunk transfer logic.
 * This must remain mounted whenever a workspace is open, regardless of
 * which view the user is on, so that:
 *   1. Incoming chunk-request messages are always served
 *   2. Incoming chunk-response messages always resolve pending promises
 *   3. Incoming chunk-seed messages are always stored
 *   4. The seeding loop keeps running to maintain replication targets
 *   5. Bandwidth sampling is continuous for accurate history
 *
 * Previously this logic lived inside useFileTransfer / useChunkSeeding hooks
 * that were scoped to the FileStorageDashboard component, causing handlers
 * to unregister when the user navigated away from the Files view.
 *
 * See docs/FILE_STORAGE_SPEC.md §8
 */

import { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { getPeerManager } from '../services/p2p/index.js';

// ── Yjs observation helpers ────────────────────────────────────────────

/**
 * Observe a Yjs Map and return its entries as a plain JS object.
 */
function useYjsMap(yMap) {
  const [data, setData] = useState({});
  useEffect(() => {
    if (!yMap) { setData({}); return; }
    const sync = () => {
      const result = {};
      yMap.forEach((value, key) => { result[key] = value; });
      setData(result);
    };
    sync();
    yMap.observe(sync);
    return () => yMap.unobserve(sync);
  }, [yMap]);
  return data;
}

/**
 * Observe a Yjs Array and return its entries as a plain JS array.
 */
function useYjsArray(yArray) {
  const [data, setData] = useState([]);
  useEffect(() => {
    if (!yArray) { setData([]); return; }
    const sync = () => setData(yArray.toArray());
    sync();
    yArray.observe(sync);
    return () => yArray.unobserve(sync);
  }, [yArray]);
  return data;
}

// ── Constants ──────────────────────────────────────────────────────────

/** Max time to wait for a peer chunk response (ms) */
const CHUNK_REQUEST_TIMEOUT = 15000;

/** Max retries per chunk */
const MAX_CHUNK_RETRIES = 3;

/** Message types for chunk transfer protocol */
export const CHUNK_MSG_TYPES = {
  REQUEST: 'chunk-request',
  RESPONSE: 'chunk-response',
  SEED: 'chunk-seed',
};

/** Max concurrent chunk seed operations */
const MAX_CONCURRENT_SEEDS = 3;

/** Ring buffer size for bandwidth samples (24h at 30s intervals) */
const BANDWIDTH_BUFFER_SIZE = 2880;

/** Bandwidth sample interval (ms) */
const BANDWIDTH_SAMPLE_INTERVAL = 30000;

/** Seed interval — how often the seeding loop runs (ms) */
const SEED_INTERVAL_MS = 60000;

/** Delay before first seed cycle after mount (ms) */
const INITIAL_SEED_DELAY_MS = 5000;

// ── IndexedDB helpers ──────────────────────────────────────────────────

function openChunkStore(workspaceId) {
  return new Promise((resolve, reject) => {
    const dbName = `nightjar-chunks-${workspaceId}`;
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('chunks')) {
        db.createObjectStore('chunks');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getLocalChunk(db, fileId, chunkIndex) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('chunks', 'readonly');
    const store = tx.objectStore('chunks');
    const key = `${fileId}:${chunkIndex}`;
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

function storeLocalChunk(db, fileId, chunkIndex, chunkData) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('chunks', 'readwrite');
    const store = tx.objectStore('chunks');
    const key = `${fileId}:${chunkIndex}`;
    store.put({ ...chunkData, fileId, chunkIndex }, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Wire encoding helpers ──────────────────────────────────────────────

function uint8ToBase64(uint8) {
  if (!uint8 || uint8.length === 0) return '';
  const chunkSize = 32768;
  let binary = '';
  for (let i = 0; i < uint8.length; i += chunkSize) {
    const slice = uint8.subarray(i, Math.min(i + chunkSize, uint8.length));
    binary += String.fromCharCode.apply(null, slice);
  }
  return btoa(binary);
}

function base64ToUint8(base64) {
  if (!base64) return new Uint8Array(0);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ── Context ────────────────────────────────────────────────────────────

const FileTransferContext = createContext(null);

/**
 * Hook to access file transfer capabilities from any component.
 * Must be used within a FileTransferProvider.
 */
export function useFileTransferContext() {
  const ctx = useContext(FileTransferContext);
  if (!ctx) {
    throw new Error('useFileTransferContext must be used within a FileTransferProvider');
  }
  return ctx;
}

/**
 * FileTransferProvider — mount at workspace level so P2P file transfer
 * stays alive across view switches.
 *
 * Accepts raw Yjs shared types and derives reactive state internally
 * (same observation pattern as useFileStorageSync) so it's independent
 * of the FileStorageContext / FileStorageDashboard component tree.
 *
 * @param {object} props
 * @param {string} props.workspaceId
 * @param {string} props.userPublicKey
 * @param {import('yjs').Map|null} props.yChunkAvailability - Yjs Map for chunk availability
 * @param {import('yjs').Array|null} props.yStorageFiles - Yjs Array for storage files
 * @param {number} [props.redundancyTarget=5]
 * @param {React.ReactNode} props.children
 */
export function FileTransferProvider({
  workspaceId,
  userPublicKey,
  yChunkAvailability,
  yStorageFiles,
  redundancyTarget = 5,
  children,
}) {
  // Observe Yjs types into reactive state
  const chunkAvailability = useYjsMap(yChunkAvailability);
  const allFiles = useYjsArray(yStorageFiles);
  const activeFiles = useMemo(() => allFiles.filter(f => !f.deletedAt), [allFiles]);

  // setChunkAvailability writes back to the Yjs Map, merging new holders with existing ones
  const setChunkAvailability = useCallback((fileId, chunkIndex, holders) => {
    if (!yChunkAvailability) return;
    const key = `${fileId}:${chunkIndex}`;
    const existing = yChunkAvailability.get(key);
    const existingHolders = (existing && Array.isArray(existing.holders)) ? existing.holders : [];
    const mergedHolders = [...new Set([...existingHolders, ...holders])];
    yChunkAvailability.set(key, {
      fileId,
      chunkIndex,
      holders: mergedHolders,
      lastUpdated: Date.now(),
    });
  }, [yChunkAvailability]);
  // ── Refs that survive the entire provider lifetime ──
  const dbRef = useRef(null);
  const pendingRequests = useRef(new Map());
  const seedingRef = useRef(false);
  const seedIntervalRef = useRef(null);
  const bandwidthIntervalRef = useRef(null);
  const bytesThisInterval = useRef({ sent: 0, received: 0 });
  const handlersRegistered = useRef(false);
  const peerManagerListenerCleanup = useRef(null);

  // Stable refs for latest values so callbacks never go stale
  const chunkAvailabilityRef = useRef(chunkAvailability);
  chunkAvailabilityRef.current = chunkAvailability;
  const activeFilesRef = useRef(activeFiles);
  activeFilesRef.current = activeFiles;
  const setChunkAvailabilityRef = useRef(setChunkAvailability);
  setChunkAvailabilityRef.current = setChunkAvailability;
  const userPublicKeyRef = useRef(userPublicKey);
  userPublicKeyRef.current = userPublicKey;
  const redundancyTargetRef = useRef(redundancyTarget);
  redundancyTargetRef.current = redundancyTarget;

  // ── State ──
  const [transferStats, setTransferStats] = useState({
    chunksServed: 0,
    chunksFetched: 0,
    bytesServed: 0,
    bytesFetched: 0,
  });

  const [seedingStats, setSeedingStats] = useState({
    chunksSeeded: 0,
    bytesSeeded: 0,
    seedingActive: false,
    lastSeedRun: null,
    underReplicatedCount: 0,
  });

  const [bandwidthHistory, setBandwidthHistory] = useState([]);

  // ── IndexedDB ──
  const getDb = useCallback(async () => {
    if (!dbRef.current && workspaceId) {
      dbRef.current = await openChunkStore(workspaceId);
    }
    return dbRef.current;
  }, [workspaceId]);

  // Reset DB ref when workspace changes
  useEffect(() => {
    dbRef.current = null;
  }, [workspaceId]);

  // ── Chunk serving (incoming chunk-request) ──
  const handleChunkRequest = useCallback(async (request) => {
    try {
      const db = await getDb();
      console.log(`[FileTransfer] Serving chunk request: fileId=${request.fileId}, chunk=${request.chunkIndex}`);
      const chunk = await getLocalChunk(db, request.fileId, request.chunkIndex);
      if (chunk) {
        console.log(`[FileTransfer] Chunk found, serving ${chunk.encrypted?.length || 0} bytes`);
        setTransferStats(prev => ({
          ...prev,
          chunksServed: prev.chunksServed + 1,
          bytesServed: prev.bytesServed + (chunk.encrypted?.length || 0),
        }));
        bytesThisInterval.current.sent += (chunk.encrypted?.length || 0);
        return { encrypted: chunk.encrypted, nonce: chunk.nonce };
      }
      console.warn(`[FileTransfer] Chunk not found locally: fileId=${request.fileId}, chunk=${request.chunkIndex}`);
      return null;
    } catch (err) {
      console.error('[FileTransfer] Error serving chunk:', err);
      return null;
    }
  }, [getDb]);

  // ── Register PeerManager handlers with readiness gating ──
  const registerHandlers = useCallback((peerManager) => {
    if (handlersRegistered.current) return;

    // Handle incoming chunk requests — serve from local IndexedDB
    const onRequest = async (peerId, message) => {
      const chunkData = await handleChunkRequest(message);
      if (chunkData) {
        try {
          await peerManager.send(peerId, {
            type: CHUNK_MSG_TYPES.RESPONSE,
            requestId: message.requestId,
            fileId: message.fileId,
            chunkIndex: message.chunkIndex,
            encrypted: uint8ToBase64(chunkData.encrypted),
            nonce: uint8ToBase64(chunkData.nonce),
            timestamp: Date.now(),
          });
        } catch (sendErr) {
          console.warn('[FileTransfer] Failed to send chunk response:', sendErr);
        }
      }
    };

    // Handle incoming chunk responses — resolve pending request promises
    const onResponse = (_peerId, message) => {
      const pending = pendingRequests.current.get(message.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        pendingRequests.current.delete(message.requestId);
        pending.resolve({
          encrypted: base64ToUint8(message.encrypted),
          nonce: base64ToUint8(message.nonce),
        });
      }
    };

    // Handle incoming seeded chunks — store in local IndexedDB
    const onSeed = async (_peerId, message) => {
      try {
        const db = await getDb();
        const chunkData = {
          encrypted: base64ToUint8(message.encrypted),
          nonce: base64ToUint8(message.nonce),
        };
        await storeLocalChunk(db, message.fileId, message.chunkIndex, chunkData);

        const setCA = setChunkAvailabilityRef.current;
        const pubKey = userPublicKeyRef.current;
        if (setCA && pubKey) {
          setCA(message.fileId, message.chunkIndex, [pubKey]);
        }

        setTransferStats(prev => ({
          ...prev,
          chunksFetched: prev.chunksFetched + 1,
          bytesFetched: prev.bytesFetched + (chunkData.encrypted?.length || 0),
        }));
        bytesThisInterval.current.received += (chunkData.encrypted?.length || 0);
      } catch (err) {
        console.warn('[FileTransfer] Failed to store seeded chunk:', err);
      }
    };

    peerManager.registerHandler(CHUNK_MSG_TYPES.REQUEST, onRequest);
    peerManager.registerHandler(CHUNK_MSG_TYPES.RESPONSE, onResponse);
    peerManager.registerHandler(CHUNK_MSG_TYPES.SEED, onSeed);
    handlersRegistered.current = true;
    console.log('[FileTransfer] Handlers registered at workspace level');

    // Return cleanup function
    return () => {
      peerManager.unregisterHandler(CHUNK_MSG_TYPES.REQUEST);
      peerManager.unregisterHandler(CHUNK_MSG_TYPES.RESPONSE);
      peerManager.unregisterHandler(CHUNK_MSG_TYPES.SEED);
      handlersRegistered.current = false;
      console.log('[FileTransfer] Handlers unregistered (workspace closed)');
    };
  }, [handleChunkRequest, getDb]);

  // ── PeerManager initialization & readiness gating ──
  // PeerManager must be initialized and joined to the workspace topic
  // BEFORE chunk requests can work. Without this, getConnectedPeers()
  // returns [] because HyperswarmTransport never connects to the sidecar.
  useEffect(() => {
    if (!workspaceId) return;

    let cleanup = null;
    let cancelled = false;

    const initAndRegister = async () => {
      // Get or create the singleton PeerManager
      let peerManager;
      try {
        peerManager = getPeerManager();
      } catch {
        console.warn('[FileTransfer] PeerManager not available');
        return;
      }
      if (!peerManager) return;

      // Initialize PeerManager if not already done.
      // This connects HyperswarmTransport to the sidecar WebSocket,
      // which is required for peer-connected events to flow.
      if (!peerManager.isInitialized) {
        const identity = {
          displayName: userPublicKeyRef.current?.slice(0, 8) || 'Anonymous',
          peerId: userPublicKeyRef.current,
        };
        console.log('[FileTransfer] Initializing PeerManager for chunk transfer...');
        try {
          await peerManager.initialize(identity);
        } catch (err) {
          console.error('[FileTransfer] PeerManager initialization failed:', err);
          return;
        }
        if (cancelled) return;
      }

      // Join the workspace so BootstrapManager discovers peers on this topic.
      // This sends p2p-join-topic to the sidecar via HyperswarmTransport,
      // causing Hyperswarm peer-joined events to flow back as p2p-peer-connected.
      if (peerManager.currentWorkspaceId !== workspaceId) {
        console.log('[FileTransfer] Joining workspace for chunk transfer:', workspaceId.slice(0, 8));
        try {
          await peerManager.joinWorkspace(workspaceId);
        } catch (err) {
          console.warn('[FileTransfer] joinWorkspace failed (non-fatal):', err.message);
          // Non-fatal — we may still get peers via other transports
        }
        if (cancelled) return;
      }

      // Register chunk message handlers
      if (!handlersRegistered.current) {
        cleanup = registerHandlers(peerManager);
      }
    };

    initAndRegister();

    return () => {
      cancelled = true;
      if (cleanup) cleanup();
      if (peerManagerListenerCleanup.current) {
        peerManagerListenerCleanup.current();
        peerManagerListenerCleanup.current = null;
      }
      handlersRegistered.current = false;
    };
  }, [workspaceId, registerHandlers]);

  // ── Request a chunk from peers ──
  const requestChunkFromPeer = useCallback(async (fileId, chunkIndex, holders = []) => {
    // 1. Check local first
    try {
      const db = await getDb();
      const localChunk = await getLocalChunk(db, fileId, chunkIndex);
      if (localChunk) {
        console.log(`[FileTransfer] Chunk ${chunkIndex} for ${fileId} found locally`);
        return localChunk;
      }
    } catch (err) {
      console.warn('[FileTransfer] Local chunk check failed:', err);
    }

    // 2. Request from peers via PeerManager
    let peerManager;
    try {
      peerManager = getPeerManager();
    } catch {
      console.warn(`[FileTransfer] PeerManager not available, cannot request chunk ${chunkIndex} for ${fileId}`);
      return null;
    }
    if (!peerManager) {
      console.warn(`[FileTransfer] PeerManager is null, cannot request chunk ${chunkIndex} for ${fileId}`);
      return null;
    }

    const connectedPeers = peerManager.getConnectedPeers?.() || [];
    console.log(`[FileTransfer] Requesting chunk ${chunkIndex} for ${fileId}. Connected peers: ${connectedPeers.length}, holders: ${holders.length}`);
    
    if (connectedPeers.length === 0 && holders.length === 0) {
      console.warn(`[FileTransfer] No peers available to request chunk ${chunkIndex} for ${fileId}`);
      return null;
    }

    // Prefer holders that are connected, then fall back to any connected peer
    const targetPeers = holders.length > 0
      ? [...new Set([...holders.filter(h => connectedPeers.includes(h)), ...connectedPeers])]
      : connectedPeers;

    for (let attempt = 0; attempt < MAX_CHUNK_RETRIES; attempt++) {
      const requestId = generateRequestId();
      const targetPeer = targetPeers[attempt % targetPeers.length];
      if (!targetPeer) break;

      const chunkPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingRequests.current.delete(requestId);
          reject(new Error(`Chunk request timeout: ${fileId}:${chunkIndex} (attempt ${attempt + 1})`));
        }, CHUNK_REQUEST_TIMEOUT);
        pendingRequests.current.set(requestId, { resolve, reject, timer });
      });

      try {
        await peerManager.send(targetPeer, {
          type: CHUNK_MSG_TYPES.REQUEST,
          requestId,
          fileId,
          chunkIndex,
          timestamp: Date.now(),
        });
      } catch (sendErr) {
        pendingRequests.current.delete(requestId);
        console.warn(`[FileTransfer] Failed to send chunk request to ${targetPeer}:`, sendErr);
        continue;
      }

      try {
        const chunkData = await chunkPromise;

        // Store chunk locally
        try {
          const db = await getDb();
          await storeLocalChunk(db, fileId, chunkIndex, chunkData);
        } catch (storeErr) {
          console.warn('[FileTransfer] Failed to cache received chunk:', storeErr);
        }

        setTransferStats(prev => ({
          ...prev,
          chunksFetched: prev.chunksFetched + 1,
          bytesFetched: prev.bytesFetched + (chunkData.encrypted?.length || 0),
        }));
        bytesThisInterval.current.received += (chunkData.encrypted?.length || 0);

        return chunkData;
      } catch (err) {
        if (attempt < MAX_CHUNK_RETRIES - 1) {
          console.warn(`[FileTransfer] Retry ${attempt + 1}/${MAX_CHUNK_RETRIES} for chunk ${chunkIndex}:`, err.message);
        } else {
          console.error(`[FileTransfer] All retries exhausted for chunk ${chunkIndex} of ${fileId}`);
        }
      }
    }

    return null;
  }, [getDb]);

  // ── Announce chunk availability ──
  const announceAvailability = useCallback(async (fileId, chunkCount) => {
    const setCA = setChunkAvailabilityRef.current;
    const pubKey = userPublicKeyRef.current;
    if (!setCA || !pubKey) return;

    const db = await getDb();
    for (let i = 0; i < chunkCount; i++) {
      const chunk = await getLocalChunk(db, fileId, i);
      if (chunk) {
        setCA(fileId, i, [pubKey]);
      }
    }
  }, [getDb]);

  // ── Local chunk count ──
  const getLocalChunkCount = useCallback(async (fileId, chunkCount) => {
    const db = await getDb();
    let count = 0;
    for (let i = 0; i < chunkCount; i++) {
      const chunk = await getLocalChunk(db, fileId, i);
      if (chunk) count++;
    }
    return count;
  }, [getDb]);

  // ── Seeding logic ──

  const findUnderReplicatedChunks = useCallback(() => {
    const ca = chunkAvailabilityRef.current;
    const files = activeFilesRef.current;
    const pubKey = userPublicKeyRef.current;
    const target = redundancyTargetRef.current;

    if (!ca || !files) return [];

    let peerManager;
    try {
      peerManager = getPeerManager();
    } catch {
      return [];
    }

    const connectedPeers = peerManager?.getConnectedPeers?.() || [];
    const effectiveTarget = Math.min(target, connectedPeers.length + 1);
    if (effectiveTarget <= 1) return [];

    const underReplicated = [];

    for (const file of files) {
      const fileId = file.id;
      const chunkCount = file.chunkCount || 0;

      for (let i = 0; i < chunkCount; i++) {
        const key = `${fileId}:${i}`;
        const entry = ca[key];
        const holders = (entry && Array.isArray(entry.holders))
          ? entry.holders
          : (Array.isArray(entry) ? entry : []);
        const replication = holders.length;

        if (replication < effectiveTarget && holders.includes(pubKey)) {
          const peersWithout = connectedPeers.filter(p => !holders.includes(p));
          if (peersWithout.length > 0) {
            underReplicated.push({ fileId, chunkIndex: i, holders, replication, targetPeers: peersWithout });
          }
        }
      }
    }

    underReplicated.sort((a, b) => a.replication - b.replication);
    return underReplicated;
  }, []);

  const seedChunkToPeer = useCallback(async (fileId, chunkIndex, targetPeer) => {
    let peerManager;
    try {
      peerManager = getPeerManager();
    } catch {
      return false;
    }

    try {
      const db = await getDb();
      const chunk = await getLocalChunk(db, fileId, chunkIndex);
      if (!chunk) {
        console.warn(`[ChunkSeeding] Local chunk ${fileId}:${chunkIndex} not found`);
        return false;
      }

      const encrypted = uint8ToBase64(chunk.encrypted);
      const nonce = uint8ToBase64(chunk.nonce);
      const bytesSent = encrypted.length + nonce.length;

      await peerManager.send(targetPeer, {
        type: CHUNK_MSG_TYPES.SEED,
        fileId,
        chunkIndex,
        encrypted,
        nonce,
        timestamp: Date.now(),
      });

      bytesThisInterval.current.sent += bytesSent;

      setSeedingStats(prev => ({
        ...prev,
        chunksSeeded: prev.chunksSeeded + 1,
        bytesSeeded: prev.bytesSeeded + bytesSent,
      }));

      return true;
    } catch (err) {
      console.warn(`[ChunkSeeding] Failed to seed chunk ${fileId}:${chunkIndex} to ${targetPeer}:`, err);
      return false;
    }
  }, [getDb]);

  const runSeedCycle = useCallback(async () => {
    if (seedingRef.current) return;
    seedingRef.current = true;

    setSeedingStats(prev => ({ ...prev, seedingActive: true }));

    try {
      const underReplicated = findUnderReplicatedChunks();
      setSeedingStats(prev => ({ ...prev, underReplicatedCount: underReplicated.length }));

      if (underReplicated.length === 0) {
        setSeedingStats(prev => ({
          ...prev,
          seedingActive: false,
          lastSeedRun: Date.now(),
        }));
        seedingRef.current = false;
        return;
      }

      for (let i = 0; i < underReplicated.length; i += MAX_CONCURRENT_SEEDS) {
        const batch = underReplicated.slice(i, i + MAX_CONCURRENT_SEEDS);
        await Promise.allSettled(
          batch.map(({ fileId, chunkIndex, targetPeers }) => {
            const targetPeer = targetPeers[Math.floor(Math.random() * targetPeers.length)];
            return seedChunkToPeer(fileId, chunkIndex, targetPeer);
          })
        );
      }
    } catch (err) {
      console.error('[ChunkSeeding] Seed cycle error:', err);
    } finally {
      seedingRef.current = false;
      setSeedingStats(prev => ({
        ...prev,
        seedingActive: false,
        lastSeedRun: Date.now(),
      }));
    }
  }, [findUnderReplicatedChunks, seedChunkToPeer]);

  // ── Seeding interval ──
  useEffect(() => {
    if (!workspaceId || !userPublicKey) return;

    const initialDelay = setTimeout(() => {
      runSeedCycle();
    }, INITIAL_SEED_DELAY_MS);

    seedIntervalRef.current = setInterval(() => {
      runSeedCycle();
    }, SEED_INTERVAL_MS);

    return () => {
      clearTimeout(initialDelay);
      if (seedIntervalRef.current) clearInterval(seedIntervalRef.current);
    };
  }, [workspaceId, userPublicKey, runSeedCycle]);

  // ── Bandwidth sampling ──
  useEffect(() => {
    bandwidthIntervalRef.current = setInterval(() => {
      const sample = {
        timestamp: Date.now(),
        bytesSent: bytesThisInterval.current.sent,
        bytesReceived: bytesThisInterval.current.received,
      };
      bytesThisInterval.current = { sent: 0, received: 0 };

      setBandwidthHistory(prev => {
        const updated = [...prev, sample];
        if (updated.length > BANDWIDTH_BUFFER_SIZE) {
          return updated.slice(-BANDWIDTH_BUFFER_SIZE);
        }
        return updated;
      });
    }, BANDWIDTH_SAMPLE_INTERVAL);

    return () => {
      if (bandwidthIntervalRef.current) clearInterval(bandwidthIntervalRef.current);
    };
  }, []);

  // ── Cleanup pending requests on unmount ──
  useEffect(() => {
    return () => {
      pendingRequests.current.forEach(({ timer }) => clearTimeout(timer));
      pendingRequests.current.clear();
    };
  }, []);

  // ── Force seed cycle (e.g. when a new peer joins) ──
  const triggerSeedCycle = useCallback(() => {
    if (!seedingRef.current) {
      setTimeout(() => runSeedCycle(), 1000);
    }
  }, [runSeedCycle]);

  // ── Track received bytes (for bandwidth tracking from external callers) ──
  const trackReceivedBytes = useCallback((bytes) => {
    bytesThisInterval.current.received += bytes;
  }, []);

  // ── Reset accumulated stats ──
  const resetStats = useCallback(() => {
    setTransferStats({
      chunksServed: 0,
      chunksFetched: 0,
      bytesServed: 0,
      bytesFetched: 0,
    });
    setSeedingStats(prev => ({
      ...prev,
      chunksSeeded: 0,
      bytesSeeded: 0,
    }));
  }, []);

  // ── Context value ──
  const value = {
    // Chunk transfer
    requestChunkFromPeer,
    announceAvailability,
    getLocalChunkCount,
    handleChunkRequest,
    // Stats
    transferStats,
    seedingStats,
    bandwidthHistory,
    resetStats,
    // Seeding control
    triggerSeedCycle,
    trackReceivedBytes,
    runSeedCycle,
  };

  return (
    <FileTransferContext.Provider value={value}>
      {children}
    </FileTransferContext.Provider>
  );
}

export default FileTransferContext;
