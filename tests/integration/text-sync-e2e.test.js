/**
 * Text Document Sync Tests
 * 
 * End-to-end tests for text document synchronization across multiple clients.
 * Tests CRDT convergence, cursors, selections, and formatting.
 */

const { ConcurrencyTestHarness, withHarness } = require('./concurrency-harness');
const { generateDocId, sleep } = require('./test-utils');
const { 
    assertTextIdentical, 
    waitForConvergence,
    assertAllHaveContent,
    assertAllContain,
    compareTextExact,
} = require('./crdt-assertions');
const {
    setAwareness,
    setCursor,
    setSelection,
    setTyping,
    getRemoteAwareness,
    waitForAwarenessSync,
    assertPresenceVisible,
    assertTypingIndicator,
    simulateTyping,
} = require('./visual-sync-helpers');
const { waitForQuiescence, timedLog } = require('./test-stability');

/**
 * Test suite definition
 */
const TextSyncTests = {
    name: 'Text Document Sync',
    tests: [],
};

/**
 * Helper to run a test with the harness
 */
function test(name, fn, options = {}) {
    TextSyncTests.tests.push({
        name,
        fn: async () => {
            const harness = new ConcurrencyTestHarness({
                testName: `text-sync-${name.replace(/\s+/g, '-').toLowerCase()}`,
                clientCount: options.clientCount || 3,
                chaosEnabled: options.chaos || false,
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
    });
}

// ============================================================================
// BASIC SYNC TESTS
// ============================================================================

test('Two clients type at different positions', async (harness) => {
    const docId = generateDocId();
    
    // Connect all clients
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    // Client A types at start
    clientA.insertText('Hello ', 0);
    
    // Wait for sync
    await sleep(200);
    
    // Client B types at end
    const currentLength = clientB.getText().length;
    clientB.insertText('World!', currentLength);
    
    // Wait for convergence
    await harness.assertAllConverged();
    
    // Verify final content
    const finalContent = clientA.getText();
    if (!finalContent.includes('Hello') || !finalContent.includes('World')) {
        throw new Error(`Unexpected content: "${finalContent}"`);
    }
    
    timedLog('✓ Two clients typed at different positions successfully');
});

test('Three clients concurrent typing at same position', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB, clientC] = harness.clients;
    
    // All clients type at position 0 simultaneously
    await harness.parallel(async (client, index) => {
        const text = `[${client.name}]`;
        client.insertText(text, 0);
    });
    
    // Wait for convergence
    await harness.waitForConvergence();
    
    // Verify all clients have same content
    const report = compareTextExact(harness.clients);
    if (!report.allIdentical) {
        throw new Error(`Content mismatch after concurrent typing:\n${JSON.stringify(report, null, 2)}`);
    }
    
    // Verify all client names are present
    const content = clientA.getText();
    for (const client of harness.clients) {
        if (!content.includes(`[${client.name}]`)) {
            throw new Error(`Missing ${client.name}'s text in: "${content}"`);
        }
    }
    
    timedLog('✓ Three clients concurrent typing converged correctly');
});

test('Interleaved typing simulation', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    // Simulate interleaved typing
    const textA = 'AAAA';
    const textB = 'BBBB';
    
    for (let i = 0; i < 4; i++) {
        clientA.insertText(textA[i], clientA.getText().length);
        await sleep(30);
        clientB.insertText(textB[i], clientB.getText().length);
        await sleep(30);
    }
    
    // Wait for convergence
    await harness.assertAllConverged();
    
    const finalContent = clientA.getText();
    
    // Count occurrences
    const countA = (finalContent.match(/A/g) || []).length;
    const countB = (finalContent.match(/B/g) || []).length;
    
    if (countA !== 4 || countB !== 4) {
        throw new Error(`Expected 4 A's and 4 B's, got ${countA} A's and ${countB} B's in: "${finalContent}"`);
    }
    
    timedLog('✓ Interleaved typing preserved all characters');
});

// ============================================================================
// DELETION TESTS
// ============================================================================

test('Concurrent deletion and insertion', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    // Set up initial content
    clientA.insertText('Hello World', 0);
    await sleep(200);
    await harness.assertAllConverged();
    
    // Client A deletes "World", Client B inserts " Beautiful" before "World"
    // These are concurrent conflicting operations
    clientA.deleteText(6, 5); // Delete "World"
    clientB.insertText(' Beautiful', 5); // Insert after "Hello"
    
    // Wait for convergence
    await harness.waitForConvergence();
    
    const content = clientA.getText();
    timedLog(`Final content after concurrent delete/insert: "${content}"`);
    
    // The CRDT should handle this gracefully - content should be consistent
    // Exact result depends on CRDT implementation
    await harness.assertAllConverged();
    
    timedLog('✓ Concurrent deletion and insertion handled correctly');
});

test('Delete the same text range', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    // Set up initial content
    clientA.insertText('Delete This Text', 0);
    await sleep(200);
    await harness.assertAllConverged();
    
    // Both clients delete the same range
    clientA.deleteText(7, 5); // Delete "This "
    clientB.deleteText(7, 5); // Delete "This "
    
    // Wait for convergence
    await harness.waitForConvergence();
    
    const content = clientA.getText();
    
    // Should only delete once, not double-delete
    if (content !== 'Delete Text') {
        throw new Error(`Expected "Delete Text", got "${content}"`);
    }
    
    timedLog('✓ Concurrent same-range deletion handled correctly');
}, { clientCount: 2 });

