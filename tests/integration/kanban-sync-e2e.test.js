/**
 * Kanban Board Sync E2E Tests
 * 
 * Tests collaborative Kanban board editing with CRDT sync.
 * Uses Y.Array for columns and Y.Map for cards.
 */

const { ConcurrencyTestHarness } = require('./concurrency-harness');
const { generateDocId, sleep } = require('./test-utils');
const { assertKanbanBoardMatch } = require('./crdt-assertions');
const { timedLog } = require('./test-stability');

/**
 * Test suite definition
 */
const KanbanSyncTests = {
    name: 'Kanban Board Sync Tests',
    tests: [],
};

function test(name, fn, options = {}) {
    KanbanSyncTests.tests.push({
        name,
        fn: async () => {
            const harness = new ConcurrencyTestHarness({
                testName: `kanban-${name.replace(/\s+/g, '-').toLowerCase()}`,
                clientCount: options.clientCount || 2,
            });
            
            try {
                await harness.setup();
                await fn(harness);
            } catch (error) {
                harness.markFailed(error);
                throw error;
            } finally {
                await harness.teardown();
            }
        },
        options,
        timeout: options.timeout || 30000,
    });
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Initialize a Kanban board structure
 */
function initKanbanBoard(client, boardId = 'default') {
    const ydoc = client.getYDoc();
    const columns = ydoc.getArray(`kanban:${boardId}:columns`);
    const cards = ydoc.getMap(`kanban:${boardId}:cards`);
    const meta = ydoc.getMap(`kanban:${boardId}:meta`);
    
    return { columns, cards, meta };
}

/**
 * Add a column to the board
 */
function addColumn(client, boardId, columnId, title, position = -1) {
    const ydoc = client.getYDoc();
    const columns = ydoc.getArray(`kanban:${boardId}:columns`);
    
    const column = {
        id: columnId,
        title,
        cardIds: [],
        createdAt: Date.now(),
    };
    
    if (position === -1) {
        columns.push([column]);
    } else {
        columns.insert(position, [column]);
    }
    
    return column;
}

/**
 * Get all columns
 */
function getColumns(client, boardId) {
    const ydoc = client.getYDoc();
    return ydoc.getArray(`kanban:${boardId}:columns`).toArray();
}

/**
 * Add a card to a column
 */
function addCard(client, boardId, cardId, columnId, content) {
    const ydoc = client.getYDoc();
    const cards = ydoc.getMap(`kanban:${boardId}:cards`);
    const columns = ydoc.getArray(`kanban:${boardId}:columns`);
    
    // Create card
    cards.set(cardId, {
        id: cardId,
        content,
        columnId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    });
    
    // Add to column's cardIds
    const columnsArray = columns.toArray();
    const colIndex = columnsArray.findIndex(c => c.id === columnId);
    if (colIndex !== -1) {
        const col = columnsArray[colIndex];
        col.cardIds = [...(col.cardIds || []), cardId];
        columns.delete(colIndex, 1);
        columns.insert(colIndex, [col]);
    }
}

/**
 * Get a card by ID
 */
function getCard(client, boardId, cardId) {
    const ydoc = client.getYDoc();
    return ydoc.getMap(`kanban:${boardId}:cards`).get(cardId);
}

/**
 * Get all cards
 */
function getAllCards(client, boardId) {
    const ydoc = client.getYDoc();
    const cards = ydoc.getMap(`kanban:${boardId}:cards`);
    const result = {};
    cards.forEach((value, key) => {
        result[key] = value;
    });
    return result;
}

/**
 * Move a card between columns
 */
function moveCard(client, boardId, cardId, fromColumnId, toColumnId, newPosition = -1) {
    const ydoc = client.getYDoc();
    const cards = ydoc.getMap(`kanban:${boardId}:cards`);
    const columns = ydoc.getArray(`kanban:${boardId}:columns`);
    
    // Update card's columnId
    const card = cards.get(cardId);
    if (card) {
        cards.set(cardId, { ...card, columnId: toColumnId, updatedAt: Date.now() });
    }
    
    // Update column cardIds
    const columnsArray = columns.toArray();
    
    // Remove from source
    const fromIdx = columnsArray.findIndex(c => c.id === fromColumnId);
    if (fromIdx !== -1) {
        const fromCol = columnsArray[fromIdx];
        fromCol.cardIds = (fromCol.cardIds || []).filter(id => id !== cardId);
        columns.delete(fromIdx, 1);
        columns.insert(fromIdx, [fromCol]);
    }
    
    // Add to target
    const columnsArrayUpdated = columns.toArray();
    const toIdx = columnsArrayUpdated.findIndex(c => c.id === toColumnId);
    if (toIdx !== -1) {
        const toCol = columnsArrayUpdated[toIdx];
        const targetCardIds = [...(toCol.cardIds || [])];
        if (newPosition === -1 || newPosition >= targetCardIds.length) {
            targetCardIds.push(cardId);
        } else {
            targetCardIds.splice(newPosition, 0, cardId);
        }
        toCol.cardIds = targetCardIds;
        columns.delete(toIdx, 1);
        columns.insert(toIdx, [toCol]);
    }
}

/**
 * Delete a card
 */
function deleteCard(client, boardId, cardId) {
    const ydoc = client.getYDoc();
    const cards = ydoc.getMap(`kanban:${boardId}:cards`);
    const columns = ydoc.getArray(`kanban:${boardId}:columns`);
    
    // Remove card
    const card = cards.get(cardId);
    cards.delete(cardId);
    
    // Remove from column
    if (card) {
        const columnsArray = columns.toArray();
        const colIdx = columnsArray.findIndex(c => c.id === card.columnId);
        if (colIdx !== -1) {
            const col = columnsArray[colIdx];
            col.cardIds = (col.cardIds || []).filter(id => id !== cardId);
            columns.delete(colIdx, 1);
            columns.insert(colIdx, [col]);
        }
    }
}

/**
 * Reorder a column
 */
function reorderColumn(client, boardId, columnId, newPosition) {
    const ydoc = client.getYDoc();
    const columns = ydoc.getArray(`kanban:${boardId}:columns`);
    
    const columnsArray = columns.toArray();
    const currentIdx = columnsArray.findIndex(c => c.id === columnId);
    
    if (currentIdx !== -1 && currentIdx !== newPosition) {
        const [column] = columnsArray.splice(currentIdx, 1);
        columnsArray.splice(newPosition, 0, column);
        
        // Recreate array
        columns.delete(0, columns.length);
        columns.push(columnsArray);
    }
}

// ============================================================================
// COLUMN TESTS
// ============================================================================

test('Add column syncs', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    initKanbanBoard(clientA, 'board1');
    addColumn(clientA, 'board1', 'col-todo', 'To Do');
    addColumn(clientA, 'board1', 'col-done', 'Done');
    
    await sleep(500);
    
    // Client B should see both columns
    const columns = getColumns(clientB, 'board1');
    
    if (columns.length !== 2) {
        throw new Error(`Expected 2 columns, got ${columns.length}`);
    }
    
    if (columns[0].title !== 'To Do' || columns[1].title !== 'Done') {
        throw new Error(`Unexpected column titles: ${columns.map(c => c.title)}`);
    }
    
    timedLog('✓ Columns synced');
});

