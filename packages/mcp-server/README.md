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

| Flag                  | Default   | Notes                                                          |
|-----------------------|-----------|----------------------------------------------------------------|
| `--catalog <url>`     | required  | Or set `CARDANO402_CATALOG_URL`                                |
| `--transport <name>`  | `stdio`   | `stdio` for local clients, `http` for Streamable HTTP          |
| `--port <n>`          | `3333`    | Only used when `--transport http`                              |
| `--network <name>`    | `Preview` | `Preview`, `Preprod`, or `Mainnet`                             |
| `-h`, `--help`        |           | Print usage                                                    |

Environment:

| Variable                       | Notes                                                                   |
|--------------------------------|-------------------------------------------------------------------------|
| `SEED_PHRASE`                  | 24-word seed phrase for the wallet that will fund payments (required)   |
| `BLOCKFROST_KEY`               | Blockfrost project ID for the chosen network (required)                 |
| `CARDANO402_CATALOG_URL`       | Alternative to `--catalog`                                              |
| `CARDANO402_NETWORK`           | Alternative to `--network`                                              |
| `CARDANO402_ALLOW_INSECURE`    | `true` to permit non-HTTPS catalog URLs (default off)                   |
| `MAINNET`                      | `true` is required to opt into a `Mainnet` connection                   |

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

See the cardano402 root [`SECURITY.md`](../../SECURITY.md) for the
disclosure channel.

## Known issues / consumer-side overrides

### `libsodium-wrappers-sumo` transitive resolution

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

`0.1.0`. End-to-end verified against Cardano Preview testnet on
2026-05-23 (tx `2845a731c935348ba2ba620b50640c7e3553da717773c1f8456decd49fe2dab7`).
See `CHANGELOG.md` for the proof and `scripts/smoke.mjs` for the
repeatable harness.
