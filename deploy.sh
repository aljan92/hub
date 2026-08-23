#!/usr/bin/env bash
set -e

# ==============================================================================
# MBA HUB — Automated Deployment Script for TerraMaster NAS (TOS 6.0)
# ==============================================================================

NAS_HOST="${NAS_HOST:-192.168.178.141}"
NAS_PORT="${NAS_PORT:-22}"
NAS_USER="${NAS_USER:-aljan92}"
NAS_PATH="${NAS_DEPLOY_PATH:-/Volume1/docker/mba-hub}"

echo "========================================================"
echo "🚀 Deploying MBA HUB to TerraMaster NAS (${NAS_HOST})"
echo "========================================================"

# Check if SSH key auth or password works
echo "📡 Checking SSH connection to ${NAS_USER}@${NAS_HOST}:${NAS_PORT}..."

SSH_CMD="ssh -p ${NAS_PORT} -o StrictHostKeyChecking=no ${NAS_USER}@${NAS_HOST}"

${SSH_CMD} << EOF
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

  echo "🐳 Building and starting Docker containers with Docker Compose..."
  docker compose pull || true
  docker compose up -d --build --remove-orphans

  echo "✅ MBA HUB is live on http://${NAS_HOST}:3000"
EOF

echo "🎉 Deployment completed successfully!"
