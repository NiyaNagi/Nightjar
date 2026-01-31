/**
 * Spreadsheet Sync E2E Tests
 * 
 * Tests collaborative spreadsheet editing with CRDT sync.
 * Uses Y.Map for cell data and Y.Array for sheet tabs.
 */

const { ConcurrencyTestHarness } = require('./concurrency-harness');
const { generateDocId, sleep } = require('./test-utils');
const { assertSpreadsheetCellsMatch, waitForConvergence } = require('./crdt-assertions');
const { timedLog } = require('./test-stability');

/**
 * Test suite definition
 */
const SheetSyncTests = {
    name: 'Spreadsheet Sync Tests',
    tests: [],
};

function test(name, fn, options = {}) {
    SheetSyncTests.tests.push({
        name,
        fn: async () => {
            const harness = new ConcurrencyTestHarness({
                testName: `sheet-${name.replace(/\s+/g, '-').toLowerCase()}`,
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
 * Initialize a spreadsheet document structure
 */
function initSpreadsheet(client, sheetName = 'Sheet1') {
    const ydoc = client.getYDoc();
    const cells = ydoc.getMap(`sheet:${sheetName}:cells`);
    const meta = ydoc.getMap(`sheet:${sheetName}:meta`);
    const sheets = ydoc.getArray('sheets');
    
    // Add sheet to list if not present
    const sheetList = sheets.toArray();
    if (!sheetList.includes(sheetName)) {
        sheets.push([sheetName]);
    }
    
    return { cells, meta, sheets };
}

/**
 * Set a cell value
 */
function setCell(client, sheetName, row, col, value) {
    const ydoc = client.getYDoc();
    const cells = ydoc.getMap(`sheet:${sheetName}:cells`);
    const cellKey = `${col}${row}`; // e.g., "A1", "B2"
    
    cells.set(cellKey, {
        value,
        type: typeof value === 'number' ? 'number' : 'string',
        updatedAt: Date.now(),
    });
}

/**
 * Get a cell value
 */
function getCell(client, sheetName, row, col) {
    const ydoc = client.getYDoc();
    const cells = ydoc.getMap(`sheet:${sheetName}:cells`);
    const cellKey = `${col}${row}`;
    const cell = cells.get(cellKey);
    return cell ? cell.value : undefined;
}

/**
 * Get all cells as object
 */
function getAllCells(client, sheetName) {
    const ydoc = client.getYDoc();
    const cells = ydoc.getMap(`sheet:${sheetName}:cells`);
    const result = {};
    
    cells.forEach((value, key) => {
        result[key] = value;
    });
    
    return result;
}

/**
 * Set cell selection for presence
 */
function setCellSelection(client, sheetName, row, col) {
    client.updateAwareness({
        type: 'spreadsheet',
        sheet: sheetName,
        cell: `${col}${row}`,
        selectedAt: Date.now(),
    });
}

/**
 * Wait for cell sync between clients
 */
async function waitForCellSync(clients, sheetName, cellKey, expectedValue, timeout = 5000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
        let allMatch = true;
        
        for (const client of clients) {
            const [col, row] = [cellKey[0], cellKey.slice(1)];
            const value = getCell(client, sheetName, row, col);
            if (value !== expectedValue) {
                allMatch = false;
                break;
            }
        }
        
        if (allMatch) return true;
        await sleep(100);
    }
    
    throw new Error(`Cell ${cellKey} did not sync to "${expectedValue}" within ${timeout}ms`);
}

// ============================================================================
// BASIC CELL EDITING TESTS
// ============================================================================

test('Single cell edit syncs between clients', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    // Client A initializes sheet and sets a cell
    initSpreadsheet(clientA, 'Sheet1');
    setCell(clientA, 'Sheet1', '1', 'A', 'Hello World');
    
    await sleep(500);
    
    // Client B should see the cell
    const value = getCell(clientB, 'Sheet1', '1', 'A');
    if (value !== 'Hello World') {
        throw new Error(`Expected "Hello World", got "${value}"`);
    }
    
    timedLog('✓ Cell edit synced');
});

test('Multiple cells edit across clients', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    // Initialize
    initSpreadsheet(clientA, 'Sheet1');
    await sleep(100);
    
    // Client A edits column A
    setCell(clientA, 'Sheet1', '1', 'A', 'Name');
    setCell(clientA, 'Sheet1', '2', 'A', 'Alice');
    setCell(clientA, 'Sheet1', '3', 'A', 'Bob');
    
    // Client B edits column B
    setCell(clientB, 'Sheet1', '1', 'B', 'Age');
    setCell(clientB, 'Sheet1', '2', 'B', 25);
    setCell(clientB, 'Sheet1', '3', 'B', 30);
    
    await sleep(500);
    
    // Both clients should see all cells
    const cellsA = getAllCells(clientA, 'Sheet1');
    const cellsB = getAllCells(clientB, 'Sheet1');
    
    const expectedKeys = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3'];
    
    for (const key of expectedKeys) {
        if (!cellsA[key]) throw new Error(`Client A missing cell ${key}`);
        if (!cellsB[key]) throw new Error(`Client B missing cell ${key}`);
    }
    
    timedLog('✓ Multiple cells synced across clients');
});

// ============================================================================
// CONFLICT RESOLUTION TESTS
// ============================================================================

test('Same cell concurrent edit (last-write-wins)', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    initSpreadsheet(clientA, 'Sheet1');
    setCell(clientA, 'Sheet1', '1', 'A', 'Initial');
    await sleep(300);
    
    // Both clients edit the same cell at nearly the same time
    // Y.Map uses last-write-wins semantics
    setCell(clientA, 'Sheet1', '1', 'A', 'Value from A');
    setCell(clientB, 'Sheet1', '1', 'A', 'Value from B');
    
    await sleep(500);
    
    // Both should converge to the same value
    const valueA = getCell(clientA, 'Sheet1', '1', 'A');
    const valueB = getCell(clientB, 'Sheet1', '1', 'A');
    
    if (valueA !== valueB) {
        throw new Error(`Cells did not converge: A="${valueA}", B="${valueB}"`);
    }
    
    timedLog(`✓ Same cell conflict resolved: "${valueA}"`);
});

test('Different cells same row concurrent edit', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    initSpreadsheet(clientA, 'Sheet1');
    await sleep(200);
    
    // Edit different cells in same row simultaneously
    setCell(clientA, 'Sheet1', '1', 'A', 'Left');
    setCell(clientB, 'Sheet1', '1', 'B', 'Right');
    
    await sleep(500);
    
    // Both cells should be preserved
    const left = getCell(clientA, 'Sheet1', '1', 'A');
    const right = getCell(clientA, 'Sheet1', '1', 'B');
    
    if (left !== 'Left' || right !== 'Right') {
        throw new Error(`Expected "Left", "Right", got "${left}", "${right}"`);
    }
    
    timedLog('✓ Different cells in same row preserved');
});

// ============================================================================
// FORMULA TESTS
// ============================================================================

test('Formula cell sync', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    initSpreadsheet(clientA, 'Sheet1');
    
    // Set values and formula
    setCell(clientA, 'Sheet1', '1', 'A', 10);
    setCell(clientA, 'Sheet1', '2', 'A', 20);
    
    // Store formula as string (evaluation happens in UI)
    const ydoc = clientA.getYDoc();
    const cells = ydoc.getMap('sheet:Sheet1:cells');
    cells.set('A3', {
        value: 30, // Computed value
        formula: '=SUM(A1:A2)',
        type: 'formula',
        updatedAt: Date.now(),
    });
    
    await sleep(500);
    
    // Client B should see the formula
    const cell = clientB.getYDoc().getMap('sheet:Sheet1:cells').get('A3');
    
    if (!cell || cell.formula !== '=SUM(A1:A2)') {
        throw new Error(`Formula not synced: ${JSON.stringify(cell)}`);
    }
    
    timedLog('✓ Formula cell synced');
});

