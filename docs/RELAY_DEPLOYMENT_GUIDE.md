# Nightjar Relay Server — Deployment Guide

Step-by-step instructions for deploying a Nightjar relay server on a VPS with Docker and Caddy (auto-TLS).

## Overview

The relay server is the rendezvous point for Nightjar clients that cannot connect directly via Hyperswarm (e.g., restrictive NATs, browser clients, or Tor-enabled privacy mode). It is **zero-knowledge** — it only sees opaque encrypted blobs and cannot read any content.

### Deployment Modes

| Mode | Persistence | Mesh | Use Case |
|------|------------|------|----------|
| **host** (default) | ✅ SQLite | ✅ DHT | Main server — stores encrypted backups |
| **relay** | ❌ | ✅ DHT | Lightweight relay — just routes connections |
| **private** | ✅ SQLite | ❌ | Isolated — no public mesh participation |

For a public relay at `relay.night-jar.io`, use **relay** mode.

---

## Prerequisites

- A VPS with a public IP (Ubuntu 22.04+ recommended)
- A domain name with DNS pointing to the VPS (e.g., `relay.night-jar.io`)
- Docker and Docker Compose installed
- Ports 80 and 443 open (for Caddy auto-TLS)
- Port 3000 open internally (Nightjar server)

---

## Step 1: Provision the VPS

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER

# Install Docker Compose plugin
sudo apt install docker-compose-plugin -y

# Verify
docker --version
docker compose version
```

---

## Step 2: Install Caddy (Reverse Proxy with Auto-TLS)

Caddy automatically provisions and renews Let's Encrypt certificates.

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy -y
```

---

## Step 3: Clone the Repository

```bash
cd /opt
sudo git clone https://github.com/InyanRock/Nightjar.git
cd Nightjar
```

---

## Step 4: Configure Caddy

Create `/etc/caddy/Caddyfile`:

```caddyfile
relay.night-jar.io {
    # Reverse proxy to Nightjar server
    reverse_proxy localhost:3000

    # WebSocket support is automatic in Caddy
    # TLS is automatic via Let's Encrypt
}
```

```bash
# Reload Caddy
sudo systemctl reload caddy

# Verify Caddy is running
sudo systemctl status caddy
```

---

## Step 5: Start the Relay Server

### Option A: Docker Compose (Recommended)

```bash
cd /opt/Nightjar/server/unified

# Relay mode (lightweight, no persistence)
PUBLIC_URL=wss://relay.night-jar.io docker compose --profile relay up -d

# Or host mode (with encrypted persistence) — starts by default
PUBLIC_URL=wss://relay.night-jar.io docker compose up -d
```

### Option B: Docker Run

```bash
docker build -t nightjar-server -f server/unified/Dockerfile .

docker run -d \
  --name nightjar-relay \
  --restart unless-stopped \
  -e NIGHTJAR_MODE=relay \
  -e PUBLIC_URL=wss://relay.night-jar.io \
  -e NODE_ENV=production \
  -p 3000:3000 \
  nightjar-server
```

### Option C: Direct Node.js

```bash
cd server/unified
npm install

# Build frontend (if serving web clients)
cd ../../frontend
npm run build
cd ../server/unified

# Start
PUBLIC_URL=wss://relay.night-jar.io NIGHTJAR_MODE=relay node index.js
```

---

## Step 6: Verify Deployment

```bash
# Local health check
curl http://localhost:3000/health

# External health check (after DNS propagates)
curl https://relay.night-jar.io/health
```

Expected response:
```json
{
  "status": "ok",
  "rooms": 0,
  "uptime": 42.5,
  "persistenceEnabled": false,
  "meshEnabled": true,
  "serverMode": "relay"
}
```

### Test WebSocket connectivity:
```bash
# Install wscat if needed
npm i -g wscat

# Test signaling endpoint
wscat -c wss://relay.night-jar.io/signal
# Should receive: {"type":"welcome","peerId":"...","serverTime":...}
```

---

## Step 7: DNS Configuration

Add an A record pointing your domain to the VPS IP:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | relay | `<VPS_IP>` | 300 |

Wait for DNS propagation (usually < 5 minutes).

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `NIGHTJAR_MODE` | `host` | Server mode: `host`, `relay`, or `private` |
| `PUBLIC_URL` | (none) | WebSocket URL for mesh announcements (e.g., `wss://relay.night-jar.io`) |
| `STATIC_PATH` | `../../frontend/dist` | Path to built React app |
| `DB_PATH` | `./data/Nightjar.db` | SQLite database path (host/private modes) |
| `MAX_PEERS_PER_ROOM` | `100` | Max concurrent users per workspace |
| `NAHMA_DISABLE_PERSISTENCE` | `false` | Set to `true` to disable persistence (relay mode sets this automatically) |

---

## Monitoring

### Docker logs
```bash
docker logs -f nightjar-relay
```

### Health check endpoint
```bash
# Returns JSON with room count, uptime, mode
curl -s https://relay.night-jar.io/health | jq .
```

### Mesh status
```bash
# View mesh network status
curl -s https://relay.night-jar.io/api/mesh/status | jq .

# View top relay nodes
curl -s https://relay.night-jar.io/api/mesh/relays | jq .
```

---

## Security Checklist

- [ ] TLS termination via Caddy (automatic Let's Encrypt)
- [ ] Firewall: only ports 80, 443 open externally
- [ ] Docker runs as non-root user (`nightjar`)
- [ ] Rate limiting: 10 req/s general, 5 req/s WebSocket
- [ ] WebSocket `maxPayload`: 1 MB signaling, 10 MB document sync
- [ ] No plaintext data — server only handles encrypted blobs
- [ ] Set `PUBLIC_URL` so the server can announce itself in the relay mesh

---

## Upgrading

```bash
cd /opt/Nightjar
git pull origin main
docker compose --profile relay build --no-cache
docker compose --profile relay up -d
```

---

## Troubleshooting

### Server won't start
```bash
# Check logs
docker logs nightjar-relay

# Common issues:
# - Port 3000 already in use → check with: ss -tlnp | grep 3000
# - Missing frontend build → cd frontend && npm run build
```

### WebSocket connections fail
```bash
# Check if Caddy is proxying correctly
curl -v https://relay.night-jar.io/health

# Check Caddy logs
sudo journalctl -u caddy -f
```

### TLS certificate issues
```bash
# Caddy auto-provisions certs — ensure:
# 1. DNS A record points to this server
# 2. Ports 80 and 443 are open
# 3. Caddy has permission to bind to ports 80/443

sudo caddy validate --config /etc/caddy/Caddyfile
```

### Clients can't connect
- Verify `BOOTSTRAP_NODES` in `sidecar/mesh-constants.js` points to the correct URL
- Clients gracefully fall back to direct Hyperswarm P2P if relay is unreachable
- Check client console logs for `[RelayBridge]` messages
