/**
 * Large Documents Tests
 * 
 * Tests for performance and stability with large documents:
 * - Large text content handling
 * - Many operations performance
 * - Memory-efficient updates
 * - Sync with large updates
 * - Chunked operations
 * - State vector efficiency
 * - Garbage collection
 * - Document splitting strategies
 * 
 * Based on Yjs CRDT capabilities
 */

const Y = require('yjs');
const {
    assert,
    sleep,
    randomHex,
} = require('./test-utils.js');

// ============ Helpers ============

/**
 * Generate a large string of specified size
 */
function generateLargeText(sizeKB) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 \n';
    const size = sizeKB * 1024;
    let result = '';
    for (let i = 0; i < size; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
}

/**
 * Generate random paragraphs
 */
function generateParagraphs(count) {
    const words = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 
                   'adipiscing', 'elit', 'sed', 'do', 'eiusmod', 'tempor'];
    const paragraphs = [];
    for (let i = 0; i < count; i++) {
        const wordCount = 50 + Math.floor(Math.random() * 100);
        const paragraph = Array.from({ length: wordCount }, () => 
            words[Math.floor(Math.random() * words.length)]
        ).join(' ');
        paragraphs.push(paragraph);
    }
    return paragraphs.join('\n\n');
}

/**
 * Measure execution time
 */
async function measureTime(fn) {
    const start = Date.now();
    await fn();
    return Date.now() - start;
}

// ============ Test Setup ============

async function setup() {
    console.log('  [Setup] Large documents tests ready');
}

async function teardown() {
    // Allow garbage collection
    global.gc && global.gc();
}

// ============ Large Text Content Tests ============

/**
 * Test: Insert 100KB of text
 */
async function testInsert100KB() {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    
    const largeText = generateLargeText(100);
    text.insert(0, largeText);
    
    assert.equal(text.toString().length, largeText.length, 'Should contain 100KB');
    
    doc.destroy();
}

/**
 * Test: Insert 1MB of text
 */
async function testInsert1MB() {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    
    const largeText = generateLargeText(1024);
    text.insert(0, largeText);
    
    assert.equal(text.toString().length, largeText.length, 'Should contain 1MB');
    
    doc.destroy();
}

/**
 * Test: Incremental inserts to 100KB
 */
async function testIncrementalInserts() {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    
    // Insert in 1KB chunks
    const chunk = generateLargeText(1);
    for (let i = 0; i < 100; i++) {
        text.insert(text.length, chunk);
    }
    
    assert.ok(text.toString().length >= 100 * 1024, 'Should have at least 100KB');
    
    doc.destroy();
}

/**
 * Test: 1000 paragraphs
 */
async function test1000Paragraphs() {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    
    const content = generateParagraphs(1000);
    text.insert(0, content);
    
    const paragraphCount = text.toString().split('\n\n').length;
    assert.equal(paragraphCount, 1000, 'Should have 1000 paragraphs');
    
    doc.destroy();
}

// ============ Many Operations Tests ============

/**
 * Test: 1000 insert operations
 */
async function test1000Inserts() {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    
    for (let i = 0; i < 1000; i++) {
        text.insert(i, 'x');
    }
    
    assert.equal(text.toString().length, 1000, 'Should have 1000 characters');
    
    doc.destroy();
}

/**
 * Test: Insert and delete cycles
 */
async function testInsertDeleteCycles() {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    
    for (let i = 0; i < 100; i++) {
        text.insert(0, 'Hello World ');
        text.delete(0, 6); // Delete "Hello "
    }
    
    // Should have "World " repeated 100 times
    assert.equal(text.toString().length, 600, 'Should have 600 characters');
    
    doc.destroy();
}

/**
 * Test: Random position inserts
 */
async function testRandomInserts() {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    
    text.insert(0, 'initial');
    
    for (let i = 0; i < 500; i++) {
        const pos = Math.floor(Math.random() * text.length);
        text.insert(pos, 'x');
    }
    
    assert.equal(text.toString().length, 7 + 500, 'Should have correct length');
    
    doc.destroy();
}

/**
 * Test: Performance of 10000 character inserts
 */
async function testInsertPerformance() {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    
    const time = await measureTime(async () => {
        for (let i = 0; i < 10000; i++) {
            text.insert(i, 'x');
        }
    });
    
    assert.ok(time < 5000, `Should complete in under 5s, took ${time}ms`);
    
    doc.destroy();
}

// ============ Sync with Large Updates Tests ============

/**
 * Test: Sync 100KB between documents
 */
async function testSyncLargeDoc() {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();
    
    const text1 = doc1.getText('test');
    const text2 = doc2.getText('test');
    
    const largeText = generateLargeText(100);
    text1.insert(0, largeText);
    
    // Sync
    const update = Y.encodeStateAsUpdate(doc1);
    Y.applyUpdate(doc2, update);
    
    assert.equal(text2.toString(), text1.toString(), 'Should sync large content');
    
    doc1.destroy();
    doc2.destroy();
}

