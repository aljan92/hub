# Lightweight, universal Dockerfile for MBA HUB (optimized for TerraMaster NAS TOS 6.0)
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy pre-compiled production build & assets
COPY dist ./dist
COPY public ./public

# Ensure data directory exists
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "dist/server.js"]
