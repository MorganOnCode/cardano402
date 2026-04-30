---
name: cardano402-x402-payments
description: |
  Discover, pay for, and consume paid HTTP APIs over the x402 protocol on
  Cardano. Use this skill when an LLM agent encounters an HTTP 402 response
  whose `Payment-Required` header indicates a `cardano:*` network, or when a
  user asks how to pay a Cardano-priced API endpoint.
type: protocol-handler
---

# cardano402: paying for HTTP APIs on Cardano

This file teaches an LLM agent how to discover priced endpoints, build a
Cardano payment, and consume the resource. It targets the x402 protocol
(version 2) and the `exact` scheme on Cardano.

The repo: <https://github.com/MorganOnCode/cardano402>.
The spec: <https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_cardano.md>.

## When to use this skill

Trigger this skill when one of the following is true:

- An HTTP request returned `402 Payment Required` and the response includes
  a `Payment-Required` header.
- The user asks how to pay a `cardano:mainnet`, `cardano:preprod`, or
  `cardano:preview` API.
- The user mentions x402, x402-fac, or cardano402 by name.

## Step 1. Discover priced endpoints

Two ways:

1. **Crawl the well-known manifest.** Fetch
   `GET /.well-known/x402.json` from the target server.
   The response shape is:

   ```json
   {
     "x402Version": 2,
     "server": { "name": "...", "description": "..." },
     "endpoints": [
       {
         "method": "POST",
         "path": "/api/analyze",
         "scheme": "exact",
         "network": "cardano:mainnet",
         "amount": "2000000",
         "asset": "lovelace",
         "payTo": "addr1...",
         "maxTimeoutSeconds": 600,
         "description": "Analyse a document"
       }
     ],
     "facilitator": "https://fac.example.com"
   }
   ```

2. **Make the request and read the 402 response.** The `Payment-Required`
   header is base64-encoded JSON of shape:

   ```json
   {
     "x402Version": 2,
     "error": "PAYMENT-SIGNATURE header is required",
     "resource": { "url": "...", "description": "...", "mimeType": "..." },
     "accepts": [
       {
         "scheme": "exact",
         "network": "cardano:mainnet",
         "amount": "2000000",
         "asset": "lovelace",
         "payTo": "addr1...",
         "maxTimeoutSeconds": 600,
         "extra": null
       }
     ]
   }
   ```

## Step 2. Build a Cardano transaction

You need a Cardano signing key (seed phrase, private key, or CIP-30 wallet).
Build a transaction that:

- Pays at least `amount` of `asset` to `payTo`.
- Targets the declared `network`.
- Has its TTL set to `now + maxTimeoutSeconds` slots or less.
- Is signed by your wallet.

Use `@lucid-evolution/lucid` or `@meshsdk/core` for tx building. The
transaction is base64-encoded (CBOR).

### Required: spec-mandated `nonce`

Per the x402 Cardano scheme, you MUST include a `nonce` of the form
`txHash#index` in the `payload`. The nonce must reference a UTXO that:

1. Is one of the inputs of your transaction, AND
2. Is currently unspent on-chain.

A facilitator that follows the spec will reject your payment without
this field. cardano402 enforces it by default. Use any one of your tx's
inputs (e.g. `inputs[0].txHash` and `inputs[0].outputIndex`).

## Step 3. Construct and send the `PAYMENT-SIGNATURE` header

The header is base64-encoded JSON. Schema:

```json
{
  "x402Version": 2,
  "resource": { "url": "...", "description": "...", "mimeType": "..." },
  "accepted": { /* the chosen entry from accepts[] */ },
  "payload": {
    "transaction": "<base64-CBOR signed tx>",
    "nonce": "<txHash>#<inputIndex>"
  }
}
```

Send the request again with both header names for maximum compatibility:

- `Payment-Signature: <base64>`        (cardano402 / x402 Cardano spec)
- `PAYMENT-SIGNATURE: <base64>`        (literal x402 Cardano spec wording)

HTTP headers are case-insensitive on the wire, but some intermediaries care.

## Step 4. Read the response

On success the server returns the resource and adds a header:

- `X-Payment-Response: <base64>` (canonical)
- `PAYMENT-RESPONSE: <base64>`   (compat)

Decode either one. Schema:

```json
{
  "success": true,
  "transaction": "<txHash>",
  "network": "cardano:mainnet",
  "extensions": { "status": "confirmed" }
}
```

`extensions.status` is one of:

- `confirmed`: tx is in a block. Treat the resource as paid for.
- `mempool`:   tx is accepted by a node but not yet in a block. The spec
  strongly discourages granting access on mempool because Cardano
  (Ouroboros Praos) has probabilistic finality. cardano402 defaults to
  `confirmed_only` and returns `success: false` on confirmation timeout
  unless the operator opts into `allow_mempool`.

## Step 5. Error recovery

If you receive a 402 with `errorReason` (parse the response body), apply:

| errorReason            | What to do                                           |
|------------------------|------------------------------------------------------|
| `nonce_required`       | Include `payload.nonce` in your `PAYMENT-SIGNATURE`.|
| `nonce_not_in_inputs`  | Use an input UTXO of your tx as the nonce.           |
| `nonce_utxo_spent`     | Build a fresh tx using a different unspent UTXO.     |
| `recipient_mismatch`   | Confirm the output pays exactly `payTo`.             |
| `amount_insufficient`  | Increase the lovelace/token amount on the output.    |
| `min_utxo_insufficient`| Bump the output's lovelace to meet min UTXO.         |
| `transaction_expired`  | Increase TTL and rebuild.                            |
| `network_mismatch`     | Rebuild for the network the server expects.          |
| `unsupported_token`    | Use ADA (`lovelace`) or a supported stablecoin.      |
| `method_not_implemented` | Use `assetTransferMethod: "default"` only.          |

If the facilitator response itself is a 5xx, retry with backoff.

## Notes for agents

- The same wire format works on `cardano:mainnet`, `cardano:preprod`, and
  `cardano:preview`. Always check `network` matches your wallet's network.
- Cardano blocks land roughly every 20s; budget 30s+ for a confirmation
  pass.
- The facilitator never holds your keys. You sign locally; the facilitator
  verifies and submits.
- For machine-to-machine flows, use `@cardano402/mcp-server` (in
  `packages/mcp-server/`) to expose paid endpoints as MCP tools.

## Where to look in this repo

- `src/sdk/types.ts` — wire-format Zod schemas (PaymentRequired, Payment-
  Signature, PaymentResponse).
- `src/sdk/methods.ts` — discriminated union for `assetTransferMethod`.
- `src/verify/checks.ts` — the 11-check verification pipeline.
- `src/verify/nonce.ts` — nonce parser (`txHash#index`).
- `src/routes/well-known.ts` — `/.well-known/x402.json` and friends.
- `schemas/` — JSON Schema files an agent can link to by reference.