// ============================================================================
// UNDO/REDO TESTS
// ============================================================================

test('Undo isolation between clients', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    // Client A types and creates undo history
    const undoManagerA = new (require('yjs').UndoManager)(clientA.ydoc.getText('content'));
    
    clientA.insertText('AAA', 0);
    await sleep(100);
    
    // Client B types
    clientB.insertText('BBB', 3);
    await sleep(100);
    
    await harness.assertAllConverged();
    
    // Verify initial state
    let content = clientA.getText();
    if (!content.includes('AAA') || !content.includes('BBB')) {
        throw new Error(`Missing content before undo: "${content}"`);
    }
    
    // Client A undoes their changes
    undoManagerA.undo();
    await sleep(200);
    
    // Wait for convergence
    await harness.assertAllConverged();
    
    // Client A's text should be gone, but Client B's should remain
    content = clientA.getText();
    if (content.includes('AAA')) {
        throw new Error(`AAA should be undone: "${content}"`);
    }
    if (!content.includes('BBB')) {
        throw new Error(`BBB should remain after undo: "${content}"`);
    }
    
    timedLog('✓ Undo only affected the originating client\'s changes');
}, { clientCount: 2 });

// ============================================================================
// LARGE CONTENT TESTS
// ============================================================================

test('Large paste synchronization', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    // Generate 10KB of text
    const largeText = 'x'.repeat(10 * 1024);
    
    // Client A pastes large content
    clientA.insertText(largeText, 0);
    
    // Wait for sync (may take longer for large content)
    await harness.waitForConvergence('content', 10000);
    
    // Verify complete transfer
    const contentB = clientB.getText();
    if (contentB.length !== largeText.length) {
        throw new Error(`Length mismatch: expected ${largeText.length}, got ${contentB.length}`);
    }
    
    timedLog('✓ 10KB paste synchronized completely');
}, { clientCount: 2 });

// ============================================================================
// AWARENESS/PRESENCE TESTS
// ============================================================================

test('Cursor position sync', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    // Set up content first
    clientA.insertText('Hello World', 0);
    await harness.assertAllConverged();
    
    // Set user info in awareness
    setAwareness(clientA, {
        user: { name: clientA.name, color: '#ff0000' },
    });
    setAwareness(clientB, {
        user: { name: clientB.name, color: '#00ff00' },
    });
    
    // Wait for awareness sync
    await waitForAwarenessSync([clientA, clientB]);
    
    // Client A sets cursor position
    setCursor(clientA, { anchor: 5, head: 5 });
    await sleep(200);
    
    // Client B should see A's cursor
    const remotesB = getRemoteAwareness(clientB);
    const peerA = remotesB.find(r => r.user?.name === clientA.name);
    
    if (!peerA) {
        throw new Error('Client B does not see Client A');
    }
    
    if (!peerA.cursor || peerA.cursor.anchor !== 5) {
        throw new Error(`Expected cursor at 5, got ${JSON.stringify(peerA.cursor)}`);
    }
    
    timedLog('✓ Cursor position synced correctly');
}, { clientCount: 2 });

test('Selection sync', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    clientA.insertText('Select this text', 0);
    await harness.assertAllConverged();
    
    // Set user awareness
    setAwareness(clientA, { user: { name: clientA.name } });
    setAwareness(clientB, { user: { name: clientB.name } });
    await waitForAwarenessSync([clientA, clientB]);
    
    // Client A selects "this"
    setSelection(clientA, { anchor: 7, head: 11 });
    await sleep(200);
    
    // Client B should see A's selection
    const remotesB = getRemoteAwareness(clientB);
    const peerA = remotesB.find(r => r.user?.name === clientA.name);
    
    if (!peerA?.selection) {
        throw new Error('Client B does not see Client A\'s selection');
    }
    
    if (peerA.selection.anchor !== 7 || peerA.selection.head !== 11) {
        throw new Error(`Wrong selection: ${JSON.stringify(peerA.selection)}`);
    }
    
    timedLog('✓ Selection synced correctly');
}, { clientCount: 2 });

test('Typing indicator', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    // Set user awareness
    setAwareness(clientA, { user: { name: clientA.name } });
    setAwareness(clientB, { user: { name: clientB.name } });
    await waitForAwarenessSync([clientA, clientB]);
    
    // Client A starts typing
    setTyping(clientA, true);
    await sleep(200);
    
    // Client B should see typing indicator
    await assertTypingIndicator(clientB, clientA, true);
    
    // Client A stops typing
    setTyping(clientA, false);
    await sleep(200);
    
    // Client B should see typing stopped
    await assertTypingIndicator(clientB, clientA, false);
    
    timedLog('✓ Typing indicator synced correctly');
}, { clientCount: 2 });

// ============================================================================
// MODULE EXPORTS
// ============================================================================

module.exports = TextSyncTests;

// Allow running directly
if (require.main === module) {
    const { runTestSuite } = require('./test-runner-utils');
    runTestSuite(TextSyncTests).catch(console.error);
}
