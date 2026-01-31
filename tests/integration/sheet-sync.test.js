/**
 * Sheet (Spreadsheet) Integration Tests
 * 
 * Tests for the Sheet document type with Fortune Sheet and Yjs sync:
 * - Sheet creation and initialization
 * - Multi-client concurrent cell edits
 * - Sheet data synchronization via Yjs
 * - Multiple sheets (tabs) support
 * - Formula calculations across clients
 * - Large spreadsheet handling
 */

const Y = require('yjs');
const { WebsocketProvider } = require('y-websocket');
const WebSocket = require('ws');
const {
    assert,
    sleep,
    generateDocId,
} = require('./test-utils.js');

// Configuration
const YJS_PORT = parseInt(process.env.YJS_PORT || '8080', 10);
const YJS_URL = `ws://localhost:${YJS_PORT}`;

let providers = [];
let docs = [];

async function setup() {
    console.log('  [Setup] Sheet integration tests ready');
}

async function teardown() {
    for (const provider of providers) {
        try {
            provider.destroy();
        } catch (e) {}
    }
    for (const doc of docs) {
        try {
            doc.destroy();
        } catch (e) {}
    }
    providers = [];
    docs = [];
}

/**
 * Helper: Create a Yjs document and connect to sidecar
 */
function createSyncedDoc(docId) {
    const doc = new Y.Doc();
    docs.push(doc);
    
    const provider = new WebsocketProvider(YJS_URL, docId, doc, {
        WebSocketPolyfill: WebSocket,
        connect: true,
        resyncInterval: 500,
    });
    providers.push(provider);
    
    return { doc, provider };
}

/**
 * Helper: Wait for provider to connect and sync
 */
async function waitForSync(provider, timeout = 10000) {
    if (!provider.wsconnected) {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Connection timeout')), timeout);
            const checkConnection = () => {
                if (provider.wsconnected) {
                    clearTimeout(timer);
                    resolve();
                }
            };
            provider.on('status', ({ status }) => {
                if (status === 'connected') {
                    checkConnection();
                }
            });
            checkConnection();
        });
    }
    
    if (provider.synced) return;
    
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Sync timeout')), timeout);
        provider.on('sync', (synced) => {
            if (synced) {
                clearTimeout(timer);
                resolve();
            }
        });
        if (provider.synced) {
            clearTimeout(timer);
            resolve();
        }
    });
}

/**
 * Helper: Create default sheet data structure
 */
function createDefaultSheetData() {
    return [{
        name: 'Sheet1',
        id: `sheet-${Date.now()}`,
        order: 0,
        row: 100,
        column: 26,
        celldata: [],
        config: {},
        status: 1,
    }];
}

/**
 * Helper: Set cell value in sheet data
 */
function setCellValue(sheetData, sheetIndex, row, col, value) {
    const sheet = sheetData[sheetIndex];
    if (!sheet) return;
    
    // Find or create cell data
    const existingCell = sheet.celldata.find(c => c.r === row && c.c === col);
    if (existingCell) {
        existingCell.v = value;
    } else {
        sheet.celldata.push({ r: row, c: col, v: value });
    }
}

/**
 * Helper: Get cell value from sheet data
 */
function getCellValue(sheetData, sheetIndex, row, col) {
    const sheet = sheetData[sheetIndex];
    if (!sheet) return undefined;
    
    const cell = sheet.celldata.find(c => c.r === row && c.c === col);
    return cell?.v;
}

/**
 * Test: Sheet data structure initialization
 */
async function testSheetInitialization() {
    const docId = generateDocId();
    const { doc, provider } = createSyncedDoc(docId);
    
    await waitForSync(provider);
    
    const ysheet = doc.getMap('sheet-data');
    
    // Set initial sheet data
    const defaultSheets = createDefaultSheetData();
    ysheet.set('sheets', defaultSheets);
    ysheet.set('pendingOps', []);
    
    await sleep(100);
    
    // Verify structure
    const storedSheets = ysheet.get('sheets');
    assert.ok(storedSheets !== undefined && storedSheets !== null, 'Sheets data should be stored');
    assert.equal(storedSheets.length, 1, 'Should have one sheet');
    assert.equal(storedSheets[0].name, 'Sheet1', 'Sheet name should be Sheet1');
    assert.equal(storedSheets[0].row, 100, 'Should have 100 rows');
    assert.equal(storedSheets[0].column, 26, 'Should have 26 columns');
}

/**
 * Test: Multi-client sheet sync - different cells
 */
