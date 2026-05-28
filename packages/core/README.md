# @cardano402/core

Schemas, types, header codec, and `FacilitatorClient` for [x402](https://github.com/x402-foundation/x402) payments on Cardano.

Zero runtime dependencies except [zod](https://zod.dev). ESM + CJS, Node 20+.

```sh
pnpm add @cardano402/core
# or
npm install @cardano402/core
```

## What's in the box

- **Wire-format Zod schemas** for the x402 V2 Cardano scheme: `PaymentRequirementsSchema`, `PaymentPayloadSchema`, `VerifyResponseSchema`, `SettleResponseSchema`, `StatusResponseSchema`, `SupportedResponseSchema`, plus primitives (`NetworkSchema`, `LovelaceAmountSchema`, `AssetIdentifierSchema`, `UtxoRefSchema`, ...).
- **Header codec**: `encodePaymentHeader` / `decodePaymentHeader` for the base64-of-JSON body carried in `Payment-Signature` / `X-PAYMENT` / `X-Payment-Response` headers, plus `findPaymentHeader` for case-insensitive lookup.
- **`FacilitatorClient`**: a tiny HTTP wrapper for cardano402's `/verify`, `/settle`, `/status`, and `/supported` endpoints. Native `fetch`, AbortController timeout, Zod-validated responses.
- **Structured errors**: `Cardano402Error`, `Cardano402DecodeError`, `Cardano402ValidationError`, `Cardano402HttpError`, `Cardano402NetworkError`.

## Quickstart

```ts
import {
  FacilitatorClient,
  encodePaymentHeader,
  decodePaymentHeader,
  type PaymentPayload,
} from '@cardano402/core';

const client = new FacilitatorClient({
  baseUrl: 'https://facilitator.example.com',
  timeout: 10_000,
});

const supported = await client.supported();

const payload: PaymentPayload = {
  x402Version: 2,
  accepted: {
    scheme: 'exact',
    network: 'cardano:preview',
    asset: 'lovelace',
    amount: '2000000',
    payTo: 'addr_test1...',
    maxTimeoutSeconds: 300,
  },
  payload: { transaction: '<base64 signed CBOR>' },
};

const headerValue = encodePaymentHeader(payload);
const roundTripped = decodePaymentHeader(headerValue);
```

## Header constants

| Constant | Value |
| --- | --- |
| `PAYMENT_REQUEST_HEADER` | `Payment-Signature` |
| `PAYMENT_REQUEST_HEADER_ALIAS` | `X-PAYMENT` |
| `PAYMENT_REQUEST_HEADER_NAMES` | `['Payment-Signature', 'X-PAYMENT']` |
| `PAYMENT_REQUIRED_HEADER` | `Payment-Required` |
| `PAYMENT_RESPONSE_HEADER` | `X-Payment-Response` |
| `PAYMENT_RESPONSE_HEADER_ALIAS` | `PAYMENT-RESPONSE` |
| `PAYMENT_RESPONSE_HEADER_NAMES` | `['X-Payment-Response', 'PAYMENT-RESPONSE']` |

HTTP header matching on the wire is case-insensitive.

## Errors

| Class | Thrown when |
| --- | --- |
| `Cardano402Error` | Base class for all errors thrown by this package |
| `Cardano402DecodeError` | Base64 or JSON decoding failed |
| `Cardano402ValidationError` | A decoded value did not match the expected Zod schema (carries `.issues`) |
| `Cardano402HttpError` | Facilitator returned a non-2xx (carries `.status`, `.statusText`, `.body`) |
| `Cardano402NetworkError` | Fetch failed, timed out, or aborted |

## Spec details

See [SPEC_TRUTH.md](./SPEC_TRUTH.md) for canonical values (CAIP-2 network format, scheme, header names, settlement status enum) and the list of known divergences from `cardano402/src/` while v0.1.0 is in transition.

## License

Apache-2.0. Part of the [cardano402](https://github.com/MorganOnCode/cardano402) project.
