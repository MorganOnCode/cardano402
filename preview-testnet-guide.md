# Preview Testnet Guide

Step-by-step guide to running the x402 Cardano payment facilitator on the Cardano Preview testnet.

## Step 1: Get a Blockfrost API key

1. Go to [blockfrost.io](https://blockfrost.io) and create a free account
2. Create a new project, select **Cardano Preview** testnet
3. Copy the project ID (starts with `preview...`)

## Step 2: Get a funded preview wallet

You need a 24-word seed phrase. If you don't already have one for testing:

- **Option A:** Generate one with cardano-cli or any Cardano wallet (Eternl, Nami, etc.)
- **Option B:** Use an existing test wallet seed phrase you already have

Then fund it:

1. Get the wallet's receive address
2. Go to the [Cardano Preview Faucet](https://docs.cardano.org/cardano-testnets/tools/faucet/)
3. Request test ADA (you need at least 5 ADA -- 2 for payment + fees + min UTXO)

## Step 3: Start Redis

```bash
cd ~/Documents/CODE/x402-fac
pnpm docker:up
```

This starts Redis on port 6379.

## Step 4: Create your config

```bash
cp config/config.example.json config/config.json
```

Then edit `config/config.json`:

```json
{
  "server": { "host": "0.0.0.0", "port": 3000 },
  "logging": { "level": "debug", "pretty": true },
  "env": "development",
  "chain": {
    "network": "Preview",
    "blockfrost": {
      "projectId": "previewYOUR_KEY_HERE",
      "tier": "free"
    },
    "facilitator": {
      "seedPhrase": "your 24 word seed phrase here"
    },
    "cache": { "utxoTtlSeconds": 60 },
    "reservation": { "ttlSeconds": 120, "maxConcurrent": 20 },
    "redis": { "host": "localhost", "port": 6379, "db": 0 },
    "verification": {
      "graceBufferSeconds": 30,
      "maxTimeoutSeconds": 300,
      "feeMinLovelace": 150000,
      "feeMaxLovelace": 5000000
    }
  },
  "storage": {
    "backend": "fs",
    "fs": { "dataDir": "./data/files" }
  }
}
```

Key differences from the example config:

- `logging.level`: `"debug"` (see everything during testing)
- `logging.pretty`: `true` (human-readable logs)
- `env`: `"development"` (not production)
- `redis.host`: `"localhost"` (not `redis-prod`)
- `redis.password`: **removed** (dev Redis has no auth)
- `sentry`: **removed** (not needed for testing)

## Step 5: Start the server

```bash
pnpm dev
```

You should see logs showing:

- Server starting on port 3000
- Redis connected
- Chain provider initialized (Lucid + Blockfrost)
- Routes registered

Test it quick:

```bash
curl http://localhost:3000/health | python3 -m json.tool
curl http://localhost:3000/supported | python3 -m json.tool
```

Health should show `{"status":"ok","dependencies":{"redis":"up","chain":"up","storage":"up"}}`.

## Step 6: Run the example client

In a **separate terminal**:

```bash
BLOCKFROST_KEY="previewYOUR_KEY_HERE" \
SEED_PHRASE="your 24 word seed phrase here" \
npx tsx examples/client.ts
```

This runs the full 7-step flow:

1. Health check
2. Query /supported
3. POST /upload without payment -> gets 402
4. Parse payment requirements from 402 response
5. Build + sign a real Cardano transaction with Lucid
6. Retry upload with Payment-Signature header -> settlement on-chain -> 200
7. Download the file back and verify integrity

**Step 6 is the big one** -- it submits a real transaction to the Cardano preview blockchain and polls for confirmation. Expect it to take 20-60 seconds for the transaction to confirm.

## Step 7: Verify on-chain

After the client prints the transaction hash, verify it on a block explorer:

```
https://preview.cardanoscan.io/transaction/YOUR_TX_HASH
```

## What to watch for

**In the server logs** (the `pnpm dev` terminal):

- CBOR deserialization succeeding
- All 10 verification checks passing
- Blockfrost submission returning a tx hash
- Confirmation polling succeeding

## Failure modes to test after the happy path

Once the happy path works, try these scenarios:

- **Expired transaction** -- should fail TTL check
- **Replay the same transaction** -- should hit SHA-256 dedup
- **Wrong amount** -- should fail amount check
- **Wrong recipient address** -- should fail recipient check
