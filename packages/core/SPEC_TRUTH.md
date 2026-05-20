# Spec truth for `@cardano402/core@0.1.0`

This document records the canonical values and shapes that `@cardano402/core` ships, and notes every place where the package deliberately differs from the in-repo `src/` schemas in `cardano402/src/verify/types.ts`, `cardano402/src/settle/types.ts`, and `cardano402/src/sdk/types.ts`. These are intentional v0.1.0 choices, not bugs.

## Canonical values

| Aspect | Value |
| --- | --- |
| Protocol version (`x402Version`) | `2` (literal) |
| Network format | CAIP-2 colon form: `cardano:preview`, `cardano:preprod`, `cardano:mainnet`. The regex `/^[a-z0-9]+:[a-z0-9]+$/` rejects `cardano-mainnet` and other hyphen forms. |
| Scheme | `'exact'` only |
| Amounts | Base-10 lovelace **string** (BigInt-safe over JSON); never a number |
| Address format | Bech32 Cardano address. `CardanoAddressSchema` enforces non-empty only in v0.1.0; tighter bech32 validation lands in v0.2.0. |
| UTXO reference (nonce) | `txHash#index` with 64 lowercase hex chars + decimal index |
| Request header (canonical) | `Payment-Signature` |
| Request header (alias) | `X-PAYMENT` (base x402 interop) |
| Response header (canonical) | `X-Payment-Response` |
| Response header (alias) | `PAYMENT-RESPONSE` (literal Cardano spec wording) |
| Header body | base64-encoded JSON of `PaymentPayloadSchema` |
| Settlement status enum | `'confirmed' \| 'mempool' \| 'failed'` (widened) |
| Nonce location (v0.1.0) | `PaymentPayload.payload.nonce`. Spec wants it on `PaymentRequirements`; promotion deferred to v0.2.0. |
| `extensions.status` requiredness | optional on success in v0.1.0; v0.2.0 will promote to required |

## Schemas exported

Composed: `PaymentRequirementsSchema`, `PaymentPayloadSchema`, `VerifyResponseSchema`, `SettleResponseSchema`, `StatusResponseSchema`, `SupportedResponseSchema`, `SupportedKindSchema`, `CardanoPayloadSchema`.

Request envelopes: `VerifyRequestSchema`, `SettleRequestSchema`, `StatusRequestSchema`.

Primitives: `NetworkSchema`, `UtxoRefSchema`, `CardanoAddressSchema`, `LovelaceAmountSchema`, `SchemeSchema`, `X402VersionSchema`, `AssetTransferMethodSchema`, `SettlementStatusSchema`, `VerifyErrorReasonSchema`.

**Not in v0.1.0:** `PaymentRequiredResponseSchema` (the 402 envelope wrapping `accepts: PaymentRequirements[]`), `PaymentAcceptSchema`, `ResourceInfoSchema`, `PaymentSignaturePayloadSchema`, `PaymentResponseHeaderSchema`. These live in `src/sdk/types.ts` today and will be consolidated and re-exported from this package in v0.2.0 once the resource-server side is migrated.

## Known divergences from `cardano402/src/`

| Field | core@0.1.0 | `src/` today | Reason / status |
| --- | --- | --- | --- |
| `SettlementStatusSchema` values | `'confirmed' \| 'mempool' \| 'failed'` | `'confirmed' \| 'mempool'` (`src/settle/types.ts:54`, `src/sdk/types.ts:116`) | Core widens per spec. `src/` widens in the follow-up PR that consolidates schemas. |
| Nonce location | `PaymentPayload.payload.nonce` (mirrors `src/`) | Same | Spec wants the nonce on `PaymentRequirements`; v0.2.0 promotes it after `src/` is consolidated. |
| `extensions.status` requiredness | optional on success | optional | v0.2.0 will require it on `success: true` settle responses. |
| `NetworkSchema` named export | yes (`z.string().regex(...)`) | regex inlined in `PaymentRequirementsSchema` (`src/verify/types.ts:61`) | Core publishes the named primitive so MCP and adapter consumers can validate one field. |
| `PaymentRequirementsSchema` vs `PaymentRequiredResponseSchema` | Only `PaymentRequirementsSchema` ships (single accept) | Both live — `PaymentRequirements` in `src/verify/types.ts`, `PaymentRequiredResponseSchema` in `src/sdk/types.ts` | Envelope ships in v0.2.0. `PaymentRequiredResponseSchema` is the 402 envelope wrapping `accepts: PaymentRequirements[]`; not the same object as `PaymentRequirements`. |
| `CardanoAddressSchema` strictness | `z.string().min(1)` | Same | v0.2.0 will add bech32 validation if achievable without a heavy dep. |
| `X-PAYMENT` alias request header constant | exported | absent | Provided for base-x402 interop; cardano402's facilitator itself only accepts `Payment-Signature` on requests. |
| `Cardano402*` error classes | exported (`Cardano402Error`, `Cardano402DecodeError`, `Cardano402ValidationError`, `Cardano402HttpError`, `Cardano402NetworkError`) | `FacilitatorClient` in `src/sdk/facilitator-client.ts` throws plain `Error` | Core ships the typed hierarchy; `src/` adopts in follow-up. |

## Header codec parity

`encodePaymentHeader(payload)` and `decodePaymentHeader(headerValue)` round-trip a `PaymentPayload` through base64-encoded JSON. The encoding is byte-compatible with what `src/sdk/payment-required.ts` and `src/sdk/payment-gate.ts` emit / consume today (`Buffer.from(JSON.stringify(x)).toString('base64')`).

`findPaymentHeader(headers)` does case-insensitive lookup across `PAYMENT_REQUEST_HEADER_NAMES = ['Payment-Signature', 'X-PAYMENT']`, accepting `Headers`, plain objects, and Node `IncomingHttpHeaders` (string or string-array values).

## FacilitatorClient API parity

The class signature mirrors `src/sdk/facilitator-client.ts` byte-for-byte in behavior:

- `new FacilitatorClient({ baseUrl, timeout?, headers?, sendRawHeader? })`
- `supported(): Promise<SupportedResponse>` — GET `/supported`
- `verify(request: VerifyRequest): Promise<VerifyResponse>` — POST `/verify`
- `settle(request: SettleRequest): Promise<SettleResponse>` — POST `/settle`
- `status(request: StatusRequest): Promise<StatusResponse>` — POST `/status`

The only behavioral difference: core throws typed `Cardano402*` errors instead of plain `Error`. The `sendRawHeader: true` path uses `encodePaymentHeader` from this package's header module instead of inlined base64 encoding.
