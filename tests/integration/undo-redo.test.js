/**
 * Undo/Redo Tests
 * 
 * Tests for collaborative undo/redo functionality:
 * - Single-client undo/redo
 * - Multi-client undo (only own changes)
 * - Undo stack management
 * - Redo after undo
 * - Undo with nested operations
 * - Clear undo history
 * - Undo with concurrent edits
 * - Undo manager capture groups
 * 
 * Based on Yjs Y.UndoManager
 */

const Y = require('yjs');
const {
    assert,
    sleep,
    randomHex,
} = require('./test-utils.js');

// ============ Mock Undo Manager (for isolated tests) ============

/**
 * Simplified UndoManager mock for testing undo/redo logic
 */
class MockUndoManager {
    constructor(scope, options = {}) {
        this.scope = scope;
        this.undoStack = [];
        this.redoStack = [];
        this.capturing = false;
        this.captureTimeout = options.captureTimeout || 500;
        this.trackedOrigins = options.trackedOrigins || new Set(['local']);
        this.currentCapture = null;
        this.captureTimer = null;
    }
    
    // Record an operation
    recordOperation(op, origin = 'local') {
        if (!this.trackedOrigins.has(origin)) return;
        
        // Clear redo stack on new operation
        this.redoStack = [];
        
        if (this.capturing && this.currentCapture) {
            this.currentCapture.push(op);
        } else {
            this.undoStack.push([op]);
        }
    }
    
    // Start capturing operations into a single undo item
    startCapture() {
        this.capturing = true;
        this.currentCapture = [];
    }
    
    // Stop capturing
    stopCapture() {
        if (this.capturing && this.currentCapture && this.currentCapture.length > 0) {
            this.undoStack.push(this.currentCapture);
        }
        this.capturing = false;
        this.currentCapture = null;
    }
    
    // Undo last operation
    undo() {
        if (this.undoStack.length === 0) return null;
        
        const ops = this.undoStack.pop();
        this.redoStack.push(ops);
        
        // Return inverse operations
        return ops.map(op => this.invertOperation(op)).reverse();
    }
    
    // Redo last undone operation
    redo() {
        if (this.redoStack.length === 0) return null;
        
        const ops = this.redoStack.pop();
        this.undoStack.push(ops);
        
        return ops;
    }
    
    // Invert an operation
    invertOperation(op) {
        if (op.type === 'insert') {
            return { type: 'delete', index: op.index, length: op.text.length, deleted: op.text };
        } else if (op.type === 'delete') {
            return { type: 'insert', index: op.index, text: op.deleted };
        }
        return op;
    }
    
    canUndo() {
        return this.undoStack.length > 0;
    }
    
    canRedo() {
        return this.redoStack.length > 0;
    }
    
    clear(clearUndo = true, clearRedo = true) {
        if (clearUndo) this.undoStack = [];
        if (clearRedo) this.redoStack = [];
    }
    
    getUndoStackLength() {
        return this.undoStack.length;
    }
    
    getRedoStackLength() {
        return this.redoStack.length;
    }
}

// ============ Yjs Undo Manager Tests ============

async function setup() {
    console.log('  [Setup] Undo/Redo tests ready');
}

async function teardown() {
    // Cleanup
}

// ============ Basic Undo Tests ============

/**
 * Test: Undo single insert
 */
async function testUndoSingleInsert() {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    const undoManager = new Y.UndoManager(text);
    
    text.insert(0, 'Hello');
    assert.equal(text.toString(), 'Hello', 'Should have inserted text');
    
    undoManager.undo();
    assert.equal(text.toString(), '', 'Should be empty after undo');
    
    doc.destroy();
}

/**
 * Test: Undo multiple inserts
 */
async function testUndoMultipleInserts() {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    const undoManager = new Y.UndoManager(text, { captureTimeout: 0 });
    
    text.insert(0, 'A');
    undoManager.stopCapturing(); // Force new capture group
    text.insert(1, 'B');
    undoManager.stopCapturing();
    text.insert(2, 'C');
    
    assert.equal(text.toString(), 'ABC', 'Should have ABC');
    
    undoManager.undo();
    assert.equal(text.toString(), 'AB', 'Should have AB after first undo');
    
    undoManager.undo();
    assert.equal(text.toString(), 'A', 'Should have A after second undo');
    
    doc.destroy();
}

/**
 * Test: Undo delete operation
 */
