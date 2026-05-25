# Security review status - 2026-05-25

Scope: local tree at `/opt/cardano402`, GitHub repository
`MorganOnCode/cardano402`, live host `https://cardano402.com`, and current
x402 specification material:

- https://github.com/x402-foundation/x402
- https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_cardano.md

This is a progress report, not a final certification. The system is closer to a
money-safe posture after the changes below, but public production use should
still wait for the open items in this document.

## What the system does

cardano402 is an open-source x402 facilitator and resource-server SDK for
Cardano payments. It supports:

- Resource servers returning HTTP 402 with `Payment-Required`.
- Clients retrying with a base64 JSON payment payload in `Payment-Signature`
  or the base x402 `X-PAYMENT` alias.
- Facilitator `/verify` validating a signed Cardano transaction against
  server-supplied payment requirements.
- Facilitator `/settle` submitting the transaction and waiting for the
  configured confirmation policy.
- Resource-server middleware that settles before protected route execution.
- An MCP server that lets agents call x402-priced endpoints using a local
  signing wallet and configurable spend controls.

The hosted `cardano402.com` instance is a convenience endpoint. The trust model
remains installer-operated and registry-free: users can run their own
facilitator and resource servers.

## x402 spec alignment

The current implementation aligns with the base x402 flow: 402 challenge,
payment payload retry, facilitator verification, settlement, then
`PAYMENT-RESPONSE`/`X-Payment-Response` on success.

Cardano `exact` default address-to-address support is implemented end-to-end:

| Spec requirement | Local implementation | Status |
| --- | --- | --- |
| `x402Version: 2` | Strict Zod literals across core, SDK, routes, MCP | Implemented |
| `scheme: "exact"` | `checkScheme` plus schemas | Implemented |
| Network validation | CAIP-2 chain match and tx network id check | Implemented |
| Recipient verification | Address canonicalization and matching output scan | Implemented |
| Amount verification | BigInt checks for lovelace and native assets | Implemented |
| Asset verification | Exact asset unit matching plus token registry | Implemented |
| Nonce / replay prevention | `payload.nonce` must match an input and be unspent | Implemented by default |
| TTL not expired | `checkTtl` rejects expired TTL | Implemented |
| Settlement status | Confirmed-only default, mempool requires opt-in | Implemented |

Additional defenses beyond the spec:

- CBOR parse validation before all transaction checks.
- Witness presence pre-filter before settlement.
- Fee bounds.
- Min-UTXO ADA check.
- Hardcoded token registry to avoid metadata spoofing.
- Public trust-contract docs warning resource servers not to echo
  client-supplied `paymentRequirements`.

Non-default asset transfer methods:

- `script`: schema-recognized, verification/settlement intentionally fail with
  `method_not_implemented` until a real Plutus verifier exists.
- Unknown methods: rejected with `method_not_supported`.
- A protected third-party smart-contract method named in the upstream spec is
  intentionally not copied or implemented here.

## Findings fixed in this worktree

### F1 - MCP Mainnet hot seed handling

Previous risk: Mainnet signing could rely on `SEED_PHRASE`, which exposes hot
wallet material through process environments, shell history, crash dumps, and
process inspection.

Change:

- Added `SEED_PHRASE_FILE` / `--seed-phrase-file`.
- Rejects non-regular, empty, group-readable, or world-readable seed files on
  POSIX.
- Mainnet rejects env seed material unless
  `CARDANO402_ALLOW_MAINNET_SEED_PHRASE_ENV=true` is explicitly set.

Evidence:

- `packages/mcp-server/src/config.ts`
- `packages/mcp-server/test/config.test.ts`

### F2 - MCP spend caps reset on restart

Previous risk: agent spend limits were process-local. Restarting the MCP server
reset the daily budget, which is unacceptable for money-handling agents.

Change:

- Added `CARDANO402_SPEND_STORE_PATH` / `--spend-store-path`.
- Mainnet requires a persistent spend store.
- Ledger writes use a temp file and rename.

Evidence:

- `packages/mcp-server/src/spend-tracker.ts`
- `packages/mcp-server/src/server.ts`
- `packages/mcp-server/test/spend-tracker.test.ts`

### F3 - MCP spend race while signing

Previous risk: two MCP processes sharing the same store could check the cap
before either wrote a spend, allowing over-budget concurrent signatures.

Change:

- Added pending spend reservations.
- Pending reservations count against the rolling cap.
- Reservations commit after successful signing and roll back on signer failure.
- Persistent ledger operations are guarded by an atomic lock directory.
- Lock acquisition fails closed after a timeout.

Evidence:

- `packages/mcp-server/src/spend-tracker.ts`
- `packages/mcp-server/src/payment.ts`
- `packages/mcp-server/test/spend-tracker.test.ts`

### F3a - MCP spend ledger operational recovery gaps

