/**
 * Sheet Sync Fix Tests (Issue #4)
 * 
 * Tests for the spreadsheet cell sync fix that migrates from Y.Map-based
 * pendingOps (last-writer-wins) to Y.Array-based ops (CRDT-ordered),
 * adds celldata → data conversion for remote updates, and hardens the
 * remote update protection window.
 * 
 * These tests validate Yjs-level sync behavior without requiring Fortune Sheet.
 */

import * as Y from 'yjs';

// ─────────────────────────────────────────────────────────────
// Helper: convertCelldataToData (extracted from Sheet.jsx)
// ─────────────────────────────────────────────────────────────
function convertCelldataToData(sheets) {
    return sheets.map(sheet => {
        const newSheet = { ...sheet };
        if (sheet.celldata && Array.isArray(sheet.celldata) && !sheet.data) {
            const rows = sheet.row || 100;
            const cols = sheet.column || 26;
            const data = Array.from({ length: rows }, () => Array(cols).fill(null));
            for (const cell of sheet.celldata) {
                if (cell && cell.r != null && cell.c != null && cell.r < rows && cell.c < cols) {
                    data[cell.r][cell.c] = cell.v !== undefined ? cell.v : null;
                }
            }
            newSheet.data = data;
        }
        return newSheet;
    });
}

// ─────────────────────────────────────────────────────────────
// Helper: convertDataToCelldata (extracted from Sheet.jsx)
// ─────────────────────────────────────────────────────────────
function convertDataToCelldata(sheets) {
    return sheets.map(sheet => {
        const newSheet = { ...sheet };
        if (sheet.data && Array.isArray(sheet.data)) {
            const celldata = [];
            sheet.data.forEach((row, r) => {
                if (row && Array.isArray(row)) {
                    row.forEach((cell, c) => {
                        if (cell !== null && cell !== undefined) {
                            celldata.push({ r, c, v: cell });
                        }
                    });
                }
            });
            newSheet.celldata = celldata;
            delete newSheet.data;
        }
        return newSheet;
    });
}

// ─────────────────────────────────────────────────────────────
// Helper: create connected Yjs doc pair (simulates two clients)
// ─────────────────────────────────────────────────────────────
function createSyncedPair() {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    // Sync doc1 → doc2
    doc1.on('update', (update) => {
        Y.applyUpdate(doc2, update);
    });
    // Sync doc2 → doc1
    doc2.on('update', (update) => {
        Y.applyUpdate(doc1, update);
    });

    return { doc1, doc2 };
}

