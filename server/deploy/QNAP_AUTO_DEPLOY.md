# Nightjar QNAP Auto-Deploy with Cloudflare Tunnel

This guide sets up **automatic deployment** of Nightjar to your QNAP NAS with **Cloudflare Tunnel** for secure public access - no port forwarding required!

## What You'll Get

- ✅ **Auto-Deploy**: Push to GitHub → Image builds → QNAP auto-pulls
- ✅ **Zero Port Forwarding**: Cloudflare Tunnel handles everything
- ✅ **Free SSL**: Automatic HTTPS via Cloudflare
- ✅ **DDoS Protection**: Cloudflare's edge network
- ✅ **Dynamic DNS**: Works even if your home IP changes

---

## Prerequisites

Before starting, make sure you have:

1. **QNAP NAS** with Container Station 2.0+ installed
2. **SSH access** to your QNAP (enable in Control Panel → Network & File Services → Telnet/SSH)
3. **GitHub Account** (for repository and container registry)
4. **Cloudflare Account** (free tier works)
5. **Domain Name** - you need to own a domain (can be purchased from any registrar)
6. **Git** installed on your local machine

### Verify QNAP Docker Support

SSH into your QNAP and verify Docker is installed:

```bash
ssh admin@your-nas-ip
docker --version    # Should show Docker version
docker-compose --version  # Should show docker-compose version
```

If `docker-compose` is not found, you may need to use `docker compose` (with a space) on newer versions.

---

## Overview: Order of Operations

⚠️ **Important**: Follow these phases in exact order!

| Phase | What You Do | Why First |
|-------|------------|-----------|
| 1 | GitHub Actions Setup | Builds Docker images |
| 2 | First Build & Registry | Creates images to pull |
| 3 | Cloudflare Domain & Tunnel | Creates tunnel token |
| 4 | QNAP Container Setup | Pulls images, runs stack |
| 5 | Configure Tunnel Routes | Connects domain → containers |
| 6 | Test & Verify | Confirms everything works |

---

## Phase 1: GitHub Actions Setup (10 minutes)

First, we set up GitHub to automatically build Docker images when you push code.

### Step 1.1: Verify Workflow File Exists

The workflow file should already exist at `.github/workflows/deploy-qnap.yml`.

If it doesn't exist, create it with this content:

```yaml
name: Build and Push to GHCR

on:
  push:
    branches: [main]
    paths:
      - 'frontend/**'
      - 'server/**'
      - 'sidecar/**'
      - '.github/workflows/deploy-qnap.yml'
  workflow_dispatch:  # Allows manual trigger

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Log in to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build and push Web image
        uses: docker/build-push-action@v5
        with:
          context: .
          file: ./server/docker/Dockerfile.web
          push: true
          tags: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}/web:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Build and push Signal image
        uses: docker/build-push-action@v5
        with:
          context: ./server/signaling
          file: ./server/docker/Dockerfile.signal
          push: true
          tags: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}/signal:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Build and push Persist image
        uses: docker/build-push-action@v5
        with:
          context: ./server/persistence
          file: ./server/docker/Dockerfile.persist
          push: true
          tags: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}/persist:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

### Step 1.2: Enable Repository Permissions

1. Go to your GitHub repository
2. Navigate to **Settings** → **Actions** → **General**
3. Scroll to "Workflow permissions"
4. Select **Read and write permissions**
5. Check **Allow GitHub Actions to create and approve pull requests**
6. Click **Save**

### Step 1.3: Note Your Image Names

Your images will be published to:
- `ghcr.io/YOUR_USERNAME/YOUR_REPO/web:latest`
- `ghcr.io/YOUR_USERNAME/YOUR_REPO/signal:latest`
- `ghcr.io/YOUR_USERNAME/YOUR_REPO/persist:latest`

Example: If your repo is `johndoe/Nightjar`, images will be at:
- `ghcr.io/johndoe/Nightjar/web:latest`

---

## Phase 2: Trigger First Build (5 minutes)

You need images in the registry BEFORE QNAP can pull them.

### Step 2.1: Commit and Push

```bash
# Add the workflow file if you created it
git add .github/workflows/deploy-qnap.yml