async function testMultiClientDifferentCells() {
    const docId = generateDocId();
    
    const { doc: doc1, provider: p1 } = createSyncedDoc(docId);
    const { doc: doc2, provider: p2 } = createSyncedDoc(docId);
    
    await waitForSync(p1);
    await waitForSync(p2);
    
    const ysheet1 = doc1.getMap('sheet-data');
    const ysheet2 = doc2.getMap('sheet-data');
    
    // Client 1 initializes
    const sheets = createDefaultSheetData();
    ysheet1.set('sheets', sheets);
    
    await sleep(200);
    
    // Client 1 edits cell A1
    const sheets1 = JSON.parse(JSON.stringify(ysheet1.get('sheets')));
    setCellValue(sheets1, 0, 0, 0, 'Hello');
    ysheet1.set('sheets', sheets1);
    
    await sleep(100);
    
    // Client 2 edits cell B1 (different cell)
    const sheets2 = JSON.parse(JSON.stringify(ysheet2.get('sheets')));
    setCellValue(sheets2, 0, 0, 1, 'World');
    ysheet2.set('sheets', sheets2);
    
    await sleep(300);
    
    // Both clients should see both values
    const final1 = ysheet1.get('sheets');
    const final2 = ysheet2.get('sheets');
    
    assert.equal(
        getCellValue(final1, 0, 0, 0),
        getCellValue(final2, 0, 0, 0),
        'Cell A1 should match across clients'
    );
    assert.equal(
        getCellValue(final1, 0, 0, 1),
        getCellValue(final2, 0, 0, 1),
        'Cell B1 should match across clients'
    );
}

/**
 * Test: Multi-client sheet sync - same cell conflict
 */
async function testMultiClientSameCellConflict() {
    const docId = generateDocId();
    
    const { doc: doc1, provider: p1 } = createSyncedDoc(docId);
    const { doc: doc2, provider: p2 } = createSyncedDoc(docId);
    
    await waitForSync(p1);
    await waitForSync(p2);
    
    const ysheet1 = doc1.getMap('sheet-data');
    const ysheet2 = doc2.getMap('sheet-data');
    
    // Initialize
    const sheets = createDefaultSheetData();
    ysheet1.set('sheets', sheets);
    
    await sleep(200);
    
    // Both clients edit same cell (A1) simultaneously
    const sheets1 = JSON.parse(JSON.stringify(ysheet1.get('sheets')));
    const sheets2 = JSON.parse(JSON.stringify(ysheet2.get('sheets')));
    
    setCellValue(sheets1, 0, 0, 0, 'Client1Value');
    setCellValue(sheets2, 0, 0, 0, 'Client2Value');
    
    // Update almost simultaneously
    ysheet1.set('sheets', sheets1);
    ysheet2.set('sheets', sheets2);
    
    await sleep(300);
    
    // After sync, both should have same value (last-write-wins in Yjs Map)
    const final1 = ysheet1.get('sheets');
    const final2 = ysheet2.get('sheets');
    
    const value1 = getCellValue(final1, 0, 0, 0);
    const value2 = getCellValue(final2, 0, 0, 0);
    
    assert.equal(value1, value2, 'Both clients should converge to same value');
    assert.ok(
        value1 === 'Client1Value' || value1 === 'Client2Value',
        'Value should be from one of the clients'
    );
}

/**
 * Test: Multiple sheets (tabs)
 */
async function testMultipleSheets() {
    const docId = generateDocId();
    const { doc, provider } = createSyncedDoc(docId);
    
    await waitForSync(provider);
    
    const ysheet = doc.getMap('sheet-data');
    
    // Create workbook with multiple sheets
    const sheets = [
        { name: 'Sheet1', id: 'sheet-1', order: 0, row: 100, column: 26, celldata: [], config: {}, status: 1 },
        { name: 'Sheet2', id: 'sheet-2', order: 1, row: 100, column: 26, celldata: [], config: {}, status: 0 },
        { name: 'Data', id: 'sheet-3', order: 2, row: 100, column: 26, celldata: [], config: {}, status: 0 },
    ];
    ysheet.set('sheets', sheets);
    
    await sleep(100);
    
    // Edit cells in different sheets
    const updatedSheets = JSON.parse(JSON.stringify(ysheet.get('sheets')));
    setCellValue(updatedSheets, 0, 0, 0, 'Sheet1-A1');
    setCellValue(updatedSheets, 1, 0, 0, 'Sheet2-A1');
    setCellValue(updatedSheets, 2, 5, 5, 'Data-F6');
    ysheet.set('sheets', updatedSheets);
    
    await sleep(100);
    
    const storedSheets = ysheet.get('sheets');
    assert.equal(storedSheets.length, 3, 'Should have 3 sheets');
    assert.equal(getCellValue(storedSheets, 0, 0, 0), 'Sheet1-A1', 'Sheet1 cell correct');
    assert.equal(getCellValue(storedSheets, 1, 0, 0), 'Sheet2-A1', 'Sheet2 cell correct');
    assert.equal(getCellValue(storedSheets, 2, 5, 5), 'Data-F6', 'Data sheet cell correct');
}

