/**
 * IndexedDB-based Changelog Storage
 * 
 * Provides efficient, unlimited changelog storage using IndexedDB.
 * Falls back to localStorage if IndexedDB is unavailable.
 * 
 * Schema:
 * - Database: 'nightjar-changelog'
 * - Object Store: 'entries' with keyPath: 'id'
 * - Indexes: 'docId', 'timestamp', 'docId-timestamp' (compound)
 */

const DB_NAME = 'nightjar-changelog';
const DB_VERSION = 1;
const STORE_NAME = 'entries';
const SETTINGS_STORE = 'settings';

// Default: unlimited history (0 = no limit)
const DEFAULT_MAX_ENTRIES = 0;

let dbPromise = null;

/**
 * Open IndexedDB database
 */
function openDatabase() {
    if (dbPromise) return dbPromise;
    
    dbPromise = new Promise((resolve, reject) => {
        if (typeof window === 'undefined' || !window.indexedDB) {
            reject(new Error('IndexedDB not available'));
            return;
        }
        
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => {
            console.error('[ChangelogStore] Failed to open database:', request.error);
            dbPromise = null; // Allow retry
            reject(request.error);
        };
        
        request.onsuccess = () => {
            resolve(request.result);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            // Create entries store
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                store.createIndex('docId', 'docId', { unique: false });
                store.createIndex('timestamp', 'timestamp', { unique: false });
                store.createIndex('docId-timestamp', ['docId', 'timestamp'], { unique: false });
                console.log('[ChangelogStore] Created entries store');
            }
            
            // Create settings store for per-doc or global settings
            if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
                db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
                console.log('[ChangelogStore] Created settings store');
            }
        };
    });
    
    return dbPromise;
}

/**
 * Get changelog entries for a document
 * @param {string} docId - Document ID
 * @param {Object} options - Options
 * @param {number} options.limit - Max entries to return (0 = all)
 * @param {number} options.offset - Number of entries to skip
 * @param {boolean} options.newestFirst - Sort newest first (default true)
 * @returns {Promise<Array>} Changelog entries
 */
export async function getChangelog(docId, options = {}) {
    const { limit = 0, offset = 0, newestFirst = true } = options;
    
    try {
        const db = await openDatabase();
        
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const index = store.index('docId-timestamp');
            
            const entries = [];
            const range = IDBKeyRange.bound([docId, 0], [docId, Number.MAX_SAFE_INTEGER]);
            
            const request = index.openCursor(range, newestFirst ? 'prev' : 'next');
            let skipped = 0;
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (!cursor) {
                    resolve(entries);
                    return;
                }
                
                // Handle offset
                if (skipped < offset) {
                    skipped++;
                    cursor.continue();
                    return;
                }
                
                // Handle limit
                if (limit > 0 && entries.length >= limit) {
                    resolve(entries);
                    return;
                }
                
                entries.push(cursor.value);
                cursor.continue();
            };
            
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.warn('[ChangelogStore] IndexedDB failed, using localStorage:', error);
        return getChangelogFromLocalStorage(docId);
    }
}

/**
 * Add a changelog entry
 * @param {string} docId - Document ID
 * @param {Object} entry - Changelog entry
 * @returns {Promise<void>}
 */
export async function addChangelogEntry(docId, entry) {
    const entryWithDocId = { ...entry, docId };
    
    try {
        const db = await openDatabase();
        
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            
            const request = store.put(entryWithDocId);
            request.onsuccess = () => {
                // Check and enforce entry limit after adding
                enforceEntryLimit(docId).then(resolve).catch(reject);
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.warn('[ChangelogStore] IndexedDB failed, using localStorage:', error);
        addChangelogEntryToLocalStorage(docId, entry);
    }
}

/**
 * Get the count of changelog entries for a document
 * @param {string} docId - Document ID
 * @returns {Promise<number>}
 */
export async function getChangelogCount(docId) {
    try {
        const db = await openDatabase();
        
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const index = store.index('docId');
            
            const request = index.count(IDBKeyRange.only(docId));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.warn('[ChangelogStore] IndexedDB failed:', error);
        return 0;
    }
}

/**
 * Delete old entries if we exceed the limit
 * @param {string} docId - Document ID
 */
async function enforceEntryLimit(docId) {
    const maxEntries = await getMaxEntriesSetting();
    if (maxEntries <= 0) return; // 0 means unlimited
    
    const count = await getChangelogCount(docId);
    if (count <= maxEntries) return;
    
    const toDelete = count - maxEntries;
    const db = await openDatabase();
    
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('docId-timestamp');
        const range = IDBKeyRange.bound([docId, 0], [docId, Number.MAX_SAFE_INTEGER]);
        
        // Open cursor from oldest to newest and delete oldest entries
        const request = index.openCursor(range, 'next');
        let deleted = 0;
        
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor || deleted >= toDelete) {
                resolve();
                return;
            }
            
            cursor.delete();
            deleted++;
            cursor.continue();
        };
        
        request.onerror = () => reject(request.error);
    });
}