test('Concurrent column creation', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    initKanbanBoard(clientA, 'board1');
    await sleep(100);
    
    // Both clients add columns simultaneously
    addColumn(clientA, 'board1', 'col-a', 'From A');
    addColumn(clientB, 'board1', 'col-b', 'From B');
    
    await sleep(500);
    
    // Both columns should exist
    const columns = getColumns(clientA, 'board1');
    const titles = columns.map(c => c.title);
    
    if (!titles.includes('From A') || !titles.includes('From B')) {
        throw new Error(`Missing columns: ${titles}`);
    }
    
    timedLog(`✓ Concurrent columns: ${titles.join(', ')}`);
});

// ============================================================================
// CARD TESTS
// ============================================================================

test('Add card syncs', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    initKanbanBoard(clientA, 'board1');
    addColumn(clientA, 'board1', 'col-todo', 'To Do');
    await sleep(200);
    
    addCard(clientA, 'board1', 'card-1', 'col-todo', 'First task');
    
    await sleep(500);
    
    const card = getCard(clientB, 'board1', 'card-1');
    
    if (!card || card.content !== 'First task') {
        throw new Error(`Card not synced: ${JSON.stringify(card)}`);
    }
    
    timedLog('✓ Card synced');
});

test('Concurrent card creation in same column', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    initKanbanBoard(clientA, 'board1');
    addColumn(clientA, 'board1', 'col-todo', 'To Do');
    await sleep(200);
    
    // Both add cards to same column
    addCard(clientA, 'board1', 'card-a', 'col-todo', 'Task from A');
    addCard(clientB, 'board1', 'card-b', 'col-todo', 'Task from B');
    
    await sleep(500);
    
    // Both cards should exist
    const cards = getAllCards(clientA, 'board1');
    
    if (!cards['card-a'] || !cards['card-b']) {
        throw new Error(`Missing cards: ${Object.keys(cards)}`);
    }
    
    timedLog('✓ Concurrent cards in same column');
});

