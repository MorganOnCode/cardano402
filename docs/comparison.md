# Upgrade summary: before and after

A side-by-side of cardano402 as it existed at the start of this work versus
where it stands today. Use this as a changelog, an onboarding aid for
contributors, and a record of which spec gaps were closed.

## TL;DR

Before, cardano402 was a working Cardano facilitator that aligned with
the *spirit* of the x402 `exact` scheme but diverged from the *letter*
of the spec on several wire-format points. After this upgrade pass it
implements the spec's default address-to-address method end-to-end
(with the spec's mandatory replay-protection nonce), accepts both
cardano402-native and base x402 request body shapes, emits both
canonical and spec-literal response headers, and exposes an
agent-native discovery surface (`/.well-known/x402.json` plus three
sibling formats, JSON Schemas, and a `SKILL.md`). Identity has
been tightened: the package is now `cardano402`, the docker
containers and image are `cardano402-*`, and references to the
prior name have been removed throughout.

## Side-by-side dimensions

| Dimension | Before | After |
|---|---|---|
| Package name | `x402-fac` | `cardano402` |
| Repo URL in `package.json` | `MorganOnCode/x402-fac` | `MorganOnCode/cardano402` |
| Spec-mandated `nonce` (`txHash#index`) | Not handled | Required by default; verified as a tx input AND unspent on-chain |
| Response header name | `X-Payment-Response` only | Both `X-Payment-Response` (canonical) and `PAYMENT-RESPONSE` (spec literal) |
| `/verify` and `/settle` body shape | `paymentPayload` (object) only | Both `paymentPayload` (object) and `paymentHeader` (base64 string) accepted |
| `extensions.status` on settle response | Not emitted | Emitted (`confirmed` by default; `mempool` only with explicit operator opt-in) |
| `x402Version` in `/supported` kinds | `z.number()` | `z.literal(2)` (strict) |
| `assetTransferMethod` branching | Implicit default only | Explicit `default` and `script` branches; unknown literals rejected with `method_not_supported` |
| Agent-discoverable manifest | None | `/.well-known/x402.json`, `/.well-known/agent-card.json`, `/.well-known/ai-agent.json`, `/.well-known/mcp/server-card.json` (all from a single `ServiceCatalog`) |
| Wire-format JSON Schemas | None | `schemas/{payment-requirements,payment-signature,settlement-response,supported,well-known-x402}.schema.json` |
| Agent skill file | None | `SKILL.md` at repo root |
| Docker container names | `x402-facilitator`, `x402-redis`, `x402-redis-prod`, `x402-ipfs` | `cardano402`, `cardano402-redis`, `cardano402-redis-prod`, `cardano402-ipfs` |
| SDK family | Fastify-only (built into root package) | Fastify path retained; new `packages/{core,mcp-server,express,fastify,hono,next,fetch,axios}` scaffolds with reserved names and per-package READMEs |
| Verification checks | 10-check pipeline | 11-check pipeline (added `checkNonce`) |

## What is new

### Source files

| Path | Purpose |
|---|---|
| `src/catalog.ts` | `ServiceCatalog` class with paid-route registration plus four render targets |
| `src/routes/well-known.ts` | Serves the four `/.well-known/` manifests from the catalog |
| `src/sdk/methods.ts` | `assetTransferMethod` schemas and `resolveAssetTransferMethod()` |
| `src/verify/methods/default.ts` | Address-to-address path entry point (re-exports `verifyPayment`) |
| `src/verify/methods/script.ts` | Plutus V3 script-payment verifier (stub returning `method_not_implemented`) |
| `src/verify/nonce.ts` | `parseNonce()` and `formatNonce()` helpers for `txHash#index` |
| `src/verify/request-shape.ts` | Normaliser that accepts both `paymentPayload` (object) and `paymentHeader` (base64) body shapes |

### Schemas and agent-facing artifacts

| Path | Purpose |
|---|---|
| `SKILL.md` | Agent-readable instructions for discovering, paying, and consuming a paid endpoint on Cardano |
| `schemas/payment-requirements.schema.json` | JSON Schema for the 402 response body |
| `schemas/payment-signature.schema.json` | JSON Schema for the `PAYMENT-SIGNATURE` payload (incl. the required `nonce`) |
| `schemas/settlement-response.schema.json` | JSON Schema for the `PAYMENT-RESPONSE` payload (incl. `extensions.status`) |
| `schemas/supported.schema.json` | JSON Schema for `GET /supported` |
| `schemas/well-known-x402.schema.json` | JSON Schema for `/.well-known/x402.json` |

### Documentation

| Path | Purpose |
|---|---|
| `docs/agent-interface.md` | How agents discover and call this server |
| `docs/open-posture.md` | Registry-free, federated commitments |
| `docs/spec-alignment.md` | Section-by-section spec coverage, including outstanding gaps |
| `docs/wire-format.md` | Full message-shape reference, cross-linked to JSON Schemas |
| `docs/comparison.md` | This file |

### Package scaffolds (under `packages/`)

| Package | Status |
|---|---|
| `@cardano402/core` | Scaffold (framework-agnostic types and clients) |
| `@cardano402/mcp-server` | Scaffold (MCP server exposing paid endpoints as tools) |
| `@cardano402/express`, `@cardano402/fastify`, `@cardano402/hono`, `@cardano402/next`, `@cardano402/fetch`, `@cardano402/axios` | Scaffolds (per-framework adapters) |

Each scaffold ships with its own `package.json`, `README.md`, and a stub
`src/index.ts` that throws a clear `notImplemented` error pointing at
the upgrade plan. The names are reserved on the public registry surface
without being published yet.

## What changed in existing files

### `src/sdk/types.ts`

Added `NonceSchema` (regex `^[0-9a-f]{64}#\d+$`). Extended
`CardanoPaymentPayloadSchema` with the optional `nonce` field (required
at runtime when `chain.verification.requireNonce` is true, default
true). Added `extensions: { status }` to `PaymentResponseHeaderSchema`.
Tightened `SupportedPaymentKindSchema.x402Version` from `z.number()` to
`z.literal(2)`.

### `src/verify/types.ts`

Mirrored the schema changes. Extended `VerifyContext` with
`declaredNonce`, `requireNonce`, and `isUtxoUnspent` so the verifier
can route around tests cleanly while still failing closed in production.

### `src/verify/checks.ts`

Added a new check at the end of the pipeline, `checkNonce`. Behaviour:

- Missing nonce + `requireNonce: true` (default) -> reject with `nonce_required`
- Missing nonce + `requireNonce: false` -> pass (legacy mode)
- Nonce present but does not match a tx input -> reject with `nonce_not_in_inputs`
- Nonce present and matches an input but UTXO is spent -> reject with `nonce_utxo_spent`
- Nonce present, callback throws -> reject with `nonce_lookup_failed`
- Nonce present, no `isUtxoUnspent` callback wired, `requireNonce: true` -> reject with `nonce_lookup_unavailable` (audit-time hardening: production fails closed if the chain hook is somehow missing)

### `src/chain/blockfrost-client.ts`

Added `isUtxoUnspent(txHash, index)`. Looks up the producing tx via
`txsUtxos`, finds the output at the given index, then queries the
holding address's UTxOs and checks whether the `(txHash, index)` pair
is still present.

### `src/chain/config.ts`

Added two fields to `chain.verification`:

- `requireNonce` (boolean, default `true`)
- `confirmationMode` (`'confirmed_only' | 'allow_mempool'`, default `'confirmed_only'`)

`'allow_mempool'` is the operator opt-in that permits emitting
`extensions.status: "mempool"` on settle responses; the spec strongly
discourages this for resources of real value because of Cardano's
Ouroboros Praos probabilistic finality.

### `src/routes/verify.ts`, `src/routes/settle.ts`

Now accept either body shape (cardano402 native or base x402) via the
new `request-shape.ts` normaliser. Branch on `assetTransferMethod` and
return structured failures for unsupported (`method_not_supported`) or
unimplemented (`method_not_implemented`) methods. Wire the
`isUtxoUnspent` chain hook through to the verify context.

### `src/sdk/payment-gate.ts`

Emits both `X-Payment-Response` and `PAYMENT-RESPONSE` headers in
parallel. Annotates the response payload with
`extensions: { status: 'confirmed' }` since the gate only proceeds past
on-chain confirmation.

### `src/settle/settle-payment.ts`

`SettleResult` carries `extensions.status`. The settle orchestrator
emits `confirmed` after block inclusion, and emits `mempool` (with
`success: true`) only when the operator passes
`{ allowMempool: true }`, which the route enables via
`chain.verification.confirmationMode === 'allow_mempool'`.

### `src/server.ts`

Registers the well-known routes plugin. Constructs and decorates a
`ServiceCatalog` instance for paid routes to register into. Updates
the CORS allowlist to surface the new header names.

### `src/types/index.ts`

Augments Fastify with the new `catalog: ServiceCatalog` decoration.

### `package.json`

`name` changed to `cardano402`. `version` bumped. `repository`,
`bugs`, and `homepage` URLs updated to `MorganOnCode/cardano402`.
Keywords expanded. `dev` script updated to load `.env` automatically
via Node's `--env-file-if-exists` flag.

### `docker-compose.yml`, `docker-compose.prod.yml`

All `x402-*` container names renamed to `cardano402-*`. Image name
updated to `cardano402:latest`.

### `.gitignore`

Added entries to exclude `.auditing/`, `.planning/`, and
`x402-rs-main/` directories from tracking. The local `.bg-shell/`
entry was already present.

### `.github/workflows/ci.yml`

Docker image tag in the CI build step renamed from `cardano-x402:ci`
to `cardano402:ci`.

### `landing/index.html`

Seven hardcoded `github.com/morganic-jarvis-agent/cardano-x402` links
updated to `github.com/MorganOnCode/cardano402`.

### `src/routes/demo.ts`

Removed an unused-variable lint error introduced before this work.
The `/supported` body fetch still consumes its response (so the
connection releases promptly) but no longer assigns to a discarded
local.

### `README.md`

Reframed from "first x402 payment facilitator for Cardano mainnet"
to a Stripe-for-agents quickstart, followed by a What's New / How
It Works / Spec Compliance / Documentation index.

## What was removed

| What | Reason |
|---|---|
| Verifier and schema for an out-of-scope alternative `assetTransferMethod` | Not in cardano402's positioning. The route layer rejects unsupported methods with a structured `method_not_supported` reason rather than silently re-interpreting them. |
| The previous `docs/comparison.md` | Replaced by this document. |
| Discriminated-union arms naming third-party protocols | Removed alongside the deletion above so the public surface only references methods we implement (`default`) or recognise but stub (`script`). |

## What was hardened during the audit pass

1. `checkNonce` now fails closed when the `isUtxoUnspent` callback is
   missing in spec-compliant mode (`requireNonce: true`). Previously
   the function returned `passed: true` with a `skipped: 'isUtxoUnspent_callback_missing'`
   detail. The new behaviour returns `passed: false` with reason
   `nonce_lookup_unavailable` when the chain hook is missing in
   production. Legacy mode (`requireNonce: false`) still skips the
   chain check.
2. Repository hygiene: the workspace scratch directories that may
   contain development planning notes or audit material are now
   excluded by `.gitignore`. They never go to GitHub on the next push.
3. Wrong-repo links in `landing/index.html` (pointing at a stale
   GitHub URL) were corrected.

## Test / build status at the end of the upgrade

- `pnpm typecheck`: clean
- `pnpm lint`: clean
- `pnpm test`: 31 files, 428 tests, all passing (49 of those are new tests added by this work, covering nonce parsing, the request-shape normaliser, the asset-transfer method scaffolding, the catalog renderers, and the hardened `checkNonce` matrix)
- `pnpm build`: clean ESM + DTS output

## Outstanding work intentionally not in scope here

- `script` (Plutus V3) verifier: the schema is in place but the
  parameter applier and datum decoder are not. Calls land at the
  `verifyScript` stub which returns `method_not_implemented`.
- The `packages/` monorepo scaffolds are not yet implemented. Each
  carries a clear `notImplemented` throw and a per-package README
  describing the intended surface.
- The MCP server (`packages/mcp-server`) is scaffolded but not yet
  wired. Implementing it is the highest-leverage next move for
  agent-native distribution.
- Two pre-existing CSP concerns on `landing/index.html` remain: an
  inline `<script>` block, an inline `<style>` block, and 38 inline
  `style="..."` attributes. Local dev with `env: development`
  bypasses CSP. A future cleanup would extract these to external files
  so the production CSP stays strict.