# Commit and push
git commit -m "Add auto-deploy workflow"
git push origin main
```

### Step 2.2: Monitor the Build

1. Go to your GitHub repository
2. Click the **Actions** tab
3. You should see "Build and Push to GHCR" running
4. Wait for it to complete (usually 3-5 minutes)
5. All three images should show ✅ green checkmarks

### Step 2.3: Verify Images Exist

1. Go to your GitHub repository main page
2. Look at the right sidebar for **Packages**
3. Click to see your three images: `web`, `signal`, `persist`

### Step 2.4: Make Packages Publicly Accessible (Recommended)

By default, packages inherit the repository visibility. For public access:

1. Click on each package (web, signal, persist)
2. Go to **Package settings** (right sidebar)
3. Scroll to "Danger Zone"
4. Click **Change visibility** → **Public**
5. Repeat for all three packages

**Alternative (Private Packages)**: Skip this step, but you'll need to configure QNAP with registry authentication (covered in Phase 4).

---

## Phase 3: Cloudflare Setup (15 minutes)

Now we set up Cloudflare to manage your domain and create the tunnel.

### Step 3.1: Add Your Domain to Cloudflare

1. Log into [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Click **Add a Site**
3. Enter your domain (e.g., `example.com`)
4. Select **Free** plan
5. Cloudflare scans your existing DNS records - review and confirm
6. Cloudflare shows you two nameservers (e.g., `ada.ns.cloudflare.com`)

### Step 3.2: Update Domain Nameservers

Go to your domain registrar (GoDaddy, Namecheap, Google Domains, etc.):

1. Find DNS or Nameserver settings
2. Replace existing nameservers with Cloudflare's nameservers
3. Save changes
4. **Wait 5-30 minutes** for propagation

Check status in Cloudflare Dashboard - it will show "Active" when ready.

### Step 3.3: Create a Cloudflare Tunnel

1. In Cloudflare Dashboard, click **Zero Trust** in left sidebar
2. First time? Complete the onboarding (free plan works)
3. Navigate to **Networks** → **Tunnels**
4. Click **Create a tunnel**
5. Select **Cloudflared** as connector type
6. Name it: `Nightjar-qnap`
7. Click **Save tunnel**

### Step 3.4: Get Your Tunnel Token

After creating the tunnel, you'll see installation options. Look for:

```
cloudflared service install eyJhIjoiZjQ1NjM4...
```

**Copy the entire token** (the long string starting with `eyJ...`)

⚠️ **Keep this token secret!** Anyone with it can connect to your tunnel.

### Step 3.5: Skip the "Install Connector" Step for Now

Cloudflare will ask you to install the connector. We'll do this via Docker, so:

1. Click **Next** or **Skip** 
2. Don't run the commands they show - we'll use Docker instead

---

## Phase 4: QNAP Container Setup (20 minutes)

Now we configure your QNAP to run the Docker containers.

### Step 4.1: SSH into Your QNAP

```bash
ssh admin@YOUR_NAS_IP_ADDRESS
```

Enter your admin password when prompted.

### Step 4.2: Create Directory Structure

```bash
# Create the Nightjar directory
mkdir -p /share/Container/Nightjar/data

# Navigate to it
cd /share/Container/Nightjar
```

### Step 4.3: Create the Docker Compose File

Create the docker-compose.yml file:

```bash
cat > docker-compose.yml << 'ENDOFFILE'
version: '3.8'

# ============================================
# Nightjar Auto-Deploy Stack with Cloudflare Tunnel
# ============================================
# 
# Before running:
# 1. Create .env file with your settings (see Step 4.4)
# 2. If packages are private, run: docker login ghcr.io
# 3. Run: docker-compose up -d
#

