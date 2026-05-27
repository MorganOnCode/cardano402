#!/usr/bin/env bash
set -euo pipefail

if [ -e config/config.json ]; then
  echo "Refusing to overwrite existing config/config.json. Run this smoke test in a clean checkout." >&2
  exit 1
fi

cleanup() {
  docker compose -f docker-compose.prod.yml down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f config/config.json
  rm -f secrets/cardano402-facilitator.seed secrets/cardano402-demo-preview.seed
  rmdir secrets 2>/dev/null || true
}
trap cleanup EXIT

mkdir -p config secrets data/files
chmod 700 secrets
cat > secrets/cardano402-facilitator.seed <<'EOF'
test test test test test test test test test test test junk
EOF
cat > secrets/cardano402-demo-preview.seed <<'EOF'
test test test test test test test test test test test junk
EOF
chmod 600 secrets/cardano402-facilitator.seed secrets/cardano402-demo-preview.seed

cat > config/config.json <<'EOF'
{
  "server": {
    "host": "0.0.0.0",
    "port": 3000,
    "trustProxy": 2
  },
  "logging": {
    "level": "info",
    "pretty": false
  },
  "env": "production",
  "rateLimit": {
    "global": 100,
    "sensitive": 20,
    "windowMs": 60000
  },
  "metrics": {
    "bearerToken": "ci-smoke-metrics-token-32-characters-minimum"
  },
  "chain": {
    "network": "Preview",
    "blockfrost": {
      "projectId": "preview-ci-smoke-project-id",
      "tier": "free"
    },
    "facilitator": {
      "signerMode": "local-file",
      "seedPhraseFile": "/run/secrets/cardano402-facilitator.seed"
    },
    "cache": {
      "utxoTtlSeconds": 60
    },
    "redis": {
      "host": "redis-prod",
      "port": 6379,
      "password": "ci-smoke-redis-password",
      "db": 0
    },
    "verification": {
      "graceBufferSeconds": 30,
      "maxTimeoutSeconds": 300,
      "feeMinLovelace": 150000,
      "feeMaxLovelace": 5000000,
      "requireNonce": true,
      "confirmationMode": "confirmed_only",
      "minConfirmations": 1
    }
  },
  "demo": {
    "blockfrostProjectId": "preview-ci-smoke-demo-project-id",
    "seedPhraseFile": "/run/secrets/cardano402-demo-preview.seed",
    "network": "Preview"
  },
  "storage": {
    "backend": "fs",
    "fs": {
      "dataDir": "./data/files"
    }
  }
}
EOF

export REDIS_PASSWORD=ci-smoke-redis-password
export MAINNET=false
export CARDANO402_ALLOW_MAINNET_LOCAL_FILE_SIGNER=false

docker compose -f docker-compose.prod.yml up -d --remove-orphans

for _ in $(seq 1 30); do
  redis_status="$(docker inspect cardano402-redis --format '{{.State.Health.Status}}' 2>/dev/null || true)"
  app_status="$(docker inspect cardano402 --format '{{.State.Health.Status}}' 2>/dev/null || true)"
  if [ "$redis_status" = "healthy" ] && [ "$app_status" = "healthy" ]; then
    break
  fi
  sleep 2
done

docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=80 redis
docker compose -f docker-compose.prod.yml logs --tail=120 facilitator

test "$(docker inspect cardano402-redis --format '{{.State.Health.Status}}')" = "healthy"
test "$(docker inspect cardano402 --format '{{.State.Health.Status}}')" = "healthy"
test "$(curl -s -o /tmp/cardano402-smoke-health.json -w '%{http_code}' http://127.0.0.1:3000/health)" = "200"
