#!/usr/bin/env bash
set -e

# ==============================================================================
# MBA HUB — Automated Deployment Script for TerraMaster NAS (TOS 6.0)
# ==============================================================================

NAS_HOST="${NAS_HOST:-192.168.178.141}"
NAS_PORT="${NAS_PORT:-22}"
NAS_USER="${NAS_USER:-aljan92}"
NAS_PASSWORD="${NAS_PASSWORD:-}"
NAS_PATH="${NAS_DEPLOY_PATH:-/Volume1/docker/mba-hub}"

echo "========================================================"
echo "🚀 Deploying MBA HUB to TerraMaster NAS (${NAS_HOST})"
echo "========================================================"

# Prepare SSH command with dedicated key or password
KEY_PATH="$HOME/.ssh/id_ed25519_mbahub"
SSH_BASE="ssh -p ${NAS_PORT} -o StrictHostKeyChecking=no"

if [ -f "${KEY_PATH}" ]; then
  SSH_CMD="${SSH_BASE} -i ${KEY_PATH} ${NAS_USER}@${NAS_HOST}"
elif [ -n "${NAS_PASSWORD}" ]; then
  SSH_CMD="sshpass -p '${NAS_PASSWORD}' ${SSH_BASE} -o PubkeyAuthentication=no -o PreferredAuthentications=password ${NAS_USER}@${NAS_HOST}"
else
  SSH_CMD="${SSH_BASE} ${NAS_USER}@${NAS_HOST}"
fi

echo "📡 Connecting to ${NAS_USER}@${NAS_HOST}:${NAS_PORT}..."

${SSH_CMD} << 'EOF'
  NAS_PATH="${NAS_DEPLOY_PATH:-/Volume1/docker/mba-hub}"
  echo "📦 Ensuring deployment directory exists at ${NAS_PATH}..."
  mkdir -p ${NAS_PATH}
  cd ${NAS_PATH}

  if [ -d .git ]; then
    echo "🔄 Pulling latest changes from GitHub..."
    git pull origin main
  else
    echo "📥 Cloning repository for the first time..."
    git clone https://github.com/aljan92/hub.git .
  fi

  echo "🐳 Building and starting Docker containers..."
  if command -v docker-compose &> /dev/null; then
    docker-compose pull || true
    docker-compose up -d --build --remove-orphans
  elif docker compose version &> /dev/null; then
    docker compose pull || true
    docker compose up -d --build --remove-orphans
  else
    echo "⚠️ Neither docker compose nor docker-compose found! Trying docker run..."
    docker build -t mba-hub .
    docker stop mba_hub_app 2>/dev/null || true
    docker rm mba_hub_app 2>/dev/null || true
    docker run -d --name mba_hub_app --restart unless-stopped -p 3000:3000 -v ./data:/app/data mba-hub
  fi

  echo "✅ MBA HUB is live on http://192.168.178.141:3000"
EOF

echo "🎉 Deployment completed successfully!"