services:
  # ----------------------------------------
  # Cloudflare Tunnel - Secure Internet Access
  # ----------------------------------------
  # Creates an outbound encrypted tunnel to Cloudflare
  # No ports need to be opened on your router!
  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: Nightjar-tunnel
    restart: unless-stopped
    command: tunnel run
    environment:
      - TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN}
    networks:
      - Nightjar-network
    depends_on:
      - nginx
      - signaling

  # ----------------------------------------
  # Watchtower - Automatic Updates
  # ----------------------------------------
  # Polls GitHub Container Registry every 5 minutes
  # Automatically pulls new images and restarts containers
  watchtower:
    image: containrrr/watchtower:latest
    container_name: Nightjar-watchtower
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - WATCHTOWER_CLEANUP=true
      - WATCHTOWER_POLL_INTERVAL=300
      - WATCHTOWER_INCLUDE_RESTARTING=true
      - WATCHTOWER_LABEL_ENABLE=true
    command: --interval 300

  # ----------------------------------------
  # Nginx Web Server
  # ----------------------------------------
  # Serves the frontend and proxies API requests
  nginx:
    image: ghcr.io/${GITHUB_USER}/${GITHUB_REPO}/web:latest
    container_name: Nightjar-web
    restart: unless-stopped
    labels:
      - "com.centurylinklabs.watchtower.enable=true"
    networks:
      - Nightjar-network
    depends_on:
      - signaling
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost/health"]
      interval: 30s
      timeout: 3s
      retries: 3

  # ----------------------------------------
  # Signaling Server
  # ----------------------------------------
  # WebRTC signaling for peer discovery
  signaling:
    image: ghcr.io/${GITHUB_USER}/${GITHUB_REPO}/signal:latest
    container_name: Nightjar-signal
    restart: unless-stopped
    labels:
      - "com.centurylinklabs.watchtower.enable=true"
    environment:
      - PORT=4444
      - MAX_PEERS_PER_ROOM=50
    networks:
      - Nightjar-network
    healthcheck:
      test: ["CMD-SHELL", "node -e \"require('net').connect(4444).on('error', () => process.exit(1)).on('connect', () => process.exit(0))\""]
      interval: 30s
      timeout: 3s
      retries: 3

  # ----------------------------------------
  # Persistence Server
  # ----------------------------------------
  # Stores encrypted document state in SQLite
  persistence:
    image: ghcr.io/${GITHUB_USER}/${GITHUB_REPO}/persist:latest
    container_name: Nightjar-persist
    restart: unless-stopped
    labels:
      - "com.centurylinklabs.watchtower.enable=true"
    environment:
      - SIGNALING_URL=ws://signaling:4444
      - DB_PATH=/app/data/persistence.db
    volumes:
      - ./data:/app/data
    depends_on:
      - signaling
    networks:
      - Nightjar-network

networks:
  Nightjar-network:
    driver: bridge
    name: Nightjar-network
ENDOFFILE
```

### Step 4.4: Create the Environment File

Create the `.env` file with your settings:

```bash
cat > .env << 'ENDOFFILE'
# ============================================
# Nightjar Environment Configuration
# ============================================

# Cloudflare Tunnel Token
# Get this from: Cloudflare Dashboard → Zero Trust → Networks → Tunnels → Your Tunnel
CLOUDFLARE_TUNNEL_TOKEN=YOUR_TUNNEL_TOKEN_HERE

