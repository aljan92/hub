# Zero-RUN Standalone Dockerfile for MBA HUB (Playwright Chromium & Mac Stealth Engine)
FROM mcr.microsoft.com/playwright:v1.50.1-noble

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Copy standalone pre-bundled server and pre-built frontend
COPY dist ./dist
COPY public ./public
COPY package.json ./
COPY browsers.json ./

EXPOSE 3000

CMD ["node", "dist/server.cjs"]

