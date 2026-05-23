# Cardano x402: High-Value Payment Operations

## The x402 Protocol

x402 is an HTTP-native payment protocol built on HTTP 402 Payment Required. It enables machine-to-machine payments where services are paid for per-request -- no subscriptions, no API keys, no billing accounts.

The protocol is chain-agnostic. Different blockchains serve different price tiers, and clients pay in whichever token the resource server accepts. This facilitator implements x402 for Cardano.

## Why Cardano?

### High-Value Operations (>= 1 ADA)

Cardano's minimum UTXO requirement (~1 ADA, approximately $0.30) makes it naturally suited for operations that are worth paying for individually:

- **AI agent tasks** -- inference, training runs, tool invocations
- **Document processing** -- analysis, extraction, transformation
- **File storage and retrieval** -- content-addressed uploads via payment gate
- **Compute-on-demand** -- GPU time, batch processing, simulations
- **Data API access** -- premium datasets, real-time feeds, analytics

This is not a limitation -- it is market positioning. Operations below ~$0.30 belong on EVM L2s where transaction costs are negligible. Cardano x402 targets the high-value tier where each request represents meaningful compute, storage, or data value.

### EUTXO Model

Cardano's Extended UTXO model provides properties that are particularly valuable for payment facilitation:

- **Inherent replay protection** -- each UTXO can only be spent once. No nonce tracking, no sequence numbers, no double-spend risk at the application layer.
- **Deterministic fees** -- transaction fees are calculated before submission. No gas estimation, no failed transactions burning fees, no frontrunning.
- **Parallel processing** -- transactions consuming different UTXOs are independent and can be processed concurrently.
- **No MEV** -- Cardano's deterministic execution model eliminates miner/validator extractable value. The transaction you build is the transaction that executes.

### Native Multi-Asset

Cardano supports multiple tokens at the protocol level, without smart contracts:

- **ADA** -- native token, minimum ~1 ADA per UTXO
- **Stablecoins** -- USDM, DJED, iUSD (hardcoded registry as security gate)
- **Custom tokens** -- any Cardano native asset identified by policy ID

Unlike ERC-20 tokens on Ethereum, Cardano native assets do not require a separate `approve` transaction before transfer. A single transaction can carry ADA and multiple tokens simultaneously.

### Transaction-Based Verification

This facilitator uses transaction-based verification rather than signature-based schemes (COSE/CIP-8):

1. The client builds and signs a complete Cardano transaction
2. The facilitator deserializes the CBOR and runs a 10-check verification pipeline
3. Checks cover: CBOR validity, payment scheme, network, token support, recipient, amount, minimum UTXO, witness signature, TTL, and fee bounds
4. The same verified transaction is submitted for settlement -- no second signing step

This approach is simpler and more secure than message-signing schemes because the payment instrument (the transaction) is also the settlement instrument.

## Complementing EVM L2 Micropayments

The x402 ecosystem spans multiple chains at different price tiers:

| Chain | Price Tier | Use Cases | Settlement |
|-------|-----------|-----------|------------|
| Base, Optimism | Sub-cent (< $0.01) | Per-token LLM inference, API calls | ~2s |
| Ethereum L2s | Cents ($0.01 -- $0.30) | Image generation, search queries | ~2-10s |
| **Cardano** | **$0.30+ (>= 1 ADA)** | **AI tasks, compute, file storage** | **~20s** |

These are complementary, not competing. A resource server can support multiple chains simultaneously:

- **Cheap operations** gated by Base or Optimism (via Coinbase x402 facilitator)
- **High-value operations** gated by Cardano (via this facilitator)

The same HTTP 402 flow works regardless of chain. The client reads the `X-PAYMENT` header, sees what chain and amount are required, and pays accordingly.

## Supported Tokens

The facilitator maintains a hardcoded token registry as a security gate. Adding a new token requires a code change and review -- this prevents on-chain metadata spoofing attacks.

| Token | Type | Unit |
|-------|------|------|
| ADA | Native | `lovelace` |
| USDM | Stablecoin | Policy ID + asset name |
| DJED | Stablecoin | Policy ID + asset name |
| iUSD | Stablecoin | Policy ID + asset name |

Overpayment is accepted (>=) for both ADA and tokens. Exact-match would reject legitimate transactions due to UTXO composition constraints.

## Architecture

The facilitator is a Fastify HTTP server with:

- **Verification pipeline** -- 10 checks, collect-all-errors pattern
- **Settlement engine** -- dedup via SHA-256 + Redis, Blockfrost submission, confirmation polling
- **UTXO management** -- two-layer cache (in-memory + Redis)
- **Payment gate middleware** -- SDK for resource servers to gate endpoints behind x402 payments

For detailed architecture diagrams, see [Architecture](architecture.md).

## Getting Started

See the [Deployment Guide](deployment.md) to run the facilitator on testnet or in production.