# GitHub Container Registry Settings
# This should be lowercase!
GITHUB_USER=your-github-username
GITHUB_REPO=your-repo-name
ENDOFFILE
```

Now edit the file with your actual values:

```bash
nano .env
```

Replace:
- `YOUR_TUNNEL_TOKEN_HERE` → The token from Step 3.4 (starts with `eyJ...`)
- `your-github-username` → Your GitHub username (lowercase)
- `your-repo-name` → Your repository name (lowercase)

**Example:**
```
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoiZjQ1NjM4...
GITHUB_USER=johndoe
GITHUB_REPO=Nightjar
```

Press `Ctrl+O` to save, `Enter` to confirm, `Ctrl+X` to exit.

### Step 4.5: (Optional) Configure Private Registry Access

**Skip this step if you made packages public in Step 2.4.**

If your packages are private, authenticate with GitHub Container Registry:

1. **Create a Personal Access Token (PAT):**
   - Go to GitHub → Settings → Developer Settings
   - Click **Personal access tokens** → **Tokens (classic)**
   - Click **Generate new token (classic)**
   - Name: `QNAP Docker Pull`
   - Expiration: Set as needed (or "No expiration")
   - Scopes: Check only `read:packages`
   - Click **Generate token**
   - **Copy the token immediately!**

2. **Login on QNAP:**
   ```bash
   docker login ghcr.io -u YOUR_GITHUB_USERNAME
   ```
   When prompted for password, paste your PAT.

3. **Copy credentials for Watchtower:**
   ```bash
   mkdir -p /share/Container/Nightjar/docker-config
   cp ~/.docker/config.json /share/Container/Nightjar/docker-config/
   ```

4. **Update docker-compose.yml** to mount the config:
   Add this under the watchtower service's volumes:
   ```yaml
   - /share/Container/Nightjar/docker-config/config.json:/config.json:ro
   ```

### Step 4.6: Pull Images and Start Containers

```bash
cd /share/Container/Nightjar

# Pull all images first (see any errors early)
docker-compose pull

# Start all containers in background
docker-compose up -d
```

### Step 4.7: Verify All Containers Are Running

```bash
docker ps
```

You should see 5 containers with STATUS "Up":

| CONTAINER | IMAGE | STATUS |
|-----------|-------|--------|
| Nightjar-tunnel | cloudflare/cloudflared:latest | Up |
| Nightjar-watchtower | containrrr/watchtower:latest | Up |
| Nightjar-web | ghcr.io/.../web:latest | Up |
| Nightjar-signal | ghcr.io/.../signal:latest | Up |
| Nightjar-persist | ghcr.io/.../persist:latest | Up |

If any container is not running, check logs:

```bash
docker logs Nightjar-tunnel
docker logs Nightjar-web
```

---

## Phase 5: Configure Cloudflare Tunnel Routes (10 minutes)

Now we tell Cloudflare how to route traffic to your containers.

### Step 5.1: Add Main Application Route

1. Go to Cloudflare Dashboard → **Zero Trust**
2. Navigate to **Networks** → **Tunnels**
3. Click on your tunnel (`Nightjar-qnap`)
4. Go to the **Public Hostname** tab
5. Click **Add a public hostname**

Configure the main app:
| Field | Value |
|-------|-------|
| Subdomain | `Nightjar` (or your choice) |
| Domain | Select your domain |
| Path | (leave empty) |
| Type | HTTP |
| URL | `Nightjar-web:80` |

Click **Save hostname**.

### Step 5.2: Add WebSocket Signaling Route

Click **Add a public hostname** again:

| Field | Value |
|-------|-------|
| Subdomain | `Nightjar` (same as above) |
| Domain | Select your domain |
| Path | `signal` |
| Type | HTTP |
| URL | `Nightjar-signal:4444` |

**Important - Enable WebSockets:**

1. Expand **Additional application settings**
2. Under **HTTP Settings**, find **WebSockets**
3. Toggle it **ON**

Click **Save hostname**.

### Step 5.3: Verify Tunnel Connection

Check that the tunnel shows as **Healthy** in the Cloudflare Dashboard.

You can also verify from QNAP:

```bash
docker logs Nightjar-tunnel --tail 20
```

Look for messages like:
```
Connection registered with ID ...
Registered tunnel connection ...
```

---

## Phase 6: Test and Verify (5 minutes)

### Step 6.1: Test Web Access

Open your browser and go to:

```
https://Nightjar.yourdomain.com
```

You should see the Nightjar welcome screen!

### Step 6.2: Test P2P Sync

1. Create an identity and workspace in one browser
2. Copy the workspace link
3. Open an incognito window or different browser
4. Paste the link
5. Both windows should sync in real-time

### Step 6.3: Test Auto-Deploy

1. Make a small change to your code
2. Commit and push to main
3. Check GitHub Actions - build should start
4. Wait 5-10 minutes
5. Your QNAP should automatically pull the new image

Verify with:
```bash
docker logs Nightjar-watchtower --tail 50
```

Look for:
```
Found new ghcr.io/.../web:latest image
Stopping container Nightjar-web
Creating container Nightjar-web
```

---

## How It All Works

### Deployment Flow

```
┌──────────────────────────────────────────────────────────┐
│ 1. Developer pushes code to GitHub                       │
│    └─► git push origin main                              │
└──────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│ 2. GitHub Actions triggered                              │
│    └─► Builds Docker images                              │
│    └─► Pushes to ghcr.io                                 │
└──────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│ 3. Watchtower on QNAP (checks every 5 min)               │
│    └─► Detects new image                                 │
│    └─► Pulls new image                                   │
│    └─► Stops old container                               │
│    └─► Starts new container                              │
└──────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│ 4. Zero-downtime deployment complete! 🎉                 │
└──────────────────────────────────────────────────────────┘
```

### Network Flow

```
┌─────────────────┐         ┌─────────────────┐
│   User Browser  │◄───────►│ Cloudflare Edge │
│                 │  HTTPS  │  (Your domain)  │
└─────────────────┘         └────────┬────────┘
                                     │
                          Encrypted Tunnel
                          (Outbound only!)
                                     │
                                     ▼
