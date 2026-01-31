/**
 * Repair script to create missing folders in Yjs
 * 
 * This script fixes the issue where documents reference folders
 * that don't exist in the workspace-folders Yjs room.
 * 
 * Run with: node scripts/repair-folders.js <workspaceId>
 */

const Y = require('yjs');
const { WebsocketProvider } = require('y-websocket');
const WebSocket = require('ws');

const workspaceId = process.argv[2];

if (!workspaceId) {
  console.log('Usage: node scripts/repair-folders.js <workspaceId>');
  process.exit(1);
}

const wsUrl = 'ws://localhost:3000';

console.log('='.repeat(60));
console.log('Folder Repair Tool');
console.log('='.repeat(60));
console.log(`Workspace ID: ${workspaceId}`);
console.log('');

// First, get documents to find folder references
async function getDocuments() {
  return new Promise((resolve) => {
    const metaRoomName = `workspace-meta:${workspaceId}`;
    console.log(`[1/3] Reading documents from: ${metaRoomName}`);
    
    const metaDoc = new Y.Doc();
    const metaProvider = new WebsocketProvider(wsUrl, metaRoomName, metaDoc, {
      WebSocketPolyfill: WebSocket,
    });
    
    metaProvider.on('synced', (isSynced) => {
      if (isSynced) {
        const yDocuments = metaDoc.getArray('documents');
        const documents = yDocuments.toArray();
        console.log(`    Found ${documents.length} documents`);
        
        // Extract unique folder IDs
        const folderIds = new Set();
        documents.forEach(doc => {
          if (doc.folderId) {
            folderIds.add(doc.folderId);
          }
        });
        
        console.log(`    Found ${folderIds.size} folder references: ${Array.from(folderIds).join(', ')}`);
        
        setTimeout(() => {
          metaProvider.destroy();
          resolve(Array.from(folderIds));
        }, 500);
      }
    });
  });
}

// Then, check which folders exist and create missing ones
async function repairFolders(neededFolderIds) {
  return new Promise((resolve) => {
    const folderRoomName = `workspace-folders:${workspaceId}`;
    console.log(`\n[2/3] Checking folders in: ${folderRoomName}`);
    
    const folderDoc = new Y.Doc();
    const folderProvider = new WebsocketProvider(wsUrl, folderRoomName, folderDoc, {
      WebSocketPolyfill: WebSocket,
    });
    
    folderProvider.on('synced', (isSynced) => {
      if (isSynced) {
        const yFolders = folderDoc.getArray('folders');
        const existingFolders = yFolders.toArray();
        const existingIds = new Set(existingFolders.map(f => f.id));
        
        console.log(`    Found ${existingFolders.length} existing folders`);
        
        // Find missing folders
        const missingIds = neededFolderIds.filter(id => !existingIds.has(id));
        
        if (missingIds.length === 0) {
          console.log('    ✅ All referenced folders exist!');
          setTimeout(() => {
            folderProvider.destroy();
            resolve(0);
          }, 500);
          return;
        }
        
        console.log(`\n[3/3] Creating ${missingIds.length} missing folders...`);
        
        // Create missing folders
        missingIds.forEach((folderId, index) => {
          const folder = {
            id: folderId,
            name: `Recovered Folder ${index + 1}`,
            workspaceId: workspaceId,
            parentId: null,
            icon: '📁',
            color: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            deletedAt: null,
          };
          
          console.log(`    Creating: ${folder.name} (${folderId})`);
          yFolders.push([folder]);
        });
        
        // Wait for sync
        setTimeout(() => {
          console.log(`    ✅ Created ${missingIds.length} folders`);
          folderProvider.destroy();
          resolve(missingIds.length);
        }, 1000);
      }
    });
  });
}

// Main
async function main() {
  try {
    const neededFolderIds = await getDocuments();
    
    if (neededFolderIds.length === 0) {
      console.log('\nNo folder references found in documents. Nothing to repair.');
      process.exit(0);
    }
    
    const created = await repairFolders(neededFolderIds);
    
    console.log('\n' + '='.repeat(60));
    if (created > 0) {
      console.log(`✅ Repair complete! Created ${created} folders.`);
      console.log('   Refresh your browser windows to see the folders.');
    } else {
      console.log('✅ All folders are intact. No repair needed.');
    }
    console.log('='.repeat(60));
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