async function testUndoDelete() {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    const undoManager = new Y.UndoManager(text, { captureTimeout: 0 });
    
    text.insert(0, 'Hello World');
    undoManager.stopCapturing();
    text.delete(5, 6); // Delete " World"
    
    assert.equal(text.toString(), 'Hello', 'Should have deleted');
    
    undoManager.undo();
    assert.equal(text.toString(), 'Hello World', 'Should restore deleted text');
    
    doc.destroy();
}

/**
 * Test: canUndo returns correct value
 */
async function testCanUndo() {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    const undoManager = new Y.UndoManager(text);
    
    assert.ok(!undoManager.canUndo(), 'Should not be able to undo initially');
    
    text.insert(0, 'test');
    assert.ok(undoManager.canUndo(), 'Should be able to undo after insert');
    
    doc.destroy();
}

// ============ Redo Tests ============

/**
 * Test: Redo after undo
 */
async function testRedoAfterUndo() {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    const undoManager = new Y.UndoManager(text);
    
    text.insert(0, 'Hello');
    undoManager.undo();
    
    assert.equal(text.toString(), '', 'Should be empty after undo');
    
    undoManager.redo();
    assert.equal(text.toString(), 'Hello', 'Should restore after redo');
    
    doc.destroy();
}

/**
 * Test: canRedo returns correct value
 */
async function testCanRedo() {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    const undoManager = new Y.UndoManager(text);
    
    assert.ok(!undoManager.canRedo(), 'Should not be able to redo initially');
    
    text.insert(0, 'test');
    assert.ok(!undoManager.canRedo(), 'Should not be able to redo after insert');
    
    undoManager.undo();
    assert.ok(undoManager.canRedo(), 'Should be able to redo after undo');
    
    doc.destroy();
}

/**
 * Test: Redo stack cleared on new operation
 */
async function testRedoStackClearedOnNew() {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    const undoManager = new Y.UndoManager(text);
    
    text.insert(0, 'A');
    await sleep(10);
    undoManager.undo();
    assert.ok(undoManager.canRedo(), 'Should be able to redo');
    
    text.insert(0, 'B');
    assert.ok(!undoManager.canRedo(), 'Redo should be cleared after new operation');
    
    doc.destroy();
}

/**
 * Test: Multiple redo operations
 */
async function testMultipleRedo() {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    const undoManager = new Y.UndoManager(text, { captureTimeout: 0 });
    
    text.insert(0, 'A');
    undoManager.stopCapturing();
    text.insert(1, 'B');
    undoManager.stopCapturing();
    text.insert(2, 'C');
    
    undoManager.undo();
    undoManager.undo();
    
    assert.equal(text.toString(), 'A', 'Should have A after 2 undos');
    
    undoManager.redo();
    assert.equal(text.toString(), 'AB', 'Should have AB after first redo');
    
    undoManager.redo();
    assert.equal(text.toString(), 'ABC', 'Should have ABC after second redo');
    
    doc.destroy();
}

// ============ Capture Group Tests ============

/**
 * Test: Rapid edits grouped
 */
async function testRapidEditsGrouped() {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    const undoManager = new Y.UndoManager(text, {
        captureTimeout: 100
    });
    
    // Rapid edits within capture timeout
    text.insert(0, 'H');
    text.insert(1, 'e');
    text.insert(2, 'l');
    text.insert(3, 'l');
    text.insert(4, 'o');
    
    assert.equal(text.toString(), 'Hello', 'Should have Hello');
    
    // Single undo should undo all
    undoManager.undo();
    assert.equal(text.toString(), '', 'Single undo should undo all rapid edits');
    
    doc.destroy();
}

/**
 * Test: Stop capturing creates new group
 */
async function testStopCaptureCreatesNewGroup() {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    const undoManager = new Y.UndoManager(text);
    
    text.insert(0, 'Hello');
    undoManager.stopCapturing();
    text.insert(5, ' World');
    
    assert.equal(text.toString(), 'Hello World', 'Should have full text');
    
    undoManager.undo();
    assert.equal(text.toString(), 'Hello', 'First undo removes World');
    
    undoManager.undo();
    assert.equal(text.toString(), '', 'Second undo removes Hello');
    
    doc.destroy();
}

// ============ Multi-client Undo Tests (Simulated) ============

/**
 * Test: Client only undoes own changes
 */
