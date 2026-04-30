# @cardano402/core

Framework-agnostic types, schemas, and clients for the cardano402 SDK
family. Currently a scaffold; track progress in
[`cardano402-upgrade-plan.md`](../../cardano402-upgrade-plan.md) Track D3.

Intended surface:

- Re-export every wire-format Zod schema (PaymentRequirements,
  PaymentSignaturePayload, SettleResponse, Supported, well-known x402).
- `FacilitatorClient` (fetch-based, no Node-only deps).
- `x402Client` that handles 402 retries given a `WalletSigner` interface.
- `WalletSigner` types (Lucid-backed, CIP-30, BYO function).
