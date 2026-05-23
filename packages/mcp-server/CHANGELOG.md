# Changelog

All notable changes to `@cardano402/mcp-server` are documented here.

## 0.1.1 — publish-correctness fix

Hotfix release. `0.1.0` shipped via bare `npm publish` (chosen for
WebAuthn 2FA compat) which does not rewrite pnpm's `workspace:`
protocol — the published manifest had
`"@cardano402/core": "workspace:^"`, an unsupported npm range, so
`npm install @cardano402/mcp-server@0.1.0` failed with
`EUNSUPPORTEDPROTOCOL`. `0.1.0` is deprecated; use `0.1.1`.

### Fixed

- **Workspace protocol rewritten to resolved version** — release is now
  built with `pnpm pack` (which rewrites `workspace:^` to the resolved
  `^0.2.0`) and uploaded with `npm publish <tarball>` (which preserves
  the rewrite and still drives the WebAuthn browser flow). Consumers
  can now install normally.
- **`bin` path normalized** to the npm-11-canonical form
  (`dist/cli.js`, no `./` prefix); npm 11 was already stripping the
  prefix server-side so the registry shape is unchanged.

### Unchanged

- Source, dependency set, public API, and CLI surface match `0.1.0`.
  No runtime behavior change.
- 37/37 unit tests still pass; preview-testnet smoke not re-run (same
  built artifact).

## 0.1.0 — initial release

First stable release. Verified end-to-end against Cardano Preview
testnet (see "Smoke proof" below).

### Added

- **`startCardano402Mcp(opts)`** — boots the MCP server. Accepts
  `catalogUrl`, `transport` (`stdio` | `http`), `httpPort`, `network`,
  `blockfrostKey`, `signer`, `requestTimeoutMs`, `allowInsecure`.
  Returns a handle with `toolNames`, `signerAddress`, `httpPort`, and
  a `stop()` teardown.
- **`cardano402-mcp` CLI** — `--catalog`, `--transport`, `--port`,
  `--network`, `--help`. Env vars: `SEED_PHRASE`, `BLOCKFROST_KEY`,
  `CARDANO402_CATALOG_URL`, `CARDANO402_NETWORK`,
  `CARDANO402_ALLOW_INSECURE`, `MAINNET`.
- **Two transports:** `stdio` (Claude Desktop / Cursor) and
  Streamable HTTP (per the MCP spec, with stateful session-id
  handling).
- **`CardanoSigner` interface** with built-in `createLucidSeedSigner`
  (`@lucid-evolution/lucid` + `@lucid-evolution/provider`, loaded
  lazily so unit tests don't pull in CML wasm).
- **`fetchCatalog`, `WellKnownX402Schema`, `toolNameFor`,
  `resolveBaseUrl`** — catalog fetcher + parser with passthrough
  schemas for forward-compat. Tool-name recipe locked to the producer
  in `cardano402/src/catalog.ts:toMcpServerCardJson`.
- **`payAndFetch`** — runs the full x402 cycle (HTTP → 402 → sign →
  retry → 200) with `AbortController`-backed timeouts that wrap the
  entire request lifetime, including body reads. Cross-checks the live
  402 against the catalog `payTo`/`amount`/`network` and refuses to
  pay on mismatch (bait-and-switch defense).
- **`registerTools`** — one MCP tool per catalog endpoint. Generic
  `{ body?, query? }` input shape. Tool descriptions include the
  catalog's `inputSchema` inline to help LLM agents supply valid
  payloads. `_meta.cardano402/endpoint` surfaces the endpoint's
  method / path / network / asset / amount / payTo to MCP-spec-aware
  clients.

### Security guardrails

- **HTTPS-only catalog URLs** unless `CARDANO402_ALLOW_INSECURE=true`
  is explicitly set. Loopback hosts (`localhost`, `127.0.0.1`,
  `[::1]`) are exempted so dev setups still work.
- **Mainnet requires explicit `MAINNET=true` env var.** Defense
  against accidentally pointing a test wallet at real ADA.
- **Catalog cross-checked against live 402.** If a resource server's
  402 quotes a different `payTo`, `amount`, or `network` than the
  catalog advertised, the request is refused with a
  `Cardano402ValidationError` before any signing happens.
- **Lucid + CML wasm loaded lazily.** Callers that only touch
  `loadConfig` / `fetchCatalog` paths don't pay the wasm startup
  cost. WASM tx objects are freed in a `finally` block to avoid
  leaks.
- **Both `Payment-Signature` and `PAYMENT-SIGNATURE` header forms
  emitted** for interop with facilitators that match either case.

### Reused from `@cardano402/core@^0.2.0`

- `PaymentRequiredResponseSchema`, `PaymentSignaturePayloadSchema`,
  `PaymentAccept` (for the 402-envelope wire format).
- `Cardano402Error`, `Cardano402HttpError`, `Cardano402NetworkError`,
  `Cardano402ValidationError` (typed error hierarchy).

### Tests

37 unit tests cover catalog parsing (schema accept/reject, HTTP /
network / validation errors, `toolNameFor` lock-in), config
precedence (CLI > env > defaults, mainnet guardrail, insecure-URL
refusal, loopback exception), and the payment cycle (200 happy path,
full 402 cycle, bait-and-switch refusal, query parameter handling).

### Smoke proof

End-to-end run on 2026-05-23 against Cardano Preview testnet using
`scripts/smoke.mjs`:

- Real Lucid signing produced a 300-byte CBOR tx.
- Tx submitted via Blockfrost preview and accepted by the chain.
- Tx hash: `2845a731c935348ba2ba620b50640c7e3553da717773c1f8456decd49fe2dab7`
- View on chain:
  https://preview.cardanoscan.io/transaction/2845a731c935348ba2ba620b50640c7e3553da717773c1f8456decd49fe2dab7

`scripts/smoke.mjs` is a self-contained harness: it boots an inline
HTTP resource server (one priced endpoint, pay-to-self), spawns
`dist/cli.js` as a stdio subprocess, drives the JSON-RPC handshake
(`initialize` → `tools/list` → `tools/call`), submits the resulting
signed tx via Blockfrost, and asserts the `X-Payment-Response`
contains a real tx hash. ~150 LOC. Excluded from the npm tarball.

### Known follow-ups (not in 0.1.0)

- CIP-30 / hardware / remote signer interfaces (the `CardanoSigner`
  abstraction is in place; only the Lucid seed-phrase impl ships in
  0.1.0).
- Multi-resource-server federation (the catalog points at one server).
- Receipt history / retry on stale UTXOs.
- Provenance OIDC publish workflow (same posture as
  `@cardano402/core` — manual publish for 0.1.0, OIDC for 0.2.0+).
