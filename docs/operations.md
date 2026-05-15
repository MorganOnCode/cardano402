# Operations Runbook

## Prerequisites

- Node.js 20+
- Docker and Docker Compose
- Blockfrost API key (https://blockfrost.io)
- Redis 7+ (provided via Docker or external)

## Quick Start (Development)

1. Copy config: `cp config/config.example.json config/config.json`
2. Edit config: set your Blockfrost project ID and seed phrase
3. Start dependencies: `docker compose up -d`
4. Start server: `pnpm dev`
5. Verify: `curl http://localhost:3000/health`

## Production Deployment (Docker)

### 1. Create production config

Copy `config/config.example.json` to `config/config.json` and set:
- `env` to `"production"`
- `logging.pretty` to `false`
- `chain.redis.host` to `"redis-prod"` (Docker service name)
- `chain.redis.password` to your Redis password
- `chain.blockfrost.projectId` to your Blockfrost key
- `chain.facilitator.seedPhrase` to your facilitator wallet seed

### 2. Set Redis password

Export the Redis password for Docker Compose:
```
export REDIS_PASSWORD=your-secure-password-here
```

### 3. Start production stack

```
docker compose --profile production up -d
```

This starts:
- `cardano402` -- the payment facilitator (port 3000)
- `cardano402-redis-prod` -- Redis with authentication (port 6380)

### 4. Verify deployment

```
curl http://localhost:3000/health
```

Expected: `{"status":"healthy","version":"1.0.0",...}`

## Startup

The facilitator starts in this order:
1. Load and validate config from `config/config.json`
2. Initialize Sentry error tracking (if DSN configured)
3. Connect to Redis
4. Initialize Lucid Evolution (Blockfrost provider)
5. Create chain provider (UTXO cache, reservation system)
6. Start HTTP server on configured host:port
7. Register SIGINT/SIGTERM shutdown handlers

If any step fails, the process exits with code 1 and logs the error.

## Shutdown

The facilitator handles graceful shutdown on SIGINT and SIGTERM:
1. Stop accepting new requests
2. Wait for in-flight requests to complete
3. Disconnect Redis client
4. Exit process

In Docker: `docker compose --profile production stop` sends SIGTERM.

## Health Check

`GET /health` returns:

| Status | HTTP | Meaning |
|--------|------|---------|
| healthy | 200 | All dependencies up |
| degraded | 200 | Some dependencies down (Redis) |
| unhealthy | 503 | All dependencies down |

**Alert on:** `unhealthy` status or health endpoint unreachable.
**Investigate:** `degraded` status -- check Redis connectivity.

## Common Issues

### Config validation error on startup

**Symptom:** `ConfigInvalidError: chain.blockfrost.projectId: Blockfrost project ID is required`
**Fix:** Ensure `config/config.json` exists and all required fields are set. Compare with `config/config.example.json`.

### Redis connection refused

**Symptom:** `Chain layer initialization failed` with ECONNREFUSED
**Fix:** Ensure Redis is running. In Docker: `docker compose --profile production ps` to check redis-prod is healthy.

### Mainnet safety block

**Symptom:** `Mainnet connection requires explicit MAINNET=true environment variable`
**Fix:** Set `MAINNET=true` in environment if intentionally connecting to mainnet. This is a safety guardrail.

### Rate limiting (429)

**Symptom:** Clients receive 429 Too Many Requests
**Fix:** Default limits: 100 req/min global, 20 req/min on /verify, /settle, /status. Adjust in config `rateLimit` section.

### Health endpoint shows version 0.0.0

**Symptom:** Health endpoint returns version "0.0.0"
**Fix:** Ensure `package.json` is in the working directory. In Docker, this is handled automatically via `WORKDIR /app`.

## Monitoring

### Logs

Production logs are structured JSON (pino format):
```json
{"level":30,"time":1707000000000,"msg":"Server listening at http://0.0.0.0:3000"}
```

Use `pino-pretty` for human-readable output during debugging:
```
docker logs cardano402 | npx pino-pretty
```

Key log fields:
- `reqId` -- request correlation ID (UUID)
- `responseTime` -- request duration in ms
- `statusCode` -- HTTP response status

### Sentry

If configured, Sentry captures:
- All 5xx errors with request context (requestId, URL, method)
- Unhandled promise rejections
- Performance traces (sample rate configurable, default 10%)

### Redis

Monitor Redis with:
```
redis-cli -a $REDIS_PASSWORD -p 6380 info
```

Key metrics: `connected_clients`, `used_memory`, `keyspace_hits/misses`.

## Recovery

### After crash / restart

1. Redis persistence (AOF) preserves UTXO reservations
2. On restart, the facilitator reconnects and resumes normal operation
3. In-flight settlements may time out -- clients should retry via /status

### After Redis data loss

1. UTXO reservations are lost (they have 120s TTL anyway)
2. Dedup keys are lost (24h TTL) -- duplicate submissions temporarily possible
3. UTXO cache rebuilds automatically from Blockfrost
4. No manual intervention required
