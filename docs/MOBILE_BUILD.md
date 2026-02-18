# Mobile Build Guide (iOS & Android)

This guide covers building Nightjar for iOS and Android using Capacitor.

## Prerequisites

### All Platforms
- Node.js 18+
- npm 9+
- Capacitor CLI: Included in project dependencies

### iOS (macOS only)
- macOS 12 (Monterey) or later
- Xcode 14+
- CocoaPods: `sudo gem install cocoapods`
- Apple Developer account (for device testing and distribution)

### Android
- Android Studio (latest stable)
- Android SDK 33+ (API level 33)
- Java 17+
- Android device or emulator

## Initial Setup

### 1. Install Dependencies

```bash
# Install all project dependencies including Capacitor
npm install

# If Capacitor packages are missing, add them:
npm install @capacitor/core @capacitor/cli
npm install @capacitor/clipboard @capacitor/share @capacitor/haptics @capacitor/device @capacitor/splash-screen
```

### 2. Build Web App

```bash
npm run build
```

### 3. Add Native Platforms

```bash
# Add Android
npx cap add android

# Add iOS (macOS only)
npx cap add ios
```

### 4. Sync Web Assets to Native

```bash
npx cap sync
```

## Running on iOS

### Using Xcode

```bash
# Open project in Xcode
npm run cap:open:ios
# or
npx cap open ios

# In Xcode:
# 1. Select your target device/simulator
# 2. Click Run (⌘R)
```

### Command Line

```bash
# Build and run on connected device or simulator
npm run cap:run:ios
```

### Troubleshooting iOS

**Pod install fails:**
```bash
cd ios/App
pod install --repo-update
```

**Signing errors:**
1. Open Xcode
2. Select the project in the navigator
3. Select your target
4. Go to "Signing & Capabilities"
5. Select your development team

## Running on Android

### Using Android Studio

```bash
# Open project in Android Studio
npm run cap:open:android
# or
npx cap open android

# In Android Studio:
# 1. Wait for Gradle sync
# 2. Select your device/emulator
# 3. Click Run (Shift+F10)
```

### Command Line

```bash
# Build and run on connected device or emulator
npm run cap:run:android
```

### Troubleshooting Android

**Gradle sync fails:**
- Ensure Android SDK 33+ is installed
- Check Java version: `java -version` (needs 17+)
- Invalidate caches: Android Studio → File → Invalidate Caches

**Device not found:**
```bash
# List connected devices
adb devices

# If device shows as "unauthorized":
# 1. Disconnect USB
# 2. Revoke USB debugging on device
# 3. Reconnect and accept prompt
```

## Platform-Specific Features

### P2P Sync Capabilities

| Feature | iOS | Android | Electron | Web |
|---------|:---:|:-------:|:--------:|:---:|
| WebSocket Relay | ✅ | ✅ | ✅ | ✅ |
| WebRTC Direct | ✅ | ✅ | ✅ | ✅ |
| Hyperswarm DHT | ❌ | ❌ | ✅ | ❌ |
| mDNS LAN Discovery | ❌ | ❌ | ✅ | ❌ |
| Tor Integration | ❌ | ❌ | ✅ | ❌ |

**Note:** Mobile platforms rely on relay-based sync through the unified server.
DHT and mDNS require native Node.js which isn't available on mobile.

### Share Links

When sharing from mobile:
- Links include `srv:` parameter with the sync server URL
- This allows cross-platform joining (Electron users can join mobile workspaces)

Example mobile-generated link:
```
Nightjar://w/abc123#k:base64key&perm:e&srv:https%3A%2F%2Fapp.Nightjar.io
```

### Identity Storage

| Platform | Storage Method | Security |
|----------|---------------|----------|
| iOS | Keychain (via Preferences) | Hardware-backed |
| Android | EncryptedSharedPreferences | Hardware-backed |
| Electron | Encrypted file | Software |
| Web | localStorage | None (dev only) |

## Available npm Scripts

```bash
# iOS
npm run cap:add:ios        # Add iOS platform
npm run cap:sync:ios       # Sync web assets to iOS
npm run cap:open:ios       # Open in Xcode
npm run cap:run:ios        # Build and run on device

# Android
npm run cap:add:android    # Add Android platform
npm run cap:sync           # Sync web assets to all platforms
npm run cap:open:android   # Open in Android Studio
npm run cap:run:android    # Build and run on device

# General
npm run build              # Build web app
npx cap sync               # Sync to all platforms
npx cap doctor             # Check Capacitor health
```

## Testing Cross-Platform

### Unit Tests (Share Link Compatibility)

```bash
npm run test:cross-platform:sharing
```

Tests that share links generated on one platform can be parsed on another.

### Integration Tests (Document Sync)

```bash
npm run test:cross-platform:sync
```

Tests actual document synchronization between platform types.

### Manual Testing Checklist

#### iOS → Web
- [ ] Create workspace on iOS
- [ ] Share link via native share sheet
- [ ] Open link in web browser
- [ ] Verify both can edit document
- [ ] Verify changes sync in real-time

#### Android → Electron
- [ ] Create workspace on Android
- [ ] Share link
- [ ] Open in Electron app
- [ ] Verify sync works
- [ ] Test offline/reconnect

#### Three-Way Sync
- [ ] iOS + Android + Web editing same document
- [ ] Verify CRDT convergence (all see same content)
- [ ] Test rapid concurrent edits

## Building for Release

### iOS App Store

1. Configure signing in Xcode:
   - Team, bundle ID, certificates
2. Archive: Product → Archive
3. Distribute: Window → Organizer → Distribute App

### Android Play Store

1. Generate signing key:
```bash
keytool -genkey -v -keystore my-release-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias my-alias
```

2. Configure in `android/app/build.gradle`

3. Build release APK:
```bash
cd android
./gradlew assembleRelease
```

## Configuration

### capacitor.config.json

```json
{
  "appId": "com.saoneyanpa.Nightjar",
  "appName": "Nightjar",
  "webDir": "dist",
  "server": {
    "androidScheme": "https"
  },
  "plugins": {
    "SplashScreen": {
      "launchShowDuration": 2000,
      "backgroundColor": "#1a1a2e",
      "spinnerColor": "#6366f1"
    }
  },
  "android": {
    "allowMixedContent": true,
    "captureInput": true,
    "webContentsDebuggingEnabled": true
  }
}
```

### Environment-Specific Server URLs

For development, the app auto-detects:
- iOS Simulator: Uses localhost
- Android Emulator: Uses 10.0.2.2 (host loopback)
- Physical devices: Must use real server URL

Configure in `frontend/src/utils/websocket.js` or via environment variables.

## Known Limitations

1. **No offline P2P on mobile** - Requires internet connection to sync
2. **Background sync limited** - iOS/Android suspend apps in background
3. **Large documents** - Mobile has limited memory compared to desktop
4. **Tor not available** - Only Electron supports Tor integration

## Support

For issues:
1. Run `npx cap doctor` to check configuration
2. Check platform-specific logs in Xcode/Android Studio
3. Review the cross-platform test results
