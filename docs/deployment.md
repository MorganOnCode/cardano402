# Deployment Guide

Deployment options for the x402 Cardano Payment Facilitator.

## Prerequisites

- **Docker and Docker Compose** (for containerized deployment)
  - OR **Node.js 20+** and **pnpm** (for bare metal)
- **Blockfrost API key** -- register at [blockfrost.io](https://blockfrost.io)
- **Funded Cardano wallet** (seed phrase or private key stored in a restrictive file)
- **Redis 7+** (provided via Docker Compose or external)

## Configuration

### Config File

The facilitator reads configuration from `config/config.json`, validated at startup using Zod schemas. If any required field is missing or invalid, the process exits with a descriptive error.

Copy the example to get started:

```bash
cp config/config.example.json config/config.json
```

See [`config/config.example.json`](../config/config.example.json) for the full structure with production defaults.

### Required Settings

| Field | Description | Example |
|-------|-------------|---------|
| `chain.network` | Cardano network | `"Preview"`, `"Preprod"`, `"Mainnet"` |
| `chain.blockfrost.projectId` | Blockfrost API key | `"previewXXX..."` |
| `chain.facilitator.signerMode` | Current root facilitator signer mode. Only `"local-file"` is implemented today | `"local-file"` |
| `chain.facilitator.seedPhraseFile` | `0600` file containing facilitator wallet seed phrase | `"/run/secrets/cardano402-facilitator.seed"` |
| `chain.facilitator.privateKeyFile` | `0600` file containing facilitator wallet private key | `"/run/secrets/cardano402-facilitator.skey"` |
| `chain.redis.host` | Redis hostname | `"localhost"` or `"redis-prod"` |

### Optional Settings

| Field | Default | Description |
|-------|---------|-------------|
| `server.port` | `3000` | HTTP listen port |
| `server.host` | `"0.0.0.0"` | HTTP listen address |
| `logging.level` | `"info"` | Log level (`debug`, `info`, `warn`, `error`) |
| `logging.pretty` | `false` | Pretty-print logs (enable for development) |
| `env` | `"development"` | Environment (`development`, `production`) |
| `rateLimit.global` | `100` | Requests per minute (global) |
| `rateLimit.sensitive` | `20` | Requests per minute (`/verify`, `/settle`, `/status`) |
| `rateLimit.windowMs` | `60000` | Rate limit window in milliseconds |
| `metrics.bearerToken` | *(none)* | Bearer token for `GET /metrics` (required in production) |
| `chain.blockfrost.tier` | `"free"` | Blockfrost plan tier |
| `chain.cache.utxoTtlSeconds` | `60` | UTXO cache TTL |
| `chain.verification.confirmationMode` | `"confirmed_only"` | Settlement response policy; `allow_mempool` is lower assurance |
| `chain.verification.minConfirmations` | `6` | Cardano confirmation depth before reporting `confirmed` |
| `chain.verification.requireNonce` | `true` | Require spec nonce UTXO anti-replay field |
| `chain.redis.port` | `6379` | Redis port |
| `chain.redis.password` | *(none)* | Redis password (enable in production) |
| `chain.redis.db` | `0` | Redis database index |
| `sentry.dsn` | *(none)* | Sentry DSN for error tracking |
| `sentry.environment` | *(none)* | Sentry environment tag |
| `sentry.tracesSampleRate` | `0.1` | Sentry performance trace sample rate |
| `storage.backend` | `"fs"` | Storage backend (`"fs"` or `"ipfs"`) |
| `storage.fs.dataDir` | `"./data/files"` | Local file storage directory |
| `storage.ipfs.apiUrl` | `"http://localhost:5001"` | IPFS Kubo API endpoint |

### Testnet Setup

Follow these steps to deploy on the Cardano Preview testnet:

1. **Create a Blockfrost account** at [blockfrost.io](https://blockfrost.io)
2. **Create a project** for the "Cardano Preview" network
3. **Copy the project ID** into `config.chain.blockfrost.projectId`
4. **Generate or use an existing 24-word seed phrase** for the facilitator wallet and store it in a `0600` file
5. **Fund the wallet** via the [Cardano Testnet Faucet](https://docs.cardano.org/cardano-testnets/tools/faucet/)
   - Request at least 10 ADA for facilitator operations
6. **Set the network** to `"Preview"` in `config.chain.network`
7. **If enabling the live demo**, use a separate Preview/Preprod wallet via
   `demo.seedPhraseFile`; production rejects inline demo seed material in
   `config.json`

### Mainnet Safety

The facilitator requires the `MAINNET=true` environment variable to connect to mainnet. This is a safety guardrail that prevents accidental mainnet usage during development. Mainnet also requires facilitator signing material to come from `chain.facilitator.seedPhraseFile` or `chain.facilitator.privateKeyFile` by default; inline `seedPhrase` / `privateKey` values in `config.json` are rejected unless `CARDANO402_ALLOW_MAINNET_INLINE_SIGNING_KEY=true` is set.

Without it, attempting to use `"Mainnet"` as the network will cause a startup error:

```
Mainnet connection requires explicit MAINNET=true environment variable
```

File-based Mainnet credentials are still a hot-wallet model. For high-value
Mainnet operation, use the signer isolation target described in
[`mainnet-signer-isolation.md`](mainnet-signer-isolation.md); until that remote
or hardware-backed signer exists, keep only limited operational funds in the
facilitator wallet.

`chain.facilitator.signerMode` is explicit so monitoring can report signer
posture. The only supported value today is `"local-file"`; remote policy signer
config should not be added until the signer provider boundary exists.

## Docker Deployment (Recommended)

### Development

Start Redis and IPFS for local development:

```bash
docker compose up -d
```

Then run the facilitator locally with hot reload:

```bash
pnpm dev
```

### Production

1. **Create production config**

   Copy `config/config.example.json` to `config/config.json` and set:
   - `env` to `"production"`
   - `logging.pretty` to `false`
   - `chain.redis.host` to `"redis-prod"` (Docker Compose service name)
   - `chain.redis.password` to your Redis password
   - `chain.blockfrost.projectId` to your Blockfrost key
   - `chain.facilitator.seedPhraseFile` to a `0600` file containing your facilitator wallet seed phrase

2. **Set Redis password**

   ```bash
   export REDIS_PASSWORD=your-secure-password
   ```

3. **Start the production stack**

   ```bash
   docker compose --profile production up -d
   ```

4. **Verify the deployment**

   ```bash
   curl http://localhost:3000/health
   ```

   Expected response: `{"status":"healthy","version":"1.0.0",...}`

### Docker Compose Services

| Profile | Service | Port | Description |
|---------|---------|------|-------------|
| *(default)* | `redis` | 6379 | Dev Redis (no auth) |
| *(default)* | `ipfs` | 5001, 8080 | IPFS node (API + gateway) |
| `production` | `facilitator` | 3000 | Facilitator server |
| `production` | `redis-prod` | 6380 | Production Redis (with auth) |

The production profile includes a health check on `redis-prod` -- the facilitator waits for Redis to be healthy before starting.

### Custom Docker Build

Build and run the image manually:

```bash
docker build -t cardano402 .
docker run -p 3000:3000 -v ./config:/app/config:ro cardano402
```

Image details:
- **Base:** Node.js 20 on Alpine Linux
- **User:** Non-root (`appuser:1001`)
- **Size:** ~180 MB
- **Health check:** Built-in (`wget` to `/health` every 30s)

## Production deploys are manual by design

There is no auto-deploy on merge. The VPS is reachable only over Tailscale and SSH is closed to the public internet — adding a GitHub-Actions deploy key would require widening the firewall to GitHub's runner IP ranges, which is a worse security posture than `bash deploy.sh` from a tailnet-attached laptop. See [`operations.md` § Manual deploy procedure](operations.md#manual-deploy-procedure) for the canonical runbook.

CI (`.github/workflows/ci.yml`) still runs on every push and PR — lint, typecheck, test, build, docker build, security audit. It only runs inside the GitHub-Actions runner and makes no outbound SSH connection.

If auto-deploy ever becomes desirable again, the right approach is the [Tailscale GitHub Action](https://github.com/tailscale/github-action), which attaches the runner to your tailnet for the deploy duration without opening any public port. Deferred until there's actual need.

## Bare Metal Deployment

If you prefer running without Docker:

```bash
# Install dependencies
pnpm install --frozen-lockfile

# Build TypeScript
pnpm build

# Start the server
node dist/index.js
```

Requires an external Redis instance. Set `chain.redis.host` and `chain.redis.port` in your config to point to your Redis server.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check (dependency status) |
| `GET` | `/supported` | Supported payment methods and facilitator address |
| `POST` | `/verify` | Verify a payment transaction |
| `POST` | `/settle` | Submit a transaction for settlement |
| `POST` | `/status` | Check transaction confirmation status |
| `POST` | `/upload` | Payment-gated file upload |
| `GET` | `/files/:cid` | Download a file by content ID |

## Monitoring

For operational monitoring, log analysis, Sentry error tracking, Redis monitoring, and common issue recovery, see the [Operations Runbook](operations.md).

## Security Considerations

- **Config file contains secrets** (API keys, seed phrase) -- never commit `config/config.json` to version control
- **Bind-mount config in Docker** with the `:ro` (read-only) flag
- **Enable Redis authentication** in production (`chain.redis.password`)
- **Rate limiting** is configured by default (100 req/min global, 20 req/min on sensitive endpoints)
- **Non-root container** -- the Docker image runs as `appuser:1001`
- **Token registry** is hardcoded as a security gate -- adding new tokens requires a code change and review
- **Mainnet signing isolation** -- file-based credentials reduce accidental
  leakage but do not isolate signing from a compromised web process; see
  [`mainnet-signer-isolation.md`](mainnet-signer-isolation.md)
