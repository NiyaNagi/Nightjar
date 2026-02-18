/**
 * Fuzzy matching utility for cross-app search.
 *
 * Scoring:
 *   - Sequential char match:     base +1
 *   - Consecutive char bonus:    +3
 *   - Word-boundary bonus:       +5
 *   - camelCase boundary bonus:  +3
 *   - Gap penalty:               −1 per skipped char
 *   - Exact substring bonus:    +100
 *
 * Returns { score, matchedIndices } or null if no match.
 */

/**
 * Run a fuzzy match of `query` against `text`.
 *
 * @param {string} query   – user input (case-insensitive)
 * @param {string} text    – candidate string
 * @returns {{ score: number, matchedIndices: number[] } | null}
 */
export function fuzzyMatch(query, text) {
    if (!query || !text) return null;

    const q = query.toLowerCase();
    const t = text.toLowerCase();

    // Fast-path: exact substring
    const exactIdx = t.indexOf(q);
    if (exactIdx !== -1) {
        const indices = [];
        for (let i = 0; i < q.length; i++) indices.push(exactIdx + i);
        return { score: 100 + q.length, matchedIndices: indices };
    }

    // Sequential char matching
    let qi = 0;
    let score = 0;
    const matchedIndices = [];
    let lastMatchIdx = -1;

    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
        if (t[ti] === q[qi]) {
            score += 1; // base

            // Consecutive bonus
            if (lastMatchIdx === ti - 1) {
                score += 3;
            }

            // Word-boundary bonus (char after space, dash, underscore, dot, slash)
            if (ti === 0 || /[\s\-_./\\]/.test(text[ti - 1])) {
                score += 5;
            }

            // camelCase bonus (lowercase → uppercase transition)
            if (ti > 0 && text[ti - 1] === text[ti - 1].toLowerCase() && text[ti] === text[ti].toUpperCase() && text[ti] !== text[ti].toLowerCase()) {
                score += 3;
            }

            matchedIndices.push(ti);
            lastMatchIdx = ti;
            qi++;
        } else {
            // Gap penalty (only when we've already started matching)
            if (matchedIndices.length > 0) {
                score -= 1;
            }
        }
    }

    // All query chars consumed?
    if (qi < q.length) return null;

    return { score, matchedIndices };
}

/**
 * Split `text` into segments for rendering, marking which are highlighted.
 *
 * @param {string} text
 * @param {number[]} matchedIndices – sorted ascending
 * @returns {Array<{ text: string, highlighted: boolean }>}
 */
export function highlightMatches(text, matchedIndices) {
    if (!text) return [];
    if (!matchedIndices || matchedIndices.length === 0) {
        return [{ text, highlighted: false }];
    }

    const set = new Set(matchedIndices);
    const segments = [];
    let i = 0;

    while (i < text.length) {
        const isHighlighted = set.has(i);
        let j = i + 1;
        while (j < text.length && set.has(j) === isHighlighted) j++;
        segments.push({ text: text.slice(i, j), highlighted: isHighlighted });
        i = j;
    }

    return segments;
}

/**
 * Score and rank a list of items by fuzzy query.
 *
 * @template T
 * @param {string} query
 * @param {T[]} items
 * @param {(item: T) => string} getText – extract searchable text from item
 * @param {number} [limit] – max results (default: all)
 * @returns {Array<{ item: T, score: number, matchedIndices: number[] }>}
 */
export function rankItems(query, items, getText, limit) {
    if (!query || !items) return [];

    const results = [];
    for (const item of items) {
        const text = getText(item);
        if (!text) continue;
        const m = fuzzyMatch(query, text);
        if (m) results.push({ item, score: m.score, matchedIndices: m.matchedIndices });
    }

    results.sort((a, b) => b.score - a.score);
    return limit ? results.slice(0, limit) : results;
}
