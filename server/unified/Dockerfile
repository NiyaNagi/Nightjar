# =============================================================================
# Multi-stage Dockerfile for Nightjar Unified Server
# 
# Build args:
#   BASE_PATH  - Vite base path for asset URLs (default: './' for root deploy)
#                Set to '/toot/' for sub-path deployment
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

# Build arg for Vite base path
ARG BASE_PATH=./

# Build frontend with the specified base path
# Cap heap at 512MB to avoid OOM on low-memory VPS instances
RUN NODE_OPTIONS="--max-old-space-size=512" npx vite build --base="${BASE_PATH}"

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