// ============================================================================
// SHEET TABS TESTS
// ============================================================================

test('Add sheet tab syncs', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    // Initialize with first sheet
    const { sheets } = initSpreadsheet(clientA, 'Sheet1');
    await sleep(200);
    
    // Add new sheet
    sheets.push(['Sheet2']);
    initSpreadsheet(clientA, 'Sheet2');
    setCell(clientA, 'Sheet2', '1', 'A', 'Second sheet content');
    
    await sleep(500);
    
    // Client B should see both sheets
    const clientBSheets = clientB.getYDoc().getArray('sheets').toArray();
    
    if (!clientBSheets.includes('Sheet1') || !clientBSheets.includes('Sheet2')) {
        throw new Error(`Missing sheets: ${clientBSheets}`);
    }
    
    // And the cell data
    const value = getCell(clientB, 'Sheet2', '1', 'A');
    if (value !== 'Second sheet content') {
        throw new Error(`Sheet2 cell not synced: "${value}"`);
    }
    
    timedLog('✓ New sheet tab synced');
});

test('Concurrent sheet creation', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    // Initialize
    initSpreadsheet(clientA, 'Sheet1');
    await sleep(200);
    
    // Both clients add sheets at same time
    const sheetsA = clientA.getYDoc().getArray('sheets');
    const sheetsB = clientB.getYDoc().getArray('sheets');
    
    sheetsA.push(['FromA']);
    sheetsB.push(['FromB']);
    
    await sleep(500);
    
    // Both sheets should exist
    const finalSheets = sheetsA.toArray();
    
    if (!finalSheets.includes('FromA') || !finalSheets.includes('FromB')) {
        throw new Error(`Missing sheets: ${finalSheets}`);
    }
    
    timedLog(`✓ Concurrent sheets created: ${finalSheets.join(', ')}`);
});

