# Build Stage
FROM node:20-slim AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Production Stage
FROM node:20-slim

WORKDIR /app

# Install system dependencies (including Doppler)
RUN apt-get update && apt-get install -y wget gnupg && \
    wget -q -t3 'https://packages.doppler.com/public/cli/rsa.8004D69E501C7328.key' -O /etc/apt/trusted.gpg.d/doppler-relay.gpg && \
    echo "deb https://packages.doppler.com/public/cli/deb/debian any-version main" | tee /etc/apt/sources.list.d/doppler-relay.list && \
    apt-get update && \
    apt-get install -y doppler && \
    rm -rf /var/lib/apt/lists/*

# Copy built artifacts and dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules

# Create uploads directory
RUN mkdir -p uploads && chown -R node:node uploads

# Switch to non-root user
USER node

# Expose port
EXPOSE 3004

# Run with Doppler
# Note: Requires DOPPLER_TOKEN environment variable at runtime
CMD ["doppler", "run", "--", "node", "dist/server.js"]