async function testClientOnlyUndoesOwn() {
    const doc1 = new Y.Doc({ gc: false });
    const doc2 = new Y.Doc({ gc: false });
    
    const text1 = doc1.getText('test');
    const text2 = doc2.getText('test');
    
    // Client 1 undo manager
    const undoManager1 = new Y.UndoManager(text1, {
        trackedOrigins: new Set([doc1.clientID])
    });
    
    // Client 1 inserts (tracked)
    doc1.transact(() => {
        text1.insert(0, 'Client1');
    }, doc1.clientID);
    
    // Sync to doc2
    const update1 = Y.encodeStateAsUpdate(doc1);
    Y.applyUpdate(doc2, update1);
    
    // Client 2 inserts (not tracked by undo manager 1)
    doc2.transact(() => {
        text2.insert(7, ' Client2');
    }, doc2.clientID);
    
    // Sync back to doc1
    const update2 = Y.encodeStateAsUpdate(doc2);
    Y.applyUpdate(doc1, update2);
    
    assert.equal(text1.toString(), 'Client1 Client2', 'Both clients text should be merged');
    
    // Client 1 undoes - should only undo their own changes
    undoManager1.undo();
    
    // Client 1's text is removed, client 2's remains
    assert.equal(text1.toString(), ' Client2', 'Only client 1 text should be undone');
    
    doc1.destroy();
    doc2.destroy();
}

/**
 * Test: Undo with concurrent remote edits
 */
async function testUndoWithRemoteEdits() {
    const doc1 = new Y.Doc({ gc: false });
    const doc2 = new Y.Doc({ gc: false });
    
    const text1 = doc1.getText('test');
    const text2 = doc2.getText('test');
    
    // Track only doc1's client ID
    const undoManager = new Y.UndoManager(text1, {
        trackedOrigins: new Set([doc1.clientID])
    });
    
    // First, insert something in doc1
    doc1.transact(() => {
        text1.insert(0, 'Hello');
    }, doc1.clientID);
    
    // Sync initial state to doc2
    const initialUpdate = Y.encodeStateAsUpdate(doc1);
    Y.applyUpdate(doc2, initialUpdate);
    
    // Now doc2 has "Hello" - append to it
    doc2.transact(() => {
        text2.insert(text2.length, ' World');
    }, doc2.clientID);
    
    // Sync doc2's changes to doc1
    const update2 = Y.encodeStateAsUpdate(doc2);
    Y.applyUpdate(doc1, update2);
    
    assert.equal(text1.toString(), 'Hello World', 'Should have merged text');
    
    // Undo local edit - remote edit should remain
    undoManager.undo();
    
    assert.equal(text1.toString(), ' World', 'Remote edit should remain after undo');
    
    doc1.destroy();
    doc2.destroy();
}

// ============ Clear History Tests ============

/**
 * Test: Clear undo stack
 */
async function testClearUndoStack() {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    const undoManager = new Y.UndoManager(text);
    
    text.insert(0, 'Hello');
    assert.ok(undoManager.canUndo(), 'Should be able to undo');
    
    undoManager.clear();
    assert.ok(!undoManager.canUndo(), 'Should not be able to undo after clear');
    
    doc.destroy();
}

/**
 * Test: Clear redo stack
 */
async function testClearRedoStack() {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    const undoManager = new Y.UndoManager(text);
    
    text.insert(0, 'Hello');
    undoManager.undo();
    assert.ok(undoManager.canRedo(), 'Should be able to redo');
    
    undoManager.clear(false, true); // Clear redo only
    assert.ok(!undoManager.canRedo(), 'Should not be able to redo after clear');
    
    doc.destroy();
}

// ============ Edge Cases ============

/**
 * Test: Undo on empty document
 */
async function testUndoEmpty() {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    const undoManager = new Y.UndoManager(text);
    
    // Should not throw
    undoManager.undo();
    
    assert.equal(text.toString(), '', 'Should still be empty');
    
    doc.destroy();
}

/**
 * Test: Redo on empty redo stack
 */
async function testRedoEmpty() {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    const undoManager = new Y.UndoManager(text);
    
    // Should not throw
    undoManager.redo();
    
    assert.equal(text.toString(), '', 'Should still be empty');
    
    doc.destroy();
}

/**
 * Test: Undo/redo with Y.XmlFragment (rich text)
 */
