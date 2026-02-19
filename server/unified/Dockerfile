# =============================================================================
# Multi-stage Dockerfile for Nightjar Unified Server
#
# Builds frontend with relative base ('./') so the same image works at any
# mount path.  The Express server's runtime BASE_PATH env var handles route
# prefixing and request stripping — Vite just needs relative asset URLs.
# =============================================================================

# --- Stage 1: Build frontend ---
FROM node:20-alpine AS frontend-builder

WORKDIR /app

# Copy frontend package files and install deps
COPY package.json package-lock.json ./
COPY frontend/ ./frontend/
COPY vite.config.js ./

# --ignore-scripts skips the Electron-specific postinstall (setup-tor, electron-builder)
RUN npm ci --prefer-offline --ignore-scripts

# Build frontend with relative base path ('./').
# Relative URLs resolve correctly at any mount point:
#   /          → ./assets/foo.js → /assets/foo.js
#   /toot/     → ./assets/foo.js → /toot/assets/foo.js
# Image is built on GitHub Actions (7GB+ RAM), so give Node plenty of heap.
RUN NODE_OPTIONS="--max-old-space-size=4096" npx vite build --base="./"

# --- Stage 2: Production server ---
FROM node:20-alpine

WORKDIR /app

# Install dependencies for better-sqlite3 and hyperswarm
RUN apk add --no-cache python3 make g++

# Copy server package files and install deps
COPY server/unified/package*.json ./server/unified/
WORKDIR /app/server/unified
RUN npm install --production

# Copy server code (including mesh modules)
COPY server/unified/*.js ./
COPY server/unified/*.mjs ./

# Copy built frontend from stage 1
WORKDIR /app
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Create data directory
RUN mkdir -p /app/server/unified/data

# Environment
ENV PORT=3000
ENV STATIC_PATH=/app/frontend/dist
ENV DB_PATH=/app/server/unified/data/nightjar.db

# Base path for sub-path deployments (e.g., /toot)
# Express uses this to prefix all routes and strip it from incoming requests
ENV BASE_PATH=

# Server mode: host (default), relay, or private
# - host: Full persistence + mesh participation
# - relay: Signaling only + mesh participation, no persistence  
# - private: Full features, no mesh (for private deployments)
ENV NIGHTJAR_MODE=host

# Public URL for mesh announcements (required to be discoverable)
# Example: wss://relay1.nightjar.co or wss://your-domain.com
ENV PUBLIC_URL=

EXPOSE 3000

WORKDIR /app/server/unified

# Run as non-root
RUN addgroup -S nightjar && adduser -S nightjar -G nightjar
RUN chown -R nightjar:nightjar /app
USER nightjar

CMD ["node", "index.js"]
