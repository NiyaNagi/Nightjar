FROM node:20-alpine

WORKDIR /app

# Install dependencies for better-sqlite3 and hyperswarm
RUN apk add --no-cache python3 make g++

# Copy package files
COPY server/unified/package*.json ./server/unified/

# Install server dependencies
WORKDIR /app/server/unified
RUN npm install --production

# Copy server code (including mesh modules)
COPY server/unified/*.js ./
COPY server/unified/*.mjs ./

# Copy built frontend
WORKDIR /app
COPY frontend/dist ./frontend/dist

# Create data directory
RUN mkdir -p /app/server/unified/data

# Environment
ENV PORT=3000
ENV STATIC_PATH=/app/frontend/dist
ENV DB_PATH=/app/server/unified/data/nightjar.db

# Server mode: host (default), relay, or private
# - host: Full persistence + mesh participation
# - relay: Signaling only + mesh participation, no persistence  
# - private: Full features, no mesh (for private deployments)
ENV NIGHTJAR_MODE=host

# Public URL for mesh announcements (required to be discoverable)
# Example: wss://relay1.nightjar.io or wss://your-domain.com
ENV PUBLIC_URL=

EXPOSE 3000

WORKDIR /app/server/unified

# Run as non-root
RUN addgroup -S nightjar && adduser -S nightjar -G nightjar
RUN chown -R nightjar:nightjar /app
USER nightjar

CMD ["node", "index.js"]
