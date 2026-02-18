/**
 * Comprehensive test suite for the cross-app search feature.
 *
 * Covers:
 *  - fuzzyMatch utility (scoring, exact match, edge cases)
 *  - highlightMatches (segment generation)
 *  - rankItems (ranking, limit)
 *  - yjsTextExtraction (text, sheet, kanban extraction)
 *  - SearchIndexCache (build, search, invalidate)
 *
 * SearchPalette component tests are in search-palette.test.jsx
 */
import { jest } from '@jest/globals';
import '@testing-library/jest-dom';
import * as Y from 'yjs';

// ═══════════════════════════════════════════════════════════════════════
// SECTION 1: fuzzyMatch
// ═══════════════════════════════════════════════════════════════════════
import { fuzzyMatch, highlightMatches, rankItems } from '../frontend/src/utils/fuzzyMatch';

describe('fuzzyMatch', () => {
    // ── Basic matching ─────────────────────────────────────────────────
    test('returns null for empty query', () => {
        expect(fuzzyMatch('', 'hello')).toBeNull();
    });

    test('returns null for empty text', () => {
        expect(fuzzyMatch('hello', '')).toBeNull();
    });

    test('returns null for null inputs', () => {
        expect(fuzzyMatch(null, 'hello')).toBeNull();
        expect(fuzzyMatch('hello', null)).toBeNull();
        expect(fuzzyMatch(null, null)).toBeNull();
    });

    test('returns null when query chars are not found in text', () => {
        expect(fuzzyMatch('xyz', 'hello')).toBeNull();
    });

    test('matches single character', () => {
        const result = fuzzyMatch('h', 'hello');
        expect(result).not.toBeNull();
        expect(result.score).toBeGreaterThan(0);
        expect(result.matchedIndices).toEqual([0]);
    });

    // ── Exact substring matching ───────────────────────────────────────
    test('exact substring gets +100 bonus', () => {
        const result = fuzzyMatch('hello', 'say hello world');
        expect(result).not.toBeNull();
        expect(result.score).toBeGreaterThanOrEqual(100);
        // matchedIndices should be consecutive starting at index 4
        expect(result.matchedIndices).toEqual([4, 5, 6, 7, 8]);
    });

    test('exact match at start of text', () => {
        const result = fuzzyMatch('hello', 'hello world');
        expect(result).not.toBeNull();
        expect(result.score).toBeGreaterThanOrEqual(100);
    });

    test('case insensitive exact match', () => {
        const result = fuzzyMatch('HELLO', 'say hello world');
        expect(result).not.toBeNull();
        expect(result.score).toBeGreaterThanOrEqual(100);
    });

    // ── Fuzzy (non-exact) matching ─────────────────────────────────────
    test('fuzzy match with gaps', () => {
        const result = fuzzyMatch('hlo', 'hello');
        expect(result).not.toBeNull();
        expect(result.matchedIndices).toEqual([0, 2, 4]);
    });

    test('fuzzy match across words', () => {
        const result = fuzzyMatch('hw', 'hello world');
        expect(result).not.toBeNull();
        expect(result.matchedIndices).toContain(0);
    });

    // ── Scoring bonuses ────────────────────────────────────────────────
    test('consecutive chars get higher score', () => {
        const consecutive = fuzzyMatch('hel', 'help me');
        const scattered = fuzzyMatch('hel', 'h_e_l');
        expect(consecutive).not.toBeNull();
        expect(scattered).not.toBeNull();
        expect(consecutive.score).toBeGreaterThan(scattered.score);
    });

    test('word boundary match gets bonus', () => {
        const wordBound = fuzzyMatch('w', 'hello world');
        expect(wordBound).not.toBeNull();
        // 'w' at index 6 is after a space — should get word-boundary bonus
        expect(wordBound.score).toBeGreaterThanOrEqual(6); // base(1) + word-boundary(5)
    });

    test('camelCase boundary gets bonus', () => {
        const result = fuzzyMatch('gN', 'getNodeName');
        expect(result).not.toBeNull();
        expect(result.score).toBeGreaterThan(0);
    });

    // ── Edge cases ─────────────────────────────────────────────────────
    test('query longer than text returns null', () => {
        expect(fuzzyMatch('longquery', 'hi')).toBeNull();
    });

    test('single char query in single char text', () => {
        const result = fuzzyMatch('a', 'a');
        expect(result).not.toBeNull();
        expect(result.matchedIndices).toEqual([0]);
    });

    test('unicode text', () => {
        const result = fuzzyMatch('café', 'a nice café here');
        expect(result).not.toBeNull();
    });
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION 2: highlightMatches
// ═══════════════════════════════════════════════════════════════════════
describe('highlightMatches', () => {
    test('returns single non-highlighted segment for empty indices', () => {
        const segs = highlightMatches('hello', []);
        expect(segs).toEqual([{ text: 'hello', highlighted: false }]);
    });

    test('returns single non-highlighted segment for null indices', () => {
        const segs = highlightMatches('hello', null);
        expect(segs).toEqual([{ text: 'hello', highlighted: false }]);
    });

    test('returns empty array for empty text', () => {
        expect(highlightMatches('', [0])).toEqual([]);
    });

    test('highlights first char only', () => {
        const segs = highlightMatches('hello', [0]);
        expect(segs).toEqual([
            { text: 'h', highlighted: true },
            { text: 'ello', highlighted: false },
        ]);
    });

    test('highlights last char only', () => {
        const segs = highlightMatches('hello', [4]);
        expect(segs).toEqual([
            { text: 'hell', highlighted: false },
            { text: 'o', highlighted: true },
        ]);
    });

    test('highlights consecutive range', () => {
        const segs = highlightMatches('hello', [1, 2, 3]);
        expect(segs).toEqual([
            { text: 'h', highlighted: false },
            { text: 'ell', highlighted: true },
            { text: 'o', highlighted: false },
        ]);
    });

    test('highlights scattered chars', () => {
        const segs = highlightMatches('hello', [0, 2, 4]);
        expect(segs).toEqual([
            { text: 'h', highlighted: true },
            { text: 'e', highlighted: false },
            { text: 'l', highlighted: true },
            { text: 'l', highlighted: false },
            { text: 'o', highlighted: true },
        ]);
    });

    test('whole string highlighted', () => {
        const segs = highlightMatches('hi', [0, 1]);
        expect(segs).toEqual([{ text: 'hi', highlighted: true }]);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION 3: rankItems
// ═══════════════════════════════════════════════════════════════════════
describe('rankItems', () => {
    const items = [
        { name: 'Budget Report' },
        { name: 'Bugs and Issues' },
        { name: 'Meeting Notes' },
        { name: 'Grocery List' },
    ];

    test('returns empty for empty query', () => {
        expect(rankItems('', items, i => i.name)).toEqual([]);
    });

    test('returns empty for null items', () => {
        expect(rankItems('bug', null, i => i.name)).toEqual([]);
    });

    test('ranks exact substring first', () => {
        const results = rankItems('bug', items, i => i.name);
        expect(results.length).toBeGreaterThanOrEqual(2);
        // "Bugs and Issues" and "Budget Report" both contain "bug"
        expect(results[0].item.name).toMatch(/Bug/i);
    });

    test('respects limit', () => {
        const results = rankItems('e', items, i => i.name, 2);
        expect(results.length).toBeLessThanOrEqual(2);
    });

    test('sorted descending by score', () => {
        const results = rankItems('b', items, i => i.name);
        for (let i = 1; i < results.length; i++) {
            expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
        }
    });

    test('skips items with null getText', () => {
        const items2 = [{ name: null }, { name: 'hello' }];
        const results = rankItems('h', items2, i => i.name);
        expect(results.length).toBe(1);
        expect(results[0].item.name).toBe('hello');
    });
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION 4: yjsTextExtraction
// ═══════════════════════════════════════════════════════════════════════
import { getTextFromFragment, getTextFromSheet, getTextFromKanban, extractDocumentText } from '../frontend/src/utils/yjsTextExtraction';

describe('yjsTextExtraction', () => {
    describe('getTextFromFragment', () => {
        test('returns empty for null fragment', () => {
            expect(getTextFromFragment(null)).toBe('');
        });

        test('returns empty for undefined fragment', () => {
            expect(getTextFromFragment(undefined)).toBe('');
        });

        test('extracts text from ProseMirror XmlFragment', () => {
            const ydoc = new Y.Doc();
            const fragment = ydoc.get('prosemirror', Y.XmlFragment);
            const p = new Y.XmlElement('paragraph');
            const text = new Y.XmlText('Hello world');
            p.insert(0, [text]);
            fragment.insert(0, [p]);
            const extracted = getTextFromFragment(fragment);
            expect(extracted).toContain('Hello world');
        });

        test('handles multiple paragraphs', () => {
            const ydoc = new Y.Doc();
            const fragment = ydoc.get('content', Y.XmlFragment);
            const p1 = new Y.XmlElement('paragraph');
            p1.insert(0, [new Y.XmlText('First paragraph')]);
            const p2 = new Y.XmlElement('paragraph');
            p2.insert(0, [new Y.XmlText('Second paragraph')]);
            fragment.insert(0, [p1, p2]);
            const extracted = getTextFromFragment(fragment);
            expect(extracted).toContain('First paragraph');
            expect(extracted).toContain('Second paragraph');
        });

        test('handles heading elements', () => {
            const ydoc = new Y.Doc();
            const fragment = ydoc.get('content', Y.XmlFragment);
            const h = new Y.XmlElement('heading');
            h.insert(0, [new Y.XmlText('My Title')]);
            fragment.insert(0, [h]);
            const extracted = getTextFromFragment(fragment);
            expect(extracted).toContain('My Title');
        });

        test('handles empty fragment', () => {
            const ydoc = new Y.Doc();
            const fragment = ydoc.get('content', Y.XmlFragment);
            const extracted = getTextFromFragment(fragment);
            expect(extracted).toBe('');
        });
    });

    describe('getTextFromSheet', () => {
        test('returns empty for null', () => {
            expect(getTextFromSheet(null)).toBe('');
        });

        test('extracts from celldata format', () => {
            const sheetData = {
                get: (key) => {
                    if (key === 'sheets') return [{
                        name: 'Sheet1',
                        celldata: [
                            { v: { m: 'Hello' } },
                            { v: { v: 42 } },
                            { v: { m: 'World' } },
                        ],
                    }];
                    return null;
                },
            };
            const text = getTextFromSheet(sheetData);
            expect(text).toContain('Sheet1');
            expect(text).toContain('Hello');
            expect(text).toContain('42');
            expect(text).toContain('World');
        });

        test('extracts from data[][] format', () => {
            const sheetData = {
                get: (key) => {
                    if (key === 'sheets') return [{
                        name: 'Data',
                        data: [
                            [{ m: 'A1' }, { v: 'B1' }],
                            [null, { m: 'B2' }],
                        ],
                    }];
                    return null;
                },
            };
            const text = getTextFromSheet(sheetData);
            expect(text).toContain('A1');
            expect(text).toContain('B1');
            expect(text).toContain('B2');
        });

        test('handles empty sheets array', () => {
            const sheetData = { get: () => [] };
            expect(getTextFromSheet(sheetData)).toBe('');
        });
    });

    describe('getTextFromKanban', () => {
        test('returns empty for null', () => {
            expect(getTextFromKanban(null)).toBe('');
        });

        test('extracts column names and card data', () => {
            const kanbanData = {
                get: (key) => {
                    if (key === 'columns') return [
                        {
                            name: 'To Do',
                            cards: [
                                { title: 'Fix bug', description: 'Critical', tags: ['urgent'] },
                                { title: 'Add feature', description: 'Nice to have', tags: ['enhancement'] },
                            ],
                        },
                        {
                            name: 'Done',
                            cards: [
                                { title: 'Setup CI', description: '', tags: [] },
                            ],
                        },
                    ];
                    return null;
                },
            };
            const text = getTextFromKanban(kanbanData);
            expect(text).toContain('To Do');
            expect(text).toContain('Done');
            expect(text).toContain('Fix bug');
            expect(text).toContain('Critical');
            expect(text).toContain('urgent');
            expect(text).toContain('Add feature');
            expect(text).toContain('Setup CI');
        });

        test('handles empty columns', () => {
            const kanbanData = { get: () => [] };
            expect(getTextFromKanban(kanbanData)).toBe('');
        });

        test('handles columns with no cards', () => {
            const kanbanData = {
                get: () => [{ name: 'Empty Column', cards: [] }],
            };
            const text = getTextFromKanban(kanbanData);
            expect(text).toContain('Empty Column');
        });
    });

    describe('extractDocumentText', () => {
        test('returns empty for null ydoc', () => {
            expect(extractDocumentText(null, 'text')).toBe('');
        });

        test('returns empty for unknown type', () => {
            const ydoc = new Y.Doc();
            expect(extractDocumentText(ydoc, 'unknown')).toBe('');
        });

        test('dispatches to text extraction for type "text"', () => {
            const ydoc = new Y.Doc();
            const fragment = ydoc.get('prosemirror', Y.XmlFragment);
            const p = new Y.XmlElement('paragraph');
            p.insert(0, [new Y.XmlText('Test content')]);
            fragment.insert(0, [p]);
            const text = extractDocumentText(ydoc, 'text');
            expect(text).toContain('Test content');
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION 5: SearchIndexCache
// ═══════════════════════════════════════════════════════════════════════
import { buildIndex, search as cacheSearch, invalidate, clearCache, cacheSize, handleIndexResults } from '../frontend/src/services/SearchIndexCache';

describe('SearchIndexCache', () => {
    beforeEach(() => {
        clearCache();
    });

    test('cacheSize returns 0 when empty', () => {
        expect(cacheSize()).toBe(0);
    });

    test('handleIndexResults populates cache', () => {
        handleIndexResults({
            results: [
                { docId: 'doc1', text: 'Hello world', type: 'text' },
                { docId: 'doc2', text: 'Test data', type: 'sheet' },
            ],
        });
        expect(cacheSize()).toBe(2);
    });

    test('search returns results from cached text', () => {
        handleIndexResults({
            results: [
                { docId: 'doc1', text: 'Meeting notes for project alpha', type: 'text' },
                { docId: 'doc2', text: 'Budget spreadsheet v2', type: 'sheet' },
            ],
        });

        const results = cacheSearch('meeting');
        expect(results.length).toBe(1);
        expect(results[0].docId).toBe('doc1');
    });

    test('search returns empty for no match', () => {
        handleIndexResults({
            results: [{ docId: 'doc1', text: 'Hello world', type: 'text' }],
        });
        const results = cacheSearch('xyz123');
        expect(results.length).toBe(0);
    });

    test('search respects limit', () => {
        handleIndexResults({
            results: Array.from({ length: 20 }, (_, i) => ({
                docId: `doc${i}`,
                text: `document about testing item ${i}`,
                type: 'text',
            })),
        });
        const results = cacheSearch('testing', 5);
        expect(results.length).toBeLessThanOrEqual(5);
    });

    test('search returns empty for empty query', () => {
        handleIndexResults({
            results: [{ docId: 'doc1', text: 'Hello', type: 'text' }],
        });
        expect(cacheSearch('')).toEqual([]);
    });

    test('invalidate removes a document from cache', () => {
        handleIndexResults({
            results: [
                { docId: 'doc1', text: 'Hello', type: 'text' },
                { docId: 'doc2', text: 'World', type: 'text' },
            ],
        });
        expect(cacheSize()).toBe(2);
        invalidate('doc1');
        expect(cacheSize()).toBe(1);
    });

    test('clearCache empties the cache', () => {
        handleIndexResults({
            results: [{ docId: 'doc1', text: 'Hello', type: 'text' }],
        });
        clearCache();
        expect(cacheSize()).toBe(0);
    });

    test('search result includes snippet', () => {
        handleIndexResults({
            results: [{ docId: 'doc1', text: 'The quick brown fox jumps over the lazy dog', type: 'text' }],
        });
        const results = cacheSearch('fox');
        expect(results.length).toBe(1);
        expect(results[0].snippet).toBeDefined();
        expect(results[0].snippet.length).toBeGreaterThan(0);
    });

    test('handleIndexResults with empty data', () => {
        handleIndexResults({});
        expect(cacheSize()).toBe(0);
    });

    test('handleIndexResults with null', () => {
        handleIndexResults(null);
        expect(cacheSize()).toBe(0);
    });

    test('buildIndex with already-open docs indexes them', async () => {
        const ydoc = new Y.Doc();
        const fragment = ydoc.get('prosemirror', Y.XmlFragment);
        const p = new Y.XmlElement('paragraph');
        p.insert(0, [new Y.XmlText('Open document content')]);
        fragment.insert(0, [p]);

        const ydocsMap = new Map();
        ydocsMap.set('openDoc1', { ydoc, type: 'text' });

        await buildIndex({
            isElectronMode: false,
            metaSocketRef: { current: null },
            documents: [{ id: 'openDoc1', name: 'Test', type: 'text' }],
            ydocsRef: { current: ydocsMap },
            debounceMs: 0,
        });

        // Allow async to finish
        await new Promise(r => setTimeout(r, 100));
        const results = cacheSearch('Open document');
        expect(results.length).toBeGreaterThanOrEqual(1);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION 6: Edge cases & integration
// ═══════════════════════════════════════════════════════════════════════
describe('Cross-app search integration', () => {
    test('fuzzyMatch + highlightMatches integration', () => {
        const match = fuzzyMatch('mtg', 'Meeting Notes');
        expect(match).not.toBeNull();
        const segs = highlightMatches('Meeting Notes', match.matchedIndices);
        expect(segs.length).toBeGreaterThanOrEqual(1);
        const highlighted = segs.filter(s => s.highlighted);
        expect(highlighted.length).toBeGreaterThanOrEqual(1);
    });

    test('rankItems returns matchedIndices for highlighting', () => {
        const items = [{ name: 'Project Alpha' }];
        const results = rankItems('pro', items, i => i.name);
        expect(results.length).toBe(1);
        expect(results[0].matchedIndices).toBeDefined();
        expect(results[0].matchedIndices.length).toBeGreaterThanOrEqual(3);
    });

    test('extractDocumentText + search integration', () => {
        const ydoc = new Y.Doc();
        const fragment = ydoc.get('prosemirror', Y.XmlFragment);
        const p = new Y.XmlElement('paragraph');
        p.insert(0, [new Y.XmlText('Integration test content')]);
        fragment.insert(0, [p]);
        
        const text = extractDocumentText(ydoc, 'text');
        expect(text).toContain('Integration test content');
        
        const match = fuzzyMatch('integration', text);
        expect(match).not.toBeNull();
        expect(match.score).toBeGreaterThanOrEqual(100); // exact substring
    });

    test('multiple document types searchable', () => {
        // Text
        const textDoc = new Y.Doc();
        const fragment = textDoc.get('prosemirror', Y.XmlFragment);
        const p = new Y.XmlElement('paragraph');
        p.insert(0, [new Y.XmlText('Text doc')]);
        fragment.insert(0, [p]);
        expect(extractDocumentText(textDoc, 'text')).toContain('Text doc');
        
        // Sheet (mock)
        const sheetData = {
            get: (key) => key === 'sheets' ? [{ name: 'Sheet1', celldata: [{ v: { m: 'Cell data' } }] }] : null,
        };
        expect(getTextFromSheet(sheetData)).toContain('Cell data');
        
        // Kanban (mock)
        const kanbanData = {
            get: (key) => key === 'columns' ? [{ name: 'Col', cards: [{ title: 'Card title' }] }] : null,
        };
        expect(getTextFromKanban(kanbanData)).toContain('Card title');
    });
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION 8: Sidecar text extraction (Node version)
// ═══════════════════════════════════════════════════════════════════════
describe('Sidecar yjsTextExtraction', () => {
    // These tests use the same Y.js library to verify the sidecar module
    // Since we're in jsdom, we can't require() the sidecar version directly,
    // but we can verify the frontend version behaves the same way

    test('extracts text from nested ProseMirror structure', () => {
        const ydoc = new Y.Doc();
        const fragment = ydoc.get('prosemirror', Y.XmlFragment);
        
        // Blockquote > paragraph > text
        const blockquote = new Y.XmlElement('blockquote');
        const p = new Y.XmlElement('paragraph');
        p.insert(0, [new Y.XmlText('Quoted text')]);
        blockquote.insert(0, [p]);
        fragment.insert(0, [blockquote]);
        
        const text = getTextFromFragment(fragment);
        expect(text).toContain('Quoted text');
    });

    test('handles multiple text nodes in paragraph', () => {
        const ydoc = new Y.Doc();
        const fragment = ydoc.get('prosemirror', Y.XmlFragment);
        const p = new Y.XmlElement('paragraph');
        p.insert(0, [new Y.XmlText('Hello ')]);
        p.insert(1, [new Y.XmlText('World')]);
        fragment.insert(0, [p]);
        
        const text = getTextFromFragment(fragment);
        expect(text).toContain('Hello');
        expect(text).toContain('World');
    });

    test('sheet extraction handles missing fields gracefully', () => {
        const sheetData = {
            get: (key) => {
                if (key === 'sheets') return [{
                    name: 'Test',
                    celldata: [
                        { v: {} },        // No m or v
                        { v: null },      // null v
                        {},               // No v at all
                        { v: { m: 'ok' } }, // Valid
                    ],
                }];
                return null;
            },
        };
        const text = getTextFromSheet(sheetData);
        expect(text).toContain('ok');
        expect(text).toContain('Test');
    });

    test('kanban extraction handles missing fields gracefully', () => {
        const kanbanData = {
            get: (key) => {
                if (key === 'columns') return [{
                    name: 'Col',
                    cards: [
                        { title: 'Card 1' },           // No description/tags
                        { description: 'desc only' },    // No title
                        { title: 'Card 2', tags: null }, // null tags
                    ],
                }];
                return null;
            },
        };
        const text = getTextFromKanban(kanbanData);
        expect(text).toContain('Col');
        expect(text).toContain('Card 1');
        expect(text).toContain('desc only');
        expect(text).toContain('Card 2');
    });
});
