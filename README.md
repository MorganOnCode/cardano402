# cardano402

> Open-source payment gateway for the agent economy on Cardano. Accept ADA
> or stablecoin payments per HTTP request, with zero registration, zero
> subscriptions, zero percentage fees, and agent-native discovery. Built on
> the x402 protocol.

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

```typescript
import { createPaymentGate, FacilitatorClient } from "cardano402/sdk";

const facilitator = new FacilitatorClient({ baseUrl: "https://cardano402.com" });
const gate = createPaymentGate({
  facilitator,
  payTo: "addr1...",        // your wallet
  amount: "2000000",         // 2 ADA in lovelace
  network: "cardano:mainnet",
});

app.post("/api/analyze", { preHandler: gate }, handler);
```

That is it. Any x402 client or MCP-enabled agent can now pay for
`/api/analyze`. No third-party accounts, no central registry, no KYC.

## Why cardano402

- **Agent-native.** Discovery via `/.well-known/x402.json`, plus
  agent-card.json (A2A), ai-agent.json (aiia.ro), and MCP server-card.
  See [`docs/agent-interface.md`](docs/agent-interface.md).
- **Registry-free.** No accounts, no API keys, no agent identifier
  required for the default address-to-address path. See
  [`docs/open-posture.md`](docs/open-posture.md).
- **Spec-aligned.** Implements the
  [x402 Cardano scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_cardano.md)
  default method end-to-end with all six mandatory facilitator checks.
  See [`docs/spec-alignment.md`](docs/spec-alignment.md).
- **Stricter than spec on safety.** 11 verification checks (CBOR
  validity, witness, min UTXO, fee bounds in addition to the 6 spec
  checks). On-chain confirmation polling. SHA-256 dedup.
- **Multi-token.** ADA plus a hardcoded registry of stablecoins (USDM,
  DJED, iUSD). Tokens added via code review only, not metadata
  spoofing.
- **Bring-your-own facilitator.** Run yours, run ours, or use someone
  else's. The facilitator is a commodity component.

## How it works

```
Client          Resource server          Facilitator              Cardano
  |    GET /api      |                       |                        |
  |----------------->|                       |                        |
  |  402 Payment     |                       |                        |
  |  Required        |                       |                        |
  |<-----------------|                       |                        |
  | build & sign tx  |                       |                        |
  |  GET /api +      |                       |                        |
  |  PAYMENT-        |                       |                        |
  |  SIGNATURE       |                       |                        |
  |----------------->|       /verify         |                        |
  |                  |---------------------->|                        |
  |                  |    isValid            |                        |
  |                  |<----------------------|                        |
  |                  |       /settle         |       submit           |
  |                  |---------------------->|----------------------->|
  |                  |                       |     confirmation       |
  |                  |                       |<-----------------------|
  |  200 + resource  |                       |                        |
  |  PAYMENT-        |                       |                        |
  |  RESPONSE        |                       |                        |
  |<-----------------|                       |                        |
```

cardano402 ships both the facilitator (verify/settle/status/supported)
and the resource-server SDK (the gate plus client utilities) in one
repo. Run them separately or together.

## Spec compliance status

cardano402 implements the **default address-to-address asset transfer
method** with full spec compliance, including the spec-mandated `nonce`
(UTXO reference, must be a tx input, must be unspent). The `script`
(Plutus V3) method is schema-recognised but the verifier is stubbed;
requests for it receive a structured `method_not_implemented` reason.
Other methods receive `method_not_supported`.

Full status: [`docs/spec-alignment.md`](docs/spec-alignment.md).

## Quick start (preview testnet)

### 1. Clone

```bash
git clone https://github.com/MorganOnCode/cardano402.git
cd cardano402
pnpm install
```

### 2. Start dependencies

```bash
pnpm docker:up   # starts Redis
```

### 3. Configure

```bash
cp config/config.example.json config/config.json
```

Edit `config/config.json`:

- Set `chain.blockfrost.projectId` to your Blockfrost preview project ID
  (free tier from <https://blockfrost.io>).
- Set `chain.facilitator.seedPhrase` to a 24-word seed phrase for a
  preview-testnet wallet. Never commit `config.json`.

### 4. Run

```bash
pnpm dev
```

Then in another terminal:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/supported
curl http://localhost:3000/.well-known/x402.json
```

For a full end-to-end client + server walkthrough, see
[`preview-testnet-guide.md`](preview-testnet-guide.md).

## API surface

| Method | Path                                | Description                          |
|--------|-------------------------------------|--------------------------------------|
| GET    | `/health`                           | Server health and dependency status  |
| GET    | `/supported`                        | Supported chains, schemes, signers   |
| POST   | `/verify`                           | Verify a signed Cardano transaction  |
| POST   | `/settle`                           | Submit and confirm payment on-chain  |
| POST   | `/status`                           | Tx confirmation status               |
| GET    | `/.well-known/x402.json`            | Native x402 discovery manifest       |
| GET    | `/.well-known/agent-card.json`      | Google A2A agent-card                |
| GET    | `/.well-known/ai-agent.json`        | aiia.ro ai-agent.json                |
| GET    | `/.well-known/mcp/server-card.json` | MCP server-card (SEP-1649)           |
| POST   | `/upload`                           | Reference: payment-gated file upload |
| GET    | `/files/:cid`                       | Reference: download by CID (free)    |

Interactive docs at `/docs` (Swagger UI). Wire-format schemas in
[`schemas/`](schemas/).

## Documentation

- [`SKILL.md`](SKILL.md) — agent-consumable instructions
- [`docs/agent-interface.md`](docs/agent-interface.md) — how agents discover and call this
- [`docs/wire-format.md`](docs/wire-format.md) — full message schemas
- [`docs/spec-alignment.md`](docs/spec-alignment.md) — section-by-section spec coverage
- [`docs/open-posture.md`](docs/open-posture.md) — registry-free commitments
- [`docs/architecture.md`](docs/architecture.md) — system design
- [`docs/operations.md`](docs/operations.md) — runbook
- [`docs/deployment.md`](docs/deployment.md) — production deploy
- [`docs/cardano-x402.md`](docs/cardano-x402.md) — Cardano positioning

## Contributing

The `master` branch is protected. Open a PR. CI runs typecheck, lint,
and tests on every push.

## Security

See [`SECURITY.md`](SECURITY.md). Disclosure is privately to the email
listed there.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
