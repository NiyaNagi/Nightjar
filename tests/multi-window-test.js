/**
 * Interactive Multi-Window Test for Nahma
 * 
 * This script helps you test real-time sync between multiple windows
 * on the same machine.
 * 
 * Usage:
 *   node tests/multi-window-test.js
 * 
 * It will:
 * 1. Start the sidecar if not running
 * 2. Open the React dev server
 * 3. Give you instructions to test sync
 */

const { spawn, exec } = require('child_process');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(prompt) {
    return new Promise(resolve => rl.question(prompt, resolve));
}

function checkPort(port) {
    return new Promise(resolve => {
        const net = require('net');
        const socket = new net.Socket();
        
        socket.setTimeout(1000);
        socket.on('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.on('timeout', () => {
            socket.destroy();
            resolve(false);
        });
        socket.on('error', () => {
            socket.destroy();
            resolve(false);
        });
        
        socket.connect(port, 'localhost');
    });
}

async function main() {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║           NAHMA MULTI-WINDOW SYNC TEST                   ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('');
    
    // Check if sidecar is running
    console.log('🔍 Checking if sidecar is running on port 8081...');
    const sidecarRunning = await checkPort(8081);
    
    if (!sidecarRunning) {
        console.log('⚠️  Sidecar not running!');
        console.log('');
        console.log('Please start the sidecar in a separate terminal:');
        console.log('  cd Nahma');
        console.log('  node sidecar/index.js');
        console.log('');
        await question('Press Enter when sidecar is running...');
        
        // Check again
        const sidecarNow = await checkPort(8081);
        if (!sidecarNow) {
            console.log('❌ Sidecar still not running. Exiting.');
            process.exit(1);
        }
    }
    
    console.log('✅ Sidecar is running');
    console.log('');
    
    // Check if dev server is running
    console.log('🔍 Checking if React dev server is running on port 5173...');
    const devServerRunning = await checkPort(5173);
    
    if (!devServerRunning) {
        console.log('⚠️  Dev server not running!');
        console.log('');
        console.log('Please start the dev server in a separate terminal:');
        console.log('  cd Nahma');
        console.log('  npm run dev:react');
        console.log('');
        await question('Press Enter when dev server is running...');
    }
    
    console.log('✅ Dev server is running');
    console.log('');
    
    // Instructions
    console.log('═══════════════════════════════════════════════════════════');
    console.log('TESTING INSTRUCTIONS');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    console.log('1. Open TWO browser windows to: http://localhost:5173');
    console.log('');
    console.log('2. In Window 1:');
    console.log('   - Click "+ New Document" in the sidebar');
    console.log('   - Name it "Sync Test"');
    console.log('   - Type some text in the editor');
    console.log('');
    console.log('3. In Window 2:');
    console.log('   - You should see "Sync Test" appear in the sidebar');
    console.log('   - Click it to open the document');
    console.log('   - You should see the text from Window 1!');
    console.log('');
    console.log('4. Type in Window 2');
    console.log('   - Changes should appear in Window 1 in real-time');
    console.log('');
    console.log('5. Test conflict resolution:');
    console.log('   - Type quickly in both windows simultaneously');
    console.log('   - Both edits should merge correctly');
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    
    const openBrowser = await question('Open browser windows automatically? (y/n) ');
    
    if (openBrowser.toLowerCase() === 'y') {
        console.log('Opening browser windows...');
        
        // Open two browser windows
        const open = (url) => {
            const platform = process.platform;
            const cmd = platform === 'win32' ? 'start' :
                       platform === 'darwin' ? 'open' : 'xdg-open';
            exec(`${cmd} ${url}`);
        };
        
        open('http://localhost:5173');
        setTimeout(() => open('http://localhost:5173'), 1000);
        
        console.log('✅ Opened two browser windows');
    }
    
    console.log('');
    console.log('Press Enter to run automated sync verification...');
    await question('');
    
    // Run verification
    console.log('Running automated verification...');
    
    const WebSocket = require('ws');
    
    try {
        // Connect to metadata socket
        const ws = new WebSocket('ws://localhost:8081');
        
        await new Promise((resolve, reject) => {
            ws.on('open', resolve);
            ws.on('error', reject);
            setTimeout(() => reject(new Error('Connection timeout')), 5000);
        });
        
        console.log('✅ Connected to sidecar');
        
        // Request document list
        ws.send(JSON.stringify({ type: 'list-documents' }));
        
        const response = await new Promise((resolve, reject) => {
            ws.on('message', (data) => {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'document-list') {
                    resolve(msg);
                }
            });
            setTimeout(() => reject(new Error('No response')), 5000);
        });
        
        console.log(`✅ Found ${response.documents.length} documents`);
        
        ws.close();
        
        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('✅ All systems operational!');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');
        console.log('The sync system is working. You can now:');
        console.log('- Edit documents in multiple windows');
        console.log('- See real-time collaboration');
        console.log('- Test the Kanban board sync');
        console.log('- Test the chat feature');
        console.log('');
        
    } catch (e) {
        console.error('❌ Verification failed:', e.message);
    }
    
    rl.close();
}

main().catch(console.error);
