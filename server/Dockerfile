# Build Stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies for building (including native modules if any)
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Production Stage
FROM node:20-alpine

WORKDIR /app

# Install Doppler CLI
RUN wget -q -O - https://packages.doppler.com/public/cli/gpg.82367221.key | gpg --import && \
    echo 'https://packages.doppler.com/public/cli/alpine/any-version/main' | tee -a /etc/apk/repositories && \
    apk add --no-cache doppler

COPY package*.json ./
# Install only production dependencies
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
# Keep src for ts-node if needed, but preferably use dist
# COPY --from=builder /app/src ./src 

# Create uploads directory
RUN mkdir -p uploads

EXPOSE 3004

# Use doppler to run the compiled javascript
CMD ["doppler", "run", "--", "node", "dist/server.js"]
