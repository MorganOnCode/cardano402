#!/usr/bin/env bash
# deploy.sh — Pull latest and restart the facilitator on a VPS
#
# Run from the repo directory:
#   bash deploy.sh
#
# Assumes:
#   - git remote is set up
#   - config/config.json is present (not in git, managed separately)
#   - .env is present with REDIS_PASSWORD
#   - Docker and docker compose v2 are installed

set -euo pipefail

branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "master" ]; then
  echo "ERROR: deploy.sh must be run from the master branch, not '$branch'." >&2
  echo "Run: git switch master && git pull origin master && bash deploy.sh" >&2
  exit 1
fi

echo "==> Pulling latest code..."
git pull origin master

echo "==> Building images..."
docker compose -f docker-compose.prod.yml build --no-cache

echo "==> Restarting services..."
docker compose -f docker-compose.prod.yml up -d --remove-orphans

echo "==> Waiting for health check..."
sleep 10
docker compose -f docker-compose.prod.yml ps

echo "==> Tailing logs (Ctrl+C to exit)..."
docker compose -f docker-compose.prod.yml logs -f --tail=30 facilitator
