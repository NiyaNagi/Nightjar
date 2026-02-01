#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const TOR_DIR = path.join(__dirname, '../tor');
const TOR_EXECUTABLE = path.join(TOR_DIR, getTorExecutableName());

function getTorExecutableName() {
    const platform = os.platform();
    const arch = os.arch();
    
    if (platform === 'win32') {
        return 'tor.exe';
    } else if (platform === 'darwin') {
        return 'tor';
    } else if (platform === 'linux') {
        if (arch === 'x64') {
            return 'tor';
        } else if (arch === 'arm64') {
            return 'tor';
        }
    }
    
    throw new Error('Unsupported platform or architecture for Tor bundling.');
}

function downloadTor() {
    if (!fs.existsSync(TOR_DIR)) {
        fs.mkdirSync(TOR_DIR, { recursive: true });
    }

    const platform = os.platform();
    const arch = os.arch();
    
    let downloadUrl;
    if (platform === 'win32') {
        downloadUrl = 'https://archive.torproject.org/tor-package-archive/torbrowser/15.0.4/tor-expert-bundle-windows-x86_64-15.0.4.tar.gz';
    } else if (platform === 'darwin') {
        downloadUrl = 'https://archive.torproject.org/tor-package-archive/torbrowser/15.0.4/tor-expert-bundle-macos-x86_64-15.0.4.tar.gz';
    } else if (platform === 'linux') {
        if (arch === 'x64') {
            downloadUrl = 'https://archive.torproject.org/tor-package-archive/torbrowser/15.0.4/tor-expert-bundle-linux-x86_64-15.0.4.tar.gz';
        } else if (arch === 'arm64') {
            downloadUrl = 'https://archive.torproject.org/tor-package-archive/torbrowser/15.0.4/tor-expert-bundle-linux-aarch64-15.0.4.tar.gz';
        }
    }
    
    if (!downloadUrl) {
        throw new Error('Unsupported platform or architecture for Tor bundling.');
    }
    
    console.log(`Downloading Tor from ${downloadUrl}...`);
    
    // Create a temp extraction directory to avoid conflicts
    const tempExtractDir = path.join(TOR_DIR, '_extract_temp');
    if (fs.existsSync(tempExtractDir)) {
        fs.rmSync(tempExtractDir, { recursive: true });
    }
    fs.mkdirSync(tempExtractDir, { recursive: true });
    
    // Use curl or wget to download the Tor executable
    try {
        const tarPath = path.join(TOR_DIR, 'tor.tar.gz');
        
        if (platform === 'win32') {
            execSync(`curl -L -o "${tarPath}" ${downloadUrl}`, { stdio: 'inherit' });
            
            // Verify the downloaded file exists and is not empty
            if (!fs.existsSync(tarPath) || fs.statSync(tarPath).size === 0) {
                throw new Error('Downloaded file is empty or does not exist.');
            }
            
            // Use PowerShell to extract the tar.gz file on Windows to temp dir
            execSync(`powershell -command "tar -xf '${tarPath}' -C '${tempExtractDir}'"`, { stdio: 'inherit' });
        } else {
            execSync(`curl -L -o "${tarPath}" ${downloadUrl}`, { stdio: 'inherit' });
            execSync(`tar -xf "${tarPath}" -C "${tempExtractDir}"`, { stdio: 'inherit' });
        }
        
        // Find the tor executable recursively in the temp extraction directory
        const findTorExecutable = (dir) => {
            const exeName = getTorExecutableName();
            const items = fs.readdirSync(dir, { withFileTypes: true });
            for (const item of items) {
                const itemPath = path.join(dir, item.name);
                if (item.isDirectory()) {
                    const found = findTorExecutable(itemPath);
                    if (found) return found;
                } else if (item.name === exeName) {
                    return itemPath;
                }
            }
            return null;
        };
        
        const torPath = findTorExecutable(tempExtractDir);
        if (!torPath) {
            throw new Error('Could not find tor executable in extracted archive');
        }
        
        // Remove any existing file/directory at the destination
        if (fs.existsSync(TOR_EXECUTABLE)) {
            const stat = fs.statSync(TOR_EXECUTABLE);
            if (stat.isDirectory()) {
                fs.rmSync(TOR_EXECUTABLE, { recursive: true });
            } else {
                fs.unlinkSync(TOR_EXECUTABLE);
            }
        }
        
        // Copy the executable to the correct location
        fs.copyFileSync(torPath, TOR_EXECUTABLE);
        if (platform !== 'win32') {
            fs.chmodSync(TOR_EXECUTABLE, 0o755);
        }
        console.log(`Copied Tor executable from ${torPath} to ${TOR_EXECUTABLE}`);
        
        // Clean up the downloaded archive and temp directory
        if (fs.existsSync(tarPath)) {
            fs.unlinkSync(tarPath);
        }
        if (fs.existsSync(tempExtractDir)) {
            fs.rmSync(tempExtractDir, { recursive: true });
        }
        
        console.log('Tor downloaded and extracted successfully.');
    } catch (error) {
        console.error('Failed to download or extract Tor:', error);
        throw error;
    }
}

function startTor() {
    if (!fs.existsSync(TOR_EXECUTABLE)) {
        console.log('Tor executable not found. Downloading...');
        downloadTor();
    }
    
    console.log('Starting Tor...');
    
    // Start Tor with the necessary configuration
    const torProcess = execSync(`"${TOR_EXECUTABLE}" --SocksPort 9050 --ControlPort 9051 --DataDirectory ${TOR_DIR}/data`, { stdio: 'inherit' });
    
    console.log('Tor started successfully.');
}

// In CI environment, only download Tor, don't start it
// GitHub Actions sets CI=true, GITHUB_ACTIONS=true
const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true' || process.env.CI === true;
if (isCI) {
    console.log('CI environment detected. Downloading Tor binary only (not starting)...');
    if (!fs.existsSync(TOR_EXECUTABLE)) {
        downloadTor();
    } else {
        console.log('Tor executable already exists.');
    }
    console.log('Skipping Tor startup in CI environment.');
    process.exit(0);
}

// Check if Tor is already running
try {
    const platform = os.platform();
    let command;
    
    if (platform === 'win32') {
        // Windows: Use tasklist to check for tor.exe
        command = 'tasklist | findstr "tor.exe"';
    } else {
        // Unix-based systems: Use pgrep
        command = 'pgrep -f tor';
    }
    
    execSync(command, { stdio: 'ignore' });
    console.log('Tor is already running.');
} catch (error) {
    startTor();
}