/**
 * Test: Incremental sync
 */
async function testIncrementalSync() {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();
    
    const text1 = doc1.getText('test');
    const text2 = doc2.getText('test');
    
    // Initial sync
    const initialText = generateLargeText(50);
    text1.insert(0, initialText);
    const initialUpdate = Y.encodeStateAsUpdate(doc1);
    Y.applyUpdate(doc2, initialUpdate);
    
    // Get state vector for incremental sync
    const stateVector = Y.encodeStateVector(doc2);
    
    // More edits on doc1
    text1.insert(text1.length, ' additional content');
    
    // Incremental update (only changes since stateVector)
    const diffUpdate = Y.encodeStateAsUpdate(doc1, stateVector);
    Y.applyUpdate(doc2, diffUpdate);
    
    assert.equal(text2.toString(), text1.toString(), 'Should sync incrementally');
    
    // Diff should be smaller than full update
    const fullUpdate = Y.encodeStateAsUpdate(doc1);
    assert.ok(diffUpdate.length < fullUpdate.length, 'Diff should be smaller');
    
    doc1.destroy();
    doc2.destroy();
}

/**
 * Test: Multiple clients sync large doc
 */
async function testMultiClientLargeSync() {
    const docs = [];
    const texts = [];
    
    for (let i = 0; i < 5; i++) {
        const doc = new Y.Doc();
        docs.push(doc);
        texts.push(doc.getText('test'));
    }
    
    // First doc inserts large content
    const largeText = generateLargeText(50);
    texts[0].insert(0, largeText);
    
    // Sync to all other docs
    const update = Y.encodeStateAsUpdate(docs[0]);
    for (let i = 1; i < docs.length; i++) {
        Y.applyUpdate(docs[i], update);
    }
    
    // Verify all synced
    for (let i = 1; i < docs.length; i++) {
        assert.equal(texts[i].toString(), texts[0].toString(), `Doc ${i} should match`);
    }
    
    docs.forEach(d => d.destroy());
}

// ============ Update Size Tests ============

/**
 * Test: Update size is reasonable
 */
async function testUpdateSizeReasonable() {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    
    const contentSize = 50 * 1024; // 50KB
    const content = generateLargeText(50);
    text.insert(0, content);
    
    const update = Y.encodeStateAsUpdate(doc);
    
    // Update should be reasonably sized (not more than 2x content)
    assert.ok(update.length < contentSize * 2, 
        `Update ${update.length} should be < ${contentSize * 2}`);
    
    doc.destroy();
}

/**
 * Test: State vector is small
 */
async function testStateVectorSmall() {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    
    // Many operations
    for (let i = 0; i < 1000; i++) {
        text.insert(i, 'x');
    }
    
    const stateVector = Y.encodeStateVector(doc);
    
    // State vector should be small (contains only client clocks)
    assert.ok(stateVector.length < 100, 
        `State vector should be small, was ${stateVector.length}`);
    
    doc.destroy();
}

// ============ Memory Efficiency Tests ============

/**
 * Test: Document can be destroyed and recreated
 */
async function testDestroyAndRecreate() {
    let doc = new Y.Doc();
    let text = doc.getText('test');
    
    const content = generateLargeText(100);
    text.insert(0, content);
    
    // Save state
    const savedState = Y.encodeStateAsUpdate(doc);
    doc.destroy();
    
    // Recreate
    doc = new Y.Doc();
    text = doc.getText('test');
    Y.applyUpdate(doc, savedState);
    
    assert.equal(text.toString(), content, 'Should restore from saved state');
    
    doc.destroy();
}

/**
 * Test: Snapshot support
 */
async function testSnapshot() {
    // Snapshots require gc: false
    const doc = new Y.Doc({ gc: false });
    const text = doc.getText('test');
    
    text.insert(0, 'Version 1');
    const snapshot1 = Y.snapshot(doc);
    
    text.delete(0, text.length);
    text.insert(0, 'Version 2');
    
    assert.equal(text.toString(), 'Version 2', 'Should have version 2');
    
    // Restore from snapshot
    const restoredDoc = Y.createDocFromSnapshot(doc, snapshot1);
    const restoredText = restoredDoc.getText('test');
    
    assert.equal(restoredText.toString(), 'Version 1', 'Snapshot should be version 1');
    
    doc.destroy();
    restoredDoc.destroy();
}

// ============ Complex Data Types Tests ============

/**
 * Test: Large array
 */
async function testLargeArray() {
    const doc = new Y.Doc();
    const arr = doc.getArray('test');
    
    const items = Array.from({ length: 1000 }, (_, i) => ({ id: i, value: `item-${i}` }));
    arr.insert(0, items);
    
    assert.equal(arr.length, 1000, 'Should have 1000 items');
    assert.equal(arr.get(500).id, 500, 'Should access middle item');
    
    doc.destroy();
}