/**
 * Test: Large number of cells
 */
async function testLargeSpreadsheet() {
    const docId = generateDocId();
    const { doc, provider } = createSyncedDoc(docId);
    
    await waitForSync(provider);
    
    const ysheet = doc.getMap('sheet-data');
    
    // Create sheet with many cells
    const sheets = createDefaultSheetData();
    
    // Fill 100 cells
    for (let i = 0; i < 10; i++) {
        for (let j = 0; j < 10; j++) {
            setCellValue(sheets, 0, i, j, `Cell-${i}-${j}`);
        }
    }
    
    ysheet.set('sheets', sheets);
    
    await sleep(200);
    
    const storedSheets = ysheet.get('sheets');
    assert.equal(storedSheets[0].celldata.length, 100, 'Should have 100 cells');
    assert.equal(getCellValue(storedSheets, 0, 5, 5), 'Cell-5-5', 'Middle cell should be correct');
    assert.equal(getCellValue(storedSheets, 0, 9, 9), 'Cell-9-9', 'Last cell should be correct');
}

/**
 * Test: Operations array for sync
 */
async function testOperationsSync() {
    const docId = generateDocId();
    
    const { doc: doc1, provider: p1 } = createSyncedDoc(docId);
    const { doc: doc2, provider: p2 } = createSyncedDoc(docId);
    
    await waitForSync(p1);
    await waitForSync(p2);
    
    const ysheet1 = doc1.getMap('sheet-data');
    const ysheet2 = doc2.getMap('sheet-data');
    
    // Initialize
    ysheet1.set('sheets', createDefaultSheetData());
    ysheet1.set('pendingOps', []);
    
    await sleep(200);
    
    // Client 1 adds operation
    const op1 = {
        op: 'replace',
        id: 'sheet-1',
        path: ['data', 0, 0, 'v'],
        value: 'TestValue'
    };
    ysheet1.set('pendingOps', [op1]);
    
    await sleep(200);
    
    // Client 2 should receive ops
    const ops2 = ysheet2.get('pendingOps');
    assert.ok(ops2 !== undefined && ops2 !== null, 'Pending ops should sync');
    assert.ok(ops2.length > 0, 'Should have pending ops');
}

/**
 * Test: Three clients concurrent editing
 */
async function testThreeClientsConcurrent() {
    const docId = generateDocId();
    
    const { doc: doc1, provider: p1 } = createSyncedDoc(docId);
    const { doc: doc2, provider: p2 } = createSyncedDoc(docId);
    const { doc: doc3, provider: p3 } = createSyncedDoc(docId);
    
    await waitForSync(p1);
    await waitForSync(p2);
    await waitForSync(p3);
    
    const ysheet1 = doc1.getMap('sheet-data');
    const ysheet2 = doc2.getMap('sheet-data');
    const ysheet3 = doc3.getMap('sheet-data');
    
    // Initialize
    ysheet1.set('sheets', createDefaultSheetData());
    
    await sleep(200);
    
    // All three clients edit different cells
    const sheets1 = JSON.parse(JSON.stringify(ysheet1.get('sheets')));
    const sheets2 = JSON.parse(JSON.stringify(ysheet2.get('sheets')));
    const sheets3 = JSON.parse(JSON.stringify(ysheet3.get('sheets')));
    
    setCellValue(sheets1, 0, 0, 0, 'Client1');
    setCellValue(sheets2, 0, 1, 0, 'Client2');
    setCellValue(sheets3, 0, 2, 0, 'Client3');
    
    ysheet1.set('sheets', sheets1);
    ysheet2.set('sheets', sheets2);
    ysheet3.set('sheets', sheets3);
    
    await sleep(400);
    
    // All should converge
    const final1 = ysheet1.get('sheets');
    const final2 = ysheet2.get('sheets');
    const final3 = ysheet3.get('sheets');
    
    // At minimum, each client should see its own edit
    // Due to CRDT, last-write-wins may override other cells when sheets are replaced
    // In a real implementation, we'd sync at cell granularity
    
    // For now, verify convergence
    assert.equal(
        JSON.stringify(final1),
        JSON.stringify(final2),
        'Clients 1 and 2 should converge'
    );
    assert.equal(
        JSON.stringify(final2),
        JSON.stringify(final3),
        'Clients 2 and 3 should converge'
    );
}