Previous risk: fail-closed ledger handling protected funds, but a stale lock
or corrupt active ledger could halt the signing wallet until manual operator
repair.

Change:

- Persistent spend-ledger locks now write a holder PID. If the holder process
  is no longer alive, the next signer can remove the stale lock and continue.
  Active or unknown locks still fail closed after the timeout.
- Successful ledger persists now maintain a `.bak` copy of the last valid
  ledger. If the active ledger is malformed or has invalid entries, the
  tracker restores the valid backup and quarantines the corrupt active file as
  `.corrupt.<timestamp>.<pid>`.
- If no valid backup exists, the tracker still fails closed instead of starting
  with an empty ledger and silently resetting daily spend history.

Evidence:

- `packages/mcp-server/src/spend-tracker.ts`
- `packages/mcp-server/test/spend-tracker.test.ts`

### F3b - MCP elicitation happened before spend-policy rejection

Previous risk: agents could be asked to approve a payment that would then be
rejected by the spend cap or pay-to allowlist. This was not a fund-loss bug,
but it created noisy prompts and confused operator decisions.

Change:

- `payAndFetch` now calls `spendTracker.assertCanSpend(...)` before
  elicitation.
- The later `reserve(...)` remains after elicitation and still rechecks
  atomically before signing, so concurrent spend protection is preserved.

Evidence:

- `packages/mcp-server/src/payment.ts`
- `packages/mcp-server/test/payment-guards.test.ts`

### F4 - SDK payment gate missed base x402 request-header alias

Previous risk: the core header codec supported both `Payment-Signature` and
`X-PAYMENT`, but the Fastify payment gate only read `Payment-Signature`.
Alias-only clients would be rejected despite documented compatibility.

Change:

- `createPaymentGate` now accepts either `payment-signature` or `x-payment`.
- Added unit and Fastify request-level regression tests.

Evidence:

- `src/sdk/payment-gate.ts`
- `tests/unit/sdk/payment-gate.test.ts`
- `src/server.ts`

### F6 - Payment-specific invariants were not CI-enforced

Previous risk: several money-handling invariants were documented and tested in
specific places, but there was no small CI gate for the exact anti-patterns
that would reintroduce past bugs.

Change:

- Added `pnpm security:payments`.
- The check fails if:
  - `createPaymentGate` stops accepting `X-PAYMENT`.
  - CORS stops allowing `X-PAYMENT`.
  - SDK tests stop covering alias acceptance.
  - source code appears to derive `paymentRequirements` from request/client
    data.
  - the payment gate trusts `payload.accepted` for server-owned requirement
    fields.
  - MCP public examples encourage hot seed material from `process.env`.
- CI security job now runs the payment invariant check after dependency audit.

Evidence:

- `scripts/payment-security-check.mjs`
- `package.json`
- `.github/workflows/ci.yml`

### F6a - Payment gate forwarded client-owned network in verify payload

Previous risk: `createPaymentGate` correctly derived `paymentRequirements`
from server-side options, but the nested `paymentPayload.accepted.network`
sent to `/verify` still copied `payload.accepted.network` from the inbound
payment header. Verification ultimately uses server-owned
`paymentRequirements.network`, but forwarding attacker-controlled network
metadata is a trust-boundary inconsistency and could confuse downstream
logging, policy, or future facilitator logic.

Change:

- `createPaymentGate` now builds `paymentPayload.accepted.network` from
  `PaymentGateOptions.network`.
- The payment invariant check now fails on any
  `payload.accepted.network` forwarding in the gate.
- Added a regression test with a spoofed client `accepted` object.

Evidence:

- `src/sdk/payment-gate.ts`
- `scripts/payment-security-check.mjs`
- `tests/unit/sdk/payment-gate.test.ts`

### F6b - `/settle` malformed-request responses used an invalid network value

Previous risk: malformed `/settle` requests returned `network: ""`. That does
not satisfy the CAIP-2 network shape used by the settlement response schema and
does not match the Cardano x402 response examples, which keep the network in
the response envelope even when reporting failure.

Change:

- `/settle` now derives the configured CAIP-2 network before request-envelope
  validation.
- Malformed-envelope and malformed-payment responses now return that configured
  network instead of an empty string.
- Integration tests assert the malformed-request response carries
  `cardano:preview` under the test configuration.

Evidence:

- `src/routes/settle.ts`
- `tests/integration/settle-route.test.ts`

### F7 - Root facilitator config allowed inline Mainnet signing keys

Previous risk: the hosted/resource-server facilitator config accepted inline
`chain.facilitator.seedPhrase` or `chain.facilitator.privateKey` values in
`config.json`. That keeps hot signing material in ordinary config files and
raises the chance of accidental backup, log, shell, or repository exposure.

Change:

- Added `chain.facilitator.seedPhraseFile` and
  `chain.facilitator.privateKeyFile`.
