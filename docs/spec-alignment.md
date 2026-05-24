# x402 Cardano spec alignment

This document tracks compliance against the
[x402-foundation/x402 scheme_exact_cardano.md](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_cardano.md)
spec, by section.

## Summary

cardano402 implements the **default (address-to-address) asset transfer
method end-to-end with all six spec-mandated facilitator verification
rules**, plus four additional defensive checks (CBOR validity, witness
presence, fee bounds, min UTXO).

The `script` asset transfer method is recognised at the schema level
but the runtime verifier returns a structured `method_not_implemented`
reason. Any other non-default method literal is rejected with
`method_not_supported`. The schemas in `src/sdk/methods.ts` give a
clear contract for future implementers of `script`.

## Section-by-section status

### `PaymentRequirementsResponse`

| Field                | Status                                   |
|----------------------|------------------------------------------|
| `x402Version`        | Strict literal `2` (rejects `1`).        |
| `error`              | Optional, supported.                     |
| `resource.{url,description,mimeType}` | Supported.                  |
| `accepts[].scheme: "exact"` | Strict literal.                    |
| `accepts[].network`         | Validated via CAIP-2 regex.        |
| `accepts[].amount`          | String, BigInt-safe.               |
| `accepts[].asset`           | `lovelace` or `policyId.assetNameHex`. |
| `accepts[].payTo`           | Bech32 string.                     |
| `accepts[].maxTimeoutSeconds` | Defaults 300; spec recommends 600. |
| `accepts[].extra`           | Open record; runtime branch on `assetTransferMethod`. |

### `PAYMENT-SIGNATURE` header

Both header names accepted on the wire: `Payment-Signature` and
`PAYMENT-SIGNATURE`. Payload schema `PaymentSignaturePayloadSchema` now
enforces:

- `x402Version: 2` strict
- `accepted: <PaymentAccept>`
- `payload.transaction: <base64 string>`
- `payload.nonce: <txHash>#<index>` — required when
  `chain.verification.requireNonce = true` (default)

### Facilitator verification rules

| #   | Rule                                       | cardano402 check  | Status |
|-----|--------------------------------------------|-------------------|--------|
| 1   | Network validation                         | `checkNetwork`    | Implemented |
| 2   | Recipient verification                     | `checkRecipient`  | Implemented |
| 3   | Amount verification                        | `checkAmount`     | Implemented |
| 4   | Asset verification                         | `checkAmount` + `checkTokenSupported` | Implemented (plus token registry) |
| 5   | Nonce / replay prevention                  | `checkNonce`      | Implemented (Track A1) |
| 6   | TTL / expiry                               | `checkTtl`        | Implemented |

Plus cardano402 extras (defensive, not required by spec): `checkCborValid`,
`checkWitnessPresent`, `checkMinUtxo`, `checkFee`.

`checkWitnessPresent` is a **presence pre-filter only** — it confirms the
vkey witness slot is non-empty. Cryptographic signature validation (vkey ↔
payment address, signature ↔ tx hash) happens on-chain when the Cardano
node accepts the submitted tx. The facilitator does NOT duplicate that
check; a tx with garbage witness bytes will pass the presence filter and
then be rejected by the chain (returned to the caller as
`invalid_transaction`). See `src/verify/checks.ts:checkWitnessPresent` for
the contract.

### `PAYMENT-RESPONSE` header

Both header names emitted on response: `X-Payment-Response` (canonical)
and `PAYMENT-RESPONSE` (compat). Payload schema includes
`extensions.status` with `confirmed | mempool` per spec. cardano402
defaults to `confirmed_only` mode; emit-on-mempool requires explicit
operator opt-in (`chain.verification.confirmationMode = "allow_mempool"`).

### Confirmation depth (`minConfirmations`)

Cardano's Ouroboros Praos has *probabilistic* finality. A transaction
sighted in a single block CAN be rolled back if a competing fork wins —
the probability halves with each additional block confirmation. cardano402
exposes this as an operator-tunable knob:

`chain.verification.minConfirmations` (default: **6**) gates the
`status: confirmed` emission. Settlement does not flip the dedup record
to `confirmed` until the tx is at least N blocks deep, where N is this
config. The convention is: a tx in the latest block counts as 1
confirmation, so default-6 means "5 blocks have been built on top".

Operator tradeoffs:

| Setting | Approx. wall time | Risk profile                                                    |
|---------|-------------------|-----------------------------------------------------------------|
| 1       | ~20s              | First-sighting; equivalent to pre-PR-8 behavior. Use for tests. |
| 6       | ~2 min            | Default. Commonly-cited "near-final" for Cardano.               |
| 15      | ~5 min            | Conservative; appropriate for high-value flows.                 |

The polling deadline scales with `minConfirmations`
(`max(120s, minConfirmations × 30s)`) so depth-gated polling has enough
headroom to accumulate confirmations during a momentarily-slow chain.

### `assetTransferMethod` coverage

| Method     | Schema | Verifier                          | Settlement        |
|------------|--------|-----------------------------------|-------------------|
| `default`  | Yes    | Full 11-check pipe                | Full              |
| `script`   | Yes    | Returns `method_not_implemented`  | Refuses to settle |
| any other  | n/a    | Returns `method_not_supported`    | Refuses to settle |

### Body shape compatibility

`POST /verify` and `POST /settle` accept either:

- `{x402Version, paymentPayload: <object>, paymentRequirements}` (cardano402 native)
- `{x402Version, paymentHeader: <base64-string>, paymentRequirements}` (base x402)

The internal verifier always sees the parsed object form. See
`src/verify/request-shape.ts`.

## Outstanding gaps

1. **Script method verifier.** Requires a Plutus parameter applier
   compatible with `@lucid-evolution/lucid` and a datum decoder.
2. **Strict spec-conformance test fixtures.** When upstream
   `x402-foundation/x402` ships test fixtures for the Cardano scheme,
   wire them into `tests/integration/` to lock in alignment. Until then
   we self-test against the Zod schemas plus hand-built tx fixtures.

## Header / body shape disagreements with base x402

The base x402 spec and the Cardano spec disagree on a few details
(documented in upstream issues). cardano402's posture:

- **Request header**: accept both `PAYMENT-SIGNATURE` and `X-PAYMENT`.
  Document `Payment-Signature` (cardano402 client default).
- **Response header**: emit both `X-Payment-Response` (canonical, matches
  base x402) and `PAYMENT-RESPONSE` (matches Cardano spec literal).
- **Verify body**: accept both `paymentPayload` (object) and
  `paymentHeader` (base64 string).

We will remove deprecated forms one major version after upstream
reconciles, with at least one release of overlap.
