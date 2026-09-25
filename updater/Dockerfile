FROM node:22-alpine

RUN apk add --no-cache docker-cli docker-cli-compose
WORKDIR /app
COPY updater/server.mjs ./server.mjs
USER root
EXPOSE 3001
CMD ["node", "server.mjs"]
