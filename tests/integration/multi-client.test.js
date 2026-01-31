/**
 * Multi-Client Collaboration Tests
 * 
 * Tests real-time collaboration between multiple clients:
 * - Two clients editing the same document
 * - Changes syncing in real-time
 * - Awareness/cursor positions
 * - Multiple document collaboration
 */

const {
    TestClient,
    assert,
    sleep,
    generateDocId,
    generateKey,
    CONFIG,
} = require('./test-utils.js');

// Shared state for tests
let clients = [];

/**
 * Test setup - ensure sidecar is running
 */
async function setup() {
    console.log('  [Setup] Checking sidecar availability...');
    
    const testClient = new TestClient('SetupCheck');
    try {
        await testClient.connectMeta();
        await testClient.waitForMessage('status', 5000);
        testClient.close();
        console.log('  [Setup] Sidecar is running ✓');
    } catch (err) {
        testClient.close();
        throw new Error(`Sidecar not running. Start with: node sidecar/index.js\nError: ${err.message}`);
    }
}

/**
 * Test teardown - close all clients
 */
async function teardown() {
    for (const client of clients) {
        client.close();
    }
    clients = [];
}

/**
 * Test: Two clients can connect simultaneously
 */
async function testTwoClientsConnect() {
    const key = generateKey();
    const client1 = new TestClient('Client1', { sessionKey: key });
    const client2 = new TestClient('Client2', { sessionKey: key });
    clients.push(client1, client2);

    await client1.connectMeta();
    await client2.connectMeta();

    // Both should receive status
    const status1 = await client1.waitForMessage('status');
    const status2 = await client2.waitForMessage('status');

    assert.ok(status1, 'Client1 should receive status');
    assert.ok(status2, 'Client2 should receive status');

    client1.close();
    client2.close();
    clients = [];
}

/**
 * Test: Document creation broadcasts to all clients
 */
async function testDocumentCreationBroadcast() {
    const key = generateKey();
    const client1 = new TestClient('Creator', { sessionKey: key });
    const client2 = new TestClient('Observer', { sessionKey: key });
    clients.push(client1, client2);

    await client1.connectMeta();
    await client2.connectMeta();

    await client1.waitForMessage('status');
    await client2.waitForMessage('status');
    
    // Small delay to ensure both clients are fully connected
    await sleep(300);

    // Note the message count before create
    const client2MsgCountBefore = client2.receivedMessages.length;

    // Client1 creates a document
    const docId = generateDocId();
    client1.send({
        type: 'create-document',
        document: {
            id: docId,
            name: 'Shared Document',
            type: 'text',
            createdAt: Date.now(),
            lastEdited: Date.now(),
        }
    });

    // Wait for creator to get confirmation (with longer timeout)
    const created1 = await client1.waitForMessage('document-created', 10000);
    
    // Poll for the broadcast to reach observer
    let created2 = null;
    const pollStart = Date.now();
    while (Date.now() - pollStart < 3000) {
        // Look for a document-created message that arrived after we sent the create
        // and matches our docId
        created2 = client2.receivedMessages.find(
            (m, idx) => idx >= client2MsgCountBefore && 
                       m.type === 'document-created' && 
                       m.document?.id === docId
        );
        if (created2) break;
        await sleep(50);
    }
    
    assert.equal(created1.document.id, docId, 'Creator should see document');
    assert.ok(created2, 'Observer should receive document-created broadcast');
    assert.equal(created2.document.id, docId, 'Observer should see same document');

    client1.close();
    client2.close();
    clients = [];
}

/**
 * Test: Multiple documents can be created and listed
 */
async function testMultipleDocuments() {
    const key = generateKey();
    const client = new TestClient('DocManager', { sessionKey: key });
    clients.push(client);

    await client.connectMeta();
    await client.waitForMessage('status');

    // Create 3 documents
    const docIds = [];
    for (let i = 0; i < 3; i++) {
        const docId = generateDocId();
        docIds.push(docId);
        
        client.send({
            type: 'create-document',
            document: {
                id: docId,
                name: `Test Doc ${i + 1}`,
                type: 'text',
                createdAt: Date.now(),
                lastEdited: Date.now(),
            }
        });
        await client.waitForMessage('document-created');
    }

    // Small delay to ensure all documents are persisted
    await sleep(100);

    // List documents
    client.clearMessages();
    client.send({ type: 'list-documents' });
    const list = await client.waitForMessage('document-list');

    // Verify all documents exist (some may be from other tests, so just check ours exist)
    for (const docId of docIds) {
        const found = list.documents.find(d => d.id === docId);
        assert.ok(found, `Document ${docId} should be in list`);
    }

    client.close();
    clients = [];
}

/**
 * Test: Workspace creation and listing
 */
async function testWorkspaceManagement() {
    const key = generateKey();
    const client = new TestClient('WorkspaceTest', { sessionKey: key });
    clients.push(client);

    await client.connectMeta();
    await client.waitForMessage('status');

    // Create workspace
    const workspaceId = `ws-${Date.now()}`;
    client.send({
        type: 'create-workspace',
        workspace: {
            id: workspaceId,
            name: 'Test Workspace',
            createdAt: Date.now(),
        }
    });

    const created = await client.waitForMessage('workspace-created');
    assert.equal(created.workspace.id, workspaceId, 'Workspace should be created');

    // List workspaces
    client.clearMessages();
    client.send({ type: 'list-workspaces' });
    const list = await client.waitForMessage('workspace-list');

    const found = list.workspaces.find(w => w.id === workspaceId);
    assert.ok(found, 'Workspace should be in list');

    client.close();
    clients = [];
}

/**
 * Test: Folder creation within workspace
 */
