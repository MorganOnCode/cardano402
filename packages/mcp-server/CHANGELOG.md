# Changelog

All notable changes to `@cardano402/mcp-server` are documented here.

## 0.1.3 — security: persistent spend caps and safer Mainnet signing

Security hardening release on top of `0.1.2`.

### Fixed (security)

- **Persistent Mainnet spend ledger.** Mainnet now requires
  `--spend-store-path` or `CARDANO402_SPEND_STORE_PATH` so per-call and
  rolling daily spend caps survive MCP server restarts.
- **Concurrent signing spend race.** Spend checks now create a pending
  reservation before wallet signing. Reservations count against the daily cap,
  commit after successful signing, roll back on signer failure, expire after a
  short TTL, and are protected by a process-safe ledger lock when persisted.
- **Safer Mainnet seed loading.** Mainnet now requires
  `--seed-phrase-file` or `SEED_PHRASE_FILE` by default. POSIX seed files must
  be regular files and must not be group/world readable or writable. Using
  `SEED_PHRASE` for Mainnet now requires the explicit
  `CARDANO402_ALLOW_MAINNET_SEED_PHRASE_ENV=true` override.
- **Spend records include context.** Persistent ledger entries now include
  recipient, asset, transaction hash, tool name, reservation status, and
  timestamps for auditability.

### Added

- CLI flags:
  `--seed-phrase-file`, `--spend-store-path`.
- Env vars:
  `SEED_PHRASE_FILE`, `CARDANO402_SPEND_STORE_PATH`,
  `CARDANO402_ALLOW_MAINNET_SEED_PHRASE_ENV`.

### Tests

102 MCP package tests cover config parsing, seed-file permissions, Mainnet
guards, persistent spend history, pending reservation accounting, rollback,
expiry, and locked-ledger failure.

## 0.1.2 — security: spending limits, loopback default, SSRF guard

Security release. Closes three vulnerabilities in `0.1.1` (and earlier) that
let an LLM (or LAN-resident attacker) drain the configured signing wallet.
GHSA filed alongside this release. Upgrade is strongly recommended,
especially for any consumer running with `--transport http` or on Mainnet.

### Fixed (security)

- **Spending limits (C5).** `payAndFetch` now refuses to sign if the
  requested amount exceeds `maxAmountPerCall` (default `5_000_000`
  lovelace = 5 ADA) or would push the rolling 24h total over
  `maxAmountPerDay` (default `50_000_000` = 50 ADA). Optional
  `payToAllowlist` rejects signings to addresses outside the list. The
  gate runs *before* `signer.signPayment` so a refused call burns no
  wallet UTXOs or daily budget. New CLI flags: `--max-amount-per-call`,
  `--max-amount-per-day`, `--pay-to-allowlist`. Env equivalents:
  `CARDANO402_MAX_AMOUNT_PER_CALL`, `CARDANO402_MAX_AMOUNT_PER_DAY`,
  `CARDANO402_PAY_TO_ALLOWLIST`.
- **MCP elicitation/confirmation hook for large payments.** When the
  requested amount exceeds `--elicitation-threshold` (defaults to
  `--max-amount-per-call`), the server now issues an MCP
  `elicitation/create` request and requires an explicit user `yes`
  before signing. Anything other than `accept` aborts the sign.
- **HTTP transport defaults to loopback (H10).** `cardano402-mcp
  --transport http` now binds `127.0.0.1` by default. Opting into a
  non-loopback host (`--listen-host 0.0.0.0`) requires
  `--http-bearer-token` (or `MCP_HTTP_BEARER_TOKEN`); otherwise startup
  refuses. The transport also enforces:
  - **`Origin` header allowlist.** Requests with a non-loopback `Origin`
    that is not in `--http-origin-allowlist` are rejected with 403.
  - **Bearer token check.** When `--http-bearer-token` is configured,
    every request must echo it via `Authorization: Bearer <token>`;
    otherwise 401 with a `WWW-Authenticate: Bearer` header.
- **Mainnet tool registration is opt-in per tool.** Endpoints whose
  catalog `network` is `cardano:mainnet` are dropped at register-time
  unless the operator named the derived tool in
  `--mainnet-confirmed-tools` (`CARDANO402_MAINNET_CONFIRMED_TOOLS`).
  This is in addition to the existing `MAINNET=true` env-var gate.
- **SSRF via `catalog.server.url` (H11).** `resolveBaseUrl` is now
  validated through `assertPublicUrl` at register-time. Private,
  loopback, link-local, CGNAT, multicast, ULA, and IPv4-mapped IPv6
  variants of all of those are rejected unless `CARDANO402_ALLOW_INSECURE=true`.
  The same check now also fires on the catalog URL itself in
  `fetchCatalog`.