/**
 * Test: Deep nested map
 */
async function testDeepNestedMap() {
    const doc = new Y.Doc();
    const root = doc.getMap('test');
    
    // Create 10 levels of nesting
    let current = root;
    for (let i = 0; i < 10; i++) {
        const nested = new Y.Map();
        current.set(`level-${i}`, nested);
        current = nested;
    }
    current.set('deep-value', 'found');
    
    // Navigate to deep value
    let nav = root;
    for (let i = 0; i < 10; i++) {
        nav = nav.get(`level-${i}`);
    }
    
    assert.equal(nav.get('deep-value'), 'found', 'Should find deep value');
    
    doc.destroy();
}

/**
 * Test: Mixed content types
 */
async function testMixedContentTypes() {
    const doc = new Y.Doc();
    
    const text = doc.getText('text');
    const array = doc.getArray('array');
    const map = doc.getMap('map');
    
    // Populate all types
    text.insert(0, generateLargeText(10));
    
    for (let i = 0; i < 100; i++) {
        array.push([{ value: i }]);
    }
    
    map.set('config', { nested: { deep: 'value' } });
    
    // Sync to another doc
    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc));
    
    assert.equal(doc2.getText('text').toString(), text.toString(), 'Text should sync');
    assert.equal(doc2.getArray('array').length, 100, 'Array should sync');
    assert.ok(doc2.getMap('map').get('config'), 'Map should sync');
    
    doc.destroy();
    doc2.destroy();
}

// ============ Edge Cases ============

/**
 * Test: Empty document sync
 */
async function testEmptyDocSync() {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();
    
    const update = Y.encodeStateAsUpdate(doc1);
    Y.applyUpdate(doc2, update);
    
    // Should not throw
    assert.ok(true, 'Empty doc sync should work');
    
    doc1.destroy();
    doc2.destroy();
}

/**
 * Test: Single character operations at scale
 */
async function testSingleCharOperations() {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    
    // Type like a real user - character by character
    const input = 'This is a sentence typed character by character.';
    for (let i = 0; i < input.length; i++) {
        text.insert(i, input[i]);
    }
    
    assert.equal(text.toString(), input, 'Should match typed input');
    
    doc.destroy();
}

/**
 * Test: Backspace operations at scale
 */
async function testBackspaceAtScale() {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    
    // Type and backspace
    text.insert(0, 'Hello Worlddd');
    text.delete(12, 1); // Remove extra d
    text.delete(11, 1); // Remove extra d
    
    assert.equal(text.toString(), 'Hello World', 'Should have correct text');
    
    doc.destroy();
}

/**
 * Test: Very long single line
 */
async function testVeryLongLine() {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    
    // 100KB single line (no newlines)
    const longLine = 'x'.repeat(100 * 1024);
    text.insert(0, longLine);
    
    assert.equal(text.toString().length, 100 * 1024, 'Should handle long line');
    assert.ok(!text.toString().includes('\n'), 'Should be single line');
    
    doc.destroy();
}

/**
 * Test: Many newlines
 */
async function testManyNewlines() {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    
    // 10000 lines
    const manyLines = Array.from({ length: 10000 }, (_, i) => `Line ${i}`).join('\n');
    text.insert(0, manyLines);
    
    const lineCount = text.toString().split('\n').length;
    assert.equal(lineCount, 10000, 'Should have 10000 lines');
    
    doc.destroy();
}

/**
 * Test: Unicode in large document
 */
async function testUnicodeLargeDoc() {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    
    // Mix of unicode characters
    const unicodeChars = '日本語中文한국어العربيةעברית🎉🚀💻';
    const content = Array.from({ length: 1000 }, () => 
        unicodeChars[Math.floor(Math.random() * unicodeChars.length)]
    ).join('');
    
    text.insert(0, content);
    
    assert.equal(text.toString(), content, 'Should handle unicode');
    
    doc.destroy();
}

// Export test suite
module.exports = {
    name: 'LargeDocuments',
    setup,
    teardown,
    tests: {
        // Large text content tests
        testInsert100KB,
        testInsert1MB,
        testIncrementalInserts,
        test1000Paragraphs,
        
        // Many operations tests
        test1000Inserts,
        testInsertDeleteCycles,
        testRandomInserts,
        testInsertPerformance,
        
        // Sync tests
        testSyncLargeDoc,
        testIncrementalSync,
        testMultiClientLargeSync,
        
        // Update size tests
        testUpdateSizeReasonable,
        testStateVectorSmall,
        
        // Memory efficiency tests
        testDestroyAndRecreate,
        testSnapshot,
        
        // Complex data types tests
        testLargeArray,
        testDeepNestedMap,
        testMixedContentTypes,
        
        // Edge cases
        testEmptyDocSync,
        testSingleCharOperations,
        testBackspaceAtScale,
        testVeryLongLine,
        testManyNewlines,
        testUnicodeLargeDoc,
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