┌────────────────────────────────────────────────────────┐
│                    Your QNAP NAS                       │
│  ┌─────────────┐                                       │
│  │ cloudflared │◄─── Tunnel Connection                 │
│  └──────┬──────┘                                       │
│         │ Internal Network                             │
│         ▼                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌────────────┐  │
│  │  Nightjar-web  │◄──►│Nightjar-signal │◄──►│Nightjar-persist│ │
│  │   (nginx)   │    │  (WebRTC)   │    │  (SQLite)  │  │
│  └─────────────┘    └─────────────┘    └────────────┘  │
└────────────────────────────────────────────────────────┘
```

**Why this is secure:**
- ✅ No ports open on your router
- ✅ Tunnel is outbound-only from QNAP
- ✅ Your home IP is never exposed
- ✅ All traffic encrypted by Cloudflare
- ✅ DDoS protection included

---

## Maintenance Commands

### View Logs

```bash
# All containers
cd /share/Container/Nightjar
docker-compose logs -f

# Specific container
docker logs Nightjar-web
docker logs Nightjar-tunnel
docker logs Nightjar-watchtower
docker logs Nightjar-signal
docker logs Nightjar-persist
```

### Check Container Status

```bash
docker ps
docker-compose ps
```

### Manual Update (Skip Watchtower Wait)

```bash
cd /share/Container/Nightjar
docker-compose pull
docker-compose up -d
```

### Restart All Containers

```bash
cd /share/Container/Nightjar
docker-compose restart
```

### Stop Everything

```bash
cd /share/Container/Nightjar
docker-compose down
```

### Start Everything

```bash
cd /share/Container/Nightjar
docker-compose up -d
```

### View Resource Usage

```bash
docker stats
```

---

## Troubleshooting

### Problem: GitHub Actions Build Fails

**Check the Actions tab** on GitHub for error details.

Common issues:
- Missing Dockerfile in expected path
- Syntax error in workflow YAML
- Repository permissions not set correctly (Step 1.2)

### Problem: Can't Pull Images on QNAP

```bash
# Test pulling manually
docker pull ghcr.io/your-username/your-repo/web:latest
```

If it fails:
- **401 Unauthorized**: Need to run `docker login ghcr.io`
- **404 Not Found**: Check image name is correct (lowercase!)
- **Image doesn't exist**: GitHub Actions hasn't run yet, or failed

### Problem: Tunnel Not Connecting

```bash
docker logs Nightjar-tunnel
```

Common issues:
- **Bad token**: Regenerate token in Cloudflare Dashboard
- **Network issues**: Check QNAP has internet access

### Problem: Website Not Loading

1. **Check containers are running:**
   ```bash
   docker ps
   ```

2. **Check nginx logs:**
   ```bash
   docker logs Nightjar-web
   ```

3. **Test locally on NAS:**
   ```bash
   curl http://localhost:80
   ```

4. **Verify tunnel routes** in Cloudflare Dashboard

### Problem: WebSockets/P2P Not Working

1. **Verify WebSockets enabled** in Cloudflare tunnel route settings
2. **Check signaling server:**
   ```bash
   docker logs Nightjar-signal
   ```
3. **Check browser console** for WebSocket connection errors

### Problem: Watchtower Not Updating

```bash
docker logs Nightjar-watchtower
```

Common issues:
- **Registry auth expired**: Re-run `docker login ghcr.io`
- **Image tag issue**: Verify `:latest` tag is being pushed
- **Not labeled**: Check containers have watchtower label

---

## Optional Enhancements

### Discord Notifications

Add to your GitHub workflow (`.github/workflows/deploy-qnap.yml`):

```yaml
- name: Notify Discord
  if: success()
  env:
    DISCORD_WEBHOOK: ${{ secrets.DISCORD_WEBHOOK }}
  run: |
    curl -H "Content-Type: application/json" \
      -d "{\"content\": \"🚀 Nightjar deployed! Commit: ${{ github.sha }}\"}" \
      $DISCORD_WEBHOOK
