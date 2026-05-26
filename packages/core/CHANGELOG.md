# Changelog

All notable changes to `@cardano402/core` are documented here.

## 0.2.0 — 402 envelope (client-side schemas)

Minor release promoting the four 402-envelope schemas from
`cardano402/src/sdk/types.ts` into this package. Unblocks the
`@cardano402/mcp-server` package and any third-party x402 client that
needs to parse a `402 Payment Required` response without depending on
the facilitator codebase. No breaking changes for `0.1.x` consumers.

### Added

- **`PaymentAcceptSchema`** — one accept option in a 402 envelope.
  Fields: `scheme` (default `'exact'`), `network`, `amount`, `payTo`,
  `maxTimeoutSeconds` (default `300`), `asset` (default `'lovelace'`),
  `extra` (default `null`). `network` / `amount` / `payTo` stay loose
  `z.string()` to match existing facilitator emissions; `asset` is
  validated by `AssetIdentifierSchema`.
- **`AssetIdentifierSchema`** — accepts `lovelace` or lowercase
  `policyId.assetNameHex` native asset identifiers. Used by
  `PaymentRequirementsSchema` and the `asset` field on 402 accept
  options so malformed asset strings fail before quote, verification,
  settlement, or signer paths consume them.
- **`ResourceInfoSchema`** — resource metadata in a 402 envelope.
  Fields: `description`, `mimeType` (default `'application/json'`),
  `url`.
- **`PaymentRequiredResponseSchema`** — the full 402 envelope.
  `{ x402Version: 2, error, resource, accepts: PaymentAccept[] }`.
- **`PaymentSignaturePayloadSchema`** — SDK request wrapper combining
  `accepted`, `payload`, and `resource`. Useful for tools that POST a
  signed payload back to a resource server.

All four schemas + inferred types (`PaymentAccept`, `ResourceInfo`,
`PaymentRequiredResponse`, `PaymentSignaturePayload`) are exported
from the package root.

### Fixed

- **Stale `VERSION` constant.** `src/index.ts` exported
  `VERSION = '0.1.0'` even after the `0.1.1` publish (a documentation
  bug — npm `0.1.1` consumers saw the wrong constant). Now reads
  `'0.2.0'` and will be kept in sync with `package.json` going
  forward.

### Tests

- 8 new tests in `test/schemas.test.ts` covering defaults, missing
  required fields, `x402Version: 2` literal enforcement, JSON
  round-trips, and a property-based round-trip for
  `PaymentRequiredResponseSchema`. Total tests: 68 (was 60).

### Migration

`0.1.x` consumers can upgrade with no code changes. New schemas are
additive. Resource-server code in `cardano402/src/` continues to use
its locally-defined copies; the consolidation PR (planned separately)
will swap those imports.

## 0.1.1 — security hardening

Patch release closing four audit findings raised against `0.1.0`. No
behavior changes on the happy path; no schema renames. All `0.1.0`
consumers can upgrade without code changes.

### Fixed

- **Slow-body hang in `FacilitatorClient` (audit A1, High).** The
  abort timer is now cleared in a `finally` block that wraps the entire
  request — including response body reads. A facilitator that returns
  headers immediately but stalls the body indefinitely now aborts at
  the configured `timeout`, mapped to `Cardano402NetworkError` with a
  message naming the phase (`'while reading response body'` or
  `'while reading error body'`).
- **`constructor` / `prototype` keys leaking from `decodePaymentHeader`
  (audit A2, Medium).** Added a JSON.parse reviver in
  `packages/core/src/header.ts` that strips `__proto__`, `constructor`,
  and `prototype` keys at every depth. Defends downstream code that
  uses `Object.assign(target, payload)` or similar against prototype-
  pollution patterns. Zod 4 already neutralizes `__proto__` via its
  passthrough copy semantics; the reviver hardens against
  `constructor`/`prototype` and against future Zod behavior changes.
- **Stricter `CardanoAddressSchema` (audit A5, Medium).** Tightened
  from `z.string().min(1)` to printable ASCII (`^[\x21-\x7e]+$`) with
  a 200-char ceiling. Blocks CRLF, NUL, TAB, DEL, spaces, and other
  control characters that would otherwise survive into HTTP response
  headers, Redis keys, and log lines. Real Cardano bech32 addresses
  fit comfortably; bech32 charset validation (`[a-z0-9]` only) is
  still tracked for `0.2.0`.

### Added

- **`allowInsecure` option on `FacilitatorClient` (audit A3, Medium).**
  When `baseUrl` is non-HTTPS and non-loopback, the constructor now
  emits a single `console.warn` warning that payment payloads will
  traverse the network in cleartext. Pass `{ allowInsecure: true }`
  to suppress the warning. Default is `false`. Will become a thrown
  error in `0.2.0`.

### Tests

- 16 new tests across `test/client.test.ts`, `test/header.test.ts`,
  `test/schemas.test.ts`, including property-based tests via
  `fast-check` for the encode/decode round-trip and the address
  regex. Total tests: 60 (was 44).
- Each remediation was mutation-checked: temporarily reverting the
  fix causes the corresponding new test(s) to fail.

## 0.1.0 — initial release

See PR #53 / commit `433e23e`.