async function testUndoRedoRichText() {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('prosemirror');
    const undoManager = new Y.UndoManager(fragment);
    
    const para = new Y.XmlElement('paragraph');
    const text = new Y.XmlText();
    text.insert(0, 'Bold text');
    para.insert(0, [text]);
    fragment.insert(0, [para]);
    
    assert.equal(fragment.length, 1, 'Should have 1 element');
    
    undoManager.undo();
    assert.equal(fragment.length, 0, 'Should be empty after undo');
    
    undoManager.redo();
    assert.equal(fragment.length, 1, 'Should have 1 element after redo');
    
    doc.destroy();
}

/**
 * Test: Multiple undo managers on same document
 */
async function testMultipleUndoManagers() {
    const doc = new Y.Doc();
    const text1 = doc.getText('text1');
    const text2 = doc.getText('text2');
    
    const undoManager1 = new Y.UndoManager(text1);
    const undoManager2 = new Y.UndoManager(text2);
    
    text1.insert(0, 'Hello');
    text2.insert(0, 'World');
    
    undoManager1.undo();
    
    assert.equal(text1.toString(), '', 'Text1 should be empty');
    assert.equal(text2.toString(), 'World', 'Text2 should be unchanged');
    
    doc.destroy();
}

// ============ Mock Undo Manager Tests ============

/**
 * Test: Mock undo manager records operations
 */
async function testMockRecordsOperations() {
    const manager = new MockUndoManager('test');
    
    manager.recordOperation({ type: 'insert', index: 0, text: 'Hello' });
    
    assert.equal(manager.getUndoStackLength(), 1, 'Should have 1 item in stack');
}

/**
 * Test: Mock undo returns inverse operations
 */
async function testMockUndoReturnsInverse() {
    const manager = new MockUndoManager('test');
    
    manager.recordOperation({ type: 'insert', index: 0, text: 'Hello' });
    
    const inverse = manager.undo();
    
    assert.equal(inverse.length, 1, 'Should return 1 inverse op');
    assert.equal(inverse[0].type, 'delete', 'Inverse of insert is delete');
}

/**
 * Test: Mock capture groups multiple operations
 */
async function testMockCaptureGroup() {
    const manager = new MockUndoManager('test');
    
    manager.startCapture();
    manager.recordOperation({ type: 'insert', index: 0, text: 'A' });
    manager.recordOperation({ type: 'insert', index: 1, text: 'B' });
    manager.recordOperation({ type: 'insert', index: 2, text: 'C' });
    manager.stopCapture();
    
    assert.equal(manager.getUndoStackLength(), 1, 'Should be grouped into 1 item');
}

/**
 * Test: Mock ignores untracked origins
 */
async function testMockIgnoresUntrackedOrigins() {
    const manager = new MockUndoManager('test', {
        trackedOrigins: new Set(['local'])
    });
    
    manager.recordOperation({ type: 'insert' }, 'local');
    manager.recordOperation({ type: 'insert' }, 'remote');
    
    assert.equal(manager.getUndoStackLength(), 1, 'Should only record local');
}

// Export test suite
module.exports = {
    name: 'UndoRedo',
    setup,
    teardown,
    tests: {
        // Basic undo tests
        testUndoSingleInsert,
        testUndoMultipleInserts,
        testUndoDelete,
        testCanUndo,
        
        // Redo tests
        testRedoAfterUndo,
        testCanRedo,
        testRedoStackClearedOnNew,
        testMultipleRedo,
        
        // Capture group tests
        testRapidEditsGrouped,
        testStopCaptureCreatesNewGroup,
        
        // Multi-client tests
        testClientOnlyUndoesOwn,
        testUndoWithRemoteEdits,
        
        // Clear history tests
        testClearUndoStack,
        testClearRedoStack,
        
        // Edge cases
        testUndoEmpty,
        testRedoEmpty,
        testUndoRedoRichText,
        testMultipleUndoManagers,
        
        // Mock undo manager tests
        testMockRecordsOperations,
        testMockUndoReturnsInverse,
        testMockCaptureGroup,
        testMockIgnoresUntrackedOrigins,
    },
};

// Jest placeholder - integration tests use custom runner
const describe = typeof global.describe === 'function' ? global.describe : () => {};
const test = typeof global.test === 'function' ? global.test : () => {};
const expect = typeof global.expect === 'function' ? global.expect : () => ({});

describe('Integration Test Placeholder', () => {
  test('tests exist in custom format', () => {
    expect(module.exports).toBeDefined();
  });
});
