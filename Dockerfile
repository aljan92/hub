# Multi-stage Dockerfile for MBA HUB (Node.js 22 + Playwright / Chromium)
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install dependencies
COPY package*.json tsconfig.json vite.config.ts tailwind.config.js postcss.config.js ./
RUN npm ci

# Copy source code and build client & server
COPY src/ ./src/
COPY public/ ./public/
RUN npm run build

# Production Runtime
FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Install runtime dependencies for canvas, image processing & chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    fonts-liberation \
    libnss3 \
    libxss1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled assets from builder
COPY --from=builder /app/dist ./dist

# Create persistence data directory
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "dist/server.js"]
