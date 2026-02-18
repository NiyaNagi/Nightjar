/**
 * SearchPalette – Ctrl+K / 🔍 cross-app search.
 *
 * Two-phase results:
 *  Phase 1 (instant) – people, doc/folder/file titles, inventory, recent chat.
 *  Phase 2 (async)   – document body content from SearchIndexCache.
 *
 * Categories: People · Documents · Folders · Inventory · Files · Chat · Content
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { fuzzyMatch, highlightMatches, rankItems } from '../utils/fuzzyMatch';
import * as SearchIndex from '../services/SearchIndexCache';
import './SearchPalette.css';

const CHAT_CAP = 2500;

// Category config – icon, label, sort priority
const CATEGORIES = {
    people:    { icon: '👤', label: 'People',    priority: 0 },
    documents: { icon: '📄', label: 'Documents', priority: 1 },
    folders:   { icon: '📁', label: 'Folders',   priority: 2 },
    inventory: { icon: '📦', label: 'Inventory', priority: 3 },
    files:     { icon: '📎', label: 'Files',     priority: 4 },
    chat:      { icon: '💬', label: 'Chat',      priority: 5 },
    content:   { icon: '🔍', label: 'Content',   priority: 6 },
};

// ── Highlight renderer ──────────────────────────────────────────────
function HighlightedText({ text, matchedIndices }) {
    if (!matchedIndices || matchedIndices.length === 0) return <span>{text}</span>;
    const segs = highlightMatches(text, matchedIndices);
    return (
        <span>
            {segs.map((seg, i) =>
                seg.highlighted
                    ? <span key={i} className="sp-hl">{seg.text}</span>
                    : <span key={i}>{seg.text}</span>
            )}
        </span>
    );
}

// ── Type badge labels ───────────────────────────────────────────────
function typeBadge(type) {
    switch (type) {
        case 'text':   return '📝 Text';
        case 'sheet':  return '📊 Sheet';
        case 'kanban': return '📋 Kanban';
        default:       return type;
    }
}

// ── Main component ──────────────────────────────────────────────────
export default function SearchPalette({
    show,
    onClose,
    // Data sources (from AppNew)
    documents = [],
    folders = [],
    workspaceCollaborators = [],
    workspaceMembers = [],
    yCatalogItems,
    yStorageFiles,
    yStorageFolders,
    workspaceYdoc,
    // Navigation callbacks
    onOpenDocument,
    onNavigateFolder,
    onOpenChat,
    onOpenInventory,
    onOpenFileStorage,
    // For content index
    isElectronMode,
    metaSocketRef,
    ydocsRef,
    // Current workspace name
    workspaceName,
}) {
    const [query, setQuery] = useState('');
    const [activeIdx, setActiveIdx] = useState(0);
    const [chatSearchAll, setChatSearchAll] = useState(false);
    const [indexing, setIndexing] = useState(false);
    const inputRef = useRef(null);
    const listRef = useRef(null);

    // ── Focus input on open ─────────────────────────────────────────
    useEffect(() => {
        if (show) {
            setQuery('');
            setActiveIdx(0);
            setChatSearchAll(false);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [show]);

    // ── Build content index when opening ────────────────────────────
    useEffect(() => {
        if (!show) return;
        setIndexing(true);
        SearchIndex.buildIndex({
            isElectronMode,
            metaSocketRef,
            documents,
            ydocsRef,
            debounceMs: 100,
        }).finally(() => setIndexing(false));
    }, [show, documents, isElectronMode, metaSocketRef, ydocsRef]);

    // ── Grab raw data from Yjs shared types ─────────────────────────
    const catalogItems = useMemo(() => {
        if (!yCatalogItems) return [];
        try { return yCatalogItems.toArray(); } catch { return []; }
    }, [yCatalogItems, show]);

    const storageFiles = useMemo(() => {
        if (!yStorageFiles) return [];
        try { return yStorageFiles.toArray(); } catch { return []; }
    }, [yStorageFiles, show]);

    const storageFolders = useMemo(() => {
        if (!yStorageFolders) return [];
        try { return yStorageFolders.toArray(); } catch { return []; }
    }, [yStorageFolders, show]);

    const chatMessages = useMemo(() => {
        if (!workspaceYdoc) return [];
        try {
            const ymsgs = workspaceYdoc.getArray('chat-messages');
            const all = ymsgs.toArray();
            if (chatSearchAll) return all;
            return all.slice(-CHAT_CAP);
        } catch { return []; }
    }, [workspaceYdoc, chatSearchAll, show]);

    const totalChatCount = useMemo(() => {
        if (!workspaceYdoc) return 0;
        try { return workspaceYdoc.getArray('chat-messages').length; } catch { return 0; }
    }, [workspaceYdoc, show]);

    // ── People: members + collaborators ─────────────────────────────
    const people = useMemo(() => {
        const seen = new Set();
        const list = [];
        const addPerson = (p) => {
            const key = p.publicKey || p.publicKeyBase62 || p.name;
            if (!key || seen.has(key)) return;
            seen.add(key);
            list.push({
                name: p.displayName || p.name || 'Unknown',
                publicKey: p.publicKey || p.publicKeyBase62 || '',
                color: p.color,
                icon: p.icon,
            });
        };
        const collabArr = Array.isArray(workspaceCollaborators) ? workspaceCollaborators : Object.values(workspaceCollaborators || {});
        collabArr.forEach(addPerson);
        const membersArr = Array.isArray(workspaceMembers) ? workspaceMembers : Object.values(workspaceMembers || {});
        membersArr.forEach(m => addPerson(m));
        return list;
    }, [workspaceCollaborators, workspaceMembers]);

    // ── Compute ranked results per category ─────────────────────────
    const allResults = useMemo(() => {
        if (!query || query.length < 1) return [];

        const q = query.trim();
        const results = [];

        // People
        rankItems(q, people, p => p.name, 10).forEach(r =>
            results.push({ category: 'people', ...r }));

        // Documents
        rankItems(q, documents, d => d.name || 'Untitled', 20).forEach(r =>
            results.push({ category: 'documents', ...r }));

        // Folders
        rankItems(q, folders, f => f.name || '', 10).forEach(r =>
            results.push({ category: 'folders', ...r }));

        // Inventory — search name+description but highlight against name only
        rankItems(q, catalogItems, c => `${c.name || ''} ${c.description || ''}`, 10).forEach(r => {
            const titleMatch = fuzzyMatch(q, r.item.name || '');
            results.push({ category: 'inventory', ...r, matchedIndices: titleMatch?.matchedIndices || [] });
        });

        // Files
        rankItems(q, storageFiles, f => f.name || f.fileName || '', 10).forEach(r =>
            results.push({ category: 'files', ...r }));

        // File storage folders
        rankItems(q, storageFolders, f => f.name || '', 10).forEach(r =>
            results.push({ category: 'folders', ...r }));

        // Chat messages
        rankItems(q, chatMessages, m => m.text || '', 20).forEach(r =>
            results.push({ category: 'chat', ...r }));

        // Content from index cache
        const contentHits = SearchIndex.search(q, 15);
        contentHits.forEach(hit => {
            const doc = documents.find(d => d.id === hit.docId);
            const docName = doc?.name || 'Untitled';
            // Re-match against the title so highlight indices are correct
            const titleMatch = fuzzyMatch(q, docName);
            results.push({
                category: 'content',
                item: { ...hit, docName, docType: hit.type },
                score: hit.score,
                matchedIndices: titleMatch?.matchedIndices || [],
            });
        });

        // Sort: group by category priority, within each group by score
        results.sort((a, b) => {
            const pa = CATEGORIES[a.category]?.priority ?? 99;
            const pb = CATEGORIES[b.category]?.priority ?? 99;
            if (pa !== pb) return pa - pb;
            return b.score - a.score;
        });

        return results;
    }, [query, people, documents, folders, catalogItems, storageFiles, storageFolders, chatMessages]);

    // ── Reset active index when results change ──────────────────────
    useEffect(() => { setActiveIdx(0); }, [allResults]);

    // ── Select a result ─────────────────────────────────────────────
    const selectResult = useCallback((r) => {
        onClose();
        switch (r.category) {
            case 'people':
                onOpenChat?.(r.item);
                break;
            case 'documents':
                onOpenDocument?.(r.item.id, r.item.name, r.item.type);
                break;
            case 'folders':
                onNavigateFolder?.(r.item.id || r.item);
                break;
            case 'inventory':
                onOpenInventory?.(r.item);
                break;
            case 'files':
                onOpenFileStorage?.(r.item);
                break;
            case 'chat': {
                // Navigate to chat — set the chat target if it's a DM
                const msg = r.item;
                onOpenChat?.(msg.channel && msg.channel !== 'general'
                    ? { channel: msg.channel }
                    : undefined);
                break;
            }
            case 'content': {
                const hit = r.item;
                onOpenDocument?.(hit.docId, hit.docName, hit.docType);
                break;
            }
            default: break;
        }
    }, [onClose, onOpenDocument, onNavigateFolder, onOpenChat, onOpenInventory, onOpenFileStorage]);

    // ── Keyboard navigation ─────────────────────────────────────────
    const handleKeyDown = useCallback((e) => {
        if (e.key === 'Escape') { onClose(); return; }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIdx(i => Math.min(i + 1, allResults.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIdx(i => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const r = allResults[activeIdx];
            if (r) selectResult(r);
        }
    }, [allResults, activeIdx, onClose, selectResult]);

    // ── Scroll active item into view ────────────────────────────────
    useEffect(() => {
        const el = listRef.current?.querySelector('.search-palette__item--active');
        el?.scrollIntoView({ block: 'nearest' });
    }, [activeIdx]);

    // ── Overlay click-outside ───────────────────────────────────────
    const handleOverlayClick = useCallback((e) => {
        if (e.target === e.currentTarget) onClose();
    }, [onClose]);

    // Pre-compute category header positions (avoids mutable variable during render)
    const categoryHeaderIndices = useMemo(() => {
        const headers = new Map();
        let last = null;
        allResults.forEach((r, idx) => {
            if (r.category !== last) {
                headers.set(idx, r.category);
                last = r.category;
            }
        });
        return headers;
    }, [allResults]);

    // ── Render ──────────────────────────────────────────────────────
    if (!show) return null;

    return (
        <div className="search-palette__overlay" onClick={handleOverlayClick} data-testid="search-palette-overlay">
            <div className="search-palette" role="dialog" aria-label="Search" data-testid="search-palette">
                {/* Input */}
                <div className="search-palette__input-wrap">
                    <span className="search-palette__icon">🔍</span>
                    <input
                        ref={inputRef}
                        className="search-palette__input"
                        type="text"
                        placeholder="Search everything…"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        autoComplete="off"
                        spellCheck={false}
                        data-testid="search-palette-input"
                    />
                    <kbd className="search-palette__kbd">Esc</kbd>
                </div>

                {/* Scope hint */}
                {workspaceName && (
                    <div className="search-palette__scope">
                        <span className="search-palette__scope-dot" />
                        Searching in <strong style={{ marginLeft: 4 }}>{workspaceName}</strong>
                    </div>
                )}

                {/* Results */}
                <div className="search-palette__results" ref={listRef} data-testid="search-palette-results">
                    {query && allResults.length === 0 && !indexing && (
                        <div className="search-palette__empty">
                            No results for &ldquo;{query}&rdquo;
                        </div>
                    )}

                    {indexing && query && allResults.length === 0 && (
                        <div className="search-palette__loading">
                            <span className="search-palette__spinner" />
                            Indexing documents…
                        </div>
                    )}

                    {allResults.map((r, idx) => {
                        const cat = CATEGORIES[r.category];
                        const headerCategory = categoryHeaderIndices.get(idx);
                        const header = headerCategory ? (
                            <div key={`hdr-${headerCategory}`} className="search-palette__category">
                                {CATEGORIES[headerCategory]?.label || headerCategory}
                            </div>
                        ) : null;

                        return (
                            <React.Fragment key={idx}>
                                {header}
                                <ResultItem
                                    result={r}
                                    active={idx === activeIdx}
                                    onClick={() => selectResult(r)}
                                    onMouseEnter={() => setActiveIdx(idx)}
                                />
                            </React.Fragment>
                        );
                    })}

                    {/* Chat cap notice */}
                    {query && !chatSearchAll && totalChatCount > CHAT_CAP && (
                        <div className="search-palette__chat-cap">
                            <span className="search-palette__chat-cap-text">
                                Showing last {CHAT_CAP} of {totalChatCount} messages
                            </span>
                            <button
                                className="search-palette__chat-cap-btn"
                                onClick={() => setChatSearchAll(true)}
                                data-testid="search-all-messages-btn"
                            >
                                Search all {totalChatCount} messages
                            </button>
                        </div>
                    )}

                    {!query && (
                        <div className="search-palette__hint">
                            Start typing to search documents, people, chat, files, and more…
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="search-palette__footer">
                    <span><kbd>↑↓</kbd> navigate</span>
                    <span><kbd>↵</kbd> open</span>
                    <span><kbd>Esc</kbd> close</span>
                </div>
            </div>
        </div>
    );
}

