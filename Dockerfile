# Zero-RUN Standalone Dockerfile for MBA HUB (Playwright Chromium & Mac Stealth Engine)
FROM mcr.microsoft.com/playwright:v1.50.1-noble

ARG APP_COMMIT_SHA=unknown
LABEL org.opencontainers.image.revision="${APP_COMMIT_SHA}"

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV APP_COMMIT_SHA=${APP_COMMIT_SHA}

# Copy standalone pre-bundled server and pre-built frontend
COPY dist/server.cjs ./dist/server.cjs
COPY dist/client ./dist/client
COPY dist/assets ./dist/assets
COPY dist/browsers.json ./dist/browsers.json
COPY package.json ./
COPY browsers.json ./

EXPOSE 3000

CMD ["node", "dist/server.cjs"]
