# Deploying a Custom Relay Server

This guide explains how to deploy the Nightjar unified server as a custom relay for cross-network workspace sharing.

## When Do You Need a Custom Relay?

**You don't need a custom relay if:**
- All users are on Electron (uses Hyperswarm DHT directly)
- Web users access from the same server hosting Nightjar
- An Electron user in the workspace has UPnP enabled (acts as relay)

**You need a custom relay for:**
- Browser-only workspaces across different networks
- Private/airgapped networks without Hyperswarm access
- Improved performance with a dedicated relay server

## Auto-Detection

By default, browser clients auto-detect the relay from `window.location.origin`:
- Hosted at `https://app.example.com` → Uses `wss://app.example.com` as relay
- Local development → Uses `ws://localhost:3000`
- Electron → No relay (uses Hyperswarm DHT)

## Deployment Options

### Option 1: Fly.io (Recommended)

**Free Tier:** 3 VMs, 160GB bandwidth/month

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Login
flyctl auth login

# Deploy from server/unified directory
cd server/unified
flyctl launch --name nightjar-relay
flyctl deploy

# Your relay URL: wss://nightjar-relay.fly.dev
```

**Configuration (`fly.toml`):**
```toml
app = "nightjar-relay"

[build]
  dockerfile = "Dockerfile"

[[services]]
  internal_port = 3000
  protocol = "tcp"

  [[services.ports]]
    handlers = ["http"]
    port = 80

  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443
```

### Option 2: Railway

**Free Tier:** $5 credit/month (~100 hours runtime)

1. Push code to GitHub
2. Go to [railway.app](https://railway.app)
3. "New Project" → "Deploy from GitHub"
4. Select your Nightjar repository
5. Set root directory: `server/unified`
6. Railway auto-detects Node.js and builds
7. Your relay URL: `wss://nightjar-relay.railway.app`

**Environment Variables:**
```
PORT=3000
NODE_ENV=production
```

### Option 3: Render

**Free Tier:** 750 hours/month, but **spins down after 15min inactivity** (cold starts)

1. Push code to GitHub
2. Go to [render.com](https://render.com)
3. "New Web Service"
4. Connect your repository
5. Settings:
   - **Root Directory:** `server/unified`
   - **Build Command:** `npm install`
   - **Start Command:** `node index.mjs`
6. Your relay URL: `wss://nightjar-relay.onrender.com`

⚠️ **Warning:** Render free tier has cold starts. First connection may take 30s.

### Option 4: Self-Hosted (VPS)

**Requirements:** Ubuntu 20.04+, Node.js 18+, Nginx

```bash
# On your server
git clone https://github.com/niyanagi/nightjar.git
cd nightjar/server/unified
npm install --production
npm start
```

**Nginx config (`/etc/nginx/sites-available/nightjar`):**
```nginx
server {
    listen 80;
    server_name relay.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

Enable SSL with Let's Encrypt:
```bash
sudo certbot --nginx -d relay.yourdomain.com
```

## Testing Your Relay

Test WebSocket connectivity:

```javascript
const ws = new WebSocket('wss://your-relay-url.com');
ws.onopen = () => console.log('✓ Connected');
ws.onerror = (e) => console.error('✗ Failed:', e);
```

Or use the built-in validator in Workspace Settings → Relay Server field.

## Using Your Custom Relay

1. Open Workspace Settings
2. In "Relay Server" field, enter your relay URL
3. Wait for validation (should show ✓ Connected with latency)
4. Generate share link - it will include your custom relay

## Monitoring

Check relay health:
- Fly.io: `flyctl logs`
- Railway: Dashboard → Deployments → Logs
- Render: Dashboard → Logs
- Self-hosted: `journalctl -u nightjar-relay -f`

## Cost Estimates

| Platform | Free Tier | Upgrade Cost |
|----------|-----------|--------------|
| Fly.io | 3 VMs, 160GB | $1.94/mo per VM |
| Railway | $5 credit | $0.000463/GB-sec |
| Render | 750hrs | $7/mo for always-on |
| DigitalOcean | None | $6/mo droplet |

## Security Notes

- The relay server does NOT see encryption keys (end-to-end encrypted)
- Only syncs encrypted Yjs updates between peers
- No persistent storage of document content
- Consider adding authentication for private relays