test('Delete card syncs', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    initKanbanBoard(clientA, 'board1');
    addColumn(clientA, 'board1', 'col-todo', 'To Do');
    addCard(clientA, 'board1', 'card-1', 'col-todo', 'To be deleted');
    addCard(clientA, 'board1', 'card-2', 'col-todo', 'Keep this');
    await sleep(300);
    
    // Delete first card
    deleteCard(clientA, 'board1', 'card-1');
    
    await sleep(500);
    
    const deletedCard = getCard(clientB, 'board1', 'card-1');
    const keptCard = getCard(clientB, 'board1', 'card-2');
    
    if (deletedCard !== undefined) {
        throw new Error('Deleted card still exists');
    }
    
    if (!keptCard) {
        throw new Error('Other card was affected');
    }
    
    timedLog('✓ Card deletion synced');
});

// ============================================================================
// DRAG-DROP / MOVE TESTS
// ============================================================================

test('Move card between columns', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    initKanbanBoard(clientA, 'board1');
    addColumn(clientA, 'board1', 'col-todo', 'To Do');
    addColumn(clientA, 'board1', 'col-done', 'Done');
    addCard(clientA, 'board1', 'card-1', 'col-todo', 'Move me');
    await sleep(300);
    
    // Move card from To Do to Done
    moveCard(clientA, 'board1', 'card-1', 'col-todo', 'col-done');
    
    await sleep(500);
    
    // Verify on client B
    const card = getCard(clientB, 'board1', 'card-1');
    
    if (card.columnId !== 'col-done') {
        throw new Error(`Card not moved: columnId="${card.columnId}"`);
    }
    
    // Verify column cardIds
    const columns = getColumns(clientB, 'board1');
    const todoCol = columns.find(c => c.id === 'col-todo');
    const doneCol = columns.find(c => c.id === 'col-done');
    
    if (todoCol.cardIds?.includes('card-1')) {
        throw new Error('Card still in source column');
    }
    
    if (!doneCol.cardIds?.includes('card-1')) {
        throw new Error('Card not in target column');
    }
    
    timedLog('✓ Card moved between columns');
});