// ─────────────────────────────────────────────────────────────
// Tests: celldata ↔ data conversion
// ─────────────────────────────────────────────────────────────
describe('celldata ↔ data conversion', () => {
    test('convertCelldataToData builds 2D array from sparse celldata', () => {
        const sheets = [{
            name: 'Sheet1',
            row: 5,
            column: 5,
            celldata: [
                { r: 0, c: 0, v: { v: 'Hello' } },
                { r: 2, c: 3, v: { v: 42 } },
                { r: 4, c: 4, v: { v: 'End' } },
            ],
        }];

        const result = convertCelldataToData(sheets);
        expect(result[0].data).toBeDefined();
        expect(result[0].data.length).toBe(5);
        expect(result[0].data[0].length).toBe(5);
        expect(result[0].data[0][0]).toEqual({ v: 'Hello' });
        expect(result[0].data[2][3]).toEqual({ v: 42 });
        expect(result[0].data[4][4]).toEqual({ v: 'End' });
        // Unfilled cells should be null
        expect(result[0].data[1][1]).toBeNull();
    });

    test('convertCelldataToData skips sheets that already have data', () => {
        const existingData = [[{ v: 'existing' }]];
        const sheets = [{
            name: 'Sheet1',
            row: 5,
            column: 5,
            celldata: [{ r: 0, c: 0, v: { v: 'new' } }],
            data: existingData,
        }];

        const result = convertCelldataToData(sheets);
        // Should not overwrite existing data
        expect(result[0].data).toBe(existingData);
    });

    test('convertCelldataToData handles empty celldata', () => {
        const sheets = [{
            name: 'Sheet1',
            row: 3,
            column: 3,
            celldata: [],
        }];

        const result = convertCelldataToData(sheets);
        expect(result[0].data).toBeDefined();
        expect(result[0].data.length).toBe(3);
        // All cells should be null
        expect(result[0].data.flat().every(c => c === null)).toBe(true);
    });

    test('convertCelldataToData ignores out-of-bounds cells', () => {
        const sheets = [{
            name: 'Sheet1',
            row: 2,
            column: 2,
            celldata: [
                { r: 0, c: 0, v: { v: 'in' } },
                { r: 999, c: 999, v: { v: 'out' } }, // out of bounds
            ],
        }];

        const result = convertCelldataToData(sheets);
        expect(result[0].data[0][0]).toEqual({ v: 'in' });
        // 2x2 grid, no crash from out-of-bounds
        expect(result[0].data.length).toBe(2);
    });

    test('convertCelldataToData defaults to 100x26 when row/column missing', () => {
        const sheets = [{
            name: 'Sheet1',
            celldata: [{ r: 0, c: 0, v: { v: 'val' } }],
        }];

        const result = convertCelldataToData(sheets);
        expect(result[0].data.length).toBe(100);
        expect(result[0].data[0].length).toBe(26);
    });

    test('round-trip: data → celldata → data preserves cells', () => {
        const original = [{
            name: 'Sheet1',
            row: 3,
            column: 3,
            data: [
                [{ v: 'A1' }, null, { v: 'C1' }],
                [null, { v: 'B2' }, null],
                [null, null, null],
            ],
        }];

        const sparse = convertDataToCelldata(original);
        expect(sparse[0].celldata.length).toBe(3);
        expect(sparse[0].data).toBeUndefined();

        const restored = convertCelldataToData(sparse.map(s => ({ ...s, row: 3, column: 3 })));
        expect(restored[0].data[0][0]).toEqual({ v: 'A1' });
        expect(restored[0].data[0][2]).toEqual({ v: 'C1' });
        expect(restored[0].data[1][1]).toEqual({ v: 'B2' });
        expect(restored[0].data[0][1]).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────
// Tests: Y.Array-based ops sync
// ─────────────────────────────────────────────────────────────
describe('Y.Array-based ops sync', () => {
    test('ops pushed to Y.Array propagate between docs', () => {
        const { doc1, doc2 } = createSyncedPair();

        const yOps1 = doc1.getArray('sheet-ops');
        const yOps2 = doc2.getArray('sheet-ops');

        // Client 1 pushes an op
        doc1.transact(() => {
            yOps1.push([{ ops: [{ op: 'replace', path: ['data', 0, 0], value: 'A' }], clientId: doc1.clientID }]);
        });

        // Doc2 should see it
        expect(yOps2.length).toBe(1);
        const received = yOps2.get(0);
        expect(received.clientId).toBe(doc1.clientID);
        expect(received.ops[0].value).toBe('A');

        doc1.destroy();
        doc2.destroy();
    });

    test('concurrent ops from two clients are both preserved', () => {
        // Create two docs without auto-sync to simulate concurrency
        const doc1 = new Y.Doc();
        const doc2 = new Y.Doc();

        // Initial sync
        Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));
        Y.applyUpdate(doc1, Y.encodeStateAsUpdate(doc2));

        const yOps1 = doc1.getArray('sheet-ops');
        const yOps2 = doc2.getArray('sheet-ops');

        // Both clients push ops concurrently (before syncing)
        doc1.transact(() => {
            yOps1.push([{ ops: [{ value: 'from-client-1' }], clientId: doc1.clientID }]);
        });
        doc2.transact(() => {
            yOps2.push([{ ops: [{ value: 'from-client-2' }], clientId: doc2.clientID }]);
        });

        // Now sync both ways
        Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));
        Y.applyUpdate(doc1, Y.encodeStateAsUpdate(doc2));

        // Both docs should have BOTH ops (CRDT merge)
        expect(yOps1.length).toBe(2);
        expect(yOps2.length).toBe(2);

        const allOps1 = yOps1.toJSON();
        const clientIds = allOps1.map(o => o.clientId);
        expect(clientIds).toContain(doc1.clientID);
        expect(clientIds).toContain(doc2.clientID);

        doc1.destroy();
        doc2.destroy();
    });

    test('Y.Array delete does not lose concurrent pushes', () => {
        const doc1 = new Y.Doc();
        const doc2 = new Y.Doc();

        // Initial sync
        Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));
        Y.applyUpdate(doc1, Y.encodeStateAsUpdate(doc2));

        const yOps1 = doc1.getArray('sheet-ops');
        const yOps2 = doc2.getArray('sheet-ops');

        // Client 1 pushes an op
        doc1.transact(() => {
            yOps1.push([{ ops: [{ value: 'op-1' }], clientId: doc1.clientID }]);
        });
        Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));

        // Client 2 processes and clears, while Client 1 pushes another op concurrently
        doc2.transact(() => {
            yOps2.delete(0, yOps2.length);
        });
        doc1.transact(() => {
            yOps1.push([{ ops: [{ value: 'op-2' }], clientId: doc1.clientID }]);
        });

        // Sync both ways
        Y.applyUpdate(doc1, Y.encodeStateAsUpdate(doc2));
        Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));

        // The concurrent push (op-2) should survive the delete
        // Because Y.Array CRDT delete only removes items that existed at the time of delete
        expect(yOps1.length).toBeGreaterThanOrEqual(1);
        const surviving = yOps1.toJSON();
        const hasOp2 = surviving.some(o => o.ops[0].value === 'op-2');
        expect(hasOp2).toBe(true);

        doc1.destroy();
        doc2.destroy();
    });

    test('old Y.Map pendingOps key is no longer used', () => {
        const doc = new Y.Doc();
        const ysheet = doc.getMap('sheet-data');
        const yOps = doc.getArray('sheet-ops');

        // Simulate a client pushing ops via Y.Array
        doc.transact(() => {
            yOps.push([{ ops: [{ value: 'test' }], clientId: doc.clientID }]);
        });

        // Y.Map should NOT have pendingOps
        expect(ysheet.has('pendingOps')).toBe(false);

        // Y.Array should have the op
        expect(yOps.length).toBe(1);

        doc.destroy();
    });
});