// ── ResultItem sub-component ────────────────────────────────────────
function ResultItem({ result, active, onClick, onMouseEnter }) {
    const { category, item, matchedIndices } = result;
    const cat = CATEGORIES[category];

    let title = '';
    let snippet = '';
    let badge = null;

    switch (category) {
        case 'people':
            title = item.name;
            snippet = item.publicKey ? `${item.publicKey.slice(0, 12)}…` : '';
            break;
        case 'documents':
            title = item.name || 'Untitled';
            badge = typeBadge(item.type);
            break;
        case 'folders':
            title = item.name || item.id || 'Folder';
            break;
        case 'inventory':
            title = item.name || 'Item';
            snippet = item.description || '';
            badge = item.category || 'inventory';
            break;
        case 'files':
            title = item.name || item.fileName || 'File';
            snippet = item.size ? `${(item.size / 1024).toFixed(1)} KB` : '';
            break;
        case 'chat':
            title = item.text || '';
            snippet = item.username ? `${item.username}` : '';
            break;
        case 'content':
            title = item.docName || 'Untitled';
            snippet = item.snippet || '';
            badge = typeBadge(item.docType);
            break;
        default:
            title = JSON.stringify(item).slice(0, 60);
    }

    return (
        <div
            className={`search-palette__item${active ? ' search-palette__item--active' : ''}`}
            onClick={onClick}
            onMouseEnter={onMouseEnter}
            role="option"
            aria-selected={active}
            data-testid="search-palette-item"
        >
            <span className="search-palette__item-icon">{cat?.icon || '•'}</span>
            <div className="search-palette__item-body">
                <div className="search-palette__item-title">
                    <HighlightedText text={title} matchedIndices={matchedIndices} />
                </div>
                {snippet && (
                    <div className="search-palette__item-snippet">{snippet}</div>
                )}
            </div>
            {badge && <span className="search-palette__item-badge">{badge}</span>}
        </div>
    );
}