test('Concurrent card moves (different cards)', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    initKanbanBoard(clientA, 'board1');
    addColumn(clientA, 'board1', 'col-todo', 'To Do');
    addColumn(clientA, 'board1', 'col-wip', 'In Progress');
    addColumn(clientA, 'board1', 'col-done', 'Done');
    addCard(clientA, 'board1', 'card-1', 'col-todo', 'Card 1');
    addCard(clientA, 'board1', 'card-2', 'col-wip', 'Card 2');
    await sleep(300);
    
    // Both clients move different cards simultaneously
    moveCard(clientA, 'board1', 'card-1', 'col-todo', 'col-wip');
    moveCard(clientB, 'board1', 'card-2', 'col-wip', 'col-done');
    
    await sleep(500);
    
    // Verify both moves
    const card1 = getCard(clientA, 'board1', 'card-1');
    const card2 = getCard(clientA, 'board1', 'card-2');
    
    if (card1.columnId !== 'col-wip') {
        throw new Error(`Card 1 not moved: "${card1.columnId}"`);
    }
    
    if (card2.columnId !== 'col-done') {
        throw new Error(`Card 2 not moved: "${card2.columnId}"`);
    }
    
    timedLog('✓ Concurrent card moves (different cards)');
});

test('Concurrent reorder of same column', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    initKanbanBoard(clientA, 'board1');
    addColumn(clientA, 'board1', 'col-1', 'Column 1');
    addColumn(clientA, 'board1', 'col-2', 'Column 2');
    addColumn(clientA, 'board1', 'col-3', 'Column 3');
    await sleep(300);
    
    // Both try to reorder columns
    // This is a conflict scenario - result depends on CRDT resolution
    reorderColumn(clientA, 'board1', 'col-1', 2); // Move col-1 to end
    reorderColumn(clientB, 'board1', 'col-3', 0); // Move col-3 to start
    
    await sleep(500);
    
    // Columns should converge
    const columnsA = getColumns(clientA, 'board1');
    const columnsB = getColumns(clientB, 'board1');
    
    const orderA = columnsA.map(c => c.id).join(',');
    const orderB = columnsB.map(c => c.id).join(',');
    
    if (orderA !== orderB) {
        throw new Error(`Column order did not converge: A="${orderA}", B="${orderB}"`);
    }
    
    timedLog(`✓ Column order converged: ${orderA}`);
});

// ============================================================================
// PRESENCE TESTS
// ============================================================================

test('Card drag presence visible', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    initKanbanBoard(clientA, 'board1');
    addColumn(clientA, 'board1', 'col-todo', 'To Do');
    addCard(clientA, 'board1', 'card-1', 'col-todo', 'Drag me');
    await sleep(200);
    
    // Client A starts dragging
    clientA.updateAwareness({
        type: 'kanban-drag',
        boardId: 'board1',
        cardId: 'card-1',
        dragging: true,
    });
    
    await sleep(300);
    
    // Client B should see the drag state
    const states = clientB.getAwarenessStates();
    const dragState = Array.from(states.values()).find(
        s => s.type === 'kanban-drag' && s.cardId === 'card-1'
    );
    
    if (!dragState || !dragState.dragging) {
        throw new Error('Drag state not visible');
    }
    
    timedLog('✓ Card drag presence visible');
});

// ============================================================================
// STRESS TESTS
// ============================================================================

test('Many cards (50 cards across 3 columns)', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    initKanbanBoard(clientA, 'board1');
    addColumn(clientA, 'board1', 'col-todo', 'To Do');
    addColumn(clientA, 'board1', 'col-wip', 'In Progress');
    addColumn(clientA, 'board1', 'col-done', 'Done');
    
    const columnIds = ['col-todo', 'col-wip', 'col-done'];
    
    // Add 50 cards
    for (let i = 0; i < 50; i++) {
        const colId = columnIds[i % 3];
        addCard(clientA, 'board1', `card-${i}`, colId, `Task ${i}`);
    }
    
    await sleep(2000);
    
    // Verify all cards synced
    const cards = getAllCards(clientB, 'board1');
    const cardCount = Object.keys(cards).length;
    
    if (cardCount !== 50) {
        throw new Error(`Expected 50 cards, got ${cardCount}`);
    }
    
    timedLog('✓ 50 cards synced');
}, { timeout: 60000 });

// ============================================================================
// MODULE EXPORTS
// ============================================================================

module.exports = KanbanSyncTests;

if (require.main === module) {
    const { runTestSuite } = require('./test-runner-utils');
    runTestSuite(KanbanSyncTests).catch(console.error);
}