```

Add the webhook URL to GitHub Secrets.

### Uptime Monitoring

Free options:
- [UptimeRobot](https://uptimerobot.com) - 50 free monitors
- [Healthchecks.io](https://healthchecks.io) - cron job monitoring
- Cloudflare's built-in analytics

### Backup Data Volume

Schedule regular backups of `/share/Container/Nightjar/data/`:

```bash
# Simple backup script
cp -r /share/Container/Nightjar/data /share/Backup/Nightjar-$(date +%Y%m%d)
```

### Add Cloudflare Access (Optional Authentication)

If you want to require login:

1. Go to Cloudflare Zero Trust → Access → Applications
2. Add an application for your domain
3. Configure identity providers (GitHub, Google, email, etc.)
4. Set policies for who can access

---

## Cost Summary

| Service | Cost |
|---------|------|
| GitHub Actions | Free (public repos) or 2000 min/month (private) |
| GitHub Container Registry | Free (public) or 500MB (private) |
| Cloudflare Tunnel | Free |
| Cloudflare DNS | Free |
| **Total** | **$0/month** 🎉 |

---

## Security Checklist

- [ ] Cloudflare tunnel token stored in `.env`, not committed to git
- [ ] `.env` added to `.gitignore`
- [ ] GitHub PAT has minimal scopes (read:packages only)
- [ ] QNAP admin account has strong password
- [ ] QNAP 2FA enabled (if available)
- [ ] Regular backups of `/share/Container/Nightjar/data/`
- [ ] Watchtower only updates labeled containers
- [ ] Consider Cloudflare Access for additional auth

---

## Quick Reference

| Task | Command |
|------|---------|
| View all logs | `docker-compose logs -f` |
| Check status | `docker ps` |
| Manual update | `docker-compose pull && docker-compose up -d` |
| Restart all | `docker-compose restart` |
| Stop all | `docker-compose down` |
| View Watchtower | `docker logs Nightjar-watchtower --tail 50` |
| View tunnel | `docker logs Nightjar-tunnel --tail 50` |

---

## Next Steps

1. ✅ Verify the deployment is working
2. Set up regular backups of the data directory
3. Consider adding Cloudflare Access for authentication
4. Monitor with UptimeRobot or similar
5. Set up Discord/Slack notifications for deployments