/**
 * Get entry by ID
 * @param {string} entryId - Entry ID
 * @returns {Promise<Object|null>}
 */
export async function getChangelogEntry(entryId) {
    try {
        const db = await openDatabase();
        
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            
            const request = store.get(entryId);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.warn('[ChangelogStore] IndexedDB failed:', error);
        return null;
    }
}

/**
 * Delete all changelog entries for a document
 * @param {string} docId - Document ID
 * @returns {Promise<void>}
 */
export async function clearChangelog(docId) {
    try {
        const db = await openDatabase();
        
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const index = store.index('docId');
            const range = IDBKeyRange.only(docId);
            
            const request = index.openCursor(range);
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (!cursor) {
                    resolve();
                    return;
                }
                cursor.delete();
                cursor.continue();
            };
            
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.warn('[ChangelogStore] IndexedDB failed:', error);
        localStorage.removeItem('Nightjar-changelog-' + docId);
    }
}

// --- Settings Management ---

/**
 * Get the max entries setting (0 = unlimited)
 * @returns {Promise<number>}
 */
export async function getMaxEntriesSetting() {
    try {
        const db = await openDatabase();
        
        return new Promise((resolve, reject) => {
            const tx = db.transaction(SETTINGS_STORE, 'readonly');
            const store = tx.objectStore(SETTINGS_STORE);
            
            const request = store.get('maxEntries');
            request.onsuccess = () => {
                resolve(request.result?.value ?? DEFAULT_MAX_ENTRIES);
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        return DEFAULT_MAX_ENTRIES;
    }
}

/**
 * Set the max entries setting (0 = unlimited)
 * @param {number} maxEntries
 * @returns {Promise<void>}
 */
export async function setMaxEntriesSetting(maxEntries) {
    try {
        const db = await openDatabase();
        
        return new Promise((resolve, reject) => {
            const tx = db.transaction(SETTINGS_STORE, 'readwrite');
            const store = tx.objectStore(SETTINGS_STORE);
            
            const request = store.put({ key: 'maxEntries', value: maxEntries });
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.warn('[ChangelogStore] Failed to save max entries setting:', error);
    }
}

// --- LocalStorage Fallback ---

function getChangelogFromLocalStorage(docId) {
    try {
        const stored = localStorage.getItem('Nightjar-changelog-' + docId);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        return [];
    }
}

function addChangelogEntryToLocalStorage(docId, entry) {
    try {
        const entries = getChangelogFromLocalStorage(docId);
        entries.push(entry);
        // Keep last 100 in localStorage fallback mode (limited by quota)
        const trimmed = entries.slice(-100);
        localStorage.setItem('Nightjar-changelog-' + docId, JSON.stringify(trimmed));
    } catch (e) {
        console.error('[ChangelogStore] localStorage fallback failed:', e);
    }
}

// Export sync versions for compatibility with existing hook
export function loadChangelogSync(docId) {
    return getChangelogFromLocalStorage(docId);
}

export function saveChangelogSync(docId, changelog) {
    try {
        // Limit to most recent 100 entries to prevent unbounded localStorage growth
        // (matches addChangelogEntryToLocalStorage limit)
        const trimmed = Array.isArray(changelog) ? changelog.slice(-100) : changelog;
        localStorage.setItem('Nightjar-changelog-' + docId, JSON.stringify(trimmed));
    } catch (e) {
        console.error('[ChangelogStore] saveChangelogSync failed:', e);
    }
}
