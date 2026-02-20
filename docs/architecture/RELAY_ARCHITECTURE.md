# Relay & P2P Architecture

Nightjar uses a hybrid P2P architecture combining Hyperswarm DHT, WebSocket relays, and WebRTC for peer discovery and sync.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Nightjar P2P Stack                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐         ┌──────────────┐                  │
│  │   Electron   │◄───────►│   Electron   │                  │
│  │    Client    │         │    Client    │                  │
│  └──────┬───────┘         └──────┬───────┘                  │
│         │                         │                          │
│         │   Hyperswarm DHT        │                          │
│         │   (Direct P2P)          │                          │
│         │                         │                          │
│         └────────┬────────────────┘                          │
│                  │                                            │
│                  │                                            │
│         ┌────────▼────────┐                                  │
│         │  Embedded Relay │                                  │
│         │   (UPnP enabled)│                                  │
│         └────────┬────────┘                                  │
│                  │                                            │
│         ┌────────▼────────┐                                  │
│         │  WebSocket Relay│                                  │
│         │   (Public/Self) │                                  │
│         └────────┬────────┘                                  │
│                  │                                            │
│         ┌────────▼────────┐      ┌──────────────┐            │
│         │     Browser     │◄────►│    Browser   │            │
│         │     Client      │      │    Client    │            │
│         └─────────────────┘      └──────────────┘            │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Connection Types

### 1. Electron ↔ Electron (Hyperswarm DHT)

**Protocol:** Direct P2P via Hyperswarm  
**Relay:** None needed  
**Discovery:** DHT topic hash

```javascript
// Electron clients join Hyperswarm topic
const topic = sha256(workspaceId);
swarm.join(topic);
// Direct encrypted connections between peers
```

**Advantages:**
- Truly decentralized (no server)
- Low latency (direct connection)
- Works offline on same network

**Requirements:**
- Both clients on Electron
- Internet access for DHT bootstrap
- UPnP or manual port forwarding (optional, for better connectivity)

### 2. Browser ↔ Browser (WebSocket Relay)

**Protocol:** WebSocket via relay server  
**Relay:** Required (auto-detected or custom)  
**Discovery:** Room-based on relay

```javascript
// Browser auto-detects relay from window.location.origin
const relay = window.location.origin.replace('https:', 'wss:');
provider = new WebsocketProvider(relay, workspaceId, ydoc);
```

**Relay Auto-Detection:**
- `https://app.example.com` → `wss://app.example.com`
- `http://localhost:3000` → `ws://localhost:3000`
- `file://` (Electron) → No relay

**Advantages:**
- Works in any browser
- No installation required
- Firewall-friendly

**Limitations:**
- Requires relay server
- Relay sees encrypted traffic (but not plaintext)

### 3. Electron ↔ Browser (Hybrid)

**Protocol:** Electron embeds relay + bridges to Hyperswarm  
**Relay:** Electron user's embedded relay (via UPnP)  
**Discovery:** Relay URL in share link

```javascript
// Electron user enables embedded relay via UPnP
const relayUrl = 'wss://123.45.67.89:4445';

// Share link includes relay URL
const shareLink = generateShareLink({
  workspaceId,
  serverUrl: relayUrl, // Electron user's public relay
  encryptionKey
});

// Browser connects to Electron's relay
// Electron bridges WebSocket ↔ Hyperswarm
```

**Advantages:**
- Zero-config for users
- No central server needed
- Electron user acts as relay

**Requirements:**
- At least one Electron user with UPnP
- Or manually forwarded port

## Zero-Config Approach

Nightjar achieves zero-config through:

1. **Auto-Detection:**
   - Browser: `window.location.origin` → relay URL
   - Electron: Hyperswarm DHT
   - Development: `ws://localhost:3000`

2. **User-Hosted Relays:**
   - Electron app includes embedded relay server
   - UPnP automatically opens port
   - Share links include Electron user's public IP

3. **Fallback Chain:**
   - Try custom relay (if configured)
   - Fall back to auto-detected relay
   - For Electron: use Hyperswarm DHT directly

## Custom Relay Configuration

**When to use custom relay:**
- Private network without Hyperswarm access
- Browser-only workspaces
- Improved performance with dedicated server

**How to configure:**
1. Deploy relay (see [RELAY_DEPLOYMENT.md](RELAY_DEPLOYMENT.md))
2. Open Workspace Settings
3. Enter relay URL in "Relay Server" field
4. Validation confirms connectivity
5. Share link includes custom relay

## Security Model

### End-to-End Encryption

All document data is encrypted before reaching relay:

```javascript
// Encryption happens client-side
const encrypted = encrypt(docContent, workspaceKey);

// Relay only sees encrypted Yjs updates
wsRelay.send(encrypted);
```

**Relay server sees:**
- WebSocket handshake metadata
- Encrypted Yjs sync messages
- Awareness updates (user presence)

**Relay server does NOT see:**
- Encryption keys
- Document content (plaintext)
- User passwords

### Trust Model

- **Hyperswarm DHT:** Trustless (direct P2P)
- **User-hosted relay:** Trust Electron peer
- **Custom relay:** Trust your deployment
- **Auto-detected relay:** Trust hosting provider

## Performance Characteristics

| Connection Type | Latency | Bandwidth | Scalability |
|----------------|---------|-----------|-------------|
| Electron ↔ Electron | ~10-50ms | Unlimited | P2P limited |
| Browser ↔ Browser (local relay) | ~20-100ms | Server-limited | Relay-limited |
| Electron ↔ Browser (embedded) | ~20-100ms | Upload-limited | 5-10 browsers |
| Custom relay (cloud) | ~50-200ms | Provider-limited | Very high |

## Troubleshooting

### Peers Not Connecting

1. **Check relay URL:**
   - Workspace Settings → Relay Server
   - Should show ✓ Connected

2. **Check network:**
   - Firewall blocking WebSocket?
   - Proxy interfering?

3. **Check DHT (Electron):**
   - Run: `DEBUG=hyperswarm* npm start`
   - Check for "joined topic" messages

### Relay Validation Failed

- **URL format:** Must be `ws://` or `wss://`
- **Port:** May need explicit port (e.g., `:443`)
- **SSL:** `wss://` requires valid certificate
- **Firewall:** Outbound WebSocket allowed?

### High Latency

- Use closer relay server
- Check relay server load
- Consider dedicated relay vs free tier

## Best Practices

1. **For public apps:** Deploy custom relay for reliability
2. **For private apps:** Use Electron-only (Hyperswarm)
3. **For hybrid:** Enable UPnP on Electron users
4. **For development:** Use `ws://localhost:3000`

## References

- [Hyperswarm DHT](https://github.com/hyperswarm/hyperswarm)
- [Y-WebSocket Protocol](https://github.com/yjs/y-websocket)
- [WebRTC with STUN/TURN](https://webrtc.org/getting-started/peer-connections)
