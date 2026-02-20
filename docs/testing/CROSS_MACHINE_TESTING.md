# Cross-Machine Network Testing Guide

This guide explains how to build Nightjar for Mac and Windows, and test P2P collaboration over the internet.

## Quick Start

### 1. Build for Windows (on your PC)
```bash
npm run package:win
```
Output: `release/Nightjar Setup 1.0.0.exe` (installer) and `release/Nightjar 1.0.0.exe` (portable)

### 2. Build for Mac (requires a Mac)
On the Mac, clone the repo and run:
```bash
npm install
npm run package:mac
```
Output: `release/Nightjar-1.0.0.dmg` or `release/Nightjar-1.0.0-mac.zip`

> **Note**: Cross-compiling Mac apps from Windows is not supported by Electron. You must build on a Mac for Mac distribution.

---

## Network Architecture

Nightjar uses **Hyperswarm** for P2P discovery, which:
- Uses a DHT (Distributed Hash Table) for peer discovery over the internet
- Establishes direct peer-to-peer connections via hole-punching
- Falls back to relay servers when direct connection fails

### How Peers Connect
1. Both machines join the same "topic" (derived from the document/room name)
2. Hyperswarm DHT helps them discover each other
3. A direct connection is established (or relayed if behind strict NAT)

---

## Testing Scenarios

### Scenario A: Direct Internet Connection (Easiest)

If both machines have relatively open networks (home WiFi, not strict corporate firewall):

1. **On PC**: Run `npm run package:win`, send the executable to Mac user
2. **On Mac**: Build locally with `npm run package:mac`
3. Both launch Nightjar and create/join the same room
4. Hyperswarm handles discovery automatically

### Scenario B: Using the Relay Server

If direct P2P connection fails (strict NAT/firewall), use the built-in relay:

**On a server with public IP (or your PC if port-forwarded):**
```bash
npm run relay
```
This starts a WebSocket relay on port 8082.

Both clients can connect through this relay for guaranteed connectivity.

### Scenario C: Via Tor (Most Private)

Nightjar includes Tor support. Both machines need:
1. Tor running locally (port 9050)
2. The app will create .onion addresses for private connectivity

---

## Build Commands Reference

| Command | Description |
|---------|-------------|
| `npm run build` | Build the frontend (required before packaging) |
| `npm run package` | Build for current platform |
| `npm run package:win` | Build Windows .exe installer + portable |
| `npm run package:mac` | Build macOS .dmg + .zip |
| `npm run package:linux` | Build Linux AppImage + .deb |

---

## Troubleshooting Connection Issues

### Peers Not Discovering Each Other

1. **Check network connectivity**: Both machines need internet access
2. **Firewall**: Hyperswarm uses UDP for DHT. Ensure outbound UDP is allowed
3. **Same topic**: Verify both are joining the exact same room/document name

### Debug Mode

Run with debug logging:
```bash
# Windows
set DEBUG=hyperswarm* && npm start

# Mac/Linux  
DEBUG=hyperswarm* npm start
```

### Test Basic Connectivity

You can test if Hyperswarm works between machines by running the test script:
```bash
node scripts/test-hyperswarm-connectivity.js
```

---

## Sending the Windows Build to Mac

1. Run `npm run package:win` on your PC
2. The portable executable is at: `release/Nightjar 1.0.0.exe`
3. Share via cloud storage (Dropbox, Google Drive, etc.)

> **Important**: Windows executables won't run on Mac! You need to build on Mac for Mac users.

---

## Building Mac App from Mac

On your Mac:

```bash
# Clone your repo
git clone <your-repo-url>
cd Nightjar

# Install dependencies
npm install

# Build for Mac
npm run package:mac

# Find your build
ls release/
# Should see: Nightjar-1.0.0.dmg, Nightjar-1.0.0-arm64.dmg, etc.
```

---

## Alternative: Use GitHub Actions for Cross-Platform Builds

Add this workflow to `.github/workflows/build.yml` to automatically build for all platforms:

```yaml
name: Build

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:

jobs:
  build:
    strategy:
      matrix:
        os: [windows-latest, macos-latest, ubuntu-latest]
    
    runs-on: ${{ matrix.os }}
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - run: npm ci
      
      - run: npm run package
      
      - uses: actions/upload-artifact@v4
        with:
          name: Nightjar-${{ matrix.os }}
          path: release/*
```

Then you can download Mac builds from GitHub Actions artifacts!

---

## Testing Checklist

- [ ] Windows build runs and shows UI
- [ ] Mac build runs and shows UI  
- [ ] Both join same room (topic)
- [ ] Peer discovery works (see each other in user list)
- [ ] Text edits sync in real-time
- [ ] Cursors visible on both sides
- [ ] Disconnect/reconnect works
