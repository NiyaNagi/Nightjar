/**
 * SearchIndexCache – background document-content index for cross-app search.
 *
 * Works in two modes:
 *  • Electron (sidecar): sends `index-documents` via metaSocket, receives `index-results`.
 *  • Web (IndexedDB):    loads doc content from y-indexeddb temp providers.
 *
 * The cache stores `Map<docId, { text, type, updatedAt }>` in memory.
 * `search(query)` scans the cache with fuzzyMatch and returns ranked results.
 */
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { extractDocumentText } from '../utils/yjsTextExtraction';
import { fuzzyMatch } from '../utils/fuzzyMatch';

/** @type {Map<string, { text: string, type: string, updatedAt: number }>} */
const cache = new Map();

let _indexing = false;
let _debounceTimer = null;

/**
 * Build or refresh the index.
 *
 * @param {object} opts
 * @param {boolean}              opts.isElectronMode
 * @param {{ current: WebSocket|null }} opts.metaSocketRef – sidecar socket (Electron)
 * @param {Array<{ id: string, name: string, type: string }>} opts.documents – from workspace
 * @param {Map}                  opts.ydocsRef – ydocsRef.current (already-open Y.Docs)
 * @param {number}               [opts.debounceMs=500]
 * @returns {Promise<void>}
 */
export function buildIndex(opts) {
    const { debounceMs = 500 } = opts;

    if (_debounceTimer) clearTimeout(_debounceTimer);

    return new Promise((resolve) => {
        _debounceTimer = setTimeout(async () => {
            if (_indexing) { resolve(); return; }
            _indexing = true;
            try {
                if (opts.isElectronMode) {
                    await _buildElectronIndex(opts);
                } else {
                    await _buildWebIndex(opts);
                }
            } catch (e) {
                console.warn('[SearchIndex] build error:', e);
            } finally {
                _indexing = false;
                resolve();
            }
        }, debounceMs);
    });
}

/**
 * Handle `index-results` message from sidecar.
 * Called from AppNew's metaSocket onmessage handler.
 *
 * @param {{ results: Array<{ docId: string, text: string, type: string }> }} data
 */
export function handleIndexResults(data) {
    if (!data?.results) return;
    const now = Date.now();
    for (const r of data.results) {
        cache.set(r.docId, { text: r.text || '', type: r.type, updatedAt: now });
    }
    // Resolve any pending index promise and cancel safety timeout
    if (_safetyTimeout) { clearTimeout(_safetyTimeout); _safetyTimeout = null; }
    if (_indexResolve) { _indexResolve(); _indexResolve = null; }
}

let _indexResolve = null;
let _safetyTimeout = null;

// ── Electron path: ask sidecar to load & extract ──────────────────────
async function _buildElectronIndex(opts) {
    const { metaSocketRef, documents } = opts;
    const ws = metaSocketRef?.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // Index any already-open docs first (immediate)
    const ydocs = opts.ydocsRef?.current;
    if (ydocs) {
        for (const [docId, entry] of ydocs.entries()) {
            if (!entry?.ydoc) continue;
            try {
                const text = extractDocumentText(entry.ydoc, entry.type);
                if (text) {
                    cache.set(docId, { text, type: entry.type, updatedAt: Date.now() });
                }
            } catch (e) { /* skip */ }
        }
    }

    // Ask sidecar to index all closed docs
    const closedDocIds = (documents || [])
        .filter(d => !ydocs?.has(d.id) && !cache.has(d.id))
        .map(d => ({ id: d.id, type: d.type }));

    if (closedDocIds.length === 0) return;

    return new Promise((resolve) => {
        _indexResolve = resolve;
        ws.send(JSON.stringify({ type: 'index-documents', documents: closedDocIds }));
        // Safety timeout — don't wait forever
        _safetyTimeout = setTimeout(() => { _safetyTimeout = null; if (_indexResolve) { _indexResolve(); _indexResolve = null; } }, 10000);
    });
}

// ── Web path: load from y-indexeddb ───────────────────────────────────
async function _buildWebIndex(opts) {
    const { documents, ydocsRef } = opts;
    const ydocs = ydocsRef?.current;

    // Index already-open docs first
    if (ydocs) {
        for (const [docId, entry] of ydocs.entries()) {
            if (!entry?.ydoc) continue;
            try {
                const text = extractDocumentText(entry.ydoc, entry.type);
                if (text) {
                    cache.set(docId, { text, type: entry.type, updatedAt: Date.now() });
                }
            } catch (e) { /* skip */ }
        }
    }

    // Load closed docs from IndexedDB
    const closedDocs = (documents || []).filter(d => !ydocs?.has(d.id) && !cache.has(d.id));
    const BATCH = 5; // process in small batches to avoid locking UI

    for (let i = 0; i < closedDocs.length; i += BATCH) {
        const batch = closedDocs.slice(i, i + BATCH);
        await Promise.all(batch.map(async (doc) => {
            let ydoc;
            let idbProvider;
            try {
                ydoc = new Y.Doc();
                const dbName = `nahma-doc-${doc.id}`;
                idbProvider = new IndexeddbPersistence(dbName, ydoc);
                await idbProvider.whenSynced;
                const text = extractDocumentText(ydoc, doc.type);
                if (text) {
                    cache.set(doc.id, { text, type: doc.type, updatedAt: Date.now() });
                }
            } catch (e) {
                console.warn(`[SearchIndex] web index error for ${doc.id}:`, e);
            } finally {
                if (ydoc) ydoc.destroy();
                if (idbProvider) await idbProvider.destroy();
            }
        }));
        // Yield to UI between batches
        await new Promise(r => setTimeout(r, 0));
    }
}

/**
 * Search the index with fuzzy matching.
 *
 * @param {string} query
 * @param {number} [limit=50]
 * @returns {Array<{ docId: string, type: string, score: number, matchedIndices: number[], snippet: string }>}
 */
export function search(query, limit = 50) {
    if (!query || query.length < 1) return [];

    const results = [];

    for (const [docId, entry] of cache.entries()) {
        const m = fuzzyMatch(query, entry.text);
        if (!m) continue;

        // Build a snippet around the first match
        const snippet = _buildSnippet(entry.text, m.matchedIndices, 60);

        results.push({
            docId,
            type: entry.type,
            score: m.score,
            matchedIndices: m.matchedIndices,
            snippet,
        });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
}

/**
 * Invalidate a specific document (e.g. on edit).
 */
export function invalidate(docId) {
    cache.delete(docId);
}

/**
 * Clear the entire cache.
 */
export function clearCache() {
    cache.clear();
}

/**
 * Expose cache size for testing / debugging.
 */
export function cacheSize() {
    return cache.size;
}

// ── Helpers ───────────────────────────────────────────────────────────

function _buildSnippet(text, matchedIndices, contextChars) {
    if (!matchedIndices || matchedIndices.length === 0) return text.slice(0, contextChars * 2);

    const first = matchedIndices[0];
    const start = Math.max(0, first - contextChars);
    const end = Math.min(text.length, first + contextChars);
    let snippet = text.slice(start, end).replace(/\n+/g, ' ');
    if (start > 0) snippet = '…' + snippet;
    if (end < text.length) snippet = snippet + '…';
    return snippet;
}
