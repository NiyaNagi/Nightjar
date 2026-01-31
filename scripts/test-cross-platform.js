#!/usr/bin/env node

const { execSync } = require('child_process');
const os = require('os');

console.log('Testing cross-platform compatibility...');

try {
    // Test if the application can be built
    console.log('Building the application...');
    execSync('npm run package', { stdio: 'inherit' });
    console.log('Build successful.');
    
    // Test if the application can be started
    console.log('Starting the application...');
    const platform = os.platform();
    
    if (platform === 'win32') {
        execSync('npm start', { stdio: 'inherit' });
    } else {
        execSync('npm start &', { stdio: 'inherit' });
    }
    
    console.log('Application started successfully.');
    
    // Test if the WebSocket servers are running
    console.log('Testing WebSocket servers...');
    execSync('curl -v ws://localhost:8080', { stdio: 'inherit' });
    execSync('curl -v ws://localhost:8081', { stdio: 'inherit' });
    
    console.log('Cross-platform compatibility test passed.');
} catch (error) {
    console.error('Cross-platform compatibility test failed:', error);
    process.exit(1);
}