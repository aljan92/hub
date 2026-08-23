# Zero-RUN Standalone Dockerfile for MBA HUB (100% immune to NAS procfs/runc build restrictions)
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Copy standalone pre-bundled server and pre-built frontend
COPY dist ./dist
COPY public ./public
COPY package.json ./

EXPOSE 3000

CMD ["node", "dist/server.cjs"]