- POSIX credential files must be regular files and must not be group/world
  readable or writable.
- Mainnet now rejects inline facilitator signing material unless
  `CARDANO402_ALLOW_MAINNET_INLINE_SIGNING_KEY=true` is explicitly set.
- `chain.facilitator.signerMode` is now explicit and defaults to the only
  implemented root facilitator mode, `local-file`.
- `/health` now reports non-secret signer posture under `policy.signer`,
  including mode, credential source, and whether the signer is a hot-wallet
  mode.
- Updated deployment examples and runbooks to use file-based signing material.
- Added a Mainnet signer isolation plan that treats file-based Mainnet
  credentials as a hot-wallet interim state, not the final high-value signer
  architecture.

Evidence:

- `src/chain/config.ts`
- `tests/unit/config.test.ts`
- `config/config.example.json`
- `docs/deployment.md`
- `docs/operations.md`
- `docs/vps-deployment.md`
- `docs/mainnet-signer-isolation.md`
- `scripts/protocol-monitor.mjs`

### F5 - Dependency audit gate was too soft

Previous risk: CI dependency audit was non-blocking and high-only.

Change:

- CI now runs `pnpm audit --prod --audit-level=moderate`.
- Added a pnpm override for the vulnerable transitive `ip-address` range under
  the Cardano SDK dependency path.

Evidence:

- `.github/workflows/ci.yml`
- `package.json`
- `pnpm-lock.yaml`

## Current live-site findings

### L1 - Agent API endpoints are Cloudflare-challenged

Observed on 2026-05-25 UTC, most recently at 2026-05-25T08:34:57Z:

- `GET https://cardano402.com/.well-known/x402.json` returns HTTP 200 JSON.
- `GET https://cardano402.com/health` returns HTTP 403 with
  `cf-mitigated: challenge`.
- `GET https://cardano402.com/supported` returns HTTP 403 with
  `cf-mitigated: challenge`.
- `POST https://cardano402.com/verify` returns HTTP 403 with
  `cf-mitigated: challenge`.
- `POST https://cardano402.com/settle` returns HTTP 403 with
  `cf-mitigated: challenge`.

Security interpretation:

- The challenge helps reduce opportunistic abuse.
- It also blocks non-browser agents and resource servers from using the hosted
  facilitator API. If `cardano402.com` is intended to be a public facilitator,
  this is an availability/protocol-compatibility defect.

Recommendation:

- Keep browser challenges for marketing/root pages if desired.
- Add Cloudflare WAF skip rules for machine API routes that must be reachable:
  `/.well-known/x402.json`, `/supported`, `/verify`, `/settle`, `/status`, and
  paid-demo routes.
- Compensate with route-specific rate limits, body-size caps, origin logging,
  and optional API-key tiers for hosted-facilitator abuse control.
- Keep admin/deploy/metrics endpoints private or tailnet-only.

Follow-up added in this branch:

- `pnpm monitor:protocol` now checks machine endpoints and fails on Cloudflare
  challenges, HTML responses, or unexpected statuses.
- `docs/operations.md` now includes a Cloudflare WAF posture and verification
  runbook for preserving machine access without dropping abuse controls.

### L2 - Hosted manifest advertises no paid endpoints

Observed `/.well-known/x402.json` returns `endpoints: []`.

Interpretation:

- This is safe if the hosted domain is only a facilitator/landing host.
- It is confusing if users expect a demo paid endpoint to appear in discovery.

Recommendation:

- Decide whether the hosted domain is a public facilitator only, a demo resource
  server, or both.
- Reflect that decision in the manifest and docs.

## Remaining risks before "production money-safe"

### R1 - Remote signer support

The MCP server still uses a local hot signing wallet. File-based seed loading is
better than env material, but for Mainnet the safer target is a remote signer,
hardware wallet bridge, or policy engine that can enforce address, asset,
amount, TTL, and daily caps outside the MCP process.

The root facilitator also currently initializes local Lucid signing material.
For most public `/verify` and `/settle` calls, the facilitator settles
client-signed transactions rather than spending from its own wallet. Still, any
future facilitator-owned transaction, administrative transaction, demo-wallet
flow, or agent automation should use the signer isolation model in
`docs/mainnet-signer-isolation.md`.

Recommended next step:

- Implement the documented signer provider boundary.
- Support a process/HTTP signer adapter with strict request schema and timeout.
- Require human approval or policy proof for Mainnet amounts above a low
  threshold.

### R2 - Confirmation policy must be operator-visible

The code defaults away from mempool access, which is correct. `/health` now
reports non-secret confirmation policy under `policy.confirmation`, including
network, confirmation mode, nonce requirement, timeout, and minimum
confirmations. `pnpm monitor:protocol` now validates that policy and fails on
unexpected mempool mode, disabled nonce enforcement, missing policy, or
minimum-confirmation drift below the configured threshold. The same monitor also
checks that `/health` exposes signer posture.

