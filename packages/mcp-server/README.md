# @cardano402/mcp-server

An MCP (Model Context Protocol) server that exposes any x402-priced HTTP
API as a set of MCP tools and handles the Cardano payment cycle on the
agent's behalf.

Given a `/.well-known/x402.json` URL and a signing wallet, this package:

1. Fetches the catalog and registers one MCP tool per paid endpoint.
2. On tool invocation, makes the HTTP call, reads the `402 Payment
   Required` response, builds and signs a Cardano transaction with
   [Lucid Evolution](https://github.com/Anastasia-Labs/lucid-evolution),
   retries with the `Payment-Signature` header, and returns the resource
   to the calling agent.

## CLI

```bash
SEED_PHRASE="word1 word2 ... word24" \
BLOCKFROST_KEY="preview..." \
  npx @cardano402/mcp-server \
    --catalog https://api.example.com/.well-known/x402.json \
    --transport stdio
```

Flags:

| Flag                              | Default       | Notes                                                                                             |
|-----------------------------------|---------------|---------------------------------------------------------------------------------------------------|
| `--catalog <url>`                 | required      | Or set `CARDANO402_CATALOG_URL`                                                                   |
| `--transport <name>`              | `stdio`       | `stdio` for local clients, `http` for Streamable HTTP                                             |
| `--port <n>`                      | `3333`        | Only used when `--transport http`                                                                 |
| `--listen-host <host>`            | `127.0.0.1`   | HTTP listen interface. Anything non-loopback **requires** `--http-bearer-token`                   |
| `--network <name>`                | `Preview`     | `Preview`, `Preprod`, or `Mainnet`                                                                |
| `--max-amount-per-call <lovelace>`| `5_000_000`   | Hard cap per signed transaction (5 ADA default)                                                   |
| `--max-amount-per-day <lovelace>` | `50_000_000`  | Rolling 24h cap on signed amount (50 ADA default)                                                 |
| `--pay-to-allowlist <a,b,c>`      | none          | Refuse to sign to addresses outside this comma-separated list                                     |
| `--mainnet-confirmed-tools <a,b,c>` | none        | Required to register any tool whose catalog `network` is `cardano:mainnet`                        |
| `--elicitation-threshold <lovelace>` | per-call cap | Amount above which an MCP `elicitation/create` confirmation is requested before signing       |
| `--http-bearer-token <token>`     | none          | Require `Authorization: Bearer <token>` on every HTTP transport request                           |
| `--http-origin-allowlist <a,b,c>` | loopback only | Additional `Origin` header values to accept                                                       |
| `-h`, `--help`                    |               | Print usage                                                                                       |

Environment:

| Variable                              | Notes                                                                   |
|---------------------------------------|-------------------------------------------------------------------------|
| `SEED_PHRASE`                         | 24-word seed phrase for the wallet that will fund payments (required)   |
| `BLOCKFROST_KEY`                      | Blockfrost project ID for the chosen network (required)                 |
| `CARDANO402_CATALOG_URL`              | Alternative to `--catalog`                                              |
| `CARDANO402_NETWORK`                  | Alternative to `--network`                                              |
| `CARDANO402_ALLOW_INSECURE`           | `true` to permit non-HTTPS catalog URLs + private-CIDR base URLs        |
| `MAINNET`                             | `true` is required to opt into a `Mainnet` connection                   |
| `CARDANO402_LISTEN_HOST`              | Alternative to `--listen-host`                                          |
| `MCP_HTTP_BEARER_TOKEN`               | Alternative to `--http-bearer-token`                                    |
| `MCP_HTTP_ORIGIN_ALLOWLIST`           | Alternative to `--http-origin-allowlist`                                |
| `CARDANO402_MAX_AMOUNT_PER_CALL`      | Alternative to `--max-amount-per-call`                                  |
| `CARDANO402_MAX_AMOUNT_PER_DAY`       | Alternative to `--max-amount-per-day`                                   |
| `CARDANO402_PAY_TO_ALLOWLIST`         | Alternative to `--pay-to-allowlist`                                     |
| `CARDANO402_MAINNET_CONFIRMED_TOOLS`  | Alternative to `--mainnet-confirmed-tools`                              |
| `CARDANO402_ELICITATION_THRESHOLD`    | Alternative to `--elicitation-threshold`                                |

## Claude Desktop / Cursor config

```json
{
  "mcpServers": {
    "example-api": {
      "command": "npx",
      "args": [
        "-y",
        "@cardano402/mcp-server",
        "--catalog",
        "https://api.example.com/.well-known/x402.json"
      ],
      "env": {
        "SEED_PHRASE": "word1 word2 ... word24",
        "BLOCKFROST_KEY": "preview..."
      }
    }
  }
}
```

## Programmatic use

```ts
import { startCardano402Mcp, loadConfig } from '@cardano402/mcp-server';

const handle = await startCardano402Mcp(
  loadConfig({ argv: process.argv.slice(2), env: process.env })
);

process.on('SIGTERM', () => void handle.stop());
```

## Transports

- **`stdio`** — JSON-RPC over stdin/stdout. Use this with desktop MCP
  clients (Claude Desktop, Cursor).
- **`http`** — MCP Streamable HTTP per the
  [MCP transport spec](https://modelcontextprotocol.io/). Sessions are
  created on first request; the session id is returned in the
  `Mcp-Session-Id` response header and must be echoed back on subsequent
  requests.

## Tool naming

Tool names follow the same recipe as
`/.well-known/mcp/server-card.json` in cardano402's facilitator: lower-
cased method, underscore, sanitised path. For example, a catalog entry
`POST /api/analyze` becomes the tool `post_api_analyze`.

## Security posture

- **Per-call + per-day spending caps.** Refuses to sign a payment that
  exceeds `--max-amount-per-call` (default 5 ADA) or that would push
  the rolling 24-hour total over `--max-amount-per-day` (default 50
  ADA). Optional `--pay-to-allowlist` rejects signings to addresses
  outside the list. The gate runs *before* the signer touches a UTXO.
- **MCP elicitation/confirmation for large payments.** When the
  requested amount exceeds `--elicitation-threshold` (defaults to the
  per-call cap), the server sends an MCP `elicitation/create` request
  to the client and requires an explicit `yes` before signing.
- **HTTP transport defaults to loopback.** `--transport http` binds
  `127.0.0.1` by default. Anything else requires `--http-bearer-token`
  (so a wallet RPC is never exposed on a LAN/WAN without auth). The
  transport also checks the `Origin` header (loopback +
  `--http-origin-allowlist` only) and the bearer token on every
  request.
- **Mainnet tools are opt-in per-tool.** Catalog endpoints whose
  `network` is `cardano:mainnet` are dropped at register-time unless
  the operator names the derived tool in `--mainnet-confirmed-tools`.
  This is on top of the existing `MAINNET=true` env-var gate.
- **SSRF guard.** `catalog.server.url` and the catalog URL itself are
  rejected if they resolve to a private, loopback, link-local, CGNAT,
  multicast, ULA, or IPv4-mapped IPv6 address (`169.254.169.254`,
  `fc00::/7`, etc) — unless `CARDANO402_ALLOW_INSECURE=true`.
- **Path validation.** Endpoint paths containing `..`, NUL bytes,
  whitespace, CR/LF, or anything that looks like an absolute URL are
  rejected at register-time.
- The signing wallet's seed phrase is read from `SEED_PHRASE` and lives
  only in process memory. It is never logged.
- By default the server refuses to fetch a non-HTTPS catalog URL or to
  POST signed transactions to one, unless it's a loopback host. Override
  with `CARDANO402_ALLOW_INSECURE=true` if you really mean it.
- Mainnet requires an explicit `MAINNET=true` env var as a guardrail
  against accidentally pointing the signer at real ADA.
- Before paying, the live `402` response is cross-checked against the
  catalog: a resource server that quotes a different `payTo` / `amount`
  / `network` at runtime than its catalog advertised is refused.
- The resource-server response body is nested under
  `__rawFromUntrustedResourceServer` in the tool's structured output so
  attacker-supplied keys can't shadow `status`, `payment`, or
  `contentType`. Catalog descriptions are stripped of control chars
  and wrapped in an "untrusted catalog description" envelope.

See the cardano402 root [`SECURITY.md`](../../SECURITY.md) for the
disclosure channel.

## Known issues / consumer-side overrides

### `libsodium-wrappers-sumo` transitive resolution

> **0.1.2 update:** the published package now ships an npm-format
> `overrides` block pinning `libsodium-wrappers-sumo` and
> `libsodium-sumo` to `0.8.2`. That covers consumers installing via
> `npm` or `yarn` (both honor top-level `overrides` from the installed
> package's manifest). **pnpm consumers still need their own
> `pnpm.overrides` block** — pnpm only reads `overrides` from the
> workspace root, not from transitives.

On a fresh `npm install` / `pnpm add` of this package, Lucid Evolution's
deep transitive `@cardano-sdk/crypto` pulls in
`libsodium-wrappers-sumo@0.7.x`. That version uses a broken ESM import
(`import e from "./libsodium-sumo.mjs"` — the file isn't in the package),
so the server crashes at signer-init time with:

```
ERR_MODULE_NOT_FOUND: Cannot find module
  '.../libsodium-wrappers-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs'
```

The fix landed upstream in `libsodium-wrappers-sumo@0.8.0` (changed to a
bare specifier, `import e from "libsodium-sumo"`). Until
`@cardano-sdk/crypto` bumps its range, consumers need to override the
version themselves. Add one of the following to your project's
`package.json`:

**pnpm:**

```json
{
  "pnpm": {
    "overrides": {
      "libsodium-wrappers-sumo": "^0.8.2",
      "libsodium-sumo": "^0.8.2"
    }
  }
}
```

**npm (>= 8.3):**

```json
{
  "overrides": {
    "libsodium-wrappers-sumo": "^0.8.2",
    "libsodium-sumo": "^0.8.2"
  }
}
```

Then re-install. The package's own test suite (37 tests, mocked
signer) is unaffected; this only bites at runtime when Lucid is
actually initialized.

Tracking upstream: [input-output-hk/cardano-js-sdk#1682](https://github.com/input-output-hk/cardano-js-sdk/issues/1682).
This package will bump Lucid (and drop the override note) once the
upstream fix lands.

## Smoke testing

`scripts/smoke.mjs` (not shipped in the npm tarball) exercises the full
preview-testnet path end-to-end without requiring an external resource
server. It boots a tiny inline HTTP server with one priced endpoint
(pay-to-self, 2 ADA), spawns `dist/cli.js` as a stdio subprocess,
drives `initialize` → `tools/list` → `tools/call`, submits the signed
tx via Blockfrost, and asserts the resulting `X-Payment-Response` is
real.

Run from the package root:

```bash
SEED_PHRASE="word1 ... word24" \
BLOCKFROST_KEY="previewXXXXXXXXXXXXXXXXXXXXXXXX" \
  node scripts/smoke.mjs
```

The wallet needs ~3 preview ADA (faucet:
https://docs.cardano.org/cardano-testnets/tools/faucet/). Net cost per
run is the tx fee (~0.2 ADA).

On success the script prints a `preview.cardanoscan.io` URL for the
transaction. Use this whenever cutting a release that changes the
payment loop or signer.

## Status

`0.1.2`. Security release fixing C5 (no spending limits), H10
(LAN-exposed HTTP transport), and H11 (SSRF via `catalog.server.url`).
See `CHANGELOG.md` for full notes and the linked GHSA. `0.1.1` end-to-end
proof tx (unchanged signer code path):
`2845a731c935348ba2ba620b50640c7e3553da717773c1f8456decd49fe2dab7`.
