# Nahma QNAP NAS Deployment Guide

This guide walks you through securely deploying Nahma on a QNAP NAS using Container Station. The deployment is designed with security as the primary concern.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Security Overview](#security-overview)
3. [Network Configuration](#network-configuration)
4. [SSL Certificate Setup](#ssl-certificate-setup)
5. [Container Deployment](#container-deployment)
6. [Firewall Configuration](#firewall-configuration)
7. [Monitoring & Maintenance](#monitoring--maintenance)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Hardware Requirements
- QNAP NAS with Container Station support (x86 or ARM64)
- Minimum 2GB RAM available for containers
- 1GB storage for application (more for document persistence)

### Software Requirements
- QTS 5.0+ or QuTS hero
- Container Station 2.0+
- SSH access enabled (temporarily for setup)

### Network Requirements
- Static IP for your NAS (internal network)
- Domain name pointing to your public IP (for HTTPS)
- Port forwarding capability on your router

---

## Security Overview

### Architecture

```
Internet
    │
    ▼ (Port 443 only)
┌─────────────────────────────────────────────┐
│              Your Router                     │
│  Port 443 → NAS:443 (HTTPS only)            │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│              QNAP NAS                        │
│  ┌─────────────────────────────────────┐    │
│  │         Container Network           │    │
│  │  ┌───────┐ ┌────────┐ ┌─────────┐  │    │
│  │  │ nginx │ │signal  │ │ persist │  │    │
│  │  │ :443  │ │ :4444  │ │  (int)  │  │    │
│  │  └───┬───┘ └────────┘ └─────────┘  │    │
│  │      │      (internal only)         │    │
│  └──────┼──────────────────────────────┘    │
│         │                                    │
│    Only nginx exposed to host               │
└─────────────────────────────────────────────┘
```

### Security Principles

1. **Minimal Exposure**: Only port 443 exposed to internet
2. **Internal Network**: Signaling and persistence only accessible within container network
3. **Non-root Containers**: All services run as unprivileged users
4. **TLS Everywhere**: All external connections encrypted
5. **Zero Trust**: Server cannot read document content (E2E encrypted)

---

## Network Configuration

### Step 1: Assign Static IP to NAS

1. Open **Control Panel** → **Network & File Services** → **Network & Virtual Switch**
2. Select your network adapter
3. Click **Configure** → **IPv4**
4. Set to **Static IP** (e.g., 192.168.1.100)
5. Note this IP for port forwarding

### Step 2: Configure Port Forwarding on Router

Access your router's admin panel and create these rules:

| External Port | Internal IP      | Internal Port | Protocol |
|---------------|------------------|---------------|----------|
| 443           | 192.168.1.100    | 443           | TCP      |

⚠️ **Do NOT expose port 80** - We'll redirect HTTP to HTTPS via external means or use HTTPS only.

### Step 3: Configure Dynamic DNS (if no static public IP)

1. Open **Control Panel** → **Network & File Services** → **DDNS**
2. Add a DDNS provider (myQNAPcloud, No-IP, etc.)
3. Configure your domain to update automatically

---

## SSL Certificate Setup

### Option A: Let's Encrypt via QNAP (Recommended)

1. Open **Control Panel** → **Security** → **Certificate & Private Key**
2. Click **Replace Certificate** → **Get from Let's Encrypt**
3. Enter your domain name
4. Complete validation (may require port 80 temporarily)
5. Export the certificate:
   ```
   /etc/stunnel/stunnel.pem → fullchain.pem + privkey.pem
   ```

### Option B: Let's Encrypt via Certbot (Manual)

SSH into your NAS:

```bash
# Install entware if not already installed
# (Provides package management for QNAP)

# Install certbot
opkg install certbot

# Get certificate (requires port 80 temporarily)
certbot certonly --standalone -d yourdomain.com

# Certificates will be in:
# /opt/etc/letsencrypt/live/yourdomain.com/
```

### Option C: Self-Signed (Development Only)

```bash
# Create SSL directory
mkdir -p /share/Container/nahma/ssl

# Generate self-signed certificate
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /share/Container/nahma/ssl/privkey.pem \
  -out /share/Container/nahma/ssl/fullchain.pem \
  -subj "/CN=nahma.local"
```

⚠️ Self-signed certificates will show browser warnings.

---

## Container Deployment

### Step 1: Prepare Directory Structure

SSH into your NAS:

```bash
# Create Nahma directory structure
mkdir -p /share/Container/nahma/{ssl,data}

# Set permissions
chmod 755 /share/Container/nahma
chmod 700 /share/Container/nahma/ssl
chmod 755 /share/Container/nahma/data
```

### Step 2: Upload Application Files

Option A: Via File Station
1. Open **File Station**
2. Navigate to `Container/nahma`
3. Upload the entire `server` folder from the Nahma repository

Option B: Via SCP
```bash
scp -r server/ admin@NAS-IP:/share/Container/nahma/
```

### Step 3: Upload SSL Certificates

```bash
# Copy your certificates
cp /path/to/fullchain.pem /share/Container/nahma/ssl/
cp /path/to/privkey.pem /share/Container/nahma/ssl/

# Secure permissions
chmod 600 /share/Container/nahma/ssl/*.pem
```

### Step 4: Create Docker Compose File for QNAP

Create `/share/Container/nahma/docker-compose.yml`:

```yaml
version: '3.8'

services:
  nginx:
    build:
      context: .
      dockerfile: server/docker/Dockerfile.web
    container_name: nahma-web
    restart: unless-stopped
    ports:
      - "443:443"
    volumes:
      - ./ssl:/etc/nginx/ssl:ro
      - ./nginx-prod.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - signaling
    networks:
      - nahma-internal
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /var/cache/nginx
      - /var/run

  signaling:
    build:
      context: .
      dockerfile: server/docker/Dockerfile.signal
    container_name: nahma-signal
    restart: unless-stopped
    environment:
      - PORT=4444
      - MAX_PEERS_PER_ROOM=50
    networks:
      - nahma-internal
    security_opt:
      - no-new-privileges:true
    read_only: true

  persistence:
    build:
      context: .
      dockerfile: server/docker/Dockerfile.persist
    container_name: nahma-persist
    restart: unless-stopped
    environment:
      - SIGNALING_URL=ws://signaling:4444
      - DB_PATH=/app/data/persistence.db
    volumes:
      - ./data:/app/data
    depends_on:
      - signaling
    networks:
      - nahma-internal
    security_opt:
      - no-new-privileges:true

networks:
  nahma-internal:
    driver: bridge
    internal: false  # Needs internet for WebRTC ICE
```

### Step 5: Create Production Nginx Config

Create `/share/Container/nahma/nginx-prod.conf`:

```nginx
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    
    sendfile on;
    keepalive_timeout 65;
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=general:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=websocket:10m rate=5r/s;

    # Upstream
    upstream signaling {
        server signaling:4444;
    }

    # Redirect HTTP to HTTPS
    server {
        listen 80;
        return 301 https://$host$request_uri;
    }

    # HTTPS server
    server {
        listen 443 ssl http2;
        
        ssl_certificate /etc/nginx/ssl/fullchain.pem;
        ssl_certificate_key /etc/nginx/ssl/privkey.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
        ssl_prefer_server_ciphers off;
        ssl_session_cache shared:SSL:10m;
        
        # Security headers
        add_header Strict-Transport-Security "max-age=31536000" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' wss://$host; img-src 'self' data: blob:;" always;

        # WebSocket signaling
        location /signal {
            limit_req zone=websocket burst=10 nodelay;
            
            proxy_pass http://signaling;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_read_timeout 86400s;
            proxy_send_timeout 86400s;
        }

        # Static files
        location / {
            limit_req zone=general burst=20 nodelay;
            
            root /usr/share/nginx/html;
            index index.html;
            try_files $uri $uri/ /index.html;
            
            location ~* \.(js|css|png|jpg|ico|svg|woff2)$ {
                expires 1y;
                add_header Cache-Control "public, immutable";
            }
        }

        # Health check
        location /health {
            access_log off;
            return 200 "OK";
        }
    }
}
```

### Step 6: Deploy via Container Station

**Option A: Via GUI**

1. Open **Container Station**
2. Click **Create** → **Create Application**
3. Choose **Docker Compose**
4. Browse to `/share/Container/nahma/docker-compose.yml`
5. Click **Create**

**Option B: Via SSH**

```bash
cd /share/Container/nahma
docker-compose up -d --build
```

### Step 7: Verify Deployment

```bash
# Check container status
docker ps

# Check logs
docker logs nahma-web
docker logs nahma-signal
docker logs nahma-persist

# Test HTTPS
curl -k https://localhost/health
```

---

## Firewall Configuration

### QNAP Firewall Rules

1. Open **Control Panel** → **Security** → **Security Counselor**
2. Go to **Network Access Protection**
3. Add rules:

| Priority | Direction | Source | Destination | Port | Action |
|----------|-----------|--------|-------------|------|--------|
| 1        | In        | Any    | NAS         | 443  | Allow  |
| 2        | In        | LAN    | NAS         | 22   | Allow  |
| 3        | In        | LAN    | NAS         | 8080 | Allow  |
| 999      | In        | Any    | NAS         | Any  | Deny   |

### Additional Security Measures

1. **Disable Unused Services**
   - Control Panel → Network & File Services
   - Disable: Telnet, FTP, AFP (if not needed)

2. **Enable Access Control**
   - Control Panel → Security → Access Control
   - Enable IP access protection
   - Set failed login threshold (e.g., 5 attempts)

3. **Enable Security Counselor**
   - Run weekly security scans
   - Address all critical findings

---

## Monitoring & Maintenance

### Log Locations

```bash
# Nginx access logs
docker exec nahma-web cat /var/log/nginx/access.log

# Nginx error logs
docker exec nahma-web cat /var/log/nginx/error.log

# Signaling server logs
docker logs nahma-signal

# Persistence node logs
docker logs nahma-persist
```

### Health Checks

```bash
# Check all containers
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Check disk usage
docker system df

# Check persistence database size
du -sh /share/Container/nahma/data/
```

### Automatic Updates

Create a script at `/share/Container/nahma/update.sh`:

```bash
#!/bin/bash
cd /share/Container/nahma

# Pull latest images
docker-compose pull

# Rebuild and restart
docker-compose up -d --build

# Clean up old images
docker image prune -f

echo "Update complete: $(date)"
```

Add to crontab for weekly updates:
```bash
0 3 * * 0 /share/Container/nahma/update.sh >> /share/Container/nahma/update.log 2>&1
```

### SSL Certificate Renewal

If using Let's Encrypt, add renewal to crontab:

```bash
# Renew certificate monthly
0 3 1 * * certbot renew --quiet && docker exec nahma-web nginx -s reload
```

---

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker logs nahma-web 2>&1 | tail -50

# Common issues:
# - SSL certificate path incorrect
# - Port 443 already in use
# - Permission issues on volumes
```

### WebSocket Connection Fails

1. Check nginx config for `/signal` location
2. Verify signaling container is running
3. Check browser console for errors
4. Test WebSocket directly:
   ```bash
   wscat -c wss://yourdomain.com/signal
   ```

### Performance Issues

```bash
# Check resource usage
docker stats

# If memory constrained, limit containers:
# Add to docker-compose.yml:
#   deploy:
#     resources:
#       limits:
#         memory: 256M
```

### Database Corruption

```bash
# Stop persistence container
docker stop nahma-persist

# Backup current database
cp /share/Container/nahma/data/persistence.db{,.backup}

# Delete corrupted database (will start fresh)
rm /share/Container/nahma/data/persistence.db

# Restart
docker start nahma-persist
```

---

## Security Checklist

Before going live, verify:

- [ ] SSL certificate installed and valid
- [ ] Only port 443 exposed to internet
- [ ] Rate limiting enabled in nginx
- [ ] Security headers configured
- [ ] QNAP firewall rules active
- [ ] Container auto-restart enabled
- [ ] Backups configured for `/share/Container/nahma/data`
- [ ] Admin password is strong
- [ ] 2FA enabled on QNAP admin account
- [ ] Auto-update disabled on QTS (use scheduled maintenance)
- [ ] Security Counselor shows no critical issues

---

## Quick Reference

### Start/Stop Commands

```bash
cd /share/Container/nahma

# Start all containers
docker-compose up -d

# Stop all containers
docker-compose down

# Restart specific container
docker-compose restart nginx

# View logs
docker-compose logs -f
```

### File Locations

| Item | Path |
|------|------|
| Docker Compose | `/share/Container/nahma/docker-compose.yml` |
| Nginx Config | `/share/Container/nahma/nginx-prod.conf` |
| SSL Certificates | `/share/Container/nahma/ssl/` |
| Persistence Data | `/share/Container/nahma/data/` |
| Update Script | `/share/Container/nahma/update.sh` |

### Ports

| Service | Internal Port | External Port |
|---------|---------------|---------------|
| nginx | 443 | 443 |
| signaling | 4444 | (internal only) |
| persistence | - | (internal only) |

---

## Support

For issues specific to this deployment:
1. Check container logs first
2. Verify network connectivity
3. Test with curl from NAS itself
4. Check QNAP system logs

For Nahma application issues, refer to the main repository documentation.