- **Path validation (H11).** `endpoint.path` is rejected at register-time
  if it contains `..`, NUL bytes, embedded whitespace / CR / LF, an
  absolute URL, or a protocol-relative `//host/...` form.
- **Single canonical `Payment-Signature` header on retry (M20).** The
  retry no longer duplicates the header as `PAYMENT-SIGNATURE`. HTTP
  headers are case-insensitive so spec-compliant gates are unaffected;
  the change closes off downstream tools that picked the duplicate
  and produced inconsistent telemetry.
- **Resource-server body nested under `__rawFromUntrustedResourceServer`
  (M14).** Attacker-supplied response keys can no longer shadow
  `status`, `payment`, or `contentType` in the tool's structured
  output.
- **Tool descriptions sanitised + envelope-wrapped (M13).** Catalog
  `description` strings are stripped of control chars, length-capped at
  2000 chars, and rendered inside a clearly-labelled "untrusted catalog
  description" envelope so prompt injection from a hostile catalog is
  harder to disguise as authoritative instructions.
- **`requestTimeoutMs` ceiling lowered to 120s (M21).** Previously
  600s; that's longer than any reasonable x402 settlement window and
  amplifies the cost of a stuck request.
- **Bundled libsodium override hint (CHANGELOG carry-over).** The
  package now ships an npm-format `overrides` block pinning
  `libsodium-wrappers-sumo` and `libsodium-sumo` to `0.8.2`. This
  works for `npm install @cardano402/mcp-server` and `yarn add` (which
  honor top-level `overrides` from the installed package's manifest).
  pnpm consumers still need their own `pnpm.overrides` block — see
  `Known issue` below.

### Added

- New CLI flags + env vars:
  `--listen-host` (`CARDANO402_LISTEN_HOST`),
  `--http-bearer-token` (`MCP_HTTP_BEARER_TOKEN`),
  `--http-origin-allowlist` (`MCP_HTTP_ORIGIN_ALLOWLIST`),
  `--max-amount-per-call` / `--max-amount-per-day` / `--pay-to-allowlist`,
  `--mainnet-confirmed-tools`,
  `--elicitation-threshold` (`CARDANO402_ELICITATION_THRESHOLD`).
- `SpendTracker` class (exported) for callers that want to enforce
  spending limits in their own glue code without `cardano402-mcp`'s
  full server loop.

### Changed

- `StartResult.httpPort` now reports the *actually bound* port (useful
  when callers pass `httpPort: 0` to let the OS pick).
- `StartResult` gained `httpHost: string` for observability.

### Disclosure / migration notes

- `0.1.1` will be `npm deprecate`d after this release with a pointer
  to the GHSA.
- `0.1.0` remains deprecated for the `EUNSUPPORTEDPROTOCOL` install
  failure documented in the `0.1.1` notes.
- Consumers who were running `0.1.1` on Mainnet with `--transport http`
  on a non-loopback interface should rotate their hot wallet seed
  before upgrading.

### Tests

89 unit tests (up from 37). 52 new test cases cover spend tracking,
elicitation, SSRF / private-CIDR + IPv6-mapped variants, path
traversal, HTTP transport loopback default, Origin rejection, bearer
token rejection, mainnet tool gating.

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

### Known issue (not blocking install, blocks runtime)

`@cardano-sdk/crypto` (a transitive dep through Lucid Evolution) pins
`libsodium-wrappers-sumo` to a `0.7.x` range. Versions `0.7.x` have a
broken ESM import (`./libsodium-sumo.mjs` doesn't exist in the
package), so the signer crashes on first init with
`ERR_MODULE_NOT_FOUND`. The fix landed in
`libsodium-wrappers-sumo@0.8.0` (bare specifier), and the cardano402
workspace itself works around this with a `pnpm.overrides` block at
the repo root — but the override doesn't propagate to npm consumers.

Until `@cardano-sdk/crypto` bumps its range, consumers must add their
own override:

```json
{
  "pnpm": { "overrides": { "libsodium-wrappers-sumo": "^0.8.2",
                           "libsodium-sumo": "^0.8.2" } }
}
```

or the equivalent npm `overrides` block. Verified end-to-end with that
override applied — preview-testnet tx
`0ee97088bcd84c19756d89d334b71ca29d8e78532cf40242945fcb879ea6e678`
submitted by `cardano402-mcp@0.1.1` (from npm, not the workspace).
Full details in the README's "Known issues / consumer-side overrides"
section.

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
