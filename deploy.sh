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

# --- deploy safety guard (added after the 2026-05-27 prod incident) -----------
# The outage was caused by deploying the wrong tree: this script runs
# `git pull origin master` but never `git checkout master`, so when it was run
# while the checkout was on a feature branch, it built and shipped that branch
# (with config/redis changes incompatible with prod) to production. These
# checks make that — and concurrent deploys clobbering each other — impossible.

# 1) Only ever deploy master.
branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "master" ]; then
  echo "ABORT: deploy.sh must run on 'master' (currently on '$branch')." >&2
  echo "       Fix: git switch master && git pull" >&2
  exit 1
fi

# 2) Refuse to deploy a dirty working tree — no shipping uncommitted edits.
if [ -n "$(git status --porcelain)" ]; then
  echo "ABORT: working tree is not clean. Commit or stash before deploying:" >&2
  git status --short >&2
  exit 1
fi

# 3) Single-deployer lock — prevent two deploys (e.g. two operators/agents)
#    from racing and recreating containers under each other.
exec 9>/tmp/cardano402-deploy.lock
if ! flock -n 9; then
  echo "ABORT: another deploy is already in progress (/tmp/cardano402-deploy.lock)." >&2
  exit 1
fi
# --- end guard ----------------------------------------------------------------

echo "==> Pulling latest code..."
git pull origin master

echo "==> Building images..."
docker compose -f docker-compose.prod.yml build --no-cache

echo "==> Restarting services..."
docker compose -f docker-compose.prod.yml up -d --remove-orphans

echo "==> Waiting for health check..."
sleep 10
docker compose -f docker-compose.prod.yml ps

# Post-deploy health gate: fail loudly if the facilitator isn't actually serving,
# instead of leaving a silent crash-loop (origin down -> Cloudflare 502).
echo "==> Verifying /health..."
for i in $(seq 1 12); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/health || echo 000)"
  if [ "$code" = "200" ]; then
    echo "    healthy (200)"
    break
  fi
  if [ "$i" = "12" ]; then
    echo "ERROR: /health did not return 200 after ~60s (last: $code). Recent logs:" >&2
    docker compose -f docker-compose.prod.yml logs --tail=30 facilitator >&2
    exit 1
  fi
  sleep 5
done

echo "==> Tailing logs (Ctrl+C to exit)..."
docker compose -f docker-compose.prod.yml logs -f --tail=30 facilitator