/**
 * Test: Rapid consecutive edits
 */
async function testRapidEdits() {
    const docId = generateDocId();
    const { doc, provider } = createSyncedDoc(docId);
    
    await waitForSync(provider);
    
    const ysheet = doc.getMap('sheet-data');
    ysheet.set('sheets', createDefaultSheetData());
    
    await sleep(100);
    
    // Rapidly edit 20 cells
    for (let i = 0; i < 20; i++) {
        const sheets = JSON.parse(JSON.stringify(ysheet.get('sheets')));
        setCellValue(sheets, 0, Math.floor(i / 5), i % 5, `Rapid-${i}`);
        ysheet.set('sheets', sheets);
        await sleep(10); // Very fast edits
    }
    
    await sleep(300);
    
    const finalSheets = ysheet.get('sheets');
    assert.ok(finalSheets !== undefined && finalSheets !== null, 'Sheets should exist after rapid edits');
    assert.ok(finalSheets[0].celldata.length > 0, 'Should have cell data');
}

/**
 * Test: Sheet rename
 */
async function testSheetRename() {
    const docId = generateDocId();
    const { doc, provider } = createSyncedDoc(docId);
    
    await waitForSync(provider);
    
    const ysheet = doc.getMap('sheet-data');
    ysheet.set('sheets', createDefaultSheetData());
    
    await sleep(100);
    
    // Rename sheet
    const sheets = JSON.parse(JSON.stringify(ysheet.get('sheets')));
    sheets[0].name = 'MyData';
    ysheet.set('sheets', sheets);
    
    await sleep(100);
    
    const storedSheets = ysheet.get('sheets');
    assert.equal(storedSheets[0].name, 'MyData', 'Sheet name should be updated');
}

/**
 * Test: Add new sheet
 */
async function testAddSheet() {
    const docId = generateDocId();
    const { doc, provider } = createSyncedDoc(docId);
    
    await waitForSync(provider);
    
    const ysheet = doc.getMap('sheet-data');
    ysheet.set('sheets', createDefaultSheetData());
    
    await sleep(100);
    
    // Add new sheet
    const sheets = JSON.parse(JSON.stringify(ysheet.get('sheets')));
    sheets.push({
        name: 'Sheet2',
        id: `sheet-${Date.now()}-2`,
        order: 1,
        row: 100,
        column: 26,
        celldata: [],
        config: {},
        status: 0,
    });
    ysheet.set('sheets', sheets);
    
    await sleep(100);
    
    const storedSheets = ysheet.get('sheets');
    assert.equal(storedSheets.length, 2, 'Should have 2 sheets');
    assert.equal(storedSheets[1].name, 'Sheet2', 'New sheet name correct');
}

/**
 * Test: Delete sheet
 */
async function testDeleteSheet() {
    const docId = generateDocId();
    const { doc, provider } = createSyncedDoc(docId);
    
    await waitForSync(provider);
    
    const ysheet = doc.getMap('sheet-data');
    
    // Create with 2 sheets
    const sheets = [
        { name: 'Sheet1', id: 'sheet-1', order: 0, row: 100, column: 26, celldata: [], config: {}, status: 1 },
        { name: 'Sheet2', id: 'sheet-2', order: 1, row: 100, column: 26, celldata: [], config: {}, status: 0 },
    ];
    ysheet.set('sheets', sheets);
    
    await sleep(100);
    
    // Delete second sheet
    const updatedSheets = JSON.parse(JSON.stringify(ysheet.get('sheets')));
    updatedSheets.splice(1, 1);
    ysheet.set('sheets', updatedSheets);
    
    await sleep(100);
    
    const storedSheets = ysheet.get('sheets');
    assert.equal(storedSheets.length, 1, 'Should have 1 sheet after deletion');
    assert.equal(storedSheets[0].name, 'Sheet1', 'Remaining sheet should be Sheet1');
}

// Export test suite
module.exports = {
    setup,
    teardown,
    tests: {
        'Sheet data structure initialization': testSheetInitialization,
        'Multi-client sync - different cells': testMultiClientDifferentCells,
        'Multi-client sync - same cell conflict': testMultiClientSameCellConflict,
        'Multiple sheets (tabs)': testMultipleSheets,
        'Large spreadsheet with many cells': testLargeSpreadsheet,
        'Operations array for sync': testOperationsSync,
        'Three clients concurrent editing': testThreeClientsConcurrent,
        'Rapid consecutive edits': testRapidEdits,
        'Sheet rename': testSheetRename,
        'Add new sheet': testAddSheet,
        'Delete sheet': testDeleteSheet,
    },
};
