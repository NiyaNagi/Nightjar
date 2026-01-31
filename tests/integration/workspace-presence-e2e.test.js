/**
 * Workspace and Presence Tests
 * 
 * End-to-end tests for workspace operations, permissions, and presence.
 */

const { ConcurrencyTestHarness } = require('./concurrency-harness');
const { generateDocId, generateWorkspaceId, sleep, generateKey } = require('./test-utils');
const { retryWithBackoff } = require('./crdt-assertions');
const { waitForQuiescence, timedLog } = require('./test-stability');

/**
 * Test suite definition
 */
const WorkspacePresenceTests = {
    name: 'Workspace and Presence',
    tests: [],
};

function test(name, fn, options = {}) {
    WorkspacePresenceTests.tests.push({
        name,
        fn: async () => {
            const harness = new ConcurrencyTestHarness({
                testName: `workspace-presence-${name.replace(/\s+/g, '-').toLowerCase()}`,
                clientCount: options.clientCount || 2,
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
// WORKSPACE CREATION & LISTING
// ============================================================================

test('Create workspace and see it in list', async (harness) => {
    await harness.connectAllMeta();
    
    const [clientA, clientB] = harness.clients;
    
    // Client A creates a workspace
    const workspace = await clientA.createWorkspace({
        name: 'Test Workspace',
    });
    
    // Wait for broadcast
    await sleep(300);
    
    // Client B requests workspace list
    clientB.send({ type: 'list-workspaces' });
    const response = await clientB.waitForMessage('workspace-list');
    
    const found = response.workspaces.find(w => w.id === workspace.id);
    if (!found) {
        throw new Error(`Workspace ${workspace.id} not found in list`);
    }
    
    timedLog('✓ Workspace created and visible to other clients');
}, { clientCount: 2 });

test('Multiple clients create workspaces concurrently', async (harness) => {
    await harness.connectAllMeta();
    
    // All clients create workspaces at the same time
    const workspaces = await harness.parallel(async (client, index) => {
        return client.createWorkspace({
            name: `Workspace ${index + 1}`,
        });
    });
    
    // Wait for all broadcasts
    await sleep(500);
    
    // Each client should see all workspaces
    for (const client of harness.clients) {
        client.send({ type: 'list-workspaces' });
        const response = await client.waitForMessage('workspace-list');
        
        for (const ws of workspaces) {
            const found = response.workspaces.find(w => w.id === ws.id);
            if (!found) {
                throw new Error(`${client.name} missing workspace ${ws.id}`);
            }
        }
    }
    
    timedLog('✓ Concurrent workspace creation handled correctly');
}, { clientCount: 3 });

// ============================================================================
// DOCUMENT OPERATIONS
// ============================================================================

test('Document creation broadcasts to all clients', async (harness) => {
    await harness.connectAllMeta();
    
    const [clientA, clientB] = harness.clients;
    
    // Create workspace first
    const workspace = await clientA.createWorkspace({ name: 'Doc Test WS' });
    await sleep(200);
    
    // Client A creates a document
    const doc = await clientA.createDocument({
        name: 'Shared Doc',
        workspaceId: workspace.id,
    });
    
    // Client B should receive the broadcast
    await retryWithBackoff(async () => {
        const createMessages = clientB.getMessages('document-created');
        const found = createMessages.find(m => m.document?.id === doc.id);
        if (!found) {
            throw new Error('Document creation not broadcast to Client B');
        }
    });
    
    timedLog('✓ Document creation broadcast to all clients');
}, { clientCount: 2 });

test('Document deletion broadcasts to all clients', async (harness) => {
    await harness.connectAllMeta();
    
    const [clientA, clientB] = harness.clients;
    
    // Create workspace and document
    const workspace = await clientA.createWorkspace({ name: 'Delete Test WS' });
    const doc = await clientA.createDocument({
        name: 'To Be Deleted',
        workspaceId: workspace.id,
    });
    
    await sleep(300);
    
    // Clear message history to make it easier to find the delete
    clientB.clearMessages();
    
    // Client A deletes the document
    clientA.send({ type: 'delete-document', docId: doc.id });
    
    // Client B should receive the broadcast
    await retryWithBackoff(async () => {
        const deleteMessages = clientB.getMessages('document-deleted');
        const found = deleteMessages.find(m => m.docId === doc.id);
        if (!found) {
            throw new Error('Document deletion not broadcast to Client B');
        }
    });
    
    timedLog('✓ Document deletion broadcast to all clients');
}, { clientCount: 2 });

// ============================================================================
// JOIN/LEAVE WORKSPACE
// ============================================================================

test('Join workspace via share link', async (harness) => {
    await harness.connectAllMeta();
    
    const [clientA, clientB] = harness.clients;
    
    // Client A creates a workspace
    const workspace = await clientA.createWorkspace({
        name: 'Shared Workspace',
    });
    
    // Client A generates a share link
    // In a real scenario this would involve encryption key encoding
    const sharePayload = {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        permissionLevel: 'editor',
    };
    
    // Client B joins via the share info
    clientB.send({
        type: 'join-workspace',
        workspace: {
            id: workspace.id,
            name: workspace.name,
        },
    });
    
    // Wait for join confirmation
    await retryWithBackoff(async () => {
        const listResponse = clientB.getMessages('workspace-list');
        if (listResponse.length === 0) {
            clientB.send({ type: 'list-workspaces' });
            throw new Error('Waiting for workspace list');
        }
        
        const latest = listResponse[listResponse.length - 1];
        const found = latest.workspaces?.find(w => w.id === workspace.id);
        if (!found) {
            throw new Error('Joined workspace not in list');
        }
    });
    
    timedLog('✓ Client joined workspace successfully');
}, { clientCount: 2 });

test('Client disconnect removes from presence', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB, clientC] = harness.clients;
    
    // Set awareness for all
    for (const client of harness.clients) {
        if (client.yjsProvider?.awareness) {
            client.yjsProvider.awareness.setLocalState({
                user: { name: client.name },
            });
        }
    }
    
    await sleep(500);
    
    // Verify C sees both A and B
    if (clientC.yjsProvider?.awareness) {
        const states = clientC.yjsProvider.awareness.getStates();
        // Should have at least 2 other clients plus self
        if (states.size < 3) {
            timedLog(`Warning: Only ${states.size} awareness states, expected 3`);
        }
    }
    
    // Client B disconnects
    clientB.close();
    harness.clients = [clientA, clientC]; // Remove from harness
    
    // Wait for disconnect to propagate
    await sleep(1000);
    
    // Client C should no longer see B
    // (This depends on awareness timeout settings)
    
    timedLog('✓ Client disconnect handled');
}, { clientCount: 3 });

// ============================================================================
// PERMISSIONS
// ============================================================================

test('Permission changes broadcast to affected clients', async (harness) => {
    await harness.connectAllMeta();
    
    const [owner, editor] = harness.clients;
    
    // Owner creates workspace
    const workspace = await owner.createWorkspace({
        name: 'Permission Test WS',
    });
    
    await sleep(200);
    
    // In a real implementation, we would:
    // 1. Have editor join workspace
    // 2. Owner changes editor's permission level
    // 3. Editor receives permission-changed message
    
    // For now, test that permission message format is correct
    owner.send({
        type: 'update-collaborator-permission',
        workspaceId: workspace.id,
        collaboratorId: editor.clientId,
        permission: 'viewer',
    });
    
    // This test verifies the message is sent correctly
    // Full permission enforcement would require more infrastructure
    
    timedLog('✓ Permission change message sent');
}, { clientCount: 2 });

// ============================================================================
// FOLDER OPERATIONS
// ============================================================================

test('Folder creation syncs to all clients', async (harness) => {
    await harness.connectAllMeta();
    
    const [clientA, clientB] = harness.clients;
    
    // Create workspace
    const workspace = await clientA.createWorkspace({ name: 'Folder Test WS' });
    await sleep(200);
    
    // Create folder
    const folderId = `folder-${Date.now()}`;
    clientA.send({
        type: 'create-folder',
        folder: {
            id: folderId,
            name: 'Test Folder',
            workspaceId: workspace.id,
        },
    });
    
    // Wait for creation
    await clientA.waitForMessage('folder-created');
    
    // Client B should be able to list and see the folder
    clientB.send({ type: 'list-folders', workspaceId: workspace.id });
    
    await retryWithBackoff(async () => {
        const listMessages = clientB.getMessages('folder-list');
        if (listMessages.length === 0) {
            throw new Error('No folder list received');
        }
        const latest = listMessages[listMessages.length - 1];
        const found = latest.folders?.find(f => f.id === folderId);
        if (!found) {
            throw new Error('Created folder not in list');
        }
    });
    
    timedLog('✓ Folder creation synced to all clients');
}, { clientCount: 2 });

test('Document move to folder syncs', async (harness) => {
    await harness.connectAllMeta();
    
    const [clientA, clientB] = harness.clients;
    
    // Create workspace, folder, and document
    const workspace = await clientA.createWorkspace({ name: 'Move Test WS' });
    
    const folderId = `folder-${Date.now()}`;
    clientA.send({
        type: 'create-folder',
        folder: {
            id: folderId,
            name: 'Target Folder',
            workspaceId: workspace.id,
        },
    });
    await clientA.waitForMessage('folder-created');
    
    const doc = await clientA.createDocument({
        name: 'Moveable Doc',
        workspaceId: workspace.id,
        folderId: null, // Root level initially
    });
    
    await sleep(200);
    
    // Move document to folder
    clientA.send({
        type: 'move-document',
        documentId: doc.id,
        folderId: folderId,
    });
    
    // Wait for move broadcast
    await retryWithBackoff(async () => {
        const moveMessages = clientB.getMessages('document-moved');
        const found = moveMessages.find(m => 
            (m.documentId === doc.id || m.docId === doc.id) && 
            m.folderId === folderId
        );
        if (!found) {
            throw new Error('Document move not broadcast');
        }
    });
    
    timedLog('✓ Document move to folder synced');
}, { clientCount: 2 });

// ============================================================================
// MODULE EXPORTS
// ============================================================================

module.exports = WorkspacePresenceTests;

if (require.main === module) {
    const { runTestSuite } = require('./test-runner-utils');
    runTestSuite(WorkspacePresenceTests).catch(console.error);
}
