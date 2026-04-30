# @cardano402/mcp-server

An MCP server that exposes paid HTTP endpoints as MCP tools, paying via
the x402 Cardano scheme.

Status: scaffold. See
[`cardano402-upgrade-plan.md` Track D2](../../cardano402-upgrade-plan.md)
for the full spec.

Planned CLI:

```bash
npx @cardano402/mcp-server --catalog https://api.example.com/.well-known/x402.json
```

Planned MCP client config (Claude Desktop / Cursor):

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
      ]
    }
  }
}
```

Two transports planned:

- `stdio` for local desktop MCP clients
- `http+streaming` for remote MCP (per the x402 roadmap)
