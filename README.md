# cardano402

A **keyless Cardano x402 facilitator** on Cloudflare Workers, built on the
x402 Foundation's reference implementation
([`@x402/cardano`](https://github.com/x402-foundation/x402/tree/main/typescript/packages/mechanisms/cardano)).
It verifies payer-signed `exact`-scheme transactions and broadcasts them once.
It holds no keys and no funds.

- **Standard:** x402 v2, `exact` scheme, `default` / `script` / `masumi`
  transfer methods, per-route confirmation policy, `settlement_pending`
  resume. Any `@x402/core` resource server can use it unchanged.
- **Keyless:** the payer signs and pays the network fee. The facilitator runs
  provider-only (Blockfrost), so there is no hot wallet to steal.
- **Agent-first:** `GET /` returns a TOON home view (AXI style) with live
  network and confirmation bounds and runnable next steps; browsers get HTML.
  `/SKILL.md` and `/llms.txt` are generated from the same data.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Home view: TOON for agents, HTML for browsers |
| GET | `/supported` | x402 payment kinds, confirmation bounds, signers (always empty) |
| POST | `/verify` | `{ x402Version, paymentPayload, paymentRequirements }` → `VerifyResponse` |
| POST | `/settle` | Same body → `SettleResponse`; retry once on `settlement_pending` |
| GET | `/health` | Liveness; `?deep=1` also probes Blockfrost and reports settlement counts |
| GET | `/SKILL.md`, `/llms.txt` | Agent integration docs |

## Use it from a resource server

```ts
import { HTTPFacilitatorClient } from "@x402/core/server";

const facilitator = new HTTPFacilitatorClient({ url: "https://cardano402.com" });
```

The flow is *authorization*: verify, run your handler, then settle. If the
handler fails, don't settle: nothing is broadcast and the payer is not charged.

## Layout

```
apps/facilitator/   The Worker (Hono + @x402/cardano + Durable Object settlement guard)
packages/           Legacy @cardano402/* SDKs (core, mcp-server), superseded by @x402/*
docs/v2-roadmap.md  Refunds, edge cases and other planned upgrades
docs/v2-cutover.md  Runbook for moving cardano402.com from the VPS to the Worker
docs/v1/            v1 (Fastify/Lucid, VPS) documentation, kept for history
```

## Develop

```sh
pnpm install
cp apps/facilitator/.dev.vars.example apps/facilitator/.dev.vars   # preprod Blockfrost id
pnpm --filter @cardano402/facilitator dev     # wrangler dev on cardano:preprod
pnpm --filter @cardano402/facilitator test    # runs inside workerd
```

## Deploy

GitHub Actions (`.github/workflows/deploy.yml`): every push to `master` or
`v2` deploys the **preview** Worker on `cardano:preprod` and smoke-tests it.
**Production** (`cardano:mainnet`) deploys only from `master`, after a
reviewer approves the `production` environment. The Blockfrost id is a Worker
secret (`wrangler secret put BLOCKFROST_PROJECT_ID --env <env>`).

## v1

The Fastify/Lucid facilitator that ran on a VPS (with a hot-wallet signer,
Redis, and the `/demo` testnet trial) is preserved at tag
[`v1-final`](https://github.com/MorganOnCode/cardano402/tree/v1-final).

## License

Apache-2.0