Recommended next step:

- Add a deployment table mapping low/test, normal, and high-value resources to
  `minConfirmations` and timeouts.
- Re-enable the protocol monitor schedule and wire its result into alerting
  once the live Cloudflare WAF skip rules are applied.

### R3 - Script method is not implemented

The spec describes script payments. This repo correctly refuses them today, but
that means it is not a complete implementation of every Cardano `exact` method.

Recommended next step:

- Keep refusal behavior until a full Plutus parameter application and datum
  verification path exists.
- Add conformance fixtures when upstream publishes them.

### R4 - Public facilitator abuse economics

`/verify` performs CBOR parsing and chain lookups; `/settle` can submit to the
chain provider. Public deployment needs abuse controls that preserve agent
access.

Recommended next step:

- Keep strict body limits.
- Add per-IP and per-ASN rate limits at Cloudflare and Fastify.
- Track `facilitator_payment_results_total` for rejected verification reason
  counts, settlement failures, and status polling drift. The metric uses
  bounded reason labels to avoid attacker-controlled Prometheus cardinality.
- Add request-cost dashboards for Blockfrost quota burn.

### R5 - Supply-chain controls need enforcement visibility

The repository has strong workflow coverage: CodeQL, OSV Scanner, dependency
review, Gitleaks, Scorecard, Zizmor, pinned actions, and Harden-Runner. The next
gap is making those results visible and mandatory before release.

Recommended next step:

- Require passing status checks on protected branches.
- Turn on GitHub private vulnerability reporting.
- Keep `docs/release-readiness.md` and `pnpm security:release` current as
  branch protection and package publishing policy changes.

## Tool recommendations

Already present or appropriate for this repo:

- Sentry: keep for server exceptions, MCP crashes, settlement errors, and cron
  monitors. Add alert routing for settlement failures, chain-provider failures,
  and error-rate spikes.
- CodeQL: keep `security-and-quality`; require it on protected branches.
- OSV Scanner: keep for transitive vulnerability coverage beyond npm audit.
- Gitleaks: keep; add pre-commit or pre-push local instructions for operators.
- Dependency Review: keep for PR-time diff visibility.
- OpenSSF Scorecard: keep; monitor branch protection and token-permission
  signals.
- Zizmor: keep for GitHub Actions hardening.
- StepSecurity Harden-Runner: keep; switch select jobs from `audit` to
  allowlisted egress after baseline noise is understood.
- Greptile or equivalent AI code review: useful as a paid PR reviewer for
  security-sensitive changes, but do not treat it as an approval gate by itself.
- Semgrep: add custom rules for payment-specific anti-patterns:
  client-supplied `paymentRequirements`, missing settlement before handler
  execution, unsafe seed handling, and Cloudflare/API challenge bypass drift.
  The repo now has a dependency-free local check for the highest-risk subset
  plus `semgrep/payment-security.yml` and `pnpm security:semgrep` for optional
  AST-aware enforcement across adapters.
- Socket or Snyk: paid dependency intelligence can complement OSV/npm audit,
  especially for maintainer-risk and install-script behavior.
- Cloudflare WAF/Bot Management: use route-specific API allowances instead of a
  blanket managed challenge on machine endpoints.

## Verification performed

Commands run after the current MCP and SDK changes:

- `pnpm --filter @cardano402/mcp-server test`
- `pnpm --filter @cardano402/mcp-server test -- spend-tracker.test.ts`
- `pnpm --filter @cardano402/mcp-server test -- payment-guards.test.ts`
- `pnpm --filter @cardano402/mcp-server typecheck`
- `pnpm --filter @cardano402/mcp-server build`
- `pnpm typecheck`
- `pnpm test -- --runInBand`
- `pnpm audit --prod`
- `pnpm security:payments`
- `pnpm security:release`
- `pnpm monitor:protocol -- --base-url <local-json-mock> --json`
- `rg -n "<protected-brand-pattern>" .`
- `curl -i https://cardano402.com/.well-known/x402.json`
- `curl -i https://cardano402.com/health`
- `curl -i https://cardano402.com/supported`
- `curl -i -X POST https://cardano402.com/verify ...`
- `curl -i -X POST https://cardano402.com/settle ...`

Results:

- MCP spend-tracker test run passed: 106 tests.
- MCP payment-guards test run passed: 104 tests.
- Root test suite passed: 472 tests in the latest full run on this hardening
  branch.
- Typecheck passed.
- MCP build passed.
- Production dependency audit reported no known vulnerabilities.
- Payment invariant check passed.
- Release readiness check passed.
- Protected brand search returned no local matches.
- Live well-known manifest is reachable.
- Live machine API endpoints are currently challenged by Cloudflare.
