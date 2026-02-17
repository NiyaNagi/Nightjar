/**
 * Debug script to check folder sync state
 * 
 * Run with: node scripts/debug-folder-sync.js <workspaceId>
 */

const Y = require('yjs');
const { WebsocketProvider } = require('y-websocket');
const WebSocket = require('ws');

const workspaceId = process.argv[2];

if (!workspaceId) {
  console.log('Usage: node scripts/debug-folder-sync.js <workspaceId>');
  console.log('\nTo find workspaceId, look at the URL in your browser:');
  console.log('  localhost:3000/#<key>  - the workspace ID is in localStorage');
  console.log('\nOr check browser console for "[FolderContext] Web mode - setting up Yjs folder sync for workspace: <id>"');
  process.exit(1);
}

const wsUrl = 'ws://localhost:3000';

console.log('='.repeat(60));
console.log('Folder Sync Debug Tool');
console.log('='.repeat(60));
console.log(`Workspace ID: ${workspaceId}`);
console.log(`WebSocket URL: ${wsUrl}`);
console.log('');

// Check workspace-folders room
const folderRoomName = `workspace-folders:${workspaceId}`;
console.log(`Connecting to room: ${folderRoomName}`);

const ydoc = new Y.Doc();
const provider = new WebsocketProvider(wsUrl, folderRoomName, ydoc, {
  WebSocketPolyfill: WebSocket,
});

provider.on('status', ({ status }) => {
  console.log(`[Provider] Status: ${status}`);
});

provider.on('synced', (isSynced) => {
  console.log(`[Provider] Synced: ${isSynced}`);
  
  if (isSynced) {
    const yFolders = ydoc.getMap('folders');
    const yDocFolders = ydoc.getMap('documentFolders');
    const yTrashedDocs = ydoc.getArray('trashedDocuments');
    
    console.log('\n' + '='.repeat(60));
    console.log('FOLDER DATA IN YJS');
    console.log('='.repeat(60));
    
    const folders = [];
    yFolders.forEach((folder, folderId) => {
      folders.push({ ...folder, id: folder.id || folderId });
    });
    console.log(`\nFolders (${folders.length}):`);
    if (folders.length === 0) {
      console.log('  (none)');
    } else {
      folders.forEach((f, i) => {
        console.log(`  ${i + 1}. ${f.name} (id: ${f.id})`);
        console.log(`     workspaceId: ${f.workspaceId}`);
        console.log(`     parentId: ${f.parentId || '(root)'}`);
        console.log(`     deletedAt: ${f.deletedAt || '(not deleted)'}`);
      });
    }
    
    console.log(`\nDocument-Folder Mappings:`);
    let mappingCount = 0;
    yDocFolders.forEach((folderId, docId) => {
      mappingCount++;
      console.log(`  ${docId} -> ${folderId}`);
    });
    if (mappingCount === 0) {
      console.log('  (none)');
    }
    
    const trashedDocs = yTrashedDocs.toArray();
    console.log(`\nTrashed Documents (${trashedDocs.length}):`);
    if (trashedDocs.length === 0) {
      console.log('  (none)');
    } else {
      trashedDocs.forEach((d, i) => {
        console.log(`  ${i + 1}. ${d.name} (id: ${d.id})`);
      });
    }
    
    // Also check workspace-meta room
    console.log('\n' + '='.repeat(60));
    console.log('Checking workspace-meta room...');
    console.log('='.repeat(60));
    
    checkWorkspaceMeta(workspaceId).then(() => {
      console.log('\n' + '='.repeat(60));
      console.log('Debug complete. Press Ctrl+C to exit.');
      console.log('='.repeat(60));
    });
  }
});

async function checkWorkspaceMeta(wsId) {
  return new Promise((resolve) => {
    const metaRoomName = `workspace-meta:${wsId}`;
    console.log(`Connecting to room: ${metaRoomName}`);
    
    const metaDoc = new Y.Doc();
    const metaProvider = new WebsocketProvider(wsUrl, metaRoomName, metaDoc, {
      WebSocketPolyfill: WebSocket,
    });
    
    metaProvider.on('synced', (isSynced) => {
      if (isSynced) {
        const yDocuments = metaDoc.getArray('documents');
        const yInfo = metaDoc.getMap('workspaceInfo');
        
        console.log(`\nWorkspace Info:`);
        console.log(`  name: ${yInfo.get('name')}`);
        console.log(`  icon: ${yInfo.get('icon')}`);
        console.log(`  color: ${yInfo.get('color')}`);
        
        const documents = yDocuments.toArray();
        console.log(`\nDocuments (${documents.length}):`);
        if (documents.length === 0) {
          console.log('  (none)');
        } else {
          documents.forEach((d, i) => {
            console.log(`  ${i + 1}. ${d.name} (id: ${d.id}, type: ${d.type || 'text'})`);
            console.log(`     folderId: ${d.folderId || '(root)'}`);
          });
        }
        
        setTimeout(() => {
          metaProvider.destroy();
          resolve();
        }, 500);
      }
    });
  });
}

// Keep script running
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  provider.destroy();
  process.exit(0);
});