// ============================================================================
// CELL SELECTION PRESENCE TESTS
// ============================================================================

test('Cell selection presence syncs', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    initSpreadsheet(clientA, 'Sheet1');
    await sleep(200);
    
    // Client A selects a cell
    setCellSelection(clientA, 'Sheet1', '1', 'A');
    
    await sleep(500);
    
    // Client B should see A's selection in awareness
    const states = clientB.getAwarenessStates();
    const found = Array.from(states.values()).find(
        s => s.cell === 'A1' && s.type === 'spreadsheet'
    );
    
    if (!found) {
        throw new Error('Cell selection not seen by other client');
    }
    
    timedLog('✓ Cell selection presence synced');
});

test('Multiple users selecting different cells', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB, clientC] = harness.clients;
    
    initSpreadsheet(clientA, 'Sheet1');
    await sleep(200);
    
    // Each client selects a different cell
    setCellSelection(clientA, 'Sheet1', '1', 'A');
    setCellSelection(clientB, 'Sheet1', '2', 'B');
    setCellSelection(clientC, 'Sheet1', '3', 'C');
    
    await sleep(500);
    
    // Client A should see B and C's selections
    const states = clientA.getAwarenessStates();
    const selections = Array.from(states.values())
        .filter(s => s.type === 'spreadsheet' && s.cell)
        .map(s => s.cell);
    
    // Should have at least B2 and C3 (might also have A1)
    if (!selections.includes('B2') || !selections.includes('C3')) {
        throw new Error(`Missing selections: ${selections}`);
    }
    
    timedLog(`✓ Multiple cell selections visible: ${selections.join(', ')}`);
}, { clientCount: 3 });

// ============================================================================
// BULK OPERATIONS TESTS
// ============================================================================

test('Large data paste (100 cells)', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    initSpreadsheet(clientA, 'Sheet1');
    
    // Paste 10x10 grid
    for (let row = 1; row <= 10; row++) {
        for (let col = 0; col < 10; col++) {
            const colLetter = String.fromCharCode(65 + col); // A-J
            setCell(clientA, 'Sheet1', `${row}`, colLetter, `${colLetter}${row}`);
        }
    }
    
    await sleep(1000);
    
    // Verify sync
    const cellsB = getAllCells(clientB, 'Sheet1');
    const expectedCount = 100;
    const actualCount = Object.keys(cellsB).length;
    
    if (actualCount !== expectedCount) {
        throw new Error(`Expected ${expectedCount} cells, got ${actualCount}`);
    }
    
    // Spot check
    const a1 = getCell(clientB, 'Sheet1', '1', 'A');
    const j10 = getCell(clientB, 'Sheet1', '10', 'J');
    
    if (a1 !== 'A1' || j10 !== 'J10') {
        throw new Error(`Spot check failed: A1="${a1}", J10="${j10}"`);
    }
    
    timedLog('✓ 100 cells pasted and synced');
});

test('Delete cell syncs', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    initSpreadsheet(clientA, 'Sheet1');
    setCell(clientA, 'Sheet1', '1', 'A', 'To be deleted');
    setCell(clientA, 'Sheet1', '2', 'A', 'Keep this');
    await sleep(300);
    
    // Delete cell A1
    const cells = clientA.getYDoc().getMap('sheet:Sheet1:cells');
    cells.delete('A1');
    
    await sleep(500);
    
    // Client B should not see A1
    const value = getCell(clientB, 'Sheet1', '1', 'A');
    const kept = getCell(clientB, 'Sheet1', '2', 'A');
    
    if (value !== undefined) {
        throw new Error(`Deleted cell still visible: "${value}"`);
    }
    
    if (kept !== 'Keep this') {
        throw new Error(`Other cell affected: "${kept}"`);
    }
    
    timedLog('✓ Cell deletion synced');
});

// ============================================================================
// MODULE EXPORTS
// ============================================================================

module.exports = SheetSyncTests;

if (require.main === module) {
    const { runTestSuite } = require('./test-runner-utils');
    runTestSuite(SheetSyncTests).catch(console.error);
}
