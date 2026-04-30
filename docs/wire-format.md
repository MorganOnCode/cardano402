# Wire format reference

This document quotes the on-the-wire shapes for every cardano402 message
exchange. Schemas are also published as JSON Schema files under
[`schemas/`](../schemas/).

## HTTP 402 response from a paid resource server

Status: `402 Payment Required`. Header `Payment-Required` carries
base64-encoded JSON. Schema:
[`payment-requirements.schema.json`](../schemas/payment-requirements.schema.json).

```json
{
  "x402Version": 2,
  "error": "PAYMENT-SIGNATURE header is required",
  "resource": {
    "url": "https://api.example.com/premium-data",
    "description": "Access to premium market data",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "cardano:mainnet",
      "amount": "10000",
      "asset": "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad.0014df105553444d",
      "payTo": "addr1...",
      "maxTimeoutSeconds": 600,
      "extra": null
    }
  ]
}
```

## Client `PAYMENT-SIGNATURE` header

Two header names are accepted on the wire (HTTP headers are
case-insensitive, but CORS allowlists differ):

- `Payment-Signature` (current cardano402 client form, kebab-case)
- `PAYMENT-SIGNATURE` (literal x402 Cardano spec form)

Decoded payload schema: [`payment-signature.schema.json`](../schemas/payment-signature.schema.json).

```json
{
  "x402Version": 2,
  "resource": { "url": "...", "description": "...", "mimeType": "..." },
  "accepted": { "scheme": "exact", "network": "cardano:mainnet", "amount": "10000", "asset": "...", "payTo": "addr1...", "maxTimeoutSeconds": 600 },
  "payload": {
    "transaction": "<base64-CBOR signed tx>",
    "nonce": "662cbf645fcd8914eb89115b83970a950493dd2fbaf39dea3b96e8cbdc132939#0"
  }
}
```

`payload.nonce` is a UTXO reference of the form `txHash#index`. Per the
x402 Cardano spec, the facilitator MUST verify:

1. The nonce is one of the transaction's inputs.
2. The referenced UTXO is unspent in the current chain state.

cardano402 enforces this by default. Disable for legacy clients with
`chain.verification.requireNonce = false` in config.

## Server `PAYMENT-RESPONSE` header (after settlement)

Two header names emitted in parallel:

- `X-Payment-Response`  (canonical, matches base x402)
- `PAYMENT-RESPONSE`    (literal x402 Cardano spec wording)

Both carry the same base64-encoded JSON. Schema:
[`settlement-response.schema.json`](../schemas/settlement-response.schema.json).

```json
{
  "success": true,
  "transaction": "2f9a7b3c...",
  "network": "cardano:mainnet",
  "extensions": { "status": "confirmed" }
}
```

`extensions.status`:

- `confirmed` — tx is in a block. Treat the resource as paid for.
- `mempool`   — tx accepted by a node but not yet in a block. Spec
  strongly discourages emitting this. cardano402 emits it only when the
  operator opts in via `chain.verification.confirmationMode = "allow_mempool"`.

## Facilitator `POST /verify` request body

Two equivalent shapes are accepted:

### cardano402 native (object form)

```json
{
  "x402Version": 2,
  "paymentPayload": { /* a PaymentSignaturePayload object */ },
  "paymentRequirements": { /* the chosen entry from accepts[] */ }
}
```

### Base x402 (string form)

```json
{
  "x402Version": 2,
  "paymentHeader": "<base64-encoded PaymentSignaturePayload JSON>",
  "paymentRequirements": { /* the chosen entry from accepts[] */ }
}
```

If both fields are present, cardano402 prefers `paymentPayload`. The
`FacilitatorClient` SDK ships with `sendRawHeader: false` by default (it
sends the object form); set `sendRawHeader: true` to interoperate with
base-x402 facilitators.

## Facilitator `POST /verify` response

Schema: see `VerifyResponseSchema` in `src/verify/types.ts`.

```json
{
  "isValid": true,
  "payer": "addr1...",
  "extensions": {
    "scheme": "exact",
    "amount": "10000",
    "payTo": "addr1...",
    "txHash": "2f9a7b3c..."
  }
}
```

Failure shape:

```json
{
  "isValid": false,
  "invalidReason": "nonce_required",
  "invalidMessage": "payload.nonce is required by the x402 Cardano scheme",
  "extensions": { "errors": ["nonce_required"] }
}
```

## Facilitator `POST /settle` request and response

Same body shapes as `/verify`. Response schema:
[`settlement-response.schema.json`](../schemas/settlement-response.schema.json).

## `GET /supported`

Schema: [`supported.schema.json`](../schemas/supported.schema.json).

```json
{
  "kinds": [
    { "x402Version": 2, "scheme": "exact", "network": "cardano:mainnet" }
  ],
  "extensions": [],
  "signers": {
    "cardano:*": ["addr1..."]
  }
}
```

`kinds` is a strict-superset match for base-x402 readers. `extensions`
and `signers` are cardano402 supersets.

## `/.well-known/` discovery

Schema for `/.well-known/x402.json`:
[`well-known-x402.schema.json`](../schemas/well-known-x402.schema.json).

In addition, the server emits compatible shapes at:

- `GET /.well-known/agent-card.json` (Google A2A protocol)
- `GET /.well-known/ai-agent.json` (aiia.ro)
- `GET /.well-known/mcp/server-card.json` (SEP-1649)

All four are generated from the same `ServiceCatalog` (see
`src/catalog.ts`).