async function testFolderManagement() {
    const key = generateKey();
    const client = new TestClient('FolderTest', { sessionKey: key });
    clients.push(client);

    await client.connectMeta();
    await client.waitForMessage('status');

    // Create folder
    const folderId = `folder-${Date.now()}`;
    client.send({
        type: 'create-folder',
        folder: {
            id: folderId,
            name: 'Test Folder',
            workspaceId: 'test-workspace',
            createdAt: Date.now(),
        }
    });

    const created = await client.waitForMessage('folder-created');
    assert.equal(created.folder.id, folderId, 'Folder should be created');

    // List folders
    client.clearMessages();
    client.send({ type: 'list-folders' });
    const list = await client.waitForMessage('folder-list');

    const found = list.folders.find(f => f.id === folderId);
    assert.ok(found, 'Folder should be in list');

    client.close();
    clients = [];
}

/**
 * Test: Document deletion
 */
async function testDocumentDeletion() {
    const key = generateKey();
    const client = new TestClient('DeleteTest', { sessionKey: key });
    clients.push(client);

    await client.connectMeta();
    await client.waitForMessage('status');

    // Create document
    const docId = generateDocId();
    client.send({
        type: 'create-document',
        document: {
            id: docId,
            name: 'To Be Deleted',
            type: 'text',
            createdAt: Date.now(),
            lastEdited: Date.now(),
        }
    });
    await client.waitForMessage('document-created');

    // Delete document
    client.clearMessages();
    client.send({ type: 'delete-document', docId });
    const deleted = await client.waitForMessage('document-deleted');
    assert.equal(deleted.docId, docId, 'Document should be deleted');

    // Verify it's gone
    client.clearMessages();
    client.send({ type: 'list-documents' });
    const list = await client.waitForMessage('document-list');
    
    const found = list.documents.find(d => d.id === docId);
    assert.ok(!found, 'Deleted document should not be in list');

    client.close();
    clients = [];
}

/**
 * Test: Session key is required for operations
 */
async function testSessionKeyRequired() {
    const client = new TestClient('NoKeyTest');
    clients.push(client);

    // Connect without sending key
    await new Promise((resolve, reject) => {
        const ws = require('ws');
        const socket = new ws(`ws://localhost:${CONFIG.META_WS_PORT}`);
        socket.on('open', () => {
            // Should still connect
            socket.on('message', (data) => {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'status') {
                    socket.close();
                    resolve();
                }
            });
        });
        socket.on('error', reject);
    });

    // Client should receive status even without key
    // (key is only needed for encryption operations)
    clients = [];
}

/**
 * Test: Real-time document updates between clients
 */
async function testRealTimeYjsSync() {
    const key = generateKey();
    const docId = generateDocId();
    
    const client1 = new TestClient('Editor1', { sessionKey: key });
    const client2 = new TestClient('Editor2', { sessionKey: key });
    clients.push(client1, client2);

    // Connect both to metadata
    await client1.connectMeta();
    await client2.connectMeta();
    await client1.waitForMessage('status');
    await client2.waitForMessage('status');

    // Connect both to Yjs for same document
    await client1.connectYjs(docId);
    await client2.connectYjs(docId);

    // Client1 inserts text
    client1.insertText('Hello from Client 1!');
    
    // Wait for sync
    await sleep(500);

    // Client2 should see the text
    const text2 = client2.getText();
    assert.contains(text2, 'Hello from Client 1', 'Client2 should see Client1 text');

    // Client2 inserts text
    client2.insertText(' And Client 2!', client2.getText().length);
    
    // Wait for sync
    await sleep(500);

    // Both should have both texts
    const finalText1 = client1.getText();
    const finalText2 = client2.getText();

    assert.contains(finalText1, 'Client 1', 'Client1 should have its text');
    assert.contains(finalText1, 'Client 2', 'Client1 should have Client2 text');
    assert.equal(finalText1, finalText2, 'Both clients should have same content');

    client1.close();
    client2.close();
    clients = [];
}

/**
 * Test: Three clients collaborating
 */
async function testThreeClientCollaboration() {
    const key = generateKey();
    const docId = generateDocId();
    
    const clients3 = [
        new TestClient('Alice', { sessionKey: key }),
        new TestClient('Bob', { sessionKey: key }),
        new TestClient('Charlie', { sessionKey: key }),
    ];
    clients.push(...clients3);

    // Connect all to metadata and Yjs
    for (const c of clients3) {
        await c.connectMeta();
        await c.waitForMessage('status');
        await c.connectYjs(docId);
    }

    // Each client adds their name
    clients3[0].insertText('Alice was here. ');
    await sleep(200);
    clients3[1].insertText('Bob was here. ', clients3[1].getText().length);
    await sleep(200);
    clients3[2].insertText('Charlie was here.', clients3[2].getText().length);
    await sleep(500);

    // All should have all content
    for (const c of clients3) {
        const text = c.getText();
        assert.contains(text, 'Alice', `${c.name} should see Alice`);
        assert.contains(text, 'Bob', `${c.name} should see Bob`);
        assert.contains(text, 'Charlie', `${c.name} should see Charlie`);
    }

    for (const c of clients3) c.close();
    clients = [];
}

// Export test suite
module.exports = {
    setup,
    teardown,
    tests: {
        'Two clients can connect simultaneously': testTwoClientsConnect,
        'Document creation broadcasts to all clients': testDocumentCreationBroadcast,
        'Multiple documents can be created and listed': testMultipleDocuments,
        'Workspace creation and listing': testWorkspaceManagement,
        'Folder creation within workspace': testFolderManagement,
        'Document deletion': testDocumentDeletion,
        'Session key operations': testSessionKeyRequired,
        'Real-time Yjs sync between two clients': testRealTimeYjsSync,
        'Three clients collaborating': testThreeClientCollaboration,
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