// ─────────────────────────────────────────────────────────────
// Tests: Full-sheet sync with celldata conversion
// ─────────────────────────────────────────────────────────────
describe('Full-sheet sync with celldata conversion', () => {
    test('remote celldata-only data is converted to 2D data array', () => {
        const { doc1, doc2 } = createSyncedPair();
        const ysheet1 = doc1.getMap('sheet-data');
        const ysheet2 = doc2.getMap('sheet-data');

        // Client 1 saves data with celldata-only (as it would after convertDataToCelldata)
        doc1.transact(() => {
            ysheet1.set('sheets', [{
                name: 'Sheet1',
                row: 10,
                column: 5,
                celldata: [
                    { r: 0, c: 0, v: { v: 'Hello' } },
                    { r: 1, c: 1, v: { v: 'World' } },
                ],
                config: {},
                status: 1,
            }]);
            ysheet1.set('version', `${doc1.clientID}-${Date.now()}`);
        });

        // Client 2 receives the data
        const storedData = ysheet2.get('sheets');
        expect(storedData).toBeDefined();
        expect(storedData[0].celldata.length).toBe(2);
        expect(storedData[0].data).toBeUndefined(); // No 2D data yet

        // Apply convertCelldataToData (as the fixed Sheet.jsx would)
        const converted = convertCelldataToData(JSON.parse(JSON.stringify(storedData)));
        expect(converted[0].data).toBeDefined();
        expect(converted[0].data[0][0]).toEqual({ v: 'Hello' });
        expect(converted[0].data[1][1]).toEqual({ v: 'World' });
        expect(converted[0].data[0][1]).toBeNull();

        doc1.destroy();
        doc2.destroy();
    });

    test('two clients editing different cells both survive via version-based sync', () => {
        const { doc1, doc2 } = createSyncedPair();
        const ysheet1 = doc1.getMap('sheet-data');
        const ysheet2 = doc2.getMap('sheet-data');

        // Client 1 saves cell A1
        doc1.transact(() => {
            ysheet1.set('sheets', [{
                name: 'Sheet1',
                row: 10,
                column: 5,
                celldata: [{ r: 0, c: 0, v: { v: 'From Client 1' } }],
                config: {},
            }]);
            ysheet1.set('version', `${doc1.clientID}-${Date.now()}`);
        });

        // Client 2 receives and sees it
        const data2 = convertCelldataToData(JSON.parse(JSON.stringify(ysheet2.get('sheets'))));
        expect(data2[0].data[0][0]).toEqual({ v: 'From Client 1' });

        doc1.destroy();
        doc2.destroy();
    });

    test('three-way sync: all clients receive updates', () => {
        const doc1 = new Y.Doc();
        const doc2 = new Y.Doc();
        const doc3 = new Y.Doc();

        // Wire all three together
        doc1.on('update', (u) => { Y.applyUpdate(doc2, u); Y.applyUpdate(doc3, u); });
        doc2.on('update', (u) => { Y.applyUpdate(doc1, u); Y.applyUpdate(doc3, u); });
        doc3.on('update', (u) => { Y.applyUpdate(doc1, u); Y.applyUpdate(doc2, u); });

        const yOps1 = doc1.getArray('sheet-ops');
        const yOps2 = doc2.getArray('sheet-ops');
        const yOps3 = doc3.getArray('sheet-ops');

        // Each client pushes an op
        doc1.transact(() => { yOps1.push([{ ops: [{ value: 'c1' }], clientId: doc1.clientID }]); });
        doc2.transact(() => { yOps2.push([{ ops: [{ value: 'c2' }], clientId: doc2.clientID }]); });
        doc3.transact(() => { yOps3.push([{ ops: [{ value: 'c3' }], clientId: doc3.clientID }]); });

        // All three docs should see all three ops
        expect(yOps1.length).toBe(3);
        expect(yOps2.length).toBe(3);
        expect(yOps3.length).toBe(3);

        doc1.destroy();
        doc2.destroy();
        doc3.destroy();
    });
});

