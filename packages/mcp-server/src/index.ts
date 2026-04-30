// @cardano402/mcp-server — MCP server that exposes paid HTTP endpoints as
// MCP tools, paying via the x402 Cardano scheme.
//
// Scaffold only. Final shape (planned):
//
//   import { startCardano402Mcp } from "@cardano402/mcp-server";
//   await startCardano402Mcp({
//     catalogUrl: "https://api.example.com/.well-known/x402.json",
//     signer: { type: "lucid", seedPhrase: process.env.SEED_PHRASE! },
//     transport: "stdio", // or "http"
//   });
//
// On invocation of any priced tool:
//   1. Make the HTTP call.
//   2. Read the 402 response, decode Payment-Required.
//   3. Build and sign a Cardano tx via the configured signer.
//   4. Retry with PAYMENT-SIGNATURE.
//   5. Return the resource (and the PAYMENT-RESPONSE metadata) to the agent.
//
// Transports:
//   - stdio: for desktop MCP clients (Claude Desktop, Cursor)
//   - http+streaming: for remote MCP clients per the x402 roadmap

export const STATUS = 'scaffold' as const;

export function startCardano402Mcp(): never {
  throw new Error(
    '@cardano402/mcp-server is scaffolding only. Implementation tracking: cardano402-upgrade-plan.md Track D2.'
  );
}
