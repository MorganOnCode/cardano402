#!/usr/bin/env node
// CLI entry for @cardano402/mcp-server (scaffold).
//
// Planned usage:
//   npx @cardano402/mcp-server --catalog https://api.example.com/.well-known/x402.json
//
// And in a Claude Desktop / Cursor MCP client config:
//   {
//     "mcpServers": {
//       "example-api": {
//         "command": "npx",
//         "args": ["-y", "@cardano402/mcp-server", "--catalog",
//                  "https://api.example.com/.well-known/x402.json"]
//       }
//     }
//   }

console.error(
  '@cardano402/mcp-server is scaffolding only. See packages/mcp-server/README.md.'
);
process.exit(1);