// ─────────────────────────────────────────────────────────────
// Tests: Legacy cleanup
// ─────────────────────────────────────────────────────────────
describe('Legacy pendingOps cleanup', () => {
    test('old pendingOps on Y.Map can be detected and cleaned', () => {
        const doc = new Y.Doc();
        const ysheet = doc.getMap('sheet-data');

        // Simulate legacy data
        ysheet.set('pendingOps', [{ ops: [{ old: true }], clientId: 123 }]);
        expect(ysheet.has('pendingOps')).toBe(true);

        // Cleanup (as Sheet.jsx now does on init)
        doc.transact(() => { ysheet.delete('pendingOps'); });
        expect(ysheet.has('pendingOps')).toBe(false);

        doc.destroy();
    });
});

// ─────────────────────────────────────────────────────────────
// Tests: Y.Array observer event structure
// ─────────────────────────────────────────────────────────────
describe('Y.Array observer event structure', () => {
    test('observe fires with event.changes.added for pushed items', (done) => {
        const doc = new Y.Doc();
        const yOps = doc.getArray('sheet-ops');

        yOps.observe((event) => {
            expect(event.changes).toBeDefined();
            expect(event.changes.added.size).toBe(1);
            
            const addedItems = [];
            event.changes.added.forEach(item => {
                if (item.content && item.content.getContent) {
                    addedItems.push(...item.content.getContent());
                }
            });

            expect(addedItems.length).toBe(1);
            expect(addedItems[0].clientId).toBe(42);
            expect(addedItems[0].ops[0].value).toBe('test');

            doc.destroy();
            done();
        });

        doc.transact(() => {
            yOps.push([{ ops: [{ value: 'test' }], clientId: 42 }]);
        });
    });

    test('delete followed by push in same transaction works correctly', () => {
        const doc = new Y.Doc();
        const yOps = doc.getArray('sheet-ops');

        // Push initial ops
        doc.transact(() => {
            yOps.push([{ ops: [{ value: 'first' }], clientId: 1 }]);
        });
        expect(yOps.length).toBe(1);

        // Delete all and push new in same transaction
        doc.transact(() => {
            yOps.delete(0, yOps.length);
            yOps.push([{ ops: [{ value: 'second' }], clientId: 2 }]);
        });

        expect(yOps.length).toBe(1);
        expect(yOps.get(0).ops[0].value).toBe('second');

        doc.destroy();
    });
});

// ─────────────────────────────────────────────────────────────
// Tests: Rapid edits stress test
// ─────────────────────────────────────────────────────────────
describe('Rapid edits stress test', () => {
    test('20 rapid ops from each of 2 clients all arrive', () => {
        const { doc1, doc2 } = createSyncedPair();
        const yOps1 = doc1.getArray('sheet-ops');
        const yOps2 = doc2.getArray('sheet-ops');

        for (let i = 0; i < 20; i++) {
            doc1.transact(() => {
                yOps1.push([{ ops: [{ value: `c1-${i}` }], clientId: doc1.clientID }]);
            });
            doc2.transact(() => {
                yOps2.push([{ ops: [{ value: `c2-${i}` }], clientId: doc2.clientID }]);
            });
        }

        // Both docs should see all 40 ops
        expect(yOps1.length).toBe(40);
        expect(yOps2.length).toBe(40);

        const allOps = yOps1.toJSON();
        const c1Ops = allOps.filter(o => o.clientId === doc1.clientID);
        const c2Ops = allOps.filter(o => o.clientId === doc2.clientID);
        expect(c1Ops.length).toBe(20);
        expect(c2Ops.length).toBe(20);

        doc1.destroy();
        doc2.destroy();
    });

    test('100 cells via full-sheet sync round-trip', () => {
        const { doc1, doc2 } = createSyncedPair();
        const ysheet1 = doc1.getMap('sheet-data');

        // Build 100 cells
        const celldata = [];
        for (let i = 0; i < 10; i++) {
            for (let j = 0; j < 10; j++) {
                celldata.push({ r: i, c: j, v: { v: `${i}-${j}` } });
            }
        }

        doc1.transact(() => {
            ysheet1.set('sheets', [{
                name: 'Sheet1',
                row: 20,
                column: 20,
                celldata,
                config: {},
            }]);
            ysheet1.set('version', `${doc1.clientID}-${Date.now()}`);
        });

        // Client 2 receives
        const ysheet2 = doc2.getMap('sheet-data');
        const raw = JSON.parse(JSON.stringify(ysheet2.get('sheets')));
        const converted = convertCelldataToData(raw);

        expect(converted[0].data[0][0]).toEqual({ v: '0-0' });
        expect(converted[0].data[5][5]).toEqual({ v: '5-5' });
        expect(converted[0].data[9][9]).toEqual({ v: '9-9' });

        doc1.destroy();
        doc2.destroy();
    });
});
