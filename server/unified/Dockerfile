FROM node:20-alpine

WORKDIR /app

# Install dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

# Copy package files
COPY server/unified/package*.json ./server/unified/

# Install server dependencies
WORKDIR /app/server/unified
RUN npm install --production

# Copy server code
COPY server/unified/*.js ./

# Copy built frontend
WORKDIR /app
COPY frontend/dist ./frontend/dist

# Create data directory
RUN mkdir -p /app/server/unified/data

# Environment
ENV PORT=3000
ENV STATIC_PATH=/app/frontend/dist
ENV DB_PATH=/app/server/unified/data/Nightjar.db

EXPOSE 3000

WORKDIR /app/server/unified

# Run as non-root
RUN addgroup -S Nightjar && adduser -S Nightjar -G Nightjar
RUN chown -R Nightjar:Nightjar /app
USER Nightjar

CMD ["node", "index.js"]
