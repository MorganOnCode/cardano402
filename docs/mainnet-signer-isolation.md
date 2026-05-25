# Mainnet Signer Isolation Plan

This document defines the required posture before using cardano402 as a
high-value Mainnet facilitator. The current root facilitator process uses a
local Lucid wallet loaded from `chain.facilitator.seedPhraseFile` or
`chain.facilitator.privateKeyFile`. That is safer than inline JSON secrets, but
it is still a hot-wallet design: the web process can sign if the host is
compromised.

The target posture is a separate signer boundary with policy enforcement before
any transaction can be signed.

## Current State

- Preview, Preprod, and Mainnet initialize Lucid in-process.
- Mainnet requires `MAINNET=true`.
- Mainnet rejects inline `chain.facilitator.seedPhrase` and
  `chain.facilitator.privateKey` unless an explicit unsafe override is set.
- Mainnet signing material must be loaded from restrictive files by default.
- `chain.facilitator.signerMode` is explicit and currently supports only
  `local-file`.
- `/health` exposes `policy.signer` so operators and monitors can see that the
  current signer is a hot-wallet mode.
- The MCP agent signer already has spend caps, allowlists, elicitation, and a
  persistent spend ledger.
- The root facilitator signer does not yet have an external signer boundary.

## Target Boundary

Run the HTTP facilitator and signing key in different trust domains:

- The facilitator process may verify, settle, read chain state, and serve x402
  metadata.
- A signer service or hardware-backed signer owns private keys.
- The signer accepts only typed signing requests over a local authenticated
  channel.
- The signer refuses any request that violates policy before key material is
  touched.

The signer API should be narrow:

```json
{
  "network": "cardano:mainnet",
  "intent": "facilitator-admin",
  "transactionCbor": "<base64 unsigned tx>",
  "policy": {
    "allowedOutputs": ["addr1..."],
    "maxLovelace": "10000000",
    "expiresAt": "2026-05-25T08:00:00.000Z"
  },
  "requestId": "uuid"
}
```

The response should contain only:

```json
{
  "requestId": "uuid",
  "signedTransactionCbor": "<base64 signed tx>",
  "signerAddress": "addr1..."
}
```

## Minimum Signer Policy

The signer must enforce these checks independently of the HTTP process:

1. Network equals the configured network.
2. Request has a bounded expiry and fresh request ID.
3. Transaction body hash matches the body presented for policy evaluation.
4. Outputs are restricted to an operator-managed allowlist when signing
   facilitator-owned transactions.
5. Per-request and rolling spend ceilings are enforced in signer-owned durable
   storage.
6. No request can include arbitrary metadata that changes policy semantics.
7. Every refusal and approval is logged without private key material or full
   seed/private-key contents.

For the current facilitator, most public `/verify` and `/settle` requests do
not require the facilitator to sign: clients submit already-signed payment
transactions. The signer boundary matters for any future facilitator-owned
transactions, administrative transactions, demo-wallet flows, or agent payment
automation.

## Deployment Patterns

Acceptable patterns for high-value Mainnet use:

- Hardware wallet or HSM-backed signer with operator approval for exceptional
  high-value transactions.
- Local loopback signer daemon under a separate Unix user, with a Unix-domain
  socket, strict file permissions, and allowlisted call sites.
- Remote signer on a private network segment with mutual TLS, explicit policy
  documents, replay protection, and audit logging.

Not acceptable for high-value Mainnet use:

- Inline seed phrases or private keys in `config.json`.
- Seed phrases in process environment variables.
- Signer RPC exposed on a LAN/WAN without strong authentication.
- A signer that accepts arbitrary CBOR without independently decoding and
  enforcing policy.
- Treating a Docker secret or `0600` file as equivalent to hardware or remote
  policy signing.

## Implementation Steps

1. Define a `SignerProvider` interface for root facilitator signing operations.
2. Keep the existing Lucid file-backed signer as `local-file` for Preview,
   Preprod, and low-value Mainnet deployments.
3. Add `remote-http` or `unix-socket` signer provider support.
4. Require explicit config for signer mode:
   - `local-file`
   - `remote-policy`
   - future hardware-backed modes
5. For Mainnet, log the signer mode at startup and warn when `local-file` is
   used.
6. Add an integration test signer that rejects policy violations.
7. Document operational approval and incident response around signer refusals.

## Current Recommendation

Until the remote policy signer exists, Mainnet operation should be treated as a
hot-wallet deployment. Keep only limited operational funds in the facilitator
wallet, rotate keys after suspected host compromise, keep `config.json` out of
backups unless encrypted, and prefer Preview/Preprod for public demos.
