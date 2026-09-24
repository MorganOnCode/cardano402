> Historical facilitator roadmap. The current deployment scope is a static portfolio and bounded Preview demo; see [portfolio-costs.md](portfolio-costs.md). Items below are not commitments to add hosted services.

# v2 roadmap: refunds, edge cases, upgrades

Status key: **done** = in v2 now · **next** = small, planned · **decide** =
needs an owner decision first.

## Already handled by v2

| Case | How |
|---|---|
| Handler fails after payment | Authorization flow: verify → handler → settle. A failed handler never settles, so nothing is broadcast and nothing is charged. v1 settled *before* the handler. |
| Settlement slower than one HTTP call | `settlement_pending` + one identical retry that resumes observing the same transaction (fixes v1 #132). |
| Duplicate / concurrent settle | Durable Object guard keyed by canonical tx id: broadcast at most once; retry resumes; rejection is a permanent tombstone. |
| Isolate dies between claim and broadcast record | `waitUntil` keeps the isolate alive after a client disconnect; a claim still in flight after 10 min is reported `submitted`, so it is observed, never re-broadcast. |
| Tx expires before inclusion | Terminal `exact_cardano_settlement_failed` once the validity window closes (reference behaviour). |
| Malformed / invalid tx | Full phase-1 checks before the handler runs: inputs unspent, validity interval, value conservation, fee floor from protocol params, min-UTxO from serialized size. |
| Replay of one Masumi quote | `termsDigest` bound to one transaction. |
| Hot-wallet theft | No key: provider-only facilitator. |
| Oversized bodies / floods | 64 KiB body cap; 120 req/min/IP limiter on `/verify` and `/settle`. |
| Chain provider outage visibility | `/health?deep=1` → 503 `degraded`; hourly GitHub monitor. |

## Refunds

Cardano x402 `exact` payments are final once on chain, so a refund is a new
transaction from the seller (payee) back to the payer. The facilitator never
holds funds and cannot refund by itself. Options, cheapest first:

1. **next: prevent the need.** Keep the authorization flow and document it for resource servers:
   settle only after the handler succeeded; on handler failure, drop the payload.
2. **next: refund ledger.** Record every settlement (tx id, payer, payTo,
   amount, resource, confirmations) in D1. Expose `GET /receipts/:tx` to the
   payer. A seller can mark one refund-due; an operator pays it from a cold
   wallet. No key on the Worker.
3. **decide: Masumi escrow.** `assetTransferMethod: "masumi"` locks funds in
   Masumi's `vested_pay` contract, which has refund and dispute paths. The
   seller key drives result submission and refunds, so this suits sellers who
   run their own tooling. v2 already verifies Masumi locks; it needs a seller-side
   runbook and a `validateRegistryClaim` if registered agents are accepted.
4. **decide: automatic refunds.** Needs a funded refund wallet on some
   service, i.e. a hot key again. Recommended only with a small float, a
   per-day cap, and a separate Worker from the facilitator.

## Edge cases still to cover

| Priority | Case | Plan |
|---|---|---|
| next | Rollback after 0–1 confirmations (Praos is probabilistic) | Cron Worker re-checks settlements from the last 24 h; if a tx disappears, flag it in the receipt ledger and alert. |
| next | Overpayment | `exact` rejects any amount other than the exact price, so overpaying is a verify failure, not lost funds. Make the error name the expected amount. |
| next | Payer timeout budget | Document: client timeout ≥ 2 × 75 s settle window, or accept pending + poll. |
| next | Blockfrost outage | Koios fallback for verify/submit (settles only at depth 0 without Blockfrost evidence). |
| next | Cloudflare bot challenge blocking agents | WAF skip rule for `/verify`, `/settle`, `/supported` on cardano402.com (see docs/v1/cloudflare-machine-api-waf.md). |
| next | Receipts for disputes | D1 ledger above; include `extra.status` / `extra.confirmations` evidence as returned. |
| decide | USDM pricing | Allow `$0.10`-style prices via `DEFAULT_ASSETS` (USDM on mainnet); needs payer-side asset allow-lists. |
| decide | Mempool acceptance | `acceptMempool` for low-value calls; spec strongly discourages it. Keep off. |
| upstream | Binding a tx to one resource | Open as x402-foundation/x402#3449; the resource server must key its own record by tx id meanwhile. |
| later | AXI CLI (`cardano402-axi`) | Payer `quote` / `pay` with local spend policy; blocked on the package-namespace decision. |
