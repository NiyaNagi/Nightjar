/**
 * Shared Yjs text extraction utilities (Node.js / sidecar version)
 * 
 * Extracts plain text from various Yjs document types for search indexing.
 * Pure Yjs tree traversal — no DOM dependency.
 */
const Y = require('yjs');

/**
 * Extract plain text from a Y.XmlFragment (ProseMirror / TipTap documents).
 */
function getTextFromFragment(fragment) {
    if (!fragment) return '';
    try {
        let text = '';
        const traverse = (node) => {
            if (!node) return;
            if (typeof node === 'string') { text += node; return; }

            if (node.constructor?.name === 'YXmlText' || node.toString !== Object.prototype.toString) {
                try {
                    const str = node.toString();
                    if (str && typeof str === 'string') { text += str; return; }
                } catch (e) { /* fall through */ }
            }

            if (node._start !== undefined) {
                let item = node._start;
                while (item) {
                    if (item.content && typeof item.content.str === 'string') {
                        text += item.content.str;
                    }
                    item = item.right;
                }
                return;
            }

            if (typeof node.toArray === 'function') {
                node.toArray().forEach(child => traverse(child));
                if (node.nodeName && ['paragraph', 'heading', 'blockquote'].includes(node.nodeName)) {
                    text += '\n';
                }
                return;
            }

            if (typeof node.forEach === 'function') {
                node.forEach(child => traverse(child));
            }
        };
        traverse(fragment);
        return text.trim();
    } catch (e) { return ''; }
}

/**
 * Extract searchable text from a Fortune Sheet Y.Map.
 */
function getTextFromSheet(ySheetMap) {
    if (!ySheetMap) return '';
    try {
        const sheets = ySheetMap.get ? ySheetMap.get('sheets') : ySheetMap.sheets;
        if (!sheets || !Array.isArray(sheets)) return '';

        const parts = [];
        for (const sheet of sheets) {
            if (sheet.name) parts.push(sheet.name);
            if (sheet.celldata && Array.isArray(sheet.celldata)) {
                for (const cell of sheet.celldata) {
                    const val = cell.v?.m || cell.v?.v;
                    if (val != null && val !== '') parts.push(String(val));
                }
            }
            if (sheet.data && Array.isArray(sheet.data)) {
                for (const row of sheet.data) {
                    if (!Array.isArray(row)) continue;
                    for (const cell of row) {
                        if (cell == null) continue;
                        const val = typeof cell === 'object' ? (cell.m || cell.v) : cell;
                        if (val != null && val !== '') parts.push(String(val));
                    }
                }
            }
        }
        return parts.join(' ');
    } catch (e) { return ''; }
}

/**
 * Extract searchable text from a Kanban Y.Map.
 */
function getTextFromKanban(yKanbanMap) {
    if (!yKanbanMap) return '';
    try {
        const columns = yKanbanMap.get ? yKanbanMap.get('columns') : yKanbanMap.columns;
        if (!columns || !Array.isArray(columns)) return '';

        const parts = [];
        for (const col of columns) {
            if (col.name) parts.push(col.name);
            if (col.cards && Array.isArray(col.cards)) {
                for (const card of col.cards) {
                    if (card.title) parts.push(card.title);
                    if (card.description) parts.push(card.description);
                    if (card.tags && Array.isArray(card.tags)) {
                        parts.push(...card.tags);
                    }
                }
            }
        }
        return parts.join(' ');
    } catch (e) { return ''; }
}

/**
 * High-level dispatcher: extracts searchable text from a Y.Doc based on doc type.
 */
function extractDocumentText(ydoc, docType) {
    if (!ydoc) return '';
    try {
        switch (docType) {
            case 'text':
                return getTextFromFragment(ydoc.get('prosemirror', Y.XmlFragment));
            case 'sheet':
                return getTextFromSheet(ydoc.getMap('sheet-data'));
            case 'kanban':
                return getTextFromKanban(ydoc.getMap('kanban'));
            default:
                return '';
        }
    } catch (e) { return ''; }
}

module.exports = {
    getTextFromFragment,
    getTextFromSheet,
    getTextFromKanban,
    extractDocumentText,
};
