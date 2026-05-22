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

## Status

`0.1.0-alpha.0`. The wire-format pieces are stable and shared with
`@cardano402/core`; the public surface of this package (CLI flags,
`startCardano402Mcp` signature) may still shift before `0.1.0`.
