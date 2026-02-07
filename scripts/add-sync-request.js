/**
 * Script to add sync request code to join-workspace handler
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'sidecar', 'index.js');
let content = fs.readFileSync(filePath, 'utf8');

// The code we want to insert after the for loop that connects to bootstrap peers
const syncRequestCode = `
                            
                            // Request full state from bootstrap peers (initial sync)
                            // Wait a short delay for connections to stabilize
                            const topicForSync = topicHash;
                            const peersForSync = [...bootstrapPeers];
                            setTimeout(() => {
                                if (topicForSync && p2pBridge.hyperswarm) {
                                    console.log(\`[Sidecar] Requesting initial sync from peers...\`);
                                    for (const peerKey of peersForSync) {
                                        try {
                                            p2pBridge.hyperswarm.sendSyncRequest(peerKey, topicForSync);
                                            console.log(\`[Sidecar] Sent sync-request to \${peerKey.slice(0, 16)}...\`);
                                        } catch (e) {
                                            console.error(\`[Sidecar] Failed to send sync-request to \${peerKey.slice(0, 16)}:\`, e.message);
                                        }
                                    }
                                }
                            }, 1000); // 1 second delay for connection stabilization`;

// Find the pattern: end of the for loop followed by "else { No bootstrap peers"
// We look for the closing braces of the for loop and try-catch, then insert before the else
const searchPattern = /(\s+}\r?\n\s+}\r?\n\s+} else \{\r?\n\s+console\.warn\('\[Sidecar\] .+ No bootstrap peers provided'\);)/;

const match = content.match(searchPattern);
if (match) {
    console.log('Found insertion point');
    
    // Check if we already added the sync request code
    if (content.includes('Requesting initial sync from peers')) {
        console.log('Sync request code already present, skipping');
        process.exit(0);
    }
    
    // Insert the sync request code
    const insertionPoint = match.index;
    const matchedText = match[0];
    
    // We need to insert after the closing braces but before the else
    // Let's split the matched text and insert between
    const closingBraces = matchedText.match(/^(\s+}\r?\n\s+})/);
    if (closingBraces) {
        const newContent = content.slice(0, insertionPoint + closingBraces[0].length) + 
                          syncRequestCode + 
                          content.slice(insertionPoint + closingBraces[0].length);
        
        fs.writeFileSync(filePath, newContent, 'utf8');
        console.log('Successfully added sync request code');
    } else {
        console.error('Could not find closing braces');
    }
} else {
    console.log('Pattern not found, trying alternative approach');
    
    // Alternative: find line number and insert after it
    const lines = content.split('\n');
    let insertIndex = -1;
    
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('Connected to bootstrap peer')) {
            // Look for the closing braces after this
            for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
                if (lines[j].trim() === '}' && lines[j+1] && lines[j+1].trim() === '}') {
                    insertIndex = j + 2;
                    break;
                }
            }
            break;
        }
    }
    
    if (insertIndex > 0) {
        console.log('Found insertion point at line', insertIndex);
        
        // Check if we already added the sync request code
        if (content.includes('Requesting initial sync from peers')) {
            console.log('Sync request code already present, skipping');
            process.exit(0);
        }
        
        // Insert the code
        lines.splice(insertIndex, 0, syncRequestCode);
        fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
        console.log('Successfully added sync request code');
    } else {
        console.error('Could not find insertion point');
        process.exit(1);
    }
}
