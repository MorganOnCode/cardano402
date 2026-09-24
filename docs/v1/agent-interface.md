# Agent interface: how agents discover and call this server

cardano402 is designed so an LLM-driven agent can find a priced API and
pay for it without operator intervention. This doc lays out how.

## Discovery

An agent has two starting points:

1. **A known URL.** The agent has a URL like `https://api.example.com`
   and wants to enumerate its paid endpoints.
2. **A 402 response.** The agent already tried a request and the server
   responded `402 Payment Required`.

For case (1), the agent fetches `/.well-known/x402.json` and reads the
endpoints array. Schema:
[`schemas/well-known-x402.schema.json`](../schemas/well-known-x402.schema.json).

The same content is mirrored at:

- `/.well-known/agent-card.json` (Google A2A protocol)
- `/.well-known/ai-agent.json` (aiia.ro vendor-neutral)
- `/.well-known/mcp/server-card.json` (SEP-1649 MCP discovery)

An agent that prefers any of these conventions will find a compatible
shape.

For case (2), the agent decodes the `Payment-Required` header
(base64 JSON, matches `schemas/payment-requirements.schema.json`) and
proceeds straight to step "Build a payment".

## Payment construction

Build a Cardano transaction that pays `amount` of `asset` to `payTo`,
TTL set to `now + maxTimeoutSeconds` slots or fewer, signed by the
agent's wallet. Pick one of the transaction's inputs as the nonce
(`txHash#outputIndex`). Base64-encode the signed CBOR.

Construct the `PAYMENT-SIGNATURE` payload (schema
[`payment-signature.schema.json`](../schemas/payment-signature.schema.json)),
base64-encode it, and send the request again with both header forms:

```
Payment-Signature: <base64>
PAYMENT-SIGNATURE: <base64>
```

## Reading the response

On success the server returns `200 OK` plus both headers:

```
X-Payment-Response: <base64>
PAYMENT-RESPONSE: <base64>
```

Decode either; the schema is in
[`schemas/settlement-response.schema.json`](../schemas/settlement-response.schema.json).

## SKILL.md

The repo-root `SKILL.md` is the agent-readable instruction file. Hand
that file plus a 402 response to a fresh LLM and it should construct a
valid payment with no other context.

## MCP path

For agents talking via MCP (Claude Desktop, Cursor, Vercel AI SDK),
`packages/mcp-server/` (scaffolded; full implementation in progress)
exposes paid endpoints as MCP tools with pricing declared in the tool
annotations:

```json
{
  "price": {
    "amount": "2000000",
    "asset": "lovelace",
    "network": "cardano:preview"
  }
}
```

On invocation, the MCP server makes the HTTP call, handles the 402,
constructs the Cardano tx using a configured signer, retries with
`PAYMENT-SIGNATURE`, and returns the resource to the calling agent.

## Open posture

There is no central registry to onboard with. See
[`open-posture.md`](open-posture.md) for the registry-free commitments.
